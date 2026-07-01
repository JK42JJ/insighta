# 관측·평가 시스템 Phase 0 — 현황 인벤토리 (완료 2026-07-01)

> read-only 감사 산출. 설계 SSOT = `insighta-observability-eval-system-design.md`.
> 3개 병렬 Explore 감사(tracing / quota·units / admin·scheduler) 종합. 전부 file:line·table:column 앵커.

## 한 줄 결론
기존 리치 계측(cosine·cohere·쿼리생성 prompt)은 전부 **폐기된 v3 경로**에 있고, 라이브 프로덕션(v5 add-cards + 위저드 precompute)은 **최소 집계 trace만** 흐른다. 후보별 원장(trail log 본체)·Trace Explorer·일일 롤업은 전부 greenfield. 스케줄러는 Temporal이 아니라 pg-boss/node-cron, 이메일 인프라는 존재.

## 9단계 매핑 (현재 prod 실제 흐름 = `V3_TRACE_ENABLED=true` prod 확인)

| 단계 | 현재 계측(실제 흐름) | 갭 | verdict | 앵커 |
|---|---|---|---|---|
| 1 목표→만다라 | `add_cards.start`/`pipeline.execute.start`(centerGoal,subGoals,algo_version) | 만다라 셀 배열/셀 매핑 없음 | 통합(확장) | add-cards.ts:221 / v3/executor.ts:265 |
| 2 쿼리생성 | v3 `keyword_builder.llm`(prompt+queries) — v5 라이브 경로 전용 trace 無. 쿼리텍스트는 `search.list.request.query`+`add_cards.end.v5_per_query[]` 간접. center=cellIndex −1 | v5 query-gen LLM prompt/raw 미로깅 | 신설(v5) | keyword-builder.ts:194 / add-cards.ts:447 |
| 3 YouTube fanout | `tier2.search.list`(query,items[],quota 100/call), `tier2.videos.batch`, 429=error행 | pageToken 없음, per-query 429 미집계 | 통합(확장) | youtube-client.ts:301 |
| 4 ingest/필터 | `add_cards.end` 집계 카운트만(off_lang/shorts/after_exclude) | per-video drop 사유 없음, series/channel-cap는 log만 | 신설 | add-cards.ts:424 / v5/executor.ts:187 |
| 5 후보풀 | v3 `tier1.match_from_video_pool`(sources[],sample) — v5는 카운트만(`v5_pool_backfill`) | 후보별 source tier/임베딩유무 없음 | 신설(v5) | cache-matcher.ts:151 |
| 6 관련도평가 | v3 `hybrid_rerank.cohere`(nested relevance array, cosine·cell 없음). v5=전무 | 후보별 gc+cosine 없음 | 신설(핵심) | cohere-client.ts:163 |
| 7 게이트결정 | wizard `inflow_gate.cut`(videoId 리스트만). v5 LLM picker=전무 | 후보별 keep/drop+drop_reason 없음 | 신설(핵심=원장 본체) | wizard-precompute.ts:163 |
| 8 배치 | `mandala_filter.semantic_gate`(byCell 카운트), `add_cards.end`(pool_backfill/skipped/en_pass) | 후보별 최종셀 없음, reconciler trace 없음 | 신설 | v3/executor.ts:493 |
| 9 최종서빙 | `add_cards.end.returned_video_ids[]`(videoId만), `wizard.discover.end` | 카드별 gc/cosine/source/cell payload 없음 | 통합(확장) | add-cards.ts:416 |

**요약: 통합 3(1·3·9) / 신설 6(2·4·5·6·7·8).** `search_trace`(요청당)=대체로 확장 / `search_trace_candidate`(후보당)=전면 신설. 신설 emission 지점 = `v5/executor.ts` + `llm-picker`(현 recordTrace ZERO) + `youtube-fanout`.

## 4개 Verdict
1. **trail log 본체 현존? NO — 신설 필수.** 현존은 요청/스텝 집계 + truncated 샘플배열(<=50~60, {videoId,title,cell/score})뿐. 후보별 (source쿼리+gc+cosine+keep/drop+drop_reason+최종셀) 단일 레코드 전무. cosine/gc는 폐기 v3 경로에만(cohere nested, cell/reason 없음), 라이브 v5 emit 0.
2. **위저드 precompute 라이브 units → 계수급 갭.** 2 JSON 위치에만(`mandala_wizard_precompute.discover_result…quotaUnitsApprox` + `video_discover_traces` `wizard.discover.end`…`quotaUnitsApprox`), 키명 불일치(add-cards는 `v5_quota_units`), TTL-sweep, precompute MISS 소실, SUM 컬럼 없음, `reserveQuota` 미경유. pool-serve 라이브 units=전무. `CostUnits.youtube_search_units` 타입 sink 존재하나 producer 0 = dead.
3. **admin 전체 flow 뷰 → 없음. Trace Explorer 신설.** 최근접 `AdminSearchAlgorithms`=algorithm_version 집계 롤업만. v3 `runSearchTraced`=ephemeral 미영속(perQuery `{query,count,error}`만) → 확장점.
4. **일일 job 훅 → Temporal 아님(설계 문서 오류).** 실제 = pg-boss `boss.schedule`(batch-scan 패턴; 등록 `queue/index.ts:54-67` + `types.ts` job명/cron) 또는 node-cron(`v2-quality-audit-cron.ts` 템플릿 + `server.ts:620-628`). 이메일=`src/modules/skills/mailer.ts:11` 공유 transporter(nodemailer Gmail SMTP relay, EC2 IP-whitelisted) 재사용.

## 핵심 테이블 스키마 (prisma)
- `video_discover_traces`(:1959): id,mandala_id,user_id,run_id,step(80),status(20),request Json,response Json,error_message,latency_ms,created_at,expires_at(now+7d),algorithm_version,cost_units Json. idx (mandala_id,created_at),(run_id,created_at),(user_id,created_at),(expires_at),(algorithm_version,created_at).
- `mandala_wizard_precompute`(:522): session_id PK, discover_result Json(=diagnostics.quotaUnitsApprox), status(pending|running|done|failed|consumed), expires_at(now+10min).
- `quota_usage`(:1207)/`quota_operations`(:1193): playlist/video sync + enrichment 전용(reserveQuota만 write). 검색 트리거 4종 미경유.
- `video_pool_collection_runs`(:2216): quota_used Int = batch-collector 유일 실쿼타 컬럼(executor.ts:556).
- `mandala_pipeline_runs`(:1814): total_cost_units Json(:1846) = dead(producer 0).

## 크로스컷
- v5/executor.ts·llm-query-gen.ts·youtube-fanout.ts·llm-picker = **recordTrace ZERO**. v5 라이브 emit = add_cards.start/end + tier2.search.list/videos.batch뿐.
- v5 cell_binning = LLM-pick(**cosine·IKS 없음**) → per-candidate cosine/gc가 서브 시점에 부재. gc/cosine nullable + gc 분포는 골든코호트 오프라인 평가로 분업.

## 재현 스크립트 (scratchpad, 지평 0)
M1재확인 `m1recon.js` / M2 커버리지 `m2c.js` / M4 쿼타정밀 `m4prec.js`. 실행: `cat <script> | bash scripts/ssh-connect.sh "docker exec -i insighta-api node"`.
