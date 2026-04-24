/**
 * CP424 T5 — LoRA prompt schema contract test.
 *
 * Kept in a dedicated file so jest.requireActual can pull in the real
 * `src/modules/mandala/generator.ts` without colliding with the @prisma/client
 * mock used by fill-missing-actions.test.ts. PrismaClient is stubbed at module
 * level so the generator's transitive DB imports don't crash.
 *
 * Contract: LoRA prompt MUST explicitly instruct the model to emit action keys
 * as the literal strings sub_goal_1 through sub_goal_8. Prior prompt had no
 * schema, model fell back to Korean sub_goal-text keys, fill-missing-actions
 * matching broke silently (cellsFilled=0 yet action='filled').
 */

// Stub database/client directly so the generator's transitive load doesn't
// crash trying to instantiate a Prisma client with incomplete methods.
jest.mock('../../../src/modules/database/client', () => ({
  getPrismaClient: () => ({
    user_mandalas: { findUnique: jest.fn() },
    user_mandala_levels: { findMany: jest.fn(), findFirst: jest.fn() },
  }),
  db: {
    user_mandalas: { findUnique: jest.fn() },
  },
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    constructor() {
      /* no-op */
    }
    $connect() {
      return Promise.resolve();
    }
    $disconnect() {
      return Promise.resolve();
    }
    $on() {
      /* no-op */
    }
  },
  Prisma: { JsonNull: null },
}));

// The real generator also imports config/embedding providers; stub them out
// at the transitive level so the prompt builder export is reachable.
jest.mock('../../../src/config', () => ({
  config: {
    app: { isDevelopment: false, isProduction: true },
    mandalaEmbed: { provider: 'openrouter' },
    mandalaGen: { url: 'http://localhost:11434', model: 'mandala-gen' },
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}));

import { buildPromptForTest } from '../../../src/modules/mandala/generator';

describe('CP424 buildPrompt (LoRA) schema contract', () => {
  it('exports buildPromptForTest', () => {
    expect(typeof buildPromptForTest).toBe('function');
  });

  it('Korean prompt contains sub_goal_1..sub_goal_8 literal directive', () => {
    const prompt = buildPromptForTest({ goal: '테스트 목표', language: 'ko' });
    for (let i = 1; i <= 8; i++) {
      expect(prompt).toContain(`sub_goal_${i}`);
    }
    expect(prompt).toMatch(/반드시|CRITICAL|MUST/);
    expect(prompt).toMatch(/sub_goal 텍스트.*사용하지|NOT.*text/i);
  });

  it('English prompt contains sub_goal_1..sub_goal_8 literal directive', () => {
    const prompt = buildPromptForTest({ goal: 'test goal', language: 'en' });
    for (let i = 1; i <= 8; i++) {
      expect(prompt).toContain(`sub_goal_${i}`);
    }
    expect(prompt).toMatch(/literally|CRITICAL|MUST/);
    expect(prompt).toMatch(/NOT.*text/i);
  });

  it('prompt explicitly forbids nested metadata keys inside actions dict', () => {
    const prompt = buildPromptForTest({ goal: 'goal', language: 'ko' });
    // Must mention that 'sub_goals' / 'actions' nested keys are forbidden.
    expect(prompt).toMatch(/sub_goals.*중첩|nested.*sub_goals|metadata.*actions/i);
  });

  it('both languages reference the goal verbatim', () => {
    const ko = buildPromptForTest({ goal: '독특한_목표_abc123', language: 'ko' });
    const en = buildPromptForTest({ goal: 'unique_goal_xyz789', language: 'en' });
    expect(ko).toContain('독특한_목표_abc123');
    expect(en).toContain('unique_goal_xyz789');
  });
});
