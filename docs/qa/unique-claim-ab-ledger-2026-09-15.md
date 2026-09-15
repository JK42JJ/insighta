# unique_claim — evaluation ledger

Status: **smoke test recorded; the 30-video evaluation has not run yet.** Nothing here is a
result that a decision may rest on until the evaluation section is filled.

## What is being tested

The v2 summary prompt (`src/modules/skills/rich-summary-v2-prompt.ts`) produces
`core.one_liner`, `core.toc_label`, sections and atoms. It has no field for "the one thing this
video says that similar videos do not." The hypothesis (source: YouTube short `QLSLR1gQsaQ`,
2026-09-15) is that asking for exactly that produces a more useful summary than the plain
request.

## Gate that decides whether a claim is stored (PR: flag `RICH_SUMMARY_UNIQUE_CLAIM_ENABLED`, default OFF)

A claim is kept only if a contiguous run of its text occurs verbatim in the transcript within
±60 s of `timestamp_sec`. Failing claims are dropped. There is no "unverified" state.

| Parameter                          | Value                                                      | Why                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| window                             | `UNIQUE_CLAIM_WINDOW_SEC = 60`                             | a caption line is 2–6 s; ±60 s tolerates a model that points at the start of the passage rather than the line |
| normalization                      | NFKC, lower-case, strip whitespace + punctuation + symbols | ASR captions and prose differ only there (spacing, 。, quotes)                                                |
| minimum run, Hangul-majority claim | `UNIQUE_CLAIM_MIN_MATCH_HANGUL = 12` normalized chars      | ≈ 4–5 Korean words; shorter runs match by accident ("할 수 있습니다")                                         |
| minimum run, Latin-majority claim  | `UNIQUE_CLAIM_MIN_MATCH_LATIN = 24` normalized chars       | ≈ 4–5 English words at 5 letters each                                                                         |
| claim length cap                   | `UNIQUE_CLAIM_TEXT_MAX_LEN = 240`                          | two sentences, not a paragraph                                                                                |

The route logs `{ videoId, verdict: { pass, minMatchLen, longestRun, matchedAtSec, tsErrorSec, reason } }`
for every claim it sees, so the ledger below can be filled from logs, not from memory.

## Arms

| Arm | Prompt                                                                                                | Note                                                               |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A   | production v2 prompt, unchanged                                                                       | baseline                                                           |
| B   | A + the original sentence, verbatim: **"다른 유튜브에서 얘기하지 않는 가장 중요한 내용을 발췌해 줘"** | the sentence is not rewritten                                      |
| B′  | A + the sentence used in the smoke test (below)                                                       | kept separate so B stays clean                                     |
| C   | A + the original sentence + a list of claims from 10 neighbour videos (same topic)                    | addresses "the model does not know other videos"; neighbour k = 10 |

B′ text (smoke test, 2026-09-15 17:30 KST):

```
## 추가 필드 (필수)
"core" 객체에 "unique_claim" 을 추가하라:
{"text": "같은 주제의 다른 유튜브 영상들이 보통 말하지 않는, 이 영상만의 가장 중요한 주장 하나 (1~2문장, 구체적 수치·조건·예외 포함)", "timestamp_sec": <근거 구간 시작 초, 정수>, "why_unique": "왜 흔한 요약에는 안 나오는 내용인지 1문장"}
자막에 없는 내용을 만들지 말 것. 나머지 출력 형식과 필드는 그대로 유지하라.
```

## Smoke test (2026-09-15, 5 videos, arms A and B′ only) — not an evaluation

Engine: Mac Mini `claude -p` (the production summariser). Transcript passed as plain text
(no `[mm:ss]` lines) — which is why timestamps below are model estimates. The evaluation run
uses the annotated form.

| Video                   | Domain label          | A one_liner (gist)            | B′ unique_claim (gist)                         | Verbatim in transcript                 | ts within ±60 s             |
| ----------------------- | --------------------- | ----------------------------- | ---------------------------------------------- | -------------------------------------- | --------------------------- |
| UaBUfB0Uvpo (×3 reruns) | tech/learning/finance | 상담 이력을 한곳에 정리       | 상태값 4종 + 항목 6유형으로 상담 페이지 재설계 | yes                                    | yes (130–168 s)             |
| OVK4yUZWtYc             | business              | 바이브 코딩으로 MVP           | 목표 3회 미달 시 생성 AI 가 즉석 잔소리 생성   | yes                                    | yes (470 s)                 |
| ZEk_eMZ6Sjo             | social                | 왜곡된 혼잣말 → 건강한 표현   | 듣기 ≠ 지는 것; "한쪽만 정신줄"                | first half yes; "한쪽만 정신줄" absent | yes for the first half      |
| 1y5wgvFXfS8 (en)        | health                | boil + stir-fry bracken       | 6–8 min boil, 12–24 h soak, 4–5 water changes  | numbers yes; "fingernail" absent       | no (75 s points at rinsing) |
| ut1hZgZ2WLU (en)        | creative              | lo-fi playlist + affirmations | survival counts as achievement                 | yes                                    | yes (180 s)                 |

Counts: claim produced 7/7 runs; same claim on 3 reruns of the same video; verbatim support
3/5 full, 2/5 partial; timestamp inside window 4/5. Raw pairs: Mac Mini
`~/ab-unique-claim-20260915/out/{domain}.{base,var}.out` — James reads these himself before
"more specific in 5/5" is treated as a finding.

Two things the smoke test taught, both already fixed for the evaluation run:

1. the runner passed a plain-text transcript, so every timestamp was a guess;
2. the candidate endpoint's domain filter returned the same video for three domains, and
   returned videos without captions.

## Evaluation run (pending)

- sample: 30 videos, 9 domains, no video in two domains, transcript ≥ 800 chars fetched
  through the 4242 service before a video is admitted; list reported before any arm runs
- arms A / B / B′ / C, each once per video, Mac Mini `claude -p`, annotated transcript
- human blind sheet: 30 rows, arm order randomized per row, label key kept in a separate file
- pass lines: taken from the 9-2 handoff as written; no post-hoc adjustment
- per row this ledger records: video, domain, arms' claim text, neighbour k (arm C), verbatim
  verdict (`longestRun`, `minMatchLen`), `tsErrorSec`, blind preference

| video                                              | domain | A   | B   | B′  | C   | verbatim (B/B′/C) | tsError s (B/B′/C) | blind pick |
| -------------------------------------------------- | ------ | --- | --- | --- | --- | ----------------- | ------------------ | ---------- |
| _to be filled from `sample/list.tsv` + route logs_ |        |     |     |     |     |                   |                    |            |
