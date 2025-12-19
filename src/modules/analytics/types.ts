/**
 * Analytics Module Types
 *
 * Data structures for learning analytics and progress tracking
 */

/**
 * Watch session data
 */
export interface WatchSession {
  id: string;
  videoId: string;
  startedAt: Date;
  endedAt: Date;
  startPos: number; // in seconds
  endPos: number; // in seconds
  duration: number; // actual watch duration in seconds
  createdAt: Date;
}

/**
 * Session creation input
 */
export interface CreateSessionInput {
  videoId: string;
  startPos: number;
  endPos: number;
  startedAt?: Date;
  endedAt?: Date;
}

/**
 * Video analytics data
 */
export interface VideoAnalytics {
  videoId: string;
  videoTitle: string;
  totalDuration: number; // video duration in seconds
  totalWatchTime: number; // total time spent watching (all sessions)
  completionPercentage: number; // 0-100
  watchCount: number; // number of watch sessions
  lastWatchedAt: Date | null;
  firstWatchedAt: Date | null;
  averageSessionDuration: number;
  rewatchCount: number; // sessions after first complete watch
}

/**
 * Playlist analytics data
 */
export interface PlaylistAnalytics {
  playlistId: string;
  playlistTitle: string;
  totalVideos: number;
  watchedVideos: number; // videos with at least one session
  completedVideos: number; // videos with >=80% completion
  totalWatchTime: number; // sum of all watch sessions
  averageCompletion: number; // average completion across all videos (0-100)
  lastActivity: Date | null;
  videoAnalytics: VideoAnalytics[];
}

/**
 * Learning dashboard data
 */
export interface LearningDashboard {
  totalVideos: number;
  totalWatchTime: number; // in seconds
  totalSessions: number;
  averageSessionDuration: number;
  completedVideos: number;
  inProgressVideos: number;
  notStartedVideos: number;
  recentActivity: RecentActivity[];
  topVideos: TopVideo[];
  learningStreak: LearningStreak;
}

/**
 * Recent activity entry
 */
export interface RecentActivity {
  videoId: string;
  videoTitle: string;
  watchedAt: Date;
  duration: number;
  progress: number; // 0-100
}

/**
 * Top video entry
 */
export interface TopVideo {
  videoId: string;
  videoTitle: string;
  watchTime: number;
  sessionCount: number;
  completionRate: number;
}

/**
 * Learning streak data
 */
export interface LearningStreak {
  currentStreak: number; // consecutive days
  longestStreak: number;
  lastActiveDate: Date | null;
}

/**
 * Retention metrics
 */
export interface RetentionMetrics {
  videoId: string;
  videoTitle: string;
  difficulty: 'easy' | 'medium' | 'hard'; // based on rewatch patterns
  retentionScore: number; // 0-100
  recommendedReviewDate: Date | null;
  lastReviewedAt: Date | null;
  reviewCount: number;
}

/**
 * Session operation result
 */
export interface SessionOperationResult {
  success: boolean;
  session?: WatchSession;
  error?: string;
}

/**
 * Analytics query filters
 */
export interface AnalyticsFilters {
  videoId?: string;
  playlistId?: string;
  startDate?: Date;
  endDate?: Date;
  minCompletion?: number; // 0-100
  maxCompletion?: number; // 0-100
}
