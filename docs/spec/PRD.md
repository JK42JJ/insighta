# Product Requirements Document (PRD)
# YouTube Playlist Sync Module

## 1. Executive Summary

### 1.1 Project Overview
개인 지식관리 및 학습 플랫폼을 위한 YouTube 플레이리스트 동기화 모듈 개발.

### 1.2 Primary Objectives
- YouTube 플레이리스트 자동 동기화
- 동영상 메타데이터 수집 및 저장
- 동영상 요약 및 개인 메모 기능을 위한 데이터 인프라 제공
- 학습 콘텐츠의 체계적 관리 지원

### 1.3 Target Users
- 개인 학습자 (개발자, 연구자, 학생)
- YouTube를 통한 지식 습득 및 관리를 원하는 사용자
- 체계적인 학습 콘텐츠 아카이빙이 필요한 사용자

---

## 2. Problem Statement

### 2.1 Current Challenges
- YouTube 플레이리스트는 동영상 링크만 관리, 추가 메타데이터 부족
- 개인 메모나 요약 기능 없음
- 플레이리스트 변경사항 추적 어려움
- 학습 진도 관리 및 콘텐츠 분석 불가능

### 2.2 Solution Approach
YouTube API를 활용한 플레이리스트 동기화 모듈을 통해:
- 자동으로 플레이리스트 변경사항 감지 및 동기화
- 동영상 메타데이터 (제목, 설명, 썸네일, 길이 등) 수집
- 로컬 데이터베이스에 구조화된 데이터 저장
- 추후 요약, 메모, 학습 진도 추적 기능의 기반 제공

---

## 3. Functional Requirements

### 3.1 Core Features

#### 3.1.1 Playlist Synchronization
**FR-1.1: Playlist Import**
- YouTube 플레이리스트 URL 또는 ID로 가져오기
- 플레이리스트 메타데이터 수집 (제목, 설명, 생성일, 동영상 개수)
- 모든 동영상 항목 수집 (페이지네이션 처리)

**FR-1.2: Automatic Sync**
- 주기적 동기화 스케줄링 (설정 가능한 간격)
- 변경사항 감지 (새 동영상 추가, 삭제, 순서 변경)
- 증분 동기화 (전체가 아닌 변경사항만)

**FR-1.3: Multi-Playlist Management**
- 여러 플레이리스트 동시 관리
- 플레이리스트 그룹화/카테고리 지정
- 플레이리스트 우선순위 설정

#### 3.1.2 Video Metadata Collection
**FR-2.1: Video Information**
- 기본 정보: 제목, 설명, 채널명, 게시일
- 미디어 정보: 길이, 썸네일 URL (여러 해상도)
- 통계 정보: 조회수, 좋아요 수, 댓글 수
- 카테고리, 태그, 언어 정보

**FR-2.2: Video Status Tracking**
- 시청 상태 (미시청, 진행중, 완료)
- 마지막 시청 위치 저장
- 시청 이력 추적

**FR-2.3: Data Enrichment**
- 자동 태그 추출 및 분류
- 관련 동영상 연결
- 플레이리스트 간 동영상 중복 감지

#### 3.1.3 Data Storage & Management
**FR-3.1: Local Database**
- 구조화된 데이터 저장 (SQLite/PostgreSQL)
- 효율적인 쿼리 및 검색 지원
- 데이터 백업 및 복원 기능

**FR-3.2: Data Schema**
```
Playlists:
  - id (primary key)
  - youtube_id (unique)
  - title
  - description
  - channel_id
  - created_at
  - updated_at
  - sync_status
  - last_synced_at

Videos:
  - id (primary key)
  - youtube_id (unique)
  - title
  - description
  - channel_id
  - channel_title
  - published_at
  - duration
  - thumbnail_urls (JSON)
  - view_count
  - like_count
  - comment_count
  - tags (JSON)
  - category_id
  - language
  - created_at
  - updated_at

PlaylistItems:
  - id (primary key)
  - playlist_id (foreign key)
  - video_id (foreign key)
  - position
  - added_at
  - removed_at (nullable)
  - created_at
  - updated_at

UserVideoStates:
  - id (primary key)
  - video_id (foreign key)
  - watch_status (enum: unwatched, watching, completed)
  - last_position (seconds)
  - watch_count
  - notes (text)
  - summary (text)
  - tags (JSON)
  - rating (1-5)
  - created_at
  - updated_at
```

#### 3.1.4 API Integration
**FR-4.1: YouTube Data API v3**
- OAuth 2.0 인증 구현
- API 쿼터 관리 (10,000 units/day 기본)
- Rate limiting 처리
- 에러 처리 및 재시도 로직

**FR-4.2: API Endpoints to Implement**
- `GET /playlists` - 플레이리스트 정보 조회
- `GET /playlistItems` - 플레이리스트 아이템 조회
- `GET /videos` - 동영상 상세 정보 조회
- `GET /channels` - 채널 정보 조회

### 3.2 Phase 2: Knowledge Management Features ✅ (Completed)

#### 3.2.1 Video Caption Extraction ✅
**FR-5.1: Multi-language Subtitle Support**
- ✅ YouTube 자막 추출 (7개 언어 지원: en, ko, ja, es, fr, de, zh)
- ✅ 자동 언어 감지 및 사용 가능한 언어 목록 조회
- ✅ 타임스탬프 기반 세그먼트 분할
- ✅ 데이터베이스 캐싱으로 중복 호출 방지

**Implementation Details:**
- CLI Commands: `caption-download`, `caption-languages`
- Module: `src/modules/caption/`
- Database: `video_captions` table with timestamp segments

#### 3.2.2 AI-Powered Video Summarization ✅
**FR-5.2: OpenAI GPT-4 Integration**
- ✅ AI 기반 동영상 요약 생성 (OpenAI GPT-4)
- ✅ 3단계 요약 레벨 (short, medium, detailed)
- ✅ 구조화된 JSON 출력 (summary, key points, keywords)
- ✅ 선택적 타임스탬프 추출
- ✅ 플레이리스트 일괄 요약 기능

**Implementation Details:**
- CLI Commands: `summarize`, `summarize-playlist`
- Module: `src/modules/summarization/`
- Database: `video_summaries` table
- Token Management: ~4000 tokens 자동 truncation

#### 3.2.3 Personal Note-Taking ✅
**FR-5.3: Timestamp-based Notes**
- ✅ 타임스탬프 기반 메모 (초 단위)
- ✅ 마크다운 콘텐츠 지원
- ✅ 유연한 태그 시스템
- ✅ 고급 검색 (동영상, 태그, 내용, 시간 범위)
- ✅ 다중 형식 내보내기 (Markdown, JSON, CSV)
- ✅ 전체 CRUD 작업 지원

**Implementation Details:**
- CLI Commands: `note-add`, `note-list`, `note-update`, `note-delete`, `note-export`
- Module: `src/modules/note/`
- Database: `personal_notes` table

#### 3.2.4 Learning Analytics ✅
**FR-5.4: Progress Tracking & Insights**
- ✅ 시청 세션 기록 및 추적
- ✅ 동영상 완료율 계산
- ✅ 플레이리스트 진도 분석
- ✅ 학습 대시보드 (통계, 최근 활동, 상위 동영상)
- ✅ 보유 메트릭 및 난이도 평가
- ✅ 스마트 복습 추천 시스템
- ✅ 학습 연속일 계산

**Implementation Details:**
- CLI Commands: `session-record`, `analytics-video`, `analytics-playlist`, `analytics-dashboard`, `retention`
- Module: `src/modules/analytics/`
- Database: `watch_sessions` table

---

## 4. Non-Functional Requirements

### 4.1 Performance
- **NFR-1.1**: 100개 동영상 플레이리스트 동기화 < 30초
- **NFR-1.2**: API 응답 시간 < 2초 (95th percentile)
- **NFR-1.3**: 동시 5개 플레이리스트 동기화 지원

### 4.2 Reliability
- **NFR-2.1**: 99% 동기화 성공률
- **NFR-2.2**: 네트워크 오류 시 자동 재시도 (exponential backoff)
- **NFR-2.3**: 데이터 손실 방지 (트랜잭션 처리)

### 4.3 Scalability
- **NFR-3.1**: 최대 100개 플레이리스트 관리
- **NFR-3.2**: 총 10,000개 동영상 지원
- **NFR-3.3**: 데이터베이스 크기 < 500MB (평균)

### 4.4 Security
- **NFR-4.1**: OAuth 2.0 토큰 안전한 저장 (암호화)
- **NFR-4.2**: API 키 환경변수 관리
- **NFR-4.3**: 개인정보 로컬 저장 (외부 전송 없음)

### 4.5 Usability
- **NFR-5.1**: CLI 인터페이스 제공
- **NFR-5.2**: 설정 파일을 통한 간편한 구성
- **NFR-5.3**: 상세한 로깅 및 에러 메시지

### 4.6 Maintainability
- **NFR-6.1**: TypeScript로 타입 안전성 확보
- **NFR-6.2**: 80% 이상 테스트 커버리지
- **NFR-6.3**: 모듈화된 아키텍처

---

## 5. Technical Architecture

### 5.1 Technology Stack

#### 5.1.1 Core Technologies
- **Language**: TypeScript (Node.js 18+)
- **Database**: SQLite (development), PostgreSQL (production option)
- **ORM**: Prisma or TypeORM
- **API Client**: Official Google APIs Client Library

#### 5.1.2 Supporting Libraries
- **Authentication**: googleapis OAuth2 client
- **CLI**: Commander.js or Yargs
- **Scheduling**: node-cron or Bull (job queue)
- **Logging**: Winston or Pino
- **Config**: dotenv, cosmiconfig
- **Testing**: Jest, Supertest
- **Validation**: Zod or Joi

### 5.2 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Interface                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Playlist   │  │    Video     │  │    Sync      │      │
│  │   Manager    │  │   Manager    │  │  Scheduler   │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                  │              │
│         └─────────────────┴──────────────────┘              │
│                          │                                  │
│                 ┌────────▼─────────┐                        │
│                 │   YouTube API    │                        │
│                 │     Client       │                        │
│                 └────────┬─────────┘                        │
│                          │                                  │
│         ┌────────────────┴────────────────┐                │
│         │                                  │                │
│  ┌──────▼───────┐              ┌──────────▼──────┐         │
│  │   Database   │              │   File Storage  │         │
│  │   (SQLite/   │              │   (Thumbnails,  │         │
│  │  PostgreSQL) │              │    Cache)       │         │
│  └──────────────┘              └─────────────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 Core Modules

#### Phase 1 Modules (Completed)

##### 5.3.1 YouTube API Client Module
- OAuth 2.0 인증 관리
- API 호출 래퍼 (rate limiting, error handling)
- 쿼터 사용량 추적
- 응답 캐싱

##### 5.3.2 Playlist Manager Module
- 플레이리스트 CRUD 작업
- 플레이리스트 동기화 로직
- 변경사항 감지 알고리즘
- 플레이리스트 메타데이터 관리

##### 5.3.3 Video Manager Module
- 동영상 메타데이터 수집 및 저장
- 동영상 검색 및 필터링
- 중복 감지 및 관리
- 썸네일 다운로드 및 캐싱

##### 5.3.4 Sync Scheduler Module
- 주기적 동기화 스케줄링
- 동기화 작업 큐 관리
- 동기화 상태 모니터링
- 실패 처리 및 재시도

##### 5.3.5 Database Module
- 데이터 모델 정의
- 쿼리 인터페이스
- 마이그레이션 관리
- 데이터 백업/복원

#### Phase 2 Modules (Completed)

##### 5.3.6 Caption Extractor Module
- YouTube 자막 추출 (youtube-transcript library)
- 다국어 지원 (7개 언어)
- 타임스탬프 기반 세그먼트 분할
- 데이터베이스 캐싱 및 중복 제거
- 자동 언어 감지

##### 5.3.7 Summarization Generator Module
- OpenAI GPT-4 통합
- 3단계 요약 레벨 (short, medium, detailed)
- 구조화된 JSON 출력 (summary, keyPoints, keywords)
- 토큰 관리 및 자동 truncation (~4000 tokens)
- 배치 처리 지원 (플레이리스트 일괄 요약)

##### 5.3.8 Note Manager Module
- 타임스탬프 기반 노트 CRUD
- 마크다운 콘텐츠 저장 및 렌더링
- 태그 시스템 (쉼표 구분 문자열)
- 고급 검색 (동영상, 태그, 내용, 시간 범위)
- 다중 형식 내보내기 (Markdown, JSON, CSV)

##### 5.3.9 Analytics Tracker Module
- 시청 세션 기록 및 추적
- 동영상별 분석 (완료율, 시청 시간, 재시청 횟수)
- 플레이리스트 진도 분석
- 학습 대시보드 생성 (통계, 최근 활동, 상위 동영상)
- 보유 메트릭 계산 (난이도, 복습 추천일)
- 학습 연속일 추적 (streak calculation)

---

## 6. Implementation Phases

### Phase 1: Core Synchronization Infrastructure ✅ (Completed)
**Milestone: Basic Infrastructure & Manual Sync**
**Status: Completed - 2025-12**
- ✅ Project setup (TypeScript, Prisma, SQLite)
- ✅ Database schema design and migration (8 tables)
- ✅ YouTube API client with OAuth 2.0 and API key support
- ✅ Configuration management with Zod validation
- ✅ Quota management system (10,000 units/day)
- ✅ Playlist manager (import, update, list)
- ✅ Video manager (metadata, user state tracking)
- ✅ Sync engine with incremental sync
- ✅ CLI interface with 11 base commands
- ✅ Error handling with exponential backoff
- ✅ Winston logging system

**Deliverables:**
- 30+ TypeScript files with type safety
- 11 CLI commands for core functionality
- Comprehensive error handling and retry logic
- Database schema with Prisma ORM

### Phase 2: Knowledge Management Features ✅ (Completed)
**Milestone: Learning Platform Features**
**Status: Completed - 2025-12**

#### Phase 2.1: Caption Extraction & Summarization ✅
- ✅ YouTube caption extraction (7 languages)
- ✅ AI-powered summarization (OpenAI GPT-4)
- ✅ Three summarization levels (short, medium, detailed)
- ✅ Batch playlist summarization
- ✅ CLI commands: `caption-download`, `caption-languages`, `summarize`, `summarize-playlist`

#### Phase 2.2: Personal Note-Taking ✅
- ✅ Timestamp-based note CRUD operations
- ✅ Markdown content support
- ✅ Flexible tagging system
- ✅ Advanced search (video, tags, content, time range)
- ✅ Multi-format export (Markdown, JSON, CSV)
- ✅ CLI commands: `note-add`, `note-list`, `note-update`, `note-delete`, `note-export`

#### Phase 2.3: Learning Analytics ✅
- ✅ Watch session tracking
- ✅ Video completion percentage calculation
- ✅ Playlist progress analytics
- ✅ Learning dashboard with statistics
- ✅ Retention metrics and difficulty assessment
- ✅ Smart review recommendations
- ✅ Learning streak calculation
- ✅ CLI commands: `session-record`, `analytics-video`, `analytics-playlist`, `analytics-dashboard`, `retention`

**Deliverables:**
- 4 new modules (caption, summarization, note, analytics)
- 14 additional CLI commands (total 25+ commands)
- 3 new database tables (video_captions, video_summaries, personal_notes, watch_sessions)
- OpenAI GPT-4 integration
- Comprehensive testing guide (TEST_GUIDE.md)

### Phase 3: Production Readiness & Testing (In Progress) 🚧
**Milestone: Production Deployment**
**Status: In Progress - 2025-12-18**

#### Phase 3.1: YouTube API Integration Completion
- [ ] Complete OAuth 2.0 flow with browser-based authentication
- [ ] Implement full playlist sync automation
- [ ] Response caching for API efficiency
- [ ] Advanced quota management with dynamic throttling

#### Phase 3.2: Testing & Quality Assurance (In Progress) 🚧
**Status: ~60% Complete**

##### TypeScript Compilation & Type Safety ✅
- ✅ All TypeScript compilation errors resolved (29 errors fixed)
- ✅ Strict type checking enabled and passing
- ✅ Zero TypeScript errors (`npx tsc --noEmit` passes)

**Fixed Issues:**
- Wave 1: Process.env access patterns, unused variables, ErrorCode additions (10 errors)
- Wave 2: Fastify JWT types & route response schemas (22 errors)
  - auth.ts: JWT module augmentation + key parameter fixes
  - routes/playlists.ts: Type guards + error handling refactor
  - routes/auth.ts: Type guard implementations
- Wave 3: Server environment variables (7 errors)
  - server.ts: Bracket notation for process.env access

##### Test Infrastructure ✅ (Partial)
- ✅ Jest configuration with TypeScript support
- ✅ Test utilities and mock patterns
- ✅ Database test mocks (Jest hoisting patterns)
- ✅ 10/17 test suites passing (58.8%)

**Passing Test Suites (10):**
1. errors.test.ts - Error handling utilities
2. cache.test.ts - Cache service
3. quota-manager.test.ts - API quota management
4. scheduler-manager.test.ts - Sync scheduling
5. note-manager.test.ts - Personal notes
6. adapter-registry.test.ts - Adapter registration
7. adapter-factory.test.ts - Adapter creation
8. youtube-adapter.test.ts - YouTube adapter integration
9. video-manager.test.ts - Video metadata management ✅ Fixed
10. playlist-manager.test.ts - Playlist management ✅ Fixed

**Current Test Results:**
```
Test Suites: 10 passed, 7 failing, 17 total
Tests:       378 passed, 65 failing, 443 total
Coverage:    Pending full run
```

##### Remaining Test Failures (7 suites)
**High Priority:**
1. **database-client.test.ts** - Mock pattern issues
2. **sync-engine.test.ts** - 3 tests failing (timing/logic)
3. **api-auth.test.ts** - Integration test failures
4. **api-playlists.test.ts** - Integration test failures

**Performance Issues:**
5. **retry.test.ts** - Failing + VERY slow (762 seconds)
6. **caption-extractor.test.ts** - Failing + slow (132 seconds)
7. **summarization-generator.test.ts** - Failing + slow (132 seconds)

##### Unit Tests - In Progress
- ✅ Core utilities (errors, cache, retry)
- ✅ Quota manager (26 tests passing)
- ✅ Scheduler manager (26 tests passing)
- ✅ Note manager (32 tests passing)
- ✅ Video manager (30 tests passing) - Fixed mock patterns
- ✅ Playlist manager (29 tests passing) - Fixed mock patterns
- ✅ Adapter system (58 tests passing)
- 🚧 Database client - Mock issues remaining
- 🚧 Sync engine - 3 tests failing

##### Integration Tests - In Progress
- ✅ YouTube adapter integration (20 tests passing)
- 🚧 API authentication routes - Failing
- 🚧 API playlist routes - Failing
- [ ] End-to-end sync workflows
- [ ] Real-world YouTube playlist testing

##### Performance Testing - Pending
- [ ] Benchmark 100-video playlist sync (target: <30s)
- [ ] API response time testing (target: <2s p95)
- [ ] Concurrent playlist sync testing (target: 5 playlists)
- [ ] Database query optimization
- [ ] Memory usage profiling

#### Phase 3.3: Documentation & DevOps
- [ ] Complete API documentation
- [ ] User guides and tutorials
- [ ] Deployment automation (Docker, CI/CD)
- [ ] PostgreSQL migration for production
- [ ] Monitoring and alerting setup

### Phase 3.5: Universal Adapter System ✅ (Completed)
**Milestone: Multi-Source Content Integration Foundation**
**Status: Completed - 2025-12-17**

#### Universal Adapter Architecture
- ✅ **DataSourceAdapter Interface** - Source-agnostic adapter interface
  - Type-safe TypeScript interface for all adapters
  - Lifecycle management (initialize, shutdown)
  - Authentication & credentials management
  - Collection & content operations
  - Schema definition & capabilities
  - Health check & quota management
  - URL extraction utilities

#### YouTubeAdapter Implementation
- ✅ **YouTube-specific Adapter** - Complete DataSourceAdapter implementation
  - Integrated with existing YouTube API Client
  - URL parsing & ID extraction
  - Playlist & video metadata fetching
  - Quota tracking integration
  - Comprehensive error handling
  - Integration tests (20 tests, 100% passing)

#### Plugin System
- ✅ **AdapterRegistry** - Centralized adapter management
  - Singleton pattern for global registry
  - Register/unregister/retrieve adapters
  - Automatic metadata generation
  - Graceful shutdown support
  - Unit tests (21 tests, 100% passing)

- ✅ **AdapterFactory** - Type-safe adapter creation
  - Factory pattern for adapter instantiation
  - Custom adapter registration support
  - Automatic initialization helpers
  - Built-in adapter auto-registration
  - Unit tests (17 tests, 100% passing)

#### Database Migration
- ✅ **Universal Data Models** - Source-independent schema
  - `Collection` model - Universal collection representation
  - `ContentItem` model - Universal content representation
  - `CollectionItemLink` model - Many-to-many relationship
  - Coexists with existing YouTube-specific models
  - Supports metadata as JSON for source-specific data

#### Documentation
- ✅ **Comprehensive Documentation** (docs/ADAPTER_SYSTEM.md)
  - Architecture overview (400+ lines)
  - Quick start examples
  - Complete API reference
  - Custom adapter creation guide
  - Error handling patterns
  - Best practices & examples

**Deliverables:**
- 4 core TypeScript files (1000+ lines total)
- 58 comprehensive tests (100% passing)
- 3 new database tables with migration
- Complete documentation system
- Foundation for future multi-source support (Notion, LinkedIn, Files, etc.)

**Test Results:**
```
Test Suites: 3 passed, 3 total
Tests:       58 passed, 58 total
- YouTubeAdapter integration: 20 tests
- AdapterRegistry unit: 21 tests
- AdapterFactory unit: 17 tests
```

**Future Extensions:**
- Notion Adapter for Notion pages and databases
- LinkedIn Adapter for LinkedIn posts and articles
- File Adapter for local files and directories
- Google Drive Adapter for Google Docs and Drive files
- Vimeo Adapter for Vimeo videos
- Spotify Adapter for Spotify playlists and tracks

### Phase 4: Web UI & Advanced Features (Future)
**Milestone: Full-Featured Learning Platform**
**Status: Future Enhancement**
- [ ] Web-based user interface
- [ ] Visual playlist management
- [ ] Interactive note-taking with video player
- [ ] Advanced analytics visualization
- [ ] Multi-user support
- [ ] Cloud synchronization (optional)
- [ ] Mobile-responsive design
- [ ] Export/import functionality

---

## 7. API Quota Management

### 7.1 YouTube API Quota Costs
- Playlist details: 1 unit
- PlaylistItems list (50 items): 1 unit
- Videos list (50 videos): 1 unit
- Total for 100-video playlist: ~5 units

### 7.2 Optimization Strategies
- 캐싱 활용 (변경되지 않은 데이터 재사용)
- 배치 처리 (50개씩 묶어서 요청)
- 증분 동기화 (전체가 아닌 변경사항만)
- 스마트 스케줄링 (변경 빈도에 따라 조정)

### 7.3 Quota Monitoring
- 일일 쿼터 사용량 추적
- 쿼터 초과 시 알림
- 우선순위 기반 동기화

---

## 8. Success Metrics

### 8.1 Technical Metrics
- API 호출 성공률 > 99%
- 평균 동기화 시간 < 30초 (100개 동영상)
- 데이터 정확도 100% (YouTube와 일치)
- 테스트 커버리지 > 80%

### 8.2 User Experience Metrics
- 설정 완료 시간 < 5분
- CLI 명령 응답 시간 < 2초
- 에러 발생 시 명확한 메시지 제공

### 8.3 Business Metrics
- 개인 학습 플랫폼 데이터 소스로 안정적 작동
- 향후 요약/메모 기능 구현 가능한 데이터 구조
- 확장 가능한 아키텍처

---

## 9. Risk Assessment

### 9.1 Technical Risks
| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| API 쿼터 초과 | High | Medium | 캐싱, 증분 동기화, 스마트 스케줄링 |
| API 응답 변경 | Medium | Low | 버전 고정, 에러 처리, 모니터링 |
| 대용량 플레이리스트 성능 | Medium | Medium | 페이지네이션, 배치 처리, 비동기 |
| 데이터 일관성 문제 | High | Low | 트랜잭션, 검증 로직, 백업 |

### 9.2 Business Risks
| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| YouTube API 정책 변경 | High | Low | 공식 문서 모니터링, 유연한 설계 |
| 사용자 요구사항 변경 | Medium | Medium | 모듈화 아키텍처, 확장성 고려 |

---

## 10. Compliance & Legal

### 10.1 YouTube API Terms of Service
- API 사용 약관 준수
- 사용자 데이터 로컬 저장만 허용
- 쿼터 제한 준수
- 적절한 attribution 표시

### 10.2 Data Privacy
- 개인 OAuth 토큰 안전한 저장
- 로컬 데이터베이스 (외부 전송 없음)
- 사용자 동의 하에 데이터 수집

---

## 11. Documentation Requirements

### 11.1 Technical Documentation
- API 참조 문서
- 아키텍처 설계 문서
- 데이터베이스 스키마 문서
- 배포 가이드

### 11.2 User Documentation
- 설치 가이드
- 설정 가이드
- CLI 명령어 참조
- 문제 해결 가이드

### 11.3 Developer Documentation
- 개발 환경 설정
- 코드 스타일 가이드
- 기여 가이드
- 테스트 가이드

---

## 12. Appendix

### 12.1 References
- [YouTube Data API v3 Documentation](https://developers.google.com/youtube/v3)
- [OAuth 2.0 for Google APIs](https://developers.google.com/identity/protocols/oauth2)
- [Prisma Documentation](https://www.prisma.io/docs)
- [TypeScript Best Practices](https://www.typescriptlang.org/docs/)

### 12.2 Glossary
- **Playlist**: YouTube에서 동영상들의 모음
- **Playlist Item**: 플레이리스트 내의 개별 동영상 항목
- **Sync**: 플레이리스트의 변경사항을 로컬 데이터베이스에 반영하는 프로세스
- **Quota**: YouTube API 일일 사용 한도
- **Incremental Sync**: 전체가 아닌 변경된 부분만 동기화

### 12.3 Version History
- v1.0 (2025-12-14): Initial PRD creation
- v2.0 (2025-12-15): Phase 2 completion update
  - Added Phase 2 Knowledge Management Features as completed
  - Updated Implementation Phases with detailed deliverables
  - Added Phase 3 and Phase 4 planning sections
  - Updated functional requirements with FR-5.x series
  - Documented all Phase 2 modules and CLI commands
