/**
 * src/modules/chatbot-rag/brief-prompt.ts
 *
 * System prompt for a chat opened on a published brief (work order
 * 2026-09-15, brief page "AI 챗봇" panel).
 *
 * The brief page marks its conversation with `[[brief:<slug>]]`. When
 * `rewriteSystemContent` sees that marker it loads this module on demand and
 * asks it for the whole system prompt; every other request never loads this
 * file and runs the existing path unchanged.
 *
 * The prompt is the product persona, the issue itself (stories with their
 * kicker, title and text; picks as the issue describes them; the source
 * list) and the answering rules. Grade tags such as `[확인]` / `[영상]` stay
 * exactly as written. Nothing outside the stored issue is fetched: no video
 * summaries, no transcripts, no retrieval.
 *
 * Access rule matches `src/api/routes/brief.ts`: a draft (`published_at IS
 * NULL`) is never readable, so an unpublished or unknown slug yields null and
 * the caller falls back to the ordinary prompt.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import {
  IssueDocumentSchema,
  type Block,
  type IssueDocument,
} from '@/modules/newsletter/issue-schema';
import { issueLabelOf, type IssueLocale } from '@/modules/newsletter/issue-label';
import { plainText } from '@/modules/newsletter/plain-text';
import { PRODUCT_PERSONA_EN, PRODUCT_PERSONA_KO, type Lang } from './prompt-builder';

const log = logger.child({ module: 'chatbot-rag/brief-prompt' });

/** The marker the brief page's chat panel puts in its instructions. */
export const BRIEF_SLUG_REGEX = /\[\[brief:([a-z0-9-]+)\]\]/;

/** Per-story text cap; four stories stay well inside the model's context. */
export const BRIEF_STORY_TEXT_MAX = 1_200;

/** Upper bound on sentences per answer, stated in the rules block. */
const BRIEF_ANSWER_MAX_SENTENCES = 6;

const TABLE_CELL_SEPARATOR = ' | ';
const HEADLINE_LINE_SEPARATOR = ' / ';
const REF_SOURCE_SEPARATOR = '; ';
const SCHEMA_ISSUES_LOGGED = 3;

export interface BriefIssue {
  slug: string;
  issueLabel: string;
  categoryKey: string;
  headline: string[];
  stories: Array<{ kicker: string; title: string; navLabel?: string; text: string }>;
  picks: Array<{ title: string; body: string; videoId?: string }>;
  refs: Array<{ label: string; sources: string[] }>;
}

export function parseBriefSlug(systemContent: string): string | null {
  return BRIEF_SLUG_REGEX.exec(systemContent)?.[1] ?? null;
}

function cap(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function blockText(b: Block): string {
  switch (b.type) {
    case 'p':
    case 'lede':
      return plainText(b.html);
    case 'h3':
      return b.text;
    case 'note':
      return `${b.lead}: ${plainText(b.html)}`;
    case 'table': {
      const rows = [b.head, ...b.rows].map((r) => r.join(TABLE_CELL_SEPARATOR));
      return (b.figref ? [b.figref, ...rows] : rows).join('\n');
    }
  }
}

function toBriefIssue(
  slug: string,
  issueNo: number,
  categoryKey: string,
  locale: IssueLocale,
  doc: IssueDocument
): BriefIssue {
  return {
    slug,
    issueLabel: issueLabelOf(issueNo, locale),
    categoryKey,
    headline: doc.headline,
    stories: doc.stories.map((s) => ({
      kicker: s.kicker,
      title: s.title,
      ...(s.navLabel ? { navLabel: s.navLabel } : {}),
      text: cap(s.blocks.map(blockText).join('\n'), BRIEF_STORY_TEXT_MAX),
    })),
    picks: doc.picks.map((p) => ({
      title: p.title,
      body: p.body,
      ...(p.videoId ? { videoId: p.videoId } : {}),
    })),
    refs: doc.refs.map((r) => ({
      label: r.label,
      sources: r.sources.map((src) => (src.url ? `${src.name} (${src.url})` : src.name)),
    })),
  };
}

/** The published issue for `slug`, or null (unknown, draft, invalid, DB error). */
export async function loadBriefIssue(slug: string): Promise<BriefIssue | null> {
  try {
    const row = await getPrismaClient().newsletter_issues.findUnique({
      where: { slug },
      select: {
        issue_no: true,
        category_key: true,
        locale: true,
        content_json: true,
        published_at: true,
      },
    });
    if (!row || !row.published_at) return null;

    const parsed = IssueDocumentSchema.safeParse(row.content_json);
    if (!parsed.success) {
      log.warn('brief content_json failed schema validation', {
        slug,
        issues: parsed.error.issues.slice(0, SCHEMA_ISSUES_LOGGED),
      });
      return null;
    }
    const locale: IssueLocale = row.locale === 'en' ? 'en' : 'ko';
    return toBriefIssue(slug, row.issue_no, row.category_key, locale, parsed.data);
  } catch (err) {
    log.warn('brief lookup failed; falling back to the ordinary prompt', {
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const BRIEF_RULES_KO = `[브리프 답변 규칙]
- 답은 위 이번 호 본문과 출처 목록 안에서만 합니다.
- 어느 스토리(kicker) 근거인지와 출처 등급([확인]/[영상])을 본문에 적힌 그대로 함께 말합니다.
- 이번 호에 없는 질문이면 "이번 호에서는 다루지 않았습니다"라고 말하고, 가장 가까운 스토리나 출처를 가리킵니다.
- 본문에 없는 숫자·날짜·이름을 만들지 않습니다.
- 존댓말로, ${BRIEF_ANSWER_MAX_SENTENCES}문장 이내로 답합니다.`;

const BRIEF_RULES_EN = `[Brief answering rules]
- Answer only from this issue's text and its source list above.
- Name the story (kicker) the answer rests on and quote its source grade ([확인]/[영상]) exactly as written.
- If the issue does not cover the question, say so and point to the closest story or source.
- Do not invent numbers, dates, or names that are not in the text.
- Reply in the user's language, at most ${BRIEF_ANSWER_MAX_SENTENCES} sentences.`;

export function renderBriefPrompt(b: BriefIssue, lang: Lang): string {
  const ko = lang === 'ko';
  const lines: string[] = [ko ? PRODUCT_PERSONA_KO : PRODUCT_PERSONA_EN, ''];
  lines.push(ko ? '[이번 호 브리프]' : '[This issue (brief)]');
  lines.push(
    ko
      ? `호: ${b.issueLabel} / 카테고리: ${b.categoryKey}`
      : `Issue: ${b.issueLabel} / Category: ${b.categoryKey}`
  );
  lines.push(`${ko ? '헤드라인' : 'Headline'}: ${b.headline.join(HEADLINE_LINE_SEPARATOR)}`);

  for (const s of b.stories) {
    lines.push('');
    const nav = s.navLabel ? ` (${ko ? '목차' : 'TOC'}: ${s.navLabel})` : '';
    lines.push(`## [${s.kicker}] ${s.title}${nav}`);
    lines.push(s.text);
  }

  if (b.picks.length > 0) {
    lines.push('');
    lines.push(ko ? '[이번 호 추천 영상]' : '[Picks in this issue]');
    b.picks.forEach((p, i) => {
      const vid = p.videoId ? ` (${p.videoId})` : '';
      lines.push(`${i + 1}. "${p.title}"${vid}`);
      lines.push(`   ${p.body}`);
    });
  }

  if (b.refs.length > 0) {
    lines.push('');
    lines.push(ko ? '[출처 목록]' : '[Sources]');
    for (const r of b.refs) lines.push(`- ${r.label}: ${r.sources.join(REF_SOURCE_SEPARATOR)}`);
  }

  lines.push('');
  lines.push(ko ? BRIEF_RULES_KO : BRIEF_RULES_EN);
  return lines.join('\n');
}

/**
 * The full system content for a brief conversation, or null when the content
 * carries no marker or the issue cannot be read (the caller then builds the
 * ordinary prompt).
 */
export async function buildBriefSystemContent(
  systemContent: string,
  lang: Lang
): Promise<string | null> {
  const slug = parseBriefSlug(systemContent);
  if (!slug) return null;
  const issue = await loadBriefIssue(slug);
  return issue ? renderBriefPrompt(issue, lang) : null;
}
