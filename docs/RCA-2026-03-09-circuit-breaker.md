# RCA: Supavisor Circuit Breaker 장애

**Incident ID**: INC-2026-03-09
**Severity**: P2 (프로덕션 배포 불가, 서비스 자체는 기존 버전 운영 중)
**Duration**: ~28시간 (2026-03-08 23:30 KST ~ 2026-03-09 12:05 KST)
**Impact**: 프로덕션 배포 파이프라인 중단, DB 비밀번호 3회 리셋, Supabase project 2회 pause/resume

---

## Timeline (KST)

| 시간 | 이벤트 |
|------|--------|
| 3/8 23:40 | PR #112/#114 Deploy **성공** (옛 비밀번호 정상) |
| 3/9 00:02 | #85-A 스키마 변경 커밋 → 수동 `prisma db push` 필요 |
| 3/9 00:30 | **잘못된 DB URL로 수동 push 시도** (us-west-1 리전, db.xxx 직접연결) |
| | → 인증 실패 → **circuit breaker 최초 트리거** |
| 3/9 01:00 | circuit breaker를 "비밀번호 문제"로 오판 → **불필요한 비밀번호 리셋 #1** (`Jd8FfKLSSGgrYkoo`) |
| 3/9 01:00 | GitHub Secrets 업데이트 시도 → 불완전/실패 |
| 3/9 01:30 | 올바른 URL + 새 비밀번호로 수동 push → 성공 |
| 3/9 01:59 | PR #115 머지 → Deploy 트리거 → **DB Schema Sync 실패 (P1000)** |
| | EC2 API 서버는 옛 비밀번호로 계속 가동 중 → circuit breaker 지속 리트리거 |
| 3/9 10:00 | 새 세션에서 deploy fix 작업 시작 |
| 3/9 10:05 | GitHub Secrets 업데이트 + deploy re-run → P1000 재실패 |
| 3/9 10:10 | 로컬 psql 테스트 → circuit breaker 확인 |
| 3/9 10:28 | Supabase Dashboard에서 **비밀번호 리셋 #2** (`###Brian7677v5r6c4`) |
| 3/9 10:30 | psql 테스트 → 여전히 circuit breaker |
| 3/9 10:17 | Supabase project **pause/resume #1** |
| 3/9 10:40 | 10분 대기 후 psql 테스트 → 여전히 circuit breaker |
| 3/9 11:10 | 30분 대기 후 psql 테스트 → 여전히 circuit breaker |
| 3/9 11:15 | **비밀번호 리셋 #3** (`####Brian7677v5r6c4`) + **pause/resume #2** |
| 3/9 11:30 | Dashboard Healthy 확인 → psql 테스트 → circuit breaker (로컬 IP) |
| 3/9 11:30 | 웹 리서치 → **"모든 failing client 먼저 중지" 발견** |
| 3/9 11:33 | **근본 원인 발견**: EC2 API 서버가 옛 비밀번호로 12시간째 접속 시도 |
| 3/9 11:34 | EC2 SSH → **컨테이너 전체 중지** + .env 업데이트 |
| 3/9 11:36 | deploy.yml migrate job skip 커밋 + push (순서 실수 — 30분 대기 전에 push) |
| 3/9 11:37 | 유저가 workflow 수동 중단 |
| 3/9 12:05 | EC2에서 직접 `docker compose up -d` → **DB 연결 성공, 프로덕션 복구** |

---

## Root Cause

### 직접 원인
잘못된 DB URL(us-west-1 리전 + db.xxx 직접연결)로 `prisma db push`를 시도하여 Supavisor circuit breaker가 트리거됨.

### 근본 원인
**EC2 프로덕션 서버가 옛 비밀번호로 지속적으로 DB 접속을 시도**하면서 circuit breaker를 계속 리트리거함. 비밀번호를 리셋해도, pause/resume 해도, Supavisor의 per-IP circuit breaker는 해당 IP에서의 인증 실패가 멈추지 않는 한 해제되지 않음.

### 지연 원인 (왜 28시간 걸렸나)
1. **EC2 failing client 미인지**: EC2 서버가 계속 옛 비밀번호로 접속하고 있다는 것을 인지하지 못함
2. **circuit breaker의 IP별 독립성 미인지**: 로컬 psql 테스트가 로컬 IP의 circuit breaker를 리셋
3. **비밀번호 리셋으로 해결 시도**: 비밀번호가 문제가 아니라 접속 시도가 문제
4. **pause/resume 과신**: DB는 재시작되지만 Supavisor(공유 인프라)는 영향 없음

---

## Supavisor Circuit Breaker 동작 원리

```
클라이언트 (IP: X.X.X.X)
    │
    ▼
Supavisor (공유 인프라, 프로젝트/DB와 독립)
    │
    ├─ 인증 실패 2회+ → IP별 circuit breaker OPEN
    │   └─ 이후 해당 IP의 모든 연결 즉시 거부 (비밀번호 확인 안 함)
    │   └─ 30분 쿨다운 (해당 IP에서 접속 시도가 0인 상태에서 30분)
    │   └─ 접속 시도가 있으면 타이머 리셋
    │
    ▼
PostgreSQL (DB 인스턴스)
```

**핵심**:
- Circuit breaker는 **IP별 독립** (EC2 IP ≠ 로컬 IP ≠ GitHub Actions IP)
- 비밀번호가 맞든 틀리든, breaker가 열린 상태에서는 **모든 접속 거부**
- DB pause/resume, 비밀번호 리셋 → **Supavisor circuit breaker에 영향 없음**
- 해제 조건: **해당 IP에서 접속 시도가 0인 상태로 30분 경과**

---

## Impact

| 항목 | 영향 |
|------|------|
| 서비스 중단 | 없음 (기존 버전 운영 중) |
| 배포 중단 | 28시간 |
| DB 비밀번호 리셋 | 3회 (불필요 2회) |
| Project pause | 2회 (불필요, 서비스 일시 중단 야기) |
| 개발 시간 손실 | ~3시간 |

---

## Corrective Actions

### 즉시 조치 (완료)

| # | 조치 | 상태 |
|---|------|------|
| 1 | EC2 .env 새 비밀번호 적용 | Done |
| 2 | GitHub Secrets 업데이트 | Done |
| 3 | credentials.md 갱신 | Done |
| 4 | deploy.yml migrate job skip | Done (임시) |
| 5 | 프로덕션 복구 | Done |
| 6 | EC2 SSH 임시 규칙 제거 | Done |

### 재발 방지 (TODO)

| # | 조치 | 대상 | 상태 |
|---|------|------|------|
| 1 | deploy.yml migrate job 복원 (`needs: [migrate]`) | deploy.yml | TODO — circuit breaker 완전 해제 후 |
| 2 | troubleshooting.md 체크리스트에 "비밀번호 변경 시 EC2 먼저 중지" 추가 | troubleshooting.md | TODO |
| 3 | DB 비밀번호 변경 SOP 문서화 | docs/operations-manual.md | TODO |
| 4 | deploy.yml에 migrate 실패 시 deploy 계속 진행 옵션 추가 | deploy.yml | TODO |
| 5 | EC2 health check에 DB 연결 에러 알림 추가 | monitoring | Backlog |

---

## Lessons Learned

1. **Circuit breaker 해결의 핵심은 "failing client 중지"** — DB 비밀번호 변경이나 인프라 재시작이 아님
2. **Supavisor circuit breaker는 IP별 독립** — 한 IP에서 테스트해도 다른 IP에는 영향 없음
3. **비밀번호 변경 시 올바른 순서**: EC2 중지 → 비밀번호 변경 → 모든 곳 업데이트 → 30분 대기 → 테스트 → 재시작
4. **"확인" 목적의 접속 시도도 circuit breaker 리셋** — 대기 중에는 절대 테스트하지 않을 것
5. **Supabase project pause/resume은 Supavisor에 영향 없음** — 공유 인프라이므로 독립적
