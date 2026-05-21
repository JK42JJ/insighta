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

import type { Editor } from '@tiptap/react';

let currentEditor: Editor | null = null;

export function setNoteEditorRef(editor: Editor | null): void {
  currentEditor = editor;
}

/**
 * Append plain text to the end of the note editor as a new paragraph.
 * Returns true when the insertion succeeded, false when no editor is
 * mounted. Forces the editor to editable mode for the insertion and
 * restores the prior editable state afterwards so the TipTap update
 * event fires and the existing 2-second auto-save debounce in
 * `useNoteDocument` picks the change up.
 */
export function appendToNote(text: string): boolean {
  const editor = currentEditor;
  if (!editor) return false;
  const wasEditable = editor.isEditable;
  if (!wasEditable) editor.setEditable(true);
  try {
    editor.commands.focus('end');
    editor.commands.insertContent([{ type: 'paragraph', content: [{ type: 'text', text }] }]);
  } finally {
    if (!wasEditable) editor.setEditable(false);
  }
  return true;
}
