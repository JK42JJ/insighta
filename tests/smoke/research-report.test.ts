/**
 * ResearchReportSkill smoke tests
 *
 * Covers: skill identity, execute happy-path (cards found), execute skipped
 * (no cards), execute error handling (mandala not found, thrown exception),
 * dryRun preview, and $executeRaw persistence call.
 *
 * Mocking strategy:
 *   - getPrismaClient: mocked for mandala/level DB access
 *   - queryMandalaCards: mocked to return unified SkillCard[]
 *   - GenerationProvider: inline mock object
 *   - logger: mocked to suppress output
 *
 * All tests are pure-unit — no JWT/SUPABASE_URL required.
 */
export {};

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted by Jest before any imports
// ---------------------------------------------------------------------------

const mockFindUniqueMandala = jest.fn();
const mockFindManyLevels = jest.fn();
const mockExecuteRaw = jest.fn();

const mockPrisma = {
  user_mandalas: { findUnique: mockFindUniqueMandala },
  user_mandala_levels: { findMany: mockFindManyLevels },
  $executeRaw: mockExecuteRaw,
};

jest.mock('../../src/modules/database', () => ({
  getPrismaClient: jest.fn(() => mockPrisma),
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

const mockQueryMandalaCards = jest.fn();
jest.mock('../../src/modules/skills/card-query', () => ({
  queryMandalaCards: (...args: unknown[]) => mockQueryMandalaCards(...args),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are registered
// ---------------------------------------------------------------------------

import { ResearchReportSkill } from '../../src/modules/skills/research-report';
import type { SkillContext } from '../../src/modules/skills/types';
import type { GenerationProvider } from '../../src/modules/llm/provider';
import type { SkillCard } from '../../src/modules/skills/card-query';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockLlm: GenerationProvider = {
  generate: jest.fn().mockResolvedValue('Mock report content'),
  name: 'mock',
  model: 'test-model',
};

const makeCtx = (overrides: Partial<SkillContext> = {}): SkillContext => ({
  userId: 'user-abc',
  mandalaId: 'mandala-xyz',
  tier: 'free',
  llm: mockLlm,
  ...overrides,
});

const MANDALA_ROW = { title: 'Test Mandala' };
const LEVEL_ROW = { id: 'level-1', subjects: ['Sector A', 'Sector B'], position: 0 };

const SKILL_CARDS: SkillCard[] = [
  {
    id: 'card-1',
    title: 'Card One',
    url: null,
    thumbnail_url: null,
    cell_index: 0,
    channel_title: null,
    one_liner: null,
    structured: null,
    quality_score: null,
    quality_flag: null,
    source: 'local',
    created_at: new Date('2026-03-28'),
  },
  {
    id: 'card-2',
    title: 'Card Two',
    url: 'https://example.com',
    thumbnail_url: null,
    cell_index: 1,
    channel_title: 'example.com',
    one_liner: null,
    structured: null,
    quality_score: null,
    quality_flag: null,
    source: 'local',
    created_at: new Date('2026-03-29'),
  },
  {
    id: 'synced-1',
    title: 'Synced Video',
    url: 'https://youtube.com/watch?v=abc',
    thumbnail_url: 'https://i.ytimg.com/vi/abc/maxresdefault.jpg',
    cell_index: 0,
    channel_title: 'Some Channel',
    one_liner: 'A great video',
    structured: null,
    quality_score: null,
    quality_flag: null,
    source: 'synced',
    created_at: new Date('2026-03-30'),
  },
];

// ---------------------------------------------------------------------------
// Group 1: Skill identity & static metadata
// ---------------------------------------------------------------------------

describe('ResearchReportSkill — identity & metadata', () => {
  const skill = new ResearchReportSkill();

  it('has id "report"', () => {
    expect(skill.id).toBe('report');
  });

  it('has version "1.0.0"', () => {
    expect(skill.version).toBe('1.0.0');
  });

  it('has trigger type "manual"', () => {
    expect(skill.trigger.type).toBe('manual');
  });

  it('exposes inputSchema requiring mandala_id', () => {
    expect(skill.inputSchema.required).toContain('mandala_id');
  });

  it('is available to all tiers including free', () => {
    expect(skill.tiers).toContain('free');
    expect(skill.tiers).toContain('pro');
    expect(skill.tiers).toContain('admin');
  });
});

// ---------------------------------------------------------------------------
// Group 2: execute — happy path
// ---------------------------------------------------------------------------

describe('ResearchReportSkill.execute — happy path', () => {
  let skill: ResearchReportSkill;

  beforeEach(() => {
    skill = new ResearchReportSkill();
    jest.clearAllMocks();
    mockFindUniqueMandala.mockResolvedValue(MANDALA_ROW);
    mockFindManyLevels.mockResolvedValue([LEVEL_ROW]);
    mockQueryMandalaCards.mockResolvedValue(SKILL_CARDS);
    mockExecuteRaw.mockResolvedValue(1);
    (mockLlm.generate as jest.Mock).mockResolvedValue('Mock report content');
  });

  it('returns success:true when cards exist', async () => {
    const result = await skill.execute(makeCtx());
    expect(result.success).toBe(true);
  });

  it('returns data.content from LLM response', async () => {
    const result = await skill.execute(makeCtx());
    expect(result.data?.['content']).toBe('Mock report content');
  });

  it('returns data.title prefixed with "Research Report:"', async () => {
    const result = await skill.execute(makeCtx());
    expect(result.data?.['title']).toBe('Research Report: Test Mandala');
  });

  it('returns data.card_count equal to total card count', async () => {
    const result = await skill.execute(makeCtx());
    expect(result.data?.['card_count']).toBe(3);
  });

  it('returns metadata.duration_ms as a non-negative number', async () => {
    const result = await skill.execute(makeCtx());
    expect(typeof result.metadata?.duration_ms).toBe('number');
    expect(result.metadata!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('calls llm.generate with a prompt containing the mandala title', async () => {
    await skill.execute(makeCtx());
    const [prompt] = (mockLlm.generate as jest.Mock).mock.calls[0] as [string];
    expect(prompt).toContain('Test Mandala');
  });

  it('saves output via $executeRaw to skill_outputs table', async () => {
    await skill.execute(makeCtx());
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });

  it('calls queryMandalaCards with correct userId and mandalaId', async () => {
    await skill.execute(makeCtx());
    expect(mockQueryMandalaCards).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-abc', mandalaId: 'mandala-xyz' })
    );
  });
});

// ---------------------------------------------------------------------------
// Group 3: execute — skipped when no cards
// ---------------------------------------------------------------------------

describe('ResearchReportSkill.execute — skipped (no cards)', () => {
  let skill: ResearchReportSkill;

  beforeEach(() => {
    skill = new ResearchReportSkill();
    jest.clearAllMocks();
    mockFindUniqueMandala.mockResolvedValue(MANDALA_ROW);
    mockFindManyLevels.mockResolvedValue([LEVEL_ROW]);
    mockQueryMandalaCards.mockResolvedValue([]);
    mockExecuteRaw.mockResolvedValue(1);
  });

  it('returns success:true with skipped flag when no cards found', async () => {
    const result = await skill.execute(makeCtx());
    expect(result.success).toBe(true);
    expect(result.data?.['skipped']).toBe('no_cards');
  });

  it('does NOT call llm.generate when skipping', async () => {
    await skill.execute(makeCtx());
    expect(mockLlm.generate).not.toHaveBeenCalled();
  });

  it('does NOT call $executeRaw when skipping', async () => {
    await skill.execute(makeCtx());
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Group 4: execute — error handling
// ---------------------------------------------------------------------------

describe('ResearchReportSkill.execute — error handling', () => {
  let skill: ResearchReportSkill;

  beforeEach(() => {
    skill = new ResearchReportSkill();
    jest.clearAllMocks();
    mockQueryMandalaCards.mockResolvedValue([]);
  });

  it('returns success:false with "Mandala not found" when mandala does not exist', async () => {
    mockFindUniqueMandala.mockResolvedValue(null);
    const result = await skill.execute(makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toBe('Mandala not found');
  });

  it('does NOT call llm.generate when mandala is missing', async () => {
    mockFindUniqueMandala.mockResolvedValue(null);
    await skill.execute(makeCtx());
    expect(mockLlm.generate).not.toHaveBeenCalled();
  });

  it('returns success:false and captures error message when an exception is thrown', async () => {
    mockFindUniqueMandala.mockRejectedValue(new Error('DB connection lost'));
    const result = await skill.execute(makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toBe('DB connection lost');
  });

  it('returns success:false and captures error string when a non-Error is thrown', async () => {
    mockFindUniqueMandala.mockRejectedValue('raw string error');
    const result = await skill.execute(makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toBe('raw string error');
  });
});

// ---------------------------------------------------------------------------
// Group 5: dryRun
// ---------------------------------------------------------------------------

describe('ResearchReportSkill.dryRun', () => {
  let skill: ResearchReportSkill;

  beforeEach(() => {
    skill = new ResearchReportSkill();
    jest.clearAllMocks();
    mockFindUniqueMandala.mockResolvedValue(MANDALA_ROW);
    mockFindManyLevels.mockResolvedValue([LEVEL_ROW]);
    mockQueryMandalaCards.mockResolvedValue(SKILL_CARDS);
  });

  it('returns subject containing the mandala title', async () => {
    const preview = await skill.dryRun(makeCtx());
    expect(preview.subject).toContain('Test Mandala');
  });

  it('returns curated_count equal to total card count', async () => {
    const preview = await skill.dryRun(makeCtx());
    expect(preview.curated_count).toBe(3);
  });

  it('returns preview_html containing the card count', async () => {
    const preview = await skill.dryRun(makeCtx());
    expect(preview.preview_html).toContain('3');
  });

  it('returns preview_html containing sector count', async () => {
    const preview = await skill.dryRun(makeCtx());
    // cell_index 0 and 1 — 2 distinct sectors
    expect(preview.preview_html).toContain('2');
  });

  it('falls back gracefully when mandala is not found (no throw)', async () => {
    mockFindUniqueMandala.mockResolvedValue(null);
    mockQueryMandalaCards.mockResolvedValue([]);
    const preview = await skill.dryRun(makeCtx());
    expect(preview.subject).toContain('Mandala');
    expect(preview.curated_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Environment report — always runs
// ---------------------------------------------------------------------------

describe('ResearchReportSkill environment check', () => {
  it('reports skill unit test capability', () => {
    console.log(
      'INFO: ResearchReportSkill unit tests run in all environments — no JWT/SUPABASE_URL required'
    );
    const skill = new ResearchReportSkill();
    expect(typeof skill.execute).toBe('function');
    expect(typeof skill.dryRun).toBe('function');
  });
});
