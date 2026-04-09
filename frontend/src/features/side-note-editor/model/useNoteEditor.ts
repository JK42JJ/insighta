/**
 * Tiptap editor hook with the MVP extension set.
 *
 * Extensions (Phase 1-4):
 *   StarterKit (doc, paragraph, text, heading, lists, bold/italic/code, etc.)
 *   Placeholder
 *   Link (autolink, no open-on-click)
 *   CodeBlockLowlight (with lowlight)
 *
 * Deferred to Phase 2: TimestampNode, Image, @tiptap/extension-youtube.
 */
import { useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { useMemo } from 'react';
import type { TiptapDoc } from '../lib/note-parser';
import { EDITOR_PLACEHOLDER } from '../config';

const lowlight = createLowlight(common);

export interface UseNoteEditorOptions {
  /** Initial Tiptap JSON, plain text string, or null/undefined → empty editor. */
  initialContent: TiptapDoc | string | null;
  /** Called on every editor update (content change). */
  onUpdate?: (doc: TiptapDoc) => void;
  /** Disable editing entirely (e.g., while the initial GET is loading). */
  editable?: boolean;
}

export function useNoteEditor({
  initialContent,
  onUpdate,
  editable = true,
}: UseNoteEditorOptions): Editor | null {
  // Memoize extensions so Tiptap doesn't reinitialize on every render.
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false, // replaced by CodeBlockLowlight below
      }),
      Placeholder.configure({ placeholder: EDITOR_PLACEHOLDER }),
      Link.configure({ openOnClick: false, autolink: true }),
      CodeBlockLowlight.configure({ lowlight }),
    ],
    []
  );

  return useEditor({
    extensions,
    content: initialContent ?? '',
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (!onUpdate) return;
      onUpdate(editor.getJSON() as TiptapDoc);
    },
  });
}
