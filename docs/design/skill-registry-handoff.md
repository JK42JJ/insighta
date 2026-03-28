# Insighta — Skill Registry + Newsletter MVP Implementation Guide

> Claude Code handoff document | Created: 2026-03-27
> Goal: Complete "YouTube registration -> card -> structured summary -> newsletter" E2E loop within 7 days

---

## Background & Context

Insighta's core philosophy is **"Ideas (Insighta) + Execution (Temporal)"**.
Until now, only card accumulation (ideas) existed, with no actual execution happening on top of them.

This implementation is the first execution loop:
```
YouTube channel/playlist registration
  -> Card creation (existing)
  -> Structured summary generation (new — Python Sidecar)
  -> Quality validation (new — SummaryQualityGate)
  -> Newsletter curation (new — NewsletterSkill)
  -> Gmail SMTP (Google Workspace) delivery (new)
  -> pg_cron weekly schedule (new)
```

**Why this is not just a feature addition**: The newsletter is the first case of "execution actions" that will continue to grow — reports, new video alerts, product recommendations, etc. Therefore it must be implemented with an extensible **SkillRegistry** pattern.

---

## Architecture Principles

### 1. LLM-agnostic Skill Execution
All skills do not call LLMs directly. They must only call through `SkillContext.llm` (existing `src/modules/llm/provider.ts`). If the user has registered their own API key, that key takes priority; otherwise, it falls back to Insighta's default key.

### 2. Claude Tool Use Compatible Schema
Define `InsightaSkill.inputSchema` in JSON Schema 7 format. This format is identical to Claude Tool Use's `input_schema`, so when later exposed as an MCP server, it can be used as-is without adapters.

### 3. Temporal Migration Readiness
Currently pg_cron + direct execution, but the `skill_runs` table serves as an event log. When Temporal is introduced, just wrap `execute()` internals as Temporal Activities. The interface does not change.

### 4. Absolute Rules (based on CLAUDE.md)
- No direct DB modification — must go through API only
- Mandala loading is critical path — do not touch
- Local first, production later
- Blast radius check before work

---

## Step 1: DB Migration (4 new tables)

Existing tables are not modified at all. Only new tables are added.

Add to end of `prisma/schema.prisma`:

```prisma
// --- Skill System --------------------------------------------------------

model video_rich_summaries {
  video_id      String   @id @db.VarChar(11)  // youtube_video_id
  tier_required String   @default("free") @db.VarChar(10)
  one_liner     String?  // Free tier: one-line summary
  structured    Json?    // Pro tier: structured summary (see schema below)
  quality_score Float?   // SummaryQualityGate score (0.0~1.0)
  quality_flag  String?  @default("pending") @db.VarChar(20)
  // quality_flag: pending | pass | low | failed
  model         String?  @db.VarChar(50)
  created_at    DateTime @default(now()) @db.Timestamptz(6)
  updated_at    DateTime @default(now()) @updatedAt @db.Timestamptz(6)

  @@schema("public")
}

// structured JSONB schema (reference):
// {
//   "core_argument": string,           // Core thesis in 1 sentence
//   "key_points": string[],            // 3-5 key points
//   "evidence": string[],              // Supporting data/evidence
//   "actionables": string[],           // Immediately actionable items
//   "prerequisites": string[],         // Required prior knowledge
//   "bias_signals": string[],          // Bias indicators (curation filter material)
//   "content_type": string,            // tutorial|opinion|research|news
//   "depth_level": string,             // beginner|intermediate|advanced
//   "mandala_fit": {
//     "suggested_topics": string[],    // L2 cell matching keywords
//     "relevance_rationale": string
//   }
// }

model newsletter_settings {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  user_id       String   @unique @db.Uuid
  is_subscribed Boolean  @default(true)
  frequency     String   @default("weekly") @db.VarChar(10)
  // frequency: daily | weekly
  day_of_week   Int      @default(1)   // 1=Monday (for weekly)
  send_hour     Int      @default(9)   // UTC send time
  last_sent_at  DateTime? @db.Timestamptz(6)
  created_at    DateTime @default(now()) @db.Timestamptz(6)
  updated_at    DateTime @default(now()) @updatedAt @db.Timestamptz(6)
  users         users    @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id], map: "idx_newsletter_settings_user_id")
  @@schema("public")
}

model newsletter_logs {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  user_id         String   @db.Uuid
  mandala_id      String?  @db.Uuid
  subject         String?
  curated_videos  Json?    // Top N selected video snapshot
  sent_at         DateTime @default(now()) @db.Timestamptz(6)
  message_id      String?  @db.VarChar(100)
  status          String   @default("sent") @db.VarChar(20)
  users           users    @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id], map: "idx_newsletter_logs_user_id")
  @@index([sent_at(sort: Desc)], map: "idx_newsletter_logs_sent_at")
  @@schema("public")
}

model skill_runs {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  skill_id    String   @db.VarChar(50)   // 'newsletter', 'report', 'alert'
  user_id     String?  @db.Uuid
  status      String   @default("running") @db.VarChar(20)
  // status: running | success | failed | retrying
  input       Json?    // SkillContext snapshot (userId, mandalaId, etc.)
  output      Json?    // SkillResult snapshot
  error       String?
  retry_count Int      @default(0)
  started_at  DateTime @default(now()) @db.Timestamptz(6)
  ended_at    DateTime? @db.Timestamptz(6)
  users       users?   @relation(fields: [user_id], references: [id], onDelete: SetNull)

  @@index([skill_id, status], map: "idx_skill_runs_skill_status")
  @@index([user_id], map: "idx_skill_runs_user_id")
  @@index([started_at(sort: Desc)], map: "idx_skill_runs_started_at")
  @@schema("public")
}
```

Add relations to `users` model:
```prisma
newsletter_settings  newsletter_settings?
newsletter_logs      newsletter_logs[]
skill_runs           skill_runs[]
```

Migration execution:
```bash
# Local first
npx prisma db push

# After verification, production
npx prisma migrate deploy
```

---

## Step 2: SkillRegistry Implementation

### 2-1. Type Definitions

New file: `src/modules/skills/types.ts`

```typescript
import type { JSONSchema7 } from 'json-schema'
import type { LLMProvider } from '../llm/provider'

export type Tier = 'free' | 'pro' | 'lifetime' | 'admin'

export interface SkillContext {
  userId: string
  mandalaId: string
  tier: Tier
  // User key takes priority, falls back to Insighta default key
  // Uses existing LLMProvider type from src/modules/llm/provider.ts
  llm: LLMProvider
  // Per-skill additional parameters
  params?: Record<string, unknown>
}

export interface SkillResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
  metadata?: {
    duration_ms: number
    llm_tokens_used?: number
  }
}

export interface SkillPreview {
  // dryRun result — preview without actual sending
  subject?: string
  preview_html?: string
  curated_count?: number
}

export type SkillTrigger =
  | { type: 'cron'; schedule: string }         // pg_cron schedule
  | { type: 'event'; event: string }           // Event-based (future)
  | { type: 'manual' }                         // Manual execution

export interface InsightaSkill {
  id: string                    // 'newsletter', 'report', 'alert'
  version: string               // semver: '1.0.0'
  description: string           // Human-readable description
  trigger: SkillTrigger
  tiers: Tier[]                 // Tiers that can use this skill

  // JSON Schema 7 format — identical to Claude Tool Use input_schema
  // Can be serialized as tools[] array in MCP server without conversion
  inputSchema: JSONSchema7

  execute(ctx: SkillContext): Promise<SkillResult>
  dryRun(ctx: SkillContext): Promise<SkillPreview>
}
```

### 2-2. SkillRegistry

New file: `src/modules/skills/registry.ts`

```typescript
import { prisma } from '../database/client'
import { logger } from '../../utils/logger'
import type { InsightaSkill, SkillContext, SkillResult } from './types'

const log = logger.child({ module: 'SkillRegistry' })

class SkillRegistry {
  private skills = new Map<string, InsightaSkill>()

  register(skill: InsightaSkill): void {
    this.skills.set(skill.id, skill)
    log.info(`Skill registered: ${skill.id} v${skill.version}`)
  }

  get(skillId: string): InsightaSkill | undefined {
    return this.skills.get(skillId)
  }

  listAll(): InsightaSkill[] {
    return Array.from(this.skills.values())
  }

  // List skills available for user's tier
  listForTier(tier: string): InsightaSkill[] {
    return this.listAll().filter(s => s.tiers.includes(tier as any))
  }

  async execute(skillId: string, ctx: SkillContext): Promise<SkillResult> {
    const skill = this.skills.get(skillId)
    if (!skill) {
      return { success: false, error: `Skill not found: ${skillId}` }
    }

    // Record execution start in skill_runs table
    const run = await prisma.skill_runs.create({
      data: {
        skill_id: skillId,
        user_id: ctx.userId,
        status: 'running',
        input: { mandalaId: ctx.mandalaId, tier: ctx.tier, params: ctx.params },
      },
    })

    const startedAt = Date.now()

    try {
      const result = await skill.execute(ctx)

      await prisma.skill_runs.update({
        where: { id: run.id },
        data: {
          status: result.success ? 'success' : 'failed',
          output: result.data ?? {},
          error: result.error,
          ended_at: new Date(),
        },
      })

      return result
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.error(`Skill execution failed: ${skillId}`, { error, userId: ctx.userId })

      await prisma.skill_runs.update({
        where: { id: run.id },
        data: { status: 'failed', error, ended_at: new Date() },
      })

      return { success: false, error }
    }
  }
}

// Singleton
export const skillRegistry = new SkillRegistry()
```

### 2-3. Skill Registration (entry point)

`src/modules/skills/index.ts` (new):

```typescript
import { skillRegistry } from './registry'
import { NewsletterSkill } from './newsletter'

// Skill registration — just add one line here for new skills
skillRegistry.register(new NewsletterSkill())
// skillRegistry.register(new ReportSkill())   // future
// skillRegistry.register(new AlertSkill())    // future

export { skillRegistry }
```

In `src/index.ts` or server initialization:
```typescript
import '../modules/skills'  // Execute skill registration
```

---

## Step 3: SummaryQualityGate (Python Sidecar)

Add to the existing Python Sidecar structure. Reference existing `summarization/generator.py` pattern.

### 3-1. Structured Summary Prompt

New file: `python_sidecar/summarization/rich_summary.py`

```python
import json
import re
from dataclasses import dataclass
from typing import Optional

RICH_SUMMARY_PROMPT = """You are a learning content analysis expert.
Analyze the following YouTube video information and respond ONLY in JSON. Do not output any other text.

Video title: {title}
Video description: {description}
Transcript summary: {transcript_chunk}

Respond with the following JSON structure:
{{
  "core_argument": "Core thesis of this video (1 sentence, 10-100 chars)",
  "key_points": ["Key point 1", "Key point 2", "Key point 3"],
  "evidence": ["Evidence/data presented (empty array if none)"],
  "actionables": ["Immediately actionable items after watching"],
  "prerequisites": ["Required prior knowledge (empty array if none)"],
  "bias_signals": ["Commercial intent expressions", "Exaggerated/definitive expressions", "Unsourced claims"],
  "content_type": "tutorial",
  "depth_level": "beginner",
  "mandala_fit": {{
    "suggested_topics": ["keyword1", "keyword2"],
    "relevance_rationale": "One line explanation"
  }}
}}

content_type allowed values: tutorial, opinion, research, news, entertainment
depth_level allowed values: beginner, intermediate, advanced"""

ONE_LINER_PROMPT = """Summarize the following YouTube video in one Korean sentence (under 30 characters).
Video title: {title}
Video description: {description}
Output only the summary sentence."""


@dataclass
class GateResult:
    score: float
    passed: bool
    action: str  # 'use' | 'retry' | 'fallback'
    reasons: list[str]


HALLUCINATION_PATTERNS = [
    r"as an ai",
    r"i don't know",
    r"i cannot",
    r"죄송합니다",
    r"(.)\1{5,}",  # 5+ repeated characters
]

VALID_CONTENT_TYPES = {"tutorial", "opinion", "research", "news", "entertainment"}
VALID_DEPTH_LEVELS = {"beginner", "intermediate", "advanced"}


class SummaryQualityGate:
    def check(self, summary: dict) -> GateResult:
        score = 0.0
        reasons = []

        # 1. Structure check (40 points)
        core = summary.get("core_argument", "")
        if core and 10 <= len(core) <= 100:
            score += 0.15
        else:
            reasons.append(f"core_argument length issue: {len(core)} chars")

        key_points = summary.get("key_points", [])
        if isinstance(key_points, list) and len(key_points) >= 3:
            score += 0.15
        else:
            reasons.append(f"key_points insufficient: {len(key_points)} items")

        if summary.get("actionables"):
            score += 0.10
        else:
            reasons.append("actionables missing")

        # 2. Hallucination check (30 points)
        full_text = json.dumps(summary, ensure_ascii=False).lower()
        has_hallucination = any(
            re.search(p, full_text) for p in HALLUCINATION_PATTERNS
        )
        if not has_hallucination:
            score += 0.30
        else:
            reasons.append("hallucination pattern detected")

        # 3. Meta field check (30 points)
        if isinstance(summary.get("bias_signals"), list):
            score += 0.20
        else:
            reasons.append("bias_signals unparseable")

        if summary.get("content_type") in VALID_CONTENT_TYPES:
            score += 0.05
        if summary.get("depth_level") in VALID_DEPTH_LEVELS:
            score += 0.05

        passed = score >= 0.7
        action = "use" if passed else "retry"

        return GateResult(score=score, passed=passed, action=action, reasons=reasons)


async def generate_rich_summary(
    video_id: str,
    title: str,
    description: str,
    transcript: str,
    llm_client,  # Existing LLM client
    tier: str = "free",
) -> dict:
    """
    Generate structured summary + quality validation.
    Max 1 retry. Falls back to one_liner on failure.
    """
    gate = SummaryQualityGate()

    # Free tier: one_liner only
    if tier == "free":
        one_liner = await llm_client.complete(
            ONE_LINER_PROMPT.format(title=title, description=description[:500])
        )
        return {
            "video_id": video_id,
            "tier_required": "free",
            "one_liner": one_liner.strip(),
            "quality_flag": "pass",
            "quality_score": 1.0,
        }

    # Pro+ tier: structured summary
    transcript_chunk = transcript[:3000] if transcript else description[:1000]

    for attempt in range(2):  # Max 2 attempts
        try:
            raw = await llm_client.complete(
                RICH_SUMMARY_PROMPT.format(
                    title=title,
                    description=description[:500],
                    transcript_chunk=transcript_chunk,
                )
            )
            # JSON parsing
            structured = json.loads(raw.strip())
            result = gate.check(structured)

            if result.passed:
                return {
                    "video_id": video_id,
                    "tier_required": "pro",
                    "one_liner": structured.get("core_argument"),
                    "structured": structured,
                    "quality_score": result.score,
                    "quality_flag": "pass",
                }
        except (json.JSONDecodeError, Exception):
            pass  # Retry

    # All attempts failed -> one_liner fallback
    one_liner = await llm_client.complete(
        ONE_LINER_PROMPT.format(title=title, description=description[:500])
    )
    return {
        "video_id": video_id,
        "tier_required": "free",
        "one_liner": one_liner.strip(),
        "quality_flag": "low",
        "quality_score": 0.0,
    }
```

---

## Step 4: NewsletterSkill Implementation

New file: `src/modules/skills/newsletter.ts`

```typescript
import nodemailer from 'nodemailer'
import { prisma } from '../database/client'
import { logger } from '../../utils/logger'
import { TIER_LIMITS } from '@/config/quota'
import type { InsightaSkill, SkillContext, SkillResult, SkillPreview, Tier } from './types'

const log = logger.child({ module: 'NewsletterSkill' })
const transporter = nodemailer.createTransport({
  host: process.env.GMAIL_SMTP_HOST,   // smtp-relay.gmail.com
  port: Number(process.env.GMAIL_SMTP_PORT ?? 587),
  secure: false,  // STARTTLS — not SSL
  // No auth field: IP-authenticated via EC2 (44.231.152.49) whitelisted in Google Workspace SMTP Relay
})

// Curation config
const CURATION_CONFIG = {
  MAX_BIAS_SIGNALS: 1,          // Exclude if bias_signals exceed this count
  MIN_QUALITY_SCORE: 0.7,       // Exclude below this score (quality_flag='low')
  MAX_FROM_SAME_CHANNEL: 1,     // Max N from same channel
}

export class NewsletterSkill implements InsightaSkill {
  id = 'newsletter'
  version = '1.0.0'
  description = 'Mandala-based weekly content curation newsletter'
  trigger = { type: 'cron' as const, schedule: '0 9 * * 1' }  // Every Monday 09:00 UTC
  tiers = ['free', 'pro', 'lifetime', 'admin'] as const

  // JSON Schema 7 — identical format to Claude Tool Use input_schema
  inputSchema = {
    type: 'object',
    properties: {
      mandala_id: { type: 'string', description: 'Mandala ID to generate newsletter for' },
      dry_run: { type: 'boolean', description: 'Preview mode (no actual sending)', default: false },
    },
    required: ['mandala_id'],
  } as const

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const start = Date.now()
    const { userId, mandalaId, tier } = ctx
    const topN = TIER_LIMITS[tier].skills.newsletter.curationTopN ?? Infinity

    try {
      // 1. Get user email
      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: { email: true },
      })
      if (!user?.email) throw new Error('User email not found')

      // 2. Check newsletter settings
      const settings = await prisma.newsletter_settings.findUnique({
        where: { user_id: userId },
      })
      if (settings && !settings.is_subscribed) {
        return { success: true, data: { skipped: 'unsubscribed' } }
      }

      // 3. Curate
      const curated = await this.curate(userId, mandalaId, topN)
      if (curated.length === 0) {
        log.info('No content to curate', { userId, mandalaId })
        return { success: true, data: { skipped: 'no_content' } }
      }

      // 4. Get mandala title
      const mandala = await prisma.user_mandalas.findUnique({
        where: { id: mandalaId },
        select: { title: true },
      })

      // 5. Generate HTML + send
      const subject = `This week's ${mandala?.title ?? 'learning'} curation — Top ${curated.length}`
      const html = this.buildHtml(curated, mandala?.title, tier)

      const info = await transporter.sendMail({
        from: 'Insighta <noreply@insighta.one>',
        to: user.email,
        subject,
        html,
      })

      // 6. Record send log
      await prisma.newsletter_logs.create({
        data: {
          user_id: userId,
          mandala_id: mandalaId,
          subject,
          curated_videos: curated,
          message_id: info.messageId,
          status: 'sent',
        },
      })

      // 7. Update last_sent_at
      await prisma.newsletter_settings.upsert({
        where: { user_id: userId },
        update: { last_sent_at: new Date() },
        create: { user_id: userId, last_sent_at: new Date() },
      })

      return {
        success: true,
        data: { message_id: info.messageId, curated_count: curated.length },
        metadata: { duration_ms: Date.now() - start },
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.error('Newsletter send failed', { error, userId })
      return { success: false, error, metadata: { duration_ms: Date.now() - start } }
    }
  }

  async dryRun(ctx: SkillContext): Promise<SkillPreview> {
    const topN = TIER_LIMITS[ctx.tier].skills.newsletter.curationTopN ?? Infinity
    const curated = await this.curate(ctx.userId, ctx.mandalaId, topN)
    const mandala = await prisma.user_mandalas.findUnique({
      where: { id: ctx.mandalaId },
      select: { title: true },
    })
    return {
      subject: `This week's ${mandala?.title ?? 'learning'} curation — Top ${curated.length}`,
      preview_html: this.buildHtml(curated, mandala?.title, ctx.tier),
      curated_count: curated.length,
    }
  }

  // --- Curation Pipeline -----------------------------------------------

  private async curate(userId: string, mandalaId: string, topN: number) {
    // 1. Get cards from last 7 days with rich summaries
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const cards = await prisma.$queryRaw<any[]>`
      SELECT
        uvs.video_id,
        yv.youtube_video_id,
        yv.title,
        yv.thumbnail_url,
        yv.channel_title,
        vrs.one_liner,
        vrs.structured,
        vrs.quality_score,
        vrs.quality_flag,
        uvs.created_at
      FROM user_video_states uvs
      JOIN youtube_videos yv ON yv.id = uvs.video_id
      LEFT JOIN video_rich_summaries vrs ON vrs.video_id = yv.youtube_video_id
      WHERE uvs.user_id = ${userId}
        AND uvs.mandala_id = ${mandalaId}
        AND uvs.created_at >= ${since}
      ORDER BY uvs.created_at DESC
      LIMIT 50
    `

    // 2. Bias filter
    const filtered = cards.filter(card => {
      if (card.quality_flag === 'low' || card.quality_flag === 'failed') return false
      if (!card.structured) return true  // No rich summary -> pass through (use one_liner)

      const biasSignals = card.structured?.bias_signals ?? []
      return biasSignals.length <= CURATION_CONFIG.MAX_BIAS_SIGNALS
    })

    // 3. Channel diversity — max 1 from same channel
    const channelCount: Record<string, number> = {}
    const diversified = filtered.filter(card => {
      const ch = card.channel_title ?? 'unknown'
      channelCount[ch] = (channelCount[ch] ?? 0) + 1
      return channelCount[ch] <= CURATION_CONFIG.MAX_FROM_SAME_CHANNEL
    })

    // 4. Top N selection
    return diversified.slice(0, topN)
  }

  // --- HTML Template ---------------------------------------------------

  private buildHtml(cards: any[], mandalaTitle?: string, tier?: Tier): string {
    const summaryMode = tier ? TIER_LIMITS[tier].skills.newsletter.summaryMode : 'one_liner'

    const cardHtml = cards.map((card, i) => {
      const summarySection = summaryMode === 'structured' && card.structured?.key_points?.length
        ? `<ul style="margin:8px 0;padding-left:20px;color:#444;">
            ${card.structured.key_points.slice(0, 3).map((p: string) =>
              `<li style="margin:4px 0;font-size:14px;">${p}</li>`
            ).join('')}
           </ul>`
        : `<p style="color:#555;font-size:14px;margin:8px 0;">${card.one_liner ?? ''}</p>`

      return `
        <div style="margin-bottom:24px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            ${card.thumbnail_url
              ? `<img src="${card.thumbnail_url}" width="120" style="border-radius:4px;flex-shrink:0;" />`
              : ''}
            <div style="flex:1;">
              <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;">${card.channel_title ?? ''}</p>
              <p style="margin:0 0 8px;font-weight:600;font-size:15px;color:#111;">
                ${i + 1}. ${card.title}
              </p>
              ${summarySection}
              <a href="https://youtube.com/watch?v=${card.youtube_video_id}"
                 style="display:inline-block;margin-top:8px;padding:6px 12px;
                        background:#111;color:#fff;border-radius:4px;
                        font-size:12px;text-decoration:none;">
                Watch on YouTube
              </a>
            </div>
          </div>
        </div>`
    }).join('')

    const upgradeSection = tier === 'free'
      ? `<div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:8px;text-align:center;">
           <p style="margin:0 0 8px;font-size:14px;color:#555;">
             Upgrade to Pro for key point analysis and unlimited curation.
           </p>
           <a href="https://insighta.one/settings/billing"
              style="display:inline-block;padding:8px 20px;background:#7c3aed;
                     color:#fff;border-radius:6px;font-size:13px;text-decoration:none;">
             Start Pro
           </a>
         </div>`
      : ''

    return `
      <!DOCTYPE html>
      <html>
      <body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111;">
        <h2 style="margin-bottom:4px;">This week's ${mandalaTitle ?? 'learning'} curation</h2>
        <p style="color:#6b7280;font-size:14px;margin-top:0;">
          Top ${cards.length} videos related to your goals
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
        ${cardHtml}
        ${upgradeSection}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <p style="font-size:11px;color:#9ca3af;text-align:center;">
          <a href="https://insighta.one/settings/newsletter" style="color:#9ca3af;">Change send settings</a>
          &nbsp;&middot;&nbsp;
          <a href="https://insighta.one/unsubscribe" style="color:#9ca3af;">Unsubscribe</a>
        </p>
      </body>
      </html>`
  }
}
```

---

## Step 5: API Routes

New file: `src/api/routes/skills.ts`

```typescript
import { FastifyPluginCallback } from 'fastify'
import { skillRegistry } from '../../modules/skills'
import { getLLMProvider } from '../../modules/llm'

export const skillRoutes: FastifyPluginCallback = (fastify, _opts, done) => {

  // GET /api/v1/skills — List available skills
  fastify.get('/skills', { onRequest: [fastify.authenticate] }, async (req, reply) => {
    const userId = req.user.userId
    const user = await prisma.user_subscriptions.findUnique({ where: { user_id: userId } })
    const tier = user?.tier ?? 'free'
    const skills = skillRegistry.listForTier(tier).map(s => ({
      id: s.id,
      description: s.description,
      version: s.version,
      trigger: s.trigger,
      inputSchema: s.inputSchema,
    }))
    return reply.send({ status: 200, data: skills })
  })

  // POST /api/v1/skills/:skillId/preview — Preview (dry run)
  fastify.post<{ Params: { skillId: string }; Body: { mandala_id: string } }>(
    '/skills/:skillId/preview',
    { onRequest: [fastify.authenticate] },
    async (req, reply) => {
      const { skillId } = req.params
      const { mandala_id } = req.body
      const userId = req.user.userId

      const skill = skillRegistry.get(skillId)
      if (!skill) return reply.code(404).send({ status: 404, message: 'Skill not found' })

      const userSub = await prisma.user_subscriptions.findUnique({ where: { user_id: userId } })
      const llm = await getLLMProvider(userId)  // User key priority fallback

      const preview = await skill.dryRun({
        userId,
        mandalaId: mandala_id,
        tier: (userSub?.tier ?? 'free') as any,
        llm,
      })

      return reply.send({ status: 200, data: preview })
    }
  )

  // POST /api/v1/skills/:skillId/execute — Execute immediately (manual)
  fastify.post<{ Params: { skillId: string }; Body: { mandala_id: string } }>(
    '/skills/:skillId/execute',
    { onRequest: [fastify.authenticate] },
    async (req, reply) => {
      const { skillId } = req.params
      const { mandala_id } = req.body
      const userId = req.user.userId

      const userSub = await prisma.user_subscriptions.findUnique({ where: { user_id: userId } })
      const llm = await getLLMProvider(userId)

      const result = await skillRegistry.execute(skillId, {
        userId,
        mandalaId: mandala_id,
        tier: (userSub?.tier ?? 'free') as any,
        llm,
        params: req.body,
      })

      return reply.send({ status: result.success ? 200 : 500, data: result })
    }
  )

  done()
}
```

Register route in `src/api/index.ts`:
```typescript
import { skillRoutes } from './routes/skills'
fastify.register(skillRoutes, { prefix: '/api/v1' })
```

---

## Step 6: pg_cron Schedule

Execute in Supabase SQL Editor:

```sql
-- Every Monday 09:00 UTC — newsletter to all subscribed users
SELECT cron.schedule(
  'insighta-newsletter-weekly',
  '0 9 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://insighta.one/api/v1/skills/newsletter/batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  )
  $$
);
```

Batch endpoint (`/api/v1/skills/newsletter/batch`):
- Query `newsletter_settings` for `is_subscribed=true` AND (`frequency='weekly'` AND `day_of_week=1`) users
- Execute `skillRegistry.execute('newsletter', ctx)` for each user's default mandala
- Sequential processing (no parallelism needed at current 7-user scale)

---

## Step 7: Gmail SMTP Relay Setup (IP Authentication — no app password)

Insighta uses **Gmail SMTP Relay** (`smtp-relay.gmail.com`) authenticated by EC2 IP address, not by username/password. The EC2 instance IP `44.231.152.49` must be whitelisted in Google Workspace Admin before the first send.

```bash
# 1. npm install
npm install nodemailer
npm install --save-dev @types/nodemailer

# 2. Add environment variables (.env)
GMAIL_SMTP_HOST=smtp-relay.gmail.com
GMAIL_SMTP_PORT=587
GMAIL_SMTP_FROM=noreply@insighta.one

# 3. Add to src/config/index.ts
gmail: {
  smtpHost: env.GMAIL_SMTP_HOST,
  smtpPort: Number(env.GMAIL_SMTP_PORT ?? 587),
  smtpFrom: env.GMAIL_SMTP_FROM,
},
```

Google Workspace SMTP Relay setup (one-time, Admin console):
- Admin console -> Apps -> Google Workspace -> Gmail -> Routing -> SMTP relay service
- Add allowed sender: `noreply@insighta.one` (or "Any address in domain")
- Authentication: select "Only accept mail from the specified IP addresses" -> add `44.231.152.49`
- Require TLS: enabled
- No username/password is exchanged — the EC2 IP is the credential
- Send limit: 2,000 emails/day (Google Workspace)

nodemailer transporter for reference:
```typescript
nodemailer.createTransport({
  host: process.env.GMAIL_SMTP_HOST,   // smtp-relay.gmail.com
  port: Number(process.env.GMAIL_SMTP_PORT ?? 587),
  secure: false,  // STARTTLS on port 587
  // No auth field — IP-authenticated
})
```

---

## Recommended Implementation Order

```
Day 1  Prisma migration (4 tables) + Gmail SMTP setup
Day 2  SkillRegistry + types (src/modules/skills/)
Day 3  SummaryQualityGate + rich_summary (Python Sidecar)
Day 4  NewsletterSkill (curate + buildHtml)
Day 5  API routes + dryRun endpoint preview verification
Day 6  Gmail SMTP actual send test (test email)
Day 7  pg_cron schedule setup + E2E verification
```

---

## Verification Checklist

```
[ ] prisma db push -> verify 4 tables created
[ ] skillRegistry.register() log output confirmed
[ ] POST /api/v1/skills/newsletter/preview response verified
[ ] video_rich_summaries has quality_flag='pass' records
[ ] Gmail SMTP test email received (noreply@insighta.one)
[ ] newsletter_logs table has send records (message_id populated)
[ ] skill_runs table has success records
[ ] pg_cron job registered: SELECT * FROM cron.job;
```

---

## Bot vs Skill Role Distinction (Confirmed)

| Aspect | Skill (SkillRegistry) | Bot (OpenClaw/Telegram) |
|--------|---------------------|----------------------|
| Trigger | pg_cron, events, system auto | User message/command |
| Example | Weekly newsletter, monthly report | "Summarize this video", "Show me newsletter preview" |
| Output | Email, push, report | Telegram chat response |
| Log | `skill_runs` table | `bot_usage_log` table |

**Core principle**: The bot is a manual trigger interface for skills.
When a user says "Show me the newsletter preview" on Telegram -> the bot calls `skillRegistry.execute('newsletter', { dryRun: true })` -> returns the result to Telegram.
The bot never implements skill logic directly. It always delegates through SkillRegistry.

---

## Cautions

1. **Do not touch mandala loading** — Only read UserVideoState, user_mandala_levels; no modifications
2. **Include cards without rich_summary in newsletter** — Handle with one_liner fallback
3. **Always dryRun before Gmail SMTP send** — `POST /api/v1/skills/newsletter/preview`
4. **getLLMProvider(userId)** — Follow existing `src/modules/llm/` pattern exactly. Do not create new one
5. **When using `$queryRaw`** — Must use tagged template literal to prevent SQL injection

---

## SummaryQualityGate Architecture

The SummaryQualityGate is designed with a two-phase evolution path. The public interface (`check()`) is stable across both phases — only the internal implementation changes.

### Interface Contract (invariant across phases)

```typescript
interface GateResult {
  score: number    // 0.0 – 1.0
  passed: boolean  // score >= threshold
  action: 'use' | 'retry' | 'fallback'
  reasons: string[]
}

interface SummaryQualityGate {
  check(summary: Record<string, unknown>): GateResult
}
```

### Phase 1 — TypeScript Rule-Based Gate (current)

**Location**: `src/modules/skills/summary-gate.ts`

Rule-based validation running entirely in the Node.js process alongside the SkillRegistry. No additional infrastructure required.

Validation rules:
- Structure check (40 pts): `core_argument` length 10–100 chars, `key_points` >= 3 items, `actionables` present
- Hallucination check (30 pts): regex scan for AI refusal patterns and repeated characters
- Meta field check (30 pts): `bias_signals` parseable as array, `content_type` and `depth_level` in allowed enum sets

Pass threshold: score >= 0.7. On failure: action = `retry` (up to 1 retry), then `fallback` to one_liner.

### Phase 2 — Python Sidecar ML-Based Gate (future)

**Location**: `python_sidecar/quality/ml_gate.py`

ML-based gate using a lightweight embedding model served inside the existing Python Sidecar process. No new infrastructure.

Components:
- **Model**: BGE-M3 (BAAI/bge-m3), exported to ONNX for CPU inference
- **Runtime**: ONNX Runtime via HuggingFace `optimum` — no GPU required
- **Scoring**: cosine similarity between generated summary and source transcript embeddings; semantic coherence replaces the regex hallucination check

Trigger for migration: when false-positive rate on rule-based gate exceeds 15% in production (tracked via `quality_flag='low'` rate in `video_rich_summaries`).

### Migration Path

Swap the internal implementation inside `src/modules/skills/summary-gate.ts` to call the Python Sidecar HTTP endpoint instead of running local rules. The `check()` signature and `GateResult` shape do not change. All callers (`newsletter.ts`, `rich_summary.py` wrapper) require zero modification.

```
Phase 1 (now):   NewsletterSkill -> TypeScript RuleGate (in-process)
Phase 2 (later): NewsletterSkill -> TypeScript GateClient -> Python Sidecar MLGate
                                                              (BGE-M3 / ONNX)
```

---

## Related Documents

- Quota policy: `docs/policies/skill-quota-policy.md` (tier-based execution limits)
- Quota config: `src/config/quota.ts` (`TIER_LIMITS.*.skills`)
- GitHub Issue: #337 (backlog)
