/**
 * Caption Extractor
 *
 * Extracts publicly available captions/subtitles from YouTube videos
 * using the youtube-transcript npm package (Innertube API).
 *
 * LEGAL: Transcripts are NOT persisted on the server.
 * Only LLM-generated summaries are stored. Raw transcripts
 * may be returned to the client for local caching only.
 */

// Dynamic import of the ESM build subpath.
// The package `main` (youtube-transcript.common.js) is CJS-bodied yet the
// package.json declares `"type": "module"`, so importing the bare package
// name throws "exports is not defined in ES module scope". Importing the
// `.esm.js` build directly sidesteps the broken main entry.
async function loadFetchTranscript() {
  const mod = await import('youtube-transcript/dist/youtube-transcript.esm.js');
  return mod.fetchTranscript;
}
import { logger } from '../../utils/logger';
import { loadTranscriptConfig } from '@/config/transcript';

// Mac Mini transcript proxy. EC2 us-west-2 outbound to YouTube is rate-
// limited / returns false "Transcript is disabled" — verified by apples-
// to-apples test (same library, same call, same video; KR ISP IP succeeds
// from Mac Mini, AWS us-west-2 returns the disabled error). When
// MAC_MINI_TRANSCRIPT_URL is set, we forward the fetch to Mac Mini over
// Tailscale; the EC2 caption-extractor falls back to direct youtube-
// transcript only if the proxy is unreachable (defence in depth).
const TRANSCRIPT_CONFIG = loadTranscriptConfig();
const MAC_MINI_URL = TRANSCRIPT_CONFIG.macMiniUrl;
const MAC_MINI_TOKEN = TRANSCRIPT_CONFIG.macMiniToken;
const MAC_MINI_TIMEOUT_MS = 30_000;

interface MacMiniSegment {
  text: string;
  offset: number;
  duration: number;
}
interface MacMiniResponse {
  success: boolean;
  videoId?: string;
  language?: string;
  segments?: MacMiniSegment[];
  error?: string;
}

async function fetchViaMacMini(youtubeId: string, lang: string): Promise<MacMiniSegment[] | null> {
  if (!MAC_MINI_URL || !MAC_MINI_TOKEN) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAC_MINI_TIMEOUT_MS);
  try {
    const resp = await fetch(
      `${MAC_MINI_URL.replace(/\/$/, '')}/transcript/${encodeURIComponent(youtubeId)}?lang=${encodeURIComponent(lang)}`,
      {
        method: 'GET',
        headers: { 'x-transcript-token': MAC_MINI_TOKEN },
        signal: controller.signal,
      }
    );
    if (resp.status === 404) {
      // service reachable, captions absent in this language — bubble up
      // as "no captions" so the outer loop can try the next language
      return [];
    }
    if (!resp.ok) {
      logger.warn('Mac Mini transcript proxy non-200', {
        youtubeId,
        lang,
        status: resp.status,
      });
      return null;
    }
    const data = (await resp.json()) as MacMiniResponse;
    if (!data.success || !Array.isArray(data.segments)) {
      logger.warn('Mac Mini transcript proxy returned no segments', {
        youtubeId,
        lang,
        error: data.error,
      });
      return null;
    }
    return data.segments;
  } catch (err) {
    logger.warn('Mac Mini transcript proxy fetch failed (falling back)', {
      youtubeId,
      lang,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
import type {
  CaptionSegment,
  CaptionMetadata,
  CaptionExtractionResult,
  AvailableLanguages,
} from './types';

// --------------------------------------------------------------------------
// Caption Extractor Service (in-memory only, no DB persistence)
// --------------------------------------------------------------------------

export class CaptionExtractor {
  /**
   * Extract captions for a video (in-memory only).
   * Uses youtube-transcript (public caption API) exclusively.
   * Returns transcript data without persisting to server DB.
   */
  public async extractCaptions(
    youtubeId: string,
    language?: string
  ): Promise<CaptionExtractionResult> {
    // Korean-first default — auto captions follow the video's spoken
    // language, and the prod pool skews Korean.
    const BASE_LANGS = ['ko', 'en'];
    const LANG_PRIORITY = language
      ? [language, ...BASE_LANGS.filter((l) => l !== language)]
      : BASE_LANGS;

    try {
      let segments: CaptionSegment[] = [];
      let resolvedLang = LANG_PRIORITY[0]!;

      for (const lang of LANG_PRIORITY) {
        logger.info('Extracting captions', { videoId: youtubeId, language: lang });

        // Path 1 — Mac Mini Tailscale proxy (preferred). EC2 outbound IP
        // is blocked by YouTube for caption fetch; Mac Mini uses a KR ISP
        // residential IP that successfully fetches. When the env vars are
        // configured and the proxy returns a usable result, skip path 2.
        const macMini = await fetchViaMacMini(youtubeId, lang);
        if (macMini && macMini.length > 0) {
          segments = macMini.map((item) => ({
            text: item.text,
            start: item.offset / 1000,
            duration: item.duration / 1000,
          }));
          resolvedLang = lang;
          break;
        }

        // Path 2 — youtube-transcript direct (fallback). Used when Mac
        // Mini proxy env is unset OR proxy is unreachable. Known to fail
        // on EC2 outbound but retained as defence in depth (e.g. for
        // local dev or if the IP block is later lifted).
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const transcript = await (await loadFetchTranscript())(youtubeId, { lang });
            if (transcript && transcript.length > 0) {
              segments = transcript.map((item) => ({
                text: item.text,
                start: item.offset / 1000,
                duration: item.duration / 1000,
              }));
              resolvedLang = lang;
              lastErr = null;
              break;
            }
          } catch (err) {
            lastErr = err;
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 300));
            }
          }
        }
        if (segments.length > 0) break;
        if (lastErr) {
          const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
          logger.warn('youtube-transcript failed after retry', { youtubeId, lang, error: errMsg });
        }
      }

      if (segments.length === 0) {
        logger.warn('No publicly available captions found', { videoId: youtubeId });
        return {
          success: false,
          videoId: youtubeId,
          language: LANG_PRIORITY[0]!,
          error: 'No publicly available captions found',
        };
      }

      logger.info('Captions fetched (in-memory only)', {
        youtubeId,
        segments: segments.length,
        source: 'youtube-transcript',
        language: resolvedLang,
      });

      const fullText = segments.map((s) => s.text).join(' ');
      const caption: CaptionMetadata = {
        videoId: youtubeId,
        language: resolvedLang,
        fullText,
        segments,
      };

      return { success: true, videoId: youtubeId, language: resolvedLang, caption };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to extract captions', {
        videoId: youtubeId,
        language: LANG_PRIORITY.join(','),
        error: errorMessage,
      });
      return {
        success: false,
        videoId: youtubeId,
        language: LANG_PRIORITY[0]!,
        error: errorMessage,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Language detection
  // --------------------------------------------------------------------------

  public async getAvailableLanguages(videoId: string): Promise<AvailableLanguages> {
    try {
      const commonLanguages = ['en', 'ko', 'ja', 'es', 'fr', 'de', 'zh'];
      const available: string[] = [];

      for (const lang of commonLanguages) {
        try {
          const result = await (await loadFetchTranscript())(videoId, { lang });
          if (result && result.length > 0) {
            available.push(lang);
          }
        } catch {
          // Language not available
        }
      }

      logger.info('Available languages detected', { videoId, languages: available });
      return { videoId, languages: available };
    } catch (error) {
      logger.error('Failed to get available languages', { videoId, error });
      return { videoId, languages: [] };
    }
  }
}

let extractorInstance: CaptionExtractor | null = null;

export function getCaptionExtractor(): CaptionExtractor {
  if (!extractorInstance) {
    extractorInstance = new CaptionExtractor();
  }
  return extractorInstance;
}

export default getCaptionExtractor;
