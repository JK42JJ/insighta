# PR-3 INFLOW-GATE — 1단계 현황+분석 (read-only seam map)

> **부모**: `crosscutting-audit-phase2-design.md` §3 (판단 게이트 설계) + §4 PR 사슬(PR-4 INFLOW-GATE = 본 트랙, 재번호 PR-3).
> **이 문서**: 그 게이트 설계의 **사실 지반** — 현 게이트 표면 + chokepoint 수렴 + R4 트랙 + config/canary + 갭 + scope 질문. 사실+옵션(안 고름). plan/처방/측정은 다음 단계.
> **기준**: `origin/main 17b73354` (PR-1 CONFIG-SSOT `13366da8` + PR-2 CHOKEPOINT `17b73354` ship 후). ⚠️ 작업 브랜치 `feat/v2-translations`는 main보다 20커밋 뒤 = stale → 본 감사는 origin/main read-only worktree로 수행(감사 후 제거).
> **방법**: 4 병렬 에이전트(게이트표면/chokepoint/R4/config) + CC printenv·add-cards cross-check. 세션: CP500++ PR-3 1단계, 2026-06-18.

---

## 0. ★핵심 정정 (prod printenv 실측 — phase2 "기둥2 판단 부재" → "판단 비일관")★

phase1/phase2는 **코드 default**를 봤다. 실 process env(`docker exec insighta-api printenv`, 2026-06-18)는 compose-override로 다르다 (CLAUDE.md LEVEL-1 compose `environment:` > env_file):

```
VIDEO_DISCOVER_V3=1   V3_CENTER_GATE_MODE=semantic   V3_SEMANTIC_MIN_COSINE=0.5   V3_ENABLE_QUALITY_GATE=true
V5_PICKER_MODE=cell_binning   V5_QUERY_GEN=llm   V5_POOL_SERVE=true   V5_DIVERSITY_GUARD=true
RELEVANCE_RUBRIC_ENABLED=true   RELEVANCE_BACKFILL_CONCURRENCY=8   (BATCH_GATE_PRUNE unset=off)
```

| 경로 | phase 가정 | **prod 실측** |
|---|---|---|
| v3 (prod-live, 최대볼륨) | "무게이트, title-shorts만" | **❌ 틀림 — semantic 게이트 ON** (cosine≥0.5 + quality gate) |
| v5 add-cards/wizard 후보생성 | LLM-pick 판단 | **judge 없음** — `cell_binning` (YouTube 랭크+셀 배정만) |
| pool-serve 입구 | — | **Haiku rubric 게이트 ON** ≥60 |
| 배치후 backfill | — | **score-only** (relevance_pct 배지), prune OFF = 라이브 캐너리 |

**→ 정정 진단**: 판단이 전무한 게 아니라 **경로마다 종류가 다르고 비일관**. v3=코사인0.5 / pool-serve=Haiku-rubric60 / **v5 add-cards·wizard=judge 없음(cell_binning)** / backfill=점수만. **진짜 갭 = (a) v5 cell_binning 경로의 relevance judge 부재 + (b) 세 판단자(cosine/Haiku/없음) 비일관.** (이미 게이트 있는 v3·pool에 중복 씌우면 비용·지연 낭비 — 측정으로 차단.)

## 1. 현 게이트 표면 매트릭스 (printenv 보정 후)

| 게이트 | v5 executor | v3 executor (prod) | pool-serve-fill | placeAutoAddedCards |
|---|---|---|---|---|
| off-language | ✅ youtube-fanout.ts:685 | ✅ executor.ts:1053 `hasKoreanTitle`(별도 약한 구현) | ✅ :142 `hygienic()` | ❌ |
| shorts(title) | ✅ :678 | ✅ :1040 | ✅ :140 | ❌ |
| shorts(URL probe ≥180) | ✅ step6 :330 | ❌ duration만(≤75s, no probe) :1036 | ✅ :165 (v5 복제) | ❌ |
| blocklist | ✅ :678 | ✅ :1044 | ✅ :139 | ❌ |
| 채널 다양성 | ✅ softCap(flag) :183 | ✅ 하드 MAX_PER_CHANNEL=2 :95 | ✅ :151 | ❌ |
| view floor | ❌(요청레벨 후처리) | ✅ quality-gate ON(prod) | ❌ | ⚠️ opt, auto-add default 0=no-op (place-auto-added-cards.ts:180) |
| **relevance judge** | **❌ cell_binning** | **✅ cosine≥0.5(prod)** | **✅ Haiku rubric≥60** (:196-254) | ❌(점수 copy만 :215) |
| duration cap | min만(shorts) | min만(75s) | min만(180) | ❌ |

**중복/분기**: off-language 2구현(v5 `isOffLanguageTitle` vs v3 `hasKoreanTitle`) / 채널cap 2메커니즘(soft demote vs 하드 drop) / shorts 컷오프 2개(180+probe vs 75 no-probe) / **relevance 3 별도 경로(cosine/Haiku-rubric/없음), 공유 primitive 없음**. 단 title 휴리스틱(`titleIndicatesShorts`/`titleHitsBlocklist`)·`isShortCached` probe·`dedupeSeries`는 단일 소스 공유.

## 2. Chokepoint 수렴 (axis 2/4 — 확정)

- **자동 유입 전부 `placeAutoAddedCards`(place-auto-added-cards.ts:78, 단일 INSERT :226) 수렴 = YES** (CI 가드 `check-card-chokepoint.sh` 강제, auto_added:true는 이 파일에만). wizard(wizard-precompute.ts:459 maybeAutoAdd→188) / pipeline(pipeline-runner.ts:246 maybeAutoAdd→188) / pool-serve(pool-serve-fill.ts:348 직접). **PR-2가 pool-serve 직접 uvs INSERT 우회 제거 확인** (phase1 :363 stale 정정).
- **add-cards = 미경유 (CC cross-check 확정)**: runV5Executor → cards[] FE 반환만(add-cards.ts:365,412) → 유저 Pick → LIKE 라우트(cards.ts:393 raw INSERT) `auto_added=false`(:410, ON CONFLICT :420). **user-action 경로**, 자동 아님.
- 기타 미경유(전부 user-action/non-discovery, auto_added=false): pin(cards.ts:196) / playlist sync(engine.ts:337) / local-cards EF(별 테이블 user_local_cards).
- **단일 게이트 1점 = `placeAutoAddedCards` 직전** → 자동유입 100% 커버. add-cards/pin/sync/manual은 그 1점이 안 봄(설계상 user-action).

## 3. R4/rubric 트랙 (axis 3)

- "R4" 심볼 없음 = `computeCardRelevance`(Haiku claude-haiku-4.5, compute-card-relevance.ts:86) SSOT 스코어러 + 3축 rubric(cell_fit · **goal_contribution**(판별축) · actionability, rich-summary-v2-quick-prompt.ts:109-118). 점수 합성 `composeRubricScore`(relevance-composition.ts:31, cellFit0.4/goalContrib0.4/action0.2, **freshness 의도적 제외** CP500+ 축분리).
- 2 소비자: ① `enrich-relevance-quick`(배치후 score→relevance_pct, R1 prune시 DELETE :106-118 — "system may delete only what it inserted" auto_added=true만) ② `pool-serve-fill`(입구 cut ≥60 :246).
- backfill trigger 3곳(전부 fire-and-forget, applyCutoff:false): pipeline-runner.ts:272 / wizard-precompute.ts:479 / 라우트 mandalas.ts:2774(FE = add-cards 패널 close+pick시만 AddCardsPanel.tsx:429). **ulc도 스코어 대상**(구조 배제 아님, panel-close-with-pick 타이밍 한정 도달).
- **갭**: `config.relevanceBackfill.enabled`(config/index.ts:220) 파싱되나 **어디서도 안 읽힘** → auto 스코어 사실상 ungated always-on, cutoff inert.
- **Layer2 흡수 가능**: 같은 Haiku 스코어러·3축 rubric·`video_mandala_relevance` 캐시(pool-serve-fill.ts:201). **구조 차이(병합 주의)**: 점수 키 = backfill은 row-PK(uvs.id/ulc.id, user-scoped, 누수방지 enrich-relevance-quick.ts:7-12) vs pool-serve 캐시는 video×mandala(non-user). + 입구컷(pre-insert) vs backfill(post-placement). + 입력 비대칭(uvs=title-only, ulc=title+desc, pool=title+desc+duration; transcript 대개 부재).

## 4. config/canary 배선 (axis D)

- flag-read 패턴 = `src/config/*` zod 로더(`loadRelevanceRubricConfig` relevance-rubric.ts:25 / `getV5Config` v5/config.ts:22 memoized / `loadPoolServeConfig` pool-serve.ts:31), safeParse-safe-default, boolean은 `"true"/"1"/"yes"`만 true. 비즈니스 로직에 직접 process.env 읽기 없음. **PR-3도 동일 재사용**(신규 zod 스키마+로더, default OFF).
- **canary 코드 메커니즘 부재** (per-mandala/% rollout 없음). **검증된 운영 선례 = 2단 flag split**: `RELEVANCE_RUBRIC_ENABLED`(score/badge, 무삭제) ON → 관측 → **별도** `BATCH_GATE_PRUNE`(파괴적 컷) 별도 [GO] (relevance-rubric.ts:26-32, compose:250-256 코멘트). + 전역ON+단일 만다라(K8s) 관측.
- on-off 경로(CONFIG-SSOT) = compose `environment:` 1줄 편집(`docker-compose.prod.yml`) → 배포 → `printenv` 검증(deploy.yml:301). CI `config-ssot`(check-config-ssot.sh): (a) .env+compose 이중정의 FAIL (b) compose 블록 내 중복 FAIL. **신규 flag는 compose `environment:` 단일 라인 + .env 미기록**(아니면 CI FAIL).

## 5. 핵심 갭 + scope 결정 (James 확정)

1. **v3 적용범위 = (B)**: v3는 prod 최대볼륨 + **이미 cosine0.5 게이트 보유** → Haiku 추가(A) 안 함(비용·지연 폭발). PR-3는 **judge 없는 v5(cell_binning) 경로만** 침. v3 cosine 충분성은 별도 측정 나중.
2. **add-cards 적용범위 = (B)**: 자동유입만 게이트, **add-cards 제외**. 근거 = add-cards는 유저가 후보 보고 Pick(auto_added=false) = **유저가 판단자** / 위저드는 유저 안 보고 시스템이 채움 = **진짜 타겟**. 통제권 원칙("자동=게이트 / 유저선택=존중"). ※ add-cards 후보 품질(cell_binning) 개선은 별개로 도움되나 **강제 컷은 유저 몫** — plan에서 구분 명시.
3. **게이트 위치**: `placeAutoAddedCards` 직전(자동유입 100%) + Layer1 공유 모듈(off-lang·shorts·channelcap 3중복 → 단일).
4. **캐너리 = RELEVANCE_RUBRIC 2단 split 선례**: score/log-only 먼저(컷 안 함, "컷할 것만 로그") → James 로그 확인(쓰레기만 걸리나) → 별 flag 실제 컷 [GO]. false-cut 로그 선제 차단.
5. **Layer2 = `computeCardRelevance`(Haiku) 흡수** + 캐시키 scope(user-scoped vs video×mandala) plan에서 결정.

## 6. 옵션 (펼침, 안 고름 — 5에서 James 1차 결정분 외 잔여)

- **Layer1 공유 범위**: off-lang·shorts·channelcap 3중복만 단일화 / + v3 `hasKoreanTitle`·하드cap도 공유로 흡수(v3 동작 변경 risk).
- **Layer2 캐시 scope**: video×mandala(재사용·누수 가능) / user-scoped row-PK(누수0·재계산↑) / 하이브리드(video×mandala 캐시 + user 노출 분리).
- **fail-open 경계**: 전 경로 fail-open(공급우선) / pool-first만 fail-closed(CP494+1 lexical 무심판 방지) — phase2 §3 기 명시.

---

## 다음 (plan, James [GO] 후 구현)
Layer1 공유 모듈 + Layer2 chokepoint(placeAutoAddedCards 직전) Haiku judge + fail-open + 컷이유 로그 + 2단 flag(score-only 먼저/컷 별도) + 적용범위 ①(v5만, v3·pool 제외)②(자동유입만, add-cards 제외). **PR-3 Done = James 화면(위저드 쓰레기 컷 + 멀쩡한 건 생존 + 빈섹터 악화 안 됨), 코드 live≠verified.** side-effect = `[GO]`/`[MERGE]` 토큰만.
