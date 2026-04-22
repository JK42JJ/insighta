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

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { generateMandalaActions } from './generator';

const log = logger.child({ module: 'fill-missing-actions' });

const EXPECTED_ACTIONS_PER_CELL = 8;
const MIN_ACTIONS_TO_CONSIDER_FILLED = 8;

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

  const levels = await db.user_mandala_levels.findMany({
    where: { mandala_id: mandalaId, depth: 1 },
    orderBy: { position: 'asc' },
    select: { id: true, center_goal: true, subjects: true, position: true },
  });

  const rootLevel = await db.user_mandala_levels.findFirst({
    where: { mandala_id: mandalaId, depth: 0 },
    select: { center_goal: true },
  });
  if (!rootLevel) {
    log.warn(`fill-missing-actions: root level missing for mandala=${mandalaId}`);
    return { ok: false, action: 'skipped-not-found' };
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

  log.info(`[${mandalaId}] generating actions for ${needsFill.length}/${levels.length} cells`);

  let actions: Record<string, string[]>;
  try {
    actions = await generateMandalaActions(
      subGoals,
      language,
      rootLevel.center_goal ?? '',
      focusTags,
      targetLevel
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[${mandalaId}] generateMandalaActions threw: ${msg}`);
    return { ok: false, action: 'failed', reason: msg };
  }

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
