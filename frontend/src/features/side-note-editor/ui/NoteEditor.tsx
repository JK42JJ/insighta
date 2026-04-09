/**
 * Main editor component. Wires Tiptap + BubbleMenu toolbar.
 * Calls `onDocChange` on every update so the parent can run auto-save.
 */
import { useEffect, useRef } from 'react';
import { BubbleMenu, EditorContent } from '@tiptap/react';
import { useNoteEditor } from '../model/useNoteEditor';
import type { TiptapDoc } from '../lib/note-parser';
import { EditorToolbar } from './EditorToolbar';

export interface NoteEditorProps {
  /** Tiptap JSON doc, plain text string, or null. Strings are wrapped into a paragraph. */
  initialContent: TiptapDoc | string | null;
  onDocChange: (doc: TiptapDoc) => void;
}

export function NoteEditor({ initialContent, onDocChange }: NoteEditorProps) {
  const onChangeRef = useRef(onDocChange);
  useEffect(() => {
    onChangeRef.current = onDocChange;
  }, [onDocChange]);

  const editor = useNoteEditor({
    initialContent,
    onUpdate: (doc) => onChangeRef.current(doc),
  });

  // Auto-focus the editor when it mounts so the user can type immediately.
  useEffect(() => {
    if (editor && !editor.isFocused) {
      // Small delay so the Sheet slide-in animation finishes first.
      const timer = setTimeout(() => editor.commands.focus('end'), 200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [editor]);

  if (!editor) {
    return <div className="text-xs text-muted-foreground">에디터를 불러오는 중…</div>;
  }

  return (
    <div className="side-note-editor flex flex-1 flex-col">
      <BubbleMenu editor={editor} tippyOptions={{ duration: 150 }}>
        <EditorToolbar editor={editor} />
      </BubbleMenu>
      <EditorContent
        editor={editor}
        className={[
          'max-w-none flex-1',
          // Notion-style: borderless, generous spacing, clean typography
          '[&_.ProseMirror]:min-h-[300px] [&_.ProseMirror]:outline-none [&_.ProseMirror]:leading-relaxed',
          // Headings — clean hierarchy
          '[&_.ProseMirror_h1]:text-xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:tracking-tight [&_.ProseMirror_h1]:mt-6 [&_.ProseMirror_h1]:mb-2',
          '[&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:tracking-tight [&_.ProseMirror_h2]:mt-5 [&_.ProseMirror_h2]:mb-1.5',
          '[&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:mt-4 [&_.ProseMirror_h3]:mb-1',
          // Paragraphs
          '[&_.ProseMirror_p]:text-sm [&_.ProseMirror_p]:text-foreground/80 [&_.ProseMirror_p]:my-1.5',
          // Lists — subtle indent, compact
          '[&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ul]:my-1 [&_.ProseMirror_ul]:text-sm',
          '[&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ol]:my-1 [&_.ProseMirror_ol]:text-sm',
          '[&_.ProseMirror_li]:my-0.5 [&_.ProseMirror_li]:text-foreground/80',
          '[&_.ProseMirror_li_p]:my-0',
          // Inline code — subtle pill
          '[&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-muted [&_.ProseMirror_code]:px-1.5 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:text-xs [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-primary/80',
          // Code block — clean dark bg
          '[&_.ProseMirror_pre]:rounded-lg [&_.ProseMirror_pre]:bg-muted/60 [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_pre]:my-3 [&_.ProseMirror_pre]:text-xs [&_.ProseMirror_pre]:font-mono [&_.ProseMirror_pre]:leading-relaxed [&_.ProseMirror_pre]:overflow-x-auto',
          '[&_.ProseMirror_pre_code]:bg-transparent [&_.ProseMirror_pre_code]:p-0 [&_.ProseMirror_pre_code]:rounded-none',
          // Blockquote — Notion-style left border
          '[&_.ProseMirror_blockquote]:border-l-[3px] [&_.ProseMirror_blockquote]:border-foreground/20 [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:my-3 [&_.ProseMirror_blockquote]:text-foreground/60',
          // Links
          '[&_.ProseMirror_a]:text-primary [&_.ProseMirror_a]:underline [&_.ProseMirror_a]:underline-offset-2 [&_.ProseMirror_a]:decoration-primary/40',
          // Horizontal rule
          '[&_.ProseMirror_hr]:my-6 [&_.ProseMirror_hr]:border-border/30',
          // Placeholder
          '[&_.ProseMirror_.is-editor-empty:first-child::before]:text-muted-foreground/40 [&_.ProseMirror_.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_.is-editor-empty:first-child::before]:pointer-events-none',
        ].join(' ')}
      />
    </div>
  );
}
