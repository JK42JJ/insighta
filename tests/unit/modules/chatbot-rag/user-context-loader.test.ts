/**
 * tests/unit/modules/chatbot-rag/user-context-loader.test.ts
 *
 * Unit tests for the chatbot user-context loader (CP474 Phase B).
 *
 * Coverage:
 *   - Happy path: all 6 source queries return data → UserContext fully populated
 *   - New user without subscription row → tier defaults to 'free'
 *   - currentMandalaId absent → current_mandala_name undefined
 *   - mandala_titles ordering + cap (MAX_MANDALA_TITLES)
 *   - Recent cards filter uses RECENT_DAYS_WINDOW from `now` injection
 *   - displayName fallback to email local-part when JWT user_metadata missing
 *   - Graceful degradation: individual Prisma query rejection → field falls back
 *
 * Mocks: Prisma client only. No real DB, no env vars, no network calls.
 */

const mockUsersFindUnique = jest.fn();
const mockSubscriptionFindUnique = jest.fn();
const mockMandalasFindMany = jest.fn();
const mockMandalasCount = jest.fn();
const mockMandalaFindUnique = jest.fn();
const mockCardsCount = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    users: { findUnique: mockUsersFindUnique },
    user_subscriptions: { findUnique: mockSubscriptionFindUnique },
    user_mandalas: {
      findMany: mockMandalasFindMany,
      count: mockMandalasCount,
      findUnique: mockMandalaFindUnique,
    },
    user_local_cards: { count: mockCardsCount },
  }),
}));

import { loadUserContext } from '@/modules/chatbot-rag/user-context-loader';
import { MAX_MANDALA_TITLES, RECENT_DAYS_WINDOW } from '@/modules/chatbot-rag/types';

const FIXED_NOW = new Date('2026-05-20T00:00:00.000Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  // Defaults reused across happy-path tests.
  mockUsersFindUnique.mockResolvedValue({
    created_at: new Date('2026-01-15T00:00:00.000Z'),
  });
  mockSubscriptionFindUnique.mockResolvedValue({ tier: 'lifetime' });
  mockMandalasFindMany.mockResolvedValue([
    { title: '마라톤 완주' },
    { title: 'Python 풀스택' },
    { title: '프랑스어 B1' },
  ]);
  mockMandalasCount.mockResolvedValue(3);
  mockCardsCount.mockResolvedValue(12);
  mockMandalaFindUnique.mockResolvedValue({ title: '마라톤 완주' });
});

describe('loadUserContext — happy path', () => {
  it('returns fully populated UserContext when all sources resolve', async () => {
    const ctx = await loadUserContext({
      userId: 'u-1',
      email: 'jeonho@example.com',
      displayName: 'Jeonho',
      currentMandalaId: 'm-1',
      preferredLanguage: 'ko',
      now: FIXED_NOW,
    });

    expect(ctx).toMatchObject({
      user_id: 'u-1',
      display_name: 'Jeonho',
      email: 'jeonho@example.com',
      tier: 'lifetime',
      join_date: '2026-01-15',
      mandala_count: 3,
      mandala_titles: ['마라톤 완주', 'Python 풀스택', '프랑스어 B1'],
      current_mandala_name: '마라톤 완주',
      recent_card_count_7d: 12,
      preferred_language: 'ko',
    });
    // 2026-01-15 → 2026-05-20 = 125 days (Jan 16-31:16, Feb:28, Mar:31, Apr:30, May 1-20:20 = 16+28+31+30+20 = 125)
    expect(ctx.days_active).toBe(125);
  });

  it('passes the correct recency cutoff to user_local_cards.count', async () => {
    await loadUserContext({
      userId: 'u-1',
      email: 'jeonho@example.com',
      preferredLanguage: 'ko',
      now: FIXED_NOW,
    });

    const expectedCutoff = new Date(FIXED_NOW.getTime() - RECENT_DAYS_WINDOW * ONE_DAY_MS);
    expect(mockCardsCount).toHaveBeenCalledWith({
      where: {
        user_id: 'u-1',
        created_at: { gte: expectedCutoff },
      },
    });
  });

  it('caps mandala_titles to MAX_MANDALA_TITLES via Prisma take', async () => {
    await loadUserContext({
      userId: 'u-1',
      email: 'jeonho@example.com',
      preferredLanguage: 'ko',
      now: FIXED_NOW,
    });

    expect(mockMandalasFindMany).toHaveBeenCalledWith({
      where: { user_id: 'u-1' },
      select: { title: true },
      orderBy: { created_at: 'desc' },
      take: MAX_MANDALA_TITLES,
    });
  });
});

describe('loadUserContext — defaults + degradation', () => {
  it('defaults tier to "free" when user_subscriptions row is missing', async () => {
    mockSubscriptionFindUnique.mockResolvedValueOnce(null);

    const ctx = await loadUserContext({
      userId: 'new-user',
      email: 'newbie@example.com',
      preferredLanguage: 'ko',
      now: FIXED_NOW,
    });

    expect(ctx.tier).toBe('free');
  });

  it('returns current_mandala_name undefined when currentMandalaId not passed', async () => {
    const ctx = await loadUserContext({
      userId: 'u-1',
      email: 'jeonho@example.com',
      preferredLanguage: 'ko',
      now: FIXED_NOW,
    });

    expect(ctx.current_mandala_name).toBeUndefined();
    expect(mockMandalaFindUnique).not.toHaveBeenCalled();
  });

  it('falls back display_name to email local-part when displayName is empty', async () => {
    const ctx = await loadUserContext({
      userId: 'u-1',
      email: 'taro@example.com',
      displayName: '   ', // whitespace
      preferredLanguage: 'en',
      now: FIXED_NOW,
    });

    expect(ctx.display_name).toBe('taro');
  });

  it('returns join_date="" and days_active=0 when users row lacks created_at', async () => {
    mockUsersFindUnique.mockResolvedValueOnce({ created_at: null });

    const ctx = await loadUserContext({
      userId: 'u-1',
      email: 'jeonho@example.com',
      preferredLanguage: 'ko',
      now: FIXED_NOW,
    });

    expect(ctx.join_date).toBe('');
    expect(ctx.days_active).toBe(0);
  });

  it('survives individual Prisma rejection — empty mandalas list when findMany throws', async () => {
    mockMandalasFindMany.mockRejectedValueOnce(new Error('connection lost'));

    const ctx = await loadUserContext({
      userId: 'u-1',
      email: 'jeonho@example.com',
      preferredLanguage: 'ko',
      now: FIXED_NOW,
    });

    expect(ctx.mandala_titles).toEqual([]);
    // Other fields still populated from their successful queries
    expect(ctx.tier).toBe('lifetime');
    expect(ctx.mandala_count).toBe(3);
  });

  it('normalizes unknown tier strings to "free"', async () => {
    mockSubscriptionFindUnique.mockResolvedValueOnce({ tier: 'enterprise-trial' });

    const ctx = await loadUserContext({
      userId: 'u-1',
      email: 'jeonho@example.com',
      preferredLanguage: 'ko',
      now: FIXED_NOW,
    });

    expect(ctx.tier).toBe('free');
  });
});
