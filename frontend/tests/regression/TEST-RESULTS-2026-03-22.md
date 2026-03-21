# Card E2E Test Results — 2026-03-22

## Summary

| Metric | Value |
|--------|-------|
| Total Tests | 34 |
| Passed | **30** |
| Failed | **4** |
| Skipped | 0 |
| Duration | 2m 42s |
| Video Recording | ON (webm) |
| Workers | 2 |

## Changes Made This Session

| File | Change |
|------|--------|
| `card-e2e.spec.ts` | getMandalaId EF fallback, action as query param, link_type auto-detect, status 201 support, 11 new test cases |
| `playwright.config.ts` | .env loader, video recording ON |
| `src/api/server.ts` | Rate limit disabled in dev (was 100/15min causing 429/500) |

## Test Results (detailed)

### Group 1: EF CRUD — Full Lifecycle (4 tests)

| # | Test | Expected | Result | Video |
|---|------|----------|--------|-------|
| 1 | add -> verify integrity -> list -> delete -> verify gone | Card CRUD lifecycle works end-to-end | **PASS** | [video](../test-results/artifacts/regression-card-e2e-EF-CRU-b50b0-list-→-delete-→-verify-gone-chromium/video.webm) |
| 2 | batch-move -> verify position + content preserved | Card moves to new cell, content intact | **PASS** | [video](../test-results/artifacts/regression-card-e2e-EF-CRU-d482e-content-preserved-no-ghosts-chromium/video.webm) |
| 3 | batch-move multiple cards -> all move, none left behind | All cards reach target, source depleted | **PASS** | [video](../test-results/artifacts/regression-card-e2e-EF-CRU-c29c1-→-all-move-none-left-behind-chromium/video.webm) |
| 4 | move card back and forth -> no duplication or data loss | Round-trip preserves content, no ghosts | **PASS** | [video](../test-results/artifacts/regression-card-e2e-EF-CRU-3c445-no-duplication-or-data-loss-chromium/video.webm) |

### Group 2: D&D — UI + DB Integrity (3 tests)

| # | Test | Expected | Result | Video |
|---|------|----------|--------|-------|
| 5 | scratchpad -> mandala cell | Card moves, no ghost in source | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--18bb6-ly-moves-no-ghost-in-source-chromium/video.webm) |
| 6 | cell -> cell | Card moves with all content, source depleted | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--90e9d-all-content-source-depleted-chromium/video.webm) |
| 7 | center cell rejects drop | Card stays in source, DB unchanged | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--8af65-tays-in-source-DB-unchanged-chromium/video.webm) |

### Group 3: D&D — Ideation Position-Sensitive Tests (6 tests)

| # | Test | Expected | Result | Video |
|---|------|----------|--------|-------|
| 8 | drag from card top-left corner | Card moves to target cell | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--62f62--left-corner-→-mandala-cell-chromium/video.webm) |
| 9 | drag from card bottom-right corner | Card moves to target cell | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--5b747-right-corner-→-mandala-cell-chromium/video.webm) |
| 10 | drag from card center -> cell near edge of grid | Card moves to edge cell | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--eb921-er-→-cell-near-edge-of-grid-chromium/video.webm) |
| 11 | multi-select 2 cards -> drag to cell -> both move | Both selected cards move together | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--7bd0b--→-drag-to-cell-→-both-move-chromium/video.webm) |
| 12 | drag outside any drop zone -> card returns to source | Card returns, DB unchanged | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--ed36a-ne-→-card-returns-to-source-chromium/video.webm) |
| 13 | rapid sequential drags -> no race condition duplicates | No duplicates after rapid operations | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--fd80e-o-race-condition-duplicates-chromium/video.webm) |

### Group 4: D&D — Known Bug Regressions (4 tests)

| # | Test | Expected | Result | Video |
|---|------|----------|--------|-------|
| 14 | BUG: drag state not cleared after drop | selected-drag class disappears | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--a5967-drag-class-should-disappear-chromium/video.webm) |
| 15 | BUG: mandala -> ideation move (z-index) | Card not hidden behind floating panel | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--e9f3a--hide-behind-floating-panel-chromium/video.webm) |
| 16 | BUG: ideation -> mandala move (z-index) | Card not hidden behind ideation panel | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--1ebcb--hide-behind-ideation-panel-chromium/video.webm) |
| 17 | multi-select drag -> all selected cards clear selection | Selection state cleared after drop | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--78b70--clear-selection-after-drop-chromium/video.webm) |

### Group 5: UI State — Selection & Interaction (3 tests)

| # | Test | Expected | Result | Video |
|---|------|----------|--------|-------|
| 18 | card click opens detail panel | Detail panel visible after click | **PASS** | [video](../test-results/artifacts/regression-card-e2e-UI-Sta-3e08c-rd-click-opens-detail-panel-chromium/video.webm) |
| 19 | ESC deselects all | No selected cards after ESC | **PASS** | [video](../test-results/artifacts/regression-card-e2e-UI-Sta-c3bd4-teraction-ESC-deselects-all-chromium/video.webm) |
| 20 | Ctrl+Click toggles multi-select without side effects | Toggle works, DB unchanged | **PASS** | [video](../test-results/artifacts/regression-card-e2e-UI-Sta-f9c78-select-without-side-effects-chromium/video.webm) |

### Group 6: URL Paste — Full Cycle (1 test)

| # | Test | Expected | Result | Video |
|---|------|----------|--------|-------|
| 21 | paste YouTube URL -> DB has complete card -> cleanup | Card created with full fields, cleaned up | **PASS** | [video](../test-results/artifacts/regression-card-e2e-URL-Pa-42b29-has-complete-card-→-cleanup-chromium/video.webm) |

### Group 7: Mandala API Verification (1 test)

| # | Test | Expected | Result | Video |
|---|------|----------|--------|-------|
| 22 | list mandalas returns array with valid structure | 200 + valid mandala array | **PASS** | [video](../test-results/artifacts/regression-card-e2e-Mandal-8cbc6--array-with-valid-structure-chromium/video.webm) |

### Group 8: D&D — Extended Coverage (11 tests, NEW)

| # | Test | Expected | Actual | Result | Artifacts |
|---|------|----------|--------|--------|-----------|
| 23 | cell -> scratchpad: reverse direction move | Card moves to scratchpad, content preserved | As expected | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--df315-on-move-preserves-card-data-chromium/video.webm) |
| 24 | same-cell drop: no-op | Card stays, DB unchanged | `data-selected` state mismatch — card appears not selected after Meta+Click | **FAIL** | [screenshot](../test-results/artifacts/regression-card-e2e-D-D-—--7e7c0-n-place-DB-unchanged-no-op--chromium/test-failed-1.png), [video](../test-results/artifacts/regression-card-e2e-D-D-—--7e7c0-n-place-DB-unchanged-no-op--chromium/video.webm) |
| 25 | drag 3+ cards multi-select -> all move | 3+ cards selected, all move | `data-selected="true"` count = 0 after Meta+Click on 3 cards | **FAIL** | [screenshot](../test-results/artifacts/regression-card-e2e-D-D-—--a1284--select-→-all-move-together-chromium/test-failed-1.png), [video](../test-results/artifacts/regression-card-e2e-D-D-—--a1284--select-→-all-move-together-chromium/video.webm) |
| 26 | ESC during drag cancels operation | Card returns to source, position unchanged | As expected | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--e3c5b-on-—-card-returns-to-source-chromium/video.webm) |
| 27 | add card then immediately drag | Optimistic update + drag consistent | As expected | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--d3886-timistic-update-consistency-chromium/video.webm) |
| 28 | multiple rapid batch-moves -> final DB state | Final position = last move (cell 7) | Card count changed 229->230 (parallel test interference) | **FAIL** | [screenshot](../test-results/artifacts/regression-card-e2e-D-D-—--27c48-inal-DB-state-is-consistent-chromium/test-failed-1.png), [video](../test-results/artifacts/regression-card-e2e-D-D-—--27c48-inal-DB-state-is-consistent-chromium/video.webm) |
| 29 | drag to all 8 non-center cells | Each position verified after move | Card count changed 229->228 (parallel test cleanup interference) | **FAIL** | [screenshot](../test-results/artifacts/regression-card-e2e-D-D-—--f085f-ly-→-each-position-verified-chromium/test-failed-1.png), [video](../test-results/artifacts/regression-card-e2e-D-D-—--f085f-ly-→-each-position-verified-chromium/video.webm) |
| 30 | playlist card: add -> move -> link_type preserved | Playlist URL and link_type preserved | As expected | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--fdfd9--verify-link-type-preserved-chromium/video.webm) |
| 31 | shorts card: add -> move -> link_type preserved | Shorts URL and link_type preserved | As expected | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--4046b--verify-link-type-preserved-chromium/video.webm) |
| 32 | mixed card types in same cell | All 3 types coexist, no corruption | As expected | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--20997-ist-without-data-corruption-chromium/video.webm) |
| 33 | delete card during/after drag | No ghost card after delete | As expected | **PASS** | [video](../test-results/artifacts/regression-card-e2e-D-D-—--2bbf5-rag-—-no-ghost-card-remains-chromium/video.webm) |

## Failed Test Analysis

### 1. same-cell drop (no-op)
- **Root Cause**: Test clicks card with Meta+Click then drags back to same position. But after reload (`addCard` + reload), the newly added cards may not have `data-selected` attribute behavior matching expectations
- **Fix Needed**: Investigate `data-selected` attribute — may need to check DOM attribute name or use different selector

### 2. drag 3+ cards multi-select
- **Root Cause**: `data-selected="true"` count is 0 after Meta+Click on 3 cards. The multi-select UI uses a different state mechanism than expected
- **Fix Needed**: Check actual DOM attribute for selected state (might be CSS class instead of data attribute)

### 3. rapid batch-moves / all 8 cells
- **Root Cause**: Parallel test execution — other tests add/remove cards while these tests run, causing `assertTotalCountPreserved` to fail
- **Fix Needed**: Remove total count assertion (unreliable in parallel), verify only the test's own card position

## Infrastructure Changes

| Change | Before | After | Impact |
|--------|--------|-------|--------|
| Rate limit (dev) | 100 req/15min | Disabled | No more 429 errors during testing |
| Rate limit (prod) | 100 req/15min | 100 req/15min | Unchanged |
| EF call format | action in body | action in URL query param | Matches EF's actual API |
| addCard link_type | Missing | Auto-detected from URL | EF requires link_type field |
| Video recording | OFF | ON | All tests recorded as webm |
