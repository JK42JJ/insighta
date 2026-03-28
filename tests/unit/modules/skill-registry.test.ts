/**
 * SkillRegistry Unit Tests
 *
 * Tests for:
 * - Skill registration and lookup
 * - listAll / listForTier filtering
 * - execute() with skill_runs logging (mocked DB)
 * - Error handling in execute()
 */

import type {
  InsightaSkill,
  SkillContext,
  SkillResult,
  SkillPreview,
} from '../../../src/modules/skills/types';

// ============================================================================
// Mocks
// ============================================================================

const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../../src/modules/database', () => ({
  getPrismaClient: () => ({
    skill_runs: {
      create: mockCreate,
      update: mockUpdate,
    },
  }),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    }),
  },
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { skillRegistry } from '../../../src/modules/skills/registry';

// ============================================================================
// Test Skill Fixture
// ============================================================================

function createTestSkill(overrides?: Partial<InsightaSkill>): InsightaSkill {
  return {
    id: 'test-skill',
    version: '1.0.0',
    description: 'Test skill',
    trigger: { type: 'manual' },
    tiers: ['free', 'pro', 'lifetime', 'admin'],
    inputSchema: { type: 'object', properties: {} },
    execute: jest.fn(
      async (): Promise<SkillResult> => ({
        success: true,
        data: { result: 'ok' },
      })
    ),
    dryRun: jest.fn(
      async (): Promise<SkillPreview> => ({
        subject: 'Test',
        curated_count: 0,
      })
    ),
    ...overrides,
  };
}

function createTestContext(overrides?: Partial<SkillContext>): SkillContext {
  return {
    userId: 'user-123',
    mandalaId: 'mandala-456',
    tier: 'free',
    llm: { generate: jest.fn(), name: 'test', model: 'test-model' },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SkillRegistry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 'run-123' });
    mockUpdate.mockResolvedValue({});
  });

  describe('register and get', () => {
    it('registers a skill and retrieves by id', () => {
      const skill = createTestSkill({ id: 'reg-test' });
      skillRegistry.register(skill);
      expect(skillRegistry.get('reg-test')).toBe(skill);
    });

    it('returns undefined for unregistered skill', () => {
      expect(skillRegistry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('listAll', () => {
    it('returns all registered skills', () => {
      skillRegistry.register(createTestSkill({ id: 'list-a' }));
      skillRegistry.register(createTestSkill({ id: 'list-b' }));
      const all = skillRegistry.listAll();
      const ids = all.map((s) => s.id);
      expect(ids).toContain('list-a');
      expect(ids).toContain('list-b');
    });
  });

  describe('listForTier', () => {
    it('filters skills by tier', () => {
      skillRegistry.register(createTestSkill({ id: 'pro-only', tiers: ['pro', 'admin'] }));
      const freeSkills = skillRegistry.listForTier('free');
      expect(freeSkills.find((s) => s.id === 'pro-only')).toBeUndefined();

      const proSkills = skillRegistry.listForTier('pro');
      expect(proSkills.find((s) => s.id === 'pro-only')).toBeDefined();
    });
  });

  describe('execute', () => {
    it('returns error for unknown skill', async () => {
      const result = await skillRegistry.execute('unknown', createTestContext());
      expect(result.success).toBe(false);
      expect(result.error).toContain('Skill not found');
    });

    it('creates skill_runs record on start', async () => {
      const skill = createTestSkill({ id: 'exec-test' });
      skillRegistry.register(skill);
      await skillRegistry.execute('exec-test', createTestContext());

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          skill_id: 'exec-test',
          user_id: 'user-123',
          status: 'running',
        }),
      });
    });

    it('updates skill_runs to success on completion', async () => {
      const skill = createTestSkill({ id: 'success-test' });
      skillRegistry.register(skill);
      const result = await skillRegistry.execute('success-test', createTestContext());

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'run-123' },
        data: expect.objectContaining({
          status: 'success',
          ended_at: expect.any(Date),
        }),
      });
    });

    it('updates skill_runs to failed when skill returns error', async () => {
      const skill = createTestSkill({
        id: 'fail-result-test',
        execute: jest.fn(async () => ({ success: false, error: 'quota exceeded' })),
      });
      skillRegistry.register(skill);
      await skillRegistry.execute('fail-result-test', createTestContext());

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'run-123' },
        data: expect.objectContaining({
          status: 'failed',
          error: 'quota exceeded',
        }),
      });
    });

    it('catches thrown errors and records to skill_runs', async () => {
      const skill = createTestSkill({
        id: 'throw-test',
        execute: jest.fn(async () => {
          throw new Error('connection timeout');
        }),
      });
      skillRegistry.register(skill);
      const result = await skillRegistry.execute('throw-test', createTestContext());

      expect(result.success).toBe(false);
      expect(result.error).toBe('connection timeout');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'run-123' },
        data: expect.objectContaining({
          status: 'failed',
          error: 'connection timeout',
        }),
      });
    });
  });
});
