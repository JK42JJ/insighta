# Mobile morning cards: swipe code reuse decision (#1788)

## Decision

Do not reuse the existing swipe code. Write a small React hook (`use-card-swipe`) in the new
`frontend/src/features/morning-cards` feature.

## What was searched

- `frontend/index.html` is 127 lines (Vite entry), so the lines 6283-6330 cited in the issue do not exist there.
- The cited range matches `frontend/public/mobile/index.html` (7256 lines, a standalone static page), not the React app.
- Searched `frontend/src` and `frontend/public/mobile/index.html` for `swipe`, `touchstart`, `touchend`, `pointerdown`.
- The React app (`frontend/src`) has no swipe hook. Only `useDragSelect` (mouse selection) and
  pointer-stop handlers in `VideoPlayerModal.tsx` exist, and neither is a card swipe.

## What the static page offers (lines ~6283-6433)

| Lines | Behavior | Fit |
|-------|----------|-----|
| 6287-6337 | Swipe-DOWN to dismiss the YouTube connect sheet; sideways swipes are explicitly cancelled | No: wrong axis |
| 6417-6433 | Left-to-right swipe closes the curation deck (`MIN_X=70`, `MAX_Y=45`) | No: back navigation, one direction, no left/right verdict |
| 6498-6535 | `cdStrip` vertical drag with momentum to travel through deck cards | No: vertical navigation, no verdict, tied to deck state |

All of them are vanilla DOM handlers bound by element id inside a 7k-line inline script. They cannot be
imported by React components and have no left/right verdict semantics.

## What is reused (ideas only)

- The pattern of a named distance threshold plus a vertical tolerance (`MIN_X` / `MAX_Y`).
- Controls (buttons, links) are not drag surfaces.

## Consequences

- The new hook uses pointer events, named constants for the thresholds, right = useful, left = skip, no undo.
- `MobileGateNotice` in the router must be bypassed only for the flagged morning-cards route (separate feature).
