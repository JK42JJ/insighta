/**
 * Mac Mini video-collector orchestrator (CP438, 2026-04-29).
 *
 * Runs ON the Mac Mini. Pulls candidate YouTube video IDs from 4 sources,
 * enriches metadata via YouTube Data API, and POSTs in batches to the
 * Insighta `/api/v1/internal/videos/bulk-upsert` endpoint where the
 * server-side quality gate filters short / blocklisted / out-of-duration
 * rows and dedupes against existing youtube_videos.
 *
 * Source mix (CP438 spec §5.1, default target 1000 videos/run):
 *   - 40% (400) — YT Data API mostPopular per categoryId × 2 regions
 *                 (replaces deprecated yt-dlp /feed/trending)
 *   - 25% (250) — Naver DataLab → keyword search via yt-dlp
 *                 (Google Trends fallback retired — pytrends 404)
 *   - 20% (200) — YT Data API mostPopular (generic, KR + US)
 *   - 15% (150) — 9-domain × 5 trendy seed keywords (top 50% per cell)
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
 *   COLLECT_TARGET_TOTAL      (default: 1000)
 *   COLLECT_DRY_RUN           (default: 0 — when 1, skip POST)
 *   S2_CONCURRENCY            (default: 10)
 *   S4_CONCURRENCY            (default: 10)
 */

import { collectCategoryMostPopular } from './sources/mostpopular-by-category';
import { collectMostPopular } from './sources/youtube-mostpopular';
import { collectDomainKeywords } from './sources/domain-keywords';
import { collectNaverDataLab } from './sources/naver-datalab';
import { fetchVideoMetadata } from './sources/youtube-metadata';
import { pConcurrencyMap } from './sources/concurrency';
import type { VideoMeta } from './sources/types';
import { spawn } from 'node:child_process';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const POST_BATCH_SIZE = 200;
const S1_CATEGORY_CONCURRENCY = 5;

interface EnvConfig {
  apiUrl: string;
  internalToken: string;
  youtubeApiKey: string;
  naverClientId: string | null;
  naverClientSecret: string | null;
  webshareProxy: string;
  ytdlpBin: string;
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
    categoryMostPopular: Math.round(target * 0.4),
    naver: Math.round(target * 0.25),
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

  // Source 1 — categoryId iteration of YT Data API mostPopular (CP438
  // smoke fix: replaces deprecated yt-dlp /feed/trending). 10 categories
  // × 2 regions × 50 results = 1000 raw → ~400-600 unique after dedupe.
  const s1 = await collectCategoryMostPopular({
    apiKey: env.youtubeApiKey,
    regions: ['KR', 'US'],
    maxResultsPerCall: 50,
    concurrency: S1_CATEGORY_CONCURRENCY,
  });
  console.log('[s1 category_mostpopular] dedup=%d errors=%d',
    (s1.diagnostics as Record<string, number>)['dedup_count'],
    Array.isArray((s1.diagnostics as Record<string, unknown>)['errors'])
      ? ((s1.diagnostics as Record<string, unknown>)['errors'] as unknown[]).length
      : 0,
  );

  // Source 2 — Naver DataLab (CP438: Google Trends fallback retired —
  // pytrends `trending_searches` 404 since the API change. If Naver
  // returns empty, S2 yields 0 and the budget is absorbed by the other
  // sources via dedupe; the orchestrator does NOT block on S2.)
  const here = dirname(fileURLToPath(import.meta.url));
  let s2Keywords: string[] = [];
  let s2Diagnostics: Record<string, unknown> = {};
  if (env.naverClientId && env.naverClientSecret) {
    // topN=9 → all 9 Insighta domains covered (CP438 smoke 2: top4 left
    // 5 domains unrepresented in S2, hurting cross-domain diversity).
    const naver = await collectNaverDataLab({
      clientId: env.naverClientId,
      clientSecret: env.naverClientSecret,
      topN: 9,
    });
    s2Keywords = naver.keywords;
    s2Diagnostics = { naver: naver.diagnostics };
  } else {
    s2Diagnostics = { naver: 'credentials_missing' };
  }
  // Run yt-dlp search per keyword (concurrency=env.s2Concurrency).
  const perKw = Math.max(2, Math.ceil(budgets.naver / Math.max(1, s2Keywords.length)));
  const s2Per = await pConcurrencyMap(s2Keywords, env.s2Concurrency, async (kw) =>
    ytsearchYtdlp(kw, perKw, env.ytdlpBin, env.webshareProxy, 30_000),
  );
  const s2Ids: string[] = s2Per.flat();
  const s2Dedup = Array.from(new Set(s2Ids));
  console.log('[s2 naver] keywords=%d ids=%d (dedup) %o', s2Keywords.length, s2Dedup.length, s2Diagnostics);

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

  // Aggregate. S1 and S3 return full metadata directly; S2 and S4
  // return bare IDs that need enrichment via videos.list. Trim each
  // source to its budget; cross-source dedupe keeps first occurrence.
  const trim = <T>(arr: readonly T[], n: number): T[] => arr.slice(0, n);
  const s1Videos = trim(s1.videos, budgets.categoryMostPopular);
  const s3Videos = trim(s3.videos, budgets.mostPopular);
  const s2Take = trim(s2Dedup, budgets.naver);
  const s4Take = trim(s4.videoIdsOnly, budgets.domainKeywords);

  // Insertion order = priority. s1+s3 first (full metadata, dedupe
  // basis); s2+s4 IDs filtered to non-overlap, then enriched.
  const seen = new Set<string>();
  const directVideos: VideoMeta[] = [];
  for (const v of [...s1Videos, ...s3Videos]) {
    if (seen.has(v.youtube_video_id)) continue;
    seen.add(v.youtube_video_id);
    directVideos.push(v);
  }
  const idsToEnrich = [...s2Take, ...s4Take].filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  let enriched: VideoMeta[] = [];
  if (idsToEnrich.length > 0) {
    enriched = await fetchVideoMetadata(idsToEnrich, env.youtubeApiKey);
  }
  const allVideos: VideoMeta[] = [...directVideos, ...enriched];

  console.log(
    '[aggregate] s1=%d s2=%d s3=%d s4=%d → direct=%d enrich_input=%d enriched=%d total=%d',
    s1Videos.length,
    s2Take.length,
    s3Videos.length,
    s4Take.length,
    directVideos.length,
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
