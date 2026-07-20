/**
 * Curation interest profile — account signal collection + analysis (Growth Hub, 2026-07-20).
 * Design: docs/design/growth-hub-curation-personalized-2026-07-20.md (§2, §4, §8-B4).
 *
 * Collects the AVAILABLE YouTube personal signals (subscriptions + playlists +
 * saved playlist videos — watch history is NOT exposed by the Data API) and
 * derives a normalized interest vector [{kw, domain, weight}] via the existing
 * keyword extractor. Saved videos = explicit intent → outweigh subscriptions.
 *
 * Runs as an ASYNC job (never inside GET /curations/suggest — B4 latency), and
 * persists to curation_interest_profile (status building→ready). extractKeywordsBatch
 * hits an LLM (production-serving path); tests inject a mock via deps.
 */

import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database';
import {
  getUserSubscriptions,
  getUserPlaylists,
  getPlaylistItems,
  getVideosMetadata,
} from '@/modules/youtube/api';
import { extractKeywordsBatch } from '@/skills/plugins/trend-collector/sources/llm-extract';
import { mapKeywordToDomain, type CurationDomain } from './domain-taxonomy';
import {
  INTEREST_WEIGHTS,
  COLLECT_CAPS,
  KEYWORD_LEARNING_FLOOR,
  PROFILE_ERROR_RETRY_COOLDOWN_MS,
} from './config';

const log = logger.child({ module: 'curation/interest-profile' });

export interface InterestKeyword {
  kw: string;
  domain: CurationDomain;
  /** normalized [0,1] interest strength */
  weight: number;
}
export type InterestProfile = InterestKeyword[];

/** Titles collected from the account, tagged with their source weight. */
export interface AccountSignals {
  /** title → source weight (sub vs save); dedup keeps the strongest source */
  titleWeights: Map<string, number>;
  counts: { subscriptions: number; playlists: number; savedVideos: number };
}

/** Injectable deps — real YouTube/LLM/DB by default, mocked in tests. */
export interface InterestProfileDeps {
  getUserSubscriptions: typeof getUserSubscriptions;
  getUserPlaylists: typeof getUserPlaylists;
  getPlaylistItems: typeof getPlaylistItems;
  getVideosMetadata: typeof getVideosMetadata;
  extractKeywordsBatch: typeof extractKeywordsBatch;
}

const defaultDeps: InterestProfileDeps = {
  getUserSubscriptions,
  getUserPlaylists,
  getPlaylistItems,
  getVideosMetadata,
  extractKeywordsBatch,
};

/** Merge a title at `weight`, keeping the stronger source if it repeats. */
function addTitle(map: Map<string, number>, title: string, weight: number): void {
  const t = title.trim();
  if (t.length < 2) return;
  const prev = map.get(t);
  if (prev === undefined || weight > prev) map.set(t, weight);
}

/**
 * Collect the account's available interest titles, page-capped for quota safety.
 * Subscriptions + playlist labels → sub weight; saved playlist videos → save weight.
 */
export async function collectAccountSignals(
  userId: string,
  deps: InterestProfileDeps = defaultDeps
): Promise<AccountSignals> {
  const titleWeights = new Map<string, number>();
  let subCount = 0;
  let plCount = 0;
  let savedCount = 0;

  // Subscriptions (channel titles + descriptions) — passive interest.
  let pageToken: string | undefined;
  for (let page = 0; page < COLLECT_CAPS.subscriptionPages; page++) {
    const res = await deps.getUserSubscriptions(userId, pageToken);
    for (const s of res.items) {
      subCount++;
      addTitle(titleWeights, s.title, INTEREST_WEIGHTS.sub);
      if (s.description) addTitle(titleWeights, s.description.slice(0, 120), INTEREST_WEIGHTS.sub);
    }
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }

  // Playlists — labels (sub weight) + collect their saved videos (save weight).
  const playlistIds: string[] = [];
  pageToken = undefined;
  for (let page = 0; page < COLLECT_CAPS.playlistPages; page++) {
    const res = await deps.getUserPlaylists(userId, pageToken);
    for (const p of res.items) {
      plCount++;
      addTitle(titleWeights, p.title, INTEREST_WEIGHTS.sub);
      if (p.playlistId && playlistIds.length < COLLECT_CAPS.playlists)
        playlistIds.push(p.playlistId);
    }
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }

  // Saved videos inside playlists — explicit intent (save weight). Cap total.
  const savedVideoIds: string[] = [];
  for (const playlistId of playlistIds) {
    let plToken: string | undefined;
    for (let page = 0; page < COLLECT_CAPS.playlistItemPages; page++) {
      const res = await deps.getPlaylistItems(userId, playlistId, plToken);
      for (const it of res.items) {
        if (it.videoId && savedVideoIds.length < COLLECT_CAPS.savedVideos) {
          savedVideoIds.push(it.videoId);
        }
      }
      if (!res.nextPageToken || savedVideoIds.length >= COLLECT_CAPS.savedVideos) break;
      plToken = res.nextPageToken;
    }
    if (savedVideoIds.length >= COLLECT_CAPS.savedVideos) break;
  }
  if (savedVideoIds.length > 0) {
    const metas = await deps.getVideosMetadata(userId, savedVideoIds);
    for (const m of metas) {
      savedCount++;
      addTitle(titleWeights, m.title, INTEREST_WEIGHTS.save);
    }
  }

  return {
    titleWeights,
    counts: { subscriptions: subCount, playlists: plCount, savedVideos: savedCount },
  };
}

/**
 * Build the normalized interest vector from collected signals.
 * extractKeywordsBatch → aggregate per-keyword weight (by source) → learning gate
 * → domain tag → normalize to [0,1]. Pure over `deps`, so unit-testable.
 */
export async function buildInterestProfile(
  userId: string,
  deps: InterestProfileDeps = defaultDeps
): Promise<InterestProfile> {
  const signals = await collectAccountSignals(userId, deps);
  const titles = [...signals.titleWeights.keys()];
  if (titles.length === 0) return [];

  const extracted = await deps.extractKeywordsBatch({ titles });

  // kw → accumulated raw weight (source weight × per-title keywords, learning-gated).
  const raw = new Map<string, number>();
  for (const r of extracted) {
    if (r.learning_score < KEYWORD_LEARNING_FLOOR) continue;
    const w = signals.titleWeights.get(r.title) ?? INTEREST_WEIGHTS.sub;
    for (const kw of r.keywords) {
      const key = kw.trim().toLowerCase();
      if (key.length < 2) continue;
      raw.set(key, (raw.get(key) ?? 0) + w);
    }
  }
  if (raw.size === 0) return [];

  const max = Math.max(...raw.values());
  const profile: InterestProfile = [...raw.entries()]
    .map(([kw, weight]) => ({
      kw,
      domain: mapKeywordToDomain(kw),
      weight: Math.round((weight / max) * 100) / 100,
    }))
    .sort((a, b) => b.weight - a.weight);

  log.info('interest profile built', {
    userId,
    ...signals.counts,
    keywords: profile.length,
  });
  return profile;
}

/** Upsert the profile row (status ready + built_at). */
export async function persistInterestProfile(
  userId: string,
  profile: InterestProfile,
  status: 'ready' | 'error' = 'ready'
): Promise<void> {
  const prisma = getPrismaClient();
  const now = new Date();
  await prisma.curation_interest_profile.upsert({
    where: { user_id: userId },
    create: { user_id: userId, profile: profile as unknown as object, status, built_at: now },
    update: { profile: profile as unknown as object, status, built_at: now },
  });
}

/**
 * Kick off a profile build IF one isn't already ready/in-flight (fire-and-forget).
 * Called from GET /curations/suggest when the profile is not ready — the build
 * itself is async so the GET stays fast (B4). Idempotent-ish: skips if 'building'
 * or 'ready'. The proper trigger is YouTube-connect; this is the first-suggest fallback.
 */
export async function maybeTriggerProfileBuild(
  userId: string,
  deps: InterestProfileDeps = defaultDeps
): Promise<void> {
  const prisma = getPrismaClient();
  const row = await prisma.curation_interest_profile.findUnique({ where: { user_id: userId } });
  if (row && (row.status === 'building' || row.status === 'ready')) return;
  // Back off on a recently-errored build — otherwise every suggest poll re-fires a
  // doomed build (P1: token-less users, or a transient YouTube/LLM failure).
  if (
    row &&
    row.status === 'error' &&
    row.built_at &&
    Date.now() - row.built_at.getTime() < PROFILE_ERROR_RETRY_COOLDOWN_MS
  ) {
    return;
  }
  // mark building first so concurrent suggests don't double-fire, then run detached.
  await prisma.curation_interest_profile.upsert({
    where: { user_id: userId },
    create: { user_id: userId, profile: [], status: 'building' },
    update: { status: 'building' },
  });
  void buildAndPersistInterestProfile(userId, deps).catch(() => undefined);
}

/**
 * Full async job: mark building → build → persist ready (or error).
 * Triggered at YouTube connect (or first suggest). Never called inside a GET.
 */
export async function buildAndPersistInterestProfile(
  userId: string,
  deps: InterestProfileDeps = defaultDeps
): Promise<InterestProfile> {
  try {
    const profile = await buildInterestProfile(userId, deps);
    await persistInterestProfile(userId, profile, 'ready');
    return profile;
  } catch (err) {
    log.error('interest profile build failed', { userId, err });
    await persistInterestProfile(userId, [], 'error').catch(() => undefined);
    throw err;
  }
}
