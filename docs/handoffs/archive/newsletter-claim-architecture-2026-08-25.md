# 주간 브리핑 — Claim 아키텍처 구현 설계

> 2026-08-25 · **설계. 구현 전 James 승인 필요.**
> **상위 명세: `weekly-knowledge-brief-master-spec.md`** — 이 문서는 그것을 인사이타
> 코드베이스에서 어떻게 구현하는지만 다룬다. 상위 명세와 충돌하면 상위가 이긴다.
> 대체 문서: `newsletter-pipeline-design-2026-08-25.md`(영상 단위 설계 — Claim 부재로 폐기)

---

## 0. 이 문서가 다시 쓰이는 이유

`newsletter-pipeline-design-2026-08-25.md` 를 오늘 오전에 썼다. 상위 명세를 읽지 않고 썼고,
**영상 단위로 설계했다.** 상위 명세 §4.3 은 `Claim` 을 *"서비스의 가장 중요한 내부 객체"* 로
놓는다. 둘의 차이가 제품을 가른다.

```
영상 단위    Source → 게이트 → 선별 → 집필
주장 단위    Source → Claim → Evidence → Editorial Score → Knowledge Diff → Weekly
```

**영상 단위로는 §16 Knowledge Diff 가 계산되지 않는다.** 지난주와 비교할 대상이 없기 때문이다.
"영상 A" 와 "영상 B" 는 비교 대상이 아니지만, *"AI 면접에서 X가 중요하다"* 라는 주장은
지난주 상태와 비교된다. 상위 명세가 *"Weekly의 장기 경쟁력은 요약이 아니라 변화 감지"*
(§16)라고 말하는 것이 이 지점이다.

---

## 1. 8단계 대조 — 이미 있는 것

전수 확인했다. **여덟 단계 중 여섯이 재사용 가능하고, 진짜 신규는 둘이다.**

| 상위 명세 | 인사이타에 있는 것 | 상태 |
|---|---|---|
| §5 Stage 1 Collection | `v2/youtube-client` — `searchVideos`·`videosBatch`, 검색키 8개 failover | **실증됨** (2026-08-25: 쿼리 80·2,714편·8,000 units·실패 0) |
| §6 Stage 2 Candidate Filter | `search-trace` 후보별 탈락사유 · 형식 게이트 | 있음 (후보 23,394행 적재 실적) |
| §7 Stage 3 Semantic Dedup | **pgvector** — `mandala_embeddings vector(4096)`, `video_chunk_embeddings` | 기반 있음, 뉴스레터 배선 없음 |
| §8 Stage 4 Claim Extraction | **v2 rich summary `atoms`** + `sections{timestamp, relevance_pct}` | **기반 있음 — §2 참조** |
| §9 Stage 5 Cross Validation | `book-factcheck` 5등급 + `web-search`(네이버/Exa) | 있음, 오늘 근거-0 게이트 추가(PR #1532) |
| §10 Stage 6 Editorial Scoring | `topic-judge` 2축(safe/learnable) | **7항목으로 확장 필요** |
| §11 Stage 7 Editorial Decision | `admin/*` 14 라우트 패턴 | 화면 신규 |
| §12 Stage 8 Report Generation | `email/broadcast`·`templates` | 있음 |
| **§16 Knowledge Diff** | **없음** | **핵심 신규** |

새로 만들 것은 **Claim 저장소**와 **Knowledge Diff** 둘이다. 나머지는 배선이다.

---

## 2. Claim 의 기반은 `atoms` 다

v2 rich summary 가 영상마다 이미 만들고 있는 것:

```
atoms                 2개 이상 강제 (summary-gate 검증)
entities              name + type, 타입 검증됨
sections              구간마다 timestamp + relevance_pct(0~100)
```

`atom` 이 이미 **주장 단위**다. 그리고 `book-factcheck` 가 `atom_idx` 참조가 있는 문장만
검증 큐에 넣는다(`hasSource===true`) — 상위 명세 §8 이 요구하는 *"영상 전체 요약이 아니라
주장 단위"* 가 그 형태로 존재한다.

**빠진 것은 영상을 가로지르는 통합이다.** 지금 atom 은 영상 하나에 갇혀 있다.
세 영상이 같은 주장을 해도 atom 세 개로 남는다. §9 의 supporting/contradicting 이
성립하려면 그것들이 **하나의 Claim 으로 묶여야 한다.**

### 묶는 방법 — pgvector

`video_chunk_embeddings` 와 같은 방식으로 atom 을 임베딩하고 코사인 유사도로 클러스터링한다.
상위 명세 §7 이 *"초기에는 PostgreSQL + pgvector로 충분하다"* 라고 적은 그대로다.

**[미측정] M1** — atom 임베딩 1건당 원가, 그리고 같은 주장을 실제로 묶어내는 유사도 임계.
임계를 추정으로 정하면 서로 다른 주장이 합쳐지거나 같은 주장이 갈라진다.

---

## 3. 데이터 모델

상위 명세 §4 를 인사이타 컨벤션으로 옮긴다. 이름은 명세를 따른다.

```
newsletter_claims
  id · statement · claim_type · confidence
  first_seen_at · last_seen_at          ← §16 Diff 의 축
  topic · issue_id(발행된 호)
  superseded_by                          ← 주장이 갱신됐을 때 이전 주장을 가리킴

newsletter_claim_sources               Claim ↔ 영상 N:N
  claim_id · video_id · atom_idx
  stance: supporting | neutral | contradicting
  timestamp_sec                          ← 인용 좌표 (자막 원문은 저장 안 함)

newsletter_issues
  topic · 호수 · 창(from~to) · 상태(draft|review|published)
  share_code · 지표 스냅샷 · 발행 시각

newsletter_items                        호수별 추천 영상 · 등급 · 순서
```

`claim_type` 은 상위 명세 §4.3 의 7종을 그대로 쓴다 — Fact · Opinion · Prediction ·
Recommendation · Experience · Marketing Claim · Research Finding.

**`Marketing Claim` 이 분리돼 있다는 점이 중요하다.** 오늘 창간호에서 사람이 손으로 뺀
*"7세 아이 키우며 순수익 월 2,000만 원"* 류가 이 타입으로 자동 분류된다.

### 법적 제약이 인용 방식을 정한다

`caption/extractor` 주석: *"Transcripts are NOT persisted. Only LLM-generated summaries are stored."*
상위 명세 §13 도 *"전체 스크립트 저장"* 을 금지한다.

따라서 `newsletter_claim_sources.timestamp_sec` 은 **요약 구간을 가리키지 원문을 담지 않는다.**
발행문에서는 *"그 영상 12분 30초에서"* 로 쓴다.

---

## 4. Editorial Score — 2축에서 7항목으로

`topic-judge` 가 이미 `safe`/`learnable` 2축을 판정하고 **결과를 영속화**한다(재실행 비용 0).
상위 명세 §10 의 7항목은 그 확장이다.

```
Editorial Score =
  25% Relevance  + 20% Novelty   + 20% Evidence
+ 15% Source Quality + 10% Practical Value + 10% Timeliness
− Commercial Bias Penalty − Redundancy Penalty
```

| 항목 | 산출 근거 |
|---|---|
| Relevance | `topic-judge.learnable` + 도메인 태그 |
| **Novelty** | **§16 Diff — 지난 호 Claim 에 없던 것.** 이 항목이 Knowledge Diff 를 스코어에 연결한다 |
| Evidence | `book-factcheck` verdict + 독립 채널 수 |
| Source Quality | 채널 원장 점수(§6) |
| Practical Value | [미측정] |
| Timeliness | `published_at` |
| Commercial Bias | `claim_type == Marketing Claim` + 제목 금액 패턴 |
| Redundancy | pgvector 클러스터 크기 |

등급은 §10 의 5단(Must Know 90+ / Recommended 80+ / Watch 70+ / Archive 60+ / Reject).
**오늘 창간호의 3단 등급(확인·관측·미확인)은 이것과 다른 축이다** — 그쪽은 *사실인가*,
이쪽은 *실을 가치가 있는가*. 둘 다 필요하고, 합치면 안 된다.

---

## 5. Knowledge Diff — 매주 발행할 이유

상위 명세 §16 이 *"이 기능이 축적되면 매주 발행할 이유가 생긴다"* 라고 말한다.
Claim 에 `first_seen_at`·`last_seen_at`·`superseded_by` 가 있으면 계산은 단순하다.

```
NEW        이번 주 처음 등장한 Claim              → "이번 주 새롭게 달라진 것"
PERSISTS   지난 호에도 있었고 이번에도 있음        → 지표판 (곡선이 안 꺾인다)
CHANGED    같은 클러스터인데 statement 가 갱신됨   → OLD → NEW 병기
CONTRADICTED  이번 주 반박 근거가 붙음            → §18 "논쟁 중인 내용"
GONE       지난 호에 있었으나 이번 주 소멸         → 이탈 자체가 기사
```

**1호는 전부 NEW 다.** Diff 는 2호부터 값을 낸다. 그래서 1호에서 Claim 을 저장하지 않으면
2호가 비교 대상 없이 시작하고, 그때 다시 1호를 복원할 방법이 없다.
**Claim 저장은 Diff 구현보다 먼저 들어가야 한다.**

---

## 6. 채널 원장 — Source Quality 의 입력

상위 명세 §22 가 *"출처별 신뢰도 데이터"* 를 해자로 꼽는다. 오늘 실측한 결과가 설계를 정한다.

```
855채널 중 599개(70%)가 편당 조회수 중앙값 100회 미만
편수 1위 채널이 편당 4회 · 4편 낸 채널이 편당 1회
```

**편수로 줄 세우면 상위가 스팸으로 찬다.** 점수식:

```
score = 조회수 중앙값(8주) × Editorial Score 통과율 × 발행 규칙성
하한:  8주 3편 이상 · 편당 중앙값 100회 이상
```

중앙값을 쓰는 이유는 한 편 터진 채널과 꾸준한 채널을 가르기 위해서다.
**한 주 데이터로는 Top 100 이 안 된다** — 주 2편 이상 낸 채널이 114개뿐이라 8주 누적이 필요하다.

---

## 7. Editor 화면 — §11 을 그대로

상위 명세 §11 이 화면을 이미 명세했다. `admin/*` 14개 라우트 패턴을 따른다.

```
[Claim] · [Sources] · [Supporting] · [Contradicting] · [Evidence] · [Score]
[AI recommendation]  Must Know / Recommended / …
[Human decision]     Publish / Reject / Investigate
```

**`Human decision` 이 학습 데이터다.** 상위 명세 §22 가 *"인간 편집자의 승인 데이터"* 를
해자로 꼽고, §10 이 *"충분한 데이터가 쌓인 뒤 자동화한다"* 라고 적는다.
산문을 고쳐 쓰면 이 데이터가 남지 않는다 — 초안은 **후보 목록 + 표시·재정렬** 형태여야 한다.

발행은 James 고유 권한이므로 파이프라인은 `review` 상태에서 정지한다(CLAUDE.md 하드룰, 훅 강제).

---

## 8. 배포 3면 (§14)

```
Web Report        /n/<share_code> 공개 열람. mandala_shares 의 share_code 패턴 재사용
App Note          Deep Dive 만 노트로. 뉴스레터 전체가 아니다
YouTube Video     후순위
```

**노트에 들어가는 것은 Deep Dive 다.** 구독자는 자기 인사이타에서 「구독 중인 브리프」로
호수 목록을 읽고, 노트 내용이 되는 것은 Deep Dive 뿐이다.

구독은 `curation_subscriptions` 재사용 — `cadence` 컬럼이 이미 있고 기본값이 `weekly` 다.
`topic` 에 주제 슬러그를 넣는다. **가입 시점과 무관하게 차주부터 발송**하고, 지난 호는 열람만.

---

## 9. 주제 10개 (§23) — 정정

상위 명세 §23 Phase 3 의 목록이다.

```
AI · 취업/커리어 · 영어 · 투자/경제 · 쇼핑 · 생산성 · 개발 · 건강 · 창업 · 뉴스/트렌드
```

`config/domains.ts` 의 만다라 슬러그도, `trend_signals` 의 9축도 아니다. 오늘 두 번 잘못 짚었다.

**첫 주제는 §19 에 따라 취준생**이다 — *"AI 시대 취준생이 알아야 할 변화"*.
오늘 만든 창간호는 AI·기술이다. §3.1 이 *"초기에는 10개를 동시에 자동화하지 않고 1~3개 주제에서
품질을 검증"* 이라고 적으므로, 두 주제를 병행하는 것은 명세 안에 있다. **James 판단.**

---

## 10. 착수 순서

각 단계가 독립적으로 되돌려져야 한다.

| # | 내용 | 선행 | 되돌리기 |
|---|---|---|---|
| 1 | `newsletter_claims` + `claim_sources` 테이블 | — | drop |
| 2 | atom → Claim 승격 배선 (영상 1편 내) | 1 | 플래그 off |
| 3 | pgvector 클러스터링 — 영상 가로지르기 | 2 · **M1 측정** | 플래그 off |
| 4 | Cross Validation — `book-factcheck` 배선 | 3 | 플래그 off |
| 5 | **여기서 1호를 다시 만든다** | 4 | — |
| 6 | Editorial Score 7항목 | 5 | 2축으로 복귀 |
| 7 | Editor 화면 (§11) | 6 | 화면만 |
| 8 | **Knowledge Diff — 2호부터 값이 나온다** | 1호가 Claim 을 남겼을 때 | 표시만 끔 |
| 9 | 채널 원장 · 발행물 저장 · 공개 링크 · 구독 | 병행 가능 | drop |

**5번에서 멈춘다.** Claim 기반으로 한 호가 나오는지 먼저 본다. 안 나오면 Score 를 정교하게
해도 안 나온다.

---

## 11. 미측정 — 확정 전 반드시 잴 것

| # | 잴 것 | 왜 |
|---|---|---|
| M1 | atom 임베딩 원가 + 클러스터 유사도 임계 | 임계를 추정하면 주장이 합쳐지거나 갈라진다 |
| M2 | 영상 1편당 atom 수 | Claim 총량과 §9 비용 |
| M3 | 자막 확보율 — atom 생성의 전제 | Mac Mini SPOF, Azure 폴백 |
| M4 | 주제 10개 각각의 주간 수확량 | AI·기술은 2,714편. 나머지는 미측정 |
| M5 | Human decision 과 AI 추천의 일치율 | §21 Editorial Quality. 자동화 시점의 근거 |

M5 가 자동화 시점을 정한다. 상위 명세 §10 은 *"초기 운영에서는 사람이 점수를 검토하고,
충분한 데이터가 쌓인 뒤 자동화한다"* 이고, 그 "충분" 을 M5 가 판정한다.

---

## 12. 오늘 실증된 것 — 이 설계의 근거

2026-08-25 창간호 1차 시도에서 실측했다.

| | 결과 |
|---|---|
| 수확 | 쿼리 80개·2,714편·8,000 units·실패 0 |
| `order=date` + `videoCategoryId` 27·28 | **투자 채널 오염 제거** — 유입 단계 차단이 사후 필터보다 낫다 |
| `videoCategoryId` CSV | **HTTP 400.** 단일 값만 받는다. 클라이언트 JSDoc 이 틀렸다 |
| 사람이 6.6%만 골라 덩어리로 넘김 | 집필자가 편집을 못 하고 **번역만 했다** |
| 외부 수치를 검색 없이 생성 | **§12 위반.** 사후 검증에서 2건 오류(보도일·발표일·축소 수치) |
| 편수로 채널 정렬 | 상위가 편당 4회짜리 스팸 |

마지막 둘이 §9(Cross Validation)와 §10(Source Quality)이 왜 파이프라인 안에 있어야 하는지를
보여준다. 사람이 사후에 하면 놓친다.

---

## 13. 미결 — James 판단

1. **첫 주제.** §19 는 취준생이다. 오늘 만든 AI·기술 창간호를 살릴지, 명세대로 갈지, 병행할지.
2. **오늘 창간호 처리.** 정정 2건은 반영됐다(보도일 8/16 · 발표일 7/2 · 800→164토큰).
   Claim 기반으로 다시 만들 때까지 이것을 1호로 발행할지, 시험판으로 둘지.
3. **Deep Dive 를 노트로 넣는 범위.** §14 는 Deep Dive 만이라고 적는다. 확인 필요.
4. **쇼핑 주제.** `pool-inflow-ledger.md` 에 *"Smart Shopping 제외(James) — 신선 키워드
   30개(1.6%)로 공급이 성립하지 않았다"* 가 있다. §23 목록에는 들어 있다. 공급 확보 후 개설인지.
