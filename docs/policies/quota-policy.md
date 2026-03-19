# Quota & Rate Limit Policy

> **SSOT**: This document is the single source of truth for all quota, rate limit, and tier-related policies.
> Code implementations MUST reference this document. Hardcoded values MUST match these definitions.

**Last updated**: 2026-03-19

---

## 1. Tier Definitions

| Tier | Description | Billing |
|------|-------------|---------|
| `free` | Default on signup | Free |
| `pro` | Paid subscription | Monthly / Annual |
| `lifetime` | One-time purchase, permanent access | One-time |
| `admin` | Internal operations | N/A |

**Default tier**: `free` (set via `user_subscriptions` table, `COALESCE(tier, 'free')`)

---

## 2. Resource Limits

| Resource | free | pro | lifetime | admin |
|----------|------|-----|----------|-------|
| Mandalas | 3 | 20 | Unlimited | Unlimited |
| Cards | 150 | 1,000 | Unlimited | Unlimited |
| AI Summaries | 150 | 1,000 | Unlimited | Unlimited |
| Reports (weekly) | 10 | Unlimited | Unlimited | Unlimited |

### 2.1 AI Summary Processing Modes

| Mode | Description | Tiers |
|------|-------------|-------|
| Near-realtime | Summary generated immediately on card add, visible in UI | pro, lifetime, admin |
| Background | Queued for async processing, notification on completion | free |

- **free**: Request queued -> background worker processes sequentially -> notification on completion
- **pro+**: Processed immediately -> summary displayed on card (within seconds)
- Under server load, pro may fall back to background (graceful degradation)

---

## 3. API Rate Limits

| Tier | Global (req/min) |
|------|-------------------|
| `free` | 100 |
| `pro` | 300 |
| `lifetime` | Unlimited |
| `admin` | Unlimited |

---

## 4. Promotions & Event Bonuses

| Type | Description | Expiry |
|------|-------------|--------|
| `tier_upgrade` | Tier upgrade (e.g., free -> pro) | Time-limited (optional) |
| `limit_increase` | Increase specific resource limit | Time-limited (optional) |
| `trial_extension` | Extend trial period | Auto-revert on expiry |

- **Temporary boost**: Auto-reverts when promotion period ends
- **Permanent boost**: Applied directly to limit (event reward)
- **Current implementation**: `admin_promotions` + `user_promotion_redemptions` tables (not yet deployed to Cloud)
- **Future**: Separate `user_quota_boosts` table for automatic expiry management

---

## 5. Implementation Status

| Item | Status | Location |
|------|--------|----------|
| Tier default (`free`) | Done | `user_subscriptions` table |
| Mandala quota check | Done | `MandalaManager.createMandala()` |
| Card quota check | Done | Edge Function `local-cards` |
| Rate limit (per-tier) | Done | `rate-limit.ts` (dynamic max via `quota.ts`) |
| AI summary quota check | Not implemented | Needs new middleware |
| AI summary mode separation | Not implemented | Near-realtime vs background queue |
| Report quota check | Not implemented | Needs new middleware |
| Promotion tables | Not deployed to Cloud | `admin_promotions` (local only) |
| Bonus expiry management | Not implemented | Future `user_quota_boosts` table |

---

## 6. Hardcoded Values (SSOT Mapping)

Centralized in `src/config/quota.ts`. Backend code imports from this module.
Edge Functions (Deno runtime) cannot import Node modules — values are kept inline with SSOT comment.

| Location | Source | Notes |
|----------|--------|-------|
| `src/config/quota.ts` | **SSOT** | All tier limits, rate limits, helper functions |
| `MandalaManager` | `import { getMandalaLimit }` | Dynamic per-tier |
| `rate-limit.ts` | `import { getRateLimitMax }` | Dynamic per-tier via `max` callback |
| `admin/redemption.ts` | `import { TIER_LIMITS }` | SQL COALESCE uses `TIER_LIMITS.free.*` |
| `admin/users.ts` | `import { DEFAULT_TIER, TIER_LIMITS }` | SQL COALESCE uses constants |
| Edge Function `local-cards` | Inline + SSOT comment | Deno runtime, cannot import Node module |

---

## 7. Future Work

1. ~~**`src/config/quota.ts`**: Centralized quota constants~~ — Done (2026-03-19)
2. ~~**Per-tier rate limiting**: Refactor `rate-limit.ts` to read user tier~~ — Done (2026-03-19)
3. **AI summary queue**: Background processing for free tier
4. **Report quota middleware**: Weekly report generation limit
5. **`user_quota_boosts` table**: Automatic bonus expiry management

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-19 | Initial policy document created | JK |
| 2026-03-19 | `src/config/quota.ts` + per-tier rate limit + hardcoding removal | JK |
