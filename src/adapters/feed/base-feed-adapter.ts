/**
 * BaseFeedAdapter - Base class for feed-based adapters (RSS, Atom, etc.)
 *
 * Provides feed-specific functionality including:
 * - Feed URL validation and parsing
 * - Content extraction and normalization
 * - Polling and update detection
 *
 * @version 1.0.0
 * @since 2025-12-22
 */

import { BaseAdapter } from '../core/base-adapter';
import {
  AdapterConfig,
  Collection,
  CollectionItem,
  ContentItem,
  FetchOptions,
  FetchResult,
  ContentSchema,
  SourceCapabilities,
  AdapterErrorCode,
} from '../DataSourceAdapter';

/**
 * Feed item from parsed feed
 */
export interface FeedItem {
  id: string;
  title: string;
  link: string;
  description?: string;
  content?: string;
  pubDate?: Date;
  author?: string;
  categories?: string[];
  enclosure?: {
    url: string;
    type: string;
    length?: number;
  };
}

/**
 * Parsed feed metadata
 */
export interface ParsedFeed {
  title: string;
  description?: string;
  link: string;
  language?: string;
  lastBuildDate?: Date;
  items: FeedItem[];
}

/**
 * Feed adapter configuration
 */
export interface FeedConfig extends AdapterConfig {
  feedUrl: string;
  refreshInterval?: number; // milliseconds
  maxItems?: number;
}

/**
 * Abstract base class for feed adapters
 */
export abstract class BaseFeedAdapter extends BaseAdapter {
  protected feedUrl: string | null = null;
  protected lastFetchedAt: Date | null = null;
  protected refreshInterval = 3600000; // 1 hour default

  // ============================================================================
  // Abstract Methods (Feed-specific)
  // ============================================================================

  /**
   * Parse raw feed content into structured format
   */
  abstract parseFeed(content: string): Promise<ParsedFeed>;

  /**
   * Convert feed item to ContentItem
   */
  abstract mapFeedItemToContentItem(item: FeedItem): ContentItem;

  // ============================================================================
  // Lifecycle
  // ============================================================================

  protected override async onInitialize(config: AdapterConfig): Promise<void> {
    const feedConfig = config as FeedConfig;

    if (feedConfig.feedUrl) {
      this.feedUrl = feedConfig.feedUrl;
    }

    if (feedConfig.refreshInterval) {
      this.refreshInterval = feedConfig.refreshInterval;
    }

    await super.onInitialize(config);
  }

  // ============================================================================
  // Collection Operations
  // ============================================================================

  async fetchCollection(collectionId: string, options?: FetchOptions): Promise<Collection> {
    this.ensureInitialized();

    const feedUrl = collectionId || this.feedUrl;
    if (!feedUrl) {
      throw this.createError(AdapterErrorCode.INVALID_INPUT, 'No feed URL provided');
    }

    const feed = await this.fetchAndParseFeed(feedUrl, options);

    return {
      sourceId: feedUrl,
      sourceType: this.sourceType,
      sourceUrl: feed.link,
      title: feed.title,
      description: feed.description,
      itemCount: feed.items.length,
      lastModifiedAt: feed.lastBuildDate,
      metadata: {
        language: feed.language,
      },
    };
  }

  async fetchCollectionItems(
    collectionId: string,
    options?: FetchOptions
  ): Promise<FetchResult<CollectionItem>> {
    this.ensureInitialized();

    const feedUrl = collectionId || this.feedUrl;
    if (!feedUrl) {
      throw this.createError(AdapterErrorCode.INVALID_INPUT, 'No feed URL provided');
    }

    const feed = await this.fetchAndParseFeed(feedUrl, options);
    const maxResults = options?.maxResults ?? feed.items.length;

    const items: CollectionItem[] = feed.items.slice(0, maxResults).map((item, index) => ({
      sourceId: item.id || item.link,
      sourceType: this.sourceType,
      position: index,
      addedAt: item.pubDate,
      metadata: {
        title: item.title,
        link: item.link,
      },
    }));

    return {
      items,
      totalCount: feed.items.length,
    };
  }

  // ============================================================================
  // Content Operations
  // ============================================================================

  async fetchContentItem(contentId: string, options?: FetchOptions): Promise<ContentItem> {
    this.ensureInitialized();

    // For feeds, we need to fetch the whole feed and find the item
    const feedUrl = this.feedUrl;
    if (!feedUrl) {
      throw this.createError(AdapterErrorCode.INVALID_INPUT, 'No feed URL configured');
    }

    const feed = await this.fetchAndParseFeed(feedUrl, options);
    const item = feed.items.find((i) => i.id === contentId || i.link === contentId);

    if (!item) {
      throw this.createError(AdapterErrorCode.NOT_FOUND, `Item not found: ${contentId}`);
    }

    return this.mapFeedItemToContentItem(item);
  }

  async fetchContentItemsBatch(
    contentIds: string[],
    options?: FetchOptions
  ): Promise<ContentItem[]> {
    this.ensureInitialized();

    const feedUrl = this.feedUrl;
    if (!feedUrl) {
      throw this.createError(AdapterErrorCode.INVALID_INPUT, 'No feed URL configured');
    }

    const feed = await this.fetchAndParseFeed(feedUrl, options);
    const idSet = new Set(contentIds);

    return feed.items
      .filter((item) => idSet.has(item.id) || idSet.has(item.link))
      .map((item) => this.mapFeedItemToContentItem(item));
  }

  // ============================================================================
  // URL Extraction
  // ============================================================================

  extractCollectionId(url: string): string {
    // For feeds, the URL itself is the collection ID
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.href;
    } catch {
      throw this.createError(AdapterErrorCode.INVALID_URL, `Invalid feed URL: ${url}`);
    }
  }

  // ============================================================================
  // Schema & Capabilities
  // ============================================================================

  getSchema(): ContentSchema {
    return {
      sourceType: this.sourceType,
      supportedContentTypes: ['article'],
      requiredFields: ['title', 'sourceUrl'],
      optionalFields: ['description', 'content', 'publishedAt', 'tags'],
      metadataFields: {
        author: 'Article author',
        categories: 'Feed categories',
        enclosure: 'Media attachment',
      },
    };
  }

  getCapabilities(): SourceCapabilities {
    return {
      supportsCollections: true,
      supportsDirectContent: true,
      supportsSearch: false,
      supportsIncrementalSync: true,
      supportsRealTimeSync: false,
      supportsFullText: true,
      supportsTranscripts: false,
      supportsComments: false,
      hasQuotaLimit: false,
      hasRateLimit: true,
      rateLimitPerSecond: 1,
    };
  }

  // ============================================================================
  // Feed Fetching
  // ============================================================================

  /**
   * Fetch and parse feed from URL
   */
  protected async fetchAndParseFeed(feedUrl: string, options?: FetchOptions): Promise<ParsedFeed> {
    const cacheKey = `feed:${feedUrl}`;

    // Check cache
    if (options?.useCache !== false) {
      const cached = this.getCached<ParsedFeed>(cacheKey);
      if (cached) return cached;
    }

    // Fetch feed content
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Insighta/1.0 (+https://github.com/JK42JJ/insighta)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
    });

    if (!response.ok) {
      throw this.createError(
        AdapterErrorCode.NETWORK_ERROR,
        `Failed to fetch feed: ${response.status} ${response.statusText}`,
        undefined,
        { url: feedUrl, status: response.status }
      );
    }

    const content = await response.text();
    const feed = await this.parseFeed(content);

    // Cache result
    this.setCache(cacheKey, feed);
    this.lastFetchedAt = new Date();

    return feed;
  }

  /**
   * Check if feed needs refresh based on interval
   */
  protected needsRefresh(): boolean {
    if (!this.lastFetchedAt) return true;
    return Date.now() - this.lastFetchedAt.getTime() > this.refreshInterval;
  }
}

export default BaseFeedAdapter;
