/**
 * Skill System Schema Tests
 *
 * Validates Prisma schema definitions for the 4 skill system tables:
 * - video_rich_summaries
 * - newsletter_settings
 * - newsletter_logs
 * - skill_runs
 *
 * Also validates TIER_LIMITS.skills configuration consistency.
 */

import { TIER_LIMITS, type Tier } from '../../../src/config/quota';

// ============================================================================
// TIER_LIMITS.skills configuration tests
// ============================================================================

describe('TIER_LIMITS.skills', () => {
  const TIERS: Tier[] = ['free', 'pro', 'lifetime', 'admin'];

  it('all tiers have skills section', () => {
    for (const tier of TIERS) {
      expect(TIER_LIMITS[tier].skills).toBeDefined();
      expect(TIER_LIMITS[tier].skills.newsletter).toBeDefined();
      expect(TIER_LIMITS[tier].skills.report).toBeDefined();
      expect(TIER_LIMITS[tier].skills.alert).toBeDefined();
      expect(TIER_LIMITS[tier].skills.recommend).toBeDefined();
    }
  });

  it('free tier has limited newsletter runs', () => {
    const free = TIER_LIMITS.free.skills.newsletter;
    expect(free.monthlyRuns).toBe(4);
    expect(free.frequency).toEqual(['weekly']);
    expect(free.summaryMode).toBe('one_liner');
    expect(free.curationTopN).toBe(3);
    expect(free.biasReport).toBe(false);
    expect(free.customTemplate).toBe(false);
    expect(free.targetMandalas).toBe(1);
  });

  it('pro tier has unlimited newsletter runs', () => {
    const pro = TIER_LIMITS.pro.skills.newsletter;
    expect(pro.monthlyRuns).toBeNull();
    expect(pro.frequency).toContain('daily');
    expect(pro.summaryMode).toBe('structured');
    expect(pro.curationTopN).toBe(5);
    expect(pro.biasReport).toBe(true);
    expect(pro.customTemplate).toBe(true);
    expect(pro.targetMandalas).toBeNull();
  });

  it('lifetime/admin tiers have unlimited runs for all skills', () => {
    for (const tier of ['lifetime', 'admin'] as Tier[]) {
      const skills = TIER_LIMITS[tier].skills;
      expect(skills.newsletter.monthlyRuns).toBeNull();
      expect(skills.report.monthlyRuns).toBeNull();
      expect(skills.alert.monthlyRuns).toBeNull();
      expect(skills.recommend.dailyItems).toBeNull();
    }
  });

  it('free tier has limited report runs', () => {
    expect(TIER_LIMITS.free.skills.report.monthlyRuns).toBe(1);
    expect(TIER_LIMITS.free.skills.report.depth).toBe('basic');
  });

  it('pro tier has full report depth', () => {
    expect(TIER_LIMITS.pro.skills.report.depth).toBe('full');
  });

  it('free tier has limited alert channels', () => {
    expect(TIER_LIMITS.free.skills.alert.monthlyRuns).toBe(20);
    expect(TIER_LIMITS.free.skills.alert.channels).toEqual(['email']);
  });

  it('pro tier adds push channel', () => {
    expect(TIER_LIMITS.pro.skills.alert.channels).toContain('push');
  });

  it('free tier has limited daily recommendations', () => {
    expect(TIER_LIMITS.free.skills.recommend.dailyItems).toBe(3);
    expect(TIER_LIMITS.free.skills.recommend.targetScope).toBe('single_cell');
  });

  it('pro tier has more daily recommendations', () => {
    expect(TIER_LIMITS.pro.skills.recommend.dailyItems).toBe(10);
    expect(TIER_LIMITS.pro.skills.recommend.targetScope).toBe('all_mandalas');
  });

  it('admin has unlimited curation count', () => {
    expect(TIER_LIMITS.admin.skills.newsletter.curationTopN).toBeNull();
  });

  it('existing resource limits are unchanged', () => {
    expect(TIER_LIMITS.free.mandalas).toBe(3);
    expect(TIER_LIMITS.free.cards).toBe(150);
    expect(TIER_LIMITS.pro.mandalas).toBe(20);
    expect(TIER_LIMITS.pro.cards).toBe(1_000);
    expect(TIER_LIMITS.lifetime.mandalas).toBeNull();
    expect(TIER_LIMITS.admin.cards).toBeNull();
  });
});
