# Insighta Skill (Action) Quota Policy

> Created: 2026-03-28 | SSOT: This document → `src/config/quota.ts`
> See also: `docs/policies/quota-policy.md` (resource limits and rate limits)

---

## 1. Skill Policy Principles

**Skill** = An automated action that operates on top of Insighta's accumulated knowledge
(cards, summaries, ontology graph). Newsletter, report, alert, and recommendation are skills.

### Tier Differentiation Strategy
- **Execution count**: Monthly limit (resets on 1st of month, UTC)
- **Content quality**: Free gets one-liner summaries, Pro+ gets structured detailed summaries
- **Scope**: Free gets basic features only, Pro+ unlocks all features

---

## 2. Per-Skill Tier Policy

### 2.1 NewsletterSkill

| Feature | Free | Pro | Lifetime | Admin |
|---------|------|-----|----------|-------|
| Available | Yes | Yes | Yes | Yes |
| Monthly runs | 4 | Unlimited | Unlimited | Unlimited |
| Default frequency | Weekly | Weekly | Weekly | Any |
| Frequency change | No | Yes (daily) | Yes | Yes |
| Summary mode | one_liner | structured | structured | structured |
| Curation count | Top 3 | Top 5 | Top 5 | Unlimited |
| Bias analysis report | No | Yes | Yes | Yes |
| Custom send template | No | Yes | Yes | Yes |
| Target mandalas | Default (1) | All | All | All |

**Free tier 4/month rationale**:
- Weekly × 4 weeks = exact fit
- Upgrading to daily naturally requires Pro
- After exhaustion: "Upgrade to Pro for unlimited sends + detailed analysis + bias report"

### 2.2 ReportSkill (Monthly Learning Report) — Planned

| Feature | Free | Pro | Lifetime | Admin |
|---------|------|-----|----------|-------|
| Available | Yes (basic) | Yes (full) | Yes | Yes |
| Monthly runs | 1 | Unlimited | Unlimited | Unlimited |
| Report depth | Card count + cell distribution | Full analysis + bias + growth trends | Full | Full |

### 2.3 AlertSkill (New Video Alert) — Planned

| Feature | Free | Pro | Lifetime | Admin |
|---------|------|-----|----------|-------|
| Available | Yes | Yes | Yes | Yes |
| Monthly alerts | 20 | Unlimited | Unlimited | Unlimited |
| Channels | Email | Email + Push | Email + Push | All |

### 2.4 RecommendSkill (Goal-Based Content Recommendation) — Planned

| Feature | Free | Pro | Lifetime | Admin |
|---------|------|-----|----------|-------|
| Available | Yes (limited) | Yes (full) | Yes | Yes |
| Target scope | Active mandala, single cell | All mandalas, all cells | All | All |
| Daily items | 3 | 10 | Unlimited | Unlimited |

---

## 3. Execution Limit Summary

| Skill | Free/month | Pro/month | Lifetime/month | Admin/month |
|-------|-----------|---------|---------------|------------|
| Newsletter | 4 | Unlimited | Unlimited | Unlimited |
| Report | 1 | Unlimited | Unlimited | Unlimited |
| Alert | 20 | Unlimited | Unlimited | Unlimited |
| Recommend | 3/day | 10/day | Unlimited | Unlimited |

---

## 4. Implementation in `src/config/quota.ts`

The `skills` section is added to each tier in `TIER_LIMITS`.
Existing resource limits (`mandalas`, `cards`, `aiSummaries`, `weeklyReports`) are unchanged.

Types exported: `SkillLimits`, `SummaryMode`, `TargetScope`, `ReportDepth`,
`NewsletterFrequency`, `AlertChannel`.

---

## 5. Quota Check Method (Future: SkillRegistry)

When `SkillRegistry.execute()` is implemented, it should call `checkSkillQuota()`
at entry to verify the user's tier allows the requested skill execution.

- Query `skill_runs` table: count rows where `skill_id` matches, `status` in
  (`success`, `running`), and `started_at >= start of current month`.
- If count >= limit: return `{ allowed: false, reason, remaining: 0 }`.
- If limit is `null`: unlimited, always allowed.

---

## 6. Frontend Display

### Newsletter Settings UI (Free user)
```
Newsletter usage: 3/4 this month
Frequency: Weekly (fixed)
Summary: One-liner

[Upgrade to Pro]
- Unlimited sends
- Daily frequency available
- Key points + bias analysis included
```

### Quota Exceeded API Response
```json
{
  "success": false,
  "error": "Monthly limit exceeded (4/4)",
  "metadata": { "quota_exceeded": true, "upgrade_cta": true }
}
```
Frontend shows upgrade modal when `upgrade_cta: true`.

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-28 | Initial skill quota policy created | JK |
