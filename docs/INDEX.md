# 📚 Documentation Index

Insighta 프로젝트의 전체 문서 목록입니다.

**Last Updated**: 2025-12-22
**Current Phase**: Phase 5.2 Complete - Extensible Adapter System

---

## 🚀 Quick Start

### Essential Documents
- **[📊 CURRENT_STATUS.md](./status/CURRENT_STATUS.md)** - 현재 프로젝트 상태 요약
- **[🗺️ ROADMAP.md](./status/ROADMAP.md)** - 다음 단계 실행 계획
- **[📋 PRD.md](./spec/PRD.md)** - Product Requirements Document
- **[🏗️ ARCHITECTURE.md](./spec/ARCHITECTURE.md)** - System Architecture
- **[📖 README.md](../README.md)** - Main Project Documentation

---

## 📋 스펙 문서 (`docs/spec/`)

### [PRD.md](./spec/PRD.md)
**Product Requirements Document** - 제품 요구사항 정의서

- 프로젝트 목적 및 배경
- 핵심 기능 명세
- 기술 스택 및 아키텍처 결정
- 개발 로드맵 (Phase 1-4)
- 비기능 요구사항 (성능, 보안, 확장성)

### [ARCHITECTURE.md](./spec/ARCHITECTURE.md)
**시스템 아키텍처 설계 문서**

- 전체 시스템 구조 다이어그램
- 모듈별 책임과 인터페이스
- 데이터베이스 스키마 설계
- API 엔드포인트 명세
- 보안 아키텍처 (JWT, OAuth 2.0)

---

## 📊 상태 문서 (`docs/status/`)

### [CURRENT_STATUS.md](./status/CURRENT_STATUS.md)
**프로젝트 현재 상태 대시보드**

- 전체 진행률 및 완료 현황
- 각 Phase별 상세 상태
- 최근 변경사항

### [ROADMAP.md](./status/ROADMAP.md)
**다음 단계 실행 계획**

- 향후 개발 방향
- 우선순위 및 일정
- 의존성 관리

---

## 📝 구현 보고서 (`docs/implementation-reports/`)

구현된 각 기능의 상세 보고서입니다. 시간순으로 정리되어 있습니다.

| # | 보고서 | 설명 | 구현 일자 |
|---|--------|------|-----------|
| 01 | [Authentication](./implementation-reports/01-authentication.md) | JWT 기반 인증 시스템 | 2025-12-16 |
| 02 | [Playlist API](./implementation-reports/02-playlist-api.md) | 플레이리스트 관리 API | 2025-12-17 |
| 03 | [CLI Integration](./implementation-reports/03-cli-integration.md) | CLI와 REST API 통합 | 2025-12-17 |
| 04 | [CLI Testing](./implementation-reports/04-cli-integration-testing.md) | CLI 통합 테스트 | 2025-12-17 |
| 05 | [Auto Sync](./implementation-reports/05-auto-sync.md) | 자동 동기화 시스템 | 2025-12-18 |
| 06 | [Token Refresh](./implementation-reports/06-token-refresh.md) | 토큰 자동 갱신 | 2025-12-18 |
| 07 | [Error Handling](./implementation-reports/07-error-handling.md) | 에러 처리 시스템 | 2025-12-18 |
| 08 | [Test Improvements](./implementation-reports/08-test-improvements.md) | 테스트 개선 | 2025-12-18 |
| 09 | [Frontend Integration](./implementation-reports/09-frontend-integration.md) | 프론트엔드 모노레포 통합 | 2025-12-20 |
| 10 | [Supabase Edge Functions](./implementation-reports/10-supabase-edge-functions.md) | YouTube OAuth & 동기화 Edge Functions | 2025-12-21 |
| 11 | [Extensible Adapter System](./implementation-reports/11-extensible-adapter-system.md) | 확장 가능한 플러그인 기반 어댑터 시스템 | 2025-12-22 |

---

## 🗂️ Phase 4 문서 (`docs/phases/phase4/`)

Phase 4 (Advanced API Features) 구현 계획 및 상세 문서입니다.

| 문서 | 설명 |
|------|------|
| [4-1 Videos API](./phases/phase4/4-1-videos-api.md) | Videos API 엔드포인트 |
| [4-2/4-3 Analytics & Sync API](./phases/phase4/4-2-4-3-analytics-sync-api.md) | Analytics, Sync API |
| [4-4/4-5 Rate Limit & Docs](./phases/phase4/4-4-4-5-rate-limit-docs.md) | Rate Limiting, Documentation |

---

## 🔧 설정 가이드

### [YOUTUBE_API_SETUP.md](./YOUTUBE_API_SETUP.md)
**YouTube API OAuth 2.0 설정 가이드**

- Google Cloud Console 프로젝트 생성
- YouTube Data API v3 활성화
- OAuth 2.0 인증 정보 설정
- 환경 변수 구성

---

## 🎨 개발 가이드 (`docs/guides/`)

### [FRONTEND_INTEGRATION_GUIDE.md](./guides/FRONTEND_INTEGRATION_GUIDE.md)
**프론트엔드 개발 통합 가이드**

- 전체 42개 API 엔드포인트 상세 문서
- 8개 화면별 ASCII 와이어프레임
- React/TypeScript 코드 예제
- 상태 관리 패턴 (TanStack Query, Zustand)
- 에러 처리 및 인증 패턴
- 컴포넌트 구조 가이드

---

## 🔌 어댑터 개발 가이드 ⭐ NEW

### 어댑터 시스템 개요
Insighta의 확장 가능한 플러그인 기반 어댑터 시스템입니다.

| 카테고리 | Base 클래스 | 지원 서비스 |
|---------|------------|-----------|
| OAuth 2.0 | `BaseOAuthAdapter` | YouTube, Notion, Google Drive, LinkedIn |
| Feed | `BaseFeedAdapter` | RSS, Atom |
| File | `BaseFileAdapter` | Markdown, PDF, DOCX, PPTX, TXT |

### 관련 파일
- **[adapter-patterns Skill](../.claude/skills/adapter-patterns/SKILL.md)** - 어댑터 개발 패턴 가이드
- **[adapter-dev Agent](../.claude/agents/adapter-dev.md)** - 어댑터 개발 전문 subagent
- **[create-adapter Command](../.claude/commands/create-adapter.md)** - 어댑터 스캐폴딩 명령

### 새 어댑터 생성
```bash
# OAuth 어댑터 생성
npm run create:adapter -- --name notion --category oauth

# Feed 어댑터 생성
npm run create:adapter -- --name rss --category feed

# File 어댑터 생성
npm run create:adapter -- --name markdown --category file
```

---

## 📊 구현 현황

### Phase 1: Core Infrastructure ✅
- TypeScript + Prisma + SQLite 설정
- 데이터베이스 스키마 (8 tables)
- YouTube API 클라이언트
- Winston 로깅 시스템

### Phase 2: Knowledge Management ✅
- Caption Extraction (7개 언어)
- AI Summarization (Gemini/OpenAI)
- Personal Note-Taking
- Learning Analytics

### Phase 3: REST API & CLI ✅
- YouTube API Integration
- Authentication & Security
- Playlist Management API
- CLI Integration

### Phase 4: Advanced API Features ✅
- Videos API (6 endpoints)
- Analytics API (4 endpoints)
- Sync API (8 endpoints)
- Rate Limiting
- Documentation (Docusaurus + OpenAPI)

### Phase 5: Frontend Integration ✅
- React + Vite + shadcn/ui 프론트엔드
- Docker nginx 배포
- Monorepo 개발 환경
- API 클라이언트 통합 (JWT)
- 개발 스크립트 (dev.sh, docker-build.sh)

### Phase 5.1: Supabase Edge Functions ✅
- YouTube OAuth 2.0 플로우 (Edge Function)
- 플레이리스트 동기화 API (Edge Function)
- Kong API Gateway 설정
- React Query 훅 (useYouTubeAuth, useYouTubeSync)

### Phase 5.2: Extensible Adapter System ✅ ⭐ NEW
- 플러그인 기반 어댑터 아키텍처
- Base 클래스 계층 (OAuth, Feed, File)
- adapter-dev subagent 및 자동화 스크립트
- adapter-patterns skill 및 create-adapter 명령

---

## 🗂️ 문서 구조

```
sync-youtube-playlists/
├── README.md                    # 프로젝트 메인
├── CLAUDE.md                    # Claude Code 가이드
├── CHANGELOG.md                 # 버전별 변경 이력 ⭐ NEW
│
├── frontend/                    # React 프론트엔드 ⭐ NEW
│   ├── src/
│   │   ├── lib/api-client.ts   # JWT API 클라이언트
│   │   └── hooks/use-api.ts    # React Query 훅
│   ├── Dockerfile              # Multi-stage 빌드
│   └── nginx/                  # nginx 설정
│
├── scripts/                     # 개발 스크립트
│   ├── dev.sh                  # 개발 환경 시작
│   ├── docker-build.sh         # Docker 빌드
│   └── create-adapter.ts       # 어댑터 스캐폴딩 ⭐ NEW
│
└── docs/
    ├── INDEX.md                 # 📍 이 문서
    ├── README.md                # 문서 홈
    │
    ├── spec/                    # 스펙 문서
    │   ├── PRD.md
    │   └── ARCHITECTURE.md
    │
    ├── status/                  # 상태 문서
    │   ├── CURRENT_STATUS.md
    │   └── ROADMAP.md
    │
    ├── implementation-reports/  # 구현 보고서
    │   ├── 01-authentication.md
    │   ├── 02-playlist-api.md
    │   ├── 03-cli-integration.md
    │   ├── 04-cli-integration-testing.md
    │   ├── 05-auto-sync.md
    │   ├── 06-token-refresh.md
    │   ├── 07-error-handling.md
    │   ├── 08-test-improvements.md
    │   ├── 09-frontend-integration.md
    │   └── 10-supabase-edge-functions.md  # ⭐ NEW
    │
    ├── phases/                  # Phase별 계획
    │   └── phase4/
    │       ├── 4-1-videos-api.md
    │       ├── 4-2-4-3-analytics-sync-api.md
    │       └── 4-4-4-5-rate-limit-docs.md
    │
    ├── api/                     # API 문서
    ├── guides/                  # 사용 가이드
    │   └── FRONTEND_INTEGRATION_GUIDE.md  # 프론트엔드 통합 가이드 (2954줄)
    └── reports/                 # 기타 보고서
```

---

**Last Updated**: 2025-12-22
**Maintained by**: James Kim (jamesjk4242@gmail.com)
**Project**: Insighta (Insighta)
