/**
 * Curation 3-topic suggestion — interest × trend scoring (Growth Hub, 2026-07-20).
 * Design: docs/design/growth-hub-curation-personalized-2026-07-20.md (§4, §8).
 *
 * score(t) = w1·affinity(t, profile) + w2·rising(t) + w3·reinforce(t, user)
 * with a hard max-per-domain cap standing in for the w4·redundancy term (P0).
 * rising = trend_signals.norm_score (suggest-rank proxy — B5; velocity=P1).
 * reinforce is DERIVED from the append-only curation_proposals log (N1).
 *
 * The pure scorer `scoreAndSelect` has no DB/LLM — unit-tested directly.
 * `suggestTopics` wraps it with the DB reads.
 */

import { getPrismaClient } from '@/modules/database';
import { mapKeywordToDomain, type CurationDomain } from './domain-taxonomy';
import type { InterestProfile } from './interest-profile';
import { PROPOSAL_WEIGHTS, PROPOSAL_COUNT, MAX_PER_DOMAIN, REINFORCE } from './config';

export interface TrendCandidate {
  keyword: string;
  /** trend_signals.norm_score in [0,1] — the rising proxy (P0). */
  norm_score: number;
}

/** Domain-level reinforcement counts derived from the proposal log. */
export interface ReinforceSignals {
  /** domain → # of past weeks the user SELECTED a topic in this domain */
  selected: Map<CurationDomain, number>;
  /** domain → # of past weeks a topic in this domain was proposed but NOT selected */
  unselected: Map<CurationDomain, number>;
}

export interface TopicProposal {
  topic: string;
  domain: CurationDomain;
  /** final blended score (higher = better) */
  score: number;
  /** rising component [0,1], surfaced for UI/telemetry */
  rising: number;
}

/** Token overlap: does the candidate keyword relate to a profile keyword? */
function tokenMatch(candidate: string, profileKw: string): boolean {
  const c = candidate.toLowerCase();
  const p = profileKw.toLowerCase();
  if (c.includes(p) || p.includes(c)) return true;
  const pTokens = p.split(/\s+/).filter((t) => t.length >= 2);
  return pTokens.some((t) => c.includes(t));
}

/** affinity(t, profile) ∈ [0,1] — profile-weighted token/domain overlap, capped. */
function affinity(keyword: string, domain: CurationDomain, profile: InterestProfile): number {
  let acc = 0;
  for (const p of profile) {
    if (tokenMatch(keyword, p.kw)) acc += p.weight;
    else if (p.domain === domain) acc += p.weight * 0.3; // weaker domain-level match
  }
  return Math.min(1, acc);
}

/** reinforce(t, user) ∈ roughly [-β·k, +α·k] — from the proposal log (N1). */
function reinforce(domain: CurationDomain, sig: ReinforceSignals): number {
  const sel = sig.selected.get(domain) ?? 0;
  const un = sig.unselected.get(domain) ?? 0;
  return REINFORCE.alpha * sel - REINFORCE.beta * un;
}

/**
 * Pure scorer: rank candidates and pick PROPOSAL_COUNT with domain diversity
 * (≤ MAX_PER_DOMAIN per domain = the redundancy guard). No DB, no LLM.
 */
export function scoreAndSelect(
  profile: InterestProfile,
  candidates: TrendCandidate[],
  sig: ReinforceSignals
): TopicProposal[] {
  const scored: TopicProposal[] = candidates.map((c) => {
    const domain = mapKeywordToDomain(c.keyword);
    const aff = affinity(c.keyword, domain, profile);
    const rising = Math.max(0, Math.min(1, c.norm_score));
    const rein = reinforce(domain, sig);
    const score =
      PROPOSAL_WEIGHTS.affinity * aff +
      PROPOSAL_WEIGHTS.rising * rising +
      PROPOSAL_WEIGHTS.reinforce * rein;
    return { topic: c.keyword, domain, score: Math.round(score * 1000) / 1000, rising };
  });

  scored.sort((a, b) => b.score - a.score);

  const picked: TopicProposal[] = [];
  const perDomain = new Map<CurationDomain, number>();
  for (const s of scored) {
    if (picked.length >= PROPOSAL_COUNT) break;
    const n = perDomain.get(s.domain) ?? 0;
    if (n >= MAX_PER_DOMAIN) continue; // redundancy guard
    perDomain.set(s.domain, n + 1);
    picked.push(s);
  }
  // If diversity cap starved the list (few domains), backfill by score.
  if (picked.length < PROPOSAL_COUNT) {
    for (const s of scored) {
      if (picked.length >= PROPOSAL_COUNT) break;
      if (!picked.includes(s)) picked.push(s);
    }
  }
  return picked;
}

export type SuggestResult =
  | { status: 'building' }
  | { status: 'ready'; proposals: TopicProposal[] };

/**
 * Read interest profile → fresh trends → reinforcement → 3 proposals.
 * excludeTopics (normalized lowercase) drops candidates BEFORE scoring — the
 * "re-tune" path re-scores the remaining pool instead of surfacing ranks 4-6.
 */
export async function suggestTopics(
  userId: string,
  excludeTopics: string[] = []
): Promise<SuggestResult> {
  const prisma = getPrismaClient();

  const profileRow = await prisma.curation_interest_profile.findUnique({
    where: { user_id: userId },
  });
  if (!profileRow || profileRow.status !== 'ready') {
    return { status: 'building' };
  }
  const profile = (profileRow.profile as unknown as InterestProfile) ?? [];

  // Use the freshest trends by fetch time, NOT an expires_at gate: the trend-collector's
  // TTL can lapse (all rows "expired") between runs, which would leave zero candidates and
  // wrongly show the connect gate to a connected user. Recency + norm_score is the signal.
  const trends = await prisma.trend_signals.findMany({
    orderBy: [{ fetched_at: 'desc' }, { norm_score: 'desc' }],
    take: 300,
    select: { keyword: true, norm_score: true },
  });
  const excluded = new Set(excludeTopics.map((t) => t.trim().toLowerCase()));
  const candidates: TrendCandidate[] = trends
    .filter((t) => !excluded.has(t.keyword.trim().toLowerCase()))
    .map((t) => ({
      keyword: t.keyword,
      norm_score: t.norm_score,
    }));

  const sig = await loadReinforceSignals(userId);
  const proposals = scoreAndSelect(profile, candidates, sig);
  return { status: 'ready', proposals };
}

/** Derive domain-level reinforcement from the append-only proposal log (N1). */
export async function loadReinforceSignals(userId: string): Promise<ReinforceSignals> {
  const prisma = getPrismaClient();
  const rows = await prisma.curation_proposals.findMany({
    where: { user_id: userId },
    select: { proposed: true, selected_topic: true },
  });
  const selected = new Map<CurationDomain, number>();
  const unselected = new Map<CurationDomain, number>();
  for (const r of rows) {
    const proposed = (r.proposed as unknown as TopicProposal[]) ?? [];
    for (const p of proposed) {
      const bucket = r.selected_topic && p.topic === r.selected_topic ? selected : unselected;
      bucket.set(p.domain, (bucket.get(p.domain) ?? 0) + 1);
    }
  }
  return { selected, unselected };
}
