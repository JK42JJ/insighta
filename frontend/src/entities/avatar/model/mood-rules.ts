import { MoodState, type MoodSignals } from './types';

export function computeMood(signals: MoodSignals): MoodState {
  if (signals.daysSinceLastActivity >= 14) return MoodState.NEEDS_SUPPORT;
  if (signals.newTopicCount >= 2) return MoodState.CHALLENGING;
  if (signals.entertainmentRatio > 0.7) return MoodState.RECHARGING;
  if (signals.weeklySessionCount >= 3) return MoodState.FOCUSED;
  return MoodState.COMFORTABLE;
}
