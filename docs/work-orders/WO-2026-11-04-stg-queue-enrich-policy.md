---
id: WO-2026-11-04-stg-queue-enrich-policy
status: done
owner: insighta-session
opened: 2026-11-04
---

# 목표

stg(`stg.insighta.one`)에서 (1) 쌓인 큐 작업 764건을 실행하지 않고, (2) 새 만다라는 후속 작업(셀 채우기, 실행 항목, 관련도 판정)이 자동으로 완료되며, (3) 영상 요약은 사용자가 카드를 직접 클릭했을 때만 만들어지게 한다. 이 정책은 **stg 에만** 적용하고 prod 의 동작은 바뀌지 않는다.

# 결정 (James, 2026-11-04)

- 쌓인 큐 작업은 재처리하지 않는다.
- 요약은 카드를 직접 선택해 클릭할 때만 한다(stg 한정).
- 이 시점 이후 새 만다라 생성은 자동으로 완결되어야 한다.
- 정책 B 로 시작한다: 전 카드 관련도 판정은 자동, 요약은 클릭 때만. 적합도 기반 자동 요약(정책 A)은 보류.

# 맥락 (2026-11-04 실측)

1. 가장 최근 stg 만다라(`38efdcbb`)는 카드 55장이 DB 에 있으나 셀 5~7 이 비어 있다. 셀 채우기 작업(`pool-serve-fill`)이 큐에 들어갔지만 처리되지 않았다.
2. stg 에는 worker 가 없다(`worker.replicaCount: 0`). pg-boss 에 **764건이 `created` 상태로 쌓여 있다**(가장 오래된 것 2026-10-29): `enrich-relevance-quick` 585, `enrich-video` 160, `pool-serve-fill` 9, `mandala-actions-fill` 5, `enrich-rich-summary` 4, `translate-mandala-bulk` 1.
3. 워커 등록은 전부 아니면 전무다(`initJobQueue` 가 `registerWorkers` 로 19개 이상을 한꺼번에 등록). 큐별 선택 설정은 없다. 따라서 "요약 큐만 제외"는 worker 에서 할 수 없고, **작업이 큐에 들어가는 원인을 막아야 한다**.
4. 만다라 생성 직후의 자동 요약은 `POST /mandalas/:id/rich-summary-trigger` → `enqueueRichSummaryForMandalaCards` 가 카드마다 `enrich-video` 를 넣는 경로다. 이 경로는 이미 설정 `V2_AUTO_ENRICH_ENABLED`(`src/config/v2-auto-enrich.ts`)로 끌 수 있다. 기본값은 true 이고 `false`/`0`/`no` 일 때만 멈춘다(2026-07-12 시험 기간에 사용된 이력이 있음). 이 설정은 위저드 생성의 요약 연쇄와 노트 자동 생성(trigger-level book fill)을 함께 멈춘다. 판정 증거: 2026-07-12 시험에서 `enrich_jobs=0`.
5. stg Secret(`insighta-env`)의 `V2_AUTO_ENRICH_ENABLED` 값은 현재 `true` 다(prod 와 같음). `RICH_SUMMARY_V2_CRON_ENABLED=false`.
6. 클릭 경로: `POST /cards/:videoId/enrich-bg`(및 하트 `like`)가 `enrich-rich-summary` 를 큐에 넣는다. 이 작업을 처리할 worker 가 있어야 클릭 요약이 동작한다.
7. worker 템플릿은 `RUN_QUEUE_WORKERS=true`, `RUN_SCHEDULERS=true` 를 값 없이 고정한다. worker 가 켜지면 스케줄러(정기 `batch-scan` 이 `enrich-video` 를 계속 넣음 등)도 같이 켜져 자동 요약이 다시 생긴다.
8. 비용(prod `llm_call_logs` 30일 실측): 관련도 판정 호출당 $0.00288(haiku-4.5), 만다라당 평균 44장 ⇒ 만다라당 약 $0.13. 요약 v2 빠른 경로 호출당 $0.00595. `summary_v2_full` 은 25건 중 18건 실패(평균 66초).
9. stg 리소스: `resourceQuota` 요청 메모리 384Mi, 한도 960Mi. 현재 요청 합계 api 192 + frontend 16 + redis 16 = 224Mi. worker 128Mi 를 더하면 352Mi ≤ 384Mi, 한도 합계 928Mi ≤ 960Mi 로 들어간다.

# 설계

## 1. 쌓인 764건 취소 (stg DB 한정, 먼저)

- 대상 확인: 실행 전에 접속 대상이 stg 프로젝트임을 확인한다(`migrate-staging` 의 "Assert the target is staging" 가드와 같은 방식, prod 식별자와 다름을 해시로 대조).
- 보관: 취소 대상 행을 파일로 내보낸다(`pgboss.job` 의 `created`/`retry` 행 전체).
- 취소: 상태를 `cancelled` 로 바꾼다(삭제하지 않음).
- 순서가 중요하다: **worker 를 올리기 전에** 한다. 그렇지 않으면 worker 가 764건을 가져가 LLM 호출이 발생한다.
- 롤백: 보관 파일로 `created` 로 복원(복원하면 worker 가 실행하므로 의도적일 때만).

## 2. 차트 설정 (코드 변경 없음, 기본값은 현재 동작)

- `worker.runSchedulers`(기본 `true`) 값을 추가해 템플릿의 `RUN_SCHEDULERS` 를 값으로 받는다.
- `api.extraEnv`, `worker.extraEnv`(기본 빈 목록)을 추가한다. 명시 `env` 는 `envFrom` 의 Secret 값을 덮어쓴다.
- `environments/staging.yaml`:
  - `worker.replicaCount: 1`
  - `worker.runSchedulers: false` (정기 작업 없음)
  - `api.extraEnv`, `worker.extraEnv` 에 `V2_AUTO_ENRICH_ENABLED=false`
- prod 렌더링 결과는 변하지 않아야 한다(`helm template` 차이 0 으로 증명).
- 설정은 Secret 이 아니라 차트 값으로 둔다(민감정보가 아님).

## 3. 정책 결과

| 항목 | stg 동작 |
|---|---|
| 셀 채우기(`pool-serve-fill`), 실행 항목(`mandala-actions-fill`) | worker 가 자동 처리 |
| 관련도 판정(`enrich-relevance-quick`) | 자동(카드당 haiku-4.5) |
| 영상 요약(`enrich-video`), 노트 자동 생성 | 만다라 생성 시 자동으로는 안 함 |
| 카드 클릭 요약(`enrich-rich-summary`) | 클릭 시 worker 가 처리 |
| 정기 작업(스케줄러) | 없음 |

노트 자동 생성도 함께 멈춘다는 점은 `V2_AUTO_ENRICH_ENABLED` 의 기존 의미 그대로이며, stg 에서 노트는 요약이 만들어진 뒤에 수동 경로로 확인한다.

## 4. 이후 B 를 prod DB 로 옮길 때

stg worker 는 임시다. WO-2026-11-03-stg-to-prod-promotion 의 P2 에서 B 가 prod DB 를 쓰게 되면 worker 와 스케줄러는 끄고(`worker.replicaCount: 0`) A 의 worker 가 처리한다. 이 오더의 설정 값은 그때 되돌리기 쉬운 형태다.

# 제약

- 코드 변경은 이 작업지시서 승인 후. stg 를 대상으로 하는 데이터 변경(1번)도 승인 후.
- 이 오더에서 prod 는 변하지 않는다. prod 렌더링 불변 증거 없이는 머지하지 않는다.
- 관련도 판정은 OpenRouter(haiku-4.5)를 호출한다. stg Secret 의 `OPENROUTER_API_KEY` 가 prod 와 같은 키인지는 확인하지 않았다(P0 에서 해시 비교로 확인). 새 만다라 시험 1건당 약 $0.13.
- 적합도 기반 자동 요약(정책 A)은 `summary_v2_full` 실패율(72%) 원인을 확인한 뒤 별도 오더.

# 순서

1. **P0**: 위 7, 9번 가정 확인. `OPENROUTER_API_KEY` 가 prod 와 같은지(해시), 현재 stg 큐 상태 재측정, 클릭 경로가 worker 부재 시 실패하는 방식 확인.
2. **P1 차트 PR**: 2번 설정 추가, staging 값 적용(worker 는 아직 `replicaCount: 0` 로 머지). prod `helm template` 차이 0, Chart Verify 통과.
3. **P2 큐 취소**: 1번 절차를 stg DB 에 실행(대상 확인, 보관, 취소, 잔여 `created` 0 확인).
4. **P3 worker 가동**: `worker.replicaCount: 1` PR. 가동 전 큐에 `created` 가 0건인지 재확인.
5. **P4 검증**: 새 만다라 1개 생성(James). 셀 0~7 모두 채워짐, 새 `enrich-video` 0건, 관련도 값이 채워짐, 카드 클릭 시 요약 생성, 정기 작업 없음, worker 메모리 사용량.

# 검증 기준

- [ ] P1: prod 렌더링 diff 0, stg 렌더링에서 worker env 와 `V2_AUTO_ENRICH_ENABLED=false` 확인
- [ ] P2: `pgboss.job` 의 `created`/`retry` 0건, 보관 파일 행 수 = 취소 행 수(764)
- [ ] P3: worker 파드 Running, 가동 직후 처리된 작업 0건(취소된 것은 실행되지 않음)
- [ ] P4: 새 만다라 8셀 모두 카드 있음, 새 만다라 관련 `enrich-video` 0건, 클릭한 카드의 요약 행 생성

# 롤백

- 차트 PR revert. worker 는 `replicaCount: 0`.
- 큐 취소: 보관 파일에서 상태 복원(실행을 원하는 경우에만).
- 설정 되돌림: `extraEnv` 제거로 Secret 의 기존 값(`true`)으로 돌아간다.

# 의사결정 필요

1. 노트 자동 생성도 stg 에서 멈추는 것(위 3번 표)에 동의하는지.
2. 정책 B 의 관련도 판정 비용(만다라당 약 $0.13)을 stg 에서 허용하는지.

# 실행 결과 (2026-11-04)

James 승인("ok") 후 아래 순서로 실행했다. 설계와 다르게 한 점은 표시한다.

| 단계 | 실행 | 결과 |
|---|---|---|
| 1 | stg Secret 의 `V2_AUTO_ENRICH_ENABLED` 를 `false` 로 | **설계와 다름**: 차트 `extraEnv` 가 아니라 stg Secret 빌더(`build-stg-secret.py`)의 강제 false 목록에 추가(PR #1763). stg 플래그는 원래 이 빌더가 관리하므로 차트 값을 늘리지 않았다. 적용 후 stg api 재시작, `/health` 200, 노드 가용 메모리 346MB |
| 2 | 큐 취소 | 대상이 stg 프로젝트임을 확인(URL 이 stg ref 를 포함, prod ref 를 포함하지 않음) → 705건 보관(`~/insighta-backups/stg-queue-2026-11-04/cancelled-jobs.csv`, 705행) → 행 수가 705 가 아니면 예외로 되돌리는 블록으로 취소. 남은 61건: 관련도 55, 셀 채우기 3, 클릭 요약 2, 실행 항목 1. 첫 시도는 psql 문법 오류로 중단되어 롤백됐고 큐는 변하지 않았다 |
| 3 | worker 가동 | PR #1764(`worker.runSchedulers` 값 추가, stg worker 1, 스케줄러 off). prod 렌더링 diff 0, stg 는 의도한 2줄만 변경 |

검증
- worker 메모리 93Mi, 노드 가용 메모리 360MB → 243MB.
- 관련도 55건, 셀 채우기 3건, 클릭 요약 3건 완료. 새 `enrich-video` 0건(취소된 55건은 `cancelled` 유지). 스케줄러 skipped 로그 확인.
- 아직 James 의 화면 확인(클릭한 카드의 요약 표시)은 받지 못했다.

계획과 다르게 확인된 것
- 상세 요약(v2 full)이 stg 에서도 실패한다: `OpenRouter returned empty content (reasoning-only response detected)` 후 `v2 marked low`. prod 30일 실측 25건 중 18건 실패와 같은 증상이며 빠른 요약은 성공한다. 원인은 미확인이고 별도 작업(본작업 정리 후 원인 파악)으로 다룬다.
- worker 를 켜면 pg-boss 등록형 작업(`error-log-check` 일 1회, `collapse-watch` 15분 주기)이 stg 에서도 등록된다. `RUN_SCHEDULERS=false` 의 영향을 받지 않는다. 알림 수신처(Slack, 메일)는 stg Secret 에서 제외되어 있다.
