/**
 * Diversity guard — CP500+ (UX 원칙 2 "다양성" 축).
 *
 * Two pure transforms applied to candidate lists on all three v5-era paths
 * (v5 placement, pool-serve fill, live fallback):
 *
 *   1. dedupeSeries  — same-channel 연강 (episode N of one series) collapse to
 *      ONE representative = the latest episode. Series detection is two-tier:
 *      (a) shared series marker (leading [bracket] segment) + an episode token
 *          in BOTH titles, (b) episode-token-stripped title similarity ≥
 *          threshold (token Jaccard). Titles WITHOUT an episode token are never
 *          grouped — two distinct "[웨비나] …" uploads stay independent.
 *   2. softChannelCap — the cap-th+ card of one channel is DEMOTED (moved to
 *      the back of its cell bucket), never dropped: if a thin-supply cell has
 *      candidates from only one channel they all still surface — 빈 셀 불허
 *      원칙과 정합 (soft, not hard).
 *
 * Measured rationale (CP500 diagnosis, mandala cca14d65): dedup was
 * videoId-only — Basphere "[Kubernetes 6주 코스] 5주 차 1강/2강/6주 차 2강"
 * all passed (the regression pin below). v1 GLOBAL_CHANNEL_CAP (executor.ts
 * Fix 3) and v3 MAX_PER_CHANNEL_PER_CELL=2 were lost in the v5 swap
 * (#802/#804) — this restores the dimension as a SOFT reorder.
 */

import { logger } from '@/utils/logger';

const log = logger.child({ module: 'diversity-guard' });

/** Minimal shape both FanoutCandidate and pool-serve GateCandidate satisfy. */
export interface DiversityCandidate {
  title: string;
  channelId?: string | null;
  channelTitle?: string | null;
  publishedAt?: string | Date | null;
  cellIndex?: number | null;
}

// ── episode tokens ──────────────────────────────────────────────────────────

// Order matters: compound forms ([6-2강], 5주 차) before bare N강/N회.
// NOTE: \b does NOT work after Hangul (Hangul ∉ \w, so 강+":" is non-word/
// non-word = no boundary) — use a Hangul negative lookahead instead, which
// also keeps "N강의/N부작" (강의=lecture) from false-matching.
const EPISODE_PATTERNS: RegExp[] = [
  /[[(]\s*\d+\s*[-–]\s*\d+\s*강?\s*[\])]/g, // [6-2강], (5-1)
  /\d+\s*주\s*차/g, // 5주 차
  /\d+\s*회\s*차/g, // 3회차
  /\d+\s*강(?![가-힣])/g,
  /\d+\s*부(?![가-힣])/g,
  /\d+\s*회(?![가-힣])/g,
  /\d+\s*화(?![가-힣])/g,
  /\bEP\.?\s*\d+\b/gi,
  /\bPart\s*\d+\b/gi,
  /#\d+\b/g,
  /^\s*\d+\s*[.)]\s*/, // leading "06." numbering
  /\(\s*\d+\s*\)\s*$/, // trailing "(2)"
];

export function hasEpisodeToken(title: string): boolean {
  return EPISODE_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(title);
  });
}

/** Strip episode tokens + brackets, lowercase, collapse — series identity text. */
export function stripEpisodeTokens(title: string): string {
  let t = title;
  for (const p of EPISODE_PATTERNS) {
    p.lastIndex = 0;
    t = t.replace(p, ' ');
  }
  return t
    .toLowerCase()
    .replace(/[[\]()【】|:~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Leading [bracket] segment = explicit series marker ("[Kubernetes 6주 코스]"). */
export function seriesMarker(title: string): string | null {
  const m = /^\s*[[【]([^\]】]{2,60})[\]】]/.exec(title);
  if (!m) return null;
  return m[1]!.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Episode ordinal tuple for "대표작 = 최신 회차" ([5,1] < [5,2] < [6,2]). */
export function episodeOrdinals(title: string): number[] {
  const out: number[] = [];
  const grab = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(title)) !== null) {
      for (let g = 1; g < m.length; g += 1) {
        if (m[g] !== undefined) out.push(Number(m[g]));
      }
      if (!re.global) break;
    }
  };
  grab(/(\d+)\s*주\s*차/g);
  grab(/(\d+)\s*회\s*차/g);
  grab(/(\d+)\s*강(?![가-힣])/g);
  grab(/(\d+)\s*[부회화](?![가-힣])/g);
  grab(/\bEP\.?\s*(\d+)\b/gi);
  grab(/\bPart\s*(\d+)\b/gi);
  grab(/[[(]\s*(\d+)\s*[-–]\s*(\d+)/g);
  grab(/^\s*(\d+)\s*[.)]/);
  grab(/\(\s*(\d+)\s*\)\s*$/);
  return out;
}

function tokenSet(s: string): Set<string> {
  return new Set(s.split(/[^0-9a-z가-힣]+/i).filter((t) => t.length > 0));
}

/** Token Jaccard over episode-stripped titles. */
export function strippedTitleSimilarity(a: string, b: string): number {
  const ta = tokenSet(stripEpisodeTokens(a));
  const tb = tokenSet(stripEpisodeTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

// ── series dedup ────────────────────────────────────────────────────────────

function channelKey(c: DiversityCandidate): string {
  return (c.channelId || c.channelTitle || '').trim().toLowerCase();
}

function publishedMs(c: DiversityCandidate): number {
  if (!c.publishedAt) return 0;
  const d = c.publishedAt instanceof Date ? c.publishedAt : new Date(c.publishedAt);
  const ms = d.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** a beats b as the series representative ("최신 회차" — ordinal tuple, then publishedAt). */
function isLaterEpisode(a: DiversityCandidate, b: DiversityCandidate): boolean {
  const ea = episodeOrdinals(a.title);
  const eb = episodeOrdinals(b.title);
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i += 1) {
    const va = ea[i] ?? -1;
    const vb = eb[i] ?? -1;
    if (va !== vb) return va > vb;
  }
  return publishedMs(a) > publishedMs(b);
}

export interface DedupeSeriesOptions {
  /** Stripped-title similarity threshold for tier (b). */
  simThreshold?: number;
  /** Already-accepted items (e.g. pool passes, when gating live candidates):
   *  a candidate in the same series as any of these is dropped outright. */
  against?: DiversityCandidate[];
}

export interface DedupeSeriesResult<T extends DiversityCandidate> {
  kept: T[];
  dropped: number;
}

/**
 * Collapse same-channel series episodes to one representative (latest episode).
 * Output preserves input order; the representative occupies the position of
 * the group's FIRST occurrence (stable for downstream rank-order consumers).
 */
export function dedupeSeries<T extends DiversityCandidate>(
  candidates: T[],
  opts: DedupeSeriesOptions = {}
): DedupeSeriesResult<T> {
  const sim = opts.simThreshold ?? 0.8;
  const against = opts.against ?? [];

  // Group ids per candidate index. Tier (a): channel+marker. Tier (b):
  // channel + stripped-title similarity vs each group's first member.
  interface Group {
    firstIdx: number;
    bestIdx: number; // representative (latest episode)
    members: number[];
  }
  const groupOf = new Map<number, Group>();
  const markerGroups = new Map<string, Group>();
  const simGroupsByChannel = new Map<string, Group[]>();

  candidates.forEach((c, i) => {
    const ch = channelKey(c);
    if (!ch || !hasEpisodeToken(c.title)) return; // never grouped
    const marker = seriesMarker(c.title);
    let g: Group | undefined;
    if (marker) {
      const key = `${ch}|${marker}`;
      g = markerGroups.get(key);
      if (!g) {
        g = { firstIdx: i, bestIdx: i, members: [] };
        markerGroups.set(key, g);
      }
    } else {
      const list = simGroupsByChannel.get(ch) ?? [];
      g = list.find(
        (cand) => strippedTitleSimilarity(candidates[cand.firstIdx]!.title, c.title) >= sim
      );
      if (!g) {
        g = { firstIdx: i, bestIdx: i, members: [] };
        list.push(g);
        simGroupsByChannel.set(ch, list);
      }
    }
    g.members.push(i);
    groupOf.set(i, g);
    if (i !== g.bestIdx && isLaterEpisode(c, candidates[g.bestIdx]!)) {
      g.bestIdx = i;
    }
  });

  // `against` suppression: candidate in the same series as an accepted item.
  const inAgainstSeries = (c: T): boolean => {
    if (!hasEpisodeToken(c.title)) return false;
    const ch = channelKey(c);
    if (!ch) return false;
    const marker = seriesMarker(c.title);
    return against.some((a) => {
      if (channelKey(a) !== ch || !hasEpisodeToken(a.title)) return false;
      if (marker && seriesMarker(a.title) === marker) return true;
      return strippedTitleSimilarity(a.title, c.title) >= sim;
    });
  };

  // Emit walk — the series representative occupies its group's FIRST slot
  // (stable for downstream rank-order consumers); other members drop.
  const emit: T[] = [];
  candidates.forEach((c, i) => {
    const g = groupOf.get(i);
    if (g && g.members.length > 1) {
      if (i === g.firstIdx) {
        const rep = candidates[g.bestIdx]!;
        if (!inAgainstSeries(rep)) emit.push(rep);
      }
      return;
    }
    if (!inAgainstSeries(c)) emit.push(c);
  });
  return { kept: emit, dropped: candidates.length - emit.length };
}

// ── soft channel cap ────────────────────────────────────────────────────────

/**
 * Demote (NOT drop) the cap-exceeding cards of one channel to the back of
 * their cell bucket, preserving relative order. cap = how many cards one
 * channel keeps at priority; the (cap+1)-th onward are demoted. Buckets are
 * per cellIndex (binByCells / pool-serve consume per-cell rank order); items
 * without cellIndex form one bucket. A bucket whose candidates all share one
 * channel comes back in identical order — thin-supply cells lose nothing.
 */
export function softChannelCap<T extends DiversityCandidate>(candidates: T[], cap: number): T[] {
  if (cap <= 0) return candidates;
  const byCell = new Map<number | null, number[]>(); // bucket → original indices
  candidates.forEach((c, i) => {
    const key = c.cellIndex ?? null;
    const list = byCell.get(key);
    if (list) list.push(i);
    else byCell.set(key, [i]);
  });

  const out: T[] = new Array(candidates.length);
  for (const indices of byCell.values()) {
    const counts = new Map<string, number>();
    const primary: number[] = [];
    const demoted: number[] = [];
    for (const i of indices) {
      const ch = channelKey(candidates[i]!);
      if (!ch) {
        primary.push(i);
        continue;
      }
      const n = (counts.get(ch) ?? 0) + 1;
      counts.set(ch, n);
      (n <= cap ? primary : demoted).push(i);
    }
    const reordered = [...primary, ...demoted];
    indices.forEach((slot, k) => {
      out[slot] = candidates[reordered[k]!]!;
    });
  }
  return out;
}

// ── hard channel cap (global, demote-only) ──────────────────────────────────

export interface HardChannelCapResult<T extends DiversityCandidate> {
  /** Same length as input — DEMOTE only, never drop (card-floor 50~70 불변). */
  reordered: T[];
  demoted: number;
}

/**
 * Global (cross-cell) channel cap — closes the gap softChannelCap cannot: a
 * channel under the per-cell cap in EVERY individual cell can still monopolize
 * the aggregate list (e.g. 2/cell × 5 cells = 10 cards, one channel, zero
 * per-cell violations). Counted across the WHOLE candidate list regardless of
 * cellIndex; the cap-th+ occurrence of one channel is DEMOTED to the tail,
 * preserving relative order — never dropped, so downstream card-count floor
 * (50~70) is never at risk from this transform alone.
 *
 * `minCandidates` gate: below this pool size the cap does not fire at all
 * (thin-supply protection — same principle as softChannelCap's single-channel
 * bucket passthrough, applied globally instead of per-cell).
 */
export function hardChannelCap<T extends DiversityCandidate>(
  candidates: T[],
  cap: number,
  minCandidates: number
): HardChannelCapResult<T> {
  if (cap <= 0 || candidates.length < minCandidates) {
    return { reordered: candidates, demoted: 0 };
  }
  const counts = new Map<string, number>();
  const primary: T[] = [];
  const demoted: T[] = [];
  candidates.forEach((c) => {
    const ch = channelKey(c);
    if (!ch) {
      primary.push(c);
      return;
    }
    const n = (counts.get(ch) ?? 0) + 1;
    counts.set(ch, n);
    (n <= cap ? primary : demoted).push(c);
  });
  return { reordered: [...primary, ...demoted], demoted: demoted.length };
}

// ── cross-channel title dedup (demote-only) ─────────────────────────────────

export interface CrossChannelDedupResult<T extends DiversityCandidate> {
  /** Same length as input — DEMOTE only, never drop. */
  reordered: T[];
  demoted: number;
}

/**
 * Groups near-identical titles ACROSS channels (unlike dedupeSeries, which is
 * same-channel-only and requires an episode token) — catches the "동일 문구
 * 반복 재업로드" pattern (e.g. "왕초보 영어회화 100문장 | 생활영어 …" reposted
 * with cosmetic wording changes by many small channels). Token-Jaccard over
 * stripEpisodeTokens output (reused — brackets/lowercase/punctuation strip is
 * useful here even without an episode marker). Union-find groups transitively
 * similar titles; representative = first occurrence in input order, the rest
 * DEMOTED to the tail (never dropped — card-floor invariant).
 */
export function crossChannelTitleDedup<T extends DiversityCandidate>(
  candidates: T[],
  simThreshold: number
): CrossChannelDedupResult<T> {
  const n = candidates.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const normed = candidates.map((c) => stripEpisodeTokens(c.title || ''));
  for (let i = 0; i < n; i += 1) {
    if (!normed[i]) continue; // no title text — never grouped (no fabrication)
    for (let j = i + 1; j < n; j += 1) {
      if (!normed[j]) continue;
      if (strippedTitleSimilarity(candidates[i]!.title, candidates[j]!.title) >= simThreshold) {
        union(i, j);
      }
    }
  }

  const repOf = new Map<number, number>(); // root → representative (first occurrence)
  const membersOf = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const r = find(i);
    if (!repOf.has(r)) repOf.set(r, i);
    const arr = membersOf.get(r) ?? [];
    arr.push(i);
    membersOf.set(r, arr);
  }
  const demotedIdx = new Set<number>();
  for (const [root, members] of membersOf) {
    if (members.length <= 1) continue;
    const rep = repOf.get(root)!;
    for (const m of members) if (m !== rep) demotedIdx.add(m);
  }
  const primary: T[] = [];
  const demoted: T[] = [];
  candidates.forEach((c, i) => (demotedIdx.has(i) ? demoted : primary).push(c));
  return { reordered: [...primary, ...demoted], demoted: demoted.length };
}

// ── observability (③ raw 모집 채널 분포 1줄) ────────────────────────────────

export interface ChannelDistribution {
  total: number;
  distinct: number;
  top3SharePct: number;
  topSummary: string;
}

export function channelDistribution(candidates: DiversityCandidate[]): ChannelDistribution {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const ch = (c.channelTitle || c.channelId || '(unknown)').trim() || '(unknown)';
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = candidates.length;
  const top3 = sorted.slice(0, 3).reduce((s, [, n]) => s + n, 0);
  return {
    total,
    distinct: sorted.length,
    top3SharePct: total ? Math.round((top3 / total) * 1000) / 10 : 0,
    topSummary: sorted
      .slice(0, 3)
      .map(([ch, n]) => `${ch}:${n}`)
      .join(', '),
  };
}

export function logChannelDistribution(label: string, candidates: DiversityCandidate[]): void {
  const d = channelDistribution(candidates);
  log.info(
    `${label} channel dist: total=${d.total} distinct=${d.distinct} top3=${d.top3SharePct}% [${d.topSummary}]`
  );
}
