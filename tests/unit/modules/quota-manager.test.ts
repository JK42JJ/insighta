/**
 * Quota Manager Unit Tests
 *
 * Tests for:
 * - getOperationCost() — pure operation cost lookup
 * - calculateSyncCost() — pure sync cost calculation
 * - QuotaOperation interface validation
 */

// ============================================================================
// Mocks (must be before imports)
// ============================================================================

jest.mock('../../../src/config', () => ({
  config: {
    quota: {
      dailyLimit: 10000,
      warningThreshold: 9000,
    },
    quotaCosts: {
      playlistDetails: 1,
      playlistItems: 1,
      videos: 1,
      search: 100,
      channels: 1,
    },
  },
}));

jest.mock('../../../src/modules/database/client', () => ({
  db: {},
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logQuotaUsage: jest.fn(),
}));

jest.mock('../../../src/utils/errors', () => ({
  QuotaExceededError: class QuotaExceededError extends Error {
    constructor(details: { used: number; limit: number; requested: number }) {
      super(`Quota exceeded: ${details.used}/${details.limit}`);
    }
  },
}));

// ============================================================================
// Imports
// ============================================================================

import { QuotaManager, type QuotaOperation } from '../../../src/modules/quota/manager';

// ============================================================================
// Tests
// ============================================================================

describe('QuotaManager', () => {
  let manager: QuotaManager;

  beforeEach(() => {
    manager = new QuotaManager();
  });

  describe('getOperationCost', () => {
    it('returns correct cost for playlist.details', () => {
      const cost = manager.getOperationCost({ type: 'playlist.details' });
      expect(cost).toBe(1);
    });

    it('returns correct cost for search', () => {
      const cost = manager.getOperationCost({ type: 'search' });
      expect(cost).toBe(100);
    });

    it('returns correct cost for channel.details', () => {
      const cost = manager.getOperationCost({ type: 'channel.details' });
      expect(cost).toBe(1);
    });

    it('calculates playlist.items cost based on item count (50 per page)', () => {
      // 1 page for 50 items
      expect(manager.getOperationCost({ type: 'playlist.items', itemCount: 50 })).toBe(1);
      // 2 pages for 51 items
      expect(manager.getOperationCost({ type: 'playlist.items', itemCount: 51 })).toBe(2);
      // 1 page for 1 item
      expect(manager.getOperationCost({ type: 'playlist.items', itemCount: 1 })).toBe(1);
      // 3 pages for 150 items
      expect(manager.getOperationCost({ type: 'playlist.items', itemCount: 150 })).toBe(3);
    });

    it('calculates video.details cost based on item count (50 per page)', () => {
      expect(manager.getOperationCost({ type: 'video.details', itemCount: 100 })).toBe(2);
      expect(manager.getOperationCost({ type: 'video.details', itemCount: 25 })).toBe(1);
    });

    it('defaults to 50 items when itemCount not provided for playlist.items', () => {
      const cost = manager.getOperationCost({ type: 'playlist.items' });
      expect(cost).toBe(1); // ceil(50/50) * 1
    });

    it('defaults to 50 items when itemCount not provided for video.details', () => {
      const cost = manager.getOperationCost({ type: 'video.details' });
      expect(cost).toBe(1); // ceil(50/50) * 1
    });

    it('returns default cost of 1 for unknown operation types', () => {
      const cost = manager.getOperationCost({
        type: 'unknown.operation' as QuotaOperation['type'],
      });
      expect(cost).toBe(1);
    });
  });

  describe('calculateSyncCost', () => {
    it('calculates correct cost for small playlist (1-50 items)', () => {
      // playlistDetails(1) + ceil(10/50)*playlistItems(1) + ceil(10/50)*videos(1)
      const cost = manager.calculateSyncCost(10);
      expect(cost).toBe(1 + 1 + 1); // 3
    });

    it('calculates correct cost for medium playlist (51-100 items)', () => {
      // playlistDetails(1) + ceil(75/50)*1 + ceil(75/50)*1
      const cost = manager.calculateSyncCost(75);
      expect(cost).toBe(1 + 2 + 2); // 5
    });

    it('calculates correct cost for large playlist (200+ items)', () => {
      // playlistDetails(1) + ceil(200/50)*1 + ceil(200/50)*1
      const cost = manager.calculateSyncCost(200);
      expect(cost).toBe(1 + 4 + 4); // 9
    });

    it('handles zero items', () => {
      // playlistDetails(1) + ceil(0/50)*1 + ceil(0/50)*1 = 1 + 0 + 0
      const cost = manager.calculateSyncCost(0);
      expect(cost).toBe(1);
    });

    it('handles exact page boundary (50 items)', () => {
      // playlistDetails(1) + ceil(50/50)*1 + ceil(50/50)*1 = 1 + 1 + 1
      const cost = manager.calculateSyncCost(50);
      expect(cost).toBe(3);
    });

    it('handles just above page boundary (51 items)', () => {
      // playlistDetails(1) + ceil(51/50)*1 + ceil(51/50)*1 = 1 + 2 + 2
      const cost = manager.calculateSyncCost(51);
      expect(cost).toBe(5);
    });
  });
});
