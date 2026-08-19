# 다이얼 별도 아티팩트 분리 설계

작성 2026-08-19 · 개정 2026-08-19 (점검표 반영) · 상태 **설계 승인, 단계별 구현 중**
선행 PR #1520 **머지됨** · 관련 점검표 `docs/ops/k8s-migration-issue-checklist.md` (#1522)

다이얼을 별도 파드로 분리할지에 대한 질의의 답과, 채택한 설계.
결론은 **파드 분리가 목적이 아니라 태그 분리가 목적**이고, 파드는 그 태그를 실어나르는 수단이라는 것이다.

---

## 1. 실측

### 1-1. 다이얼의 실체

| 항목 | 값 | 측정 방법 |
|---|---|---|
| 본체 | `frontend/public/mobile/index.html` **473KB 단일 자립형 HTML** | `wc -c` |
| 외부 `<script src>` | **0개** | `grep -oE '<script[^>]*src='` |
| SPA 와 공유 코드 | 없음 | 위와 동일 |
| 전체 자산 | 1.5MB (아이콘 3 · 스플래시 3 · 샘플오디오 · manifest) | `du -sh` |
| 호출 API | `/api/v1/*` — SPA 와 동일 오리진 | `grep -oE "fetch\("` |
| 자체 버전 | `version.json` = `2026-08-13-99` — SPA 와 별개 번호 체계 | 파일 |

`frontend/public/dial/` 은 다이얼 랜딩·공유 페이지(247KB HTML + 287KB og.png)로,
역시 손으로 쓴 정적 HTML 이고 SPA 빌드 산출물이 아니다. 프로드에서 `/dial/` 200 응답.

### 1-2. 변경 빈도

```
frontend/public/mobile/   188 커밋   (전부 2026-06-01 이후)
frontend/src/             133 커밋   (2026-06-01 이후)
frontend/public/dial/       9 커밋
```

**다이얼이 SPA 소스 전체보다 자주 바뀐다.** 이 문서의 모든 판단이 이 한 줄에서 나온다.

### 1-3. frontend 이미지의 구성

```
frontend/public/   30M
  demo 영상 3 + beta-notice.gif   19M   (거의 안 바뀜)
  mobile/                        1.5M  (188 커밋)
  dial/                          524K  (9 커밋)
```

이미지 무게의 대부분은 거의 안 바뀌는 미디어이고, 그 안에 가장 빨리 바뀌는 것이 들어 있다.

### 1-4. 런타임

| 항목 | 값 |
|---|---|
| frontend 파드 | nginx 정적 서빙, **실측 3.8 MiB** / request 32Mi · 10m CPU |
| replicas | 3 (prod), `topologySpreadConstraints` 로 2노드 분산 |
| ingress | `/api` `/health` `/oauth/callback` `/documentation` `/api-reference` → api, `/` → frontend |
| `/mobile` 전용 경로 | **없음** — `/` 로 떨어져 frontend nginx 가 파일로 서빙 |

### 1-5. 파이프라인이 다이얼을 특수취급해온 이력

`scope.mobile_only`, `fast-mobile`, `mobile-gate` 세 장치가 전부 "다이얼은 자기 시계로 나간다" 를
구현하려던 것이다. `fast-mobile` 은 이미지 빌드를 건너뛰고 EC2 박스로 rsync 했다.

2026-08-14 커트오버로 그 박스가 트래픽에서 빠졌고, 2026-08-19 PR #1519 가 job 을 삭제했다.
배제 조건만 남고 목적지가 사라져 **다이얼만 고친 커밋이 아무것도 배포하지 않고 green 을 반환**했다.
main 은 2026-08-13 부터 build 99 를, 프로드는 97 을 서빙하고 있었다. PR #1520 이 이것을 수리한다.

즉 분리 요구는 새로 생긴 것이 아니라 **2개월간 우회로로 구현돼 있다가 인프라 이전에 끊어진 것**이다.

---

## 2. 결정

**별도 이미지 · 별도 태그 · 별도 Deployment.** 서빙 호스트는 동일하게 유지한다.

### 2-1. 파드 분리가 사주지 않는 것

파드 경계가 통상 사주는 네 가지를 이 경우에 대입하면:

| | 값어치 | 근거 |
|---|---|---|
| 독립 스케일링 | 없음 | frontend 파드 실측 3.8 MiB. 쪼갤 부하가 없다 |
| 독립 장애도메인 | 없음 | 양쪽 다 로컬 디스크 바이트를 뱉는 nginx. 독립적으로 죽는 시나리오가 없다 |
| 독립 리소스 한계 | 없음 | 3.8 MiB 에서 무의미 |
| 독립 라이프사이클 | **있음** | §1-2 |

**"런타임 분리" 를 목적으로 파드를 나누면 비용만 지불하고 얻는 것이 없다.** 얻고 싶은 것은 릴리스 분리다.

### 2-2. 실제로 사주는 것

1. **독립 롤백.** 지금은 나쁜 다이얼 빌드를 되돌리려면 frontend 전체를 되돌려야 한다.
   다이얼은 James 가 실기기로 게이트하는 표면이라 이 시나리오는 가정이 아니다
   (`feedback_device_verify_no_blind_deploy` · CP523 build 20~24 blind 8회 실패).
2. **독립 빌드.** 다이얼 이미지는 `COPY` + nginx 베이스뿐이라 node·npm·vite 가 없다.
   SPA 빌드와 자릿수가 다르다 — 구체적 수치는 실제로 굽기 전까지 적지 않는다.
3. **이미지 결합 해소.** 473KB 텍스트 한 줄 고치는 데 19MB 영상이 든 이미지를 다시 굽지 않는다.

파드가 하나 늘어나는 것은 이 셋을 얻기 위한 **수단**이고, 비용은 32Mi · 10m 이다.

---

## 3. 기각안

### 3-1. 현행 유지 (PR #1520 상태)

다이얼 변경이 SPA 를 재빌드·재배포한다. 배포 가능성은 회복되지만 §2-2 셋을 전부 못 얻는다.
**긴급 수리로서는 옳고, 종착지로서는 아니다.**

### 3-2. S3 + CloudFront

같은 태그·롤백 경계를 파드 없이 얻고, 30MB 정적 자산을 이미지에서 들어낼 수 있다.

**기각 사유**: 이 클러스터의 불변식이 *"클러스터가 읽는 것은 이 리포지토리이고, 롤백은 커밋이다"* 이다
(`rollback.yml` · `publish-tags`, 2026-08-19). 버킷으로 가면 다이얼만 롤백 메커니즘이 달라지고,
상태가 git 밖에 산다. 롤백 경로를 하나로 모으는 데 세션 하나를 쓴 직후에 그것을 되돌리는 교환이다.

다이얼이 실제 미디어 무게(영상·오디오)를 갖게 되면 재검토한다. **19MB 데모 영상 쪽이 먼저 후보다** —
그쪽은 거의 안 바뀌고 롤백 대상도 아니라서 이 불변식과 충돌하지 않는다.

### 3-3. 별도 호스트 (`dial.insighta.one`)

**기각 사유**: 다이얼이 `/api/v1/*` 를 동일 오리진으로 부르고,
`LoginPage.tsx:115` 가 모바일 기기를 `window.location.assign('/mobile')` 로 보낸다.
호스트를 가르면 CORS 와 쿠키 도메인이 새 문제로 생긴다. 얻는 것이 없다.

---

## 4. 설계

### 4-0. 점검표가 이 설계에 부과하는 제약

`k8s-migration-issue-checklist.md` 실측에서 이 설계의 전제를 바꾸는 항목이 넷 나왔다.
설계를 쓸 때 알지 못했던 것이므로 여기에 명시하고, 해당 절에 반영한다.

| 점검표 | 사실 | 이 설계에 대한 영향 |
|---|---|---|
| C-1 | **클러스터 노드가 1대**(`k3s_node_count = 1`). 인계 기록의 2노드·09-14 축소는 현재와 다르다 | `insighta.spread` 를 dial 에 붙여도 **무동작**. §4-3 · §7-3 수정 |
| C-3 | PodDisruptionBudget 이 하나도 없다 | dial 도 같은 상태로 태어난다. §4-7 신설 |
| A-3 | `publish-tags` 가 아직 한 번도 실행되지 않아 `prod.yaml` 이 `latest` | **단계 1 의 검증이 `dialTag` 이전에 `publish-tags` 자체의 첫 실행에 의존**. §5 · §6 수정 |
| A-4 | `rollback.yml` 은 재작성됐으나 실행된 적이 없다 | §6 의 롤백 리허설이 그 워크플로의 **최초 실행**이 된다. 리허설을 다이얼로 하는 것은 오히려 적절 — 되돌려도 정적 파일 한 벌이다 |

### 4-1. 이미지 — `insighta-dial`

```dockerfile
# docker/dial/Dockerfile
FROM nginx:alpine
COPY frontend/public/mobile /usr/share/nginx/html/mobile
COPY frontend/public/dial   /usr/share/nginx/html/dial
```

`/mobile` 과 `/dial` 을 한 이미지에 둔다. 둘 다 손으로 쓴 정적 HTML 이고 SPA 빌드 산출물이 아니며,
같은 표면(다이얼)에 속한다. 분리 근거가 없다.

### 4-2. 사본은 하나여야 한다

`frontend/.dockerignore` 에 `public/mobile` · `public/dial` 을 추가해 **frontend 이미지에서 뺀다.**

두 이미지가 같은 파일을 담으면 어느 쪽이 서빙되는지가 ingress 규칙에 달리고,
한쪽만 갱신됐을 때 드리프트가 조용히 생긴다. 이번 사건이 정확히 "이미지 안 내용과 리포 내용이
다른데 아무 신호가 없었다" 였다. 사본은 하나로 둔다.

부작용: 다이얼 파드가 죽으면 `/mobile` 이 404 이지 낡은 사본으로 폴백하지 않는다. **이것이 의도다.**

### 4-3. 차트

- `charts/insighta/templates/dial.yaml` — Deployment + Service.
  `frontend.yaml` 을 본으로 하되 `API_URL` env 는 불필요(다이얼은 동일 오리진 상대경로만 호출).
- `values.yaml`

  ```yaml
  dial:
    replicaCount: 1
    port: 8082
    image: { repository: insighta-dial, pullPolicy: IfNotPresent }
    resources:
      requests: { memory: 32Mi, cpu: 10m }
      limits:   { memory: 128Mi, cpu: 200m }
    livenessProbe:  { httpGet: { path: /mobile/version.json, port: 8082 } }
    readinessProbe: { httpGet: { path: /mobile/version.json, port: 8082 } }
  ```

  프로브 경로를 `/` 가 아니라 `version.json` 으로 두면 파일이 실제로 있는지까지 확인한다.
- `environments/prod.yaml` 의 `images:` 블록에 `dialTag` 추가. `publish-tags` 가 함께 쓴다.
- `_helpers.tpl` 의 `insighta.image` 는 그대로 쓴다(태그 오버라이드 이미 지원).
- `insighta.spread` 는 **붙이지 않는다.** 노드가 1대라 무동작이고(점검표 C-1),
  분산할 대상이 생기는 시점에 frontend·api 와 함께 일괄로 붙이는 편이 낫다.
  지금 붙이면 "분산되고 있다" 는 잘못된 인상만 남는다.

### 4-4. ingress

`ingress.yaml` 의 host rule 에 `/` 보다 **앞에** 두 경로를 추가한다.

```
- path: /mobile   -> insighta-dial:8082
- path: /dial     -> insighta-dial:8082
- path: /         -> insighta-frontend:8081
```

ingress-nginx 는 `pathType: Prefix` 를 길이 내림차순으로 정렬하므로 매니페스트 순서가
결정적이지는 않으나, 파일의 기존 관례(`$apiPaths` 를 `/` 앞에 렌더)를 따라 의심의 여지를 없앤다.

**rate-limit Ingress 와 무관하다.** 그쪽은 `/api` 만 소유한다.

### 4-5. `deploy.yml`

- `scope`: `dial` 출력의 판정 범위를 `^frontend/public/(mobile|dial)/` 로 넓힌다.
  현재 `mobile/` 만 본다 — `dial/` 변경은 지금도 full 경로로 가므로 결함은 아니지만,
  분리 후에는 이 신호가 "다이얼 이미지를 다시 구울 것인가" 를 결정하므로 정확해야 한다.
- `build-and-push`: `Build & push Dial image` 스텝 추가, `if: needs.scope.outputs.dial == 'true'`.
- `publish-tags`: `dialTag` 도 기록.
- `mobile-gate`: 그대로. 이미 `dial` 신호를 읽는다(PR #1520).

### 4-7. PodDisruptionBudget — 함께 만들지, 함께 미룰지

점검표 C-3 기준 클러스터에 PDB 가 하나도 없다. dial 을 추가하면 같은 상태의 Deployment 가 하나 더 는다.

노드가 1대인 동안 PDB 는 실효가 없다(drain 이 곧 전면 중단이다). 따라서 **이 설계에서는 만들지 않는다.**
다만 두 번째 노드가 돌아오는 시점에 dial 을 포함한 4개 Deployment 에 `minAvailable: 1` 을 한 번에
붙이는 것이 선행 조건이라는 사실을 여기에 남긴다. dial 만 따로 챙기면 나머지 셋을 빠뜨린다.

### 4-6. 롤백

`rollback.yml` 이 `apiTag`/`frontendTag` 를 쓰는 자리에 `dialTag` 를 더한다.
그 워크플로는 재작성 후 실행된 적이 없다(점검표 A-4). §6 의 리허설이 최초 실행이 된다.
**단, 다이얼만 되돌리는 입력이 필요하다** — 그것이 이 설계의 존재 이유다.

`inputs.scope` 추가: `all` | `dial` | `app`. 기본 `all`.
`dial` 이면 `dialTag` 만, `app` 이면 `apiTag`+`frontendTag` 만 움직인다.

---

## 5. 이행 순서

무중단이어야 하고, 각 단계가 독립적으로 되돌려져야 한다.

| 단계 | 내용 | 되돌리는 법 |
|---|---|---|
| 0 | PR #1520 머지 **(완료 `d8d1eaa9`)**. 라이브 확인은 아직 — §5-1 참조 | revert |
| 1 | `docker/dial/Dockerfile` + `build-and-push` 스텝 + `publish-tags` 의 `dialTag`. **차트 미변경** — 이미지만 굽고 아무도 안 쓴다 | revert (배포 영향 0) |
| 2 | `dial.yaml` + `values.yaml` + `prod.yaml` `dialTag`. **ingress 미변경** — 파드는 뜨지만 트래픽 0 | 차트 revert |
| 3 | ingress 에 `/mobile` `/dial` 추가 → 다이얼 파드가 서빙 시작. 이 시점에 frontend 이미지에도 아직 사본이 있으므로 되돌리면 즉시 원복 | ingress revert |
| 4 | 라이브 확인 후 `frontend/.dockerignore` 에서 사본 제거 | revert 하고 재빌드 |

단계 3 까지는 frontend 이미지에 사본이 남아 있어 **ingress 한 줄로 왕복**한다.
사본 제거(단계 4)는 라이브 확인 뒤에만 한다.

### 5-1. 단계 0 이 아직 안 끝난 이유

PR #1520 은 머지됐으나 **그 머지 자신이 `deployable=false`** 다(`.github/` · `tests/` 는 둘 다
`IRRELEVANT` 목록). 실측:

```
$ gh run view 32217275136 --json jobs
success  Detect scope
skipped  Build & Push Docker Images
skipped  Point the chart at this commit
...
```

따라서 프로드는 여전히 build 97 을 서빙한다. 수리된 것은 **다음 다이얼 커밋의 경로**이지
지금 밀려 있는 build 99 가 아니다.

99 를 올리는 방법은 둘이고, 둘 다 James 판단이다.

1. **`workflow_dispatch` 1회.** `scope` 가 수동 실행을 "전부" 로 취급하므로 frontend 이미지를
   main 기준으로 다시 굽고 `publish-tags` 가 첫 SHA 를 기록한다. 부수효과로 `migrate`
   (프로드 `prisma db push`)가 함께 돈다 — 스키마 변경은 없으나 프로드 쓰기다.
2. **다음 deployable 커밋을 기다린다.** 부수효과 0. 대신 그때까지 다이얼은 97 로 남는다.

**단계 1 은 1번에 의존한다.** `publish-tags` 는 아직 한 번도 실행된 적이 없어(점검표 A-3),
`dialTag` 를 추가하기 전에 그 job 이 실제로 동작하는지가 미확인 상태다.
검증되지 않은 메커니즘 위에 두 번째 태그를 얹지 않는다.

---

## 6. 검증 항목

각 단계에서 확인하고, 확인 전에 다음 단계로 가지 않는다.

- [ ] **선행**: `publish-tags` 가 1회 성공하고 `prod.yaml` 의 `apiTag` 가 SHA 로 바뀐다 (점검표 A-3)
- [ ] 단계 1: ECR 에 `insighta-dial` 태그가 커밋 SHA 로 올라온다
- [ ] 단계 2: `kubectl get pods -l component=dial` Running, 프로브 통과. 트래픽은 아직 0
- [ ] 단계 2: dial 파드가 어느 노드에 뜨든 무방 — 노드 1대(점검표 C-1). 분산 확인 항목 없음
- [ ] 단계 3: `curl https://insighta.one/mobile/version.json` 이 리포 값과 일치
- [ ] 단계 3: `curl https://insighta.one/dial/` 200
- [ ] 단계 3: `curl https://insighta.one/` (SPA) 200 — `/` 라우팅 무영향
- [ ] 단계 3: 다이얼에서 `/api/v1/*` 호출 성공 (동일 오리진 유지 확인)
- [ ] 단계 3: 모바일 기기에서 로그인 → `/mobile` 리다이렉트 동작
- [ ] 단계 4: 파드 안에 사본이 **하나뿐**인지 — frontend 파드에 `/mobile` 부재 확인
- [ ] 회귀: `tests/smoke/deploy-dial-path.test.ts` 를 `dialTag`·dial 이미지 스텝까지 확장
- [ ] 롤백 리허설: `scope=dial` 로 이전 태그 복귀 후 `version.json` 이 되돌아가는지 실측

**단계 3 의 기기 확인은 실기기에서 한다.** forced-render·resize 는 렌더 결과가 아니다
(`feedback_external_constraint_probe` · CP522).

---

## 7. 미결정 — James 판단 필요

1. **빌드 99 를 언제 올릴 것인가.** §5-1 의 두 선택지. 단계 1 착수의 선행 조건이기도 하다.
2. **19MB 데모 영상 처리.** 이번 설계 범위 밖이지만 frontend 이미지 무게의 실질이다.
   §3-2 의 불변식과 충돌하지 않는 유일한 후보라 별도 트랙으로 둘 수 있다.
3. **`dial` replicaCount.** 실측 정정: 노드는 **이미 1대**다(점검표 C-1 — 인계 기록의
   "09-14 축소 예정" 은 현재와 다르다). 따라서 replica 를 늘려도 가용성은 사지 못하고
   같은 노드 위 프로세스만 늘어난다.

   재기동 중 `/mobile` 단절을 줄이는 값은 **2** 다(rolling update 시 최소 1개 생존).
   32Mi × 2 = 64Mi, 노드 메모리 61% 사용 중이므로 여유는 있다.
   1 로 시작해 단절을 관측한 뒤 올리는 쪽도 가능하다. 판단 필요.
