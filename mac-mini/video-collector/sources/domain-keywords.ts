/**
 * Source 4 (15% slot) — 9-domain × 5 trendy seed keywords.
 *
 * Reads `keyword-templates.json`, runs yt-dlp search per keyword, takes
 * top N/2 results (per CP438 spec §5.1: cell = keyword unit, top 50%).
 * yt-dlp must route through the WebShare proxy.
 *
 * Output: bare video IDs (orchestrator enriches via YouTube Data API).
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import type { SourceResult } from './types';

interface DomainKeywordsOptions {
  ytdlpBin: string;
  webshareProxy: string;
  /** Results-per-keyword from yt-dlp (we keep top 50%). */
  searchPerKeyword: number;
  timeoutMs: number;
  keywordsFile: string;
}

interface KeywordTemplate {
  domains: Record<string, string[]>;
}

function runYtdlpSearch(
  query: string,
  resultsN: number,
  opts: DomainKeywordsOptions,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const url = `ytsearch${resultsN}:${query}`;
    const args = [
      '--flat-playlist',
      '--print',
      'id',
      '--proxy',
      opts.webshareProxy,
      '--socket-timeout',
      '15',
      url,
    ];
    const child = spawn(opts.ytdlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const t = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`yt-dlp search exit ${code}: ${stderr.slice(0, 200)}`));
      const ids = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      resolve(ids);
    });
    child.on('error', reject);
  });
}

export async function collectDomainKeywords(
  opts: DomainKeywordsOptions,
): Promise<SourceResult> {
  const raw = readFileSync(resolvePath(opts.keywordsFile), 'utf8');
  const tmpl = JSON.parse(raw) as KeywordTemplate;
  const allIds: string[] = [];
  const perKeyword: Record<string, number> = {};
  const errors: string[] = [];
  const keepTop = Math.max(1, Math.floor(opts.searchPerKeyword / 2));

  for (const [domain, keywords] of Object.entries(tmpl.domains)) {
    for (const kw of keywords) {
      try {
        const ids = await runYtdlpSearch(kw, opts.searchPerKeyword, opts);
        const top = ids.slice(0, keepTop);
        allIds.push(...top);
        perKeyword[`${domain}:${kw}`] = top.length;
      } catch (e) {
        errors.push(`${domain}:${kw}: ${(e as Error).message}`);
        perKeyword[`${domain}:${kw}`] = 0;
      }
    }
  }
  const dedup = Array.from(new Set(allIds));
  return {
    source: 'domain_keywords',
    videos: [],
    videoIdsOnly: dedup,
    diagnostics: {
      keywords_total: Object.keys(perKeyword).length,
      results_pre_dedup: allIds.length,
      results_post_dedup: dedup.length,
      per_keyword: perKeyword,
      errors,
    },
  };
}
