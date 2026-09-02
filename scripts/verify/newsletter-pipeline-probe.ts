/**
 * Does the pipeline hold its own contract?
 *
 * Runs S1 through S7 against the real tables with a corpus built here, so the
 * machinery is exercised before a real harvest spends 4,000 quota units. What
 * it checks is not "does it produce output" but the four promises the pipeline
 * is built on:
 *
 *   1. every dropped row names a stage and a reason, and the reasons add up
 *   2. the ledger and the corpus agree (S6 throws if they do not)
 *   3. an unjudged candidate stops the run — it is neither pass nor reject
 *   4. a re-run skips completed stages instead of double-counting
 *
 * S4's HTTP call is stubbed; every other stage runs its real code path.
 *
 *   DATABASE_URL=... npx tsx scripts/verify/newsletter-pipeline-probe.ts
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { getPrismaClient } from '@/modules/database/client';
import { startRun, readFunnel } from '@/modules/newsletter/pipeline-ledger';
import { pipeline, corpus } from '@/modules/newsletter/pipeline';
import { AI_TECH } from '@/modules/newsletter/topics/ai-tech';
import { createConsoleJudge } from '@/modules/newsletter/pipeline/judge/console-judge';
import { MS_PER_DAY as DAY } from '@/utils/time-constants';
import type { StageContext } from '@/modules/newsletter/pipeline';

const TMP = '/tmp/newsletter-probe';


let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
  if (!ok) failures += 1;
}

/** 11 url-safe characters, which is what the publish gate requires. */
function vid(n: number): string {
  return `PROBE${String(n).padStart(6, '0')}`.slice(0, 11);
}

interface Fixture {
  n: number;
  title: string;
  channel: string;
  ageDays: number;
  seconds: number | null;
  verdict: { safe: boolean; learnable: boolean; inScope: boolean; why: string };
}

/**
 * A corpus with one of every case the stages are supposed to separate.
 *
 * Three channels carry "agent" and three carry "benchmark", so S5 has two
 * subjects that clear the three-independent-channels bar and one ("lora",
 * two channels) that does not.
 */
function fixtures(): Fixture[] {
  const ok = (why: string) => ({ safe: true, learnable: true, inScope: true, why });
  const f: Fixture[] = [
    // corroborated: agent, three channels
    { n: 1, title: 'Building a coding agent with MCP', channel: 'UC_ai_engineer', ageDays: 1, seconds: 1500, verdict: ok('first-hand agent build') },
    { n: 2, title: 'Agent tool use in production', channel: 'UC_nate_herk', ageDays: 2, seconds: 1200, verdict: ok('production agent patterns') },
    { n: 3, title: '에이전트 툴 호출 실전', channel: 'UC_ibm_tech', ageDays: 3, seconds: 900, verdict: ok('Korean agent walkthrough') },
    // corroborated: benchmark, three channels
    { n: 4, title: 'LLM benchmark comparison 2026', channel: 'UC_ai_engineer', ageDays: 1, seconds: 1100, verdict: ok('measured benchmark run') },
    { n: 5, title: '모델 벤치마크 실측 비교', channel: 'UC_tech_bridge', ageDays: 2, seconds: 800, verdict: ok('own measurements') },
    { n: 6, title: 'Benchmark results explained', channel: 'UC_ai_foundations', ageDays: 4, seconds: 1400, verdict: ok('explains eval design') },
    // single-subject: lora, two channels only
    { n: 7, title: 'LoRA fine-tuning walkthrough', channel: 'UC_ai_engineer', ageDays: 2, seconds: 2000, verdict: ok('hands-on fine-tune') },
    { n: 8, title: '파인튜닝 LoRA 적용기', channel: 'UC_nate_herk', ageDays: 5, seconds: 1600, verdict: ok('applied fine-tuning') },
    // S1 drops
    { n: 9, title: 'Quick agent tip', channel: 'UC_ai_engineer', ageDays: 1, seconds: 45, verdict: ok('unused: dropped at S1') },
    { n: 10, title: 'Shorts: prompt trick', channel: 'UC_tech_bridge', ageDays: 1, seconds: 30, verdict: ok('unused: dropped at S1') },
    { n: 11, title: 'Removed video', channel: 'UC_ibm_tech', ageDays: 1, seconds: null, verdict: ok('unused: dropped at S1') },
    // S2 drops
    { n: 12, title: 'Old agent tutorial', channel: 'UC_ai_engineer', ageDays: 30, seconds: 1200, verdict: ok('unused: dropped at S2') },
    { n: 13, title: 'エージェント入門', channel: 'UC_jp_channel', ageDays: 2, seconds: 1000, verdict: ok('unused: dropped at S2') },
    // S3 drops, one per axis
    { n: 14, title: 'How I made $10k with AI in a week', channel: 'UC_hustle', ageDays: 2, seconds: 900, verdict: { safe: true, learnable: false, inScope: true, why: 'income claim, teaches nothing actionable' } },
    { n: 15, title: 'What is new in React 19', channel: 'UC_frontend', ageDays: 1, seconds: 1300, verdict: { safe: true, learnable: true, inScope: false, why: 'general programming — belongs to the dev brief' } },
    { n: 16, title: 'AI lingerie lookbook', channel: 'UC_lookbook', ageDays: 1, seconds: 700, verdict: { safe: false, learnable: false, inScope: false, why: 'not a study subject' } },
  ];
  return f;
}

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  mkdirSync(TMP, { recursive: true });

  const runId = await startRun({
    categoryKey: AI_TECH.categoryKey,
    weekOf: new Date(Date.UTC(2026, 8, 1)),
    topicSnapshot: { probe: true },
    createdBy: 'pipeline-probe',
  });
  console.log(`=== pipeline probe, run ${runId} ===\n`);

  const f = fixtures();
  await corpus.seed(
    runId,
    f.map((x) => ({
      videoId: vid(x.n),
      title: x.title,
      channelId: x.channel,
      channelTitle: x.channel.replace('UC_', '').replace(/_/g, ' '),
      publishedAt: new Date(Date.now() - x.ageDays * DAY),
      durationSeconds: x.seconds ?? undefined,
      viewCount: 1000 + x.n,
      source: x.n % 3 === 0 ? 'search' : 'trusted',
    }))
  );

  // S0 is not run here, so its ledger row is written by hand — the runner
  // refuses to mark a run complete over a missing stage, which is the point.
  await prisma.$executeRaw`
    INSERT INTO newsletter_pipeline_steps (run_id, stage, items_in, items_out, drop_reasons, quota_units)
    VALUES (${runId}::uuid, 'S0_harvest', ${f.length}, ${f.length}, '{}'::jsonb, 0)`;

  const verdictsPath = `${TMP}/verdicts.jsonl`;
  writeFileSync(
    verdictsPath,
    f.map((x) => JSON.stringify({ videoId: vid(x.n), ...x.verdict })).join('\n') + '\n'
  );

  // S4's transport only. Every other stage runs its real code.
  // Faithful to what videos.list returns for these ids: the fixture's own
  // title, channel and view count. An earlier version answered with one
  // channel name and one description for every id, which made S5 see every
  // term on every channel and made the pick-uniqueness check compare a
  // constant to itself — a stub that does not vary cannot test a stage whose
  // whole job is grouping.
  const stubFetch = (async (url: unknown) => {
    const ids = String(url).match(/[?&]id=([^&]+)/)?.[1]?.split(',') ?? [];
    return new Response(
      JSON.stringify({
        items: ids.map((id) => {
          const x = f.find((y) => vid(y.n) === id);
          return {
            id,
            snippet: {
              title: x?.title ?? id,
              channelTitle: (x?.channel ?? 'UC_probe').replace('UC_', '').replace(/_/g, ' '),
              channelId: x?.channel ?? 'UC_probe',
              publishedAt: new Date(Date.now() - (x?.ageDays ?? 1) * DAY).toISOString(),
              description: x?.title ?? '',
              tags: [],
            },
            statistics: { viewCount: String(1000 + (x?.n ?? 0)) },
            contentDetails: { duration: 'PT20M' },
          };
        }),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  const ctx: StageContext = {
    runId,
    topic: AI_TECH,
    judge: createConsoleJudge(verdictsPath),
    fetchImpl: stubFetch,
    artifacts: {},
  };

  await pipeline(ctx, 'S1_format', 'S7_draft').invoke(undefined);

  // ---- 1. the funnel balances, stage by stage ----------------------------
  const funnel = await readFunnel(runId);
  const balanced = funnel.stages.every((s) => {
    const dropped = s.itemsIn - s.itemsOut;
    const accounted = Object.values(s.dropReasons).reduce((a, b) => a + b, 0);
    return dropped === accounted;
  });
  check(
    'every stage accounts for every dropped row',
    balanced,
    funnel.stages.map((s) => `${s.stage}:${s.itemsIn}->${s.itemsOut}`).join(' ')
  );

  // ---- 2. the drops landed where they were supposed to -------------------
  const all = await corpus.readAll(runId);
  const at = (stage: string, reason: string) =>
    all.filter((r) => r.droppedAtStage === stage && r.dropReason === reason).length;
  check('S1 dropped the two shorts', at('S1_format', 'short_or_under_4min') === 2, `n=${at('S1_format', 'short_or_under_4min')}`);
  check('S1 dropped the unavailable one', at('S1_format', 'unavailable') === 1, `n=${at('S1_format', 'unavailable')}`);
  check('S2 dropped the out-of-window one', at('S2_domain', 'outside_topic_window') === 1, `n=${at('S2_domain', 'outside_topic_window')}`);
  check('S2 dropped the third-script title', at('S2_domain', 'title_not_ko_or_en') === 1, `n=${at('S2_domain', 'title_not_ko_or_en')}`);
  check('S3 separated the three axes', at('S3_judge', 'unsafe') === 1 && at('S3_judge', 'out_of_scope') === 1 && at('S3_judge', 'not_learnable') === 1,
    `unsafe=${at('S3_judge', 'unsafe')} out_of_scope=${at('S3_judge', 'out_of_scope')} not_learnable=${at('S3_judge', 'not_learnable')}`);

  // ---- 3. rejected rows keep the reasoning that rejected them ------------
  const rejected = all.filter((r) => r.droppedAtStage === 'S3_judge');
  check(
    'a rejected row records who judged it and why',
    rejected.length === 3 && rejected.every((r) => {
      const v = (r.verdict ?? {}) as { judge?: string; why?: string };
      return v.judge === 'console' && !!v.why;
    }),
    rejected.map((r) => `${r.videoId}:${((r.verdict ?? {}) as { why?: string }).why?.slice(0, 28)}`).join(' | ')
  );

  // ---- 4. S5 found the subjects, and only the real ones ------------------
  const survivors = await corpus.readStage(runId, 'S7_draft');
  const corroboratedTerms = new Set<string>();
  for (const s of survivors) {
    const c = (s.corroboration ?? {}) as { corroborated?: Array<{ term: string }> };
    for (const t of c.corroborated ?? []) corroboratedTerms.add(t.term);
  }
  check(
    'S5 cleared subjects with three independent channels and not the two-channel one',
    corroboratedTerms.has('agent') && corroboratedTerms.has('benchmark') && !corroboratedTerms.has('lora'),
    `cleared: ${[...corroboratedTerms].join(', ') || '(none)'}`
  );

  // ---- 5. the draft is derived, and says what it still needs -------------
  const draft = ctx.artifacts['draft'] as {
    picks: Array<{ videoId: string; meta: string; body: string; judgedBy: string }>;
    awaitingEditor: string[];
    funnel: unknown;
  };
  const oneChannelEach = new Set(draft.picks.map((p) => p.meta.split(' · ')[0])).size === draft.picks.length;
  check('picks carry a video id and the judge that passed them',
    draft.picks.length > 0 && draft.picks.every((p) => /^[A-Za-z0-9_-]{11}$/.test(p.videoId) && p.judgedBy === 'console'),
    `${draft.picks.length} picks, ids ${draft.picks.map((p) => p.videoId).join(',')}`);
  check('no channel appears twice in the picks', oneChannelEach, draft.picks.map((p) => p.meta).join(' | '));
  check('the draft names what a person still has to write',
    draft.awaitingEditor.includes('stories') && draft.picks.every((p) => p.body === '[[EDITOR]]'),
    `${draft.awaitingEditor.length} fields marked`);

  // ---- 6. an unjudged candidate stops the run ----------------------------
  const runB = await startRun({ categoryKey: 'ai-tech', weekOf: new Date(Date.UTC(2026, 8, 1)), topicSnapshot: {}, createdBy: 'pipeline-probe' });
  await corpus.seed(runB, [{ videoId: vid(99), title: 'Unjudged agent video', channelId: 'UC_x', channelTitle: 'x', publishedAt: new Date(), durationSeconds: 900, viewCount: 10, source: 'search' }]);
  await prisma.$executeRaw`
    INSERT INTO newsletter_pipeline_steps (run_id, stage, items_in, items_out, drop_reasons, quota_units)
    VALUES (${runB}::uuid, 'S0_harvest', 1, 1, '{}'::jsonb, 0)`;
  let stopped = '';
  try {
    await pipeline({ runId: runB, topic: AI_TECH, judge: createConsoleJudge(verdictsPath), fetchImpl: stubFetch, artifacts: {} }, 'S1_format', 'S3_judge').invoke(undefined);
  } catch (e) {
    stopped = e instanceof Error ? e.message : String(e);
  }
  check('an unjudged candidate stops the run rather than passing or failing silently',
    stopped.includes('no verdict'), stopped.slice(0, 100) || '(did not stop)');

  // ---- 7. re-running does not double count -------------------------------
  const before = (await readFunnel(runId)).stages.length;
  await pipeline(ctx, 'S1_format', 'S7_draft').invoke(undefined);
  const after = await readFunnel(runId);
  check('a completed stage is skipped on re-run', after.stages.length === before,
    `${before} stage rows before, ${after.stages.length} after`);

  // ---- cleanup -----------------------------------------------------------
  for (const r of [runId, runB]) {
    await prisma.$executeRawUnsafe(`DELETE FROM newsletter_corpus WHERE run_id = '${r}'::uuid`);
    await prisma.$executeRawUnsafe(`DELETE FROM newsletter_pipeline_steps WHERE run_id = '${r}'::uuid`);
    await prisma.$executeRawUnsafe(`DELETE FROM newsletter_pipeline_runs WHERE id = '${r}'::uuid`);
  }
  rmSync(TMP, { recursive: true, force: true });
  await prisma.$disconnect();

  console.log(failures ? `\n=== ${failures} FAILURE(S) ===` : '\n=== all checks passed ===');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
