/**
 * Type definitions for enums
 *
 * These replace Prisma enums for SQLite compatibility
 */

export enum SyncStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'syncing', // DB CHECK constraint uses 'syncing', not 'in_progress'
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/** Status for youtube_sync_history table (DB CHECK: 'started', 'completed', 'failed') */
export enum SyncHistoryStatus {
  STARTED = 'started',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum WatchStatus {
  UNWATCHED = 'UNWATCHED',
  WATCHING = 'WATCHING',
  COMPLETED = 'COMPLETED',
}

export type SyncStatusValue = `${SyncStatus}`;
export type SyncHistoryStatusValue = `${SyncHistoryStatus}`;
export type WatchStatusValue = `${WatchStatus}`;
