/**
 * VideoScriptSkill — Generate a video script from mandala cell cards
 *
 * Pipeline:
 *   1. Query cards for selected cells (or full mandala)
 *   2. Group by sector with names
 *   3. LLM generates Intro/Body/Outro video script
 *   4. Save to skill_outputs table
 *
 * Design: #334 (Mandala Skills Phase 2)
 */

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { TIER_LIMITS } from '@/config/quota';
import { queryMandalaCards, type SkillCard } from './card-query';
import type { InsightaSkill, SkillContext, SkillResult, SkillPreview } from './types';

const log = logger.child({ module: 'VideoScriptSkill' });

export class VideoScriptSkill implements InsightaSkill {
  id = 'script' as const;
  version = '1.0.0';
  description = 'Generate a video script from your mandala cards';
  trigger = { type: 'manual' as const };
  tiers = ['free', 'pro', 'lifetime', 'admin'] as const;

  inputSchema: InsightaSkill['inputSchema'] = {
    type: 'object',
    properties: {
      mandala_id: { type: 'string', description: 'Mandala ID to generate script for' },
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
    const maxCards = TIER_LIMITS[tier].skills.script.maxCards;

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

      const levels = await db.user_mandala_levels.findMany({
        where: { mandala_id: mandalaId },
        orderBy: { position: 'asc' },
        take: 1,
      });
      const sectorNames: string[] = levels[0]?.subjects ?? [];

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

      const context = this.buildContext(cards, sectorNames, mandala.title);
      const scriptContent = await llm.generate(this.buildPrompt(mandala.title, context), {
        maxTokens: 3072,
      });

      const scriptTitle = `Video Script: ${mandala.title}`;

      await db.$executeRaw`
        INSERT INTO skill_outputs (user_id, mandala_id, skill_type, title, content, cell_scope, card_count, model_used)
        VALUES (${userId}::uuid, ${mandalaId}::uuid, ${this.id}, ${scriptTitle}, ${scriptContent},
                ${cellScope ?? []}::int[], ${cards.length}, ${llm.model ?? 'unknown'})
      `;

      return {
        success: true,
        data: {
          title: scriptTitle,
          content: scriptContent,
          card_count: cards.length,
          sectors_covered: [...new Set(cards.map((c) => c.cell_index))].length,
        },
        metadata: {
          duration_ms: Date.now() - start,
          llm_tokens_used: scriptContent.length,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error('Video script generation failed', { error, userId });
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

    const maxCards = TIER_LIMITS[ctx.tier].skills.script.maxCards;
    const cards = await queryMandalaCards({
      userId: ctx.userId,
      mandalaId: ctx.mandalaId,
      cellScope,
      limit: maxCards,
    });

    const sectorCount = [...new Set(cards.map((c) => c.cell_index))].length;

    return {
      subject: `Video Script: ${mandala?.title ?? 'Mandala'}`,
      preview_html: `<p>Will create a script from <strong>${cards.length}</strong> cards across <strong>${sectorCount}</strong> sectors.</p>`,
      curated_count: cards.length,
    };
  }

  private buildContext(cards: SkillCard[], sectorNames: string[], title: string): string {
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
          return `  - ${c.title ?? 'Untitled'}${summary}`;
        })
        .join('\n');
      sections.push(`### ${sectorName} (${cellCards.length} cards)\n${cardSummaries}`);
    }

    return `# ${title}\n\n${sections.join('\n\n')}`;
  }

  private buildPrompt(title: string, context: string): string {
    return `You are a professional video scriptwriter. Create a video script based on the following knowledge base.

## Knowledge Base
${context}

## Instructions
Write a video script in Markdown format with clear sections:

1. **INTRO** (30-60 seconds)
   - Hook: attention-grabbing opening line
   - Topic introduction: what the viewer will learn
   - Brief overview of key points

2. **BODY** (3-5 minutes)
   - One section per major topic/sector
   - Each section: key point → evidence/example → transition
   - Include [VISUAL CUE] markers for B-roll or graphics
   - Natural spoken language (not written prose)

3. **OUTRO** (30 seconds)
   - Summary of key takeaways
   - Call to action
   - Closing line

Requirements:
- Write in the same language as the card titles
- Use conversational, spoken-word tone (not academic)
- Include [PAUSE], [VISUAL CUE], [EMPHASIS] markers
- Each section should have approximate timing
- Keep total script 800-1200 words
- Reference the topic "${title}"`;
  }
}
