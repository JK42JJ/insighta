/**
 * Add Cards panel persistence (CP466 amendment 9).
 *
 * Keeps the last search result + cumulative surfaced-videoId set in
 * localStorage so a non-graceful exit (reload, browser quit) does NOT
 * lose the user's discovery context. Per mandala — each mandala has
 * its own bucket so switching mandalas restores the per-mandala
 * history.
 *
 * Surfaced set semantics (user directive 2026-05-18):
 *   - 검색 버튼 click → fresh fetch with `excludeVideoIds: [...surfaced]`
 *   - 응답 → 새 카드만. 이전 노출 카드 절대 다시 안 옴.
 *   - 응답의 videoId 들이 surfaced set 에 누적 (다음 검색에서 또 제외).
 *   - 패널 close 후 재open → 마지막 저장된 cards 다시 보임 (history).
 *   - 비정상 exit 후 → localStorage 에서 같은 cards + surfaced 복구.
 *
 * Storage shape limit: 카드 40개 + surfaced N개 (videoId 만, 11 char/each).
 * 패널 history 가 누적되어도 surfaced 만 늘어남, cards 는 최신 batch
 * 하나로 항상 overwrite. localStorage 용량 부담 낮음.
 */

import type { AddCardCandidate } from '../model/useAddCards';

const STORAGE_PREFIX = 'addCards:state:';
const STORAGE_VERSION = 1;
const MAX_SURFACED_VIDEO_IDS = 5000; // hard cap to bound localStorage growth
const SESSION_PICKS_PREFIX = 'addCards:sessionPicks:';

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

interface AddCardsPersistedState {
  version: number;
  mandalaId: string;
  cards: AddCardCandidate[];
  /** Cumulative set of videoIds the user has already been shown in
   *  the panel for this mandala. Used as `excludeVideoIds` on every
   *  search button click. */
  surfacedVideoIds: string[];
  lastSearchedAt: string;
}

function storageKey(mandalaId: string): string {
  return `${STORAGE_PREFIX}${mandalaId}`;
}

export function loadAddCardsState(mandalaId: string): AddCardsPersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(mandalaId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AddCardsPersistedState>;
    if (parsed.version !== STORAGE_VERSION) return null;
    if (parsed.mandalaId !== mandalaId) return null;
    if (!Array.isArray(parsed.cards) || !Array.isArray(parsed.surfacedVideoIds)) return null;
    return {
      version: STORAGE_VERSION,
      mandalaId,
      cards: parsed.cards,
      surfacedVideoIds: parsed.surfacedVideoIds.filter((v): v is string => typeof v === 'string'),
      lastSearchedAt: typeof parsed.lastSearchedAt === 'string' ? parsed.lastSearchedAt : '',
    };
  } catch {
    return null;
  }
}

export function saveAddCardsState(
  mandalaId: string,
  cards: AddCardCandidate[],
  surfacedVideoIds: string[]
): void {
  if (typeof window === 'undefined') return;
  const trimmedSurfaced =
    surfacedVideoIds.length > MAX_SURFACED_VIDEO_IDS
      ? surfacedVideoIds.slice(-MAX_SURFACED_VIDEO_IDS)
      : surfacedVideoIds;
  const payload: AddCardsPersistedState = {
    version: STORAGE_VERSION,
    mandalaId,
    cards,
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
