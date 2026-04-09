/**
 * Inner layout of the side editor sheet.
 * Owns the data fetch + auto-save wiring for a single cardId.
 */
import { useEffect, useRef } from 'react';
import { useRichNoteQuery, useSaveRichNoteMutation } from '../model/useNoteQuery';
import { useAutoSave } from '../model/useAutoSave';
import { EditorHeader } from './EditorHeader';
import { NoteEditor } from './NoteEditor';
import { SaveStatusIndicator } from './SaveStatusIndicator';
import type { TiptapDoc } from '../lib/note-parser';

export interface SideEditorPanelProps {
  cardId: string;
}

export function SideEditorPanel({ cardId }: SideEditorPanelProps) {
  const query = useRichNoteQuery(cardId);
  const save = useSaveRichNoteMutation(cardId);

  const saveFn = async (doc: TiptapDoc): Promise<void> => {
    await save.mutateAsync(doc);
  };
  const saveFnRef = useRef(saveFn);
  useEffect(() => {
    saveFnRef.current = saveFn;
    // biome: intentional — stable reference; real save is called via ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save]);

  const autoSave = useAutoSave(async (doc) => {
    await saveFnRef.current(doc);
  });

  // Flush any pending save on unmount so typing-then-closing doesn't lose edits.
  useEffect(() => {
    return () => {
      autoSave.flush();
    };
    // biome: intentional — flush should only run on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (query.isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <EditorHeader video={null} mandalaCell={null} />
        <div className="flex-1 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-destructive">
        <span>메모를 불러오지 못했습니다.</span>
        {query.error && (
          <pre className="mt-1 max-w-full overflow-auto rounded bg-muted p-2 text-[10px] text-muted-foreground">
            {query.error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={() => query.refetch()}
          className="underline underline-offset-2"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const { video, mandalaCell, note } = query.data;

  return (
    <div className="flex h-full flex-col">
      {/* Header — compact, separated by a subtle line */}
      <div className="px-6 pt-6 pb-4">
        <EditorHeader video={video} mandalaCell={mandalaCell} />
      </div>
      <div className="mx-6 border-t border-border/30" />
      {/* Editor — generous padding, full height */}
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-2">
        <NoteEditor key={cardId} initialContent={note} onDocChange={autoSave.trigger} />
      </div>
      {/* Footer — minimal, right-aligned */}
      <div className="flex items-center justify-end px-6 py-3 text-muted-foreground/60">
        <SaveStatusIndicator status={autoSave.status} onRetry={autoSave.retry} />
      </div>
    </div>
  );
}
