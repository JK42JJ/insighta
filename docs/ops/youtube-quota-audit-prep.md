# YouTube Data API — Quota Extension Audit Prep (2026-07-03)

> **Status: DRAFT for James's external submission.** CC prepares the material; the
> audit form + Cloud Console actions are James's to submit (external account
> action, not automatable). Supervisor directive Q-01 order: **정비 → 단일화 →
> 실사용 축적 → 신청**. Do NOT submit the audit while 8 stacked SEARCH keys are
> live (multi-project circumvention = ToS violation → rejection + project
> suspension risk).

## 0. Blocker triage (Q-01 지시4 실측 결과)

| Item | Status | Action |
|---|---|---|
| Public privacy policy page | ✅ LIVE — `https://insighta.one/privacy` (200), router:132, footer+login linked | none (exists) |
| Public terms of service page | ✅ LIVE — `https://insighta.one/terms` (200), router:133 | none (exists) |
| **YouTube API Services citation in privacy/ToS** | ❌ **0 mentions** (grep on PrivacyPage/TermsPage) | **정비 P0 — small FE PR (see §4)** |
| GCP Console: per-project audit history | ⚠️ CC cannot access — **James to verify** | check before submit |
| 8-key SEARCH stacking | ⚠️ ToS risk for audit | consolidate to 1–2 projects BEFORE submit (G5 + P3 Gemini-mix) |

## 1. Purpose of use (rejection-reason #1 avoidance: NOT bulk scraping)

Insighta is a **PKM (personal knowledge management)** learning tool. Each YouTube
`search.list` call is **goal-scoped**: a user defines a learning objective
(mandala center goal) split into 8 sub-goal cells; the app runs one bounded
search per cell to curate ~20 candidate learning videos for that specific
sub-goal. This is **per-user, per-goal curation — not bulk indexing, not
scraping, not re-hosting**. Videos are shown via the official YouTube iframe
player; no video content is downloaded or re-served.

## 2. Daily-call estimate (evidence-based, NOT "give us a lot")

**Measured baseline (prod, last 30 days):**
- add-cards: 81 sessions → 60,281 `search.list` units (~603 units/session ≈ 6
  `search.list` calls/session; each 100u).
- wizard (new-mandala): 62 sessions (8 cells × ~1 search = ~800u/session).
- Current daily peak (single active day, small test cohort): **13,518 units**.

**Projected at beta scale** (pricing model: Free = 3 mandalas + 50 AI-summaries/mo):
- Assume a beta user runs ~1 wizard (8 cells = 800u) + ~3 add-cards rounds
  (1,800u) per active day = **~2,600 units/user/active-day**.
- 50 concurrent active users → ~130k units/day (already > current ~85k stacked
  capacity → the extension driver).
- 200 users → ~520k units/day.
- **Requested quota: 1,000,000 units/day** on the consolidated SEARCH project
  (headroom to ~380 active users; standard extension tier).

## 3. Quota-efficiency evidence ("designed to fit inside 10k")

- **Global result cache** (`video_id`): a re-search of the same mandala is a
  cache hit = **0 additional units** (idempotent). Repeat usage does not
  multiply quota.
- **Bounded fan-out**: max ~6 `search.list`/add-cards session, 8/wizard —
  hard-capped, no unbounded pagination.
- **Cheap metadata path**: `videos.list` + `channels.list` run on a **separate
  1-unit project** (`_VIDEOS`), never on the 100-unit search project.
- **Relevance gating** (top-20 Haiku scoring) filters candidates without extra
  YouTube calls.

## 4. 정비 P0 — YouTube API Services citation (small FE PR, must precede audit)

Add to `PrivacyPage.tsx` a "YouTube API Services" section stating:
- This app uses **YouTube API Services**; by using it you agree to the
  [YouTube Terms of Service](https://www.youtube.com/t/terms).
- Google's Privacy Policy: `https://policies.google.com/privacy` (already
  linked — keep).
- What YouTube data is accessed (public video metadata: title, channel, view
  count, thumbnails, publish date), how it is used (curation/display), stored
  (result cache), and how a user can revoke/remove it.

## 5. VIDEOS availability redundancy (NOT stacking)

Add `YOUTUBE_API_KEY_VIDEOS_2` as a **single-point-of-failure hedge**. `videos.list`/
`channels.list` are 1-unit calls with **no circumvention incentive** — this is
availability redundancy, categorically different from the 100-unit SEARCH
stacking that must be consolidated. Secret registration = James's action.

## 6. Submission order (self-sabotage guard)

1. ✅→ verify privacy/ToS live (done) → add YouTube citation section (§4 PR)
2. → author this audit material (this doc)
3. → consolidate 8 SEARCH keys → 1–2 representative projects (G5 remainder +
   P3 Gemini-mix untangle)
4. → beta launch → accumulate real usage evidence
5. → submit audit with consolidated project + real numbers

**Never submit at step 2 with 8 keys live.**
