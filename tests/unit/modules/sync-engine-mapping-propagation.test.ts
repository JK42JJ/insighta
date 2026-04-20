/**
 * sync engine — source_mandala_mappings propagation (Issue #389)
 *
 * Pins the behavior of {@link propagateSourceMandalaMapping}:
 *   - mapping found       → updateMany stamps mandala_id + is_in_ideation=false
 *   - no mapping          → legacy behavior preserved (no updateMany call)
 *   - empty newVideoIds   → no DB work at all
 *   - multiple mappings   → oldest-wins (findFirst orderBy created_at asc)
 *   - source_type + source_id filter uses 'playlist' + youtubePlaylistId
 *
 * Unit test against a hand-rolled tx mock; no Prisma, no database.
 */

jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  logSyncOperation: jest.fn(),
}));

import {
  propagateSourceMandalaMapping,
  type SourceMandalaMappingTx,
} from '../../../src/modules/sync/engine';

const USER_ID = '00000000-0000-0000-0000-000000000010';
const PLAYLIST_ROW_ID = '00000000-0000-0000-0000-000000000011';
const YT_PLAYLIST_ID = 'PLabcdef123456';
const MANDALA_A = '00000000-0000-0000-0000-000000000020';
const VIDEO_1 = '00000000-0000-0000-0000-000000000030';
const VIDEO_2 = '00000000-0000-0000-0000-000000000031';
const VIDEO_3 = '00000000-0000-0000-0000-000000000032';

function makeTxMock(): {
  tx: SourceMandalaMappingTx;
  findFirst: jest.Mock;
  updateMany: jest.Mock;
} {
  const findFirst = jest.fn();
  const updateMany = jest.fn();
  return {
    tx: {
      source_mandala_mappings: { findFirst },
      userVideoState: { updateMany },
    },
    findFirst,
    updateMany,
  };
}

describe('propagateSourceMandalaMapping (Issue #389)', () => {
  it('stamps mandala_id and is_in_ideation=false when a mapping exists', async () => {
    const { tx, findFirst, updateMany } = makeTxMock();
    findFirst.mockResolvedValueOnce({ mandala_id: MANDALA_A });
    updateMany.mockResolvedValueOnce({ count: 3 });

    const result = await propagateSourceMandalaMapping(tx, {
      userId: USER_ID,
      playlistId: PLAYLIST_ROW_ID,
      youtubePlaylistId: YT_PLAYLIST_ID,
      newVideoIds: [VIDEO_1, VIDEO_2, VIDEO_3],
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        user_id: USER_ID,
        source_type: 'playlist',
        source_id: YT_PLAYLIST_ID,
      },
      orderBy: { created_at: 'asc' },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        user_id: USER_ID,
        videoId: { in: [VIDEO_1, VIDEO_2, VIDEO_3] },
      },
      data: {
        mandala_id: MANDALA_A,
        is_in_ideation: false,
      },
    });
    expect(result).toEqual({ mapped: true, mandalaId: MANDALA_A, videosMapped: 3 });
  });

  it('is a no-op when no mapping exists — legacy behavior preserved', async () => {
    const { tx, findFirst, updateMany } = makeTxMock();
    findFirst.mockResolvedValueOnce(null);

    const result = await propagateSourceMandalaMapping(tx, {
      userId: USER_ID,
      playlistId: PLAYLIST_ROW_ID,
      youtubePlaylistId: YT_PLAYLIST_ID,
      newVideoIds: [VIDEO_1, VIDEO_2],
    });

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ mapped: false, mandalaId: null, videosMapped: 0 });
  });

  it('skips all DB calls when newVideoIds is empty (no-op idempotency guard)', async () => {
    const { tx, findFirst, updateMany } = makeTxMock();

    const result = await propagateSourceMandalaMapping(tx, {
      userId: USER_ID,
      playlistId: PLAYLIST_ROW_ID,
      youtubePlaylistId: YT_PLAYLIST_ID,
      newVideoIds: [],
    });

    expect(findFirst).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ mapped: false, mandalaId: null, videosMapped: 0 });
  });

  it('queries with source_type="playlist" + youtubePlaylistId (external YouTube ID, not internal UUID)', async () => {
    const { tx, findFirst, updateMany } = makeTxMock();
    findFirst.mockResolvedValueOnce(null);

    await propagateSourceMandalaMapping(tx, {
      userId: USER_ID,
      playlistId: PLAYLIST_ROW_ID, // internal UUID — must NOT be used in where
      youtubePlaylistId: YT_PLAYLIST_ID, // external — must be used
      newVideoIds: [VIDEO_1],
    });

    const call = findFirst.mock.calls[0]?.[0] as {
      where: { source_id: string; source_type: string };
    };
    expect(call.where.source_id).toBe(YT_PLAYLIST_ID);
    expect(call.where.source_id).not.toBe(PLAYLIST_ROW_ID);
    expect(call.where.source_type).toBe('playlist');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('oldest mapping wins when multiple mappings exist (orderBy created_at asc)', async () => {
    const { tx, findFirst, updateMany } = makeTxMock();
    // findFirst + orderBy asc ≡ oldest. The mock returns only what we program,
    // but we can assert the call's orderBy clause.
    findFirst.mockResolvedValueOnce({ mandala_id: MANDALA_A });
    updateMany.mockResolvedValueOnce({ count: 1 });

    await propagateSourceMandalaMapping(tx, {
      userId: USER_ID,
      playlistId: PLAYLIST_ROW_ID,
      youtubePlaylistId: YT_PLAYLIST_ID,
      newVideoIds: [VIDEO_1],
    });

    const findFirstCall = findFirst.mock.calls[0]?.[0] as {
      orderBy?: { created_at: string };
    };
    expect(findFirstCall.orderBy).toEqual({ created_at: 'asc' });
  });
});
