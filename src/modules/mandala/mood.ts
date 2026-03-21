import { getPrismaClient } from '../database/client';
import { logger } from '../../utils/logger';

interface MoodSignals {
  weeklySessionCount: number;
  entertainmentRatio: number;
  newTopicCount: number;
  daysSinceLastActivity: number;
  totalCards: number;
}

enum MoodState {
  FOCUSED = 0,
  RECHARGING = 1,
  CHALLENGING = 2,
  COMFORTABLE = 3,
  NEEDS_SUPPORT = 4,
}

function computeMood(signals: MoodSignals): MoodState {
  if (signals.daysSinceLastActivity >= 14) return MoodState.NEEDS_SUPPORT;
  if (signals.newTopicCount >= 2) return MoodState.CHALLENGING;
  if (signals.entertainmentRatio > 0.7) return MoodState.RECHARGING;
  if (signals.weeklySessionCount >= 3) return MoodState.FOCUSED;
  return MoodState.COMFORTABLE;
}

export async function getMood(
  mandalaId: string,
  userId: string
): Promise<{ state: MoodState; signals: MoodSignals; updatedAt: string }> {
  const prisma = getPrismaClient();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  try {
    const [activityLogs, totalCardsResult, recentCards] = await Promise.all([
      // Recent activity in this mandala (last 7 days)
      prisma.mandala_activity_log.findMany({
        where: {
          mandala_id: mandalaId,
          user_id: userId,
          created_at: { gte: oneWeekAgo },
        },
        orderBy: { created_at: 'desc' },
      }),
      // Total cards in this mandala
      prisma.user_local_cards.count({
        where: {
          mandala_id: mandalaId,
          user_id: userId,
        },
      }),
      // Cards created in the last 2 weeks (to detect new topics)
      prisma.user_local_cards.findMany({
        where: {
          mandala_id: mandalaId,
          user_id: userId,
          created_at: { gte: twoWeeksAgo },
        },
        select: { cell_index: true, link_type: true, created_at: true },
      }),
    ]);

    // Weekly session count: unique days with activity in the last 7 days
    const uniqueDays = new Set(
      activityLogs.map((log) => new Date(log.created_at).toISOString().slice(0, 10))
    );
    const weeklySessionCount = uniqueDays.size;

    // Entertainment ratio: proportion of youtube/youtube-shorts cards
    const entertainmentTypes = ['youtube', 'youtube-shorts'];
    const entertainmentCards = recentCards.filter((c) =>
      entertainmentTypes.includes(c.link_type)
    ).length;
    const entertainmentRatio = recentCards.length > 0 ? entertainmentCards / recentCards.length : 0;

    // New topic count: unique cell indices used in recent cards
    const recentCellIndices = new Set(
      recentCards.filter((c) => c.cell_index !== null && c.cell_index >= 0).map((c) => c.cell_index)
    );
    const newTopicCount = recentCellIndices.size;

    // Days since last activity
    const lastActivity = activityLogs[0]?.created_at;
    const daysSinceLastActivity = lastActivity
      ? Math.floor((now.getTime() - new Date(lastActivity).getTime()) / (24 * 60 * 60 * 1000))
      : 999;

    const signals: MoodSignals = {
      weeklySessionCount,
      entertainmentRatio,
      newTopicCount,
      daysSinceLastActivity,
      totalCards: totalCardsResult,
    };

    return {
      state: computeMood(signals),
      signals,
      updatedAt: now.toISOString(),
    };
  } catch (error) {
    logger.error('Failed to compute mood', { mandalaId, userId, error });
    return {
      state: MoodState.COMFORTABLE,
      signals: {
        weeklySessionCount: 0,
        entertainmentRatio: 0,
        newTopicCount: 0,
        daysSinceLastActivity: 0,
        totalCards: 0,
      },
      updatedAt: now.toISOString(),
    };
  }
}
