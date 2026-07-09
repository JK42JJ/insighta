// §4.5.1 [4] STORM-style research gap-fill (CP504 loop-2-B).
//
// Finds perspective GAPS in the book's woven chapters (loop-1b output) + the
// mandala center goal, generates a web-search query per gap (one Haiku call),
// retrieves CSE snippets, and returns reference-tracked supplemental facts.
//
// Scope boundary: returns ResearchFinding[] keyed to EXISTING chapterTitles.
// This module never generates chapters, sections, or outline structure — that
// is Sonnet's domain (book-skeleton). A finding MUST carry a real CSE reference;
// gaps with no CSE result are silently dropped (no fabrication, P-2B-REF).
//
// Service module — OpenRouter Haiku + CSE are PRODUCTION calls. CC MUST NOT
// call them for tests; unit tests mock both (LLM-API ban).

import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { logger } from '@/utils/logger';
import { createGoogleCseClient, loadGoogleCseConfig } from '@/modules/google-cse';
import type { CseSearchResult, SearchWebOptions } from '@/modules/google-cse';

const log = logger.child({ module: 'mandala-book/book-research' });

// Haiku: cheap + fast for gap identification; same model id used project-wide.
const HAIKU_MODEL = 'anthropic/claude-haiku-4.5';
const MAX_TOKENS = 2000;
const RESEARCH_ATTEMPTS = 2;
const TEMPERATURE = 0.3;
// Caps total gaps to bound CSE quota + cost (3 results/gap × MAX_GAPS calls).
const MAX_GAPS = 6;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Woven narrative chapter passed in as research input (from loop-1b). */
export interface ResearchChapterInput {
  title: string;
  intro: string;
  sectionSummaries: string[];
}

/** A web reference from a CSE result item. */
export interface ResearchReference {
  title: string;
  url: string; // from CseItem.link — non-empty (P-2B-REF enforced at retrieval)
}

/** One research finding: fact from a CSE snippet, tied to an existing chapter. */
export interface ResearchFinding {
  chapterTitle: string; // references an existing chapter — never a new structure
  perspective: string; // the gap angle this fills
  fact: string; // concise factual statement derived from the CSE snippet
  reference: ResearchReference; // always non-empty (P-2B-REF: no finding without a ref)
}

export type ResearchResult =
  | { ok: true; findings: ResearchFinding[] }
  | { ok: false; reason: string };

/** One identified knowledge gap with its generated web-search query. */
export interface ResearchGap {
  chapterTitle: string;
  perspective: string;
  query: string;
}

/** CSE client interface — accepts the real createGoogleCseClient() return value or a mock. */
export interface CseClient {
  searchWeb: (query: string, opts?: SearchWebOptions) => Promise<CseSearchResult>;
}

// ─── Perspective module ───────────────────────────────────────────────────────

/**
 * Build the Haiku prompt to identify missing perspectives in the book's chapters.
 * The model outputs gap objects only — no structural proposals.
 */
export function buildPerspectivePrompt(
  chapters: ResearchChapterInput[],
  centerGoal: string
): string {
  const chapterList = chapters
    .map(
      (ch, i) =>
        `[${i}] "${ch.title}"\n  intro: ${ch.intro || '(none)'}\n  sections: ${ch.sectionSummaries.join(' | ')}`
    )
    .join('\n\n');
  return [
    `You are a research assistant for a book on the goal: "${centerGoal}".`,
    `Below are the existing chapters (title, intro, section summaries):`,
    ``,
    chapterList,
    ``,
    `Task: identify THIN or MISSING perspectives a complete book on "${centerGoal}" should cover but the chapters above lack.`,
    `For each gap output { "chapterTitle": <existing title>, "perspective": <1-2 sentences describing the gap>, "query": <concise web search query to find facts filling this gap> }.`,
    ``,
    `Rules:`,
    `- Identify gaps ONLY. Do NOT propose new chapters, sections, or structural changes.`,
    `- chapterTitle must exactly match one of the existing chapter titles above.`,
    `- Max ${MAX_GAPS} gaps total.`,
    `- Output JSON only: {"gaps":[{"chapterTitle":"...","perspective":"...","query":"..."}]}`,
  ].join('\n');
}

/**
 * Pure parse of the Haiku gaps response. Exported for unit tests (no live LLM).
 * Caps at MAX_GAPS; drops entries with missing or empty required fields.
 * Code-fence strip mirrors book-skeleton pattern.
 */
export function parsePerspectiveResponse(
  raw: string
): { ok: true; perspectives: ResearchGap[] } | { ok: false; reason: string } {
  const stripped = raw
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  let json: { gaps?: unknown };
  try {
    json = JSON.parse(stripped) as { gaps?: unknown };
  } catch (err) {
    return {
      ok: false,
      reason: `json_parse: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!Array.isArray(json.gaps)) return { ok: false, reason: 'no_gaps_array' };

  const perspectives: ResearchGap[] = [];
  for (const g of (json.gaps as Array<Record<string, unknown>>).slice(0, MAX_GAPS)) {
    const chapterTitle = typeof g['chapterTitle'] === 'string' ? g['chapterTitle'].trim() : '';
    const perspective = typeof g['perspective'] === 'string' ? g['perspective'].trim() : '';
    const query = typeof g['query'] === 'string' ? g['query'].trim() : '';
    if (!chapterTitle || !perspective || !query) continue;
    perspectives.push({ chapterTitle, perspective, query });
  }

  if (perspectives.length === 0) return { ok: false, reason: 'no_valid_gaps' };
  return { ok: true, perspectives };
}

// ─── Question module ──────────────────────────────────────────────────────────

/**
 * Extract the web-search query for each gap.
 * Distinct testable unit satisfying the "question module" boundary; the query
 * field is produced inline by the Haiku perspective call above.
 */
export function gapsToQueries(gaps: ResearchGap[]): string[] {
  return gaps.map((g) => g.query);
}

// ─── Retrieval module ─────────────────────────────────────────────────────────

/**
 * Retrieve CSE facts for each gap. Gaps with errors or no results are silently
 * skipped — a finding MUST have a real CSE reference (P-2B-REF).
 * Accept the CSE client as a param (dependency injection for tests).
 */
export async function retrieveForGaps(
  gaps: ResearchGap[],
  cseClient: CseClient
): Promise<ResearchFinding[]> {
  const findings: ResearchFinding[] = [];
  for (const gap of gaps) {
    const result = await cseClient.searchWeb(gap.query, { num: 3 });
    if (result.error || result.items.length === 0) continue; // no fabrication

    const item = result.items[0];
    if (!item || !item.link) continue; // noUncheckedIndexedAccess + empty-url guard

    const fact = item.snippet ? item.snippet.replace(/\s*\n+\s*/g, ' ').trim() : item.title;
    if (!fact) continue;

    findings.push({
      chapterTitle: gap.chapterTitle,
      perspective: gap.perspective,
      fact,
      reference: { title: item.title, url: item.link },
    });
  }
  return findings;
}

// ─── Top-level orchestrator ───────────────────────────────────────────────────

/**
 * STORM-style research loop: Haiku identifies perspective gaps → CSE retrieves
 * reference-tracked facts. Returns findings keyed to existing chapterTitles;
 * never returns new chapters or outline structure (P-2B-NO-ARTICLE).
 * Retries the Haiku call once on parse/provider failure (like book-skeleton).
 * Honest fail → ok:false (caller may proceed without supplemental research).
 */
export async function researchBookGaps(
  chapters: ResearchChapterInput[],
  centerGoal: string,
  cseClient?: CseClient
): Promise<ResearchResult> {
  if (chapters.length === 0) return { ok: false, reason: 'no_chapters' };

  const client = cseClient ?? createGoogleCseClient(loadGoogleCseConfig());

  let gaps: ResearchGap[] | null = null;
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= RESEARCH_ATTEMPTS; attempt++) {
    const r = await attemptPerspective(chapters, centerGoal);
    if (r.ok) {
      if (attempt > 1) log.info('book-research perspective recovered on retry', { attempt });
      gaps = r.perspectives;
      break;
    }
    lastReason = r.reason;
    if (attempt < RESEARCH_ATTEMPTS) {
      log.warn('book-research perspective attempt failed — retrying', {
        attempt,
        reason: r.reason,
      });
    }
  }

  if (gaps === null) {
    log.error('book-research HARD FAIL after retries', { reason: lastReason });
    return { ok: false, reason: `hard_fail: ${lastReason}` };
  }

  log.info('book-research gaps identified', { count: gaps.length });
  const findings = await retrieveForGaps(gaps, client);
  log.info('book-research done', { gaps: gaps.length, findings: findings.length });
  return { ok: true, findings };
}

async function attemptPerspective(
  chapters: ResearchChapterInput[],
  centerGoal: string
): Promise<{ ok: true; perspectives: ResearchGap[] } | { ok: false; reason: string }> {
  const prompt = buildPerspectivePrompt(chapters, centerGoal);
  let raw: string;
  try {
    raw = await new OpenRouterGenerationProvider(HAIKU_MODEL).generate(prompt, {
      format: 'json',
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      purpose: 'book_research', // CP504 §3 per-stage cost attribution
    });
  } catch (err) {
    return {
      ok: false,
      reason: `provider_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return parsePerspectiveResponse(raw);
}
