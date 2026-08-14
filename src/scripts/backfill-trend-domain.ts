/**
 * Backfill `trend_signals.domain` from the nine-domain taxonomy (P3).
 *
 * The column has been NULL on every row since the table was created, which left
 * MAX_PER_DOMAIN — the filter-bubble guard in the suggester — with nothing to
 * count, and makes domain-keyed collection impossible to write at all.
 *
 * Derived, not authored: `domain` is a function of `keyword`, so re-running is
 * safe and a taxonomy change is re-applied by running it again. Nothing else on
 * the row is touched.
 *
 *   npx tsx src/scripts/backfill-trend-domain.ts            # dry run, prints the plan
 *   npx tsx src/scripts/backfill-trend-domain.ts --apply    # writes
 *   npx tsx src/scripts/backfill-trend-domain.ts --apply --only-null
 */
import { getPrismaClient } from '@/modules/database';
import { mapKeywordToDomain, CURATION_DOMAINS } from '@/modules/curation/domain-taxonomy';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'scripts/backfill-trend-domain' });

/** Rows per UPDATE batch — small enough that a long run stays interruptible. */
const BATCH = 500;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const onlyNull = process.argv.includes('--only-null');
  const prisma = getPrismaClient();

  const rows = await prisma.trend_signals.findMany({
    where: onlyNull ? { domain: null } : {},
    select: { id: true, keyword: true, domain: true },
  });

  const planned = rows
    .map((r) => ({ id: r.id, from: r.domain, to: mapKeywordToDomain(r.keyword) }))
    .filter((r) => r.from !== r.to);

  const tally: Record<string, number> = Object.fromEntries(CURATION_DOMAINS.map((d) => [d, 0]));
  for (const r of planned) tally[r.to] = (tally[r.to] ?? 0) + 1;

  console.log(`scanned ${rows.length} rows, ${planned.length} would change\n`);
  for (const d of CURATION_DOMAINS) {
    const n = tally[d] ?? 0;
    const pct = planned.length ? ((100 * n) / planned.length).toFixed(1) : '0.0';
    console.log(`  ${d.padEnd(11)} ${String(n).padStart(6)}  ${pct.padStart(5)}%`);
  }

  if (!apply) {
    console.log('\ndry run — pass --apply to write');
    await prisma.$disconnect();
    return;
  }

  // Grouped by target domain so each batch is one UPDATE ... WHERE id IN (...),
  // rather than a statement per row.
  const byDomain = new Map<string, string[]>();
  for (const r of planned) {
    const list = byDomain.get(r.to) ?? [];
    list.push(r.id);
    byDomain.set(r.to, list);
  }

  let written = 0;
  for (const [domain, ids] of byDomain) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const res = await prisma.trend_signals.updateMany({
        where: { id: { in: slice } },
        data: { domain },
      });
      written += res.count;
    }
    log.info('backfill-trend-domain: domain written', { domain, rows: ids.length });
  }

  console.log(`\nwrote ${written} rows`);
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  log.error('backfill-trend-domain failed', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
