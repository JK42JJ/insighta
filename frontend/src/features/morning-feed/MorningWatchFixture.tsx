import { useEffect, useRef, useState } from 'react';

import type { FixtureScreen } from '@/features/morning-feed/fixture-screen';
import {
  FIXTURE_DATE_LABEL,
  FIXTURE_DEFAULT_REACTS,
  FIXTURE_GOALS,
  FIXTURE_HISTORY,
  FIXTURE_HISTORY_PRESET,
  FIXTURE_PRESET,
  fixtureCustomGoal,
  fixtureDuration,
  fixtureInsight,
  fixtureItemView,
  fixtureVids,
  type FixtureGoal,
  type FixtureReact,
} from '@/features/morning-feed/watch-fixture-data';
import type { WatchReaction } from '@/features/morning-feed/watch-design';
import {
  ONB_LAST_STEP,
  PauseIcon,
  PlayIcon,
  WatchInputScreen,
  WatchInsightScreen,
  WatchOnboarding,
  WatchScreen,
} from '@/features/morning-feed/watch-screens';
import './watch.css';

/*
 * Test-hook mode for the watch flow (/morning-cards?view=watch&fixture=1): the design handoff
 * prototype's example data and its logic, for side-by-side captures. No sign-in, no network, no
 * storage, no fonts requested. `&screen=onb|input|watch|insight` opens a screen directly (watch and
 * insight use goal 0, level 0, branches [0,1,2,3], like the prototype).
 */

/** The prototype answers after the exit animation; same length as the live screen. */
const FIXTURE_EXIT_MS = 480;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Maps the screen's reaction to the prototype's react kind ('skip' there = 넘기기). */
const REACT_OF: Record<WatchReaction, FixtureReact> = {
  like: 'like',
  dislike: 'dislike',
  pass: 'skip',
};

interface FixtureState {
  screen: FixtureScreen;
  onb: number;
  goal: FixtureGoal | null;
  level: number | null;
  sel: number[];
  idx: number;
  reacts: FixtureReact[];
  playing: boolean;
}

function initialState(screen: FixtureScreen): FixtureState {
  const pre = screen === 'watch' || screen === 'insight';
  const goal = pre ? FIXTURE_GOALS[FIXTURE_PRESET.goal] : null;
  const sel = pre ? [...FIXTURE_PRESET.sel] : [];
  return {
    screen,
    onb: 0,
    goal,
    level: pre ? FIXTURE_PRESET.level : null,
    sel,
    idx: 0,
    reacts:
      screen === 'insight' ? FIXTURE_DEFAULT_REACTS.slice(0, fixtureVids(goal, sel).length) : [],
    playing: false,
  };
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}

export function MorningWatchFixture({ screen }: { screen: FixtureScreen }): JSX.Element {
  const [s, setS] = useState<FixtureState>(() => initialState(screen));
  const [exit, setExit] = useState<WatchReaction | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    []
  );

  const vids = fixtureVids(s.goal, s.sel);
  const n = vids.length;

  const pickGoal = (goal: FixtureGoal): void => setS((x) => ({ ...x, goal, level: null, sel: [] }));

  const react = (kind: WatchReaction): void => {
    if (exit !== null || timer.current !== null) return; // input is ignored while leaving
    const advance = (): void => {
      timer.current = null;
      setExit(null);
      setS((x) => {
        const reacts = [...x.reacts, REACT_OF[kind]];
        return reacts.length >= fixtureVids(x.goal, x.sel).length
          ? { ...x, reacts, screen: 'insight' }
          : { ...x, reacts, idx: x.idx + 1 };
      });
    };
    setS((x) => ({ ...x, playing: false }));
    if (prefersReducedMotion()) {
      advance();
      return;
    }
    setExit(kind);
    timer.current = window.setTimeout(advance, FIXTURE_EXIT_MS);
  };

  let body: JSX.Element;
  if (s.screen === 'onb') {
    body = (
      <WatchOnboarding
        step={s.onb}
        onNext={() =>
          setS((x) =>
            x.onb < ONB_LAST_STEP ? { ...x, onb: x.onb + 1 } : { ...x, screen: 'input' }
          )
        }
      />
    );
  } else if (s.screen === 'input') {
    const showBranches = !!s.goal && s.level !== null;
    body = (
      <WatchInputScreen
        dateLabel={FIXTURE_DATE_LABEL}
        carry={null}
        askTitle="오늘은 뭘 알아볼까요?"
        chips={FIXTURE_GOALS.map((g) => ({
          key: g.key,
          title: g.title,
          on: s.goal === g,
          onPick: () => pickGoal(g),
        }))}
        onSubmitText={(t) => pickGoal(fixtureCustomGoal(t))}
        goal={s.goal}
        level={s.level}
        onLevel={(i) => setS((x) => ({ ...x, level: i, sel: [...(x.goal?.rec[i] ?? [])] }))}
        showBranches={showBranches}
        sel={s.sel}
        onToggle={(i) =>
          setS((x) => ({
            ...x,
            sel: x.sel.includes(i) ? x.sel.filter((k) => k !== i) : [...x.sel, i],
          }))
        }
        history={FIXTURE_HISTORY.map((h) => ({
          key: h.t,
          title: h.t,
          meta: h.meta,
          onPick: () =>
            setS((x) => ({
              ...x,
              goal: FIXTURE_GOALS[h.g],
              level: FIXTURE_HISTORY_PRESET.level,
              sel: [...FIXTURE_HISTORY_PRESET.sel],
              idx: 0,
              reacts: [],
              screen: 'watch',
            })),
        }))}
        cta={showBranches && s.sel.length > 0 ? '영상 ' + n + '편 받기' : null}
        onStart={() => setS((x) => ({ ...x, screen: 'watch', idx: 0, reacts: [] }))}
      />
    );
  } else if (s.screen === 'watch' && s.goal) {
    const v = vids[Math.min(s.idx, n - 1)];
    body = (
      <WatchScreen
        goalTitle={s.goal.title}
        item={fixtureItemView(s.goal, s.level, v, s.idx)}
        index={s.idx}
        total={n}
        exit={exit}
        onBack={() => {
          if (timer.current !== null) return;
          setS((x) => ({ ...x, screen: 'input', playing: false }));
        }}
        onReact={react}
        playerProps={{
          'data-fixture': '',
          onClick: () => setS((x) => ({ ...x, playing: !x.playing })),
        }}
        player={
          <>
            <div className="mf-w-player-label">YouTube 플레이어 (공식 임베드)</div>
            <div className="mf-w-player-play">{s.playing ? <PauseIcon /> : <PlayIcon />}</div>
            <div className="mf-w-player-dur">{fixtureDuration(v)}</div>
            {s.playing ? <div className="mf-w-player-progress" /> : null}
          </>
        }
      />
    );
  } else {
    const goal = s.goal ?? FIXTURE_GOALS[FIXTURE_PRESET.goal];
    body = (
      <WatchInsightScreen
        goalTitle={goal.title}
        view={fixtureInsight(goal, fixtureVids(goal, s.sel), s.reacts)}
        onClose={() => setS((x) => ({ ...x, screen: 'input' }))}
      />
    );
  }

  return (
    <div className="mf-w">
      <div className="mf-w-app" lang="ko" data-testid="mf-watch-root" data-fixture="">
        {body}
      </div>
    </div>
  );
}
