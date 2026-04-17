/**
 * Video-Discover TC Runner
 * ------------------------
 * Runs a fixed 10-mandala test set (ko5 + en5) via ai-custom generation,
 * measures per-stage timings (BE Server-Timing-equivalent log fields + pipeline
 * step_result.debug), and emits a structured JSON report.
 *
 * Target env is chosen by DATABASE_URL / DIRECT_URL (inline env, CP358).
 *   Dev:  DIRECT_URL=postgresql://...@127.0.0.1:5432/postgres
 *         YOUTUBE_API_KEY_SEARCH=<dev key>
 *         OPENROUTER_API_KEY=<dev key>
 *   Prod: DIRECT_URL=<prod> YOUTUBE_API_KEY_SEARCH=<prod> etc. (when invoked
 *         against prod, every step is SELECT-first; the only write is
 *         mandala creation + pipeline trigger — same as normal wizard flow.)
 *
 * Writes:
 *   - reports/video-discover-tc/<timestamp>-<env_label>.json
 *   - reports/video-discover-tc/<timestamp>-<env_label>.md (human-readable)
 *
 * Usage:
 *   DIRECT_URL="..." \
 *   YOUTUBE_API_KEY_SEARCH="..." \
 *   YOUTUBE_API_KEY_SEARCH_2="..." \
 *   OPENROUTER_API_KEY="..." OPENROUTER_MODEL="..." \
 *   USER_EMAIL=jamesjk4242@gmail.com \
 *   ENV_LABEL=dev|prod \
 *   npx tsx scripts/video-discover-tc/run-tc.ts
 */

import { Client } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMandalaManager } from '@/modules/mandala/manager';
import { generateMandalaWithHaiku } from '@/modules/mandala/generator';
import {
  createPipelineRun,
  executePipelineRun,
} from '@/modules/mandala/pipeline-runner';
import { getPrismaClient } from '@/modules/database/client';

// Minimal mirror of buildSkillConfigRows in src/api/routes/mandalas.ts:87
// (CP357 default: video_discover ON with auto_add). Kept in sync manually.
function buildSkillConfigRows(userId: string, mandalaId: string) {
  return [
    {
      user_id: userId,
      mandala_id: mandalaId,
      skill_type: 'video_discover',
      enabled: true,
      config: { auto_add: true },
    },
  ];
}

interface TestCase {
  title: string;
  goal: string;
  language: 'ko' | 'en';
}

const TEST_SET: TestCase[] = [
  // Korean
  { title: '3개월 내 토익 900 달성', goal: '3개월 내 토익 900 달성', language: 'ko' },
  { title: '6개월 내 개발자 취업', goal: '6개월 내 개발자 취업', language: 'ko' },
  { title: '100일 수능 마무리 1등급', goal: '100일 수능 마무리 1등급', language: 'ko' },
  { title: '3개월 내 10kg 감량 바디프로필', goal: '3개월 내 10kg 감량 바디프로필', language: 'ko' },
  { title: '6개월 내 사이드 프로젝트 월 100만원 수익화', goal: '6개월 내 사이드 프로젝트 월 100만원 수익화', language: 'ko' },
  // English
  { title: '90-Day AI Agent SaaS Launch with $5K MRR', goal: '90-Day AI Agent SaaS Launch with $5K MRR', language: 'en' },
  { title: '6-Month Full-Stack Bootcamp to FAANG Offer', goal: '6-Month Full-Stack Bootcamp to FAANG Offer', language: 'en' },
  { title: '12-Week Half Marathon Sub-2 Hour Finish', goal: '12-Week Half Marathon Sub-2 Hour Finish', language: 'en' },
  { title: '90-Day Solopreneur Newsletter to 10K Subscribers', goal: '90-Day Solopreneur Newsletter to 10K Subscribers', language: 'en' },
  { title: '6-Month Passive Income Portfolio Yielding $2K Monthly', goal: '6-Month Passive Income Portfolio Yielding $2K Monthly', language: 'en' },
];

interface TrialResult {
  caseIdx: number;
  title: string;
  language: 'ko' | 'en';
  mandalaId: string | null;
  timings: {
    aiGenerateMs: number;
    createMandalaMs: number;
    pipelineTotalMs: number;
    step1Ms: number | null;
    step2Ms: number | null;
    step3Ms: number | null;
  };
  pipeline: {
    status: string | null;
    step1Status: string | null;
    step1Result: unknown;
    step2Status: string | null;
    step2Result: unknown;
    step2Error: string | null;
    step3Status: string | null;
    step3Result: unknown;
    step3Error: string | null;
  };
  recCount: number;
  error?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Log-normal jitter (Box-Muller → exp). Median ≈ (min+max)/2, heavy
 * right tail keeps inter-request spacing human-ish and desynchronized
 * across concurrent runners. Prevents burst patterns that YouTube's
 * abuse heuristics flag even below the hard quota.
 */
function jitterMs(minMs = 1500, maxMs = 5000): number {
  const mean = Math.log((minMs + maxMs) / 2);
  const sigma = 0.4;
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1 || 1e-9)) * Math.cos(2 * Math.PI * u2);
  const raw = Math.exp(mean + sigma * z);
  return Math.max(minMs, Math.min(maxMs, Math.round(raw)));
}

/**
 * Rough YouTube quota cost estimate for a TC round. We use these to stop
 * early when the budget is reached, so a round cannot silently consume
 * the full daily quota.
 *   search.list = 100 units, videos.list = 1 unit per 50 ids.
 * v3 Tier 2 uses at most MAX_QUERIES(12) search + 1 videos batch per mandala.
 */
const ESTIMATED_UNITS_PER_MANDALA = 12 * 100 + 1; // 1201

async function main(): Promise<void> {
  const userEmail = process.env.USER_EMAIL ?? 'jamesjk4242@gmail.com';
  const envLabel = process.env.ENV_LABEL ?? 'unknown';
  const dbUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[fatal] DIRECT_URL (or DATABASE_URL) required');
    process.exit(2);
  }
  if (!/:5432/.test(dbUrl)) {
    console.error('[fatal] must run against port 5432 (session mode), not pgbouncer :6543.');
    process.exit(2);
  }
  if (!process.env.YOUTUBE_API_KEY_SEARCH) {
    console.error('[fatal] YOUTUBE_API_KEY_SEARCH env required');
    process.exit(2);
  }

  const pg = new Client({ connectionString: dbUrl });
  await pg.connect();

  const userRow = await pg.query<{ id: string }>(
    `SELECT id FROM auth.users WHERE email = $1 LIMIT 1`,
    [userEmail]
  );
  if (userRow.rowCount === 0) {
    console.error(`[fatal] user not found: ${userEmail}`);
    await pg.end();
    process.exit(2);
  }
  const userId = userRow.rows[0]!.id;
  console.log(`[user] ${userEmail} → ${userId}`);
  console.log(`[env]  ${envLabel}`);
  console.log(`[set]  ${TEST_SET.length} mandalas\n`);

  const results: TrialResult[] = [];
  const totalSleepMsTracker = { value: 0 };
  const consecutiveFailures = { count: 0 };
  const CIRCUIT_BREAK_THRESHOLD = 3;
  const QUOTA_BUDGET_UNITS = parseInt(process.env.YT_QUOTA_BUDGET_UNITS ?? '', 10);
  // Default: stop after ~60% of a single-key daily quota (safety margin).
  // Callers can set YT_QUOTA_BUDGET_UNITS=3000 etc. to be stricter.
  const budget = Number.isFinite(QUOTA_BUDGET_UNITS) && QUOTA_BUDGET_UNITS > 0
    ? QUOTA_BUDGET_UNITS
    : 6000;
  let unitsEstimated = 0;

  for (let i = 0; i < TEST_SET.length; i++) {
    if (unitsEstimated >= budget) {
      console.log(`[stop] estimated units ${unitsEstimated} ≥ budget ${budget} — stopping round early`);
      break;
    }
    if (consecutiveFailures.count >= CIRCUIT_BREAK_THRESHOLD) {
      console.log(`[stop] ${CIRCUIT_BREAK_THRESHOLD} consecutive tier2 failures — circuit breaker tripped`);
      break;
    }
    const tc = TEST_SET[i]!;
    console.log(`[${i + 1}/${TEST_SET.length}] "${tc.title}" (${tc.language})`);
    const result: TrialResult = {
      caseIdx: i,
      title: tc.title,
      language: tc.language,
      mandalaId: null,
      timings: {
        aiGenerateMs: 0,
        createMandalaMs: 0,
        pipelineTotalMs: 0,
        step1Ms: null,
        step2Ms: null,
        step3Ms: null,
      },
      pipeline: {
        status: null,
        step1Status: null,
        step1Result: null,
        step2Status: null,
        step2Result: null,
        step2Error: null,
        step3Status: null,
        step3Result: null,
        step3Error: null,
      },
      recCount: 0,
    };

    try {
      const tAi = Date.now();
      const ai = await generateMandalaWithHaiku({
        goal: tc.goal,
        language: tc.language,
      });
      result.timings.aiGenerateMs = Date.now() - tAi;

      const subjects = ai.sub_goals ?? [];
      if (subjects.length !== 8) throw new Error(`ai returned ${subjects.length} sub_goals`);

      // Build levels mirror create-with-data route
      const levels = [
        {
          levelKey: 'root',
          centerGoal: ai.center_goal ?? tc.goal,
          centerLabel: ai.center_label,
          subjects,
          subjectLabels: ai.sub_labels,
          position: 0,
          depth: 0,
          parentLevelKey: null,
        },
        ...subjects.map((sg, idx) => {
          const actions = ai.actions?.[sg] ?? [];
          const padded = [...actions];
          while (padded.length < 8) padded.push('');
          return {
            levelKey: `sub_${idx}`,
            centerGoal: sg,
            subjects: padded.slice(0, 8),
            position: idx,
            depth: 1,
            parentLevelKey: 'root',
          };
        }),
      ];

      const titleWithSuffix = `${tc.title} [tc-${envLabel}-${Date.now()}]`;
      const tCreate = Date.now();
      const mandala = await getMandalaManager().createMandala(userId, titleWithSuffix, levels);
      result.timings.createMandalaMs = Date.now() - tCreate;
      result.mandalaId = mandala.id;

      // Skill config (video_discover ON default)
      await getPrismaClient().user_skill_config.createMany({
        data: buildSkillConfigRows(userId, mandala.id),
        skipDuplicates: true,
      });

      // Execute pipeline synchronously via runner (not fire-and-forget).
      const tPipe = Date.now();
      const runId = await createPipelineRun(mandala.id, userId, 'tc');
      await executePipelineRun(runId);
      result.timings.pipelineTotalMs = Date.now() - tPipe;

      const runRow = await pg.query<{
        status: string | null;
        step1_status: string | null;
        step1_result: unknown;
        step1_started_at: Date | null;
        step1_ended_at: Date | null;
        step2_status: string | null;
        step2_result: unknown;
        step2_error: string | null;
        step2_started_at: Date | null;
        step2_ended_at: Date | null;
        step3_status: string | null;
        step3_result: unknown;
        step3_error: string | null;
        step3_started_at: Date | null;
        step3_ended_at: Date | null;
      }>(
        `SELECT status, step1_status, step1_result, step1_started_at, step1_ended_at,
                step2_status, step2_result, step2_error, step2_started_at, step2_ended_at,
                step3_status, step3_result, step3_error, step3_started_at, step3_ended_at
         FROM public.mandala_pipeline_runs WHERE id = $1`,
        [runId]
      );
      const r = runRow.rows[0];
      if (r) {
        result.pipeline.status = r.status;
        result.pipeline.step1Status = r.step1_status;
        result.pipeline.step1Result = r.step1_result;
        result.pipeline.step2Status = r.step2_status;
        result.pipeline.step2Result = r.step2_result;
        result.pipeline.step2Error = r.step2_error;
        result.pipeline.step3Status = r.step3_status;
        result.pipeline.step3Result = r.step3_result;
        result.pipeline.step3Error = r.step3_error;
        if (r.step1_started_at && r.step1_ended_at) {
          result.timings.step1Ms = r.step1_ended_at.getTime() - r.step1_started_at.getTime();
        }
        if (r.step2_started_at && r.step2_ended_at) {
          result.timings.step2Ms = r.step2_ended_at.getTime() - r.step2_started_at.getTime();
        }
        if (r.step3_started_at && r.step3_ended_at) {
          result.timings.step3Ms = r.step3_ended_at.getTime() - r.step3_started_at.getTime();
        }
      }

      const recRow = await pg.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.recommendation_cache WHERE mandala_id = $1`,
        [mandala.id]
      );
      result.recCount = parseInt(recRow.rows[0]?.count ?? '0', 10);

      console.log(
        `  ok mandala=${mandala.id.slice(0, 8)} status=${r?.status} rec=${result.recCount} pipe=${result.timings.pipelineTotalMs}ms`
      );

      // Circuit breaker: any step2 that produced 0 recs *and* the pipeline
      // flagged it partial/failed is a sustained-failure candidate. This
      // is what tripped key_1 in the 2026-04-17 prod run — we bail early
      // instead of burning the remaining keys down.
      const s2 = r?.step2_result as { tier2_matches?: number } | null | undefined;
      const tier2Zero = s2 && typeof s2.tier2_matches === 'number' && s2.tier2_matches === 0;
      if (r?.status && r.status !== 'completed' && tier2Zero) {
        consecutiveFailures.count++;
      } else {
        consecutiveFailures.count = 0;
      }

      // Cost bookkeeping — crude upper bound; reflects tier2_queries when
      // present so dedup / early-exit paths are credited accurately.
      const queriesRun =
        (s2 as { tier2_queries?: number } | null | undefined)?.tier2_queries ??
        12; // fallback to MAX_QUERIES
      unitsEstimated += queriesRun * 100 + 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.error = msg;
      console.error(`  fail: ${msg}`);
      consecutiveFailures.count++;
    }
    results.push(result);

    // Log-normal random sleep between mandalas. Purpose:
    //   1. YouTube abuse heuristics penalise perfectly-regular cadences
    //      even below hard quota — spread avoids that signal.
    //   2. Gives Supabase pooler time to release connections between
    //      back-to-back 9-level transactions.
    //   3. `totalSleepMsTracker.value` is subtracted from the round's
    //      wall-clock aggregate in the report (measurement purity).
    if (i < TEST_SET.length - 1) {
      const slept = jitterMs();
      totalSleepMsTracker.value += slept;
      await sleep(slept);
    }
  }

  await pg.end();

  // Write outputs
  const outDir = path.resolve(__dirname, '../../reports/video-discover-tc');
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${ts}-${envLabel}`;
  const meta = {
    envLabel,
    userEmail,
    totalSleepMs: totalSleepMsTracker.value,
    unitsEstimated,
    unitsBudget: budget,
    circuitTripped: consecutiveFailures.count >= CIRCUIT_BREAK_THRESHOLD,
    completedCount: results.length,
    configuredCount: TEST_SET.length,
  };
  const jsonFp = path.join(outDir, `${base}.json`);
  fs.writeFileSync(jsonFp, JSON.stringify({ ...meta, results }, null, 2));
  console.log(`\n[written] ${jsonFp}`);

  const mdFp = path.join(outDir, `${base}.md`);
  const md = formatMarkdown(envLabel, userEmail, results, meta);
  fs.writeFileSync(mdFp, md);
  console.log(`[written] ${mdFp}`);
  console.log(
    `[budget] units≈${unitsEstimated}/${budget}  sleep=${Math.round(totalSleepMsTracker.value / 1000)}s (excluded from timing metrics)`
  );
}

function formatMarkdown(
  envLabel: string,
  userEmail: string,
  results: TrialResult[],
  meta: {
    totalSleepMs: number;
    unitsEstimated: number;
    unitsBudget: number;
    circuitTripped: boolean;
    completedCount: number;
    configuredCount: number;
  }
): string {
  const lines: string[] = [];
  lines.push(`# Video-Discover TC — ${envLabel}`);
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- User: ${userEmail}`);
  lines.push(`- Cases: ${results.length} (configured ${meta.configuredCount})`);
  const ok = results.filter((r) => r.recCount > 0).length;
  lines.push(`- Success (rec > 0): ${ok}/${results.length}`);
  lines.push(`- Units estimated: ${meta.unitsEstimated} / budget ${meta.unitsBudget}`);
  lines.push(
    `- Inter-mandala sleep: ${Math.round(meta.totalSleepMs / 1000)}s (excluded from timing aggregates)`
  );
  if (meta.circuitTripped) {
    lines.push(`- ⚠ Circuit breaker tripped — stopped early`);
  }
  lines.push('');
  lines.push('| # | title | lang | rec | pipe ms | step1 | step2 | step3 | status |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(
      `| ${r.caseIdx + 1} | ${r.title.slice(0, 40)} | ${r.language} | ${r.recCount} | ${r.timings.pipelineTotalMs} | ${r.timings.step1Ms ?? '?'} | ${r.timings.step2Ms ?? '?'} | ${r.timings.step3Ms ?? '?'} | ${r.pipeline.status ?? r.error ?? '?'} |`
    );
  }
  lines.push('');
  lines.push('## Detail');
  for (const r of results) {
    lines.push(`### [${r.caseIdx + 1}] ${r.title}`);
    lines.push('```json');
    lines.push(
      JSON.stringify(
        { timings: r.timings, pipeline: r.pipeline, recCount: r.recCount, error: r.error },
        null,
        2
      )
    );
    lines.push('```');
  }
  return lines.join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
