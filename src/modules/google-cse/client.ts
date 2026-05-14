/**
 * Google Custom Search Engine (CSE) HTTP client.
 *
 * CP458 T4-1 PoC — web search fallback for video_pool sparse-domain mandalas.
 * Search results are web pages (URL + title + snippet), NOT YouTube videos.
 * Integration into video_pool is a separate follow-up PR.
 *
 * Usage:
 *   const cse = createGoogleCseClient(googleCseConfig);
 *   const result = await cse.searchWeb('KBO 2026 드래프트', { num: 10 });
 */

import { logger } from '@/utils/logger';
import type { GoogleCseConfig } from './config';

const log = logger.child({ module: 'google-cse/client' });

/** A single web-search result item from the CSE API. */
export interface CseItem {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

/** Return shape for searchWeb — never throws; errors are surfaced via `error`. */
export interface CseSearchResult {
  items: CseItem[];
  totalResults: number;
  error?: string;
}

export interface SearchWebOptions {
  /** Number of results to return. CSE max = 10 per request. Default 10. */
  num?: number;
  /** Safe search level. Default 'off'. */
  safe?: 'active' | 'off';
}

const CSE_BASE_URL = 'https://www.googleapis.com/customsearch/v1';
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 1;

/**
 * Create a Google CSE client bound to the provided config.
 * Returns an object with a single `searchWeb` method.
 * Gracefully returns empty result when config.enabled is false.
 */
export function createGoogleCseClient(config: GoogleCseConfig) {
  /**
   * Execute a web search via Google CSE.
   *
   * @param query - Search query string.
   * @param opts  - Optional parameters (num, safe).
   * @returns CseSearchResult — never throws; errors are in `.error`.
   */
  async function searchWeb(query: string, opts: SearchWebOptions = {}): Promise<CseSearchResult> {
    if (!config.enabled) {
      return { items: [], totalResults: 0, error: 'google-cse not configured' };
    }

    const num = Math.min(opts.num ?? 10, 10); // CSE hard cap = 10
    const safe = opts.safe ?? 'off';

    const url = new URL(CSE_BASE_URL);
    url.searchParams.set('key', config.apiKey);
    url.searchParams.set('cx', config.cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(num));
    url.searchParams.set('safe', safe);

    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetch(url.toString(), { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          log.warn(
            `CSE API error: status=${response.status} query="${query}" body=${body.slice(0, 200)}`
          );
          if (response.status >= 500 && attempt < MAX_RETRIES) {
            attempt++;
            continue;
          }
          return {
            items: [],
            totalResults: 0,
            error: `CSE API HTTP ${response.status}`,
          };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await response.json();

        const items: CseItem[] = (json.items ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (item: any): CseItem => ({
            title: String(item.title ?? ''),
            link: String(item.link ?? ''),
            snippet: String(item.snippet ?? ''),
            displayLink: String(item.displayLink ?? ''),
          })
        );

        const totalResults = parseInt(json.searchInformation?.totalResults ?? '0', 10);

        log.debug(
          `CSE search OK: query="${query}" count=${items.length} totalResults=${totalResults}`
        );
        return { items, totalResults };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`CSE fetch error: query="${query}" attempt=${attempt} error=${message}`);
        if (attempt < MAX_RETRIES) {
          attempt++;
          continue;
        }
        return { items: [], totalResults: 0, error: message };
      }
    }

    // Should not reach here, but satisfy TypeScript
    return { items: [], totalResults: 0, error: 'unexpected loop exit' };
  }

  return { searchWeb };
}
