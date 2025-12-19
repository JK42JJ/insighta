/**
 * AdapterRegistry Implementation
 *
 * Centralized registry for managing DataSourceAdapter instances.
 * Provides singleton pattern for global adapter management.
 *
 * @version 1.0.0
 * @since 2025-12-17
 */

import {
  DataSourceAdapter,
  AdapterRegistry as IAdapterRegistry,
  SourceType,
  AdapterMetadata,
} from './DataSourceAdapter';

/**
 * Concrete implementation of AdapterRegistry
 *
 * Features:
 * - Singleton pattern for global registry access
 * - Thread-safe adapter registration and retrieval
 * - Automatic lifecycle management
 * - Metadata caching for quick lookups
 *
 * @example
 * ```typescript
 * const registry = AdapterRegistry.getInstance();
 * registry.register(new YouTubeAdapter());
 * const adapter = registry.get('youtube');
 * ```
 */
export class AdapterRegistry implements IAdapterRegistry {
  private static instance: AdapterRegistry | null = null;

  /**
   * Map of sourceType to adapter instance
   */
  private adapters: Map<SourceType, DataSourceAdapter>;

  /**
   * Map of sourceType to adapter metadata
   */
  private metadata: Map<SourceType, AdapterMetadata>;

  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    this.adapters = new Map();
    this.metadata = new Map();
  }

  /**
   * Get singleton instance of AdapterRegistry
   *
   * @returns Global AdapterRegistry instance
   */
  public static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  /**
   * Reset singleton instance (for testing)
   */
  public static resetInstance(): void {
    AdapterRegistry.instance = null;
  }

  /**
   * Register a new adapter
   *
   * @param adapter - DataSourceAdapter instance to register
   * @throws Error if adapter with same sourceType already exists
   */
  register(adapter: DataSourceAdapter): void {
    const sourceType = adapter.sourceType;

    if (this.adapters.has(sourceType)) {
      throw new Error(`Adapter for sourceType '${sourceType}' is already registered`);
    }

    this.adapters.set(sourceType, adapter);

    // Create and cache metadata
    const metadata: AdapterMetadata = {
      name: adapter.name,
      version: adapter.version,
      sourceType: adapter.sourceType,
      description: this.generateDescription(adapter),
      capabilities: adapter.getCapabilities(),
    };

    this.metadata.set(sourceType, metadata);
  }

  /**
   * Unregister an adapter
   *
   * @param sourceType - Source type of adapter to unregister
   * @returns true if adapter was unregistered, false if not found
   */
  unregister(sourceType: SourceType): void {
    const adapter = this.adapters.get(sourceType);

    if (adapter) {
      // Shutdown adapter before removing
      adapter.shutdown().catch((error) => {
        console.warn(`Failed to shutdown adapter '${sourceType}':`, error);
      });

      this.adapters.delete(sourceType);
      this.metadata.delete(sourceType);
    }
  }

  /**
   * Get adapter by sourceType
   *
   * @param sourceType - Source type of adapter to retrieve
   * @returns Adapter instance or undefined if not found
   */
  get(sourceType: SourceType): DataSourceAdapter | undefined {
    return this.adapters.get(sourceType);
  }

  /**
   * Get all registered adapters
   *
   * @returns Array of all adapter instances
   */
  getAll(): DataSourceAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Check if adapter is registered
   *
   * @param sourceType - Source type to check
   * @returns true if adapter exists, false otherwise
   */
  has(sourceType: SourceType): boolean {
    return this.adapters.has(sourceType);
  }

  /**
   * Get metadata for an adapter
   *
   * @param sourceType - Source type of adapter
   * @returns Adapter metadata or undefined if not found
   */
  getMetadata(sourceType: SourceType): AdapterMetadata | undefined {
    return this.metadata.get(sourceType);
  }

  /**
   * Get all adapter metadata
   *
   * @returns Array of all adapter metadata
   */
  getAllMetadata(): AdapterMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Get supported source types
   *
   * @returns Array of registered source types
   */
  getSupportedSourceTypes(): SourceType[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Shutdown all adapters
   *
   * Gracefully shuts down all registered adapters.
   * Useful for application cleanup.
   */
  async shutdownAll(): Promise<void> {
    const shutdownPromises = Array.from(this.adapters.values()).map((adapter) =>
      adapter.shutdown().catch((error) => {
        console.warn(`Failed to shutdown adapter '${adapter.sourceType}':`, error);
      })
    );

    await Promise.all(shutdownPromises);
  }

  /**
   * Clear all adapters from registry
   *
   * Note: Does NOT call shutdown() on adapters.
   * Use shutdownAll() before clear() for graceful cleanup.
   */
  clear(): void {
    this.adapters.clear();
    this.metadata.clear();
  }

  /**
   * Generate description for adapter based on capabilities
   *
   * @param adapter - Adapter instance
   * @returns Human-readable description
   */
  private generateDescription(adapter: DataSourceAdapter): string {
    const capabilities = adapter.getCapabilities();
    const features: string[] = [];

    if (capabilities.supportsCollections) features.push('collections');
    if (capabilities.supportsDirectContent) features.push('direct content');
    if (capabilities.supportsSearch) features.push('search');
    if (capabilities.supportsIncrementalSync) features.push('incremental sync');

    const featuresStr = features.length > 0 ? ` (${features.join(', ')})` : '';

    return `${adapter.name} adapter v${adapter.version}${featuresStr}`;
  }
}

/**
 * Get global adapter registry instance
 *
 * Convenience function for accessing the singleton registry.
 *
 * @returns Global AdapterRegistry instance
 */
export function getAdapterRegistry(): AdapterRegistry {
  return AdapterRegistry.getInstance();
}

export default AdapterRegistry;
