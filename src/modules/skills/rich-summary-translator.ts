/**
 * v2 rich-summary translations (CP499+ 출시 트랙, James-approved 4-axis design).
 *
 * Storage: the RESERVED `video_rich_summaries.translations` jsonb (CP437 v2
 * schema, Phase 2 seat — zero schema change):
 *   { "<lang>": { one_liner, core, analysis, segments },
 *     "_failures": { "<lang>": { n, last_at } } }
 *
 * - New rows: enrich-time co-generation when mandala language ≠ source
 *   language (ko video on ko mandala = no call, cost 0).
 * - Existing rows: on-demand at display time (translate → store; revisit is
 *   0-cost). Fail-open: translation failure serves the original, and after
 *   MAX_TRANSLATE_FAILURES the original is pinned (no per-view re-fire).
 * - Structure preservation is VERIFIED (#896 lineage): parse mirrors the
 *   proven fence/brace strip, then key-shape equality vs the source payload
 *   (same keys, same array lengths, numbers/booleans byte-equal). Any
 *   mismatch = failure.
 */

import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database';
import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import {
  RICH_SUMMARY_TRANSLATE_MODEL,
  RICH_SUMMARY_TRANSLATE_TEMPERATURE,
  RICH_SUMMARY_TRANSLATE_MAX_TOKENS,
  buildRichSummaryTranslatePrompt,
} from '@/prompts/rich-summary-translator';

const log = logger.child({ module: 'rich-summary-translator' });

export const MAX_TRANSLATE_FAILURES = 3;

export type TranslateLang = 'ko' | 'en';

export interface TranslatablePayload {
  one_liner: string | null;
  core: unknown;
  analysis: unknown;
  segments: unknown;
}

export type GenerateImpl = (
  prompt: string,
  opts?: { temperature?: number; maxTokens?: number; format?: 'json' }
) => Promise<string>;

interface TranslationsShape {
  [lang: string]: unknown;
  _failures?: Record<string, { n: number; last_at: string }>;
}

// ─── translations jsonb accessors ───────────────────────────────────────────

export function getStoredTranslation(
  translations: unknown,
  lang: TranslateLang
): TranslatablePayload | null {
  if (!translations || typeof translations !== 'object') return null;
  const t = (translations as TranslationsShape)[lang];
  if (!t || typeof t !== 'object') return null;
  return t as TranslatablePayload;
}

export function translationFailureCount(translations: unknown, lang: TranslateLang): number {
  if (!translations || typeof translations !== 'object') return 0;
  const f = (translations as TranslationsShape)._failures?.[lang];
  return typeof f?.n === 'number' ? f.n : 0;
}

// ─── structure verification (#896 lineage) ──────────────────────────────────

/**
 * Recursive key-shape equality: objects must have the SAME key set, arrays
 * the SAME length (elementwise recursion), and numbers/booleans must be
 * byte-equal (translation may only change strings). Null/undefined must
 * match in kind. Strings are free to differ.
 */
export function sameShape(src: unknown, out: unknown): boolean {
  if (src === null || src === undefined) return out === null || out === undefined;
  if (typeof src === 'string') return typeof out === 'string';
  if (typeof src === 'number' || typeof src === 'boolean') return src === out;
  if (Array.isArray(src)) {
    if (!Array.isArray(out) || out.length !== src.length) return false;
    return src.every((v, i) => sameShape(v, out[i]));
  }
  if (typeof src === 'object') {
    if (typeof out !== 'object' || out === null || Array.isArray(out)) return false;
    const sk = Object.keys(src as Record<string, unknown>).sort();
    const ok = Object.keys(out as Record<string, unknown>).sort();
    if (sk.length !== ok.length || sk.some((k, i) => k !== ok[i])) return false;
    return sk.every((k) =>
      sameShape((src as Record<string, unknown>)[k], (out as Record<string, unknown>)[k])
    );
  }
  return false;
}

/** Fence/brace strip + JSON.parse, mirroring the proven #896 parser shape. */
export function parseTranslateResponse(raw: string): unknown | null {
  let text = (raw ?? '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) text = brace[0];
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ─── translate ──────────────────────────────────────────────────────────────

/**
 * Translate the v2 payload. Fail-open: any failure (LLM error, parse fail,
 * SHAPE MISMATCH) returns null — the caller records the failure and serves
 * the original.
 */
export async function translateRichSummaryPayload(
  payload: TranslatablePayload,
  targetLang: TranslateLang,
  opts: { generateImpl?: GenerateImpl } = {}
): Promise<TranslatablePayload | null> {
  const generate =
    opts.generateImpl ??
    ((p: string, o?: { temperature?: number; maxTokens?: number; format?: 'json' }) =>
      new OpenRouterGenerationProvider(RICH_SUMMARY_TRANSLATE_MODEL).generate(p, o));

  try {
    const raw = await generate(buildRichSummaryTranslatePrompt(payload, targetLang), {
      temperature: RICH_SUMMARY_TRANSLATE_TEMPERATURE,
      maxTokens: RICH_SUMMARY_TRANSLATE_MAX_TOKENS,
      format: 'json',
    });
    const parsed = parseTranslateResponse(raw);
    if (!parsed) {
      log.warn(`v2-translate parse failed (lang=${targetLang}) — fail-open`);
      return null;
    }
    if (!sameShape(payload, parsed)) {
      log.warn(`v2-translate SHAPE MISMATCH (lang=${targetLang}) — fail-open (#896 lineage)`);
      return null;
    }
    return parsed as TranslatablePayload;
  } catch (err) {
    log.warn(
      `v2-translate LLM call failed (lang=${targetLang}) — fail-open: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

// ─── translate + persist (failure-cap aware) ────────────────────────────────

export interface TranslateAndStoreInput {
  videoId: string;
  targetLang: TranslateLang;
  payload: TranslatablePayload;
  /** Current translations jsonb (for failure count + merge). */
  translations: unknown;
  generateImpl?: GenerateImpl;
}

/**
 * Translate and persist into the translations jsonb. Returns the stored
 * payload, or null when translation failed or the failure cap is reached
 * (cap ⇒ no LLM call at all — the original is pinned).
 */
export async function translateAndStore(
  input: TranslateAndStoreInput
): Promise<TranslatablePayload | null> {
  const { videoId, targetLang, payload } = input;
  const prisma = getPrismaClient();

  const failures = translationFailureCount(input.translations, targetLang);
  if (failures >= MAX_TRANSLATE_FAILURES) return null;

  const translated = await translateRichSummaryPayload(payload, targetLang, {
    generateImpl: input.generateImpl,
  });

  const base =
    input.translations && typeof input.translations === 'object'
      ? { ...(input.translations as TranslationsShape) }
      : ({} as TranslationsShape);

  if (translated) {
    base[targetLang] = translated;
    await prisma.video_rich_summaries.update({
      where: { video_id: videoId },
      data: { translations: base as object },
    });
    log.info(`v2-translate stored: video=${videoId} lang=${targetLang}`);
    return translated;
  }

  base._failures = {
    ...(base._failures ?? {}),
    [targetLang]: { n: failures + 1, last_at: new Date().toISOString() },
  };
  await prisma.video_rich_summaries.update({
    where: { video_id: videoId },
    data: { translations: base as object },
  });
  log.warn(
    `v2-translate failure recorded: video=${videoId} lang=${targetLang} n=${failures + 1}/${MAX_TRANSLATE_FAILURES}`
  );
  return null;
}
