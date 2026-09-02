/**
 * Does the breaker actually stop the calls?
 *
 * Not a unit test: this runs the real call sites against the real table, with
 * a fetch that counts every HTTP attempt and answers 402 the way OpenRouter
 * did on 2026-09-01. The number that matters is how many times that fetch is
 * reached when the caller asks for a scheduler window's worth of work.
 *
 *   before this change   18 requests -> 18 HTTP calls, 18 x 402
 *   after                18 requests -> 1  HTTP call,  17 refused locally
 *
 * Run: DATABASE_URL=... npx tsx scripts/verify/credit-breaker-probe.ts
 */

import { getPrismaClient } from '@/modules/database/client';
import { judgeTopics, JUDGE_BATCH_SIZE } from '@/modules/curation/topic-judge';
import { extractKeywordsBatch } from '@/skills/plugins/trend-collector/sources/llm-extract';
import { checkProviderCredit, resetCreditStateForTest } from '@/modules/llm/cost-gate';

const prisma = getPrismaClient();

/** OpenRouter's answer while the account is empty, verbatim from the ledger. */
function response402(): Response {
  return new Response(JSON.stringify({ error: { message: 'requires more credits', code: 402 } }), {
    status: 402,
    headers: { 'content-type': 'application/json' },
  });
}

let httpCalls = 0;
const countingFetch = (async () => {
  httpCalls += 1;
  return response402();
}) as unknown as typeof fetch;

/** Let the ledger writer's fire-and-forget path land before measuring. */
const settle = () => new Promise((r) => setTimeout(r, 300));

async function clearState() {
  await settle();
  await prisma.$executeRaw`DELETE FROM llm_provider_credit_state`;
  resetCreditStateForTest();
}

async function stateRow() {
  const rows = await prisma.$queryRaw<
    { provider: string; hits: number; last_module: string | null; cleared_at: Date | null }[]
  >`SELECT provider, hits, last_module, cleared_at FROM llm_provider_credit_state`;
  return rows;
}

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log('=== credit breaker, against the real table ===\n');

  // ---- 1. topic-judge: the 5-call half of the daily burst -----------------
  await clearState();
  httpCalls = 0;
  // Five batches, which is what the 09-01 bursts actually were (topic-judge
  // n=5). An earlier draft used 25 keywords and divided by five to name the
  // batch count; JUDGE_BATCH_SIZE is 100, so that was one batch and the check
  // passed whether or not the breaker did anything.
  const batches = 5;
  const keywords = Array.from(
    { length: JUDGE_BATCH_SIZE * batches },
    (_, i) => `keyword-${i}`
  );
  const verdicts = await judgeTopics(keywords, countingFetch, 'probe-key');
  check(
    'topic-judge stops after the first refusal',
    httpCalls === 1,
    `${batches} batches requested (${keywords.length} keywords / ${JUDGE_BATCH_SIZE}) ` +
      `-> ${httpCalls} HTTP call(s)`
  );
  check(
    'topic-judge still returns a verdict for every keyword (degraded, not empty)',
    verdicts.length === keywords.length && verdicts.every((v) => v.degraded),
    `${verdicts.length}/${keywords.length} verdicts, all marked degraded`
  );

  // ---- 2. trend-extract: the 13-call half ---------------------------------
  await clearState();
  httpCalls = 0;
  const titles = Array.from({ length: 130 }, (_, i) => `title ${i}`);
  // Field names read from ExtractKeywordsOptions, not guessed: an earlier
  // draft of this probe passed `fetchFn`/`apiKey`, which the interface does
  // not have, so the injection silently did nothing and the real global fetch
  // went to the network. The assertion below fails loudly if that recurs.
  await extractKeywordsBatch({
    titles,
    provider: 'openrouter',
    openRouterApiKey: 'probe-key',
    fetchImpl: countingFetch,
  }).catch(() => undefined);
  check(
    'trend-extract stops after the first refusal',
    httpCalls === 1,
    `${Math.ceil(titles.length / 5)} chunks requested -> ${httpCalls} HTTP call(s)` +
      (httpCalls === 0 ? '  <-- ZERO means the injected fetch was not used at all' : '')
  );

  // ---- 3. the state is in the table, not in this process -------------------
  await settle();
  const rows = await stateRow();
  check(
    'the refusal is recorded where every pod can see it',
    rows.length === 1 && rows[0]?.provider === 'openrouter' && rows[0]?.cleared_at === null,
    JSON.stringify(rows)
  );

  // ---- 4. a fresh process reads the same answer ---------------------------
  resetCreditStateForTest(); // simulates a pod restart / the second pod
  const cold = await checkProviderCredit('openrouter/anything');
  check(
    'a restarted pod is refused too, without a round trip',
    cold.allowed === false,
    `allowed=${cold.allowed} hits=${cold.hits}`
  );

  // ---- 5. the probe is what lets it recover -------------------------------
  await prisma.$executeRaw`UPDATE llm_provider_credit_state SET next_probe_at = now() - interval '1 minute'`;
  resetCreditStateForTest();
  const probe = await checkProviderCredit('openrouter/anything');
  check('one call is let through to test for recovery', probe.allowed === true && probe.isProbe === true,
    `allowed=${probe.allowed} isProbe=${probe.isProbe}`);

  resetCreditStateForTest();
  const afterProbe = await checkProviderCredit('openrouter/anything');
  check(
    'the next caller does not also get a probe',
    afterProbe.allowed === false,
    `allowed=${afterProbe.allowed}`
  );

  // ---- 6. a real success closes it ----------------------------------------
  httpCalls = 0;
  const okFetch = (async () => {
    httpCalls += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '[{"k":"kubernetes","safe":true,"learnable":true}]' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  await prisma.$executeRaw`UPDATE llm_provider_credit_state SET next_probe_at = now() - interval '1 minute'`;
  resetCreditStateForTest();
  await judgeTopics(['kubernetes'], okFetch, 'probe-key');
  await settle();
  const after = await stateRow();
  check(
    'a successful call closes the breaker',
    after.length === 0 || after[0]?.cleared_at !== null,
    JSON.stringify(after)
  );

  const reopened = await checkProviderCredit('openrouter/anything');
  check('and calls flow again', reopened.allowed === true, `allowed=${reopened.allowed}`);

  await clearState();
  await prisma.$disconnect();
  console.log(process.exitCode ? '\n=== FAILURES ABOVE ===' : '\n=== all checks passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
