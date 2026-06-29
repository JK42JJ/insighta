// §CV-NOTE-WIRE (CP505) — Haiku-powered figure-target detection for visual CV enrichment.
//
// Reads book sections (title + narrative + atoms{vid,ts,text}) and returns a SMALL
// pinpoint set of (videoId, tsSec) where a chart/table/diagram/equation would aid
// comprehension. All returned tsSec values are grounded in real section atoms — no
// invented timestamps. Graceful: LLM / parse failure → [] (never throws).
// Pure-ish: one Haiku call + parse (no DB I/O).
//
// Service module — OpenRouter Haiku is a PRODUCTION call. Unit tests MUST mock it
// (LLM-API ban). See book-factcheck pattern for the mock shape.

import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { logger } from '@/utils/logger';
import type { BookJson } from './book-schema';

const log = logger.child({ module: 'mandala-book/book-figure-detect' });

// Same Haiku model used across the book pipeline (factcheck, research).
const HAIKU_MODEL = 'anthropic/claude-haiku-4.5';
const MAX_TOKENS = 1024;
// Low temperature for factual timestamp grounding; avoid creative timestamps.
const TEMPERATURE = 0.2;

// Hard cap: never exceed this many targets per book regardless of maxTargets arg.
const DEFAULT_MAX_TARGETS = 8;
// Atoms per section sent to the prompt (cost control).
const MAX_ATOMS_PER_SECTION = 12;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One detected figure target — (videoId, tsSec) grounded in a real section atom. */
export interface FigureTarget {
  videoId: string;
  tsSec: number;
  chapterIdx: number;
  sectionIdx: number;
  reason: string;
}

// Internal shape expected from Haiku JSON response.
interface LlmTarget {
  chapterIdx?: unknown;
  sectionIdx?: unknown;
  videoId?: unknown;
  tsSec?: unknown;
  reason?: unknown;
}

// ---------------------------------------------------------------------------
// Prompt builder (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Build the Haiku detection prompt from the book's sections.
 * Each section contributes: chapterIdx/sectionIdx indices, title, narrative excerpt,
 * and up to MAX_ATOMS_PER_SECTION atoms with their (vid, ts, text).
 */
export function buildFigureDetectPrompt(
  book: BookJson,
  centerGoal: string,
  maxTargets: number
): string {
  const sectionBlocks: string[] = [];

  for (let ci = 0; ci < book.chapters.length; ci++) {
    const ch = book.chapters[ci];
    if (!ch) continue;
    for (let si = 0; si < ch.sections.length; si++) {
      const sec = ch.sections[si];
      if (!sec) continue;
      const atomLines = sec.atoms
        .slice(0, MAX_ATOMS_PER_SECTION)
        .map((a) => `    {vid:"${a.vid}",ts:${a.ts},"${a.text.slice(0, 80)}"}`)
        .join('\n');
      sectionBlocks.push(
        `[ch:${ci} sec:${si}] "${sec.title}"\n` +
          `  narrative: ${sec.narrative.slice(0, 120)}\n` +
          `  atoms:\n${atomLines || '    (none)'}`
      );
    }
  }

  return [
    `Book goal: "${centerGoal}"`,
    `Identify up to ${maxTargets} video timestamps where a chart, table, diagram, or equation would CONCRETELY aid comprehension.`,
    '',
    'Rules:',
    '- STEM / AI-ML topics: prioritize equations first, then charts/tables/diagrams.',
    '- tsSec MUST be the exact ts value of an atom in that section — no invented timestamps.',
    '- Prefer sections with dense technical content over narrative/intro sections.',
    '- Return [] if nothing qualifies (no STEM content, no suitable atoms).',
    `- Output JSON only (no code fence): [{"chapterIdx":0,"sectionIdx":0,"videoId":"...","tsSec":123,"reason":"..."}]`,
    '',
    'Sections:',
    sectionBlocks.join('\n\n'),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Response parser (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Parse and validate the Haiku JSON response into FigureTarget[].
 * Enforces maxTargets hard cap. Drops items where tsSec is not a real atom ts
 * for the given section (prevents fabricated timestamps). Code-fence strip
 * mirrors other book modules. Returns [] on JSON parse failure.
 */
export function parseFigureDetectResponse(
  raw: string,
  book: BookJson,
  maxTargets: number
): FigureTarget[] {
  // Strip code fences (```json...``` or ```...```)
  const stripped = raw
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch {
    return [];
  }

  if (!Array.isArray(json)) return [];

  const result: FigureTarget[] = [];

  for (const item of json as LlmTarget[]) {
    if (result.length >= maxTargets) break; // hard cap

    const ci = typeof item.chapterIdx === 'number' ? Math.floor(item.chapterIdx) : -1;
    const si = typeof item.sectionIdx === 'number' ? Math.floor(item.sectionIdx) : -1;
    const videoId = typeof item.videoId === 'string' ? item.videoId.trim() : '';
    const tsSec = typeof item.tsSec === 'number' ? Math.floor(item.tsSec) : -1;
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';

    if (!videoId || tsSec < 0 || !reason || ci < 0 || si < 0) continue;

    // Chapter and section must exist in the book.
    const ch = book.chapters[ci];
    if (!ch) continue;
    const sec = ch.sections[si];
    if (!sec) continue;

    // tsSec MUST match an atom in that section for the given videoId.
    const grounded = sec.atoms.some((a) => a.vid === videoId && a.ts === tsSec);
    if (!grounded) continue;

    result.push({ videoId, tsSec, chapterIdx: ci, sectionIdx: si, reason });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect figure targets in the book's sections using one Haiku call.
 * Returns ≤ maxTargets (default 8, HARD cap) FigureTargets grounded in real
 * section atoms. Graceful: returns [] on LLM / parse failure (never throws).
 *
 * @param book       - Parsed book (v2 schema).
 * @param opts.centerGoal  - Mandala center goal (context for the LLM).
 * @param opts.maxTargets  - Override cap; still clamped to DEFAULT_MAX_TARGETS.
 */
export async function detectFigureTargets(
  book: BookJson,
  opts: { centerGoal: string; maxTargets?: number }
): Promise<FigureTarget[]> {
  // Clamp to the HARD cap regardless of caller input.
  const maxTargets = Math.min(opts.maxTargets ?? DEFAULT_MAX_TARGETS, DEFAULT_MAX_TARGETS);

  // No atoms anywhere → skip the LLM call entirely.
  const hasAtoms = book.chapters.some((ch) => ch.sections.some((s) => s.atoms.length > 0));
  if (!hasAtoms) return [];

  const prompt = buildFigureDetectPrompt(book, opts.centerGoal, maxTargets);

  let raw: string;
  try {
    raw = await new OpenRouterGenerationProvider(HAIKU_MODEL).generate(prompt, {
      format: 'json',
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    });
  } catch (err) {
    log.warn('book-figure-detect: LLM 호출 실패 → []', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const targets = parseFigureDetectResponse(raw, book, maxTargets);
  log.info('book-figure-detect 완료', {
    chaptersInBook: book.chapters.length,
    detected: targets.length,
  });
  return targets;
}
