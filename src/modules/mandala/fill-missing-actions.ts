/**
 * fill-missing-actions.ts — Phase 1 (2026-04-22)
 *
 * Runs in parallel with the main post-creation pipeline for mandalas
 * that were saved with empty `subjects` on their sub-goal levels. This
 * is the expected state after the wizard-stream previewOnly path (~3s
 * structure-only) swap — actions are no longer shipped inside the
 * wizard response, so they are generated here asynchronously and
 * written back to `user_mandala_levels.subjects` when done.
 *
 * Contract:
 *  - Fire-and-forget. Never throws. All errors logged + swallowed.
 *  - Idempotent. Re-running on a fully-filled mandala is a no-op.
 *  - Tolerant. Partial progress is fine — each depth=1 level updates
 *    independently. A crash mid-batch leaves partially-filled rows
 *    rather than a half-committed transaction.
 *  - Non-blocking on the pipeline. Starts alongside `executePipelineRun`
 *    rather than as a step, because the wizard → card path doesn't
 *    depend on actions existing.
 */

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
// `generateMandalaActions` kept imported for the commented-out Haiku
// fallback revive path below (CP416 policy). Silence unused-import lint.
import { generateMandala, generateMandalaActions as _generateMandalaActions } from './generator';
void _generateMandalaActions;

const log = logger.child({ module: 'fill-missing-actions' });

const EXPECTED_SUB_GOAL_COUNT = 8;
const EXPECTED_ACTIONS_PER_CELL = 8;
const MIN_ACTIONS_TO_CONSIDER_FILLED = 8;

/**
 * Minimum action-uniqueness rate for a LoRA output to be accepted.
 * LoRA's known failure mode is repetition ("학습하기, 학습하기, ...")
 * — unique-rate below this suggests that mode and we fall back to the
 * OpenRouter Haiku path. Picked conservatively; tune after telemetry.
 */
const MIN_ACTION_UNIQUE_RATE = 0.7;

function computeActionUniqueRate(actions: Record<string, string[]>): number {
  const all: string[] = [];
  for (const arr of Object.values(actions)) {
    if (Array.isArray(arr)) {
      for (const a of arr) all.push(a.trim().toLowerCase());
    }
  }
  if (all.length === 0) return 0;
  return new Set(all).size / all.length;
}

/**
 * Read depth=1 rows, detect ones with empty / partial subjects, call
 * `generateMandalaActions`, update each row's `subjects` in place.
 *
 * Returns a small summary for observability. Never throws.
 */
export async function fillMissingActionsIfNeeded(mandalaId: string): Promise<{
  ok: boolean;
  action: 'skipped-full' | 'filled' | 'skipped-not-found' | 'failed';
  cellsFilled?: number;
  reason?: string;
}> {
  const db = getPrismaClient();

  const mandala = await db.user_mandalas.findUnique({
    where: { id: mandalaId },
    select: { id: true, language: true, focus_tags: true, target_level: true },
  });
  if (!mandala) {
    log.warn(`fill-missing-actions: mandala not found: ${mandalaId}`);
    return { ok: false, action: 'skipped-not-found' };
  }

  let levels = await db.user_mandala_levels.findMany({
    where: { mandala_id: mandalaId, depth: 1 },
    orderBy: { position: 'asc' },
    select: { id: true, center_goal: true, subjects: true, position: true },
  });

  const rootLevel = await db.user_mandala_levels.findFirst({
    where: { mandala_id: mandalaId, depth: 0 },
    select: { id: true, center_goal: true, subjects: true },
  });
  if (!rootLevel) {
    log.warn(`fill-missing-actions: root level missing for mandala=${mandalaId}`);
    return { ok: false, action: 'skipped-not-found' };
  }

  // Recovery path: legacy mandalas created before the `/create-with-data`
  // depth=1 scaffold fix have depth=0 only. Scaffold 8 empty depth=1 rows
  // from root.subjects so the fill can proceed. Safe on first write — all
  // rows arrive together via createMany; schema validation enforces unique
  // (mandala_id, depth, position). If a concurrent writer inserted rows
  // between read and write, the createMany will fail and the caller's
  // next poll will see the now-populated levels.
  if (levels.length === 0) {
    const rootSubjects = Array.isArray(rootLevel.subjects)
      ? rootLevel.subjects.filter((s): s is string => typeof s === 'string')
      : [];
    if (rootSubjects.length < EXPECTED_SUB_GOAL_COUNT) {
      log.warn(
        `fill-missing-actions: root has ${rootSubjects.length}/${EXPECTED_SUB_GOAL_COUNT} subjects — cannot scaffold depth=1 for mandala=${mandalaId}`
      );
      return { ok: false, action: 'skipped-not-found', reason: 'root has < 8 subjects' };
    }
    log.info(
      `fill-missing-actions: scaffolding ${EXPECTED_SUB_GOAL_COUNT} depth=1 rows for legacy mandala=${mandalaId}`
    );
    const scaffoldData = rootSubjects.slice(0, EXPECTED_SUB_GOAL_COUNT).map((subject, idx) => ({
      id: randomUUID(),
      mandala_id: mandalaId,
      parent_level_id: rootLevel.id,
      level_key: `sub_${idx}`,
      center_goal: subject,
      subjects: [] as string[],
      position: idx,
      depth: 1,
    }));
    try {
      await db.user_mandala_levels.createMany({ data: scaffoldData });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`fill-missing-actions: scaffold createMany failed for ${mandalaId}: ${msg}`);
      return { ok: false, action: 'failed', reason: `scaffold failed: ${msg}` };
    }
    levels = await db.user_mandala_levels.findMany({
      where: { mandala_id: mandalaId, depth: 1 },
      orderBy: { position: 'asc' },
      select: { id: true, center_goal: true, subjects: true, position: true },
    });
  }

  const needsFill = levels.filter(
    (lvl) => !Array.isArray(lvl.subjects) || lvl.subjects.length < MIN_ACTIONS_TO_CONSIDER_FILLED
  );
  if (needsFill.length === 0) {
    return { ok: true, action: 'skipped-full' };
  }

  const subGoals = levels.map((l) => l.center_goal ?? '');
  const language = (mandala.language as 'ko' | 'en' | null) ?? 'ko';
  const focusTags = Array.isArray(mandala.focus_tags) ? mandala.focus_tags : undefined;
  const targetLevel = mandala.target_level ?? undefined;

  log.info(
    `[${mandalaId}] generating actions for ${needsFill.length}/${levels.length} cells (LoRA-only policy, CP416)`
  );

  // Policy (CP416 user directive, 2026-04-22): **LoRA-first, 100% target.**
  //   - Mac Mini LoRA (`generateMandala`) handles action generation alone.
  //   - OpenRouter Haiku fallback is kept in source for emergency revival
  //     but NOT called at runtime (cost concern).
  //   - Every LoRA failure is logged to `generation_log` so failure cases
  //     become retraining data for the next LoRA fine-tune.
  //     See `memory/project_lora_first_policy.md` +
  //     `memory/feedback_lora_failure_as_training_data.md`.
  //
  // Revive Haiku ONLY after explicit user approval (cost sign-off). When
  // reviving, uncomment the `haiku-fallback` block below and the export of
  // `generateMandalaActions` from this module's imports.
  let actions: Record<string, string[]> | null = null;
  const centerGoal = rootLevel.center_goal ?? '';
  let loraErrorForCaller: string | null = null;

  const loraStart = Date.now();
  let loraRawOutput: Record<string, unknown> | null = null;
  let loraFailureReason: string | null = null;

  try {
    const loraMandala = await generateMandala({
      goal: centerGoal,
      language,
      focusTags,
      targetLevel,
    });
    loraRawOutput = loraMandala as unknown as Record<string, unknown>;
    const loraActions = loraMandala?.actions ?? {};
    const totalActions = Object.values(loraActions).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
      0
    );
    const uniqueRate = computeActionUniqueRate(loraActions);
    const loraMs = Date.now() - loraStart;
    const expectedTotal = EXPECTED_SUB_GOAL_COUNT * EXPECTED_ACTIONS_PER_CELL;

    if (totalActions < expectedTotal) {
      loraFailureReason = `incomplete-actions: ${totalActions}/${expectedTotal}`;
      log.warn(`[${mandalaId}] LoRA ${loraFailureReason} (ms=${loraMs})`);
    } else if (uniqueRate < MIN_ACTION_UNIQUE_RATE) {
      loraFailureReason = `repetition-mode: unique-rate ${uniqueRate.toFixed(2)} < ${MIN_ACTION_UNIQUE_RATE}`;
      log.warn(`[${mandalaId}] LoRA ${loraFailureReason} (ms=${loraMs})`);
    } else {
      actions = loraActions;
      log.info(
        `[${mandalaId}] LoRA accepted: ${totalActions} actions, unique-rate ${uniqueRate.toFixed(2)}, ms=${loraMs}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loraFailureReason = `throw: ${msg}`;
    log.warn(`[${mandalaId}] LoRA threw: ${msg}`);
  }

  // Persist failure case for retraining. Fire-and-forget — never blocks
  // the fill path. `generation_log` has the columns we need (lora_output /
  // lora_error / lora_duration_ms / lora_sub_goals / lora_actions_total /
  // lora_action_unique_rate). raw_prompt / raw_response_text are a CP417
  // schema extension candidate.
  if (loraFailureReason) {
    const loraMs = Date.now() - loraStart;
    void (async () => {
      try {
        // Type-narrowed projections from the raw LoRA output so Prisma's
        // typed `.create` data accepts the values.
        const subGoalsLen: number | null = Array.isArray(loraRawOutput?.['sub_goals'])
          ? (loraRawOutput['sub_goals'] as unknown[]).length
          : null;
        let actionsTotal: number | null = null;
        if (loraRawOutput?.['actions'] && typeof loraRawOutput['actions'] === 'object') {
          const actionsObj = loraRawOutput['actions'] as Record<string, unknown>;
          actionsTotal = Object.values(actionsObj).reduce<number>(
            (sum, v) => sum + (Array.isArray(v) ? v.length : 0),
            0
          );
        }
        const uniqueRateLog = loraRawOutput?.['actions']
          ? computeActionUniqueRate(loraRawOutput['actions'] as Record<string, string[]>)
          : null;

        await db.generation_log.create({
          data: {
            user_id: null,
            goal: centerGoal.slice(0, 500),
            domain: null,
            language,
            lora_won: false,
            source_returned: 'failed',
            ...(loraRawOutput != null
              ? { lora_output: loraRawOutput as Prisma.InputJsonValue }
              : {}),
            lora_duration_ms: loraMs,
            lora_valid: false,
            lora_sub_goals: subGoalsLen,
            lora_actions_total: actionsTotal,
            lora_action_unique_rate: uniqueRateLog,
            // `[mandala=<uuid>]` prefix is load-bearing — `scripts/retry-action-fill.ts`
            // does NOT parse this (it scans user_mandala_levels directly), but
            // ops scripts / admin queries grep this token to correlate failures
            // with specific mandalas. Keep the exact format.
            lora_error: `[mandala=${mandalaId}] ${loraFailureReason}`.slice(0, 2000),
            llm_duration_ms: null,
            llm_error: null,
          },
        });
        log.info(
          `[${mandalaId}] LoRA failure logged to generation_log (reason=${loraFailureReason.slice(0, 60)})`
        );
      } catch (logErr) {
        const msg = logErr instanceof Error ? logErr.message : String(logErr);
        log.warn(`[${mandalaId}] generation_log insert failed: ${msg}`);
      }
    })();
  }

  // Haiku fallback — disabled by CP416 policy (cost). Revive condition:
  // explicit user approval after a LoRA outage that exceeds acceptable
  // action-fill downtime. To revive:
  //   1. Uncomment the block below.
  //   2. Ensure `generateMandalaActions` stays imported from ./generator.
  //   3. Add a log line `actions source=haiku-fallback` so the revive is
  //      observable in prod logs.
  /* if (!actions) {
    try {
      actions = await generateMandalaActions(
        subGoals,
        language,
        centerGoal,
        focusTags,
        targetLevel
      );
      log.info(`[${mandalaId}] actions source=haiku-fallback (REVIVED)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[${mandalaId}] Haiku fallback also threw: ${msg}`);
      return { ok: false, action: 'failed', reason: `lora+haiku both failed: ${msg}` };
    }
  } */

  if (!actions) {
    loraErrorForCaller = loraFailureReason ?? 'lora returned null';
    return {
      ok: false,
      action: 'failed',
      reason: `lora-only policy; lora failed: ${loraErrorForCaller}`,
    };
  }

  log.info(`[${mandalaId}] actions source=lora`);

  // Update each depth=1 level's subjects. Key layout from the prompt is
  // `sub_goal_1`..`sub_goal_8`; fall back to index-keyed lookups per the
  // tolerant reader in `useWizard.selectGeneratedMandala`.
  let cellsFilled = 0;
  for (const level of levels) {
    const idx = level.position;
    const keyA = `sub_goal_${idx + 1}`;
    const keyB = String(idx);
    const keyC = subGoals[idx] ?? '';
    const next = actions[keyA] ?? actions[keyB] ?? actions[keyC] ?? null;
    if (!Array.isArray(next) || next.length === 0) continue;
    if (Array.isArray(level.subjects) && level.subjects.length >= MIN_ACTIONS_TO_CONSIDER_FILLED) {
      // Already filled. Don't overwrite user edits.
      continue;
    }
    try {
      await db.user_mandala_levels.update({
        where: { id: level.id },
        data: { subjects: next.slice(0, EXPECTED_ACTIONS_PER_CELL) },
      });
      cellsFilled += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[${mandalaId}] cell ${idx} update failed: ${msg}`);
      // Continue with the next cell — partial fill is fine.
    }
  }

  log.info(`[${mandalaId}] actions fill complete: ${cellsFilled}/${levels.length} cells`);
  return { ok: true, action: 'filled', cellsFilled };
}
