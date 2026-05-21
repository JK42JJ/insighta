/**
 * Unit tests for the chatbot background failover poller (CP477+14).
 *
 * Covers:
 *   - `getEffectiveProvider`:
 *       flag OFF → returns config.chatbot.provider (no-op path)
 *       flag ON, no tick yet → returns config.chatbot.provider
 *       flag ON, after unhealthy tick → returns 'openrouter'
 *       flag ON, after recovery tick → returns 'qwen-runpod'
 *   - `startProviderHealthPoller`:
 *       flag OFF → no timer, no probe
 *       provider != qwen-runpod → no timer, no probe
 *       healthy → unhealthy → calls onChange once with 'openrouter'
 *       unhealthy → healthy → calls onChange once with 'qwen-runpod'
 *       duplicate start → second call is a no-op
 *   - `stopProviderHealthPoller`:
 *       clears the timer + resets effectiveProvider
 */

// Top-level mock so the SUT picks our config + isQwenRunpodHealthy stub.
// Both mocks are defined before the SUT import below.

type ChatbotProvider = 'gemini' | 'openrouter' | 'local' | 'qwen-runpod';

const mockConfig: {
  chatbot: { provider: ChatbotProvider; failoverEnabled: boolean };
  qwenLora: { apiUrl: string };
} = {
  chatbot: {
    provider: 'qwen-runpod',
    failoverEnabled: true,
  },
  qwenLora: {
    apiUrl: 'https://example.proxy.runpod.net/v1',
  },
};

jest.mock('@/config/index', () => ({
  get config() {
    return mockConfig;
  },
}));

const mockIsHealthy = jest.fn<Promise<boolean>, [string | undefined]>();

jest.mock('@/api/routes/copilotkit-health', () => ({
  isQwenRunpodHealthy: (apiUrl: string | undefined) => mockIsHealthy(apiUrl),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// SUT (lazy require inside each suite so module-level state can be reset)
type PollerModule = typeof import('@/api/routes/copilotkit-provider-poller');

function loadPoller(): PollerModule {
  jest.isolateModules(() => {
    /* no-op — isolateModules clears module registry; require below picks fresh copy */
  });
  return require('@/api/routes/copilotkit-provider-poller') as PollerModule;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // Reset config defaults — individual tests override.
  mockConfig.chatbot.provider = 'qwen-runpod';
  mockConfig.chatbot.failoverEnabled = true;
  mockIsHealthy.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('getEffectiveProvider', () => {
  it('flag OFF → returns config.chatbot.provider unconditionally', () => {
    mockConfig.chatbot.failoverEnabled = false;
    const poller = loadPoller();
    expect(poller.getEffectiveProvider()).toBe('qwen-runpod');
  });

  it('flag ON, before any tick → returns config.chatbot.provider', () => {
    const poller = loadPoller();
    expect(poller.getEffectiveProvider()).toBe('qwen-runpod');
  });

  it('flag ON, after unhealthy tick → returns openrouter', async () => {
    const poller = loadPoller();
    mockIsHealthy.mockResolvedValue(false);
    const onChange = jest.fn();
    poller.startProviderHealthPoller(onChange);
    // Drain the immediate tick() promise.
    await Promise.resolve();
    await Promise.resolve();
    expect(poller.getEffectiveProvider()).toBe('openrouter');
    expect(onChange).toHaveBeenCalledWith('openrouter');
    expect(onChange).toHaveBeenCalledTimes(1);
    poller.stopProviderHealthPoller();
  });
});

describe('startProviderHealthPoller', () => {
  it('flag OFF → returns without scheduling a probe', async () => {
    mockConfig.chatbot.failoverEnabled = false;
    const poller = loadPoller();
    const onChange = jest.fn();
    poller.startProviderHealthPoller(onChange);
    await Promise.resolve();
    expect(mockIsHealthy).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('provider != qwen-runpod → returns without scheduling a probe', async () => {
    mockConfig.chatbot.provider = 'openrouter';
    const poller = loadPoller();
    const onChange = jest.fn();
    poller.startProviderHealthPoller(onChange);
    await Promise.resolve();
    expect(mockIsHealthy).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('healthy → unhealthy transition fires onChange once with openrouter', async () => {
    const poller = loadPoller();
    mockIsHealthy.mockResolvedValueOnce(true);
    const onChange = jest.fn();
    poller.startProviderHealthPoller(onChange);
    // initial tick — healthy, no transition
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    expect(poller.getEffectiveProvider()).toBe('qwen-runpod');

    // Advance the poller. Next tick reports unhealthy.
    mockIsHealthy.mockResolvedValueOnce(false);
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledWith('openrouter');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(poller.getEffectiveProvider()).toBe('openrouter');
    poller.stopProviderHealthPoller();
  });

  it('duplicate start → second call is a no-op (no second timer)', async () => {
    const poller = loadPoller();
    mockIsHealthy.mockResolvedValue(true);
    const onChange = jest.fn();
    poller.startProviderHealthPoller(onChange);
    await Promise.resolve();
    const callsAfterFirst = mockIsHealthy.mock.calls.length;
    poller.startProviderHealthPoller(onChange);
    await Promise.resolve();
    expect(mockIsHealthy.mock.calls.length).toBe(callsAfterFirst);
    poller.stopProviderHealthPoller();
  });
});

describe('stopProviderHealthPoller', () => {
  it('clears the timer + resets effectiveProvider', async () => {
    const poller = loadPoller();
    mockIsHealthy.mockResolvedValue(false);
    const onChange = jest.fn();
    poller.startProviderHealthPoller(onChange);
    await Promise.resolve();
    await Promise.resolve();
    expect(poller.getEffectiveProvider()).toBe('openrouter');

    poller.stopProviderHealthPoller();
    // After stop, the next read should fall back to config.chatbot.provider
    expect(poller.getEffectiveProvider()).toBe('qwen-runpod');

    // Advance timer — no more probes.
    mockIsHealthy.mockClear();
    jest.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(mockIsHealthy).not.toHaveBeenCalled();
  });
});
