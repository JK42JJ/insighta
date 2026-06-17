# 횡단 관심사 정합 감사 — 1단계 현황+분석 보고 (read-only seam map)

> **부모 문서**: `docs/handoffs/crosscutting-concern-audit-cp500plus.md` (이 감사의 SSOT — 배경/범위/2단계 구조).
> **이 문서**: 그 §1의 **1단계 산출물** = CC의 깊은 현황+분석. **사실 + 옵션(안 고름) + 미해결 질문**까지. 정본층 선택·불변식 확정·① 결정·fix·측정은 **2단계(Claude 전략) + James 승인** 사항 — 이 문서에 없음.
> **세션**: CP500++ 감사 1단계, 2026-06-16.
> **방법**: 코드·스키마 전문 read (grep=경로발견, 판정=Read). 에이전트 4명(②③④⑦) + CC 직접(①) + CC cross-check.

---

## 0. Substrate (필독 — 판정 기준)

- **모든 판정은 origin/main (`657c20da`) = prod = 핸드오프 기준.** 작업 브랜치 `feat/v2-translations`는 merge-base `77835497`(2026-06-11, #901) 기준 **20 커밋 뒤** — CP500+ 구조-fix(#909/#913/#916/#917/#920/#921/#922)가 main에만 존재.
- 감사 13파일 two-dot diff(`origin/main..HEAD`): **stale = 3파일뿐**(`schema.prisma`·`auto-add-recommendations.ts`#922·`enrich-rich-summary.ts`#917). 나머지 ①②의 모든 의존 파일은 main과 동일 → 그 결론은 prod 유효. stale 3파일은 `git show origin/main`로 재그라운딩.
- **CC cross-check로 에이전트 오류 3건 교정**: (a) 관련도 reach(fan-out과 도달 혼동) (b) diversity/pool-serve "default-off"(prod compose override=ON) (c) like가 mandala_id 미기록(실제 기록함). "verify 보고도 불신, 직접 재확인" 적용.

## 핵심 진단 (한 문단)
5개 증상(노트유실·관련도공백·heart-pin공백·메타미연결·풀오염)이 **단일 뿌리**로 수렴: **카드 정체성 3-key 분열 + `ulc.video_id` 구조적 항상-NULL + chokepoint들이 (a)우연적 (b)부분-reach (c)config-분산.** 이 하나가 ②③⑦을 동시에 무력화. 무한루프(두더지잡기) 탈출 = 증상별 fix 중단 → 정본층(2단계).

---

## ① 카드 정체성 (CC 직접 검증, 전 파일 main 동일)

- **3 정체성 키**: uvs `@@unique(user_id, videoId=youtube_videos.id **uuid**)`(schema:54) / ulc `@@unique(user_id, url)` + `video_id VarChar(11) nullable·非unique`(schema:710,695) / card_interactions `@@unique(user_id, video_id **11자**, signal)`(schema:754). uvs↔interactions 브릿지 = `youtube_videos.id→youtube_video_id` 1점프(schema:997).
- **InsightCard.id = 테이블-모호 uuid**: uvs.id(youtubeToInsightCard:23) / ulc.id(local-cards:154) 둘 다 bare uuid = 값으로 구분 불가. stream만 `stream-` prefix(recommendationToInsightCard:29). **구분 유일수단 = `sourceTable`(types.ts:49)**, 3 컨버터가 채움.
- **discriminator 사용 불일치 (병의 표면)**: pin✅(usePinCard:32→cards:220) / move✅(detectCardSource, cardUtils:25) / delete✅(useCardOrchestrator:1487) / watch_position✅(uvs-only guard :1455) / enrich✅(:208,236) — **rich-note만 ❌**: `saveRichNote(currentCard.id)` source 없이 전송(RightPanel:71) → BE `userVideoState.findUnique({id})`+`.update` **uvs-only**(rich-note-service:142,151) → ulc.id는 `z.string().uuid()`(video-rich-notes:22) 통과 후 uvs 조회 null → 404 → `.catch(()=>{})` 삼킴.
- **두 API 네임스페이스**: videoId(11자)=source-agnostic 대칭(`/cards/:videoId/like|archive…`, 양 테이블 dual-UPDATE) vs uuid-row=모호(`/rich-notes/:cardId` blind uvs / `/cards/:id/pin` source-param 해소).
- **조립 뿌리**: useCardOrchestrator(메인, id-우선 후 URL-fallback) / useMandalaCards(읽기전용, normalizeUrl dedup, local 우선).

## ② per-card 콘텐츠 — 두 축 (에이전트 + CC 1건 교정, 전 파일 main 동일)

| 콘텐츠 | 저장:양테이블 | 저장:read/write | ★도달:전유입(ulc수동)★ | 위반 file:line |
|---|---|---|---|---|
| 노트 | ⚠️ user_note 양쪽 / json **uvs-only**(schema:22) | ❌ editor=json uvs-only(rich-note-service:74) / grid=plain 양쪽 | ❌ ulc editor save 404 swallow | RightPanel:71 / rich-note-service:142,151 |
| 핀 | ✅ pinned_at 양쪽 | ⚠️ toggle dual✅(cards:220) / heart=video_id 키 | ❌ **ulc.video_id 항상 NULL → heart-pin ulc 도달 전무**(③로 격상) | cards.ts:347 |
| 관련도 | ✅ 양쪽(schema:46,700) | ✅ fan-out 양쪽(trigger:83-135) | ❌ **REACH: trigger 발화처=AddCards/wizard/pipeline/admin뿐, 수동-add 없음 → ulc placed 0/82 prod** | 발화처 mandalas:2787/pipeline:275/wizard:477 |
| 시청완료 | ❌ uvs-only(schema:24) | ❌ | ❌ ulc 경로 자체 없음 | ulc 컬럼 부재 |
| 시청위치 | ❌ uvs-only(schema:23) | ❌ guard가 ulc skip | ❌ no-op(else 없음) | useCardOrchestrator:1456 |
| 셀위치 | ✅ 양쪽(schema:25,691) | ✅ 테이블별 독립 | ✅ | — |

- **★CC 교정★**: 에이전트②는 관련도 reach를 ✅로 표기 → trigger 내부 fan-out(양테이블)과 trigger 발화-도달(수동-add 미발화)을 혼동. 교차검증 = **저장✅ / fan-out✅ / 도달❌**(prod 0/82 정합). 두 축 분리의 핵심 사례.
- **노트 split-brain 확정**: ulc grid-인라인 편집 → ulc.user_note 저장·grid 표시 OK. 사이드에디터 초기 read는 fallback으로 기존 노트 표시되나, **편집 저장 → 404 → 삼킴 = 영구 미저장**. `user_note_json`은 ulc에 컬럼 자체 없음. uvs 약한 split: grid write가 plain만 → json NULL → 에디터 legacy-wrap(rich 포맷 상실).
- **추가 비대칭**: surfaced_at uvs-only(저영향) · is_in_ideation uvs-only(useMandalaCards가 ulc는 cell_index만, uvs는 !isInIdeation = placement-state 모델 비대칭).

## ③ 메타 ingest (에이전트 + CC main 재그라운딩)

- ★**ulc.video_id = 어느 경로도 안 씀 → 구조적 100% NULL**★: EF add/batch-move/import 행객체에 키 없음 + FE `AddLocalCardPayload`(local-cards:96-109) 필드 부재 + 백필 커밋 0. → 유튜브 ulc 카드 전량이 youtube_videos·card_interactions 미연결. **①폭탄 = ③ 규명: NULL 시점 = "항상".** (②heart-pin·메타조인·⑦signal store 동시 무력화의 단일 뿌리.)
- local-cards EF 'user-d-and-d' youtube_videos ingest = **DEAD**: `&& body.video_id` 게이트(EF:530)가 FE 미전송으로 영구 false → source='user-d-and-d' 행 0(코드 확정).
- youtube_videos 생성(필드-레벨 chokepoint 없음): like-hint(cards:362,partial)/VideoManager.upsert*(partial)/auto-add createMany(partial)/EF(dead)/cron 2종(생성안함·기존SELECT). full 백필=youtube-metadata-cron 위임.
- ★**#917 `ensureYoutubeVideoRow`(ensure-video-row.ts) = 메타 chokepoint, main 실재**★: enrich 핸들러(:126) fail-open 호출, `videosBatchFullMetadata`+`VideoManager.upsertVideo` 재사용, 주석이 IdeaSpot D&D 0-rows 명시 타깃. **단 reach = enrich 도달 카드 한정**(=하트/크론). 수동 미좋아요 ulc 카드는 영영 미생성.

## ④ 추천 게이트 — **단일 chokepoint 아님** (에이전트 + CC config 교정)

- 게이트 표면 **3개가 코드 비공유**: ① v5 executor(shorts title+probe, diversity, LLM-pick) → add-cards·wizard만 / ② pool-serve-fill(같은 게이트 **수기 복제** + semantic relevance + **직접 uvs INSERT** :363 = maybeAutoAdd **우회**) / ③ v3 executor(prod 라이브, title-shorts만, probe·diversity·relevance·view-floor 전무).
- `maybeAutoAddRecommendations`(:89) = **view-floor+meta-enrich 가드 전용 chokepoint**(recommendation_cache 경유만) — shorts/diversity/relevance 미포함.
- ★**prod 라이브 = v3**★(pipeline-runner:42, compose:308 `VIDEO_DISCOVER_V3=1`) → v5 diversity/probe가 최대볼륨 경로 미적용. + pool-serve(v5)도 prod 활성.
- ★**CC 교정 (config-axis = §10-C)**★: 에이전트는 diversity/pool-serve를 코드 "default-off"로 봤으나 **prod compose override = ON**(compose:160 `V5_DIVERSITY_GUARD=true`, :151 `V5_POOL_SERVE=true`). **genuinely off = #922 view-floor·meta-enrich뿐**(`AUTO_ADD_*` compose 부재). 실프로드 4토글 확정 = `docker exec printenv` ⓜ.
- 우회 3종: (A)pool-serve 직접 uvs write(eviction sweep도 미경유) (B)v3 prod-라이브 미게이트 (C)수동 D&D `youtube-shorts` 그대로 수용(local-cards:486, 별 테이블).

## ⑦ 행동 텔레메트리 → 페르소나 토대 (map-only, 에이전트 + CC 2건 교정)

- **Gap A(이벤트 부재)**: 진입·재생·반복 카운트 저장처 없음. uvs=state 덮어쓰기, card_interactions=signal당 1행 dedup.
- ★NEW: `watch_sessions`(schema:1236) = 유일한 play-event 형태 테이블★ — **단 product-미배선**: HTTP 라우트 `/analytics/sessions`(analytics.ts:205) 존재하나 **FE api-client 미호출**(CC 교정: "CLI-only" 아님 = "라우트 존재 + FE 미배선") + **user_id·mandala_id 미기록**(tracker.ts) → 사실상 dead + 귀속 불가.
- `youtube_watch_history`(schema:1108) = **writer 0**(dead). `mandala_activity_log` = share_enabled/disabled만(mandalas:2269 유일 caller). card_interactions: delete/watch_complete/skip = **never written**(읽기만, exclude 로직 latent dead-read).
- ★**CC 교정**★: 에이전트는 "like가 mandala_id 없이 기록"이라 했으나 **오류** — cards.ts:320·329가 create·update 모두 `mandala_id: body.mandalaId ?? null` 기록 → like는 mandala-귀속 가능(mandalaId 전달 시). **INV-⑦.6 철회.**
- **Gap B(split)**: watch state=uvs-only / signal=양쪽(11자) — **단 ulc.video_id NULL이라 ulc는 signal store에도 사실상 미도달**.
- **롤업**: 페르소나/profile/rollup 테이블 **전무**(전수 grep 확인).
- ★**①커플링 (핵심)**★: video-키 행동 store 필요 → ulc.video_id NULL이면 ulc 전량 누락(soft wall — 데이터 손상 아님, 미래 백필/통합 마이그레이션 강제). uvs(uuid) vs interactions/ulc(11자) 키패밀리 분열도 통합 전제. **출시 시 ①을 페르소나 못 읽는 모델로 굳히면 토대 재시공.**

---

## 통합 불변식 카탈로그 (사실분 — 최종 문구·강제방식 확정은 2단계)
```
[INV-CARD-IDENTITY]  출처 테이블 카드만으로 복원.       강제:⚠️관습 (sourceTable, rich-note만 무시)        위반:RightPanel:71
[INV-ULC-VIDEOID]    유튜브 ulc는 11자 video_id 보유.    강제:❌무방비 (어느 write 경로도 안 씀)             위반:EF 480/771/961 + FE payload 96-109
[INV-VIDEO-META]     v2도달 영상은 youtube_videos 행.    강제:⚠️chokepoint(#917 ensure-video-row) reach=enrich한정·우연  위반:수동 미좋아요 ulc
[INV-INFLOW-GATE]    자동유입 1게이트 통과.              강제:❌무방비 (v5/pool/v3 3표면 복제+우회)          위반:pool-serve-fill:363, v3 prod(compose:308)
[INV-AUTOADD-GUARD]  view-floor·meta 전 자동카드 적용.    강제:⚠️#922 존재·default-off·pool 미경유            위반:pool-serve 전무
[INV-CONFIG-SSOT]    토글 활성값 단일 진실.              강제:❌무방비 (compose리터럴>env_file>코드 우선순위)  위반:§10-C BACKFILL 잠복(troubleshooting CP500++)
[INV-BEHAVIOR-EVENT] 진입·재생·반복 적재처.              강제:❌무방비 (watch_sessions 미배선·무귀속)        위반:analytics.ts:205 FE-unwired
```

## ★§10-D 구조-강제 갭 (오늘 병의 근본 — 입증)★
chokepoint들은 **존재하나 (a) 우연적**(현 코드가 우연히 유입을 그리 보냄 — 구조가 우회 금지 안 함; pool-serve 직접쓰기·v3 prod = 산 증거) **(b) reach 부분적**(#917=enrich-only, #922=auto-only·수동 D&D 우회, 게이트=3표면 복제) **(c) 가드 config 분산**(diversity/pool=compose-ON, view/meta=off — §10-C 혼란). → "정본도 또 우연." 1~5th instance 재발 단일 근본 = **type/lint/test/DB-constraint로 우회불가 강제하는 장치 부재.** (2단계 0순위 — §10-D.)

## 트리아지 (심각도 + 블래스트 ⓜ표시만 — 측정 미실행)
| 등급 | 항목 | 블래스트(ⓜ — 2단계 후 James 승인) |
|---|---|---|
| **launch-blocking(유실)** | 노트 ulc 사이드에디터 write-dead | `SELECT count ulc WHERE user_note IS NOT NULL AND cell_index>=0` |
| **잠복(거짓기능)** | 관련도 ulc 0/82 · heart-pin ulc 0 · 시청완료/위치 ulc 무 | `SELECT count ulc WHERE video_id IS NULL AND link_type LIKE 'youtube%'` (예측=전량) |
| **단순결함/우연 chokepoint** | pool-serve uvs 직접쓰기 · v3 미게이트 · #922 inert | `docker exec printenv` 4토글 실값 |
| **출시후 부채(큰안)** | ① 정체성 통합 · ⑦ 이벤트 스토어 | uvs:ulc placed 비율(CP498=98.7:1.3, 갱신) |

## 옵션 (각 갭 A/B — ★고르지 않음, 2단계 몫★)
- **정체성/노트/핀**: A=정체성 통합(단일 테이블 or canonical id→table 리졸버 전 엔드포인트 공유) / B=discriminator 구조강제(전 카드-뮤테이션 source 필수, rich-note도 채택) / C=videoId 네임스페이스 수렴(ulc.video_id 상시 채움 선결).
- **메타**: A=enrich chokepoint 유지+reach 확대(수동 유입도) / B=유입경로별 ingest 복제(§10 chokepoint 원칙 반대방향).
- **게이트**: A=true 단일 chokepoint(pool-serve·v3도 maybeAutoAdd 경유, 게이트 그 안으로) / B=공유 `applyInflowGates()` 모듈(복제 제거, 우회는 여전).
- **config**: A=토글 활성 SSOT 1개(compose environment 리터럴)+printenv 검증 / B=코드 default로 흡수.
- **⑦ 토대**: A=전면 defer(출시후 greenfield, 단 ① 백필 비용↑) / B=① 출시결정을 persona-ready로(단일 video-key + 행동행 mandala_id, store는 후속).

## 미해결 질문 (추가 확인 필요)
1. `/list` 메타조인(EF:359-360)이 ulc 위해 의도된 것인가, ulc는 의도적 meta-less(uvs만 메타)인가? — 옵션C 실현가능성 전제.
2. prod 라이브가 v3(compose:308)인 게 의도인가 — v5 diversity/probe가 최대볼륨 경로 미적용이 #909/#913/#916 의도와 부합?
3. pool-serve에 view-floor/meta 가드 부재가 의도인가 누락인가?
4. watch_sessions FE 배선 예정인가 폐기인가(user_id·mandala_id 미기록)?
5. ① 통합을 출시에 할까, ulc.video_id 백필을 미래로 미룰까? (⑦ d1 = 진짜 wall — 데이터 누적될수록 마이그레이션 비용↑.)

## 핸드오프 드리프트 (코드>핸드오프 정정)
- §6-bis "ensureYoutubeVideoRow / enrich 핸들러 fetch+upsert" = main에 **실재**(작업브랜치만 stale). §6-bis 다수 라인번호 stale(claim은 정확).
- §6-bis ⑦ 이벤트테이블에 **`watch_sessions` 누락**(유일 play-event형). youtube_watch_history "외부 임포트" = 실제 writer 0(dead, 과대표현).
- §2 ④ "executor 단일점" 전제 = main 코드 반증(3표면). "prod=v5 게이트" = 부정확(prod=v3).
- §10-A diversity/pool "default-off" = 코드default 맞으나 **prod compose=ON**(§10-C 정합 — 이 문서 ④ 참조).

---

## 1단계 종료 / 2단계 입력
- 본 문서 = **사실 지반.** 정본층 아키텍처 선택 · 불변식 최종 확정 · ① 결정 · 트리아지 라인 · 측정(ⓜ) · fix · 거버넌스 = **2단계(Claude 전략 종합·설계) → James 출시라인 결정** (별 호흡).
- CC(1단계) 진입 범위는 여기까지. §1 조사/설계 분리 준수.

---

## measurement addendum (prod, 2026-06-16)

> 2단계 입력용 정량 측정(ⓜ1~5, read-only SELECT + `docker exec printenv`, origin/main 스키마) 결과. **원문 주장은 감사 이력 보존을 위해 삭제하지 않고, 아래에서 "정정됨/확정"으로 표시한다.** 측정만 — 옵션선택·fix·flip 없음.

### ★정정됨 (REFUTED) — 1건 중대★
- **③ / ① "`ulc.video_id` 구조적 항상-NULL 폭탄" = 거짓.** prod 실측 `ulc.video_id NOT NULL = 157/157` (NULL 0). 원인 = **DB 트리거 `trg_set_youtube_video_id`** (user_local_cards INSERT/UPDATE 시 url→11자 서버측 추출, 생성컬럼 아님 is_generated=NEVER). 샘플 `video_id=XSy96HDtJ8s ← .../watch?v=XSy96HDtJ8s`.
- **따라서 아래 원문 주장 철회**:
  - ③ "ulc.video_id 어느 경로도 안 씀 → 100% NULL" → **app 레이어 한정 참, DB 트리거가 채움.**
  - ② F "heart-pin ulc 도달 전무"(cards.ts:347 video_id-NULL 전제) → **작동.** 실측 `ulc pinned = 20`.
  - ③ "유튜브 ulc가 youtube_videos·card_interactions 미연결 / `/list` 메타조인 dead" → **video_id 채워져 join 가능.**
  - `[INV-ULC-VIDEOID]` "강제 ❌무방비" → **DB 트리거로 사실상 강제됨**(불변식 재분류 = 2단계).
- **① 통합 무게 하향**: ulc placed = 82 / uvs placed = 7243 = **1.12%**(소수) + video_id 브릿지 이미 작동 → ① "큰 안" 긴급도/규모 모두 하향. (단 ③ "EF user-d-and-d youtube_videos ingest dead"는 `body.video_id` 미전송 = **별개 메커니즘**, ulc.video_id 컬럼과 무관 — 별도 확인 대상.)

### ★확정 (STANDS) — 측정 재확인★
- **관련도 reach ❌**: `ulc placed relevance = 0 / 82` (trigger 미발화 메커니즘 = video_id와 무관). uvs placed = 1275/7243(17.6%). → ② 관련도 도달축 STANDS.
- **노트 launch-blocking 실규모**: 실유저 placed ulc 노트(non-empty) = **13장**(사이드에디터 write-dead). uvs split = json 24 / plain 27 / legacy(plain有json無) 11.
- **config 실값 6 (printenv, §10-C 실증)**: `V5_DIVERSITY_GUARD=true` · `V5_POOL_SERVE=true` · `VIDEO_DISCOVER_V3=1` · `YOUTUBE_METADATA_BACKFILL_ENABLED=false`(.env=true이나 compose override) · `AUTO_ADD_MIN_VIEW_COUNT`·`AUTO_ADD_META_ENRICH` **unset(=off)**. → diversity·pool·v3 활성 / #922 가드 off 확정.
- **⑦ 토대**: `watch_sessions = 0`·`youtube_watch_history = 0`(둘 다 dead 확정). `card_interactions = 2819`, **mandala_id = 2685(95.2%) = 롤업 가능 데이터 실재**(순수 greenfield 아님). signal = surfaced 2540/like 253/archive 26, **delete·watch_complete·skip = 0**(never-written 확정). → like가 mandala_id 기록(원문 ⑦ INV-⑦.6 "미기록" 이미 CC 교정, 실측 정합).

### ★메타-교훈 (2단계 필수 반영)★
- **1단계 read-audit가 DB 트리거 레이어를 통째로 누락.** app 레이어(EF·FE·BE 라우트)만 읽어 "video_id 안 채움"으로 오판 → prod 측정이 정정. **2단계 정본층 설계 시 트리거 3종을 seam에 포함 필수**: `trg_set_youtube_video_id`(ulc.video_id 채움) · `trg_sync_local_card` · `trg_placed_in_edge`(ontology shadow, migrations/ontology/004·005). 정합 불변식은 app+DB-trigger 양 레이어로 판정해야 함.

### 트리아지 갱신 (측정 후)
| 등급 | 항목 | 실측 |
|---|---|---|
| launch-blocking(유실) | 노트 ulc 사이드에디터 write-dead | **13장** (소규모) |
| 잠복(거짓기능) | 관련도 ulc 0/82 | **확정 0/82** (heart-pin·메타조인은 정정=작동) |
| 단순결함 | pool-serve 직접쓰기·v3 미게이트·#922 off | config 6값 확정 |
| 출시후 부채 | ① 정체성 통합 | **무게 하향**(ulc 1.1% + video_id 브릿지 작동) |
| 출시후 부채 | ⑦ 이벤트 스토어 | watch_sessions/ywh dead, **단 card_interactions 2685 attributable 재활용 가능** |
