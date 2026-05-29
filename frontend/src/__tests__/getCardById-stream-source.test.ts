/**
 * Regression — getCardById 4-source signature.
 *
 * Background: PR #666 (CP471, 2026-05-19) added a 4th merge source —
 * `streamMandalaCards` — to `allMandalaCards` in `useCardOrchestrator`,
 * but `getCardById` was left with its 3-source signature
 * (syncedCards / persistedLocalCards / pendingLocalCards). SSE-pushed
 * `recommendation_cache` cards (id format `stream-<uuid>`) were rendered
 * in the grid but invisible to `getCardById`, causing D&D mutations on
 * them to silently fail (handleCardDrop: `if (!card) return;`).
 *
 * This test pins the 4-arg search so future refactors don't drop
 * stream-card support again.
 */
import { describe, it, expect } from 'vitest';
import { getCardById } from '@/features/card-management/lib/cardUtils';
import type { InsightCard } from '@/entities/card/model/types';

function mk(id: string, url = `https://example.com/${id}`): InsightCard {
  return {
    id,
    videoUrl: url,
    title: id,
    thumbnail: '',
    userNote: '',
    createdAt: new Date(0),
    cellIndex: 0,
    levelId: 'root',
    linkType: 'youtube',
  };
}

describe('getCardById — 4-source search (CP489+ stream-card fix)', () => {
  it('finds a card that lives only in streamCards (4th source)', () => {
    const stream = [mk('stream-abc')];
    const got = getCardById('stream-abc', [], [], [], stream);
    expect(got?.id).toBe('stream-abc');
  });

  it('returns null when the id is not in any source', () => {
    expect(getCardById('missing', [], [], [], [])).toBeNull();
  });

  it('falls through earlier sources before streamCards', () => {
    const synced = [mk('id-1')];
    const stream = [mk('id-1', 'https://other.example/id-1')];
    const got = getCardById('id-1', synced, [], [], stream);
    expect(got?.videoUrl).toBe('https://example.com/id-1');
  });

  it('back-compat — 4-arg call still works (streamCards defaults to [])', () => {
    const synced = [mk('id-1')];
    const got = getCardById('id-1', synced, [], []);
    expect(got?.id).toBe('id-1');
  });

  it('back-compat — missing id with no streamCards returns null', () => {
    expect(getCardById('stream-x', [], [], [])).toBeNull();
  });
});
