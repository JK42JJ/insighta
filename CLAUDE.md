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

## Work Delegation Rules

### Supabase 작업 위임 (필수 준수)

⚠️ **MANDATORY**: Supabase 관련 모든 작업은 반드시 `supabase-dev` subagent에게 위임하여 수행할 것.

| 작업 유형 | 위임 대상 | 비고 |
|----------|----------|------|
| Edge Functions 개발/수정 | `supabase-dev` | `superbase/volumes/functions/` |
| Kong API Gateway 설정 | `supabase-dev` | `superbase/volumes/api/kong.template.yml` |
| Supabase 마이그레이션 | `supabase-dev` | SQL migrations |
| Docker Compose 설정 | `supabase-dev` | Supabase 서비스 관련 |
| Supabase Auth 설정 | `supabase-dev` | GoTrue 설정 |

```bash
# Task tool 사용 예시
Task(subagent_type="supabase-dev", prompt="Edge Function 수정: ...")
```

**관련 파일 경로**:
- Edge Functions: `/Users/jeonhokim/cursor/superbase/volumes/functions/`
- Kong 설정: `/Users/jeonhokim/cursor/superbase/volumes/api/`
- Docker: `/Users/jeonhokim/cursor/superbase/docker-compose.yml`

### Adapter 개발 위임 (필수 준수)

⚠️ **MANDATORY**: 데이터 소스 어댑터 관련 모든 작업은 반드시 `adapter-dev` subagent에게 위임하여 수행할 것.

| 작업 유형 | 위임 대상 | 비고 |
|----------|----------|------|
| 새 어댑터 구현 | `adapter-dev` | OAuth, Feed, File 카테고리 |
| 어댑터 테스트 작성 | `adapter-dev` | MSW 기반 통합 테스트 |
| JSON Schema 정의 | `adapter-dev` | Frontend 폼 자동 생성용 |
| 어댑터 버그 수정 | `adapter-dev` | 기존 어댑터 유지보수 |
| 어댑터 기능 확장 | `adapter-dev` | 기존 어댑터 기능 추가 |

```bash
# Task tool 사용 예시
Task(subagent_type="adapter-dev", prompt="RSS 어댑터 구현: ...")
Task(subagent_type="adapter-dev", prompt="Notion 어댑터 OAuth 연동: ...")
Task(subagent_type="adapter-dev", prompt="Markdown 어댑터 frontmatter 파싱: ...")
```

**어댑터 카테고리**:
- **OAuth**: YouTube, Notion, Google Drive, LinkedIn (OAuth 2.0 기반)
- **Feed**: RSS, Atom (피드 기반)
- **File**: Markdown, PDF, DOCX, PPTX, TXT (파일 파서)

**관련 파일 경로**:
- Base 클래스: `src/adapters/core/`, `src/adapters/oauth/`, `src/adapters/feed/`, `src/adapters/file/`
- 어댑터 구현: `src/adapters/{category}/{name}/`
- Skill: `.claude/skills/adapter-patterns/SKILL.md`

**Scaffolding 명령**:
```bash
npm run create:adapter -- --name <name> --category <oauth|feed|file>
```

### Frontend 개발 위임 (필수 준수)

⚠️ **MANDATORY**: Frontend UI 관련 모든 작업은 반드시 `frontend-dev` subagent에게 위임하여 수행할 것.

| 작업 유형 | 위임 대상 | 비고 |
|----------|----------|------|
| React 컴포넌트 개발/수정 | `frontend-dev` | `frontend/src/components/` |
| 커스텀 훅 개발/수정 | `frontend-dev` | `frontend/src/hooks/` |
| 상태 관리 (React Query, Context) | `frontend-dev` | 플로팅 윈도우, UI 설정 등 |
| UI 버그 수정 | `frontend-dev` | 무한 루프, 렌더링 이슈 |
| 접근성/반응형 디자인 | `frontend-dev` | WCAG 2.1 AA 준수 |

```bash
# Task tool 사용 예시
Task(subagent_type="frontend-dev", prompt="플로팅 윈도우 위치 저장 기능 수정: ...")
Task(subagent_type="frontend-dev", prompt="만다라트 컴포넌트 상태 관리 개선: ...")
Task(subagent_type="frontend-dev", prompt="useUIPreferences 훅 디버깅: ...")
```

**기술 스택**:
- **Framework**: React 18+ with TypeScript
- **State**: TanStack Query (React Query), Zustand
- **UI**: shadcn/ui, Radix UI, Tailwind CSS
- **Build**: Vite

**관련 파일 경로**:
- 컴포넌트: `frontend/src/components/`
- 훅: `frontend/src/hooks/`
- 페이지: `frontend/src/pages/`
- 타입: `frontend/src/types/`
- Agent 설정: `.claude/agents/frontend-dev.md`

---

## Protected Folders & Files

⚠️ **절대 삭제 금지 (DO NOT DELETE)**:

| Path | Description |
|------|-------------|
| `prompt/*.md` | 사용자 개인 작업 파일. 정리/삭제 대상 아님 |

작업 중 폴더 정리 시 위 경로의 파일은 반드시 보존할 것.

## Future Enhancements (Phase 2)

See PRD.md for detailed specifications:
- Video summarization (YouTube captions + AI)
- Timestamp-based note-taking
- Learning analytics and progress tracking
- Web UI (optional)
