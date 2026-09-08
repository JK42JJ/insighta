/**
 * Caption Extractor
 *
 * Extracts publicly available captions through the Webshare-backed transcript
 * proxies, and only through them. This module holds no YouTube client: calling
 * YouTube from the cluster is what gets the account blocked, and a direct
 * fallback here is a rule violation waiting for the first person to click.
 *
 * LEGAL: Transcripts are NOT persisted on the server.
 * Only LLM-generated summaries are stored. Raw transcripts
 * may be returned to the client for local caching only.
 */

import { logger } from '../../utils/logger';
import { loadTranscriptConfig } from '@/config/transcript';

// Mac Mini transcript proxy. EC2 us-west-2 outbound to YouTube is rate-
// limited / returns false "Transcript is disabled" — verified by apples-
// to-apples test (same library, same call, same video; KR ISP IP succeeds
// from Mac Mini, AWS us-west-2 returns the disabled error). When
// MAC_MINI_TRANSCRIPT_URL is set, we forward the fetch there. There is no
// fallback: if every proxy is unreachable the extraction fails, which is the
// correct outcome. Tailscale is management-only and must not carry service
// traffic -- the proxy address has to be one the cluster reaches directly.
const TRANSCRIPT_CONFIG = loadTranscriptConfig();
const PROXY_TIMEOUT_MS = 30_000;

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

/**
 * Fetch a transcript through ONE proxy host (Azure App Service or Mac Mini —
 * same Webshare-backed service, same token). Returns segments on success, `[]`
 * when the proxy REACHED YouTube but there are no captions in this language,
 * and `null` when the proxy is unreachable (so the caller tries the next proxy).
 */
async function fetchViaProxy(
  proxy: { name: string; url: string; token: string },
  youtubeId: string,
  lang: string
): Promise<MacMiniSegment[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const resp = await fetch(
      `${proxy.url.replace(/\/$/, '')}/transcript/${encodeURIComponent(youtubeId)}?lang=${encodeURIComponent(lang)}`,
      {
        method: 'GET',
        headers: { 'x-transcript-token': proxy.token },
        signal: controller.signal,
      }
    );
    if (resp.status === 404) {
      // service reachable, captions absent in this language — bubble up as
      // "no captions" so the outer loop can try the next language.
      return [];
    }
    if (!resp.ok) {
      logger.warn('transcript proxy non-200', {
        proxy: proxy.name,
        youtubeId,
        lang,
        status: resp.status,
      });
      return null;
    }
    const data = (await resp.json()) as MacMiniResponse;
    if (!data.success || !Array.isArray(data.segments)) {
      logger.warn('transcript proxy returned no segments', {
        proxy: proxy.name,
        youtubeId,
        lang,
        error: data.error,
      });
      return null;
    }
    return data.segments;
  } catch (err) {
    logger.warn('transcript proxy fetch failed (falling back)', {
      proxy: proxy.name,
      youtubeId,
      lang,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try each configured proxy in order (Azure → Mac Mini). Returns the result of
 * the FIRST proxy that reaches YouTube (segments or `[]` = no captions); returns
 * `null` only when every proxy is unreachable (caller then tries direct).
 */
async function fetchViaProxies(youtubeId: string, lang: string): Promise<MacMiniSegment[] | null> {
  for (const proxy of TRANSCRIPT_CONFIG.proxies) {
    const r = await fetchViaProxy(proxy, youtubeId, lang);
    if (r !== null) return r; // reached (segments or 404 no-captions) — stop
    // r === null → this proxy is unreachable; try the next one.
  }
  return null; // all proxies unreachable
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
   * Fetched through the configured proxies exclusively.
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

        // Path 1 — Webshare-backed proxies (Azure primary → Mac Mini fallback).
        // EC2 outbound IP is blocked by YouTube AND scraping must not run on EC2
        // (ToS); the proxies fetch through a Webshare residential IP off-EC2.
        // Azure is an always-on cloud host (fixes the Mac Mini SPOF). When a
        // proxy returns a usable result, skip path 2.
        const macMini = await fetchViaProxies(youtubeId, lang);
        if (macMini && macMini.length > 0) {
          segments = macMini.map((item) => ({
            text: item.text,
            start: item.offset / 1000,
            duration: item.duration / 1000,
          }));
          resolvedLang = lang;
          break;
        }

        // There is no second path, and that is the rule rather than an
        // omission. Captions are fetched through the Webshare-backed proxies or
        // not at all: calling YouTube from this pod is what gets the account
        // blocked, and "it fails on EC2 anyway" is not a reason to keep the
        // call -- a request that is refused was still a request.
        //
        // What used to be here retried youtube-transcript twice per language,
        // so a video with both proxies down made four direct calls. It fired
        // only because nobody had clicked, not because it was safe.
        logger.warn('captions: no proxy reached YouTube', {
          videoId: youtubeId,
          language: lang,
          proxies: TRANSCRIPT_CONFIG.proxies.map((p) => p.name),
        });
      }

      if (segments.length === 0) {
        // Distinguish "nothing is configured" from "nothing answered". Both end
        // with no captions, and only one of them is fixed by restarting a host.
        const configured = TRANSCRIPT_CONFIG.proxies.length > 0;
        logger.warn(
          configured
            ? 'captions: proxies configured but none reached YouTube'
            : 'captions: no transcript proxy configured',
          { videoId: youtubeId }
        );
        return {
          success: false,
          videoId: youtubeId,
          language: LANG_PRIORITY[0]!,
          error: configured ? 'transcript proxies unreachable' : 'no transcript proxy configured',
        };
      }

      logger.info('Captions fetched (in-memory only)', {
        youtubeId,
        segments: segments.length,
        source: 'proxy',
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

  /**
   * Which of the supported languages this video actually has captions for.
   *
   * The previous implementation asked YouTube directly, once per language, for
   * seven languages -- seven direct calls per request, from an API endpoint,
   * bypassing the proxies entirely. No caller in the frontend uses it, so it
   * had never been noticed; it only needed one request to become the reason
   * the account was blocked.
   *
   * It now asks the proxies, and only for the two languages the extractor
   * actually attempts. Asking about five more it would never use was work done
   * to fill a field nobody reads.
   */
  public async getAvailableLanguages(videoId: string): Promise<AvailableLanguages> {
    const available: string[] = [];
    for (const lang of ['ko', 'en']) {
      try {
        const segs = await fetchViaProxies(videoId, lang);
        if (segs && segs.length > 0) available.push(lang);
      } catch {
        // A proxy that cannot answer is not evidence the language is missing.
      }
    }
    logger.info('Available languages detected', { videoId, languages: available });
    return { videoId, languages: available };
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
