export enum MoodState {
  FOCUSED = 0,
  RECHARGING = 1,
  CHALLENGING = 2,
  COMFORTABLE = 3,
  NEEDS_SUPPORT = 4,
}

export interface MoodSignals {
  weeklySessionCount: number;
  entertainmentRatio: number;
  newTopicCount: number;
  daysSinceLastActivity: number;
  totalCards: number;
}

export interface MoodResult {
  state: MoodState;
  signals: MoodSignals;
  updatedAt: string;
}

export interface MandalaAvatarProps {
  mandalaId?: string;
  seed: string;
  totalCards: number;
  centerGoal: string;
  riveUrl?: string;
  className?: string;
}
