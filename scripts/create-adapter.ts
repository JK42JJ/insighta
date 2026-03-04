#!/usr/bin/env npx tsx
/**
 * Adapter Scaffolding Script
 *
 * Generates boilerplate code for new adapters based on category:
 * - oauth: OAuth 2.0 based services (YouTube, Notion, Google Drive, LinkedIn)
 * - feed: Feed based services (RSS, Atom)
 * - file: File parsers (Markdown, PDF, DOCX, PPTX, TXT)
 *
 * Usage:
 *   npm run create:adapter -- --name rss --category feed
 *   npm run create:adapter -- --name pdf --category file
 *   npm run create:adapter -- --name notion --category oauth
 *
 * @version 1.0.0
 * @since 2025-12-22
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

type AdapterCategory = 'oauth' | 'feed' | 'file';

interface AdapterConfig {
  name: string;
  category: AdapterCategory;
  className: string;
  sourceType: string;
}

// =============================================================================
// Templates
// =============================================================================

const TEMPLATES = {
  // ---------------------------------------------------------------------------
  // OAuth Adapter Template
  // ---------------------------------------------------------------------------
  oauth: {
    'index.ts': (config: AdapterConfig) => `/**
 * ${config.className} - OAuth 2.0 based adapter for ${config.name}
 *
 * @version 1.0.0
 * @since ${new Date().toISOString().split('T')[0]}
 */

import { BaseOAuthAdapter, OAuthConfig, OAuthTokens } from '../../oauth/base-oauth-adapter';
import {
  AdapterInfo,
  Collection,
  CollectionItem,
  ContentItem,
  FetchOptions,
  FetchResult,
  ContentSchema,
  SourceCapabilities,
} from '../../DataSourceAdapter';

/**
 * ${config.className} implementation
 */
export class ${config.className} extends BaseOAuthAdapter {
  readonly name = '${config.name}';
  readonly version = '1.0.0';
  readonly sourceType = '${config.sourceType}';

  // ==========================================================================
  // Adapter Info
  // ==========================================================================

  getAdapterInfo(): AdapterInfo {
    return {
      id: '${config.sourceType}',
      name: '${config.className.replace('Adapter', '')}',
      description: '${config.name} integration adapter',
      icon: '${config.name}',
      category: 'oauth',
      authType: 'oauth2',
      supportedContentTypes: ['document'],
      configSchema: {
        type: 'object',
        properties: {
          // Add your configuration schema here
        },
        required: [],
      },
    };
  }

  // ==========================================================================
  // OAuth Configuration
  // ==========================================================================

  getOAuthConfig(): OAuthConfig {
    return {
      clientId: process.env.${config.name.toUpperCase()}_CLIENT_ID!,
      clientSecret: process.env.${config.name.toUpperCase()}_CLIENT_SECRET!,
      redirectUri: process.env.${config.name.toUpperCase()}_REDIRECT_URI!,
      scopes: [], // Add required scopes
      authorizationEndpoint: '', // Add authorization endpoint
      tokenEndpoint: '', // Add token endpoint
    };
  }

  async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    // TODO: Implement token exchange
    throw new Error('Not implemented');
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    // TODO: Implement token refresh
    throw new Error('Not implemented');
  }

  // ==========================================================================
  // Collection Operations
  // ==========================================================================

  async fetchCollection(
    collectionId: string,
    options?: FetchOptions
  ): Promise<Collection> {
    this.ensureInitialized();
    await this.ensureValidToken();

    // TODO: Implement collection fetching
    throw new Error('Not implemented');
  }

  async fetchCollectionItems(
    collectionId: string,
    options?: FetchOptions
  ): Promise<FetchResult<CollectionItem>> {
    this.ensureInitialized();
    await this.ensureValidToken();

    // TODO: Implement collection items fetching
    throw new Error('Not implemented');
  }

  // ==========================================================================
  // Content Operations
  // ==========================================================================

  async fetchContentItem(
    contentId: string,
    options?: FetchOptions
  ): Promise<ContentItem> {
    this.ensureInitialized();
    await this.ensureValidToken();

    // TODO: Implement content item fetching
    throw new Error('Not implemented');
  }

  async fetchContentItemsBatch(
    contentIds: string[],
    options?: FetchOptions
  ): Promise<ContentItem[]> {
    // TODO: Implement batch fetching
    return Promise.all(
      contentIds.map((id) => this.fetchContentItem(id, options))
    );
  }

  // ==========================================================================
  // URL Extraction
  // ==========================================================================

  extractCollectionId(url: string): string {
    // TODO: Implement URL parsing for collection ID
    throw new Error('Not implemented');
  }

  // ==========================================================================
  // Schema & Capabilities
  // ==========================================================================

  getSchema(): ContentSchema {
    return {
      sourceType: this.sourceType,
      supportedContentTypes: ['document'],
      requiredFields: ['title', 'content'],
      optionalFields: ['description', 'tags'],
      metadataFields: {},
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
      hasQuotaLimit: true,
      hasRateLimit: true,
    };
  }
}

export default ${config.className};
`,

    'types.ts': (config: AdapterConfig) => `/**
 * ${config.className} Types
 *
 * Source-specific type definitions for ${config.name} adapter.
 *
 * @version 1.0.0
 * @since ${new Date().toISOString().split('T')[0]}
 */

/**
 * ${config.name} API response types
 */
export interface ${config.className.replace('Adapter', '')}ApiResponse<T> {
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * ${config.name} collection type
 */
export interface ${config.className.replace('Adapter', '')}Collection {
  id: string;
  name: string;
  // Add more fields as needed
}

/**
 * ${config.name} item type
 */
export interface ${config.className.replace('Adapter', '')}Item {
  id: string;
  title: string;
  content?: string;
  // Add more fields as needed
}
`,

    '__tests__/index.test.ts': (config: AdapterConfig) => `/**
 * ${config.className} Tests
 *
 * Integration tests using MSW (Mock Service Worker).
 *
 * @version 1.0.0
 * @since ${new Date().toISOString().split('T')[0]}
 */

import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { ${config.className} } from '../index';

// =============================================================================
// Mock Data
// =============================================================================

const mockCollection = {
  id: 'test-collection-id',
  name: 'Test Collection',
};

const mockItems = [
  { id: 'item-1', title: 'Item 1' },
  { id: 'item-2', title: 'Item 2' },
];

// =============================================================================
// MSW Server Setup
// =============================================================================

const server = setupServer(
  // Add your API mock handlers here
  // http.get('https://api.${config.name}.com/...', () => {
  //   return HttpResponse.json(mockData);
  // }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// =============================================================================
// Tests
// =============================================================================

describe('${config.className}', () => {
  let adapter: ${config.className};

  beforeEach(async () => {
    adapter = new ${config.className}();
    // Mock environment variables
    process.env.${config.name.toUpperCase()}_CLIENT_ID = 'test-client-id';
    process.env.${config.name.toUpperCase()}_CLIENT_SECRET = 'test-client-secret';
    process.env.${config.name.toUpperCase()}_REDIRECT_URI = 'http://localhost:3000/callback';
  });

  afterEach(async () => {
    await adapter.shutdown();
  });

  describe('getAdapterInfo', () => {
    it('should return adapter info', () => {
      const info = adapter.getAdapterInfo();

      expect(info.id).toBe('${config.sourceType}');
      expect(info.category).toBe('oauth');
      expect(info.authType).toBe('oauth2');
    });
  });

  describe('getOAuthConfig', () => {
    it('should return OAuth configuration', async () => {
      await adapter.initialize({ sourceType: '${config.sourceType}' });
      const authUrl = adapter.getAuthUrl();

      expect(authUrl).toContain('client_id=test-client-id');
    });
  });

  // Add more tests as you implement the adapter
  describe.skip('fetchCollection', () => {
    it('should fetch collection', async () => {
      // TODO: Implement test when adapter is complete
    });
  });

  describe.skip('fetchContentItem', () => {
    it('should fetch content item', async () => {
      // TODO: Implement test when adapter is complete
    });
  });
});
`,
  },

  // ---------------------------------------------------------------------------
  // Feed Adapter Template
  // ---------------------------------------------------------------------------
  feed: {
    'index.ts': (config: AdapterConfig) => `/**
 * ${config.className} - Feed based adapter for ${config.name}
 *
 * @version 1.0.0
 * @since ${new Date().toISOString().split('T')[0]}
 */

import { BaseFeedAdapter, ParsedFeed, FeedItem } from '../../feed/base-feed-adapter';
import {
  AdapterInfo,
  ContentItem,
  ContentSchema,
  SourceCapabilities,
} from '../../DataSourceAdapter';

/**
 * ${config.className} implementation
 */
export class ${config.className} extends BaseFeedAdapter {
  readonly name = '${config.name}';
  readonly version = '1.0.0';
  readonly sourceType = '${config.sourceType}';

  // ==========================================================================
  // Adapter Info
  // ==========================================================================

  getAdapterInfo(): AdapterInfo {
    return {
      id: '${config.sourceType}',
      name: '${config.className.replace('Adapter', '')}',
      description: '${config.name} feed adapter',
      icon: 'rss',
      category: 'feed',
      authType: 'none',
      supportedContentTypes: ['article'],
      configSchema: {
        type: 'object',
        properties: {
          feedUrl: {
            type: 'string',
            format: 'uri',
            title: 'Feed URL',
            description: 'URL of the ${config.name} feed',
          },
          refreshInterval: {
            type: 'number',
            title: 'Refresh Interval',
            description: 'Refresh interval in seconds',
            default: 3600,
            minimum: 60,
          },
        },
        required: ['feedUrl'],
      },
    };
  }

  // ==========================================================================
  // Feed Parsing
  // ==========================================================================

  async parseFeed(content: string): Promise<ParsedFeed> {
    // TODO: Implement feed parsing (use rss-parser or similar)
    // Example with rss-parser:
    // const parser = new Parser();
    // const feed = await parser.parseString(content);

    throw new Error('Not implemented - install rss-parser and implement');
  }

  mapFeedItemToContentItem(item: FeedItem): ContentItem {
    return {
      sourceId: item.id || item.link,
      sourceType: this.sourceType,
      sourceUrl: item.link,
      title: item.title,
      content: item.content || item.description || '',
      contentType: 'article',
      publishedAt: item.pubDate,
      metadata: {
        author: item.author,
        categories: item.categories,
        enclosure: item.enclosure,
      },
    };
  }

  // ==========================================================================
  // Schema & Capabilities (Override if needed)
  // ==========================================================================

  override getSchema(): ContentSchema {
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

  override getCapabilities(): SourceCapabilities {
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
}

export default ${config.className};
`,

    'types.ts': (config: AdapterConfig) => `/**
 * ${config.className} Types
 *
 * Source-specific type definitions for ${config.name} adapter.
 *
 * @version 1.0.0
 * @since ${new Date().toISOString().split('T')[0]}
 */

/**
 * Extended feed item with ${config.name}-specific fields
 */
export interface Extended${config.className.replace('Adapter', '')}Item {
  guid?: string;
  creator?: string;
  isoDate?: string;
  contentSnippet?: string;
  // Add more fields as needed
}

/**
 * Feed configuration
 */
export interface ${config.className.replace('Adapter', '')}Config {
  feedUrl: string;
  refreshInterval?: number;
  maxItems?: number;
}
`,

    '__tests__/index.test.ts': (config: AdapterConfig) => `/**
 * ${config.className} Tests
 *
 * Integration tests using MSW (Mock Service Worker).
 *
 * @version 1.0.0
 * @since ${new Date().toISOString().split('T')[0]}
 */

import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { ${config.className} } from '../index';

// =============================================================================
// Mock Data
// =============================================================================

const mockFeed = \`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>A test feed</description>
    <item>
      <title>Test Article 1</title>
      <link>https://example.com/article-1</link>
      <description>Test description 1</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Test Article 2</title>
      <link>https://example.com/article-2</link>
      <description>Test description 2</description>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>\`;

// =============================================================================
// MSW Server Setup
// =============================================================================

const server = setupServer(
  http.get('https://example.com/feed.xml', () => {
    return new HttpResponse(mockFeed, {
      headers: { 'Content-Type': 'application/xml' },
    });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// =============================================================================
// Tests
// =============================================================================

describe('${config.className}', () => {
  let adapter: ${config.className};

  beforeEach(async () => {
    adapter = new ${config.className}();
  });

  afterEach(async () => {
    await adapter.shutdown();
  });

  describe('getAdapterInfo', () => {
    it('should return adapter info', () => {
      const info = adapter.getAdapterInfo();

      expect(info.id).toBe('${config.sourceType}');
      expect(info.category).toBe('feed');
      expect(info.authType).toBe('none');
    });

    it('should have valid config schema', () => {
      const info = adapter.getAdapterInfo();

      expect(info.configSchema).toBeDefined();
      expect(info.configSchema?.properties?.feedUrl).toBeDefined();
    });
  });

  describe('extractCollectionId', () => {
    it('should extract feed URL from valid URL', () => {
      const url = 'https://example.com/feed.xml';
      const id = adapter.extractCollectionId(url);

      expect(id).toBe(url);
    });
  });

  // Add more tests as you implement the adapter
  describe.skip('fetchCollection', () => {
    it('should fetch and parse feed', async () => {
      await adapter.initialize({
        sourceType: '${config.sourceType}',
        feedUrl: 'https://example.com/feed.xml',
      });

      const collection = await adapter.fetchCollection('https://example.com/feed.xml');

      expect(collection.title).toBe('Test Feed');
      expect(collection.itemCount).toBe(2);
    });
  });
});
`,
  },

  // ---------------------------------------------------------------------------
  // File Adapter Template
  // ---------------------------------------------------------------------------
  file: {
    'index.ts': (config: AdapterConfig) => `/**
 * ${config.className} - File parser adapter for ${config.name} files
 *
 * @version 1.0.0
 * @since ${new Date().toISOString().split('T')[0]}
 */

import { BaseFileAdapter, ParsedFile, FileMetadata } from '../../file/base-file-adapter';
import {
  AdapterInfo,
  ContentSchema,
  SourceCapabilities,
} from '../../DataSourceAdapter';

/**
 * ${config.className} implementation
 */
export class ${config.className} extends BaseFileAdapter {
  readonly name = '${config.name}';
  readonly version = '1.0.0';
  readonly sourceType = '${config.sourceType}';

  // ==========================================================================
  // Adapter Info
  // ==========================================================================

  getAdapterInfo(): AdapterInfo {
    return {
      id: '${config.sourceType}',
      name: '${config.className.replace('Adapter', '')}',
      description: '${config.name} file parser',
      icon: 'file-text',
      category: 'file',
      authType: 'none',
      supportedContentTypes: ['document'],
      configSchema: {
        type: 'object',
        properties: {
          basePath: {
            type: 'string',
            title: 'Base Path',
            description: 'Base directory for ${config.name} files',
          },
          recursive: {
            type: 'boolean',
            title: 'Recursive',
            description: 'Scan subdirectories',
            default: true,
          },
        },
        required: [],
      },
    };
  }

  // ==========================================================================
  // File Operations
  // ==========================================================================

  getSupportedExtensions(): string[] {
    // TODO: Add supported file extensions
    return ['.${config.name}'];
  }

  async parseFile(content: Buffer, filename: string): Promise<ParsedFile> {
    const text = content.toString('utf-8');
    const metadata = await this.getFileStats(filename);

    // TODO: Implement file parsing logic
    // For text-based formats, you might extract:
    // - Title from first heading or filename
    // - Frontmatter/metadata
    // - Main content

    return {
      title: this.extractTitle(text, filename),
      content: text,
      metadata: {
        ...metadata,
        wordCount: text.split(/\\s+/).length,
      },
    };
  }

  extractTitle(content: string, filename: string): string {
    // TODO: Implement title extraction logic
    // Common patterns:
    // - First heading (# Title for Markdown)
    // - Frontmatter title
    // - Filename without extension

    // Default: use filename without extension
    const ext = this.getSupportedExtensions().find((e) =>
      filename.toLowerCase().endsWith(e)
    );
    return ext ? filename.slice(0, -ext.length) : filename;
  }

  // ==========================================================================
  // Schema & Capabilities (Override if needed)
  // ==========================================================================

  override getSchema(): ContentSchema {
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
      },
    };
  }

  override getCapabilities(): SourceCapabilities {
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
      hasRateLimit: false,
    };
  }
}

export default ${config.className};
`,

    'parser.ts': (config: AdapterConfig) => `/**
 * ${config.className} Parser
 *
 * Parsing utilities for ${config.name} files.
 *
 * @version 1.0.0
 * @since ${new Date().toISOString().split('T')[0]}
 */

/**
 * Parse result structure
 */
export interface ${config.className.replace('Adapter', '')}ParseResult {
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  sections?: ${config.className.replace('Adapter', '')}Section[];
}

/**
 * Document section
 */
export interface ${config.className.replace('Adapter', '')}Section {
  heading?: string;
  content: string;
  level?: number;
}

/**
 * Parse ${config.name} content
 */
export function parse${config.className.replace('Adapter', '')}(content: string): ${config.className.replace('Adapter', '')}ParseResult {
  // TODO: Implement parsing logic

  return {
    title: '',
    content,
    metadata: {},
    sections: [],
  };
}

/**
 * Extract metadata from ${config.name} content
 */
export function extractMetadata(content: string): Record<string, unknown> {
  // TODO: Implement metadata extraction
  return {};
}

/**
 * Extract sections from ${config.name} content
 */
export function extractSections(content: string): ${config.className.replace('Adapter', '')}Section[] {
  // TODO: Implement section extraction
  return [];
}
`,

    'types.ts': (config: AdapterConfig) => `/**
 * ${config.className} Types
 *
 * Source-specific type definitions for ${config.name} adapter.
 *
 * @version 1.0.0
 * @since ${new Date().toISOString().split('T')[0]}
 */

/**
 * ${config.name} file metadata
 */
export interface ${config.className.replace('Adapter', '')}Metadata {
  title?: string;
  author?: string;
  date?: string;
  tags?: string[];
  // Add more fields as needed
}

/**
 * ${config.name} parse options
 */
export interface ${config.className.replace('Adapter', '')}ParseOptions {
  extractMetadata?: boolean;
  extractSections?: boolean;
  includeRawContent?: boolean;
}
`,

    '__tests__/index.test.ts': (config: AdapterConfig) => `/**
 * ${config.className} Tests
 *
 * Unit and integration tests for ${config.name} file adapter.
 *
 * @version 1.0.0
 * @since ${new Date().toISOString().split('T')[0]}
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ${config.className} } from '../index';

// =============================================================================
// Test Utilities
// =============================================================================

let testDir: string;

async function createTestFile(filename: string, content: string): Promise<string> {
  const filePath = path.join(testDir, filename);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

// =============================================================================
// Setup & Teardown
// =============================================================================

beforeAll(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), '${config.name}-adapter-test-'));
});

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

// =============================================================================
// Tests
// =============================================================================

describe('${config.className}', () => {
  let adapter: ${config.className};

  beforeEach(async () => {
    adapter = new ${config.className}();
    await adapter.initialize({
      sourceType: '${config.sourceType}',
      basePath: testDir,
    });
  });

  afterEach(async () => {
    await adapter.shutdown();
  });

  describe('getAdapterInfo', () => {
    it('should return adapter info', () => {
      const info = adapter.getAdapterInfo();

      expect(info.id).toBe('${config.sourceType}');
      expect(info.category).toBe('file');
      expect(info.authType).toBe('none');
    });
  });

  describe('getSupportedExtensions', () => {
    it('should return supported extensions', () => {
      const extensions = adapter.getSupportedExtensions();

      expect(extensions).toBeInstanceOf(Array);
      expect(extensions.length).toBeGreaterThan(0);
    });
  });

  describe('parseFile', () => {
    it('should parse file content', async () => {
      const testContent = 'Test content for ${config.name} file';
      const filePath = await createTestFile('test.${config.name}', testContent);
      const content = await fs.readFile(filePath);

      const result = await adapter.parseFile(content, 'test.${config.name}');

      expect(result.content).toBe(testContent);
      expect(result.title).toBeDefined();
      expect(result.metadata).toBeDefined();
    });
  });

  describe('extractTitle', () => {
    it('should extract title from filename', () => {
      const title = adapter.extractTitle('', 'my-document.${config.name}');

      expect(title).toBe('my-document');
    });
  });

  describe('fetchContentItem', () => {
    it('should fetch content item by path', async () => {
      const testContent = 'Test document content';
      const filePath = await createTestFile('document.${config.name}', testContent);

      const item = await adapter.fetchContentItem(filePath);

      expect(item.sourceType).toBe('${config.sourceType}');
      expect(item.content).toBe(testContent);
    });
  });

  describe('fetchCollection', () => {
    it('should list files in directory', async () => {
      await createTestFile('file1.${config.name}', 'Content 1');
      await createTestFile('file2.${config.name}', 'Content 2');

      const collection = await adapter.fetchCollection(testDir);

      expect(collection.itemCount).toBeGreaterThanOrEqual(2);
    });
  });
});
`,
  },
};

// =============================================================================
// Utility Functions
// =============================================================================

function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

function toSnakeCase(str: string): string {
  return str.toLowerCase().replace(/[-\s]/g, '_');
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Directory exists
  }
}

// =============================================================================
// Main Logic
// =============================================================================

async function createAdapter(name: string, category: AdapterCategory): Promise<void> {
  const config: AdapterConfig = {
    name: name.toLowerCase(),
    category,
    className: `${toPascalCase(name)}Adapter`,
    sourceType: toSnakeCase(name),
  };

  const baseDir = path.resolve(__dirname, '../src/adapters', category, config.name);
  const testsDir = path.join(baseDir, '__tests__');

  console.log(`\n📦 Creating ${config.className} in ${category} category...\n`);

  // Create directories
  await ensureDir(baseDir);
  await ensureDir(testsDir);

  // Get templates for category
  const templates = TEMPLATES[category];

  // Generate files
  for (const [filename, templateFn] of Object.entries(templates)) {
    const filePath = path.join(baseDir, filename);
    const content = templateFn(config);

    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`  ✅ Created: ${path.relative(process.cwd(), filePath)}`);
  }

  // Print next steps
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ ${config.className} scaffolding complete!

📁 Files created:
   ${path.relative(process.cwd(), baseDir)}/
   ├── index.ts           # Main adapter class
   ├── types.ts           # Type definitions${category === 'file' ? '\n   ├── parser.ts          # Parsing utilities' : ''}
   └── __tests__/
       └── index.test.ts  # Tests

🚀 Next steps:
   1. Implement TODO sections in index.ts
   2. Add source-specific types in types.ts
   3. Run tests: npm test -- --testPathPattern=${category}/${config.name}
   4. Register adapter in AdapterFactory.ts:

      import { ${config.className} } from './${category}/${config.name}';

      if (!adapterConstructors.has('${config.sourceType}')) {
        adapterConstructors.set('${config.sourceType}', ${config.className});
      }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs(): { name: string; category: AdapterCategory } {
  const args = process.argv.slice(2);
  let name = '';
  let category: AdapterCategory = 'oauth';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      name = args[++i];
    } else if (args[i] === '--category' && args[i + 1]) {
      const cat = args[++i];
      if (['oauth', 'feed', 'file'].includes(cat)) {
        category = cat as AdapterCategory;
      } else {
        console.error(`❌ Invalid category: ${cat}`);
        console.error('   Valid categories: oauth, feed, file');
        process.exit(1);
      }
    }
  }

  if (!name) {
    console.error(`
❌ Missing required argument: --name

Usage:
  npm run create:adapter -- --name <adapter-name> --category <oauth|feed|file>

Examples:
  npm run create:adapter -- --name notion --category oauth
  npm run create:adapter -- --name rss --category feed
  npm run create:adapter -- --name markdown --category file
`);
    process.exit(1);
  }

  return { name, category };
}

// Run
const { name, category } = parseArgs();
createAdapter(name, category).catch((error) => {
  console.error('❌ Error creating adapter:', error);
  process.exit(1);
});
