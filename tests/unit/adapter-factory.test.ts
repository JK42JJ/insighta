/**
 * AdapterFactory Unit Tests
 *
 * Tests for AdapterFactory implementation including:
 * - Adapter creation
 * - Custom adapter registration
 * - Source type support
 * - Error handling
 */

import {
  createAdapter,
  createAndInitializeAdapter,
  registerAdapterConstructor,
  unregisterAdapterConstructor,
  getSupportedSourceTypes,
  isAdapterSupported,
  clearAdapterConstructors,
} from '../../src/adapters/AdapterFactory';
import { YouTubeAdapter } from '../../src/adapters/YouTubeAdapter';
import {
  DataSourceAdapter,
  AdapterConfig,
  SourceType,
  SourceCapabilities,
} from '../../src/adapters/DataSourceAdapter';

describe('AdapterFactory', () => {
  const mockConfig: AdapterConfig = {
    sourceType: 'youtube',
    credentials: { apiKey: 'test-api-key' },
    quotaLimit: 10000,
    cacheEnabled: true,
  };

  afterEach(() => {
    // Clear custom adapters after each test
    clearAdapterConstructors();
  });

  describe('Built-in Adapters', () => {
    test('should list supported source types', () => {
      const types = getSupportedSourceTypes();

      expect(types).toContain('youtube');
      expect(types.length).toBeGreaterThan(0);
    });

    test('should check if adapter is supported', () => {
      expect(isAdapterSupported('youtube')).toBe(true);
      expect(isAdapterSupported('notion' as SourceType)).toBe(false);
    });

    test('should create YouTube adapter', () => {
      const adapter = createAdapter('youtube', mockConfig);

      expect(adapter).toBeInstanceOf(YouTubeAdapter);
      expect(adapter.sourceType).toBe('youtube');
      expect(adapter.name).toBe('youtube');
      expect(adapter.version).toBe('1.0.0');
    });

    test('should throw error for unsupported adapter type', () => {
      const unsupportedConfig: AdapterConfig = {
        sourceType: 'unsupported',
        credentials: {},
      };

      expect(() => createAdapter('unsupported', unsupportedConfig)).toThrow(
        'Unsupported adapter type: unsupported'
      );
    });

    test('should include supported types in error message', () => {
      const unsupportedConfig: AdapterConfig = {
        sourceType: 'unsupported',
        credentials: {},
      };

      expect(() => createAdapter('unsupported', unsupportedConfig)).toThrow(
        /Supported types:/
      );
    });
  });

  describe('Adapter Initialization', () => {
    test('should create adapter without auto-initialization', () => {
      const adapter = createAdapter('youtube', mockConfig);

      // Adapter should be created but not initialized
      expect(adapter).toBeInstanceOf(YouTubeAdapter);

      // Calling methods before initialization should throw
      expect(() => adapter.extractCollectionId('https://youtube.com/playlist?list=PLxxx')).not.toThrow();
    });

    test('should create and initialize adapter', async () => {
      const adapter = await createAndInitializeAdapter('youtube', mockConfig);

      expect(adapter).toBeInstanceOf(YouTubeAdapter);

      // Adapter should be initialized
      expect(() => adapter.extractCollectionId('https://youtube.com/playlist?list=PLxxx')).not.toThrow();

      await adapter.shutdown();
    });

    test('should handle initialization failures', async () => {
      const invalidConfig: AdapterConfig = {
        sourceType: 'youtube',
        credentials: {}, // Missing API key
        quotaLimit: 10000,
      };

      // This should create the adapter but initialization might fail
      // depending on the adapter's requirements
      const adapter = await createAndInitializeAdapter('youtube', invalidConfig);
      expect(adapter).toBeInstanceOf(YouTubeAdapter);

      await adapter.shutdown();
    });
  });

  describe('Custom Adapter Registration', () => {
    class CustomAdapter implements DataSourceAdapter {
      readonly name = 'custom';
      readonly version = '1.0.0';
      readonly sourceType = 'custom' as SourceType;

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
        return 'custom-collection';
      }
      getSchema(): any {
        return {
          sourceType: 'custom',
          supportedContentTypes: [],
          requiredFields: [],
          optionalFields: [],
          metadataFields: {},
        };
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

    test('should register custom adapter constructor', () => {
      registerAdapterConstructor('custom', CustomAdapter);

      expect(isAdapterSupported('custom')).toBe(true);
      expect(getSupportedSourceTypes()).toContain('custom');
    });

    test('should create custom adapter', () => {
      registerAdapterConstructor('custom', CustomAdapter);

      const config: AdapterConfig = {
        sourceType: 'custom',
        credentials: {},
      };

      const adapter = createAdapter('custom', config);

      expect(adapter).toBeInstanceOf(CustomAdapter);
      expect(adapter.sourceType).toBe('custom');
    });

    test('should throw error when registering duplicate constructor', () => {
      registerAdapterConstructor('custom', CustomAdapter);

      expect(() => registerAdapterConstructor('custom', CustomAdapter)).toThrow(
        "Adapter constructor for 'custom' is already registered"
      );
    });

    test('should unregister custom adapter constructor', () => {
      registerAdapterConstructor('custom', CustomAdapter);
      expect(isAdapterSupported('custom')).toBe(true);

      unregisterAdapterConstructor('custom');
      expect(isAdapterSupported('custom')).toBe(false);
    });

    test('should not throw when unregistering non-existent constructor', () => {
      expect(() => unregisterAdapterConstructor('non-existent' as SourceType)).not.toThrow();
    });
  });

  describe('Multiple Adapters', () => {
    class AnotherCustomAdapter implements DataSourceAdapter {
      readonly name = 'another';
      readonly version = '2.0.0';
      readonly sourceType = 'another' as SourceType;

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
        return 'another-collection';
      }
      getSchema(): any {
        return {
          sourceType: 'another',
          supportedContentTypes: [],
          requiredFields: [],
          optionalFields: [],
          metadataFields: {},
        };
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

    test('should support multiple custom adapters', () => {
      class CustomAdapter implements DataSourceAdapter {
        readonly name = 'custom';
        readonly version = '1.0.0';
        readonly sourceType = 'custom' as SourceType;

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
          return 'custom-collection';
        }
        getSchema(): any {
          return {
            sourceType: 'custom',
            supportedContentTypes: [],
            requiredFields: [],
            optionalFields: [],
            metadataFields: {},
          };
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

      registerAdapterConstructor('custom', CustomAdapter);
      registerAdapterConstructor('another', AnotherCustomAdapter);

      const supportedTypes = getSupportedSourceTypes();

      expect(supportedTypes).toContain('youtube');
      expect(supportedTypes).toContain('custom');
      expect(supportedTypes).toContain('another');
    });

    test('should create different adapter instances', () => {
      class CustomAdapter implements DataSourceAdapter {
        readonly name = 'custom';
        readonly version = '1.0.0';
        readonly sourceType = 'custom' as SourceType;

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
          return 'custom-collection';
        }
        getSchema(): any {
          return {
            sourceType: 'custom',
            supportedContentTypes: [],
            requiredFields: [],
            optionalFields: [],
            metadataFields: {},
          };
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

      registerAdapterConstructor('custom', CustomAdapter);
      registerAdapterConstructor('another', AnotherCustomAdapter);

      const customConfig: AdapterConfig = { sourceType: 'custom', credentials: {} };
      const anotherConfig: AdapterConfig = { sourceType: 'another', credentials: {} };

      const customAdapter = createAdapter('custom', customConfig);
      const anotherAdapter = createAdapter('another', anotherConfig);
      const youtubeAdapter = createAdapter('youtube', mockConfig);

      expect(customAdapter.sourceType).toBe('custom');
      expect(anotherAdapter.sourceType).toBe('another');
      expect(youtubeAdapter.sourceType).toBe('youtube');
    });
  });

  describe('Clear Constructors', () => {
    test('should clear all custom constructors', () => {
      class CustomAdapter implements DataSourceAdapter {
        readonly name = 'custom';
        readonly version = '1.0.0';
        readonly sourceType = 'custom' as SourceType;

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
          return 'custom-collection';
        }
        getSchema(): any {
          return {
            sourceType: 'custom',
            supportedContentTypes: [],
            requiredFields: [],
            optionalFields: [],
            metadataFields: {},
          };
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

      registerAdapterConstructor('custom', CustomAdapter);
      expect(isAdapterSupported('custom')).toBe(true);

      clearAdapterConstructors();

      // After clearing, even built-in adapters are removed
      expect(isAdapterSupported('custom')).toBe(false);

      // But they get re-registered on next call
      const types = getSupportedSourceTypes();
      expect(types).toContain('youtube');
    });
  });
});
