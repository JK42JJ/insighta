/**
 * Type definitions for enums
 *
 * These replace Prisma enums for SQLite compatibility
 */

export enum SyncStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum WatchStatus {
  UNWATCHED = 'UNWATCHED',
  WATCHING = 'WATCHING',
  COMPLETED = 'COMPLETED',
}

export type SyncStatusValue = `${SyncStatus}`;
export type WatchStatusValue = `${WatchStatus}`;
