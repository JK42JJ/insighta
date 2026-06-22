/**
 * deck-build handler (③ e2e) — orchestration. All deps mocked (dynamic imports).
 * Locks: happy path (book→figures→build→upload→done); no book → failed (no throw);
 * build null → failed + throw (retry); [] figures = text deck still builds.
 */

const mockFillBook = jest.fn();
const mockCollect = jest.fn();
const mockBuildDeck = jest.fn();
const mockUpload = jest.fn();
const mockBuilding = jest.fn().mockResolvedValue(undefined);
const mockDone = jest.fn().mockResolvedValue(undefined);
const mockFailed = jest.fn().mockResolvedValue(undefined);
const mockBookFindUnique = jest.fn();

jest.mock('@/modules/mandala-book/fill-book', () => ({ fillMandalaBook: (...a: unknown[]) => mockFillBook(...a) }));
jest.mock('@/modules/snapshot/collect-figures', () => ({ collectFiguresForMandala: (...a: unknown[]) => mockCollect(...a) }));
jest.mock('@/modules/deck/slides-build-client', () => ({ buildDeck: (...a: unknown[]) => mockBuildDeck(...a) }));
jest.mock('@/modules/deck/deck-storage', () => ({ uploadDeckPptx: (...a: unknown[]) => mockUpload(...a) }));
jest.mock('@/modules/deck/deck-status', () => ({
  markDeckBuilding: (...a: unknown[]) => mockBuilding(...a),
  markDeckDone: (...a: unknown[]) => mockDone(...a),
  markDeckFailed: (...a: unknown[]) => mockFailed(...a),
}));
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ mandala_books: { findUnique: (...a: unknown[]) => mockBookFindUnique(...a) } }),
}));
jest.mock('../../../src/modules/queue/manager', () => ({ getJobQueue: () => ({ getInstance: () => ({}) }) }));

import { handleDeckBuild } from '../../../src/modules/queue/handlers/deck-build';

const job = (data: unknown) => ({ id: 'j1', data }) as never;

beforeEach(() => {
  [mockFillBook, mockCollect, mockBuildDeck, mockUpload, mockBuilding, mockDone, mockFailed, mockBookFindUnique].forEach((m) => m.mockReset());
  mockBuilding.mockResolvedValue(undefined);
  mockDone.mockResolvedValue(undefined);
  mockFailed.mockResolvedValue(undefined);
});

describe('handleDeckBuild', () => {
  it('happy path: book → figures → build → upload → done', async () => {
    mockFillBook.mockResolvedValue({ ok: true, action: 'filled' });
    mockBookFindUnique.mockResolvedValue({ book_json: { chapters: [] } });
    mockCollect.mockResolvedValue([{ figure_id: 'v:1:table' }]);
    mockBuildDeck.mockResolvedValue(Buffer.from('pptx'));
    mockUpload.mockResolvedValue('https://supabase/.../slide-decks/m1.pptx');

    await handleDeckBuild(job({ userId: 'u1', mandalaId: 'm1' }));

    expect(mockBuilding).toHaveBeenCalledWith('m1');
    expect(mockBuildDeck).toHaveBeenCalledWith({ chapters: [] }, [{ figure_id: 'v:1:table' }]);
    expect(mockUpload).toHaveBeenCalledWith('m1', expect.any(Buffer));
    expect(mockDone).toHaveBeenCalledWith('m1', 'https://supabase/.../slide-decks/m1.pptx');
    expect(mockFailed).not.toHaveBeenCalled();
  });

  it('text deck: [] figures still builds (fail-closed, not an error)', async () => {
    mockFillBook.mockResolvedValue({ ok: true });
    mockBookFindUnique.mockResolvedValue({ book_json: { chapters: [] } });
    mockCollect.mockResolvedValue([]);
    mockBuildDeck.mockResolvedValue(Buffer.from('pptx'));
    mockUpload.mockResolvedValue('https://supabase/x.pptx');

    await handleDeckBuild(job({ userId: 'u1', mandalaId: 'm1' }));
    expect(mockBuildDeck).toHaveBeenCalledWith({ chapters: [] }, []);
    expect(mockDone).toHaveBeenCalled();
  });

  it('no book_json → failed, no throw, no build', async () => {
    mockFillBook.mockResolvedValue({ ok: false, action: 'skipped-no-videos' });
    mockBookFindUnique.mockResolvedValue(null);

    await handleDeckBuild(job({ userId: 'u1', mandalaId: 'm1' }));
    expect(mockFailed).toHaveBeenCalledWith('m1', expect.stringContaining('no book_json'));
    expect(mockBuildDeck).not.toHaveBeenCalled();
  });

  it('build returns null → failed + throw (pg-boss retry)', async () => {
    mockFillBook.mockResolvedValue({ ok: true });
    mockBookFindUnique.mockResolvedValue({ book_json: {} });
    mockCollect.mockResolvedValue([]);
    mockBuildDeck.mockResolvedValue(null);

    await expect(handleDeckBuild(job({ userId: 'u1', mandalaId: 'm1' }))).rejects.toThrow();
    expect(mockFailed).toHaveBeenCalledWith('m1', expect.stringContaining('no deck'));
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('missing payload → drop without throw', async () => {
    await handleDeckBuild(job({}));
    expect(mockFillBook).not.toHaveBeenCalled();
  });
});
