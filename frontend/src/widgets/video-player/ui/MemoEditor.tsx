import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/shared/ui/button';
import type { YTPlayer } from '../model/youtube-api';
import { formatTime } from '../model/youtube-api';
import { SlashMenu } from './SlashMenu';
import { NotePreview } from './NotePreview';
import { RichTextarea } from './RichTextarea';

const AUTO_SAVE_DELAY_MS = 3_000;

interface MemoEditorProps {
  note: string;
  cardId: string;
  videoId: string | null;
  playerRef: React.MutableRefObject<YTPlayer | null>;
  playerReady: boolean;
  onSave: (id: string, note: string) => void;
  isYouTube: boolean;
}

export function MemoEditor({
  note: initialNote,
  cardId,
  videoId,
  playerRef,
  playerReady,
  onSave,
  isYouTube,
}: MemoEditorProps) {
  const { t } = useTranslation();
  const [note, setNote] = useState(initialNote);
  const [isEditing, setIsEditing] = useState(!initialNote);
  const [slashMenu, setSlashMenu] = useState<{ bottom?: number; top?: number; left: number } | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slashPosRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync with external note changes (e.g., when card changes)
  useEffect(() => {
    setNote(initialNote);
  }, [initialNote]);

  // Auto-save debounce
  const scheduleAutoSave = useCallback(
    (newNote: string) => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        onSave(cardId, newNote);
        toast.success(t('videoPlayer.autoSaved'));
      }, AUTO_SAVE_DELAY_MS);
    },
    [cardId, onSave, t]
  );

  // Cleanup auto-save timer
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  const handleNoteChange = useCallback(
    (value: string) => {
      setNote(value);
      scheduleAutoSave(value);
    },
    [scheduleAutoSave]
  );

  const handleImmediateSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    onSave(cardId, note);
    toast.success(t('videoPlayer.noteSaved'));
    setIsEditing(false);
  }, [cardId, note, onSave, t]);

  // Insert timestamp at end of note (or replace overrideNote)
  const insertTimestamp = useCallback((overrideNote?: string) => {
    if (!playerRef.current || !videoId) {
      toast.error(t('videoPlayer.playerNotReady'));
      return;
    }

    try {
      const currentNote = overrideNote ?? note;
      const currentTime = Math.floor(playerRef.current.getCurrentTime());
      const timestamp = formatTime(currentTime);
      const link = `[⏱ ${timestamp}](https://www.youtube.com/watch?v=${videoId}&t=${currentTime}s)`;

      const separator = currentNote.length > 0 && !currentNote.endsWith('\n') ? '\n' : '';
      const newNote = currentNote + separator + link + ' ';

      setNote(newNote);
      scheduleAutoSave(newNote);
      setIsEditing(true);

      toast.success(t('videoPlayer.timestampAdded', { timestamp }));
    } catch {
      toast.error(t('videoPlayer.timestampFailed'));
    }
  }, [note, videoId, playerRef, scheduleAutoSave, t]);

  // Handle slash menu selection
  const handleSlashSelect = useCallback(
    (itemId: string) => {
      // Remove the '/' character and any typed filter text
      const slashPos = slashPosRef.current;
      let cleanedNote = note;
      if (slashPos !== null) {
        const beforeSlash = note.slice(0, slashPos);
        const afterSlash = note.slice(slashPos + 1);
        const filterEnd = afterSlash.search(/[\s\n]|$/);
        cleanedNote = beforeSlash + afterSlash.slice(filterEnd);
      }

      setSlashMenu(null);
      slashPosRef.current = null;

      if (itemId === 'timestamp') {
        insertTimestamp(cleanedNote);
      } else {
        setNote(cleanedNote);
      }
    },
    [note, insertTimestamp]
  );

  const handleSlashClose = useCallback(() => {
    setSlashMenu(null);
    slashPosRef.current = null;
  }, []);

  // Keyboard shortcuts in textarea
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't handle if slash menu is open (it captures keys)
      if (slashMenu) return;

      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleImmediateSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsEditing(false);
      }
    },
    [slashMenu, handleImmediateSave]
  );

  // RichTextarea change handler with slash detection
  const handleRichTextareaChange = useCallback(
    (value: string) => {
      handleNoteChange(value);

      // Detect slash at end of value for slash menu
      // (simplified: check if the last char typed was '/')
      const lastLine = value.split('\n').pop() ?? '';
      if (lastLine.trim() === '/') {
        slashPosRef.current = value.length - 1;
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          setSlashMenu({
            bottom: window.innerHeight - rect.top + 4,
            left: rect.left,
          });
        }
      } else if (slashMenu && !lastLine.startsWith('/')) {
        setSlashMenu(null);
        slashPosRef.current = null;
      }
    },
    [handleNoteChange, slashMenu]
  );

  // Seek to timestamp when clicking a chip in the RichTextarea
  const handleTimestampSeek = useCallback(
    (url: string) => {
      if (!playerRef.current || !playerReady) return;
      const tMatch = url.match(/[?&]t=(\d+)/);
      if (tMatch) {
        const seconds = parseInt(tMatch[1], 10);
        playerRef.current.seekTo(seconds, true);
      }
    },
    [playerRef, playerReady]
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full flex flex-col"
      style={{
        background: 'hsl(var(--bg-sunken) / 0.85)',
        backdropFilter: 'blur(18px)',
        borderTop: '1px solid hsl(var(--border) / 0.15)',
      }}
    >
      <div className="flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isYouTube && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => insertTimestamp()}
                disabled={!playerReady}
                className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40"
                title={t('videoPlayer.addTimestamp')}
              >
                <Timer className="w-3.5 h-3.5" />
              </Button>
            )}
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-foreground/60" />
              <span className="text-xs font-medium text-foreground/60">
                {t('videoPlayer.memo')}
              </span>
            </div>
          </div>
          {isEditing && (
            <span className="text-[10px] text-muted-foreground/50">
              {t('videoPlayer.slashHint')}
            </span>
          )}
        </div>

        {/* Content — fills remaining height from parent */}
        <div className="px-3 pb-2 flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          {isEditing ? (
            <RichTextarea
              value={note}
              onChange={handleRichTextareaChange}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (!slashMenu) {
                  setTimeout(() => {
                    if (!slashMenu) setIsEditing(false);
                  }, 200);
                }
              }}
              autoFocus
              placeholder={t('videoPlayer.notePlaceholder')}
              className="w-full h-full cursor-text"
              onTimestampClick={handleTimestampSeek}
            />
          ) : (
            <NotePreview
              note={note}
              videoId={videoId}
              playerRef={playerRef}
              playerReady={playerReady}
              onEditClick={() => setIsEditing(true)}
            />
          )}
        </div>
      </div>

      {/* Slash Menu — portal to document.body to escape backdrop-filter/transform containing block */}
      {slashMenu && createPortal(
        <SlashMenu
          position={slashMenu}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
        />,
        document.body
      )}
    </div>
  );
}
