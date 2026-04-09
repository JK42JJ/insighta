/**
 * Unit tests for tiptap-text-extract
 */
import { extractPlainText, isEmptyDoc } from '../../../src/modules/notes/tiptap-text-extract';
import type { TiptapNode } from '../../../src/modules/notes/tiptap-schema';

describe('extractPlainText', () => {
  it('returns empty string for null/undefined', () => {
    expect(extractPlainText(null)).toBe('');
    expect(extractPlainText(undefined)).toBe('');
  });

  it('extracts text from a single paragraph', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] },
      ],
    };
    expect(extractPlainText(doc)).toBe('hello world');
  });

  it('joins multiple block nodes with newlines', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: '제목' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
      ],
    };
    const result = extractPlainText(doc);
    expect(result).toContain('제목');
    expect(result).toContain('본문');
    expect(result).toMatch(/제목\n+본문/);
  });

  it('collects bullet list items', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
              ],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
              ],
            },
          ],
        },
      ],
    };
    expect(extractPlainText(doc)).toContain('one');
    expect(extractPlainText(doc)).toContain('two');
  });

  it('collapses 3+ consecutive newlines to 2', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'end' }] },
      ],
    };
    expect(extractPlainText(doc)).not.toMatch(/\n{3,}/);
  });

  it('handles hardBreak as newline', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'line1' },
            { type: 'hardBreak' },
            { type: 'text', text: 'line2' },
          ],
        },
      ],
    };
    expect(extractPlainText(doc)).toContain('line1');
    expect(extractPlainText(doc)).toContain('line2');
  });
});

describe('isEmptyDoc', () => {
  it('returns true for null', () => {
    expect(isEmptyDoc(null)).toBe(true);
  });

  it('returns true for undefined', () => {
    expect(isEmptyDoc(undefined)).toBe(true);
  });

  it('returns true for doc with a single empty paragraph', () => {
    expect(
      isEmptyDoc({
        type: 'doc',
        content: [{ type: 'paragraph' }],
      }),
    ).toBe(true);
  });

  it('returns false for doc with text content', () => {
    expect(
      isEmptyDoc({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
        ],
      }),
    ).toBe(false);
  });

  it('returns true for doc whose only content is whitespace (trimmed)', () => {
    expect(
      isEmptyDoc({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
        ],
      }),
    ).toBe(true);
  });
});
