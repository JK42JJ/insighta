/**
 * src/modules/chatbot-rag/video-context-loader.ts
 *
 * Decides which video-grounding block(s) the chatbot prompt should carry:
 *
 *   - v2 rich summary present + usable → return V2Summary (Block A-D)
 *   - v2 absent OR not usable → fall back to transcript fetch (Block T)
 *   - both unavailable → null/null → caller adds the "분석 미생성" rule
 *
 * "Usable" mirrors FE summaryHasUsableContent (ChatAssistant.tsx) so BE
 * and FE agree on the same decision boundary. Source of truth = this BE
 * port; FE port is reviewed periodically for drift.
 *
 * Failures (DB unreachable, Mac Mini proxy down, no public captions) all
 * degrade to a null result on the affected branch. This loader never
 * throws — the chatbot must respond even when both data sources are gone.
 *
 * Design: docs/design/insighta-chatbot-prompt-serving-design.md §3 + CP474.
 */

import { getPrismaClient } from '@/modules/database/client';
import { getCaptionExtractor } from '@/modules/caption/extractor';
import { logger } from '@/utils/logger';
import { TRANSCRIPT_PROMPT_MAX_CHARS, type TranscriptContext } from './types';
import type { V2Summary, Lang } from './prompt-builder';

const log = logger.child({ module: 'chatbot-rag/video-context-loader' });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface VideoGroundingResult {
  /** Populated when v2 row exists and passes summaryHasUsableContent. */
  v2Data: V2Summary | null;
  /** Populated when v2 absent/unusable AND the caption extractor returned text. */
  transcript: TranscriptContext | null;
}

export interface LoadVideoContextParams {
  /** YouTube 11-char video id (NOT the internal youtube_videos.id UUID). */
  youtubeVideoId: string;
  /**
   * Hint for which language to request from the caption extractor.
   * Affects only the transcript branch.
   */
  preferredLanguage?: Lang;
}

/**
 * Returns whichever grounding source is available for `youtubeVideoId`.
 * Order of attempts: v2 row → transcript fetch. Each branch is fail-safe;
 * the function always returns a `VideoGroundingResult` (with both slots
 * potentially null in the worst case).
 */
export async function loadVideoContext(
  params: LoadVideoContextParams
): Promise<VideoGroundingResult> {
  const v2Data = await tryLoadV2(params.youtubeVideoId);
  if (v2Data) {
    return { v2Data, transcript: null };
  }

  const transcript = await tryFetchTranscript(params.youtubeVideoId, params.preferredLanguage);
  return { v2Data: null, transcript };
}

// ---------------------------------------------------------------------------
// Public utility — exported for testing + reuse by adapter for logging
// ---------------------------------------------------------------------------

/**
 * BE port of the FE `summaryHasUsableContent` helper
 * (frontend/.../ChatAssistant.tsx). Returns true when the row carries any
 * content the chatbot prompt can ground answers in.
 *
 * Mirror invariant: if either side returns true, the other should too.
 */
export function summaryHasUsableContent(input: {
  oneLiner?: string | null;
  core?: { one_liner?: string | null } | null;
  analysis?: {
    core_argument?: string | null;
    key_concepts?: ReadonlyArray<unknown> | null;
    actionables?: ReadonlyArray<unknown> | null;
  } | null;
  structured?: {
    core_argument?: string | null;
    key_points?: ReadonlyArray<unknown> | null;
    actionables?: ReadonlyArray<unknown> | null;
  } | null;
}): boolean {
  if (input.core?.one_liner) return true;
  if (input.analysis?.core_argument) return true;
  if ((input.analysis?.key_concepts?.length ?? 0) > 0) return true;
  if ((input.analysis?.actionables?.length ?? 0) > 0) return true;
  if (input.oneLiner) return true;
  if (input.structured?.core_argument) return true;
  if ((input.structured?.key_points?.length ?? 0) > 0) return true;
  if ((input.structured?.actionables?.length ?? 0) > 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Branch 1 — v2 rich summary
// ---------------------------------------------------------------------------

async function tryLoadV2(youtubeVideoId: string): Promise<V2Summary | null> {
  const prisma = getPrismaClient();

  try {
    const row = await prisma.video_rich_summaries.findUnique({
      where: { video_id: youtubeVideoId },
      select: {
        one_liner: true,
        structured: true,
        core: true,
        analysis: true,
        segments: true,
        quality_flag: true,
        template_version: true,
      },
    });

    if (!row) return null;

    // quality_flag must be 'pass' (or 'pending' but with usable content);
    // 'low' / 'fail' rows are silently treated as if absent.
    if (row.quality_flag && row.quality_flag !== 'pass' && row.quality_flag !== 'pending') {
      return null;
    }

    const usable = summaryHasUsableContent({
      oneLiner: row.one_liner,
      core: row.core as { one_liner?: string | null } | null,
      analysis: row.analysis as never,
      structured: row.structured as never,
    });
    if (!usable) return null;

    // Title comes from a separate JOIN — we keep it as an optional Block A
    // field. Fetched in parallel with the row when present.
    const titleRow = await prisma.youtube_videos
      .findUnique({
        where: { youtube_video_id: youtubeVideoId },
        select: { title: true },
      })
      .catch(() => null);

    return {
      title: titleRow?.title ?? null,
      core: (row.core ?? null) as V2Summary['core'],
      analysis: (row.analysis ?? null) as V2Summary['analysis'],
      segments: (row.segments ?? null) as V2Summary['segments'],
    };
  } catch (err) {
    log.warn('v2 row lookup failed', {
      youtubeVideoId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Branch 2 — transcript fallback
// ---------------------------------------------------------------------------

async function tryFetchTranscript(
  youtubeVideoId: string,
  preferredLanguage?: Lang
): Promise<TranscriptContext | null> {
  try {
    const result = await getCaptionExtractor().extractCaptions(youtubeVideoId, preferredLanguage);

    if (!result.success || !result.caption || !result.caption.fullText) {
      return null;
    }

    const total = result.caption.fullText.length;
    const truncated = total > TRANSCRIPT_PROMPT_MAX_CHARS;
    const fullText = truncated
      ? result.caption.fullText.slice(0, TRANSCRIPT_PROMPT_MAX_CHARS)
      : result.caption.fullText;

    // Extractor's `language` is the resolved language (ko / en / ...);
    // we narrow to our Lang union or 'auto'.
    const resolved =
      result.caption.language === 'ko' || result.caption.language === 'en'
        ? (result.caption.language as Lang)
        : 'auto';

    // Source detection: extractor logs `source: 'youtube-transcript'` when
    // falling back; the Mac Mini path doesn't set a distinct flag on the
    // return value, but its env-gated success is the dominant prod path.
    // Heuristic: env present → assume Mac Mini took the first hit.
    const macMiniEnabled = Boolean(
      process.env['MAC_MINI_TRANSCRIPT_URL'] && process.env['MAC_MINI_TRANSCRIPT_TOKEN']
    );

    return {
      full_text: fullText,
      source: macMiniEnabled ? 'mac-mini' : 'youtube-transcript',
      language: resolved,
      truncated,
      total_chars: total,
    };
  } catch (err) {
    log.warn('transcript fetch failed', {
      youtubeVideoId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
