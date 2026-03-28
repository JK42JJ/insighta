/**
 * NewsletterSkill — Mandala-based weekly content curation newsletter
 *
 * Curation pipeline:
 *   1. Query recent cards (7 days) with rich summaries
 *   2. Filter by quality (quality_flag != low/failed)
 *   3. Filter by bias (bias_signals count)
 *   4. Diversify by channel (max 1 per channel)
 *   5. Select Top N (tier-based: free=3, pro=5)
 *   6. Build HTML email
 *   7. Send via Gmail SMTP Relay (IP-authenticated)
 *
 * Design: docs/design/skill-registry-handoff.md (Step 4)
 * Issue: #337
 */

import nodemailer from 'nodemailer';
import type { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { config } from '@/config/index';
import { TIER_LIMITS, type Tier } from '@/config/quota';
import type { InsightaSkill, SkillContext, SkillResult, SkillPreview } from './types';

const log = logger.child({ module: 'NewsletterSkill' });

// Gmail SMTP Relay — IP-authenticated via EC2, no password
const transporter = nodemailer.createTransport({
  host: config.gmail.smtpHost,
  port: config.gmail.smtpPort,
  secure: false, // STARTTLS
});

// ============================================================================
// Curation constants
// ============================================================================

const MAX_BIAS_SIGNALS = 1;
const MAX_FROM_SAME_CHANNEL = 1;
const CURATION_WINDOW_DAYS = 7;
const CURATION_QUERY_LIMIT = 50;

// ============================================================================
// Skill Implementation
// ============================================================================

export class NewsletterSkill implements InsightaSkill {
  id = 'newsletter' as const;
  version = '1.0.0';
  description = 'Mandala-based weekly content curation newsletter';
  trigger = { type: 'cron' as const, schedule: '0 9 * * 1' };
  tiers = ['free', 'pro', 'lifetime', 'admin'] as const;

  inputSchema: InsightaSkill['inputSchema'] = {
    type: 'object',
    properties: {
      mandala_id: { type: 'string', description: 'Mandala ID to generate newsletter for' },
      dry_run: { type: 'boolean', description: 'Preview mode (no actual sending)', default: false },
    },
    required: ['mandala_id'],
  };

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const start = Date.now();
    const { userId, mandalaId, tier } = ctx;
    const topN = TIER_LIMITS[tier].skills.newsletter.curationTopN ?? Infinity;

    try {
      const db = getPrismaClient();

      // 1. Get user email
      const user = await db.users.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!user?.email) {
        return {
          success: false,
          error: 'User email not found',
          metadata: { duration_ms: Date.now() - start },
        };
      }

      // 2. Check newsletter settings
      const settings = await db.newsletter_settings.findUnique({ where: { user_id: userId } });
      if (settings && !settings.is_subscribed) {
        return {
          success: true,
          data: { skipped: 'unsubscribed' },
          metadata: { duration_ms: Date.now() - start },
        };
      }

      // 3. Curate
      const curated = await this.curate(userId, mandalaId, topN);
      if (curated.length === 0) {
        log.info('No content to curate', { userId, mandalaId });
        return {
          success: true,
          data: { skipped: 'no_content' },
          metadata: { duration_ms: Date.now() - start },
        };
      }

      // 4. Get mandala title
      const mandala = await db.user_mandalas.findUnique({
        where: { id: mandalaId },
        select: { title: true },
      });

      // 5. Build + send
      const subject = `This week's ${mandala?.title ?? 'learning'} curation — Top ${curated.length}`;
      const html = this.buildHtml(curated, mandala?.title, tier);

      const info = await transporter.sendMail({
        from: config.gmail.smtpFrom,
        to: user.email,
        subject,
        html,
      });

      // 6. Log send
      await db.newsletter_logs.create({
        data: {
          user_id: userId,
          mandala_id: mandalaId,
          subject,
          curated_videos: curated as unknown as Prisma.InputJsonValue,
          message_id: info.messageId,
          status: 'sent',
        },
      });

      // 7. Update last_sent_at
      await db.newsletter_settings.upsert({
        where: { user_id: userId },
        update: { last_sent_at: new Date() },
        create: { user_id: userId, last_sent_at: new Date() },
      });

      return {
        success: true,
        data: { message_id: info.messageId, curated_count: curated.length },
        metadata: { duration_ms: Date.now() - start },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error('Newsletter send failed', { error, userId });
      return { success: false, error, metadata: { duration_ms: Date.now() - start } };
    }
  }

  async dryRun(ctx: SkillContext): Promise<SkillPreview> {
    const topN = TIER_LIMITS[ctx.tier].skills.newsletter.curationTopN ?? Infinity;
    const curated = await this.curate(ctx.userId, ctx.mandalaId, topN);
    const db = getPrismaClient();
    const mandala = await db.user_mandalas.findUnique({
      where: { id: ctx.mandalaId },
      select: { title: true },
    });
    return {
      subject: `This week's ${mandala?.title ?? 'learning'} curation — Top ${curated.length}`,
      preview_html: this.buildHtml(curated, mandala?.title, ctx.tier),
      curated_count: curated.length,
    };
  }

  // ============================================================================
  // Curation Pipeline
  // ============================================================================

  private async curate(userId: string, mandalaId: string, topN: number) {
    const db = getPrismaClient();
    const since = new Date(Date.now() - CURATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const cards = await db.$queryRaw<CuratedCard[]>`
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
      LIMIT ${CURATION_QUERY_LIMIT}
    `;

    // Bias filter
    const filtered = cards.filter((card) => {
      if (card.quality_flag === 'low' || card.quality_flag === 'failed') return false;
      if (!card.structured) return true; // no rich summary → pass (use one_liner)
      const biasSignals = (card.structured as Record<string, unknown>)?.['bias_signals'];
      return !Array.isArray(biasSignals) || biasSignals.length <= MAX_BIAS_SIGNALS;
    });

    // Channel diversity
    const channelCount: Record<string, number> = {};
    const diversified = filtered.filter((card) => {
      const ch = card.channel_title ?? 'unknown';
      channelCount[ch] = (channelCount[ch] ?? 0) + 1;
      return channelCount[ch] <= MAX_FROM_SAME_CHANNEL;
    });

    return diversified.slice(0, topN);
  }

  // ============================================================================
  // HTML Template
  // ============================================================================

  private buildHtml(cards: CuratedCard[], mandalaTitle?: string, tier?: Tier): string {
    const summaryMode = tier ? TIER_LIMITS[tier].skills.newsletter.summaryMode : 'one_liner';

    const cardHtml = cards
      .map((card, i) => {
        const structured = card.structured as Record<string, unknown> | null;
        const keyPoints = Array.isArray(structured?.['key_points'])
          ? (structured['key_points'] as string[])
          : [];

        const summarySection =
          summaryMode === 'structured' && keyPoints.length > 0
            ? `<ul style="margin:8px 0;padding-left:20px;color:#444;">
            ${keyPoints
              .slice(0, 3)
              .map((p) => `<li style="margin:4px 0;font-size:14px;">${escapeHtml(p)}</li>`)
              .join('')}
           </ul>`
            : `<p style="color:#555;font-size:14px;margin:8px 0;">${escapeHtml(card.one_liner ?? '')}</p>`;

        return `
        <div style="margin-bottom:24px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            ${
              card.thumbnail_url
                ? `<img src="${escapeHtml(card.thumbnail_url)}" width="120" style="border-radius:4px;flex-shrink:0;" />`
                : ''
            }
            <div style="flex:1;">
              <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;">${escapeHtml(card.channel_title ?? '')}</p>
              <p style="margin:0 0 8px;font-weight:600;font-size:15px;color:#111;">
                ${i + 1}. ${escapeHtml(card.title ?? '')}
              </p>
              ${summarySection}
              <a href="https://youtube.com/watch?v=${escapeHtml(card.youtube_video_id ?? '')}"
                 style="display:inline-block;margin-top:8px;padding:6px 12px;
                        background:#111;color:#fff;border-radius:4px;
                        font-size:12px;text-decoration:none;">
                Watch on YouTube
              </a>
            </div>
          </div>
        </div>`;
      })
      .join('');

    const upgradeSection =
      tier === 'free'
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
        : '';

    return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111;">
  <h2 style="margin-bottom:4px;">This week's ${escapeHtml(mandalaTitle ?? 'learning')} curation</h2>
  <p style="color:#6b7280;font-size:14px;margin-top:0;">
    Top ${cards.length} videos related to your goals
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
  ${cardHtml}
  ${upgradeSection}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
  <p style="font-size:11px;color:#9ca3af;text-align:center;">
    <a href="https://insighta.one/settings" style="color:#9ca3af;">Change send settings</a>
    &middot;
    <a href="https://insighta.one/settings" style="color:#9ca3af;">Unsubscribe</a>
  </p>
</body>
</html>`;
  }
}

// ============================================================================
// Helpers
// ============================================================================

interface CuratedCard {
  video_id: string;
  youtube_video_id: string;
  title: string | null;
  thumbnail_url: string | null;
  channel_title: string | null;
  one_liner: string | null;
  structured: unknown;
  quality_score: number | null;
  quality_flag: string | null;
  created_at: Date;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
