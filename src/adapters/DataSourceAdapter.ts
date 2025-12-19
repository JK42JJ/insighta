/**
 * DataSourceAdapter Interface
 *
 * Universal adapter pattern for integrating multiple content sources
 * (YouTube, Notion, LinkedIn, Files, Google Drive, etc.)
 *
 * Design Principles:
 * - Source-agnostic: All adapters implement the same interface
 * - Type-safe: Leverage TypeScript for compile-time validation
 * - Extensible: Easy to add new data sources via plugin system
 * - Fault-tolerant: Graceful degradation with health checks
 *
 * @version 1.0.0
 * @since 2025-12-17
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Supported data source types
 */
export type SourceType =
  | 'youtube'
  | 'notion'
  | 'linkedin'
  | 'file'
  | 'google_drive'
  | 'vimeo'
  | 'spotify'
  | string; // Allow custom source types

/**
 * Content types across all sources
 */
export type ContentType =
  | 'video'        // YouTube videos, Vimeo videos
  | 'article'      // Notion pages, LinkedIn posts, Medium articles
  | 'document'     // Google Docs, PDF files, Markdown files
  | 'note'         // Notion databases, text files
  | 'audio'        // Spotify tracks, podcasts
  | 'image'        // Image files, galleries
  | 'playlist'     // YouTube playlists, Spotify playlists
  | string;        // Allow custom content types

/**
 * Sync status for collections and content items
 */
export enum SyncStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * Authentication result
 */
export interface AuthResult {
  success: boolean;
  credentials?: SourceCredentials;
  expiresAt?: Date;
  error?: string;
}

/**
 * Source-specific credentials (flexible structure)
 */
export interface SourceCredentials {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  [key: string]: any; // Allow source-specific fields
}

/**
 * Adapter configuration
 */
export interface AdapterConfig {
  sourceType: SourceType;
  credentials?: SourceCredentials;
  quotaLimit?: number;
  quotaCosts?: QuotaCostConfig;
  cacheEnabled?: boolean;
  cacheTTL?: number;
  rateLimitPerSecond?: number;
  [key: string]: any; // Allow source-specific config
}

/**
 * Quota cost configuration
 */
export interface QuotaCostConfig {
  collectionDetails: number;
  collectionItems: number;
  contentDetails: number;
  search: number;
  [key: string]: number; // Allow custom operation costs
}

// ============================================================================
// Collection Types (Playlists, Notion Databases, LinkedIn Profiles, etc.)
// ============================================================================

/**
 * Unified collection model (YouTube playlist, Notion database, folder, etc.)
 */
export interface Collection {
  // Source Information
  sourceId: string;           // YouTube playlist ID, Notion database ID, folder path
  sourceType: SourceType;
  sourceUrl?: string;         // Original URL

  // Metadata
  title: string;
  description?: string;
  creatorId?: string;         // Channel ID, user ID, author ID
  creatorName?: string;       // Channel title, username, author name
  thumbnailUrl?: string;

  // Stats
  itemCount: number;

  // Timestamps
  publishedAt?: Date;
  lastModifiedAt?: Date;

  // Source-specific metadata
  metadata?: Record<string, any>;
}

/**
 * Collection item (video in playlist, page in database, file in folder)
 */
export interface CollectionItem {
  sourceId: string;           // Video ID, page ID, file path
  sourceType: SourceType;
  position: number;           // Order within collection
  addedAt?: Date;

  // Reference to content item
  contentId?: string;         // Internal database ID (populated after fetch)

  // Source-specific metadata
  metadata?: Record<string, any>;
}

// ============================================================================
// Content Types (Videos, Articles, Documents, etc.)
// ============================================================================

/**
 * Unified content item model
 */
export interface ContentItem {
  // Source Information
  sourceId: string;           // YouTube video ID, Notion page ID, file path
  sourceType: SourceType;
  sourceUrl?: string;         // Original URL

  // Content
  title: string;
  description?: string;
  content?: string;           // Full text content (Markdown)
  contentType: ContentType;

  // Creator Information
  creatorId?: string;
  creatorName?: string;

  // Media
  thumbnailUrls?: {
    default?: string;
    medium?: string;
    high?: string;
    standard?: string;
    maxres?: string;
  };

  // Temporal Data
  duration?: number;          // seconds (for video/audio)
  publishedAt?: Date;
  lastModifiedAt?: Date;

  // Tags and Categorization
  tags?: string[];
  category?: string;
  language?: string;

  // Source-specific metadata (viewCount, likeCount, etc.)
  metadata?: Record<string, any>;
}

// ============================================================================
// Fetch and Sync Types
// ============================================================================

/**
 * Fetch options for paginated requests
 */
export interface FetchOptions {
  maxResults?: number;
  pageToken?: string;
  useCache?: boolean;
  filter?: Record<string, any>;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated fetch result
 */
export interface FetchResult<T> {
  items: T[];
  nextPageToken?: string;
  totalCount?: number;
  quotaCost?: number;
}

/**
 * Change detection result
 */
export interface ChangeSet {
  added: CollectionItem[];
  removed: CollectionItem[];
  modified: CollectionItem[];
  reordered: CollectionItem[];
  quotaCost?: number;
}

/**
 * Content schema definition (for each source)
 */
export interface ContentSchema {
  sourceType: SourceType;
  supportedContentTypes: ContentType[];
  requiredFields: string[];
  optionalFields: string[];
  metadataFields: Record<string, string>; // field name → description
}

/**
 * Source capabilities declaration
 */
export interface SourceCapabilities {
  // Core Features
  supportsCollections: boolean;     // Can fetch playlists/databases
  supportsDirectContent: boolean;   // Can fetch individual content items
  supportsSearch: boolean;          // Can search content

  // Sync Features
  supportsIncrementalSync: boolean; // Can detect changes since last sync
  supportsRealTimeSync: boolean;    // Can subscribe to real-time updates

  // Content Features
  supportsFullText: boolean;        // Can extract full text content
  supportsTranscripts: boolean;     // Can extract transcripts/captions
  supportsComments: boolean;        // Can fetch comments

  // Quota and Rate Limiting
  hasQuotaLimit: boolean;           // Has daily/monthly quota limits
  hasRateLimit: boolean;            // Has requests-per-second limits
  quotaLimit?: number;
  rateLimitPerSecond?: number;
}

/**
 * Health check result
 */
export interface HealthStatus {
  healthy: boolean;
  authenticated: boolean;
  quotaRemaining?: number;
  quotaLimit?: number;
  lastChecked: Date;
  error?: string;
}

// ============================================================================
// DataSourceAdapter Interface
// ============================================================================

/**
 * Universal adapter interface for all data sources
 *
 * Implementation Guidelines:
 * - All methods should be async
 * - Throw AdapterError for adapter-specific errors
 * - Use quota management where applicable
 * - Implement caching strategies for expensive operations
 * - Support graceful degradation (e.g., return partial data if API fails)
 *
 * @example
 * ```typescript
 * const youtubeAdapter = new YouTubeAdapter(config);
 * await youtubeAdapter.initialize();
 *
 * const collection = await youtubeAdapter.fetchCollection('PLrAXtmErZgOe...');
 * const items = await youtubeAdapter.fetchCollectionItems('PLrAXtmErZgOe...');
 * ```
 */
export interface DataSourceAdapter {
  // ============================================================================
  // Adapter Metadata
  // ============================================================================

  /**
   * Adapter name (e.g., 'youtube', 'notion', 'linkedin')
   */
  readonly name: string;

  /**
   * Adapter version (semantic versioning)
   */
  readonly version: string;

  /**
   * Source type this adapter handles
   */
  readonly sourceType: SourceType;

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  /**
   * Initialize adapter with configuration
   *
   * @param config - Adapter configuration
   * @throws AdapterError if initialization fails
   */
  initialize(config: AdapterConfig): Promise<void>;

  /**
   * Shutdown adapter and cleanup resources
   */
  shutdown(): Promise<void>;

  // ============================================================================
  // Authentication
  // ============================================================================

  /**
   * Generate authentication URL for OAuth flow
   *
   * @returns Authorization URL to redirect user
   * @throws AdapterError if OAuth is not supported
   */
  getAuthUrl?(): string;

  /**
   * Authenticate with credentials
   *
   * @param credentials - Source-specific credentials
   * @returns Authentication result with token info
   * @throws AdapterError if authentication fails
   */
  authenticate(credentials: SourceCredentials): Promise<AuthResult>;

  /**
   * Refresh expired access token
   *
   * @returns New authentication result
   * @throws AdapterError if refresh fails
   */
  refreshAuth(): Promise<AuthResult>;

  /**
   * Set credentials after successful authentication
   *
   * @param credentials - Credentials to store
   */
  setCredentials(credentials: SourceCredentials): void;

  // ============================================================================
  // Collection Operations
  // ============================================================================

  /**
   * Fetch collection metadata (playlist, database, folder)
   *
   * @param collectionId - Source-specific collection ID
   * @param options - Fetch options (caching, etc.)
   * @returns Collection metadata
   * @throws AdapterError if collection not found or fetch fails
   */
  fetchCollection(
    collectionId: string,
    options?: FetchOptions
  ): Promise<Collection>;

  /**
   * Fetch collection items (paginated)
   *
   * @param collectionId - Source-specific collection ID
   * @param options - Fetch options (pagination, caching, etc.)
   * @returns Paginated collection items
   * @throws AdapterError if fetch fails
   */
  fetchCollectionItems(
    collectionId: string,
    options?: FetchOptions
  ): Promise<FetchResult<CollectionItem>>;

  /**
   * Detect changes in collection since last sync
   *
   * @param collectionId - Source-specific collection ID
   * @param since - Timestamp of last sync
   * @returns Change set with added/removed/modified items
   * @throws AdapterError if change detection not supported or fails
   */
  detectCollectionChanges?(
    collectionId: string,
    since: Date
  ): Promise<ChangeSet>;

  // ============================================================================
  // Content Operations
  // ============================================================================

  /**
   * Fetch single content item by ID
   *
   * @param contentId - Source-specific content ID
   * @param options - Fetch options (caching, etc.)
   * @returns Content item metadata
   * @throws AdapterError if content not found or fetch fails
   */
  fetchContentItem(
    contentId: string,
    options?: FetchOptions
  ): Promise<ContentItem>;

  /**
   * Fetch multiple content items in batch
   *
   * @param contentIds - Array of source-specific content IDs
   * @param options - Fetch options
   * @returns Array of content items (may be partial if some IDs fail)
   * @throws AdapterError if batch fetch fails
   */
  fetchContentItemsBatch(
    contentIds: string[],
    options?: FetchOptions
  ): Promise<ContentItem[]>;

  /**
   * Search content items
   *
   * @param query - Search query string
   * @param options - Search options (filters, pagination, etc.)
   * @returns Paginated search results
   * @throws AdapterError if search not supported or fails
   */
  searchContent?(
    query: string,
    options?: FetchOptions
  ): Promise<FetchResult<ContentItem>>;

  // ============================================================================
  // URL Extraction
  // ============================================================================

  /**
   * Extract collection ID from source URL
   *
   * @param url - Source URL (YouTube playlist URL, Notion page URL, etc.)
   * @returns Extracted collection ID
   * @throws AdapterError if URL format is invalid
   *
   * @example
   * YouTubeAdapter: 'https://youtube.com/playlist?list=PLxxx' → 'PLxxx'
   * NotionAdapter: 'https://notion.so/workspace/abc123' → 'abc123'
   */
  extractCollectionId(url: string): string;

  /**
   * Extract content ID from source URL
   *
   * @param url - Source URL
   * @returns Extracted content ID
   * @throws AdapterError if URL format is invalid
   */
  extractContentId?(url: string): string;

  // ============================================================================
  // Schema and Capabilities
  // ============================================================================

  /**
   * Get content schema definition for this source
   *
   * @returns Content schema with supported fields
   */
  getSchema(): ContentSchema;

  /**
   * Get adapter capabilities
   *
   * @returns Capabilities declaration
   */
  getCapabilities(): SourceCapabilities;

  // ============================================================================
  // Health and Monitoring
  // ============================================================================

  /**
   * Check adapter health status
   *
   * @returns Health status with quota info
   */
  healthCheck(): Promise<HealthStatus>;

  /**
   * Get quota usage statistics
   *
   * @returns Current quota usage info
   */
  getQuotaUsage?(): Promise<{
    used: number;
    limit: number;
    remaining: number;
    resetAt?: Date;
  }>;
}

// ============================================================================
// Adapter Factory
// ============================================================================

/**
 * Adapter factory for creating data source adapters
 *
 * @example
 * ```typescript
 * const adapter = createAdapter('youtube', config);
 * await adapter.initialize();
 * ```
 */
export type AdapterFactory = (
  sourceType: SourceType,
  config: AdapterConfig
) => DataSourceAdapter;

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Adapter-specific error codes
 */
export enum AdapterErrorCode {
  // Authentication
  AUTH_FAILED = 'AUTH_FAILED',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',

  // Data Access
  NOT_FOUND = 'NOT_FOUND',
  ACCESS_DENIED = 'ACCESS_DENIED',

  // Quota and Rate Limiting
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  RATE_LIMITED = 'RATE_LIMITED',

  // Network
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',

  // Validation
  INVALID_INPUT = 'INVALID_INPUT',
  INVALID_URL = 'INVALID_URL',

  // Operations
  OPERATION_NOT_SUPPORTED = 'OPERATION_NOT_SUPPORTED',
  SYNC_FAILED = 'SYNC_FAILED',

  // Internal
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Adapter error class
 */
export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    public readonly sourceType?: SourceType,
    public override readonly cause?: Error,
    public readonly metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'AdapterError';

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AdapterError);
    }
  }
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Adapter registry for managing multiple adapters
 */
export interface AdapterRegistry {
  register(adapter: DataSourceAdapter): void;
  unregister(sourceType: SourceType): void;
  get(sourceType: SourceType): DataSourceAdapter | undefined;
  getAll(): DataSourceAdapter[];
  has(sourceType: SourceType): boolean;
}

/**
 * Adapter metadata for discovery and management
 */
export interface AdapterMetadata {
  name: string;
  version: string;
  sourceType: SourceType;
  description: string;
  author?: string;
  homepage?: string;
  capabilities: SourceCapabilities;
}
