/**
 * Unit tests for RichNoteService — dual-write behavior, empty detection, legacy wrap.
 */
import { Prisma } from '@prisma/client';

const mockFindFirst = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockUlcFindFirst = jest.fn();
const mockUlcFindUnique = jest.fn();
const mockUlcUpdate = jest.fn();

jest.mock('../../../src/modules/database', () => ({
  getPrismaClient: () => ({
    userVideoState: {
      findFirst: mockFindFirst,
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
    user_local_cards: {
      findFirst: mockUlcFindFirst,
      findUnique: mockUlcFindUnique,
      update: mockUlcUpdate,
    },
  }),
}));

import {
  RichNoteService,
  RichNoteNotFoundError,
  wrapLegacyPlainText,
} from '../../../src/modules/notes/rich-note-service';
import type { TiptapDoc } from '../../../src/modules/notes/tiptap-schema';

const fakeVideo = {
  id: 'vid-1',
  title: 'Test Video',
  channel_title: 'Ch',
  duration_seconds: 300,
  thumbnail_url: 'https://img',
};

const doc: TiptapDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
};

beforeEach(() => {
  mockFindFirst.mockReset();
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
  mockUlcFindFirst.mockReset();
  mockUlcFindUnique.mockReset();
  mockUlcUpdate.mockReset();
});

describe('RichNoteService.getRichNote', () => {
  it('returns stored Tiptap JSON when user_note_json exists', async () => {
    mockFindFirst.mockResolvedValue({
      user_note: 'hello',
      user_note_json: doc,
      updatedAt: new Date('2026-04-09T00:00:00Z'),
      mandala_id: 'mid-1',
      cell_index: 4,
      video: fakeVideo,
    });

    const svc = new RichNoteService();
    const view = await svc.getRichNote('user-1', 'card-1');

    expect(view.note).toEqual(doc);
    expect(view.isLegacy).toBe(false);
    expect(view.updatedAt).toBe('2026-04-09T00:00:00.000Z');
    expect(view.mandalaCell).toEqual({ mandalaId: 'mid-1', cellIndex: 4 });
  });

  it('wraps legacy plain-text user_note into paragraph doc', async () => {
    mockFindFirst.mockResolvedValue({
      user_note: 'old memo',
      user_note_json: null,
      updatedAt: new Date(),
      mandala_id: null,
      cell_index: -1,
      video: fakeVideo,
    });

    const svc = new RichNoteService();
    const view = await svc.getRichNote('user-1', 'card-1');

    expect(view.isLegacy).toBe(true);
    expect(view.note).toEqual(wrapLegacyPlainText('old memo'));
    expect(view.mandalaCell).toBeNull();
  });

  it('returns note=null when both columns are null', async () => {
    mockFindFirst.mockResolvedValue({
      user_note: null,
      user_note_json: null,
      updatedAt: new Date(),
      mandala_id: null,
      cell_index: null,
      video: fakeVideo,
    });

    const svc = new RichNoteService();
    const view = await svc.getRichNote('user-1', 'card-1');

    expect(view.note).toBeNull();
    expect(view.isLegacy).toBe(false);
  });

  it('throws RichNoteNotFoundError when row missing', async () => {
    mockFindFirst.mockResolvedValue(null);
    const svc = new RichNoteService();
    await expect(svc.getRichNote('u', 'card-x')).rejects.toBeInstanceOf(RichNoteNotFoundError);
  });
});

describe('RichNoteService.saveRichNote', () => {
  it('dual-writes Tiptap JSON + plain-text extract', async () => {
    mockFindUnique.mockResolvedValue({ user_id: 'user-1' });
    mockUpdate.mockResolvedValue({ updatedAt: new Date('2026-04-09T01:00:00Z') });
    const svc = new RichNoteService();
    const result = await svc.saveRichNote('user-1', 'card-1', doc);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'card-1' });
    expect(call.data.user_note_json).toEqual(doc);
    expect(call.data.user_note).toBe('hello');
    expect(result.updatedAt).toBe('2026-04-09T01:00:00.000Z');
  });

  it('clears both columns when doc is empty', async () => {
    mockFindUnique.mockResolvedValue({ user_id: 'user-1' });
    mockUpdate.mockResolvedValue({ updatedAt: new Date() });
    const svc = new RichNoteService();
    const empty: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
    await svc.saveRichNote('user-1', 'card-1', empty);

    const call = mockUpdate.mock.calls[0][0];
    expect(call.data.user_note).toBeNull();
    expect(call.data.user_note_json).toBe(Prisma.JsonNull);
  });

  it('throws RichNoteNotFoundError when ownership check fails (row missing)', async () => {
    mockFindUnique.mockResolvedValue(null);
    const svc = new RichNoteService();
    await expect(svc.saveRichNote('u', 'card-x', doc)).rejects.toBeInstanceOf(
      RichNoteNotFoundError
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws RichNoteNotFoundError when ownership check fails (wrong user)', async () => {
    mockFindUnique.mockResolvedValue({ user_id: 'other-user' });
    const svc = new RichNoteService();
    await expect(svc.saveRichNote('u', 'card-x', doc)).rejects.toBeInstanceOf(
      RichNoteNotFoundError
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws RichNoteNotFoundError on P2025', async () => {
    mockFindUnique.mockResolvedValue({ user_id: 'u' });
    mockUpdate.mockRejectedValue({ code: 'P2025' });
    const svc = new RichNoteService();
    await expect(svc.saveRichNote('u', 'card-x', doc)).rejects.toBeInstanceOf(
      RichNoteNotFoundError
    );
  });
});

// CP501 — ulc note routing (the fix). ulc has NO user_note_json column → plain
// text only; the single service routes by sourceTable.
describe('RichNoteService — user_local_cards routing', () => {
  it('getRichNote(ulc) wraps plain user_note + reads ulc-only (never touches uvs)', async () => {
    mockUlcFindFirst.mockResolvedValue({
      user_note: 'ulc memo',
      updated_at: new Date('2026-04-09T02:00:00Z'),
      title: 'Local Title',
      metadata_title: null,
      metadata_image: 'https://thumb',
      video_id: 'abc12345678',
      mandala_id: 'mid-9',
      cell_index: 2,
    });

    const svc = new RichNoteService();
    const view = await svc.getRichNote('user-1', 'card-ulc', 'user_local_cards');

    expect(mockUlcFindFirst).toHaveBeenCalledTimes(1);
    expect(mockFindFirst).not.toHaveBeenCalled(); // uvs path untouched
    expect(view.isLegacy).toBe(true);
    expect(view.note).toEqual(wrapLegacyPlainText('ulc memo'));
    expect(view.updatedAt).toBe('2026-04-09T02:00:00.000Z');
    expect(view.video.title).toBe('Local Title');
    expect(view.mandalaCell).toEqual({ mandalaId: 'mid-9', cellIndex: 2 });
  });

  it('getRichNote(ulc) returns note=null when user_note is null', async () => {
    mockUlcFindFirst.mockResolvedValue({
      user_note: null,
      updated_at: new Date(),
      title: 'T',
      metadata_title: null,
      metadata_image: null,
      video_id: null,
      mandala_id: null,
      cell_index: -1,
    });
    const svc = new RichNoteService();
    const view = await svc.getRichNote('user-1', 'card-ulc', 'user_local_cards');
    expect(view.note).toBeNull();
    expect(view.isLegacy).toBe(false);
  });

  it('getRichNote(ulc) throws RichNoteNotFoundError when row missing', async () => {
    mockUlcFindFirst.mockResolvedValue(null);
    const svc = new RichNoteService();
    await expect(svc.getRichNote('u', 'card-x', 'user_local_cards')).rejects.toBeInstanceOf(
      RichNoteNotFoundError
    );
  });

  it('saveRichNote(ulc) writes plain user_note only (no user_note_json) + sets updated_at', async () => {
    mockUlcFindUnique.mockResolvedValue({ user_id: 'user-1' });
    mockUlcUpdate.mockResolvedValue({ updated_at: new Date('2026-04-09T03:00:00Z') });
    const svc = new RichNoteService();
    const result = await svc.saveRichNote('user-1', 'card-ulc', doc, 'user_local_cards');

    expect(mockUlcUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled(); // uvs path untouched
    const call = mockUlcUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'card-ulc' });
    expect(call.data.user_note).toBe('hello');
    expect('user_note_json' in call.data).toBe(false); // ulc has no such column
    expect(call.data.updated_at).toBeInstanceOf(Date);
    expect(result.updatedAt).toBe('2026-04-09T03:00:00.000Z');
  });

  it('saveRichNote(ulc) clears user_note when doc is empty', async () => {
    mockUlcFindUnique.mockResolvedValue({ user_id: 'user-1' });
    mockUlcUpdate.mockResolvedValue({ updated_at: new Date() });
    const svc = new RichNoteService();
    const empty: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
    await svc.saveRichNote('user-1', 'card-ulc', empty, 'user_local_cards');
    expect(mockUlcUpdate.mock.calls[0][0].data.user_note).toBeNull();
  });

  it('saveRichNote(ulc) enforces ownership (wrong user) without updating', async () => {
    mockUlcFindUnique.mockResolvedValue({ user_id: 'other' });
    const svc = new RichNoteService();
    await expect(svc.saveRichNote('u', 'card-x', doc, 'user_local_cards')).rejects.toBeInstanceOf(
      RichNoteNotFoundError
    );
    expect(mockUlcUpdate).not.toHaveBeenCalled();
  });

  it('default sourceTable routes to uvs (back-compat)', async () => {
    mockFindUnique.mockResolvedValue({ user_id: 'user-1' });
    mockUpdate.mockResolvedValue({ updatedAt: new Date() });
    const svc = new RichNoteService();
    await svc.saveRichNote('user-1', 'card-1', doc); // no sourceTable
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUlcUpdate).not.toHaveBeenCalled();
  });
});
