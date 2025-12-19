/**
 * AdapterRegistry Unit Tests
 *
 * Tests for AdapterRegistry implementation including:
 * - Singleton pattern
 * - Registration and retrieval
 * - Metadata management
 * - Lifecycle management
 */

import { AdapterRegistry } from '../../src/adapters/AdapterRegistry';
import { YouTubeAdapter } from '../../src/adapters/YouTubeAdapter';
import {
  DataSourceAdapter,
  AdapterConfig,
  SourceType,
  SourceCapabilities,
} from '../../src/adapters/DataSourceAdapter';

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;
  let youtubeAdapter: YouTubeAdapter;

  beforeEach(() => {
    // Reset singleton before each test
    AdapterRegistry.resetInstance();
    registry = AdapterRegistry.getInstance();
    youtubeAdapter = new YouTubeAdapter();
  });

  afterEach(async () => {
    // Cleanup
    await registry.shutdownAll();
    registry.clear();
  });

  describe('Singleton Pattern', () => {
    test('should return same instance on multiple calls', () => {
      const instance1 = AdapterRegistry.getInstance();
      const instance2 = AdapterRegistry.getInstance();

      expect(instance1).toBe(instance2);
    });

    test('should create new instance after reset', () => {
      const instance1 = AdapterRegistry.getInstance();
      AdapterRegistry.resetInstance();
      const instance2 = AdapterRegistry.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Adapter Registration', () => {
    test('should register adapter successfully', () => {
      expect(() => registry.register(youtubeAdapter)).not.toThrow();
      expect(registry.has('youtube')).toBe(true);
    });

    test('should throw error when registering duplicate sourceType', () => {
      registry.register(youtubeAdapter);

      const duplicateAdapter = new YouTubeAdapter();
      expect(() => registry.register(duplicateAdapter)).toThrow(
        "Adapter for sourceType 'youtube' is already registered"
      );
    });

    test('should store adapter metadata on registration', () => {
      registry.register(youtubeAdapter);

      const metadata = registry.getMetadata('youtube');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('youtube');
      expect(metadata?.version).toBe('1.0.0');
      expect(metadata?.sourceType).toBe('youtube');
      expect(metadata?.capabilities).toBeDefined();
    });
  });

  describe('Adapter Retrieval', () => {
    beforeEach(() => {
      registry.register(youtubeAdapter);
    });

    test('should retrieve registered adapter', () => {
      const adapter = registry.get('youtube');

      expect(adapter).toBeDefined();
      expect(adapter).toBe(youtubeAdapter);
    });

    test('should return undefined for non-existent adapter', () => {
      const adapter = registry.get('notion' as SourceType);

      expect(adapter).toBeUndefined();
    });

    test('should retrieve all adapters', () => {
      const adapters = registry.getAll();

      expect(adapters).toHaveLength(1);
      expect(adapters[0]).toBe(youtubeAdapter);
    });

    test('should check adapter existence', () => {
      expect(registry.has('youtube')).toBe(true);
      expect(registry.has('notion' as SourceType)).toBe(false);
    });
  });

  describe('Adapter Unregistration', () => {
    beforeEach(() => {
      registry.register(youtubeAdapter);
    });

    test('should unregister adapter successfully', () => {
      registry.unregister('youtube');

      expect(registry.has('youtube')).toBe(false);
      expect(registry.get('youtube')).toBeUndefined();
    });

    test('should remove metadata on unregistration', () => {
      registry.unregister('youtube');

      expect(registry.getMetadata('youtube')).toBeUndefined();
    });

    test('should not throw error when unregistering non-existent adapter', () => {
      expect(() => registry.unregister('notion' as SourceType)).not.toThrow();
    });
  });

  describe('Metadata Management', () => {
    beforeEach(() => {
      registry.register(youtubeAdapter);
    });

    test('should retrieve adapter metadata', () => {
      const metadata = registry.getMetadata('youtube');

      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('youtube');
      expect(metadata?.version).toBe('1.0.0');
      expect(metadata?.sourceType).toBe('youtube');
    });

    test('should retrieve all metadata', () => {
      const allMetadata = registry.getAllMetadata();

      expect(allMetadata).toHaveLength(1);
      expect(allMetadata[0]?.sourceType).toBe('youtube');
    });

    test('should generate description from capabilities', () => {
      const metadata = registry.getMetadata('youtube');

      expect(metadata?.description).toBeDefined();
      expect(metadata?.description).toContain('youtube adapter');
      expect(metadata?.description).toContain('v1.0.0');
    });
  });

  describe('Supported Source Types', () => {
    test('should return empty array initially', () => {
      const types = registry.getSupportedSourceTypes();

      expect(types).toHaveLength(0);
    });

    test('should return registered source types', () => {
      registry.register(youtubeAdapter);

      const types = registry.getSupportedSourceTypes();

      expect(types).toHaveLength(1);
      expect(types).toContain('youtube');
    });
  });

  describe('Lifecycle Management', () => {
    test('should shutdown all adapters', async () => {
      const shutdownSpy = jest.spyOn(youtubeAdapter, 'shutdown');
      registry.register(youtubeAdapter);

      await registry.shutdownAll();

      expect(shutdownSpy).toHaveBeenCalled();
    });

    test('should handle shutdown errors gracefully', async () => {
      const shutdownSpy = jest
        .spyOn(youtubeAdapter, 'shutdown')
        .mockRejectedValueOnce(new Error('Shutdown failed'));

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      registry.register(youtubeAdapter);

      await expect(registry.shutdownAll()).resolves.not.toThrow();
      expect(shutdownSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to shutdown adapter'),
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    test('should clear all adapters without shutdown', () => {
      registry.register(youtubeAdapter);

      registry.clear();

      expect(registry.has('youtube')).toBe(false);
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe('Mock Adapter Tests', () => {
    class MockAdapter implements DataSourceAdapter {
      readonly name = 'mock';
      readonly version = '1.0.0';
      readonly sourceType = 'mock' as SourceType;

      async initialize(_config: AdapterConfig): Promise<void> {}
      async shutdown(): Promise<void> {}
      async authenticate(_credentials: any): Promise<any> {
        return { success: true };
      }
      async refreshAuth(): Promise<any> {
        return { success: true };
      }
      setCredentials(_credentials: any): void {}
      async fetchCollection(_collectionId: string, _options?: any): Promise<any> {
        return {};
      }
      async fetchCollectionItems(_collectionId: string, _options?: any): Promise<any> {
        return { items: [] };
      }
      async fetchContentItem(_contentId: string, _options?: any): Promise<any> {
        return {};
      }
      async fetchContentItemsBatch(_contentIds: string[], _options?: any): Promise<any[]> {
        return [];
      }
      extractCollectionId(_url: string): string {
        return 'mock-collection';
      }
      getSchema(): any {
        return { sourceType: 'mock', supportedContentTypes: [], requiredFields: [], optionalFields: [], metadataFields: {} };
      }
      getCapabilities(): SourceCapabilities {
        return {
          supportsCollections: true,
          supportsDirectContent: true,
          supportsSearch: false,
          supportsIncrementalSync: false,
          supportsRealTimeSync: false,
          supportsFullText: false,
          supportsTranscripts: false,
          supportsComments: false,
          hasQuotaLimit: false,
          hasRateLimit: false,
        };
      }
      async healthCheck(): Promise<any> {
        return { healthy: true, authenticated: true, lastChecked: new Date() };
      }
    }

    test('should support multiple adapter types', () => {
      const mockAdapter = new MockAdapter();

      registry.register(youtubeAdapter);
      registry.register(mockAdapter);

      expect(registry.has('youtube')).toBe(true);
      expect(registry.has('mock')).toBe(true);
      expect(registry.getAll()).toHaveLength(2);
    });

    test('should maintain separate metadata for each adapter', () => {
      const mockAdapter = new MockAdapter();

      registry.register(youtubeAdapter);
      registry.register(mockAdapter);

      const youtubeMetadata = registry.getMetadata('youtube');
      const mockMetadata = registry.getMetadata('mock');

      expect(youtubeMetadata?.sourceType).toBe('youtube');
      expect(mockMetadata?.sourceType).toBe('mock');
    });
  });
});
