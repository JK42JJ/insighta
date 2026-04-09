/**
 * Tiptap JSON validation schema (zod).
 *
 * Scope: Phase 1-4 MVP. Only the extensions we enable on the frontend are allowed:
 *   StarterKit (doc, paragraph, text, heading, bulletList, orderedList, listItem,
 *               blockquote, bold, italic, code, hardBreak, horizontalRule)
 *   Placeholder (no node type — attributes only)
 *   Link (mark)
 *   CodeBlockLowlight (codeBlock node)
 *
 * We deliberately validate structurally rather than reconstructing the full
 * ProseMirror schema so that minor version bumps of Tiptap don't break the API.
 */
import { z } from 'zod';

// Permissive "any JSON value" used for unknown attrs.
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ])
);

/** Node/mark name whitelist — MVP scope only. */
export const ALLOWED_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
]);

export const ALLOWED_MARK_TYPES = new Set([
  'bold',
  'italic',
  'code',
  'link',
  'strike', // StarterKit includes this
]);

// Base recursive node schema.
interface TiptapNodeShape {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNodeShape[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export const tiptapMarkSchema = z.object({
  type: z.string(),
  attrs: z.record(jsonValueSchema).optional(),
});

export const tiptapNodeSchema: z.ZodType<TiptapNodeShape> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: z.record(jsonValueSchema).optional(),
    content: z.array(tiptapNodeSchema).optional(),
    marks: z.array(tiptapMarkSchema).optional(),
    text: z.string().optional(),
  })
);

/** Top-level Tiptap document. Must be `type: "doc"`. */
export const tiptapDocSchema = tiptapNodeSchema.refine((node) => node.type === 'doc', {
  message: 'Top-level node must be type="doc"',
});

export type TiptapNode = TiptapNodeShape;
export type TiptapDoc = TiptapNodeShape & { type: 'doc' };

/**
 * Validates node/mark type whitelist recursively.
 * Unknown types return a list of violations (one per unknown).
 */
export function findDisallowedTypes(doc: TiptapNode): string[] {
  const violations: string[] = [];
  const walk = (node: TiptapNode): void => {
    if (!ALLOWED_NODE_TYPES.has(node.type)) {
      violations.push(`node:${node.type}`);
    }
    if (node.marks) {
      for (const mark of node.marks) {
        if (!ALLOWED_MARK_TYPES.has(mark.type)) {
          violations.push(`mark:${mark.type}`);
        }
      }
    }
    if (node.content) {
      for (const child of node.content) walk(child);
    }
  };
  walk(doc);
  return violations;
}
