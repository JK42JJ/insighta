/**
 * src/modules/chatbot-rag/brief-context-loader.ts
 *
 * Block `brief_issue` source — the published brief a conversation is about.
 *
 * Reads `newsletter_issues` by slug, validates `content_json` against
 * IssueDocumentSchema, and flattens the document to prose the prompt
 * builder can print:
 *   - story blocks become plain text (HTML stripped; grade tags such as
 *     `[확인]` / `[영상]` are kept exactly as written in the issue),
 *   - picks keep the issue's own description plus the video's v2
 *     one-liner when a rich summary exists,
 *   - refs are copied through.
 *
 * Access rule matches `src/api/routes/brief.ts`: a draft
 * (`published_at IS NULL`) is never readable, so an unpublished slug
 * yields null exactly like an unknown one.
 *
 * Failures degrade to `null` (unknown slug, draft, schema mismatch, DB
 * error). A failed pick lookup drops only that pick's summary.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import {
  IssueDocumentSchema,
  type Block,
  type Pick as IssuePick,
  type Ref,
} from '@/modules/newsletter/issue-schema';
import { issueLabelOf, type IssueLocale } from '@/modules/newsletter/issue-label';
import { plainText } from '@/modules/newsletter/plain-text';
import { loadVideoContext } from './video-context-loader';
import {
  BRIEF_PICK_SUMMARY_MAX,
  BRIEF_PICKS_TOTAL_MAX,
  BRIEF_STORY_TEXT_MAX,
  type BriefContext,
  type BriefPickContext,
  type BriefRefContext,
  type BriefStoryContext,
} from './types';

const log = logger.child({ module: 'chatbot-rag/brief-context-loader' });

/** Table cells are joined with this so a row reads as one line of prose. */
const TABLE_CELL_SEPARATOR = ' | ';

/** Joins the v2 one-liner and core argument into one pick summary. */
const SUMMARY_PART_SEPARATOR = ' / ';

/** Number of zod issues kept in the warning log for a rejected document. */
const SCHEMA_ISSUES_LOGGED = 3;

function cap(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

/**
 * `navLabel` is not part of IssueDocumentSchema yet and zod strips unknown
 * keys on parse, so the label is read from the stored JSON by story index.
 */
function rawNavLabels(contentJson: unknown): Array<string | undefined> {
  if (!contentJson || typeof contentJson !== 'object') return [];
  const stories = (contentJson as { stories?: unknown }).stories;
  if (!Array.isArray(stories)) return [];
  return stories.map((s: unknown) => {
    if (!s || typeof s !== 'object') return undefined;
    const v = (s as { navLabel?: unknown }).navLabel;
    return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
  });
}

async function pickSummary(videoId: string): Promise<string | undefined> {
  try {
    const { v2Data } = await loadVideoContext({ youtubeVideoId: videoId, skipTranscript: true });
    const parts = [v2Data?.core?.one_liner, v2Data?.analysis?.core_argument].filter(
      (p): p is string => typeof p === 'string' && p.trim().length > 0
    );
    return parts.length > 0 ? parts.join(SUMMARY_PART_SEPARATOR) : undefined;
  } catch (err) {
    log.warn('pick summary lookup failed; pick kept without summary', {
      videoId,
      error: errorMessage(err),
    });
    return undefined;
  }
}

/**
 * Summaries are fetched in parallel, then the total budget is spent in
 * pick order: each summary is capped per pick and again by what is left
 * of BRIEF_PICKS_TOTAL_MAX, so later picks lose their summary first.
 */
async function buildPicks(picks: IssuePick[]): Promise<BriefPickContext[]> {
  const summaries = await Promise.all(
    picks.map((p) => (p.videoId ? pickSummary(p.videoId) : Promise.resolve(undefined)))
  );
  let budget = BRIEF_PICKS_TOTAL_MAX;
  return picks.map((p, i) => {
    const out: BriefPickContext = { title: p.title, body: p.body };
    if (p.videoId) out.videoId = p.videoId;
    const raw = summaries[i];
    if (raw && budget > 0) {
      const summary = cap(raw, Math.min(BRIEF_PICK_SUMMARY_MAX, budget));
      budget -= summary.length;
      out.summary = summary;
    }
    return out;
  });
}

function buildRefs(refs: Ref[]): BriefRefContext[] {
  return refs.map((r) => ({
    label: r.label,
    sources: r.sources.map((s) => (s.url ? `${s.name} (${s.url})` : s.name)),
  }));
}

export async function loadBriefContext(slug: string): Promise<BriefContext | null> {
  if (!slug) return null;
  const prisma = getPrismaClient();

  try {
    const row = await prisma.newsletter_issues.findUnique({
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
    const doc = parsed.data;
    const locale: IssueLocale = row.locale === 'en' ? 'en' : 'ko';
    const navLabels = rawNavLabels(row.content_json);

    const stories: BriefStoryContext[] = doc.stories.map((s, i) => {
      const story: BriefStoryContext = {
        kicker: s.kicker,
        title: s.title,
        text: cap(s.blocks.map(blockText).join('\n'), BRIEF_STORY_TEXT_MAX),
      };
      const navLabel = navLabels[i];
      if (navLabel) story.navLabel = navLabel;
      return story;
    });

    return {
      slug,
      issueLabel: issueLabelOf(row.issue_no, locale),
      categoryKey: row.category_key,
      headline: doc.headline,
      stories,
      picks: await buildPicks(doc.picks),
      refs: buildRefs(doc.refs),
    };
  } catch (err) {
    log.warn('brief lookup failed', { slug, error: errorMessage(err) });
    return null;
  }
}
