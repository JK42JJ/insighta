/**
 * Module Index Exports Unit Tests
 *
 * Simple tests to verify module index files properly export their members
 */

describe('Module Index Exports', () => {
  describe('adapters/index', () => {
    test('should export adapter classes', () => {
      const adaptersModule = require('../../../src/adapters');
      expect(adaptersModule.YouTubeAdapter).toBeDefined();
      expect(adaptersModule.AdapterRegistry).toBeDefined();
    });

    test('should export factory functions', () => {
      const {
        createAdapter,
        getAdapterRegistry,
        createAndInitializeAdapter,
      } = require('../../../src/adapters');
      expect(typeof createAdapter).toBe('function');
      expect(typeof getAdapterRegistry).toBe('function');
      expect(typeof createAndInitializeAdapter).toBe('function');
    });

    test('should export utility functions', () => {
      const {
        registerAdapterConstructor,
        unregisterAdapterConstructor,
        getSupportedSourceTypes,
        isAdapterSupported,
      } = require('../../../src/adapters');
      expect(typeof registerAdapterConstructor).toBe('function');
      expect(typeof unregisterAdapterConstructor).toBe('function');
      expect(typeof getSupportedSourceTypes).toBe('function');
      expect(typeof isAdapterSupported).toBe('function');
    });
  });

  describe('api/index', () => {
    test('should export getYouTubeClient function', () => {
      const { getYouTubeClient } = require('../../../src/api');
      expect(typeof getYouTubeClient).toBe('function');
    });

    test('should re-export client module', () => {
      const apiModule = require('../../../src/api');
      expect(apiModule).toBeDefined();
    });
  });

  describe('modules/analytics/index', () => {
    test('should export AnalyticsTracker', () => {
      const analyticsModule = require('../../../src/modules/analytics');
      expect(analyticsModule.AnalyticsTracker).toBeDefined();
    });

    test('should export getAnalyticsTracker function', () => {
      const { getAnalyticsTracker } = require('../../../src/modules/analytics');
      expect(typeof getAnalyticsTracker).toBe('function');
    });

    test('should have default export', () => {
      const defaultExport = require('../../../src/modules/analytics').default;
      expect(typeof defaultExport).toBe('function');
    });
  });

  describe('modules/auth/index', () => {
    test('should export TokenManager', () => {
      const authModule = require('../../../src/modules/auth');
      expect(authModule.TokenManager).toBeDefined();
    });

    test('should export getTokenManager function', () => {
      const { getTokenManager } = require('../../../src/modules/auth');
      expect(typeof getTokenManager).toBe('function');
    });

    test('should export types', () => {
      const {
        credentialsToStoredTokens,
      } = require('../../../src/modules/auth');
      expect(typeof credentialsToStoredTokens).toBe('function');
    });
  });

  describe('modules/note/index', () => {
    test('should export NoteManager', () => {
      const noteModule = require('../../../src/modules/note');
      expect(noteModule.NoteManager).toBeDefined();
    });

    test('should export getNoteManager function', () => {
      const { getNoteManager } = require('../../../src/modules/note');
      expect(typeof getNoteManager).toBe('function');
    });

    test('should have default export', () => {
      const defaultExport = require('../../../src/modules/note').default;
      expect(typeof defaultExport).toBe('function');
    });
  });

  describe('modules/quota/index', () => {
    test('should export QuotaManager', () => {
      const quotaModule = require('../../../src/modules/quota');
      expect(quotaModule.QuotaManager).toBeDefined();
    });

    test('should export getQuotaManager function', () => {
      const { getQuotaManager } = require('../../../src/modules/quota');
      expect(typeof getQuotaManager).toBe('function');
    });
  });

  describe('modules/scheduler/index', () => {
    test('should export SchedulerManager', () => {
      const schedulerModule = require('../../../src/modules/scheduler');
      expect(schedulerModule.SchedulerManager).toBeDefined();
    });

    test('should export getSchedulerManager function', () => {
      const { getSchedulerManager } = require('../../../src/modules/scheduler');
      expect(typeof getSchedulerManager).toBe('function');
    });

    test('should have default export', () => {
      const defaultExport = require('../../../src/modules/scheduler').default;
      expect(typeof defaultExport).toBe('function');
    });
  });

  describe('modules/summarization/index', () => {
    test('should export SummaryGenerator', () => {
      const summarizationModule = require('../../../src/modules/summarization');
      expect(summarizationModule.SummaryGenerator).toBeDefined();
    });

    test('should export getSummaryGenerator function', () => {
      const { getSummaryGenerator } = require('../../../src/modules/summarization');
      expect(typeof getSummaryGenerator).toBe('function');
    });

    test('should have default export', () => {
      const defaultExport = require('../../../src/modules/summarization').default;
      expect(typeof defaultExport).toBe('function');
    });
  });

  describe('modules/video/index', () => {
    test('should export VideoManager', () => {
      const videoModule = require('../../../src/modules/video');
      expect(videoModule.VideoManager).toBeDefined();
    });

    test('should export getVideoManager function', () => {
      const { getVideoManager } = require('../../../src/modules/video');
      expect(typeof getVideoManager).toBe('function');
    });
  });
});
