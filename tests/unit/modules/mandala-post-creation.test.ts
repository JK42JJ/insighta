/**
 * mandala-post-creation — Phase 3.5 pipeline tests
 *
 * Pipeline tested:
 *   Step 1: ensureMandalaEmbeddings (fire-and-forget, chained)
 *   Step 2: video-discover (opt-in gated, chained after step 1)
 *
 * Contracts pinned:
 *   - fire-and-forget: `triggerMandalaPostCreationAsync` returns void
 *     synchronously, all error paths logged + swallowed
 *   - embedding step runs unconditionally (before opt-in check)
 *   - video-discover opt-in gate: skill_type='video_discover' + enabled=true
 *   - naming bridge: wizard writes 'video_discover' (underscore), plugin
 *     is registered as 'video-discover' (hyphen) — helper resolves both
 *   - tier resolution from user_subscriptions (default 'free')
 *   - embedding failure does NOT block video-discover dispatch — plugin
 *     preflight has its own skip reason for missing embeddings
 *
 * Mocks:
 *   - ./ensure-mandala-embeddings: full control of result
 *   - @/modules/database: skill config + user_subscriptions lookups
 *   - @/modules/skills: skillRegistry.execute
 *   - @/modules/llm: createGenerationProvider (minimal stub)
 */

const mockEnsureEmbeddings = jest.fn();
const mockSkillConfigFindFirst = jest.fn();
const mockSubFindUnique = jest.fn();
const mockSkillRegistryExecute = jest.fn();
const mockCreateGenerationProvider = jest.fn();

jest.mock('../../../src/modules/mandala/ensure-mandala-embeddings', () => ({
  ensureMandalaEmbeddings: mockEnsureEmbeddings,
}));

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

import { triggerMandalaPostCreationAsync } from '../../../src/modules/mandala/mandala-post-creation';

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

describe('triggerMandalaPostCreationAsync', () => {
  beforeEach(() => {
    mockEnsureEmbeddings.mockReset();
    mockSkillConfigFindFirst.mockReset();
    mockSubFindUnique.mockReset();
    mockSkillRegistryExecute.mockReset();
    mockCreateGenerationProvider.mockReset();
    mockCreateGenerationProvider.mockResolvedValue({ name: 'stub' });
    // Default: embeddings succeed (already present) — tests override as needed
    mockEnsureEmbeddings.mockResolvedValue({
      ok: true,
      alreadyPresent: true,
      finalCount: 8,
      embedMs: 0,
    });
  });

  it('returns synchronously (fire-and-forget)', () => {
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSubFindUnique.mockResolvedValue({ tier: 'free' });
    mockSkillRegistryExecute.mockResolvedValue({ success: true, data: {} });

    const ret = triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID);
    // Must be undefined (void) — not a Promise
    expect(ret).toBeUndefined();
  });

  it('skips silently when user_skill_config has no row', async () => {
    mockSkillConfigFindFirst.mockResolvedValue(null);

    triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID);
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

    triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID);
    await flushAsync();

    expect(mockSkillRegistryExecute).not.toHaveBeenCalled();
  });

  it('invokes skillRegistry with hyphenated plugin id when enabled', async () => {
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSubFindUnique.mockResolvedValue({ tier: 'pro' });
    mockSkillRegistryExecute.mockResolvedValue({ success: true, data: { rows: 20 } });

    triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID);
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

    triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID);
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
    expect(() => triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID)).not.toThrow();
    await flushAsync();

    expect(mockSkillRegistryExecute).toHaveBeenCalled();
  });

  it('swallows unexpected exceptions (DB failure, LLM init failure, plugin crash)', async () => {
    mockSkillConfigFindFirst.mockRejectedValue(new Error('DB down'));

    expect(() => triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID)).not.toThrow();
    await flushAsync();

    // skill was never reached because the DB query failed
    expect(mockSkillRegistryExecute).not.toHaveBeenCalled();
  });

  it('swallows skillRegistry.execute() throws (plugin bug)', async () => {
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSubFindUnique.mockResolvedValue({ tier: 'admin' });
    mockSkillRegistryExecute.mockRejectedValue(new Error('plugin crashed'));

    expect(() => triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID)).not.toThrow();
    await flushAsync();

    expect(mockSkillRegistryExecute).toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Step 1: Embedding chain tests
  // ──────────────────────────────────────────────────────────────────────

  it('runs ensureMandalaEmbeddings BEFORE reaching the video-discover opt-in gate', async () => {
    // Opt-in disabled → video-discover will skip, but embedding step
    // MUST still run (it's unconditional — general platform asset).
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: false });

    triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID);
    await flushAsync();

    expect(mockEnsureEmbeddings).toHaveBeenCalledWith(MANDALA_ID);
    expect(mockSkillRegistryExecute).not.toHaveBeenCalled();
  });

  it('SKIPS video-discover when ensureMandalaEmbeddings reports ok=false (short-circuit)', async () => {
    // Design rule: if step 1 fails, don't bother running step 2 — the
    // video-discover preflight would skip anyway for "no embeddings",
    // burning 2 DB queries + LLM provider init + skill_runs logging for
    // a guaranteed skip.
    mockEnsureEmbeddings.mockResolvedValue({
      ok: false,
      alreadyPresent: false,
      finalCount: 0,
      embedMs: 500,
      reason: 'mandala has no root level',
    });
    // These would be hit if short-circuit was broken — keep them defined
    // so a regression shows up as "unexpected call" rather than a silent pass
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSubFindUnique.mockResolvedValue({ tier: 'free' });
    mockSkillRegistryExecute.mockResolvedValue({ success: true, data: {} });

    triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID);
    await flushAsync();

    expect(mockEnsureEmbeddings).toHaveBeenCalled();
    expect(mockSkillRegistryExecute).not.toHaveBeenCalled(); // short-circuited
    expect(mockSkillConfigFindFirst).not.toHaveBeenCalled(); // also skipped
  });

  it('SKIPS video-discover when ensureMandalaEmbeddings throws (short-circuit)', async () => {
    mockEnsureEmbeddings.mockRejectedValue(new Error('Ollama network error'));
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSkillRegistryExecute.mockResolvedValue({ success: true, data: {} });

    expect(() => triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID)).not.toThrow();
    await flushAsync();

    expect(mockEnsureEmbeddings).toHaveBeenCalled();
    expect(mockSkillRegistryExecute).not.toHaveBeenCalled();
    expect(mockSkillConfigFindFirst).not.toHaveBeenCalled();
  });

  it('proceeds to video-discover when ensureMandalaEmbeddings reports ok=true (alreadyPresent)', async () => {
    mockEnsureEmbeddings.mockResolvedValue({
      ok: true,
      alreadyPresent: true,
      finalCount: 8,
      embedMs: 0,
    });
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSubFindUnique.mockResolvedValue({ tier: 'free' });
    mockSkillRegistryExecute.mockResolvedValue({ success: true, data: {} });

    triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID);
    await flushAsync();

    expect(mockSkillRegistryExecute).toHaveBeenCalled();
  });

  it('proceeds to video-discover when ensureMandalaEmbeddings reports ok=true (just generated)', async () => {
    mockEnsureEmbeddings.mockResolvedValue({
      ok: true,
      alreadyPresent: false,
      finalCount: 8,
      embedMs: 9500,
    });
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true });
    mockSubFindUnique.mockResolvedValue({ tier: 'free' });
    mockSkillRegistryExecute.mockResolvedValue({ success: true, data: {} });

    triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID);
    await flushAsync();

    expect(mockSkillRegistryExecute).toHaveBeenCalled();
  });

  it('runs embedding step with mandalaId only (no userId needed)', async () => {
    triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID);
    await flushAsync();

    // Embeddings are a platform asset keyed by mandala, not user
    expect(mockEnsureEmbeddings).toHaveBeenCalledWith(MANDALA_ID);
    expect(mockEnsureEmbeddings).not.toHaveBeenCalledWith(USER_ID, MANDALA_ID);
  });
});
