# Insighta 운영 매뉴얼

> 최종 업데이트: 2026-03-06
> 프로젝트: Insighta
> 도메인: https://insighta.one

---

## 목차

1. [시스템 아키텍처](#1-시스템-아키텍처)
2. [인프라 접속 정보](#2-인프라-접속-정보)
3. [서비스 구성](#3-서비스-구성)
4. [배포 파이프라인](#4-배포-파이프라인)
5. [일상 운영 명령어](#5-일상-운영-명령어)
6. [모니터링 및 헬스체크](#6-모니터링-및-헬스체크)
7. [장애 대응](#7-장애-대응)
8. [롤백 절차](#8-롤백-절차)
9. [데이터베이스 관리](#9-데이터베이스-관리)
10. [인증 시스템](#10-인증-시스템)
11. [보안 설정](#11-보안-설정)
12. [SSL 인증서 관리](#12-ssl-인증서-관리)
13. [환경변수 관리](#13-환경변수-관리)
14. [로그 관리](#14-로그-관리)
15. [백업 및 복구](#15-백업-및-복구)
16. [인프라 관리 (Terraform IaC)](#16-인프라-관리-terraform-iac)
17. [CI/CD 상세](#17-cicd-상세)
18. [트러블슈팅 가이드](#18-트러블슈팅-가이드)
19. [이슈 및 작업 관리](#19-이슈-및-작업-관리)
20. [개발 환경 (Console IDE)](#20-개발-환경-console-ide)
21. [연락처 및 참고 링크](#21-연락처-및-참고-링크)
22. [코드베이스 관리 정책](#22-코드베이스-관리-정책)

---

## 1. 시스템 아키텍처

### 전체 구조

```
[사용자 브라우저]
    │
    ▼ HTTPS (443)
[insighta.one] ──DNS──▶ [44.231.152.49]
    │
    ▼
[EC2 t2.micro (Ubuntu 22.04, us-west-2)]
    │
    ├── Host Nginx (SSL 종단, 리버스 프록시)
    │     ├── /api/*        → 127.0.0.1:3000 (API 컨테이너)
    │     ├── /health       → 127.0.0.1:3000
    │     ├── /oauth/*      → 127.0.0.1:3000
    │     ├── /documentation → 127.0.0.1:3000 (Swagger UI)
    │     └── /*            → 127.0.0.1:8081 (Frontend 컨테이너)
    │
    ├── Docker: insighta-api (Fastify, port 3000)
    │     ├── Prisma ORM → PostgreSQL
    │     ├── YouTube Data API v3
    │     ├── Gemini AI API
    │     └── JWT 검증 (Supabase)
    │
    └── Docker: insighta-frontend (Nginx, port 8081)
          └── React SPA (Vite 빌드)
               └── Supabase Auth SDK (Google OAuth)

[External Services]
    ├── Supabase Cloud (us-west-2, Oregon)
    │     ├── PostgreSQL (rckkhhjanqgaopynhfgd)
    │     ├── Auth (Google OAuth + Email)
    │     └── JWT 발급/검증
    │
    ├── GHCR (ghcr.io/jk42jj/insighta-*)
    │     ├── insighta-api:latest
    │     └── insighta-frontend:latest
    │
    └── GitHub Actions (CI/CD)
```

### 기술 스택

| 레이어 | 기술 | 버전 |
|--------|------|------|
| **Frontend** | React, TypeScript, Vite | React 18+, Vite 5 |
| **UI** | shadcn/ui, Radix UI, Tailwind CSS | - |
| **상태관리** | TanStack Query, Zustand | - |
| **Backend** | Fastify, TypeScript | Fastify 4 |
| **ORM** | Prisma | v5.22+ |
| **Database** | PostgreSQL (Supabase Cloud) | 15+ |
| **Auth** | Supabase Auth (Google OAuth) | - |
| **AI** | Google Gemini API | Flash model |
| **배포** | Docker, GitHub Actions, GHCR | - |
| **웹서버** | Nginx (Host) + Nginx (Frontend container) | - |
| **SSL** | Let's Encrypt (Certbot) | - |
| **인프라** | AWS EC2 t2.micro (Ubuntu 22.04) | - |

### 네트워크 구조

```
Internet → :443 (Nginx SSL) → :3000 (API) / :8081 (Frontend)
                              ↓ (localhost only, 외부 직접 접근 불가)
                              Docker bridge network (insighta-network)
```

- **외부 접근 가능 포트**: 80 (→443 리다이렉트), 443 (HTTPS)
- **내부 전용 포트**: 3000 (API), 8081 (Frontend) — `127.0.0.1` 바인딩
- **SSH**: 22 (My IP only: `115.143.184.132/32`)

---

## 2. 인프라 접속 정보

### EC2 인스턴스

| 항목 | 값 |
|------|-----|
| 인스턴스 타입 | t2.micro |
| OS | Ubuntu 22.04 LTS |
| Region | us-west-2 (Oregon) |
| Elastic IP | 44.231.152.49 |
| SSH Key | `~/Downloads/prx01-insighta.pem` |
| 앱 디렉토리 | `/opt/insighta/` |

#### SSH 접속

```bash
ssh -i ~/Downloads/prx01-insighta.pem ubuntu@44.231.152.49
```

> **주의**: Security Group에서 SSH(22)는 `115.143.184.132/32`만 허용.
> IP가 변경되면 AWS Console > EC2 > Security Groups에서 업데이트 필요.

### Supabase Cloud

| 항목 | 값 |
|------|-----|
| Project ID | `rckkhhjanqgaopynhfgd` |
| Region | us-west-2 (Oregon) |
| Dashboard | https://supabase.com/dashboard/project/rckkhhjanqgaopynhfgd |
| DB Host | `aws-0-us-west-1.pooler.supabase.com` |
| Transaction Pooler | port 6543 (앱 연결용, `?pgbouncer=true`) |
| Session Pooler | port 5432 (Migration용, DIRECT_URL) |

### GitHub

| 항목 | 값 |
|------|-----|
| Repository | https://github.com/JK42JJ/insighta |
| GHCR API Image | `ghcr.io/jk42jj/insighta-api` |
| GHCR Frontend Image | `ghcr.io/jk42jj/insighta-frontend` |
| Secrets 관리 | https://github.com/JK42JJ/insighta/settings/secrets/actions |
| Actions | https://github.com/JK42JJ/insighta/actions |

### 도메인 (GoDaddy)

| 항목 | 값 |
|------|-----|
| 도메인 | insighta.one |
| DNS Provider | GoDaddy |
| A 레코드 | insighta.one → 44.231.152.49 |
| SSL 만료일 | 2026-06-02 (Let's Encrypt, 자동 갱신) |

---

## 3. 서비스 구성

### Docker 컨테이너

| 컨테이너 | 이미지 | 포트 | 메모리 제한 | 헬스체크 |
|-----------|--------|------|-------------|----------|
| `insighta-api` | `ghcr.io/jk42jj/insighta-api:latest` | 127.0.0.1:3000 | 512MB | `curl http://localhost:3000/health` (30s 간격) |
| `insighta-frontend` | `ghcr.io/jk42jj/insighta-frontend:latest` | 127.0.0.1:8081 | 256MB | `wget http://localhost:8081/` (30s 간격) |

### Docker Compose 파일 위치

- **EC2**: `/opt/insighta/docker-compose.prod.yml`
- **로컬 소스**: `docker-compose.prod.yml` (프로젝트 루트)

### Docker 볼륨

| 볼륨 | 마운트 경로 | 용도 |
|------|-------------|------|
| `cache_data` | `/app/cache` (API) | API 응답 캐시 |
| `logs_data` | `/app/logs` (API) | 애플리케이션 로그 |

---

## 4. 배포 파이프라인

### 배포 플로우

```
git push origin main
    │
    ▼
[GitHub Actions: CI]
    ├── Lint (continue-on-error: true)
    ├── Typecheck
    ├── Test (continue-on-error: true)
    ├── Build API
    └── Build Frontend
    │
    ▼
[GitHub Actions: Build & Push]
    ├── Docker Build API → ghcr.io/jk42jj/insighta-api:latest + :sha
    └── Docker Build Frontend → ghcr.io/jk42jj/insighta-frontend:latest + :sha
    │
    ▼
[GitHub Actions: Migration]
    └── prisma migrate deploy (DIRECT_URL, continue-on-error: true)
    │
    ▼
[GitHub Actions: Deploy to EC2]
    ├── SSH → EC2
    ├── docker compose pull
    ├── docker compose up -d --remove-orphans
    ├── Health check (6회 재시도, 10초 간격)
    ├── 실패 시 자동 롤백
    └── docker image prune -f
```

### 배포 트리거

| 트리거 | 워크플로우 | 설명 |
|--------|-----------|------|
| `git push main` | `deploy.yml` | 자동 배포 |
| Manual dispatch | `deploy.yml` | GitHub Actions UI에서 수동 실행 |
| Manual dispatch | `rollback.yml` | 특정 버전으로 롤백 |

### 배포 주의사항

> **SSH Security Group**: GitHub Actions Runner IP는 고정이 아님.
> 현재 SSH가 My IP로 제한되어 있어 **배포 시 SSH 접속 실패할 수 있음**.
>
> **해결 방법** (택 1):
> 1. 배포 전 Security Group에 `0.0.0.0/0` 임시 허용 → 배포 후 복원
> 2. GitHub Actions IP range를 Security Group에 추가 (변동이 커서 비추천)
> 3. AWS SSM (Systems Manager)으로 SSH 대체 (장기적 해결)
> 4. tailscale 등 VPN 기반 접근 (장기적 해결)

---

## 5. 일상 운영 명령어

### EC2 접속 후 사용

```bash
# 앱 디렉토리 이동
cd /opt/insighta

# 컨테이너 상태 확인
docker ps
docker compose -f docker-compose.prod.yml ps

# 컨테이너 로그 (실시간)
docker logs insighta-api --tail 50 -f
docker logs insighta-frontend --tail 50 -f

# 컨테이너 재시작
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml restart frontend

# 전체 서비스 재시작
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# 이미지 수동 업데이트 (GitHub Actions 없이)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
docker image prune -f

# 디스크 사용량 확인
df -h
docker system df

# Docker 리소스 정리
docker system prune -f         # 중지된 컨테이너, 미사용 네트워크 정리
docker image prune -a -f       # 모든 미사용 이미지 삭제 (주의!)

# Nginx 상태
sudo systemctl status nginx
sudo nginx -t                  # 설정 문법 검사
sudo systemctl reload nginx    # 설정 리로드 (무중단)
sudo systemctl restart nginx   # 재시작

# 시스템 리소스
htop                           # CPU/메모리 실시간 모니터링
free -h                        # 메모리 사용량
```

### 로컬 개발 명령어

```bash
# 개발 서버 시작
npm run dev:all                # API + Frontend 동시 실행

# 개별 실행
npm run api:dev                # API만 (tsx watch)
npm run dev:frontend           # Frontend만 (Vite)

# 빌드
npm run build                  # TypeScript 빌드
npm run build:frontend         # Frontend 빌드
npm run build:all              # 전체 빌드

# 테스트
npm test                       # 전체 테스트
npm run test:watch             # 감시 모드
npm run test:cov               # 커버리지 리포트

# Lint
npx eslint src/                # lint 검사
npx eslint src/ --fix          # 자동 수정

# DB
npx prisma studio              # DB GUI
npx prisma generate            # Prisma Client 생성
npx prisma migrate dev --name <name>  # 개발 마이그레이션

# CLI
npm run cli -- sync <playlist-url>     # 플레이리스트 동기화
npm run cli -- list                    # 동기화된 플레이리스트 목록
```

---

## 6. 모니터링 및 헬스체크

### 헬스체크 엔드포인트

```bash
# 외부에서 확인
curl -s https://insighta.one/health
# 응답: {"status":"ok","timestamp":"...","uptime":...,"version":"1.0.0"}

# EC2 내부에서 확인
curl -s http://localhost:3000/health    # API 직접
wget -q -O- http://localhost:8081/      # Frontend 직접
```

### API 엔드포인트 검증

```bash
# 인증 불필요
curl -s https://insighta.one/health                # 200 OK
curl -s https://insighta.one/api/v1                # API 정보

# 인증 필요 (401 반환이 정상)
curl -s https://insighta.one/api/v1/playlists      # 401 Unauthorized
curl -s https://insighta.one/api/v1/videos         # 401 Unauthorized
curl -s https://insighta.one/api/v1/quota/usage    # 401 Unauthorized
```

### 주요 API 엔드포인트 목록

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/health` | 헬스체크 | 불필요 |
| GET | `/api/v1` | API 정보 | 불필요 |
| GET | `/api/v1/auth/me` | 현재 사용자 정보 | 필요 |
| POST | `/api/v1/playlists/import` | 플레이리스트 임포트 | 필요 |
| GET | `/api/v1/playlists` | 플레이리스트 목록 | 필요 |
| GET | `/api/v1/playlists/:id` | 플레이리스트 상세 | 필요 |
| POST | `/api/v1/playlists/:id/sync` | 플레이리스트 동기화 | 필요 |
| GET | `/api/v1/videos` | 비디오 목록 | 필요 |
| GET | `/api/v1/videos/:id` | 비디오 상세 | 필요 |
| GET | `/api/v1/sync/status` | 동기화 상태 | 필요 |
| GET | `/api/v1/quota/usage` | API 할당량 | 필요 |
| GET | `/api/v1/analytics/dashboard` | 대시보드 | 필요 |

### Docker 헬스체크

```bash
# EC2에서 실행
docker inspect --format='{{.State.Health.Status}}' insighta-api       # healthy
docker inspect --format='{{.State.Health.Status}}' insighta-frontend  # healthy
```

### 6.5. 일일 서비스 점검

#### 자동화 스크립트

```bash
# 전체 체크 (SSH 포함 — EC2 접근 가능 시)
./scripts/daily-healthcheck.sh

# 외부 체크만 (SSH 없이)
./scripts/daily-healthcheck.sh --local-only

# JSON 출력 (에이전트 파싱용)
./scripts/daily-healthcheck.sh --json
```

**종료 코드**: `0` = 전체 통과, `1` = 경고 있음, `2` = 심각한 문제

#### 체크 항목 (8개)

| # | 카테고리 | 체크 내용 | 판정 기준 |
|---|---------|----------|-----------|
| 1 | **Site** | HTTPS 접근 가능 | HTTP 200 |
| 2 | **API** | `/health` 응답 | 200 + JSON |
| 3 | **Auth** | 인증 엔드포인트 | 401 = 정상 |
| 4 | **SSL** | 인증서 만료일 | 30일 미만 경고 |
| 5 | **Docker** | 컨테이너 상태 (SSH) | healthy/running |
| 6 | **Disk** | 디스크 사용률 (SSH) | 80% 초과 경고 |
| 7 | **Memory** | 메모리 사용률 (SSH) | 90% 초과 경고 |
| 8 | **CI/CD** | 최근 배포 상태 | success/failure |

> **참고**: SSH 접속 실패 시 Docker/Disk/Memory는 자동 SKIP 처리됩니다.

#### Agent 위임

Claude Code에서 데일리 체크를 자동으로 수행하려면:

```bash
# Agent tool로 위임
Agent(subagent_type="general-purpose", prompt="Run ./scripts/daily-healthcheck.sh --json and report results")

# 또는 직접 실행
Bash("./scripts/daily-healthcheck.sh")
```

#### 수동 점검 체크리스트 (매일)

- [ ] `https://insighta.one` 접속 확인
- [ ] `https://insighta.one/health` 응답 확인
- [ ] Google 로그인 테스트 (선택)
- [ ] GitHub Actions 최근 실행 상태 확인

#### 주간 추가 점검

| 항목 | 명령어 | 주기 |
|------|--------|------|
| Docker 리소스 정리 | `docker system prune -f` (EC2) | 주 1회 |
| 로그 크기 확인 | `docker system df` (EC2) | 주 1회 |
| SSL 인증서 갱신 테스트 | `sudo certbot renew --dry-run` (EC2) | 주 1회 |
| Supabase Dashboard 확인 | DB 크기, 연결 수, Auth 로그 | 주 1회 |

#### 월간 추가 점검

| 항목 | 설명 |
|------|------|
| DB 수동 백업 | `pg_dump` (섹션 15 참조) |
| Docker 이미지 정리 | `docker image prune -a -f` |
| Security Group 검토 | SSH 허용 IP 확인 |
| SSL 인증서 만료일 확인 | `sudo certbot certificates` |
| GitHub Secrets 만료 확인 | GHCR PAT, SSH Key 등 |

### 6.6. Production E2E 테스트

프로덕션 환경에서 실제 API/UI 동작을 자동 검증하는 Playwright E2E 테스트.

#### 테스트 구성

| 파일 | 테스트 | 파괴적? |
|------|--------|---------|
| `health.spec.ts` | `/health` 200, SSL 확인 | No |
| `auth-api.spec.ts` | `/auth/me`, `/playlists`, `/videos`, 401 | No |
| `playlist-lifecycle.spec.ts` | import → verify → delete | Yes (cleanup) |
| `ui-smoke.spec.ts` | 랜딩, 로그인, 설정 페이지 | No |

총 11개 테스트, ~2분 이내 실행.

#### 인증 방식

Google OAuth는 Playwright에서 자동화 불가 (봇 차단). 대신:
- Supabase에 `e2e-test@insighta.one` 유저 생성 (email/password, Auto Confirm)
- `auth.setup.ts`에서 `signInWithPassword()`로 실제 JWT 획득
- 유효한 토큰으로 API + UI 테스트 수행

#### 로컬 실행

```bash
cd frontend
E2E_TARGET=production \
E2E_TEST_EMAIL=e2e-test@insighta.one \
E2E_TEST_PASSWORD='비밀번호' \
VITE_SUPABASE_URL=https://rckkhhjanqgaopynhfgd.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY='anon_key' \
npx playwright test tests/e2e/production/ --project=chromium
```

#### CI 실행

```bash
# GitHub Actions → E2E Tests → Run workflow → environment: production
gh workflow run e2e.yml -f environment=production
```

#### 필수 GitHub Secrets

| Secret | 용도 |
|--------|------|
| `E2E_TEST_EMAIL` | 테스트 유저 이메일 |
| `E2E_TEST_PASSWORD` | 테스트 유저 비밀번호 |
| `SUPABASE_URL` | (기존) workflow에서 `VITE_SUPABASE_URL`로 매핑 |
| `SUPABASE_ANON_KEY` | (기존) workflow에서 `VITE_SUPABASE_PUBLISHABLE_KEY`로 매핑 |

> **주의**: 시크릿 이름과 코드 내 환경변수 이름이 다름. `e2e.yml`에서 매핑 처리됨.

---

## 7. 장애 대응

### 장애 진단 플로우

```
사이트 접속 불가
    │
    ├── DNS 확인: dig insighta.one +short → 44.231.152.49 ?
    │     └── 아니면: GoDaddy DNS 설정 확인
    │
    ├── SSL 확인: curl -vI https://insighta.one 2>&1 | grep TLS
    │     └── 인증서 만료: sudo certbot renew
    │
    ├── Nginx 확인: sudo systemctl status nginx
    │     ├── 중지됨: sudo systemctl start nginx
    │     └── 에러: sudo nginx -t → 설정 오류 확인
    │
    ├── Docker 확인: docker ps
    │     ├── 컨테이너 없음: cd /opt/insighta && docker compose up -d
    │     ├── Unhealthy: docker logs <container> --tail 50
    │     └── Restarting: 메모리 부족 → htop 확인
    │
    └── EC2 확인: AWS Console에서 인스턴스 상태 확인
          └── 중지됨: Start instance
```

### 주요 장애 시나리오별 대응

#### API 500 에러

```bash
# 1. API 로그 확인
docker logs insighta-api --tail 100

# 2. DB 연결 확인
docker exec insighta-api node -e "
  const { PrismaClient } = require('@prisma/client');
  new PrismaClient().\$connect().then(() => console.log('OK')).catch(e => console.error(e))
"

# 3. 컨테이너 재시작
docker compose -f docker-compose.prod.yml restart api
```

#### 메모리 부족 (OOM)

```bash
# 메모리 상태 확인
free -h
docker stats --no-stream

# Swap 사용량 확인
swapon --show

# 긴급 대응: 불필요한 프로세스 종료 후 재시작
docker compose -f docker-compose.prod.yml restart
```

#### 디스크 부족

```bash
# 디스크 사용량 확인
df -h

# Docker 리소스 정리
docker system prune -f
docker image prune -a -f

# 로그 크기 확인 및 정리
sudo du -sh /var/log/*
sudo journalctl --vacuum-time=3d
```

---

## 8. 롤백 절차

### 자동 롤백 (배포 실패 시)

deploy.yml 워크플로우에서 헬스체크 실패 시 자동으로 이전 이미지로 롤백됩니다.

### 수동 롤백 (GitHub Actions)

1. https://github.com/JK42JJ/insighta/actions → "Rollback" 워크플로우
2. "Run workflow" 클릭
3. `version` 입력:
   - `previous`: 직전 배포로 롤백
   - `<commit-sha>`: 특정 커밋의 이미지로 롤백

### 수동 롤백 (EC2 직접)

```bash
cd /opt/insighta

# 특정 버전 이미지로 롤백
export API_IMAGE=ghcr.io/jk42jj/insighta-api:<commit-sha>
export FRONTEND_IMAGE=ghcr.io/jk42jj/insighta-frontend:<commit-sha>
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans

# 헬스체크
curl -s http://localhost:3000/health
```

### GHCR에서 이전 이미지 태그 확인

```bash
# GitHub CLI로 확인
gh api /user/packages/container/insighta-api/versions --jq '.[].metadata.container.tags'
```

---

## 9. 데이터베이스 관리

### 접속 정보

| 용도 | 연결 방식 | 포트 |
|------|-----------|------|
| 앱 연결 | Transaction Pooler (PgBouncer) | 6543 |
| Migration | Session Pooler (Direct) | 5432 |
| Dashboard | Supabase Dashboard SQL Editor | 웹 |

### Prisma 스키마

- **위치**: `prisma/schema.prisma`
- **스키마**: `auth` (Supabase 관리), `public` (앱 테이블)
- **Preview Feature**: `multiSchema`

### 테이블 목록 (public 스키마, 16개)

| 테이블 | 설명 | RLS |
|--------|------|-----|
| `youtube_playlists` | 플레이리스트 메타데이터 | ✅ user_id 기반 |
| `youtube_playlist_items` | 플레이리스트-비디오 관계 | ✅ playlist 경유 |
| `youtube_videos` | 비디오 메타데이터 (공유) | ✅ 인증 사용자 READ |
| `youtube_sync_settings` | 동기화 설정 | ✅ user_id 기반 |
| `youtube_sync_history` | 동기화 이력 | ✅ playlist 경유 |
| `user_video_states` | 시청 상태, 메모 | ✅ user_id 기반 |
| `user_local_cards` | 만다라트 카드 | ✅ user_id 기반 |
| `user_ui_preferences` | UI 설정 | ✅ user_id 기반 |
| `user_subscriptions` | 구독 정보 | ✅ user_id READ only |
| `video_notes` | 비디오 노트 | ✅ 인증 사용자 READ |
| `watch_sessions` | 시청 세션 | ✅ 인증 사용자 READ |
| `video_captions` | 자막 데이터 | ✅ 인증 사용자 READ |
| `credentials` | 인증 정보 (민감) | ✅ 완전 잠금 |
| `sync_schedules` | 동기화 스케줄 | ✅ playlist 경유 |
| `quota_usage` | API 할당량 (시스템) | ✅ 완전 잠금 |
| `quota_operations` | 할당량 상세 (시스템) | ✅ 완전 잠금 |

### RLS 정책

- **적용일**: 2026-03-04
- **SQL 파일**: `prisma/migrations/rls_policies.sql`
- **동작 방식**: Supabase Client/Dashboard 직접 접근 시 `auth.uid()` 기반 행 수준 보안
- **API 서버**: Prisma는 postgres 슈퍼유저로 연결하므로 RLS bypass (정상)

### Migration 전략

**현재 상태**: `prisma db push`로 수동 적용 (Supabase auth 스키마 충돌로 `migrate deploy` 사용 불가)

**스키마 변경 시 절차**:
1. 로컬에서 `prisma/schema.prisma` 수정
2. `npx prisma migrate dev --name <description>` (로컬 DB)
3. Supabase Dashboard SQL Editor에서 수동 적용 또는 `DIRECT_URL`로 `prisma db push`
4. 코드 커밋 & 배포

### DB 비밀번호 주의사항

- Supabase DB 비밀번호에 `#` 포함 → URL에서 `%23`으로 인코딩 필수
- `.env` 파일에서 `#` 포함 값은 반드시 `"따옴표"`로 감쌈
- GitHub Secrets에서도 URL 인코딩된 값 사용

---

## 10. 인증 시스템

### 인증 플로우

```
[브라우저]
    │
    ├── 1. "Google로 로그인" 클릭
    │     └── Supabase Auth SDK → Google OAuth 2.0 → 콜백
    │
    ├── 2. Supabase가 JWT 발급 (access_token + refresh_token)
    │     └── localStorage에 세션 저장
    │
    ├── 3. API 요청 시 Authorization: Bearer <access_token> 헤더 첨부
    │     └── frontend/src/lib/api-client.ts에서 자동 처리
    │
    └── 4. API 서버에서 JWT 검증
          └── src/api/plugins/auth.ts
              ├── @fastify/jwt로 토큰 서명 검증
              ├── SUPABASE_JWT_SECRET (HS256 Legacy)
              └── JWT claims → JWTPayload 매핑 (userId, email, name)
```

### 주요 설정

| 항목 | 값/위치 |
|------|---------|
| Auth Provider | Supabase Auth (Google OAuth) |
| JWT 알고리즘 | HS256 (Legacy shared secret) |
| JWT Secret | Supabase Dashboard > Settings > API > JWT Settings > Legacy 탭 |
| Google OAuth Console | https://console.cloud.google.com (Credentials > OAuth 2.0) |
| Redirect URI (Google) | `https://rckkhhjanqgaopynhfgd.supabase.co/auth/v1/callback` |
| Site URL (Supabase) | `https://insighta.one` |
| 프론트엔드 클라이언트 | `frontend/src/integrations/supabase/client.ts` |
| 백엔드 인증 플러그인 | `src/api/plugins/auth.ts` |

### Google OAuth Consent Screen

- **현재 상태**: Testing 모드 (100명 테스트 사용자 제한)
- **경고 화면**: "Google hasn't verified this app" — Continue 클릭으로 진행
- **프로덕션 전환**: Google Cloud Console > OAuth consent screen > PUBLISH APP
  - 전환 시 Google 검토 필요 (개인정보 처리방침 URL, 홈페이지 URL 등)

---

## 11. 보안 설정

### 현재 보안 상태

| 항목 | 상태 | 비고 |
|------|------|------|
| SSL/TLS | ✅ TLS 1.2/1.3 | Let's Encrypt, 자동 갱신 |
| HSTS | ✅ 활성화 | `max-age=63072000; includeSubDomains; preload` |
| Security Headers | ✅ 설정됨 | X-Content-Type-Options, X-Frame-Options, XSS-Protection |
| SSH 접근 제한 | ✅ Admin IP only | Terraform 관리, `119.194.145.146/32` |
| Docker 포트 | ✅ localhost only | `127.0.0.1:3000`, `127.0.0.1:8081` |
| UFW 방화벽 | ✅ 활성화 | SSH(22), HTTP(80), HTTPS(443) |
| RLS | ✅ 16개 테이블 | `prisma/migrations/rls_policies.sql` |
| API Rate Limiting | ✅ 30 req/s | Nginx level, `/api/` 경로 |
| 환경변수 암호화 | ✅ | `.env`는 EC2에만 존재, git 미포함 |
| Pre-commit Hook | ✅ | husky + lint-staged (prettier + eslint) |
| CloudWatch | ✅ 활성화 | CPU/메모리/디스크 메트릭 수집 |

### EC2 Security Group 규칙

> SG는 Terraform으로 관리됩니다 (`terraform/modules/security/`).

| 유형 | 포트 | 소스 | 용도 |
|------|------|------|------|
| SSH | 22 | `119.194.145.146/32` (admin IP) | 관리자 SSH |
| HTTP | 80 | 0.0.0.0/0 | HTTPS 리다이렉트 |
| HTTPS | 443 | 0.0.0.0/0 | 웹 서비스 |

> **배포 시**: `deploy.yml`이 GitHub Actions Runner IP를 SG에 동적 추가/제거합니다.

### SSH IP 변경 시

**방법 1: Terraform (권장)**
```bash
cd terraform/projects/insighta/environments/prod
# main.tf의 admin_ssh_cidr 변경
terraform plan
terraform apply
```

**방법 2: AWS Console (긴급)**
1. AWS Console > EC2 > Security Groups
2. `insighta-sg-*` > Inbound rules > Edit
3. SSH(22) 규칙의 Source → My IP 선택
4. Save rules

> Console에서 변경한 경우, Terraform state와 drift가 발생합니다. 이후 `terraform plan`으로 확인 필요.

---

## 12. SSL 인증서 관리

### 현재 인증서 정보

| 항목 | 값 |
|------|-----|
| 발급자 | Let's Encrypt |
| 도메인 | insighta.one, www.insighta.one |
| 만료일 | 2026-06-02 |
| 자동 갱신 | Certbot systemd timer |
| 인증서 경로 | `/etc/letsencrypt/live/insighta.one/` |

### 인증서 상태 확인

```bash
sudo certbot certificates
```

### 수동 갱신

```bash
sudo certbot renew
sudo systemctl reload nginx
```

### 갱신 테스트

```bash
sudo certbot renew --dry-run
```

---

## 13. 환경변수 관리

### 환경변수 위치

| 위치 | 용도 | 접근 방법 |
|------|------|-----------|
| `/opt/insighta/.env` (EC2) | 프로덕션 런타임 | SSH 접속 |
| `.env` (로컬) | 개발 환경 | 직접 편집 |
| GitHub Secrets (14개) | CI/CD 파이프라인 | GitHub Settings |
| `.env.production.example` | 템플릿 (git 포함) | 참고용 |

### 필수 환경변수

```bash
# === Supabase ===
SUPABASE_URL=https://rckkhhjanqgaopynhfgd.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_JWT_SECRET=<jwt-secret>          # Legacy HS256 shared secret
DATABASE_URL=<transaction-pooler-url>      # port 6543, ?pgbouncer=true
DIRECT_URL=<session-pooler-url>            # port 5432

# === YouTube API ===
YOUTUBE_CLIENT_ID=<google-oauth-client-id>
YOUTUBE_CLIENT_SECRET=<google-oauth-client-secret>
YOUTUBE_API_KEY=<youtube-data-api-key>
YOUTUBE_REDIRECT_URI=https://insighta.one/oauth/callback

# === Application ===
NODE_ENV=production
API_PORT=3000
API_HOST=0.0.0.0
CORS_ORIGIN=https://insighta.one,https://www.insighta.one
ENCRYPTION_SECRET=<64-char-hex>
LOG_LEVEL=info
DOMAIN=insighta.one

# === AI (Optional) ===
GEMINI_API_KEY=<gemini-api-key>
```

### 환경변수 변경 시 절차

1. EC2에 SSH 접속
2. `/opt/insighta/.env` 수정
3. 컨테이너 재시작: `docker compose -f docker-compose.prod.yml up -d`
4. 필요 시 GitHub Secrets도 업데이트 (CI/CD용)

---

## 14. 로그 관리

### 로그 위치 및 설정

| 로그 | 위치 | 크기 제한 |
|------|------|-----------|
| API 컨테이너 | `docker logs insighta-api` | JSON, 10MB × 3파일 |
| Frontend 컨테이너 | `docker logs insighta-frontend` | JSON, 10MB × 3파일 |
| Nginx access | `/var/log/nginx/access.log` | logrotate |
| Nginx error | `/var/log/nginx/error.log` | logrotate |
| 시스템 | `journalctl -u docker` | systemd journal |

### 로그 조회 명령어

```bash
# 최근 100줄 + 실시간 추적
docker logs insighta-api --tail 100 -f

# 특정 시간 이후 로그
docker logs insighta-api --since "2026-03-04T00:00:00"

# 에러만 필터
docker logs insighta-api 2>&1 | grep -i error

# Nginx 에러 로그
sudo tail -f /var/log/nginx/error.log
```

---

## 15. 백업 및 복구

### 데이터베이스 백업

#### 자동 백업 (GitHub Actions)

**스케줄**: 매일 03:00 UTC (`.github/workflows/backup.yml`)

**파이프라인**:
1. `pg_dump` (public 스키마) → gzip 압축
2. 검증: 파일 크기 ≥1KB, CREATE TABLE ≥5개
3. S3 업로드: `s3://insighta-backups/db/YYYY/MM/backup_YYYYMMDD.sql.gz`
4. 30일 이상 백업 정리
5. 실패 시: `backup-failure` 라벨로 GitHub Issue 자동 생성

**인프라** (Terraform `modules/backup`):
- S3 버킷: `insighta-backups` (버전관리, AES256 암호화, 퍼블릭 액세스 차단)
- Lifecycle: Standard → Standard-IA (7일), 만료 (30일)

**수동 트리거**: `gh workflow run backup.yml`

#### 수동 백업 (pg_dump)

```bash
# DIRECT_URL을 사용하여 백업
pg_dump "$DIRECT_URL" --schema=public --no-owner --no-acl > backup_$(date +%Y%m%d).sql

# 압축 백업
pg_dump "$DIRECT_URL" --schema=public --no-owner --no-acl | gzip > backup_$(date +%Y%m%d).sql.gz
```

#### 복구

```bash
psql "$DIRECT_URL" < backup_20260304.sql
```

### Docker 볼륨 백업

```bash
# EC2에서 실행
docker run --rm -v insighta_cache_data:/data -v /tmp:/backup alpine tar czf /backup/cache_backup.tar.gz /data
docker run --rm -v insighta_logs_data:/data -v /tmp:/backup alpine tar czf /backup/logs_backup.tar.gz /data
```

---

## 16. 인프라 관리 (Terraform IaC)

### 16.1 Terraform 구조

```
terraform/
  modules/
    networking/       # VPC, 서브넷 (기본 VPC 사용)
    security/         # Security Group, 인바운드 규칙
    compute/          # EC2 인스턴스, EIP, cloud-init
    iam/              # IAM Role, Instance Profile (SSM, CloudWatch)
    state-backend/    # S3 + DynamoDB (원격 상태 저장)
  projects/
    insighta/
      environments/
        prod/         # 프로덕션 환경 (main.tf, variables.tf, backend.tf)
    _template/        # 새 프로젝트 템플릿
  global/
    state-backend/    # 부트스트랩: S3 + DynamoDB 생성 (1회)
    iam-ci/           # GitHub Actions IAM 사용자 (최소 권한)
```

### 16.2 일반 인프라 변경 절차

```
1. terraform/projects/insighta/environments/prod/ 파일 수정
2. PR 생성 → main 타겟
3. GitHub Actions가 `terraform plan` 실행 → PR 코멘트로 결과 게시
4. 리뷰 후 머지
5. `production` 환경 승인 게이트에서 수동 승인
6. `terraform apply` 자동 실행
7. 결과 확인
```

### 16.3 SSH SG 동적 관리

`deploy.yml`에서 GitHub Actions Runner IP를 자동으로 SG에 추가/제거합니다:

```bash
# 배포 전: Runner IP 허용
MY_IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress \
  --group-id sg-079aa1ca6855e587b \
  --protocol tcp --port 22 --cidr ${MY_IP}/32

# 배포 후: Runner IP 제거 (cleanup step, always 실행)
aws ec2 revoke-security-group-ingress ...
```

### 16.4 CloudWatch 모니터링

**상태**: 활성화 (`enable_cloudwatch = true`)

```bash
# EC2에서 CloudWatch Agent 상태 확인
sudo systemctl status amazon-cloudwatch-agent

# 비활성화 (긴급 시)
sudo systemctl stop amazon-cloudwatch-agent

# Terraform에서 비활성화
# terraform.tfvars: enable_cloudwatch = false → terraform apply
```

**수집 메트릭**: CPU, 메모리, 디스크 (Free Tier 3/10 커스텀 메트릭)

### 16.5 인프라 비용 가드

```bash
# 비용 추정 확인
./scripts/infra-cost-guard.sh check

# 현재 상태 요약
./scripts/infra-cost-guard.sh status

# 변경 전 비용 영향 예측
./scripts/infra-cost-guard.sh estimate
```

**종료 코드**: `0` = PASS, `1` = WARN, `2` = BLOCK

### 16.6 Terraform 필수 GitHub Secrets

| Secret | 용도 |
|--------|------|
| `TF_AWS_ACCESS_KEY_ID` | CI IAM 사용자 Access Key |
| `TF_AWS_SECRET_ACCESS_KEY` | CI IAM 사용자 Secret Key |

### 16.7 긴급 롤백 (인프라)

```bash
cd terraform/projects/insighta/environments/prod

# 특정 리소스만 이전 상태로 복원
terraform state show <resource_address>
terraform apply -target=<resource_address>

# 리소스 관리 해제 (Terraform에서 삭제하지 않고 분리)
terraform state rm <resource_address>
```

---

## 17. CI/CD 상세

### CI 워크플로우 (`.github/workflows/ci.yml`)

| Job | 의존성 | 실패 허용 | 설명 |
|-----|--------|-----------|------|
| lint | 없음 | ✅ | ESLint (src/) |
| typecheck | 없음 | ❌ | TypeScript 타입 검사 |
| test | 없음 | ✅ | Jest 테스트 |
| build-api | lint, typecheck, test | ❌ | API TypeScript 빌드 |
| build-frontend | lint | ❌ | Frontend Vite 빌드 |

### ESLint 현재 상태

- **Errors**: 0개 (2026-03-04 수정 완료)
- **Warnings**: 385개 (CI 차단하지 않음)
- **주요 warning 유형**: `no-unsafe-*` (타입 안전성), `explicit-function-return-type`, `no-explicit-any`
- **설정 파일**: `.eslintrc.json`
- **Pre-commit Hook**: husky + lint-staged (커밋 시 변경 파일 자동 수정)

### 테스트 현재 상태

- **로컬**: 39/42 suites, 1015 tests 통과
- **CI**: 환경 차이로 일부 실패 (`continue-on-error: true`)
- **실패 원인**: DB 연결 없는 CI 환경에서 통합 테스트 실패

### Migration 현재 상태

- **방식**: `prisma db push` (수동)
- **이슈**: `prisma migrate deploy`가 Supabase auth 스키마와 충돌 (P3005)
- **EC2**: `SKIP_MIGRATIONS=true` 설정

---

## 18. 트러블슈팅 가이드

### 자주 발생하는 문제

#### 1. "DIRECT_URL not found" (Vercel 빌드 실패)

- **원인**: Vercel에 DIRECT_URL 환경변수 미설정
- **해결**: Vercel 프로젝트 삭제 (EC2로 배포하므로 불필요)
- **상태**: Vercel 연결 해제 예정 (2026-03-04)

#### 2. SSH 접속 실패 (Connection timeout)

- **원인**: IP가 변경되어 Security Group에서 차단
- **해결**: AWS Console > EC2 > Security Groups > SSH 규칙 > My IP로 업데이트

#### 3. Docker 컨테이너 Unhealthy

```bash
docker inspect --format='{{json .State.Health}}' insighta-api | python3 -m json.tool
```

- **OOM**: `docker stats`로 메모리 확인 → 컨테이너 재시작
- **DB 연결 실패**: `.env`의 DATABASE_URL 확인, Supabase Dashboard에서 DB 상태 확인
- **포트 충돌**: `sudo lsof -i :3000` → 충돌 프로세스 확인

#### 4. Google OAuth "provider is not enabled"

- **해결**: Supabase Dashboard > Authentication > Providers > Google > Enable
- Client ID, Client Secret 입력 확인

#### 5. Google OAuth "localhost refused to connect"

- **원인**: Supabase Site URL이 `http://localhost:3000`으로 설정됨
- **해결**: Supabase Dashboard > Authentication > URL Configuration > Site URL → `https://insighta.one`

#### 6. Google OAuth "Unexpected failure (500)"

- **원인**: Site URL에 앞쪽 공백 포함 (" https://insighta.one")
- **해결**: Site URL 앞뒤 공백 제거

#### 7. prisma migrate deploy 실패 (P3005)

- **원인**: Supabase auth 스키마가 이미 존재하여 migration history 불일치
- **현재 대응**: `SKIP_MIGRATIONS=true`, `prisma db push` 수동 적용
- **장기 해결**: baseline migration 설정 또는 auth 스키마 제외

#### 8. DB 비밀번호 `#` 문자 이슈

- **증상**: DB 연결 실패, "password authentication failed"
- **원인**: URL에서 `#`이 fragment 시작으로 해석됨
- **해결**: `#` → `%23`으로 URL 인코딩, `.env`에서 따옴표로 감싸기

#### 9. GitHub Actions Deploy SSH 실패

- **원인**: Security Group이 My IP로 제한되어 GitHub Runner IP 차단
- **해결**: 배포 전 Security Group 임시 개방 또는 GitHub Actions IP range 허용

---

## 19. 이슈 및 작업 관리

### GitHub Issues 기반 관리 (권장)

프로젝트의 버그, UX 개선, 기능 추가는 **GitHub Issues**로 관리합니다.

#### 이슈 템플릿

**버그 리포트**:
```markdown
## 버그 설명
[문제 현상 설명]

## 재현 방법
1. ...
2. ...

## 기대 동작
[정상 동작 설명]

## 환경
- 브라우저:
- OS:
- 로그/에러 메시지:

## 스크린샷
[해당 시 첨부]
```

**기능 요청**:
```markdown
## 기능 설명
[추가하고 싶은 기능]

## 동기
[왜 필요한지]

## 구현 방안 (선택)
[기술적 접근 방법]

## 우선순위
- [ ] High (핵심 기능)
- [ ] Medium (편의 기능)
- [ ] Low (나중에)
```

#### Label 체계

| Label | 색상 | 용도 |
|-------|------|------|
| `bug` | 🔴 red | 버그 수정 |
| `feature` | 🟢 green | 새 기능 |
| `ux` | 🟣 purple | UX/UI 개선 |
| `security` | 🟠 orange | 보안 관련 |
| `infra` | 🔵 blue | 인프라/DevOps |
| `docs` | ⚪ gray | 문서 작업 |
| `priority:high` | 🔴 | 긴급 |
| `priority:medium` | 🟡 | 보통 |
| `priority:low` | 🟢 | 낮음 |

#### 워크플로우

```
이슈 등록 → Label 부여 → 브랜치 생성 (feature/xxx, fix/xxx)
    → 개발 → PR 생성 → 코드 리뷰 → main 머지 → 자동 배포
```

### 현재 알려진 이슈 (Backlog)

| # | 유형 | 설명 | 우선순위 |
|---|------|------|----------|
| 1 | infra | Google OAuth consent screen Testing → Production 전환 | Medium |
| 2 | infra | CI 테스트 환경 안정화 (로컬 39/42, CI 일부 실패) | Low |
| 3 | infra | DB Migration 전략 통일 (migrate deploy vs db push) | Low |
| 4 | infra | GitHub Actions SSH 배포 시 Security Group 자동화 | Medium |
| 5 | feature | 플레이리스트 동기화 E2E 테스트 (프로덕션) | High |
| 6 | infra | Supabase Audit Logs 활성화 | Low |
| 7 | infra | EC2 모니터링/알림 설정 (CloudWatch) | Medium |
| 8 | infra | DB 자동 백업 전략 수립 | Medium |
| 9 | security | video_notes, watch_sessions에 user_id 컬럼 추가 → RLS 강화 | Medium |
| 10 | security | credentials 테이블 user_id TEXT → UUID 마이그레이션 | Low |
| 11 | ux | lint warnings 385개 점진적 정리 | Low |

---

## 20. 개발 환경 (Console IDE)

Ghostty + tmux + Claude Code 기반 터미널 IDE 환경. Catppuccin Mocha 테마로 통일.

### 구성 요소

```
[Ghostty Terminal]
    │ JetBrainsMono Nerd Font, Catppuccin Mocha
    │
    └── [tmux session: insighta]
          │
          ├── Pane 0 (65%): Claude Code (--dangerously-skip-permissions --resume)
          ├── Pane 1 (35% top): Subagent Monitor (실시간 에이전트 추적)
          └── Pane 2 (35% bot): File Monitor (파일 변경 감지)
          │
          ├── Popup: lazygit (prefix+g)
          ├── Popup: yazi (prefix+f)
          ├── Popup: fzf grep (prefix+/)
          ├── Popup: fzf files (prefix+p)
          ├── Popup: btop (prefix+B)
          ├── Popup: lazydocker (prefix+D)
          └── Popup: shell (prefix+S)
```

### 설치된 도구

| 도구 | 버전 확인 | 용도 |
|------|-----------|------|
| **fzf** | `fzf --version` | 퍼지 파인더 (파일, 히스토리, 디렉토리) |
| **bat** | `bat --version` | 구문 강조 cat (Catppuccin Mocha 테마) |
| **eza** | `eza --version` | 아이콘 지원 ls (git 상태 표시) |
| **git-delta** | `delta --version` | Git diff 뷰어 (side-by-side, 라인 번호) |
| **zoxide** | `zoxide --version` | 스마트 cd (사용 빈도 기반 디렉토리 이동) |
| **lazygit** | `lazygit --version` | Git TUI (staging, diff, log, branch) |
| **yazi** | `yazi --version` | 파일 매니저 TUI (미리보기 포함) |
| **btop** | `btop --version` | 시스템 리소스 모니터 |
| **lazydocker** | `lazydocker --version` | Docker 컨테이너/로그 TUI |
| **ripgrep** | `rg --version` | 고속 코드 검색 |
| **fd** | `fd --version` | 고속 파일 검색 |

### 설정 파일 위치

| 파일 | 용도 |
|------|------|
| `~/Library/Application Support/com.mitchellh.ghostty/config` | Ghostty 터미널 설정 |
| `~/.tmux.conf` | tmux 글로벌 설정 (터미널, vi copy, 키바인딩) |
| `.tmux.project.conf` | 프로젝트 tmux 설정 (상태바, 팝업, 테마) |
| `scripts/tmux-agents.sh` | tmux 세션 생성 스크립트 |
| `~/.zshrc` | 쉘 설정 (도구 초기화, alias, 함수) |
| `~/.gitconfig` | Git 설정 (delta pager, side-by-side diff) |

### tmux 키바인딩

> **prefix** = `Ctrl+b` (기본값)

#### 도구 팝업 (prefix + key)

| 키 | 도구 | 설명 |
|----|------|------|
| `prefix + g` | lazygit | Git 전체 관리 (commit, push, branch, stash, rebase) |
| `prefix + f` | yazi | 파일 매니저 (탐색, 미리보기, 삭제, 이동) |
| `prefix + /` | fzf + rg | **코드 검색** (rg 결과를 fzf로 필터 + bat 미리보기) |
| `prefix + p` | fzf + fd | **파일 찾기** (fd 결과를 fzf로 필터 + bat 미리보기) |
| `prefix + B` | btop | CPU, 메모리, 네트워크 실시간 모니터링 |
| `prefix + D` | lazydocker | Docker 컨테이너 상태, 로그, 볼륨 관리 |
| `prefix + S` | zsh | 빠른 쉘 팝업 (일회성 명령 실행) |

#### 윈도우/페인 관리

| 키 | 동작 |
|----|------|
| `Alt + 1-9` | 윈도우 직접 전환 (prefix 불필요) |
| `Alt + ←→↑↓` | 페인 이동 (prefix 불필요) |
| `Alt + Shift + ←→↑↓` | 페인 크기 조절 |
| `Alt + z` | 현재 페인 줌/언줌 토글 |
| `prefix + \|` | 수평 분할 (현재 경로 유지) |
| `prefix + -` | 수직 분할 (현재 경로 유지) |
| `prefix + c` | 새 윈도우 (현재 경로 유지) |
| `prefix + >` / `<` | 페인 위치 교환 |

#### Vi Copy Mode

| 키 | 동작 |
|----|------|
| `prefix + Enter` | Copy mode 진입 |
| `v` | 선택 시작 (visual) |
| `y` | 선택 복사 → 클립보드 (pbcopy) |
| 마우스 드래그 | 선택 → 자동 클립보드 복사 |

### 쉘 명령어 (alias & 함수)

#### Claude Code

```bash
cc                # claude --dangerously-skip-permissions
ccr               # claude --dangerously-skip-permissions --resume
```

#### 파일 탐색

```bash
ls                # eza --icons
ll                # eza -la --icons --git --group-directories-first
lt                # eza --tree --icons --level=2
lta               # eza --tree --icons --level=3 -a
cat <file>        # bat --paging=never (구문 강조)
catp <file>       # bat (pager 포함)
y                 # yazi (종료 시 해당 디렉토리로 cd)
```

#### 검색

```bash
rgf <pattern>     # rg + fzf 인터랙티브 검색 (bat 미리보기)
fp                # fd + fzf 파일 찾기 (bat 미리보기)
Ctrl+R            # fzf 명령어 히스토리 검색
Ctrl+T            # fzf 파일 퍼지 검색 (현재 명령에 삽입)
Alt+C             # fzf 디렉토리 퍼지 이동
z <keyword>       # zoxide 스마트 cd (사용 빈도 기반)
```

#### Git (delta 통합)

```bash
git log           # delta로 렌더링 (side-by-side)
git diff          # delta로 렌더링 (라인 번호, 구문 강조)
git show          # delta로 렌더링
```

### tmux 세션 관리

```bash
# 세션 시작 (프로젝트 루트에서 실행)
./scripts/tmux-agents.sh              # 기본 3-pane (Claude + 모니터 2개)
./scripts/tmux-agents.sh full         # 4-pane (Claude + 모니터 + 쉘)
./scripts/tmux-agents.sh minimal      # 2-pane (Claude + 모니터)
./scripts/tmux-agents.sh solo         # 1-pane (Claude only)
./scripts/tmux-agents.sh kill         # 세션 종료

# 세션 연결
tmux attach -t insighta            # 기존 세션에 연결
tmux ls                               # 세션 목록
```

#### 레이아웃 비교

| 모드 | 페인 | Claude | Subagent Monitor | File Monitor | Shell |
|------|------|--------|-----------------|--------------|-------|
| **default** | 3 | 65% left | 35% right-top | 35% right-bottom | - |
| **full** | 4 | 55% left-top | 35% right-top | 35% right-bottom | 20% bottom |
| **minimal** | 2 | 75% top | 25% bottom | - | - |
| **solo** | 1 | 100% | - | - | - |

### 워크플로우 예시

#### 일반 개발

```bash
# 1. 세션 시작
./scripts/tmux-agents.sh

# 2. Claude가 자동 실행됨 (--dangerously-skip-permissions --resume)
# 3. 작업 지시 → Claude가 코드 수정 → 우측 모니터에서 실시간 확인
# 4. prefix+g → lazygit으로 변경사항 확인, commit, push
# 5. prefix+/ → 코드 검색이 필요할 때
```

#### 디버깅

```bash
# prefix+/ → 에러 메시지로 코드 검색
# prefix+g → lazygit에서 최근 변경사항 확인
# prefix+B → btop으로 리소스 상태 확인
# prefix+D → lazydocker로 컨테이너 로그 확인
```

#### EC2 서버 작업

```bash
# Ghostty에서 새 탭 (Cmd+T)으로 SSH 세션 열기
ssh -i ~/Downloads/prx01-insighta.pem ubuntu@44.231.152.49
# Alt+1-9로 로컬 탭과 SSH 탭 간 빠르게 전환
```

### Catppuccin Mocha 테마 적용 범위

| 대상 | 상태 | 설정 위치 |
|------|------|-----------|
| Ghostty 터미널 | `theme = catppuccin-mocha` | Ghostty config |
| tmux 상태바 | `bg=#1e1e2e, fg=#cdd6f4` | .tmux.project.conf |
| tmux 페인 테두리 | `fg=#313244 / #89b4fa` | .tmux.project.conf |
| fzf | `--color=bg+:#313244,...` | .zshrc FZF_DEFAULT_OPTS |
| bat | `BAT_THEME="Catppuccin Mocha"` | .zshrc |
| git-delta | `syntax-theme = Catppuccin Mocha` | .gitconfig |

### 문제 해결

#### Nerd Font 아이콘이 깨져 보일 때

```bash
# 폰트 설치 확인
fc-list | grep -i "JetBrainsMono Nerd"

# 재설치
brew install --cask font-jetbrains-mono-nerd-font

# Ghostty 재시작 필요
```

#### fzf Ctrl+R/Ctrl+T가 동작하지 않을 때

```bash
# .zshrc에서 fzf 초기화 확인
source <(fzf --zsh)

# 쉘 재로드
source ~/.zshrc
```

#### tmux 팝업에서 도구가 실행되지 않을 때

```bash
# 도구 설치 확인
which lazygit yazi btop lazydocker

# 없으면 재설치
brew install lazygit yazi btop lazydocker
```

#### delta가 적용되지 않을 때

```bash
# .gitconfig 확인
git config --global core.pager   # → delta

# 수동 테스트
git log -1 -p | delta
```

---

## 21. 연락처 및 참고 링크

### 주요 대시보드

| 서비스 | URL |
|--------|-----|
| 프로덕션 사이트 | https://insighta.one |
| API 문서 (Swagger) | https://insighta.one/documentation |
| API 문서 (Scalar) | https://insighta.one/api-reference |
| Supabase Dashboard | https://supabase.com/dashboard/project/rckkhhjanqgaopynhfgd |
| GitHub Repository | https://github.com/JK42JJ/insighta |
| GitHub Actions | https://github.com/JK42JJ/insighta/actions |
| GitHub Secrets | https://github.com/JK42JJ/insighta/settings/secrets/actions |
| AWS EC2 Console | https://us-west-2.console.aws.amazon.com/ec2 |
| Google Cloud Console | https://console.cloud.google.com |
| GoDaddy DNS | https://dcc.godaddy.com |

### 프로젝트 주요 파일

| 파일 | 설명 |
|------|------|
| `CLAUDE.md` | Claude Code 프로젝트 가이드 |
| `docs/DEPLOYMENT.md` | 배포 가이드 (9단계) |
| `docs/OPERATIONS.md` | 이 운영 매뉴얼 |
| `.github/workflows/ci.yml` | CI 파이프라인 |
| `.github/workflows/deploy.yml` | CD 파이프라인 |
| `.github/workflows/rollback.yml` | 롤백 워크플로우 |
| `docker-compose.prod.yml` | 프로덕션 Docker Compose |
| `deploy/nginx/insighta.conf` | Nginx 설정 |
| `scripts/ec2-setup.sh` | EC2 초기화 스크립트 |
| `prisma/schema.prisma` | DB 스키마 |
| `prisma/migrations/rls_policies.sql` | RLS 정책 SQL |
| `.env.production.example` | 환경변수 템플릿 |
| `.tmux.project.conf` | 프로젝트 tmux 설정 (Console IDE) |
| `scripts/tmux-agents.sh` | tmux 세션 생성 스크립트 |

---

---

## 22. 코드베이스 관리 정책

### 21.1 GitHub 공개 파일 기준

| 기준 | 정책 |
|------|------|
| **언어** | GitHub에 노출되는 파일(README, CHANGELOG, PR/Issue 템플릿, CONTRIBUTING)은 영문 |
| **내부 문서** | `docs/` 하위 운영 문서는 한국어 허용 |
| **커밋 메시지** | Conventional Commits, 영문 |
| **Issue/PR** | 영문 |

### 21.2 브랜딩

- 프로젝트명: **Insighta**
- `package.json` name: `insighta`
- 도메인: `insighta.one`

### 21.3 삭제 금지 파일

| 경로 | 이유 |
|------|------|
| `prompt/*.md` | 사용자 개인 작업 파일 |
| `.claude/` | Claude Code 설정 |
| `.env*` | 환경변수 |

### 21.4 정기 정리 항목

- 사용하지 않는 레거시 설정 파일 제거 (예: `vercel.json`)
- 보일러플레이트 디렉토리 제거 (예: `docs-site/`)
- `docs-site/` → `.gitignore`에 추가 완료
- package.json에서 미사용 스크립트 제거

### 21.5 필수 GitHub 커뮤니티 파일

- `LICENSE` (MIT)
- `CONTRIBUTING.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`

---

> **이 문서는 프로젝트 운영 중 발생하는 변경사항에 맞춰 지속적으로 업데이트해야 합니다.**
