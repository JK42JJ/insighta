/**
 * Completion-gated book-fill (CP516). Verifies the flag-gated behavior:
 *  - OFF → legacy debounced per-enrich re-fill (unchanged).
 *  - ON  → build once when every video is attempted (remaining=0), then update
 *          only every ≥5 new non-skipped summaries. Skipped rows are terminal so
 *          an unfixable video does not stall the barrier.
 */
import { maybeTriggerBookFill } from '../../src/modules/queue/handlers/book-fill-gate';
import { isBookFillBarrierEnabled } from '@/config/book-gate';
import { enqueueMandalaBookFill } from '../../src/modules/queue/handlers/mandala-book-fill';
import { getPrismaClient } from '../../src/modules/database/client';

// Break the logger→config import chain (config validation needs prod env vars).
jest.mock('../../src/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));
jest.mock('@/config/book-gate', () => ({ isBookFillBarrierEnabled: jest.fn() }));
jest.mock('../../src/modules/queue/handlers/mandala-book-fill', () => ({
  enqueueMandalaBookFill: jest.fn().mockResolvedValue('job-id'),
}));
jest.mock('../../src/modules/database/client', () => ({ getPrismaClient: jest.fn() }));

const flag = isBookFillBarrierEnabled as unknown as jest.Mock;
const enqueue = enqueueMandalaBookFill as unknown as jest.Mock;
const getPrisma = getPrismaClient as unknown as jest.Mock;

interface V2Row {
  video_id: string;
  quality_flag: string;
  updated_at: Date | null;
}

const ANCIENT = new Date('2000-01-01T00:00:00Z'); // well past the settle grace

function mockPrisma(opts: {
  videoIds: string[];
  v2Rows: V2Row[];
  lastFill: Date | null;
  /** rowless vids with a LIVE enrich job (is_live=true). */
  liveEnrich?: string[];
  /** rowless vids with only TERMINAL enrich jobs (is_live=false). */
  terminalEnrich?: string[];
  /** newest card timestamp (default ANCIENT = past grace). */
  newestCard?: Date | null;
}) {
  const live = opts.liveEnrich ?? [];
  const terminal = opts.terminalEnrich ?? [];
  return {
    user_local_cards: { findMany: jest.fn().mockResolvedValue([]) },
    userVideoState: {
      findMany: jest
        .fn()
        .mockResolvedValue(opts.videoIds.map((id) => ({ video: { youtube_video_id: id } }))),
    },
    video_rich_summaries: { findMany: jest.fn().mockResolvedValue(opts.v2Rows) },
    // Three raw queries now — branch on the SQL text:
    //  enrichJobStates ('is_live'), newestCardAt ('newest'), lastBookFillAt ('completedon').
    $queryRawUnsafe: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('is_live')) {
        return Promise.resolve([
          ...live.map((v) => ({ vid: v, is_live: true })),
          ...terminal.map((v) => ({ vid: v, is_live: false })),
        ]);
      }
      if (sql.includes('newest')) {
        return Promise.resolve([
          { newest: opts.newestCard === undefined ? ANCIENT : opts.newestCard },
        ]);
      }
      return Promise.resolve([{ completedon: opts.lastFill }]);
    }),
  };
}

const row = (id: string, flag = 'pass', updated: Date | null = new Date()): V2Row => ({
  video_id: id,
  quality_flag: flag,
  updated_at: updated,
});

beforeEach(() => jest.clearAllMocks());

describe('maybeTriggerBookFill', () => {
  it('flag OFF → legacy debounced enrich-complete enqueue', async () => {
    flag.mockReturnValue(false);
    getPrisma.mockReturnValue(mockPrisma({ videoIds: [], v2Rows: [], lastFill: null }));
    await maybeTriggerBookFill({ userId: 'u', mandalaId: 'm' });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      { userId: 'u', mandalaId: 'm', trigger: 'enrich-complete' },
      expect.objectContaining({ singletonKey: 'book-fill-m', startAfter: 120 })
    );
  });

  it('flag ON, a video still enriching (no row + live job) → no enqueue', async () => {
    flag.mockReturnValue(true);
    getPrisma.mockReturnValue(
      mockPrisma({ videoIds: ['a', 'b'], v2Rows: [row('a')], lastFill: null, liveEnrich: ['b'] })
    );
    await maybeTriggerBookFill({ userId: 'u', mandalaId: 'm' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  // DEADLOCK FIX (2026-07-16): a rowless video whose enrich FAILED (terminal
  // job, no row) is settled → must NOT stall the gate forever. Old code counted
  // "no row" as pending and never fired the initial barrier.
  it('flag ON, rowless video with a TERMINAL enrich job → settled → fires barrier', async () => {
    flag.mockReturnValue(true);
    getPrisma.mockReturnValue(
      mockPrisma({
        videoIds: ['a', 'b'],
        v2Rows: [row('a')],
        lastFill: null,
        terminalEnrich: ['b'],
      })
    );
    await maybeTriggerBookFill({ userId: 'u', mandalaId: 'm' });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'completion-barrier' }),
      expect.objectContaining({ singletonKey: 'book-fill-barrier-m' })
    );
  });

  // PREMATURE-FIRE GUARD (supervisor 2026-07-16): a rowless video with NO enrich
  // job yet, WITHIN the settle grace, may just have an in-flight enqueue — it
  // must block so the barrier does not fire a partial book.
  it('flag ON, rowless + no job + WITHIN grace → waits (no premature fire)', async () => {
    flag.mockReturnValue(true);
    getPrisma.mockReturnValue(
      mockPrisma({
        videoIds: ['a', 'b'],
        v2Rows: [row('a')],
        lastFill: null,
        newestCard: new Date(), // just placed → within grace
      })
    );
    await maybeTriggerBookFill({ userId: 'u', mandalaId: 'm' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  // Past grace, a no-job rowless video is settled (a failed enqueue must not
  // stall forever) → the barrier fires.
  it('flag ON, rowless + no job + PAST grace → settled → fires barrier', async () => {
    flag.mockReturnValue(true);
    getPrisma.mockReturnValue(
      mockPrisma({ videoIds: ['a', 'b'], v2Rows: [row('a')], lastFill: null, newestCard: ANCIENT })
    );
    await maybeTriggerBookFill({ userId: 'u', mandalaId: 'm' });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'completion-barrier' }),
      expect.anything()
    );
  });

  it('flag ON, all attempted + no prior fill → completion-barrier once', async () => {
    flag.mockReturnValue(true);
    getPrisma.mockReturnValue(
      mockPrisma({ videoIds: ['a', 'b'], v2Rows: [row('a'), row('b')], lastFill: null })
    );
    await maybeTriggerBookFill({ userId: 'u', mandalaId: 'm' });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      { userId: 'u', mandalaId: 'm', trigger: 'completion-barrier' },
      expect.objectContaining({ singletonKey: 'book-fill-barrier-m' })
    );
  });

  it('unfixable (skipped) video does not stall — it still counts as attempted', async () => {
    flag.mockReturnValue(true);
    getPrisma.mockReturnValue(
      mockPrisma({ videoIds: ['a', 'b'], v2Rows: [row('a', 'skipped'), row('b')], lastFill: null })
    );
    await maybeTriggerBookFill({ userId: 'u', mandalaId: 'm' });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'completion-barrier' }),
      expect.anything()
    );
  });

  it('flag ON, prior fill + ≥5 new non-skipped → update-threshold', async () => {
    flag.mockReturnValue(true);
    const old = new Date('2026-07-09T00:00:00Z');
    const fresh = new Date('2026-07-10T00:00:00Z');
    const ids = ['a', 'b', 'c', 'd', 'e'];
    getPrisma.mockReturnValue(
      mockPrisma({ videoIds: ids, v2Rows: ids.map((id) => row(id, 'pass', fresh)), lastFill: old })
    );
    await maybeTriggerBookFill({ userId: 'u', mandalaId: 'm' });
    expect(enqueue).toHaveBeenCalledWith(
      { userId: 'u', mandalaId: 'm', trigger: 'update-threshold' },
      expect.objectContaining({ singletonKey: 'book-fill-update-m' })
    );
  });

  it('flag ON, prior fill + <5 new → no enqueue', async () => {
    flag.mockReturnValue(true);
    const old = new Date('2026-07-09T00:00:00Z');
    const fresh = new Date('2026-07-10T00:00:00Z');
    const ids = ['a', 'b', 'c'];
    getPrisma.mockReturnValue(
      mockPrisma({ videoIds: ids, v2Rows: ids.map((id) => row(id, 'pass', fresh)), lastFill: old })
    );
    await maybeTriggerBookFill({ userId: 'u', mandalaId: 'm' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('flag ON, prior fill + skipped rows do not count toward the ≥5 update', async () => {
    flag.mockReturnValue(true);
    const old = new Date('2026-07-09T00:00:00Z');
    const fresh = new Date('2026-07-10T00:00:00Z');
    const ids = ['a', 'b', 'c', 'd', 'e'];
    getPrisma.mockReturnValue(
      mockPrisma({
        videoIds: ids,
        v2Rows: ids.map((id) => row(id, 'skipped', fresh)),
        lastFill: old,
      })
    );
    await maybeTriggerBookFill({ userId: 'u', mandalaId: 'm' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
