/**
 * The corpus move and the ledger row have to land in one transaction.
 *
 * They used to be two. A crash in between advanced the rows and wrote no
 * ledger row, and `alreadyRecorded` reads a missing row as "did not happen".
 * The retry then read the previous stage — empty, because those rows had
 * already moved — and recorded a balanced `0 in, 0 out`. The arithmetic check
 * passes on that, so one container restart emptied the corpus and the ledger
 * called it a clean pass. The comment above the old code claimed this was a
 * "clean re-run"; it was not.
 *
 * These tests fail if the two writes ever land on different clients again.
 */

jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const executed: Array<{ on: string }> = [];
const created: Array<{ on: string; data: Record<string, unknown> }> = [];
let failLedger = false;

/** The client handed to the transaction callback. Tagged so we can tell it apart. */
const txClient = {
  tag: 'tx',
  $executeRaw: jest.fn(async () => {
    executed.push({ on: 'tx' });
    return 1;
  }),
  newsletter_pipeline_steps: {
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      if (failLedger) throw new Error('ledger write died mid-stage');
      created.push({ on: 'tx', data: args.data });
      return {};
    }),
  },
};

/** The outer client. Any write landing here is the bug coming back. */
const outer = {
  tag: 'outer',
  $executeRaw: jest.fn(async () => {
    executed.push({ on: 'outer' });
    return 1;
  }),
  newsletter_pipeline_steps: {
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      created.push({ on: 'outer', data: args.data });
      return {};
    }),
  },
  $queryRaw: jest.fn(async () => []),
  $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
};

jest.mock('@/modules/database/client', () => ({ getPrismaClient: () => outer }));

import { toRunnable, type StageContext } from '@/modules/newsletter/pipeline/stage';
import type { Stage } from '@/modules/newsletter/pipeline/stage';

const ctx = { runId: 'r1' } as unknown as StageContext;

const stage: Stage = {
  id: 'S2_domain',
  what: 'test',
  kind: 'machine',
  run: async () => ({
    survivors: [{ videoId: 'a' }, { videoId: 'b' }],
    drops: [{ videoId: 'c', reason: 'out_of_scope' }],
    itemsIn: 3,
  }),
};

beforeEach(() => {
  executed.length = 0;
  created.length = 0;
  failLedger = false;
  jest.clearAllMocks();
});

describe('stage commit', () => {
  it('puts the corpus writes and the ledger row in the same transaction', async () => {
    await toRunnable(stage, null, ctx).invoke();

    expect(outer.$transaction).toHaveBeenCalledTimes(1);
    expect(executed.length).toBe(3); // two survivors, one drop
    expect(executed.every((e) => e.on === 'tx')).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.on).toBe('tx');
  });

  it('never writes through the outer client', async () => {
    await toRunnable(stage, null, ctx).invoke();

    expect(outer.$executeRaw).not.toHaveBeenCalled();
    expect(outer.newsletter_pipeline_steps.create).not.toHaveBeenCalled();
  });

  it('fails the whole transaction when the ledger write dies', async () => {
    failLedger = true;

    // The corpus statements ran, but they ran inside the transaction the
    // ledger write then aborted — so Postgres rolls them back and the rows
    // stay where they were. Two transactions would have left them advanced.
    await expect(toRunnable(stage, null, ctx).invoke()).rejects.toThrow('ledger write died');
    expect(executed.every((e) => e.on === 'tx')).toBe(true);
    expect(created).toHaveLength(0);
  });
});
