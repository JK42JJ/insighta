/**
 * Source 1 (40% slot) — yt-dlp trending feed.
 *
 *   yt-dlp --flat-playlist --print id "https://www.youtube.com/feed/trending"
 *
 * The trending feed is region-specific via geo-bypass. We pull KR + US
 * trending lists; for KR we set `--geo-bypass-country=KR`. yt-dlp must
 * route through the WebShare rotating proxy or YouTube bot-gates within
 * minutes (CP401/CP411 LEVEL-2 lesson).
 */

import { spawn } from 'node:child_process';

import type { SourceResult } from './types';

interface TrendingOptions {
  ytdlpBin: string;
  webshareProxy: string;
  limitPerRegion: number;
  timeoutMs: number;
}

function runYtdlpFlatPlaylist(
  url: string,
  opts: TrendingOptions,
  geoCountry: string | null,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '--flat-playlist',
      '--print',
      'id',
      '--proxy',
      opts.webshareProxy,
      '--socket-timeout',
      '15',
      '--playlist-end',
      String(opts.limitPerRegion),
    ];
    if (geoCountry) args.push('--geo-bypass-country', geoCountry);
    args.push(url);
    const child = spawn(opts.ytdlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const t = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`yt-dlp exit ${code}: ${stderr.slice(0, 300)}`));
      const ids = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      resolve(ids);
    });
    child.on('error', reject);
  });
}

export async function collectYtdlpTrending(opts: TrendingOptions): Promise<SourceResult> {
  const url = 'https://www.youtube.com/feed/trending';
  const errors: string[] = [];
  let krIds: string[] = [];
  let usIds: string[] = [];
  try {
    krIds = await runYtdlpFlatPlaylist(url, opts, 'KR');
  } catch (e) {
    errors.push(`KR: ${(e as Error).message}`);
  }
  try {
    usIds = await runYtdlpFlatPlaylist(url, opts, 'US');
  } catch (e) {
    errors.push(`US: ${(e as Error).message}`);
  }
  const dedup = Array.from(new Set([...krIds, ...usIds]));
  return {
    source: 'ytdlp_trending',
    videos: [],
    videoIdsOnly: dedup,
    diagnostics: {
      kr_count: krIds.length,
      us_count: usIds.length,
      dedup_count: dedup.length,
      errors,
    },
  };
}
