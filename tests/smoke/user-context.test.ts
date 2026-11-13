import {
  USER_CONTEXT_CONFIG as C,
  UserContextError,
  addVideoToGraph,
  applyJudgments,
  buildSearchInput,
  contextProps,
  createContextGraph,
  emptyDepthPref,
  findNodeByKey,
  levelFit,
  levelFitTerm,
  nodeIdFor,
  persistGraph,
  readContext,
  restoreGraph,
  scoreCandidate,
  selectTop,
  snapshotGraph,
  toDepthBucket,
  type Candidate,
  type ContextGraph,
  type ContextRelation,
  type GraphSnapshot,
  type UserContextDb,
  type UserContextTx,
} from '@/modules/user-context';
import { edgeKey, getEdge } from '@/modules/user-context/graph';

export {};

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-12T00:00:00Z');
const MANDALA = '33333333-3333-4333-8333-333333333333';

function fixture(): ContextGraph {
  return createContextGraph({
    userId: U,
    contextKey: 'm1',
    goalText: '데이터 분석가 되기',
    why: '이직',
    level: 'standard',
    language: 'ko',
    recencyDays: 30,
    branches: [
      { title: 'SQL', weight: 1.5, concepts: ['SQL'] },
      { title: '통계', weight: 1.0, concepts: ['통계'] },
      { title: '시각화', weight: 1.0 },
      { title: '파이썬', weight: 0.5 },
    ],
    wants: [
      { term: 'Pandas', weight: 2 },
      { term: 'SQL', weight: 1 },
      { term: '통계', weight: 1 },
      { term: '회귀', weight: 0.5 },
    ],
  });
}

const sector = (title: string): string => nodeIdFor(U, 'mandala_sector', `m1:${title}`);

/** Adds an edge from the context to an existing node (by type + key) via snapshot round-trip. */
function withContextEdge(
  g: ContextGraph,
  relation: ContextRelation,
  type: 'concept' | 'format' | 'channel',
  key: string,
  weight: number
): ContextGraph {
  const snap = snapshotGraph(g);
  const target = findNodeByKey(g, type, key);
  if (!target) throw new Error(`no ${type} ${key}`);
  snap.edges.push({
    userId: U,
    sourceId: g.contextId,
    targetId: target.id,
    relation,
    weight,
    properties: {},
  });
  return restoreGraph(snap);
}

function ctxWeight(
  g: ContextGraph,
  relation: ContextRelation,
  type: 'concept' | 'format' | 'channel',
  key: string
): number | undefined {
  const n = findNodeByKey(g, type, key);
  return n ? getEdge(g, g.contextId, relation, n.id)?.weight : undefined;
}

function withVideos(g: ContextGraph): ContextGraph {
  let out = addVideoToGraph(g, {
    videoId: 'vid00000001',
    title: 'Pandas 입문',
    concepts: [
      { term: 'Pandas', weight: 1 },
      { term: 'Matplotlib', weight: 0.8 },
    ],
    format: 'lecture',
    channelId: 'UC_A',
    channelTitle: '채널A',
    depth: 'beginner',
    durationSeconds: 600,
    branchId: sector('SQL'),
  });
  out = addVideoToGraph(out, {
    videoId: 'vid00000002',
    title: 'Pandas 실전',
    concepts: [
      { term: 'Pandas', weight: 1 },
      { term: 'Seaborn', weight: 0.5 },
    ],
    format: 'lecture',
    channelId: 'UC_A',
    depth: 'intermediate',
    durationSeconds: 900,
    branchId: sector('SQL'),
  });
  out = addVideoToGraph(out, {
    videoId: 'vid00000003',
    title: 'Pandas 심화',
    concepts: [{ term: 'Pandas', weight: 1 }],
    format: 'tutorial',
    channelId: 'UC_B',
    depth: 'advanced',
    durationSeconds: 1200,
    branchId: sector('파이썬'),
  });
  return out;
}

const DAY = '2026-11-12';

describe('user context — search input', () => {
  test('maps the graph to KeywordBuilderInput deterministically', () => {
    const input = buildSearchInput(fixture(), NOW);
    expect(input).toEqual({
      centerGoal: '데이터 분석가 되기',
      subGoals: ['SQL', '시각화', '통계'],
      focusTags: ['Pandas', 'SQL', '통계'],
      targetLevel: 'standard',
      language: 'ko',
      publishedAfter: '2026-10-13T00:00:00.000Z',
    });
    expect(buildSearchInput(fixture(), NOW)).toEqual(input);
  });

  test('AVOIDS never reach the search input', () => {
    const g = withContextEdge(fixture(), 'AVOIDS', 'concept', 'Pandas', 5);
    expect(buildSearchInput(g, NOW)).toEqual(buildSearchInput(fixture(), NOW));
  });

  test('no recency → no publishedAfter', () => {
    const g = createContextGraph({ userId: U, contextKey: 'm2', goalText: 'x' });
    expect(buildSearchInput(g, NOW).publishedAfter).toBeUndefined();
  });
});

describe('user context — scoring', () => {
  const A: Candidate = {
    videoId: 'A',
    concepts: [{ term: 'Pandas', weight: 1 }],
    branch: 'SQL',
    depth: 'intermediate',
    passesBaseFilters: true,
  };
  const B: Candidate = {
    videoId: 'B',
    concepts: [{ term: 'SQL', weight: 1 }],
    depth: 'beginner',
    passesBaseFilters: true,
  };
  const Cc: Candidate = {
    videoId: 'C',
    concepts: [{ term: '통계', weight: 0.5 }],
    depth: 'mixed',
    passesBaseFilters: true,
  };
  const D: Candidate = {
    videoId: 'D',
    concepts: [{ term: 'Pandas', weight: 1 }],
    passesBaseFilters: false,
  };
  const E: Candidate = { videoId: 'E', concepts: [], depth: null, passesBaseFilters: true };
  const F: Candidate = { videoId: 'F', concepts: [], passesBaseFilters: true };

  test('score components', () => {
    const g = fixture();
    // WANTS 2×1 + branch 1.5 + level fit 2×(0.75−0.5)
    expect(scoreCandidate(g, A)).toMatchObject({ score: 4, excluded: false });
    // WANTS 1 + inferred branch SQL 1.5 + foundation fit 0.5 → 0
    expect(scoreCandidate(g, B).score).toBe(2.5);
    expect(scoreCandidate(g, B).reasons.some((r) => r.startsWith('추정 가지'))).toBe(true);
    // WANTS 1×0.5 + inferred branch 통계 1.0; mixed depth neutral
    expect(scoreCandidate(g, Cc).score).toBe(1.5);
    expect(scoreCandidate(g, D)).toEqual({
      videoId: 'D',
      score: 0,
      excluded: true,
      reasons: ['기본 필터 미통과'],
    });
  });

  test('selectTop orders by score then videoId', () => {
    const g = fixture();
    expect(selectTop(g, [Cc, D, A, B, F, E], 3).map((s) => s.videoId)).toEqual(['A', 'B', 'C']);
    expect(selectTop(g, [F, E, Cc], 3).map((s) => s.videoId)).toEqual(['C', 'E', 'F']);
  });

  test('concept AVOIDS never excludes, it only lowers the score by AVOID_CONCEPT_PENALTY per unit', () => {
    const base = scoreCandidate(fixture(), A).score;
    const hard = withContextEdge(fixture(), 'AVOIDS', 'concept', 'Pandas', C.AVOID_EXCLUDE);
    const s = scoreCandidate(hard, A);
    expect(s.excluded).toBe(false);
    expect(s.score).toBeCloseTo(base - C.AVOID_EXCLUDE * C.AVOID_CONCEPT_PENALTY, 6);
    expect(s.reasons.join(' ')).toContain("회피 개념 'Pandas'");
    const soft = withContextEdge(fixture(), 'AVOIDS', 'concept', 'Pandas', 0.5);
    expect(scoreCandidate(soft, A).score).toBeCloseTo(base - 0.5 * C.AVOID_CONCEPT_PENALTY, 6);
  });

  test('channel AVOIDS at the threshold excludes, below it penalises; a format AVOIDS is ignored', () => {
    const g = withVideos(fixture());
    const ch: Candidate = { ...A, channelId: 'UC_A' };
    const hardCh = withContextEdge(g, 'AVOIDS', 'channel', 'UC_A', C.AVOID_EXCLUDE);
    const s = scoreCandidate(hardCh, ch);
    expect(s.excluded).toBe(true);
    expect(s.reasons[0]).toContain('회피 채널');
    const softCh = withContextEdge(g, 'AVOIDS', 'channel', 'UC_A', 0.5);
    const r = scoreCandidate(softCh, ch);
    expect(r.excluded).toBe(false);
    expect(r.score).toBeCloseTo(scoreCandidate(g, ch).score - 0.5 * C.AVOID_PENALTY_WEIGHT, 6);
    // formats are never avoided (James 2026-11-13): same score with or without the edge
    const fmt: Candidate = { ...A, format: 'lecture' };
    const fmtAvoid = withContextEdge(g, 'AVOIDS', 'format', 'lecture', C.AVOID_EXCLUDE);
    expect(scoreCandidate(fmtAvoid, fmt)).toEqual(scoreCandidate(g, fmt));
  });
});

describe('user context — judgments', () => {
  test('useful with watched ratio ≥ 0.5: concept ×1.5, branch +0.2, format/channel +0.5', () => {
    const g0 = withVideos(fixture());
    const { graph, diff } = applyJudgments(g0, [
      {
        videoId: 'vid00000001',
        verdict: 'useful',
        watchedSeconds: 300,
        day: DAY,
        batchId: 'b1',
        arm: 'ctx',
      },
    ]);
    expect(ctxWeight(graph, 'WANTS', 'concept', 'Pandas')).toBe(3.5);
    expect(ctxWeight(graph, 'WANTS', 'concept', 'Matplotlib')).toBe(1.5);
    expect(getEdge(graph, graph.contextId, 'CONTAINS', sector('SQL'))?.weight).toBe(1.7);
    expect(ctxWeight(graph, 'WANTS', 'format', 'lecture')).toBe(0.5);
    expect(ctxWeight(graph, 'WANTS', 'channel', 'UC_A')).toBe(0.5);
    expect(contextProps(graph).depth_pref.foundation).toEqual({ likes: 1, dislikes: 0 });
    const video = findNodeByKey(graph, 'video_resource', 'vid00000001');
    expect(getEdge(graph, graph.contextId, 'JUDGED', video?.id ?? '')?.properties).toEqual({
      verdict: 'useful',
      watched_seconds: 300,
      day: DAY,
      batch_id: 'b1',
      arm: 'ctx',
    });
    expect(diff.versionBefore).toBe(1);
    expect(diff.versionAfter).toBe(2);
    expect(diff.edges.find((e) => e.edge.targetTitle === 'Pandas')).toMatchObject({
      before: 2,
      after: 3.5,
    });
    expect(diff.edges.find((e) => e.edge.targetTitle === 'Matplotlib')).toMatchObject({
      before: null,
      after: 1.5,
    });
    // input graph untouched (pure)
    expect(ctxWeight(g0, 'WANTS', 'concept', 'Pandas')).toBe(2);
  });

  test('useful with a short watch: no bonus', () => {
    const { graph } = applyJudgments(withVideos(fixture()), [
      { videoId: 'vid00000001', verdict: 'useful', watchedSeconds: 100, day: DAY },
    ]);
    expect(ctxWeight(graph, 'WANTS', 'concept', 'Pandas')).toBe(3);
  });

  test('skip lowers existing weights (floor 0) and never creates WANTS', () => {
    const { graph, diff } = applyJudgments(withVideos(fixture()), [
      { videoId: 'vid00000001', verdict: 'skip', watchedSeconds: 0, day: DAY },
    ]);
    expect(ctxWeight(graph, 'WANTS', 'concept', 'Pandas')).toBe(1);
    expect(ctxWeight(graph, 'WANTS', 'concept', 'Matplotlib')).toBeUndefined();
    expect(getEdge(graph, graph.contextId, 'CONTAINS', sector('SQL'))?.weight).toBe(1.3);
    expect(ctxWeight(graph, 'WANTS', 'format', 'lecture')).toBeUndefined();
    expect(contextProps(graph).depth_pref.foundation).toEqual({ likes: 0, dislikes: 1 });
    expect(diff.avoidsAdded).toEqual([]);
  });

  test('2 skips & 0 likes → AVOIDS on concept, format and channel; a 3rd skip raises it', () => {
    const g0 = withVideos(fixture());
    const step = applyJudgments(g0, [
      { videoId: 'vid00000001', verdict: 'skip', day: DAY },
      { videoId: 'vid00000002', verdict: 'skip', day: DAY },
    ]);
    const g = step.graph;
    expect(ctxWeight(g, 'WANTS', 'concept', 'Pandas')).toBe(0);
    expect(ctxWeight(g, 'AVOIDS', 'concept', 'Pandas')).toBe(C.AVOID_INITIAL_WEIGHT);
    expect(ctxWeight(g, 'AVOIDS', 'format', 'lecture')).toBe(C.AVOID_INITIAL_WEIGHT);
    expect(ctxWeight(g, 'AVOIDS', 'channel', 'UC_A')).toBe(C.AVOID_INITIAL_WEIGHT);
    expect(ctxWeight(g, 'AVOIDS', 'concept', 'Matplotlib')).toBeUndefined();
    expect(ctxWeight(g, 'AVOIDS', 'concept', 'Seaborn')).toBeUndefined();
    expect(step.diff.avoidsAdded.map((c) => c.edge.targetTitle).sort()).toEqual([
      'Pandas',
      'lecture',
      '채널A',
    ]);

    const third = applyJudgments(g, [{ videoId: 'vid00000003', verdict: 'skip', day: DAY }]);
    expect(ctxWeight(third.graph, 'AVOIDS', 'concept', 'Pandas')).toBe(
      C.AVOID_INITIAL_WEIGHT + C.AVOID_RAISE_DELTA
    );
    expect(third.diff.avoidsRaised.map((c) => c.edge.targetTitle)).toEqual(['Pandas']);
    expect(third.diff.versionAfter).toBe(3);
  });

  test('AVOIDS is released once likes ≥ skips; the release is in the diff and deleted on persist', async () => {
    const g0 = withVideos(fixture());
    const step = applyJudgments(g0, [
      { videoId: 'vid00000001', verdict: 'skip', day: DAY },
      { videoId: 'vid00000002', verdict: 'skip', day: DAY },
    ]);
    expect(ctxWeight(step.graph, 'AVOIDS', 'concept', 'Pandas')).toBe(C.AVOID_INITIAL_WEIGHT);
    // the second video is re-judged as a like: history becomes 1 skip, 1 like
    const next = applyJudgments(step.graph, [
      { videoId: 'vid00000002', verdict: 'useful', day: DAY },
    ]);
    expect(ctxWeight(next.graph, 'AVOIDS', 'concept', 'Pandas')).toBeUndefined();
    expect(ctxWeight(next.graph, 'AVOIDS', 'format', 'lecture')).toBeUndefined();
    expect(ctxWeight(next.graph, 'AVOIDS', 'channel', 'UC_A')).toBeUndefined();
    const removed = next.diff.avoidsRemoved.map((c) => c.edge.targetTitle).sort();
    expect(removed).toEqual(['Pandas', 'lecture', '채널A']);
    for (const c of next.diff.avoidsRemoved) {
      expect(c.before).toBe(C.AVOID_INITIAL_WEIGHT);
      expect(c.after).toBeNull();
    }
    const { db, queries } = fakeDb();
    const res = await persistGraph(db, next.graph, { previous: step.graph });
    expect(res.edgesDeleted).toBe(3);
    const deletes = queries.filter((q) => q.sql.includes('DELETE FROM ontology.edges'));
    expect(deletes).toHaveLength(3);
    for (const d of deletes) expect(d.params[3]).toBe('AVOIDS');
  });

  test('a like in the history blocks AVOIDS', () => {
    const { graph } = applyJudgments(withVideos(fixture()), [
      { videoId: 'vid00000001', verdict: 'useful', day: DAY },
      { videoId: 'vid00000002', verdict: 'skip', day: DAY },
      { videoId: 'vid00000003', verdict: 'skip', day: DAY },
    ]);
    expect(ctxWeight(graph, 'AVOIDS', 'concept', 'Pandas')).toBeUndefined();
  });

  test('pass writes only JUDGED and excludes the video from the next batch', () => {
    const g0 = withVideos(fixture());
    const { graph, diff } = applyJudgments(g0, [
      { videoId: 'vid00000001', verdict: 'pass', watchedSeconds: 30, day: DAY },
    ]);
    const before = snapshotGraph(g0);
    const after = snapshotGraph(graph);
    const video = findNodeByKey(graph, 'video_resource', 'vid00000001');
    const judgedKey = edgeKey(graph.contextId, 'JUDGED', video?.id ?? '');
    const afterEdges = after.edges.filter(
      (e) => edgeKey(e.sourceId, e.relation, e.targetId) !== judgedKey
    );
    expect(afterEdges).toEqual(before.edges);
    expect(after.edges).toHaveLength(before.edges.length + 1);
    expect(diff.edges).toEqual([]);
    expect(diff.depthPref.after).toEqual(diff.depthPref.before);
    const s = scoreCandidate(graph, {
      videoId: 'vid00000001',
      concepts: [],
      passesBaseFilters: true,
    });
    expect(s).toMatchObject({ excluded: true, reasons: ['이미 판정한 영상(넘김)'] });
  });

  test('unknown video is rejected', () => {
    expect(() =>
      applyJudgments(fixture(), [{ videoId: 'nope', verdict: 'useful', day: DAY }])
    ).toThrow(UserContextError);
  });

  test('branch rank changes are reported', () => {
    const g0 = withVideos(fixture());
    const extra = ['vid00000004', 'vid00000005'].reduce(
      (g, id) =>
        addVideoToGraph(g, {
          videoId: id,
          title: id,
          concepts: [],
          depth: null,
          branchId: sector('파이썬'),
        }),
      g0
    );
    const { diff } = applyJudgments(extra, [
      { videoId: 'vid00000003', verdict: 'useful', day: DAY },
      { videoId: 'vid00000004', verdict: 'useful', day: DAY },
      { videoId: 'vid00000005', verdict: 'useful', day: DAY },
    ]);
    expect(diff.branchRanks.map((b) => [b.title, b.rankBefore, b.rankAfter])).toEqual([
      ['SQL', 1, 1],
      ['파이썬', 4, 2],
      ['시각화', 2, 3],
      ['통계', 3, 4],
    ]);
    expect(diff.branchRanks[1]).toMatchObject({ weightBefore: 0.5, weightAfter: 1.1 });
  });
});

describe('user context — depth / level fit', () => {
  test('depth scale mapping', () => {
    expect(toDepthBucket('beginner')).toBe('foundation');
    expect(toDepthBucket('intermediate')).toBe('standard');
    expect(toDepthBucket('advanced')).toBe('advanced');
    expect(toDepthBucket('expert')).toBe('advanced');
    expect(toDepthBucket('foundation')).toBe('foundation');
    expect(toDepthBucket('mixed')).toBeNull();
    expect(toDepthBucket(null)).toBeNull();
  });

  test('level fit numbers', () => {
    const p = emptyDepthPref();
    p.foundation = { likes: 1, dislikes: 0 };
    p.standard = { likes: 0, dislikes: 1 };
    expect(levelFit(p, 'standard', 'foundation')).toBeCloseTo(2 / 3);
    expect(levelFit(p, 'standard', 'standard')).toBeCloseTo(0.6);
    expect(levelFit(p, 'standard', 'advanced')).toBeCloseTo(0.5);
    expect(levelFitTerm(p, 'standard', 'beginner')).toBeCloseTo(1 / 3);
    expect(levelFitTerm(p, 'standard', 'intermediate')).toBeCloseTo(0.2);
    expect(levelFitTerm(p, 'standard', 'advanced')).toBeCloseTo(0);
    expect(levelFitTerm(p, 'standard', 'mixed')).toBe(0);
    expect(levelFitTerm(emptyDepthPref(), 'standard', 'intermediate')).toBeCloseTo(0.5);
  });

  test('depth_pref ignores pass', () => {
    const { graph } = applyJudgments(withVideos(fixture()), [
      { videoId: 'vid00000002', verdict: 'useful', day: DAY },
      { videoId: 'vid00000003', verdict: 'pass', day: DAY },
    ]);
    expect(contextProps(graph).depth_pref).toEqual({
      foundation: { likes: 0, dislikes: 0 },
      standard: { likes: 1, dislikes: 0 },
      advanced: { likes: 0, dislikes: 0 },
    });
  });
});

describe('user context — snapshot', () => {
  test('round-trips through JSON', () => {
    const { graph } = applyJudgments(withVideos(fixture()), [
      { videoId: 'vid00000001', verdict: 'useful', day: DAY },
    ]);
    const snap = snapshotGraph(graph);
    const back = restoreGraph(JSON.parse(JSON.stringify(snap)) as GraphSnapshot);
    expect(snapshotGraph(back)).toEqual(snap);
    expect(buildSearchInput(back, NOW)).toEqual(buildSearchInput(graph, NOW));
  });
});

// ---------------------------------------------------------------------------
// DB boundary (mocked)
// ---------------------------------------------------------------------------

interface Q {
  sql: string;
  params: unknown[];
}

function fakeDb(foreign: Array<{ id: string }> = []): { db: UserContextDb; queries: Q[] } {
  const queries: Q[] = [];
  const tx: UserContextTx = {
    $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      queries.push({ sql, params });
      return foreign as never;
    }),
    $executeRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      queries.push({ sql, params });
      return 1;
    }),
  };
  const db: UserContextDb = {
    ...tx,
    $transaction: jest.fn(async (fn: (t: UserContextTx) => Promise<unknown>) =>
      fn(tx)
    ) as unknown as UserContextDb['$transaction'],
  };
  return { db, queries };
}

describe('user context — persistGraph SQL shape', () => {
  test('fresh graph: ownership check, node upserts, edge upserts, mandala link — all parameterised', async () => {
    const g = withVideos(fixture());
    const { db, queries } = fakeDb();
    const res = await persistGraph(db, g, { mandalaId: MANDALA });
    expect(res).toEqual({
      nodesWritten: g.nodes.size,
      edgesWritten: g.edges.size,
      edgesDeleted: 0,
      mandalaLinked: true,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);

    expect(queries[0]?.sql).toContain('user_id <> $2::uuid');
    expect(queries[0]?.params[1]).toBe(U);
    const nodeQs = queries.filter((q) => q.sql.includes('INSERT INTO ontology.nodes'));
    const edgeQs = queries.filter((q) => q.sql.includes('INSERT INTO ontology.edges'));
    expect(nodeQs).toHaveLength(g.nodes.size);
    expect(edgeQs).toHaveLength(g.edges.size);
    for (const q of nodeQs) {
      expect(q.sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(q.sql).toContain('ontology.nodes.properties || EXCLUDED.properties');
      expect(q.params[1]).toBe(U);
      expect(q.params[6]).toBe('service');
    }
    for (const q of edgeQs) {
      expect(q.sql).toContain('ON CONFLICT (source_id, target_id, relation) DO UPDATE');
      expect(q.sql).toContain('ontology.edges.properties || EXCLUDED.properties');
      expect(q.params[0]).toBe(U);
    }
    // node writes precede edge writes (FK)
    const lastNode = queries.lastIndexOf(nodeQs[nodeQs.length - 1] as Q);
    const firstEdge = queries.indexOf(edgeQs[0] as Q);
    expect(lastNode).toBeLessThan(firstEdge);

    const link = queries[queries.length - 1];
    expect(link?.sql).toContain('UPDATE public.user_mandalas');
    expect(link?.params).toEqual([g.contextId, 1, MANDALA, U]);

    // no value is interpolated into SQL text
    for (const q of queries) {
      expect(q.sql).not.toContain('Pandas');
      expect(q.sql).not.toContain(U);
    }
  });

  test('with previous: only changed nodes/edges are written', async () => {
    const g0 = withVideos(fixture());
    const { graph } = applyJudgments(g0, [{ videoId: 'vid00000001', verdict: 'pass', day: DAY }]);
    const { db, queries } = fakeDb();
    const res = await persistGraph(db, graph, { previous: g0 });
    // context node (version) + the JUDGED edge
    expect(res).toEqual({
      nodesWritten: 1,
      edgesWritten: 1,
      edgesDeleted: 0,
      mandalaLinked: false,
    });
    const edge = queries.find((q) => q.sql.includes('INSERT INTO ontology.edges'));
    expect(edge?.params[3]).toBe('JUDGED');
  });

  test('refuses to write when a touched node belongs to another user', async () => {
    const { db, queries } = fakeDb([{ id: 'x' }]);
    await expect(persistGraph(db, fixture())).rejects.toThrow(UserContextError);
    expect(queries.some((q) => q.sql.includes('INSERT'))).toBe(false);
  });

  test("refuses a graph holding another user's node before any SQL", async () => {
    const snap = snapshotGraph(fixture());
    const first = snap.nodes[0];
    if (first) snap.nodes[0] = { ...first, userId: OTHER };
    const { db, queries } = fakeDb();
    await expect(persistGraph(db, restoreGraph(snap))).rejects.toThrow(UserContextError);
    expect(queries).toHaveLength(0);
  });
});

describe('user context — readContext (mocked)', () => {
  test('rebuilds the graph from rows scoped to the owner', async () => {
    const { graph } = applyJudgments(withVideos(fixture()), [
      { videoId: 'vid00000001', verdict: 'useful', day: DAY },
    ]);
    const snap = snapshotGraph(graph);
    const nodeRow = (n: GraphSnapshot['nodes'][number]): Record<string, unknown> => ({
      id: n.id,
      user_id: n.userId,
      type: n.type,
      title: n.title,
      properties: n.properties,
      source_ref: n.sourceRef,
    });
    const queries: Q[] = [];
    const db: UserContextTx = {
      $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes("type = 'user_context'")) {
          return snap.nodes.filter((n) => n.id === params[0]).map(nodeRow) as never;
        }
        if (sql.includes('FROM ontology.edges')) {
          const sources = params[0] as string[];
          const rels = params[2] as string[];
          return snap.edges
            .filter(
              (e) =>
                sources.includes(e.sourceId) && rels.includes(e.relation) && e.userId === params[1]
            )
            .map((e) => ({
              user_id: e.userId,
              source_id: e.sourceId,
              target_id: e.targetId,
              relation: e.relation,
              weight: e.weight,
              properties: e.properties,
            })) as never;
        }
        const ids = params[0] as string[];
        return snap.nodes
          .filter((n) => ids.includes(n.id) && n.userId === params[1])
          .map(nodeRow) as never;
      }),
      $executeRawUnsafe: jest.fn(async () => 0),
    };
    const back = await readContext(db, graph.contextId);
    // The unjudged videos (2, 3) are not reachable from the context, so compare the reachable part.
    const reachable = snapshotGraph(back);
    expect(reachable.nodes.every((n) => n.userId === U)).toBe(true);
    expect(buildSearchInput(back, NOW)).toEqual(buildSearchInput(graph, NOW));
    expect(contextProps(back)).toEqual(contextProps(graph));
    const v1 = findNodeByKey(back, 'video_resource', 'vid00000001');
    expect(v1).toBeDefined();
    expect(findNodeByKey(back, 'video_resource', 'vid00000002')).toBeUndefined();
    expect(getEdge(back, back.contextId, 'JUDGED', v1?.id ?? '')?.properties['verdict']).toBe(
      'useful'
    );
    for (const q of queries) expect(q.sql).not.toContain(U);
  });
});
