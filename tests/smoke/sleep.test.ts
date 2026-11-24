import { sleep } from '../../src/utils/sleep';

describe('sleep', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not resolve before the delay and resolves after it', async () => {
    let done = false;
    const p = sleep(1000).then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it('resolves for sleep(0)', async () => {
    const p = sleep(0);
    await jest.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toBeUndefined();
  });
});
