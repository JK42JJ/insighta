/**
 * Caption Extractor
 *
 * Extracts captions/subtitles from YouTube videos (in-memory only).
 * Primary: youtube-transcript npm (Innertube API + web scraping)
 * Fallback: yt-dlp CLI (requires system install)
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
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from '../../utils/logger';
import type {
  CaptionSegment,
  CaptionMetadata,
  CaptionExtractionResult,
  AvailableLanguages,
} from './types';

const YT_DLP_TIMEOUT_MS = 30_000;

// --------------------------------------------------------------------------
// JSON3 parser (for yt-dlp output)
// --------------------------------------------------------------------------

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

function parseJson3(body: string): CaptionSegment[] {
  const data: { events?: Json3Event[] } = JSON.parse(body);
  if (!data.events) return [];

  const segments: CaptionSegment[] = [];
  for (const ev of data.events) {
    if (!ev.segs) continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .trim();
    if (!text) continue;
    segments.push({
      text,
      start: (ev.tStartMs ?? 0) / 1000,
      duration: (ev.dDurationMs ?? 0) / 1000,
    });
  }
  return segments;
}

// --------------------------------------------------------------------------
// Caption Extractor Service (in-memory only, no DB persistence)
// --------------------------------------------------------------------------

export class CaptionExtractor {
  /**
   * Extract captions for a video (in-memory only).
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
      let source = '';
      let resolvedLang = LANG_PRIORITY[0]!;

      // Try each language in priority order
      for (const lang of LANG_PRIORITY) {
        logger.info('Extracting captions (in-memory)', { videoId: youtubeId, language: lang });

        // Primary: youtube-transcript
        try {
          const transcript = await (await loadFetchTranscript())(youtubeId, { lang });
          if (transcript && transcript.length > 0) {
            segments = transcript.map((item) => ({
              text: item.text,
              start: item.offset / 1000,
              duration: item.duration / 1000,
            }));
            source = 'youtube-transcript';
            resolvedLang = lang;
            break;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn('youtube-transcript failed', { youtubeId, lang, error: errMsg });
        }

        // Fallback: yt-dlp CLI
        try {
          logger.info('Falling back to yt-dlp', { youtubeId, lang });
          const dlpSegments = await this.extractWithYtDlp(youtubeId, lang);
          if (dlpSegments.length > 0) {
            segments = dlpSegments;
            source = 'yt-dlp';
            resolvedLang = lang;
            break;
          }
        } catch (err) {
          logger.warn('yt-dlp failed', {
            youtubeId,
            lang,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Final fallback: Supabase fetch-transcript Edge Function (residential proxy)
      if (segments.length === 0) {
        try {
          logger.info('Falling back to fetch-transcript EF (residential proxy)', { youtubeId });
          const efResult = await this.extractViaEdgeFunction(youtubeId);
          if (efResult.length > 0) {
            segments = efResult;
            source = 'edge-function';
            resolvedLang = LANG_PRIORITY[0]!;
          }
        } catch (err) {
          logger.warn('fetch-transcript EF failed', {
            youtubeId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (segments.length === 0) {
        throw new Error('No captions found (youtube-transcript + yt-dlp + EF all failed)');
      }

      logger.info('Captions fetched (in-memory only)', {
        youtubeId,
        segments: segments.length,
        source,
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
  // Supabase fetch-transcript Edge Function fallback (residential proxy)
  // --------------------------------------------------------------------------

  private async extractViaEdgeFunction(videoId: string): Promise<CaptionSegment[]> {
    const supabaseUrl = process.env['SUPABASE_URL'];
    const anonKey = process.env['SUPABASE_ANON_KEY'];

    if (!supabaseUrl || !anonKey) {
      throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY not configured');
    }

    const efUrl = `${supabaseUrl}/functions/v1/fetch-transcript`;
    const resp = await fetch(efUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ videoId }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`EF fetch-transcript HTTP ${resp.status}: ${text}`);
    }

    const data = (await resp.json()) as {
      video_id?: string;
      full_text?: string;
      segments?: number;
      error?: string;
    };

    if (!data.full_text || !data.segments) {
      throw new Error(data.error || 'Empty transcript from EF');
    }

    // EF returns aggregated full_text + segment count, convert to single segment
    return [
      {
        text: data.full_text,
        start: 0,
        duration: 0,
      },
    ];
  }

  // --------------------------------------------------------------------------
  // yt-dlp CLI fallback
  // --------------------------------------------------------------------------

  private async extractWithYtDlp(videoId: string, language: string): Promise<CaptionSegment[]> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytdlp-'));
    const outputTemplate = path.join(tmpDir, '%(id)s');
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          'yt-dlp',
          [
            '--write-sub',
            '--write-auto-sub',
            '--sub-lang',
            language,
            '--sub-format',
            'json3',
            '--skip-download',
            '-o',
            outputTemplate,
            url,
          ],
          { timeout: YT_DLP_TIMEOUT_MS },
          (error) => {
            if (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                reject(
                  new Error(
                    'yt-dlp not found. Install: brew install yt-dlp (macOS) or pip install yt-dlp (Linux)'
                  )
                );
              } else {
                reject(error);
              }
            } else {
              resolve();
            }
          }
        );
      });

      const files = await fs.readdir(tmpDir);
      const subFile = files.find((f) => f.endsWith('.json3') && f.includes(videoId));
      if (!subFile) {
        throw new Error('yt-dlp produced no subtitle file');
      }

      const content = await fs.readFile(path.join(tmpDir, subFile), 'utf-8');
      return parseJson3(content);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
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
