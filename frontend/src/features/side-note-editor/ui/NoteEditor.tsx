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
  initialContent: TiptapDoc | null;
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

  if (!editor) {
    return <div className="text-xs text-muted-foreground">에디터를 불러오는 중…</div>;
  }

  return (
    <div className="flex flex-1 flex-col">
      <BubbleMenu editor={editor}>
        <EditorToolbar editor={editor} />
      </BubbleMenu>
      <EditorContent
        editor={editor}
        className="prose prose-sm dark:prose-invert min-h-[240px] max-w-none flex-1 focus:outline-none [&_.ProseMirror]:min-h-[240px] [&_.ProseMirror]:outline-none"
      />
    </div>
  );
}
