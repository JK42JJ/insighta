/**
 * BaseFileAdapter - Base class for file-based adapters (Markdown, PDF, DOCX, etc.)
 *
 * Provides file-specific functionality including:
 * - File reading and parsing
 * - Metadata extraction
 * - Directory scanning
 * - File watching (optional)
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
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Parsed file content
 */
export interface ParsedFile {
  title: string;
  content: string;
  metadata: FileMetadata;
}

/**
 * File metadata
 */
export interface FileMetadata {
  filename: string;
  extension: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
  path: string;
  frontmatter?: Record<string, unknown>;
  headings?: string[];
  wordCount?: number;
}

/**
 * File adapter configuration
 */
export interface FileConfig extends AdapterConfig {
  basePath?: string;
  extensions?: string[];
  recursive?: boolean;
  ignorePatterns?: string[];
}

/**
 * Abstract base class for file adapters
 */
export abstract class BaseFileAdapter extends BaseAdapter {
  protected basePath: string | null = null;
  protected extensions: string[] = [];
  protected recursive = true;
  protected ignorePatterns: string[] = ['node_modules', '.git', '.DS_Store'];

  // ============================================================================
  // Abstract Methods (File-specific)
  // ============================================================================

  /**
   * Supported file extensions for this adapter
   */
  abstract getSupportedExtensions(): string[];

  /**
   * Parse file content
   */
  abstract parseFile(content: Buffer, filename: string): Promise<ParsedFile>;

  /**
   * Extract title from file content
   */
  abstract extractTitle(content: string, filename: string): string;

  // ============================================================================
  // Lifecycle
  // ============================================================================

  protected override async onInitialize(config: AdapterConfig): Promise<void> {
    const fileConfig = config as FileConfig;

    if (fileConfig.basePath) {
      this.basePath = fileConfig.basePath;
    }

    this.extensions = fileConfig.extensions ?? this.getSupportedExtensions();
    this.recursive = fileConfig.recursive ?? true;

    if (fileConfig.ignorePatterns) {
      this.ignorePatterns = [
        ...this.ignorePatterns,
        ...fileConfig.ignorePatterns,
      ];
    }

    await super.onInitialize(config);
  }

  // ============================================================================
  // Collection Operations (Directory = Collection)
  // ============================================================================

  async fetchCollection(
    collectionId: string,
    _options?: FetchOptions
  ): Promise<Collection> {
    this.ensureInitialized();

    const dirPath = this.resolvePath(collectionId);
    await this.ensurePathExists(dirPath);

    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      throw this.createError(
        AdapterErrorCode.INVALID_INPUT,
        `Path is not a directory: ${dirPath}`
      );
    }

    const files = await this.scanDirectory(dirPath);

    return {
      sourceId: collectionId,
      sourceType: this.sourceType,
      sourceUrl: `file://${dirPath}`,
      title: path.basename(dirPath),
      description: `Directory containing ${files.length} ${this.sourceType} files`,
      itemCount: files.length,
      lastModifiedAt: stats.mtime,
      metadata: {
        path: dirPath,
        extensions: this.extensions,
      },
    };
  }

  async fetchCollectionItems(
    collectionId: string,
    options?: FetchOptions
  ): Promise<FetchResult<CollectionItem>> {
    this.ensureInitialized();

    const dirPath = this.resolvePath(collectionId);
    const files = await this.scanDirectory(dirPath);

    const maxResults = options?.maxResults ?? files.length;
    const items: CollectionItem[] = files.slice(0, maxResults).map((file, index) => ({
      sourceId: file,
      sourceType: this.sourceType,
      position: index,
      metadata: {
        path: file,
        filename: path.basename(file),
      },
    }));

    return {
      items,
      totalCount: files.length,
    };
  }

  // ============================================================================
  // Content Operations
  // ============================================================================

  async fetchContentItem(
    contentId: string,
    _options?: FetchOptions
  ): Promise<ContentItem> {
    this.ensureInitialized();

    const filePath = this.resolvePath(contentId);
    await this.ensurePathExists(filePath);

    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw this.createError(
        AdapterErrorCode.INVALID_INPUT,
        `Path is not a file: ${filePath}`
      );
    }

    const content = await fs.readFile(filePath);
    const parsed = await this.parseFile(content, path.basename(filePath));

    return {
      sourceId: contentId,
      sourceType: this.sourceType,
      sourceUrl: `file://${filePath}`,
      title: parsed.title,
      content: parsed.content,
      contentType: 'document',
      publishedAt: parsed.metadata.createdAt,
      lastModifiedAt: parsed.metadata.modifiedAt,
      metadata: {
        ...parsed.metadata,
        size: stats.size,
      },
    };
  }

  async fetchContentItemsBatch(
    contentIds: string[],
    options?: FetchOptions
  ): Promise<ContentItem[]> {
    const results: ContentItem[] = [];

    for (const contentId of contentIds) {
      try {
        const item = await this.fetchContentItem(contentId, options);
        results.push(item);
      } catch (error) {
        // Log error but continue with other files
        console.warn(`Failed to fetch file: ${contentId}`, error);
      }
    }

    return results;
  }

  // ============================================================================
  // URL Extraction
  // ============================================================================

  extractCollectionId(url: string): string {
    // Handle file:// URLs
    if (url.startsWith('file://')) {
      return url.slice(7);
    }
    // Assume it's a path
    return url;
  }

  extractContentId?(url: string): string {
    return this.extractCollectionId(url);
  }

  // ============================================================================
  // Schema & Capabilities
  // ============================================================================

  getSchema(): ContentSchema {
    return {
      sourceType: this.sourceType,
      supportedContentTypes: ['document'],
      requiredFields: ['title', 'content'],
      optionalFields: ['description', 'tags', 'category'],
      metadataFields: {
        filename: 'Original filename',
        extension: 'File extension',
        size: 'File size in bytes',
        path: 'Absolute file path',
        wordCount: 'Word count',
        frontmatter: 'YAML/TOML frontmatter',
      },
    };
  }

  getCapabilities(): SourceCapabilities {
    return {
      supportsCollections: true,
      supportsDirectContent: true,
      supportsSearch: false,
      supportsIncrementalSync: true,
      supportsRealTimeSync: false, // Could be true with file watcher
      supportsFullText: true,
      supportsTranscripts: false,
      supportsComments: false,
      hasQuotaLimit: false,
      hasRateLimit: false,
    };
  }

  // ============================================================================
  // Directory Scanning
  // ============================================================================

  /**
   * Scan directory for supported files
   */
  protected async scanDirectory(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // Skip ignored patterns
      if (this.shouldIgnore(entry.name)) {
        continue;
      }

      if (entry.isDirectory() && this.recursive) {
        const subFiles = await this.scanDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && this.isSupportedFile(entry.name)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Check if file has supported extension
   */
  protected isSupportedFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return this.extensions.includes(ext);
  }

  /**
   * Check if path should be ignored
   */
  protected shouldIgnore(name: string): boolean {
    return this.ignorePatterns.some(
      (pattern) => name === pattern || name.startsWith(pattern)
    );
  }

  // ============================================================================
  // Path Helpers
  // ============================================================================

  /**
   * Resolve path relative to base path
   */
  protected resolvePath(inputPath: string): string {
    if (path.isAbsolute(inputPath)) {
      return inputPath;
    }
    if (this.basePath) {
      return path.join(this.basePath, inputPath);
    }
    return path.resolve(inputPath);
  }

  /**
   * Ensure path exists
   */
  protected async ensurePathExists(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      throw this.createError(
        AdapterErrorCode.NOT_FOUND,
        `Path not found: ${filePath}`
      );
    }
  }

  /**
   * Get file stats
   */
  protected async getFileStats(filePath: string): Promise<FileMetadata> {
    const stats = await fs.stat(filePath);
    const filename = path.basename(filePath);

    return {
      filename,
      extension: path.extname(filename).toLowerCase(),
      size: stats.size,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
      path: filePath,
    };
  }
}

export default BaseFileAdapter;
