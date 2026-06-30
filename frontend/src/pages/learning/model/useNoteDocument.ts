/**
 * useNoteDocument — CP445 (2026-05-08).
 *
 * Drives the note-mode TipTap editor for a mandala. Concerns:
 *   - Fetch existing note_documents row (404 → build from mandala_books).
 *   - Lazy first-create (D1=B / Q4=A) — POST original_json + content_json
 *     equal to the freshly-built initial doc.
 *   - Mount a TipTap Editor instance (StarterKit + Link + CodeBlockLowlight
 *     + Placeholder + VideoBlock). Reuses the existing PanelNoteEditor
 *     extension family but adds the note-mode-only VideoBlock.
 *   - Auto-save: editor.on('update') debounce 2s → PUT id (content_json).
 *   - setEditing(false): immediate flush (debounce cancel + PUT).
 *   - restoreOriginal(): refetch original_json → editor.setContent +
 *     server-side PUT (content_json := original_json).
 *
 * Hard Rule (CLAUDE.md):
 *   - 0 LLM API call (rule-based transform only)
 *   - Do not touch PanelNoteEditor / useNoteEditor (separate per-video memo)
 *   - Player wrapper untouched here — CenterPanel handles the hidden state
 */

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Blockquote from '@tiptap/extension-blockquote';
import { createLowlight, common } from 'lowlight';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient, type NoteDocumentResponse } from '@/shared/lib/api-client';
import { useMandalaBook } from '@/features/mandala/model/useMandalaBook';
import type { TiptapDoc } from '@/features/video-side-panel/lib/note-parser';

import { VideoBlock } from '../lib/video-block';
import { FigureBlock } from '../lib/figure-block';
import { Callout } from '../lib/callout-block';
import { MermaidBlock } from '../lib/mermaid-block';
import { MarkdownTable } from '../lib/markdown-table-block';
import { buildInitialNoteDoc, sanitizeNoteDoc } from '../lib/note-document-generator';

// [NOTE-FULL-TOOLSET] — Blockquote with a `keypoint` attr so the note-mode CSS
// "핵심 포인트" label targets ONLY the generated key-point quote (data-keypoint),
// leaving plain markdown blockquotes from narrative unlabeled. StarterKit's own
// blockquote is disabled (below) and this extended one registered in its place.
const KeyPointBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      keypoint: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-keypoint') === 'true',
        renderHTML: (attrs) => (attrs['keypoint'] ? { 'data-keypoint': 'true' } : {}),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_SAVE_DEBOUNCE_MS = 2000;
const NOTE_DOC_STALE_MS = 60 * 1000;

const lowlight = createLowlight(common);

// ---------------------------------------------------------------------------
// Hook contract
// ---------------------------------------------------------------------------

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseNoteDocumentInput {
  mandalaId: string | null | undefined;
}

export interface UseNoteDocumentResult {
  editor: Editor | null;
  /** True while the initial fetch / lazy create is in-flight. */
  loading: boolean;
  /** True when error occurred during fetch or save. */
  error: boolean;
  /** Editing toggle (drives editor.setEditable). */
  isEditing: boolean;
  setIsEditing: (next: boolean) => void;
  /** "원본 복원" — replace editor content with original_json + persist. */
  restoreOriginal: () => Promise<void>;
  /** Most recent server doc id (null while pre-create). */
  docId: string | null;
  saveStatus: SaveStatus;
  /** PR3 — book was re-filled after this note was generated (new cards / translations). */
  stale: boolean;
  /** PR3 — user-triggered regenerate from the current book (edit-preserving). */
  regenerate: () => Promise<void>;
  regenerating: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const queryKey = (mandalaId: string) => ['note-document', mandalaId] as const;

export function useNoteDocument(input: UseNoteDocumentInput): UseNoteDocumentResult {
  const { mandalaId } = input;
  const queryClient = useQueryClient();

  // 1. Fetch existing doc — null on 404 (first time).
  const docQuery = useQuery({
    queryKey: mandalaId ? queryKey(mandalaId) : ['note-document', 'disabled'],
    queryFn: () => apiClient.getNoteDocument(mandalaId as string),
    enabled: Boolean(mandalaId),
    staleTime: NOTE_DOC_STALE_MS,
    retry: false,
  });

  // 2. Fetch mandala_books (PoC) — needed when doc 404 to build initial.
  const { book: mandalaBook } = useMandalaBook(mandalaId ?? undefined);

  // 3. Lazy create (D1=B / Q4=A) — when fetch succeeds with null and book is loaded.
  const createMutation = useMutation({
    mutationFn: async (initial: TiptapDoc) => {
      if (!mandalaId) throw new Error('mandalaId required');
      return apiClient.createNoteDocument({
        mandalaId,
        content_json: initial,
        original_json: initial,
      });
    },
    onSuccess: (doc) => {
      if (!mandalaId) return;
      queryClient.setQueryData<NoteDocumentResponse | null>(queryKey(mandalaId), doc);
    },
  });

  useEffect(() => {
    if (!mandalaId) return;
    if (docQuery.isLoading) return;
    if (docQuery.data) return; // already exists
    if (createMutation.isPending) return;
    if (!mandalaBook) return; // wait for book
    const initial = buildInitialNoteDoc(mandalaBook.book);
    createMutation.mutate(initial);
    // mutate ref is stable; re-run only when these change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mandalaId, docQuery.isLoading, docQuery.data, mandalaBook]);

  // 4. Editor mount.
  const docId = (docQuery.data?.id ?? null) || null;
  // Sanitize on load: docs persisted by the pre-fix generator can carry empty text
  // nodes (e.g. a heading from a blank section.title) that make TipTap silently
  // collapse the whole note to one empty paragraph. Heal them before mount.
  const rawContent = (docQuery.data?.content_json as TiptapDoc | null | undefined) ?? null;
  const initialContent = rawContent ? sanitizeNoteDoc(rawContent) : null;

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        // [NOTE-FULL-TOOLSET] — disable the built-in blockquote; register the
        // keypoint-aware one below so the "핵심 포인트" label can be scoped.
        blockquote: false,
      }),
      KeyPointBlockquote,
      Placeholder.configure({ placeholder: '내용을 작성하거나 ▶ 영상으로 돌아가세요.' }),
      Link.configure({ openOnClick: false, autolink: true }),
      CodeBlockLowlight.configure({ lowlight }),
      // CP445.x — VideoBlock owns its click handling (inline iframe via store).
      VideoBlock.configure({ HTMLAttributes: {} }),
      // [CV-NOTE-WIRE] — CV figures (equation: lazy KaTeX / chart|diagram|table: img).
      FigureBlock.configure({ HTMLAttributes: {} }),
      // [NOTE-FULL-TOOLSET] — rich-markdown narrative nodes (must be registered or
      // ProseMirror throws on doc load): admonition callout, mermaid diagram,
      // read-only GFM table.
      Callout.configure({ HTMLAttributes: {} }),
      MermaidBlock.configure({ HTMLAttributes: {} }),
      MarkdownTable.configure({ HTMLAttributes: {} }),
    ],
    []
  );

  const editor = useEditor(
    {
      extensions,
      content: initialContent ?? undefined,
      editable: false, // D11 — start in read mode; toggled via setIsEditing.
      immediatelyRender: false,
    },
    [docId]
    // Re-create editor when docId changes (mandala switch). Editor instance
    // tied to the doc identity; content updates within same doc go through
    // setContent() not new editor.
  );

  // 5. Editing toggle (D11).
  const [isEditing, setIsEditingState] = useState(false);
  const setIsEditing = useCallback(
    (next: boolean) => {
      setIsEditingState(next);
      if (editor) editor.setEditable(next);
    },
    [editor]
  );

  // CP477+10 — setNoteEditorRef publish moved to PanelNoteEditor so the
  // bridge points at the RightPanel sidebar editor (which is where the
  // user clicks "메모에 추가") rather than this CenterPanel note-mode
  // editor.

  // 6. Auto-save with debounce 2s. On setIsEditing(false) we also flush.
  const updateMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: TiptapDoc }) => {
      return apiClient.updateNoteDocument(id, content);
    },
    onSuccess: (doc) => {
      if (!mandalaId) return;
      queryClient.setQueryData<NoteDocumentResponse | null>(queryKey(mandalaId), doc);
    },
  });

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDocRef = useRef<TiptapDoc | null>(null);

  const flushSave = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (!docId || !pendingDocRef.current) return;
    updateMutation.mutate({ id: docId, content: pendingDocRef.current });
    pendingDocRef.current = null;
  }, [docId, updateMutation]);

  useEffect(() => {
    if (!editor || !docId) return;
    const handler = () => {
      pendingDocRef.current = editor.getJSON() as TiptapDoc;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        flushSave();
      }, AUTO_SAVE_DEBOUNCE_MS);
    };
    editor.on('update', handler);
    return () => {
      editor.off('update', handler);
      // On unmount: flush any pending edit so we don't lose the last change.
      flushSave();
    };
  }, [editor, docId, flushSave]);

  // setIsEditing(false) → immediate flush (D16).
  useEffect(() => {
    if (!isEditing) {
      flushSave();
    }
  }, [isEditing, flushSave]);

  // 7. Restore original (D6).
  const restoreOriginal = useCallback(async () => {
    if (!docId || !editor) return;
    const fresh = mandalaId ? await apiClient.getNoteDocument(mandalaId) : null;
    const original = (fresh?.original_json as TiptapDoc | null | undefined) ?? null;
    if (!original) return;
    editor.commands.setContent(sanitizeNoteDoc(original), false);
    // Force-clear history so undo can't go past the restore point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const histAny = (editor as any).commands as { clearHistory?: () => void };
    if (typeof histAny.clearHistory === 'function') histAny.clearHistory();
    // Persist content_json := original_json.
    await apiClient.updateNoteDocument(docId, original);
    if (mandalaId) {
      queryClient.invalidateQueries({ queryKey: queryKey(mandalaId) });
    }
  }, [docId, editor, mandalaId, queryClient]);

  // 7b. Stale detection (PR3) — the book was re-filled (new cards / translations)
  // AFTER this note was generated. We do NOT auto-overwrite (the user may be
  // reading / have edits); we surface a banner and regenerate only on click.
  const bookVersion = mandalaBook?.version ?? 0;
  const noteBasedOn = docQuery.data?.based_on_book_version ?? 0;
  const stale = Boolean(docQuery.data && mandalaBook && bookVersion > noteBasedOn);

  const [regenerating, setRegenerating] = useState(false);

  // 7c. Regenerate from the current book (user-triggered). Edit preservation
  // (C안, whole-doc — per-section is not possible): unedited note (content ==
  // original) is fully refreshed; an EDITED note keeps content_json and only
  // refreshes original_json (the baseline) so the user's edits survive.
  const regenerate = useCallback(async () => {
    if (!docId || !editor || !mandalaBook) return;
    setRegenerating(true);
    try {
      const fresh = await apiClient.getNoteDocument(mandalaId as string);
      const current = (fresh?.content_json as TiptapDoc | null | undefined) ?? null;
      const original = (fresh?.original_json as TiptapDoc | null | undefined) ?? null;
      const edited = JSON.stringify(current) !== JSON.stringify(original);
      const rebuilt = buildInitialNoteDoc(mandalaBook.book);
      // Unedited → adopt the rebuilt doc for both. Edited → keep content, refresh
      // baseline. Either way bump based_on_book_version so stale clears.
      const nextContent = edited ? (current ?? rebuilt) : rebuilt;
      await apiClient.updateNoteDocument(docId, nextContent, {
        original_json: rebuilt,
        based_on_book_version: mandalaBook.version,
      });
      if (!edited) {
        editor.commands.setContent(rebuilt, false);
        const histAny = (editor as unknown as { commands: { clearHistory?: () => void } }).commands;
        if (typeof histAny.clearHistory === 'function') histAny.clearHistory();
      }
      if (mandalaId) queryClient.invalidateQueries({ queryKey: queryKey(mandalaId) });
    } finally {
      setRegenerating(false);
    }
  }, [docId, editor, mandalaBook, mandalaId, queryClient]);

  // 8. Save status surface.
  const saveStatus: SaveStatus = updateMutation.isPending
    ? 'saving'
    : updateMutation.isError
      ? 'error'
      : updateMutation.isSuccess
        ? 'saved'
        : 'idle';

  return {
    editor,
    loading: docQuery.isLoading || createMutation.isPending,
    error: docQuery.isError,
    isEditing,
    setIsEditing,
    restoreOriginal,
    docId,
    saveStatus,
    stale,
    regenerate,
    regenerating,
  };
}
