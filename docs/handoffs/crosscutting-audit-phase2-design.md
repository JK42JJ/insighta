# 횡단 관심사 정합 감사 — 2단계 정본층 설계 (Claude 전략 종합 / James 결정)

> **부모**: `docs/handoffs/crosscutting-audit-phase1-findings.md` (1단계 read-only seam 지도) + 그 **measurement addendum** (prod ⓜ1~5, ① NULL 폭탄 반증). 본 문서는 그 사실 지반 위의 **2단계 설계** — 정본층 아키텍처 + 불변식 확정 + PR 사슬.
> **결정자**: 진단·설계 = Claude(전략) 종합 / 최종 결정 = James. **판단 게이트 = 하이브리드(Layer1 규칙 + Layer2 LLM), 방식 = 게이트(통과/컷), 출시 = 4 PR 한 덩어리 후(트리아지 staging 없음).**
> **작성**: CP500++ 2단계, 2026-06-16. (CC가 영속화; 설계 결정은 Claude/James.)

---

## 1. 진단 (측정 후 — 두 기둥)

1단계 read-audit + 2단계 측정(ⓜ1~5)이 합쳐져 병이 **두 기둥**으로 분리됨:

- **기둥 1 — 도달/저장 비대칭 (측정 후 = 작음).** ① "ulc.video_id 항상-NULL 폭탄"은 **반증**(prod 157/157, DB 트리거 `trg_set_youtube_video_id`가 채움). ulc placed = 전체의 **1.1%**, 노트 실유실 = **13장**. → 데이터 유실 표면은 실재하나 **소규모**. 단, 1단계가 **DB 트리거 레이어를 누락**한 게 핵심 교훈 — 정합은 app+trigger 양 레이어로 판정.
- **기둥 2 — 판단 부재 (핵심).** 진짜 병 = **카드 유입에 관련도 판단자(judge)가 없음.** 측정이 못박음: 풀-서빙 lexical 매칭이 무관 영상 직행(CP494+1 인시던트), ulc placed 관련도 `0/82`, 게이트가 3표면 복제+우회(pool 직접쓰기·v3 미게이트)+가드 config 분산(diversity/pool ON, view/meta off). → "매칭됨=관련있음" 무근거 등식을 검사하는 단일 판단 지점이 설계에 없음.

**설계 중심 = 기둥 2.** 기둥 1은 같은 정본화로 함께 흡수(NOTE-REACH + CHOKEPOINT). §10-D(구조-강제 부재) = 두 기둥의 공통 뿌리.

---

## 2. 정본 불변식 4개 (전부 "구조 강제"로 승격)

1단계의 "관습/무방비" 불변식을 **구조 강제(type/lint/test/DB-constraint/CI)**로 올린다. memory-only·convention 강제는 1~5th instance 재발이 입증한 실패.

| 불변식 | 문구 | 현 강제 | 목표 강제 (구조) |
|---|---|---|---|
| **INV-CONFIG-SSOT** | 모든 런타임 토글의 활성값은 단일 출처로만 정의된다(검증 = `docker exec printenv`). | ❌ 무방비 (compose 리터럴 > env_file > 코드 default 우선순위 충돌, §10-C BACKFILL 잠복) | 토글 활성 SSOT = compose `environment:` 1곳. deploy.yml의 토글-키 `.env` sed-쓰기 제거(민감정보만 sync). **CI 체크: 동일 토글 키가 .env+compose 양쪽 충돌 정의 시 FAIL.** |
| **INV-CHOKEPOINT-ENFORCED** | v2/메타 필요한 모든 카드 경로는 단일 메타 chokepoint를 **구조적으로** 경유한다(우연 아님). | ⚠️ chokepoint(#917 `ensureYoutubeVideoRow`) 존재하나 reach=enrich한정·우연 | 메타 보장을 단일 길목으로 — 유입이 chokepoint 호출 없이 카드 배치/소비 시 **type/test FAIL**. (트리거 `trg_set_youtube_video_id` 도 seam 일부로 명시.) |
| **INV-INFLOW-GATE** | 모든 자동 유입(live/pool/wizard/v3)은 단일 판단 게이트를 통과한다; 미통과 후보는 카드가 못 된다. | ❌ 무방비 (3표면 복제 + pool 직접 uvs INSERT 우회 + v3 미게이트) | 단일 게이트 함수 경유 강제. **직접 uvs INSERT(pool-serve) 금지 lint/test + 모든 유입이 게이트 경유.** |
| **INV-NOTE-REACH** | 카드 노트의 read/write는 출처 테이블(uvs/ulc) 양쪽에 도달하고, 저장 실패는 사용자에게 surface된다. | ❌ 무방비 (rich-note uvs-only + `.catch(()=>{})` swallow) | rich-note 서비스 source-aware(양 테이블) + swallow 제거(에러 surface) + (필요 시) ulc 노트-JSON 저장 경로. |

> 불변식 최종 문구·강제 코드는 각 PR에서 확정. 본 표 = 승격 방향.

---

## 3. 판단 게이트 설계 (하이브리드, 게이트 방식)

**목표**: 유입 후보를 **통과/컷**으로 심판하는 단일 지점. 두 층.

### Layer 1 — 규칙 (결정적·빠름·항상)
- 항목: off-language drop / shorts(duration<180 + URL probe) / blocklist / 채널·시리즈 다양성 cap / view-count floor / 메타 ingest 보장(CHOKEPOINT 연동).
- 기존 v5 executor·diversity-guard·shorts 게이트를 **단일 모듈로 공유**(3표면 복제 제거). 통과분만 Layer 2로.

### Layer 2 — 판단 (Haiku 배치 LLM)
- **입력**: Layer1 통과 후보 + **셀 맥락(centerGoal + cellGoal) + 메타(제목/설명/채널)** 종합.
- **출력**: 통과/컷 (+ 점수/이유).
- **배치**: 여러 후보를 1콜로(비용·지연 절감). 셀별 발생 니치에 선택 적용 가능.
- **fail-open**: LLM 실패/키부재/타임아웃 = **통과**(공급 우선, 게이트 다운이 서비스 중단 안 되게). 단 pool-first 선점 경로는 fail-closed 옵션 분리(CP494+1 교훈: lexical 무심판 방지).
- **컷 이유 기록**: 왜 컷됐나 telemetry/log (튜닝·감사용).
- **env on-off**: default off → canary(소수 만다라) → fleet. CONFIG-SSOT(PR-1) 위에서 신뢰성 있게 토글.
- **R4 흡수**: 별도 R4 rubric 채점 트랙을 **이 Layer 2로 합침**(중복 제거) → PR-4에 통합.

### 단일 chokepoint (INFLOW-GATE 강제)
- pool-serve(직접 uvs INSERT) · v3 라이브 · add-cards · wizard 4 유입을 **모두 이 게이트 경유**로 수렴. 직접 INSERT 경로 차단.

---

## 4. PR 사슬 (4개, 의존성 순서, 견적 1.5~2주)

| PR | 불변식 | 내용 요지 | 의존성 |
|---|---|---|---|
| **PR-1 CONFIG-SSOT** | INV-CONFIG-SSOT | 토글 활성 SSOT = compose 단일화 + `printenv` 검증 + deploy.yml 토글 sed 제거 + CI 충돌-감지. **후속 게이트 flag가 신뢰성 있게 켜지려면 선결.** | 없음 (FIRST) |
| **PR-2 CHOKEPOINT-ENFORCED** | INV-CHOKEPOINT-ENFORCED | 메타 chokepoint를 모든 유입 단일 경유로 구조 강제 + 트리거 레이어 seam 명시 + 직접쓰기 수렴 준비. | PR-1 (flag 신뢰성) |
| **PR-3 NOTE-REACH** | INV-NOTE-REACH | rich-note 양 테이블 도달 + swallow 제거 + ulc 노트 저장 경로. 실유실 13장 + split-brain 흡수. | 독립 (순서상 3번째, 병렬 가능) |
| **PR-4 INFLOW-GATE** | INV-INFLOW-GATE | 하이브리드 판단 게이트(Layer1 공유 모듈 + Layer2 Haiku 배치, fail-open, 컷이유, env on-off) + **R4 흡수** + 4 유입 단일 chokepoint 수렴. **가장 큼.** | PR-1(config) + PR-2(단일 유입점) |

- **출시**: 4 PR **한 덩어리 후 출시**(James 결정 — 트리아지 staging 없음). 각 PR은 순차 머지되나, 사용자 노출은 전체 완료 후.
- **각 PR Done = James 화면 검증** (코드 live ≠ verified — CLAUDE.md "Done=Prod Verified" 준수).
- **견적**: 1.5~2주.

---

## 5. 거버넌스 (출시 후, 별 트랙)
4 불변식 확정 후 `ARCHITECTURE_INVARIANTS.md`(tracked) + `/check` fitness function(횡단 건드리는 PR = 정본 경유 강제, 직접 접근 차단) + 구조 변경 ADR 의무. **in-repo 강제가 핵심** — memory-only는 망각 보장(1~5th instance 입증).

## 6. 다음 액션
- **PR-1 핸드오프(CONFIG-SSOT) 먼저** — 별도. read-only로 현 토글 전파 경로(deploy.yml / compose / env_file / 코드 default) 전수 확인 → SSOT 단일화 plan 제시 → James 승인 → 구현. 배경+제약+의도+blast (처방·코드·SQL는 plan 단계, 협업 톤).
- side-effect(merge/deploy/DDL/flip) = `[GO]`/`[MERGE]` 명시 토큰만.
