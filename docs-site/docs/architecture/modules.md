# Modules

TubeArchive's business logic is organized into focused modules, each handling a specific domain.

## Module Overview

| Module | Location | Responsibility |
|--------|----------|----------------|
| Playlist | `src/modules/playlist/` | Playlist CRUD and management |
| Video | `src/modules/video/` | Video metadata and state |
| Sync | `src/modules/sync/` | YouTube synchronization |
| Analytics | `src/modules/analytics/` | Watch tracking and stats |
| Note | `src/modules/note/` | User notes and tags |
| Caption | `src/modules/caption/` | Caption extraction |
| Summarization | `src/modules/summarization/` | AI-powered summaries |
| Scheduler | `src/modules/scheduler/` | Automatic sync scheduling |
| Auth | `src/modules/auth/` | Authentication and tokens |
| Database | `src/modules/database/` | Prisma client |

## Playlist Module

### PlaylistManager

Manages playlist CRUD operations.

```typescript
class PlaylistManager {
  // Create or import a playlist
  async create(userId: string, data: CreatePlaylistInput): Promise<Playlist>

  // Get playlist by ID
  async getById(id: string, userId: string): Promise<Playlist | null>

  // List user's playlists
  async list(userId: string, options: ListOptions): Promise<PaginatedResult<Playlist>>

  // Update playlist
  async update(id: string, userId: string, data: UpdatePlaylistInput): Promise<Playlist>

  // Delete playlist
  async delete(id: string, userId: string): Promise<void>

  // Get playlist videos
  async getVideos(id: string, userId: string, options: ListOptions): Promise<PaginatedResult<Video>>
}
```

### Key Features

- URL parsing to extract playlist IDs
- Duplicate detection across user's playlists
- Video count tracking
- Sync status management

## Video Module

### VideoManager

Handles video metadata and user state.

```typescript
class VideoManager {
  // Get video with user state
  async getById(id: string, userId: string): Promise<VideoWithState | null>

  // List videos with filters
  async list(userId: string, options: VideoListOptions): Promise<PaginatedResult<Video>>

  // Update watch progress
  async updateProgress(videoId: string, userId: string, progress: number): Promise<void>

  // Mark video as complete
  async markComplete(videoId: string, userId: string): Promise<void>

  // Rate video
  async rate(videoId: string, userId: string, rating: number): Promise<void>

  // Toggle favorite
  async toggleFavorite(videoId: string, userId: string): Promise<boolean>
}
```

### Filter Options

```typescript
interface VideoListOptions {
  playlistId?: string;
  search?: string;
  status?: 'unwatched' | 'in_progress' | 'completed';
  tags?: string[];
  page?: number;
  limit?: number;
  sort?: 'title' | 'duration' | 'addedAt' | 'lastWatched';
  order?: 'asc' | 'desc';
}
```

## Sync Module

### SyncEngine

Orchestrates playlist synchronization with YouTube.

```typescript
class SyncEngine {
  // Sync a single playlist
  async syncPlaylist(playlistId: string, userId: string): Promise<SyncResult>

  // Sync all user's playlists
  async syncAll(userId: string): Promise<SyncResult[]>

  // Get sync status
  async getStatus(playlistId: string): Promise<SyncStatus>

  // Get sync history
  async getHistory(playlistId: string, options: ListOptions): Promise<SyncHistory[]>
}
```

### Sync Algorithm

```
1. Fetch current playlist state from YouTube
2. Load existing playlist items from database
3. Compute diff (added, removed, reordered)
4. Apply changes in transaction:
   - Insert new videos
   - Create new playlist items
   - Remove deleted playlist items
   - Update positions for reordered items
5. Update sync timestamp and status
6. Record in sync history
```

### SyncResult

```typescript
interface SyncResult {
  playlistId: string;
  status: 'completed' | 'failed';
  videosAdded: number;
  videosRemoved: number;
  duration: number;
  errors?: string[];
}
```

## Analytics Module

### AnalyticsTracker

Tracks watch sessions and computes statistics.

```typescript
class AnalyticsTracker {
  // Record a watch session
  async recordSession(userId: string, session: WatchSessionInput): Promise<void>

  // Get learning dashboard
  async getDashboard(userId: string): Promise<Dashboard>

  // Get video analytics
  async getVideoAnalytics(videoId: string, userId: string): Promise<VideoAnalytics>

  // Get playlist progress
  async getPlaylistProgress(playlistId: string, userId: string): Promise<PlaylistProgress>

  // Get learning streak
  async getLearningStreak(userId: string): Promise<LearningStreak>
}
```

### Dashboard Data

```typescript
interface Dashboard {
  totalVideos: number;
  totalWatchTime: number;
  completedVideos: number;
  inProgressVideos: number;
  completionRate: number;
  learningStreak: LearningStreak;
  recentActivity: RecentActivity[];
  topPlaylists: PlaylistProgress[];
}
```

## Note Module

### NoteManager

Manages user notes with timestamps and tags.

```typescript
class NoteManager {
  // Create a note
  async create(userId: string, videoId: string, data: CreateNoteInput): Promise<Note>

  // Get notes for video
  async getByVideo(userId: string, videoId: string, options: NoteListOptions): Promise<Note[]>

  // Update a note
  async update(noteId: string, userId: string, data: UpdateNoteInput): Promise<Note>

  // Delete a note
  async delete(noteId: string, userId: string): Promise<void>

  // Export notes
  async export(userId: string, options: ExportOptions): Promise<string>
}
```

### Export Formats

- **Markdown**: Organized by video with timestamps
- **JSON**: Structured data for integrations
- **CSV**: Spreadsheet-compatible format

## Caption Module

### CaptionExtractor

Retrieves and parses video captions.

```typescript
class CaptionExtractor {
  // Get available languages
  async getLanguages(videoId: string): Promise<CaptionLanguage[]>

  // Get captions in specific language
  async getCaptions(videoId: string, language: string): Promise<Caption[]>

  // Search within captions
  async search(videoId: string, query: string): Promise<CaptionSearchResult[]>
}
```

### Caption Format

```typescript
interface Caption {
  start: number;      // Start time in seconds
  duration: number;   // Duration in seconds
  text: string;       // Caption text
}
```

## Summarization Module

### Summarizer

Generates AI-powered video summaries.

```typescript
class Summarizer {
  // Generate summary from captions
  async summarize(
    videoId: string,
    userId: string,
    options: SummarizeOptions
  ): Promise<Summary>

  // Get existing summary
  async getSummary(videoId: string, userId: string): Promise<Summary | null>
}
```

### Summary Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| `brief` | 2-3 paragraphs | Quick overview |
| `detailed` | 5-7 paragraphs | Learning review |
| `comprehensive` | 10+ paragraphs | Deep reference |

## Scheduler Module

### ScheduleManager

Manages automatic sync schedules.

```typescript
class ScheduleManager {
  // Create schedule
  async create(playlistId: string, interval: number): Promise<SyncSchedule>

  // Update schedule
  async update(scheduleId: string, data: UpdateScheduleInput): Promise<SyncSchedule>

  // Delete schedule
  async delete(scheduleId: string): Promise<void>

  // Get due schedules
  async getDueSchedules(): Promise<SyncSchedule[]>

  // Process due schedules
  async processSchedules(): Promise<void>
}
```

## Auth Module

### AuthService

Handles authentication and token management.

```typescript
class AuthService {
  // Register new user
  async register(data: RegisterInput): Promise<AuthResult>

  // Login user
  async login(email: string, password: string): Promise<AuthResult>

  // Refresh tokens
  async refresh(refreshToken: string): Promise<AuthResult>

  // Logout (revoke refresh token)
  async logout(refreshToken: string): Promise<void>

  // Validate access token
  async validateToken(token: string): Promise<TokenPayload>
}
```

## Module Dependencies

```
┌─────────────┐
│    Auth     │◄──── All modules use for user context
└─────────────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│  Playlist   │────►│    Video    │
└─────────────┘     └─────────────┘
       │                   │
       ▼                   ▼
┌─────────────┐     ┌─────────────┐
│    Sync     │     │  Analytics  │
└─────────────┘     └─────────────┘
       │                   │
       ▼                   ▼
┌─────────────┐     ┌─────────────┐
│  Scheduler  │     │    Note     │
└─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Caption   │
                    └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ Summarizer  │
                    └─────────────┘
```

## Adding New Modules

1. Create module directory: `src/modules/[name]/`
2. Implement manager class with singleton pattern
3. Add Prisma models if needed
4. Create API routes and schemas
5. Write unit tests
6. Update documentation

## Next Steps

- [Database Schema](/docs/architecture/database) - Data models
- [Architecture Overview](/docs/architecture/overview) - System design
- [API Reference](/docs/api-reference/tubearchive-api) - Endpoints
