# Test Infrastructure — Insighta

> Last updated: 2026-03-28

## Overview

| Layer                | Framework          | Config                      | CI Job          | Files | Status              |
| -------------------- | ------------------ | --------------------------- | --------------- | ----- | ------------------- |
| Backend (unit/smoke) | Jest + ts-jest     | `jest.config.ts`            | `test-backend`  | 18    | 18 pass (263 tests) |
| Frontend (smoke)     | Vitest + happy-dom | `frontend/vitest.config.ts` | `test-frontend` | 14    | 14 pass (142 tests) |
| E2E (regression)     | Playwright         | —                           | manual          | 8     | manual only         |

## Backend Tests (Jest)

**Location**: `tests/`
**Run**: `npx jest --rootDir . --testMatch '**/tests/**/*.test.ts'`
**CI env**: `SUPABASE_JWT_SECRET=test` (enables server boot)

### Smoke Tests (`tests/smoke/`)

| File                     | Tests | Description                                                                          |
| ------------------------ | ----- | ------------------------------------------------------------------------------------ |
| `health.test.ts`         | 2     | `GET /health` returns 200 + status ok                                                |
| `auth-guard.test.ts`     | 3     | Protected routes reject unauthenticated requests                                     |
| `bot-api.test.ts`        | 9     | Bot auth rejection + authenticated endpoints (mood, report, subscriptions, pending)  |
| `prisma-connect.test.ts` | 2     | Prisma client connection + query                                                     |
| `youtube-api.test.ts`    | 3     | YouTube subscriptions/playlists auth rejection + env check                           |
| `sharing-api.test.ts`    | 6     | Sharing CRUD (create/view/clone/list/delete) + bot write guard                       |
| `admin-api.test.ts`      | 13    | Admin endpoint auth rejection (9 routes) + invalid token + subscription/status PATCH |
| `notes-api.test.ts`      | 14    | Notes/Quota/Subscriptions/Ontology API auth rejection (14 endpoints) |

**Note**: Smoke tests use `describeIfServer` pattern — skipped in CI when env vars missing, run locally with real DB.

### Unit Tests (`tests/unit/`)

| File                              | Tests | Status                                                                                       |
| --------------------------------- | ----- | -------------------------------------------------------------------------------------------- |
| `api/mandala-routes.test.ts`      | 111   | Pass                                                                                         |
| `modules/mandala-manager.test.ts` | 24    | Pass (pro tier naming, quota limits)                                                         |
| `modules/context-builder.test.ts` | 24    | Pass (TypeScript cast, @/ alias imports)                                                     |
| `modules/job-queue.test.ts`       | 18    | Pass (pg-boss manager lifecycle, singleton, connection string handling, type constants)      |
| `modules/queue-handlers.test.ts`  | 7     | Pass (enrich-video enqueue/register, batch-scan register/schedule, initJobQueue integration) |
| `modules/quota-manager.test.ts`   | 14    | Pass (getOperationCost per type, calculateSyncCost page boundaries)                         |
| `modules/llm-keys.test.ts`        | 12    | Pass (AES-256-GCM encrypt/decrypt roundtrip, maskKey, provider validation, listKeys)        |
| `modules/note-manager.test.ts`    | 15    | Pass (formatTimestamp, mapToVideoNote, exportToJSON, exportToCSV escaping)                   |
| `modules/caption-extractor.test.ts` | 14  | Pass (parseJson3 JSON3 parser: valid/empty/edge cases, singleton)                           |
| `modules/enrichment-scheduler.test.ts` | 13 | Pass (lifecycle start/stop, getStatus shape, getHistory, singleton)                        |

## Frontend Tests (Vitest)

**Location**: `frontend/src/__tests__/`
**Run**: `cd frontend && npx vitest run`
**CI env**: Node 20 + `npm install --no-package-lock` (npm/cli#4828)

### Smoke Tests (`frontend/src/__tests__/smoke/`)

| File                              | Tests | Description                                                               |
| --------------------------------- | ----- | ------------------------------------------------------------------------- |
| `app-smoke.test.ts`               | 3     | App component renders without crash                                       |
| `card-validation.test.ts`         | 7     | Card URL validation + shell card detection                                |
| `detect-link-type.test.ts`        | 10    | Link type detection (YouTube, URL, hostname whitelist)                    |
| `image-utils.test.ts`             | 6     | Thumbnail URL generation + fallback chain                                 |
| `url-normalize.test.ts`           | 15    | YouTube URL variants (9) + generic URL normalization + edge cases         |
| `note-markdown.test.ts`           | 13    | Timestamp extraction (4) + markdown parsing (9: text/link/image/mixed)    |
| `collision-detection.test.ts`     | 4     | D&D pointerWithinThenClosest collision strategy + scratchpad priority     |
| `graph-converters.test.ts`        | 16    | Ontology→Graph conversion (node/edge/category/val clamp/edge filter)      |
| `offline-queue.test.ts`           | 9     | IndexedDB offline mutation queue (enqueue/getAll/remove/flushQueue)       |
| `localStorage-validation.test.ts` | 19    | Zod schema validation + localStorage parsing (MandalaLevel/SubLevel/JSON) |
| `fileUpload.test.ts`              | 14    | File type detection + supported check + file icons                        |
| `slash-commands.test.ts`          | 14    | Slash command registry + player-dependent filtering                       |
| `supabase-auth.test.ts`          | 5     | Edge Function URL construction (getEdgeFunctionUrl)                       |

### Store Tests (`frontend/src/__tests__/stores/`)

| File                   | Tests | Description                                               |
| ---------------------- | ----- | --------------------------------------------------------- |
| `mandalaStore.test.ts` | 7     | Zustand mandala UI store (state + actions + independence) |

**Note**: Supabase client mocked via `setupFiles` (`frontend/src/__tests__/setup.ts`).

## E2E Tests (Playwright)

**Location**: `tests/regression/`, `tests/`
**Run**: `npx playwright test` (requires running dev server on :8081)

| File                                 | Description                                 |
| ------------------------------------ | ------------------------------------------- |
| `regression/card-dnd.spec.ts`        | Card drag & drop across contexts            |
| `regression/card-e2e.spec.ts`        | Card CRUD lifecycle                         |
| `regression/dnd-smoke.spec.ts`       | D&D basic functionality (CI gate candidate) |
| `regression/diagnose.spec.ts`        | Diagnostic page rendering                   |
| `regression/settings.spec.ts`        | Settings page full E2E                      |
| `regression/sidebar-mandala.spec.ts` | Sidebar mandala section                     |
| `a11y.spec.ts`                       | Accessibility audit                         |
| `debug-render.spec.ts`               | Debug render checks                         |

**No Playwright config at project root** — E2E tests are manual-run only.

## CI Pipeline

```
ci.yml
├── test-backend    → Jest smoke tests (gate for build/deploy)
├── test-frontend   → Vitest smoke tests (gate for build/deploy)
├── build-frontend  → Vite production build
├── deploy          → EC2 deploy (depends on all above)
└── typecheck       → D&D Change Guard (PR warning)
```

**Gate rule**: `test-backend` + `test-frontend` must pass before `build-frontend` and `deploy`.

## Running Tests

```bash
# Backend smoke (local, needs running DB)
SUPABASE_JWT_SECRET=test npx jest --rootDir . --testMatch '**/tests/**/*.test.ts'

# Backend smoke (CI-safe, no DB)
npx jest --rootDir . --testMatch '**/tests/smoke/*.test.ts'

# Frontend (local, Node 20 recommended)
cd frontend && npx vitest run

# Frontend single file
cd frontend && npx vitest run src/__tests__/smoke/card-validation.test.ts

# Bot API tests (needs INSIGHTA_BOT_KEY in .env)
SUPABASE_JWT_SECRET=test INSIGHTA_BOT_KEY=<key> INSIGHTA_BOT_USER_ID=<id> npx jest tests/smoke/bot-api.test.ts

# E2E (manual, needs dev server)
npx playwright test tests/regression/dnd-smoke.spec.ts
```

## Known Issues

- `mandala-manager.test.ts` and `context-builder.test.ts` — fixed (CP299, 2026-03-27)
- Frontend Vitest requires Node 20 (Node 24 has rollup native module issue)
- Playwright has no root config — E2E runs are manual
- Bot API authenticated tests skip in CI (no INSIGHTA_BOT_KEY in GitHub Secrets)

## Coverage

No coverage reporting configured yet. Future: `--coverage` flag + threshold enforcement.
