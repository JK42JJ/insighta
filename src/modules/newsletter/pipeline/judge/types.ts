/**
 * Who fills the LLM role.
 *
 * S3 is the only stage that needs a model, and the pipeline should not stop
 * because a provider is out of credits — that is precisely the state the rest
 * of today's work was about. So the role is an interface with more than one
 * filler:
 *
 *   openrouter   a model, in production
 *   console      an editor, judging in the console and recording the verdicts
 *
 * The console judge is not a stub. Its verdicts are written to a file, land in
 * `newsletter_corpus.verdict` with `judge: 'console'` on every row, and are
 * therefore as auditable as a model's — more so, because the reason is written
 * rather than sampled. What a page may claim about how it was judged comes
 * from that field, not from an assumption about which judge ran.
 */

export interface JudgeCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  /** 'trusted' means an editor already decided this channel matters. */
  source: 'trusted' | 'search';
  publishedAt: Date;
  durationSeconds: number | null;
  viewCount: number | null;
}

export interface JudgeVerdict {
  videoId: string;
  /** Nothing harmful, and nothing that is not a study subject. */
  safe: boolean;
  /** Teaches something a practitioner can act on. */
  learnable: boolean;
  /** Inside this brief's boundary — AI itself, not general programming. */
  inScope: boolean;
  /** Why, in the judge's words. Printed in the audit, never on the page. */
  why: string;
}

export interface TopicJudge {
  /** Recorded on every verdict so a page can say who judged it. */
  readonly name: 'openrouter' | 'console';
  /** What is answerable about this judge: model id, or the file of verdicts. */
  readonly provenance: string;
  judge(candidates: JudgeCandidate[]): Promise<JudgeVerdict[]>;
}

/** A judge that returns nothing for a candidate is a bug, not a rejection. */
export class JudgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeError';
  }
}
