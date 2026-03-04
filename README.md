# YouTube Playlist Sync Module

개인 지식관리 및 학습 플랫폼을 위한 YouTube 플레이리스트 동기화 모듈입니다.

## 🎯 목적

YouTube 플레이리스트를 로컬 데이터베이스에 자동으로 동기화하여 동영상 메타데이터를 수집하고, 개인 메모, 요약, 학습 진도 관리 기능의 기반을 제공합니다.

## ✨ 주요 기능

### Phase 1: 핵심 동기화 기능
- ✅ YouTube 플레이리스트 자동 동기화
- ✅ 동영상 메타데이터 수집 (제목, 설명, 길이, 통계 등)
- ✅ 주기적 자동 동기화 스케줄링
- ✅ CLI 인터페이스

### Phase 2: 지식 관리 기능
- ✅ **동영상 자막 추출** - 7개 언어 지원 (en, ko, ja, es, fr, de, zh)
- ✅ **AI 기반 동영상 요약** - OpenAI GPT-4 활용, 3단계 요약 레벨
- ✅ **타임스탬프 기반 개인 메모** - 마크다운 지원, 태그 시스템
- ✅ **학습 분석 대시보드** - 시청 진도, 완료율, 학습 연속일 추적

### Phase 5: 프론트엔드 ⭐ NEW
- ✅ **React 프론트엔드** - Vite + shadcn/ui + Tailwind CSS
- ✅ **모노레포 구조** - Backend + Frontend 통합 개발 환경
- ✅ **Docker 배포** - nginx:alpine 기반 프로덕션 빌드

## 🚀 빠른 시작

### 1. 필수 요구사항

- Node.js >= 18.0.0
- npm >= 9.0.0
- YouTube Data API v3 인증 정보

### 2. 설치

```bash
# 저장소 클론
git clone <repository-url>
cd sync-youtube-playlists

# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env
# .env 파일을 편집하여 YouTube API 인증 정보 입력

# Prisma 클라이언트 생성
npm run prisma:generate

# 데이터베이스 마이그레이션
npm run prisma:migrate
```

### 3. YouTube API OAuth 2.0 설정

YouTube API를 사용하려면 OAuth 2.0 인증 정보가 필요합니다.

**📖 상세 설정 가이드**: **[YouTube API OAuth 설정 가이드](./docs/YOUTUBE_API_SETUP.md)**

#### 빠른 설정 요약

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성
2. YouTube Data API v3 활성화
3. OAuth 2.0 클라이언트 ID 생성 (Desktop app)
4. `.env` 파일에 인증 정보 추가
5. CLI로 OAuth 인증 완료:

```bash
# 1. OAuth URL 생성
npm run cli -- auth

# 2. 브라우저에서 인증 후 코드 복사
npm run cli -- auth-callback "4/0AeanS0a...your_code_here..."

# 3. 인증 상태 확인
npm run cli -- auth-status
```

**환경 변수 설정 예시**:

```env
# YouTube API OAuth 2.0
YOUTUBE_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-AbCdEfGhIjKlMnOp
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback

# Encryption (토큰 저장용)
ENCRYPTION_SECRET=<64-character hex string>

# Gemini API (AI 요약 기능 사용 시 필수)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

### 4. 첫 플레이리스트 동기화

```bash
# CLI를 통한 플레이리스트 동기화
npm run cli sync <playlist-url>

# 예시
npm run cli sync https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxx
```

## 💡 사용 예시

### 전체 워크플로우 예시

```bash
# 1. 플레이리스트 동기화 (향후 구현)
npm run cli sync https://www.youtube.com/playlist?list=PLxxxxxx

# 2. 특정 동영상의 자막 다운로드
npm run cli caption-download dQw4w9WgXcQ -l ko

# 3. AI 요약 생성
npm run cli summarize dQw4w9WgXcQ -l medium --language ko

# 4. 학습하면서 노트 추가
npm run cli note-add dQw4w9WgXcQ 150 "중요한 개념: React Hooks 사용법" -t "react,hooks,important"
npm run cli note-add dQw4w9WgXcQ 320 "질문: useEffect 의존성 배열?" -t "react,question"

# 5. 시청 세션 기록 (2분 30초부터 4분까지 시청)
npm run cli session-record dQw4w9WgXcQ 150 240 150 240

# 6. 학습 진도 확인
npm run cli analytics-video dQw4w9WgXcQ
npm run cli analytics-dashboard

# 7. 노트 내보내기
npm run cli note-export ./my-notes.md -f markdown -v dQw4w9WgXcQ

# 8. 복습 추천 확인
npm run cli retention dQw4w9WgXcQ
```

### 일괄 처리 예시

```bash
# 플레이리스트 전체 요약
npm run cli summarize-playlist PLxxxxxx -l short

# 특정 태그의 노트만 내보내기
npm run cli note-export ./react-notes.json -f json -t react

# 플레이리스트 전체 진도 확인
npm run cli analytics-playlist PLxxxxxx
```

## 📖 사용법

### CLI 명령어

#### 플레이리스트 동기화
```bash
# URL로 동기화
npm run cli sync <playlist-url>

# ID로 동기화
npm run cli sync <playlist-id>

# 모든 플레이리스트 동기화
npm run cli sync --all
```

#### 플레이리스트 목록 조회
```bash
# 전체 목록
npm run cli list

# 필터링
npm run cli list --filter "learning"

# 정렬
npm run cli list --sort "last-synced"
```

#### 자동 동기화 스케줄링
```bash
# 1시간마다 동기화
npm run cli schedule --interval 1h

# 스케줄 중지
npm run cli schedule --stop

# 스케줄 상태 확인
npm run cli schedule --status
```

#### 설정 관리
```bash
# 설정 보기
npm run cli config --view

# 설정 변경
npm run cli config --set KEY=VALUE

# OAuth 인증 설정
npm run cli config --auth
```

#### 자막 추출 및 요약
```bash
# 자막 다운로드
npm run cli caption-download <video-id> [-l language]

# 사용 가능한 자막 언어 확인
npm run cli caption-languages <video-id>

# 동영상 요약 생성
npm run cli summarize <video-id> [-l short|medium|detailed] [--language lang]

# 플레이리스트 일괄 요약
npm run cli summarize-playlist <playlist-id> [-l short|medium|detailed]
```

#### 개인 노트 관리
```bash
# 노트 추가 (타임스탬프는 초 단위)
npm run cli note-add <video-id> <timestamp> <content> [-t tag1,tag2]

# 노트 목록 조회
npm run cli note-list [-v video-id] [-t tags] [-s search] [--from sec] [--to sec]

# 노트 수정
npm run cli note-update <note-id> [-c content] [-t tags] [--timestamp sec]

# 노트 삭제
npm run cli note-delete <note-id>

# 노트 내보내기 (markdown, json, csv)
npm run cli note-export <output-path> [-f format] [-v video-id] [-t tags]
```

#### 학습 분석
```bash
# 시청 세션 기록
npm run cli session-record <video-id> <start-pos> <end-pos> <start-time> <end-time>

# 동영상별 학습 분석
npm run cli analytics-video <video-id>

# 플레이리스트 진도 분석
npm run cli analytics-playlist <playlist-id>

# 전체 학습 대시보드
npm run cli analytics-dashboard

# 복습 추천 및 보유 메트릭
npm run cli retention <video-id>
```

## 🛠️ 개발

### 개발 환경 실행

```bash
# Backend API 개발 모드
npm run dev

# Frontend + Backend 동시 실행 (모노레포)
npm run dev:all

# Frontend만 실행
npm run dev:frontend

# 빌드
npm run build

# 전체 빌드 (Backend + Frontend)
npm run build:all

# 프로덕션 실행
npm start
```

### Docker 배포

```bash
# Docker 이미지 빌드
npm run docker:build

# Docker 서비스 시작
npm run docker:up
# Frontend: http://localhost:8080
# API: http://localhost:3000

# 로그 확인
npm run docker:logs

# 서비스 종료
npm run docker:down
```

### 테스트

#### E2E 테스트 (Phase 3.1)

```bash
# 환경 설정
./tests/e2e/setup-test-env.sh

# 전체 E2E 테스트 실행
./tests/e2e/run-all-tests.sh [playlist-id]

# 개별 E2E 테스트
./tests/e2e/test-oauth-flow.sh
./tests/e2e/test-cache-performance.sh [playlist-id]
./tests/e2e/test-quota-tracking.sh [playlist-id]
```

#### Unit/Integration 테스트 (향후 구현)

```bash
# 전체 테스트 실행
npm test

# 특정 테스트만 실행
npm run test:unit
npm run test:integration

# 테스트 커버리지
npm run test:cov

# Watch 모드
npm run test:watch
```

**상세 가이드**: [tests/README.md](./tests/README.md)

### 코드 품질

```bash
# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
npm run format:check

# Type checking
npm run typecheck
```

### 데이터베이스 관리

```bash
# Prisma Studio (데이터베이스 GUI)
npm run prisma:studio

# 새 마이그레이션 생성
npm run prisma:migrate -- --name <migration-name>

# 스키마 변경 즉시 반영 (개발 전용)
npm run prisma:push

# 시드 데이터 생성
npm run db:seed
```

## 📁 프로젝트 구조

```
sync-youtube-playlists/
├── frontend/             # React 프론트엔드 ⭐ NEW
│   ├── src/
│   │   ├── components/   # shadcn/ui 컴포넌트
│   │   ├── hooks/        # React Query 훅 (use-api.ts)
│   │   ├── lib/          # API 클라이언트 (api-client.ts)
│   │   └── pages/        # 페이지 컴포넌트
│   ├── nginx/            # nginx 설정 (Docker용)
│   ├── Dockerfile        # Multi-stage 빌드
│   └── vite.config.ts    # Vite 설정
│
├── scripts/              # 개발 스크립트 ⭐ NEW
│   ├── dev.sh            # 개발 환경 시작
│   └── docker-build.sh   # Docker 빌드
│
├── src/
│   ├── adapters/         # Universal Adapter System (Phase 3.5)
│   │   ├── DataSourceAdapter.ts  # 범용 어댑터 인터페이스
│   │   ├── YouTubeAdapter.ts     # YouTube 어댑터 구현
│   │   ├── AdapterRegistry.ts    # 어댑터 레지스트리
│   │   ├── AdapterFactory.ts     # 어댑터 팩토리
│   │   └── index.ts              # 통합 export
│   ├── api/              # YouTube API 클라이언트
│   │   ├── youtube-client.ts
│   │   ├── oauth-manager.ts
│   │   ├── rate-limiter.ts
│   │   └── response-cache.ts
│   ├── modules/
│   │   ├── playlist/     # 플레이리스트 관리
│   │   ├── video/        # 비디오 메타데이터 관리
│   │   ├── sync/         # 동기화 로직
│   │   ├── caption/      # 자막 추출 (Phase 2)
│   │   ├── summarization/# AI 요약 생성 (Phase 2)
│   │   ├── note/         # 개인 노트 관리 (Phase 2)
│   │   ├── analytics/    # 학습 분석 (Phase 2)
│   │   └── database/     # 데이터베이스 레이어
│   ├── cli/              # CLI 인터페이스
│   ├── config/           # 설정 관리
│   └── utils/            # 유틸리티
├── tests/                # 테스트
│   ├── unit/            # 단위 테스트 (adapter-registry, adapter-factory)
│   ├── integration/     # 통합 테스트 (youtube-adapter)
│   ├── e2e/             # E2E 테스트
│   └── manual/          # 수동 테스트
├── docs/                # 문서
│   ├── ADAPTER_SYSTEM.md  # Adapter System 가이드
│   ├── guides/          # 설정 가이드
│   └── reports/         # 완료 보고서
├── prisma/              # Prisma 스키마 및 마이그레이션
│   └── migrations/      # 데이터베이스 마이그레이션
├── docker-compose.yml   # Docker Compose 설정 ⭐ NEW
├── CHANGELOG.md         # 버전별 변경 이력 ⭐ NEW
└── data/                # 로컬 데이터베이스
```

## 🏗️ 아키텍처

자세한 아키텍처 설계는 [ARCHITECTURE.md](./ARCHITECTURE.md)를 참조하세요.

### 핵심 컴포넌트

**Phase 1: 동기화 인프라**
1. **YouTube API Client**: OAuth 2.0 인증, Rate Limiting, 캐싱
2. **Playlist Manager**: 플레이리스트 가져오기 및 동기화
3. **Video Manager**: 동영상 메타데이터 수집
4. **Sync Scheduler**: 주기적 동기화 작업 관리
5. **Database Layer**: Prisma ORM을 통한 데이터 영속성

**Phase 2: 지식 관리**
6. **Caption Extractor**: YouTube 자막 추출 및 캐싱
7. **Summary Generator**: OpenAI 기반 동영상 요약
8. **Note Manager**: 타임스탬프 기반 노트 CRUD
9. **Analytics Tracker**: 학습 진도 및 복습 추천

### 데이터 플로우

```
YouTube API → API Client → Playlist/Video Manager → Database
                ↓
           Sync Scheduler
```

## ⚡ 성능 최적화

### API 쿼터 관리
- 일일 쿼터: 10,000 units (기본)
- 배치 처리: 50개 동영상씩 묶어서 요청
- 증분 동기화: 변경사항만 동기화
- 캐싱: 변경되지 않은 데이터 재사용

### 성능 목표
- 100개 동영상 플레이리스트 동기화: < 30초
- API 응답 시간 (p95): < 2초
- 데이터베이스 쿼리: < 100ms
- 동기화 성공률: > 99%

## 🔒 보안

- OAuth 2.0 토큰 암호화 저장
- API 키 환경변수 관리
- 민감 정보 로그 제외
- 로컬 데이터베이스 (외부 전송 없음)

## 📊 모니터링

### 로깅
로그는 `logs/` 디렉토리에 저장됩니다:
- `error.log`: 에러 레벨 로그
- `combined.log`: 전체 로그

### 쿼터 사용량 추적
```bash
# 데이터베이스에서 쿼터 사용량 확인
npm run prisma:studio
# quota_usage 테이블 조회
```

## 🗺️ 로드맵

### Phase 1: 기본 기능 ✅
- [x] 프로젝트 초기화
- [x] 데이터베이스 스키마 설계
- [x] CLI 인터페이스 기반 구조
- [x] 동기화 스케줄러 구현
- [x] 캐싱 시스템 구현

### Phase 2: 지식 관리 기능 ✅
- [x] 동영상 자막 추출 (7개 언어 지원)
- [x] AI 기반 동영상 요약 (OpenAI GPT-4)
- [x] 타임스탬프 기반 개인 노트
- [x] 학습 분석 대시보드
- [x] 복습 추천 시스템

### Phase 3: REST API & CLI Development ✅ (부분 완료)

#### Phase 3.1: YouTube API Integration ✅ (완료)
- [x] OAuth 2.0 인증 구현 (CLI 명령어)
- [x] YouTube API 클라이언트 완성
- [x] 플레이리스트 임포트 및 동기화
- [x] 응답 캐싱 시스템 (API 쿼터 절약)
- [x] 쿼터 트래킹 시스템
- [x] E2E 테스팅 인프라 (자동화된 테스트 스크립트)

#### Phase 3.2: Authentication & Security ✅ (완료)
- [x] **JWT 기반 인증 시스템** - Fastify 플러그인
  - Access Token (15분 만료) + Refresh Token (7일 만료)
  - 비밀번호 암호화 (bcrypt)
- [x] **사용자 관리 API** (5개 엔드포인트)
  - POST `/api/v1/auth/register` - 회원가입
  - POST `/api/v1/auth/login` - 로그인
  - POST `/api/v1/auth/refresh` - 토큰 갱신
  - POST `/api/v1/auth/logout` - 로그아웃
  - GET `/api/v1/auth/me` - 프로필 조회
- [x] 보안 헤더 및 CORS 설정
- [x] 비밀번호 강도 검증 (8자 이상, 대/소문자, 숫자, 특수문자)

#### Phase 3.3: Playlist Management API ✅ (완료)
- [x] **플레이리스트 API** (5개 엔드포인트)
  - POST `/api/v1/playlists/import` - 플레이리스트 가져오기
  - GET `/api/v1/playlists` - 목록 조회 (필터링, 정렬, 페이징)
  - GET `/api/v1/playlists/:id` - 상세 조회
  - POST `/api/v1/playlists/:id/sync` - 동기화 실행
  - DELETE `/api/v1/playlists/:id` - 삭제
- [x] Zod 기반 스키마 검증
- [x] OpenAPI 3.1 명세 자동 생성
- [x] Swagger UI 및 Scalar API 문서 자동 생성

#### Phase 3.4: CLI Integration ✅ (완료)
- [x] **API Client Module** - HTTP 요청 처리
- [x] **Token Storage Module** - JWT 토큰 로컬 저장 (파일 권한 0o600)
- [x] **User Authentication Commands** (4개)
  - `user-register`, `user-login`, `user-logout`, `user-whoami`
- [x] **Playlist Management Commands** (5개)
  - `playlist-import`, `playlist-list`, `playlist-get`, `playlist-sync`, `playlist-delete`
- [x] 인터랙티브 비밀번호 입력 (숨김 처리)
- [x] 에러 처리 및 사용자 피드백

#### Phase 3.5: Integration Testing & Documentation ✅ (완료)
- [x] **CLI 통합 테스트** - 29개 테스트, 100% 성공
  - API 엔드포인트 테스트 (3개)
  - CLI 명령어 테스트 (10개)
  - 보안 테스트 (6개)
  - 통합 테스트 (2개)
  - 에러 핸들링 테스트 (8개)
- [x] **YouTube API OAuth 설정 가이드** 작성
  - Google Cloud Console 설정 (7단계)
  - 문제 해결 가이드 (6가지 일반 문제)
  - API 할당량 관리
  - 보안 모범 사례
- [x] **문서 인덱스** 업데이트 (docs/INDEX.md)

#### Phase 3.6: Testing & Stabilization ✅ (완료)
- [x] 단위 테스트 및 통합 테스트 자동화 (Jest/Vitest, 80%+ 커버리지)
- [x] 플레이리스트 자동 동기화 스케줄러 개선
- [x] 토큰 자동 갱신 기능 (Refresh Token 활용)
- [x] 에러 핸들링 및 복구 메커니즘 강화
- [x] 성능 최적화 및 모니터링

### Phase 4: Advanced API Features ✅ (완료)
- [x] **Videos API** - 동영상 메타데이터, 메모, 요약, 분석
- [x] **Analytics API** - 학습 통계, 진도 추적
- [x] **Sync API** - 동기화 상태 조회 및 관리
- [x] **Rate Limiting** - API 요청 속도 제한
- [x] **API 문서화 인프라** - Docusaurus + OpenAPI/Scalar
  - Docusaurus 기반 가이드/튜토리얼 사이트
  - 고급 사용 예제 및 SDK 문서
- [ ] 다중 사용자 지원 (선택사항)

### Phase 5: Frontend Integration ✅ (완료)
- [x] **React 프론트엔드** - Vite + shadcn/ui + Tailwind CSS
- [x] **모노레포 구조** - Backend + Frontend 통합 개발 환경
- [x] **API 클라이언트 통합** - JWT 기반 인증 (`api-client.ts`)
- [x] **React Query 훅** - 데이터 페칭 및 캐싱 (`use-api.ts`)
- [x] **Docker 배포** - nginx:alpine 기반 프로덕션 빌드
- [x] **개발 스크립트** - `dev.sh`, `docker-build.sh`

### Phase 6: Production Deployment (예정)
- [ ] Vercel/Railway 배포
- [ ] 도메인 설정 및 SSL
- [ ] 모니터링 및 로깅
- [ ] 사용자 피드백 수집

## 🤝 기여

기여는 언제나 환영합니다! 자세한 내용은 [CONTRIBUTING.md](./CONTRIBUTING.md)를 참조하세요.

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 [LICENSE](./LICENSE)를 참조하세요.

## 📚 문서 구조 (Documentation)

### 시작하기
- **[README](./README.md)** - 이 문서 (프로젝트 개요 및 빠른 시작)
- **[CHANGELOG](./CHANGELOG.md)** - 버전별 변경 이력 ⭐ NEW
- **[OAuth 설정 가이드](./docs/guides/SETUP_OAUTH.md)** - YouTube API 인증 설정
- **[테스트 가이드](./docs/guides/TEST_GUIDE.md)** - 테스트 실행 방법

### 상세 문서
- **[📚 전체 문서 인덱스](./docs/INDEX.md)** - 모든 문서 네비게이션
- **[🏗️ 아키텍처](./docs/spec/ARCHITECTURE.md)** - 시스템 설계 상세
- **[📋 PRD](./docs/spec/PRD.md)** - 제품 요구사항 명세
- **[📊 Phase 문서](./docs/phases/)** - 개발 단계별 문서
  - [Phase 1](./docs/phases/phase1/) - 핵심 동기화 기능
  - [Phase 2](./docs/phases/phase2/) - 지식 관리 기능
  - [Phase 3](./docs/phases/phase3/) - YouTube API 통합
- **[📁 완료 보고서](./docs/reports/)** - 완료 보고서 모음

### 개발자 도구
- **[🤖 Claude Code 가이드](./CLAUDE.md)** - AI 개발 어시스턴트 가이드
- **[📐 작업 구조](./docs/guides/TASK_HIERARCHY.md)** - 작업 분류 체계

## 🆘 문제 해결

### 일반적인 문제

#### "YouTube API quota exceeded"
- 쿼터 사용량을 확인하고 다음 날까지 대기
- 캐싱 활용 및 증분 동기화 사용
- 필요시 Google Cloud Console에서 쿼터 증가 요청

#### "Authentication failed"
- `.env` 파일의 인증 정보 확인
- OAuth 토큰 갱신: `npm run cli config --auth`
- Google Cloud Console에서 OAuth 동의 화면 설정 확인

#### "Database migration failed"
- 기존 데이터베이스 백업
- `data/` 디렉토리 삭제 후 재실행
- `npm run prisma:migrate -- --create-only`로 마이그레이션만 생성

#### "OpenAI API error" (요약 기능 사용 시)
- `.env` 파일에 `OPENAI_API_KEY` 설정 확인
- OpenAI API 크레딧 잔액 확인
- 긴 동영상의 경우 자막이 자동으로 truncate됨 (약 4000 토큰)
- Rate limit 초과 시 잠시 대기 후 재시도

#### "Caption not available"
- 해당 동영상에 자막이 없는 경우
- `npm run cli caption-languages <video-id>`로 사용 가능한 언어 확인
- 자동 생성 자막만 있는 경우 품질이 낮을 수 있음

## 📞 연락처

문제나 제안사항이 있으시면 이슈를 생성해주세요.

---

**Made with ❤️ for better knowledge management**
