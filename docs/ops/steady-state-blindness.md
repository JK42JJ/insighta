# 정상상태 실패는 감지되지 않는다 — 관측 설계 개선

작성 2026-08-24 · 상태 **설계(승인 대기)** · 계기 `batch-video-collector-run` 4일+ 매일 실패 무감지

## 1. 사건

```
02:0x UTC  watchdog → trend-collector 실행    LLM 25건 · 21초 추출 · 비용 발생   성공
02:10:40   batch-video-collector-run          "Skill not found"                 실패
```

LLM 이 뽑은 키워드를 소비할 다음 단계가 죽어 있다. **매일 값을 치르고 결과를 버린다.**

원인은 `src/modules/queue/handlers/batch-video-collector.ts:18` 이 `@/modules/skills/registry`(레지스트리 객체)를 import 하고
등록을 수행하는 `@/modules/skills/index` 를 거치지 않는 것이다. API 프로세스는 `routes/skills.ts` 가 index 를 import 해서
등록이 일어나지만, **워커에는 라우트가 없어 그 경로가 없다.** 레지스트리는 빈 Map 으로 로드된다.

web/worker 분리가 만든 두 번째 같은 결함이다. 첫 번째는 pg-boss producer 미기동(2026-08-20 수리).

## 2. 진짜 문제는 감지 실패다

감시 장치는 **이미 있었고, 돌았고, 이 실패를 담고 있었다.**

| | 실측 |
|---|---|
| `error-log-check` 존재 | 예 — **비용 사고(2026-07-09) 때문에** 만들어짐 |
| 매일 실행 | 예 — `completed` 7회, 최종 2026-08-23 |
| `OBSERVABILITY_ALERT_EMAIL` | **설정됨** |
| 다이제스트에 `pgboss.job state='failed'` 포함 | 예 — `jobsFailed` + `jobsBy`(job 이름별) |

그런데 며칠간 아무 조치가 없었다. 이유:

```
SPIKE_FRAC = 0.5     // 전일 대비 50% 증가 시 이상으로 플래그
```

**매일 정확히 1건 실패하는 것은 영원히 스파이크가 아니다.** 증가율 0%. 처음 깨진 날 한 번 튀고, 그 뒤로는 배경이 된다.

## 3. 이번 주 결함 8종을 같은 축으로 놓으면

| 결함 | 형태 | 누가 알아챘나 |
|---|---|---|
| 다이얼 무배포경로(6일) | 정상상태 | 사람이 우연히 |
| api enqueue 500(야간) | 정상상태 | 다른 조사 중 |
| publish-tags push 불가 | 정상상태 | 실행해봐서 |
| 차트가 굽지 않은 이미지 지목 | 정상상태 | 동기화 직전 확인 |
| DDL 락이 읽기 차단 | 정상상태 | 실패로 전환된 날 |
| LLM 지출 68% 미귀속 | 정상상태 | 청구서 대조 |
| **batch-video-collector 매일 실패** | **정상상태** | **4일+ 아무도** |
| CI 체크 무한 대기 | **변화** | **즉시** — PR 을 막았으므로 |

**여덟 중 일곱이 정상상태이고, 유일하게 즉시 발각된 것은 사람을 막은 것이다.**

지금 관측은 전부 **변화 감지기**다: 스파이크, 에러 증가, 알람. 정상상태로 굳은 고장은 배경값이 되어 지표를 초록으로 만든다.
비용이 가장 큰 고장이 정확히 이 형태다 — 아무도 못 하게 막지 않으므로 불평하는 사람이 없다.

## 4. 설계

세 층. 각각 독립적으로 적용·롤백 가능.

### L1 — 프로세스 능력 assert (이 계열의 발생을 막는다)

핸들러가 요구하는 능력을 **선언**하고, `startBackgroundWork` 가 등록 전에 검증한다.
없으면 **기동 실패**로 만든다 — 작업마다 런타임 실패가 아니라.

```
handler batch-video-collector  requires: ['skill:batch-video-collector']
handler curation-build         requires: ['skill:curation', 'llm']
                                    ↓
startBackgroundWork: 각 requires 를 확인 → 하나라도 불충족이면 기동 거부
```

근거: web/worker 분리가 두 번 같은 사고를 냈다(pg-boss, skills). 세 번째를 기다리지 않는다.
기동 실패는 정상상태가 될 수 없다 — 파드가 Ready 로 가지 못하므로 즉시 보인다.

### L2 — 정상상태 감지 (변화 감지기의 사각을 덮는다)

`error-log-check` 에 **"연속 무성공" 축**을 추가한다. 스파이크가 아니라 **기대 산출의 부재**를 본다.

```
현재:  어제 실패 N건, 전일 대비 +50% 이상이면 플래그
추가:  이 job 이 최근 K일 연속 성공 0회면 플래그  (K=2)
```

`SPIKE_FRAC` 은 그대로 둔다. 두 감지기는 서로 다른 것을 본다 — 하나는 악화, 하나는 **고착**.

대상은 pg-boss job 만이 아니다. 정기 산출물이 있는 것 전부:
- 스케줄 job 의 연속 실패
- `trend_signals` 최신 행이 K일보다 오래됨
- 다이얼 `version.json` 이 리포와 불일치 (이번 주 6일 사각)
- 프로드 이미지 태그가 `latest` 로 되돌아감

### L3 — 지출 귀속 (비용을 신호로 만든다)

실측: OpenRouter 청구 $0.5206/159건 vs 내부 `llm_call_logs` $0.1652/104건 — **68% 미기록.**

원인은 공용 클라이언트를 우회하는 호출 지점들이다. 귀속 헤더도, 로그도 없다:

```
헤더 O   modules/llm/openrouter.ts · video-discover/llm-query-generator.ts · llm-reranker.ts
헤더 X   trend-collector/sources/llm-extract.ts   ← 이번 낭비의 당사자
헤더 X   curation/topic-judge.ts
헤더 X   web-search/client.ts
헤더 X   api/routes/copilotkit.ts                 ← 사용자 대면 챗봇
헤더 X   api/routes/admin/llm.ts
```

다섯 지점을 **공용 클라이언트로 통일**한다. 귀속과 기록이 한 곳에서 해결되고,
CLAUDE.md `하드코딩 + 단편 조치 금지` 와도 맞는다.

그 위에 **일일 대사(reconciliation)**: 내부 장부 합계 대 OpenRouter 실제 청구.
차이가 임계 이상이면 플래그. 이번 68% 격차는 이 대사 하나로 당일에 보였을 것이다.

## 5. 순서

| 단계 | 내용 | 이유 |
|---|---|---|
| 1 | L1 능력 assert + `batch-video-collector` 등록 수리 | 실제 손실이 매일 진행 중 |
| 2 | L3 호출 지점 통일 | L1 수리 후의 낭비/절감이 관측 가능해짐 |
| 3 | L2 연속-무성공 감지 | 위 둘을 지키는 그물 |
| 4 | L3 일일 대사 | 장부가 완전해진 뒤에만 의미 있음 |

3 을 2 보다 뒤에 두는 이유: 장부가 68% 비어 있는 상태에서 무성공 감지를 붙이면 **없는 것과 기록 안 된 것을 구분하지 못한다.**

## 6. 검증

- L1: 능력 하나를 일부러 제거 → 파드가 Ready 로 가지 못하는지 (negative control)
- L2: 실패를 K일 주입 → 플래그 발화 / K-1일에는 미발화 양방향
- L3: 통일 후 같은 시간창을 재측정해 청구와 장부가 **±5% 안에서 일치**하는지
- 전부 회귀 테스트로 고정. 이 계열은 "고쳤다" 를 사람이 기억하는 방식으로 지킬 수 없다 — 정상상태로 돌아가면 다시 안 보인다.

## 7. 미결

- 임계 K(연속 무성공 일수) = 2 로 제안. 주 1회 job 은 K=2 가 2주이므로 **주기별 K** 가 필요할 수 있다.
- 대사 임계(±%) 는 첫 2주 실측 후 확정.
- 다이제스트 수신 자체가 읽히는지 — 메일이 나갔는데 조치가 없었다면 임계가 아니라 **경로**의 문제일 수 있다. James 확인 필요.
