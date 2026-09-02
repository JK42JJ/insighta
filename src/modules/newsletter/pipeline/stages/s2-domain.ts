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

const DAY_MS = 24 * 60 * 60 * 1000;

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
    const cutoff = new Date(Date.now() - ctx.topic.publishedWithinDays * DAY_MS);
    const survivors: Array<{ videoId: string }> = [];
    const drops: Array<{ videoId: string; reason: string }> = [];
    const scripts: Record<string, number> = { ko: 0, en: 0, other: 0 };

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
      survivors.push({ videoId: v.videoId });
    }

    return {
      survivors,
      drops,
      detail: {
        windowDays: ctx.topic.publishedWithinDays,
        cutoff: cutoff.toISOString(),
        titleScripts: scripts,
      },
    };
  },
};
