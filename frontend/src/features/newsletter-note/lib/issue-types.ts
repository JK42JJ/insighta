/**
 * The shape of a published issue, as the frontend sees it.
 *
 * Declared here rather than imported from the backend's zod schema: the
 * frontend does not build issues, it renders one the API already validated,
 * and importing the schema would pull zod and the server's module graph into
 * the bundle to gain nothing. The API is the guard — an issue that fails
 * `IssueDocumentSchema` never reaches a reader.
 *
 * Kept structurally identical to `src/modules/newsletter/issue-schema.ts`.
 * A field added there and not here is invisible in the note rather than
 * broken, which is the failure mode to prefer.
 */

export type Grade = 'verified' | 'observed' | 'unconfirmed';

export type Block =
  | { type: 'p'; html: string }
  | { type: 'lede'; html: string }
  | { type: 'h3'; text: string }
  | { type: 'note'; lead: string; html: string; variant: 'plain' | 'warn' }
  | { type: 'table'; figref?: string; head: string[]; rows: string[][] };

export interface LedgerRow {
  name: string;
  grade: Grade;
  ref?: number;
  desc: string;
  value: string;
  emphasis: 'none' | 'up' | 'hot';
  sub?: string;
}

export interface Story {
  kicker: string;
  title: string;
  blocks: Block[];
}

export interface Term {
  word: string;
  en?: string;
  body: string;
  use: string;
}

export interface Pick {
  title: string;
  latin: boolean;
  meta: string;
  body: string;
  /** Optional in a draft; on a published issue the gate requires it. */
  videoId?: string;
}

export interface WhenItem {
  when: string;
  title: string;
}

export interface Ref {
  label: string;
  sources: Array<{ name: string; url?: string }>;
}

export interface IssueDocument {
  schemaVersion: 1;
  templateVersion: string;
  locale: 'ko' | 'en';
  slug: string;
  category: string;
  categoryKey: string;
  issueLabel: string;
  dateLabel: string;
  publishedAt: string;
  headline: string[];
  dek: string;
  runline: string;
  preview: string;
  interest: {
    intro: string;
    ledgerCaption: string;
    ledger: LedgerRow[];
    funnel?: {
      figref: string;
      perCell: number;
      buckets: Array<{ key: 'form' | 'rule' | 'solo' | 'cross'; count: number; label: string }>;
      caption: string;
    };
  };
  stories: Story[];
  insight: { blocks: Block[]; actions: WhenItem[] };
  vocabulary: Term[];
  picks: Pick[];
  next: { intro: string; checkpoints: WhenItem[] };
  refs: Ref[];
  gradeNote: string;
  editNote: string;
  sign: string;
}
