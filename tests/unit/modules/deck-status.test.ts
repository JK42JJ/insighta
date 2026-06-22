/**
 * deck-status (③ scaffold) — slide_decks read/upsert + path helpers.
 * Dry-verified with a mock prisma (no DB). Locks: route/disk path shape,
 * pending upsert clears prior url/error, null when no row.
 */

const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ slide_decks: { findUnique: mockFindUnique, upsert: mockUpsert } }),
}));
jest.mock('@/config/index', () => ({
  config: { paths: { data: '/srv/data' } },
}));

import {
  deckPptxRoutePath,
  deckPptxDiskPath,
  getDeckState,
  markDeckPending,
} from '../../../src/modules/deck/deck-status';

const M = '942e2757-64fa-4759-afc5-56e2f33869f2';

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpsert.mockReset();
});

describe('deck-status helpers', () => {
  it('builds the authenticated serving route path', () => {
    expect(deckPptxRoutePath(M)).toBe(`/api/v1/mandalas/${M}/deck.pptx`);
  });

  it('builds the on-disk path under config.paths.data/decks', () => {
    expect(deckPptxDiskPath(M)).toBe(`/srv/data/decks/${M}.pptx`);
  });

  it('getDeckState maps a row to DeckState', async () => {
    const at = new Date('2026-06-22T00:00:00Z');
    mockFindUnique.mockResolvedValue({
      mandala_id: M,
      status: 'done',
      pptx_url: `/api/v1/mandalas/${M}/deck.pptx`,
      error: null,
      generated_at: at,
    });
    const s = await getDeckState(M);
    expect(s).toEqual({
      mandalaId: M,
      status: 'done',
      pptxUrl: `/api/v1/mandalas/${M}/deck.pptx`,
      error: null,
      generatedAt: at,
    });
  });

  it('getDeckState returns null when no deck row exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getDeckState(M)).toBeNull();
  });

  it('markDeckPending upserts pending and clears prior url/error/generated_at', async () => {
    mockUpsert.mockResolvedValue({});
    await markDeckPending(M);
    const arg = mockUpsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ mandala_id: M });
    expect(arg.create).toEqual({ mandala_id: M, status: 'pending' });
    expect(arg.update).toEqual({ status: 'pending', pptx_url: null, error: null, generated_at: null });
  });
});
