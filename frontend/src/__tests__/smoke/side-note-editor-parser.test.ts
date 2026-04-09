/**
 * Unit tests for features/side-note-editor/lib/note-parser.ts
 */
import { describe, it, expect } from 'vitest';
import {
  parseRichNote,
  wrapLegacyPlainText,
  extractPlainText,
  isEmptyDoc,
  EMPTY_DOC,
  type TiptapDoc,
} from '@/features/side-note-editor/lib/note-parser';

describe('parseRichNote', () => {
  it('returns null for null/undefined', () => {
    expect(parseRichNote(null)).toBeNull();
    expect(parseRichNote(undefined)).toBeNull();
  });

  it('returns a TiptapDoc as-is', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    };
    expect(parseRichNote(doc)).toBe(doc);
  });

  it('wraps a legacy plain-text string into a paragraph doc', () => {
    const result = parseRichNote('hello world');
    expect(result).toEqual(wrapLegacyPlainText('hello world'));
  });

  it('round-trips a stringified Tiptap doc', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
    };
    const result = parseRichNote(JSON.stringify(doc));
    expect(result).toEqual(doc);
  });

  it('falls back to legacy wrap when JSON is malformed', () => {
    const result = parseRichNote('{broken');
    expect(result).toEqual(wrapLegacyPlainText('{broken'));
  });

  it('returns null for empty/whitespace strings', () => {
    expect(parseRichNote('')).toBeNull();
    expect(parseRichNote('   ')).toBeNull();
  });
});

describe('extractPlainText', () => {
  it('returns empty string for null', () => {
    expect(extractPlainText(null)).toBe('');
  });

  it('extracts text from multiple blocks', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
      ],
    };
    const result = extractPlainText(doc);
    expect(result).toContain('title');
    expect(result).toContain('body');
  });
});

describe('isEmptyDoc', () => {
  it('treats EMPTY_DOC as empty', () => {
    expect(isEmptyDoc(EMPTY_DOC)).toBe(true);
  });

  it('treats doc with text as non-empty', () => {
    expect(
      isEmptyDoc({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
      }),
    ).toBe(false);
  });
});
