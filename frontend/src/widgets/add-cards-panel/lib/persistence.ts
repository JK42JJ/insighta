/**
 * Add Cards panel persistence (CP489 Phase 4 — schema v2).
 *
 * v1 (CP466) stored a single `cards` array per mandala. The user's intent
 * across multiple "Search" clicks was to GROW the visible result set
 * (#785 ADD model), not replace it — so v2 stores `rounds: Round[]`
 * newest-first and the panel renders separators between rounds.
 *
 * The surfacedVideoIds set + sessionPicks store layouts are unchanged.
 *
 * Migration: v1 records load as a single round (round 1 = the saved
 * `cards`, generated round_id, lastSearchedAt as round_at). v0 / corrupt
 * / mandala-mismatched records return null (cold start).
 */

import type { AddCardCandidate } from '../model/useAddCards';

const STORAGE_PREFIX = 'addCards:state:';
const STORAGE_VERSION = 2;
const MAX_SURFACED_VIDEO_IDS = 5000;
/** Cap the number of rounds we retain per mandala to bound localStorage
 *  growth. Round oldest end is dropped first. 12 rounds × ~40 cards each
 *  × ~200 bytes/card ≈ 96KB upper bound — safely under typical 5 MB
 *  per-origin localStorage quotas. */
const MAX_ROUNDS = 12;
const SESSION_PICKS_PREFIX = 'addCards:sessionPicks:';

export interface AddCardsRound {
  id: string;
  at: string; // ISO
  cards: AddCardCandidate[];
}

/** Persisted "this session" picks per mandala. Survives panel close/reopen
 *  so picked cards keep their "추가됨" overlay until the user explicitly
 *  resets — user directive 2026-05-18 "초기화 클릭 전까지는 그대로". */
export function loadSessionPicks(mandalaId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SESSION_PICKS_PREFIX + mandalaId);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function saveSessionPicks(mandalaId: string, picks: ReadonlyArray<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SESSION_PICKS_PREFIX + mandalaId, JSON.stringify([...picks]));
  } catch {
    // quota exceeded — degrade silently to in-memory only
  }
}

export function clearSessionPicks(mandalaId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SESSION_PICKS_PREFIX + mandalaId);
  } catch {
    // ignore
  }
}

export interface AddCardsPersistedState {
  version: number;
  mandalaId: string;
  /** Newest-first. rounds[0] is the most recent search. */
  rounds: AddCardsRound[];
  /** Cumulative set of videoIds the user has already been shown in
   *  the panel for this mandala. Used as `excludeVideoIds` on every
   *  search click so BE never returns a duplicate across rounds. */
  surfacedVideoIds: string[];
  lastSearchedAt: string;
}

function storageKey(mandalaId: string): string {
  return `${STORAGE_PREFIX}${mandalaId}`;
}

function isAddCardCandidate(v: unknown): v is AddCardCandidate {
  return !!v && typeof v === 'object' && typeof (v as { videoId?: unknown }).videoId === 'string';
}

function isRound(v: unknown): v is AddCardsRound {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<AddCardsRound>;
  return (
    typeof r.id === 'string' &&
    typeof r.at === 'string' &&
    Array.isArray(r.cards) &&
    r.cards.every(isAddCardCandidate)
  );
}

/**
 * Loads + migrates persisted panel state for `mandalaId`.
 *
 *   v2 — preferred shape, returned as-is (defensively filtered).
 *   v1 — single `cards` array wrapped as one round (id = `legacy-v1`,
 *        at = parsed.lastSearchedAt OR now).
 *   anything else (missing/corrupt/mandala mismatch/different version) →
 *        null (cold start).
 *
 * Migration is one-way — the next `saveAddCardsState` overwrites the slot
 * with v2 shape, so subsequent loads skip the migration path entirely.
 */
export function loadAddCardsState(mandalaId: string): AddCardsPersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(mandalaId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed['mandalaId'] !== mandalaId) return null;

    const version = typeof parsed['version'] === 'number' ? parsed['version'] : 0;
    const surfacedRaw = parsed['surfacedVideoIds'];
    const surfacedVideoIds = Array.isArray(surfacedRaw)
      ? surfacedRaw.filter((v): v is string => typeof v === 'string')
      : [];
    const lastSearchedAt =
      typeof parsed['lastSearchedAt'] === 'string' ? parsed['lastSearchedAt'] : '';

    if (version === STORAGE_VERSION) {
      const roundsRaw = parsed['rounds'];
      if (!Array.isArray(roundsRaw)) return null;
      const rounds = roundsRaw.filter(isRound);
      return {
        version: STORAGE_VERSION,
        mandalaId,
        rounds,
        surfacedVideoIds,
        lastSearchedAt,
      };
    }

    if (version === 1) {
      const cardsRaw = parsed['cards'];
      if (!Array.isArray(cardsRaw)) return null;
      const cards = cardsRaw.filter(isAddCardCandidate);
      if (cards.length === 0) {
        return {
          version: STORAGE_VERSION,
          mandalaId,
          rounds: [],
          surfacedVideoIds,
          lastSearchedAt,
        };
      }
      return {
        version: STORAGE_VERSION,
        mandalaId,
        rounds: [
          {
            id: 'legacy-v1',
            at: lastSearchedAt || new Date().toISOString(),
            cards,
          },
        ],
        surfacedVideoIds,
        lastSearchedAt,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Persists the current `rounds[]` + cumulative `surfacedVideoIds`.
 *
 * Inputs are caller-owned ordering (newest-first). `rounds` is trimmed
 * to `MAX_ROUNDS` (oldest end dropped first) and `surfacedVideoIds` to
 * `MAX_SURFACED_VIDEO_IDS` (oldest entries dropped) to keep one mandala's
 * footprint bounded.
 */
export function saveAddCardsState(
  mandalaId: string,
  rounds: ReadonlyArray<AddCardsRound>,
  surfacedVideoIds: ReadonlyArray<string>
): void {
  if (typeof window === 'undefined') return;
  const trimmedRounds = rounds.length > MAX_ROUNDS ? rounds.slice(0, MAX_ROUNDS) : [...rounds];
  const trimmedSurfaced =
    surfacedVideoIds.length > MAX_SURFACED_VIDEO_IDS
      ? surfacedVideoIds.slice(-MAX_SURFACED_VIDEO_IDS)
      : [...surfacedVideoIds];
  const payload: AddCardsPersistedState = {
    version: STORAGE_VERSION,
    mandalaId,
    rounds: trimmedRounds,
    surfacedVideoIds: trimmedSurfaced,
    lastSearchedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(storageKey(mandalaId), JSON.stringify(payload));
  } catch {
    // Quota or serialization failure — silent. UX degrades to
    // session-only memory, not a hard error.
  }
}

export function mergeSurfacedVideoIds(
  prev: ReadonlyArray<string>,
  next: ReadonlyArray<string>
): string[] {
  const set = new Set<string>(prev);
  for (const v of next) set.add(v);
  return [...set];
}
