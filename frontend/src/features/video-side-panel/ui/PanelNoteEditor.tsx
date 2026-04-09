/**
 * Tiptap editor adapted for the video side panel.
 * Reuses useNoteEditor hook and EditorToolbar from side-note-editor.
 *
 * Styled per insighta-side-editor-mockup-v3.html design tokens:
 *   - 14px body, line-height 1.72
 *   - h2: 16px/700, h3: 13px/700
 *   - code: JetBrains Mono 12px, bg rgba(255,255,255,0.05), color indigo
 *   - pre: bg rgba(0,0,0,0.3), rounded 8px
 *   - blockquote: 2px left border indigo/20
 */
import { useEffect, useRef } from 'react';
import { BubbleMenu, EditorContent } from '@tiptap/react';
import { useNoteEditor } from '../model/useNoteEditor';
import type { TiptapDoc } from '../lib/note-parser';
import { EditorToolbar } from './EditorToolbar';

/** Delay before auto-focus — lets the slide animation settle. */
const FOCUS_DELAY_MS = 200;

export interface PanelNoteEditorProps {
  /** Tiptap JSON doc, plain text string, or null. */
  initialContent: TiptapDoc | string | null;
  /** Called on every content change. */
  onDocChange: (doc: TiptapDoc) => void;
}

export function PanelNoteEditor({ initialContent, onDocChange }: PanelNoteEditorProps) {
  const onChangeRef = useRef(onDocChange);
  useEffect(() => {
    onChangeRef.current = onDocChange;
  }, [onDocChange]);

  const editor = useNoteEditor({
    initialContent,
    onUpdate: (doc) => onChangeRef.current(doc),
  });

  // Auto-focus after slide animation.
  useEffect(() => {
    if (editor && !editor.isFocused) {
      const timer = setTimeout(() => editor.commands.focus('end'), FOCUS_DELAY_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [editor]);

  if (!editor) {
    return <div className="text-xs text-[#4e4f5c]">에디터를 불러오는 중...</div>;
  }

  return (
    <div className="panel-note-editor flex flex-1 flex-col">
      <BubbleMenu editor={editor} tippyOptions={{ duration: 150 }}>
        <EditorToolbar editor={editor} />
      </BubbleMenu>
      <EditorContent
        editor={editor}
        className={[
          'max-w-none flex-1',
          // Root: no outline, no border, caret indigo
          '[&_.ProseMirror]:min-h-[200px] [&_.ProseMirror]:outline-none [&_.ProseMirror]:ring-0 [&_.ProseMirror]:ring-offset-0 [&_.ProseMirror]:caret-[#818cf8]',
          // Body text: 14px, line-height 1.72, slight transparency
          '[&_.ProseMirror]:text-[14px] [&_.ProseMirror]:leading-[1.72] [&_.ProseMirror]:text-[rgba(237,237,240,0.88)]',
          // Headings
          '[&_.ProseMirror_h2]:text-[16px] [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:tracking-[-0.2px] [&_.ProseMirror_h2]:mt-[22px] [&_.ProseMirror_h2]:mb-1 [&_.ProseMirror_h2]:text-[#ededf0]',
          '[&_.ProseMirror_h2:first-child]:mt-0',
          '[&_.ProseMirror_h3]:text-[13px] [&_.ProseMirror_h3]:font-bold [&_.ProseMirror_h3]:mt-4 [&_.ProseMirror_h3]:mb-[3px] [&_.ProseMirror_h3]:text-[#ededf0]',
          // Paragraphs
          '[&_.ProseMirror_p]:mb-[5px]',
          // Lists
          '[&_.ProseMirror_ul]:mb-[5px] [&_.ProseMirror_ul]:pl-[18px]',
          '[&_.ProseMirror_ol]:mb-[5px] [&_.ProseMirror_ol]:pl-[18px]',
          '[&_.ProseMirror_li]:mb-[2px]',
          '[&_.ProseMirror_li::marker]:text-[#353642]',
          '[&_.ProseMirror_li_p]:my-0',
          // Inline code — JetBrains Mono 12px
          "[&_.ProseMirror_code]:font-['JetBrains_Mono',monospace] [&_.ProseMirror_code]:text-[12px]",
          '[&_.ProseMirror_code]:rounded-[4px] [&_.ProseMirror_code]:bg-[rgba(255,255,255,0.05)] [&_.ProseMirror_code]:px-[5px] [&_.ProseMirror_code]:py-px [&_.ProseMirror_code]:text-[#818cf8]',
          // Code block
          '[&_.ProseMirror_pre]:my-2 [&_.ProseMirror_pre]:rounded-lg [&_.ProseMirror_pre]:bg-[rgba(0,0,0,0.3)] [&_.ProseMirror_pre]:px-3 [&_.ProseMirror_pre]:py-2.5 [&_.ProseMirror_pre]:overflow-x-auto',
          "[&_.ProseMirror_pre_code]:bg-transparent [&_.ProseMirror_pre_code]:p-0 [&_.ProseMirror_pre_code]:text-[12px] [&_.ProseMirror_pre_code]:leading-[1.55] [&_.ProseMirror_pre_code]:text-[#9394a0] [&_.ProseMirror_pre_code]:font-['JetBrains_Mono',monospace]",
          // Blockquote
          '[&_.ProseMirror_blockquote]:my-2 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-[rgba(129,140,248,0.2)] [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:py-[5px] [&_.ProseMirror_blockquote]:text-[13px] [&_.ProseMirror_blockquote]:italic [&_.ProseMirror_blockquote]:text-[#9394a0]',
          // Links
          '[&_.ProseMirror_a]:text-[#818cf8] [&_.ProseMirror_a]:underline [&_.ProseMirror_a]:underline-offset-2 [&_.ProseMirror_a]:decoration-[rgba(129,140,248,0.4)]',
          // Placeholder
          '[&_.ProseMirror_.is-editor-empty:first-child::before]:text-[#353642] [&_.ProseMirror_.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_.is-editor-empty:first-child::before]:pointer-events-none',
        ].join(' ')}
      />
    </div>
  );
}
