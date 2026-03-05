# Frontend Integration Report

## Objective
tube-mandala 프론트엔드를 Insighta 백엔드와 모노레포로 통합하여 풀스택 개발 환경 구축.

## Summary

| 항목 | 내용 |
|------|------|
| 작업 일자 | 2025-12-20 |
| 소스 | [tube-mandala](https://github.com/JK42JJ/tube-mandala) |
| 프레임워크 | React 18 + Vite + TypeScript |
| UI 라이브러리 | shadcn/ui + Radix UI + Tailwind CSS |
| 상태 관리 | React Query (TanStack Query) |
| 배포 | Docker (nginx:alpine) |

---

## Changes Made

### 1. Monorepo Setup

**Frontend Clone**:
```bash
git clone https://github.com/JK42JJ/tube-mandala.git frontend
cd frontend && rm -rf .git
```

**Root package.json 업데이트**:
- `concurrently` devDependency 추가
- 모노레포 스크립트 추가:
  - `dev:all`: API + Frontend 동시 실행
  - `dev:frontend`: Frontend만 실행
  - `build:frontend`: Frontend 빌드
  - `build:all`: 전체 빌드
  - `install:all`: 전체 의존성 설치
  - `docker:build`, `docker:up`, `docker:down`, `docker:logs`

**.gitignore 업데이트**:
```gitignore
# Frontend
frontend/node_modules/
frontend/dist/
frontend/.env.local
frontend/.env.*.local

# Docker
*.tar
docker-compose.override.yml
```

---

### 2. API Client Integration

**`frontend/src/lib/api-client.ts`** (신규):
- JWT 기반 인증 클라이언트
- localStorage 토큰 관리
- 자동 토큰 갱신 (401 응답 시)
- API 메서드:
  - Auth: `login()`, `register()`, `logout()`, `refreshToken()`, `getProfile()`
  - Playlists: `getPlaylists()`, `getPlaylist()`, `importPlaylist()`, `syncPlaylist()`, `deletePlaylist()`
  - Videos: `getVideos()`, `getVideo()`, `getVideoWithCaptions()`
  - Notes: `getNotes()`, `createNote()`, `updateNote()`, `deleteNote()`
  - Sync: `getSyncStatus()`, `scheduleSync()`

**`frontend/src/hooks/use-api.ts`** (신규):
- React Query 훅 모음
- Query Keys 패턴 적용
- 훅 목록:
  - `usePlaylists()`, `usePlaylist(id)`, `useImportPlaylist()`
  - `useVideos()`, `useVideo(id)`
  - `useNotes()`, `useCreateNote()`, `useUpdateNote()`, `useDeleteNote()`
  - `useSyncPlaylist()`, `useSyncStatus()`

**Supabase 제거**:
- `@supabase/supabase-js` 의존성 제거
- `frontend/src/integrations/supabase/` 디렉토리 삭제

---

### 3. Vite Configuration

**`frontend/vite.config.ts`** 업데이트:
```typescript
server: {
  host: '0.0.0.0',
  port: 8080,
  proxy: {
    '/api': {
      target: env.VITE_API_URL || 'http://localhost:3000',
      changeOrigin: true,
      secure: false,
    },
  },
},
```

---

### 4. Docker Setup

**`frontend/Dockerfile`** (신규):
```dockerfile
# Stage 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# Stage 2: Production
FROM nginx:alpine
# Non-root user setup
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
```

**`frontend/nginx/nginx.conf`** (신규):
- Worker processes 설정
- Gzip 압축 활성화
- MIME types 설정

**`frontend/nginx/nginx.conf.template`** (신규):
- SPA fallback (`try_files $uri $uri/ /index.html`)
- 정적 파일 캐싱 (1년)
- API 프록시 (`/api` → backend)
- 보안 헤더 설정

**`docker-compose.yml`** 업데이트:
```yaml
frontend:
  build:
    context: ./frontend
    args:
      - VITE_API_URL=/api
  ports:
    - "${FRONTEND_PORT:-8080}:8080"
  depends_on:
    api:
      condition: service_healthy
  networks:
    - insighta-network
```

---

### 5. Development Scripts

**`scripts/dev.sh`** (신규):
- 의존성 자동 설치
- Prisma 클라이언트 생성
- API + Frontend 동시 실행

**`scripts/docker-build.sh`** (신규):
- Docker 이미지 빌드 (API, Frontend)
- `--api-only`, `--frontend-only`, `--no-cache` 옵션

---

### 6. Environment Files

**`frontend/.env.example`**:
```env
VITE_API_URL=http://localhost:3000
VITE_APP_NAME=Insighta
VITE_APP_VERSION=1.0.0
```

**`frontend/.env.development`**:
- `VITE_API_URL=http://localhost:3000`

**`frontend/.env.production`**:
- `VITE_API_URL=` (nginx 프록시 사용)

---

## Files Summary

### Created (12 files)
| 파일 | 설명 |
|------|------|
| `frontend/src/lib/api-client.ts` | JWT 기반 API 클라이언트 |
| `frontend/src/hooks/use-api.ts` | React Query 훅 |
| `frontend/Dockerfile` | Multi-stage Docker 빌드 |
| `frontend/nginx/nginx.conf` | nginx 메인 설정 |
| `frontend/nginx/nginx.conf.template` | nginx 서버 설정 템플릿 |
| `frontend/.dockerignore` | Docker 빌드 제외 파일 |
| `frontend/.env.example` | 환경변수 템플릿 |
| `frontend/.env.development` | 개발 환경 설정 |
| `frontend/.env.production` | 프로덕션 환경 설정 |
| `scripts/dev.sh` | 개발 환경 시작 스크립트 |
| `scripts/docker-build.sh` | Docker 빌드 스크립트 |

### Modified (5 files)
| 파일 | 변경 내용 |
|------|----------|
| `/package.json` | 모노레포 스크립트, concurrently 추가 |
| `/docker-compose.yml` | frontend 서비스 추가 |
| `/.gitignore` | frontend, Docker 항목 추가 |
| `/frontend/package.json` | Supabase 제거, 이름 변경 |
| `/frontend/vite.config.ts` | API 프록시 설정 |

### Deleted
| 파일/디렉토리 | 이유 |
|--------------|------|
| `frontend/src/integrations/supabase/` | 자체 API 클라이언트로 대체 |

---

## Tech Stack Summary

| Layer | Technology |
|-------|------------|
| **Framework** | React 18.3 |
| **Build Tool** | Vite 5.4 |
| **Language** | TypeScript 5.8 |
| **UI Components** | shadcn/ui + Radix UI |
| **Styling** | Tailwind CSS 3.4 |
| **State Management** | TanStack Query 5.x |
| **Form Handling** | React Hook Form + Zod |
| **Charts** | Recharts 2.x |
| **Icons** | Lucide React |
| **Production** | nginx:alpine |

---

## Usage Commands

### Development
```bash
# API + Frontend 동시 실행
npm run dev:all

# Frontend만 실행
npm run dev:frontend

# 스크립트 사용
./scripts/dev.sh
```

### Docker
```bash
# 이미지 빌드
npm run docker:build
# 또는
./scripts/docker-build.sh

# 서비스 시작
npm run docker:up
# Frontend: http://localhost:8080
# API: http://localhost:3000

# 로그 확인
npm run docker:logs

# 서비스 종료
npm run docker:down
```

### Production Build
```bash
# Frontend 빌드
npm run build:frontend

# 전체 빌드 (Backend + Frontend)
npm run build:all
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser Client                        │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   nginx (Port 8080)                      │
│  ┌─────────────────┐    ┌──────────────────────────┐    │
│  │  Static Files   │    │    API Proxy (/api)      │    │
│  │  (React SPA)    │    │    → Backend:3000        │    │
│  └─────────────────┘    └──────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  Fastify API (Port 3000)                 │
│  ┌─────────────────┐    ┌──────────────────────────┐    │
│  │  REST Routes    │    │     JWT Auth             │    │
│  │  /api/v1/*      │    │     Middleware           │    │
│  └─────────────────┘    └──────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  PostgreSQL / SQLite                     │
└─────────────────────────────────────────────────────────┘
```

---

## Next Steps

1. **컴포넌트 연결**: 기존 UI 컴포넌트를 API 클라이언트와 연결
2. **인증 플로우**: 로그인/회원가입 페이지 구현
3. **플레이리스트 UI**: 플레이리스트 목록/상세 페이지 연동
4. **에러 처리**: Toast 알림을 활용한 에러 표시

---

*작성일: 2025-12-20*
*작성자: James Kim (jamesjk4242@gmail.com)*
