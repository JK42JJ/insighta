# Continuous Refresh Edge Case Test

> **Purpose.** Validate Insighta's behaviour under continuous page reload
> (Cmd+R hold, rapid F5) so structural SPA weaknesses are caught before
> they manifest as production incidents.
>
> **Why bother.** Holding Cmd+R isn't normal user behaviour, but the
> pattern surfaces real structural weakness every time: empty HTML on
> refresh, unthrottled API fan-out, cross-user cache leakage. The reason
> this test exists as a durable record (and not a one-off scratchpad) is
> that we expect to **re-run it** whenever we touch the boot path,
> QueryProvider, AuthContext, or the index.html shell.

---

## How to run the test

### A. Network capture (HAR)

1. Open the target (e.g. `http://localhost:8081` logged in, or prod).
2. DevTools → Network tab.
3. **Check "Preserve log" ON** — otherwise reload wipes the log and you get a 1-entry HAR.
4. **Check "Disable cache" ON** — measures real load, not browser cache.
5. Confirm record (red dot) is active.
6. Perform one of the scenarios:
   - **S1 — Single refresh.** One Cmd+R, wait for settle.
   - **S2 — Rapid burst.** 10× Cmd+R within ~2s, wait for settle.
   - **S3 — Hold.** Hold Cmd+R for 3 seconds, release, wait for settle.
7. Right-click the entry list → **Save all as HAR with content**.
8. File name convention: `localhost-<scenario>-<YYYYMMDDTHHMM>.har`
   (e.g. `localhost-S3-hold-20260417T1740.har`).

### B. Screenshot series

Shift+Cmd+4 (space = window). Capture at:

- `T=0` — before any refresh.
- `T=first-reload` — immediately after first refresh starts.
- `T=mid` — during burst / hold.
- `T=post-settle` — after activity stops.
- Final DOM state (useful if anything lingers).

### C. Console capture

1. `🚫` clear console before test.
2. Run the scenario.
3. Right-click inside Console → **Save as…** → `console-<scenario>-<ts>.log`.

Always keep the Web Vitals line (`[Web Vitals] FCP/LCP/CLS/TTFB`) — it
is the single most compact summary of whether the boot path regressed.

---

## Pass criteria

### LEVEL-0 — Must pass (regression stops ship)

| # | Check | How to verify |
|---|-------|---------------|
| 1 | No React runtime red error in console | Console → filter `error`, expect 0 rows from our codebase |
| 2 | Brand frame visible within 100ms of each reload | Screenshot `T=first-reload` shows "Insighta" wordmark, not pure black |
| 3 | No complete black frame lasting > 300ms during burst/hold | Screenshot series |
| 4 | Issue #369 cross-user mix does not recur | After user A burst-refreshes then user B signs in, user B's sidebar contains 0 user-A rows |
| 5 | D&D still works after the storm | Drag one card into another cell, verify it lands |

### LEVEL-1 — Should pass (quality bar)

| # | Check | How to verify |
|---|-------|---------------|
| 6 | S1 (single refresh) HAR entries ≤ 15 from our origin | HAR filter `Host: localhost:8081` |
| 7 | No POST calls on passive reload (other than `youtube-auth refresh` if connected) | HAR filter `Method: POST` |
| 8 | No 429 / 5xx from our own backend (`:3000`, `:8000`) | HAR status column |
| 9 | Web Vitals on first reload: FCP < 500ms, LCP < 2500ms | Console `[Web Vitals]` lines |

### LEVEL-2 — Aspirational

| # | Check | How to verify |
|---|-------|---------------|
| 10 | Sidebar minimap + card count rendered < 1s after reload | Screenshot timing |
| 11 | S3 (3-sec hold) → all renders settle within 3s of release | HAR total duration |
| 12 | Client abuse interstitial activates at ≥ 10 rapid reloads (once implemented) | Visual: "잠시 후 다시 시도" page |

---

## Findings log

### 2026-04-17 — Baseline (before Phase B)

Target: `localhost:8081`, signed-in user, dev server.

- Observed full blank frames during hold (Screenshot `5:19:06`).
- Console after settle: **1 real error** only — `POST /functions/v1/youtube-auth?action=refresh 400` from `useYouTubeAuth.ts:193`.
  Pre-existing; unrelated to this test. Filed as a separate concern.
- Web Vitals: FCP 240ms, TTFB 4.80ms, CLS 0.02, LCP 716ms — timings
  actually fine; the perception problem is visual, not latency.
- Account-mix (Issue #369) **not reproduced** this session. The P1
  remains at 5 historical recurrences; the test still gates for it.

### Comparison SaaS (same test, same machine, 2026-04-17)

| Site | Hold behaviour | Mechanism observed |
|------|----------------|--------------------|
| **Google** | Rapid refresh triggers `google.com/sorry/index` + reCAPTCHA | Server-side abuse guard + static "sorry" HTML. App JS stops running. |
| **Apple App Store** | No blank, content stays visible | SSR — HTML response already includes full content. |
| **Goodnotes** | No blank | SSR / static. |
| **YouTube** | **Blanks** during hold (same as us) | Console shows the DOM dump: `<ytd-app>` tree is baked into index HTML. The blank is the inter-reload gap; once HTML arrives, the pre-rendered `<ytd-app>` masthead/guide paints even before JS runs. |

Key takeaway: blank during rapid reload is a **fundamental SPA issue**.
SSR sites bypass it entirely. YouTube closes most of the gap by baking
a structural shell into index HTML — that is the pattern we copied.

### 2026-04-17 — After Phase B (HTML shell + React BootShell twin)

Changes:

- `frontend/index.html` — `<div id="boot-shell">` block with "Insighta"
  wordmark + CSS `@keyframes boot-shell-pulse`. Hidden automatically
  when React writes to `#root` via `body:has(#root:not(:empty))`.
  `MutationObserver` fallback inline script handles browsers without
  `:has()` support.
- `frontend/src/shared/ui/BootShell.tsx` — React twin of the HTML
  shell. Used inside React for `authLoading` and `Suspense` fallbacks
  so the visual language stays identical across HTML→React boundary.
- `frontend/src/pages/index/ui/IndexPage.tsx` — two `<Loader2>`
  full-screen spinners replaced with `<BootShell />`.

Observed post-fix:

- Cmd+R hold: "Insighta" wordmark stays visible continuously; no pure
  black frame.
- Console: "No errors", only the pre-existing VITE_SUPABASE_URL
  warning.
- Shell renders from HTML parse time (before JS executes).
- CSS `:has()` hides the shell once React mounts — no flash, no leftover.

### Phase A' — attempted + reverted (same session)

React Query cache persistence via `@tanstack/react-query-persist-client`
+ `query-sync-storage-persister`. Allow-listed to `['mandala','list']`
only.

Reverted because:

1. The user's reported problem is **structural empty HTML**, not cache miss. Phase A' optimises the wrong layer.
2. A single allow-listed query gives marginal visible win.
3. Any persistence that can be read before auth confirms re-opens the Issue #369 cross-user leak surface. The P1 already has 5 recurrences; a new vector is unacceptable without a hardening story first.
4. Prior art (`QueryProvider.tsx:40` CP360 Option A comment) explicitly warns per-session client swap is the structural defence. Persistence must not bypass it.

Revert was clean (no commit; `git restore` + `rm` of new files).

Conditions under which Phase A' may be retried:

- Backend ETag / Cache-Control (Option B) lands first so 304 responses
  provide the "instant data" feel without client-side replay risk.
- A cache-fingerprint strategy (signed token per userId slot) is in place
  so a restored slot cannot be served to a different session.
- The test above has been re-run and #4 (cross-user) gate is green on
  at least one full week of production traffic.

---

## Known gaps / open items

- Backend ETag / `Cache-Control: private, must-revalidate` on the main
  GET endpoints (Option B) — not started.
- Client-side abuse interstitial (Google `/sorry/` pattern) — not started.
- Route-level code split for `IndexPage` (969 lines) — not started.
- `staleTime` tuning from 30s to 5–10min for list/detail queries — not started.
- `useYouTubeAuth.ts:193` POST 400 — tracked separately.

---

## Related code (do-not-touch-without-audit list)

These files are on the hot path for the test and carry hard rules
(CLAUDE.md):

- `frontend/src/app/providers/QueryProvider.tsx` — per-session
  QueryClient, Issue #369 structural defence.
- `frontend/src/features/auth/model/AuthContext.tsx` — auth cache
  pattern, instant-render from localStorage.
- `frontend/src/widgets/app-shell/ui/AppShell.tsx` — DnDContext lives
  here. Moving it breaks D&D.
- `frontend/src/pages/index/ui/IndexPage.tsx` — call sites for BootShell.

Phase B files (safe to revert independently):

- `frontend/index.html`
- `frontend/src/shared/ui/BootShell.tsx`
- `frontend/src/pages/index/ui/IndexPage.tsx` (the two Loader2 → BootShell swaps)

Rollback command for Phase B:

```bash
git restore frontend/index.html frontend/src/pages/index/ui/IndexPage.tsx
rm -f frontend/src/shared/ui/BootShell.tsx
```

---

## Reference artifacts (2026-04-17 session)

- Screenshots: `~/Documents/bug report/0417009-연속 새로고침-엣지케이스 테스트/` — 14 PNG captures spanning Insighta before/after, plus Google, Apple, Goodnotes, YouTube comparisons.
- HAR: `~/Downloads/localhost.har` — 1 entry, captured without "Preserve log" so of limited forensic value. Future captures should follow Section A above.

---

**Last updated:** 2026-04-17
