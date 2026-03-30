/**
 * BlogPostSkill — Generate a blog post draft from mandala cards
 *
 * Pipeline:
 *   1. Query cards for selected cells (or full mandala)
 *   2. Group by sector with names
 *   3. LLM generates SEO-structured blog post
 *   4. Save to skill_outputs table
 *
 * Design: #334 (Mandala Skills Phase 2)
 */

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { TIER_LIMITS } from '@/config/quota';
import { queryMandalaCards, type SkillCard } from './card-query';
import type { InsightaSkill, SkillContext, SkillResult, SkillPreview } from './types';

const log = logger.child({ module: 'BlogPostSkill' });

export class BlogPostSkill implements InsightaSkill {
  id = 'blog' as const;
  version = '1.0.0';
  description = 'Generate a blog post draft from your mandala knowledge';
  trigger = { type: 'manual' as const };
  tiers = ['free', 'pro', 'lifetime', 'admin'] as const;

  inputSchema: InsightaSkill['inputSchema'] = {
    type: 'object',
    properties: {
      mandala_id: { type: 'string', description: 'Mandala ID to generate blog post for' },
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
    const maxCards = TIER_LIMITS[tier].skills.blog.maxCards;

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
      const blogContent = await llm.generate(this.buildPrompt(mandala.title, context), {
        maxTokens: 4096,
      });

      const blogTitle = `Blog: ${mandala.title}`;

      await db.$executeRaw`
        INSERT INTO skill_outputs (user_id, mandala_id, skill_type, title, content, cell_scope, card_count, model_used)
        VALUES (${userId}::uuid, ${mandalaId}::uuid, ${this.id}, ${blogTitle}, ${blogContent},
                ${cellScope ?? []}::int[], ${cards.length}, ${llm.model ?? 'unknown'})
      `;

      return {
        success: true,
        data: {
          title: blogTitle,
          content: blogContent,
          card_count: cards.length,
          sectors_covered: [...new Set(cards.map((c) => c.cell_index))].length,
        },
        metadata: {
          duration_ms: Date.now() - start,
          llm_tokens_used: blogContent.length,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error('Blog post generation failed', { error, userId });
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

    const maxCards = TIER_LIMITS[ctx.tier].skills.blog.maxCards;
    const cards = await queryMandalaCards({
      userId: ctx.userId,
      mandalaId: ctx.mandalaId,
      cellScope,
      limit: maxCards,
    });

    const sectorCount = [...new Set(cards.map((c) => c.cell_index))].length;

    return {
      subject: `Blog Post: ${mandala?.title ?? 'Mandala'}`,
      preview_html: `<p>Will draft a blog post from <strong>${cards.length}</strong> cards across <strong>${sectorCount}</strong> sectors.</p>`,
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
          const source = c.channel_title ? ` (${c.channel_title})` : '';
          return `  - ${c.title ?? 'Untitled'}${source}${summary}`;
        })
        .join('\n');
      sections.push(`### ${sectorName} (${cellCards.length} cards)\n${cardSummaries}`);
    }

    return `# ${title}\n\n${sections.join('\n\n')}`;
  }

  private buildPrompt(title: string, context: string): string {
    return `You are a professional blog writer and content strategist. Write a compelling blog post based on the following knowledge base.

## Knowledge Base
${context}

## Instructions
Write a blog post in Markdown format with:

1. **Title** — catchy, SEO-friendly headline (H1)
2. **Meta Description** — 1-2 sentence summary for search engines (in a blockquote)
3. **Introduction** — hook the reader, state the problem/question, preview the post
4. **Main Sections** (3-5 sections with H2 headings)
   - Each section covers one key topic from the knowledge base
   - Include specific examples and insights from the cards
   - Use subheadings (H3) for complex sections
   - Add transition sentences between sections
5. **Key Takeaways** — bulleted summary of main points
6. **Conclusion** — wrap up with a forward-looking statement or call to action

Requirements:
- Write in the same language as the card titles
- Use engaging, readable prose (not bullet-point lists for the main body)
- Optimize for web reading: short paragraphs, clear headings
- Include bold text for key terms and concepts
- Target 1000-1500 words
- Topic: "${title}"`;
  }
}
