import { useEffect, useMemo, useRef, useState } from 'react';

import { parseSafeOverride, useWatchFrame } from '@/features/morning-feed/use-watch-frame';
import { buildWatchSummary, type InsightView } from '@/features/morning-feed/watch-design';
import {
  WatchFeed,
  type R3PlayerEvents,
  type R3Video,
  type WatchFeedProps,
} from '@/features/morning-feed/watch-r3-feed';
import { LAB_DEFAULT_VIDEOS } from '@/features/morning-feed/player-lab';
import { WatchPlayer, type PlayerController } from '@/features/morning-feed/WatchPlayer';
import {
  WatchDoneR3,
  WatchInputR3,
  type R3InputState,
} from '@/features/morning-feed/watch-r3-screens';
import type { BootStage } from '@/features/morning-feed/watch-boot-stage';
import { WatchBoot } from '@/features/morning-feed/WatchBoot';
import './watch.css';
import './watch-r3.css';

/*
 * Test hook for side-by-side captures with design handoff "design_handoff_insighta_watch_v2"
 * (/morning-cards?view=watch&fixture=1&preset=…): the handoff's example data (WatchPhone.dc.html
 * VIDS, CHIPS, PRESETS) on the real components. No sign-in, no network, no player: the player
 * layer is a stand-in box. `&safe=47,34` gives the safe areas of "막대 없음" (a desktop browser
 * has none). `&thumbs=<url>,<url>` optionally supplies the two example thumbnails (they are not
 * stored in the repository).
 */

interface FixtureVid {
  t: string;
  ch: string;
  min: number;
  up: string;
  fresh?: boolean;
  views: string;
  img?: string;
  ph: string;
  amb: string;
  why?: string;
  sum?: string;
  checks?: string[];
  pts?: Array<[string, string]>;
}

/** WatchPhone.dc.html (수정 4) B5, copied. `img` is the index into `&thumbs=` (not stored here). */
const VIDS: FixtureVid[] = [
  {
    t: 'Figma Agent로 완벽한 디자인 만들기',
    ch: '코드팩토리',
    min: 6,
    up: '3일 전',
    fresh: true,
    views: '1.2만회',
    img: '0',
    ph: '#201E32',
    amb: '#201E32',
    why: "좋아요한 영상이 있는 채널 '코드팩토리'의 영상입니다.",
    sum: '[한 줄 요약 — 데이터가 있을 때만 보임, 최대 2줄]',
    checks: ['진행자 1명', '한국어 음성'],
    pts: [
      ['00:00', '[목차 항목]'],
      ['02:10', '[목차 항목]'],
      ['04:30', '[목차 항목]'],
    ],
  },
  {
    t: 'Kling 4.0(클링) vs Seedance 2.5(시댄스) 포함 AI 영상 모델 9개, 한국어 대사 장면 점수 공개 | Higgsfield 힉스필드',
    ch: 'AI 겸임교수 이종범',
    min: 13,
    up: '5일 전',
    fresh: true,
    views: '8.4천회',
    img: '1',
    ph: '#2B2419',
    amb: '#2B2419',
    why: '[고른 이유]',
    sum: '[한 줄 요약]',
    checks: ['진행자 1명', '한국어 음성'],
  },
  {
    t: 'I Built an Auto Router for Local LLMs with LiteLLM + Pi Coding Agent',
    ch: 'Execute Automation',
    min: 20,
    up: '9월 11일',
    views: '4.1천회',
    ph: '#4C6E66',
    amb: '#1C2A27',
  },
  {
    t: '(1부) 챗GPT vs 제미나이 vs 클로드, AI 승자 답 나왔습니다',
    ch: '언더스탠딩 : 세상의 모든 지식',
    min: 48,
    up: '10월 30일',
    views: '31만회',
    img: '2',
    ph: '#2F2318',
    amb: '#2F2318',
    why: '[고른 이유]',
  },
  {
    t: '직장인 야근 탈출 치트키? PPT 뼈대 제대로 만들어주는 미친 오픈소스.. ㄷㄷ',
    ch: '[채널명]',
    min: 8,
    up: '11월 2일',
    views: '2.6만회',
    ph: '#8A6F4A',
    amb: '#30271A',
    why: '[고른 이유]',
    sum: '[한 줄 요약]',
    checks: ['한국어 음성'],
  },
];
const CHIPS = ['기술·개발', '비즈니스', '재테크', '학습', '건강', '인간관계', '창작', '라이프'];
const GOAL = '기술·개발';
const HISTORY = [
  { t: '영어 회의에서 말문 트기', meta: '10월 28일 · 12편' },
  { t: '달리기 10km 완주하기', meta: '10월 14일 · 8편' },
];
type Reaction = 'like' | 'dislike' | 'skip';
const DONE_R: Reaction[] = ['like', 'dislike', 'skip', 'skip', 'skip'];

interface Preset {
  screen: 'input' | 'feed' | 'done' | 'boot';
  boot?: BootStage;
  idx?: number;
  maxIdx?: number;
  mode?: 'feed' | 'imm';
  phase?: 'thumb' | 'player';
  playing?: boolean;
  sound?: boolean;
  prog?: number;
  sheet?: boolean;
  loading?: boolean;
  dragFrac?: number;
  count?: number;
  reacts?: Reaction[];
  reacting?: 'like' | 'dislike';
  doneToday?: boolean;
  carry?: boolean;
}
const F = 'feed' as const;
const SND = { screen: F, mode: 'imm' as const, sound: true, prog: 34 };
/** WatchPhone.dc.html (수정 4) PRESETS, same names (watch screen; input/done unchanged here). */
const R3_PRESETS: Record<string, Preset> = {
  'boot-logo': { screen: 'boot', boot: 'logo' },
  'boot-load': { screen: 'boot', boot: 'line' },
  'boot-skel': { screen: 'boot', boot: 'skeleton' },
  input: { screen: 'input' },
  'input-done': { screen: 'input', doneToday: true, reacts: DONE_R },
  'input-carry': { screen: 'input', carry: true },
  feed: { screen: F, prog: 4 },
  'feed-mid': { screen: F, prog: 4, dragFrac: 0.45 },
  'feed-after': { screen: F, idx: 1, maxIdx: 1, phase: 'thumb', prog: 0, reacts: ['skip'] },
  'feed-loading': { screen: F, loading: true, phase: 'thumb' },
  'feed-more': { screen: F, prog: 4, sheet: true },
  'feed-liked': { screen: F, prog: 4, reacts: ['like'], reacting: 'like' },
  'feed-34': { screen: F, prog: 4, count: 34, idx: 7, maxIdx: 7 },
  imm: { ...SND },
  'imm-paused': { ...SND, playing: false },
  'imm-min': { ...SND, idx: 2, maxIdx: 2, reacts: ['like', 'skip'] },
  'imm-muted': { ...SND, sound: false },
  'imm-next': { ...SND, idx: 1, maxIdx: 1, prog: 3, reacts: ['like'] },
  'imm-mid': { ...SND, dragFrac: 0.45 },
  'imm-after': { ...SND, idx: 1, maxIdx: 1, phase: 'thumb', prog: 0, reacts: ['skip'] },
  'imm-back-mid': { ...SND, idx: 1, maxIdx: 1, dragFrac: -0.45, reacts: ['skip'] },
  'imm-rev-like': { ...SND, idx: 0, maxIdx: 2, prog: 0, reacts: ['like', 'skip'] },
  'imm-rev-dislike': { ...SND, idx: 1, maxIdx: 3, prog: 0, reacts: ['like', 'dislike', 'skip'] },
  'imm-rev-skip': { ...SND, idx: 1, maxIdx: 2, prog: 0, reacts: ['like', 'skip'] },
  'imm-more': { ...SND, sheet: true },
  'imm-34': { ...SND, count: 34, idx: 13, maxIdx: 13 },
  'imm-liked': { ...SND, reacts: ['like'], reacting: 'like' },
  done: { screen: 'done', reacts: DONE_R },
};

function toVideos(thumbs: string[], count: number): R3Video[] {
  return Array.from({ length: count }, (_x, i) => {
    const v = VIDS[i % VIDS.length];
    return {
      key: 'fx' + i,
      videoId: 'fx' + i,
      title: v.t,
      channel: v.ch,
      initial: v.ch.replace('[', '')[0] ?? '',
      altIcon: i % 2 === 1,
      durationSec: v.min * 60,
      ageText: v.up,
      fresh: !!v.fresh,
      viewsText: '조회수 ' + v.views,
      thumbUrl: v.img !== undefined ? thumbs[Number(v.img)] : undefined,
      ambient: v.amb,
      slotBg: v.ph,
      why: v.why ?? '',
      summary: v.sum ?? '',
      checks: v.checks ?? [],
      chapters: (v.pts ?? []).map(([at, title]) => ({ at, title })),
    };
  });
}

function tagOf(v: FixtureVid, r: Reaction | undefined): string {
  if (r === 'like') return '좋아 · ' + v.min + '분';
  if (r === 'dislike') return '별로 · ' + v.min + '분';
  return '넘김';
}

function insightOf(reacts: readonly Reaction[]): InsightView {
  const seen = VIDS.filter((_v, i) => reacts[i] === 'like' || reacts[i] === 'dislike');
  const mins = seen.reduce((a, v) => a + v.min, 0);
  const likes = reacts.filter((r) => r === 'like').length;
  return {
    paragraph: buildWatchSummary({
      received: VIDS.length,
      watched: seen.length,
      minutes: mins,
      topBranch: GOAL,
      likes,
      skips: VIDS.length - seen.length,
    }),
    stats: [
      { k: '본 영상', v: seen.length, u: '편' },
      { k: '본 시간', v: mins, u: '분' },
      { k: '좋아', v: likes, u: '편' },
    ],
    rows: VIDS.map((v, i) => ({
      key: 'r' + i,
      title: v.t,
      tag: tagOf(v, reacts[i]),
      kind: reacts[i] === 'like' ? 'like' : reacts[i] === 'dislike' ? 'dislike' : 'pass',
    })),
    bars: [{ label: GOAL, min: mins, minText: mins + '분', pct: 100 }],
  };
}

/**
 * The player layer's stand-in: the loaded video's thumbnail colour (and image) and, when stopped,
 * a play mark where YouTube's own button would be. Implements the player commands: a load
 * reports PLAYING right away (unless the preset is paused or still on the thumbnail).
 */
function FakePlayer({
  events,
  controller,
  videos,
  playing,
  holdThumb,
  prog,
}: {
  events: R3PlayerEvents;
  controller: { current: PlayerController | null };
  videos: R3Video[];
  playing: boolean;
  holdThumb: boolean;
  prog: number;
}): JSX.Element {
  const ev = useRef(events);
  ev.current = events;
  const [id, setId] = useState('');
  useEffect(() => {
    controller.current = {
      load: (videoId, _start, withSound) => {
        setId(videoId);
        ev.current.onMuted(!withSound);
        const v = videos.find((x) => x.videoId === videoId);
        const dur = v?.durationSec ?? 0;
        ev.current.onTick({ videoId, seconds: (dur * prog) / 100, duration: dur, playing: false });
        if (!holdThumb) window.setTimeout(() => ev.current.onPlaying(videoId), 0);
      },
      soundOn: () => ev.current.onMuted(false),
      soundOff: () => ev.current.onMuted(true),
      pause: () => undefined,
    };
    ev.current.onReady();
    return () => {
      controller.current = null;
    };
  }, [controller, videos, prog, holdThumb]);
  const video = videos.find((v) => v.videoId === id);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: video?.slotBg ?? 'var(--w3-navy)',
      }}
    >
      {video?.thumbUrl ? (
        <img
          src={video.thumbUrl}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      ) : null}
      {!playing ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 56,
            height: 56,
            marginLeft: -28,
            marginTop: -28,
            borderRadius: 28,
            background: 'var(--w3-on)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6 3l12 7-12 7z" fill="var(--w3-navy)" />
          </svg>
        </div>
      ) : null}
    </div>
  );
}

export function MorningWatchR3Fixture({
  preset,
  safe,
  thumbs,
  real = false,
}: {
  preset: string | null;
  safe: string | null;
  thumbs: string | null;
  /** Measurement only: the real YouTube player with the player lab's public videos. */
  real?: boolean;
}): JSX.Element {
  const pr = R3_PRESETS[preset ?? ''] ?? R3_PRESETS.input;
  const override = useMemo(() => parseSafeOverride(safe), [safe]);
  const app = useRef<HTMLDivElement>(null);
  const frame = useWatchFrame(app, override ?? { safeTop: 0, safeBottom: 0 });
  const thumbList = useMemo(
    () => (thumbs ?? '').split(',').filter((t) => /^https?:\/\//.test(t)),
    [thumbs]
  );
  const videos = useMemo(() => {
    const v = toVideos(thumbList, pr.count ?? VIDS.length);
    return real
      ? v.map((x, i) => ({ ...x, videoId: LAB_DEFAULT_VIDEOS[i % LAB_DEFAULT_VIDEOS.length] }))
      : v;
  }, [thumbList, pr.count, real]);
  const player = useRef<PlayerController | null>(null);
  const [sound, setSound] = useState(!!pr.sound);
  const [screen, setScreen] = useState(pr.screen);
  const [reacts, setReacts] = useState<Reaction[]>(pr.reacts ?? []);

  let body: JSX.Element;
  if (screen === 'boot') {
    body = (
      <WatchBoot
        fixed={pr.boot}
        safe={override ? { top: override.safeTop, bottom: override.safeBottom } : undefined}
      />
    );
  } else if (screen === 'input') {
    const state: R3InputState = pr.carry
      ? { kind: 'carry', goal: GOAL, count: VIDS.length, thumbs: [], onGo: () => setScreen('feed') }
      : pr.doneToday
        ? {
            kind: 'done',
            goal: GOAL,
            stats: insightOf(reacts).stats,
            rows: insightOf(reacts).rows,
            onOpen: () => setScreen('done'),
          }
        : { kind: 'hero' };
    body = (
      <WatchInputR3
        frame={frame}
        dateLabel="11월 11일 수요일"
        account={{ name: '[이름]', email: '[이메일]', onLogout: () => undefined }}
        state={state}
        chips={CHIPS.map((t, i) => ({
          key: t,
          title: t,
          done: !!pr.doneToday && i === 0,
          disabled: false,
          onPick: () => setScreen(pr.doneToday && i === 0 ? 'done' : 'feed'),
        }))}
        history={HISTORY.map((h) => ({
          key: h.t,
          title: h.t,
          meta: h.meta,
          onPick: () => setScreen('feed'),
        }))}
      />
    );
  } else if (screen === 'feed') {
    const initial: WatchFeedProps['initial'] = {
      idx: pr.idx ?? 0,
      maxIdx: pr.maxIdx ?? pr.idx ?? 0,
      mode: pr.mode ?? 'feed',
      phase: pr.phase ?? 'player',
      reacts: pr.reacts ?? [],
      reacting: pr.reacting ?? null,
      sheet: pr.sheet ?? false,
      dragFrac: pr.dragFrac ?? 0,
    };
    body = (
      <WatchFeed
        goalTitle={GOAL}
        videos={videos}
        frame={frame}
        loading={!!pr.loading}
        initial={initial}
        onVerdict={(i, v) =>
          setReacts((r) => {
            const n = r.slice();
            n[i] = v === 'useful' ? 'like' : v === 'skip' ? 'dislike' : 'skip';
            return n;
          })
        }
        onFinish={() => setScreen('done')}
        onBack={() => setScreen('input')}
        sound={sound}
        onSound={setSound}
        player={player}
        renderPlayer={(events) =>
          real ? (
            <WatchPlayer
              controller={player}
              onReady={events.onReady}
              onPlaying={events.onPlaying}
              onMuted={events.onMuted}
              onTick={events.onTick}
              onFailed={events.onFailed}
            />
          ) : (
            <FakePlayer
              events={events}
              controller={player}
              videos={videos}
              playing={pr.playing !== false}
              holdThumb={pr.phase === 'thumb'}
              prog={pr.prog ?? 0}
            />
          )
        }
      />
    );
  } else {
    body = (
      <WatchDoneR3
        frame={frame}
        goalTitle={GOAL}
        view={insightOf(reacts)}
        onClose={() => setScreen('input')}
      />
    );
  }

  return (
    <div className="mf-w">
      <div ref={app} className="mf-w-app" lang="ko" data-testid="mf-watch-root" data-fixture="">
        {body}
      </div>
    </div>
  );
}
