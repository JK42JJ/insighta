# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Claude Code Templates Integration**: Developer tooling extensions
  - MCP servers: context7 (library docs), playwright (E2E testing), github (PR/Issue management)
  - `git-commit-helper` Skill: Conventional Commits guide
  - `webapp-testing` Skill: Playwright E2E test patterns
  - `/generate-tests` Command: Auto-generate tests from source analysis

### Changed
- `test-runner` Agent: Added Code Review Integration section (PR Review Workflow, Quality Gates, Test Impact Analysis)
- `frontend-dev` Agent: Added UX/UI Design Principles section (WCAG 2.1 AA, design system guide, component reusability)

## [0.3.0] - 2025-12-21

### Added
- **Supabase Edge Functions Integration**: YouTube OAuth and sync Edge Functions
  - `youtube-auth` Edge Function: OAuth 2.0 flow (auth-url, callback, refresh, disconnect, status)
  - `youtube-sync` Edge Function: Playlist management (add, list, sync, delete, ideation)
  - Kong API Gateway routing (key-auth, open callback route)
  - React Query hooks (`useYouTubeAuth`, `useYouTubeSync`)
  - Popup-based OAuth UI
  - Auto-creation of `user_video_states` (ideation palette integration)

### Changed
- `frontend/.env.example`: Added Supabase env vars (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)
- Kong `kong.template.yml`: Added open route for YouTube OAuth callback

### Documentation
- `docs/implementation-reports/10-supabase-edge-functions.md`: Implementation report
- `docs/status/CURRENT_STATUS.md`: Phase 5.1 status update
- `docs/INDEX.md`: New implementation report and Phase 5.1 entry

---

## [0.2.0] - 2025-12-20

### Added
- **Frontend Integration**: React + Vite + shadcn/ui monorepo integration
  - JWT-based API client (`frontend/src/lib/api-client.ts`)
  - React Query hooks (`frontend/src/hooks/use-api.ts`)
  - Docker multi-stage build (nginx:alpine)
  - nginx config (SPA fallback, API proxy, security headers)
  - Dev scripts (`scripts/dev.sh`, `scripts/docker-build.sh`)
- **Monorepo Structure**: Backend + Frontend unified
  - `npm run dev:all`: Run API + Frontend simultaneously
  - `npm run docker:build`, `docker:up`, `docker:down`: Docker management
  - `npm run install:all`: Install all dependencies

### Changed
- `package.json`: Monorepo scripts, concurrently dependency
- `docker-compose.yml`: Frontend service added
- `.gitignore`: Frontend and Docker entries

### Removed
- Frontend Supabase integration (replaced with custom API client)

---

## [0.1.1] - 2025-12-19

### Fixed
- Vercel deployment: Added `prisma db push` to build command
- Lazy loading pattern for serverless environment
- Version bump for cache invalidation

---

## [0.1.0] - 2025-12-18

### Added
- **Test Improvements**: Coverage 73% → 80%
  - Fixed worker process leaks (globalTeardown, forceExit)
  - 25 new tests (949 → 974 total)
  - Index export test files

### Changed
- `jest.config.js`: Added globalTeardown and forceExit settings

---

## [0.0.7] - 2025-12-18

### Added
- **Error Handling System**: Advanced error handling and recovery
  - `ErrorSeverity` enum (CRITICAL, HIGH, MEDIUM, LOW)
  - `ErrorRecoveryManager`: Auto-recovery manager
  - Circuit breaker pattern
  - Exponential backoff with jitter
  - New error types: `NetworkError`, `RateLimitError`, `SyncConflictError`
  - 40+ test cases

### Changed
- `SyncEngine`: ErrorRecoveryManager integration
- `SyncResult`: Recovery metadata (recoveryAttempts, recoveryStrategy)

---

## [0.0.6] - 2025-12-18

### Added
- **Token Refresh System**: Automatic YouTube OAuth token renewal
  - `TokenManager` singleton class
  - Thread-safe token refresh (Promise caching)
  - Proactive refresh with 5-minute buffer
  - Callbacks (`onTokenRefresh`, `onRefreshError`)
  - 38 test cases

### Changed
- `YouTubeClient`: TokenManager integration, auto token refresh
- `TokenStorage`: Expiration utilities

---

## [0.0.5] - 2025-12-17

### Added
- **Auto-Sync Scheduler**: Automated playlist synchronization
  - `AutoSyncScheduler` singleton class
  - node-cron based scheduling
  - Concurrent sync prevention (lock mechanism)
  - CLI commands: `scheduler start/stop/status/add/remove/list`
  - 21 test cases

---

## [0.0.4] - 2025-12-17

### Added
- **CLI Integration Testing**: 29 tests, 100% pass rate
  - API endpoint tests (3), CLI command tests (10), Security tests (6)
  - Integration tests (2), Error handling tests (8)

---

## [0.0.3] - 2025-12-17

### Added
- **CLI + REST API Integration**
  - `ApiClient` module: HTTP client with TypeScript type safety
  - `TokenStorage` module: Secure token storage (0o600 permissions)
  - Auth commands: `user-register`, `user-login`, `user-logout`, `user-whoami`
  - Playlist commands: `playlist-import`, `playlist-list`, `playlist-get`, `playlist-sync`, `playlist-delete`
  - Interactive password input (masked)
  - ~1,162 lines of new code

### Changed
- CLI architecture: Direct DB access → REST API communication

---

## [0.0.2] - 2025-12-17

### Added
- **Playlist API Endpoints**: REST API playlist management
  - `POST /api/v1/playlists/import`: Import playlist
  - `GET /api/v1/playlists`: List (filtering, sorting, pagination)
  - `GET /api/v1/playlists/:id`: Details
  - `POST /api/v1/playlists/:id/sync`: Sync
  - `DELETE /api/v1/playlists/:id`: Delete
  - Zod runtime validation + OpenAPI documentation

### Fixed
- Schema type mismatch: Separated Zod and OpenAPI schemas

---

## [0.0.1] - 2025-12-16

### Added
- **JWT Authentication System**
  - Dual token system: Access Token (15min) + Refresh Token (7d)
  - Endpoints: register, login, refresh, logout, me
  - bcrypt password hashing (10 rounds)
  - Rate limiting (100 req/15min)
  - Swagger UI + Scalar API Reference

### Security
- CORS configuration
- Helmet security headers
- JWT secrets from environment variables
