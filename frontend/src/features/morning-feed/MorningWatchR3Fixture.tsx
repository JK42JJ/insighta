import { useEffect, useMemo, useRef, useState } from 'react';

import { parseSafeOverride, useWatchFrame } from '@/features/morning-feed/use-watch-frame';
import { buildWatchSummary, type InsightView } from '@/features/morning-feed/watch-design';
import {
  WatchFeed,
  type R3PlayerApi,
  type R3SoundControl,
  type R3Video,
  type WatchFeedProps,
} from '@/features/morning-feed/watch-r3-feed';
import {
  WatchDoneR3,
  WatchInputR3,
  type R3InputState,
} from '@/features/morning-feed/watch-r3-screens';
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
  day: string;
  ph: string;
  amb: string;
  why?: string;
  sum?: string;
  checks?: string[];
  pts?: Array<[string, string]>;
}

const VIDS: FixtureVid[] = [
  {
    t: 'Figma Agent로 완벽한 디자인 만들기',
    ch: '코드팩토리',
    min: 6,
    day: '2026-11-09',
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
    day: '2026-11-07',
    ph: '#2B2419',
    amb: '#2B2419',
    why: '[고른 이유]',
    sum: '[한 줄 요약]',
    checks: ['진행자 1명', '한국어 음성'],
  },
  {
    t: '코딩 몰라도 바이브코딩을 배워야 하는 이유 | 이제 누구나 만드는 시대입니다',
    ch: '[채널명]',
    min: 9,
    day: '2026-11-06',
    ph: '#6B5876',
    amb: '#2A2230',
  },
  {
    t: 'AI 브라우저에 일을 맡겼더니 게임까지 혼자 깼습니다 | Aside 실전 6가지',
    ch: '[채널명]',
    min: 11,
    day: '2026-11-05',
    ph: '#4C6E66',
    amb: '#1C2A27',
    why: '[고른 이유]',
  },
  {
    t: '직장인 야근 탈출 치트키? PPT 뼈대 제대로 만들어주는 미친 오픈소스.. ㄷㄷ',
    ch: '[채널명]',
    min: 8,
    day: '2026-11-02',
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
  screen: 'input' | 'feed' | 'done';
  idx?: number;
  mode?: 'feed' | 'imm';
  phase?: 'thumb' | 'player';
  playing?: boolean;
  muted?: boolean;
  prog?: number;
  sheet?: boolean;
  loading?: boolean;
  dragFrac?: number;
  reacts?: Reaction[];
  reacting?: 'like' | 'dislike';
  doneToday?: boolean;
  carry?: boolean;
}
const PLAY = { playing: true, muted: true, prog: 4 };
const SOUND = { playing: true, muted: false, prog: 12 };
const F = 'feed' as const;
/** WatchPhone.dc.html PRESETS, same names. */
const R3_PRESETS: Record<string, Preset> = {
  input: { screen: 'input' },
  'input-done': { screen: 'input', doneToday: true, reacts: DONE_R },
  'input-carry': { screen: 'input', carry: true },
  feed: { screen: F, ...PLAY },
  'feed-paused': { screen: F },
  'feed-mid': { screen: F, ...PLAY, dragFrac: 0.45 },
  'feed-after': { screen: F, idx: 1, phase: 'thumb', reacts: ['skip'] },
  'feed-loading': { screen: F, loading: true, phase: 'thumb' },
  'feed-last': { screen: F, ...PLAY, idx: 4, reacts: ['like', 'skip', 'skip', 'dislike'] },
  'feed-noinfo': { screen: F, ...PLAY, idx: 2, reacts: ['like', 'skip'] },
  'feed-more': { screen: F, ...PLAY, sheet: true },
  'feed-liked': { screen: F, ...PLAY, reacts: ['like'], reacting: 'like' },
  'feed-disliked': { screen: F, ...PLAY, reacts: ['dislike'], reacting: 'dislike' },
  imm: { screen: F, ...SOUND, mode: 'imm' },
  'imm-mid': { screen: F, ...SOUND, mode: 'imm', dragFrac: 0.45 },
  'imm-after': { screen: F, mode: 'imm', idx: 1, phase: 'thumb', reacts: ['skip'] },
  'imm-muted': { screen: F, ...PLAY, mode: 'imm', idx: 1, reacts: ['skip'] },
  'imm-nochap': { screen: F, ...SOUND, mode: 'imm', idx: 1, reacts: ['skip'] },
  'imm-noinfo': { screen: F, ...SOUND, mode: 'imm', idx: 2, reacts: ['skip', 'skip'] },
  'imm-paused': { screen: F, mode: 'imm', muted: false, prog: 38 },
  'imm-more': { screen: F, ...SOUND, mode: 'imm', sheet: true },
  'imm-last': {
    screen: F,
    ...SOUND,
    mode: 'imm',
    idx: 4,
    reacts: ['like', 'skip', 'skip', 'dislike'],
  },
  'imm-liked': { screen: F, ...SOUND, mode: 'imm', reacts: ['like'], reacting: 'like' },
  done: { screen: 'done', reacts: DONE_R },
};

function toVideos(thumbs: string[]): R3Video[] {
  return VIDS.map((v, i) => ({
    key: 'fx' + i,
    videoId: 'fx' + i,
    title: v.t,
    channel: v.ch,
    initial: v.ch.replace('[', '')[0] ?? '',
    altIcon: i % 2 === 1,
    durationSec: v.min * 60,
    publishedAt: v.day + 'T03:00:00Z',
    thumbUrl: thumbs[i],
    ambient: v.amb,
    slotBg: v.ph,
    why: v.why ?? '',
    summary: v.sum ?? '',
    checks: v.checks ?? [],
    chapters: (v.pts ?? []).map(([at, title]) => ({ at, title })),
  }));
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

/** The player layer's stand-in: the thumbnail colour and, when stopped, YouTube's own play button. */
function FakePlayer({
  api,
  video,
  playing,
  prog,
  sound,
}: {
  api: R3PlayerApi;
  video: R3Video | undefined;
  playing: boolean;
  prog: number;
  sound: { current: R3SoundControl | null };
}): JSX.Element {
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    sound.current = {
      soundOn: () => apiRef.current.onMuted(false),
      soundOff: () => apiRef.current.onMuted(true),
    };
    return () => {
      sound.current = null;
    };
  }, [sound]);
  useEffect(() => {
    const dur = video?.durationSec ?? 0;
    apiRef.current.onTick({ videoId: api.videoId, seconds: (dur * prog) / 100, duration: dur });
  }, [api.videoId, prog, video?.durationSec]);
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
}: {
  preset: string | null;
  safe: string | null;
  thumbs: string | null;
}): JSX.Element {
  const pr = R3_PRESETS[preset ?? ''] ?? R3_PRESETS.input;
  const override = useMemo(() => parseSafeOverride(safe), [safe]);
  const app = useRef<HTMLDivElement>(null);
  const frame = useWatchFrame(app, override ?? { safeTop: 0, safeBottom: 0 });
  const thumbList = useMemo(
    () => (thumbs ?? '').split(',').filter((t) => /^https?:\/\//.test(t)),
    [thumbs]
  );
  const videos = useMemo(() => toVideos(thumbList), [thumbList]);
  const sound = useRef<R3SoundControl | null>(null);
  const [screen, setScreen] = useState(pr.screen);
  const [reacts, setReacts] = useState<Reaction[]>(pr.reacts ?? []);

  let body: JSX.Element;
  if (screen === 'input') {
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
      mode: pr.mode ?? 'feed',
      muted: pr.muted ?? true,
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
        renderPlayer={(api) => (
          <FakePlayer
            api={api}
            video={videos.find((v) => v.videoId === api.videoId)}
            playing={!!pr.playing}
            prog={pr.prog ?? 0}
            sound={sound}
          />
        )}
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
