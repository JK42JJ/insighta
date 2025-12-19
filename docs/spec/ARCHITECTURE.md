# Architecture Documentation
# YouTube Playlist Sync Module

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture Principles](#architecture-principles)
3. [Component Architecture](#component-architecture)
4. [Data Architecture](#data-architecture)
5. [API Integration Architecture](#api-integration-architecture)
6. [Security Architecture](#security-architecture)
7. [Performance Architecture](#performance-architecture)
8. [Deployment Architecture](#deployment-architecture)

---

## 1. System Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Interface Layer                         │
│  ┌────────────────────┐                  ┌────────────────────────┐ │
│  │   CLI Interface    │                  │   Future: Web API      │ │
│  │  (Commander.js)    │                  │      (Express)         │ │
│  └─────────┬──────────┘                  └───────────┬────────────┘ │
└────────────┼────────────────────────────────────────┼───────────────┘
             │                                         │
┌────────────▼─────────────────────────────────────────▼───────────────┐
│                      Application Layer                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   Playlist   │  │    Video     │  │    Sync      │              │
│  │   Manager    │  │   Manager    │  │  Scheduler   │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                  │                  │                      │
│         └──────────────────┴──────────────────┘                      │
└────────────────────────────┼──────────────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────────────────┐
│                   Integration Layer                                   │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │              YouTube API Client Module                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐  │   │
│  │  │   OAuth2    │  │Rate Limiter │  │   Response Cache     │  │   │
│  │  │   Manager   │  │& Quota Mgmt │  │                      │  │   │
│  │  └─────────────┘  └─────────────┘  └──────────────────────┘  │   │
│  └────────────────────────────┬──────────────────────────────────┘   │
└───────────────────────────────┼────────────────────────────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   YouTube Data API v3  │
                    │   (External Service)   │
                    └────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────────┐
│                       Data Layer                                       │
│  ┌──────────────────┐              ┌──────────────────────────────┐   │
│  │    Database      │              │      File Storage            │   │
│  │  (SQLite/PG)     │              │  (Thumbnails, Cache, Logs)   │   │
│  │  - Playlists     │              │  - /cache/thumbnails/        │   │
│  │  - Videos        │              │  - /cache/responses/         │   │
│  │  - PlaylistItems │              │  - /logs/                    │   │
│  │  - UserStates    │              │  - /temp/                    │   │
│  └──────────────────┘              └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 System Context

```
┌──────────────┐
│   End User   │
└──────┬───────┘
       │ Manages playlists, views data
       │
┌──────▼────────────────────────────────────────────────┐
│         YouTube Playlist Sync Module                  │
│                                                        │
│  Features:                                             │
│  - Playlist import & sync                              │
│  - Video metadata collection                           │
│  - Watch status tracking                               │
│  - Local data storage                                  │
└────────┬───────────────────────────────────────────────┘
         │
         │ API Calls (OAuth 2.0)
         │
┌────────▼──────────┐
│  YouTube API v3   │
│  (Google Cloud)   │
└───────────────────┘
```

---

## 2. Architecture Principles

### 2.1 Core Principles

1. **Separation of Concerns**
   - Clear boundaries between layers (UI, Application, Integration, Data)
   - Each module has single responsibility
   - Minimal coupling between components

2. **API-First Design**
   - All business logic accessible through clean interfaces
   - Future-ready for web API or mobile client
   - Testable in isolation

3. **Data Integrity**
   - Transactional database operations
   - Validation at boundaries
   - Idempotent sync operations

4. **Resilience**
   - Graceful error handling
   - Retry mechanisms with exponential backoff
   - Fallback strategies for service failures

5. **Performance**
   - Efficient API quota usage through caching
   - Batch processing for bulk operations
   - Asynchronous operations for I/O

6. **Security**
   - Least privilege principle
   - Encrypted credential storage
   - No sensitive data in logs

### 2.2 Design Patterns

- **Repository Pattern**: Abstract data access (Database Module)
- **Strategy Pattern**: Different sync strategies (full vs incremental)
- **Observer Pattern**: Sync events for monitoring/logging
- **Factory Pattern**: Create API clients with proper configuration
- **Singleton Pattern**: Database connection, configuration
- **Circuit Breaker**: API failure protection

---

## 3. Component Architecture

### 3.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLI Interface                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  sync    │  │  list    │  │ schedule │  │  config  │       │
│  │ command  │  │ command  │  │ command  │  │ command  │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
└───────┼─────────────┼─────────────┼─────────────┼──────────────┘
        │             │             │             │
┌───────▼─────────────▼─────────────▼─────────────▼──────────────┐
│                  Application Services                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │           Playlist Manager Service                      │    │
│  │  - importPlaylist(url)                                  │    │
│  │  - syncPlaylist(id)                                     │    │
│  │  - listPlaylists()                                      │    │
│  │  - deletePlaylist(id)                                   │    │
│  └─────────────────┬──────────────────────────────────────┘    │
│                    │                                            │
│  ┌─────────────────▼──────────────────────────────────────┐    │
│  │           Video Manager Service                         │    │
│  │  - fetchVideoMetadata(videoIds)                         │    │
│  │  - updateWatchStatus(videoId, status)                   │    │
│  │  - searchVideos(query)                                  │    │
│  │  - getVideoDetails(id)                                  │    │
│  └─────────────────┬──────────────────────────────────────┘    │
│                    │                                            │
│  ┌─────────────────▼──────────────────────────────────────┐    │
│  │           Sync Scheduler Service                        │    │
│  │  - scheduleSyncJob(playlistId, interval)                │    │
│  │  - runSyncJob(jobId)                                    │    │
│  │  - cancelSyncJob(jobId)                                 │    │
│  │  - getSyncStatus(jobId)                                 │    │
│  └─────────────────┬──────────────────────────────────────┘    │
└────────────────────┼─────────────────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────────────────┐
│                  YouTube API Client                              │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  Core API Methods                                       │     │
│  │  - getPlaylist(id): PlaylistDetails                     │     │
│  │  - getPlaylistItems(playlistId): PlaylistItem[]         │     │
│  │  - getVideos(videoIds): VideoDetails[]                  │     │
│  │  - getChannel(channelId): ChannelDetails                │     │
│  └────────────────┬───────────────────────────────────────┘     │
│                   │                                              │
│  ┌────────────────▼───────────────────────────────────────┐     │
│  │  OAuth2 Manager                                         │     │
│  │  - authenticate(): Promise<Credentials>                 │     │
│  │  - refreshToken(): Promise<Credentials>                 │     │
│  │  - validateToken(): boolean                             │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Rate Limiter & Quota Manager                            │   │
│  │  - checkQuota(): boolean                                 │   │
│  │  - trackUsage(cost: number)                              │   │
│  │  - waitForQuota(): Promise<void>                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Response Cache                                           │   │
│  │  - get(key): CachedResponse | null                       │   │
│  │  - set(key, value, ttl)                                  │   │
│  │  - invalidate(key)                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────────────────┐
│                  Database Layer                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  Repositories (Data Access)                             │     │
│  │  - PlaylistRepository                                   │     │
│  │  - VideoRepository                                      │     │
│  │  - PlaylistItemRepository                               │     │
│  │  - UserVideoStateRepository                             │     │
│  └────────────────┬───────────────────────────────────────┘     │
│                   │                                              │
│  ┌────────────────▼───────────────────────────────────────┐     │
│  │  ORM Layer (Prisma/TypeORM)                             │     │
│  │  - Schema definitions                                   │     │
│  │  - Migration management                                 │     │
│  │  - Query builder                                        │     │
│  └────────────────┬───────────────────────────────────────┘     │
│                   │                                              │
│  ┌────────────────▼───────────────────────────────────────┐     │
│  │  Database (SQLite/PostgreSQL)                           │     │
│  └─────────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 Module Descriptions

#### 3.2.1 CLI Interface Module
**Responsibility**: User interaction and command routing

**Key Components**:
- Command parsers (sync, list, schedule, config)
- Input validation
- Output formatting
- Help and documentation

**Dependencies**: Application Services

#### 3.2.2 Playlist Manager Service
**Responsibility**: Playlist lifecycle management

**Key Operations**:
- Import new playlists from YouTube
- Sync existing playlists (detect changes)
- Manage playlist metadata
- Handle playlist deletion

**Sync Algorithm**:
```typescript
async function syncPlaylist(playlistId: string): Promise<SyncResult> {
  // 1. Fetch current state from YouTube
  const ytPlaylist = await youtubeClient.getPlaylist(playlistId);
  const ytItems = await youtubeClient.getPlaylistItems(playlistId);

  // 2. Fetch local state from database
  const localPlaylist = await playlistRepo.findById(playlistId);
  const localItems = await playlistItemRepo.findByPlaylist(playlistId);

  // 3. Detect changes (additions, deletions, reordering)
  const diff = calculateDiff(ytItems, localItems);

  // 4. Apply changes in transaction
  await db.transaction(async (tx) => {
    // Update playlist metadata
    await playlistRepo.update(playlistId, ytPlaylist);

    // Add new videos
    for (const newItem of diff.additions) {
      const videoDetails = await youtubeClient.getVideo(newItem.videoId);
      await videoRepo.upsert(videoDetails);
      await playlistItemRepo.create(newItem);
    }

    // Remove deleted videos
    for (const deletedItem of diff.deletions) {
      await playlistItemRepo.softDelete(deletedItem.id);
    }

    // Update positions
    for (const updatedItem of diff.reorderings) {
      await playlistItemRepo.updatePosition(updatedItem.id, updatedItem.newPosition);
    }
  });

  // 5. Update sync timestamp
  await playlistRepo.updateSyncStatus(playlistId, 'completed', new Date());

  return {
    added: diff.additions.length,
    removed: diff.deletions.length,
    reordered: diff.reorderings.length
  };
}
```

#### 3.2.3 Video Manager Service
**Responsibility**: Video metadata management

**Key Operations**:
- Fetch and store video metadata
- Update watch status
- Search and filter videos
- Manage video relationships

**Batch Processing**:
```typescript
async function fetchVideoMetadata(videoIds: string[]): Promise<Video[]> {
  const videos: Video[] = [];

  // YouTube API allows batch requests of 50 videos
  const batches = chunk(videoIds, 50);

  for (const batch of batches) {
    const response = await youtubeClient.getVideos(batch);

    // Store in database
    for (const video of response) {
      await videoRepo.upsert(video);
      videos.push(video);
    }
  }

  return videos;
}
```

#### 3.2.4 Sync Scheduler Service
**Responsibility**: Automated synchronization management

**Key Operations**:
- Schedule periodic sync jobs
- Execute sync jobs
- Monitor job status
- Handle failures and retries

**Job Queue Architecture**:
```typescript
interface SyncJob {
  id: string;
  playlistId: string;
  interval: number; // in milliseconds
  lastRun?: Date;
  nextRun: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  retryCount: number;
  maxRetries: number;
}

class SyncScheduler {
  private queue: SyncJob[] = [];
  private cron: NodeCron;

  async scheduleSyncJob(playlistId: string, interval: number): Promise<string> {
    const job: SyncJob = {
      id: generateId(),
      playlistId,
      interval,
      nextRun: new Date(Date.now() + interval),
      status: 'pending',
      retryCount: 0,
      maxRetries: 3
    };

    this.queue.push(job);
    return job.id;
  }

  async processQueue() {
    const now = new Date();
    const dueJobs = this.queue.filter(job =>
      job.status === 'pending' && job.nextRun <= now
    );

    for (const job of dueJobs) {
      await this.runSyncJob(job.id);
    }
  }

  private async runSyncJob(jobId: string) {
    const job = this.queue.find(j => j.id === jobId);
    if (!job) return;

    try {
      job.status = 'running';

      await playlistManager.syncPlaylist(job.playlistId);

      job.status = 'completed';
      job.lastRun = new Date();
      job.nextRun = new Date(Date.now() + job.interval);
      job.retryCount = 0;
    } catch (error) {
      if (job.retryCount < job.maxRetries) {
        job.retryCount++;
        job.status = 'pending';
        job.nextRun = new Date(Date.now() + this.getBackoffDelay(job.retryCount));
      } else {
        job.status = 'failed';
        logger.error(`Job ${jobId} failed after ${job.maxRetries} retries`, error);
      }
    }
  }

  private getBackoffDelay(retryCount: number): number {
    // Exponential backoff: 1min, 2min, 4min, ...
    return Math.min(60000 * Math.pow(2, retryCount - 1), 3600000);
  }
}
```

#### 3.2.5 YouTube API Client Module
**Responsibility**: YouTube API integration and management

**Key Components**:

1. **Core API Methods**
   - Wrapper around Google APIs client
   - Type-safe request/response handling
   - Error transformation

2. **OAuth2 Manager**
   - Token acquisition and refresh
   - Credential storage and encryption
   - Authentication state management

3. **Rate Limiter & Quota Manager**
   - Track API usage (quota units)
   - Enforce rate limits
   - Queue requests when quota exceeded

4. **Response Cache**
   - Cache immutable data (video metadata)
   - TTL-based cache invalidation
   - Reduce redundant API calls

**Implementation**:
```typescript
class YouTubeAPIClient {
  private oauth2Client: OAuth2Client;
  private rateLimiter: RateLimiter;
  private cache: ResponseCache;

  async getPlaylist(playlistId: string): Promise<PlaylistDetails> {
    // Check cache first
    const cached = await this.cache.get(`playlist:${playlistId}`);
    if (cached) return cached;

    // Check quota availability
    await this.rateLimiter.checkQuota(1); // 1 quota unit

    // Make API call
    const response = await this.youtube.playlists.list({
      part: ['snippet', 'contentDetails'],
      id: [playlistId]
    });

    // Track quota usage
    this.rateLimiter.trackUsage(1);

    // Cache response (TTL: 1 hour for playlist metadata)
    await this.cache.set(`playlist:${playlistId}`, response.data, 3600);

    return response.data;
  }

  async getPlaylistItems(
    playlistId: string,
    maxResults: number = 50
  ): Promise<PlaylistItem[]> {
    const items: PlaylistItem[] = [];
    let pageToken: string | undefined;

    do {
      await this.rateLimiter.checkQuota(1);

      const response = await this.youtube.playlistItems.list({
        part: ['snippet', 'contentDetails'],
        playlistId,
        maxResults,
        pageToken
      });

      items.push(...(response.data.items || []));
      pageToken = response.data.nextPageToken;

      this.rateLimiter.trackUsage(1);
    } while (pageToken);

    return items;
  }

  async getVideos(videoIds: string[]): Promise<VideoDetails[]> {
    // Batch request (max 50 IDs)
    await this.rateLimiter.checkQuota(1);

    const response = await this.youtube.videos.list({
      part: ['snippet', 'contentDetails', 'statistics'],
      id: videoIds
    });

    this.rateLimiter.trackUsage(1);

    return response.data.items || [];
  }
}

class RateLimiter {
  private quota: QuotaTracker;

  async checkQuota(cost: number): Promise<void> {
    const available = await this.quota.getAvailable();

    if (available < cost) {
      // Wait until quota resets (daily reset at midnight PST)
      const resetTime = this.getNextResetTime();
      const waitMs = resetTime.getTime() - Date.now();

      logger.warn(`Quota exhausted. Waiting ${waitMs}ms until reset.`);
      await sleep(waitMs);
    }
  }

  trackUsage(cost: number): void {
    this.quota.decrement(cost);
  }

  private getNextResetTime(): Date {
    // YouTube quota resets at midnight Pacific Time
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(8, 0, 0, 0); // Midnight PST = 8:00 UTC
    return tomorrow;
  }
}
```

#### 3.2.6 Database Module
**Responsibility**: Data persistence and retrieval

**Repository Pattern**:
```typescript
interface IPlaylistRepository {
  findById(id: string): Promise<Playlist | null>;
  findAll(): Promise<Playlist[]>;
  create(data: CreatePlaylistDto): Promise<Playlist>;
  update(id: string, data: UpdatePlaylistDto): Promise<Playlist>;
  delete(id: string): Promise<void>;
  updateSyncStatus(id: string, status: SyncStatus, timestamp: Date): Promise<void>;
}

class PlaylistRepository implements IPlaylistRepository {
  constructor(private db: PrismaClient) {}

  async findById(id: string): Promise<Playlist | null> {
    return this.db.playlist.findUnique({
      where: { id },
      include: {
        items: {
          include: { video: true }
        }
      }
    });
  }

  // ... other methods
}
```

---

## 4. Data Architecture

### 4.1 Entity Relationship Diagram

```
┌─────────────────────────┐
│      Playlists          │
├─────────────────────────┤
│ id (PK)                 │
│ youtube_id (UNIQUE)     │
│ title                   │
│ description             │
│ channel_id              │
│ channel_title           │
│ thumbnail_url           │
│ item_count              │
│ sync_status             │
│ last_synced_at          │
│ created_at              │
│ updated_at              │
└──────────┬──────────────┘
           │
           │ 1:N
           │
┌──────────▼──────────────┐
│    PlaylistItems        │
├─────────────────────────┤
│ id (PK)                 │
│ playlist_id (FK)        │───┐
│ video_id (FK)           │   │
│ position                │   │
│ added_at                │   │
│ removed_at (nullable)   │   │
│ created_at              │   │
│ updated_at              │   │
└─────────────────────────┘   │
           │                  │
           │ N:1              │
           │                  │
┌──────────▼──────────────┐   │
│       Videos            │   │
├─────────────────────────┤   │
│ id (PK)                 │   │
│ youtube_id (UNIQUE)     │◄──┘
│ title                   │
│ description             │
│ channel_id              │
│ channel_title           │
│ published_at            │
│ duration (seconds)      │
│ thumbnail_urls (JSON)   │
│ view_count              │
│ like_count              │
│ comment_count           │
│ tags (JSON)             │
│ category_id             │
│ language                │
│ created_at              │
│ updated_at              │
└──────────┬──────────────┘
           │
           │ 1:1 (optional)
           │
┌──────────▼──────────────┐
│   UserVideoStates       │
├─────────────────────────┤
│ id (PK)                 │
│ video_id (FK, UNIQUE)   │
│ watch_status (ENUM)     │
│ last_position (seconds) │
│ watch_count             │
│ notes (TEXT)            │
│ summary (TEXT)          │
│ tags (JSON)             │
│ rating (1-5)            │
│ created_at              │
│ updated_at              │
└─────────────────────────┘
```

### 4.2 Database Schema (Prisma)

```prisma
// schema.prisma

datasource db {
  provider = "sqlite" // or "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Playlist {
  id            String         @id @default(uuid())
  youtubeId     String         @unique @map("youtube_id")
  title         String
  description   String?
  channelId     String         @map("channel_id")
  channelTitle  String         @map("channel_title")
  thumbnailUrl  String?        @map("thumbnail_url")
  itemCount     Int            @default(0) @map("item_count")
  syncStatus    SyncStatus     @default(PENDING) @map("sync_status")
  lastSyncedAt  DateTime?      @map("last_synced_at")
  createdAt     DateTime       @default(now()) @map("created_at")
  updatedAt     DateTime       @updatedAt @map("updated_at")

  items         PlaylistItem[]

  @@map("playlists")
}

model Video {
  id            String         @id @default(uuid())
  youtubeId     String         @unique @map("youtube_id")
  title         String
  description   String?
  channelId     String         @map("channel_id")
  channelTitle  String         @map("channel_title")
  publishedAt   DateTime       @map("published_at")
  duration      Int            // in seconds
  thumbnailUrls Json           @map("thumbnail_urls")
  viewCount     Int            @default(0) @map("view_count")
  likeCount     Int            @default(0) @map("like_count")
  commentCount  Int            @default(0) @map("comment_count")
  tags          Json?          // string array
  categoryId    String?        @map("category_id")
  language      String?
  createdAt     DateTime       @default(now()) @map("created_at")
  updatedAt     DateTime       @updatedAt @map("updated_at")

  playlistItems PlaylistItem[]
  userState     UserVideoState?

  @@map("videos")
}

model PlaylistItem {
  id          String    @id @default(uuid())
  playlistId  String    @map("playlist_id")
  videoId     String    @map("video_id")
  position    Int
  addedAt     DateTime  @map("added_at")
  removedAt   DateTime? @map("removed_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  playlist    Playlist  @relation(fields: [playlistId], references: [id], onDelete: Cascade)
  video       Video     @relation(fields: [videoId], references: [id], onDelete: Cascade)

  @@unique([playlistId, videoId, addedAt])
  @@index([playlistId, position])
  @@map("playlist_items")
}

model UserVideoState {
  id           String      @id @default(uuid())
  videoId      String      @unique @map("video_id")
  watchStatus  WatchStatus @default(UNWATCHED) @map("watch_status")
  lastPosition Int         @default(0) @map("last_position") // in seconds
  watchCount   Int         @default(0) @map("watch_count")
  notes        String?
  summary      String?
  tags         Json?       // string array
  rating       Int?        // 1-5
  createdAt    DateTime    @default(now()) @map("created_at")
  updatedAt    DateTime    @updatedAt @map("updated_at")

  video        Video       @relation(fields: [videoId], references: [id], onDelete: Cascade)

  @@map("user_video_states")
}

enum SyncStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  FAILED
}

enum WatchStatus {
  UNWATCHED
  WATCHING
  COMPLETED
}
```

### 4.3 Data Flow Patterns

#### 4.3.1 Playlist Import Flow
```
User → CLI → PlaylistManager.importPlaylist(url)
                    ↓
              Extract playlist ID
                    ↓
              YouTubeClient.getPlaylist(id)
                    ↓
              YouTubeClient.getPlaylistItems(id)
                    ↓
              Extract video IDs
                    ↓
              YouTubeClient.getVideos(videoIds) [batch]
                    ↓
              Database Transaction:
                - Create Playlist
                - Upsert Videos
                - Create PlaylistItems
                    ↓
              Return Playlist with items
```

#### 4.3.2 Incremental Sync Flow
```
Scheduler → PlaylistManager.syncPlaylist(id)
                    ↓
              Fetch YouTube state
                    ↓
              Fetch local state
                    ↓
              Calculate diff:
                - New items (additions)
                - Removed items (deletions)
                - Position changes (reorderings)
                    ↓
              Database Transaction:
                - Add new PlaylistItems
                - Soft delete removed items
                - Update positions
                    ↓
              Update sync timestamp
                    ↓
              Return sync result
```

---

## 5. API Integration Architecture

### 5.1 YouTube Data API v3 Integration

#### 5.1.1 Authentication Flow (OAuth 2.0)

```
┌─────────┐                                  ┌──────────────┐
│  User   │                                  │ YouTube API  │
└────┬────┘                                  └──────┬───────┘
     │                                              │
     │ 1. Request authentication                   │
     ├─────────────────────────────────────────────►
     │                                              │
     │ 2. Redirect to Google OAuth consent screen  │
     ◄─────────────────────────────────────────────┤
     │                                              │
     │ 3. User grants permission                   │
     ├─────────────────────────────────────────────►
     │                                              │
     │ 4. Authorization code                        │
     ◄─────────────────────────────────────────────┤
     │                                              │
     │ 5. Exchange code for tokens                 │
     ├─────────────────────────────────────────────►
     │                                              │
     │ 6. Access token + Refresh token             │
     ◄─────────────────────────────────────────────┤
     │                                              │
     │ 7. Store encrypted tokens                   │
     │                                              │
     │ ... later ...                                │
     │                                              │
     │ 8. API request with access token            │
     ├─────────────────────────────────────────────►
     │                                              │
     │ 9. Token expired (401)                      │
     ◄─────────────────────────────────────────────┤
     │                                              │
     │ 10. Refresh access token                    │
     ├─────────────────────────────────────────────►
     │                                              │
     │ 11. New access token                        │
     ◄─────────────────────────────────────────────┤
     │                                              │
```

#### 5.1.2 API Quota Management

**Daily Quota**: 10,000 units (default free tier)

**Operation Costs**:
- Read operations: 1 unit per request
- Write operations: 50 units per request
- Search operations: 100 units per request

**Optimization Strategy**:
```typescript
class QuotaManager {
  private dailyLimit = 10000;
  private used = 0;
  private resetTime: Date;

  async trackUsage(cost: number): Promise<void> {
    // Check if quota reset time has passed
    if (new Date() > this.resetTime) {
      this.used = 0;
      this.resetTime = this.getNextResetTime();
    }

    this.used += cost;

    // Persist to database for tracking
    await this.db.quotaUsage.create({
      data: {
        date: new Date(),
        cost,
        operation: getCurrentOperation(),
        remaining: this.dailyLimit - this.used
      }
    });

    // Alert if approaching limit (90%)
    if (this.used > this.dailyLimit * 0.9) {
      logger.warn(`Approaching daily quota limit: ${this.used}/${this.dailyLimit}`);
    }
  }

  async getAvailable(): Promise<number> {
    if (new Date() > this.resetTime) {
      return this.dailyLimit;
    }
    return this.dailyLimit - this.used;
  }
}
```

#### 5.1.3 API Request Batching

```typescript
class BatchProcessor {
  private batchSize = 50; // YouTube API limit

  async batchGetVideos(videoIds: string[]): Promise<Video[]> {
    const batches = this.chunk(videoIds, this.batchSize);
    const results: Video[] = [];

    for (const batch of batches) {
      const response = await this.youtubeClient.getVideos(batch);
      results.push(...response);

      // Track quota usage (1 unit per batch)
      await this.quotaManager.trackUsage(1);
    }

    return results;
  }

  private chunk<T>(array: T[], size: number): T[][] {
    return Array.from(
      { length: Math.ceil(array.length / size) },
      (_, i) => array.slice(i * size, i * size + size)
    );
  }
}
```

---

## 6. Security Architecture

### 6.1 Security Layers

```
┌──────────────────────────────────────────────────────────┐
│                    Application Layer                      │
│  - Input validation and sanitization                      │
│  - Authorization checks                                   │
│  - Secure error handling (no sensitive data leaks)        │
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│                   Credential Layer                        │
│  - OAuth 2.0 tokens encrypted at rest                     │
│  - Environment variable management                        │
│  - Secure token refresh mechanism                         │
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│                    Data Layer                             │
│  - Database encryption (optional)                         │
│  - No sensitive data in logs                              │
│  - Secure file permissions                                │
└───────────────────────────────────────────────────────────┘
```

### 6.2 Credential Management

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

class CredentialManager {
  private algorithm = 'aes-256-gcm';
  private encryptionKey: Buffer;

  constructor() {
    // Derive key from environment variable
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) throw new Error('ENCRYPTION_SECRET not set');

    this.encryptionKey = Buffer.from(secret, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.encryptionKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(ciphertext: string): string {
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = createDecipheriv(this.algorithm, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  async storeCredentials(credentials: OAuth2Credentials): Promise<void> {
    const encrypted = this.encrypt(JSON.stringify(credentials));

    await this.db.credentials.upsert({
      where: { userId: 'default' },
      update: { data: encrypted },
      create: { userId: 'default', data: encrypted }
    });
  }

  async retrieveCredentials(): Promise<OAuth2Credentials | null> {
    const record = await this.db.credentials.findUnique({
      where: { userId: 'default' }
    });

    if (!record) return null;

    const decrypted = this.decrypt(record.data);
    return JSON.parse(decrypted);
  }
}
```

### 6.3 Security Best Practices

1. **Environment Variables**
   ```env
   # .env (never commit)
   YOUTUBE_API_KEY=your_api_key
   YOUTUBE_CLIENT_ID=your_client_id
   YOUTUBE_CLIENT_SECRET=your_client_secret
   ENCRYPTION_SECRET=your_encryption_key
   DATABASE_URL=your_database_url
   ```

2. **Input Validation**
   ```typescript
   import { z } from 'zod';

   const PlaylistUrlSchema = z.string().url().regex(
     /^https:\/\/(www\.)?youtube\.com\/playlist\?list=[\w-]+$/
   );

   function validatePlaylistUrl(url: string): string {
     return PlaylistUrlSchema.parse(url);
   }
   ```

3. **Error Handling**
   ```typescript
   class SecureError extends Error {
     constructor(
       message: string,
       public statusCode: number,
       public isOperational: boolean = true
     ) {
       super(message);
       this.name = this.constructor.name;
       Error.captureStackTrace(this, this.constructor);
     }
   }

   // Never expose internal errors to users
   function handleError(error: unknown): void {
     if (error instanceof SecureError && error.isOperational) {
       logger.error('Operational error:', error.message);
       console.error(error.message); // Safe to show user
     } else {
       logger.error('Critical error:', error);
       console.error('An unexpected error occurred'); // Generic message
     }
   }
   ```

---

## 7. Performance Architecture

### 7.1 Performance Optimization Strategies

#### 7.1.1 Caching Strategy

```
┌─────────────────────────────────────────────────────────┐
│                   Cache Layers                           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  L1: In-Memory Cache (hot data)                         │
│  - Active playlist metadata                              │
│  - Recently accessed videos                              │
│  - TTL: 5 minutes                                        │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  L2: File-Based Cache (API responses)                   │
│  - YouTube API responses                                 │
│  - Thumbnail images                                      │
│  - TTL: 1 hour                                           │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  L3: Database (persistent data)                          │
│  - All synced data                                       │
│  - Historical sync records                               │
│  - TTL: Permanent (updated on sync)                     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

```typescript
class MultiLevelCache {
  private l1: Map<string, CacheEntry> = new Map();
  private l2Path = './cache/responses';

  async get(key: string): Promise<any | null> {
    // L1: In-memory
    const l1Entry = this.l1.get(key);
    if (l1Entry && !this.isExpired(l1Entry)) {
      return l1Entry.data;
    }

    // L2: File system
    const l2Entry = await this.readFromFile(key);
    if (l2Entry && !this.isExpired(l2Entry)) {
      // Promote to L1
      this.l1.set(key, l2Entry);
      return l2Entry.data;
    }

    return null;
  }

  async set(key: string, data: any, ttl: number): Promise<void> {
    const entry: CacheEntry = {
      data,
      expiresAt: Date.now() + ttl * 1000
    };

    // Store in L1
    this.l1.set(key, entry);

    // Store in L2
    await this.writeToFile(key, entry);
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() > entry.expiresAt;
  }
}
```

#### 7.1.2 Database Query Optimization

```typescript
// Use indexes for frequent queries
// schema.prisma
model PlaylistItem {
  // ...

  @@index([playlistId, position]) // For sorted queries
  @@index([videoId]) // For lookups
  @@index([playlistId, addedAt]) // For sync operations
}

// Efficient queries with selective loading
async function getPlaylistWithVideos(
  playlistId: string,
  limit: number = 50,
  offset: number = 0
): Promise<PlaylistWithVideos> {
  return db.playlist.findUnique({
    where: { id: playlistId },
    include: {
      items: {
        where: { removedAt: null }, // Active items only
        orderBy: { position: 'asc' },
        take: limit,
        skip: offset,
        include: {
          video: {
            select: {
              id: true,
              youtubeId: true,
              title: true,
              duration: true,
              thumbnailUrls: true
              // Exclude large fields like description
            }
          }
        }
      }
    }
  });
}
```

#### 7.1.3 Parallel Processing

```typescript
async function syncMultiplePlaylists(
  playlistIds: string[]
): Promise<SyncResult[]> {
  // Process up to 5 playlists concurrently
  const concurrencyLimit = 5;
  const results: SyncResult[] = [];

  for (let i = 0; i < playlistIds.length; i += concurrencyLimit) {
    const batch = playlistIds.slice(i, i + concurrencyLimit);

    const batchResults = await Promise.all(
      batch.map(id => playlistManager.syncPlaylist(id))
    );

    results.push(...batchResults);
  }

  return results;
}
```

### 7.2 Performance Monitoring

```typescript
class PerformanceMonitor {
  async measureOperation<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    try {
      const result = await operation();

      const duration = Date.now() - startTime;
      const endMemory = process.memoryUsage();

      await this.logMetrics({
        operation: operationName,
        duration,
        memoryDelta: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external
        },
        success: true
      });

      return result;
    } catch (error) {
      await this.logMetrics({
        operation: operationName,
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      });
      throw error;
    }
  }
}
```

---

## 8. Deployment Architecture

### 8.1 Deployment Options

#### Option 1: Local CLI Application
```
┌──────────────────────────────┐
│     User's Machine           │
│  ┌────────────────────────┐  │
│  │   Node.js Runtime      │  │
│  │  ┌──────────────────┐  │  │
│  │  │  CLI Application │  │  │
│  │  └────────┬─────────┘  │  │
│  │           │             │  │
│  │  ┌────────▼─────────┐  │  │
│  │  │ SQLite Database  │  │  │
│  │  └──────────────────┘  │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

#### Option 2: Server Deployment (Future)
```
┌──────────────────────────────────────────┐
│           Production Server              │
│  ┌────────────────────────────────────┐  │
│  │   Node.js Application              │  │
│  │  ┌──────────┐    ┌──────────────┐  │  │
│  │  │   API    │    │   Scheduler  │  │  │
│  │  │  Server  │    │   (Cron)     │  │  │
│  │  └────┬─────┘    └──────┬───────┘  │  │
│  │       │                 │           │  │
│  │  ┌────▼─────────────────▼───────┐  │  │
│  │  │    PostgreSQL Database       │  │  │
│  │  └──────────────────────────────┘  │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

### 8.2 Configuration Management

```typescript
// config/default.ts
export const defaultConfig = {
  database: {
    url: process.env.DATABASE_URL || 'file:./data/youtube-sync.db',
    provider: 'sqlite'
  },
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY,
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: 'http://localhost:3000/oauth/callback'
  },
  sync: {
    defaultInterval: 3600000, // 1 hour
    maxConcurrency: 5,
    retryAttempts: 3,
    backoffMultiplier: 2
  },
  cache: {
    ttl: {
      playlist: 3600, // 1 hour
      video: 86400, // 24 hours
      thumbnail: 604800 // 7 days
    },
    directory: './cache'
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    directory: './logs'
  }
};
```

### 8.3 Monitoring & Logging

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(config.logging.directory, 'error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join(config.logging.directory, 'combined.log')
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Structured logging
logger.info('Playlist sync started', {
  playlistId: 'PLxxx',
  operation: 'sync',
  userId: 'default'
});

logger.error('Sync failed', {
  playlistId: 'PLxxx',
  error: error.message,
  stack: error.stack,
  quotaUsed: 150
});
```

---

## Conclusion

This architecture provides:
- **Modularity**: Clear separation of concerns with well-defined interfaces
- **Scalability**: Efficient quota management and caching strategies
- **Reliability**: Robust error handling and retry mechanisms
- **Maintainability**: Clean code structure with comprehensive documentation
- **Security**: Encrypted credentials and secure data handling
- **Performance**: Multi-level caching and batch processing

The architecture supports current requirements while being extensible for future enhancements (video summarization, note-taking, analytics).
