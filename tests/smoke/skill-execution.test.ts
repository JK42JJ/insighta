/**
 * SkillRegistry execution flow smoke tests
 *
 * Covers: register/lookup, execute happy-path (DB logging), error handling,
 * and quota integration.
 *
 * Mocking strategy:
 *   - getPrismaClient: mocked to avoid real DB connections
 *   - checkSkillQuota: mocked to return { allowed: true } by default
 *   - logger: mocked to suppress output
 *
 * The skillRegistry singleton's internal skills map is cleared in beforeEach
 * via the private field access pattern (skillRegistry['skills'].clear()).
 */
export {};

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted by Jest before any imports
// ---------------------------------------------------------------------------

const mockCreate = jest.fn().mockResolvedValue({ id: 'run-1' });
const mockUpdate = jest.fn().mockResolvedValue({});

jest.mock('../../src/modules/database', () => ({
  getPrismaClient: jest.fn().mockReturnValue({
    skill_runs: {
      create: mockCreate,
      update: mockUpdate,
    },
  }),
}));

const mockCheckSkillQuota = jest.fn().mockResolvedValue({ allowed: true });

jest.mock('../../src/modules/skills/quota-checker', () => ({
  checkSkillQuota: mockCheckSkillQuota,
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are registered
// ---------------------------------------------------------------------------

import { skillRegistry } from '../../src/modules/skills/registry';
import type { InsightaSkill, SkillContext } from '../../src/modules/skills/types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const makeStubSkill = (overrides: Partial<InsightaSkill> = {}): InsightaSkill => ({
  id: 'test-skill',
  version: '1.0.0',
  description: 'Test skill',
  trigger: { type: 'manual' },
  tiers: ['free', 'pro'],
  inputSchema: { type: 'object' },
  execute: jest.fn().mockResolvedValue({ success: true, data: { result: 'ok' } }),
  dryRun: jest.fn().mockResolvedValue({ subject: 'Test', preview_html: '<p>Test</p>' }),
  ...overrides,
});

const makeCtx = (overrides: Partial<SkillContext> = {}): SkillContext => ({
  userId: 'user-abc',
  mandalaId: 'mandala-xyz',
  tier: 'free',
  llm: {} as SkillContext['llm'],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Group 1: SkillRegistry.register & lookup
// ---------------------------------------------------------------------------

describe('SkillRegistry — register & lookup', () => {
  beforeEach(() => {
    // Clear the singleton's internal map between tests
    (skillRegistry as unknown as { skills: Map<string, InsightaSkill> })['skills'].clear();
  });

  it('register() adds skill to registry', () => {
    const skill = makeStubSkill();
    skillRegistry.register(skill);
    expect(skillRegistry.get('test-skill')).toBe(skill);
  });

  it('get() returns registered skill by id', () => {
    const skill = makeStubSkill({ id: 'lookup-skill' });
    skillRegistry.register(skill);
    const found = skillRegistry.get('lookup-skill');
    expect(found).toBeDefined();
    expect(found?.id).toBe('lookup-skill');
  });

  it('get() returns undefined for unknown skill', () => {
    expect(skillRegistry.get('does-not-exist')).toBeUndefined();
  });

  it('listAll() returns all registered skills', () => {
    const a = makeStubSkill({ id: 'skill-a' });
    const b = makeStubSkill({ id: 'skill-b' });
    skillRegistry.register(a);
    skillRegistry.register(b);
    const all = skillRegistry.listAll();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.id)).toEqual(expect.arrayContaining(['skill-a', 'skill-b']));
  });

  it('listForTier() filters by tier — pro skill not visible to free tier', () => {
    const freeSkill = makeStubSkill({ id: 'free-skill', tiers: ['free', 'pro'] });
    const proOnlySkill = makeStubSkill({ id: 'pro-only-skill', tiers: ['pro'] });
    skillRegistry.register(freeSkill);
    skillRegistry.register(proOnlySkill);

    const freeVisible = skillRegistry.listForTier('free');
    expect(freeVisible.map((s) => s.id)).toContain('free-skill');
    expect(freeVisible.map((s) => s.id)).not.toContain('pro-only-skill');

    const proVisible = skillRegistry.listForTier('pro');
    expect(proVisible.map((s) => s.id)).toEqual(
      expect.arrayContaining(['free-skill', 'pro-only-skill'])
    );
  });
});

// ---------------------------------------------------------------------------
// Group 2: SkillRegistry.execute — happy path
// ---------------------------------------------------------------------------

describe('SkillRegistry.execute — happy path', () => {
  beforeEach(() => {
    (skillRegistry as unknown as { skills: Map<string, InsightaSkill> })['skills'].clear();
    mockCreate.mockClear();
    mockUpdate.mockClear();
    mockCheckSkillQuota.mockClear();
    mockCheckSkillQuota.mockResolvedValue({ allowed: true });
  });

  it('execute() calls skill.execute() and returns its result', async () => {
    const skill = makeStubSkill();
    skillRegistry.register(skill);
    const ctx = makeCtx();

    const result = await skillRegistry.execute('test-skill', ctx);

    expect(skill.execute).toHaveBeenCalledWith(ctx);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ result: 'ok' });
  });

  it('execute() creates skill_runs record with status "running"', async () => {
    const skill = makeStubSkill();
    skillRegistry.register(skill);

    await skillRegistry.execute('test-skill', makeCtx());

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          skill_id: 'test-skill',
          status: 'running',
        }),
      })
    );
  });

  it('execute() updates skill_runs to "success" on successful execution', async () => {
    const skill = makeStubSkill();
    skillRegistry.register(skill);

    await skillRegistry.execute('test-skill', makeCtx());

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({ status: 'success' }),
      })
    );
  });

  it('execute() returns result.data from skill on success', async () => {
    const expectedData = { sent: true, message_id: 'msg-42' };
    const skill = makeStubSkill({
      execute: jest.fn().mockResolvedValue({ success: true, data: expectedData }),
    });
    skillRegistry.register(skill);

    const result = await skillRegistry.execute('test-skill', makeCtx());

    expect(result.success).toBe(true);
    expect(result.data).toEqual(expectedData);
  });
});

// ---------------------------------------------------------------------------
// Group 3: SkillRegistry.execute — error handling
// ---------------------------------------------------------------------------

describe('SkillRegistry.execute — error handling', () => {
  beforeEach(() => {
    (skillRegistry as unknown as { skills: Map<string, InsightaSkill> })['skills'].clear();
    mockCreate.mockClear();
    mockUpdate.mockClear();
    mockCheckSkillQuota.mockClear();
    mockCheckSkillQuota.mockResolvedValue({ allowed: true });
  });

  it('execute() returns error result for unknown skill id', async () => {
    const result = await skillRegistry.execute('nonexistent-skill', makeCtx());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Skill not found/);
    // No DB calls should happen for an unknown skill
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('execute() updates skill_runs to "failed" when skill returns success:false', async () => {
    const skill = makeStubSkill({
      execute: jest.fn().mockResolvedValue({ success: false, error: 'generation error' }),
    });
    skillRegistry.register(skill);

    const result = await skillRegistry.execute('test-skill', makeCtx());

    expect(result.success).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({ status: 'failed', error: 'generation error' }),
      })
    );
  });

  it('execute() catches thrown exceptions, logs them, and marks run as failed', async () => {
    const skill = makeStubSkill({
      execute: jest.fn().mockRejectedValue(new Error('unexpected crash')),
    });
    skillRegistry.register(skill);

    const result = await skillRegistry.execute('test-skill', makeCtx());

    expect(result.success).toBe(false);
    expect(result.error).toBe('unexpected crash');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({ status: 'failed', error: 'unexpected crash' }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Group 4: Quota integration
// ---------------------------------------------------------------------------

describe('SkillRegistry.execute — quota integration', () => {
  beforeEach(() => {
    (skillRegistry as unknown as { skills: Map<string, InsightaSkill> })['skills'].clear();
    mockCreate.mockClear();
    mockUpdate.mockClear();
    mockCheckSkillQuota.mockClear();
    mockCheckSkillQuota.mockResolvedValue({ allowed: true });
  });

  it('execute() checks quota before execution for newsletter skill', async () => {
    const skill = makeStubSkill({ id: 'newsletter' });
    skillRegistry.register(skill);
    const ctx = makeCtx({ tier: 'free' });

    await skillRegistry.execute('newsletter', ctx);

    expect(mockCheckSkillQuota).toHaveBeenCalledTimes(1);
    expect(mockCheckSkillQuota).toHaveBeenCalledWith('newsletter', ctx.userId, ctx.tier);
  });

  it('execute() checks quota before execution for report and alert skills', async () => {
    const reportSkill = makeStubSkill({ id: 'report' });
    const alertSkill = makeStubSkill({ id: 'alert' });
    skillRegistry.register(reportSkill);
    skillRegistry.register(alertSkill);

    const ctx = makeCtx({ tier: 'free' });
    await skillRegistry.execute('report', ctx);
    await skillRegistry.execute('alert', ctx);

    expect(mockCheckSkillQuota).toHaveBeenCalledTimes(2);
    expect(mockCheckSkillQuota).toHaveBeenCalledWith('report', ctx.userId, ctx.tier);
    expect(mockCheckSkillQuota).toHaveBeenCalledWith('alert', ctx.userId, ctx.tier);
  });

  it('execute() returns quota_exceeded error when quota check fails', async () => {
    mockCheckSkillQuota.mockResolvedValue({
      allowed: false,
      reason: 'Monthly limit exceeded (4/4)',
    });

    const skill = makeStubSkill({ id: 'newsletter' });
    skillRegistry.register(skill);

    const result = await skillRegistry.execute('newsletter', makeCtx({ tier: 'free' }));

    expect(result.success).toBe(false);
    expect(result.error).toBe('Monthly limit exceeded (4/4)');
    expect(result.metadata?.quota_exceeded).toBe(true);
    // Skill execute and DB create should NOT be called when quota is exceeded
    expect(skill.execute).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('execute() does NOT check quota for non-quota skills', async () => {
    const skill = makeStubSkill({ id: 'recommend' });
    skillRegistry.register(skill);

    await skillRegistry.execute('recommend', makeCtx());

    expect(mockCheckSkillQuota).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Environment report — always runs
// ---------------------------------------------------------------------------

describe('SkillRegistry environment check', () => {
  it('reports skill execution test capability', () => {
    console.log(
      'INFO: SkillRegistry unit tests run in all environments — no JWT/SUPABASE_URL required'
    );
    expect(typeof skillRegistry.register).toBe('function');
    expect(typeof skillRegistry.execute).toBe('function');
    expect(typeof skillRegistry.listAll).toBe('function');
    expect(typeof skillRegistry.listForTier).toBe('function');
  });
});
