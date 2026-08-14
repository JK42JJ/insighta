/**
 * Language-routed web-search client — drop-in for the Google CSE client
 * contract (`searchWeb(query, opts) → { items, totalResults, error? }`), so
 * book-research/book-factcheck swap without call-site changes.
 *
 * Routing (benchmark-driven, 2026-07-14):
 *  - query contains Hangul → Naver Open API. webkr first; when webkr comes up
 *    short the news + encyc verticals fill in (the benchmark's failed 24%
 *    were stats/research-flavored queries that news/academic coverage owns).
 *  - otherwise (en/ja/zh) → OpenRouter web plugin (Exa engine): annotations
 *    carry real page extracts + direct URLs (citable evidence).
 *
 * No cross-provider fallback in v1: a Korean query that Naver can't evidence
 * is dropped, not padded with an unbenchmarked Exa-Korean result ("근거 없으면
 * 드랍" — bad evidence is worse than none).
 *
 * Never throws — errors are surfaced via `.error` (mirrors CSE client).
 */

import { logger } from '@/utils/logger';
import type { WebSearchConfig } from './config';

const log = logger.child({ module: 'web-search' });

export interface WebSearchItem {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

export interface WebSearchResult {
  items: WebSearchItem[];
  totalResults: number;
  error?: string;
}

export interface SearchWebOptions {
  /** Number of results to return. Default 3 (evidence top-k). */
  num?: number;
}

const NAVER_BASE = 'https://openapi.naver.com/v1/search';
/** webkr misses stats/research queries; these verticals backfill. */
const NAVER_FALLBACK_VERTICALS = ['news', 'encyc'] as const;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 10_000;
const OPENROUTER_TIMEOUT_MS = 30_000;
/** Evidence needs a quotable extract — drop garbled/empty plugin snippets. */
const MIN_SNIPPET_LEN = 20;

export function hasHangul(text: string): boolean {
  return /[가-힣]/.test(text);
}

/** Strip Naver's <b> match-highlight tags + basic entities. */
export function stripNaverMarkup(s: string): string {
  return s
    .replace(/<\/?b>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

interface NaverRawItem {
  title?: string;
  link?: string;
  description?: string;
}

/** Extract OpenRouter web-plugin url_citation annotations into items. */
export function parseOpenRouterAnnotations(body: unknown, num: number): WebSearchItem[] {
  const choices = (body as { choices?: Array<{ message?: { annotations?: unknown[] } }> })?.choices;
  const annotations = choices?.[0]?.message?.annotations ?? [];
  const items: WebSearchItem[] = [];
  for (const a of annotations) {
    const cite = (a as { url_citation?: { url?: string; title?: string; content?: string } })
      .url_citation;
    if (!cite?.url) continue;
    const snippet = String(cite.content ?? '').trim();
    if (snippet.length < MIN_SNIPPET_LEN) continue;
    items.push({
      title: String(cite.title ?? '').trim() || hostnameOf(cite.url),
      link: cite.url,
      snippet: snippet.slice(0, 500),
      displayLink: hostnameOf(cite.url),
    });
    if (items.length >= num) break;
  }
  return items;
}

export function createWebSearchClient(config: WebSearchConfig) {
  async function searchNaverVertical(vertical: string, query: string, num: number) {
    const url = `${NAVER_BASE}/${vertical}.json?display=${num}&query=${encodeURIComponent(query)}`;
    const json = (await fetchJsonWithTimeout(
      url,
      {
        headers: {
          'X-Naver-Client-Id': config.naverClientId,
          'X-Naver-Client-Secret': config.naverClientSecret,
        },
      },
      TIMEOUT_MS
    )) as { items?: NaverRawItem[]; total?: number };
    const items: WebSearchItem[] = (json.items ?? [])
      .filter((it) => it.link)
      .map((it) => ({
        title: stripNaverMarkup(it.title ?? ''),
        link: it.link ?? '',
        snippet: stripNaverMarkup(it.description ?? ''),
        displayLink: hostnameOf(it.link ?? ''),
      }));
    return { items, total: json.total ?? items.length };
  }

  async function searchNaver(query: string, num: number): Promise<WebSearchResult> {
    try {
      const web = await searchNaverVertical('webkr', query, num);
      const merged = [...web.items];
      const seen = new Set(merged.map((i) => i.link));
      for (const vertical of NAVER_FALLBACK_VERTICALS) {
        if (merged.length >= num) break;
        const extra = await searchNaverVertical(vertical, query, num);
        for (const it of extra.items) {
          if (merged.length >= num) break;
          if (!seen.has(it.link)) {
            seen.add(it.link);
            merged.push(it);
          }
        }
      }
      log.debug(`naver OK: query="${query}" count=${merged.length}`);
      return { items: merged.slice(0, num), totalResults: web.total };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`naver search failed: ${message}`, { query });
      return { items: [], totalResults: 0, error: `naver: ${message}` };
    }
  }

  async function searchGlobal(query: string, num: number): Promise<WebSearchResult> {
    try {
      const body = await fetchJsonWithTimeout(
        OPENROUTER_URL,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.openrouterApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.openrouterWebModel,
            plugins: [{ id: 'web', max_results: num }],
            messages: [
              {
                role: 'user',
                content: `Search the web for: ${query}\nSummarize the key facts briefly.`,
              },
            ],
          }),
        },
        OPENROUTER_TIMEOUT_MS
      );
      const items = parseOpenRouterAnnotations(body, num);
      log.debug(`openrouter-web OK: query="${query}" count=${items.length}`);
      return { items, totalResults: items.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`openrouter web search failed: ${message}`, { query });
      return { items: [], totalResults: 0, error: `openrouter-web: ${message}` };
    }
  }

  /**
   * CSE-contract search. Routes by query language; a leg that is not
   * configured returns a `.error` result (caller treats as no evidence).
   */
  async function searchWeb(query: string, opts: SearchWebOptions = {}): Promise<WebSearchResult> {
    const num = Math.min(Math.max(opts.num ?? 3, 1), 10);
    if (hasHangul(query)) {
      if (!config.naverEnabled) {
        return { items: [], totalResults: 0, error: 'web-search: naver leg not configured' };
      }
      return searchNaver(query, num);
    }
    if (!config.globalEnabled) {
      return { items: [], totalResults: 0, error: 'web-search: global leg not configured' };
    }
    return searchGlobal(query, num);
  }

  return { searchWeb };
}
