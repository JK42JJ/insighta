/**
 * Inner layout of the side editor panel.
 *
 * v2: Loads initialNote from Zustand store (instant, no API call).
 * Saves through the existing onSave callback chain (handleSaveNote
 * in useCardOrchestrator) which handles both user_video_states and
 * user_local_cards automatically.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAutoSave } from '../model/useAutoSave';
import { NoteEditor } from './NoteEditor';
import { SaveStatusIndicator } from './SaveStatusIndicator';
import { extractPlainText, type TiptapDoc } from '../lib/note-parser';

export interface SideEditorPanelProps {
  cardId: string;
  initialNote: string;
  videoTitle: string;
  onSaveNote: (cardId: string, note: string) => void;
}

export function SideEditorPanel({
  cardId,
  initialNote,
  videoTitle,
  onSaveNote,
}: SideEditorPanelProps) {
  const onSaveRef = useRef(onSaveNote);
  useEffect(() => {
    onSaveRef.current = onSaveNote;
  }, [onSaveNote]);

  const saveFn = useCallback(
    async (doc: TiptapDoc): Promise<void> => {
      const plainText = extractPlainText(doc);
      onSaveRef.current(cardId, plainText);
    },
    [cardId]
  );

  const autoSave = useAutoSave(saveFn);

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      autoSave.flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header — video title, compact */}
      <div className="px-6 pt-6 pb-3">
        <h2 className="line-clamp-1 text-[13px] font-medium text-foreground">
          {videoTitle || 'Untitled'}
        </h2>
      </div>
      <div className="mx-6 border-t border-border/20" />

      {/* Editor — generous padding, full height */}
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-2">
        <NoteEditor key={cardId} initialContent={initialNote} onDocChange={autoSave.trigger} />
      </div>

      {/* Footer — save status */}
      <div className="flex items-center justify-end px-6 py-3">
        <SaveStatusIndicator status={autoSave.status} onRetry={autoSave.retry} />
      </div>
    </div>
  );
}
