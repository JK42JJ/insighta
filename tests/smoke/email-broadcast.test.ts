/**
 * Broadcast guards.
 *
 * A mass mail cannot be recalled, so the properties worth pinning are the ones
 * that stop it: it refuses a count that no longer matches the population, it
 * refuses an implausible size, and it can never mail the same person twice —
 * not on a re-run, not on a retry, not when two runs overlap.
 */

const created: Array<{ campaign: string; email: string }> = [];
const updated: Array<{ email: string; status: string }> = [];
let authUsers: string[] = [];
let alreadySent: string[] = [];
const sendCalls: string[] = [];
let sendResult: { status: string; error?: string; reason?: string } = { status: 'sent' };

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    $queryRawUnsafe: async () => authUsers.map((email) => ({ email })),
    email_broadcast_sends: {
      findMany: async () => alreadySent.map((email) => ({ email })),
      create: async ({ data }: { data: { campaign: string; email: string } }) => {
        // the unique index, modelled: a second claim for the same pair throws
        if (created.some((c) => c.campaign === data.campaign && c.email === data.email)) {
          throw new Error('duplicate key value violates unique constraint');
        }
        created.push({ campaign: data.campaign, email: data.email });
        return data;
      },
      update: async ({
        where,
        data,
      }: {
        where: { campaign_email: { email: string } };
        data: { status: string };
      }) => {
        updated.push({ email: where.campaign_email.email, status: data.status });
        return data;
      },
    },
  }),
}));

jest.mock('@/modules/email/transactional', () => ({
  sendMobileGuideEmail: async (to: string) => {
    sendCalls.push(to);
    return sendResult;
  },
}));

import {
  planBroadcast,
  runBroadcast,
  BROADCAST_MAX_RECIPIENTS,
} from '../../src/modules/email/broadcast';

beforeEach(() => {
  created.length = 0;
  updated.length = 0;
  sendCalls.length = 0;
  authUsers = ['a@x.com', 'b@x.com', 'c@x.com'];
  alreadySent = [];
  sendResult = { status: 'sent' };
});

describe('planBroadcast', () => {
  it('separates who still needs it from who already got it', async () => {
    alreadySent = ['b@x.com'];
    const plan = await planBroadcast('mobile-guide');
    expect(plan.recipients).toEqual(['a@x.com', 'c@x.com']);
    expect(plan.alreadySent).toEqual(['b@x.com']);
    expect(plan.total).toBe(3);
  });
});

describe('runBroadcast — refusals', () => {
  it('refuses when the confirmed count no longer matches', async () => {
    // someone signed up between the dry run and the send
    await expect(runBroadcast('mobile-guide', 2)).rejects.toThrow('RECIPIENT_COUNT_MISMATCH');
    expect(sendCalls).toHaveLength(0);
  });

  it('refuses an implausible population outright', async () => {
    authUsers = Array.from({ length: BROADCAST_MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@x.com`);
    await expect(runBroadcast('mobile-guide', authUsers.length)).rejects.toThrow('RECIPIENT_LIMIT');
    expect(sendCalls).toHaveLength(0);
  });

  it('sends nothing at all when it refuses', async () => {
    await expect(runBroadcast('mobile-guide', 999)).rejects.toThrow();
    expect(created).toHaveLength(0);
  });
});

describe('runBroadcast — no one is mailed twice', () => {
  it('skips anyone already recorded for the campaign', async () => {
    alreadySent = ['b@x.com'];
    const r = await runBroadcast('mobile-guide', 2);
    expect(sendCalls).toEqual(['a@x.com', 'c@x.com']);
    expect(r.sent).toBe(2);
  });

  it('claims the recipient before sending, so an overlapping run cannot double-mail', async () => {
    // pre-claim c@x.com, as a concurrent run would have
    created.push({ campaign: 'mobile-guide', email: 'c@x.com' });
    const r = await runBroadcast('mobile-guide', 3);
    expect(sendCalls).toEqual(['a@x.com', 'b@x.com']); // c skipped, not re-sent
    expect(r.attempted).toBe(3);
    expect(r.sent).toBe(2);
  });

  it('records a failure with its reason so a retry can target it', async () => {
    sendResult = { status: 'failed', error: 'smtp 550' };
    const r = await runBroadcast('mobile-guide', 3);
    expect(r.sent).toBe(0);
    expect(r.failed).toHaveLength(3);
    expect(r.failed[0]).toEqual({ email: 'a@x.com', error: 'smtp 550' });
    expect(updated.every((u) => u.status === 'failed')).toBe(true);
  });

  it('treats a skipped send as a failure rather than a success', async () => {
    sendResult = { status: 'skipped', reason: 'disabled' };
    const r = await runBroadcast('mobile-guide', 3);
    expect(r.sent).toBe(0);
    expect(r.failed[0]!.error).toContain('disabled');
  });
});
