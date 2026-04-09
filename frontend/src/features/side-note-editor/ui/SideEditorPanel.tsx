/**
 * Inner layout of the side editor sheet.
 * Owns the data fetch + auto-save wiring for a single videoId.
 */
import { useEffect, useRef } from 'react';
import { useRichNoteQuery, useSaveRichNoteMutation } from '../model/useNoteQuery';
import { useAutoSave } from '../model/useAutoSave';
import { EditorHeader } from './EditorHeader';
import { NoteEditor } from './NoteEditor';
import { SaveStatusIndicator } from './SaveStatusIndicator';
import type { TiptapDoc } from '../lib/note-parser';

export interface SideEditorPanelProps {
  videoId: string;
}

export function SideEditorPanel({ videoId }: SideEditorPanelProps) {
  const query = useRichNoteQuery(videoId);
  const save = useSaveRichNoteMutation(videoId);

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
    <div className="flex h-full flex-col gap-4">
      <EditorHeader video={video} mandalaCell={mandalaCell} />
      <NoteEditor key={videoId} initialContent={note} onDocChange={autoSave.trigger} />
      <div className="flex items-center justify-end border-t border-border pt-2">
        <SaveStatusIndicator status={autoSave.status} onRetry={autoSave.retry} />
      </div>
    </div>
  );
}
