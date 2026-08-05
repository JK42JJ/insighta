/**
 * note-emoji-strip — academic-quality guard. Locks that stripEmoji removes
 * emoji + cheap correct/incorrect markers (✅❌✓✗⚠️ + Extended_Pictographic)
 * while PRESERVING meaningful symbols (arrows → ← , math × · , typographic —),
 * and that sanitizeNoteDoc cleans EXISTING persisted docs' text nodes on load
 * without disturbing structure or node attrs.
 */
import { describe, it, expect } from 'vitest';
import { stripEmoji, parseMarkdownToTiptap } from '@/pages/learning/lib/markdown-to-tiptap';
import { sanitizeNoteDoc } from '@/pages/learning/lib/note-document-generator';
import type { TiptapDoc, TiptapNode } from '@/features/video-side-panel/lib/note-parser';

describe('stripEmoji', () => {
  it('strips correct/incorrect markers ✅❌✓✗ and warning ⚠️', () => {
    expect(stripEmoji('맞음✅ 틀림❌')).toBe('맞음 틀림');
    expect(stripEmoji('올바름✓ 잘못✗')).toBe('올바름 잘못');
    expect(stripEmoji('주의⚠️ 사항')).toBe('주의 사항');
    expect(stripEmoji('✔ ✘')).toBe('');
  });

  it('strips Extended_Pictographic emoji (🎉🔥😀)', () => {
    expect(stripEmoji('축하🎉합니다')).toBe('축하합니다');
    expect(stripEmoji('🔥😀 hot')).toBe('hot');
  });

  it('leading-marker cell → trimmed text, NOT a leading space', () => {
    expect(stripEmoji('❌ 현재완료 불가')).toBe('현재완료 불가');
    expect(stripEmoji('✅ 현재완료 가능')).toBe('현재완료 가능');
  });

  it('PRESERVES arrows, math, and typographic punctuation', () => {
    expect(stripEmoji('A → B ← C ↑ ↓')).toBe('A → B ← C ↑ ↓');
    expect(stripEmoji('3 × 4 ÷ 2 ± 1 =')).toBe('3 × 4 ÷ 2 ± 1 =');
    expect(stripEmoji('점 · 줄 — 말줄임 … “인용” ‘작은’')).toBe('점 · 줄 — 말줄임 … “인용” ‘작은’');
  });

  it('preserves the arrow in a correct→wrong example line', () => {
    expect(stripEmoji('❌ I HAVE SEEN HIM YESTERDAY → 틀림')).toBe(
      'I HAVE SEEN HIM YESTERDAY → 틀림'
    );
  });

  it('collapses double-spaces left by an inline marker', () => {
    expect(stripEmoji('a ✅ b')).toBe('a b');
  });

  it('leaves plain text untouched', () => {
    expect(stripEmoji('현재완료 불가')).toBe('현재완료 불가');
    expect(stripEmoji('')).toBe('');
  });
});

describe('parseMarkdownToTiptap — strips emoji from rendered text nodes', () => {
  const txt = (n: TiptapNode | undefined): string =>
    (n?.content ?? []).map((c) => c.text ?? '').join('');

  it('table cell "❌ 현재완료 불가" renders as clean inline text', () => {
    const md = ['| 형태 | 가능 |', '| --- | --- |', '| 현재완료 | ❌ 불가 |'].join('\n');
    const nodes = parseMarkdownToTiptap(md);
    const table = nodes.find((n) => n.type === 'table')!;
    const flat = JSON.stringify(table);
    expect(flat).not.toContain('❌');
    expect(flat).toContain('불가');
  });

  it('paragraph keeps the → arrow after stripping a leading ❌', () => {
    const [p] = parseMarkdownToTiptap('❌ I HAVE SEEN → 틀림');
    expect(txt(p)).toBe('I HAVE SEEN → 틀림');
  });
});

describe('sanitizeNoteDoc — cleans persisted text nodes, preserves structure/attrs', () => {
  it('strips emoji from text nodes while leaving node attrs (mermaid/latex) intact', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '✅ 현재완료 가능 → 맞음' }],
        },
        // Structural node: source attr carries an emoji-looking arrow but is NOT
        // a text node — must stay byte-for-byte (it is mermaid syntax, not prose).
        { type: 'mermaid', attrs: { source: 'flowchart LR\n A-->B ✅' } },
        {
          type: 'figureBlock',
          attrs: { kind: 'equation', latex: 'a \\times b ⚠️' },
        },
      ],
    } as TiptapDoc;

    const out = sanitizeNoteDoc(doc);
    const para = out.content[0] as TiptapNode;
    expect(para.content?.[0]?.text).toBe('현재완료 가능 → 맞음');

    const mermaid = out.content[1] as TiptapNode;
    expect(mermaid.attrs?.source).toBe('flowchart LR\n A-->B ✅'); // untouched

    const figure = out.content[2] as TiptapNode;
    expect(figure.attrs?.latex).toBe('a \\times b ⚠️'); // untouched
  });

  it('drops a text node that was ONLY an emoji (empty after strip)', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '✅' }] }],
    } as TiptapDoc;
    const out = sanitizeNoteDoc(doc);
    const para = out.content[0] as TiptapNode;
    expect(para.content).toEqual([]);
  });
});
