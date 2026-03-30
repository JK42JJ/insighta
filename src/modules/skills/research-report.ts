/**
 * ResearchReportSkill — Mandala-based research report generation
 *
 * Pipeline:
 *   1. Query all cards in the mandala (or selected cells)
 *   2. Group by sector (cell) with sector names
 *   3. Build context from card titles + AI summaries
 *   4. LLM generates structured research report (Markdown)
 *   5. Save to skill_outputs table
 *
 * Design: #334 (Mandala Skills Phase 1)
 */

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { config } from '@/config/index';
import { TIER_LIMITS } from '@/config/quota';
import { queryMandalaCards, type SkillCard } from './card-query';
import { transporter } from './mailer';
import type { InsightaSkill, SkillContext, SkillResult, SkillPreview } from './types';

const log = logger.child({ module: 'ResearchReportSkill' });

export class ResearchReportSkill implements InsightaSkill {
  id = 'report' as const;
  version = '1.0.0';
  description = 'Generate a structured research report from mandala cards';
  trigger = { type: 'manual' as const };
  tiers = ['free', 'pro', 'lifetime', 'admin'] as const;

  inputSchema: InsightaSkill['inputSchema'] = {
    type: 'object',
    properties: {
      mandala_id: { type: 'string', description: 'Mandala ID to generate report for' },
      cell_scope: {
        type: 'array',
        items: { type: 'integer' },
        description: 'Specific cell indices to include (omit for full mandala)',
      },
    },
    required: ['mandala_id'],
  };

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const start = Date.now();
    const { userId, mandalaId, tier, llm } = ctx;
    const cellScope = (ctx.params?.['cell_scope'] as number[] | undefined) ?? null;
    const maxCards = TIER_LIMITS[tier].skills.report.maxCards;

    try {
      const db = getPrismaClient();

      // 1. Get mandala info + sector names
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

      const levels = await db.user_mandala_levels.findMany({
        where: { mandala_id: mandalaId },
        orderBy: { position: 'asc' },
        take: 1,
      });
      const rootLevel = levels[0];
      const sectorNames: string[] = rootLevel?.subjects ? rootLevel.subjects : [];

      // 2. Query cards (local + synced) — unified card query
      const cards = await queryMandalaCards({
        userId,
        mandalaId,
        cellScope,
        limit: maxCards,
      });
      if (cards.length === 0) {
        return {
          success: true,
          data: { skipped: 'no_cards', title: mandala.title },
          metadata: { duration_ms: Date.now() - start },
        };
      }

      // 3. Build context for LLM
      const context = this.buildContext(cards, sectorNames, mandala.title);

      // 4. Generate report via LLM
      const reportContent = await llm.generate(this.buildPrompt(mandala.title, context), {
        maxTokens: 4096,
      });

      const reportTitle = `Research Report: ${mandala.title}`;

      // 5. Save to skill_outputs
      await db.$executeRaw`
        INSERT INTO skill_outputs (user_id, mandala_id, skill_type, title, content, cell_scope, card_count, model_used)
        VALUES (${userId}::uuid, ${mandalaId}::uuid, ${this.id}, ${reportTitle}, ${reportContent},
                ${cellScope ?? []}::int[], ${cards.length}, ${llm.model ?? 'unknown'})
      `;

      // 6. Send report via email
      let emailSent = false;
      try {
        const user = await db.users.findUnique({
          where: { id: userId },
          select: { email: true },
        });
        if (user?.email) {
          const html = this.markdownToHtml(reportContent, reportTitle);
          await transporter.sendMail({
            from: config.gmail.smtpFrom,
            to: user.email,
            subject: reportTitle,
            html,
          });
          emailSent = true;
          log.info('Research report email sent', { userId, to: user.email });
        }
      } catch (mailErr) {
        // Email failure is non-critical — report is saved in DB
        log.warn('Research report email failed (non-critical)', {
          error: mailErr instanceof Error ? mailErr.message : String(mailErr),
        });
      }

      return {
        success: true,
        data: {
          title: reportTitle,
          content: reportContent,
          card_count: cards.length,
          sectors_covered: [...new Set(cards.map((c) => c.cell_index))].length,
          email_sent: emailSent,
        },
        metadata: {
          duration_ms: Date.now() - start,
          llm_tokens_used: reportContent.length, // approximate
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error('Research report generation failed', { error, userId });
      return { success: false, error, metadata: { duration_ms: Date.now() - start } };
    }
  }

  async dryRun(ctx: SkillContext): Promise<SkillPreview> {
    const db = getPrismaClient();
    const cellScope = (ctx.params?.['cell_scope'] as number[] | undefined) ?? null;

    const mandala = await db.user_mandalas.findUnique({
      where: { id: ctx.mandalaId },
      select: { title: true },
    });

    const maxCards = TIER_LIMITS[ctx.tier].skills.report.maxCards;
    const cards = await queryMandalaCards({
      userId: ctx.userId,
      mandalaId: ctx.mandalaId,
      cellScope,
      limit: maxCards,
    });

    const sectorCount = [...new Set(cards.map((c) => c.cell_index))].length;

    return {
      subject: `Research Report: ${mandala?.title ?? 'Mandala'}`,
      preview_html: `<p>Will analyze <strong>${cards.length}</strong> cards across <strong>${sectorCount}</strong> sectors.</p>`,
      curated_count: cards.length,
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private buildContext(cards: SkillCard[], sectorNames: string[], mandalaTitle: string): string {
    const bySector = new Map<number, SkillCard[]>();
    for (const card of cards) {
      const list = bySector.get(card.cell_index) ?? [];
      list.push(card);
      bySector.set(card.cell_index, list);
    }

    const sections: string[] = [];
    for (const [cellIndex, cellCards] of bySector) {
      const sectorName = sectorNames[cellIndex] ?? `Sector ${cellIndex}`;
      const cardSummaries = cellCards
        .map((c) => {
          const summary = c.one_liner ? ` — ${c.one_liner}` : '';
          const source = c.channel_title ? ` (${c.channel_title})` : '';
          return `  - ${c.title ?? 'Untitled'}${source}${summary}`;
        })
        .join('\n');
      sections.push(`### ${sectorName} (${cellCards.length} cards)\n${cardSummaries}`);
    }

    return `# ${mandalaTitle}\n\n${sections.join('\n\n')}`;
  }

  /** Simple Markdown → HTML for email (no external dependency) */
  private markdownToHtml(markdown: string, title: string): string {
    const body = markdown
      .replace(/^### (.+)$/gm, '<h3 style="color:#6e46f9;margin:16px 0 8px">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="color:#6e46f9;margin:20px 0 10px">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="color:#6e46f9;margin:24px 0 12px">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#1a1a2e;line-height:1.7">
<div style="border-bottom:3px solid #6e46f9;padding-bottom:12px;margin-bottom:24px">
<h1 style="margin:0;color:#6e46f9">${title}</h1>
<p style="margin:4px 0 0;color:#666;font-size:13px">Generated by Insighta · ${new Date().toLocaleDateString()}</p>
</div>
<p>${body}</p>
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;color:#999;font-size:12px">
<p>This report was auto-generated from your Insighta mandala knowledge base.</p>
</div>
</body></html>`;
  }

  private buildPrompt(mandalaTitle: string, context: string): string {
    return `You are an expert research analyst. Generate a comprehensive research report based on the following knowledge base organized by sectors.

## Knowledge Base
${context}

## Instructions
Write a structured research report in Markdown format with:
1. **Executive Summary** (2-3 paragraphs)
2. **Key Findings by Sector** (one section per sector with analysis)
3. **Cross-Sector Insights** (connections between different sectors)
4. **Recommendations** (3-5 actionable items)
5. **Conclusion**

Requirements:
- Write in the same language as the card titles (if Korean titles, write in Korean)
- Be analytical, not just descriptive
- Identify patterns and trends across the collected knowledge
- Keep the report concise but insightful (800-1500 words)
- Use the mandala title "${mandalaTitle}" as the report's main theme`;
  }
}
