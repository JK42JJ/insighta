import {
  runsQueueWorkers,
  runsSchedulers,
  describeProcessRole,
} from '../../src/config/process-role';

/**
 * The critical property is the default. These flags exist to split one
 * deployment into web and worker processes; if an unset variable resolved to
 * false, deploying this change would silently stop every scheduled job in
 * production. Unset must reproduce today's behaviour.
 */
describe('process role flags', () => {
  it('default to on when unset, so existing deployments are unchanged', () => {
    expect(runsQueueWorkers({})).toBe(true);
    expect(runsSchedulers({})).toBe(true);
  });

  it('treat an empty or whitespace value as unset', () => {
    expect(runsQueueWorkers({ RUN_QUEUE_WORKERS: '' })).toBe(true);
    expect(runsSchedulers({ RUN_SCHEDULERS: '   ' })).toBe(true);
  });

  it.each(['false', 'FALSE', '0', 'no', 'No'])('turns off on %s', (v) => {
    expect(runsQueueWorkers({ RUN_QUEUE_WORKERS: v })).toBe(false);
    expect(runsSchedulers({ RUN_SCHEDULERS: v })).toBe(false);
  });

  it.each(['true', 'TRUE', '1', 'yes'])('stays on for %s', (v) => {
    expect(runsQueueWorkers({ RUN_QUEUE_WORKERS: v })).toBe(true);
    expect(runsSchedulers({ RUN_SCHEDULERS: v })).toBe(true);
  });

  // A typo must not silently disable a scheduler. Falling back to the
  // default is the safe direction: the job keeps running.
  it('falls back to on for an unrecognised value', () => {
    expect(runsQueueWorkers({ RUN_QUEUE_WORKERS: 'off' })).toBe(true);
    expect(runsSchedulers({ RUN_SCHEDULERS: 'disabled' })).toBe(true);
  });

  it('reports both roles for the startup log', () => {
    expect(describeProcessRole({ RUN_QUEUE_WORKERS: 'false', RUN_SCHEDULERS: 'false' })).toBe(
      'queueWorkers=false schedulers=false'
    );
    expect(describeProcessRole({})).toBe('queueWorkers=true schedulers=true');
  });

  // Negative control: the assertions above must be able to fail.
  it('distinguishes the two flags from each other', () => {
    const webRole = { RUN_QUEUE_WORKERS: 'false', RUN_SCHEDULERS: 'false' };
    const workerRole = {};
    expect(describeProcessRole(webRole)).not.toBe(describeProcessRole(workerRole));
  });
});
