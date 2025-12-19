/**
 * Type exports test
 *
 * Ensures all type exports are available and properly structured
 */

import * as types from '../../../src/types';

describe('Types Index', () => {
  describe('Enum exports', () => {
    it('should export SyncStatus enum', () => {
      expect(types.SyncStatus).toBeDefined();
      expect(types.SyncStatus.PENDING).toBe('PENDING');
      expect(types.SyncStatus.IN_PROGRESS).toBe('IN_PROGRESS');
      expect(types.SyncStatus.COMPLETED).toBe('COMPLETED');
      expect(types.SyncStatus.FAILED).toBe('FAILED');
    });

    it('should export WatchStatus enum', () => {
      expect(types.WatchStatus).toBeDefined();
      expect(types.WatchStatus.UNWATCHED).toBe('UNWATCHED');
      expect(types.WatchStatus.WATCHING).toBe('WATCHING');
      expect(types.WatchStatus.COMPLETED).toBe('COMPLETED');
    });
  });

  describe('Type structure', () => {
    it('should export all expected enum values', () => {
      // Verify the module structure
      expect(Object.keys(types)).toContain('SyncStatus');
      expect(Object.keys(types)).toContain('WatchStatus');
    });
  });
});
