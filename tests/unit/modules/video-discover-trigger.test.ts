/**
 * video-discover-trigger — Phase 3.5 mandala.created wiring tests
 *
 * Pipes tested:
 *   - opt-in gate: user_skill_config lookup with skill_type='video_discover'
 *     AND enabled=true
 *   - naming bridge: wizard writes 'video_discover' (underscore), plugin is
 *     registered as 'video-discover' (hyphen) — trigger resolves correctly
 *   - tier resolution from user_subscriptions
 *   - fire-and-forget semantics: triggerVideoDiscoverAsync returns
 *     synchronously, error paths never throw to caller
 *   - plugin skip path (result.success=false) is logged, not rethrown
 *
 * Mocks:
 *   - @/modules/database: skill config + user_subscriptions lookups
 *   - @/modules/skills: skillRegistry.execute
 *   - @/modules/llm: createGenerationProvider (minimal stub)
 */

const mockSkillConfigFindFirst = jest.fn();
const mockSubFindUnique = jest.fn();
const mockSkillRegistryExecute = jest.fn();
const mockCreateGenerationProvider = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    user_skill_config: { findFirst: mockSkillConfigFindFirst },
    user_subscriptions: { findUnique: mockSubFindUnique },
  }),
}));

jest.mock('@/modules/skills', () => ({
  skillRegistry: { execute: mockSkillRegistryExecute },
}));

jest.mock('@/modules/llm', () => ({
  createGenerationProvider: mockCreateGenerationProvider,
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

import { triggerVideoDiscoverAsync } from '../../../src/modules/mandala/video-discover-trigger';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const MANDALA_ID = '00000000-0000-0000-0000-000000000002';

/**
 * Flush the setImmediate queue and any microtasks so we can observe the
 * fire-and-forget side effects deterministically.
 */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  // A second tick covers the inner catch() chain + await
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('triggerVideoDiscoverAsync', () => {
  beforeEach(() => {
    mockSkillConfigFindFirst.mockReset();
    mockSubFindUnique.mockReset();
    mockSkillRegistryExecute.mockReset();
    mockCreateGenerationProvider.mockReset();
    mockCreateGenerationProvider.mockResolvedValue({ name: 'stub' });
  });

  it('returns synchronously (fire-and-forget)', () => {
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSubFindUnique.mockResolvedValue({ tier: 'free' });
    mockSkillRegistryExecute.mockResolvedValue({ success: true, data: {} });

    const ret = triggerVideoDiscoverAsync(USER_ID, MANDALA_ID);
    // Must be undefined (void) — not a Promise
    expect(ret).toBeUndefined();
  });

  it('skips silently when user_skill_config has no row', async () => {
    mockSkillConfigFindFirst.mockResolvedValue(null);

    triggerVideoDiscoverAsync(USER_ID, MANDALA_ID);
    await flushAsync();

    expect(mockSkillConfigFindFirst).toHaveBeenCalledWith({
      where: {
        user_id: USER_ID,
        mandala_id: MANDALA_ID,
        skill_type: 'video_discover', // wizard underscore, not hyphen
      },
      select: { enabled: true },
    });
    expect(mockSkillRegistryExecute).not.toHaveBeenCalled();
  });

  it('skips silently when video_discover is disabled (enabled=false)', async () => {
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: false });

    triggerVideoDiscoverAsync(USER_ID, MANDALA_ID);
    await flushAsync();

    expect(mockSkillRegistryExecute).not.toHaveBeenCalled();
  });

  it('invokes skillRegistry with hyphenated plugin id when enabled', async () => {
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSubFindUnique.mockResolvedValue({ tier: 'pro' });
    mockSkillRegistryExecute.mockResolvedValue({ success: true, data: { rows: 20 } });

    triggerVideoDiscoverAsync(USER_ID, MANDALA_ID);
    await flushAsync();

    expect(mockSkillRegistryExecute).toHaveBeenCalledTimes(1);
    const [skillId, ctx] = mockSkillRegistryExecute.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    // Bridge: user_skill_config has 'video_discover', plugin id is 'video-discover'
    expect(skillId).toBe('video-discover');
    expect(ctx).toMatchObject({
      userId: USER_ID,
      mandalaId: MANDALA_ID,
      tier: 'pro',
    });
    expect(ctx).toHaveProperty('llm');
  });

  it('defaults tier to "free" when user_subscriptions row is missing', async () => {
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSubFindUnique.mockResolvedValue(null);
    mockSkillRegistryExecute.mockResolvedValue({ success: true, data: {} });

    triggerVideoDiscoverAsync(USER_ID, MANDALA_ID);
    await flushAsync();

    const ctx = mockSkillRegistryExecute.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(ctx['tier']).toBe('free');
  });

  it('swallows plugin skip results (success=false) without throwing', async () => {
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSubFindUnique.mockResolvedValue({ tier: 'free' });
    mockSkillRegistryExecute.mockResolvedValue({
      success: false,
      error: 'YouTube account not connected.',
    });

    // Should NOT throw — the helper's contract is fire-and-forget
    expect(() => triggerVideoDiscoverAsync(USER_ID, MANDALA_ID)).not.toThrow();
    await flushAsync();

    expect(mockSkillRegistryExecute).toHaveBeenCalled();
  });

  it('swallows unexpected exceptions (DB failure, LLM init failure, plugin crash)', async () => {
    mockSkillConfigFindFirst.mockRejectedValue(new Error('DB down'));

    expect(() => triggerVideoDiscoverAsync(USER_ID, MANDALA_ID)).not.toThrow();
    await flushAsync();

    // skill was never reached because the DB query failed
    expect(mockSkillRegistryExecute).not.toHaveBeenCalled();
  });

  it('swallows skillRegistry.execute() throws (plugin bug)', async () => {
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSubFindUnique.mockResolvedValue({ tier: 'admin' });
    mockSkillRegistryExecute.mockRejectedValue(new Error('plugin crashed'));

    expect(() => triggerVideoDiscoverAsync(USER_ID, MANDALA_ID)).not.toThrow();
    await flushAsync();

    expect(mockSkillRegistryExecute).toHaveBeenCalled();
  });
});
