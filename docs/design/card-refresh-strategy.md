# Card Refresh Strategy — iter 1 (SUPERSEDED)

> **⚠️ SUPERSEDED by `docs/design/add-cards-2026-05-18.md` (CP466, 2026-05-18).**
> 본 doc 의 4-layer 모델 + caps + drift guard + phased rollout 은 후속 doc
> 으로 통합 (Re-search Add handoff Phase 5 와 함께). 명칭 "Refresh" 폐기 →
> "Add Cards" 채택. 본 문서는 **historical reference only** — 명명 / 결정 /
> 구현은 후속 doc 을 참조하라. CP466 결정 record:
> `retrospective.md` Rule Evolution Log 2026-05-18.

> **Status.** iter 1 draft, **pre-implementation**. Captured 2026-04-22 during
> CP416 live discussion after the user reported "서비스 불가" (card load
> 60s+ / only 1-6 cards visible) and clarified the actual product intent.
>
> **Why this exists.** Our current mandala video-discover pipeline produces
> a flat score-sorted list and the UI shows the first 24. When the user
> hits "refresh" (expecting different cards because the first batch
> didn't contain what they wanted), the next batch is algorithmically
> adjacent — **same character**. This doc defines a four-layer refresh
> strategy + a marginal feedback bias so refresh feels diverse without
> drifting off-topic, and so user likes/clicks inform later picks
> without collapsing into the YouTube-style echo chamber.
>
> **Related docs.** `v3-semantic-center-gate.md` (gate 1 already shipped
> CP416), `v3-semantic-cell-gate.md` (gate 2 pending CP417).

## 1. User intent (the two quotes this design has to honor)

> "카드는 한번에 최대한 많이 가져와야 해. 그중 일부를 가령 24~30 등으로
> 기준에 의해 보여주고, 사용자가 추가 refresh 를 하는 경우 나머지 카드
> + 신규 카드 + 캐시 등으로 다양한 카드를 추가로 제공할 수 있어야 함."

> "본인이 찾는 카드라면 동영상을 한번 눌러볼 수 있어, 혹은 like 를
> 누르거나. 그 다음부터는 카드 추천할 때 해당 카드의 내용을 바탕으로
> 가중치를 일부 조정하는 거지. 그러나 유튜브처럼 해당 카드로 도배하면
> 안 되. 일부 가중치만 조금 더 주는 거야."

Translated into system constraints:

- **Collection**: collect as much as the pipeline can afford (no artificial
  target shrink just to make the viewport math cleaner). The extra pool is
  refresh ammunition.
- **Display**: 24-30 cards at a time, chosen by a multi-axis criterion.
- **Refresh**: mix unused pool + new fetch + cached neighbours to feel
  genuinely different.
- **Feedback bias**: small score nudge (5-15%) after likes/clicks. Never
  let a single signal dominate the feed. Mandala topic stays primary.

## 2. Layered selection model

```
On each refresh call, the 24-30 cards are assembled as:

  ┌──────────────────────────────────────────────────────────┐
  │ Layer 1 — Coverage          ~45%  (11-13 cards)          │
  │   Pick from sub_goals / actions not yet surfaced in this │
  │   mandala-user session. Mandala structure itself is the  │
  │   coverage map.                                           │
  │                                                           │
  │ Layer 2 — Semantic diversity (MMR)  ~25%  (6-7 cards)    │
  │   score = λ·relevance − (1−λ)·max_sim(candidate, shown)  │
  │   λ = 0.65 starting point. Candidate embedding via       │
  │   video_chunk_embeddings (pgvector). Gate: video-dict    │
  │   pool ≥ 300 chunks before enabling Layer 2.             │
  │                                                           │
  │ Layer 3 — Exploration       ~15%  (3-4 cards)            │
  │   Random sample from adjacency pool: trending topic      │
  │   overlap / other mandalas of same user / popular in     │
  │   last 24h. Pure serendipity inject.                     │
  │                                                           │
  │ Layer 4 — Feedback bias     ~15%  (3-4 cards)            │
  │   Applied as post-reorder multiplier on Layers 1-3       │
  │   output, not as a separate slot allocation. Raises      │
  │   final score by at most +20% based on recent likes /    │
  │   clicks. Hard-capped by channel / sub_goal / cluster.   │
  └──────────────────────────────────────────────────────────┘
```

**Why Layer 4 is a multiplier, not a slot.** If feedback were a separate
slot allocation (e.g. "give 15% to liked-similar"), the liked axis gets
guaranteed airtime every refresh — which is exactly the YouTube failure
mode the user vetoed. Applying it as a *multiplier on already-selected
candidates* means feedback only swings order within an already-diverse
batch, not the composition of the batch.

## 3. Feedback signal hierarchy

| Signal | Source | Strength | Time decay |
|--------|--------|---------|-----------|
| Explicit Like | FE button | **+15%** | 14 days (exp) |
| Save / Bookmark | FE button | **+15%** | 30 days (exp) |
| Watch > 30s | FE player event | +10% | 7 days |
| Click + open player | FE route | +8% | 7 days |
| Skip / close < 5s | FE player event | **−8% channel** | 3 days |
| Explicit Dislike | FE button | **exclude channel 30d + cluster 30d** | 30 days |

Time decay formula: `weight(t) = base × exp(−t / half_life)` where
`half_life` comes from the table above.

## 4. Score composition (final form)

```
final_score(v) =
  [Layer 1-3 intermediate score]
  × (1 + Σ feedback bias terms)

where feedback bias = min(
  α_channel  × channel_boost(v),
  α_embed    × embedding_similarity(v, liked_centroid) × time_decay,
  Σ negative signals,
  0.20                    // hard cap: no single video can gain > 20%
)

α_channel = 0.08          // 8% per matched channel (with cap ≤ 2 / refresh)
α_embed   = 0.10          // 10% per high cosine to liked centroid
```

`liked_centroid` is the time-decayed average of the embeddings of all
videos the user has liked/saved in this mandala within the last 30
days. Cold-start users have no centroid → Layer 4 contributes 0.

## 5. Echo-chamber guards (hard caps)

Applied after score computation, before the final 24 are returned:

| Cap | Value | Rationale |
|------|-------|-----------|
| Same channel | ≤ 2 / refresh | "YouTuber 도배" 방지 |
| Same sub_goal | ≤ 4 / refresh (= 50%) | 8 cells 중 최소 3 표현 보장 |
| Same semantic cluster (k-means k=6 on pool) | ≤ 6 / refresh (= 25%) | cluster-level mono-culture 방지 |

If caps bind at the wrong spots, the cap-violating candidate is replaced
by the next-best candidate that respects all three caps.

## 6. Mandala drift guard (topic fidelity)

Feedback can pull toward adjacent topics, but if it pulls too far:

```
If cosine(liked_centroid, mandala.center_goal_embedding) < 0.5
  → Layer 4 disabled for this session
  → Log warn: "feedback drift beyond mandala intent — bias suppressed"
```

Reasoning: a user may like a video that's tangentially adjacent to the
mandala's goal (e.g. "AI learning habits" mandala + a "brain fatigue
recovery video" like). That's fine and should be rewarded mildly. But
if the accumulated centroid of likes drifts into an entirely different
topic (e.g. mostly "K-pop practice routines"), the mandala's purpose
is no longer in control, and the user is probably exploring a new
interest rather than pursuing this mandala. In that case the right
UX answer is "consider creating a new mandala", not "silently pivot
the feed".

## 7. Collection / display / refresh data model

```
recommendation_cache               user_video_states
─────────────────────              ─────────────────────
mandala_id                         user_id
video_id                           mandala_id
rec_score (baseline)               video_id
cell_index                         status (pending|added|dismissed)
source (cache|realtime)            surfaced_at          ← NEW
created_at                         refresh_round        ← NEW
                                   first_clicked_at     ← NEW
                                   first_liked_at       ← NEW

user_video_interactions            ← NEW TABLE
─────────────────────
user_id
video_id
mandala_id
event         enum (like|save|click|skip|dislike|watch_30s)
watch_seconds int nullable
created_at    timestamp
```

`surfaced_at` answers "already shown?" in O(1) on refresh. The
interactions table is the source of truth for feedback weights.

## 8. Refresh API shape

```
POST /api/v1/mandalas/:mandalaId/refresh-cards
  body: { limit?: number = 24 }
  →  {
       cards: [{ videoId, cellIndex, score, source, trace? }, ...],
       trace: {
         layer1_count: number,
         layer2_count: number,
         layer3_count: number,
         feedback_boost_applied: number,
         caps_enforced: { channel, subgoal, cluster }
       }
     }
```

Idempotent (within a short window) so accidental double-click doesn't
burn the pool. `trace` fires only when the caller requests debug mode —
production payload stays slim.

## 9. Phased rollout

### Phase 1 — Coverage + Pagination only (≤ 2 days impl)
- Land `user_video_interactions` table + `surfaced_at` / `refresh_round` on
  `user_video_states`
- Implement Layer 1 (coverage) + fallback pagination (Layer "A" from
  the earlier discussion)
- Channel cap ≤ 2
- Target: first refresh feels "different" purely from coverage + dedup

### Phase 2 — Semantic diversity (MMR) — post video-dict 1000 videos
- Layer 2 activates once `video_chunk_embeddings` has ≥ 300 rows (gates
  cluster size) and user has ≥ 1 previous refresh
- k-means cluster cap activates

### Phase 3 — Feedback bias + exploration
- FE wires `user_video_interactions` writes (like/save/click/skip)
- Layer 3 (exploration) + Layer 4 (bias multiplier) enabled
- Drift guard with `V3_FEEDBACK_BIAS_ENABLED` flag, default **true**
  but monitored; flip to **false** instantly if drift events spike

### Phase 4 — Personalization calibration
- Tune `α_channel` / `α_embed` from prod feedback data
- Add secondary decay tracks (7d short-term vs 30d long-term user pref)
- Candidate: personalized λ in MMR (novelty-seeking users get lower λ)

## 10. Open questions (for iter 2)

1. **Refresh pagination depth** — when the pool exhausts (e.g. after 4
   refreshes × 24 cards = 96), do we trigger a new YouTube fetch mid-
   session (refresh cost) or gracefully surface "refresh later" UX?
2. **Channel-cap reset** — does "same channel ≤ 2" reset per refresh
   round or persist across rounds within a session?
3. **k-means k** — 6 is a starting point; empirical calibration once
   pool is big enough
4. **Layer weights** — `0.45 / 0.25 / 0.15 / 0.15` is a starting mix;
   production data should validate (may need `V3_REFRESH_WEIGHTS` env)
5. **Drift guard threshold** — 0.5 cosine is conservative. Track prod
   `feedback drift` warn rate and tune
6. **Feedback signal lag** — like fired at time T should be eligible
   for bias at time T + ε. How small is ε? sync write + in-request
   read? or cached user preference vector with N-minute staleness?
7. **Concurrent mandalas** — a user with 3 active mandalas. Is
   `liked_centroid` per-mandala or per-user? Per-mandala is more
   faithful; per-user is simpler but drifts
8. **Dislike granularity** — "dislike this video" vs "dislike this
   channel" vs "not interested in this topic right now" — FE affordance
   decision blocks schema decision

## 11. Non-goals

- **Collaborative filtering / cold-start by similar users** — out of
  scope for iter 1; revisit after Phase 4 when we have enough unique
  users × interactions
- **Cross-mandala personalization** — keep per-mandala isolation for
  iter 1. A user's K-pop mandala likes should not leak into their
  Korean-habits mandala
- **Recommendation serendipity beyond 10-15%** — exploration layer
  stays modest in iter 1; we build user trust before widening
- **Real-time cluster re-computation** — k-means is computed once per
  mandala refresh call from the current pool; no streaming clustering
- **Negative feedback propagation to adjacent users** — stays local
  until we're explicitly in collaborative mode

## 12. Success criteria (before default-on)

1. "Same-character refresh" user complaint rate drops to ≤ 5% on
   sampled sessions
2. Layer 4 bias contributes ≤ 20% cumulative final_score in prod
   (measured)
3. Drift guard fires at ≤ 3% of refresh calls (feedback rarely runs
   away)
4. `surfaced_at` coverage reaches 100% of shown cards (no invisible
   shows)
5. Per-cell median fill on refresh ≥ 18/24 (75% of viewport coverage
   — remaining 25% is fine-tune space for Layer 3+4 randomness)

## 13. Progressive Delivery Layer (2026-04-22 추가)

> User directive: "카드가 한 번에 나오는 건 문제 — 병렬 처리되어 먼저
> 조회되는 순서대로 쌓이는 형태로 처리되어야 하고, 단순 시간순이 아닌
> 주제 연관성이 높은 순서로 쌓여야 한다."

§2 의 4-layer selection 은 **어떤 카드를 포함할지** 를 결정한다. 이
§13 은 **선택된 카드를 사용자에게 어떻게 전달할지** (delivery) 를
다룬다. 두 축은 독립적이지만 refresh 경험의 질을 함께 결정한다.

### 13.1 Delivery 요구

- **Progressive**: 사용자가 refresh 버튼을 누르면 24 카드 모두 도착할
  때까지 기다리지 않음. 첫 카드가 준비되는 즉시 노출. 후속 카드는
  arrival 순서대로 sorted 위치에 삽입.
- **Relevance-first ordering**: sort axis 가 `created_at` 아닌 score
  (relevance 합성). Top score 가 화면 위에 "먼저 보이는" 것이
  자연스러워야 한다.
- **재사용성**: wizard 최초 카드 / dashboard 정적 로드 / refresh /
  actions fill / search 전부 같은 transport 사용.

### 13.2 Implementation reference

상세 아키텍처는 별도 문서 `docs/design/progressive-relevance-stream.md`
에 정리. 요지만 인용:

- Producer: 카드 arrival 마다 `StreamItem<T> = { payload, score, key, ts }` emit
- Transport: `GET /api/v1/mandalas/:id/card-stream` SSE, 이벤트 `card_added` / `backlog_done` / `pipeline_done`
- Consumer: FE 공용 hook `useProgressiveSortedStream<T>(url, { keyFn, scoreFn })` 가 binary-insert 로 sorted buffer 유지

Refresh 는 이 transport 에 **다른 score function** 만 제공:

```
scoreRefresh(v) =
    layerWeights(v)          // §2 의 4-layer 선택 내부 score
  × (1 + feedbackBias(v))    // §4 Layer 4 multiplier
  × capViolationPenalty(v)   // §5 cap 위반 시 0 (사실상 제외)
```

### 13.3 Phased rollout mapping

refresh-specific 단계와 `progressive-relevance-stream.md` §7 phase 대응:

| Refresh doc phase | Stream doc phase | Prerequisite |
|-------------------|-----------------|--------------|
| §9 Phase 1 (coverage + pagination) | Stream §7 Phase 1 (sort axis only) | none |
| §9 Phase 2 (MMR) | Stream §7 Phase 3 (FE hook) | `video-dict` 300+ chunks |
| §9 Phase 3 (feedback bias) | Stream §7 Phase 4 (score composition) | `user_video_interactions` schema |
| §9 Phase 4 (personalization) | Stream §7 Phase 5 (surface expansion) | prod traffic samples |

즉 **refresh 는 progressive stream 위에서 동작하는 특수 case**.
Transport 와 hook 은 wizard 에서 먼저 검증된 뒤 refresh 로 재사용.

### 13.4 Dashboard 최초 로드 vs refresh 의 차이

| 차원 | Dashboard 최초 | Refresh |
|------|---------------|---------|
| Initial backlog | `recommendation_cache` snapshot | 없음 (fresh pool) |
| Stream source | post-creation pipeline + cardPublisher | refresh endpoint (synthetic emission) |
| Score function | §5.1 wizard/dashboard | §13.2 refresh |
| Typical duration | 5-60s (pipeline 완료까지) | 1-3s (pool 안에서 고르는 것) |

둘 다 **같은 FE hook 을 씀**. URL 만 다름.

### 13.5 Open cross-doc question

(refresh + stream 공통)

- Refresh N번째 호출 시 dashboard 의 기존 stream 이 살아있으면? → 같은
  mandala 에 2 SSE connection (initial + refresh) 금지. Refresh 호출은
  기존 connection 통해 "replace buffer" 이벤트 전송 고려. iter 2 결정.
- Refresh 중 Layer 4 feedback bias 가 변경되면 → 기존 buffer 유지 +
  새 카드 insert 시에만 적용. Stream `score_update` 이벤트 도입 여부
  iter 2.
