/**
 * IssueDocument -- the SSOT for one published brief.
 *
 * One document, three renders (mail / web / note). Content is written once;
 * only presentation differs per surface. This file is the contract between
 * whoever writes an issue and every template that draws it.
 *
 * Two versions, deliberately separate:
 *   schemaVersion    what kinds of content exist. Changes rarely.
 *   templateVersion  what it looks like. Changes whenever design improves.
 *
 * The split is what makes a design improvement cheap: bumping templateVersion
 * re-skins every past issue, because the HTML is rendered on read rather than
 * baked at publish time.
 *
 * Counts vary week to week -- 4 to 8 stages, dozens to hundreds of claims --
 * so nothing here is fixed-length and no template may assume a count.
 */

import { z } from 'zod';

/** Three tiers, matching the fact-check discipline the brief is sold on. */
export const GradeSchema = z.enum(['verified', 'observed', 'unconfirmed']);
export type Grade = z.infer<typeof GradeSchema>;

/** 1-based index into `refs`. Rendered as a superscript beside a claim. */
const RefIndex = z.number().int().positive();

/**
 * A body block inside a story. `note` is the editor callout; `warn` is its
 * one variant. Deliberately few: the design fixed six components, and a
 * seventh block type here would smuggle a seventh component into the page.
 */
export const BlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('p'), html: z.string().min(1) }),
  z.object({ type: z.literal('lede'), html: z.string().min(1) }),
  z.object({ type: z.literal('h3'), text: z.string().min(1) }),
  z.object({
    type: z.literal('note'),
    lead: z.string().min(1),
    html: z.string().min(1),
    variant: z.enum(['plain', 'warn']).default('plain'),
  }),
  z.object({
    type: z.literal('table'),
    figref: z.string().optional(),
    head: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string()).min(1)).min(1),
  }),
]);
export type Block = z.infer<typeof BlockSchema>;

export const LedgerRowSchema = z.object({
  name: z.string().min(1),
  grade: GradeSchema,
  ref: RefIndex.optional(),
  /** Why this number is on the ledger at all -- what changes if it moves. */
  desc: z.string().min(1),
  value: z.string().min(1),
  /** Colour emphasis. Semantic, not decorative: `up` = rose, `hot` = watch. */
  emphasis: z.enum(['none', 'up', 'hot']).default('none'),
  sub: z.string().optional(),
});

export const FunnelBucketSchema = z.object({
  key: z.enum(['form', 'rule', 'solo', 'cross']),
  count: z.number().int().nonnegative(),
  label: z.string().min(1),
});

export const StorySchema = z.object({
  kicker: z.string().min(1),
  title: z.string().min(1),
  blocks: z.array(BlockSchema).min(1),
});

export const TermSchema = z.object({
  word: z.string().min(1),
  en: z.string().optional(),
  body: z.string().min(1),
  /** A sentence the reader can say out loud in a meeting. */
  use: z.string().min(1),
});

export const PickSchema = z.object({
  title: z.string().min(1),
  /** Set when the title is Latin-script, so the template can serif it. */
  latin: z.boolean().default(false),
  meta: z.string().min(1),
  body: z.string().min(1),
  videoId: z.string().optional(),
});

/** Used by both the action list and the next-issue checkpoints. */
export const WhenItemSchema = z.object({
  when: z.string().min(1),
  title: z.string().min(1),
});

export const RefSchema = z.object({
  label: z.string().min(1),
  sources: z.array(z.object({ name: z.string().min(1), url: z.string().url().optional() })).min(1),
});

/**
 * The mail digest is its own editorial object, not a summary of `stories`.
 * Its lines state what stopped being true ("무료 기간이 끝나면 다시 못 잽니다"),
 * which is a different job from a story headline and cannot be derived from
 * one. Optional so an issue can exist before its digest is written.
 */
export const MailDigestSchema = z.object({
  items: z.array(z.object({ title: z.string().min(1), deck: z.string().min(1) })).min(1),
  stats: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).min(1),
  method: z.string().min(1),
  readMeta: z.string().min(1),
});

export const IssueDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  templateVersion: z.string().min(1).default('web-v1'),

  slug: z.string().regex(/^[a-z0-9-]+$/),
  category: z.string().min(1),
  categoryKey: z.string().min(1),
  issueLabel: z.string().min(1),
  dateLabel: z.string().min(1),
  publishedAt: z.string().datetime(),

  /** Split across lines exactly as the masthead should break it. */
  headline: z.array(z.string().min(1)).min(1),
  dek: z.string().min(1),
  runline: z.string().min(1),
  /** Inbox preview text. Shared with the mail render. */
  preview: z.string().min(1),

  interest: z.object({
    intro: z.string().min(1),
    ledgerCaption: z.string().min(1),
    ledger: z.array(LedgerRowSchema).min(1),
    funnel: z
      .object({
        figref: z.string().min(1),
        /** Videos represented by one cell. Keeps the grid legible as counts grow. */
        perCell: z.number().int().positive(),
        buckets: z.array(FunnelBucketSchema).min(1),
        caption: z.string().min(1),
      })
      .optional(),
  }),

  stories: z.array(StorySchema).min(1),

  insight: z.object({
    blocks: z.array(BlockSchema).min(1),
    actions: z.array(WhenItemSchema).default([]),
  }),

  vocabulary: z.array(TermSchema).default([]),
  picks: z.array(PickSchema).default([]),

  next: z.object({
    intro: z.string().min(1),
    checkpoints: z.array(WhenItemSchema).min(1),
  }),

  mail: MailDigestSchema.optional(),
  refs: z.array(RefSchema).default([]),
  gradeNote: z.string().min(1),
  editNote: z.string().min(1),
  sign: z.string().min(1),
});

export type IssueDocument = z.infer<typeof IssueDocumentSchema>;
export type LedgerRow = z.infer<typeof LedgerRowSchema>;
export type Story = z.infer<typeof StorySchema>;
export type Term = z.infer<typeof TermSchema>;
export type Pick = z.infer<typeof PickSchema>;
export type WhenItem = z.infer<typeof WhenItemSchema>;
export type Ref = z.infer<typeof RefSchema>;
export type MailDigest = z.infer<typeof MailDigestSchema>;

/**
 * Every claim carrying a grade must also carry a source, except where the
 * grade is `unconfirmed` -- that grade is itself the statement that no source
 * held up. Enforced here rather than in review because the launch issue
 * shipped 확인 badges on three figures that were never verified.
 */
export function findUngroundedClaims(doc: IssueDocument): string[] {
  const bad: string[] = [];
  for (const row of doc.interest.ledger) {
    if (row.grade !== 'unconfirmed' && row.ref === undefined) {
      bad.push(`ledger row "${row.name}" is graded ${row.grade} with no ref`);
    }
    if (row.ref !== undefined && row.ref > doc.refs.length) {
      bad.push(`ledger row "${row.name}" cites ref ${row.ref}; only ${doc.refs.length} exist`);
    }
  }
  return bad;
}
