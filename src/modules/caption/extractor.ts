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

// Dynamic import: youtube-transcript is ESM-only, CJS require() fails in production
async function loadFetchTranscript() {
  const mod = await import('youtube-transcript');
  return mod.fetchTranscript;
}
import { logger } from '../../utils/logger';
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
    // Language priority: explicit → en → ko → any available
    const LANG_PRIORITY = language ? [language] : ['en', 'ko'];

    try {
      let segments: CaptionSegment[] = [];
      let resolvedLang = LANG_PRIORITY[0]!;

      for (const lang of LANG_PRIORITY) {
        logger.info('Extracting captions', { videoId: youtubeId, language: lang });

        try {
          const transcript = await (await loadFetchTranscript())(youtubeId, { lang });
          if (transcript && transcript.length > 0) {
            segments = transcript.map((item) => ({
              text: item.text,
              start: item.offset / 1000,
              duration: item.duration / 1000,
            }));
            resolvedLang = lang;
            break;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn('youtube-transcript failed', { youtubeId, lang, error: errMsg });
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
