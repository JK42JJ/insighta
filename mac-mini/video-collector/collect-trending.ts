/**
 * Mac Mini video-collector orchestrator (CP438, 2026-04-29).
 *
 * Runs ON the Mac Mini. Pulls candidate YouTube video IDs from 4 sources,
 * enriches metadata via YouTube Data API, and POSTs in batches to the
 * Insighta `/api/v1/internal/videos/bulk-upsert` endpoint where the
 * server-side quality gate filters short / blocklisted / out-of-duration
 * rows and dedupes against existing youtube_videos.
 *
 * Source mix (CP438 spec §5.1, target 175 videos/run):
 *   - 40% (70) — yt-dlp trending feed (KR + US)
 *   - 25% (44) — Naver DataLab; Google Trends fallback when insufficient
 *   - 20% (35) — YouTube Data API mostPopular (KR + US)
 *   - 15% (26) — 9-domain × 5 trendy seed keywords (top 50% per cell)
 *
 * Hard Rules:
 *   - NO LLM API call from this script.
 *   - yt-dlp MUST route through WebShare rotating proxy (CP401/CP411
 *     LEVEL-2 — direct YouTube traffic bot-gates within minutes).
 *   - Mandala-derived collection is permanently excluded; this collector
 *     is the source-of-truth for new pool entries.
 *
 * Usage:
 *   cd /path/to/insighta-repo
 *   npx tsx mac-mini/video-collector/collect-trending.ts
 *
 * Env (read from process.env — set via .env or shell export):
 *   INSIGHTA_API_URL          (default: https://insighta.one)
 *   INTERNAL_BATCH_TOKEN      (required — same secret as transcript path)
 *   YOUTUBE_API_KEY           (required — server key, mostPopular + enrich)
 *   NAVER_CLIENT_ID           (required for Source 2 primary)
 *   NAVER_CLIENT_SECRET       (required for Source 2 primary)
 *   WEBSHARE_HOST             (required for yt-dlp paths)
 *   WEBSHARE_PORT             (required)
 *   WEBSHARE_USERNAME         (required)
 *   WEBSHARE_PASSWORD         (required)
 *   YTDLP_BIN                 (default: /opt/homebrew/bin/yt-dlp)
 *   UV_BIN                    (default: /opt/homebrew/bin/uv)
 *   UV_PROJECT_DIR            (default: /Users/jamesjk/code/video-dictionary)
 *   COLLECT_TARGET_TOTAL      (default: 175)
 *   COLLECT_DRY_RUN           (default: 0 — when 1, skip POST)
 */

import { collectYtdlpTrending } from './sources/ytdlp-trending';
import { collectMostPopular } from './sources/youtube-mostpopular';
import { collectDomainKeywords } from './sources/domain-keywords';
import { collectNaverDataLab } from './sources/naver-datalab';
import { collectGoogleTrends } from './sources/google-trends-spawn';
import { fetchVideoMetadata } from './sources/youtube-metadata';
import { pConcurrencyMap } from './sources/concurrency';
import type { VideoMeta } from './sources/types';
import { spawn } from 'node:child_process';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const POST_BATCH_SIZE = 200;
const NAVER_FALLBACK_THRESHOLD = 8; // < 8 keywords → trigger Google Trends fallback

interface EnvConfig {
  apiUrl: string;
  internalToken: string;
  youtubeApiKey: string;
  naverClientId: string | null;
  naverClientSecret: string | null;
  webshareProxy: string;
  ytdlpBin: string;
  uvBin: string;
  uvProjectDir: string;
  targetTotal: number;
  dryRun: boolean;
  s2Concurrency: number;
  s4Concurrency: number;
}

function readEnv(): EnvConfig {
  const get = (key: string) => process.env[key];
  const required = (key: string): string => {
    const v = get(key);
    if (!v) throw new Error(`Missing required env: ${key}`);
    return v;
  };
  const wsHost = required('WEBSHARE_HOST');
  const wsPort = required('WEBSHARE_PORT');
  const wsUser = required('WEBSHARE_USERNAME');
  const wsPass = required('WEBSHARE_PASSWORD');
  return {
    apiUrl: get('INSIGHTA_API_URL') ?? 'https://insighta.one',
    internalToken: required('INTERNAL_BATCH_TOKEN'),
    youtubeApiKey: required('YOUTUBE_API_KEY'),
    naverClientId: get('NAVER_CLIENT_ID') ?? null,
    naverClientSecret: get('NAVER_CLIENT_SECRET') ?? null,
    webshareProxy: `http://${wsUser}:${wsPass}@${wsHost}:${wsPort}`,
    ytdlpBin: get('YTDLP_BIN') ?? '/opt/homebrew/bin/yt-dlp',
    uvBin: get('UV_BIN') ?? '/opt/homebrew/bin/uv',
    uvProjectDir: get('UV_PROJECT_DIR') ?? '/Users/jamesjk/code/video-dictionary',
    targetTotal: parseInt(get('COLLECT_TARGET_TOTAL') ?? '1000', 10),
    dryRun: get('COLLECT_DRY_RUN') === '1',
    s2Concurrency: parseInt(get('S2_CONCURRENCY') ?? '10', 10),
    s4Concurrency: parseInt(get('S4_CONCURRENCY') ?? '10', 10),
  };
}

function ytsearchYtdlp(
  keyword: string,
  resultsN: number,
  ytdlpBin: string,
  webshareProxy: string,
  timeoutMs: number,
): Promise<string[]> {
  return new Promise((resolve) => {
    const url = `ytsearch${resultsN}:${keyword}`;
    const args = [
      '--flat-playlist',
      '--print',
      'id',
      '--proxy',
      webshareProxy,
      '--socket-timeout',
      '15',
      url,
    ];
    const child = spawn(ytdlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', () => {
      clearTimeout(t);
      const ids = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      resolve(ids);
    });
    child.on('error', () => {
      clearTimeout(t);
      resolve([]);
    });
  });
}

async function postBatch(
  apiUrl: string,
  token: string,
  videos: VideoMeta[],
): Promise<{ status: number; body: unknown }> {
  const url = `${apiUrl.replace(/\/$/, '')}/api/v1/internal/videos/bulk-upsert`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-internal-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ videos }),
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

async function main(): Promise<void> {
  const env = readEnv();
  const target = env.targetTotal;
  const budgets = {
    ytdlpTrending: Math.round(target * 0.4),
    naverGT: Math.round(target * 0.25),
    mostPopular: Math.round(target * 0.2),
    domainKeywords: target - Math.round(target * 0.4) - Math.round(target * 0.25) - Math.round(target * 0.2),
  };

  console.log(
    '[collect-trending] target=%d s2_conc=%d s4_conc=%d budgets=%o',
    target,
    env.s2Concurrency,
    env.s4Concurrency,
    budgets,
  );

  // Source 1 — yt-dlp trending feed (KR + US, dedup'd).
  // limitPerRegion is overshot 25% to absorb cross-region dedup; the
  // trending feed cap is YouTube-side (~200 ids per region max).
  const s1 = await collectYtdlpTrending({
    ytdlpBin: env.ytdlpBin,
    webshareProxy: env.webshareProxy,
    limitPerRegion: Math.min(200, Math.ceil((budgets.ytdlpTrending / 2) * 1.25)),
    timeoutMs: 60_000,
  });
  console.log('[s1 ytdlp_trending] %o', s1.diagnostics);

  // Source 2 — Naver DataLab (primary), Google Trends (fallback)
  const here = dirname(fileURLToPath(import.meta.url));
  let s2Keywords: string[] = [];
  let s2Diagnostics: Record<string, unknown> = {};
  if (env.naverClientId && env.naverClientSecret) {
    const naver = await collectNaverDataLab({
      clientId: env.naverClientId,
      clientSecret: env.naverClientSecret,
      topN: 4,
    });
    s2Keywords = naver.keywords;
    s2Diagnostics = { naver: naver.diagnostics };
  } else {
    s2Diagnostics = { naver: 'credentials_missing' };
  }
  if (s2Keywords.length < NAVER_FALLBACK_THRESHOLD) {
    const gt = await collectGoogleTrends({
      uvBin: env.uvBin,
      uvProjectDir: env.uvProjectDir,
      countries: ['KR', 'US'],
      timeoutMs: 45_000,
    });
    s2Keywords.push(...gt.keywords);
    s2Diagnostics = { ...s2Diagnostics, google_trends: gt.diagnostics };
  }
  // Run yt-dlp search per keyword (concurrency=env.s2Concurrency).
  const perKw = Math.max(2, Math.ceil(budgets.naverGT / Math.max(1, s2Keywords.length)));
  const s2Per = await pConcurrencyMap(s2Keywords, env.s2Concurrency, async (kw) =>
    ytsearchYtdlp(kw, perKw, env.ytdlpBin, env.webshareProxy, 30_000),
  );
  const s2Ids: string[] = s2Per.flat();
  const s2Dedup = Array.from(new Set(s2Ids));
  console.log('[s2 naver+gt] keywords=%d ids=%d (dedup) %o', s2Keywords.length, s2Dedup.length, s2Diagnostics);

  // Source 3 — YouTube mostPopular (full metadata in result).
  // mostPopular is hard-capped at 50 results per call; for budgets > 100
  // we still pull 50 per region (KR + US = 100 max). Server-side dedupe
  // handles overflow.
  const s3 = await collectMostPopular({
    apiKey: env.youtubeApiKey,
    maxResultsPerRegion: 50,
    regions: ['KR', 'US'],
  });
  console.log('[s3 mostPopular] %o', s3.diagnostics);

  // Source 4 — 9-domain × 5 keyword search (top 50% per cell, concurrency=env.s4Concurrency).
  // For TARGET_TOTAL=1000 the budget is 150; with searchPerKeyword=10 (top 5)
  // and 45 keywords we collect ~225 raw, dedup to ~180 — covers budget with margin.
  const s4SearchPerKw = budgets.domainKeywords > 100 ? 10 : 4;
  const s4 = await collectDomainKeywords({
    ytdlpBin: env.ytdlpBin,
    webshareProxy: env.webshareProxy,
    searchPerKeyword: s4SearchPerKw,
    timeoutMs: 30_000,
    keywordsFile: resolvePath(here, 'keyword-templates.json'),
    concurrency: env.s4Concurrency,
  });
  console.log('[s4 domain_keywords] %o', { ...s4.diagnostics, per_keyword: '<omitted>' });

  // Aggregate bare IDs (Source 1 + 2 + 4) and trim to per-source budgets.
  const trim = (ids: string[], n: number) => ids.slice(0, n);
  const s1Take = trim(s1.videoIdsOnly, budgets.ytdlpTrending);
  const s2Take = trim(s2Dedup, budgets.naverGT);
  const s4Take = trim(s4.videoIdsOnly, budgets.domainKeywords);
  const s3Videos = s3.videos.slice(0, budgets.mostPopular);

  // Dedup across sources (keep first occurrence — priority s3 > s1 > s2 > s4
  // is decided by insertion order below).
  const dedupSet = new Set<string>(s3Videos.map((v) => v.youtube_video_id));
  const idsToEnrich = [...s1Take, ...s2Take, ...s4Take].filter((id) => {
    if (dedupSet.has(id)) return false;
    dedupSet.add(id);
    return true;
  });

  // Enrich bare IDs via YouTube Data API.
  let enriched: VideoMeta[] = [];
  if (idsToEnrich.length > 0) {
    enriched = await fetchVideoMetadata(idsToEnrich, env.youtubeApiKey);
  }
  const allVideos: VideoMeta[] = [...s3Videos, ...enriched];

  console.log(
    '[aggregate] s1=%d s2=%d s3=%d s4=%d → enrich_input=%d enriched=%d total=%d',
    s1Take.length,
    s2Take.length,
    s3Videos.length,
    s4Take.length,
    idsToEnrich.length,
    enriched.length,
    allVideos.length,
  );

  if (env.dryRun) {
    console.log('[dry-run] skipping POST. first 3:', allVideos.slice(0, 3));
    return;
  }

  // POST in batches.
  const summary = { posted: 0, inserted: 0, skipped_filter: 0, skipped_duplicate: 0, db_errors: 0 };
  for (let i = 0; i < allVideos.length; i += POST_BATCH_SIZE) {
    const chunk = allVideos.slice(i, i + POST_BATCH_SIZE);
    const result = await postBatch(env.apiUrl, env.internalToken, chunk);
    if (result.status !== 200) {
      console.error(`[post] batch ${i / POST_BATCH_SIZE} status=${result.status}`, result.body);
      continue;
    }
    const body = result.body as Record<string, number>;
    summary.posted += chunk.length;
    summary.inserted += body['inserted'] ?? 0;
    summary.skipped_filter += body['skipped_filter'] ?? 0;
    summary.skipped_duplicate += body['skipped_duplicate'] ?? 0;
    summary.db_errors += body['db_errors'] ?? 0;
    console.log(`[post] batch ${i / POST_BATCH_SIZE}`, body);
  }

  console.log('[done]', summary);
}

main().catch((err) => {
  console.error('[collect-trending] fatal:', err);
  process.exit(1);
});
