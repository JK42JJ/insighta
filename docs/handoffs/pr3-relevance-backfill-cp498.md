# PR3 Handoff — A-stage relevance backfill (user-scoped, card-metadata, quick-only) — CP498

> 작성 CP498 (2026-06-08). PR1(#864 429 backoff)·PR2(#865 동시성, prod verified) 완료 위. 착수 전 James 검토. 코드 우선 — 줄·값은 착수 시 재확인.

## ⚠️ PR3b 정정 — DUAL-TABLE (전제 뒤집힌 실측)
- **placed 카드 비중 (실측)**: `user_video_states` **6034** vs `user_local_cards` **77** (uvs가 98.7%). 파이프라인 추천카드=uvs, 수동/D&D=ulc. → PR3a "81% null"은 ulc 77만 본 것 = 모집단 1.3%. **PR3는 반드시 uvs 타겟.**
- **uvs user-scoped 확인**: unique `(user_id, video_id)` → relevance write 누수 0 (ulc와 동일 안전).
- **uvs metadata = youtube_videos JOIN** (`video_id → youtube_videos.id`, FK ON DELETE CASCADE = row 항상 존재, **skip 0**). 실측 채움률 **title 100% / desc 1.1%** → uvs는 **title-only 관련도**(thin). ulc는 자체 title/metadata_description. `compute-card-relevance`(인자 기반)가 둘 다 처리.
- **스코프**: relevance_pct를 uvs(주) + ulc(PR3a 유지, 수동 77) 둘 다. dual-table 백필(rich-summary-trigger 미러). PR3a ulc 컬럼 = 불충분이나 inert·무해 → revert 불필요.
- **title-only (a) 수용** (A단계=정렬, directional이면 충분; transcript 보강은 캡션 전제 위배 비권고).

## 📏 측정해석 게이트 (title-only 판정 — eyeball 금지, measurement B 교훈)
1만다라 admin 백필 측정 항목 = 채움수 / skip(title 없음) / per-job / 동시성 / 429 **+ 아래 2개가 title-only 실제 게이트**:
- **변별력 = 점수 분산**: 1만다라 카드 relevance_pct 분포(min/max/stddev). 다 뭉치면(예 70±5) 정렬 무의미 = title-only 부족.
- **순서정합 = 고정표본**: 명백히 관련높은 3 + 빗나간 3을 **사전 지정**, 점수가 그 순서대로 나오나(전체 인상 아님).
- **done 해석**: 분산 있음 + 고정표본 순서 맞음 → title-only 충분, 진행. 아니면 → 보강 재고(transcript 아니라 **uvs desc가 왜 1.1%만 찼나**부터 — 별도 질문).

## 왜 (measurement B 결론)
A단계 "전체 카드 관련도 정렬"의 진짜 선결조건 = **점수 부재**(셀 배치 카드 81% relevance 없음, 배치는 v2 미트리거). measurement B(PR2 동시성 live)에서 Heart 경로(quick+Sonnet full 결합)는 concurrency 4 떠도 Sonnet 100-257s contention으로 체감 느림 → A단계는 **quick Haiku만(~1-3s)** 필요. + 누수 위험(아래).

## 🔒 데이터 격리 (PR3 핵심 제약)
- `video_rich_summaries.mandala_relevance_pct` = **PK video_id 단독** + `GET /v2-summaries`(cards.ts:931) user 필터 없음 → 그 컬럼에 백필하면 **유저 간 점수 누수**(A 점수가 B 카드에 보임). cards.ts:878-882 주석이 명시.
- → **PR3는 그 컬럼 안 씀.** `user_local_cards`(user+mandala+video+cell 키)에 relevance 컬럼 추가 = user-scoped, 누수 구조적 0.
- `user_local_cards`는 `title`/`metadata_title`/`metadata_description` 자체 저장(schema:679/683/684) → **youtube_videos 의존 제거** (placed 카드 56/59가 youtube_videos에 없는 갭 해소) + transcript-optional(title+desc fallback, CP498 전제).

## sub-PR (의존 순서 = 위험 격리)
- **PR3a (토대, 무해·가역)**: schema 컬럼 2개(nullable) + 마이그레이션 raw SQL + `compute-card-relevance.ts`(순수 함수, DB write 0·youtube_videos 안 읽음·Sonnet 미탑승) + smoke. 아무도 안 부름 → 동작 변화 0.
- **PR3b (동작·측정·flag)**: quick 큐(ENRICH_RELEVANCE_QUICK) + 워커(카드 read→compute→user_local_cards write) + 백필 엔트리포인트(mandala_id→null-relevance 셀카드→fan-out, created_at>cutoff+admin, flag BACKFILL_RELEVANCE_ENABLED off) + config env(RELEVANCE_BACKFILL_CONCURRENCY=4) + deploy.yml B-path 배선 + work-option richSummaryWorkOptions(N) 재사용. 1만다라 측정.
- **PR3c (정렬)**: BE cards 응답 += relevance_pct + FE "관련도순"(명시, ORDER BY relevance_pct DESC NULLS LAST). user_local_cards 읽음(글로벌 ❌).

## 백로그
- quick 큐(N)+Heart 큐(4)=t3.medium 동시 8 → measurement B CPU 천장 재현 가능 → N=RELEVANCE_BACKFILL_CONCURRENCY env 조정(시작 4, 경합 시 낮춤) + instance 부하 모니터.
- /v2-summaries Heart 배지 좁은 누수 = user-aware 필터 별도 fix.
- null-metadata 카드(title+desc 둘 다 null) = skip + 카운트 로깅.

## 측정 (CP467, PR3b)
1만다라 백필 → 채워진 카드 수 / skip(null-metadata) 수 / per-job(quick ~1-3s) / 동시성 / 429.

## ⚠️ 마이그레이션 force-track 컨벤션 (PR3b도 적용 — 안 막히게)
- `.gitignore:29 prisma/migrations/*`가 **신규 untracked DDL 파일을 ignore**한다. 단 기존 feature DDL(add-cards/billing/rich-summary-v2/...)은 전부 tracked = **수동 DDL은 force-track이 컨벤션** (ignore는 prisma auto-gen 폴더용; tracked 파일은 gitignore 면제).
- CLAUDE.md silent-fail 규칙이 raw DDL의 repo 추적을 요구 → 신규 DDL은 **`git add -f <단일 파일>`** (폴더/와일드카드 `-f` 금지 — phase4 등 untracked 빨려들 위험).
- PR3a 적용: `git add -f prisma/migrations/relevance-backfill/001_add_relevance.sql`. PR3b 마이그레이션도 동일.

## 진행 규율 (per-step)
각 sub-PR: plan→승인→측정 A(필요시)→구현→/verify→diff→merge 승인→deploy 승인. 핸드오프는 PR3a 브랜치 착수 시 즉시 커밋.
