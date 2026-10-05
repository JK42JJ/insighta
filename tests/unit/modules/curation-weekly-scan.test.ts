/**
 * The weekly curation switch (2026-10-05).
 *
 * Paused in prod after nine weeks of zero watches and zero bookmarks. Off must
 * mean nothing is read and nothing is built; on must be the shipped behaviour.
 */

jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));
jest.mock('@/modules/database/client', () => ({ getPrismaClient: () => ({}) }));
jest.mock('@/modules/queue/manager', () => ({ getJobQueue: () => ({}) }));
jest.mock('@/modules/queue/handlers/curation-build', () => ({ enqueueCurationBuild: jest.fn() }));

import { scanCuration } from '@/modules/queue/handlers/curation-weekly';

const NOW = new Date('2026-10-04T23:17:00Z');

function deps(enabled: boolean, due: Array<{ id: string }>) {
  return {
    enabled,
    findDue: jest.fn(async () => due),
    enqueue: jest.fn(async () => 'job'),
    weekOf: () => '2026-10-05',
  };
}

describe('scanCuration', () => {
  it('builds nothing and reads nothing when the weekly refresh is off', async () => {
    const d = deps(false, [{ id: 'a' }, { id: 'b' }]);
    await expect(scanCuration(NOW, d)).resolves.toEqual({ paused: true, due: 0 });
    expect(d.findDue).not.toHaveBeenCalled();
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues one build per due subscription when on, as before', async () => {
    const d = deps(true, [{ id: 'a' }, { id: 'b' }]);
    await expect(scanCuration(NOW, d)).resolves.toEqual({ paused: false, due: 2 });
    expect(d.enqueue).toHaveBeenCalledTimes(2);
    expect(d.enqueue).toHaveBeenCalledWith({ subscriptionId: 'a', weekOf: '2026-10-05' });
  });
});
