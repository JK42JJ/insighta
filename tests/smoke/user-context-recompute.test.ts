/**
 * Ratio recompute (James 2026-11-13): weights derive from the judgment history as a whole, so the
 * order of judgments does not matter; concepts and formats use 2·(L+1)/(L+S+2) and are never
 * avoided; stated branches keep a floor; channels keep the count rule and the 0-like / 2-skip AVOIDS.
 */
import {
  USER_CONTEXT_CONFIG as C,
  addVideoToGraph,
  applyJudgments,
  contextProps,
  createContextGraph,
  dropJudgments,
  ratioWeight,
  recomputeWeights,
  type ContextGraph,
  type Judgment,
} from '../../src/modules/user-context';
import {
  cloneGraph,
  ensureNode,
  findBranch,
  findNodeByKey,
  freeze,
  getEdge,
  setEdge,
} from '../../src/modules/user-context/graph';

const USER = '00000000-0000-4000-8000-00000000c0de';
const DAY = '2026-11-13';
const DURATION = 600;

function seeded(): ContextGraph {
  let g = createContextGraph({
    userId: USER,
    contextKey: 'k',
    goalText: 'goal',
    level: 'standard',
    branches: [
      { title: '만드는 법', concepts: ['A', 'B', 'D'] },
      { title: '업계 동향', concepts: ['C'] },
    ],
  });
  const m = cloneGraph(g);
  for (const t of ['A', 'B', 'C', 'D']) {
    const c = ensureNode(m, 'concept', t, t);
    setEdge(m, m.contextId, 'WANTS', c.id, 1.0, { seed: 'test' });
  }
  g = freeze(m);
  const b1 = findBranch(g, '만드는 법')!.id;
  const b2 = findBranch(g, '업계 동향')!.id;
  const vid = (
    id: string,
    concepts: string[],
    branchId: string,
    format = 'talk',
    channel = 'ch1'
  ) => ({
    videoId: id,
    title: id,
    concepts: concepts.map((term) => ({ term, weight: 1 })),
    format,
    channelId: channel,
    durationSeconds: DURATION,
    depth: 'intermediate',
    branchId,
  });
  g = addVideoToGraph(g, vid('v1', ['A'], b1));
  g = addVideoToGraph(g, vid('v2', ['A'], b1));
  g = addVideoToGraph(g, vid('v3', ['A', 'B'], b1, 'lecture', 'ch2'));
  g = addVideoToGraph(g, vid('v4', ['C'], b2));
  g = addVideoToGraph(g, vid('v5', ['C'], b2));
  g = addVideoToGraph(g, vid('v6', ['C'], b2));
  g = addVideoToGraph(g, vid('v8', ['C'], b2, 'lecture', 'ch2'));
  return g;
}
const w = (
  g: ContextGraph,
  rel: 'WANTS' | 'AVOIDS' | 'CONTAINS',
  type: 'concept' | 'format' | 'channel' | 'mandala_sector',
  key: string
) =>
  getEdge(
    g,
    g.contextId,
    rel,
    (type === 'mandala_sector' ? findBranch(g, key) : findNodeByKey(g, type, key))?.id ?? ''
  )?.weight;

// A: v1 like (60 s of 600 → no bonus), v2 skip, v3 skip · B: v3 skip · C: v4, v5, v8 skip (v6 넘김) · D: nothing
const J: Judgment[] = [
  { videoId: 'v1', verdict: 'useful', day: DAY, watchedSeconds: 60 },
  { videoId: 'v2', verdict: 'skip', day: DAY },
  { videoId: 'v3', verdict: 'skip', day: DAY },
  { videoId: 'v4', verdict: 'skip', day: DAY },
  { videoId: 'v5', verdict: 'skip', day: DAY },
  { videoId: 'v6', verdict: 'pass', day: DAY },
  { videoId: 'v8', verdict: 'skip', day: DAY },
];

describe('ratioWeight', () => {
  test('1.0 with no judgments, 2·(L+1)/(L+S+2) otherwise', () => {
    expect(ratioWeight(0, 0)).toBe(1);
    expect(ratioWeight(1, 2)).toBeCloseTo(0.8, 6);
    expect(ratioWeight(6, 10)).toBeCloseTo(14 / 18, 6);
    expect(ratioWeight(9, 9)).toBe(1);
    expect(ratioWeight(3, 0)).toBeCloseTo(1.6, 6);
  });
});

describe('recomputeWeights', () => {
  test('the same judgments in any order give the same weights', () => {
    const a = recomputeWeights(applyJudgments(seeded(), J).graph);
    const b = recomputeWeights(applyJudgments(seeded(), [...J].reverse()).graph);
    for (const [rel, type, key] of [
      ['WANTS', 'concept', 'A'],
      ['WANTS', 'concept', 'B'],
      ['WANTS', 'concept', 'C'],
      ['WANTS', 'concept', 'D'],
      ['CONTAINS', 'mandala_sector', '만드는 법'],
      ['CONTAINS', 'mandala_sector', '업계 동향'],
      ['WANTS', 'format', 'talk'],
      ['WANTS', 'format', 'lecture'],
      ['WANTS', 'channel', 'ch1'],
      ['AVOIDS', 'channel', 'ch2'],
    ] as const) {
      expect(w(a, rel, type, key)).toBe(w(b, rel, type, key));
    }
  });

  test('concept: ratio of likes, 1.0 without judgments, 넘김 ignored, never AVOIDS', () => {
    const g = recomputeWeights(applyJudgments(seeded(), J).graph);
    expect(w(g, 'WANTS', 'concept', 'A')).toBeCloseTo(ratioWeight(1, 2), 4); // 0.8
    expect(w(g, 'WANTS', 'concept', 'B')).toBeCloseTo(ratioWeight(0, 1), 4); // 0.6667
    expect(w(g, 'WANTS', 'concept', 'C')).toBeCloseTo(ratioWeight(0, 3), 4); // 0.4
    expect(w(g, 'WANTS', 'concept', 'D')).toBe(1);
    expect(w(g, 'AVOIDS', 'concept', 'C')).toBeUndefined();
  });

  test('a like watched ≥ 50 % counts as 1.5 likes', () => {
    const half: Judgment[] = [
      { videoId: 'v1', verdict: 'useful', day: DAY, watchedSeconds: DURATION / 2 },
      ...J.slice(1),
    ];
    const g = recomputeWeights(applyJudgments(seeded(), half).graph);
    expect(w(g, 'WANTS', 'concept', 'A')).toBeCloseTo(ratioWeight(C.WATCHED_BONUS, 2), 4); // 0.9091
    expect(w(g, 'WANTS', 'format', 'talk')).toBeCloseTo(ratioWeight(C.WATCHED_BONUS, 3), 4);
  });

  test('6 likes / 10 skips keeps a positive weight and no AVOIDS', () => {
    let g = seeded();
    const b1 = findBranch(g, '만드는 법')!.id;
    const js: Judgment[] = [];
    for (let i = 0; i < 16; i++) {
      const id = `x${i}`;
      g = addVideoToGraph(g, {
        videoId: id,
        title: id,
        concepts: [{ term: 'B', weight: 1 }],
        channelId: `c${i}`,
        format: `f${i}`,
        durationSeconds: DURATION,
        branchId: b1,
      });
      js.push({ videoId: id, verdict: i < 6 ? 'useful' : 'skip', day: DAY });
    }
    const r = recomputeWeights(applyJudgments(g, js).graph);
    expect(w(r, 'WANTS', 'concept', 'B')).toBeCloseTo(ratioWeight(6, 10), 4); // 0.7778
    expect(w(r, 'AVOIDS', 'concept', 'B')).toBeUndefined();
  });

  test('branch: 0.2 per judgment with the stated-branch floor', () => {
    const g = recomputeWeights(applyJudgments(seeded(), J).graph);
    expect(w(g, 'CONTAINS', 'mandala_sector', '만드는 법')).toBeCloseTo(0.8, 6); // 1 like, 2 skips
    expect(w(g, 'CONTAINS', 'mandala_sector', '업계 동향')).toBe(C.BRANCH_WEIGHT_FLOOR); // 0 likes, 3 skips → 0.4 → floor 0.5
  });

  test('format: ratio weight, never AVOIDS', () => {
    const g = recomputeWeights(applyJudgments(seeded(), J).graph);
    expect(w(g, 'WANTS', 'format', 'talk')).toBeCloseTo(ratioWeight(1, 3), 4); // v1 like; v2, v4, v5 skip
    expect(w(g, 'WANTS', 'format', 'lecture')).toBeCloseTo(ratioWeight(0, 2), 4); // v3, v8 skip
    expect(w(g, 'AVOIDS', 'format', 'lecture')).toBeUndefined();
    expect(w(g, 'AVOIDS', 'format', 'talk')).toBeUndefined();
  });

  test('channel: count rule for WANTS; AVOIDS only with 2+ skips and no like, +1 per further skip', () => {
    const g = recomputeWeights(applyJudgments(seeded(), J).graph);
    expect(w(g, 'WANTS', 'channel', 'ch1')).toBe(0); // 1 like, 3 skips → 0.5 − 1.5 → floor 0
    expect(w(g, 'AVOIDS', 'channel', 'ch1')).toBeUndefined();
    expect(w(g, 'AVOIDS', 'channel', 'ch2')).toBe(C.AVOID_INITIAL_WEIGHT); // 0 likes, 2 skips
    const more = (id: string, verdict: 'useful' | 'skip') => {
      let g2 = seeded();
      g2 = addVideoToGraph(g2, {
        videoId: id,
        title: id,
        concepts: [],
        format: 'lecture',
        channelId: 'ch2',
        durationSeconds: DURATION,
        branchId: findBranch(g2, '만드는 법')!.id,
      });
      return recomputeWeights(applyJudgments(g2, [...J, { videoId: id, verdict, day: DAY }]).graph);
    };
    expect(w(more('v9', 'skip'), 'AVOIDS', 'channel', 'ch2')).toBe(
      C.AVOID_INITIAL_WEIGHT + C.AVOID_RAISE_DELTA
    );
    const lifted = more('v9', 'useful');
    expect(w(lifted, 'AVOIDS', 'channel', 'ch2')).toBeUndefined();
    expect(w(lifted, 'WANTS', 'channel', 'ch2')).toBe(0); // 0.5·1 − 0.5·2 < 0 → floor
  });

  test('recompute is idempotent and records the history on the edge', () => {
    const once = recomputeWeights(applyJudgments(seeded(), J).graph);
    const twice = recomputeWeights(once);
    for (const key of ['A', 'B', 'C', 'D']) {
      expect(w(twice, 'WANTS', 'concept', key)).toBe(w(once, 'WANTS', 'concept', key));
    }
    expect(w(twice, 'CONTAINS', 'mandala_sector', '만드는 법')).toBe(
      w(once, 'CONTAINS', 'mandala_sector', '만드는 법')
    );
    const a = findNodeByKey(once, 'concept', 'A')!;
    const props = getEdge(once, once.contextId, 'WANTS', a.id)?.properties ?? {};
    expect(props['likes']).toBe(1);
    expect(props['skips']).toBe(2);
  });

  test('a video judged again counts once, with its latest verdict (weights and depth counts)', () => {
    // v1 was 좋아, then changed to 별로; v6 was 넘김, then changed to 좋아
    const changed: Judgment[] = [
      ...J,
      { videoId: 'v1', verdict: 'skip', day: DAY },
      { videoId: 'v6', verdict: 'useful', day: DAY },
    ];
    const finalOnly: Judgment[] = J.map((j) =>
      j.videoId === 'v1'
        ? { videoId: 'v1', verdict: 'skip', day: DAY }
        : j.videoId === 'v6'
          ? { videoId: 'v6', verdict: 'useful', day: DAY }
          : j
    );
    const a = recomputeWeights(applyJudgments(seeded(), changed).graph);
    const b = recomputeWeights(applyJudgments(seeded(), finalOnly).graph);
    for (const [rel, type, key] of [
      ['WANTS', 'concept', 'A'],
      ['WANTS', 'concept', 'C'],
      ['CONTAINS', 'mandala_sector', '만드는 법'],
      ['CONTAINS', 'mandala_sector', '업계 동향'],
      ['WANTS', 'format', 'talk'],
      ['WANTS', 'channel', 'ch1'],
    ] as const) {
      expect(w(a, rel, type, key)).toBe(w(b, rel, type, key));
    }
    expect(w(a, 'WANTS', 'concept', 'A')).toBeCloseTo(ratioWeight(0, 3), 4); // v1 now a skip
    // depth: 7 judged, all intermediate → 1 like (v6), 6 skips (v1 now a skip)
    expect(contextProps(a).depth_pref.standard).toEqual({ likes: 1, dislikes: 6 });
    expect(contextProps(a).depth_pref).toEqual(contextProps(b).depth_pref);
  });

  test('a canceled verdict (no live row left) is dropped from the history', () => {
    const g = applyJudgments(seeded(), J).graph;
    const r = recomputeWeights(dropJudgments(g, ['v1']));
    expect(w(r, 'WANTS', 'concept', 'A')).toBeCloseTo(ratioWeight(0, 2), 4);
    expect(contextProps(r).depth_pref.standard).toEqual({ likes: 0, dislikes: 5 });
  });
});
