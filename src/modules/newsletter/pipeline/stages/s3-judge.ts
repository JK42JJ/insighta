/**
 * S3 — the only stage that needs judgement.
 *
 * Three independent axes, because collapsing them loses the distinction that
 * matters: a video can be perfectly safe and still not be a study subject, and
 * both of those are different from being outside this brief's boundary. Issue
 * 1's own funnel records dropping stock and property videos, which is the
 * third axis failing, not the first.
 *
 * Whoever judges is recorded on every row. `verdict.judge` is 'openrouter' or
 * 'console', with the provenance beside it — the model id, or the path of the
 * file the verdicts were written in. A page that says how it was judged reads
 * that field; it does not assume.
 *
 * Failure policy, inherited from `curation/topic-judge` after a partial batch
 * was once read as "everything passed": a candidate with no verdict stops the
 * stage. It is not a rejection and it is not a pass.
 */

import type { CorpusRow } from '../corpus';
import type { Stage, StageContext, StageResult } from '../stage';
import type { JudgeCandidate } from '../judge/types';

export const s3Judge: Stage = {
  id: 'S3_judge',
  what: 'safe, learnable, in scope — judged and recorded per row',
  kind: 'model',

  async run(input: CorpusRow[], ctx: StageContext): Promise<StageResult> {
    if (input.length === 0) {
      return { survivors: [], drops: [], detail: { judge: ctx.judge.name, candidates: 0 } };
    }

    const candidates: JudgeCandidate[] = input.map((v) => ({
      videoId: v.videoId,
      title: v.title,
      channelTitle: v.channelTitle,
      source: v.source,
      publishedAt: v.publishedAt,
      durationSeconds: v.durationSeconds,
      viewCount: v.viewCount,
    }));

    const verdicts = await ctx.judge.judge(candidates);
    const byId = new Map(verdicts.map((v) => [v.videoId, v]));

    const survivors: Array<{ videoId: string; verdict: Record<string, unknown> }> = [];
    const drops: Array<{ videoId: string; reason: string; verdict: Record<string, unknown> }> = [];

    for (const v of input) {
      const verdict = byId.get(v.videoId);
      if (!verdict) {
        // The judge contract forbids this; both implementations throw first.
        // Kept as a hard stop rather than a default so a future judge cannot
        // quietly reintroduce "missing means approved".
        throw new Error(`S3: no verdict for ${v.videoId} — a judge must answer every candidate`);
      }

      const record = {
        judge: ctx.judge.name,
        provenance: ctx.judge.provenance,
        safe: verdict.safe,
        learnable: verdict.learnable,
        inScope: verdict.inScope,
        why: verdict.why,
        judgedAt: new Date().toISOString(),
      };

      // Ordered so the funnel names the first failing axis, which is what an
      // editor reading the drop reasons wants to know.
      // A dropped row carries its verdict as well, so the corpus answers
      // "why is this not here" and not only "why is this here".
      if (!verdict.safe) {
        drops.push({ videoId: v.videoId, reason: 'unsafe', verdict: record });
      } else if (!verdict.inScope) {
        drops.push({ videoId: v.videoId, reason: 'out_of_scope', verdict: record });
      } else if (!verdict.learnable) {
        drops.push({ videoId: v.videoId, reason: 'not_learnable', verdict: record });
      } else {
        survivors.push({ videoId: v.videoId, verdict: record });
      }
    }

    return {
      survivors,
      drops,
      detail: {
        judge: ctx.judge.name,
        provenance: ctx.judge.provenance,
        candidates: candidates.length,
      },
    };
  },
};
