/**
 * recordErrorEvent — fire-and-forget error_events writer. Locks: maps input to
 * the row (defaults severity='error'), and NEVER rejects/throws into the caller
 * even when the DB insert fails (a degraded path must not fail twice).
 */

const mockCreate = jest.fn();
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ error_events: { create: mockCreate } }),
}));
jest.mock('@/config/index', () => ({ config: { paths: { logs: '/tmp' }, app: { isTest: true } } }));

import { recordErrorEvent } from '../../../src/modules/observability/error-events';

beforeEach(() => mockCreate.mockReset());

describe('recordErrorEvent', () => {
  it('maps input to a row and defaults severity to error', async () => {
    mockCreate.mockResolvedValue({});
    recordErrorEvent({
      subsystem: 'book_fill',
      stage: 'topic_synthesis_hardfail',
      message: '2 cell(s) fell back',
      context: { failedCells: ['a', 'b'] },
      mandalaId: 'm1',
    });
    await Promise.resolve();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const arg = mockCreate.mock.calls[0]![0].data;
    expect(arg.subsystem).toBe('book_fill');
    expect(arg.stage).toBe('topic_synthesis_hardfail');
    expect(arg.severity).toBe('error'); // defaulted
    expect(arg.mandala_id).toBe('m1');
    expect(arg.context).toEqual({ failedCells: ['a', 'b'] });
    expect(arg.video_id).toBeNull();
  });

  it('honors an explicit severity=warn', async () => {
    mockCreate.mockResolvedValue({});
    recordErrorEvent({
      subsystem: 'embedding',
      stage: 'mandala_embed_batch_fail',
      severity: 'warn',
    });
    await Promise.resolve();
    expect(mockCreate.mock.calls[0]![0].data.severity).toBe('warn');
  });

  it('does NOT throw when the DB insert rejects (fire-and-forget)', async () => {
    mockCreate.mockRejectedValue(new Error('db down'));
    // Must not throw synchronously nor reject — the call returns void.
    expect(() => recordErrorEvent({ subsystem: 's', stage: 'x' })).not.toThrow();
    // Let the rejected promise settle; the .catch inside must absorb it.
    await new Promise((r) => setTimeout(r, 5));
  });
});
