/**
 * AdapterFactory Implementation
 *
 * Factory for creating and initializing DataSourceAdapter instances.
 * Provides type-safe adapter creation with configuration management.
 *
 * @version 1.0.0
 * @since 2025-12-17
 */

import {
  DataSourceAdapter,
  AdapterConfig,
  SourceType,
  AdapterFactory as IAdapterFactory,
} from './DataSourceAdapter';
import { YouTubeAdapter } from './YouTubeAdapter';

/**
 * Adapter constructor type
 */
type AdapterConstructor = new () => DataSourceAdapter;

/**
 * Registry of adapter constructors by sourceType
 */
const adapterConstructors: Map<SourceType, AdapterConstructor> = new Map();

/**
 * Register built-in adapters
 */
function registerBuiltInAdapters(): void {
  // Always ensure built-in adapters are registered
  if (!adapterConstructors.has('youtube')) {
    adapterConstructors.set('youtube', YouTubeAdapter);
  }
  // Future adapters will be registered here:
  // if (!adapterConstructors.has('notion')) {
  //   adapterConstructors.set('notion', NotionAdapter);
  // }
  // if (!adapterConstructors.has('linkedin')) {
  //   adapterConstructors.set('linkedin', LinkedInAdapter);
  // }
}

/**
 * Create a DataSourceAdapter instance
 *
 * Factory function for creating adapter instances with configuration.
 *
 * @param sourceType - Type of data source ('youtube', 'notion', etc.)
 * @param config - Adapter configuration
 * @returns Initialized adapter instance
 * @throws Error if sourceType is not supported
 *
 * @example
 * ```typescript
 * const adapter = createAdapter('youtube', {
 *   sourceType: 'youtube',
 *   credentials: { apiKey: 'YOUR_API_KEY' },
 *   quotaLimit: 10000,
 *   cacheEnabled: true,
 * });
 *
 * await adapter.initialize(config);
 * const playlist = await adapter.fetchCollection('PLxxx...');
 * ```
 */
export const createAdapter: IAdapterFactory = (
  sourceType: SourceType,
  _config: AdapterConfig
): DataSourceAdapter => {
  // Ensure built-in adapters are registered
  registerBuiltInAdapters();

  const AdapterConstructor = adapterConstructors.get(sourceType);

  if (!AdapterConstructor) {
    const supportedTypes = Array.from(adapterConstructors.keys()).join(', ');
    throw new Error(
      `Unsupported adapter type: ${sourceType}. Supported types: ${supportedTypes}`
    );
  }

  const adapter = new AdapterConstructor();

  // Note: config parameter is intentionally unused here
  // Initialize adapter with config (async operation - caller must await)
  // We don't await here to keep factory synchronous
  // Caller should call adapter.initialize(config) separately

  return adapter;
};

/**
 * Create and initialize a DataSourceAdapter
 *
 * Convenience function that creates and initializes an adapter in one call.
 *
 * @param sourceType - Type of data source
 * @param config - Adapter configuration
 * @returns Promise resolving to initialized adapter
 * @throws Error if sourceType is not supported or initialization fails
 *
 * @example
 * ```typescript
 * const adapter = await createAndInitializeAdapter('youtube', {
 *   sourceType: 'youtube',
 *   credentials: { apiKey: 'YOUR_API_KEY' },
 *   quotaLimit: 10000,
 * });
 *
 * // Adapter is ready to use
 * const playlist = await adapter.fetchCollection('PLxxx...');
 * ```
 */
export async function createAndInitializeAdapter(
  sourceType: SourceType,
  config: AdapterConfig
): Promise<DataSourceAdapter> {
  const adapter = createAdapter(sourceType, config);
  await adapter.initialize(config);
  return adapter;
}

/**
 * Register a custom adapter constructor
 *
 * Allows registering third-party or custom adapters at runtime.
 *
 * @param sourceType - Source type identifier
 * @param constructor - Adapter constructor function
 * @throws Error if sourceType is already registered
 *
 * @example
 * ```typescript
 * class CustomAdapter implements DataSourceAdapter {
 *   // ... implementation
 * }
 *
 * registerAdapterConstructor('custom', CustomAdapter);
 *
 * const adapter = createAdapter('custom', config);
 * ```
 */
export function registerAdapterConstructor(
  sourceType: SourceType,
  constructor: AdapterConstructor
): void {
  if (adapterConstructors.has(sourceType)) {
    throw new Error(`Adapter constructor for '${sourceType}' is already registered`);
  }

  adapterConstructors.set(sourceType, constructor);
}

/**
 * Unregister an adapter constructor
 *
 * @param sourceType - Source type to unregister
 */
export function unregisterAdapterConstructor(sourceType: SourceType): void {
  adapterConstructors.delete(sourceType);
}

/**
 * Get supported source types
 *
 * @returns Array of registered source types
 */
export function getSupportedSourceTypes(): SourceType[] {
  registerBuiltInAdapters();
  return Array.from(adapterConstructors.keys());
}

/**
 * Check if adapter type is supported
 *
 * @param sourceType - Source type to check
 * @returns true if supported, false otherwise
 */
export function isAdapterSupported(sourceType: SourceType): boolean {
  registerBuiltInAdapters();
  return adapterConstructors.has(sourceType);
}

/**
 * Clear all adapter constructors (for testing)
 */
export function clearAdapterConstructors(): void {
  adapterConstructors.clear();
}

export default createAdapter;
