## Commit Scope Note

Commit `a25ef0d` (dataset/v4 purge log) inadvertently included 3 non-dataset
files that were work-in-progress on this branch:

- `frontend/src/pages/index/ui/IndexPage.tsx` — main padding style tweak (`px-4 py-4` → `px-6 md:px-10 lg:px-[70px] py-6`)
- `frontend/src/widgets/card-list-view/ui/CardListView.tsx` — 13-line component adjustment
- `src/modules/mandala/manager.ts` — 27-line module logic change

These are part of this branch's intended work (wizard/sidebar/video-discover
series). Squash merge will consolidate them into the final merged commit. No
functional issue — recorded for reviewer visibility.

Root-cause investigation deferred: `lint-staged` config appeared standard, but
3 unstaged files somehow entered the commit. No reproduction in hand.
