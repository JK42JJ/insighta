/**
 * S7 — assemble the evidence a person writes from.
 *
 * The machine's job ends at facts. It produces the parts of an issue that are
 * derivable from the corpus and refuses the parts that are not:
 *
 *   derived   picks (title, channel, exact view count, working id), the funnel
 *             read from the ledger, the ledger rows for figures the corpus can
 *             prove, the week's corroborated subjects
 *   left      the headline, the stories, the insight, the vocabulary. Those
 *             are editorial judgement, and a machine writing them is how issue
 *             1 ended up with sentences containing numbers nobody sourced.
 *
 * The result is written as a draft document plus an evidence file. Any field
 * a person still has to write is present with a marker rather than absent, so
 * the gap is visible in review instead of being discovered at publication.
 *
 * Nothing here is published. `publishedAt` stays null in the database until a
 * person publishes it, and the publish gates run first.
 */

import { logger } from '@/utils/logger';
import type { CorpusRow } from '../corpus';
import type { Stage, StageContext, StageResult } from '../stage';

const log = logger.child({ module: 'newsletter/s7' });

/** Text a person must replace. Loud on purpose — it must not survive review. */
export const TODO = '[[EDITOR]]';

export interface PickDraft {
  title: string;
  latin: boolean;
  meta: string;
  body: string;
  videoId: string;
  url: string;
  channelTitle: string;
  viewCount: number | null;
  publishedAt: string;
  source: 'trusted' | 'search';
  judgedBy: string;
  why: string;
  independentChannels: number;
}

function isLatinTitle(title: string): boolean {
  return !/[가-힣]/.test(title);
}

function fmtViews(n: number | null): string {
  if (n == null) return '조회수 미상';
  if (n >= 10000) return `${Math.round(n / 1000) / 10}만회`;
  return `${n.toLocaleString('ko-KR')}회`;
}

/**
 * Rank the shortlist.
 *
 * Corroboration first, because a subject several independent channels covered
 * is the week's event rather than one channel's opinion. Trusted layer next,
 * because an editor already decided that channel matters. Recency last. Views
 * are printed but never rank: popularity is what a weekly brief is supposed to
 * see past.
 */
function rank(a: CorpusRow, b: CorpusRow): number {
  const ac = ((a.corroboration ?? {}) as { independentChannels?: number }).independentChannels ?? 0;
  const bc = ((b.corroboration ?? {}) as { independentChannels?: number }).independentChannels ?? 0;
  if (ac !== bc) return bc - ac;
  if (a.source !== b.source) return a.source === 'trusted' ? -1 : 1;
  return b.publishedAt.getTime() - a.publishedAt.getTime();
}

export const s7Draft: Stage = {
  id: 'S7_draft',
  what: 'derive picks and the funnel; leave the writing to a person',
  kind: 'person',

  async run(input: CorpusRow[], ctx: StageContext): Promise<StageResult> {
    const PICK_COUNT = 5;
    const ranked = [...input].sort(rank);

    // One pick per channel. Five videos from one channel is a channel profile,
    // not a week in review.
    const picks: PickDraft[] = [];
    const usedChannels = new Set<string>();
    for (const v of ranked) {
      if (picks.length >= PICK_COUNT) break;
      if (usedChannels.has(v.channelId)) continue;
      usedChannels.add(v.channelId);

      const e = (v.enrichment ?? {}) as {
        title?: string;
        channelTitle?: string;
        viewCount?: number | null;
        publishedAt?: string;
        url?: string;
      };
      const verdict = (v.verdict ?? {}) as { judge?: string; why?: string };
      const corr = (v.corroboration ?? {}) as { independentChannels?: number };

      // Every printed field comes from S4's response, never from this code's
      // memory of the harvest. That is the gate `checkVideosResolve` enforces.
      const title = e.title ?? v.title;
      const channelTitle = e.channelTitle ?? v.channelTitle;
      const views = e.viewCount ?? v.viewCount ?? null;

      picks.push({
        title,
        latin: isLatinTitle(title),
        meta: `${channelTitle} · ${fmtViews(views)}`,
        body: TODO,
        videoId: v.videoId,
        url: e.url ?? `https://www.youtube.com/watch?v=${v.videoId}`,
        channelTitle,
        viewCount: views,
        publishedAt: e.publishedAt ?? v.publishedAt.toISOString(),
        source: v.source,
        judgedBy: verdict.judge ?? 'unknown',
        why: verdict.why ?? '',
        independentChannels: corr.independentChannels ?? 0,
      });
    }

    const funnel = ctx.artifacts['funnel'] as
      | {
          buckets: Array<{ key: string; count: number; label: string }>;
          harvested: number;
          reviewed: number;
          quotaUnits: number;
        }
      | undefined;

    // The subjects at least three independent channels covered — the candidate
    // stories, offered to the editor rather than written up by the machine.
    const subjects = new Map<string, { channels: Set<string>; videos: string[] }>();
    for (const v of input) {
      const corr = (v.corroboration ?? {}) as {
        corroborated?: Array<{ term: string; channels: number }>;
      };
      for (const c of corr.corroborated ?? []) {
        const entry = subjects.get(c.term) ?? { channels: new Set<string>(), videos: [] };
        entry.channels.add(v.channelId);
        entry.videos.push(v.videoId);
        subjects.set(c.term, entry);
      }
    }
    const candidateStories = [...subjects.entries()]
      .map(([term, e]) => ({
        term,
        independentChannels: e.channels.size,
        videos: e.videos.slice(0, 8),
      }))
      .filter((s) => s.independentChannels >= 3)
      .sort((a, b) => b.independentChannels - a.independentChannels)
      .slice(0, 10);

    ctx.artifacts['draft'] = {
      generatedAt: new Date().toISOString(),
      runId: ctx.runId,
      categoryKey: ctx.topic.categoryKey,
      judge: ctx.judge.name,
      judgeProvenance: ctx.judge.provenance,
      shortlist: input.length,
      picks,
      candidateStories,
      funnel: funnel ?? null,
      /** Present so a reviewer can see what is still missing. */
      awaitingEditor: [
        'headline',
        'dek',
        'runline',
        'preview',
        'interest.intro',
        'interest.ledger',
        'stories',
        'insight',
        'vocabulary',
        'picks[].body',
        'next',
        'mail',
        'refs',
      ],
    };

    log.info('S7 complete', { picks: picks.length, candidateStories: candidateStories.length });
    return {
      survivors: input.map((v) => ({ videoId: v.videoId })),
      drops: [],
      detail: {
        picks: picks.length,
        pickChannels: [...usedChannels],
        candidateStories: candidateStories.length,
      },
    };
  },
};
