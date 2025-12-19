# Adapter System Documentation

This document describes the DataSourceAdapter architecture, registry system, and factory pattern used in this project.

## Overview

The adapter system provides a unified interface for integrating multiple content sources (YouTube, Notion, LinkedIn, Files, Google Drive, etc.) with a consistent API.

**Core Components:**
- **DataSourceAdapter Interface**: Universal adapter interface for all data sources
- **AdapterRegistry**: Centralized registry for managing adapter instances
- **AdapterFactory**: Factory for creating and initializing adapters
- **YouTubeAdapter**: YouTube-specific implementation

## Architecture Principles

1. **Source-agnostic**: All adapters implement the same interface
2. **Type-safe**: TypeScript for compile-time validation
3. **Extensible**: Easy to add new data sources via plugin system
4. **Fault-tolerant**: Graceful degradation with health checks

## Quick Start

### Using the Factory (Recommended)

```typescript
import { createAndInitializeAdapter } from './adapters';

// Create and initialize in one call
const adapter = await createAndInitializeAdapter('youtube', {
  sourceType: 'youtube',
  credentials: { apiKey: process.env.YOUTUBE_API_KEY },
  quotaLimit: 10000,
  cacheEnabled: true,
});

// Use adapter
const playlist = await adapter.fetchCollection('PLxxx...');
const items = await adapter.fetchCollectionItems('PLxxx...', { maxResults: 50 });

// Cleanup
await adapter.shutdown();
```

### Using the Registry

```typescript
import { getAdapterRegistry, createAndInitializeAdapter } from './adapters';

// Create adapter
const youtubeAdapter = await createAndInitializeAdapter('youtube', {
  sourceType: 'youtube',
  credentials: { apiKey: process.env.YOUTUBE_API_KEY },
});

// Register in global registry
const registry = getAdapterRegistry();
registry.register(youtubeAdapter);

// Retrieve from registry
const adapter = registry.get('youtube');

// List all adapters
const allAdapters = registry.getAll();

// Check if adapter exists
if (registry.has('youtube')) {
  console.log('YouTube adapter is available');
}

// Cleanup all adapters
await registry.shutdownAll();
```

## DataSourceAdapter Interface

All adapters implement the following interface:

### Adapter Metadata

```typescript
interface DataSourceAdapter {
  readonly name: string;           // 'youtube', 'notion', etc.
  readonly version: string;         // Semantic versioning
  readonly sourceType: SourceType;  // Source type identifier
}
```

### Lifecycle Management

```typescript
// Initialize adapter with configuration
await adapter.initialize(config);

// Shutdown and cleanup resources
await adapter.shutdown();
```

### Authentication

```typescript
// Authenticate with credentials
const authResult = await adapter.authenticate(credentials);

// Refresh expired access token
const newAuth = await adapter.refreshAuth();

// Set credentials directly
adapter.setCredentials({ apiKey: 'YOUR_KEY' });
```

### Collection Operations

```typescript
// Fetch collection metadata (playlist, database, folder)
const collection = await adapter.fetchCollection('collection-id');

// Fetch collection items (paginated)
const result = await adapter.fetchCollectionItems('collection-id', {
  maxResults: 50,
  pageToken: 'next-page-token',
});
```

### Content Operations

```typescript
// Fetch single content item
const item = await adapter.fetchContentItem('content-id');

// Fetch multiple items in batch
const items = await adapter.fetchContentItemsBatch(['id1', 'id2', 'id3']);

// Search content (if supported)
if (adapter.getCapabilities().supportsSearch) {
  const results = await adapter.searchContent?.('search query', {
    maxResults: 20,
  });
}
```

### URL Extraction

```typescript
// Extract collection ID from URL
const playlistId = adapter.extractCollectionId(
  'https://youtube.com/playlist?list=PLxxx...'
); // Returns: 'PLxxx...'

// Extract content ID from URL
const videoId = adapter.extractContentId?.(
  'https://youtube.com/watch?v=abc123'
); // Returns: 'abc123'
```

### Schema and Capabilities

```typescript
// Get content schema
const schema = adapter.getSchema();
console.log(schema.supportedContentTypes); // ['video', 'playlist']
console.log(schema.requiredFields);        // ['sourceId', 'title']

// Get adapter capabilities
const capabilities = adapter.getCapabilities();
console.log(capabilities.supportsCollections);  // true
console.log(capabilities.supportsDirectContent); // true
console.log(capabilities.hasQuotaLimit);        // true
```

### Health and Monitoring

```typescript
// Check adapter health
const health = await adapter.healthCheck();
console.log(health.healthy);        // true
console.log(health.authenticated);  // true
console.log(health.quotaRemaining); // 9500

// Get quota usage (if supported)
if (adapter.getQuotaUsage) {
  const quota = await adapter.getQuotaUsage();
  console.log(`${quota.used}/${quota.limit} quota used`);
  console.log(`Resets at: ${quota.resetAt}`);
}
```

## Creating Custom Adapters

### Step 1: Implement DataSourceAdapter Interface

```typescript
import { DataSourceAdapter, AdapterConfig, /* ... */ } from './adapters';

export class CustomAdapter implements DataSourceAdapter {
  readonly name = 'custom';
  readonly version = '1.0.0';
  readonly sourceType = 'custom';

  async initialize(config: AdapterConfig): Promise<void> {
    // Initialize your adapter
  }

  async shutdown(): Promise<void> {
    // Cleanup resources
  }

  // Implement all required methods...
}
```

### Step 2: Register Custom Adapter

```typescript
import { registerAdapterConstructor } from './adapters';
import { CustomAdapter } from './CustomAdapter';

// Register constructor
registerAdapterConstructor('custom', CustomAdapter);

// Now you can create instances
const adapter = await createAndInitializeAdapter('custom', {
  sourceType: 'custom',
  credentials: { /* ... */ },
});
```

### Step 3: Use Custom Adapter

```typescript
// Create and use like any other adapter
const customAdapter = await createAndInitializeAdapter('custom', config);
const data = await customAdapter.fetchCollection('some-id');
```

## AdapterRegistry API

### Singleton Pattern

```typescript
import { AdapterRegistry, getAdapterRegistry } from './adapters';

// Get singleton instance
const registry = AdapterRegistry.getInstance();

// Or use convenience function
const registry = getAdapterRegistry();
```

### Registration Management

```typescript
// Register adapter
registry.register(adapter);

// Unregister adapter (calls shutdown automatically)
registry.unregister('youtube');

// Check existence
if (registry.has('youtube')) {
  console.log('YouTube adapter registered');
}

// Get adapter
const adapter = registry.get('youtube');

// Get all adapters
const adapters = registry.getAll();
```

### Metadata Management

```typescript
// Get adapter metadata
const metadata = registry.getMetadata('youtube');
console.log(metadata.name);         // 'youtube'
console.log(metadata.version);      // '1.0.0'
console.log(metadata.description);  // 'youtube adapter v1.0.0 (collections, direct content, ...)'

// Get all metadata
const allMetadata = registry.getAllMetadata();

// Get supported source types
const types = registry.getSupportedSourceTypes();
console.log(types); // ['youtube', 'custom', ...]
```

### Lifecycle Management

```typescript
// Shutdown all adapters gracefully
await registry.shutdownAll();

// Clear all adapters (without shutdown)
registry.clear();
```

## AdapterFactory API

### Basic Usage

```typescript
import { createAdapter, createAndInitializeAdapter } from './adapters';

// Create adapter (not initialized)
const adapter = createAdapter('youtube', config);
await adapter.initialize(config);

// Create and initialize in one call (recommended)
const adapter = await createAndInitializeAdapter('youtube', config);
```

### Checking Support

```typescript
import { isAdapterSupported, getSupportedSourceTypes } from './adapters';

// Check if adapter type is supported
if (isAdapterSupported('youtube')) {
  console.log('YouTube adapter is available');
}

// Get all supported types
const types = getSupportedSourceTypes();
console.log(types); // ['youtube']
```

### Custom Adapter Registration

```typescript
import {
  registerAdapterConstructor,
  unregisterAdapterConstructor,
} from './adapters';

// Register custom adapter
registerAdapterConstructor('custom', CustomAdapter);

// Unregister adapter
unregisterAdapterConstructor('custom');

// Clear all registrations (mainly for testing)
clearAdapterConstructors();
```

## Error Handling

All adapters use the `AdapterError` class for consistent error handling:

```typescript
import { AdapterError, AdapterErrorCode } from './adapters';

try {
  const playlist = await adapter.fetchCollection('invalid-id');
} catch (error) {
  if (error instanceof AdapterError) {
    console.error(`Error: ${error.code}`);
    console.error(`Message: ${error.message}`);
    console.error(`Source: ${error.sourceType}`);
    console.error(`Metadata:`, error.metadata);

    // Handle specific error codes
    switch (error.code) {
      case AdapterErrorCode.NOT_FOUND:
        console.log('Resource not found');
        break;
      case AdapterErrorCode.QUOTA_EXCEEDED:
        console.log('API quota exceeded');
        break;
      case AdapterErrorCode.AUTH_FAILED:
        console.log('Authentication failed');
        break;
      // ... handle other error codes
    }
  }
}
```

## Quota Management

YouTube and other APIs have quota limits. The adapter tracks usage automatically:

```typescript
// Check quota before expensive operations
const quota = await adapter.getQuotaUsage?.();

if (quota && quota.remaining < 100) {
  console.warn('Low quota remaining:', quota.remaining);
}

// Quota is tracked automatically on API calls
const result = await adapter.fetchCollectionItems('PLxxx...', {
  maxResults: 100,
});

console.log('Quota cost:', result.quotaCost); // e.g., 2 units

// Check updated quota
const newQuota = await adapter.getQuotaUsage?.();
console.log('Remaining:', newQuota?.remaining);
```

## Best Practices

1. **Always initialize before use**: Call `initialize()` or use `createAndInitializeAdapter()`

2. **Cleanup resources**: Call `shutdown()` when done, or use `registry.shutdownAll()`

3. **Handle errors gracefully**: Use try-catch and check for `AdapterError`

4. **Monitor quota usage**: Check `getQuotaUsage()` for APIs with limits

5. **Use caching**: Enable `cacheEnabled: true` in config to reduce API calls

6. **Batch operations**: Use `fetchContentItemsBatch()` instead of multiple `fetchContentItem()` calls

7. **Registry for singletons**: Use the registry for long-lived, shared adapter instances

8. **Factory for temporary**: Use the factory for one-off or short-lived adapter usage

## Testing

The adapter system includes comprehensive tests:

```bash
# Run all adapter tests
npm test -- tests/unit/adapter-registry.test.ts
npm test -- tests/unit/adapter-factory.test.ts
npm test -- tests/integration/youtube-adapter.test.ts

# Run all tests
npm test
```

## Example: Multi-Source Content Aggregation

```typescript
import { getAdapterRegistry, createAndInitializeAdapter } from './adapters';

async function aggregateContent() {
  const registry = getAdapterRegistry();

  // Initialize YouTube adapter
  const youtube = await createAndInitializeAdapter('youtube', {
    sourceType: 'youtube',
    credentials: { apiKey: process.env.YOUTUBE_API_KEY },
  });
  registry.register(youtube);

  // Future: Add more adapters
  // const notion = await createAndInitializeAdapter('notion', { ... });
  // registry.register(notion);

  // Fetch from all sources
  const allContent = [];
  for (const adapter of registry.getAll()) {
    try {
      const content = await adapter.fetchContentItem('some-id');
      allContent.push(content);
    } catch (error) {
      console.error(`Failed to fetch from ${adapter.name}:`, error);
    }
  }

  // Cleanup
  await registry.shutdownAll();

  return allContent;
}
```

## Future Enhancements

- **Notion Adapter**: For Notion pages and databases
- **LinkedIn Adapter**: For LinkedIn posts and articles
- **File Adapter**: For local files and directories
- **Google Drive Adapter**: For Google Docs and Drive files
- **Vimeo Adapter**: For Vimeo videos
- **Spotify Adapter**: For Spotify playlists and tracks

## Support

For issues, questions, or contributions:
- GitHub Issues: [project-url]/issues
- Documentation: [project-url]/docs
- PRD: See PRD.md for project requirements
