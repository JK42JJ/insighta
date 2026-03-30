/**
 * Skill Quota Checker Unit Tests
 *
 * Tests for checkSkillQuota():
 * 1. Pro tier (unlimited) → allowed: true, no remaining field
 * 2. Free tier with 0 runs → allowed: true, remaining: 4 (newsletter limit)
 * 3. Free tier at limit (4/4) → allowed: false, remaining: 0
 * 4. Free tier below limit (2/4) → allowed: true, remaining: 2
 */

// ============================================================================
// Mocks — must be declared before any imports
// ============================================================================

const mockCount = jest.fn();

jest.mock('../../../src/modules/database', () => ({
  getPrismaClient: () => ({
    skill_runs: {
      count: mockCount,
    },
  }),
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { checkSkillQuota, type QuotaCheckResult } from '../../../src/modules/skills/quota-checker';

// ============================================================================
// Tests
// ============================================================================

describe('checkSkillQuota', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. Unlimited tier (pro) — no DB query needed
  // --------------------------------------------------------------------------
  describe('pro tier (unlimited monthlyRuns)', () => {
    it('returns allowed: true without querying the database', async () => {
      const result: QuotaCheckResult = await checkSkillQuota('newsletter', 'user-pro-1', 'pro');

      expect(result.allowed).toBe(true);
      // remaining must be undefined for unlimited tiers
      expect(result.remaining).toBeUndefined();
      // DB must NOT be consulted — null limit short-circuits early
      expect(mockCount).not.toHaveBeenCalled();
    });

    it('returns allowed: true for report skill on pro tier', async () => {
      const result = await checkSkillQuota('report', 'user-pro-2', 'pro');
      expect(result.allowed).toBe(true);
      expect(mockCount).not.toHaveBeenCalled();
    });

    it('returns allowed: true for alert skill on pro tier', async () => {
      const result = await checkSkillQuota('alert', 'user-pro-3', 'pro');
      expect(result.allowed).toBe(true);
      expect(mockCount).not.toHaveBeenCalled();
    });

    it('returns allowed: true for script skill on pro tier', async () => {
      const result = await checkSkillQuota('script', 'user-pro-4', 'pro');
      expect(result.allowed).toBe(true);
      expect(mockCount).not.toHaveBeenCalled();
    });

    it('returns allowed: true for blog skill on pro tier', async () => {
      const result = await checkSkillQuota('blog', 'user-pro-5', 'pro');
      expect(result.allowed).toBe(true);
      expect(mockCount).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Free tier — 0 runs this month → allowed with full remaining
  // --------------------------------------------------------------------------
  describe('free tier — 0 runs used', () => {
    it('newsletter: returns allowed: true with remaining: 4', async () => {
      mockCount.mockResolvedValue(0);

      const result = await checkSkillQuota('newsletter', 'user-free-1', 'free');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // TIER_LIMITS.free.skills.newsletter.monthlyRuns = 4
      expect(mockCount).toHaveBeenCalledTimes(1);
    });

    it('report: returns allowed: true with remaining: 1', async () => {
      mockCount.mockResolvedValue(0);

      const result = await checkSkillQuota('report', 'user-free-2', 'free');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // TIER_LIMITS.free.skills.report.monthlyRuns = 1
    });

    it('alert: returns allowed: true with remaining: 20', async () => {
      mockCount.mockResolvedValue(0);

      const result = await checkSkillQuota('alert', 'user-free-3', 'free');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(20); // TIER_LIMITS.free.skills.alert.monthlyRuns = 20
    });

    it('script: returns allowed: true with remaining: 2', async () => {
      mockCount.mockResolvedValue(0);

      const result = await checkSkillQuota('script', 'user-free-4', 'free');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // TIER_LIMITS.free.skills.script.monthlyRuns = 2
    });

    it('blog: returns allowed: true with remaining: 2', async () => {
      mockCount.mockResolvedValue(0);

      const result = await checkSkillQuota('blog', 'user-free-5', 'free');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // TIER_LIMITS.free.skills.blog.monthlyRuns = 2
    });
  });

  // --------------------------------------------------------------------------
  // 3. Free tier — at limit → denied
  // --------------------------------------------------------------------------
  describe('free tier — at monthly limit', () => {
    it('newsletter: returns allowed: false with reason and remaining: 0', async () => {
      mockCount.mockResolvedValue(4); // count === limit (4/4)

      const result = await checkSkillQuota('newsletter', 'user-free-full', 'free');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.reason).toBe('Monthly limit exceeded (4/4)');
    });

    it('report: returns allowed: false when count equals limit (1/1)', async () => {
      mockCount.mockResolvedValue(1);

      const result = await checkSkillQuota('report', 'user-free-full', 'free');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.reason).toBe('Monthly limit exceeded (1/1)');
    });

    it('alert: returns allowed: false when count exceeds limit (21/20)', async () => {
      mockCount.mockResolvedValue(21); // count > limit edge case
      const result = await checkSkillQuota('alert', 'user-free-full', 'free');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('script: returns allowed: false when count equals limit (2/2)', async () => {
      mockCount.mockResolvedValue(2);
      const result = await checkSkillQuota('script', 'user-free-full', 'free');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.reason).toBe('Monthly limit exceeded (2/2)');
    });

    it('blog: returns allowed: false when count equals limit (2/2)', async () => {
      mockCount.mockResolvedValue(2);
      const result = await checkSkillQuota('blog', 'user-free-full', 'free');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.reason).toBe('Monthly limit exceeded (2/2)');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Free tier — below limit → correct remaining count
  // --------------------------------------------------------------------------
  describe('free tier — below monthly limit', () => {
    it('newsletter: 2 runs used → remaining: 2', async () => {
      mockCount.mockResolvedValue(2);

      const result = await checkSkillQuota('newsletter', 'user-free-partial', 'free');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // 4 - 2 = 2
    });

    it('newsletter: 3 runs used → remaining: 1', async () => {
      mockCount.mockResolvedValue(3);

      const result = await checkSkillQuota('newsletter', 'user-free-one-left', 'free');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // 4 - 3 = 1
    });

    it('alert: 10 runs used → remaining: 10', async () => {
      mockCount.mockResolvedValue(10);

      const result = await checkSkillQuota('alert', 'user-free-half', 'free');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10); // 20 - 10 = 10
    });
  });

  // --------------------------------------------------------------------------
  // 5. DB query shape — correct WHERE clause passed to count()
  // --------------------------------------------------------------------------
  describe('DB query parameters', () => {
    it('passes correct skill_id, user_id, status filter and startOfMonth to count()', async () => {
      mockCount.mockResolvedValue(1);

      await checkSkillQuota('newsletter', 'user-abc', 'free');

      expect(mockCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            skill_id: 'newsletter',
            user_id: 'user-abc',
            status: { in: ['success', 'running'] },
            started_at: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        })
      );
    });

    it('startOfMonth date is the 1st of the current month at 00:00:00 UTC', async () => {
      mockCount.mockResolvedValue(0);

      await checkSkillQuota('report', 'user-xyz', 'free');

      const callArgs = mockCount.mock.calls[0][0];
      const startOfMonth: Date = callArgs.where.started_at.gte;

      expect(startOfMonth.getUTCDate()).toBe(1);
      expect(startOfMonth.getUTCHours()).toBe(0);
      expect(startOfMonth.getUTCMinutes()).toBe(0);
      expect(startOfMonth.getUTCSeconds()).toBe(0);
      expect(startOfMonth.getUTCMilliseconds()).toBe(0);
    });
  });
});
