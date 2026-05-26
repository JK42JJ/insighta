# Video Search & Difficulty Research — 2026-05-26

**Trigger**: 사용자 "오태민" focusTag 검색 → surface 3개 (모두 무관) + 난이도 "중급" 선택했지만 BE 무시. 단편 hotfix 대신 외부 best practice 기반 spec 재설계 결정 (CP488+1).

**5-Agent 병렬 리서치 결과 종합. 추측 금지 — 모든 claim 에 source URL.**

---

## Research index

- [R1 — 영상 난이도 자동 분류](#r1) — ✅ complete
- [R2 — YouTube discovery 시스템 best practice](#r2) — ✅ complete
- [R3 — Cross-encoder rerank + 사용자 filter 통합](#r3) — ✅ complete
- [R4 — 개인화 추천의 explicit signal 처리](#r4) — ✅ complete
- [R5 — Search algorithm versioning + A/B](#r5) — ✅ complete
- [§6 — Synthesis + Insighta 권장 spec + ship plan](#synthesis) — ✅ complete

---

<a id="r1"></a>
## R1 — Video Difficulty Classification Research

### Top findings

- **Text-difficulty 분류는 mature, 그러나 video-transcript 전용 study 는 sparse.** 2023 Springer IJAIED systematic review — neural net 이 dominant (45% studies), text-feature 가 metadata-only 보다 자주 우세. YouTube-specific systematic review 없음. ([source](https://link.springer.com/article/10.1007/s40593-023-00362-1))
- **BERT-based CEFR classifier = ~0.95 accuracy on EFCAMDAT**; complexity-contour RNN = ~0.75. 즉 transformer transcript classification 이 non-LLM 최강 baseline. (Kerz et al. 2021, BEA workshop, [source](https://aclanthology.org/2021.bea-1.21/))
- **Korean readability: KRIT (KAIST) 공개 모델 존재** — BERT 기반, 25,449 Korean textbook sentences (ages 8-16, 4 grades), **accuracy 0.746, MAE 0.327**. Insighta 가 한국어 콘텐츠 다루므로 직접 관련. ([source](https://koasas.kaist.ac.kr/handle/10203/309526))
- **Hybrid rule + LLM routing = 66-70% 비용 절감 + 거의 동등 정확도.** "Hybrid LLM Routing" (arXiv 2507.08250) — zero-shot LLM accuracy 의 **98.4-100.4%** 유지하면서 token cost **66.3%** + request cost **67.8%** 절감. ([source](https://arxiv.org/abs/2507.08250))
- **Fine-tuned small model > zero-shot LLM on classification.** (arXiv 2406.08660) — 즉 우리의 `depth_level` LLM eval 은 baseline, ceiling 아님. ([source](https://arxiv.org/html/2406.08660v1))
- **Duration ≠ difficulty empirically.** MIT/edX engagement study (Guo et al., LAS 2014) — tutorial engagement 가 2-3분 plateau, lecture engagement 만 length scaling. **content type 이 confound**. 최적 6분 미만 후 engagement 급락. ([source](https://up.csail.mit.edu/other-pubs/las2014-pguo-engagement.pdf))
- **Coursera/Khan Academy: difficulty 는 author-submitted, NOT algorithmic.** Coursera 가 `productDifficultyLevel=Advanced` 를 faceted filter 로 노출, but engineering blog 어디에도 algorithmic auto-tag 기술 없음. **Could not verify** 자동 pipeline.

### Signal accuracy ranking

| Signal | Accuracy (lit. est.) | Cost | Coverage | Notes |
|---|---|---|---|---|
| **Transcript + BERT/LLM classify** | **0.85–0.95** (CEFR analog) | High (LLM) / Med (BERT) | partial (transcript 가용성) | **최강 signal**, transcript 없으면 X |
| Title + description regex | 0.60–0.75 (rough est.) | ~0 | 100% | High precision on explicit "초급/심화/beginner/advanced"; low recall |
| LLM zero-shot on title+desc | 0.75–0.85 (analog text-class) | ~$0.0001–0.001/video (Haiku/Flash) | 100% | 강력 fallback; 작은 모델로 저렴 |
| `video_rich_summaries.depth_level` (우리 것) | High (LLM-generated) | already paid | **30%** | populated 시 ground truth |
| Duration | **Weak** (type-confounded) | 0 | 100% | tiebreaker only, primary 사용 금지 |
| Channel/view-velocity | **Could not verify** | 0 | 100% | 난이도 correlation literature 없음 |

### Recommended hybrid approach for Insighta (4-layer cascade)

- **Layer 0 (free, 30% coverage):** `video_rich_summaries.depth_level` 존재 시 ground truth 로 신뢰.
- **Layer 1 (free, ~50% 잔여 coverage):** Title+description regex with explicit difficulty markers.
  - Korean: `(초급|기초|입문|쌩초보|왕초보|기초부터)` → beginner; `(중급|심화|고급|상급|마스터|전문가|deep dive)` → advanced.
  - English: `(beginner|intro|crash course|for dummies|getting started|101)` → beginner; `(advanced|expert|deep dive|masterclass|in[- ]depth|part \d{2,})` → advanced.
  - **Conflict 패턴** ("기초부터 심화까지", "advanced beginner") → ambiguous 마킹 → Layer 2 escalate.
- **Layer 2 (LLM fallback, ambiguous only):** 미매칭/ambiguous 만 cheap model (Gemini Flash / Haiku) 로 title+desc 전송. Hybrid LLM Routing paper 근거: ~66% 비용 절감 vs LLM-everything.
- **Layer 3 (transcript+LLM, lazy, 기존):** `depth_level` 생성 그대로 유지. populated 시 Layer 0 으로 자동 승격.
- **Duration**: tiebreaker only (beginner↔intermediate 또는 intermediate↔advanced 모호 시). <5분 → beginner bias, >30분 → advanced bias. **primary signal 금지**.

### Open-source repos worth examining

- [textstat/textstat](https://github.com/textstat/textstat) — Python readability (Flesch-Kincaid, Gunning Fog, SMOG, Dale-Chall). 4k+ stars. 영어 transcript 용 general-purpose.
- [cdimascio/py-readability-metrics](https://github.com/cdimascio/py-readability-metrics) — 대체 readability; cleaner API.
- [tareknaous/readme](https://github.com/tareknaous/readme) — ReadMe++ multilingual readability dataset+benchmark (EMNLP 2024); multilingual eval.
- KRIT (KAIST) — Korean readability transformer; **paper only, public GitHub release 미확인**.
- **Could not verify**: actively maintained "YouTube video difficulty classifier" repo 부재. `youtube-8m` 류는 category 분류이지 difficulty 아님.

### Pitfalls / known false-positive patterns

- **Marketing-word inflation**: "Master class", "Pro tips", "Expert guide" 가 beginner 콘텐츠에 자주 사용. "master/pro/expert" 는 technical jargon density 와 동반 시에만 신뢰.
- **"기초부터 심화까지" / "beginner to advanced"** — range marker. **intermediate** 또는 **mixed** 분류, advanced 아님.
- **"Advanced beginner"** — CEFR A2/B1 정형 label. Transcript 없을 시 safest = beginner.
- **Course-number trap**: "Part 1" ≠ beginner; "Lecture 12" ≠ advanced. index 로 추론 금지.
- **Duration confound**: 긴 영상 = podcast/lecture/vlog. tutorial 은 2-3분 cap (MIT study).
- **Language mismatch**: Korean text in English-template title ("[입문] Python tutorial") — language-detect-then-route 대신 multi-language regex **parallel 평가** 필요 (bilingual 신호 보존).

### Confidence assessment

- **High**: Hybrid rule+LLM cost saving (~66%, cited); BERT > zero-shot LLM on classification (cited); duration type-confounded (MIT study); Coursera = author-submitted (URL param verified).
- **Speculative**: title regex 0.60-0.75 / zero-shot LLM 0.75-0.85 정확도 범위 — analog text-classification benchmark 추정, video-difficulty 측정 아님.
- **Could not verify**: Khan/Udemy/edX 의 자동 difficulty tagging 여부. view-velocity / comment pattern 의 난이도 correlation. 유지보수 중인 YouTube difficulty classifier repo. Korean YouTube difficulty regex 패턴 학술 study.

### Primary sources

- [Text-based Question Difficulty Prediction Systematic Review (Springer IJAIED 2023)](https://link.springer.com/article/10.1007/s40593-023-00362-1)
- [Automated Classification of Written Proficiency on CEFR (Kerz BEA 2021)](https://aclanthology.org/2021.bea-1.21/)
- [KRIT Korean readability index (KAIST)](https://koasas.kaist.ac.kr/handle/10203/309526)
- [Hybrid LLM Routing (arXiv 2507.08250)](https://arxiv.org/abs/2507.08250)
- [Fine-Tuned Small LLMs Outperform Zero-Shot (arXiv 2406.08660)](https://arxiv.org/html/2406.08660v1)
- [How Video Production Affects Engagement (Guo LAS 2014)](https://up.csail.mit.edu/other-pubs/las2014-pguo-engagement.pdf)
- [ReadMe++ Multilingual Readability (EMNLP 2024)](https://aclanthology.org/2024.emnlp-main.682.pdf)
- [textstat](https://github.com/textstat/textstat) · [py-readability-metrics](https://github.com/cdimascio/py-readability-metrics)
- [Duolingo CEFR alignment](https://blog.duolingo.com/goldilocks-and-the-cefr-levels-which-proficiency-level-is-just-right/)
- [Coursera Advanced filter (URL param)](https://www.coursera.org/courses?query=algorithms&productDifficultyLevel=Advanced)

---

<a id="r2"></a>
## R2 — YouTube Discovery System Best Practices

### Top findings

- **`search.list` is randomized over time.** 학술 study ([arxiv 2506.04422v2](https://arxiv.org/html/2506.04422v2), §4.1-4.2) 가 동일 query 12주 반복 → Jaccard similarity 가 시간에 따라 substantially drop. YouTube 가 "topical interest density" 에서 sample 하며, density 가 낮으면 zero return 강제.
- **가장 강한 ranking signals**: **view count + duration (짧을수록 우대)**. 같은 paper §5 — "number of views ... is the most important feature" + "shorter videos tend to have more returns". Channel popularity < channel age.
- **`search.list` = 100 units, `playlistItems.list` / `videos.list` = 1 unit.** 10k/day quota = max 100 search calls. Batched `videos.list` (50 IDs/call) = 500k videos/day 이론치. ([quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost))
- **`search.list` + `channelId` + `type=video` = 500 results hard cap.** Pagination 으로 못 뚫음. ([official docs](https://developers.google.com/youtube/v3/docs/search/list))
- **`relevanceLanguage` = soft hint, not filter.** "results in other languages will still be returned if highly relevant". `regionCode` default = US.
- **`videoCategoryId` accuracy 공개 study 없음.** No public reliability study. **advisory only — do not hard-filter on it.**
- **`order=relevance` ranking factor 공식 문서 silent.** Google 의도적 비공개; researcher 만 black-box probe.

### Known vs guessed ranking signals

| | Known (cited) | Speculative |
|---|---|---|
| **확실** | view count primacy, duration bias (짧을수록), channel age, topic-pool density. `order` param semantics. | — |
| **불확실** | — | title-keyword > tags > description weighting (SEO 블로그 주장하지만 official 검증 실패). videoCategoryId 정확도. 인자 순서 효과. |

### Pool building: industry patterns

| Pattern | Pros | Cons | Used by |
|---|---|---|---|
| `playlistItems.list` on channel uploads playlist | **1 unit**; complete channel history | 채널 사전 식별 필요 | arxiv 2506.04422v2 §6 권장 — search.list 보다 저렴 |
| Pre-cached pool + realtime fallback | Quota-bounded; fast Tier 1 | Staleness; cold-start gaps | **Insighta v3 (우리)**; [Music-Tomorrow 2025](https://www.music-tomorrow.com/blog/a-complete-guide-to-youtube-recommendation-algorithms-for-music-and-artists) |
| Two-tower candidate gen + ranker | 수백만 scale | Heavy infra; offline training | YouTube 내부 ([Covington 2016](https://research.google/pubs/pub45530/)); [xei/recommender-system-tutorial](https://github.com/xei/recommender-system-tutorial) |
| Scrape-based (no API) | No quota | ToS-grey; brittle | [Invidious](https://github.com/iv-org/invidious), [Piped](https://github.com/TeamPiped/Piped), [NewPipe](https://github.com/TeamNewPipe/NewPipeExtractor) |

### Multi-query fan-out: optimal ratio

- YouTube 특정 "20×50 diminishing returns" 곡선 공개 study **could not verify**.
- General findings: (a) **topic-pool diversity > fan-out count** — small pools (5k-65k) 가 "much higher consistency" (arxiv §4); (b) RecSys 일반 — offline-only 평가 시 "accuracy gains beyond a certain point provide diminishing returns" ([Databricks blog](https://www.databricks.com/blog), MLOps Community 2024).
- 실무 휴리스틱 (recsys 커뮤니티): fan-out ≤ 8-10 sub-queries 가 duplicate-ratio explosion 직전 knee point.

### Quota economics tactics

- **`search.list` → `channels.list` + `playlistItems.list` 대체** (채널 확정 시): 100 → 2 units. arxiv §6 명시 권장.
- **`videos.list` 50 IDs/call batch** (1 unit per 50).
- **ETag + `If-None-Match`** 변경 없는 리소스용.
- **`fields=` param** 으로 불필요 필드 strip.
- **Tiered cache TTL**: static (title/desc) 24h; dynamic (view) 1-6h. → 5-10× quota 확장 보고. ([dev.to/siyabuilt](https://dev.to/siyabuilt/youtubes-api-quota-is-10000-unitsday-heres-how-i-track-100k-videos-without-hitting-it-5d8h), [Phyllo 2026](https://www.getphyllo.com/post/youtube-api-limits-how-to-calculate-api-usage-cost-and-fix-exceeded-api-quota))

### Open-source repos worth examining

- **[yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp)** — extractor 기반 비공식 API. Metadata parsing edge case 레퍼런스.
- **[iv-org/invidious](https://github.com/iv-org/invidious)** — pure scrape, "Does not use official YouTube APIs".
- **[TeamPiped/Piped](https://github.com/TeamPiped/Piped)** — NewPipeExtractor 활용 lightweight 프런트.
- **[TeamNewPipe/NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor)** — 비공식 extraction 의 가장 reusable 라이브러리.
- **[xei/recommender-system-tutorial](https://github.com/xei/recommender-system-tutorial)** — two-tower retrieval+ranking with TFRS. 우리 pgvector → Cohere rerank pipeline 과 parallel.

### Gaps in our v3 pipeline vs best practice

1. **Cohere rerank query = centerGoal only** — known root cause (이번 fix 핵심). focusTags concat 필요.
2. **No `playlistItems.list` cheap path** — known-good channel allowlist 도입 시 quota 100× 절감 가능.
3. **Cap rules (channelCap=2, subgoalCap=4) post-rerank 적용** — focusTag-matched 영상이 사용자 노출 전 잘려나감. focusTag bypass 필요.
4. **`videoCategoryId` 신뢰** — 공개 study 부재. **advisory only**, hard-filter 사용 금지.
5. **Multi-query fan-out 20×50 = 1000 candidates** — diminishing-returns knee 초과 가능성. query-pool diversity > fan-out depth 가 evidence.
6. **`relevanceLanguage=ko` 만 의존** — soft hint. `videos.list` 의 `defaultLanguage` / `defaultAudioLanguage` post-filter 필요.

### Confidence assessment

- **High**: quota economics, search.list randomization, 500-result cap, param semantics (공식 docs + peer-reviewed paper).
- **Medium**: ranking signal hierarchy (single empirical paper, no Google 확인).
- **Low / unverifiable**: videoCategoryId 정확도, 정확한 fan-out diminishing returns curve, industry-standard cache-vs-realtime 비율.

### Primary sources

- [Search: list official docs](https://developers.google.com/youtube/v3/docs/search/list)
- [arxiv 2506.04422v2 — On YouTube Search API Use in Research](https://arxiv.org/html/2506.04422v2)
- [Quota Calculator](https://developers.google.com/youtube/v3/determine_quota_cost)
- [Invidious](https://github.com/iv-org/invidious) · [Piped](https://github.com/TeamPiped/Piped) · [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [Music-Tomorrow YouTube recommendations guide 2025](https://www.music-tomorrow.com/blog/a-complete-guide-to-youtube-recommendation-algorithms-for-music-and-artists)

---

<a id="r3"></a>
## R3 — Cross-encoder Rerank + User Filter Integration

### Top findings

- **Cohere Rerank 3.5+ 는 "complex queries with constraints" 를 위해 설계됨** — user filter 를 query string 에 **concat** 권장, post-hoc filter 아님. Rerank 3.5 의 headline = "reasoning datasets" 에서 **+23-30% P@1**. ([VentureBeat Dec 2024](https://venturebeat.com/ai/cohere-rerank-3-5-is-here-and-its-about-to-change-enterprise-search-forever), [Cohere changelog](https://docs.cohere.com/changelog/rerank-v3.5))
- **YAML structured-document format 이 공식 multi-field doc 표현** — truncation 때문에 key 순서 중요. `sort_keys=False` 필수. ([Cohere best practices](https://docs.cohere.com/docs/reranking-best-practices))
- **Query token 한도**: v3.0/v3.5 = 2,048 query / 4,096 total; v4.0 = 16,384 query / 32,768 total.
- **Reranker = precision 도구, recall 도구 X** — "retriever 가 candidate set 결정; reranker 는 그 안 순서만 결정. recall 낮을 때 rerank 는 오히려 해롭다." ([Label Your Data](https://labelyourdata.com/articles/llm-fine-tuning/rag-evaluation))
- **Pre-filter risk = top_k 작을 때 "data loss"**. Hybrid (pre + post) 가 production 표준. **95 candidates 는 위험 구간**. ([dev.to Volland](https://dev.to/volland/pre-and-post-filtering-in-vector-search-with-metadata-and-rag-pipelines-2hji))
- **Hard cap (channelCap, sliding window) = YouTube 의 _legacy_ 패턴.** DPP 로 migration: "rule cap 은 brittle 하고 stack 시 잘 안 어울림". ([mlwhiz Re-Ranking](https://www.mlwhiz.com/p/reranking-recsys-diversity-freshness))
- **MMR 이 standard middle-ground**: post-score reranker, no external API, `λ ∈ [0,1]` 로 relevance vs diversity. 권장 시작 `λ=0.5`. ([Qdrant MMR](https://qdrant.tech/blog/mmr-diversity-aware-reranking/), [Elastic Search Labs](https://www.elastic.co/search-labs/blog/maximum-marginal-relevance-diversify-results))

### Filter injection patterns ranked by industry adoption

| Pattern | Adoption | Recall impact | Precision impact | Best for |
|---|---|---|---|---|
| **Concat into query** (`centerGoal + " " + focusTags`) | **HIGH (Cohere 권장 for v3.5+)** | None (rerank-only) | +23-30% on constraint queries | Soft preferences, multi-aspect goals |
| **YAML structured docs** (focusTag as doc field) | HIGH (Cohere official) | None | High when truncation respected | Document metadata exposure |
| **Hard pre-filter before rerank** | HIGH for must-haves (e.g. `lang=ko`) | -10-40% if filter too narrow | Highest when filter accurate | Compliance, exclusion, strict ACL |
| **Score-bias post-rerank** (`rerank × focusBonus`) | MEDIUM (LangChain) | None | Lower than constraint-in-query | Soft personalization |
| **Constrained MMR / DPP** (caps as diversity term) | MEDIUM-HIGH (YouTube DPP, Qdrant) | None | High; rule cap 대체 | Channel/topic diversity |
| **Separate rerank pass per facet** | LOW | Costly | Marginal vs concat | Rarely justified |

### Cohere-specific quirks

- **Query format for constraints**: 자연어 concat. VentureBeat coverage: Rerank 3.5 "handles complex search constraints that usually break systems" via cross-encoding — **constraint 는 query text 안에**.
- **Multilingual**: 100+ langs, +26.4% cross-lingual on v3.5; v3.0 multilingual 이 prior gen.
- **top_n**: docs cap = 10,000/call; **≤1,000 권장** (latency).
- **YAML truncation**: long docs end 부터 truncate → 가장 관련 필드 (title, focusTag, topic) 를 **첫 번째**에.

### Hard filter vs soft score — 깨지는 조건

- **Hard filter 깨짐**: (a) candidate set 이 이미 작음 (≤100, **우리 ~95 는 danger zone**), (b) filter 가 _preference_ 가 _requirement_ 아닐 때 — 예: `difficulty=intermediate` 이 완벽한 beginner 해설 영상 제외.
- **Soft score 깨짐**: (a) bonus 크기가 rerank signal 압도, (b) 모든 filter 값에 uniform bonus (calibration 없음). 일반 원칙: rerank score [0,1] → multiplicative bonus ≤1.2-1.5× 가 ordering 보존.

### Cap-aware reranking

YouTube 의 documented evolution: **rule cap (sliding window n-of-m) → DPP / learned diversity** — "rule-based 접근이 brittle, stack 시 poor compose". Insighta 규모에서 **MMR over rerank scores with `λ≈0.3-0.5`** 가 documented industry middle-ground. 순수 caps (channelCap=2, subgoalCap=4) 는 debug 가능하지만 lossy.

### Recommended pattern for Insighta (3-step concrete)

1. **Query enrichment** (zero infra change): rerank query = `${centerGoal} (focus: ${focusTags.join(", ")}; level: ${difficulty})`. Rerank 3.5 의 native constraint reasoning 활용. Negative filter → `"exclude: beginner"` 같은 string 추가 (v3.5 가 negation 처리).
2. **YAML-format docs** with field order `title → focusTagsMatched → channel → difficulty → description`. truncation 이 절대로 user-aligned signal 제거 안 함. `sort_keys=False`.
3. **Replace post-rerank channelCap=2/subgoalCap=4 with MMR over rerank scores** (`λ=0.4`, similarity = same-channel OR same-subgoal indicator). Hard filter 는 진짜 exclusion (language, policy) 에만. **A/B 측정**: 동일 query set 위에서 `nDCG@10`, `recall@50 pre/post`, `p99 latency` 삼각 측정.

### Open-source production examples

- **LangChain `CohereRerank` + `ContextualCompressionRetriever`** — `EmbeddingsFilter` + `CohereRerank` chain 가능; ≥800 tokens truncation 버그 알려짐. ([LangChain discussion #17865](https://github.com/langchain-ai/langchain/discussions/17865))
- **Qdrant Universal Query API** — native `prefetch` 가 cheap-vector candidate retrieval → full-vector rerank with metadata filter as first-class.
- **Pinecone `pinecone-rerank-v0` + slab-partitioned metadata index** — ICML 2025 paper 가 pre-filter-during-search 아키텍처 문서화.
- **OpenSearch MMR vector search** — documented `λ` param.
- **YouTube DPP** — rule cap 대체 case study.

### Confidence assessment

- **HIGH**: concat-into-query 는 Cohere v3.5 design intent; YAML doc format 은 canonical Cohere guidance; MMR-over-rerank-scores 는 Qdrant/Elastic/OpenSearch 모두 문서화.
- **MEDIUM**: cap→MMR migration 권장 = YouTube/RecSys industry survey 외삽; Insighta-specific benchmark 부재. A/B 측정 필수.
- **LOW/CAVEAT**: Cohere docs 가 "constraint-in-query" vs "hard pre-filter" 구체 benchmark 공개 안 함. +23-30% 는 Cohere 내부 "reasoning dataset" P@1, tag-filter task 아님. 95 candidates 의 recall regression 은 theoretical (dev.to general guidance) — Insighta 측정 필수.

---

<a id="r4"></a>
## R4 — Explicit User Signal in Personalized Recommendation

### Top findings

- **Spotify "Exclude from Taste Profile" (Oct 2023)**: explicit per-playlist exclusion 을 **inference 보다 의도적으로 선택** — "Since we aren't mind readers, we decided not to assume what other content a user might want excluded just from a single action." Playlist-level scope, **+4% recs consumption, +10% overall consumption**. ([Spotify Eng](https://engineering.atspotify.com/2023/10/exclude-from-your-taste-profile))
- **TikTok "Not Interested" algorithmic persistence (CHI 2025)**: explicit negative signal 이 implicit (skip) 보다 효과적, 그러나 FYP 가 같은 장르를 다른 hashtag 로 resurface. **사용자가 feedback loop 실패 시 plat 떠남**. ([arXiv 2504.13895](https://arxiv.org/html/2504.13895v1))
- **LinkedIn Recruiter "Must have / Can have / Doesn't have"**: facet 별 3-state operator → hard vs soft constraint 가 **사용자 통제 UX primitive**, hidden algorithm choice 아님. ([LinkedIn Help](https://www.linkedin.com/help/recruiter/answer/a414281))
- **Airbnb filters as hard constraints**: "filter 적용 시 amenity 없는 listing 은 모든 quality signal 무시하고 사라짐". Location 은 soft (ranked), guest/dates/amenities 는 hard. ([Airbnb Help](https://www.airbnb.com/help/article/39))
- **Pinterest soft-spacing (Apr 2026)**: hard filter 에서 **멀어짐** → "soft spacing penalty with weight λ" — absolute exclude 아닌 penalty cost. ([Pinterest Eng](https://medium.com/pinterest-engineering/evolution-of-multi-objective-optimization-at-pinterest-home-feed-06657e33cd10))
- **YouTube Shorts dislike/Not Interested merge (Dec 2025)**: A/B 가 사용자가 두 button 을 interchangeably 사용 보임. Mozilla 2022 — feedback "slightly reduces" bad recs, **eliminate 안 함**. ([Mozilla report](https://www.mozillafoundation.org/en/research/library/user-controls/report/meager-and-inadequate-a-quantitative-analysis-of-youtubes-user-controls/))
- **Constraint-based RecSys (Felfernig/Burke)**: canonical 학술 framing — "weighted hard and soft user requirements와 item feature 중재". ([Springer](https://link.springer.com/chapter/10.1007/978-1-4899-7637-6_5))
- **Duolingo CEFR mapping**: content 가 정적으로 A1-B2 태깅, **algorithmic difficulty-rerank 공개 X**. 사용자 goal framing 이 filter trust 대체. ([Duolingo blog](https://blog.duolingo.com/goldilocks-and-the-cefr-levels-which-proficiency-level-is-just-right/))

### Explicit vs implicit signal arbitration

| Scenario | Industry default | Insighta current | Gap |
|---|---|---|---|
| User-stated entity (focusTags="오태민") | Hard filter (Airbnb/LinkedIn "Must have") | Soft boost via embedding (사실상 안 됨) | **explicit hard-include lane 필요** |
| User-stated difficulty | Static metadata tag, no rerank (Duolingo) | BE 미적용 | **enforcement 검증 또는 UI 제거** |
| Negative ("don't show") | Explicit > implicit; scope 보수적 (Spotify per-playlist) | Heart/archive (CP461) per-card | per-mandala vs global scope 정의 필요 |
| centerGoal | Soft rerank (Coursera/embed) | Embedding center | **정렬됨** |

### Honoring user-stated difficulty — production patterns

- **Pattern A (Duolingo): static tag + course structure** — difficulty 가 course-design-time, runtime filter 아님. 모든 B1 course 콘텐츠가 B1 이라 "beginner 받음" 자체가 불가.
- **Pattern B (LinkedIn Recruiter): user-controlled hardness** — "Must have advanced" = hard exclude; "Can have advanced" = soft boost. 플랫폼 측 추측 제거.
- **Pattern C (Pinterest soft-spacing): weighted penalty λ** — never absolute exclude; engagement 와 balance.
- **Trust-impact evidence**: TikTok study (n=14) — algorithmic persistence (explicit "not interested" override) 가 account deletion 견인. Mozilla 2022 — "each control slightly reduces bad rec rate" but users "still served many bad recommendations."

### Multi-signal weighting

- **Constraint-based weighted MaxSAT** (Felfernig): satisfied weighted constraint 합으로 rank.
- **Pinterest DCN-v2 / multi-objective**: explicit feature crossing layer; objective 별 λ-weighted soft penalty.
- **Spotify two-stack separation** ([Jan 2026](https://engineering.atspotify.com/2026/1/why-we-use-separate-tech-stacks-for-personalization-and-experimentation)): personalization stack 과 experimentation stack 분리 — signal weight 가 online experiment 으로 tune, hardcode 아님.
- **public source 가 centerGoal:focusTags:difficulty numeric ratio 공개 X** — universally online A/B 로 tune.

### EdTech-specific UX patterns

- **Duolingo**: course 를 level path 로 구조화 → difficulty 가 runtime filter 가 아닌 **course identity**. filter-trust failure 우회.
- **Coursera adaptive learning**: course 내 right/wrong rate 로 difficulty 조정, search-time filter 아님.
- **Khan Academy Adaptive Practice**: ability-or-slightly-above (mastery model) 로 선택, user-stated difficulty 아님.
- Pattern: EdTech 는 **"user 가 intermediate 선택, beginner 받음" 실패 모드를 level=course membership property 로** 회피.

### Transparency vs silent fail

- "system under-supply surface" 공개 A/B 숫자 없음.
- Adjacent evidence: Mozilla — 사용자가 ineffective 한 control 포기. TikTok — silent persistence 가 churn 견인 ("deliberately resistant to their adaptation attempts").
- **추론**: silent fail 이 dominant industry pattern, 그러나 TikTok/Mozilla evidence 가 transparent under-supply disclosure 보다 trust 빠르게 erode 시사.

### Per-tenant algorithm config — prevalence

- **LinkedIn Recruiter**: per-recruiter saved searches with operator override.
- **Multi-tenant SaaS RecSys guidance**: "global defaults + tenant override via metadata-driven config" 가 documented best practice. Netflix/Spotify 는 single-tenant 라 비공개.
- **Pinterest**: "config-based framework" 가 platform (not user) granularity.
- Per-mandala algorithm override (Insighta) 는 B2C RecSys 에선 unusual 하지만 **B2B SaaS per-tenant config pattern 과 정렬**.

### Recommended explicit-signal flow for Insighta

1. **LinkedIn 3-state operator UX 채택** for focusTags: Must-have (hard) / Can-have (boost) / Don't-show (exclude). "오태민" intent 의 platform 측 추측 제거.
2. **Difficulty 를 Duolingo-style course-membership tag 로 처리** — runtime filter 가 아닌 video_pool ingest 시 A1/A2/B1/B2 equivalent tag. result set < N 일 때 explicit "under-supply" badge 노출.
3. **Negative signal scope = per-mandala 기본** (Spotify per-playlist conservatism 일치), explicit "apply to all" toggle.
4. **Under-supply 투명 노출**: "12 results at Advanced, 47 if we include Intermediate — show more?" (TikTok silent-persistence trust loss 회피).
5. **Weight tuning via A/B**, hardcoded ratio 금지 — Spotify two-stack pattern 따라. 기존 per-mandala override 가 experimentation unit.

### Confidence assessment

- **High**: Spotify exclusion, Airbnb hard-filter, LinkedIn operator UX, TikTok persistence, Pinterest soft-spacing (모두 direct primary source).
- **Medium**: Duolingo difficulty (blog, engineering paper 아님); Coursera/Khan adaptive (general article).
- **Low**: specific numeric weight ratio (공개 X); per-tenant override prevalence (B2B SaaS guidance, consumer RecSys 아님); transparency A/B numbers.

---

<a id="r5"></a>
## R5 — Search Algorithm Versioning + A/B Comparison

### Top findings

- **Interleaving > A/B for ranking changes** 가 Airbnb (50x sensitivity), Netflix, Etsy, DoorDash, Booking.com 표준. A/B 만으로는 ranking iteration 에 느림. ([Airbnb](https://medium.com/airbnb-engineering/beyond-a-b-test-speeding-up-airbnb-search-ranking-experimentation-through-interleaving-7087afa09c8e), [Netflix](https://netflixtechblog.com/interleaving-in-online-experiments-at-netflix-a04ee392ec55), [Etsy](https://www.etsy.com/codeascraft/faster-ml-experimentation-at-etsy-with-interleaving))
- **Mature platform 이 config plane 과 code plane 분리**: LaunchDarkly 가 "model versions, prompts, parameters" 를 flag-controlled — versioned, segment-targeted, gradual deploy, redeploy 없는 rollback. ([LaunchDarkly AI](https://launchdarkly.com/))
- **Replica-index pattern (Algolia)**: ranking variant 가 **separate index object**, in-place mutation 아님 — "Algolia index 의 ranking 을 dynamically change 불가, but replica indices 사용 가능". ([Algolia A/B docs](https://www.algolia.com/doc/guides/ab-testing/what-is-ab-testing/how-to/create-and-run-an-ab-test))
- **Vespa multiple rank-profiles + inheritance**: schema 당 임의 다수 `rank-profile`, query time 에 `ranking.profile` 로 선택, inheritance 로 duplication 회피. ([Vespa Ranking](https://docs.vespa.ai/en/ranking.html))
- **DoorDash Curie + Dash-AB**: _configuration platform_ + _analysis platform_ + _metrics platform_ — 셋, 하나 아님. ([DoorDash Curie](https://careersatdoordash.com/blog/meet-dash-ab-the-statistics-engine-of-experimentation-at-doordash/))
- **Pinterest 가 query 를 head/torso/tail/single 로 segment** 후 per-segment heterogeneous treatment effect 보고 — single topline 부족. ([Pinterest LLM Relevance](https://medium.com/pinterest-engineering/llm-powered-relevance-assessment-for-pinterest-search-b846489e358d))
- **LinkedIn Lix Engine** 이 population 을 cohort (segment) 별로 split → per-segment **independent randomized splitting** — 정확히 우리 per-mandala override use case. ([LinkedIn XLNT](https://engineering.linkedin.com/ab-testing/xlnt-platform-driving-ab-testing-linkedin))
- **Bad-config outage = hot-reload 의 #1 risk**. Google 2025 outage: quota-policy update 의 blank field 가 dormant code 의 null-pointer crash 글로벌 hit. Postmortem: "easy and reliable rollback 보장". ([Unleash Google outage](https://www.getunleash.io/blog/google-outage-feature-flags))

### Versioning naming patterns

| Pattern | Used by | Pros | Cons |
|---|---|---|---|
| SemVer (`v1.2.3`) | ML model artifact | compat breakage signal | 주관적: ranker 의 "major" 가 뭐? |
| CalVer (`2026.05.26`) | Python ecosystem | Sortable, debate 없음 | compat signal 없음 |
| Human-named (`v1-current`, `v0-pre-cp488`) | **Insighta**, Vespa rank-profile | Memorable, checkpoint 연결 | sort 안 됨, 재사용 collision |
| Commit-hash | MLflow registry | Immutable, reproducible | UI 에서 unreadable |
| Hybrid (`1.23.20231111-beta+spanish.L2-H128`) | Production ML | metadata 동반 | Parse complexity |

### Per-tenant override — prevalence + maintenance trap

LinkedIn (Lix per-segment), Pinterest (per-query-popularity cohort), Booking (namespaced experiment) 에서 common. **Maintenance trap**: Algolia 가 경고 — "index 가 incredibly easily out of sync, test invalidate". LinkedIn 의 mitigation: dynamic targeting 이 treatment 자체와의 interaction 을 test 해야 — member 가 variant 간 switching 방지. **Best practice = override 는 expiry 있는 time-boxed exception, 영구 snowflake 아님**.

### A/B comparison admin UI — mature system 이 보이는 것

- **Per-segment delta**: Pinterest head/torso/tail/single.
- **Time-series with confidence band**: Etsy _Imbalance Detection_.
- **Statistical-significance gate**: Booking 이 SRM (Sample Ratio Mismatch) check + power calculator auto; DoorDash Dash-AB 가 p-value + CI return.
- **Guardrail metric**: Booking 이 topline 전 guardrail dashboard surface.

### Config vs Secret — when to use which

- **DB JSONB row** (우리 `parameters`): ops/PM 이 편집하는 tuning knob (weight, threshold, TTL). Statsig Dynamic Config 가 "ranking system, algorithm" 에 정확히 이 pattern 권장.
- **env var**: deploy-coupled boot config (DATABASE_URL, ports). CLAUDE.md "Secret vs Config 2-question test" 일치.
- **Feature-flag service**: gradual rollout %, per-user-bucket targeting, <1s kill-switch SLA 필요 시. 2 algorithm variant 에는 overkill.

### Hot-reload safety rails

- **Schema-validate writes** — Google outage root cause = "policy update 의 blank field".
- **Audit log + RBAC** — "변경마다 detailed audit log".
- **Canary cohort first** — Netflix canary "full release 전 quality-control gate".
- **Auto-rollback on guardrail breach** — PostHog flag service post-mortem 이 untested rollback 을 #1 hampering factor 로 인용.
- **Default = previous-known-good** — resolver 가 row 찾기 실패 시 compiled default 로 fall through (crash X).

### Trace stamping at scale

- Mature system 에서 common 하지만 **비싸다**: span-level sampling 이 trace size **81.2% 감소**하며 모든 request trace 보존 가능. ([arxiv 2509.13852](https://arxiv.org/html/2509.13852v1))
- Cardinality explosion: unique ID 를 label 로 붙이면 time-series count 폭발. Mitigation: `algorithm_version` 을 **low-cardinality** label 로 유지 (우리 ~5 version 안전), user_id 아님.

### Insighta design gap analysis

| Insighta now | Industry standard | Gap | Priority |
|---|---|---|---|
| `algorithm_version` text on trace | Universal at mature | None | — |
| Mandala-override > global fallback | LinkedIn Lix cohort splitting | **expiry timestamp 없음** → snowflake risk | **HIGH** |
| Admin "activate" instant flip | LaunchDarkly hot-reload | **schema validation 없음** on `parameters` JSONB; **audit log 없음**; **RBAC 없음** | **HIGH** |
| Two seeded version | Vespa N-profile inheritance | inheritance 없음 → 신규 variant 마다 param copy | MED |
| A/B comparison view | Pinterest per-segment + Dash-AB SRM | **statistical-significance gate 없음**; **per-mandala metric delta 없음**; **SRM check 없음** | **HIGH** |
| Human-named (`v0`, `v1`) | Hybrid SemVer + metadata | machine-sortable order 없음, `valid_from`/`valid_to` 없음 | MED |
| `is_active` boolean | Gradual % rollout | binary activate → instant 100% blast radius | **HIGH** |

### Recommended additions (concrete)

1. **Zod schema validation** on `parameters` JSONB write path — API boundary 에서 bad config block (Google-outage prevention).
2. **`rollout_percentage` column** + deterministic hash bucketing on `mandala_id` → gradual ramp 1% → 10% → 100%.
3. **`expires_at` on `mandala_algorithm_overrides`** + cron sweep — snowflake accumulation 차단.
4. **Audit log table** (`algorithm_version_audit`): who/when/what-changed/previous-value — rollback diagnosis 필수.
5. **Inheritance** (`parent_version_id`): 신규 variant = base + diff, full copy 아님 (Vespa pattern).
6. **SRM check on comparison view**: variant 별 assignment-rate parity (Booking 표준); skew 있는 experiment reject.
7. **Per-mandala metric delta + 95% CI** on A/B view, raw count 아님 (Pinterest 표준).
8. **Compile-time default fallback** — resolver 가 row 못 찾을 때 accidental DELETE 에도 crash X.
9. **Sample-and-stamp** trace_id every Nth request beyond raw `algorithm_version` to cap storage.

### Confidence assessment

**High**: pattern (interleaving, replica indices, hot-reload risk, per-segment analysis) — 각 4+ engineering blog 에서 cross-reference. **Medium**: 정확한 naming convention — SemVer vs CalVer vs custom community split. **High**: 9 권장사항 — 각 cited postmortem 또는 design pattern 매핑. Insighta 현재 design 이 **directionally correct vs industry** (trace-stamped versioning + per-tenant override 가 LinkedIn/Pinterest/Booking 가 하는 것); gap 은 **safety rail**, architecture 아님.

---

<a id="synthesis"></a>
## §6 — Synthesis + Insighta 권장 spec + ship plan

### 한 줄 결론

> **"오태민" 검색 surface 3개 문제 = Cohere query 가 centerGoal only + cap rule 이 focusTags bypass 없음 = R3 가 highest-impact 단일 변경. 그러나 R1/R4/R5 의 cross-cutting insight 가 사용자 trust 와 systemic safety 의 1차 의존성.**

### 5-research cross-cutting insights

| Insight | 근거 영역 | Insighta 함의 |
|---|---|---|
| **Constraint 를 query 안에 넣는다** | R3 (Cohere v3.5 design intent) | Cohere query = `centerGoal + focusTags + difficulty + "exclude: <other>"`. **highest-impact 단일 변경**. |
| **Difficulty 는 video tag, runtime filter 아님** | R1 (4-layer cascade) + R4 (Duolingo course-membership) | video_pool ingest 시 `depth_level` 박힘. runtime 매번 평가 X. populated rate ↑ → 정밀도 ↑. |
| **focusTags 는 3-state operator** | R4 (LinkedIn Recruiter) | `[{tag, mode: 'must'\|'should'\|'must_not'}]`. plat 측 추측 제거. |
| **Hard cap → MMR with λ=0.4** | R3 (YouTube DPP) | channelCap=2, subgoalCap=4 deprecate, MMR over rerank score. focusTag-matched 영상 자연스러운 우대. |
| **Under-supply 투명** | R4 (TikTok silent persistence trust loss) | "12 at Advanced, 47 with Intermediate — expand?" CTA. |
| **Algorithm versioning 9 safety rail** | R5 (Google outage, LaunchDarkly, LinkedIn Lix) | zod schema validate + expires_at + audit log + rollout_pct + SRM + inheritance + compile-time fallback. |
| **YouTube quota: channel allowlist 패턴** | R2 (arxiv §6) | known-good channel (e.g. 오태민) 의 `playlistItems.list` (1 unit) → quota 100× 절감 + 신선도 ↑. |

### 권장 ship sequence (PR-by-PR, dependency-ordered)

| # | PR | 핵심 변경 | 추정 줄 | 의존성 | 시급도 |
|---|---|---|---|---|---|
| **1** | **Cohere query enrichment + YAML docs** (R3) | rerank query = `centerGoal + focusTags + difficulty + exclude`; doc YAML field order; top_n ≤ 96 유지 | ~30 | none | **🔥 즉시** ("오태민" 문제 직접 해결) |
| **2** | **Difficulty 4-layer cascade + FE wiring** (R1) | depth_level → KR/EN regex → Haiku fallback → transcript; AddCardsBody.difficulty; ambiguous "기초부터 심화까지" → intermediate | ~150 | none (PR 1 과 병행 가능) | **🔥 즉시** (사용자 trust 회복) |
| **3** | **focusTags 3-state + applyCapsAndSort → MMR** (R3+R4) | `focusTags: [{tag, mode}]`; pre-filter must / pre-exclude must_not / boost should; MMR (λ=0.4) replaces caps | ~120 | PR 1 (Cohere query 형식 정해야) | 1주 내 |
| **4** | **Algorithm versioning safety rail** (R5) | zod schema validate POST/PATCH; expires_at + cron sweep; audit log; rollout_percentage column; compile-time fallback | ~200 | none | 1-2주 내 (Google outage 류 위험 차단) |
| **5** | **Under-supply transparency UX** (R4) | SSE `under_supply` 이벤트; FE "expand?" CTA | ~80 | PR 2 (difficulty 적용 후) | 2-3주 내 |
| **6** | **Channel allowlist + playlistItems.list cheap path** (R2) | known-good channel curation (admin UI); cron 으로 batch ingest; quota 100× 절감 | ~100 | none | 2-3주 내 |
| **7** | **Per-segment A/B + SRM** (R5) | per-mandala metric delta + 95% CI; SRM check; head/torso/tail segment | ~150 | PR 4 (rollout_pct 등) | 1개월 내 |

**총 7 PR, ~830 줄.**

### Day-1 minimum (사용자 "오태민" 문제 즉각 해결)

**PR 1 + PR 2 만으로 사용자 보고 문제 즉시 해결:**
- PR 1: Cohere query 에 focusTags + difficulty concat → "오태민" 영상 rerank score ↑
- PR 2: difficulty FE→BE wire + 4-layer cascade → "중급" 선택 실제 작동
- 합 ~180줄, ~1시간

PR 3 (MMR) 까지 가면 cap 의 over-filter 도 해결되어 사용자 surface 자연스러움 ↑.

### Discarded options + 이유

| Option | 왜 discard |
|---|---|
| Title regex 만으로 difficulty 해결 | R1 — 0.60-0.75 정확도, 4-layer cascade 가 0.85-0.95 도달 가능. 그러나 PR 2 에선 1차 layer 로 채택. |
| Duration 으로 difficulty 직접 매핑 | R1 — MIT study: content type confound. **primary signal 금지**, tiebreaker only. |
| Hard pre-filter at 95 candidates | R3 — danger zone. recall regression risk. **must_not 만 hard, must/should 는 query-concat**. |
| Per-mandala override expiry 없음 | R5 — Algolia 가 snowflake risk 경고. `expires_at` + cron sweep 의무. |
| Interleaving 도입 | R5 — Airbnb 50x sensitivity 가 매력적이지만 우리 traffic 규모에서 standard A/B 로 충분. 향후 5x+ growth 시 재검토. |
| Feature-flag service (LaunchDarkly) | R5 — 2 variant 에 overkill. DB JSONB + zod validate 충분. 향후 10+ variant 도달 시 재검토. |
| LLM-everything for difficulty | R1 — Hybrid LLM Routing 이 66% 비용 절감 + 98% 정확도 유지 입증. **rule first, LLM fallback** 채택. |

### Open questions (ship 전 prod 측정 또는 UX 결정 필요)

1. **rich_summary.depth_level populated rate** — 추정 30%, prod 측정으로 확정 필요.
2. **focusTags 3-state UX** — 사용자가 must/should/must_not 을 직관 입력하는 UI 디자인. tag 옆 toggle? 별 input field? UX 결정.
3. **MMR λ 초기값** — Qdrant/Elastic 권장 0.5, R3 권장 0.3-0.4. A/B 측정 필요.
4. **Channel allowlist curation 정책** — admin manual 만? 사용자 like rate 자동 promote? heart rate ≥ N% 자동 candidate?
5. **Under-supply threshold N** — "expand?" CTA 발동 기준 (e.g. < 20 results 시).

### Hard rule compliance (CLAUDE.md)

- ✅ 추측 전 소스 읽기: 모든 외부 claim 에 URL citation. "could not verify" 명시.
- ✅ 계획 → 승인 → 실행: 본 doc 작성, ship 은 사용자 ok 후.
- ✅ Secret vs Config 2-question test: tuning knob 은 JSONB, secret 아님 (R5).
- ✅ Pre-push verification: ship 시 /verify gate.
- ✅ Hardcoded numbers: MMR λ, regex pattern, duration threshold 모두 algorithm.parameters JSONB → admin tunable.

### 다음 액션 (사용자 결정 필요)

- **(a) "PR 1+2 부터 진행"** — Day-1 minimum, ~1시간, "오태민" 문제 즉시 해결.
- **(b) "PR 1 만 먼저, 측정 후 다음"** — 가장 보수적, 단일 변경 후 영향 측정.
- **(c) "PR 4 (safety rail) 부터"** — Google outage 류 위험 차단 우선.
- **(d) 종합 토론 → spec 조정 → 그 다음 ship sequence 확정**.

**(a) 권장**: 사용자 보고 문제가 trust-breaking 수준 (3개만 surface, 무관 + 난이도 적용 안 됨). PR 1+2 즉시 ship 후 PR 3~7 순차.

---

_research doc 끝. ship 시 본 doc 의 §6 가 spec source._
