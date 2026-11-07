# 상시 에이전트 루프 — 현황 조사 (current-state)

- 작성: 2026-11-04 / PRD v1.0 §0 단계 1
- 근거 범위: `origin/main` @ `19b83735` 를 읽은 결과 + 읽기 전용 `gh` 호출 + 메모리 디렉터리. **라이브 DB·클러스터는 조회하지 않았다.** 숫자 중 메모리에서 온 것은 "(메모리, 날짜)"로 표시한다.
- 표기: 파일 경로가 붙은 것은 코드에서 읽은 사실. "추측"은 읽지 않고 추론한 것. "미검증"은 보고는 받았으나 직접 열어보지 못한 것.

---

## 1. 스택

| 항목 | 값 | 근거 |
|---|---|---|
| Node | 20.x | `package.json:157`, CI `node-version: 20`, Dockerfile `node:20-alpine` |
| BE | Fastify ^5.12, Prisma ^5.7, TypeScript ^5.3, tsx, Jest ^29 + ts-jest | `package.json` |
| FE | React 18, Vite ^6.4, Vitest 3.2, Playwright ^1.58, Tailwind 3 | `frontend/package.json` |
| 검사 스크립트 | `test`(jest) · `lint` · `typecheck` · `build` · FE `test`(vitest run) | 각 `package.json` |
| 훅 | Husky + lint-staged. 커밋·PR 제목은 영어(`commit-msg`, `pr-body-english`) | R29 |

## 2. CI / 배포

- 워크플로: `ci`, `deploy`, `rollback`, `e2e`, `e2e-staging`, `terraform`, `keel`, `backup`, `restore-drill`, `db-integrity-check`, `pool-maintenance`, `brief-harvest`, `dataset-pipeline`, `hardcode-audit-weekly`, `stale-pr-triage`, `notify-runbook`. LLM 비용이 나던 `trend-collector`·`batch-video-collector`(+watchdog)는 disabled (메모리, 2026-09-10). **`promote.yml` 없음.**
- `ci.yml`: 트리거 = main 대상 PR + `workflow_call`. 잡: Lint, Type Check, Test Frontend, Chart Verify, Hardcode Audit, Config SSOT, SQL Allowlist, PR Body English, **Definition of Done**(`ci.yml:198`), Card Chokepoint, Test Backend & Build API, Build Frontend & Accessibility.
- **main 필수 체크 8개**(라이브 보호 API, strict): Lint, Type Check, Test Frontend, Hardcode Audit, Config SSOT, Card Chokepoint, Test Backend & Build API, Build Frontend & Accessibility. Definition of Done · Chart Verify · SQL Allowlist · PR Body English 는 **필수 아님**.
- 브랜치 보호의 나머지: force-push·삭제 차단, **PR 리뷰 필수 없음**, **`enforce_admins=false`**(관리자 우회 가능), 룰셋 없음, **CODEOWNERS 없음**.
- **prod 배포는 이미 GitOps** (`deploy.yml`): main 푸시 → 이미지 빌드·ECR 푸시(OIDC) → `publish-tags` 가 `charts/insighta/environments/prod.yaml` 의 태그를 바꾸는 봇 PR(`images/<sha12>`) 생성 → 사람이 머지 → Argo CD `insighta-prod` 동기화. 러너는 Argo CD에 접근하지 않는다.
- **주의 — main 머지 즉시 승인 없이 실행되는 것** (`deploy.yml`): `migrate`(prod DB 스키마 동기화), `deploy-edge-functions`(prod). 즉 "머지 = prod DB 마이그레이션".
- `terraform.yml`: `terraform/**` 변경 시 main 푸시에서 apply. `production` 환경에 검토자 없음 → 머지 = apply.
- 스테이징 경로: main 머지 후에만 `deploy/staging` 브랜치 재작성 → `smoke-staging` → `e2e-staging`(Playwright, `stg.insighta.one`). **E2E 결과가 prod를 막지 않는다.** PR 브랜치는 스테이징에 배포 불가(모든 stg 잡이 `refs/heads/main` 게이트).
- `rollback.yml`: `workflow_dispatch(sha|previous, reason)` → `prod.yaml` 태그 되돌리는 PR → Argo CD. 에이전트가 호출 가능한 롤백 워크플로로 재사용할 수 있다.
- **PR 미리보기 네임스페이스 없음.**

## 3. k8s / 환경

- 차트 1개 `charts/insighta/`, 값 파일 `dev`·`prod`·`staging`·`staging-images`·`validation`. Argo CD 앱: `insighta-dev/validation/prod`(`charts/bootstrap/applications.yaml`), `insighta-staging`(`staging-app.yaml`, `targetRevision: deploy/staging`).
- **노드 1대**(k3s, t3.medium). 가용 메모리 약 240~340MB, 스왑 0 (메모리 2026-11-04). 스테이징 ResourceQuota: requests 384Mi / limits 960Mi.
- 추가 비용 금지(2026-10-29), 노드 증설·상시 비용은 **Slack 승인 요청 후 James 승인**(2026-11-03). **Slack 웹훅·앱은 아직 없다.**
- `docs/ops/staging.md` 는 `origin/main` 에 **없다**(CLAUDE.md 는 정본이라 부른다) — 미병합 브랜치/작업트리에만 있을 수 있음.
- **진행 중 변경**: `docs/work-orders/WO-2026-11-03-stg-to-prod-promotion.md`(draft) — stg→prod 두 단계, **DB 한 벌 공유**, additive-only 스키마 가드, 수동 `promote`(Environment 승인). 확정 전.

## 4. 거버넌스 (GitHub)

- repo `JK42JJ/insighta`: **PUBLIC**, 개인 계정 소유. 플랜은 API 에서 `null` — 알 수 없음.
- Environments: `Production` 1개, 보호 규칙 없음.
- GitHub App 설치: 읽지 못함(401). 알려진 커스텀 App/봇 없음. 있는 것: Dependabot, `stale-pr-triage`, OIDC 역할 `insighta-github-actions`.
- Actions 시크릿(이름만): AWS_ROLE_ARN, DATABASE_URL, DIRECT_URL, SUPABASE_*, OPENROUTER_API_KEY, COHERE_API_KEY, ELEVENLABS_API_KEY, RUNPOD_API_KEY, SLACK_ALERT_WEBHOOK(이름은 있으나 실제 웹훅 부재 — 메모리), STG_* 등 다수. `EC2_*` 는 미사용으로 추측.
- AWS: admin IAM 사용자 MFA 없음, 정적 키 1개(2026-03), SNS 알람은 `support@` (메모리 2026-09-11).

## 5. 이미 있는 하네스 (PRD 개념과 겹치는 것)

| PRD 개념 | 이미 있는 것 | 경로 | 격차 |
|---|---|---|---|
| tasks/T-xxxx.json, backlog | 작업 오더 `WO-YYYY-MM-DD-slug.md` 19건, 질문 큐 `QUESTIONS.md`, 템플릿 | `docs/work-orders/` | Markdown. id·예산·재시도·metric 필드 없음. `draft→open` 은 James 수동 |
| 오더 조회 | `work-orders.sh` | `scripts/ops/` | 터미널 출력만 |
| 일일 스크럼 | `digest.sh` (저녁, 머지/오픈 PR/오더/질문) | `scripts/ops/` | 터미널 전용·스케줄러 없음·전달 채널 없음 |
| ci/guard | `done-gate`, `pr-body-english`, `hardcode-audit`(감소 방향 래칫), Card Chokepoint | `ci.yml`, `scripts/audit/` | 테스트 삭제/skip/단언 감소 탐지 없음, 금지 경로 탐지 없음 |
| 머지 판정 | `merge-green.sh <pr> [--check]` (R31) | `scripts/ops/` | 지표 판정 없음 |
| PR 4칸 | Work order / Changed / Verified / Not verified / Spec / Decision needed | `.github/PULL_REQUEST_TEMPLATE.md` | — |
| watcher | **Keel**: 15분 클러스터 CronJob + 일일 `keel.yml`, 결과는 `error_events(subsystem='keel')`, Grafana `/keel/` | `scripts/keel/`, `src/modules/keel/`, `charts/insighta/templates/keel-*` | 검사 수 8 vs 12 미검증. **알림 전달 실패(Slack 부재)** |
| 규칙 저장소 | `rules-ledger.md` R01~R31(+R32/R33 언급, 미검증) — 규칙·집행수단·사고·상태, 주간 가지치기 | `docs/ops/rules-ledger.md` | program.md 를 따로 만들면 규칙 저장소가 둘이 됨 |
| 자기 측정 | `harness-audit.sh`(LLM·네트워크 없음), `/retro`, `/save` D1–D5, `/harness-review` | `scripts/audit/`, `.claude/commands/` | keep/discard 실험 원장 없음 |
| 훅 | PreToolUse(Bash): email-send-guard, verify-gate, ssh-ec2-guard, git-rm-guard, git-destructive-snapshot, memory-guard | **`.claude/settings.local.json`** | `.claude/` 는 `origin/main` 에 **추적되지 않음** → 원격 러너에는 없다 |
| 롤백 | `rollback.yml` | `.github/workflows/` | — |

## 6. 추천·거르기·수집 로직

- **추천**: `src/skills/plugins/video-discover/` (v2 keyword-builder/cell-assigner, v3 executor/mandala-filter/hybrid-rerank/quality-gate, v5 executor/llm-query-gen/youtube-fanout). 보조: `src/modules/rerank/cohere-client.ts`, `src/modules/mandala/auto-add-recommendations.ts`(캐시→`user_video_states`), pool-serve(`src/config/pool-serve.ts`, `pool-serve-fill.ts`).
- 진입점: `GET /api/v1/mandalas/:id/recommendations`(`src/api/routes/mandalas.ts` ~L1962, 캐시 읽기), `/videos/stream`(SSE), `add-cards.ts`. FE: `frontend/src/features/recommendation-feed/`.
- **알고리즘 버전/실험 장치**: `search_algorithm_versions` 카탈로그 + 만다라별 override + 전역 active (`src/modules/search/algorithm-resolver.ts`, 어드민 CRUD `routes/admin/search-algorithms.ts`). `config_change_events.experiment` 컬럼. **사용자 단위 고정 배정 없음. 최신순/무작위 기준선 모드 없음. `recommendation_source` 필드 없음.**
- **카드 거르기**: `AUTO_ADD_MIN_VIEW_COUNT`(기본 0=꺼짐, `src/config/recommendations.ts`), domain-fit(`src/config/domain-fit-shadow.ts`, `src/modules/domain-fit-shadow/`, 로컬 Ollama 이진 분류기 T3), `v3/quality-gate.ts`, T11 inflow judge, `JUDGE_DEBOOST`(deboost 카드 `relevance_pct=2`), pool-serve 하한 `V5_POOL_SERVE_RELEVANCE_MIN=60`.
- **거르기 오탐/미탐 측정은 오프라인 문서뿐**: `docs/qa/domain-fit-*.md`(gold 라벨 108쌍 시뮬, 수치 미검증). 온라인 FP/FN·사람 라벨 세트(카드 관련도)는 repo에 없음.
- **수집**: trend-collector, batch-video-collector(`video_pool*`, `video_pool_collection_runs`), 보강 스케줄러 30분 주기 배치 3개(`src/modules/enrichment/scheduler.ts`), pg-boss 잡 목록 `src/modules/queue/types.ts`. 자막은 맥미니 수집기(코드는 repo 밖으로 추측). "수집 성공률" 카운터는 `video_pool_collection_runs` 로 추측(컬럼 미확인).

## 7. 데이터 계층 / 이벤트

- `user_video_states`(`watch_position_seconds`, `is_watched`, `auto_added`, `surfaced_at`, `relevance_*`), `user_local_cards`(`auto_added`·`source` 없음), `recommendation_cache`(`rec_score`, `weight_version`, `keyword`, `rec_reason`, TTL, `surfaced_at`).
- **`recommendation_feedback`** 테이블(impression/click/watch_30s/add/memo/dismiss 설계)은 있으나 `src/` 에서 쓰는 코드 0건(grep, 추측 근거).
- **`card_interactions`**: `like/archive/delete/surfaced` 기록, `(user,video,signal)` 유니크 → **첫 1회만**. `watch_complete`·`skip` 은 예약만.
- `watch_sessions`(시청 구간), `mandala_activity_log`, `llm_call_logs`(비용만), `search_trace(+candidate)`, `search_metrics_daily`, `video_discover_traces`.
- FE PostHog(`frontend/src/shared/lib/posthog.ts`): 키 없으면 no-op. `trackRecommendationFeedback` 호출처는 미확인. Sentry·Amplitude·OTel 없음.
- 평가 장치: `src/modules/eval-harness/{golden-cohort,run-harness}.ts`(고정 만다라 10개, `cacheOnly=true` 시 LLM 호출 없음), `routes/admin/eval-harness.ts`. 설계 SSOT `docs/handoffs/insighta-observability-eval-system-design.md`.
- **"M1–M9 타이밍 핀" 은 찾지 못했다.** `[TIMING]` 로그(`src/modules/mandala/generator.ts`)와 `pipeline_events` 의 M1/M3(CP437 품질 지표 — 다른 의미)만 있음.
- **추천 출처 보존 문제**: 추천 카드가 `user_video_states` 로 들어간 뒤 사용자가 만지면 `auto_added=false` 로 덮여 "원래 추천이었음"이 사라진다. 캐시는 TTL 로 삭제된다.
- RLS: ~10개 마이그레이션에만(`prisma/migrations/<feature>/`). 핵심 테이블에는 없는 것으로 보임(추측). BE 는 Prisma 직결(RLS 우회, 추측). `service_role` 은 스토리지·일부 Edge Function.
- 마이그레이션 관례: `prisma/migrations/<feature>/NNN_*.sql` raw SQL + CLAUDE.md "prisma db push silent fail" 절차. 로컬→prod 순서.

## 8. 사용자 규모

- 2026-09-11 측정 (메모리): `auth.users` 21명, 만다라 작성자 16명, **최근 30일 로그인 1명**, 만다라 2,279개 중 2,001개가 운영자 계정. 브리프 구독자 2명, 열람 0. 이후 "100명 테스트" 계획 중.
- 결론: **지금 A/B 로 통계적 결론을 낼 수 없다.** PRD 리스크 표의 우려가 사실이다.

## 9. 비용·LLM 규칙 (PRD 가 부딪히는 것)

| 규칙 | 내용 | PRD 영향 |
|---|---|---|
| **R01 / CLAUDE.md "LLM API 호출 금지"** | Anthropic·OpenRouter API 는 **서비스 전용**. 실험·테스트·데이터셋·스크립트 사용 금지. 허용은 CC 콘솔 직접 작업뿐. 위반 시 세션 종료 | strategist/executor/helpdesk/watcher(LLM) 전부 API 호출 → **위반**. FR-INFRA-6 워크스페이스, G5 크레딧 한도도 동일 |
| `feedback_no_additional_cost_before_market_validation` (2026-10-29) | 시장 검증 전 추가 비용 불가 | 별도 러너 EC2, 별도 작업공간 EC2, Secrets Manager(유료)에 해당 |
| `feedback_node_expansion_needs_slack_approval` (2026-11-03) | 노드 증설·상시 비용은 Slack 승인. Slack 없음 → 실행 금지 | 위와 동일 |
| R23 | 유료 보안 서비스 금지 | — |
| R27 | 외부 API·다운로드는 사전 승인 | 신규 외부 의존 |
| R02 | 메일/알림은 명시적 "보내" 전 금지 (`email-send-guard`) | 에이전트의 자동 알림·스크럼 메일 불가 |
| R14 | 되돌릴 수 없는 것(발송·결제·삭제·지출·방향·시크릿 재발급)만 James 승인 | 비LLM·무비용·가역 작업은 무인 허용 |
| R30 / R07 | 오더 없이 코드 변경 금지, "완료" = 검증 기준 실측 + PR 칸 | 과제 단위와 동일 철학 |
| (정정 2026-11-04) 원장 R01 의 `llm-call-ledger` | **같은 이름의 파일 · 잡 · 테스트가 `origin/main` 에 없다** (`git ls-files` · `git grep`). 실제 유사 장치는 `hardcode-audit` 의 `openrouter-endpoint-redeclared` 뿐이며 OpenRouter 엔드포인트 재선언만 탐지하고 Anthropic 직접 호출은 탐지하지 않는다 | 새 LLM 호출 경로를 막는 CI 장치는 **현재 없다**. R01 개정(PR #1766)에서 "예정" 으로 표기 |

관찰: CLAUDE.md 에는 "계획→승인→실행"(LEVEL-2)이 남아 있고 `rules-ledger` 는 R14 로 그 방식을 대체했다고 적는다. 두 규칙이 공존한다 — 이번 작업 범위 밖이므로 변경하지 않았다.

## 10. 확인하지 못한 것

- Keel 검사 수(8 vs 12), `harness-audit` 의 "8축", ledger R32·R33 행.
- `insighta-prod` Argo 앱의 `syncPolicy.automated` 소속.
- `recommendation_feedback` 쓰기 경로 유무(`src/` 외 Edge Function 포함 grep 안 함), `trackRecommendationFeedback` 호출처.
- Claude Code 샌드박스 설정 키(`failIfUnavailable`, `network.strictAllowlist` 등)는 PRD 의 표기를 이 세션에서 문서와 대조하지 않았다.
- GitHub 플랜, App 설치 목록, `.claude/skills/`(원격에 없음).
