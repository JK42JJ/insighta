import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CardDetailBlocks, hasCardDetail } from '@/features/morning-feed/CardDetail';
import { cssText as css } from '@/features/morning-feed/css-text';
import { InsightSection } from '@/features/morning-feed/InsightSection';
import type { FeedCell } from '@/features/morning-feed/MorningFeed';
import {
  counterText,
  goalCells,
  metaLine,
  pickTodaysVideos,
  segmentStates,
  type WatchVerdict,
  type WatchVideo,
} from '@/features/morning-feed/watch-list';
import { YouTubePlayer } from '@/features/morning-feed/YouTubePlayer';
import './mf.css';
import './watch.css';

/*
 * 시청 (/morning-cards?view=watch): pick one of the 8 goals, then watch today's videos of that
 * goal one at a time and answer each with 별로 / 넘기기 / 좋아. A plain vertical scroll page: no
 * swipe gestures. After the last video the day's insight is shown.
 */

/** The answered content leaves for this long, then the next video replaces it. */
export const WATCH_EXIT_MS = 480;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** The boxed info blocks in the handoff style: card face, 1px line, radius 10. */
const WATCH_BLOCK_CSS =
  'border-radius: 10px; padding: 14px 16px; background: var(--mf-fit); border: 1px solid var(--mf-line); display: flex; flex-direction: column; gap: 8px';

export interface WatchJudgeEvent {
  video: WatchVideo;
  verdict: WatchVerdict;
  /** Index within today's list of the goal. */
  shownPosition: number;
}

export interface MorningWatchProps {
  cards: WatchVideo[];
  cells: FeedCell[];
  /** Videos per day, from the server. */
  daily: number;
  onJudge: (e: WatchJudgeEvent) => void;
  /** Resolves once the queued judgments are written (or the wait gave up), so the insight counts them. */
  whenSaved: () => Promise<void>;
}

type Screen =
  | { kind: 'goals' }
  | { kind: 'watch'; goal: FeedCell; list: WatchVideo[]; index: number }
  | { kind: 'insight'; goal: FeedCell };

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}

export function MorningWatch({ cards, cells, daily, onJudge, whenSaved }: MorningWatchProps) {
  const [screen, setScreen] = useState<Screen>({ kind: 'goals' });
  // videos answered in this visit; the server leaves out the ones answered before
  const [judged, setJudged] = useState<ReadonlySet<string>>(() => new Set());
  const [exit, setExit] = useState<WatchVerdict | null>(null);
  const busy = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    []
  );

  const openGoal = (goal: FeedCell) => {
    const list = pickTodaysVideos(cards, goal.label, daily, judged);
    if (list.length === 0) return;
    setScreen({ kind: 'watch', goal, list, index: 0 });
  };

  const toGoals = () => {
    if (busy.current) return; // input is ignored while an answer is leaving
    setScreen({ kind: 'goals' });
  };

  const react = (verdict: WatchVerdict) => {
    if (busy.current || screen.kind !== 'watch') return;
    const { list, index } = screen;
    const video = list[index];
    if (!video?.videoId) return;
    busy.current = true;
    onJudge({ video, verdict, shownPosition: index });
    const id = video.videoId;
    setJudged((prev) => new Set(prev).add(id));
    const advance = () => {
      timer.current = null;
      busy.current = false;
      setExit(null);
      setScreen((s) => {
        if (s.kind !== 'watch') return s;
        return s.index + 1 >= s.list.length
          ? { kind: 'insight', goal: s.goal }
          : { ...s, index: s.index + 1 };
      });
    };
    if (prefersReducedMotion()) {
      advance();
      return;
    }
    setExit(verdict);
    timer.current = window.setTimeout(advance, WATCH_EXIT_MS);
  };

  return (
    <div className="mf-page mf-watch">
      <div className="mf-watch-app" lang="ko" data-testid="mf-watch-root">
        {screen.kind === 'goals' ? (
          <GoalList
            goals={goalCells(cells).map((g) => ({
              goal: g,
              count: pickTodaysVideos(cards, g.label, daily, judged).length,
            }))}
            onPick={openGoal}
          />
        ) : screen.kind === 'watch' ? (
          <WatchView
            goal={screen.goal}
            list={screen.list}
            index={screen.index}
            exit={exit}
            onBack={toGoals}
            onReact={react}
          />
        ) : (
          <InsightView goal={screen.goal} whenSaved={whenSaved} onDone={toGoals} />
        )}
      </div>
    </div>
  );
}

function GoalList({
  goals,
  onPick,
}: {
  goals: Array<{ goal: FeedCell; count: number }>;
  onPick: (goal: FeedCell) => void;
}) {
  return (
    <div
      className="mf-watch-scroll"
      data-testid="mf-watch-goals"
      style={css(
        'padding: calc(env(safe-area-inset-top, 0px) + 44px) 22px max(24px, calc(env(safe-area-inset-bottom, 0px) + 16px))'
      )}
    >
      <div className="mf-watch-tick" style={css('margin-bottom: 10px')} />
      <div style={css('font-size: 22px; font-weight: 800; line-height: 1.35')}>
        오늘 볼 목표를 고르세요
      </div>
      <div style={css('margin-top: 26px; border-top: 1px solid var(--mf-line); padding-top: 16px')}>
        <div className="mf-watch-kicker" style={css('margin-bottom: 6px')}>
          목표
        </div>
        {goals.map(({ goal, count }) => (
          <button
            key={goal.label}
            type="button"
            className="mf-watch-goal"
            data-testid="mf-watch-goal"
            data-count={count}
            disabled={count === 0}
            onClick={() => onPick(goal)}
          >
            <span style={css('font-size: 14.5px; font-weight: 700')}>{goal.short}</span>
            <span style={css('flex: none; font-size: 12px; color: var(--mf-caption)')}>
              {count > 0 ? '오늘 ' + count + '편' : '오늘 영상 없음'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function WatchView({
  goal,
  list,
  index,
  exit,
  onBack,
  onReact,
}: {
  goal: FeedCell;
  list: WatchVideo[];
  index: number;
  exit: WatchVerdict | null;
  onBack: () => void;
  onReact: (verdict: WatchVerdict) => void;
}) {
  const video = list[index];
  const scroller = useRef<HTMLDivElement>(null);
  const [playerFailed, setPlayerFailed] = useState(false);

  // the next video starts at the top of the page
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    el.scrollTop = 0;
    // iOS Safari: a scroll still coasting can overwrite the first reset
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [index]);

  if (!video) return null;
  const meta = metaLine(video.ch, video.durationSec, goal.short);
  return (
    <>
      <div className="mf-watch-top">
        <div style={css('display: flex; align-items: center; gap: 10px')}>
          <button
            type="button"
            className="mf-watch-back"
            data-testid="mf-watch-back"
            aria-label="뒤로"
            onClick={onBack}
            style={css('color: var(--mf-fg)')}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 4l-6 6 6 6" />
            </svg>
          </button>
          <div
            data-testid="mf-watch-goal-name"
            style={css(
              'flex: 1; min-width: 0; font-size: 14px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis'
            )}
          >
            {goal.short}
          </div>
          <div
            data-testid="mf-watch-counter"
            style={css('flex: none; font: 700 13px Arial, sans-serif; color: var(--mf-sub)')}
          >
            {counterText(index, list.length)}
          </div>
        </div>
        <div style={css('display: flex; gap: 4px; margin-top: 4px')}>
          {segmentStates(list.length, index).map((state, k) => (
            <div key={k} className="mf-watch-seg" data-testid="mf-watch-seg" data-state={state} />
          ))}
        </div>
      </div>
      <div
        ref={scroller}
        className="mf-watch-scroll"
        data-testid="mf-watch-scroll"
        style={css('padding: 0 22px calc(var(--mf-watch-bar-h) + 20px)')}
      >
        <div
          className="mf-watch-content"
          data-testid="mf-watch-content"
          data-exit={exit ?? undefined}
        >
          <div className="mf-watch-player" data-testid="mf-watch-player">
            {video.videoId ? (
              <YouTubePlayer
                videoId={video.videoId}
                active={exit === null}
                onFailed={setPlayerFailed}
              />
            ) : null}
          </div>
          {video.videoId && playerFailed ? (
            <div
              data-testid="mf-watch-player-failed"
              style={css(
                'display: flex; gap: 10px; align-items: center; justify-content: center; padding-top: 12px; font-size: 13px; color: var(--mf-sub)'
              )}
            >
              <span>재생할 수 없습니다</span>
              <a
                data-testid="mf-watch-open-yt"
                href={'https://www.youtube.com/watch?v=' + video.videoId}
                target="_blank"
                rel="noopener noreferrer"
                style={css('color: var(--mf-fg); font-weight: 700; text-decoration: underline')}
              >
                YouTube에서 열기
              </a>
            </div>
          ) : null}
          <div
            data-testid="mf-watch-title"
            style={css('margin-top: 14px; font-size: 19px; font-weight: 800; line-height: 1.35')}
          >
            {video.title}
          </div>
          {meta ? (
            <div
              data-testid="mf-watch-meta"
              style={css('margin-top: 5px; font-size: 13px; color: var(--mf-sub)')}
            >
              {meta}
            </div>
          ) : null}
          {hasCardDetail(video) ? (
            <div
              data-testid="mf-watch-info"
              style={css('margin-top: 16px; display: flex; flex-direction: column; gap: 14px')}
            >
              <CardDetailBlocks card={video} blockCss={WATCH_BLOCK_CSS} />
            </div>
          ) : null}
        </div>
      </div>
      <div className="mf-watch-bar" data-testid="mf-watch-actions">
        <button
          type="button"
          className="mf-watch-btn"
          data-testid="mf-watch-skip"
          data-size="large"
          data-pop={exit === 'skip' ? '' : undefined}
          aria-label="별로"
          onClick={() => onReact('skip')}
          style={css('color: var(--mf-sub)')}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <button
          type="button"
          className="mf-watch-btn"
          data-testid="mf-watch-pass"
          data-size="small"
          data-pop={exit === 'pass' ? '' : undefined}
          aria-label="넘기기"
          onClick={() => onReact('pass')}
          style={css('color: var(--mf-caption)')}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 6l6 6-6 6M13 6l6 6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          className="mf-watch-btn"
          data-testid="mf-watch-like"
          data-size="large"
          data-tone="accent"
          data-pop={exit === 'useful' ? '' : undefined}
          aria-label="좋아"
          onClick={() => onReact('useful')}
          style={css('color: var(--mf-card)')}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 20.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z" />
          </svg>
        </button>
      </div>
    </>
  );
}

function InsightView({
  goal,
  whenSaved,
  onDone,
}: {
  goal: FeedCell;
  whenSaved: () => Promise<void>;
  onDone: () => void;
}) {
  // the summary is read only after today's answers are written, so it counts them
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void whenSaved().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [whenSaved]);
  return (
    <div
      className="mf-watch-scroll"
      data-testid="mf-watch-insight"
      style={css(
        'padding: calc(env(safe-area-inset-top, 0px) + 52px) 22px max(30px, calc(env(safe-area-inset-bottom, 0px) + 16px)); display: flex; flex-direction: column; gap: 18px'
      )}
    >
      <div>
        <div className="mf-watch-tick" style={css('margin-bottom: 10px')} />
        <div className="mf-watch-kicker" style={css('color: var(--mf-steel)')}>
          오늘 본 것
        </div>
        <div
          data-testid="mf-watch-insight-goal"
          style={css('margin-top: 6px; font-size: 24px; font-weight: 800; line-height: 1.3')}
        >
          {goal.short}
        </div>
      </div>
      <InsightSection enabled={ready} showTitle={false} />
      <button
        type="button"
        className="mf-watch-primary"
        data-testid="mf-watch-to-goals"
        onClick={onDone}
        style={css('margin-top: 8px')}
      >
        목표 목록으로
      </button>
    </div>
  );
}
