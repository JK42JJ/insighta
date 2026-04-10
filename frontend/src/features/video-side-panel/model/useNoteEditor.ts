/**
 * Tiptap editor hook with the MVP extension set.
 *
 * Extensions:
 *   StarterKit (doc, paragraph, text, heading, lists, bold/italic/code, etc.)
 *   Placeholder
 *   Link (autolink, no open-on-click)
 *   CodeBlockLowlight (with lowlight)
 *   TimestampPlugin (YouTube timestamp links → clickable pills with seekTo)
 *
 * Deferred to Phase 2: Image, @tiptap/extension-youtube.
 */
import { useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { useMemo } from 'react';
import { parseRichNote, type TiptapDoc } from '../lib/note-parser';
import { EDITOR_PLACEHOLDER_FALLBACK } from '../config';
import { TimestampPlugin } from '../lib/timestamp-node';

const lowlight = createLowlight(common);

export interface UseNoteEditorOptions {
  /** Initial Tiptap JSON, plain text string, or null/undefined → empty editor. */
  initialContent: TiptapDoc | string | null;
  /** Called on every editor update (content change). */
  onUpdate?: (doc: TiptapDoc) => void;
  /** Disable editing entirely (e.g., while the initial GET is loading). */
  editable?: boolean;
  /** Called when a timestamp pill is clicked (seconds). */
  onTimestampClick?: (seconds: number) => void;
  /** Placeholder text (i18n resolved by caller). */
  placeholder?: string;
}

export function useNoteEditor({
  initialContent,
  onUpdate,
  editable = true,
  onTimestampClick,
  placeholder = EDITOR_PLACEHOLDER_FALLBACK,
}: UseNoteEditorOptions): Editor | null {
  // Memoize extensions so Tiptap doesn't reinitialize on every render.
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false, // replaced by CodeBlockLowlight below
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: true, autolink: true }),
      CodeBlockLowlight.configure({ lowlight }),
      TimestampPlugin.configure({ onSeek: onTimestampClick }),
    ],
    // onTimestampClick is a stable callback from useCallback in VideoSidePanel
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onTimestampClick, placeholder]
  );

  return useEditor({
    extensions,
    content: parseRichNote(initialContent) ?? '',
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (!onUpdate) return;
      onUpdate(editor.getJSON() as TiptapDoc);
    },
  });
}
