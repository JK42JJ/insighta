#!/usr/bin/env bash
# CP500++ PR-2 — card-placement chokepoint guard (INV-CHOKEPOINT-ENFORCED).
#
# DISCOVERY auto-inflow cards (auto_added=true) may be inserted into
# user_video_states ONLY through `placeAutoAddedCards`
# (src/modules/mandala/place-auto-added-cards.ts). Any other `auto_added: true`
# insert reintroduces a bypass (a new executor / pool path / direct INSERT) and
# silently re-splinters the single chokepoint — the exact failure mode this
# refactor closed (pool-serve used to write uvs directly).
#
# NOT a target (boundary — these must keep working):
#   - user-action placements: like / pin  → auto_added:false
#   - non-discovery placements: playlist sync, watch-state upsert, manual D&D
# They never set auto_added:true, so they pass this guard naturally.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Allowed files:
#   - place-auto-added-cards.ts        : the chokepoint INSERT itself.
#   - auto-add-recommendations.ts      : its only `auto_added: true` are the
#     selective-replace WHERE clauses (count + deleteMany of un-touched
#     auto_added rows) — NOT inserts (placement moved to the primitive). Those
#     are byte-identical to an insert literal, so they cannot be distinguished
#     line-locally; the file is excluded by name. The guard's purpose is to
#     catch a NEW bypass path (a new executor / pool-style direct write) in some
#     OTHER file — exactly the failure mode this refactor closed.
ALLOW_RE='/(place-auto-added-cards|auto-add-recommendations)\.ts:'

# Prisma object-literal form used by createMany/create/upsert data: `auto_added: true`.
hits="$(grep -rEn 'auto_added:[[:space:]]*true' "$ROOT/src" --include='*.ts' \
  | grep -vE "$ALLOW_RE" || true)"

if [ -n "$hits" ]; then
  echo "FAIL — auto_added:true insert outside the placeAutoAddedCards chokepoint:"
  printf '%s\n' "$hits" | sed 's/^/    /'
  echo "  -> route discovery card placement through placeAutoAddedCards (src/modules/mandala/place-auto-added-cards.ts)."
  echo "     user-action (like/pin) and non-discovery (playlist/watch/manual) use auto_added:false and are exempt."
  exit 1
fi

echo "card-chokepoint: OK — auto_added:true confined to placeAutoAddedCards"
