import { useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchWatchInsight,
  type FeedHistoryItem,
  type InsightData,
} from '@/features/morning-cards/api';
import type { FeedCell } from '@/features/morning-feed/MorningFeed';
import { useViewportFitCover, useWatchFrame } from '@/features/morning-feed/use-watch-frame';
import {
  carryCandidate,
  historyMetaText,
  insightViewFromData,
  kstDateLabel,
  readOnboardingSeen,
  writeOnboardingSeen,
  type InsightView,
} from '@/features/morning-feed/watch-design';
import {
  goalCells,
  goalChipState,
  unansweredInBatch,
  withBatch,
  withOneJudged,
  type GoalChipState,
  type WatchTodayMap,
  type WatchVerdict,
  type WatchVideo,
} from '@/features/morning-feed/watch-list';
import { WatchFeed, type R3Verdict } from '@/features/morning-feed/watch-r3-feed';
import { r3VideoOf } from '@/features/morning-feed/watch-r3-video';
import {
  WatchDoneR3,
  WatchInputR3,
  type R3InputState,
} from '@/features/morning-feed/watch-r3-screens';
import { ONB_LAST_STEP, WatchOnboarding } from '@/features/morning-feed/watch-screens';
import { WatchPlayer, type PlayerController } from '@/features/morning-feed/WatchPlayer';
import './watch.css';
import './watch-r3.css';

/*
 * 시청 flow (/morning-cards?view=watch), design handoff "design_handoff_insighta_watch_v2" (수정 3):
 * 온보딩 (unchanged, first visit on this device) -> 입력 -> 카드 피드 / 몰입 재생 -> 다 본 뒤.
 * Live data: the 8 feed cells are the "요즘 많이 고르는 것" chips; pressing one opens today's
 * batch of that cell (POST /watch/batch) straight away. Chips follow GET /watch/today: no batch
 * and no candidates -> disabled, a batch answered in full -> done (opens its summary). Verdicts:
 * 좋아 = useful, 별로 = skip, swiping up without a verdict = pass (surface 'watch'); a liked card
 * that is swiped up stays 좋아.
 */

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
  /** 온보딩 step 3. Resolves when done, whatever the outcome; the onboarding then ends. */
  connectYouTube: () => Promise<void>;
}

type Screen =
  | { kind: 'onb'; step: number }
  | { kind: 'input' }
  | {
      kind: 'watch';
      goal: FeedCell;
      /** null = the batch is on its way (skeleton). */
      list: WatchVideo[] | null;
      /** Index of each list entry in the batch (shown_position). */
      positions: number[];
    }
  | { kind: 'insight'; goal: FeedCell };

const R3_TO_VERDICT: Record<R3Verdict, WatchVerdict> = {
  useful: 'useful',
  skip: 'skip',
  pass: 'pass',
};

export function MorningWatch({
  cells,
  today: todayFromServer,
  loadBatch,
  history,
  onJudge,
  whenSaved,
  connectYouTube,
}: MorningWatchProps): JSX.Element {
  useViewportFitCover();
  const app = useRef<HTMLDivElement>(null);
  const frame = useWatchFrame(app);
  const [screen, setScreen] = useState<Screen>(() =>
    readOnboardingSeen() ? { kind: 'input' } : { kind: 'onb', step: 0 }
  );
  const [connecting, setConnecting] = useState(false);
  // today's state per goal, moved on locally with each batch and answer so no reload is needed
  const [today, setToday] = useState<WatchTodayMap>(todayFromServer);
  // batch videos answered in this visit (the batch itself tells the earlier ones)
  const [judged, setJudged] = useState<ReadonlySet<string>>(() => new Set());
  const starting = useRef(false);
  const [carryOff, setCarryOff] = useState(false);
  const alive = useRef(true);
  const player = useRef<PlayerController | null>(null);
  /** README 수정 4: the sound setting is kept for the session (this visit), across cards and goals. */
  const [sound, setSound] = useState(false);
  /** Videos answered in this visit, read synchronously so a changed verdict is not counted twice. */
  const answered = useRef(new Set<string>());
  const [now] = useState(() => new Date());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const goals = useMemo(() => goalCells(cells), [cells]);
  const cellOf = (label: string): FeedCell | undefined => goals.find((g) => g.label === label);
  const shortOf = (label: string): string => cellOf(label)?.short ?? label;
  const chipOf = (cell: FeedCell): GoalChipState => goalChipState(today[cell.label]);

  // 어제에 이어서: a goal with yesterday's batch that still has videos today. Decided once at load.
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

  /** Chip / 이어서 보기: today's batch of the goal, straight to its unanswered videos. */
  const openGoal = (cell: FeedCell): void => {
    const state = chipOf(cell);
    if (state.kind === 'done') {
      setScreen({ kind: 'insight', goal: cell });
      return;
    }
    if (state.kind === 'none' || starting.current) return;
    starting.current = true;
    setCarryOff(true);
    setScreen({ kind: 'watch', goal: cell, list: null, positions: [] });
    loadBatch(cell.label)
      .then((batch) => {
        if (!alive.current) return;
        const answered = new Set([...Object.keys(batch.judged), ...judged]);
        const rest = unansweredInBatch(batch.items, answered);
        if (batch.items.length === 0) {
          // no candidates left (nothing was stored): the chip turns disabled
          setToday((t) => ({ ...t, [cell.label]: { issued: null, judged: 0, available: 0 } }));
          setScreen({ kind: 'input' });
          return;
        }
        setToday((t) =>
          withBatch(t, cell.label, batch.items.length, batch.items.length - rest.length)
        );
        if (rest.length === 0) {
          setScreen({ kind: 'insight', goal: cell });
          return;
        }
        setScreen({
          kind: 'watch',
          goal: cell,
          list: rest.map((r) => r.video),
          positions: rest.map((r) => r.position),
        });
      })
      .catch(() => {
        /* not loaded: back to 입력, the chip can be pressed again */
        if (alive.current) setScreen({ kind: 'input' });
      })
      .finally(() => {
        starting.current = false;
      });
  };

  const verdict = (index: number, v: R3Verdict): void => {
    if (screen.kind !== 'watch' || !screen.list) return;
    const video = screen.list[index];
    if (!video?.videoId) return;
    onJudge({
      video,
      verdict: R3_TO_VERDICT[v],
      shownPosition: screen.positions[index] ?? index,
    });
    const id = video.videoId;
    const goalLabel = screen.goal.label;
    setJudged((prev) => new Set(prev).add(id));
    // a passed card changed to 좋아/별로 later is still one answered video
    if (answered.current.has(id)) return;
    answered.current.add(id);
    setToday((prev) => withOneJudged(prev, goalLabel));
  };

  // 오늘 다 봄 card on 입력: the first goal answered in full today, with its summary
  const doneCell = goals.find((g) => chipOf(g).kind === 'done') ?? null;
  const doneLabel = doneCell?.label ?? null;
  const [doneView, setDoneView] = useState<{ label: string; view: InsightView | null } | null>(
    null
  );
  useEffect(() => {
    if (screen.kind !== 'input' || !doneLabel) return undefined;
    let on = true;
    void whenSaved()
      .then(() => fetchWatchInsight(doneLabel))
      .then(
        (d) =>
          on &&
          setDoneView({
            label: doneLabel,
            view: d.reacted + d.passed > 0 ? insightViewFromData(d, shortOf) : null,
          })
      )
      .catch(() => on && setDoneView({ label: doneLabel, view: null }));
    return () => {
      on = false;
    };
    // shortOf reads `goals`, which is stable for the visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.kind, doneLabel, whenSaved]);

  const watchList = screen.kind === 'watch' ? screen.list : null;
  const watchVideos = useMemo(() => (watchList ?? []).map(r3VideoOf), [watchList]);

  let body: JSX.Element;
  if (screen.kind === 'onb') {
    body = <WatchOnboarding step={screen.step} busy={connecting} onNext={onbNext} />;
  } else if (screen.kind === 'input') {
    const carryState = carryCell ? chipOf(carryCell) : null;
    let state: R3InputState = { kind: 'hero' };
    if (carryCell && carryState && !carryOff && carryState.kind === 'open') {
      state = {
        kind: 'carry',
        goal: carryCell.short,
        count: carryState.count,
        // today's thumbnails would need the batch, and reading it creates it: not drawn
        thumbs: [],
        onGo: () => openGoal(carryCell),
      };
    } else if (doneCell) {
      const v = doneView && doneView.label === doneCell.label ? doneView.view : null;
      state = {
        kind: 'done',
        goal: doneCell.short,
        stats: v ? v.stats : null,
        rows: v ? v.rows : [],
        onOpen: () => setScreen({ kind: 'insight', goal: doneCell }),
      };
    }
    body = (
      <WatchInputR3
        frame={frame}
        dateLabel={kstDateLabel(now)}
        state={state}
        chips={goals.map((g) => {
          const c = chipOf(g);
          return {
            key: g.label,
            title: g.short,
            done: c.kind === 'done',
            disabled: c.kind === 'none',
            count: c.count,
            onPick: () => openGoal(g),
          };
        })}
        history={history.flatMap((h) => {
          const cell = cellOf(h.cell);
          const meta = historyMetaText(h.day, h.count);
          return cell && meta
            ? [{ key: h.cell, title: cell.short, meta, onPick: () => openGoal(cell) }]
            : [];
        })}
      />
    );
  } else if (screen.kind === 'watch') {
    body = (
      <WatchFeed
        key={screen.goal.label}
        goalTitle={screen.goal.short}
        videos={watchVideos}
        frame={frame}
        loading={screen.list === null}
        onVerdict={verdict}
        onFinish={() => setScreen({ kind: 'insight', goal: screen.goal })}
        onBack={() => setScreen({ kind: 'input' })}
        sound={sound}
        onSound={setSound}
        player={player}
        renderPlayer={(events) => (
          <WatchPlayer
            controller={player}
            onReady={events.onReady}
            onPlaying={events.onPlaying}
            onMuted={events.onMuted}
            onTick={events.onTick}
            onFailed={events.onFailed}
          />
        )}
      />
    );
  } else {
    body = (
      <LiveDone
        frame={frame}
        goal={screen.goal}
        shortOf={shortOf}
        whenSaved={whenSaved}
        onClose={() => setScreen({ kind: 'input' })}
      />
    );
  }

  return (
    <div className="mf-w">
      <div ref={app} className="mf-w-app" lang="ko" data-testid="mf-watch-root">
        {body}
      </div>
    </div>
  );
}

/** 다 본 뒤 for one goal, read after today's answers are written so it counts them. */
function LiveDone({
  frame,
  goal,
  shortOf,
  whenSaved,
  onClose,
}: {
  frame: ReturnType<typeof useWatchFrame>;
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
  return <WatchDoneR3 frame={frame} goalTitle={goal.short} view={view} onClose={onClose} />;
}
