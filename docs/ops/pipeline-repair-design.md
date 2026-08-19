# 배포·스케줄 파이프라인 복구 설계

작성 2026-08-19 · 상태 **설계(승인 대기)**

"코드 수정 → PR → 즉시 반영" 이 성립하는지 물었고, 확인해 보니 성립하지 않는다.
이 문서는 무엇이 어디서 끊겼는지 실측으로 정리하고 복구 순서를 제안한다.

---

## 1. 현재 상태 실측

### 1-1. 워크플로 15개 전수

| 워크플로 | 트리거 | 최근 2회 | 인프라 의존 |
|---|---|---|---|
| `backup.yml` | schedule 03:00 UTC | **fail · fail** | EC2 |
| `batch-video-collector.yml` | schedule | **fail · fail** | — |
| `batch-video-collector-watchdog.yml` | schedule | **fail · fail** | — |
| `pool-maintenance.yml` | schedule | **fail · fail** | — |
| `trend-collector.yml` | schedule | **fail · fail** | — |
| `rollback.yml` | manual | **fail** (04-18) | EC2 |
| `deploy.yml` | push main | success | EC2 · TF · EF |
| `terraform.yml` | push main / 04:40 | success | TF |
| `ci.yml` · `dataset-pipeline` · `db-integrity-check` · `e2e` · `hardcode-audit-weekly` · `notify-runbook` · `stale-pr-triage` | — | success | — |

**15개 중 6개가 실패 중이다.** 그중 5개는 스케줄 작업이라 매일 실패를 반복한다.

### 1-2. 원인은 세 갈래

실패 6건이 같은 원인이 아니다. 섞어서 고치면 안 된다.

| 갈래 | 해당 | 원인 |
|---|---|---|
| **A. 사라진 EC2 를 가리킴** | backup(부분) · rollback · deploy(잠재) | 2026-08-19 철거 |
| **B. ingress 60초 타임아웃** | trend-collector · batch-video-collector · pool-maintenance | 커트오버 때 180초→60초 |
| **C. 클러스터 반영 경로 없음** | (실패로 안 나타남) | 차트가 `latest`, ArgoCD 수동 |

---

## 2. 갈래 A — 사라진 EC2

### 2-1. 무엇이 남아 있나

`grep -rl EC2_HOST .github/workflows/` → 4개 파일.

| 워크플로 | EC2 를 쓰는 부분 | 지금 상태 |
|---|---|---|
| `deploy.yml` | `Deploy to EC2` job 전체 — compose 파일 scp + SSH 로 docker compose | **죽음.** 오늘 3건은 문서·TF 변경이라 skip 되어 아직 안 터졌다 |
| `deploy.yml` | `fast-mobile` job — dial 파일 scp | **죽음** |
| `backup.yml` | `Redis Volume Backup` — EC2 의 redis 컨테이너에서 덤프 | **죽음.** DB 백업은 러너에서 돌아 계속 성공 |
| `rollback.yml` | 전체 | **죽음** |

**중요**: `deploy.yml` 은 아직 성공으로 보인다. 오늘 머지한 3건이 전부
`deployable=false` 로 판정되어 배포 job 이 skip 됐기 때문이다.
**다음 실제 코드 변경에서 처음 실패한다.**

### 2-2. 백업이 실제로 어떻게 되고 있나

S3 `db/2026/08/` 는 08-18 까지 정상(약 1.19GB/일). 즉 **DB 백업은 살아 있다.**
죽은 것은 redis 볼륨 백업이고, 그 실패 때문에 job 전체가 fail 로 기록되어
"백업이 안 되고 있다" 처럼 보인다.

redis 는 현재 클러스터 안 StatefulSet 이고 PVC(8Gi)를 쓴다. 백업 대상이
EC2 컨테이너에서 클러스터 파드로 옮겨갔는데 워크플로가 따라오지 않았다.

### 2-3. 조치

| # | 대상 | 조치 |
|---|---|---|
| A-1 | `deploy.yml` `Deploy to EC2` job | **삭제.** 대상이 없다 |
| A-2 | `deploy.yml` `fast-mobile` job | **삭제.** 같은 이유 |
| A-3 | `backup.yml` Redis 단계 | 클러스터 파드 대상으로 **재작성** (`kubectl exec`) |
| A-4 | `rollback.yml` | **삭제 또는 재작성.** §4 결정 필요 |
| A-5 | `EC2_HOST` · `EC2_USER` 시크릿 | 위 완료 후 **폐기** |

A-1·A-2 는 판단이 필요 없다. 가리키는 것이 존재하지 않는다.

---

## 3. 갈래 B — ingress 60초

### 3-1. 실측

`trend-collector` 는 **정상 동작하고 있다.** 끊기는 것은 호출 쪽이다.

```
02:01:52  POST /api/v1/internal/skills/trend-collector/run
02:02:06  pod: dynamic seeds: 30 goals → 68 terms   (13.9s)
02:02:21  pod: LLM extracted keywords from 34 titles (14.4s)
02:02:23  pod: 1040 keywords from 97 seeds          ← 계속 작업 중
02:02:52  ingress: 504                              ← 정확히 60초
```

이전 서버의 nginx 는 `proxy_read_timeout 180s` 였고, ingress 기본값은 60초다.
작업 자체는 140~181초 걸린다.

### 3-2. 이 상태가 만드는 비용

작업은 **끝까지 수행된다.** LLM 호출도 그대로 발생한다. 그런데 호출자는 504 를 받아
실패로 기록하고, 스케줄이라 다음 날 다시 돈다. 즉 **매일 LLM 비용을 쓰면서
매일 실패로 집계된다.**

### 3-3. 조치 — 두 층으로

**B-1. 즉시 — ingress 타임아웃 상향**

측정된 최대치 181초 위로, 클라이언트 `--max-time 300` 아래로 잡는다.

```yaml
# charts/insighta/environments/prod.yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "240"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "240"
```

증상 제거이지 근본 해결이 아니다. 작업이 더 길어지면 다시 터진다.

**B-2. 근본 — 동기 실행을 비동기로**

`/run` 이 작업을 큐에 넣고 즉시 202 를 반환하고, 워크플로는 상태를 폴링한다.
HTTP 요청 수명과 작업 수명을 분리하면 타임아웃 자체가 사라진다.

이것은 `pool-maintenance` 의 실패 원인과도 이어진다. 그 경로는 pg-boss 에
넣으려 하는데 api 파드에서 JobQueue 가 초기화돼 있지 않다.

```
src/api/background.ts:57
  if (runsQueueWorkers()) { await initJobQueue(); }
  else { /* pg-boss 는 세션 커넥션을 쓰므로 워커에만 둔다 */ }
```

api 는 `RUN_QUEUE_WORKERS=false` 인데 **producer 이기도 하다.** 주석은 consumer 만
고려했다.

**B-3. producer 커넥션 예산** (측정 완료)

- pg-boss 9.0.3 은 `max` 를 지정하지 않음 → `pg-pool` 기본값 10 (`index.js:89`, 실측 확인)
- 현재 Supabase 커넥션 32/60, 여유 28
- api 3 레플리카 × 10 = 30 > 28 → 그대로 켜면 초과

따라서 producer 는 축소 설정으로 연다.

```ts
new PgBoss({ connectionString, max: 2, noSupervisor: true, noScheduling: true })
// 3 레플리카 × 2 = 6 커넥션
```

`noSupervisor` · `noScheduling` 은 `pg-boss/src/index.js:107,111` 에서 확인한 실제
옵션이며, 유지보수와 스케줄은 worker 가 계속 담당한다.

---

## 4. 갈래 C — 클러스터 반영 경로

### 4-1. 지금 무슨 일이 일어나나

```
PR 머지
  → deploy.yml 이 ECR 에 푸시:  :latest  와  :<커밋SHA>  둘 다  (244-245행)
  → 끝.
```

클러스터에 알리는 단계가 없다. 그리고 차트가 `tag: latest`,
`pullPolicy: IfNotPresent` 라 기존 파드는 새 이미지를 받지 않는다.

지금 ECR `:latest` 와 실행 중 digest 가 일치하는 이유는 **08-14 이후 이미지를
한 번도 안 올렸기 때문**이지 반영이 되고 있어서가 아니다.

```
ECR  insighta-api:latest   digest 7206a370…  (푸시 08-14 15:14)
파드 api 실행 중            digest 7206a370…
```

### 4-2. 이미 갖춰진 재료

- `deploy.yml` 이 **커밋 SHA 태그를 이미 푸시**한다
- ArgoCD Application 이 **helm parameter 주입을 이미 쓴다** (`imageRegistry` 등 3개)

즉 배관은 있고 연결만 안 돼 있다.

### 4-3. 조치

**C-1. 차트가 SHA 태그를 받도록**

```yaml
# charts/insighta/values.yaml — 기본값만 남기고
api:
  image:
    tag: latest      # ArgoCD parameter 가 덮어쓴다
```

**C-2. `deploy.yml` 이 ArgoCD parameter 를 갱신**

이미지 푸시 후 Application 의 `api.image.tag` 를 커밋 SHA 로 설정한다.
`imageRegistry` 를 넣는 것과 같은 메커니즘이다.

**C-3. 자동 동기화 — 결정 필요**

현재 3개 앱 모두 수동이다. `charts/bootstrap/applications.yaml` 주석에
"사람이 먼저 읽고, 확인된 뒤에 자동 동기화를 켠다" 고 적혀 있다. 의도적 선택이다.

| | 자동 (`automated: prune+selfHeal`) | 수동 (현행) |
|---|---|---|
| 반영 시점 | 머지 즉시 | 사람이 Sync |
| 되돌리기 | 다시 머지해야 함 | 안 누르면 됨 |
| 드리프트 | selfHeal 이 자동 복원 | 표시만 |

**권고: prod 는 수동 유지, dev·staging 만 자동.** 지금 롤백 경로가 git revert
하나뿐이라(예전 EC2 철거로 3층 소멸), prod 자동 동기화는 되돌리기 수단이 없는
상태에서 자동 전진만 켜는 것이 된다.

### 4-4. 이 조치가 함께 푸는 것

`latest` 태그를 SHA 로 바꾸면 **롤백 1층도 같이 살아난다.**
리비전마다 이미지 문자열이 달라져 `kubectl rollout undo` 가 실제로 이전 코드로
돌아간다. 현재는 두 리비전이 같은 `:latest` 를 가리켜 무효다.

---

## 5. 순서와 판정 기준

의존 관계 때문에 순서가 정해진다.

| # | 작업 | 판정 기준 | 위험 |
|---|---|---|---|
| 1 | `deploy.yml` 죽은 job 2개 삭제 | 코드 변경 PR 이 성공으로 끝남 | 낮음 |
| 2 | ingress 타임아웃 240초 | trend-collector 가 200 반환 | 낮음 |
| 3 | `backup.yml` redis 단계를 파드 대상으로 | job 전체 success, S3 에 redis 백업 | 낮음 |
| 4 | 차트 SHA 태그 + ArgoCD parameter 갱신 | 배포 2회 후 리비전 이미지가 서로 다름 | 중간 |
| 5 | `rollout undo` 로 이전 코드 복귀 확인 | digest 가 실제로 바뀜 | 중간 |
| 6 | producer JobQueue (`max:2`) | pool-maintenance 200, 커넥션 38/60 | 중간 |
| 7 | `/run` 비동기화 (202 + 폴링) | 타임아웃 무관해짐 | 높음 |
| 8 | `rollback.yml` 재작성 또는 삭제 | — | 결정 필요 |
| 9 | `EC2_HOST`·`EC2_USER` 폐기 | 참조 0건 | 낮음 |

1~3 은 명백한 수리이고 되돌리기 쉽다. 4~6 은 배포 동작을 바꾸므로 각각
검증 후 진행한다. 7 은 API 계약이 바뀌므로 별도 설계가 필요하다.

---

## 6. 이 상황이 만들어진 경위

기록으로 남긴다.

커트오버(2026-08-14)는 트래픽을 옮겼다. 그러나 **트래픽 외의 것들** — 배포 대상,
백업 대상, 롤백 대상, 타임아웃 값 — 은 예전 서버를 가리킨 채 남았다. 서비스가
200 을 반환했기 때문에 점검을 통과했고, 스케줄 작업의 실패는 매일 조용히 쌓였다.

2026-08-19 예전 서버 철거는 그 남은 참조들을 **죽은 참조**로 바꿨다. 철거 전에
`grep -rl EC2_HOST .github/` 를 한 번 돌렸으면 4개 파일이 즉시 나왔을 것이다.
프로덕션 헬스·terraform drift·엔드포인트 응답은 확인했으나 CI 참조는 확인하지
않았다.

**여기서 얻은 점검 항목**: 인프라를 제거하기 전에 그것을 **이름으로 참조하는
모든 것**을 검색한다. 워크플로, 스크립트, 시크릿, 문서. 서비스가 정상이라는 것은
아무것도 그것을 참조하지 않는다는 뜻이 아니다.
