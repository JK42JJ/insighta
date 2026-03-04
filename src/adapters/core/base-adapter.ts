/**
 * BaseAdapter - Abstract base class for all data source adapters
 *
 * Provides common functionality for lifecycle management, error handling,
 * caching, and quota tracking that all adapters can inherit.
 *
 * @version 1.0.0
 * @since 2025-12-22
 */

import {
  DataSourceAdapter,
  AdapterConfig,
  AdapterInfo,
  SourceType,
  SourceCredentials,
  AuthResult,
  Collection,
  CollectionItem,
  ContentItem,
  FetchOptions,
  FetchResult,
  ContentSchema,
  SourceCapabilities,
  HealthStatus,
  AdapterError,
  AdapterErrorCode,
} from '../DataSourceAdapter';

/**
 * Abstract base adapter with common functionality
 */
export abstract class BaseAdapter implements DataSourceAdapter {
  // ============================================================================
  // Abstract Properties (must be implemented by subclasses)
  // ============================================================================

  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly sourceType: SourceType;

  /**
   * Adapter metadata for UI and discovery
   */
  abstract getAdapterInfo(): AdapterInfo;

  // ============================================================================
  // Protected Properties
  // ============================================================================

  protected config: AdapterConfig | null = null;
  protected credentials: SourceCredentials | null = null;
  protected initialized = false;

  // Cache management
  protected cache: Map<string, { data: unknown; expiresAt: Date }> = new Map();
  protected cacheTTL = 300000; // 5 minutes default

  // Quota tracking
  protected quotaUsed = 0;
  protected quotaLimit = 10000;

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  async initialize(config: AdapterConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.config = config;
    this.cacheTTL = config.cacheTTL ?? this.cacheTTL;
    this.quotaLimit = config.quotaLimit ?? this.quotaLimit;

    if (config.credentials) {
      this.credentials = config.credentials;
    }

    await this.onInitialize(config);
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    await this.onShutdown();
    this.cache.clear();
    this.initialized = false;
  }

  /**
   * Hook for subclass initialization logic
   */
  protected async onInitialize(_config: AdapterConfig): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Hook for subclass shutdown logic
   */
  protected async onShutdown(): Promise<void> {
    // Override in subclass if needed
  }

  // ============================================================================
  // Authentication (default implementations)
  // ============================================================================

  getAuthUrl?(): string {
    throw new AdapterError(
      AdapterErrorCode.OPERATION_NOT_SUPPORTED,
      'OAuth authentication not supported by this adapter',
      this.sourceType
    );
  }

  async authenticate(credentials: SourceCredentials): Promise<AuthResult> {
    this.credentials = credentials;
    return { success: true, credentials };
  }

  async refreshAuth(): Promise<AuthResult> {
    if (!this.credentials) {
      return {
        success: false,
        error: 'No credentials available to refresh',
      };
    }
    return { success: true, credentials: this.credentials };
  }

  setCredentials(credentials: SourceCredentials): void {
    this.credentials = credentials;
  }

  // ============================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ============================================================================

  abstract fetchCollection(
    collectionId: string,
    options?: FetchOptions
  ): Promise<Collection>;

  abstract fetchCollectionItems(
    collectionId: string,
    options?: FetchOptions
  ): Promise<FetchResult<CollectionItem>>;

  abstract fetchContentItem(
    contentId: string,
    options?: FetchOptions
  ): Promise<ContentItem>;

  abstract fetchContentItemsBatch(
    contentIds: string[],
    options?: FetchOptions
  ): Promise<ContentItem[]>;

  abstract extractCollectionId(url: string): string;

  abstract getSchema(): ContentSchema;

  abstract getCapabilities(): SourceCapabilities;

  // ============================================================================
  // Health Check (default implementation)
  // ============================================================================

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: this.initialized,
      authenticated: !!this.credentials,
      quotaRemaining: this.quotaLimit - this.quotaUsed,
      quotaLimit: this.quotaLimit,
      lastChecked: new Date(),
    };
  }

  async getQuotaUsage(): Promise<{
    used: number;
    limit: number;
    remaining: number;
    resetAt?: Date;
  }> {
    return {
      used: this.quotaUsed,
      limit: this.quotaLimit,
      remaining: this.quotaLimit - this.quotaUsed,
    };
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  protected getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (new Date() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  protected setCache<T>(key: string, data: T, ttl?: number): void {
    const expiresAt = new Date(Date.now() + (ttl ?? this.cacheTTL));
    this.cache.set(key, { data, expiresAt });
  }

  protected clearCache(): void {
    this.cache.clear();
  }

  // ============================================================================
  // Quota Management
  // ============================================================================

  protected addQuotaCost(cost: number): void {
    this.quotaUsed += cost;
  }

  protected checkQuota(requiredCost: number): void {
    if (this.quotaUsed + requiredCost > this.quotaLimit) {
      throw new AdapterError(
        AdapterErrorCode.QUOTA_EXCEEDED,
        `Quota exceeded: ${this.quotaUsed}/${this.quotaLimit} used, need ${requiredCost}`,
        this.sourceType
      );
    }
  }

  // ============================================================================
  // Error Handling Helpers
  // ============================================================================

  protected createError(
    code: AdapterErrorCode,
    message: string,
    cause?: Error,
    metadata?: Record<string, unknown>
  ): AdapterError {
    return new AdapterError(code, message, this.sourceType, cause, metadata);
  }

  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw this.createError(
        AdapterErrorCode.INTERNAL_ERROR,
        'Adapter not initialized. Call initialize() first.'
      );
    }
  }

  protected ensureAuthenticated(): void {
    if (!this.credentials) {
      throw this.createError(
        AdapterErrorCode.AUTH_FAILED,
        'Not authenticated. Call authenticate() first.'
      );
    }
  }
}

export default BaseAdapter;
