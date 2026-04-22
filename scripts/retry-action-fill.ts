/**
 * retry-action-fill — re-run fill-missing-actions for one or many mandalas
 *
 * CP416 user directive (2026-04-22): LoRA 실패 기록을 남기고 재처리 가능해야 함.
 * This script provides the re-processing path.
 *
 * Usage:
 *   # Retry a single mandala (e.g. known orphan from generation_log)
 *   npx tsx scripts/retry-action-fill.ts <mandala-id>
 *
 *   # Retry all mandalas whose depth=1 rows have incomplete subjects
 *   npx tsx scripts/retry-action-fill.ts --all
 *
 *   # Dry run — list candidates without calling LoRA
 *   npx tsx scripts/retry-action-fill.ts --all --dry-run
 *
 * Failure candidates are the mandalas that still have fewer than 8
 * subjects on any depth=1 row. The fill function is idempotent: cells
 * already at length 8 are not overwritten (preserves user edits).
 *
 * On prod the script runs inside the api container:
 *   ssh insighta-ec2 "docker exec insighta-api npx tsx scripts/retry-action-fill.ts --all"
 */

import { getPrismaClient } from '../src/modules/database';
import { fillMissingActionsIfNeeded } from '../src/modules/mandala/fill-missing-actions';

const MIN_ACTIONS_PER_CELL = 8;

interface RunResult {
  mandalaId: string;
  result: Awaited<ReturnType<typeof fillMissingActionsIfNeeded>>;
}

async function listFailureCandidates(): Promise<string[]> {
  const db = getPrismaClient();
  // A mandala needs retry if any depth=1 row has fewer than 8 subjects.
  // Covers orphans (no depth=1 rows → scaffold path triggers) AND partial
  // fills (some cells subjects=[], 4, etc.).
  const rows = await db.$queryRaw<Array<{ mandala_id: string }>>`
    SELECT DISTINCT m.id AS mandala_id
    FROM user_mandalas m
    LEFT JOIN user_mandala_levels l
      ON l.mandala_id = m.id AND l.depth = 1
    WHERE l.id IS NULL
       OR COALESCE(array_length(l.subjects, 1), 0) < ${MIN_ACTIONS_PER_CELL}
    ORDER BY m.id
  `;
  return rows.map((r) => r.mandala_id);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');
  const positional = args.find((a) => !a.startsWith('--'));

  let targets: string[];
  if (all) {
    targets = await listFailureCandidates();
    console.log(`[retry-action-fill] ${targets.length} mandalas with incomplete actions`);
  } else if (positional) {
    targets = [positional];
  } else {
    console.error('usage: retry-action-fill <mandala-id> | --all [--dry-run]');
    process.exit(1);
  }

  if (dryRun) {
    for (const id of targets) console.log(id);
    return;
  }

  const results: RunResult[] = [];
  for (const mandalaId of targets) {
    const t0 = Date.now();
    try {
      const result = await fillMissingActionsIfNeeded(mandalaId);
      const ms = Date.now() - t0;
      console.log(
        `[retry-action-fill] ${mandalaId} -> ${result.action} ` +
          `(cellsFilled=${result.cellsFilled ?? 0}, ms=${ms}${result.reason ? `, reason=${result.reason}` : ''})`
      );
      results.push({ mandalaId, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[retry-action-fill] ${mandalaId} -> ERROR: ${msg}`);
      results.push({
        mandalaId,
        result: { ok: false, action: 'failed', reason: msg },
      });
    }
  }

  const filled = results.filter((r) => r.result.action === 'filled').length;
  const skipped = results.filter((r) => r.result.action === 'skipped-full').length;
  const failed = results.filter((r) => r.result.action === 'failed').length;
  const notFound = results.filter((r) => r.result.action === 'skipped-not-found').length;
  console.log('---');
  console.log(
    `summary: filled=${filled} skipped-full=${skipped} failed=${failed} skipped-not-found=${notFound} total=${results.length}`
  );
  if (failed > 0) process.exitCode = 2;
}

main()
  .catch((err) => {
    console.error('[retry-action-fill] fatal:', err);
    process.exit(1);
  })
  .finally(() => {
    // Best-effort disconnect so the script exits cleanly
    const db = getPrismaClient();
    void db.$disconnect().catch(() => {});
  });
