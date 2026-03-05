# Docker 배포 가이드

Insighta를 Docker로 배포하는 방법을 설명합니다.

## 목차

- [빠른 시작](#빠른-시작)
- [사전 요구사항](#사전-요구사항)
- [환경 설정](#환경-설정)
- [로컬 실행](#로컬-실행)
- [PaaS 배포](#paas-배포)
- [CLI 명령어](#cli-명령어)
- [트러블슈팅](#트러블슈팅)

---

## 빠른 시작

```bash
# 1. 환경 파일 설정
cp .env.docker.example .env.docker
# .env.docker 파일을 편집하여 필수 값 입력

# 2. Docker 이미지 빌드
docker build -t ytsync .

# 3. 컨테이너 실행
docker run -d --name ytsync-api \
  --env-file .env.docker \
  -p 3000:3000 \
  ytsync api

# 4. 상태 확인
curl http://localhost:3000/health
```

---

## 사전 요구사항

- Docker 20.10+
- Docker Compose 2.0+ (선택)
- 외부 PostgreSQL 데이터베이스 (Neon, Supabase, Railway 등)

---

## 환경 설정

### 1. 환경 파일 생성

```bash
cp .env.docker.example .env.docker
```

### 2. 필수 환경변수 설정

**.env.docker** 파일에서 다음 값을 설정하세요:

| 변수 | 설명 | 예시 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 연결 문자열 | `postgresql://user:pass@host:5432/db` |
| `YOUTUBE_CLIENT_ID` | YouTube OAuth Client ID | `xxx.apps.googleusercontent.com` |
| `YOUTUBE_CLIENT_SECRET` | YouTube OAuth Secret | `GOCSPX-xxx` |
| `ENCRYPTION_SECRET` | 암호화 키 (64자 hex) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_SECRET` | JWT 서명 키 | 임의의 긴 문자열 |

### 3. 데이터베이스 설정

**Neon (추천)**:
```
DATABASE_URL=postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require
```

**Supabase**:
```
DATABASE_URL=postgresql://postgres:pass@db.xxx.supabase.co:5432/postgres
```

**Railway**:
```
DATABASE_URL=postgresql://postgres:pass@xxx.railway.app:5432/railway
```

---

## 로컬 실행

### Docker Compose 사용

```bash
# 시작
docker compose up -d

# 로그 확인
docker compose logs -f

# 중지
docker compose down
```

### Docker 직접 사용

```bash
# 이미지 빌드
docker build -t ytsync .

# API 서버 실행
docker run -d --name ytsync-api \
  --env-file .env.docker \
  -p 3000:3000 \
  ytsync api

# 스케줄러 실행 (선택)
docker run -d --name ytsync-scheduler \
  --env-file .env.docker \
  -e SKIP_MIGRATIONS=true \
  ytsync scheduler
```

---

## PaaS 배포

### Railway

```bash
# Railway CLI 설치
npm install -g @railway/cli

# 로그인 및 프로젝트 생성
railway login
railway init

# 환경변수 설정 (Railway 대시보드 또는 CLI)
railway variables set DATABASE_URL="..."
railway variables set YOUTUBE_CLIENT_ID="..."
# ... 나머지 변수들

# 배포
railway up
```

**railway.json** (선택):
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "api",
    "healthcheckPath": "/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

### Render

1. [Render Dashboard](https://dashboard.render.com)에서 새 Web Service 생성
2. Docker 선택
3. 환경변수 설정
4. 배포

**render.yaml** (선택):
```yaml
services:
  - type: web
    name: ytsync-api
    env: docker
    dockerfilePath: ./Dockerfile
    dockerCommand: api
    healthCheckPath: /health
    envVars:
      - key: DATABASE_URL
        sync: false
      - key: NODE_ENV
        value: production
```

### Fly.io

```bash
# Fly CLI 설치
curl -L https://fly.io/install.sh | sh

# 앱 생성
fly launch

# 비밀 설정
fly secrets set DATABASE_URL="..."
fly secrets set YOUTUBE_CLIENT_ID="..."
fly secrets set JWT_SECRET="..."
# ... 나머지 변수들

# 배포
fly deploy
```

**fly.toml** (자동 생성됨):
```toml
app = "ytsync-api"
primary_region = "nrt"  # 또는 원하는 리전

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  API_PORT = "3000"

[http_service]
  internal_port = 3000
  force_https = true

[[services.tcp_checks]]
  grace_period = "30s"
  interval = "15s"
  timeout = "10s"
```

---

## CLI 명령어

Docker 컨테이너 내에서 CLI 명령을 실행하는 방법:

### Docker Compose 사용

```bash
# 플레이리스트 가져오기
docker compose run --rm api cli import PLxxxxxxxxxx

# 모든 플레이리스트 동기화
docker compose run --rm api cli sync --all

# 할당량 확인
docker compose run --rm api cli quota

# OAuth 인증
docker compose run --rm api cli auth
```

### Docker 직접 사용

```bash
# 플레이리스트 가져오기
docker run --rm --env-file .env.docker ytsync cli import PLxxxxxxxxxx

# 동기화
docker run --rm --env-file .env.docker ytsync cli sync --all
```

---

## 서비스 모드

| 모드 | 명령어 | 설명 |
|------|--------|------|
| `api` | `docker run ... ytsync api` | REST API 서버 (기본) |
| `scheduler` | `docker run ... ytsync scheduler` | 백그라운드 동기화 스케줄러 |
| `cli` | `docker run ... ytsync cli <command>` | 일회성 CLI 명령 실행 |
| `migrate` | `docker run ... ytsync migrate` | DB 마이그레이션만 실행 |

---

## 헬스체크

API 서버 상태 확인:

```bash
curl http://localhost:3000/health
```

응답:
```json
{
  "status": "ok",
  "timestamp": "2025-01-15T12:00:00.000Z"
}
```

---

## 트러블슈팅

### 데이터베이스 연결 실패

```
ERROR: Could not connect to database after 30 attempts
```

**해결방법**:
1. `DATABASE_URL`이 올바른지 확인
2. 데이터베이스 서버가 실행 중인지 확인
3. 방화벽/보안그룹에서 연결 허용 확인
4. SSL 설정 확인 (`?sslmode=require`)

### 이미지 빌드 실패

```
npm ERR! code ELIFECYCLE
```

**해결방법**:
```bash
# 캐시 없이 빌드
docker build --no-cache -t ytsync .

# 빌더 정리 후 빌드
docker builder prune -f
docker build -t ytsync .
```

### 포트 충돌

```
Error: bind: address already in use
```

**해결방법**:
```bash
# 다른 포트 사용
docker run -p 3001:3000 ytsync api

# 또는 기존 컨테이너 중지
docker stop ytsync-api
```

### 마이그레이션 실패

```
Error: Migration failed
```

**해결방법**:
```bash
# 수동으로 마이그레이션 실행
docker run --rm --env-file .env.docker ytsync migrate

# 또는 DB 상태 확인
docker run --rm --env-file .env.docker ytsync cli \
  -- npx prisma db push --accept-data-loss
```

---

## 로그 확인

```bash
# Docker Compose
docker compose logs -f api
docker compose logs -f scheduler

# Docker 직접
docker logs -f ytsync-api
```

---

## 볼륨 관리

```bash
# 볼륨 목록
docker volume ls | grep ytsync

# 볼륨 삭제 (주의: 데이터 손실)
docker compose down -v
```

---

## 보안 권장사항

1. **프로덕션 환경에서 강력한 비밀값 사용**
   ```bash
   # 암호화 키 생성
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

   # JWT 시크릿 생성
   node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
   ```

2. **환경변수는 PaaS의 시크릿 관리 기능 사용**
   - Railway: Variables
   - Render: Environment Variables
   - Fly.io: Secrets

3. **HTTPS 사용** (PaaS는 기본 제공)

4. **CORS 설정 제한**
   ```env
   CORS_ORIGIN=https://yourdomain.com
   ```
