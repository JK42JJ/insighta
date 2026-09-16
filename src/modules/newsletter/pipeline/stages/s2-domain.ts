/**
 * S2 — the topic boundary, applied before anything expensive.
 *
 * `ai-tech` is not "AI and technology". The master spec (§23) lists AI and
 * 개발 as separate briefs and the code's CATEGORY_KEYS matches, so this brief
 * is the change in AI itself and general programming belongs to `dev`.
 *
 * Deterministic on purpose. The judge at S3 decides the hard cases; this stage
 * removes the ones no judgement is needed for, and every rule it applies is a
 * named reason in the funnel rather than a score. Two rules:
 *
 *   window   published outside the topic's window. search.list honours
 *            publishedAfter, but the trusted layer reads uploads playlists,
 *            which do not, so the boundary is enforced here for both.
 *   language a title in neither Korean nor English is a video this brief's
 *            readers cannot use, and the judge should not spend a batch slot
 *            deciding that.
 *
 * A trusted channel is exempt from nothing. Trust decides what enters the
 * corpus, not what survives it.
 */

import type { CorpusRow } from '../corpus';
import type { Stage, StageContext, StageResult } from '../stage';
import { MS_PER_DAY } from '@/utils/time-constants';

/**
 * Views per day since publication, so a video posted yesterday is not judged
 * against one posted six days ago.
 *
 * A flat view floor would do that. Inside a 7-day window the newest videos
 * have had the least time to be watched, and a weekly brief that
 * systematically drops the newest of the week has the wrong bias. The floor is
 * half a day so a video published minutes ago does not divide by nothing.
 */
function viewsPerDay(v: { viewCount: number | null; publishedAt: Date }, now: number): number {
  const days = Math.max((now - v.publishedAt.getTime()) / MS_PER_DAY, 0.5);
  return (v.viewCount ?? 0) / days;
}

/** Hangul, or Latin. Anything else is a third script. */
function titleScript(title: string): 'ko' | 'en' | 'other' {
  if (/[가-힣]/.test(title)) return 'ko';
  const latin = (title.match(/[A-Za-z]/g) ?? []).length;
  const cjkOrOther = (title.match(/[぀-ヿ一-鿿Ѐ-ӿ؀-ۿ]/g) ?? []).length;
  if (cjkOrOther > latin) return 'other';
  return latin > 0 ? 'en' : 'other';
}

export const s2Domain: Stage = {
  id: 'S2_domain',
  what: 'the topic window and the two languages this brief serves',
  kind: 'machine',

  async run(input: CorpusRow[], ctx: StageContext): Promise<StageResult> {
    const now = Date.now();
    const cutoff = new Date(now - ctx.topic.publishedWithinDays * MS_PER_DAY);
    const survivors: Array<{ videoId: string }> = [];
    const drops: Array<{ videoId: string; reason: string }> = [];
    const scripts: Record<string, number> = { ko: 0, en: 0, other: 0 };

    const kept: CorpusRow[] = [];
    for (const v of input) {
      if (v.publishedAt < cutoff) {
        drops.push({ videoId: v.videoId, reason: 'outside_topic_window' });
        continue;
      }
      const script = titleScript(v.title);
      scripts[script] = (scripts[script] ?? 0) + 1;
      if (script === 'other') {
        drops.push({ videoId: v.videoId, reason: 'title_not_ko_or_en' });
        continue;
      }
      kept.push(v);
    }

    // ---- selection ---------------------------------------------------------
    //
    // The harvest grew from 870 videos to 3,645 and the judge is a person. The
    // rules above remove what needs no judgement; these two remove what is not
    // worth spending judgement on, and they are here rather than inside S3
    // because S3's contract is that every candidate it sees gets a verdict.
    //
    // Measured on this week's 1,184 survivors before the rules were added:
    // the median video had 68 views, a quarter had 13 or fewer, and one
    // channel had pushed 47 videos into the pool with two more at 31 and 29.
    //
    //   reach        a week nobody watched is not the week this brief reports
    //   concentration  one channel's output is a channel profile, not a week
    //
    // A trusted channel is exempt from both: an editor already decided it
    // matters, and reach is exactly the thing a good new source lacks. That
    // exemption is why this is not a popularity filter — 72 of this week's
    // survivors enter on an editor's judgement rather than on their numbers.
    const select = ctx.topic.select;
    if (select) {
      const perChannel = new Map<string, number>();
      const byReach = [...kept].sort((a, b) => viewsPerDay(b, now) - viewsPerDay(a, now));
      const admitted = new Set<string>();

      for (const v of byReach) {
        if (v.source === 'trusted') {
          admitted.add(v.videoId);
          continue;
        }
        if (select.minViewsPerDay !== undefined && viewsPerDay(v, now) < select.minViewsPerDay) {
          drops.push({ videoId: v.videoId, reason: 'below_reach_floor' });
          continue;
        }
        if (select.maxPerChannel !== undefined) {
          const n = (perChannel.get(v.channelId) ?? 0) + 1;
          if (n > select.maxPerChannel) {
            drops.push({ videoId: v.videoId, reason: 'channel_quota' });
            continue;
          }
          perChannel.set(v.channelId, n);
        }
        admitted.add(v.videoId);
      }
      for (const v of kept) if (admitted.has(v.videoId)) survivors.push({ videoId: v.videoId });
    } else {
      for (const v of kept) survivors.push({ videoId: v.videoId });
    }

    return {
      survivors,
      drops,
      detail: {
        windowDays: ctx.topic.publishedWithinDays,
        cutoff: cutoff.toISOString(),
        titleScripts: scripts,
        select: select ?? null,
        passedDomain: kept.length,
        trustedAdmitted: kept.filter((v) => v.source === 'trusted').length,
      },
    };
  },
};
