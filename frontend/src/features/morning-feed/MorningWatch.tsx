import { useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchWatchInsight,
  type FeedHistoryItem,
  type InsightData,
} from '@/features/morning-cards/api';
import type { FeedCell } from '@/features/morning-feed/MorningFeed';
import {
  carryCandidate,
  historyMetaText,
  insightViewFromData,
  kstDateLabel,
  readOnboardingSeen,
  writeOnboardingSeen,
  type WatchGoal,
  type WatchItemView,
  type WatchReaction,
} from '@/features/morning-feed/watch-design';
import {
  goalCells,
  goalChipState,
  goalRowText,
  metaLine,
  unansweredInBatch,
  withBatch,
  withOneJudged,
  type GoalChipState,
  type WatchTodayMap,
  type WatchVerdict,
  type WatchVideo,
} from '@/features/morning-feed/watch-list';
import {
  ONB_LAST_STEP,
  WatchInputScreen,
  WatchInsightScreen,
  WatchOnboarding,
  WatchScreen,
  type WatchChipView,
} from '@/features/morning-feed/watch-screens';
import { YouTubePlayer } from '@/features/morning-feed/YouTubePlayer';
import './watch.css';

/*
 * 시청 flow (/morning-cards?view=watch), design handoff "design_handoff_insighta_mobile":
 * 01 온보딩 (first visit on this device) -> 02 입력 -> 03 시청 -> 04 인사이트.
 * Live data: the 8 feed cells are the "요즘 많이 고르는 것" chips; a cell is one goal with one branch
 * (the cell itself). The videos of a goal are today's batch issued by the server (POST
 * /watch/batch); the chips follow GET /watch/today: no batch and no candidates -> disabled, a batch
 * answered in full -> '오늘은 끝' (opens its insight), otherwise level -> 갈래 -> CTA. Only answers
 * given on this screen count (surface 'watch'). Free text and the level are kept on screen only:
 * no server turns them into branches or videos, so the 갈래 section and the CTA stay hidden for
 * typed text.
 */

/** The answered video leaves for this long, then the next one replaces it (README 03 동작). */
export const WATCH_EXIT_MS = 480;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const ASK_FIRST = '오늘은 뭘 알아볼까요?';
const ASK_AGAIN = '다른 걸 알아보고 싶다면';
/** A cell goal has one branch, the cell; every level preselects it. */
const CELL_GOAL_REC: number[][] = [[0], [0], [0]];
const NO_BRANCH_REC: number[][] = [[], [], []];

const VERDICT_OF: Record<WatchReaction, WatchVerdict> = {
  like: 'useful',
  dislike: 'skip',
  pass: 'pass',
};

export interface WatchJudgeEvent {
  video: WatchVideo;
  verdict: WatchVerdict;
  /** Index within today's batch of the goal. */
  shownPosition: number;
}

/** Today's batch of one goal: the videos in batch order and the ones already answered here. */
export interface WatchBatchView {
  items: WatchVideo[];
  judged: Readonly<Record<string, WatchVerdict>>;
}

export interface MorningWatchProps {
  cells: FeedCell[];
  /** Per goal: today's batch size and answers, or what a new batch would get (server). */
  today: WatchTodayMap;
  /** Creates (first call of the day) or reads today's batch of the goal. */
  loadBatch: (cellLabel: string) => Promise<WatchBatchView>;
  /** 이전 주제, newest first (server). Empty = the section is not drawn. */
  history: FeedHistoryItem[];
  onJudge: (e: WatchJudgeEvent) => void;
  /** Resolves once the queued judgments are written (or the wait gave up), so the insight counts them. */
  whenSaved: () => Promise<void>;
  /** 01 온보딩 step 3. Resolves when done, whatever the outcome; the onboarding then ends. */
  connectYouTube: () => Promise<void>;
}

type Screen =
  | { kind: 'onb'; step: number }
  | { kind: 'input' }
  | {
      kind: 'watch';
      goal: FeedCell;
      list: WatchVideo[];
      /** Index of each list entry in the batch (shown_position). */
      positions: number[];
      index: number;
    }
  | { kind: 'insight'; goal: FeedCell };

/** What is chosen on 02 입력: a cell chip, or typed text (no cell). */
interface Picked {
  goal: WatchGoal;
  cell: FeedCell | null;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}

function cellGoal(cell: FeedCell): WatchGoal {
  return { key: cell.label, title: cell.short, branches: [cell.short], rec: CELL_GOAL_REC };
}

function textGoal(text: string): WatchGoal {
  return { key: 'text:' + text, title: text, branches: [], rec: NO_BRANCH_REC };
}

/** One live video as 03 시청 draws it: the info blocks only when their data exists. */
function itemView(video: WatchVideo, cellShort: string): WatchItemView {
  return {
    key: video.videoId ?? video.title,
    title: video.title,
    meta: metaLine(video.ch, video.durationSec, cellShort),
    summary: video.oneLiner ?? '',
    reasonLines: video.reasonLines ?? [],
    checks: (video.checks ?? []).map((c) => ({ text: c.text, ok: c.text.startsWith('✓') })),
    chapters: video.chapters ?? [],
  };
}

export function MorningWatch({
  cells,
  today: todayFromServer,
  loadBatch,
  history,
  onJudge,
  whenSaved,
  connectYouTube,
}: MorningWatchProps): JSX.Element {
  const [screen, setScreen] = useState<Screen>(() =>
    readOnboardingSeen() ? { kind: 'input' } : { kind: 'onb', step: 0 }
  );
  const [connecting, setConnecting] = useState(false);
  // today's state per goal, moved on locally with each batch and answer so no reload is needed
  const [today, setToday] = useState<WatchTodayMap>(todayFromServer);
  // batch videos answered in this visit (the batch itself tells the earlier ones)
  const [judged, setJudged] = useState<ReadonlySet<string>>(() => new Set());
  // a batch request is on its way: further presses are ignored
  const starting = useRef(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [carryOff, setCarryOff] = useState(false);
  const [exit, setExit] = useState<WatchReaction | null>(null);
  const [failedVideo, setFailedVideo] = useState<string | null>(null);
  const busy = useRef(false);
  const timer = useRef<number | null>(null);
  const alive = useRef(true);
  const [now] = useState(() => new Date());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  const goals = useMemo(() => goalCells(cells), [cells]);
  const cellOf = (label: string): FeedCell | undefined => goals.find((g) => g.label === label);
  const shortOf = (label: string): string => cellOf(label)?.short ?? label;
  const chipOf = (cell: FeedCell): GoalChipState => goalChipState(today[cell.label]);

  // 어제에 이어서: a goal with yesterday's batch that still has videos today (a new batch or an
  // unfinished one). Decided once at load, so the question row keeps its wording for the visit.
  const [carryCell] = useState<FeedCell | null>(() => {
    const open = (label: string): boolean =>
      goals.some((g) => g.label === label) && goalChipState(todayFromServer[label]).kind === 'open';
    const c = carryCandidate(history, now, open);
    return c ? (goals.find((g) => g.label === c.cell) ?? null) : null;
  });

  const finishOnboarding = (): void => {
    writeOnboardingSeen();
    setScreen({ kind: 'input' });
  };

  const onbNext = (): void => {
    if (screen.kind !== 'onb' || connecting) return;
    if (screen.step < ONB_LAST_STEP) {
      setScreen({ kind: 'onb', step: screen.step + 1 });
      return;
    }
    setConnecting(true);
    void connectYouTube().finally(() => {
      if (!alive.current) return;
      setConnecting(false);
      finishOnboarding();
    });
  };

  /**
   * Today's batch of the goal (issued by the server on the first call of the day), then straight
   * to its unanswered videos in batch order; the insight when all of them are answered.
   */
  const openGoal = (cell: FeedCell): void => {
    const state = chipOf(cell);
    if (state.kind === 'done') {
      setScreen({ kind: 'insight', goal: cell });
      return;
    }
    if (state.kind === 'none' || starting.current) return;
    starting.current = true;
    loadBatch(cell.label)
      .then((batch) => {
        if (!alive.current) return;
        const answered = new Set([...Object.keys(batch.judged), ...judged]);
        const rest = unansweredInBatch(batch.items, answered);
        if (batch.items.length === 0) {
          // no candidates left (nothing was stored): the chip turns disabled
          setToday((t) => ({ ...t, [cell.label]: { issued: null, judged: 0, available: 0 } }));
          return;
        }
        setToday((t) =>
          withBatch(t, cell.label, batch.items.length, batch.items.length - rest.length)
        );
        if (rest.length === 0) {
          setScreen({ kind: 'insight', goal: cell });
          return;
        }
        setCarryOff(true);
        setFailedVideo(null);
        setScreen({
          kind: 'watch',
          goal: cell,
          list: rest.map((r) => r.video),
          positions: rest.map((r) => r.position),
          index: 0,
        });
      })
      .catch(() => {
        /* not loaded: stay on 02 입력, the chip can be pressed again */
      })
      .finally(() => {
        starting.current = false;
      });
  };

  const pickGoal = (next: Picked): void => {
    setPicked(next);
    setLevel(null);
    setSel([]);
  };

  const toInput = (): void => {
    if (busy.current) return; // input is ignored while an answer is leaving
    setScreen({ kind: 'input' });
  };

  const closeInsight = (): void => {
    setPicked(null);
    setLevel(null);
    setSel([]);
    setScreen({ kind: 'input' });
  };

  const react = (kind: WatchReaction): void => {
    if (busy.current || screen.kind !== 'watch') return;
    const { list, positions, index } = screen;
    const video = list[index];
    if (!video?.videoId) return;
    busy.current = true;
    onJudge({ video, verdict: VERDICT_OF[kind], shownPosition: positions[index] ?? index });
    const id = video.videoId;
    const goalLabel = screen.goal.label;
    setJudged((prev) => new Set(prev).add(id));
    setToday((prev) => withOneJudged(prev, goalLabel));
    const advance = (): void => {
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
    setExit(kind);
    timer.current = window.setTimeout(advance, WATCH_EXIT_MS);
  };

  let body: JSX.Element;
  if (screen.kind === 'onb') {
    body = <WatchOnboarding step={screen.step} busy={connecting} onNext={onbNext} />;
  } else if (screen.kind === 'input') {
    const pickedCell = picked?.cell ?? null;
    const showBranches = !!picked && level !== null && picked.goal.branches.length > 0;
    const n = pickedCell ? chipOf(pickedCell).count : 0;
    const carryState = carryCell ? chipOf(carryCell) : null;
    const carry =
      carryCell && carryState && !carryOff && carryState.kind === 'open'
        ? { title: carryCell.short, count: carryState.count, onGo: () => openGoal(carryCell) }
        : null;
    body = (
      <WatchInputScreen
        dateLabel={kstDateLabel(now)}
        carry={carry}
        askTitle={carryCell ? ASK_AGAIN : ASK_FIRST}
        chips={goals.map((g): WatchChipView => {
          const c = chipOf(g);
          return {
            key: g.label,
            title: g.short,
            on: pickedCell?.label === g.label,
            state: c.kind === 'open' ? undefined : c.kind,
            count: c.count,
            note: c.kind === 'open' ? undefined : goalRowText(c.count, c.kind === 'done'),
            disabled: c.kind === 'none',
            onPick: () =>
              c.kind === 'done' ? openGoal(g) : pickGoal({ goal: cellGoal(g), cell: g }),
          };
        })}
        onSubmitText={(t) => pickGoal({ goal: textGoal(t), cell: null })}
        goal={picked?.goal ?? null}
        level={level}
        onLevel={(i) => {
          setLevel(i);
          setSel([...(picked?.goal.rec[i] ?? [])]);
        }}
        showBranches={showBranches}
        sel={sel}
        onToggle={(i) => setSel((s) => (s.includes(i) ? s.filter((k) => k !== i) : [...s, i]))}
        history={history.flatMap((h) => {
          const cell = cellOf(h.cell);
          const meta = historyMetaText(h.day, h.count);
          return cell && meta
            ? [{ key: h.cell, title: cell.short, meta, onPick: () => openGoal(cell) }]
            : [];
        })}
        cta={showBranches && pickedCell && sel.length > 0 && n > 0 ? '영상 ' + n + '편 받기' : null}
        onStart={() => {
          if (pickedCell && chipOf(pickedCell).kind === 'open') openGoal(pickedCell);
        }}
      />
    );
  } else if (screen.kind === 'watch') {
    const video = screen.list[screen.index];
    const vid = video?.videoId;
    body = video ? (
      <WatchScreen
        goalTitle={screen.goal.short}
        item={itemView(video, screen.goal.short)}
        index={screen.index}
        total={screen.list.length}
        exit={exit}
        onBack={toInput}
        onReact={react}
        player={
          vid ? (
            <YouTubePlayer
              videoId={vid}
              active={exit === null}
              onFailed={(f) => setFailedVideo(f ? vid : null)}
            />
          ) : null
        }
        belowPlayer={
          vid && failedVideo === vid ? (
            <div className="mf-w-player-failed" data-testid="mf-watch-player-failed">
              <span>재생할 수 없습니다</span>
              <a
                data-testid="mf-watch-open-yt"
                href={'https://www.youtube.com/watch?v=' + vid}
                target="_blank"
                rel="noopener noreferrer"
              >
                YouTube에서 열기
              </a>
            </div>
          ) : null
        }
      />
    ) : (
      <div className="mf-w-screen" data-testid="mf-w-watch" />
    );
  } else {
    body = (
      <LiveInsight
        goal={screen.goal}
        shortOf={shortOf}
        whenSaved={whenSaved}
        onClose={closeInsight}
      />
    );
  }

  return (
    <div className="mf-w">
      <div className="mf-w-app" lang="ko" data-testid="mf-watch-root">
        {body}
      </div>
    </div>
  );
}

/** 04 인사이트 for one goal, read after today's answers are written so it counts them. */
function LiveInsight({
  goal,
  shortOf,
  whenSaved,
  onClose,
}: {
  goal: FeedCell;
  shortOf: (label: string) => string;
  whenSaved: () => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [data, setData] = useState<InsightData | null>(null);
  useEffect(() => {
    let on = true;
    void whenSaved()
      .then(() => fetchWatchInsight(goal.label))
      .then((d) => on && setData(d))
      .catch(() => on && setData(null));
    return () => {
      on = false;
    };
  }, [whenSaved, goal.label]);
  const view = data && data.reacted + data.passed > 0 ? insightViewFromData(data, shortOf) : null;
  return <WatchInsightScreen goalTitle={goal.short} view={view} onClose={onClose} />;
}
