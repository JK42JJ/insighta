# PR2 Handoff — Heart rich-summary 동시성 직렬 해소 (CP498)

> 작성: CP498 (2026-06-08). 착수 전 James 검토 → 승인 필요. 코드 우선 — 줄번호·정확한 옵션 위치·현재 값은 **착수 시 코드 재확인 후 확정**(이 문서는 문제·맥락·메커니즘·측정 기준만 고정).

## ▶ 다음 세션 시작 (트리거 — James 확정)
- 트리거 문구: **"핸드오프 승인. PR2 착수해 — plan 재제시(코드 확인 확정값, env 노출 포함)부터"**
- 흐름: CC가 **plan 재제시**(아래 "변경" specifics를 코드 확인해 확정값 + env 노출 여부 포함) → James 검토·승인 → **측정 A(before, 구현 전)** 진입 → 구현 → merge/deploy(각 승인) → 측정 B(after)+429율 → done.
- CC는 plan 작성되면 **즉시 James에게 보여주고** 승인 전 구현 착수 금지.

## 위치
3-PR A단계("점수 백필 + 병렬화 + 정렬") 중 **PR2**. PR1(#864 OpenRouter 429/5xx backoff)은 ship 완료 = 병렬 버스트 안전판. PR2 = Heart 경로 직렬 해소. PR3 = 셀카드 점수 백필(다음).

## 문제
Heart 여러 개 동시 클릭 시 v2 rich-summary 생성이 1개씩 순차 처리 = 매우 느림(James 실측). A단계 점수 백필도 같은 워커 경로라 직렬이면 못 씀.

## 🔑 메커니즘 (측정으로 확정 — 빠지면 "숫자만 올려 no-op" 반복하므로 필수 명시)
- **동시성 설정값(숫자)만 올리는 건 no-op.** 현재 설정값(=10)은 이미 크지만 **죽어 있다.**
- 원인: worker가 `teamSize:1` + `teamRefill` 부재로 등록됨. pg-boss v9는 매 폴링당 `teamSize − in-flight`개만 fetch하고(=최대 1개), 그 1잡이 **완료될 때까지 다음 fetch를 await로 막는다** → 엄격히 직렬. `teamConcurrency`는 fetch된 배치(항상 크기 1)에만 적용돼 무력.
- **발동 조건 = `teamSize:N` + `teamRefill:true`** (teamConcurrency:N과 함께). 이 조합이라야 N잡을 동시 in-flight로 유지.
- **`batchSize`는 부적합** — batchSize는 N잡을 **한 핸들러 콜백에 묶어** 넘기는데, 현 핸들러는 1잡(=1영상) 단위 처리라 호환 안 됨.
- CP475 "5→10" 변경은 `teamSize:1`을 그대로 둬서 **no-op이었음**(주석이 자기 효과 오판 — PR1에서 주석 교정 완료).
- → **착수 시 코드 확인 위임**: worker 등록 지점(enrich-rich-summary worker 등록부)의 실제 work-option 줄 + 현재 N 출처(리터럴/env) 확인 후 `teamSize:N + teamRefill:true` 적용.

## 변경 (코드 확인 확정 — PR2 = 2파일, 동시성 활성화만)
가역성을 config refactor에 안 묶이게 **behavioral change만 격리**:
1. `src/config/index.ts`: envSchema(`MAX_CONCURRENT_SYNCS` 인근)에 `RICH_SUMMARY_CONCURRENCY: z.coerce.number().int().min(1).default(4)` + config 객체(`sync` 섹션 뒤)에 `queue: { richSummaryConcurrency: env.RICH_SUMMARY_CONCURRENCY }`.
2. `src/modules/queue/handlers/enrich-rich-summary.ts:68`: `const n = config.queue.richSummaryConcurrency` → work-option `{ teamConcurrency: n, teamSize: n, teamRefill: true }` (현 `{...RICH_SUMMARY_CONCURRENCY, teamSize:1}` 교체) + 로그 `concurrency:n`.
- **분리 (조정1)**: `QUEUE_CONFIG.RICH_SUMMARY_CONCURRENCY=10` 리터럴(`types.ts:178`, 참조처 worker 2곳뿐)은 PR2 후 미사용(런타임 무영향) → **별도 cleanup PR**에서 제거(+PR1 주석 정리). PR2 diff 미포함.
- N=4 시작, 측정하며 상향. env = `RICH_SUMMARY_CONCURRENCY`(비밀 아님/CP392 2-질문 통과). 롤백 = `RICH_SUMMARY_CONCURRENCY=1`(코드 revert 무) 또는 PR2 revert(2파일).
- 범위 = Heart 워커만 (PR3 백필 큐 별도).

## 안전 / 롤백
- 선행 안전판: PR1 429/5xx backoff 이미 ship(병렬 버스트가 rate limit 쳐도 재시도).
- 롤백 = work-option 1줄 revert (또는 env N=1). behavior-가역.
- Heart 인터랙티브 경로는 `retryLimit:0`(사용자 대기)라 backoff(PR1)가 유일 방어 — N 상향 전 429율 측정 필수(아래).

## 📏 측정 (CP467 의무 — 닫는 기준, **2시점 분리**)
**핵심: `before`는 직렬 baseline이라 구현/배포 前에만 측정 가능 — 배포 후 회상/추정으로 채우면 미충족.**
순서: **측정 A(before) → 구현 → merge+deploy → 측정 B(after) → done.** (텔레메트리부터 확인해 수동 재현 회피.)

**A. 착수 前 (구현 전) — `before` (직렬 현상태) — ✅ 측정 완료 (CP498, pg-boss 텔레메트리):**
- 텔레메트리 존재 확인됨: `pgboss.job`/`archive`에 `createdon/startedon/completedon` (timestamptz) → **수동 재현 불요**.
- **관측 최대 동시성 = 1** (880잡/21d) → 직렬 확정(추론 아님).
- per-job 실측: **p50 49.6s / p95 143.8s** (가정 87s는 stale — 교정).
- **실제 Heart 버스트 span (enqueue→last complete, 직렬 baseline):**
  - 4–5 카드 → **320~490s** (~5–8분)
  - 10 카드 → **830s** (~14분)

**B. 구현 → merge+deploy 後 — `after` (병렬 4) — 미측정:**
- **after 측정**: A와 동일(텔레메트리)로 배포 후 유사 규모 버스트 span. 기대: 4–5 카드 ⌈5/4⌉=2-wave ≈ **160~290s**, 10 카드 ⌈10/4⌉=3-wave ≈ **250~430s** (vs 830s) + 관측 최대 동시성 1→4.
4. **429율**: PR1 backoff 로그(`llm_call_logs` 또는 stdout의 `Retryable <status>; backoff ...` 건수)에서 버스트 중 retryable 발생. **0이면 N 상향 여지** / >0이면 현 N 유지·backoff 여유 확인.

**done 기준 = `before`(배포前) + `after`(배포後) 경과 + 429율 모두 측정값 기록.** 한쪽이라도 추정이면 미충족.
※ `after`는 Heart=prod 경로라 merge+deploy 후 prod에서만 측정 가능 → merge 승인은 `before`+plan 기준, `after`가 done 게이트(CP467).

## 테스트 / 발동 증명 (조정2)
- 정적 assert(`teamRefill:true` 포함 / `config.queue.richSummaryConcurrency` default=4) = **배선 확인용일 뿐 발동 증명 아님**. teamRefill 신규라 "옵션 들어감 ≠ 발동"(CP475 5→10 no-op 전례 — 옵션 존재해도 직렬이었음).
- **done 게이트 = 측정 B(after) 실측** ~520s(직렬)→~174s(병렬4). 구현 시 "assert green = 완료" 착각 금지.
- 기존 enrich/queue 테스트 회귀 green.

## 진행 규율 (per-step, CP494+1)
plan 재제시(코드 확인 후 확정값) → James 승인 → **측정 A(`before`, 구현 前 필수)** → 구현 → **merge 승인** → **deploy 승인** → **측정 B(`after`) + 429율** → health 재확인 → done 선언(before+after+429 기록).
⚠️ **핸드오프 문서는 PR2 브랜치 착수 시 즉시 커밋** (working tree만 두면 손실 — 미루기 금지, CP497 repo-boundary 교훈).

## 의존
- PR1(#864) merged/deployed = 선결 충족.
- PR3(점수 백필)는 PR2의 병렬 워커 위에 얹힘 → PR2 먼저.
