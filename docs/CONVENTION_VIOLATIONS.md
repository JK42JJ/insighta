# Convention Violations — Phase 1

> Detected on 2026-03-19. **All 20 violations resolved (2026-03-27, CP296).**

## 1. Deep Relative Imports (3+ levels)

All in `src/api/routes/admin/` — `import { db } from '../../../modules/database/client'`

| File | Should Be |
|------|-----------|
| `admin/promotions.ts:3` | `import { db } from '@/modules/database/client'` |
| `admin/content.ts:3` | same |
| `admin/payments.ts:3` | same |
| `admin/audit.ts:3` | same |
| `admin/stats.ts:2` | same |
| `admin/analytics.ts:3` | same |
| `admin/users.ts:3` | same |
| `admin/reports.ts:3` | same |
| `admin/redemption.ts:3` | same |
| `admin/health.ts:2` | same |

Also: `createErrorResponse`, `createSuccessResponse` imports in these files use deep relative paths.

## 2. Magic Number Hardcoding

### YouTube API quota (10000 in 4+ locations)

| File | Line | Value | Should Be |
|------|------|-------|-----------|
| `adapters/YouTubeAdapter.ts:806` | `quotaLimit ?? 10000` | `YOUTUBE_DAILY_QUOTA_LIMIT` (config already exists in `config/index.ts`) |
| `adapters/YouTubeAdapter.ts:831` | `quotaLimit ?? 10000` | same |
| `adapters/YouTubeAdapter.ts:884` | `quotaLimit ?? 10000` | same |
| `adapters/YouTubeAdapter.ts:962` | `quotaLimit ?? 10000` | same |

### Business logic thresholds

| File | Line | Value | Suggested Constant |
|------|------|-------|--------------------|
| `modules/analytics/tracker.ts:378` | `>= 50` | `COMPLETION_THRESHOLD_PERCENT` |
| `modules/analytics/tracker.ts:380` | `80, 60, 40, 30, 14, 7, 3` | `RETENTION_SCORE_THRESHOLDS`, `REVIEW_INTERVAL_DAYS` |
| `modules/scheduler/auto-sync.ts:302` | `< 100` | `QUOTA_SKIP_THRESHOLD` |
| `api/routes/mandalas.ts:150` | `> 100` | `MAX_PAGINATION_LIMIT` |

### Time constants

| File | Line | Value | Suggested Constant |
|------|------|-------|--------------------|
| `modules/scheduler/auto-sync.ts:353` | `6 * 60 * 60 * 1000` | `DEFAULT_SYNC_INTERVAL_MS` |
| `modules/scheduler/auto-sync.ts:360` | `60 * 1000` | `MIN_SYNC_INTERVAL_MS` |

## Summary

| Category | Count |
|----------|-------|
| Deep relative imports | 10 files |
| Magic numbers (quota) | 4 locations |
| Magic numbers (business logic) | 4 locations |
| Magic numbers (time) | 2 locations |
| **Total** | **20 violations** |
