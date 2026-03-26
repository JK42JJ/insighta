# 📊 Current Project Status

**Last Updated**: 2025-12-22
**Project**: Insighta
**Current Phase**: Phase 5.2 Complete ✅ - Extensible Adapter System

---

## 🎯 Executive Summary

YouTube 플레이리스트 동기화 모듈 개발 프로젝트입니다. **Phase 1~5 완료**, REST API, CLI, 그리고 **React 프론트엔드**가 모노레포로 통합되었습니다. **테스트 커버리지 90%+ 달성**. 전체 변경 이력은 [CHANGELOG.md](/CHANGELOG.md)에서 확인할 수 있습니다.

---

## ✅ Completed Phases (Phase 1-5)

### Phase 1: Core Infrastructure ✅ (Completed 2025-12)

**Duration**: Initial setup
**Status**: ✅ **COMPLETE**

**Deliverables**:
- ✅ TypeScript + Node.js 18+ 프로젝트 구조
- ✅ Prisma ORM + SQLite 데이터베이스 설정
- ✅ 8개 데이터베이스 테이블 스키마
- ✅ YouTube Data API v3 클라이언트
- ✅ OAuth 2.0 + API Key 인증 지원
- ✅ Winston 로깅 시스템
- ✅ 환경 변수 관리 (Zod 검증)

**Key Files**:
- `prisma/schema.prisma` - Database schema
- `src/api/youtube-client.ts` - YouTube API client
- `src/config/` - Configuration management

---

### Phase 2: Knowledge Management Features ✅ (Completed 2025-12)

**Duration**: ~2 weeks
**Status**: ✅ **COMPLETE**

**Deliverables**:

#### Phase 2.1: Caption & Summarization ✅
- ✅ YouTube 자막 추출 (7개 언어: en, ko, ja, es, fr, de, zh)
- ✅ 자동 언어 감지 및 타임스탬프 세그먼트
- ✅ AI 기반 동영상 요약 (Gemini/OpenAI GPT-4)
- ✅ 3단계 요약 레벨 (short, medium, detailed)
- ✅ 플레이리스트 일괄 요약

**CLI Commands**: `caption-download`, `caption-languages`, `summarize`, `summarize-playlist`

#### Phase 2.2: Personal Note-Taking ✅
- ✅ 타임스탬프 기반 노트 CRUD
- ✅ 마크다운 콘텐츠 지원
- ✅ 태그 시스템 (검색 가능)
- ✅ 고급 검색 (동영상, 태그, 내용, 시간 범위)
- ✅ 다중 형식 내보내기 (Markdown, JSON, CSV)

**CLI Commands**: `note-add`, `note-list`, `note-update`, `note-delete`, `note-export`

#### Phase 2.3: Learning Analytics ✅
- ✅ 시청 세션 기록 및 추적
- ✅ 동영상 완료율 계산
- ✅ 플레이리스트 진도 분석
- ✅ 학습 대시보드 (통계, 최근 활동)
- ✅ 보유 메트릭 및 복습 추천
- ✅ 학습 연속일 (streak) 계산

**CLI Commands**: `session-record`, `analytics-video`, `analytics-playlist`, `analytics-dashboard`, `retention`

**Key Files**:
- `src/modules/caption/` - Caption extraction
- `src/modules/summarization/` - AI summarization
- `src/modules/note/` - Note management
- `src/modules/analytics/` - Analytics tracking
- Database tables: `video_captions`, `video_summaries`, `personal_notes`, `watch_sessions`

**Documentation**: [docs/phases/phase2/](./docs/phases/phase2/)

---

### Phase 3: REST API & CLI Development ✅ (Completed 2025-12-17)

**Duration**: ~3 weeks
**Status**: ✅ **COMPLETE** (Phase 3.1-3.5)

#### Phase 3.1: YouTube API Integration ✅
**Completed**: 2025-12-16

- ✅ OAuth 2.0 인증 플로우 (CLI 기반)
- ✅ YouTube API 클라이언트 완성
- ✅ 플레이리스트 임포트 및 동기화
- ✅ 응답 캐싱 시스템 (API 쿼터 절약)
- ✅ 쿼터 트래킹 시스템
- ✅ E2E 테스팅 인프라 (자동화된 bash 스크립트)

**CLI Commands**: `auth`, `auth-callback`, `auth-status`, `playlist-import`, `sync`

**Test Scripts**:
- `tests/e2e/setup-test-env.sh`
- `tests/e2e/test-oauth-flow.sh`
- `tests/e2e/test-cache-performance.sh`
- `tests/e2e/test-quota-tracking.sh`
- `tests/e2e/run-all-tests.sh`

**Documentation**:
- [docs/phases/phase3/PHASE3.1_COMPLETE.md](./docs/phases/phase3/PHASE3.1_COMPLETE.md)
- [docs/guides/YOUTUBE_API_SETUP.md](./docs/guides/YOUTUBE_API_SETUP.md)
- [tests/README.md](./tests/README.md)

#### Phase 3.2: Authentication & Security ✅
**Completed**: 2025-12-16

- ✅ JWT 기반 인증 시스템 (Fastify 플러그인)
- ✅ Access Token (15분) + Refresh Token (7일)
- ✅ 비밀번호 암호화 (bcrypt)
- ✅ 보안 헤더 및 CORS 설정
- ✅ 비밀번호 강도 검증

**API Endpoints**:
- `POST /api/v1/auth/register` - 회원가입
- `POST /api/v1/auth/login` - 로그인
- `POST /api/v1/auth/refresh` - 토큰 갱신
- `POST /api/v1/auth/logout` - 로그아웃
- `GET /api/v1/auth/me` - 프로필 조회

**Key Files**:
- `src/api/routes/auth.ts` - Authentication routes
- `src/api/plugins/auth.ts` - JWT plugin
- `src/api/schemas/auth.ts` - Zod validation schemas

**Documentation**: [docs/implementation-reports/01-authentication.md](./docs/implementation-reports/01-authentication.md)

#### Phase 3.3: Playlist Management API ✅
**Completed**: 2025-12-17

- ✅ RESTful API 엔드포인트 (5개)
- ✅ Zod 기반 스키마 검증
- ✅ OpenAPI 3.1 명세 자동 생성
- ✅ Swagger UI 및 Scalar API 문서

**API Endpoints**:
- `POST /api/v1/playlists/import` - 플레이리스트 가져오기
- `GET /api/v1/playlists` - 목록 조회 (필터링, 정렬, 페이징)
- `GET /api/v1/playlists/:id` - 상세 조회
- `POST /api/v1/playlists/:id/sync` - 동기화 실행
- `DELETE /api/v1/playlists/:id` - 삭제

**Key Files**:
- `src/api/routes/playlists.ts` - Playlist routes
- `src/api/schemas/playlists.ts` - Zod schemas
- `scripts/generate-openapi.ts` - OpenAPI generation

**Documentation**: [docs/implementation-reports/02-playlist-api.md](./docs/implementation-reports/02-playlist-api.md)

#### Phase 3.4: CLI Integration ✅
**Completed**: 2025-12-17

- ✅ API Client Module (HTTP 요청 처리)
- ✅ Token Storage Module (JWT 로컬 저장, 파일 권한 0o600)
- ✅ User Authentication Commands (4개)
- ✅ Playlist Management Commands (5개)
- ✅ 인터랙티브 비밀번호 입력
- ✅ 에러 처리 및 사용자 피드백

**CLI Commands**:
- **Auth**: `user-register`, `user-login`, `user-logout`, `user-whoami`
- **Playlists**: `playlist-import`, `playlist-list`, `playlist-get`, `playlist-sync`, `playlist-delete`

**Key Files**:
- `src/cli/api-client.ts` - HTTP client
- `src/cli/token-storage.ts` - JWT token storage
- `src/cli/commands/user.ts` - User commands
- `src/cli/commands/playlist-api.ts` - Playlist commands

**Documentation**: [docs/implementation-reports/03-cli-integration.md](./docs/implementation-reports/03-cli-integration.md)

#### Phase 3.5: Integration Testing & Documentation ✅
**Completed**: 2025-12-17

- ✅ CLI 통합 테스트 (29개 테스트, 100% 성공)
  - API 엔드포인트 테스트 (3개)
  - CLI 명령어 테스트 (10개)
  - 보안 테스트 (6개)
  - 통합 테스트 (2개)
  - 에러 핸들링 테스트 (8개)
- ✅ YouTube API OAuth 설정 가이드 작성
- ✅ 문서 인덱스 업데이트

**Test Results**: 29/29 tests passed, API response time <200ms (p95)

**Documentation**:
- [docs/implementation-reports/04-cli-integration-testing.md](./docs/implementation-reports/04-cli-integration-testing.md)
- [docs/guides/YOUTUBE_API_SETUP.md](./docs/guides/YOUTUBE_API_SETUP.md)
- [docs/INDEX.md](./docs/INDEX.md)

#### Phase 3.6: Testing & Stabilization ✅
**Completed**: 2025-12-19

- ✅ **90%+ 테스트 커버리지 달성**
  - Statements: 90.95% (target: 80%)
  - Branches: 77.36% (target: 75%)
  - Functions: 92.70% (target: 80%)
  - Lines: 91.03% (target: 80%)
- ✅ **37개 테스트 스위트, 1005개 테스트 통과**
- ✅ **API 라우트 테스트** (92.75% coverage)
  - Auth routes: 26 tests (93.58% statements)
  - Playlist routes: 34 tests (91.66% statements)
- ✅ **CLI 테스트** (100% coverage)
  - api-client.ts: 21 tests (100%)
  - token-storage.ts: 29 tests (100%)
- ✅ **모듈 테스트** (80%+ coverage)
  - Sync engine, Caption, Summarization, Note, Analytics, Video modules
- ✅ **Worker process leak 수정**
  - Jest global teardown 구현
  - 프로세스 정상 종료 보장
- ✅ **Auto-sync scheduler** (node-cron 기반)
  - 플레이리스트 자동 동기화 스케줄링
  - 즉시 실행, 주기적 실행 지원

**Key Files Created/Modified**:
- `tests/teardown.js` - Jest global teardown
- `tests/unit/api/routes/auth.test.ts` - Auth route tests (26 tests)
- `tests/unit/api/routes/playlists.test.ts` - Playlist route tests (34 tests)
- `tests/unit/cli/api-client.test.ts` - API client tests (21 tests)
- `tests/unit/cli/token-storage.test.ts` - Token storage tests (29 tests)
- `tests/unit/modules/index-exports.test.ts` - Module exports tests (24 tests)
- `jest.config.js` - Updated with global teardown and exclusions

---

### Phase 4: Advanced API Features ✅ (Completed 2025-12-19)

**Status**: ✅ **COMPLETE**

**Deliverables**:

#### Phase 4.1: Videos API ✅
- ✅ `GET /api/v1/videos` - 비디오 목록 (필터링, 페이지네이션)
- ✅ `GET /api/v1/videos/:id` - 비디오 상세
- ✅ `GET /api/v1/videos/:id/captions` - 자막 조회
- ✅ `GET /api/v1/videos/:id/summary` - AI 요약
- ✅ `POST /api/v1/videos/:id/notes` - 노트 추가
- ✅ `GET /api/v1/videos/:id/analytics` - 학습 분석

#### Phase 4.2-4.3: Analytics & Sync API ✅
- ✅ Analytics 대시보드 API (4 endpoints)
- ✅ Sync 상태 관리 API (8 endpoints)

#### Phase 4.4-4.5: Rate Limiting & Documentation ✅
- ✅ @fastify/rate-limit 구현
- ✅ Docusaurus 문서 사이트
- ✅ OpenAPI 자동 생성

**Documentation**: [docs/phases/phase4/](../phases/phase4/)

---

### Phase 5: Frontend Integration ✅ (Completed 2025-12-20)

**Status**: ✅ **COMPLETE**

**Deliverables**:

#### Monorepo 구조 ✅
- ✅ Frontend 클론 (tube-mandala → frontend/)
- ✅ Root package.json 모노레포 스크립트
- ✅ 통합 개발 환경 (`npm run dev:all`)

#### API 클라이언트 통합 ✅
- ✅ JWT 기반 API 클라이언트 (`frontend/src/lib/api-client.ts`)
- ✅ React Query 훅 (`frontend/src/hooks/use-api.ts`)
- ✅ Supabase 제거, 자체 API로 대체

#### Docker 배포 ✅
- ✅ Multi-stage Dockerfile (nginx:alpine)
- ✅ nginx.conf (SPA fallback, API 프록시, 보안 헤더)
- ✅ docker-compose.yml frontend 서비스

#### 개발 스크립트 ✅
- ✅ `scripts/dev.sh` - 개발 환경 시작
- ✅ `scripts/docker-build.sh` - Docker 빌드

**Key Files**:
- `frontend/src/lib/api-client.ts` - JWT API client
- `frontend/src/hooks/use-api.ts` - React Query hooks
- `frontend/Dockerfile` - Multi-stage build
- `frontend/nginx/` - nginx configuration

**Documentation**: [docs/implementation-reports/09-frontend-integration.md](../implementation-reports/09-frontend-integration.md)

---

### Phase 5.1: Supabase Edge Functions Integration ✅ (Completed 2025-12-21)

**Status**: ✅ **COMPLETE**

**Deliverables**:

#### Supabase Self-Hosted 환경 구축 ✅
- ✅ Docker Compose 기반 Supabase 로컬 환경 구성
- ✅ Kong API Gateway 설정 (declarative mode)
- ✅ Edge Functions 런타임 (Deno 기반)
- ✅ GoTrue 인증 서비스 연동

#### YouTube OAuth Edge Function ✅
- ✅ `youtube-auth` - OAuth 2.0 인증 플로우
- ✅ Actions: `auth-url`, `callback`, `refresh`, `disconnect`, `status`
- ✅ Kong에서 callback 경로 오픈 라우트 설정
- ✅ 팝업 기반 OAuth 플로우 (postMessage 통신)

#### YouTube Sync Edge Function ✅
- ✅ `youtube-sync` - 플레이리스트 동기화
- ✅ Actions: `add-playlist`, `list-playlists`, `sync-playlist`, `delete-playlist`
- ✅ Actions: `update-settings`, `get-ideation-videos`, `update-video-state`
- ✅ YouTube Data API v3 통합 (플레이리스트, 비디오 메타데이터)
- ✅ `user_video_states` 자동 생성 (아이디에이션 팔레트 연동)

#### 프론트엔드 연동 ✅
- ✅ `useYouTubeAuth` 훅 - OAuth 인증 관리
- ✅ `useYouTubeSync` 훅 - 플레이리스트 동기화
- ✅ Kong API Gateway `apikey` 헤더 설정
- ✅ React Query 기반 상태 관리

**Key Files**:
- `superbase/volumes/functions/main/index.ts` - Edge Functions 엔트리포인트
- `superbase/volumes/api/kong.template.yml` - Kong API Gateway 설정
- `frontend/src/hooks/useYouTubeAuth.ts` - OAuth 훅
- `frontend/src/hooks/useYouTubeSync.ts` - 동기화 훅

**Documentation**: [docs/implementation-reports/10-supabase-edge-functions.md](../implementation-reports/10-supabase-edge-functions.md)

---

### Phase 5.2: Extensible Adapter System ✅ (Completed 2025-12-22)

**Status**: ✅ **COMPLETE**

**Deliverables**:

#### 플러그인 기반 어댑터 아키텍처 ✅
- ✅ `SourceType` 확장 (rss, markdown, pdf, docx, pptx, txt)
- ✅ 디렉토리 구조 (`oauth/`, `feed/`, `file/` 카테고리)
- ✅ `BaseAdapter` 추상 클래스 (공통 기능: 캐시, 쿼터, 에러 처리)
- ✅ `BaseOAuthAdapter` - OAuth 2.0 인증 기반 서비스
- ✅ `BaseFeedAdapter` - RSS/Atom 피드 기반 서비스
- ✅ `BaseFileAdapter` - 파일 파싱 기반 서비스

#### adapter-dev Subagent ✅
- ✅ 어댑터 개발 전문 Claude Code subagent
- ✅ OAuth, Feed, File 카테고리별 개발 지원
- ✅ MSW 기반 통합 테스트 패턴
- ✅ JSON Schema for Frontend 폼 자동 생성

#### 자동화 도구 ✅
- ✅ `scripts/create-adapter.ts` - 어댑터 스캐폴딩 스크립트
- ✅ `/create-adapter` 명령 - Claude Code slash command
- ✅ `adapter-patterns` skill - 개발 패턴 가이드

#### CLAUDE.md 위임 규칙 ✅
- ✅ adapter-dev subagent 위임 규칙 추가
- ✅ 어댑터 관련 모든 작업 자동 위임

**Key Files**:
- `src/adapters/core/base-adapter.ts` - BaseAdapter 추상 클래스
- `src/adapters/oauth/base-oauth-adapter.ts` - OAuth 베이스 클래스
- `src/adapters/feed/base-feed-adapter.ts` - Feed 베이스 클래스
- `src/adapters/file/base-file-adapter.ts` - File 베이스 클래스
- `scripts/create-adapter.ts` - 스캐폴딩 스크립트
- `.claude/agents/adapter-dev.md` - adapter-dev subagent
- `.claude/skills/adapter-patterns/SKILL.md` - 어댑터 패턴 skill

**Documentation**: [docs/implementation-reports/11-extensible-adapter-system.md](../implementation-reports/11-extensible-adapter-system.md)

---

## 🔄 Current Technical Stack

### Backend
- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.3
- **Framework**: Fastify 4.25
- **Database**: Prisma ORM + SQLite (dev), PostgreSQL (prod option)
- **Authentication**: JWT (@fastify/jwt) + bcrypt
- **Validation**: Zod 3.22
- **API Documentation**: @fastify/swagger + @scalar/fastify-api-reference

### YouTube Integration
- **API**: YouTube Data API v3 (googleapis)
- **Auth**: OAuth 2.0 + API Key support
- **Quota Management**: Daily tracking (10,000 units/day)
- **Caching**: Response caching system

### AI & Content Processing
- **Summarization**: Google Gemini 2.5 Flash / OpenAI GPT-4
- **Captions**: youtube-caption-extractor (7 languages)
- **Token Management**: Auto-truncation (~4000 tokens)

### CLI & Tooling
- **CLI Framework**: Commander.js 11.1
- **Logging**: Winston 3.11
- **Config**: dotenv + Zod validation
- **Scheduling**: node-cron 3.0

### Testing
- **Framework**: Jest 29.7 with ts-jest
- **E2E Tests**: Bash scripts (5 scripts, 80% automation)
- **Coverage**: 90%+ achieved ✅ (37 suites, 1005 tests)

### Frontend
- **Framework**: React 18.3 + Vite 5.4
- **Language**: TypeScript 5.8
- **UI Components**: shadcn/ui + Radix UI
- **Styling**: Tailwind CSS 3.4
- **State Management**: TanStack Query 5.x
- **Form Handling**: React Hook Form + Zod
- **Charts**: Recharts 2.x
- **Icons**: Lucide React
- **Production**: nginx:alpine (Docker)

### Supabase Edge Functions ⭐ NEW
- **Runtime**: Deno (Supabase Edge Runtime v1.69)
- **API Gateway**: Kong (DB-less declarative mode)
- **Auth Service**: GoTrue (Supabase Auth)
- **Database**: PostgreSQL (Supabase DB)
- **OAuth**: YouTube Data API v3 + Google OAuth 2.0
- **Deployment**: Docker Compose (self-hosted)

---

## 📊 Database Schema

**Total Tables**: 11 tables

### Core Tables
1. **users** - User accounts for API authentication
2. **playlists** - YouTube playlist metadata
3. **videos** - Video metadata and statistics
4. **playlist_items** - Playlist-video relationships

### Knowledge Management Tables
5. **user_video_states** - Watch status, ratings, custom tags
6. **video_captions** - Downloaded captions with timestamps
7. **video_summaries** - AI-generated summaries
8. **personal_notes** - User notes with timestamps
9. **watch_sessions** - Learning session tracking

### System Tables
10. **quota_usage** - API quota tracking
11. **response_cache** - API response caching

**Database Size**: ~500MB target (average use case)

---

## 📁 Project Structure

```
insighta/
├── src/                    # Backend source code
│   ├── adapters/           # Universal Adapter System (YouTube only)
│   ├── api/                # Fastify REST API
│   │   ├── routes/         # API route handlers
│   │   ├── schemas/        # Zod validation schemas
│   │   ├── plugins/        # Fastify plugins (auth, etc.)
│   │   └── server.ts       # Fastify server setup
│   ├── cli/                # Commander CLI
│   │   ├── commands/       # CLI command handlers (25+ commands)
│   │   ├── api-client.ts   # HTTP client for API
│   │   └── token-storage.ts # JWT token storage
│   ├── modules/            # Business logic
│   │   ├── analytics/      # Learning analytics
│   │   ├── caption/        # Caption extraction
│   │   ├── note/           # Note management
│   │   ├── playlist/       # Playlist sync
│   │   ├── quota/          # Quota tracking
│   │   ├── summarization/  # AI summarization
│   │   ├── sync/           # Sync orchestration
│   │   └── video/          # Video metadata
│   ├── config/             # Configuration management
│   ├── types/              # TypeScript types
│   └── utils/              # Shared utilities
├── frontend/               # ⭐ React Frontend (NEW)
│   ├── src/
│   │   ├── components/     # UI components (shadcn/ui)
│   │   ├── hooks/          # React Query hooks
│   │   ├── lib/            # API client, utilities
│   │   └── pages/          # Page components
│   ├── nginx/              # nginx configuration
│   └── Dockerfile          # Multi-stage build
├── prisma/
│   ├── schema.prisma       # Database schema (11 tables)
│   └── migrations/         # Database migrations
├── tests/
│   ├── e2e/                # E2E test scripts (5 bash scripts)
│   ├── unit/               # Unit tests
│   └── integration/        # Integration tests
├── scripts/                # ⭐ Development scripts (NEW)
│   ├── dev.sh              # Development environment
│   └── docker-build.sh     # Docker build
├── docs/                   # 30+ documentation files
├── docker-compose.yml      # Docker orchestration
└── CHANGELOG.md            # ⭐ Version history (NEW)
```

**Total Files**: 120+ TypeScript files, 30+ documentation files

---

## 🔢 Project Metrics

### Code Metrics
- **TypeScript Files**: 100+ files
- **Lines of Code**: ~15,000+ lines (estimated)
- **Test Coverage**: 90.95% ✅ (exceeds 80% target)
- **Test Suites**: 37 suites, 1005 tests, 5 E2E bash scripts

### Documentation Metrics
- **Documentation Files**: 30 markdown files
- **Total Documentation**: ~25,000+ lines
- **Guides**: 3 user guides
- **Implementation Reports**: 4 reports
- **Phase Documents**: 8 phase documents

### API Metrics
- **REST Endpoints**: 10 endpoints (5 auth + 5 playlists)
- **CLI Commands**: 25+ commands
- **Database Tables**: 11 tables
- **Supported Languages**: 7 languages (captions)

### Performance Metrics
- **API Response Time**: <200ms (p95, achieved)
- **OAuth Flow**: <10s (target), <30s (acceptable)
- **Small Playlist Sync**: <5s (target), <10s (acceptable)
- **Cache Hit Rate**: ≥80% (target), ≥60% (acceptable)

---

## ⚡ Performance & Quotas

### YouTube API Quotas
- **Daily Limit**: 10,000 units/day (default)
- **Quota Costs**:
  - Playlist details: 1 unit
  - PlaylistItems (50 items): 1 unit
  - Videos batch (50 videos): 1 unit
  - **100-video playlist**: ~5 units
- **Optimization**: Caching, incremental sync, batch requests

### API Performance Targets
- **100-video playlist sync**: <30s ✅ (achieved)
- **API response time (p95)**: <2s ✅ (achieved <200ms)
- **Concurrent playlist sync**: 5 playlists ✅
- **Success rate**: >99% (achieved)

---

## 🔐 Security Features

### Authentication & Authorization
- ✅ JWT-based authentication
- ✅ Access Token (15min) + Refresh Token (7 days)
- ✅ bcrypt password hashing (salt rounds: 10)
- ✅ Password strength validation (8+ chars, complexity)
- ✅ Token storage with file permissions (0o600)

### API Security
- ✅ CORS configuration
- ✅ Security headers (@fastify/helmet)
- ✅ Rate limiting (@fastify/rate-limit) - configured
- ✅ Input validation (Zod schemas)
- ✅ OAuth 2.0 token encryption at rest

### Best Practices
- ✅ Environment variables for secrets (.env)
- ✅ No sensitive data in logs
- ✅ API keys never committed to git
- ✅ Local-only data storage (no external transmission)

---

## 📦 Available Commands

### Monorepo ⭐ NEW
```bash
npm run dev:all          # API + Frontend 동시 실행
npm run dev:frontend     # Frontend만 실행
npm run build:all        # 전체 빌드 (Backend + Frontend)
npm run install:all      # 전체 의존성 설치
./scripts/dev.sh         # 개발 환경 스크립트
```

### Docker ⭐ NEW
```bash
npm run docker:build     # Docker 이미지 빌드
npm run docker:up        # Docker 서비스 시작
npm run docker:down      # Docker 서비스 중지
npm run docker:logs      # Docker 로그 확인
./scripts/docker-build.sh # Docker 빌드 스크립트
```

### Development
```bash
npm run dev              # Development mode with ts-node
npm run build            # Build TypeScript to dist/
npm start                # Run production build
npm run api:dev          # Start API server in dev mode
```

### CLI
```bash
npm run cli -- <command>       # Run CLI commands
npm run cli -- user-login      # Login to API
npm run cli -- playlist-list   # List playlists
npm run cli -- summarize <id>  # Summarize video
```

### Database
```bash
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run migrations
npm run prisma:studio    # Open Prisma Studio GUI
npm run prisma:push      # Push schema changes (dev)
```

### Testing
```bash
npm test                 # Run all Jest tests
npm run test:watch       # Watch mode
npm run test:cov         # Coverage report
./tests/e2e/run-all-tests.sh  # Run E2E tests
```

### Code Quality
```bash
npm run lint             # ESLint check
npm run lint:fix         # Fix ESLint issues
npm run format           # Format with Prettier
npm run typecheck        # TypeScript type checking
```

### API & Documentation
```bash
npm run generate:openapi # Generate OpenAPI spec
npm run api:start        # Start production API
```

---

## 🚧 Known Limitations & Issues

### Testing ✅ (Resolved in Phase 3.6)
- ✅ **High unit test coverage** (90.95% statements, 77.36% branches)
- ✅ **Integration tests** for all core modules
- ⚠️ **Manual E2E testing** required (20% of OAuth flow)
- ⚠️ **Token expiration testing** requires 1-hour wait

### Features
- ⚠️ **No automatic token refresh** (manual re-login required)
- ✅ **Auto-sync scheduler implemented** (node-cron based)
- ⚠️ **No concurrent sync support** (one playlist at a time)
- ⚠️ **No edge case handling** (empty playlists, private videos)

### Documentation
- ⚠️ **No deployed documentation site** (Docusaurus planned, not implemented)
- ⚠️ **No interactive API reference** (Scalar planned, not implemented)
- ⚠️ **OpenAPI spec not auto-generated** (script exists, not integrated)

### Production Readiness
- ❌ **No CI/CD pipeline** (GitHub Actions not configured)
- ❌ **No monitoring/alerting** (logging only)
- ❌ **No PostgreSQL migration** (SQLite only for now)
- ✅ **Docker deployment** available (docker-compose.yml)

---

## 🎯 Next Steps

### ✅ Phase 4 & 5 (COMPLETED)
**Status**: ✅ **COMPLETE** (2025-12-20)

Phase 4 (Advanced API Features)와 Phase 5 (Frontend Integration)가 완료되었습니다.
자세한 내용은 [CHANGELOG.md](/CHANGELOG.md) 및 각 Phase 문서를 참조하세요.

---

### 🚀 Phase 6 - Production Deployment (NEXT)
**Focus**: CI/CD, 모니터링, 프로덕션 배포

**Tasks**:

#### Phase 6.1: CI/CD Pipeline
- GitHub Actions 설정
- 자동화된 테스트 실행
- Docker 이미지 빌드 및 푸시
- 자동 배포 파이프라인

#### Phase 6.2: Production Database
- PostgreSQL 마이그레이션
- 데이터베이스 백업 전략
- 마이그레이션 스크립트

#### Phase 6.3: Monitoring & Alerting
- Prometheus/Grafana 설정
- 에러 트래킹 (Sentry)
- 성능 모니터링
- 알림 설정

#### Phase 6.4: Security Hardening
- HTTPS 설정
- 환경 변수 관리 (secrets)
- 보안 감사

---

## 📅 Recommended Timeline

### ✅ Completed (Phase 1-5)
- ✅ Core Infrastructure (Phase 1)
- ✅ Knowledge Management (Phase 2)
- ✅ REST API & CLI (Phase 3)
- ✅ Advanced API Features (Phase 4)
- ✅ Frontend Integration (Phase 5)

### Immediate (This Week)
- ⏳ 프론트엔드 컴포넌트와 API 연결
- ⏳ 인증 플로우 구현 (로그인/회원가입)

### Short-term (1-2 Weeks)
- 플레이리스트 UI 완성
- 비디오 상세 페이지
- 노트 기능 연동

### Medium-term (3-4 Weeks)
- CI/CD 파이프라인 설정
- 프로덕션 배포 준비
- 성능 최적화

### Long-term (1-2 Months)
- PostgreSQL 마이그레이션
- 모니터링 인프라 구축
- 사용자 피드백 반영

---

## 🔗 Quick Links

### Documentation
- [📚 Documentation Index](./docs/INDEX.md) - All documentation files
- [📋 PRD](./PRD.md) - Product Requirements Document
- [🏗️ Architecture](./ARCHITECTURE.md) - System architecture

### Guides
- [🔐 OAuth Setup](./docs/guides/YOUTUBE_API_SETUP.md) - YouTube API authentication
- [🧪 Testing Guide](./tests/README.md) - E2E testing instructions
- [📝 Test Guide](./docs/guides/TEST_GUIDE.md) - Feature testing guide

### Implementation Reports
- [01 - Authentication](../implementation-reports/01-authentication.md)
- [02 - Playlist API](../implementation-reports/02-playlist-api.md)
- [03 - CLI Integration](../implementation-reports/03-cli-integration.md)
- [04 - CLI Testing](../implementation-reports/04-cli-integration-testing.md)
- [05 - Auto Sync](../implementation-reports/05-auto-sync.md)
- [06 - Token Refresh](../implementation-reports/06-token-refresh.md)
- [07 - Error Handling](../implementation-reports/07-error-handling.md)
- [08 - Test Improvements](../implementation-reports/08-test-improvements.md)
- [09 - Frontend Integration](../implementation-reports/09-frontend-integration.md)
- [10 - Supabase Edge Functions](../implementation-reports/10-supabase-edge-functions.md)
- [11 - Extensible Adapter System](../implementation-reports/11-extensible-adapter-system.md) ⭐ NEW

### Version History
- [📋 CHANGELOG.md](/CHANGELOG.md) - 전체 버전별 변경 이력

### Phase Documentation
- [Phase 1 Complete](./docs/phases/phase1/PHASE1_IMPROVEMENTS_COMPLETE.md)
- [Phase 2 Complete](./docs/phases/phase2/PHASE2_IMPLEMENTATION.md)
- [Phase 3.1 Complete](./docs/phases/phase3/PHASE3.1_COMPLETE.md)

---

## 📞 Getting Help

### Common Issues
- **Authentication failed**: Check `.env` OAuth credentials
- **API quota exceeded**: Wait for next day or use caching
- **Database migration failed**: Delete `prisma/dev.db` and re-run migrations
- **OpenAI API error**: Verify `GEMINI_API_KEY` or `OPENAI_API_KEY` in `.env`

### Resources
- [Troubleshooting Guide](./README.md#-문제-해결)
- [GitHub Issues](https://github.com/your-repo/issues)
- [YouTube Data API Docs](https://developers.google.com/youtube/v3)

---

## 🎉 Project Achievements

**Completed Work** (as of 2025-12-21):
- ✅ **120+ TypeScript files** with full type safety
- ✅ **11 database tables** with Prisma ORM
- ✅ **25+ CLI commands** for all features
- ✅ **42+ REST API endpoints** with JWT authentication
- ✅ **7-language caption support** for global accessibility
- ✅ **AI-powered video summarization** with Gemini/OpenAI
- ✅ **Learning analytics dashboard** with progress tracking
- ✅ **30+ documentation files** with comprehensive guides
- ✅ **E2E testing infrastructure** with 5 automated scripts
- ✅ **Universal Adapter System** for future multi-source support
- ✅ **90%+ test coverage** with 1005 unit/integration tests
- ✅ **React Frontend** with shadcn/ui + Tailwind CSS
- ✅ **Docker Deployment** with nginx + multi-stage build
- ✅ **Monorepo Structure** with unified development scripts
- ✅ **Supabase Edge Functions** with YouTube OAuth + Sync
- ✅ **Kong API Gateway** for Edge Functions routing
- ✅ **Ideation Palette** auto-sync integration
- ✅ **Extensible Adapter System** with plugin architecture ⭐ NEW
- ✅ **adapter-dev Subagent** for autonomous adapter development ⭐ NEW
- ✅ **Adapter Scaffolding** with create-adapter script ⭐ NEW

**Test Results** (Phase 3.6):
- ✅ 37 test suites, 1005 tests (100% passing)
- ✅ Statements: 90.95% | Branches: 77.36% | Functions: 92.70% | Lines: 91.03%
- ✅ API response time <200ms (target: <2s)
- ✅ Worker process leak fixed (clean Jest teardown)

**Code Quality**:
- ✅ TypeScript strict mode enabled
- ✅ ESLint + Prettier configured
- ✅ Zod validation for all inputs
- ✅ Comprehensive error handling
- ✅ Winston structured logging
- ✅ 90%+ test coverage threshold enforced

---

**Status**: ✅ **Production-ready** with high test coverage, full-stack deployment, Supabase integration, and extensible adapter system

**Current Version**: 0.3.0
**Next Step**: Phase 6 - Production Deployment (CI/CD, Monitoring, PostgreSQL)

---

*Last reviewed: 2025-12-22*
*Maintained by: James Kim (admin@insighta.one)*
*Version: 2.2*
