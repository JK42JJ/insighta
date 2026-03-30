/**
 * AlertSkill — Mandala activity trend alerts
 *
 * Pipeline:
 *   1. Query recent cards (7 days) for the mandala
 *   2. Compare with previous period (8-14 days ago) for trend detection
 *   3. LLM generates trend analysis + actionable alert
 *   4. Send alert via email
 *
 * Design: #334 (Mandala Skills Phase 2)
 */

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { config } from '@/config/index';
import { queryMandalaCards, type SkillCard } from './card-query';
import { transporter } from './mailer';
import type { InsightaSkill, SkillContext, SkillResult, SkillPreview } from './types';

const log = logger.child({ module: 'AlertSkill' });

const RECENT_WINDOW_DAYS = 7;
const PREVIOUS_WINDOW_DAYS = 14;
const ALERT_CARD_LIMIT = 100;

export class AlertSkill implements InsightaSkill {
  id = 'alert' as const;
  version = '1.0.0';
  description = 'Get trend alerts based on mandala activity changes';
  trigger = { type: 'manual' as const };
  tiers = ['free', 'pro', 'lifetime', 'admin'] as const;

  inputSchema: InsightaSkill['inputSchema'] = {
    type: 'object',
    properties: {
      mandala_id: { type: 'string', description: 'Mandala ID to analyze trends for' },
    },
    required: ['mandala_id'],
  };

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const start = Date.now();
    const { userId, mandalaId, llm } = ctx;

    try {
      const db = getPrismaClient();

      const mandala = await db.user_mandalas.findUnique({
        where: { id: mandalaId },
        select: { title: true },
      });
      if (!mandala) {
        return {
          success: false,
          error: 'Mandala not found',
          metadata: { duration_ms: Date.now() - start },
        };
      }

      // Get sector names
      const levels = await db.user_mandala_levels.findMany({
        where: { mandala_id: mandalaId },
        orderBy: { position: 'asc' },
        take: 1,
      });
      const sectorNames: string[] = levels[0]?.subjects ?? [];

      // Query recent cards (last 7 days)
      const now = new Date();
      const recentSince = new Date(now.getTime() - RECENT_WINDOW_DAYS * 86_400_000);
      const previousSince = new Date(now.getTime() - PREVIOUS_WINDOW_DAYS * 86_400_000);

      const recentCards = await queryMandalaCards({
        userId,
        mandalaId,
        since: recentSince,
        limit: ALERT_CARD_LIMIT,
      });

      const previousCards = await queryMandalaCards({
        userId,
        mandalaId,
        since: previousSince,
        limit: ALERT_CARD_LIMIT,
      });
      // Filter to only cards from the previous period (8-14 days ago)
      const olderCards = previousCards.filter((c) => c.created_at < recentSince);

      if (recentCards.length === 0 && olderCards.length === 0) {
        return {
          success: true,
          data: { skipped: 'no_activity', title: mandala.title },
          metadata: { duration_ms: Date.now() - start },
        };
      }

      // Build trend context
      const context = this.buildTrendContext(recentCards, olderCards, sectorNames, mandala.title);

      // Generate alert via LLM
      const alertContent = await llm.generate(this.buildPrompt(mandala.title, context), {
        maxTokens: 1024,
      });

      const alertTitle = `Activity Alert: ${mandala.title}`;

      // Save to skill_outputs
      await db.$executeRaw`
        INSERT INTO skill_outputs (user_id, mandala_id, skill_type, title, content, card_count, model_used)
        VALUES (${userId}::uuid, ${mandalaId}::uuid, ${this.id}, ${alertTitle}, ${alertContent},
                ${recentCards.length}, ${llm.model ?? 'unknown'})
      `;

      // Send email
      let emailSent = false;
      try {
        const user = await db.users.findUnique({
          where: { id: userId },
          select: { email: true },
        });
        if (user?.email) {
          await transporter.sendMail({
            from: config.gmail.smtpFrom,
            to: user.email,
            subject: alertTitle,
            html: this.buildEmailHtml(alertContent, alertTitle),
          });
          emailSent = true;
          log.info('Alert email sent', { userId, to: user.email });
        }
      } catch (mailErr) {
        log.warn('Alert email failed (non-critical)', {
          error: mailErr instanceof Error ? mailErr.message : String(mailErr),
        });
      }

      return {
        success: true,
        data: {
          title: alertTitle,
          content: alertContent,
          recent_count: recentCards.length,
          previous_count: olderCards.length,
          email_sent: emailSent,
        },
        metadata: {
          duration_ms: Date.now() - start,
          llm_tokens_used: alertContent.length,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error('Alert generation failed', { error, userId });
      return { success: false, error, metadata: { duration_ms: Date.now() - start } };
    }
  }

  async dryRun(ctx: SkillContext): Promise<SkillPreview> {
    const db = getPrismaClient();

    const mandala = await db.user_mandalas.findUnique({
      where: { id: ctx.mandalaId },
      select: { title: true },
    });

    const recentSince = new Date(Date.now() - RECENT_WINDOW_DAYS * 86_400_000);
    const recentCards = await queryMandalaCards({
      userId: ctx.userId,
      mandalaId: ctx.mandalaId,
      since: recentSince,
      limit: ALERT_CARD_LIMIT,
    });

    const sectorCount = [...new Set(recentCards.map((c) => c.cell_index))].length;

    return {
      subject: `Activity Alert: ${mandala?.title ?? 'Mandala'}`,
      preview_html: `<p><strong>${recentCards.length}</strong> new cards in the last 7 days across <strong>${sectorCount}</strong> sectors.</p>`,
      curated_count: recentCards.length,
    };
  }

  private buildTrendContext(
    recent: SkillCard[],
    older: SkillCard[],
    sectorNames: string[],
    title: string
  ): string {
    const recentBySector = this.groupBySector(recent);
    const olderBySector = this.groupBySector(older);

    const allSectors = new Set([...recentBySector.keys(), ...olderBySector.keys()]);
    const sections: string[] = [];

    for (const cellIndex of allSectors) {
      const sectorName = sectorNames[cellIndex] ?? `Sector ${cellIndex}`;
      const recentCount = recentBySector.get(cellIndex)?.length ?? 0;
      const olderCount = olderBySector.get(cellIndex)?.length ?? 0;

      let trend = 'stable';
      if (recentCount > olderCount) trend = 'growing';
      else if (recentCount < olderCount) trend = 'declining';

      const recentTitles = (recentBySector.get(cellIndex) ?? [])
        .map((c) => c.title ?? 'Untitled')
        .slice(0, 5)
        .join(', ');

      sections.push(
        `- **${sectorName}**: ${recentCount} new (prev: ${olderCount}) [${trend}]${recentTitles ? ` — ${recentTitles}` : ''}`
      );
    }

    return `# ${title}\n\nTotal: ${recent.length} new cards (prev period: ${older.length})\n\n${sections.join('\n')}`;
  }

  private groupBySector(cards: SkillCard[]): Map<number, SkillCard[]> {
    const map = new Map<number, SkillCard[]>();
    for (const card of cards) {
      const list = map.get(card.cell_index) ?? [];
      list.push(card);
      map.set(card.cell_index, list);
    }
    return map;
  }

  private buildPrompt(mandalaTitle: string, context: string): string {
    return `You are a knowledge management assistant. Analyze the following activity data for a mandala knowledge base and generate a brief trend alert.

## Activity Data
${context}

## Instructions
Write a concise activity alert in Markdown format with:
1. **Summary** (1-2 sentences: what changed this week)
2. **Trends** (which sectors are growing/declining, new topics emerging)
3. **Suggested Actions** (2-3 bullet points: what the user should focus on)

Requirements:
- Write in the same language as the card titles
- Be actionable and specific, not generic
- Keep it under 300 words
- Reference the mandala title "${mandalaTitle}"`;
  }

  private buildEmailHtml(content: string, title: string): string {
    const body = content
      .replace(/^### (.+)$/gm, '<h3 style="color:#6e46f9;margin:12px 0 6px">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="color:#6e46f9;margin:16px 0 8px">$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a2e;line-height:1.6">
<div style="border-bottom:3px solid #6e46f9;padding-bottom:10px;margin-bottom:20px">
<h1 style="margin:0;color:#6e46f9;font-size:20px">${title}</h1>
<p style="margin:4px 0 0;color:#666;font-size:12px">Insighta · ${new Date().toLocaleDateString()}</p>
</div>
<p>${body}</p>
<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;color:#999;font-size:11px">
<p>Auto-generated trend alert from your Insighta knowledge base.</p>
</div>
</body></html>`;
  }
}
