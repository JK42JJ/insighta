# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Claude Code Templates Integration**: 개발 효율성 향상을 위한 도구 확장
  - MCP 서버 추가: context7 (라이브러리 문서), playwright (E2E 테스트), github (PR/Issue 관리)
  - `git-commit-helper` Skill: Conventional Commits 기반 커밋 메시지 가이드
  - `webapp-testing` Skill: Playwright E2E 테스트 패턴 가이드
  - `/generate-tests` Command: 소스 코드 분석 후 테스트 자동 생성

### Changed
- `test-runner` Agent: Code Review Integration 섹션 추가 (PR Review Workflow, Quality Gates, Test Impact Analysis)
- `frontend-dev` Agent: UX/UI Design Principles 섹션 추가 (WCAG 2.1 AA, 디자인 시스템 가이드, 컴포넌트 재사용성)

## [0.3.0] - 2025-12-21

### Added
- **Supabase Edge Functions Integration**: YouTube OAuth 및 동기화 Edge Functions 구현
  - `youtube-auth` Edge Function: OAuth 2.0 플로우 (auth-url, callback, refresh, disconnect, status)
  - `youtube-sync` Edge Function: 플레이리스트 관리 (add, list, sync, delete, ideation)
  - Kong API Gateway 라우팅 설정 (key-auth, open callback route)
  - React Query 훅 (`useYouTubeAuth`, `useYouTubeSync`)
  - 팝업 기반 OAuth 인증 UI
  - `user_video_states` 자동 생성 (아이디에이션 팔레트 연동)

### Changed
- `frontend/.env.example`: Supabase 환경 변수 추가 (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)
- Kong `kong.template.yml`: YouTube OAuth callback을 위한 open 라우트 추가

### Documentation
- `docs/implementation-reports/10-supabase-edge-functions.md`: 구현 보고서 추가
- `docs/status/CURRENT_STATUS.md`: Phase 5.1 상태 업데이트
- `docs/INDEX.md`: 새 구현 보고서 및 Phase 5.1 추가

---

## [0.2.0] - 2025-12-20

### Added
- **Frontend Integration**: React + Vite + shadcn/ui 프론트엔드 모노레포 통합
  - JWT 기반 API 클라이언트 (`frontend/src/lib/api-client.ts`)
  - React Query 훅 (`frontend/src/hooks/use-api.ts`)
  - Docker multi-stage 빌드 (nginx:alpine)
  - nginx 설정 (SPA fallback, API 프록시, 보안 헤더)
  - 개발 스크립트 (`scripts/dev.sh`, `scripts/docker-build.sh`)
- **Monorepo Structure**: Backend + Frontend 통합 구조
  - `npm run dev:all`: API + Frontend 동시 실행
  - `npm run docker:build`, `docker:up`, `docker:down`: Docker 관리
  - `npm run install:all`: 전체 의존성 설치

### Changed
- `package.json`: 모노레포 스크립트 추가, concurrently 의존성 추가
- `docker-compose.yml`: frontend 서비스 추가
- `.gitignore`: frontend, Docker 항목 추가

### Removed
- Frontend Supabase 통합 (자체 API 클라이언트로 대체)

---

## [0.1.1] - 2025-12-19

### Fixed
- Vercel 배포 수정: `prisma db push`를 빌드 명령에 추가
- Serverless 환경을 위한 lazy loading 패턴 적용
- 캐시 무효화를 위한 버전 범프

---

## [0.1.0] - 2025-12-18

### Added
- **Test Improvements**: 테스트 커버리지 73% → 80% 향상
  - Worker process leak 수정 (globalTeardown, forceExit)
  - 25개 신규 테스트 추가 (949 → 974 tests)
  - Index export 테스트 파일 생성

### Changed
- `jest.config.js`: globalTeardown 및 forceExit 설정 추가

---

## [0.0.7] - 2025-12-18

### Added
- **Error Handling System**: 고급 에러 처리 및 복구 시스템
  - `ErrorSeverity` enum (CRITICAL, HIGH, MEDIUM, LOW)
  - `ErrorRecoveryManager`: 자동 복구 관리자
  - Circuit Breaker 패턴 구현
  - Exponential backoff with jitter
  - 새 에러 타입: `NetworkError`, `RateLimitError`, `SyncConflictError`
  - 40+ 테스트 케이스

### Changed
- `SyncEngine`: ErrorRecoveryManager 통합
- `SyncResult`: 복구 메타데이터 추가 (recoveryAttempts, recoveryStrategy)

---

## [0.0.6] - 2025-12-18

### Added
- **Token Refresh System**: YouTube OAuth 자동 토큰 갱신
  - `TokenManager` 싱글톤 클래스
  - 스레드 안전한 토큰 갱신 (Promise 캐싱)
  - 5분 버퍼의 선제적 토큰 갱신
  - 콜백 지원 (`onTokenRefresh`, `onRefreshError`)
  - 38개 테스트 케이스

### Changed
- `YouTubeClient`: TokenManager 통합, 자동 토큰 갱신
- `TokenStorage`: expiration 유틸리티 추가

---

## [0.0.5] - 2025-12-17

### Added
- **Auto-Sync Scheduler**: 자동화된 플레이리스트 동기화
  - `AutoSyncScheduler` 싱글톤 클래스
  - node-cron 기반 스케줄링
  - 동시 동기화 방지 (Lock 메커니즘)
  - CLI 명령어: `scheduler start/stop/status/add/remove/list`
  - 21개 테스트 케이스
  - 문서: `docs/AUTO_SYNC_SCHEDULER.md`, `docs/AUTO_SYNC_EXAMPLES.md`

---

## [0.0.4] - 2025-12-17

### Added
- **CLI Integration Testing**: CLI 통합 테스트 완료
  - API 엔드포인트 테스트 (3/3 통과)
  - CLI 명령어 테스트 (10/10 통과)
  - 보안 테스트 (6/6 통과)
  - 통합 테스트 (2/2 통과)
  - 에러 처리 테스트 (8/8 통과)
  - 총 29개 테스트 케이스 통과

---

## [0.0.3] - 2025-12-17

### Added
- **CLI Integration with REST API**: CLI와 REST API 연동
  - `ApiClient` 모듈: HTTP 클라이언트 with TypeScript 타입 안전성
  - `TokenStorage` 모듈: 보안 토큰 저장 (0o600 권한)
  - 인증 명령어: `user-register`, `user-login`, `user-logout`, `user-whoami`
  - 플레이리스트 명령어: `playlist-import`, `playlist-list`, `playlist-get`, `playlist-sync`, `playlist-delete`
  - 인터랙티브 패스워드 입력 (마스킹)
  - ~1,162 lines 신규 코드

### Changed
- CLI 아키텍처: 직접 DB 접근 → REST API 통신

---

## [0.0.2] - 2025-12-17

### Added
- **Playlist API Endpoints**: REST API 플레이리스트 관리
  - `POST /api/v1/playlists/import`: 플레이리스트 가져오기
  - `GET /api/v1/playlists`: 플레이리스트 목록 (필터링, 정렬, 페이지네이션)
  - `GET /api/v1/playlists/:id`: 플레이리스트 상세 조회
  - `POST /api/v1/playlists/:id/sync`: 플레이리스트 동기화
  - `DELETE /api/v1/playlists/:id`: 플레이리스트 삭제
  - Zod 런타임 검증 + OpenAPI 문서화 스키마

### Fixed
- Schema type mismatch: Zod 스키마와 OpenAPI 스키마 분리

---

## [0.0.1] - 2025-12-16

### Added
- **JWT Authentication System**: 완전한 인증 시스템
  - Dual Token System: Access Token (15분) + Refresh Token (7일)
  - `POST /api/v1/auth/register`: 사용자 등록
  - `POST /api/v1/auth/login`: 로그인
  - `POST /api/v1/auth/refresh`: 토큰 갱신
  - `POST /api/v1/auth/logout`: 로그아웃
  - `GET /api/v1/auth/me`: 현재 사용자 조회
  - bcrypt 패스워드 해싱 (10 rounds)
  - Rate limiting (100 req/15min)
  - Swagger UI + Scalar API Reference

### Security
- CORS 설정
- Helmet 보안 헤더
- JWT secrets from environment variables

---

## Project Links

- **Documentation**: [docs/INDEX.md](./docs/INDEX.md)
- **Implementation Reports**: [docs/implementation-reports/](./docs/implementation-reports/)
- **API Reference**: http://localhost:3000/api-reference
- **Swagger UI**: http://localhost:3000/documentation

---

*작성일: 2025-12-21*
*Generated with Claude Code*
