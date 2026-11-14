import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  parseLabControls,
  parseLabVideos,
  stampText,
  stateName,
} from '@/features/morning-feed/player-lab';
import { playerHeight } from '@/features/morning-feed/watch-r3-layout';
import './player-lab.css';

/*
 * Device test page for the watch screen's player (stg, /morning-cards/player-lab). One YouTube
 * IFrame player, nothing drawn over it. Records every player event with a time so the results on
 * an iPhone can be read back. No server calls, no judgments, no batches.
 *
 * Checks (James 2026-11-13):
 *  1. controls=0: what YouTube still shows (title, channel, pause screen)
 *  2. sound on from OUR button vs from YouTube's own control
 *  3. sound kept across a video swap (loadVideoById); when blocked, back to muted
 *  4. a tap on the video pauses it (YouTube); can we then turn sound on and play from our side
 */

interface LabPlayer {
  loadVideoById(id: string): void;
  cueVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getPlayerState(): number;
  destroy(): void;
}
interface LabApi {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: Record<string, (e: { target: LabPlayer; data?: unknown }) => void>;
    }
  ) => LabPlayer;
}
interface LabWindow {
  YT?: LabApi;
  onYouTubeIframeAPIReady?: () => void;
}

const API_SRC = 'https://www.youtube.com/iframe_api';
const PLAYING = 1;
const PAUSED = 2;
const POLL_MS = 250;
/** Same grace as the deck player: no PLAYING with sound by then = blocked. */
const SOUND_CHECK_MS = 1500;
/** Swap check: keep looking this long for the first PLAYING, so slow loading is told apart from refused sound. */
const SWAP_WAIT_MAX_MS = 6000;
/** The watch screen's two delays before it loads the next video (2026-11-14 sound-loss test). */
const DELAY_REVEAL_MS = 30;
const DELAY_DISLIKE_MS = 800;
const MAX_LOG = 200;
/** Swap-method test (2026-11-14): when the arriving card's player is more than half visible. */
const SWAP_REVEAL_MS = 20;
const CUED = 5;

/**
 * How the next video replaces the current one (black-frame test, James 2026-11-14):
 * - load: pause, then loadVideoById once the player is more than half visible (the watch screen)
 * - cue: cueVideoById at the swipe (no playback), playVideo once more than half visible
 * - cover: as load, but the next thumbnail is shown and the player is not displayed until PLAYING
 * - cue-cover: cue + cover
 */
export type SwapMethod = 'load' | 'cue' | 'cover' | 'cue-cover';
const SWAP_METHODS: readonly SwapMethod[] = ['load', 'cue', 'cover', 'cue-cover'];
function parseSwapMethod(v: string | null): SwapMethod {
  return (SWAP_METHODS as readonly string[]).includes(v ?? '') ? (v as SwapMethod) : 'load';
}

let apiPromise: Promise<LabApi> | null = null;
function loadApi(): Promise<LabApi> {
  const w = window as unknown as LabWindow;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<LabApi>((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (w.YT) resolve(w.YT);
    };
    const s = document.createElement('script');
    s.src = API_SRC;
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('youtube api failed to load'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export function PlayerLab(): JSX.Element {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  const videos = parseLabVideos(q.get('v'));
  const controls = parseLabControls(q.get('controls'));

  const t0 = useRef(performance.now());
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<LabPlayer | null>(null);
  const [idx, setIdx] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [muted, setMuted] = useState(true);
  const [state, setState] = useState('-');
  const [keepSound, setKeepSound] = useState(true);
  const [autoOnPause, setAutoOnPause] = useState(false);
  const autoRef = useRef(autoOnPause);
  autoRef.current = autoOnPause;
  const lastMuted = useRef(true);
  /** Sound wanted, remembered the moment a button is pressed (James 2026-11-13: isMuted() lags on iOS). */
  const wantSound = useRef(false);
  /** Our own command just changed the sound: the polled state is ignored until then. */
  const quietUntil = useRef(0);
  /** The one pending sound check; cancelled on every swap and tied to a video id. */
  const check = useRef<number | null>(null);
  const loadedId = useRef('');
  const [width, setWidth] = useState(() => Math.min(window.innerWidth, 430));
  const [method, setMethod] = useState<SwapMethod>(() => parseSwapMethod(q.get('swap')));
  /** cover methods: the player is not displayed until the next video is PLAYING. */
  const [covered, setCovered] = useState(false);
  const coveredRef = useRef(false);
  const swapStart = useRef(0);
  /** cue methods: play as soon as both the reveal time has passed and the video is CUED. */
  const playWhenCued = useRef<{ id: string; revealed: boolean; cued: boolean } | null>(null);
  const [thumbId, setThumbId] = useState(videos[0] ?? '');

  const add = useCallback((line: string) => {
    const entry = stampText(performance.now() - t0.current) + '  ' + line;
    setLog((l) => [entry, ...l].slice(0, MAX_LOG));
  }, []);

  useEffect(() => {
    const onResize = (): void => setWidth(Math.min(window.innerWidth, 430));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** Checks shortly after a sound-on attempt whether it really plays with sound (log only). */
  const checkSound = useCallback(
    (label: string) => {
      if (check.current != null) window.clearTimeout(check.current);
      const id = loadedId.current;
      check.current = window.setTimeout(() => {
        check.current = null;
        const p = player.current;
        if (!p || loadedId.current !== id) return;
        const st = p.getPlayerState();
        const m = p.isMuted();
        add(label + ' → ' + stateName(st) + (m ? ', 음소거' : ', 소리 켜짐'));
      }, SOUND_CHECK_MS);
    },
    [add]
  );

  useEffect(() => {
    let alive = true;
    let poll: number | null = null;
    const mount = document.createElement('div');
    host.current?.appendChild(mount);
    add('플레이어 만들기 (controls=' + controls + ')');
    loadApi()
      .then((yt) => {
        if (!alive) return;
        player.current = new yt.Player(mount, {
          videoId: videos[0],
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, controls, origin: window.location.origin },
          events: {
            onReady: (e) => {
              const p = e.target;
              loadedId.current = videos[0];
              p.mute();
              p.playVideo();
              add('onReady → mute + playVideo (음소거 자동 재생)');
              poll = window.setInterval(() => {
                try {
                  const m = p.isMuted();
                  setMuted(m);
                  // right after our own command the reading can lag: don't take it as a change
                  if (performance.now() < quietUntil.current) return;
                  if (m !== lastMuted.current) {
                    lastMuted.current = m;
                    // YouTube's own control (or the browser) changed it
                    wantSound.current = !m;
                    add(m ? '음소거됨' : '소리 켜짐 (감지)');
                  }
                } catch {
                  /* player gone */
                }
              }, POLL_MS);
            },
            onStateChange: (e) => {
              const s = Number(e.data);
              setState(stateName(s));
              add('상태: ' + stateName(s));
              if (s === PLAYING && swapStart.current) {
                add('교체 → 재생까지 ' + Math.round(performance.now() - swapStart.current) + 'ms');
                swapStart.current = 0;
              }
              const pw = playWhenCued.current;
              if (s === CUED && pw && pw.id === loadedId.current) {
                pw.cued = true;
                if (pw.revealed) {
                  playWhenCued.current = null;
                  e.target.playVideo();
                  add('CUED → playVideo');
                }
              }
              if (s === PLAYING && coveredRef.current) {
                coveredRef.current = false;
                setCovered(false);
              }
              // check 4 (automatic): YouTube paused it after a tap -> sound on and play, no gesture
              if (s === PAUSED && autoRef.current && !wantSound.current) {
                wantSound.current = true;
                lastMuted.current = false;
                quietUntil.current = performance.now() + SOUND_CHECK_MS;
                e.target.unMute();
                e.target.playVideo();
                add('일시정지 감지 → 자동 unMute + playVideo (사용자 제스처 아님)');
                checkSound('자동 소리 켜고 재생');
              }
            },
            onAutoplayBlocked: () => add('onAutoplayBlocked (소리 있는 자동 재생 막힘)'),
            onError: (e) => add('onError ' + String(e.data)),
          },
        });
      })
      .catch(() => add('YouTube API 를 불러오지 못함'));
    return () => {
      alive = false;
      if (poll != null) window.clearInterval(poll);
      try {
        player.current?.destroy();
      } catch {
        /* already gone */
      }
      player.current = null;
      mount.remove();
    };
    // the player is built once per page (controls change reloads the page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const soundOn = (): void => {
    const p = player.current;
    if (!p) return;
    wantSound.current = true;
    lastMuted.current = false;
    quietUntil.current = performance.now() + SOUND_CHECK_MS;
    p.unMute();
    p.playVideo();
    add('우리 단추: unMute + playVideo (사용자 탭 안에서)');
    checkSound('우리 단추');
  };
  const soundOff = (): void => {
    wantSound.current = false;
    lastMuted.current = true;
    quietUntil.current = performance.now() + SOUND_CHECK_MS;
    player.current?.mute();
    add('우리 단추: mute');
  };
  const swap = (step: 1 | -1, delayMs = 0): void => {
    const p = player.current;
    if (!p) return;
    const next = (idx + step + videos.length) % videos.length;
    const id = videos[next];
    setIdx(next);
    // the previous swap's check must not judge this video
    if (check.current != null) {
      window.clearTimeout(check.current);
      check.current = null;
    }
    // the sound wanted as remembered when the button was pressed, not a fresh isMuted() read
    const withSound = keepSound && wantSound.current;
    lastMuted.current = !withSound;
    quietUntil.current = performance.now() + SOUND_CHECK_MS;
    if (withSound) p.unMute();
    else p.mute();
    loadedId.current = id;
    p.loadVideoById(id);
    const how = delayMs > 0 ? ', 누른 뒤 ' + delayMs + 'ms 지연' : ', 누른 순간';
    add('영상 교체 → ' + id + (withSound ? ' (소리 유지 시도' : ' (음소거') + how + ')');
    if (!withSound) return;
    // Sound test 2026-11-14: read the state at 1.5 s as the watch screen does, but only give up
    // on sound once the video is PLAYING muted or never plays within 6 s. "느린 로딩" lines show
    // where the watch screen's 1.5 s check would have muted a video that kept its sound.
    const started = performance.now();
    let early = true;
    const look = (): void => {
      check.current = null;
      const cur = player.current;
      if (!cur || loadedId.current !== id) return;
      const st = cur.getPlayerState();
      const m = cur.isMuted();
      const at = Math.round(performance.now() - started) + 'ms';
      if (st === PLAYING && !m) {
        add(
          (early
            ? '소리 유지 성공 → '
            : '소리 유지 성공 (느린 로딩, 1.5초 검사였다면 음소거됨) → ') +
            id +
            ' ' +
            at
        );
        return;
      }
      if (st === PLAYING || performance.now() - started >= SWAP_WAIT_MAX_MS) {
        add(
          '소리 유지 실패 → ' +
            id +
            ' (' +
            stateName(st) +
            (m ? ', 음소거 상태' : '') +
            ', ' +
            at +
            ') → 음소거로 되돌리고 재생'
        );
        wantSound.current = false;
        lastMuted.current = true;
        cur.mute();
        cur.playVideo();
        return;
      }
      if (early)
        add(
          '1.5초 시점: ' + id + ' ' + stateName(st) + (m ? ', 음소거 상태' : '') + ' → 더 기다림'
        );
      early = false;
      check.current = window.setTimeout(look, POLL_MS);
    };
    check.current = window.setTimeout(look, SOUND_CHECK_MS);
  };
  /** Next video by the chosen method, muted (the feed), for the black-frame test. */
  const swapByMethod = (): void => {
    const p = player.current;
    if (!p) return;
    const next = (idx + 1) % videos.length;
    const id = videos[next];
    setIdx(next);
    if (check.current != null) {
      window.clearTimeout(check.current);
      check.current = null;
    }
    wantSound.current = false;
    lastMuted.current = true;
    quietUntil.current = performance.now() + SOUND_CHECK_MS;
    p.mute();
    loadedId.current = id;
    swapStart.current = performance.now();
    setThumbId(id);
    const cover = method === 'cover' || method === 'cue-cover';
    if (cover) {
      coveredRef.current = true;
      setCovered(true);
    }
    add('방식 ' + method + ' → ' + id);
    if (method === 'cue' || method === 'cue-cover') {
      playWhenCued.current = { id, revealed: false, cued: false };
      p.cueVideoById(id);
      window.setTimeout(() => {
        const pw = playWhenCued.current;
        if (!pw || pw.id !== id) return;
        pw.revealed = true;
        if (pw.cued) {
          playWhenCued.current = null;
          p.playVideo();
          add('reveal → playVideo');
        }
      }, SWAP_REVEAL_MS);
    } else {
      p.pauseVideo();
      window.setTimeout(() => {
        if (loadedId.current === id) p.loadVideoById(id);
      }, SWAP_REVEAL_MS);
    }
  };

  /** The same swap started outside the tap, as the watch screen does (reveal wait, 별로 wait). */
  const swapLater = (delayMs: number): void => {
    add('단추 누름 → ' + delayMs + 'ms 뒤 교체');
    window.setTimeout(() => swap(1, delayMs), delayMs);
  };

  const otherControls = controls === 1 ? 0 : 1;
  const reloadHref = (() => {
    const n = new URLSearchParams(search);
    n.set('controls', String(otherControls));
    return '/morning-cards/player-lab?' + n.toString();
  })();

  const copyLog = (): void => {
    const text = [navigator.userAgent, 'controls=' + controls, ...[...log].reverse()].join('\n');
    navigator.clipboard?.writeText(text).then(
      () => add('기록 복사됨'),
      () => add('복사 실패 — 기록을 길게 눌러 선택하세요')
    );
  };

  return (
    <div className="mf-lab" data-testid="player-lab">
      <div className="mf-lab-head">
        <b>플레이어 시험</b>
        <span>
          controls={controls} · 영상 {idx + 1}/{videos.length} · {state} ·{' '}
          {muted ? '음소거' : '소리 켜짐'}
        </span>
      </div>
      <div
        className="mf-lab-player"
        style={{ height: playerHeight(width) + 'px' }}
        ref={host}
        data-cover={covered ? '' : undefined}
        data-testid="lab-player"
      >
        {thumbId ? (
          <img
            className="mf-lab-thumb"
            src={'https://i.ytimg.com/vi/' + thumbId + '/hqdefault.jpg'}
            alt=""
          />
        ) : null}
      </div>
      <div className="mf-lab-row">
        {SWAP_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            data-on={m === method ? '' : undefined}
            onClick={() => setMethod(m)}
            data-testid={'lab-method-' + m}
          >
            {m}
          </button>
        ))}
        <button type="button" onClick={swapByMethod} data-testid="lab-next-method">
          다음 영상 (방식)
        </button>
      </div>
      <div className="mf-lab-row">
        <button type="button" onClick={soundOn} data-testid="lab-sound-on">
          소리 켜기 (우리 단추)
        </button>
        <button type="button" onClick={soundOff}>
          소리 끄기
        </button>
      </div>
      <div className="mf-lab-row">
        <button type="button" onClick={() => swap(-1)}>
          이전 영상
        </button>
        <button type="button" onClick={() => swap(1)} data-testid="lab-next">
          다음 영상
        </button>
      </div>
      <div className="mf-lab-row">
        <button type="button" onClick={() => swapLater(DELAY_REVEAL_MS)} data-testid="lab-next-30">
          다음 영상 (30ms 뒤)
        </button>
        <button
          type="button"
          onClick={() => swapLater(DELAY_DISLIKE_MS)}
          data-testid="lab-next-800"
        >
          다음 영상 (0.8초 뒤)
        </button>
      </div>
      <label className="mf-lab-check">
        <input
          type="checkbox"
          checked={keepSound}
          onChange={(e) => setKeepSound(e.target.checked)}
        />
        영상 교체 때 소리 유지 (막히면 음소거로 복귀)
      </label>
      <label className="mf-lab-check">
        <input
          type="checkbox"
          checked={autoOnPause}
          onChange={(e) => setAutoOnPause(e.target.checked)}
        />
        영상을 눌러 일시정지되면 자동으로 소리 켜고 재생
      </label>
      <div className="mf-lab-row">
        <a href={reloadHref}>controls={otherControls} 로 다시 열기</a>
        <button type="button" onClick={copyLog}>
          기록 복사
        </button>
        <button type="button" onClick={() => setLog([])}>
          지우기
        </button>
      </div>
      <ol className="mf-lab-log" data-testid="lab-log">
        {log.map((l, i) => (
          <li key={log.length - i}>{l}</li>
        ))}
      </ol>
    </div>
  );
}
