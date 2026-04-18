import { getPrismaClient } from '../database/client';
import { logger } from '../../utils/logger';
import { MS_PER_DAY } from '@/utils/time-constants';

interface MoodSignals {
  weeklySessionCount: number;
  entertainmentRatio: number;
  newTopicCount: number;
  daysSinceLastActivity: number;
  totalCards: number;
}

/**
 * Mood state 1-5: activity-frequency gradient.
 * Higher = more active. Used by OpenClaw bot for tone calibration.
 */
const MOOD_DEEP_SILENCE = 1; // 30+ days inactive
const MOOD_RESTING = 2; // 7-29 days inactive
const MOOD_RELAXED = 3; // active but low frequency (1-2 sessions/week)
const MOOD_STEADY = 4; // moderate frequency (3-4 sessions/week)
const MOOD_ON_FIRE = 5; // high frequency (5+ sessions/week)

type MoodState = 1 | 2 | 3 | 4 | 5;

const DEEP_SILENCE_THRESHOLD_DAYS = 30;
const RESTING_THRESHOLD_DAYS = 7;
const STEADY_THRESHOLD_SESSIONS = 3;
const ON_FIRE_THRESHOLD_SESSIONS = 5;

function computeMood(signals: MoodSignals): MoodState {
  const { daysSinceLastActivity, weeklySessionCount } = signals;

  if (daysSinceLastActivity >= DEEP_SILENCE_THRESHOLD_DAYS) return MOOD_DEEP_SILENCE;
  if (daysSinceLastActivity >= RESTING_THRESHOLD_DAYS) return MOOD_RESTING;
  if (weeklySessionCount >= ON_FIRE_THRESHOLD_SESSIONS) return MOOD_ON_FIRE;
  if (weeklySessionCount >= STEADY_THRESHOLD_SESSIONS) return MOOD_STEADY;
  return MOOD_RELAXED;
}

export async function getMood(
  mandalaId: string,
  userId: string
): Promise<{ state: MoodState; signals: MoodSignals; updatedAt: string }> {
  const prisma = getPrismaClient();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * MS_PER_DAY);
  const twoWeeksAgo = new Date(now.getTime() - 14 * MS_PER_DAY);

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
      ? Math.floor((now.getTime() - new Date(lastActivity).getTime()) / MS_PER_DAY)
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
      state: MOOD_RELAXED,
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
