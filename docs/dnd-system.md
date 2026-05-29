---
name: D&D System Architecture & Troubleshooting
last_updated: 2026-05-29 (CP489)
applies_to: frontend/src/{shared/lib/dnd,pages/index,widgets/{app-shell,mandala-grid,card-list,card-list-view,sidebar-heat-minimap,scratch-pad,add-cards-panel}}, prisma/migrations/user-video-states-guards
---

# D&D System Architecture & Troubleshooting

This document is the canonical reference for the drag-and-drop system. It
exists because every D&D-related session re-discovers the same plumbing
invariants and recently-broken regressions; future sessions should read
this BEFORE touching D&D code (CLAUDE.md §D&D Protection enforces this).

The historical record of regressions and recovery is in `memory/troubleshooting.md`
(LEVEL-1+ entries tagged D&D) and `memory/work-efficiency.md`. This file is the
*current* state of the system.

---

## 1. Plumbing Invariants (CLAUDE.md §D&D Protection)

Four invariants. Smoke-tested in `frontend/src/__tests__/smoke/dnd-context-structure.test.ts`
(12 tests) + `collision-detection.test.ts` (4 tests). CI D&D Change Guard
warns when any of the protected files is touched in a PR.

| # | Invariant | File:line | Guard |
|---|-----------|-----------|-------|
| 1 | DndContext lives ONLY in AppShell.tsx — never in IndexPage | `widgets/app-shell/ui/AppShell.tsx:101-135` (single host) + `pages/index/ui/IndexPage.tsx:1116` has DragOverlay only | smoke test "AppShell.tsx must contain DndContext" + "IndexPage.tsx must NOT contain DndContext" |
| 2 | `dndHandlersRef` is a module-level ref, assigned synchronously during IndexPage render (never via useEffect) | `stores/shellStore.ts:17` exports the ref; `pages/index/ui/IndexPage.tsx:792` writes; `widgets/app-shell/ui/AppShell.tsx:105-108` reads via wrapper callbacks | smoke test "shellStore.ts must export dndHandlersRef" + "IndexPage.tsx must set dndHandlersRef.current during render" |
| 3 | The `minimapData` useEffect deps array MUST include `cards.cardsByCell` | `pages/index/ui/IndexPage.tsx:822` | smoke test "minimapData useEffect must include cardsByCell in deps" |
| 4 | Collision detection = `pointerWithinThenClosest` (not raw `rectIntersection` or `closestCenter`) | `shared/lib/dnd/collisionDetection.ts:17` + AppShell:103 | smoke test "collision-detection.test.ts" 4 cases |

### Why invariant 1 exists
Mounting DndContext inside IndexPage breaks drags between the Sidebar
minimap and the main grid — the sidebar lives outside IndexPage's tree,
so a sidebar-mounted draggable cannot reach a grid-mounted droppable.
Origin incident: CP324 (2026-03-30). Recurrence prevention: smoke test.

### Why invariant 2 exists
`dndHandlersRef` is the bridge between IndexPage (which owns the dnd-kit
handlers — they close over `cards`, `navigation`, etc.) and AppShell
(which mounts DndContext). Sync-via-useEffect introduces a 1-frame delay
during which the first drag after a state change uses stale handlers.
The module-level ref pattern is render-time-assigned, which means there
is no stale window. Same principle reused by `learning/model/noteEditorBridge.ts`.

### Why invariant 3 exists
`minimapData.cardsByCell` is what the sidebar minimap reads to render
its 9 heat-indicator dots. Forgetting `cards.cardsByCell` in the deps
array means the sidebar counts go stale after every drop. Origin: an
auto-deps-fixer once stripped it. Recurrence prevention: smoke test +
ESLint override (`prefer-const`, `no-unused-vars` set to `warn` instead
of `error` so autofix doesn't touch this file).

### Why invariant 4 exists
Default `rectIntersection` is unreliable when the draggable is much
smaller than the droppable (e.g. ScratchPad's 80×45 thumbnails dropping
on full-grid cells). `pointerWithinThenClosest` does:
1. Try `pointerWithin` — works perfectly when the pointer is inside the
   droppable rect.
2. Fall back to `closestCenter`, filtered to exclude `drag-card-*`
   droppables, so dragging from a docked ScratchPad across the gap to
   the grid doesn't accidentally land on a nearby sortable card.

---

## 2. Card Source Model (4-source merge with normalizeUrl dedupe)

`useCardOrchestrator.allMandalaCards` is a 4-way merge:

```ts
const merged = [
  ...mandalaLocalCards,    // filter of useLocalCards (user_local_cards table)
  ...mandalaVideoCards,    // filter of useAllVideoStates (user_video_states table)
  ...pendingMandalaCards,  // optimistic in-flight, pre-server-ack
  ...streamMandalaCards,   // SSE recommendation_cache backlog
];
// dedupe by normalizeUrl(card.videoUrl) — earlier sources win.
```

### Stream-card id prefix invariant (CP489 fix)

`streamMandalaCards` cards have ids of the form `stream-<recommendation_cache.id>`
(see `features/recommendation-feed/lib/recommendationToInsightCard.ts:29`).
These ids are NOT in any of `syncedCards` / `persistedLocalCards` /
`pendingLocalCards`, so any helper that searches those three source arrays
will miss stream-origin cards.

`getCardById` therefore takes a 5th argument `streamCards?: InsightCard[] = []`
(default empty for back-compat). All 5 callsites in `useCardOrchestrator`
pass `streamMandalaCards`. Smoke test pins this:
`__tests__/getCardById-stream-source.test.ts`.

### Stream-card mutation contract (CP489 fix)

A stream card cannot directly back a `user_video_states` UPDATE — its id
doesn't exist as a `user_video_states.id`. Mutations that target a stream
card must first resolve the stream id to the backing synced/local row by
`normalizeUrl(videoUrl)`. `resolveStreamCardId` in `useCardOrchestrator.ts`
implements this:

```ts
const resolveStreamCardId = useCallback((id: string): string | null => {
  if (!id.startsWith('stream-')) return id;
  const streamCard = streamMandalaCards.find((c) => c.id === id);
  if (!streamCard) return null;
  const normalized = normalizeUrl(streamCard.videoUrl);
  const synced = syncedCards.find((c) => normalizeUrl(c.videoUrl) === normalized);
  if (synced) return synced.id;
  const local = persistedLocalCards.find((c) => normalizeUrl(c.videoUrl) === normalized);
  if (local) return local.id;
  return null;
}, [streamMandalaCards, syncedCards, persistedLocalCards]);
```

`handleCardDrop` / `handleScratchPadCardDrop` / `handleScratchPadMultiCardDrop`
all call this at function entry. If resolution returns `null` (no backing
row exists yet — the recommendation_cache row hasn't been promoted to
`user_video_states`), the handler emits a `cardSyncing` toast and returns
without mutating. The user is asked to wait and retry; no data loss.

### Origin pre-CP489
The 4th source `streamMandalaCards` was added in PR #666 (CP471,
2026-05-19) without updating `getCardById`'s signature. For 10 days,
drags targeting stream-origin cards silently failed (`getCardById === null`
→ early return; toast never fired). User-visible symptom (CP489):
"12 cards selected, drag to Idea Spot, toast says '12 moved' but only 1
actually moved" — the 1 was a non-stream source, the 11 were stream.

Recurrence prevention: smoke test + this section.

---

## 3. cell_index Regression Trigger

Migration: `prisma/migrations/user-video-states-guards/`

### 001_protect_cell_index_regression.sql (PR #676, CP474, 2026-05-19)
DB trigger blocks any `cell_index >= 0 → -1` UPDATE on `user_video_states`.
Originally added to stop the `cards.ts /like` ON CONFLICT bookmark-loss
incident — a buggy UPSERT was overwriting placed cards' cell_index back
to -1, stranding them in scratchpad.

### 002_allow_intentional_scratchpad_move.sql (CP489, 2026-05-29)
The 001 trigger blocked EVERY `cell_index >= 0 → -1`, including legitimate
scratchpad/delete demotions (handleScratchPadCardDrop /
handleScratchPadMultiCardDrop / handleDeleteCards). The 001 SQL comment
had promised a "dedicated /unpin-cell endpoint that bypasses this guard
intentionally," but that endpoint was never implemented — so legitimate
demote paths silently failed for 10 days. CP489 user-visible symptom:
batch-update-video-state EF logged 11× `code 23514 cell_index regression
blocked: was=4 new=-1` while the FE toast still claimed "12 moved" (the
EF returns 200 with `updatedCount` that the FE ignores).

Recovery without dropping the protection: the 002 migration adds an
explicit-demote escape clause to the trigger:

```sql
IF OLD.cell_index >= 0
   AND NEW.cell_index = -1
   AND NOT (NEW.level_id = 'scratchpad' AND NEW.mandala_id IS NULL)
THEN RAISE EXCEPTION ...
```

The pair `level_id='scratchpad' AND mandala_id IS NULL` is the signature
of an intentional UI-driven demote. Silent stranding (a bare
`cell_index=-1` without level/mandala changes) is still blocked.

### Caller compliance
All current FE/BE/EF callers that demote a synced card to scratchpad
set the full 4-tuple. Audited 2026-05-29:

| Path | Location | 4-tuple set? |
|------|----------|--------------|
| handleScratchPadCardDrop (single synced) | `useCardOrchestrator.ts:1270-1273` | ✓ |
| handleScratchPadMultiCardDrop (multi synced) | `useCardOrchestrator.ts:1322` → `useBatchMoveCards.ts:53-66` | ✓ |
| handleDeleteCards (cell card) | `useCardOrchestrator.ts:1477-1480` | ✓ |
| cards.ts BE user_video_states UPDATE | `src/api/routes/cards.ts:227, 432, 620` | N/A (cell_index never touched) |

Adding a new path that sets `cell_index=-1` MUST set `level_id='scratchpad'`
+ `mandala_id=NULL` together, or the trigger will reject it.

---

## 4. Mutation Path Matrix

| Action | FE handler | BE/EF endpoint | Trigger reaches? | Notes |
|--------|-----------|----------------|-------------------|-------|
| Place card on cell (synced) | handleCardDrop | youtube-sync/update-video-state | N (cell_index -1 → N) | Allowed |
| Move card between cells (synced) | handleCardDrop | youtube-sync/update-video-state | N (cell_index ≥ 0 → ≥ 0) | Allowed |
| Demote single card to scratchpad (synced) | handleScratchPadCardDrop | youtube-sync/update-video-state | Y | Allowed via 4-tuple |
| Demote multi cards to scratchpad (synced) | handleScratchPadMultiCardDrop | youtube-sync/batch-update-video-state | Y | Allowed via 4-tuple |
| Delete cell card (synced) | handleDeleteCards (isInMandala) | youtube-sync/update-video-state | Y | Allowed via 4-tuple |
| Reorder within cell | handleCardsReorder | useBatchMoveCards | N (cell_index unchanged) | — |
| All local-card paths | various | local-cards EF | N/A | user_local_cards table, no trigger |

---

## 5. External (HTML5) Drop Paths

Three external drop receivers (URL/file/cardId from outside dnd-kit):
- `widgets/mandala-grid/ui/MandalaCell.tsx` `handleExternalDrop` (line ~410)
- `widgets/sidebar-heat-minimap/ui/SidebarHeatMinimap.tsx` `handleExternalDrop`
- `widgets/card-list-view/ui/CardListView.tsx` `handleExternalDrop`

All three accept `text/uri-list` + `text/plain` + `text/html` for URL
parsing, plus `application/card-id` + `application/multi-card-ids` for
intra-app drags. None of them call `stopPropagation` — the document-level
listener in `useCardDragDrop` MUST fire to reset the overlay state, even
if the cell-level handler also fires.

### YouTube channel/playlist guard
`IndexPage:1000-1016` rejects YouTube non-video URLs (channel home,
playlist that has no video id) with a toast — these used to silently
create placeholder cards.

---

## 6. Render-Time Defences

### HTML entity decode (CP489 fix)
YouTube Data API v3 returns `snippet.title` and `snippet.channelTitle`
with HTML entities escaped (`&quot;`, `&#39;`, `&amp;`, etc.). The DB
trigger `trg_decode_youtube_videos_titles` (migration
`prisma/migrations/youtube-videos-decode-entities/001_decode_entities.sql`)
decodes on every INSERT/UPDATE — so new writes are clean. The FE
`decodeHtmlEntities` calls at render sites are defence against rows the
backfill hasn't reached yet:
- `widgets/card-list/ui/InsightCardItemV2.tsx:598, 684`
- `widgets/card-list/ui/MandalaCell.tsx:109` (CP489 added)
- `widgets/add-cards-panel/ui/AddCardsList.tsx:289` (CP489 added)

---

## 7. Regression Watchlist

When touching any of the following, re-read this document AND run
`npx vitest run src/__tests__/smoke/dnd-context-structure.test.ts`
`src/__tests__/smoke/collision-detection.test.ts`
`src/__tests__/getCardById-stream-source.test.ts` BEFORE pushing:

- Adding a new InsightCard source array → update getCardById + detectCardSource callsites in `useCardOrchestrator.ts` (CP488 IT "Cross-Layer Propagation grep ALL consumers")
- Adding a new path that sets `cell_index=-1` → must also set `level_id='scratchpad' + mandala_id=NULL` together
- Changing the `dndHandlersRef` write timing (e.g. moving it into useEffect) → invariant 2 broken, first drag after every render is stale
- Adding a new DndContext anywhere outside AppShell.tsx → invariant 1 broken
- Removing `cards.cardsByCell` from the minimapData effect deps → invariant 3 broken
- Changing `pointerWithinThenClosest` → re-run collision-detection.test.ts; the scratchpad-priority and drag-card-* filter rules are not optional

---

## 8. Cross-references

- CLAUDE.md §D&D Protection (Hard Rule)
- CLAUDE.md §Cross-Layer Propagation (Hard Rule) — getCardById drift was a direct case
- `memory/troubleshooting.md` LEVEL-1+ entries tagged D&D
- `memory/work-efficiency.md` "Browser-env specific 진단 first action 순서" (CP489)
- `tests/regression/dnd-smoke.spec.ts` + `card-dnd.spec.ts` (Playwright)
