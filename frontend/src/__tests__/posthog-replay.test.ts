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

async function load(key: string, flag: string, until = '2999-12-31') {
  vi.resetModules();
  // happy-dom calls itself automated; a participant's browser is not
  vi.spyOn(navigator, 'webdriver', 'get').mockReturnValue(false);
  vi.stubEnv('VITE_POSTHOG_KEY', key);
  vi.stubEnv('VITE_POSTHOG_REPLAY', flag);
  vi.stubEnv('VITE_POSTHOG_REPLAY_UNTIL', until);
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

  it('past the last day, or without one: no recording and no person', async () => {
    for (const until of ['2000-01-01', '']) {
      const m = await load('phc_k', '1', until);
      m.identifyUser('u1', PROPS);
      expect(ph.identify).not.toHaveBeenCalled();
      expect(ph.startSessionRecording).not.toHaveBeenCalled();
      expect(m.getReplayUrl()).toBeNull();
    }
  });

  it('the last day is a Korean day; an automated browser is never recorded', async () => {
    const { replayAllowed } = await load('phc_k', '1');
    const at = (iso: string): boolean => replayAllowed(new Date(iso), false, true, '2026-12-09');
    expect(at('2026-12-09T14:59:59Z')).toBe(true); // 23:59 KST
    expect(at('2026-12-09T15:00:00Z')).toBe(false); // the 10th in Korea
    expect(replayAllowed(new Date('2026-12-01'), true, true, '2026-12-09')).toBe(false);
    expect(replayAllowed(new Date('2026-12-01'), false, false, '2026-12-09')).toBe(false);
  });

  it('a replay build sends the recording and the user id only, never product events', async () => {
    const { onlyReplay } = await load('phc_k', '1');
    const cfg = ph.init.mock.calls[0]![1];
    expect(cfg.capture_pageview).toBe(false);
    expect(cfg.before_send).toBe(onlyReplay);
    expect(onlyReplay({ event: '$snapshot' })).toEqual({ event: '$snapshot' });
    for (const event of ['$pageview', 'card_added', '$autocapture']) {
      expect(onlyReplay({ event })).toBeNull();
    }
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
