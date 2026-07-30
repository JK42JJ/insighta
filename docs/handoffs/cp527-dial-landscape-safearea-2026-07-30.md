# Dial landscape: the safe area, the lineup bar, and seven builds to find it (CP527)

**Session alias:** `다이얼-가로-안전영역`
**Date:** 2026-07-30 · **Author:** CC, driven by James
**Live build:** `2026-07-30-70` · **Merged:** #1412 … #1420 (9 PRs)
**Status:** landscape shift CLOSED (James: "패스"). One item held, listed in §5.

---

## §0 Resume prompt

```
다이얼 세션 재개. 인계 = docs/handoffs/cp527-dial-landscape-safearea-2026-07-30.md
라이브 build 2026-07-30-70. 가로 쏠림은 종결됨(§1). 착수 전 §4 읽을 것 —
이 세션은 7배포 6실패였고, 실패 원인은 코드가 아니라 검증 환경이었다.

우선순위:
1. §5-A 개인정보처리방침 push 보류분 (커밋 d1955f96, 브랜치 docs/privacy-subscriptions)
2. §5-B judge backfill 프로드 미실행 — judge_state NULL 행이 제안에서 조용히 제외됨
3. §6 큐레이션 잔여 (샘플 2종 승인, 주제입력 트렌드 카드, 채널 20 pick)
```

---

## §1 What was wrong, and what it actually was

**Symptom:** in landscape the picture sat 129 device px to the right and lost the same amount off one edge. **Some videos, not others, on the same build** — the same video in both states within one session.

**Cause:** `viewport-fit=cover` + iOS **standalone (home-screen app)**. iOS hands `env(safe-area-inset-left)` down **into the cross-origin YouTube frame**, and the player shifts its picture right by exactly that inset. A browser tab has Safari's chrome over the sensor housing, so the inset is 0 there — which is why it only ever happened in the installed app.

**Measured on the handset, not inferred:**

| fact | value | source |
| --- | --- | --- |
| build 62 shifted the slot by `-1 * env(safe-area-inset-left)`; picture moved | **129 device px** (315 → 186) | James's screenshots |
| ⇒ inset | **129 device = 59 CSS** — the standard landscape inset | derived |
| shift observed | **129** — the whole inset | 14 screenshots |
| shift in a browser tab | **0** | James, the fact that closed it |

**Why compensating could not work:** the player applies the inset on *some* layouts and not others, and nothing can ask a cross-origin frame which it just did. Half the videos land right, half land 129 the other way — which is exactly what build 62 produced.

**Fix (#1417):** `viewport-fit=auto` for the duration of landscape playback. The inset goes to zero for us *and* for the frame, and the two states collapse into one. It costs nothing: the layout viewport shrinks to the safe width (837 of 956) but **the picture is bound by height**, so it stays 782×440 and lands at 87..869 — pixel-identical to the YouTube app. Four things restore it (rotate back, close deck, page resume, self-heal on the bar tick).

---

## §2 Shipped this session

| PR | Build | What |
| --- | --- | --- |
| #1412 | 62 | wheel → in-card player; **landscape offset guess (wrong, reverted)** |
| #1413 | 63 | revert that guess; bar takes the note view's shape (one tick, never stopped) |
| #1414 | 64 | **one owner for the stage rect**; landscape full bleed (crop gone) |
| #1415 | 65 | poster back on the existing probe; sticky `?dbg` |
| #1416 | 66 | `-webkit-overflow-scrolling:auto` in landscape; entrance animation cleared |
| #1417 | 67 | **`viewport-fit` switch — closes the shift** |
| #1418 | 68 | loading cue (2px line); **`:root` colourway — fixes body-level surfaces** |
| #1419 | 69 | bar = position in the lineup, segmented; one line at the bottom |
| #1420 | 70 | wheel band narrowed (unlocks YouTube controls); bar on the picture edge; chrome fades together |

---

## §3 Structural findings worth keeping

**`YT.Player.setSize()` is a no-op here.** It writes the iframe's width/height **attributes**, an attribute is a presentational hint, and any author declaration outranks it. Measured: `setSize(300,200)` left the frame at 782×440 with the attributes set and ignored. The rotation path had been calling it since the in-card rewrite and had never resized anything. To make an embed re-lay-out you must **change its box for real** (1px off and back, on a `setTimeout` — not `requestAnimationFrame`, which is throttled whenever the page is not painting and leaves the nudge stuck).

**Colourway tokens never reached three surfaces.** `.th-cream` etc. live on `.device`; `#curDeck`, `#ytSheet` and `.toast` are body-level by design. So every `var(--acc)` they used resolved to nothing — and an undefined custom property does not warn, it **deletes the whole declaration**. The journey bar had been painting its fill in `transparent` for weeks; the dot showed because it is a literal. Same family as the scene palette that rendered black. **Third occurrence.** Fixed by declaring the default colourway at `:root`; `check-dial` now fails on any no-fallback token referenced from a body-level surface that is not declared on `:root`/`html`/`body`. Gate proven: removing the `:root` block reports `--shade`, `--acc-ink`, `--acc-lo` immediately.

**`body.wheelawake` was a dead selector.** Three stylesheets read it; nothing ever set it. `wheelAwake`/`wheelSleep` now mirror onto `<body>`. Had the bar's fade been written against it and shipped, the bar would never have appeared.

**YouTube thumbnails.** `hq` 480×360 and `sd` 640×480 are **4:3 with black bars baked in**; `mq` 320×180 and `maxres` 1280×720 are 16:9 (maxres is not always — one measured 1280×702). When maxres is absent YouTube may answer **200 with a 120×90 grey placeholder**, so layered CSS urls cannot filter it — only an `Image` + `naturalWidth` probe can, and that probe already existed in the file.

---

## §4 The failure to read before touching anything

Seven deploys, six failures. **The code was not the hard part; the verification was wrong.**

The symptom only occurs with `body.standalone` (installed app). **No probe in this session applied that class until the seventh attempt.** Every "verified in a browser at 956×440" report was therefore a check that *could not fail*. Reported as verification six times. James: "또 사기치네" — correct.

Three habits that cost the most:

1. **A check that cannot fail is an alibi.** If a symptom is environment-specific (installed app / OS / connection / auth state), assert the harness reproduces that condition *before* claiming a result. If it cannot, say "not verifiable here" and stop.
2. **"Some do, some don't" is the primary clue, not noise.** James said it early — "영상마다 쏠리는 것이 있고 정상인 것이 있어" — and it was treated as noise for hours. Coexisting good/bad on one build = a **state difference**; never model it as a constant offset.
3. **Ask the environment-split question first.** "Where does it reproduce — installed app, browser, both?" One sentence from James closed a six-hour hunt. It should have been the first question.

Also: twice in this session an existing mechanism was rebuilt from scratch instead of used (the wheel summon, the poster probe). Both were three functions away in the same file.

Rules written: `memory/feedback_two_behaviours_means_state_not_offset.md` (rewritten with the corrected numbers — an earlier version claimed 258/half and was wrong arithmetic on the wrong pair of edges).

---

## §5 Held / open

**A. Privacy policy update — committed, NOT pushed.**
Commit `d1955f96` on branch `docs/privacy-subscriptions`. Four keys × two locales (`s2_2P1`, `s3Item2`, `s4P2`, `s8P1`): channel subscriptions are collected, watch history is **not** (the Data API does not expose it), and the signals are stored only as an interest keyword list.
Blocked by the `/verify` gate (touches `frontend/src/`). Local dev could not render the app in this worktree — no console errors, `#root` stayed empty; not caused by this change. James: "로컬앱은 넘어가자". **Decision needed:** push as-is (i18n value swap only — keys, HTML tags, tsc, JSON parity all verified) or fold into the next frontend session.

**B. Trend topic judge backfill — never run on prod.**
`judge_state` NULL means the row **predates judging and is excluded from proposals**, so serving silently loses candidates. Script: `src/scripts/backfill-topic-judge.ts`. Needs prod NULL-vs-judged counts → run → verify the ok/unsafe/unfit/unknown distribution.

**C. Portrait commit-time veil** computes `.20` instead of the intended `.12`. Eight percent, invisible, not a regression. Landscape takes `.12`. Left alone deliberately.

**D. Rotation MENU behaviour** — my recommendation is that rotating back should return to the portrait feed rather than home. Never decided.

---

## §6 Carryover from before this session

- **Curation:** sample topics 투자 + AI·LLM (awaiting approval) · topic-entry screen should offer trend cards instead of an empty field · 20 researched channels awaiting James's pick · weekly count 20→30 (deferred)
- **Dead layers:** `cdP` (70 refs) · `cdFollow` · `cdTrack` · `cd-stage`. `cdMomentum`/`cdMomentumLand` became unreferenced this session. James approved removal as a later track ("하던거 마치고").
- **Release notes:** `docs/releases/` has **0 tracked files** — the convention exists but nothing has ever been committed. Today's ~22 PRs have no note.

---

## §7 Dependencies

**Runtime**
- YouTube IFrame API — cross-origin; internals unreadable. `setSize` ineffective against author CSS (§3).
- iOS WebKit — `env(safe-area-inset-*)` propagates into subframes under `viewport-fit=cover`; **this behaviour does not exist in desktop Chrome**, which is why it was invisible to every local check.
- YouTube thumbnail CDN — `mq`/`maxres` 16:9, `hq`/`sd` 4:3, missing maxres may return 200 + grey placeholder (§3).
- OAuth scope `youtube.readonly` — already granted; `subscriptions.list` needs no new consent. Watch history is **not obtainable at any scope**.

**Build / gates**
- `scripts/ci/check-dial.mjs` — inline-script parse + `APP_BUILD` ↔ `version.json` + colourway tokens + **new:** body-level orphan tokens.
- `scripts/audit/hardcode-audit.ts` — `css-color-literal` baseline **248**, total **281**. Use `black`/`transparent` keywords in masks; `rgba(var(--token),.x)` is exempt.
- `scripts/verify-gate.sh` — blocks push/PR when `frontend/src/` changed without a `/verify` marker. Does **not** gate `frontend/public/mobile/`.
- `.husky/commit-msg` — no Korean in commit messages (BSD grep, no `-P`).

**Local environment**
- The worktree has no `node_modules`; symlinking the main repo's works for vite but the app did not mount (§5-A). `npm install` in the main repo was run this session and now includes sigma/graphology.
- `playwright install webkit` **fails** in this environment — no real WebKit available for local testing.
