# Sync YouTube Playlists - Project Conventions

프로젝트 전반의 코딩 규칙, 아키텍처 패턴, 파일 구조 등을 정의합니다.

## Project Structure

```
sync-youtube-playlists/
├── src/
│   ├── adapters/           # DataSourceAdapter implementations
│   │   ├── DataSourceAdapter.ts
│   │   ├── AdapterRegistry.ts
│   │   ├── AdapterFactory.ts
│   │   ├── AdapterError.ts
│   │   └── YouTubeAdapter.ts
│   ├── api/                # REST API endpoints
│   │   ├── server.ts
│   │   ├── routes/
│   │   └── middleware/
│   ├── cli/                # CLI interface
│   │   ├── index.ts
│   │   └── commands/
│   ├── config/             # Configuration management
│   ├── modules/            # Business logic modules
│   │   ├── playlist/
│   │   ├── video/
│   │   └── sync/
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Shared utilities
├── prisma/
│   ├── schema.prisma       # Database schema
│   └── migrations/
├── tests/
│   ├── unit/
│   └── integration/
└── docs/
```

## TypeScript Conventions

### Strict Mode
```typescript
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true
  }
}
```

### Naming Conventions
- **Files**: `kebab-case.ts` (e.g., `youtube-adapter.ts`)
- **Classes**: `PascalCase` (e.g., `YouTubeAdapter`)
- **Interfaces**: `PascalCase` (e.g., `DataSourceAdapter`)
- **Functions**: `camelCase` (e.g., `fetchCollection`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRY_ATTEMPTS`)
- **Types**: `PascalCase` (e.g., `SourceType`)
- **Enums**: `PascalCase` with `UPPER_CASE` values

```typescript
// Good
enum AdapterErrorCode {
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  API_ERROR = 'API_ERROR'
}

class YouTubeAdapter implements DataSourceAdapter {
  async fetchCollection(collectionId: string): Promise<Collection> {
    // ...
  }
}
```

## Error Handling Pattern

### AdapterError Usage
```typescript
import { AdapterError, AdapterErrorCode } from '../AdapterError';

// Throw AdapterError for all adapter-related errors
throw new AdapterError(
  AdapterErrorCode.API_ERROR,
  'Failed to fetch playlist',
  'youtube',
  { statusCode: 404, playlistId: 'PLxxx' }
);
```

### Error Code Categories
- `AUTHENTICATION_FAILED`: OAuth/API key issues
- `QUOTA_EXCEEDED`: API quota limit reached
- `INVALID_CREDENTIALS`: Invalid API credentials
- `NOT_FOUND`: Resource not found
- `API_ERROR`: General API errors
- `NETWORK_ERROR`: Network connectivity issues
- `RATE_LIMIT`: Rate limiting triggered
- `VALIDATION_ERROR`: Input validation failed

### Try-Catch Pattern
```typescript
async function syncPlaylist(playlistId: string): Promise<void> {
  try {
    const collection = await adapter.fetchCollection(playlistId);
    await saveToDatabase(collection);
  } catch (error) {
    if (error instanceof AdapterError) {
      logger.error(`Adapter error: ${error.message}`, error.metadata);
      throw error;
    }
    logger.error('Unexpected error', error);
    throw new Error(`Sync failed: ${error.message}`);
  }
}
```

## API Response Format

### Success Response
```typescript
interface ApiResponse<T> {
  success: true;
  data: T;
  metadata?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

// Example
return res.json({
  success: true,
  data: playlists,
  metadata: { page: 1, limit: 50, total: 100 }
});
```

### Error Response
```typescript
interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

// Example
return res.status(404).json({
  success: false,
  error: {
    code: 'NOT_FOUND',
    message: 'Playlist not found',
    details: { playlistId: 'PLxxx' }
  }
});
```

## Database Patterns

### Transactions
```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Use transactions for multi-step operations
await prisma.$transaction(async (tx) => {
  const collection = await tx.collection.create({ data: collectionData });
  await tx.contentItem.createMany({ data: itemsData });
  await tx.collectionItemLink.createMany({ data: linksData });
});
```

### Query Patterns
```typescript
// Include related data
const collection = await prisma.collection.findUnique({
  where: { id },
  include: {
    items: {
      include: {
        contentItem: true
      }
    }
  }
});

// Pagination
const playlists = await prisma.playlist.findMany({
  skip: (page - 1) * limit,
  take: limit,
  orderBy: { createdAt: 'desc' }
});
```

## Import/Export Conventions

### Import Order
1. Node built-in modules
2. External packages
3. Internal modules (absolute paths)
4. Relative imports

```typescript
// 1. Node built-in
import path from 'path';
import fs from 'fs/promises';

// 2. External packages
import express from 'express';
import { PrismaClient } from '@prisma/client';

// 3. Internal modules
import { DataSourceAdapter } from '@/adapters/DataSourceAdapter';
import { logger } from '@/utils/logger';

// 4. Relative imports
import { parsePlaylistUrl } from './utils';
import type { SyncOptions } from './types';
```

### Export Pattern
```typescript
// Prefer named exports
export class YouTubeAdapter implements DataSourceAdapter {
  // ...
}

export const createAdapter = (type: SourceType): DataSourceAdapter => {
  // ...
};

// Avoid default exports except for main entry points
```

## Git Commit Conventions

### Commit Message Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `test`: Adding tests
- `docs`: Documentation changes
- `chore`: Maintenance tasks
- `perf`: Performance improvements

### Examples
```bash
feat(adapter): add Notion adapter implementation

Implement NotionAdapter with OAuth 2.0 support.
- fetchCollection for Notion databases
- fetchContentItem for Notion pages
- Block content extraction to Markdown

Closes #23

---

fix(youtube): handle quota exceeded errors gracefully

Add exponential backoff retry logic when YouTube API
quota is exceeded. Queue failed requests for next day.

---

test(adapter-registry): add comprehensive unit tests

Add 21 unit tests for AdapterRegistry covering:
- register/unregister operations
- singleton pattern enforcement
- adapter lifecycle management
```

## Environment Variables

### .env Structure
```bash
# Database
DATABASE_URL="file:./dev.db"

# YouTube API
YOUTUBE_API_KEY="your-api-key"
YOUTUBE_CLIENT_ID="your-client-id"
YOUTUBE_CLIENT_SECRET="your-client-secret"
YOUTUBE_REDIRECT_URI="http://localhost:3000/auth/callback"

# Notion API (Phase 2)
NOTION_API_KEY=""
NOTION_CLIENT_ID=""
NOTION_CLIENT_SECRET=""

# Server
PORT=3000
NODE_ENV=development
JWT_SECRET="your-jwt-secret"
JWT_ACCESS_EXPIRY="15m"
JWT_REFRESH_EXPIRY="7d"

# Logging
LOG_LEVEL="info"
```

### Config Loading
```typescript
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY!,
    clientId: process.env.YOUTUBE_CLIENT_ID!,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET!,
  },
  database: {
    url: process.env.DATABASE_URL!,
  },
  jwt: {
    secret: process.env.JWT_SECRET!,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
  }
};
```

## Logging Conventions

### Logger Usage
```typescript
import { logger } from '@/utils/logger';

// Log levels: debug, info, warn, error
logger.info('Syncing playlist', { playlistId, userId });
logger.warn('API quota approaching limit', { remaining: 100 });
logger.error('Sync failed', { error, playlistId });

// Structured logging with metadata
logger.info('Collection created', {
  collectionId: collection.id,
  sourceType: collection.sourceType,
  itemCount: collection.itemCount
});
```

## Testing Conventions

### Test File Naming
- Unit tests: `*.test.ts` (same directory as source)
- Integration tests: `tests/integration/*.integration.test.ts`

### Test Structure (AAA Pattern)
```typescript
describe('AdapterRegistry', () => {
  describe('register', () => {
    it('should register adapter successfully', () => {
      // Arrange
      const registry = AdapterRegistry.getInstance();
      const adapter = createMockAdapter('test');

      // Act
      registry.register(adapter);

      // Assert
      expect(registry.has('test')).toBe(true);
    });
  });
});
```

## Comments and Documentation

### JSDoc for Public APIs
```typescript
/**
 * Fetches a collection from the data source.
 *
 * @param collectionId - The unique identifier of the collection
 * @returns Promise resolving to Collection object
 * @throws {AdapterError} When collection not found or API error occurs
 *
 * @example
 * ```typescript
 * const collection = await adapter.fetchCollection('PLxxx');
 * console.log(collection.title);
 * ```
 */
async fetchCollection(collectionId: string): Promise<Collection>;
```

### Inline Comments
```typescript
// Good: Explain WHY, not WHAT
// YouTube API returns duration in ISO 8601 format (PT1H30M)
const durationSeconds = parseDuration(video.contentDetails.duration);

// Bad: Obvious what the code does
// Get the video duration
const duration = video.duration;
```

## Performance Guidelines

### API Quota Management
```typescript
// Batch requests to minimize quota usage
// YouTube API: playlistItems.list supports up to 50 items per request
const BATCH_SIZE = 50;

async function fetchAllItems(playlistId: string): Promise<VideoItem[]> {
  const items: VideoItem[] = [];
  let pageToken: string | undefined;

  do {
    const response = await youtube.playlistItems.list({
      playlistId,
      part: ['snippet', 'contentDetails'],
      maxResults: BATCH_SIZE,
      pageToken
    });

    items.push(...response.data.items || []);
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return items;
}
```

### Caching Strategy
```typescript
// Cache API responses for unchanged data
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour

async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached) return cached;

  const data = await fetcher();
  cache.set(key, data);
  return data;
}
```

## References
- PRD.md - Project requirements and roadmap
- docs/ADAPTER_SYSTEM.md - Adapter architecture documentation
- prisma/schema.prisma - Database schema reference
