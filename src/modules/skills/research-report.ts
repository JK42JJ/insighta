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

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import type { InsightaSkill, SkillContext, SkillResult, SkillPreview } from './types';

const log = logger.child({ module: 'ResearchReportSkill' });

const REPORT_CARD_LIMIT = 50;

interface CardRow {
  id: string;
  title: string | null;
  url: string | null;
  cell_index: number;
  one_liner: string | null;
  channel_title: string | null;
  source_table: string;
}

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
    const { userId, mandalaId, llm } = ctx;
    const cellScope = (ctx.params?.['cell_scope'] as number[] | undefined) ?? null;

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

      // 2. Query cards (local + synced)
      const cards = await this.queryCards(userId, mandalaId, rootLevel?.id, cellScope);
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

      return {
        success: true,
        data: {
          title: reportTitle,
          content: reportContent,
          card_count: cards.length,
          sectors_covered: [...new Set(cards.map((c) => c.cell_index))].length,
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

    const levels = await db.user_mandala_levels.findMany({
      where: { mandala_id: ctx.mandalaId },
      orderBy: { position: 'asc' },
      take: 1,
    });

    const cards = await this.queryCards(ctx.userId, ctx.mandalaId, levels[0]?.id, cellScope);

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

  private async queryCards(
    userId: string,
    mandalaId: string,
    _rootLevelId: string | undefined,
    cellScope: number[] | null
  ): Promise<CardRow[]> {
    const db = getPrismaClient();

    // Local cards — all cards in mandala (no level_id filter: level_id stores level_key, not UUID)
    const localCards = await db.user_local_cards.findMany({
      where: {
        user_id: userId,
        mandala_id: mandalaId,
        cell_index: cellScope ? { in: cellScope } : { gte: 0 },
      },
      select: {
        id: true,
        title: true,
        url: true,
        cell_index: true,
      },
      take: REPORT_CARD_LIMIT,
    });

    // Synced cards with summaries — all in mandala (no level_id filter)
    const syncedCards = await db.$queryRaw<CardRow[]>`
      SELECT
        uvs.id::text,
        yv.title,
        CONCAT('https://youtube.com/watch?v=', yv.youtube_video_id) as url,
        uvs.cell_index,
        vrs.one_liner,
        yv.channel_title,
        'synced' as source_table
      FROM user_video_states uvs
      JOIN youtube_videos yv ON yv.id = uvs.video_id
      LEFT JOIN video_rich_summaries vrs ON vrs.video_id = yv.youtube_video_id
      WHERE uvs.user_id = ${userId}::uuid
        AND uvs.mandala_id = ${mandalaId}::uuid
        AND uvs.cell_index >= 0
        AND uvs.is_in_ideation = false
        ${cellScope ? Prisma.sql`AND uvs.cell_index = ANY(${cellScope}::int[])` : Prisma.empty}
      ORDER BY uvs.created_at DESC
      LIMIT ${REPORT_CARD_LIMIT}
    `;

    const merged: CardRow[] = [
      ...localCards.map((c) => ({
        id: c.id,
        title: c.title,
        url: c.url,
        cell_index: c.cell_index ?? 0,
        one_liner: null,
        channel_title: null,
        source_table: 'local',
      })),
      ...syncedCards,
    ];

    return merged.slice(0, REPORT_CARD_LIMIT);
  }

  private buildContext(cards: CardRow[], sectorNames: string[], mandalaTitle: string): string {
    const bySector = new Map<number, CardRow[]>();
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
