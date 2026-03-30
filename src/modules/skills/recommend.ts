/**
 * RecommendSkill — AI-powered knowledge gap recommendations
 *
 * Pipeline:
 *   1. Query all cards in the mandala
 *   2. Analyze coverage per sector (card density, topic diversity)
 *   3. LLM identifies gaps and suggests new topics/resources
 *   4. Save recommendations to skill_outputs
 *
 * Design: #334 (Mandala Skills Phase 2)
 */

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { TIER_LIMITS } from '@/config/quota';
import { queryMandalaCards, type SkillCard } from './card-query';
import type { InsightaSkill, SkillContext, SkillResult, SkillPreview } from './types';

const log = logger.child({ module: 'RecommendSkill' });

const RECOMMEND_CARD_LIMIT = 200;

export class RecommendSkill implements InsightaSkill {
  id = 'recommend' as const;
  version = '1.0.0';
  description = 'Get AI recommendations to fill knowledge gaps in your mandala';
  trigger = { type: 'manual' as const };
  tiers = ['free', 'pro', 'lifetime', 'admin'] as const;

  inputSchema: InsightaSkill['inputSchema'] = {
    type: 'object',
    properties: {
      mandala_id: { type: 'string', description: 'Mandala ID to analyze for recommendations' },
    },
    required: ['mandala_id'],
  };

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const start = Date.now();
    const { userId, mandalaId, tier, llm } = ctx;
    const dailyItems = TIER_LIMITS[tier].skills.recommend.dailyItems;

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

      // Query all cards
      const cards = await queryMandalaCards({
        userId,
        mandalaId,
        limit: RECOMMEND_CARD_LIMIT,
      });

      if (cards.length === 0) {
        return {
          success: true,
          data: { skipped: 'no_cards', title: mandala.title },
          metadata: { duration_ms: Date.now() - start },
        };
      }

      // Build coverage analysis context
      const context = this.buildCoverageContext(cards, sectorNames, mandala.title);

      // Generate recommendations via LLM
      const maxItems = dailyItems ?? 10;
      const recommendations = await llm.generate(
        this.buildPrompt(mandala.title, context, maxItems),
        { maxTokens: 2048 }
      );

      const outputTitle = `Recommendations: ${mandala.title}`;

      // Save to skill_outputs
      await db.$executeRaw`
        INSERT INTO skill_outputs (user_id, mandala_id, skill_type, title, content, card_count, model_used)
        VALUES (${userId}::uuid, ${mandalaId}::uuid, ${this.id}, ${outputTitle}, ${recommendations},
                ${cards.length}, ${llm.model ?? 'unknown'})
      `;

      return {
        success: true,
        data: {
          title: outputTitle,
          content: recommendations,
          card_count: cards.length,
          sectors_analyzed: [...new Set(cards.map((c) => c.cell_index))].length,
        },
        metadata: {
          duration_ms: Date.now() - start,
          llm_tokens_used: recommendations.length,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error('Recommendation generation failed', { error, userId });
      return { success: false, error, metadata: { duration_ms: Date.now() - start } };
    }
  }

  async dryRun(ctx: SkillContext): Promise<SkillPreview> {
    const db = getPrismaClient();

    const mandala = await db.user_mandalas.findUnique({
      where: { id: ctx.mandalaId },
      select: { title: true },
    });

    const cards = await queryMandalaCards({
      userId: ctx.userId,
      mandalaId: ctx.mandalaId,
      limit: RECOMMEND_CARD_LIMIT,
    });

    const sectorCount = [...new Set(cards.map((c) => c.cell_index))].length;
    const totalSectors = 9;
    const emptySectors = totalSectors - sectorCount;

    return {
      subject: `Recommendations: ${mandala?.title ?? 'Mandala'}`,
      preview_html: `<p>Analyzing <strong>${cards.length}</strong> cards across <strong>${sectorCount}</strong> sectors. <strong>${emptySectors}</strong> sectors have no cards yet.</p>`,
      curated_count: cards.length,
    };
  }

  private buildCoverageContext(cards: SkillCard[], sectorNames: string[], title: string): string {
    const bySector = new Map<number, SkillCard[]>();
    for (const card of cards) {
      const list = bySector.get(card.cell_index) ?? [];
      list.push(card);
      bySector.set(card.cell_index, list);
    }

    const sections: string[] = [];
    const totalSectors = Math.max(sectorNames.length, 9);

    for (let i = 0; i < totalSectors; i++) {
      const sectorName = sectorNames[i] ?? `Sector ${i}`;
      const sectorCards = bySector.get(i) ?? [];

      if (sectorCards.length === 0) {
        sections.push(`- **${sectorName}**: EMPTY (0 cards) — needs content`);
      } else {
        const topics = sectorCards
          .map((c) => c.title ?? 'Untitled')
          .slice(0, 5)
          .join(', ');
        const hasAiSummaries = sectorCards.some((c) => c.one_liner);
        sections.push(
          `- **${sectorName}**: ${sectorCards.length} cards${hasAiSummaries ? ' (with AI summaries)' : ''} — ${topics}`
        );
      }
    }

    return `# ${title}\n\nTotal: ${cards.length} cards across ${bySector.size}/${totalSectors} sectors\n\n${sections.join('\n')}`;
  }

  private buildPrompt(title: string, context: string, maxItems: number): string {
    return `You are a knowledge management advisor. Analyze the following mandala knowledge base coverage and recommend topics/resources to fill gaps.

## Current Coverage
${context}

## Instructions
Generate up to ${maxItems} actionable recommendations in Markdown format:

1. **Coverage Summary** (1-2 sentences: overall knowledge completeness)
2. **Gap Analysis** (which sectors are weak or empty)
3. **Recommendations** (numbered list, each with):
   - A specific topic or keyword to research
   - Why it matters for this mandala's theme
   - Suggested resource type (article, video, book, tool)

Requirements:
- Write in the same language as the card titles
- Prioritize empty sectors first, then sectors with low diversity
- Be specific — suggest actual topics, not vague categories
- Keep it concise (400-800 words)
- Reference the mandala title "${title}"`;
  }
}
