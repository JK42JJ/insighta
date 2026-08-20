# k8s 이전 예상 이슈 점검표

작성 2026-08-19 · 대상 커트오버 2026-08-14 (EC2 docker-compose 1대 → k3s) · 점검 시각 2026-08-19 03:30~04:00 UTC

compose 단일 호스트에서 k3s 로 옮기면 **구조적으로 예상 가능한** 이슈 목록과 실측 판정.
각 항목은 판정 근거 명령을 함께 적는다. 근거 없는 항목은 판정하지 않고 미확인으로 남긴다.

## 판정 요약

| | 항목 | 판정 |
|---|---|---|
| A-1 | 삭제된 호스트를 부르는 워크플로 | **해결** |
| A-2 | 다이얼 배포 경로 소실 | **결함 — PR #1520 대기** |
| A-3 | 이미지 태그 `latest` | **미완 — 첫 SHA 미기록** |
| A-4 | 롤백 워크플로 | **미검증** |
| A-5 | CI 가 보호 브랜치에 쓸 수 없다 | **해결** (2026-08-20) |
| A-6 | 차트가 굽지 않은 이미지를 가리켰다 | **해결** (2026-08-20) |
| A-7 | CI 필수 체크가 timeout 없이 매달림 | **해결** (2026-08-20) |
| B-1 | 3 replica × in-process 스케줄러 중복 | **해결** |
| B-2 | 데이터 파이프라인 4종 | **원인 2건 규명, 수리 배포됨 — 다음 발화가 판정** |
| B-3 | DB 백업 | **정상** |
| B-4 | DB 무결성 검사 | **정상** |
| C-1 | 노드 수 — 문서와 실제 불일치 | **결함(문서)** |
| C-2 | ingress 컨트롤러 SPOF | **미해결(기지)** |
| C-3 | PodDisruptionBudget 부재 | **결함** |
| C-4 | graceful shutdown | **정상**(frontend 경미) |
| C-5 | 리소스 한계 · OOM | **정상** |
| C-6 | TLS 갱신 | **정상** |
| C-7 | 프로드 Argo Application 이 git 에 없다 | **결함** |
| D-1 | 시크릿 etcd 평문 | **미해결(기지)** |
| D-5 | DDL 대기가 읽기를 막는다 | **해결** (2026-08-20) |
| E-1 | t3 패밀리 고정 — RI 제약 | **제약 조건** |
| D-2 | api 볼륨 emptyDir | **허용 — 근거 불일치** |
| D-3 | SSE × 3 replica | **정상** |
| D-4 | in-process 캐시 × 3 replica | **성능 저하** |

---

## A. 배포 경로

### A-1. 삭제된 호스트를 부르는 워크플로 — 해결

compose 호스트는 2026-08-19 반납됐다. 그 호스트에 SSH 하던 job 은 반드시 실패한다.

```
$ grep -nE "EC2_HOST" .github/workflows/*.yml
backup.yml:115:  # against a container on secrets.EC2_HOST, which was released...
deploy.yml:392:  # session to secrets.EC2_HOST, copying files onto the host...
```

남은 2건은 전부 주석. 실행 경로 0건. `deploy.yml` 의 `deploy`·`fast-mobile`, `backup.yml` 의 `redis`,
`rollback.yml` 전체가 PR #1519 에서 제거·재작성됐다.

### A-2. 다이얼 배포 경로 소실 — 결함, PR #1520 대기

```
main            {"build": "2026-08-13-99"}
prod (curl)     {"build": "2026-08-04-97"}
파드 내부 파일    {"build": "2026-08-04-97"}
```

다이얼만 고친 커밋은 `mobile_only=true` 가 되고, `build-and-push` 가 `mobile_only != 'true'` 였다.
그 배제는 `fast-mobile` 이 rsync 로 대신 배포하던 동안 옳았고, 그 job 이 사라지자 목적지 없는 배제만 남았다.
문법 게이트만 돌고 전부 스킵된 뒤 green 을 반환한다. **적색 신호가 없는 유형이라 6일간 드러나지 않았다.**

상세·수리 = PR #1520, 회귀 = `tests/smoke/deploy-dial-path.test.ts`.

### A-3. 이미지 태그 `latest` — 미완

`prod.yaml` 의 `apiTag`/`frontendTag`/`redisTag` 가 아직 `latest`. PR #1519 가 `publish-tags` 를 넣었으나
그 머지 자신이 `deployable=false` 라 아직 한 번도 실행되지 않았다.

결과 두 가지가 여전히 유효하다.
- **롤백 대상 부재**: 되돌아갈 이전 태그가 기록된 적이 없다.
- **노드 간 불일치 가능**: `pullPolicy: IfNotPresent` + `latest` 는 서로 다른 날 pull 한 노드가
  같은 태그로 다른 코드를 돌릴 수 있다. 현재 노드가 1대라 실현되지 않을 뿐 구조는 남아 있다.

첫 deployable 머지에서 해소된다.

### A-4. 롤백 워크플로 — 미검증

`rollback.yml` 은 차트 태그를 커밋하는 방식으로 재작성됐으나 `workflow_dispatch` 라 실행된 적이 없다.
파싱과 참조 키 존재만 확인했다. A-3 가 해소되기 전에는 실행해도 "되돌아갈 태그 없음" 으로 종료한다.

### A-5. CI 가 보호 브랜치에 쓸 수 없다 — 결함, 부분 수리

`publish-tags` 최초 실행(run `32218303510`)이 거부됐다.

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - 8 of 8 required status checks are expected.
remote: ! [remote rejected] main -> main (protected branch hook declined)
```

보호 설정 실측:

```
required_checks  8개   strict: true
enforce_admins   false
restrictions     없음   required_pull_request_reviews  없음
```

CI 가 push 한 커밋은 체크를 하나도 달고 있지 않으므로 **구조적으로** 필수 체크를 만족할 수 없다.
job 설정으로 해결되지 않는다. `rollback.yml` 이 동일한 방식이라 같은 결함을 공유했고,
재작성 후 실행된 적이 없어 **장애 중에 발견될 예정이었다.**

**막힌 지점.** 완전 자동화의 선택지가 셋인데 전부 이 세션 밖의 결정을 요구한다.

| 안 | 필요한 것 | 비용 |
|---|---|---|
| CI 가 main 에 직접 push | 관리자 권한 PAT (`enforce_admins: false` 이므로 우회 가능) | 공개 리포 main 에 push 가능한 상시 크레덴셜 |
| 봇 PR + auto-merge | PAT (GITHUB_TOKEN 이 만든 이벤트는 워크플로를 **트리거하지 않아** 필수 체크가 영원히 미보고) + `allow_auto_merge` 활성화 | 크레덴셜 + 배포 완료가 CI 속도에 종속 |
| Argo 가 별도 브랜치를 추적 | 프로드 Application 의 `targetRevision` 변경 | 그 Application 이 git 에 없다 — C-7 |

**지금 한 것.** 브랜치 push 는 보호 대상이 아니므로, 두 워크플로가 브랜치를 밀고 PR 을 연다.
`enforce_admins: false` 라 관리자는 체크 미보고 상태로도 머지할 수 있다 — 클릭 한 번.
배포가 마지막 단계에서 실패하지 않고, 무엇을 해야 하는지가 run summary 와 `::notice` 에 남는다.

**푸는 조건**: 위 표에서 하나를 고르는 것. 크레덴셜 생성은 James 권한이라 여기서 정하지 않는다.
회귀 = `tests/smoke/workflow-git-writes.test.ts` (워크플로가 main 에 push 하지 않음을 고정).

---

## B. 스케줄 작업

### B-1. 3 replica × in-process 스케줄러 중복 — 해결

compose 는 컨테이너 1개였다. k8s 에서 api 를 3 replica 로 올리면 `node-cron` 스케줄이 3배로 발화한다.
`pg-boss` 는 DB 가 중재하므로 안전하지만 `node-cron` 은 프로세스 내 변수로만 가드된다
(`src/config/process-role.ts`).

```
api    RUN_QUEUE_WORKERS=false  RUN_SCHEDULERS=false   replicas 3
worker RUN_QUEUE_WORKERS=true   RUN_SCHEDULERS=true    replicas 1
```

스케줄러는 정확히 1 프로세스에서만 돈다. **이 항목은 이전 설계 때 이미 처리됐다.**

### B-2. 데이터 파이프라인 4종 — 결함, 수리 미검증

| 워크플로 | 최근 2회 | cron(UTC) | 클라이언트 timeout |
|---|---|---|---|
| `trend-collector` | fail · fail | 07:30, 19:30 | 300s |
| `pool-maintenance` | fail · fail | 03:13 | 300s |
| `batch-video-collector` | fail · fail | 07:30 | 300s |
| `batch-video-collector-watchdog` | fail · fail | 00:30 | 30s, 300s |

넷 다 `https://${DOMAIN}/api/v1/internal/...` 로 POST 한다. 커트오버 후 그 경로 앞에 ingress 가 생겼고
기본 `proxy-read-timeout` 이 60s 였다. `trend-collector` 는 140~181s 로 측정돼 60s 를 넘는다.

PR #1518 이 ingress 를 270s 로 올렸고 **라이브 반영을 확인했다**:

```
$ kubectl -n insighta-prod get ingress -o json | grep timeout
"nginx.ingress.kubernetes.io/proxy-connect-timeout": "15"
"nginx.ingress.kubernetes.io/proxy-read-timeout": "270"
"nginx.ingress.kubernetes.io/proxy-send-timeout": "270"
```

클라이언트 300s > 프록시 270s 이므로 순서도 맞다(프록시가 먼저 504 를 준다).

**그러나 #1518 머지(02:42Z) 이후 네 워크플로 중 실행된 것이 0건이다.** 다음 발화는 07:30Z.
따라서 지금 시점에 "고쳤다" 고 말할 수 없다. 07:30Z 결과가 판정한다.

`pool-maintenance` 는 03:13Z 예정이었으나 04:00Z 기준 미실행 — GitHub 스케줄 지연 범위인지 별건인지 미확인.

### B-3. DB 백업 — 정상

```
$ aws s3 ls s3://insighta-backups/db/ --recursive | tail -1
2026-08-19 12:38:54  1248112985  db/2026/08/backup_20260819.sql.gz
Total Objects: 31
```

오늘자 1.25GB 존재. `backup.yml` 은 08-14 이후 매일 실패했는데, 실패한 것은 반납된 호스트를 부르던
`redis` job 이었고 DB 백업 job 은 그 옆에서 계속 성공하고 있었다. #1519 가 `redis` job 을 제거한 뒤
03:34Z 실행이 전체 성공했다.

### B-4. DB 무결성 검사 — 정상 (08-18 success)

---

## C. 런타임 토폴로지

### C-1. 노드 수 — 문서와 실제 불일치 (결함은 문서 쪽)

```
$ kubectl get nodes
ip-172-31-11-236   Ready   v1.36.3+k3s1        ← 1대

$ aws ec2 describe-instances ...
insighta-k3s-1  t3.medium  running  172.31.11.236   ← 1대

$ grep k3s_node_count terraform/.../prod/terraform.tfvars
k3s_node_count = 1
```

인계 기록은 **2노드(`insighta-k3s-2` t3a.small)이고 2026-09-14 에 1노드로 축소 예정**이라고 적고 있다.
실제로는 이미 1노드다. 따라서:

- 파드 8개 전부 단일 노드. `topologySpreadConstraints maxSkew=1` 은 분산할 대상이 없어 **무동작**이다.
- `prod.yaml` 의 "3 replica 를 2노드에 2·1 로 분산" 주석은 현재 상태를 설명하지 않는다.
- api 3 replica 는 가용성이 아니라 **커넥션 풀 산술과 동시성**만 사는 구성이다.

노드 여유는 CPU 20% · 메모리 61%(2347Mi). 축소로 인한 압박은 없다.

**조치 = 문서와 주석을 실제에 맞추는 것.** 노드를 늘리는 판단은 별건.

### C-2. ingress 컨트롤러 SPOF — 미해결(기지)

`ingress-nginx-controller` 는 replicas 1 의 Deployment 이고, 노드가 1대이므로 그 파드가 진입점 전체다.
DaemonSet 전환이 비용 0 의 개선안으로 이미 기록돼 있다. 노드가 1대인 동안은 실효가 없다.

### C-3. PodDisruptionBudget 부재 — 결함

```
$ kubectl -n insighta-prod get pdb
(없음)
```

노드 drain·업그레이드 시 한 Deployment 의 replica 3개가 동시에 축출될 수 있다.
단일 노드에서는 drain 자체가 전면 중단이므로 지금 당장의 실효는 낮으나,
**노드를 다시 늘리는 순간 필요한 선행 조건**이다. `minAvailable: 1` 세 개면 충분하다.

### C-4. graceful shutdown — 정상 (frontend 경미)

```
api       grace=90   preStop: sleep 5
worker    grace=120  preStop: (없음)
frontend  grace=30   preStop: (없음)
```

api 의 preStop 이 Service 에서 빠지는 시간을 벌어 준다. frontend 는 정적 서빙이라 영향이 작지만
같은 5초를 넣으면 종료 중 파드로 가는 요청이 사라진다. 선택 사항.

### C-5. 리소스 한계 · OOM — 정상

파드 8개 전부 `restartCount 0`, `lastState.terminated` 없음. OOMKill 이력 없음.

### C-6. TLS 갱신 — 정상

```
insighta-tls  notAfter 2026-11-16T07:57:13Z  renewalTime 2026-10-17T07:57:13Z
```

cert-manager 가 10-17 에 갱신한다. compose 시절 호스트 nginx + certbot 경로는 호스트와 함께 사라졌다.

### C-7. 프로드 Argo Application 이 git 에 없다 — 결함

```
$ grep -n "name: insighta-" charts/bootstrap/applications.yaml
14:  name: insighta-dev
34:  name: insighta-staging
57:  name: insighta-validation
```

프로드가 없다. 클러스터의 `insighta-prod` 는 `kubectl.kubernetes.io/last-applied-configuration` 를
갖고 `ownerReferences` 가 비어 있다 — **손으로 apply 됐고 root-app 이 관리하지 않는다.**

파일 상단 주석은 아직 *"There is no prod Application yet... It is added at P4, with the cutover"* 라고
적혀 있다. P4 는 2026-08-14 에 끝났고 Application 은 만들어졌으나 리포에 돌아오지 않았다.

결과 셋:
- **클러스터 재구축 시 이 Application 을 기억으로 복원해야 한다.** 무엇을 배포할지 결정하는 객체가
  재구축 절차의 대상 밖에 있다.
- Argo 설정 변경(예: A-5 의 세 번째 안)이 GitOps 가 아니라 클러스터 수작업이 된다.
- 그 spec 이 `imageRegistry` 로 AWS 계정 id 를 담고 있다. 공개 리포라 그대로는 커밋할 수 없다 —
  이것이 애초에 커밋되지 않은 이유로 보이며, `requireImageRegistry` 와 같은 방식
  (값은 Argo 의 helm parameter 로, 파일에는 부재)으로 풀 수 있다.

---

## D. 상태·데이터

### D-1. 시크릿 etcd 평문 — 미해결(기지)

```
$ sudo k3s secrets-encrypt status
Encryption Status: Disabled
```

144키가 etcd 에 base64 로 존재한다. `secrets-encrypt enable` 은 k3s v1.36.3 에서 4회 실패했고,
External Secrets Operator 가 정답으로 기록돼 있다. 노드 디스크 접근 = 전체 시크릿 노출.

### D-2. api 볼륨 emptyDir — 허용, 근거 불일치

`values.yaml` 은 `/app/cache`(13MB) 와 `/app/logs` 를 "버려도 되는 것이 아니다" 라며 기본 PVC 로 두는데,
`prod.yaml` 은 `api.persistence.enabled: false` 다. replica 3 과 ReadWriteOnce 가 양립하지 않기 때문이고
판단 자체는 옳다. 실제 손실은 재스케줄 시 캐시 13MB 재수집이고, 로그는 stdout 에도 나간다.

**두 파일의 설명이 서로 다른 결론을 적고 있다는 것이 문제다.** prod 가 왜 끄는지를 `values.yaml` 쪽에
한 줄로 연결해야 다음 사람이 PVC 를 되살리려다 3 replica 와 충돌한다.

### D-3. SSE × 3 replica — 정상

`text/event-stream` 4개(`mandalas.ts` 3, `cards.ts` 1). Service 에 `sessionAffinity` 선언 없음.

스트림은 **단일 요청이 살아 있는 동안** 유지되고 그 요청은 한 파드에 고정된다.
하트비트 `setInterval` 은 요청 스코프이고 close 시 정리된다. 후속 요청이 같은 파드에 가야 하는
구조가 아니므로 affinity 가 필요 없다.

### D-4. in-process 캐시 × 3 replica — 성능 저하

```
src/api/routes/mandalas.ts:53
const exploreCache = new MemoryCache({ defaultTTLMs: EXPLORE_CACHE_TTL_MS, maxEntries: 100 });
```

프로세스 메모리 캐시라 replica 3개가 각자 갖는다. 적중률이 구조적으로 1/3 로 떨어지고
같은 사용자가 요청마다 다른 온도의 캐시를 만난다. **정확성 문제는 아니다** — TTL 10분의 explore 결과다.

redis 가 이미 클러스터에 있으므로 옮길 자리는 있다. 우선순위는 실측 적중률을 본 뒤 정한다.

---

### A-6. 차트가 굽지 않은 이미지를 가리켰다 — 해결

`build-and-push` 는 바뀐 이미지만 굽는데(`api`/`frontend`/`redis` 각자 조건), `publish-tags` 는 태그 3개를 무조건 같은 SHA 로 썼다. `src/` 만 바뀐 커밋(#1525)에서 실측:

```
insighta-api:ee911588        PRESENT
insighta-frontend:ee911588   ABSENT
insighta-redis:ee911588      ABSENT
```

동기화했으면 frontend 3파드 + redis 가 `ImagePullBackOff`. **배포가 성공을 보고한 뒤 누군가 동기화를 눌러야 드러나는 장애.** 동기화 직전 ECR 확인으로 잡았다.

수리 = #1529 (이번 실행이 실제로 구운 태그만 기록) + 회귀 `tests/smoke/publish-tags-matches-builds.test.ts`.

**남은 함정**: #1529 이전에 `publish-tags` 가 밀어둔 `images/*` 브랜치는 옛 동작으로 만들어져 있다. 발견 시 머지하지 말고 삭제할 것. 2건 삭제함(2026-08-20).

### A-7. CI 필수 체크가 timeout 없이 매달림 — 해결

`npx playwright install --with-deps chromium` 이 반환하지 않았다. 05:06Z 이전 전부 2~5분 성공, 이후 전부 매달림. `--with-deps` 가 부르는 apt 가 원인.

`ci.yml` 의 9개 job 중 timeout 이 하나도 없어 GitHub 기본 6시간까지 갔고, **PR 3건이 5시간 묶였다.** 보고하지 않는 체크는 실패한 체크보다 나쁘다 — 재실행할 근거조차 안 준다.

수리 = #1526 (`--with-deps` 제거 + 실측 기반 timeout 9개 + 스텝 6분) + 회귀 `tests/smoke/ci-jobs-have-timeouts.test.ts`.

### D-5. DDL 대기가 읽기를 막는다 — 해결

`DROP TRIGGER IF EXISTS` 는 지울 게 없어도 ACCESS EXCLUSIVE 를 요청하고, **대기 중인 그 요청이 뒤따르는 읽기를 전부 막는다.** 러너는 `lock_timeout` 없이 53개 SQL 을 매 배포 재적용했다. 2026-08-20 배포가 여기서 실패했고, 성공했던 배포들도 같은 시간 테이블을 세우고 있었다.

수리 = #1528 (`lock_timeout=5s` + 경합 한정 재시도 + 011 을 카탈로그 조회로 가드). **프로드 실증**: 다음 배포의 `Database Schema Sync` 성공.

### E-1. t3 패밀리 고정 — 2027-04-16까지 (제약)

```
Reserved Instance  t3.medium ×1  standard  scope=Region  Linux/UNIX
                   2026-04-16 → 2027-04-16   전액선불 $213   활용률 100%
```

Standard RI 는 **패밀리 변경 불가**(Convertible 만 가능). Regional 스코프라 **t3 안에서는 사이즈 유연성 적용**(medium=2 단위, large=4 단위).

- **t3.large 로 증설** → RI 가 절반 흡수, 추가 현금 **$30.37/mo**
- **t3.medium 1대 추가** → 동일하게 **$30.37/mo** (분산은 얻고 단일 풀 크기는 손해)
- **t3a / t4g 로 이전** → RI 전량 사장, 잔여 약 **$140 낭비**. **금지.**
- EKS 로 가도 워커가 t3 이면 RI 는 계속 유효.

**다음 세션이 모르고 t3a/t4g 를 제안하면 같은 실수를 반복한다.**

## 미확인으로 남긴 것

- **B-2 최종 판정.** 원인은 둘이었다: ①ingress timeout 60s(#1518, `trend-collector` 07:59Z 성공으로 확인) ②api 가 pg-boss 를 start 하지 않아 enqueue 가 500(#1525, 08-20 배포로 라이브). 나머지 2종은 다음 발화(`pool-maintenance` 03:13Z, `batch-video-collector` 07:30Z)가 판정한다. 지금 수동 실행하면 실제 수집이 돌아 프로드 데이터에 쓴다.
- `exploreCache` 적중률의 실제 값 (D-4).

## 재점검

이 표의 대부분은 명령 한 줄로 다시 잴 수 있다. 반복 점검이 필요해지면
`scripts/cc-facts.sh` 옆에 `scripts/audit/k8s-posture.sh` 로 묶는 것이 다음 단계다.
지금은 묶지 않는다 — 항목이 확정되기 전에 스크립트로 굳히면 틀린 항목이 초록색으로 고정된다.
