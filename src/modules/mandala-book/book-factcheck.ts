// §4.5.1 loop-2-A Factcheck-GPT-style fact verification for chapter bodies (CP504).
//
// Pipeline: selectCheckWorthy → (per claim) CSE search + Haiku stance → verdict → correction.
// Creation boundary ([P-3A-NARRATIVE-EXEMPT]): only sentences with hasSource===true (atom/ref
// backed fact claims) enter the verification queue. Narrative/connective sentences are exempt —
// they carry no external fact to verify and would produce false positives.
//
// Service module — OpenRouter Haiku and CSE are PRODUCTION calls. Unit tests MUST mock both.
// CC MUST NOT execute them (LLM-API ban).

import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { logger } from '@/utils/logger';
import type { CseSearchResult } from '@/modules/google-cse/client';

const log = logger.child({ module: 'mandala-book/book-factcheck' });

// Haiku: fast, cost-effective Korean scorer — DeepSeek disqualified (P-3A-MODEL).
const HAIKU_MODEL = 'anthropic/claude-haiku-4.5';
const MAX_TOKENS = 1024;
// One retry per claim on transient provider error.
const VERIFY_ATTEMPTS = 2;
const TEMPERATURE = 0.1; // near-deterministic for fact verdicts

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A sentence from a chapter body, tagged by whether it carries an atom reference. */
export interface FactSentence {
  text: string;
  /** true = sentence is backed by an atom_idx/reference (fact claim); false = narrative/connective. */
  hasSource: boolean;
}

/** Factcheck verdict per sentence. */
export type Verdict = 'TRUE' | 'SUBSTANTIALLY_TRUE' | 'FALSE' | 'MISLEADING' | 'UNVERIFIABLE';

/** Result for one checked sentence. */
export interface CheckResult {
  sentence: string;
  verdict: Verdict;
  /** Supporting evidence URL (required for FALSE/MISLEADING corrections). */
  evidenceUrl?: string;
  /** Corrected wording (only for FALSE/MISLEADING, evidence-grounded). */
  correction?: string;
}

export type FactcheckResult = { ok: true; results: CheckResult[] } | { ok: false; reason: string };

// CSE client interface (minimal — matches createGoogleCseClient return shape).
interface CseClient {
  searchWeb(query: string, opts?: { num?: number }): Promise<CseSearchResult>;
}

// Internal shape expected from Haiku JSON.
interface LlmCheckItem {
  sentence?: unknown;
  verdict?: unknown;
  evidenceUrl?: unknown;
  correction?: unknown;
}

// ---------------------------------------------------------------------------
// Stage 1 — check-worthiness gate (pure, exported for tests)
// ---------------------------------------------------------------------------

/**
 * Filter sentences to only those that are check-worthy:
 * fact claims with a source reference (hasSource===true).
 * Narrative/connective/opinion sentences (hasSource===false) are ALWAYS excluded.
 * Pure function — no side effects, heavily tested ([P-3A-NARRATIVE-EXEMPT]).
 */
export function selectCheckWorthy(sentences: FactSentence[]): FactSentence[] {
  return sentences.filter((s) => s.hasSource === true);
}

// ---------------------------------------------------------------------------
// Prompt builder (exported for inspection in tests)
// ---------------------------------------------------------------------------

/**
 * Build the Haiku verification prompt for a batch of claim sentences + CSE evidence.
 * Instructs Haiku to assign one of 5 verdicts and produce style-preserving corrections
 * only for FALSE/MISLEADING — evidence-grounded (carrying evidenceUrl).
 */
export function buildFactcheckPrompt(
  claims: Array<{ sentence: string; evidenceSnippets: Array<{ url: string; snippet: string }> }>
): string {
  const claimBlocks = claims.map((c, i) => {
    const ev = c.evidenceSnippets
      .map((e, j) => `  [ev${j}] url="${e.url}" snippet="${e.snippet}"`)
      .join('\n');
    return `[${i}] claim: "${c.sentence}"\nevidence:\n${ev || '  (none)'}`;
  });

  return [
    '당신은 팩트체크 전문가다. 아래 각 CLAIM을 주어진 evidence 기반으로 검증하라.',
    '',
    '판정 기준:',
    '- TRUE: evidence가 claim을 직접 지지',
    '- SUBSTANTIALLY_TRUE: 대체로 맞으나 세부 수치/표현 일부 부정확',
    '- FALSE: evidence가 claim을 반박',
    '- MISLEADING: 과장/오해유도 표현 (사실이지만 왜곡)',
    '- UNVERIFIABLE: evidence 없거나 판단 불가',
    '',
    '★ correction 규칙:',
    '- FALSE/MISLEADING만 correction 생성. 사실 토큰만 수정, 문장 스타일/어조 유지.',
    '- correction에는 반드시 evidenceUrl을 함께 제시 (근거 없는 correction 금지).',
    '- TRUE/SUBSTANTIALLY_TRUE/UNVERIFIABLE: correction 없음 (correction 키 생략).',
    '',
    'JSON 배열만 출력 (코드펜스 금지):',
    '[{"sentence":"원문","verdict":"TRUE","evidenceUrl":"url"},...]',
    '',
    '검증 대상:',
    claimBlocks.join('\n\n'),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Stage 3/4 — parse Haiku response (pure, exported for tests)
// ---------------------------------------------------------------------------

const VALID_VERDICTS = new Set<string>([
  'TRUE',
  'SUBSTANTIALLY_TRUE',
  'FALSE',
  'MISLEADING',
  'UNVERIFIABLE',
]);

/**
 * Parse and validate the raw Haiku JSON response into CheckResult[].
 * Drops out-of-shape items. Strips code fences. Pure function ([P-3A-STYLE-KEEP]).
 * Returns ok:false on JSON parse failure or empty result.
 */
export function parseFactcheckResponse(
  raw: string,
  sentences: string[]
): { ok: true; results: CheckResult[] } | { ok: false; reason: string } {
  // Strip code fences (```json...``` or ```...```)
  const stripped = raw
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch (err) {
    return {
      ok: false,
      reason: `json_parse: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!Array.isArray(json)) return { ok: false, reason: 'expected_array' };

  const sentenceSet = new Set(sentences);
  const results: CheckResult[] = [];

  for (const item of json as LlmCheckItem[]) {
    const sentence = typeof item.sentence === 'string' ? item.sentence.trim() : '';
    if (!sentence) continue;
    // Only accept sentences we sent (prevents hallucinated extras).
    if (sentenceSet.size > 0 && !sentenceSet.has(sentence)) continue;

    const verdictRaw = typeof item.verdict === 'string' ? item.verdict.trim().toUpperCase() : '';
    if (!VALID_VERDICTS.has(verdictRaw)) continue;
    const verdict = verdictRaw as Verdict;

    const evidenceUrl =
      typeof item.evidenceUrl === 'string' && item.evidenceUrl.trim()
        ? item.evidenceUrl.trim()
        : undefined;

    // [P-3A-STYLE-KEEP]: correction ONLY for FALSE/MISLEADING, and only when evidence-grounded.
    let correction: string | undefined;
    if ((verdict === 'FALSE' || verdict === 'MISLEADING') && evidenceUrl) {
      correction =
        typeof item.correction === 'string' && item.correction.trim()
          ? item.correction.trim()
          : undefined;
    }

    // [P-3A-NO-NEW-ERROR]: if FALSE/MISLEADING but no evidenceUrl, record without correction.
    results.push({ sentence, verdict, evidenceUrl, correction });
  }

  if (results.length === 0) return { ok: false, reason: 'no_valid_items' };
  return { ok: true, results };
}

// ---------------------------------------------------------------------------
// Stage 2 — CSE + Haiku verify for one batch of claims
// ---------------------------------------------------------------------------

async function verifyClaims(claims: FactSentence[], cseClient: CseClient): Promise<CheckResult[]> {
  // Gather CSE evidence for each claim (3 snippets per claim).
  const enriched = await Promise.all(
    claims.map(async (c) => {
      const res = await cseClient.searchWeb(c.text, { num: 3 });
      const evidenceSnippets = (res.items ?? []).slice(0, 3).map((it) => ({
        url: it.link,
        snippet: it.snippet,
      }));
      return { sentence: c.text, evidenceSnippets };
    })
  );

  const prompt = buildFactcheckPrompt(enriched);
  const sentenceTexts = claims.map((c) => c.text);

  // Retry Haiku once on failure (VERIFY_ATTEMPTS).
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await new OpenRouterGenerationProvider(HAIKU_MODEL).generate(prompt, {
        format: 'json',
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
      });
    } catch (err) {
      lastReason = `provider_error: ${err instanceof Error ? err.message : String(err)}`;
      if (attempt < VERIFY_ATTEMPTS) {
        log.warn('book-factcheck verify attempt failed — retrying', {
          attempt,
          reason: lastReason,
        });
        continue;
      }
      throw new Error(lastReason);
    }

    const parsed = parseFactcheckResponse(raw, sentenceTexts);
    if (parsed.ok) {
      if (attempt > 1) log.info('book-factcheck recovered on retry', { attempt });
      return parsed.results;
    }

    lastReason = parsed.reason;
    if (attempt < VERIFY_ATTEMPTS) {
      log.warn('book-factcheck parse failed — retrying', { attempt, reason: lastReason });
    }
  }

  throw new Error(`hard_fail: ${lastReason}`);
}

// ---------------------------------------------------------------------------
// Top-level orchestrator (exported)
// ---------------------------------------------------------------------------

/**
 * Factcheck a chapter body's sentences.
 * Stages: selectCheckWorthy → CSE search + Haiku stance → verdict → style-preserving correction.
 * Narrative/connective sentences (hasSource===false) are exempt from verification.
 * Honest fail → ok:false. Logs verdict distribution for observability.
 *
 * @param sentences  - All sentences in the chapter body, tagged with hasSource.
 * @param cseClient  - Google CSE client (injected; defaults to disabled client for safety).
 */
export async function factcheckChapterBody(
  sentences: FactSentence[],
  cseClient?: CseClient
): Promise<FactcheckResult> {
  if (sentences.length === 0) return { ok: false, reason: 'no_sentences' };

  // Default CSE client returns empty results (safe no-op if caller omits it).
  const client: CseClient = cseClient ?? {
    searchWeb: async () => ({ items: [], totalResults: 0, error: 'no_cse_client' }),
  };

  const checkWorthy = selectCheckWorthy(sentences);

  log.info('book-factcheck start', {
    total: sentences.length,
    checkWorthy: checkWorthy.length,
    narrative: sentences.length - checkWorthy.length,
  });

  if (checkWorthy.length === 0) {
    // All sentences are narrative — return empty verified result (nothing to correct).
    return { ok: true, results: [] };
  }

  let results: CheckResult[];
  try {
    results = await verifyClaims(checkWorthy, client);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('book-factcheck HARD FAIL', { reason });
    return { ok: false, reason };
  }

  // Log verdict distribution for observability.
  const dist: Partial<Record<Verdict, number>> = {};
  for (const r of results) dist[r.verdict] = (dist[r.verdict] ?? 0) + 1;
  log.info('book-factcheck done', {
    total: sentences.length,
    checkWorthy: checkWorthy.length,
    verified: results.length,
    verdicts: dist,
  });

  return { ok: true, results };
}
