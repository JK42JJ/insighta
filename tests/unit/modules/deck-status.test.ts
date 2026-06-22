/**
 * deck-status (③) — slide_decks lifecycle helpers. Mock prisma (no DB).
 * Locks: getDeckState mapping/null, pending clears, building/done/failed writes.
 */

const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    slide_decks: { findUnique: mockFindUnique, upsert: mockUpsert, update: mockUpdate },
  }),
}));

import {
  getDeckState,
  markDeckPending,
  markDeckBuilding,
  markDeckDone,
  markDeckFailed,
} from '../../../src/modules/deck/deck-status';

const M = '942e2757-64fa-4759-afc5-56e2f33869f2';

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpsert.mockReset().mockResolvedValue({});
  mockUpdate.mockReset().mockResolvedValue({});
});

describe('deck-status helpers', () => {
  it('getDeckState maps a row to DeckState', async () => {
    const at = new Date('2026-06-22T00:00:00Z');
    mockFindUnique.mockResolvedValue({
      mandala_id: M,
      status: 'done',
      pptx_url: 'https://supabase/storage/v1/object/public/slide-decks/x.pptx',
      error: null,
      generated_at: at,
    });
    expect(await getDeckState(M)).toEqual({
      mandalaId: M,
      status: 'done',
      pptxUrl: 'https://supabase/storage/v1/object/public/slide-decks/x.pptx',
      error: null,
      generatedAt: at,
    });
  });

  it('getDeckState returns null when no deck row exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getDeckState(M)).toBeNull();
  });

  it('markDeckPending upserts pending and clears prior url/error/generated_at', async () => {
    await markDeckPending(M);
    const arg = mockUpsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ mandala_id: M });
    expect(arg.create).toEqual({ mandala_id: M, status: 'pending' });
    expect(arg.update).toEqual({ status: 'pending', pptx_url: null, error: null, generated_at: null });
  });

  it('markDeckBuilding sets status=building', async () => {
    await markDeckBuilding(M);
    expect(mockUpdate.mock.calls[0]![0].data).toEqual({ status: 'building', error: null });
  });

  it('markDeckDone writes status=done + pptx_url + generated_at', async () => {
    const url = 'https://supabase/storage/v1/object/public/slide-decks/x.pptx';
    await markDeckDone(M, url);
    const data = mockUpdate.mock.calls[0]![0].data;
    expect(data.status).toBe('done');
    expect(data.pptx_url).toBe(url);
    expect(data.error).toBeNull();
    expect(data.generated_at).toBeInstanceOf(Date);
  });

  it('markDeckFailed sets status=failed + truncated error', async () => {
    await markDeckFailed(M, 'x'.repeat(900));
    const data = mockUpdate.mock.calls[0]![0].data;
    expect(data.status).toBe('failed');
    expect(data.error).toHaveLength(500);
  });
});
