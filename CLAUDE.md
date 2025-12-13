# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

개인 지식관리 및 학습 플랫폼을 위한 YouTube 플레이리스트 동기화 모듈. YouTube 동영상 요약, 개인 메모, 학습 진도 관리를 지원하는 데이터 인프라를 제공합니다.

**Primary Purpose**: YouTube 플레이리스트를 로컬 데이터베이스에 동기화하여 동영상 메타데이터를 수집하고, 향후 요약/메모/분석 기능의 기반을 제공

## Technology Stack

- **Language**: TypeScript (Node.js 18+)
- **Database**: SQLite (development), PostgreSQL (production option)
- **ORM**: Prisma or TypeORM
- **API**: YouTube Data API v3 with OAuth 2.0
- **CLI**: Commander.js or Yargs
- **Scheduling**: node-cron or Bull
- **Testing**: Jest with 80%+ coverage target

## Project Structure

```
src/
├── api/              # YouTube API client and authentication
├── modules/
│   ├── playlist/     # Playlist management logic
│   ├── video/        # Video metadata collection
│   ├── sync/         # Sync scheduler and logic
│   └── database/     # Database models and queries
├── cli/              # CLI interface
├── config/           # Configuration management
└── utils/            # Shared utilities
```

## Core Architecture

### 1. YouTube API Client Module
- OAuth 2.0 token management (secure storage)
- Rate limiting wrapper (10,000 units/day quota)
- Error handling with exponential backoff retry
- Response caching for unchanged data

### 2. Playlist Manager Module
- Import playlists by URL/ID
- Detect changes (additions, deletions, reordering)
- Incremental sync (only changed items)
- Multi-playlist support with priority settings

### 3. Video Manager Module
- Collect metadata (title, description, duration, thumbnails, stats)
- Track watch status and position
- Detect duplicates across playlists
- Download and cache thumbnails

### 4. Sync Scheduler Module
- Configurable sync intervals
- Job queue management
- Failure handling and retry logic
- Sync status monitoring

### 5. Database Module
Core tables:
- `Playlists`: YouTube playlist metadata
- `Videos`: Video details and statistics
- `PlaylistItems`: Playlist-video relationships with position
- `UserVideoStates`: Watch status, notes, summaries, ratings

## Development Commands

```bash
# Setup
npm install
npx prisma generate
npx prisma migrate dev

# Development
npm run dev          # Run in development mode
npm run build        # Build TypeScript
npm start           # Run production build

# Testing
npm test            # Run all tests
npm run test:watch  # Watch mode
npm run test:cov    # Coverage report

# Database
npx prisma studio   # Database GUI
npx prisma migrate dev --name <name>  # Create migration
npx prisma db push  # Push schema changes

# CLI
npm run cli -- sync <playlist-url>     # Sync a playlist
npm run cli -- list                    # List synced playlists
npm run cli -- schedule --interval 1h  # Schedule auto-sync
```

## Critical Implementation Notes

### API Quota Management
- YouTube API quota: 10,000 units/day (default)
- Playlist details: 1 unit
- PlaylistItems (50): 1 unit
- Videos batch (50): 1 unit
- **Strategy**: Cache aggressively, use incremental sync, batch requests (50 items)

### Sync Logic
1. Fetch current playlist state from YouTube
2. Compare with local database
3. Detect changes (diff algorithm)
4. Apply changes in transaction
5. Update sync timestamp

### Error Handling
- Network failures: Exponential backoff retry (max 5 attempts)
- API quota exceeded: Queue for next day
- Invalid tokens: Trigger re-authentication
- Data corruption: Rollback transaction

### Security
- OAuth tokens encrypted at rest
- API keys in `.env` (never commit)
- No external data transmission (local only)
- Validate all API responses

## Data Flow

```
YouTube API → API Client → Playlist Manager → Database
                ↓              ↓
           Video Manager → Sync Scheduler
```

1. **Import**: User provides playlist URL → API fetches data → Store in DB
2. **Sync**: Scheduler triggers → Fetch updates → Diff with DB → Apply changes
3. **Query**: CLI/API queries DB for playlist/video information

## Performance Targets

- 100-video playlist sync: < 30 seconds
- API response time: < 2 seconds (p95)
- Concurrent playlist sync: 5 playlists
- Database size: < 500MB (average)
- Success rate: > 99%

## Testing Strategy

- **Unit tests**: All business logic modules
- **Integration tests**: Database operations, API client
- **E2E tests**: Full sync workflows
- **Coverage target**: 80%+

## Future Enhancements (Phase 2)

See PRD.md for detailed specifications:
- Video summarization (YouTube captions + AI)
- Timestamp-based note-taking
- Learning analytics and progress tracking
- Web UI (optional)
