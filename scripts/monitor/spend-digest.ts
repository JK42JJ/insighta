/**
 * Daily spend digest — where the money went, by model and by stage.
 *
 *   npx tsx scripts/monitor/spend-digest.ts
 *
 * Deliberately separate from the spend *alarm* in `checks.ts`. The alarm says
 * "you are approaching a ceiling" and fires on a transition; this is a report
 * and arrives once a day. Merging them would mean receiving a table every
 * hour, and a table that arrives every hour is not read.
 *
 * `llm_call_logs` already carries every dimension this needs, indexed on
 * `model` and `module`. Nothing was added to the schema for this.
 *
 * The `module` column is only trustworthy from 2026-09-04, when `purpose`
 * became required on the provider call. Before that, thirty-four call sites
 * set it five times and 45,476 calls collapsed onto the single label
 * `openrouter`. A stage breakdown covering earlier data would be fiction.
 */

import { getPrisma, postDigest } from './lib';

interface Row {
  key: string;
  calls: bigint;
  cost: number;
  in_tok: bigint | null;
  cached_tok: bigint | null;
  out_tok: bigint | null;
  p95_ms: number | null;
}

const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/** Right-pad to a fixed width so the Slack code block lines up. Slack renders
 *  triple-backtick blocks in a monospace face, so columns hold. */
function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function padStart(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function table(rows: Row[], label: string): string {
  if (rows.length === 0) return `${label}: (없음)`;
  const head =
    pad(label, 34) + padStart('calls', 7) + padStart('cost', 10) + padStart('cache', 7) + padStart('p95', 8);
  const body = rows.map((r) => {
    const inTok = Number(r.in_tok ?? 0);
    const cached = Number(r.cached_tok ?? 0);
    // NULL and 0 are different facts: no cache support versus a cache miss.
    // A dash says "the provider reported nothing", which is not 0%.
    const cacheCol = r.cached_tok === null ? '—' : inTok > 0 ? `${Math.round((cached / inTok) * 100)}%` : '0%';
    return (
      pad(r.key, 34) +
      padStart(String(r.calls), 7) +
      padStart(money(r.cost), 10) +
      padStart(cacheCol, 7) +
      padStart(r.p95_ms === null ? '—' : `${Math.round(r.p95_ms)}ms`, 8)
    );
  });
  return [head, ...body].join('\n');
}

async function main(): Promise<void> {
  const prisma = getPrisma();

  const byModel = await prisma.$queryRaw<Row[]>`
    SELECT model AS key,
           COUNT(*) AS calls,
           COALESCE(SUM(cost_usd), 0)::float AS cost,
           SUM(input_tokens) AS in_tok,
           SUM(cached_input_tokens) AS cached_tok,
           SUM(output_tokens) AS out_tok,
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::float AS p95_ms
      FROM llm_call_logs
     WHERE created_at >= CURRENT_DATE - INTERVAL '1 day' AND status = 'success'
     GROUP BY model
     ORDER BY cost DESC
  `;

  const byModule = await prisma.$queryRaw<Row[]>`
    SELECT module AS key,
           COUNT(*) AS calls,
           COALESCE(SUM(cost_usd), 0)::float AS cost,
           SUM(input_tokens) AS in_tok,
           SUM(cached_input_tokens) AS cached_tok,
           SUM(output_tokens) AS out_tok,
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::float AS p95_ms
      FROM llm_call_logs
     WHERE created_at >= CURRENT_DATE - INTERVAL '1 day' AND status = 'success'
     GROUP BY module
     ORDER BY cost DESC
  `;

  // Money spent on calls that did not succeed. Retry waste hides here, and it
  // is invisible in every total that filters on status = 'success'.
  const wasted = await prisma.$queryRaw<Array<{ calls: bigint; cost: number }>>`
    SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0)::float AS cost
      FROM llm_call_logs
     WHERE created_at >= CURRENT_DATE - INTERVAL '1 day' AND status <> 'success'
  `;

  const totals = await prisma.$queryRaw<Array<{ day: number; month: number }>>`
    SELECT COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '1 day'), 0)::float AS day,
           COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)), 0)::float AS month
      FROM llm_call_logs
     WHERE status = 'success'
  `;

  const day = totals[0]?.day ?? 0;
  const month = totals[0]?.month ?? 0;
  const monthlyLimit = Number(process.env['LLM_MONTHLY_COST_LIMIT_USD'] ?? 50);
  const failed = wasted[0];

  const lines = [
    `*LLM 지출 · 최근 24시간*`,
    `총 ${money(day)} · 이번 달 ${money(month)} / ${money(monthlyLimit)}` +
      ` (${Math.round((month / monthlyLimit) * 100)}%)`,
    '',
    '```',
    table(byModel, '모델'),
    '',
    table(byModule, '단계'),
    '```',
  ];

  if (failed && Number(failed.calls) > 0) {
    lines.push(`⚠️ 실패한 호출 ${failed.calls}건에 ${money(failed.cost)} — 재시도 낭비`);
  }

  await postDigest(lines.join('\n'));
  await prisma.$disconnect();
}

void main();
