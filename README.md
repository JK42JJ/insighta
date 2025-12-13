# YouTube Playlist Sync Module

개인 지식관리 및 학습 플랫폼을 위한 YouTube 플레이리스트 동기화 모듈입니다.

## 🎯 목적

YouTube 플레이리스트를 로컬 데이터베이스에 자동으로 동기화하여 동영상 메타데이터를 수집하고, 개인 메모, 요약, 학습 진도 관리 기능의 기반을 제공합니다.

## ✨ 주요 기능

- ✅ YouTube 플레이리스트 자동 동기화
- ✅ 동영상 메타데이터 수집 (제목, 설명, 길이, 통계 등)
- ✅ 시청 상태 및 진도 추적
- ✅ 개인 메모 및 요약 기능
- ✅ 주기적 자동 동기화 스케줄링
- ✅ CLI 인터페이스

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

### 3. YouTube API 인증 정보 획득

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 새 프로젝트 생성 또는 기존 프로젝트 선택
3. YouTube Data API v3 활성화
4. OAuth 2.0 클라이언트 ID 생성
5. API 키 생성
6. `.env` 파일에 인증 정보 입력

```env
YOUTUBE_API_KEY=your_api_key
YOUTUBE_CLIENT_ID=your_client_id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=your_client_secret
```

### 4. 첫 플레이리스트 동기화

```bash
# CLI를 통한 플레이리스트 동기화
npm run cli sync <playlist-url>

# 예시
npm run cli sync https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxx
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

## 🛠️ 개발

### 개발 환경 실행

```bash
# 개발 모드
npm run dev

# 빌드
npm run build

# 프로덕션 실행
npm start
```

### 테스트

```bash
# 전체 테스트 실행
npm test

# 특정 테스트만 실행
npm run test:unit
npm run test:integration
npm run test:e2e

# 테스트 커버리지
npm run test:cov

# Watch 모드
npm run test:watch
```

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
├── src/
│   ├── api/              # YouTube API 클라이언트
│   │   ├── youtube-client.ts
│   │   ├── oauth-manager.ts
│   │   ├── rate-limiter.ts
│   │   └── response-cache.ts
│   ├── modules/
│   │   ├── playlist/     # 플레이리스트 관리
│   │   ├── video/        # 비디오 메타데이터 관리
│   │   ├── sync/         # 동기화 로직
│   │   └── database/     # 데이터베이스 레이어
│   ├── cli/              # CLI 인터페이스
│   ├── config/           # 설정 관리
│   └── utils/            # 유틸리티
├── test/                 # 테스트
├── prisma/              # Prisma 스키마 및 마이그레이션
├── docs/                # 추가 문서
└── data/                # 로컬 데이터베이스
```

## 🏗️ 아키텍처

자세한 아키텍처 설계는 [ARCHITECTURE.md](./ARCHITECTURE.md)를 참조하세요.

### 핵심 컴포넌트

1. **YouTube API Client**: OAuth 2.0 인증, Rate Limiting, 캐싱
2. **Playlist Manager**: 플레이리스트 가져오기 및 동기화
3. **Video Manager**: 동영상 메타데이터 수집
4. **Sync Scheduler**: 주기적 동기화 작업 관리
5. **Database Layer**: Prisma ORM을 통한 데이터 영속성

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

### Phase 1: 기본 기능 (현재)
- [x] 프로젝트 초기화
- [ ] YouTube API 통합
- [ ] 플레이리스트 동기화
- [ ] CLI 인터페이스
- [ ] 테스트 커버리지 80%+

### Phase 2: 고급 기능 (향후)
- [ ] 동영상 자막 다운로드
- [ ] AI 기반 동영상 요약
- [ ] 타임스탬프 기반 메모
- [ ] 학습 분석 대시보드
- [ ] Web UI (선택사항)

## 🤝 기여

기여는 언제나 환영합니다! 자세한 내용은 [CONTRIBUTING.md](./CONTRIBUTING.md)를 참조하세요.

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 [LICENSE](./LICENSE)를 참조하세요.

## 📚 추가 문서

- [PRD.md](./PRD.md) - 제품 요구사항 명세
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 아키텍처 설계 문서
- [CLAUDE.md](./CLAUDE.md) - Claude Code 작업 가이드
- [TASK_HIERARCHY.md](./TASK_HIERARCHY.md) - 작업 계층 구조

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

## 📞 연락처

문제나 제안사항이 있으시면 이슈를 생성해주세요.

---

**Made with ❤️ for better knowledge management**
