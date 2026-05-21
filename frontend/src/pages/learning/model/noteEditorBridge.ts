/**
 * Module-level bridge that exposes the TipTap note editor instance to
 * code outside the note-mode component tree — primarily ChatAssistant's
 * "메모에 추가" button click handler.
 *
 * Pattern mirrors CP480 `dndHandlersRef` (module-level ref) to avoid
 * stale closures and prop drilling through CopilotKit Provider.
 *
 * Lifecycle:
 *   - `useNoteDocument` calls `setNoteEditorRef(editor)` on editor change.
 *   - Component unmount clears the ref via `setNoteEditorRef(null)`.
 *   - Consumers call `appendToNote(text)` which is a no-op when no editor
 *     is mounted (e.g., user has not opened the notes tab yet).
 */

import type { Editor, JSONContent } from '@tiptap/react';
import { parseTimestamps } from '@/pages/learning/lib/parse-timestamps';

let currentEditor: Editor | null = null;

export function setNoteEditorRef(editor: Editor | null): void {
  currentEditor = editor;
}

/**
 * Append text to the end of the note editor as a new paragraph.
 *
 * When `videoId` is provided, timestamps inside the text (e.g. `5:10`,
 * `7:00-8:30`, `380초`) are converted to clickable YouTube link marks
 * pointing at `https://www.youtube.com/watch?v=<videoId>&t=<seconds>s`.
 * This matches the chatbot bubble's click-to-seek affordance so users
 * never lose the link when moving content into the note.
 *
 * Without `videoId`, the text is inserted as a single plain-text node
 * (legacy CP477+9 behaviour).
 *
 * Returns `true` when the editor is mounted; `false` when no editor has
 * registered yet (e.g. user hasn't opened the notes tab in this session).
 * Forces editable mode for the insertion and restores the prior editable
 * state so the TipTap update event fires and the existing 2-second
 * auto-save debounce picks the change up.
 */
export function appendToNote(text: string, videoId?: string): boolean {
  const editor = currentEditor;
  if (!editor) return false;
  const wasEditable = editor.isEditable;
  if (!wasEditable) editor.setEditable(true);
  try {
    editor.commands.focus('end');
    editor.commands.insertContent(buildContentNodes(text, videoId));
  } finally {
    if (!wasEditable) editor.setEditable(false);
  }
  return true;
}

function buildContentNodes(text: string, videoId: string | undefined): JSONContent[] {
  if (!videoId) {
    return [{ type: 'paragraph', content: [{ type: 'text', text }] }];
  }
  const segments = parseTimestamps(text);
  if (segments.length === 0) {
    return [{ type: 'paragraph', content: [{ type: 'text', text }] }];
  }
  const inline: JSONContent[] = segments.map((seg) => {
    if (seg.type === 'timestamp') {
      return {
        type: 'text',
        text: seg.label,
        marks: [
          {
            type: 'link',
            attrs: {
              href: `https://www.youtube.com/watch?v=${videoId}&t=${seg.seconds}s`,
            },
          },
        ],
      };
    }
    return { type: 'text', text: seg.value };
  });
  return [{ type: 'paragraph', content: inline }];
}
