import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Session replay (work order B4, 2026-11-25): on only with a key AND VITE_POSTHOG_REPLAY=1; started
 * after sign-in; the person is the user id only; input masking is left at PostHog's default.
 */

const ph = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
  sessionRecordingStarted: vi.fn(),
  get_session_replay_url: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: ph }));

const URL_ = 'https://us.posthog.com/project/k/replay/s?t=5';
const PROPS = { email: 'p@example.com', created_at: '2026-01-01' };

async function load(key: string, flag: string) {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', key);
  vi.stubEnv('VITE_POSTHOG_REPLAY', flag);
  const mod = await import('@/shared/lib/posthog');
  mod.initPostHog();
  return mod;
}

beforeEach(() => {
  Object.values(ph).forEach((f) => f.mockReset());
  ph.sessionRecordingStarted.mockReturnValue(false);
  ph.get_session_replay_url.mockReturnValue(URL_);
});
afterEach(() => vi.unstubAllEnvs());

describe('PostHog session replay', () => {
  it.each(['', '0', 'true'])('flag %j: exactly the earlier behaviour', async (flag) => {
    const m = await load('phc_k', flag);
    expect(ph.init).toHaveBeenCalledWith('phc_k', {
      api_host: 'https://us.i.posthog.com',
      autocapture: false,
      capture_pageview: true,
      person_profiles: 'identified_only',
    });
    m.identifyUser('u1', PROPS);
    expect(ph.identify).toHaveBeenCalledWith('u1', PROPS);
    ph.sessionRecordingStarted.mockReturnValue(true);
    expect(m.getReplayUrl()).toBeNull();
    m.resetUser();
    expect(ph.startSessionRecording).not.toHaveBeenCalled();
    expect(ph.stopSessionRecording).not.toHaveBeenCalled();
  });

  it('flag on without a key: nothing at all', async () => {
    const m = await load('', '1');
    m.identifyUser('u1', PROPS);
    m.resetUser();
    expect(m.getReplayUrl()).toBeNull();
    for (const f of Object.values(ph)) expect(f).not.toHaveBeenCalled();
  });

  it('flag on: not recording until sign-in, then everyone, as the user id only', async () => {
    const m = await load('phc_k', '1');
    const cfg = ph.init.mock.calls[0]![1];
    expect(cfg.disable_session_recording).toBe(true);
    expect(cfg.autocapture).toBe(false);
    expect(cfg).not.toHaveProperty('session_recording'); // masking stays the default
    expect(ph.startSessionRecording).not.toHaveBeenCalled();
    m.identifyUser('u1', PROPS);
    expect(ph.identify.mock.calls).toEqual([['u1']]);
    expect(ph.startSessionRecording).toHaveBeenCalledWith(true);
    // a token refresh identifies again: the running recording is left alone
    ph.sessionRecordingStarted.mockReturnValue(true);
    m.identifyUser('u1', PROPS);
    expect(ph.startSessionRecording).toHaveBeenCalledTimes(1);
  });

  it('sign-out stops the recording', async () => {
    const m = await load('phc_k', '1');
    m.resetUser();
    expect(ph.stopSessionRecording).toHaveBeenCalledTimes(1);
    expect(ph.reset).toHaveBeenCalledTimes(1);
  });

  it('getReplayUrl: 10 seconds back while recording, else null', async () => {
    const m = await load('phc_k', '1');
    expect(m.getReplayUrl()).toBeNull();
    expect(ph.get_session_replay_url).not.toHaveBeenCalled();
    ph.sessionRecordingStarted.mockReturnValue(true);
    expect(m.getReplayUrl()).toBe(URL_);
    expect(ph.get_session_replay_url).toHaveBeenCalledWith({
      withTimestamp: true,
      timestampLookBack: 10,
    });
    ph.get_session_replay_url.mockReturnValue('');
    expect(m.getReplayUrl()).toBeNull();
    ph.get_session_replay_url.mockImplementation(() => {
      throw new Error('x');
    });
    expect(m.getReplayUrl()).toBeNull();
  });
});
