/**
 * Unit tests for RichNoteService — dual-write behavior, empty detection, legacy wrap.
 */
import { Prisma } from '@prisma/client';

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../../src/modules/database', () => ({
  getPrismaClient: () => ({
    userVideoState: {
      findUnique: mockFindUnique,
      update: mockUpdate,
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
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
  ],
};

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
});

describe('RichNoteService.getRichNote', () => {
  it('returns stored Tiptap JSON when user_note_json exists', async () => {
    mockFindUnique.mockResolvedValue({
      user_note: 'hello',
      user_note_json: doc,
      updatedAt: new Date('2026-04-09T00:00:00Z'),
      mandala_id: 'mid-1',
      cell_index: 4,
      video: fakeVideo,
    });

    const svc = new RichNoteService();
    const view = await svc.getRichNote('user-1', 'vid-1');

    expect(view.note).toEqual(doc);
    expect(view.isLegacy).toBe(false);
    expect(view.updatedAt).toBe('2026-04-09T00:00:00.000Z');
    expect(view.mandalaCell).toEqual({ mandalaId: 'mid-1', cellIndex: 4 });
  });

  it('wraps legacy plain-text user_note into paragraph doc', async () => {
    mockFindUnique.mockResolvedValue({
      user_note: 'old memo',
      user_note_json: null,
      updatedAt: new Date(),
      mandala_id: null,
      cell_index: -1,
      video: fakeVideo,
    });

    const svc = new RichNoteService();
    const view = await svc.getRichNote('user-1', 'vid-1');

    expect(view.isLegacy).toBe(true);
    expect(view.note).toEqual(wrapLegacyPlainText('old memo'));
    expect(view.mandalaCell).toBeNull();
  });

  it('returns note=null when both columns are null', async () => {
    mockFindUnique.mockResolvedValue({
      user_note: null,
      user_note_json: null,
      updatedAt: new Date(),
      mandala_id: null,
      cell_index: null,
      video: fakeVideo,
    });

    const svc = new RichNoteService();
    const view = await svc.getRichNote('user-1', 'vid-1');

    expect(view.note).toBeNull();
    expect(view.isLegacy).toBe(false);
  });

  it('throws RichNoteNotFoundError when row missing', async () => {
    mockFindUnique.mockResolvedValue(null);
    const svc = new RichNoteService();
    await expect(svc.getRichNote('u', 'v')).rejects.toBeInstanceOf(RichNoteNotFoundError);
  });
});

describe('RichNoteService.saveRichNote', () => {
  it('dual-writes Tiptap JSON + plain-text extract', async () => {
    mockUpdate.mockResolvedValue({ updatedAt: new Date('2026-04-09T01:00:00Z') });
    const svc = new RichNoteService();
    const result = await svc.saveRichNote('user-1', 'vid-1', doc);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ user_id_videoId: { user_id: 'user-1', videoId: 'vid-1' } });
    expect(call.data.user_note_json).toEqual(doc);
    expect(call.data.user_note).toBe('hello');
    expect(result.updatedAt).toBe('2026-04-09T01:00:00.000Z');
  });

  it('clears both columns when doc is empty', async () => {
    mockUpdate.mockResolvedValue({ updatedAt: new Date() });
    const svc = new RichNoteService();
    const empty: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
    await svc.saveRichNote('user-1', 'vid-1', empty);

    const call = mockUpdate.mock.calls[0][0];
    expect(call.data.user_note).toBeNull();
    expect(call.data.user_note_json).toBe(Prisma.JsonNull);
  });

  it('throws RichNoteNotFoundError on P2025', async () => {
    mockUpdate.mockRejectedValue({ code: 'P2025' });
    const svc = new RichNoteService();
    await expect(svc.saveRichNote('u', 'v', doc)).rejects.toBeInstanceOf(RichNoteNotFoundError);
  });
});
