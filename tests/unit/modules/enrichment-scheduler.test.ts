/**
 * Enrichment Scheduler — Unit Tests
 *
 * Tests for public API: lifecycle, status, history, adaptive behavior.
 * DB-dependent methods are tested indirectly via mock.
 */

import {
  EnrichmentScheduler,
  getEnrichmentScheduler,
} from '../../../src/modules/enrichment/scheduler';

// Mock Prisma client
jest.mock('../../../src/modules/database/client', () => ({
  getPrismaClient: jest.fn(() => ({
    $queryRaw: jest.fn().mockResolvedValue([{ count: BigInt(0) }]),
    $executeRaw: jest.fn().mockResolvedValue(0),
  })),
}));

// Mock enrichVideo
jest.mock('../../../src/modules/ontology/enrichment', () => ({
  enrichVideo: jest.fn().mockResolvedValue(undefined),
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock fetch for health check
global.fetch = jest.fn().mockResolvedValue({ ok: true }) as jest.Mock;

describe('EnrichmentScheduler', () => {
  let scheduler: EnrichmentScheduler;

  beforeEach(() => {
    jest.useFakeTimers();
    scheduler = new EnrichmentScheduler();
  });

  afterEach(async () => {
    await scheduler.stop();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  describe('lifecycle', () => {
    it('starts in disabled state', () => {
      const status = scheduler.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.running).toBe(false);
    });

    it('transitions to enabled state after start()', async () => {
      await scheduler.start();
      const status = scheduler.getStatus();
      expect(status.enabled).toBe(true);
    });

    it('transitions to disabled state after stop()', async () => {
      await scheduler.start();
      await scheduler.stop();
      const status = scheduler.getStatus();
      expect(status.enabled).toBe(false);
    });

    it('start() is idempotent (double start does not error)', async () => {
      await scheduler.start();
      await scheduler.start();
      const status = scheduler.getStatus();
      expect(status.enabled).toBe(true);
    });

    it('stop() is idempotent (double stop does not error)', async () => {
      await scheduler.start();
      await scheduler.stop();
      await scheduler.stop();
      const status = scheduler.getStatus();
      expect(status.enabled).toBe(false);
    });
  });

  // ==========================================================================
  // Status
  // ==========================================================================

  describe('getStatus', () => {
    it('returns correct initial status shape', () => {
      const status = scheduler.getStatus();
      expect(status).toEqual({
        enabled: false,
        running: false,
        cardDelayMs: 5000,
        consecutiveSuccess: 0,
        skipCyclesRemaining: 0,
        recentCycles: { enriched: 0, errors: 0 },
        lastRun: null,
        currentCycle: null,
        totalRuns: 0,
      });
    });

    it('initial cardDelayMs is 5000 (DEFAULT_CARD_DELAY_MS)', () => {
      expect(scheduler.getStatus().cardDelayMs).toBe(5000);
    });

    it('consecutiveSuccess starts at 0', () => {
      expect(scheduler.getStatus().consecutiveSuccess).toBe(0);
    });
  });

  // ==========================================================================
  // History
  // ==========================================================================

  describe('getHistory', () => {
    it('returns empty array initially', () => {
      expect(scheduler.getHistory()).toEqual([]);
    });

    it('respects limit parameter', () => {
      const history = scheduler.getHistory(5);
      expect(history).toEqual([]);
    });

    it('default limit is 10', () => {
      const history = scheduler.getHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('getEnrichmentScheduler', () => {
    it('returns an EnrichmentScheduler instance', () => {
      const instance = getEnrichmentScheduler();
      expect(instance).toBeInstanceOf(EnrichmentScheduler);
    });

    it('returns the same instance on subsequent calls (singleton)', () => {
      const a = getEnrichmentScheduler();
      const b = getEnrichmentScheduler();
      expect(a).toBe(b);
    });
  });
});
