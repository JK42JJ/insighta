---
id: WO-2026-11-03-stg-to-prod-promotion
status: draft
owner: insighta-session
opened: 2026-11-03
---

# 목표

변경이 prod(A, `insighta.one`)에 닿기 전에 B(`stg.insighta.one`)에서 먼저 실제 데이터로 검증되고, prod 반영은 James 의 승인 이후에만 일어난다. A 와 B 는 **같은 DB 한 벌**을 쓴다. 별도 stg DB 는 폐기한다.

순서: **B 배포 → B 검증 통과 → James 승인 → A 배포 → Keel 확인**.

# 결정 (2026-11-03, James)

- 환경은 `stg`(B) → `prod`(A) 두 단계. 슬롯·라우터·세그먼트 테이블은 만들지 않는다(보류).
- **DB 는 한 벌(prod DB).** 별도 stg DB 는 제거한다. 단 **prod DB 는 어떤 경우에도 삭제 대상이 아니며**, 제거는 아래 "stg DB 제거 안전 절차"의 사전 확인을 모두 통과한 stg 전용 프로젝트에 한한다.
- 고객군 이름은 `team` 으로 예약(주소·코드·DB 에 아직 쓰지 않음). 주소 체계는 바꾸지 않는다.
- 노드 증설과 상시 비용 증가는 Slack 승인 후에만. 이 오더는 추가 비용이 없다.

# 맥락 (origin/main 실측, 2026-11-03)

`.github/workflows/deploy.yml`, `charts/insighta/environments/staging.yaml`, `e2e-staging.yml` 을 읽은 결과.

1. push(main) 한 번에 stg 작업과 prod 작업이 **병렬**로 돈다. prod `migrate`(`prisma db push` 를 prod DB 에)와 prod `deploy-edge-functions` 는 `scope` 에만 의존하며 stg 결과와 무관하고 사람 승인이 없다. prod 이미지는 핀 PR(`publish-tags`)이라는 사람 단계가 있다.
2. `e2e-staging.yml` 주석에 "promotion will be gated on" 이라고 있으나 그 결과를 읽는 prod 쪽 job 이 없다.
3. 모든 stg job 이 `github.ref == 'refs/heads/main'` 이라 PR 브랜치는 stg 에 배포할 수 없다.
4. 현재 stg 는 별도 Supabase 프로젝트(`vars.STG_PROJECT_REF`, `secrets.STG_DIRECT_URL`)에 연결돼 있고, `migrate-staging`·`deploy-edge-functions-staging`·E2E 가 이를 쓴다. `migrate-staging` 에는 URL 이 stg 프로젝트를 가리키는지 확인하는 가드("Assert the target is staging")가 이미 있다.
5. stg 는 이미 worker `replicaCount: 0`, `curation.weeklyEnabled: false`, `keel.enabled: false`, `schemaSync.enabled: false`, 자체 redis 를 쓴다. api 는 1개(Recreate).
6. stg 의 DB 접속 비밀은 차트가 아니라 클러스터의 `insighta-staging` 네임스페이스 Secret(스크립트로 생성)에 있다. 이 Secret 의 키 이름과 가리키는 프로젝트는 아직 읽지 않았다(P0).

# 설계

## 목표 구조

| | A (prod) | B (stg) |
|---|---|---|
| 도메인 | `insighta.one` | `stg.insighta.one` |
| 네임스페이스 | `insighta-prod` | `insighta-staging` |
| 코드 | 안정 이미지 핀 | 후보 이미지 핀 |
| api | 2 | 1 |
| worker·스케줄러 | worker 1 (큐·스케줄 담당) | **없음**: worker 0, api 의 `RUN_QUEUE_WORKERS=false`, `RUN_SCHEDULERS=false` |
| DB | prod DB | **prod DB (같은 DB)** |
| 큐(pg-boss) | DB 안 | 같은 DB 안(공유). B 는 작업을 넣기만 하고 처리하지 않는다 |
| 사용자 | 전체 | 내부 계정만 |

## DB 한 벌의 결과

1. **스키마·Edge Function 은 적용 즉시 A 에도 적용된다.** 따라서 "추가 먼저, 삭제 나중"(컬럼 삭제·이름 변경 금지)이 필수 조건이다. 이를 어기는 PR 은 CI 에서 막는다. 스키마·Edge Function 적용은 B 배포의 **선행 단계**이며 James 승인 대상이다.
2. **큐 공유**: B 가 넣은 작업은 A 의 worker 가 처리한다. 작업 데이터 형식은 A 와 호환되어야 하므로 작업 데이터에 버전 필드를 둔다. 비호환 변경은 worker 이미지(A)를 먼저 올린 뒤 api 를 올린다.
3. **B 의 쓰기는 실제 데이터에 들어간다.** B 접근 사용자를 내부 계정으로 제한한다. E2E 는 전용 시험 계정 한 개만 쓰고, 그 계정이 만든 행은 소유 키(`user_id`, `mandala_id`) 기준으로만 지운다.
4. **B 검증은 실제 prod 데이터량·형태로 이루어진다.** 이전 초안의 "stg 와 prod 데이터가 달라 보증하지 못한다"는 한계는 이 구조에서 해소된다.
5. **인증**: B 가 prod 의 인증 프로젝트를 쓰려면 `stg.insighta.one` 이 해당 프로젝트의 허용 리다이렉트 목록에 있어야 한다(콘솔 확인, P0). B 프런트가 prod 번들을 그대로 쓰는지, 별도 빌드인지도 P0 에서 확인한다(현재 prod 빌드 job 이 `staging_only` 에서 제외됨).

## 배포 흐름

```
push main
 ├─ build (이미지)  ── 호환 검사(추가형 스키마, 큐 형식)
 ├─ [스키마·Edge Function 변경이 있을 때만] 적용 단계 ── James 승인 (Environment)
 ├─ B 배포 (stg 핀) ── smoke ── E2E (내부 시험 계정)
 └─ (여기서 정지)

promote (workflow_dispatch, 입력 sha, reason)
 ├─ 게이트: 해당 sha 의 E2E(B) 성공 여부 확인, 아니면 실패
 ├─ James 승인 (Environment production)
 └─ A 배포 (prod 이미지 핀) ── Keel 확인
```

- 스키마·Edge Function 적용 job 은 현재 `deploy.yml` 의 prod `migrate`, `deploy-edge-functions` 를 승인 단계 뒤로 옮긴 것이다. 코드만 바뀐 푸시는 승인 없이 B 까지 자동 배포된다(B 는 내부 전용이므로).
- 승인 대기가 다음 푸시의 B 배포를 막지 않도록 워크플로 전체 `concurrency` 대신 job 단위 그룹으로 나눈다. 이 동작은 P0 에서 확인한다.
- 긴급 예외: 입력 `skip_gate=true` + 필수 `reason`. James 의 직접 지시가 있을 때만, 실행 기록에 남긴다.

## stg DB 제거 안전 절차

제거 대상은 `vars.STG_PROJECT_REF` 가 가리키는 **stg 전용 Supabase 프로젝트**이다. prod DB 를 지울 가능성이 구조적으로 없어야 한다.

원칙
- **CC 는 삭제를 실행하지 않는다.** 삭제는 James 가 Supabase 콘솔에서 프로젝트 이름을 직접 입력해 수행한다. CC 는 사전 확인과 증거 제시, 일시정지(pause)와 export 준비까지만 한다.
- 삭제 전에는 반드시 일시정지 후 관찰 기간을 둔다. 일시정지는 되돌릴 수 있고 삭제는 되돌릴 수 없다.

사전 확인(모두 증거를 첨부, 하나라도 실패하면 중단)
1. **식별**: stg 프로젝트 ref 와 prod DB 가 속한 프로젝트·호스트가 **다른 값**임을 두 출처에서 대조한다(GitHub 변수 `STG_PROJECT_REF`, 클러스터 prod Secret 의 접속 문자열에서 프로젝트 식별자). 값 전체를 출력하지 않고 일치/불일치만 보고한다. 같거나 판별 불가면 중단.
2. **조직·이름**: Supabase 에서 해당 프로젝트의 조직, 이름, 생성일을 확인한다(stg 로 만든 무료 org 의 프로젝트여야 함). prod 가 속한 곳이면 중단.
3. **미사용 증명(재배선 이후)**: (a) `insighta-staging` Secret 이 stg 프로젝트를 더는 가리키지 않는다, (b) 저장소의 `STG_PROJECT_REF`, `STG_DIRECT_URL` 참조가 모두 제거되었다, (c) stg 프로젝트의 활성 연결이 일정 기간(예: 7일) 0 이다, (d) B 와 A 가 7일 동안 정상이다(Keel).
4. **보존 확인**: stg 프로젝트의 데이터를 export 로 받아 보관 위치를 기록한다(복원 시험은 하지 않음, 크기와 테이블 수 대조).
5. **롤백 자산**: 삭제 전까지는 일시정지 상태로 두면 재개 가능. 삭제 후에는 export 로 새 프로젝트를 만들 수 있으나 같은 ref 는 복구되지 않음을 James 에게 알린다.

순서: 재배선·B 검증 → 일시정지 → 7일 관찰 → 사전 확인 5개 보고 → James 삭제 → 관련 변수·Secret·워크플로 job·문서 정리.

# 순서

각 단계는 별도 PR 이며 검증 기준을 통과해야 다음으로 간다.

1. **P0 현황 확정(읽기 전용)**: `deploy.yml` 전체, `insighta-staging` Secret 의 키 이름과 가리키는 프로젝트(값 비출력), B 프런트 빌드가 가리키는 인증 프로젝트, 허용 리다이렉트 목록, `RUN_*` 환경 값, job 단위 concurrency 의 승인 대기 동작, `production` Environment 필수 검토자 기능(공개 저장소 확인됨). 결과로 이 문서의 설계를 확정한다.
2. **P1 호환 가드**: 스키마 추가형 검사(컬럼·테이블 삭제, 이름 변경 감지), 큐 작업 데이터 버전 필드. CI 에서 막는 것까지.
3. **P2 B 재배선**: `insighta-staging` 의 DB 접속을 prod DB 로 바꾸고 B 의 worker·스케줄러를 확실히 끈다. 내부 계정 제한. 시험 계정 준비. 이 단계는 prod DB 에 접속하는 구성이므로 시작 전 사전검토 4칸(영향·백업·롤백·판정)을 문서화한다. 롤백: Secret 을 이전 값으로 복원(변경 전 백업 필수).
4. **P3 워크플로**: 스키마·Edge Function 적용 승인 단계, `promote.yml`(게이트 + 승인 + A 배포), stg 마이그레이션·Edge Function job 제거. 한 PR 에 묶는다.
5. **P4 첫 실사용 검증**: 다음 실제 변경 하나를 이 경로로 배포. B → 검증 → 승인 → A → Keel, 이전 핀으로 롤백 연습 한 번.
6. **P5 stg DB 제거**: 위 안전 절차를 순서대로. 정리 대상: `STG_*` 변수·Secret, `migrate-staging`, `deploy-edge-functions-staging`, `stg-clean.yml`, 복제 스크립트와 표 목록, PR #1752 와 `insighta-stg-pipe` 미커밋 변경, `docs/ops/staging.md`, 규칙 R33 문구, 메모리.

# 제약

- 코드·워크플로 변경은 이 작업지시서 승인 후. P2 와 P3 은 prod 에 영향을 주므로 각각 별도 승인.
- **prod DB 는 삭제·초기화·덮어쓰기 대상이 아니다.** P2 의 Secret 교체는 접속 문자열 교체이지 DB 변경이 아니다.
- 다음 주 100명 테스트 기간에는 P2 이후를 배포하지 않는다. P0, P1 은 prod 경로를 건드리지 않는다.
- 시험 데이터 규칙("운영 DB 에 시험 데이터 INSERT 금지")은 시험 계정 한 개와 소유 키 기준 정리에 한해 허용하는 문구로 바꿀 것인지 James 결정 후 적용한다.
- 시크릿 값은 출력하지 않는다. 워크플로 변경은 merge-green(R31) 통과.

# 검증 기준

- [ ] P0: 위 확인 항목 전부를 근거(파일·줄, 명령 결과)와 함께 기록
- [ ] P1: 컬럼 삭제를 포함한 PR 이 CI 에서 실패, 추가형 PR 은 통과
- [ ] P2: B 의 api 로그인·조회 성공, B 에서 큐 작업이 처리되지 않음(작업이 A 의 worker 에서만 소비됨), 내부 계정이 아닌 접근 차단
- [ ] P3: main push 후 prod 이미지 핀·스키마·Edge Function 이 **승인 전에는 변하지 않는다**. promote 는 E2E 실패 sha 에서 게이트로 막힌다
- [ ] P4: 롤백 연습 후 이전 핀에서 Keel 정상
- [ ] P5: 사전 확인 5개 보고서, 삭제 후 저장소에 `STG_PROJECT_REF`·`STG_DIRECT_URL` 참조 0, A 와 B 정상

# 롤백

- 워크플로 PR: revert. 롤백하면 승인 없는 prod 스키마 적용(R33 공백)이 되살아나므로 PR 설명에 적는다.
- P2: 변경 전 Secret 백업으로 복원, B 를 0 으로 축소.
- 이미지: 커밋 해시 핀이라 이전 핀으로 복귀.
- 스키마: 추가형만 허용하는 가드(P1) 이후에는 코드 롤백이 스키마 롤백 없이 가능하다. P1 전에는 스키마 변경 PR 을 James 가 개별 확인한다.
- P5: 삭제 전까지만 가능(일시정지 재개). 삭제 후에는 export 로 새 프로젝트 생성.

# P0 결과 (읽기 전용 실측, 2026-11-03)

클러스터 Secret 은 키 이름과 짧은 해시 비교만 사용했고 값은 출력하지 않았다.

| 항목 | 실측 | 설계에 미치는 영향 |
|---|---|---|
| stg 와 prod 의 DB 대상 | `DATABASE_URL`, `DIRECT_URL` 해시가 서로 다름(`c3ef1b5e` 대 `f4e70e9a`). stg 내부에서 두 값은 같음 | 두 프로젝트가 구분된다. 삭제 사전 확인 1(식별)이 해시 대조로 가능함이 입증됨 |
| 인증 엔드포인트 | `SUPABASE_URL` 호스트 해시도 서로 다름(`c4f56d9a` 대 `e3f96979`). stg 는 자체 인증 프로젝트 | B 가 prod DB 를 쓰려면 `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 5개를 prod 값으로 바꿔야 한다(인증 프로젝트와 DB 는 한 쌍). 나머지 130개 키는 그대로 둔다 |
| stg Secret | `insighta-env` 한 개, 키 135개. `OPENROUTER_API_KEY` 가 있고 메일 발송 키는 없음 | 재배선 시 prod Secret 을 통째로 복사하지 않는다(메일 키가 B 에 생기면 B 에서 실제 메일이 나갈 수 있음). 위 5개만 교체 |
| stg api | `RUN_QUEUE_WORKERS=false`, `RUN_SCHEDULERS=false`, replicas 1 | 목표 구조와 이미 일치 |
| stg worker | replicas 0 이지만 환경값은 `RUN_QUEUE_WORKERS=true`, `RUN_SCHEDULERS=true` | 누군가 1 로 올리면 prod DB 의 큐와 스케줄러를 가져간다. 재배선 시 `worker.enabled: false` 로 아예 만들지 않는다 |
| stg 프런트 이미지 | 별도 빌드(`stg-<sha>`). `VITE_SUPABASE_URL` 에 `vars.STG_SUPABASE_URL`, 키에 `STG_SUPABASE_ANON_KEY` 가 박힘 | 재배선하면 B 는 prod 빌드와 같은 번들(prod 인증 값)을 써야 한다. stg 전용 프런트 빌드 단계를 제거하고 prod 빌드 이미지를 B 에 쓴다. prod 프런트 빌드가 `staging_only` 에서 제외돼 있으므로 P3 에서 조건 정리 |
| B 접근 제한 수단 | 가입 모드(`open`/`invite_only`/`closed`)는 있으나 **서비스 전체 설정이라 B 만 따로 제한할 수 없음** | 인그레스 단계의 제한을 쓴다(아래) |
| 인증 리다이렉트 허용 목록 | 저장소에 없음. prod 인증 프로젝트의 콘솔 설정 | `stg.insighta.one` 등록 여부는 James 확인 필요(콘솔 작업) |

## B 접근 제한 방식 (결정 4 확정)

인그레스 어노테이션으로 `stg.insighta.one` 에 접근 제한을 건다(코드 변경 없음, 추가 비용 없음). 후보는 기본 인증(Secret 한 개)이며, 소스 IP 허용은 James 의 접속 위치가 바뀌므로 제외한다. 가입 모드 설정은 prod 사용자에게도 영향을 주므로 쓰지 않는다.

## B 의 비용 소모

B 의 api 는 `OPENROUTER_API_KEY` 와 YouTube 쿼터를 prod 와 같은 키로 쓰고, 만다라 생성은 api 안에서 인라인으로 돈다(`PIPELINE_DURABLE_ENABLED=false`). 내부 계정만 접근하더라도 B 에서의 시험은 실제 LLM 비용과 쿼터를 쓴다. 시험 횟수를 제한한다. B 의 `OPENROUTER_API_KEY` 를 제거해 LLM 호출을 막는 선택지도 있으나 그러면 만다라 생성을 B 에서 시험할 수 없다(P2 에서 결정).

# 결정 사항 (James 위임, 2026-11-03: "취지에 맞게 알아서 판단/결정")

취지: prod 를 보호하면서 stg(B)에서 실제 데이터로 먼저 검증하고, 추가 비용 없이, 승인 없이는 prod 가 변하지 않게 한다.

| # | 항목 | 결정 | 근거 |
|---|---|---|---|
| 1 | 시험 데이터 규칙 | "운영 DB 에 시험 데이터 INSERT 금지"를 **전용 시험 계정 1개가 만든 행에 한해 허용, 소유 키(`user_id`, `mandala_id`) 기준으로만 정리**로 변경. 규칙 문구 수정(CLAUDE.md)은 P3 PR 에서 하고 그 전에는 시험 쓰기를 하지 않는다 | B 가 같은 DB 라 쓰기 시험이 불가피. 예외를 넓히지 않고 소유 범위로 한정 |
| 2 | 승인 방식 | GitHub Environment 필수 검토자(James) | 공개 저장소라 무료. 승인 기록이 남고 권한으로 통제됨 |
| 3 | 긴급 우회 | 허용. `skip_gate=true` + 필수 `reason`, **James 가 직접 지시했을 때만**, 실행 기록에 남김 | stg 자체 고장으로 prod 수정이 막히는 상황 방지 |
| 4 | B 접근 제한 | 로그인 허용 목록(내부 계정). 방식은 P0 에서 현재 인증 구조를 읽고 확정 | 같은 DB 라 외부 사용자가 B 의 미검증 코드를 쓰면 안 됨 |
| 5 | 100명 테스트 전 범위 | P0, P1 만. P2 이후는 테스트 뒤 | P2 는 prod DB 접속 구성 변경, P3 은 prod 배포 경로 변경 |
| 6 | stg DB | 일시정지 → 7일 관찰 → 사전 확인 5개 보고 → James 가 콘솔에서 삭제 | 삭제 불가역. prod DB 는 대상 아님 |
