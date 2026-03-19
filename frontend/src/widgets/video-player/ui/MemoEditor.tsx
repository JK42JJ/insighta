import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Timer, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Textarea } from '@/shared/ui/textarea';
import type { YTPlayer } from '../model/youtube-api';
import { formatTime } from '../model/youtube-api';
import { SlashMenu } from '@/shared/ui/SlashMenu';
import { getCaretCoordinates } from '@/shared/lib/get-caret-coordinates';
import { getAuthHeaders } from '@/shared/lib/supabase-auth';
import { localCardsKeys } from '@/features/card-management/model/useLocalCards';
import { useQueryClient } from '@tanstack/react-query';
import { NotePreview } from './NotePreview';

const AUTO_SAVE_DELAY_MS = 3_000;
const IMAGE_MD_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;

interface CaptureImage {
  alt: string;
  url: string;
  seconds: number | null;
}

function parseCaptures(text: string): CaptureImage[] {
  const captures: CaptureImage[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(IMAGE_MD_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    const url = match[2];
    const tMatch = url.match(/#t=(\d+)s/);
    captures.push({
      alt: match[1],
      url: url.replace(/#t=\d+s$/, ''),
      seconds: tMatch ? parseInt(tMatch[1], 10) : null,
    });
  }
  return captures;
}

function CaptureGallery({
  captures,
  playerRef,
  playerReady,
}: {
  captures: CaptureImage[];
  playerRef: React.MutableRefObject<YTPlayer | null>;
  playerReady: boolean;
}) {
  if (captures.length === 0) return null;

  return (
    <div className="flex-1 min-w-0 overflow-x-auto scrollbar-thin">
      <div className="flex gap-1.5 flex-nowrap">
        {captures.map((cap, i) => (
          <button
            key={`${cap.url}-${i}`}
            onClick={() => {
              if (cap.seconds !== null && playerRef.current && playerReady) {
                playerRef.current.seekTo(cap.seconds, true);
              }
            }}
            className="relative flex-shrink-0 rounded overflow-hidden border border-border/20 hover:border-primary/40 transition-colors group"
            title={cap.alt}
          >
            <img
              src={cap.url}
              alt={cap.alt}
              className="h-8 w-auto object-cover"
              loading="lazy"
            />
            {cap.seconds !== null && (
              <span className="absolute bottom-0 right-0 text-[8px] bg-black/70 text-white px-0.5 rounded-tl">
                {formatTime(cap.seconds)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  const queryClient = useQueryClient();
  const [note, setNote] = useState(initialNote);
  const [isEditing, setIsEditing] = useState(!initialNote);
  const [slashMenu, setSlashMenu] = useState<boolean>(false);
  const [caretCoords, setCaretCoords] = useState<{ top: number; left: number } | null>(null);
  const captures = useMemo(() => parseCaptures(note), [note]);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slashPosRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync with external note changes (e.g., when card changes) — avoid unnecessary setState
  useEffect(() => {
    setNote(prev => prev === initialNote ? prev : initialNote);
  }, [initialNote]);

  // Focus cursor at end of text when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.focus();
      textarea.selectionStart = textarea.value.length;
      textarea.selectionEnd = textarea.value.length;
    }
  }, [isEditing]);

  // Auto-save debounce
  const scheduleAutoSave = useCallback(
    (newNote: string) => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        onSave(cardId, newNote);
      }, AUTO_SAVE_DELAY_MS);
    },
    [cardId, onSave]
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
  }, [cardId, note, onSave]);

  // Insert text at cursor position (or at end)
  const insertTextAtCursor = useCallback(
    (text: string, overrideNote?: string) => {
      const currentNote = overrideNote ?? note;
      const textarea = textareaRef.current;
      const cursorPos = textarea?.selectionStart ?? currentNote.length;

      const before = currentNote.slice(0, cursorPos);
      const after = currentNote.slice(cursorPos);
      const separator = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
      const newNote = before + separator + text + ' ' + after;

      setNote(newNote);
      scheduleAutoSave(newNote);
      setIsEditing(true);

      // Restore cursor position after the inserted text
      const newCursorPos = before.length + separator.length + text.length + 1;
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newCursorPos;
          textareaRef.current.selectionEnd = newCursorPos;
          textareaRef.current.focus();
        }
      });

      return newNote;
    },
    [note, scheduleAutoSave]
  );

  // Insert timestamp at cursor
  const insertTimestamp = useCallback((overrideNote?: string) => {
    if (!playerRef.current || !videoId) {
      toast.error(t('videoPlayer.playerNotReady'));
      return;
    }

    try {
      const currentTime = Math.floor(playerRef.current.getCurrentTime());
      const timestamp = formatTime(currentTime);
      const link = `[⏱ ${timestamp}](https://www.youtube.com/watch?v=${videoId}&t=${currentTime}s)`;

      insertTextAtCursor(link, overrideNote);
      toast.success(t('videoPlayer.timestampAdded', { timestamp }));
    } catch {
      toast.error(t('videoPlayer.timestampFailed'));
    }
  }, [videoId, playerRef, insertTextAtCursor, t]);

  // Insert capture bookmark with thumbnail image markdown
  const insertCapture = useCallback((overrideNote?: string) => {
    if (!playerRef.current || !videoId) {
      toast.error(t('videoPlayer.playerNotReady'));
      return;
    }

    try {
      const currentTime = Math.floor(playerRef.current.getCurrentTime());
      const timestamp = formatTime(currentTime);
      const link = `![📸 ${timestamp}](https://img.youtube.com/vi/${videoId}/mqdefault.jpg#t=${currentTime}s)`;

      insertTextAtCursor(link, overrideNote);
      toast.success(t('videoPlayer.timestampAdded', { timestamp }));
    } catch {
      toast.error(t('videoPlayer.timestampFailed'));
    }
  }, [videoId, playerRef, insertTextAtCursor, t]);

  // Trigger AI summary generation for this card — inline animation at cursor
  const GENERATING_PLACEHOLDER = '⏳ Generating AI summary...';
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

  const triggerAiSummary = useCallback(
    async (cleanedNote: string) => {
      // Insert placeholder at cursor position
      insertTextAtCursor(GENERATING_PLACEHOLDER, cleanedNote);
      setIsGeneratingSummary(true);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/v1/ontology/enrich/auto', {
          method: 'POST',
          headers,
          body: JSON.stringify({ source_table: 'user_local_cards', source_id: cardId, force: true }),
        });
        const data = await res.json();
        if (res.ok && data.data?.enriched !== false) {
          toast.success(t('videoPlayer.aiSummarySuccess'), { id: 'ai-summary' });
          // Remove placeholder — cards refresh will bring the actual summary
          setNote((prev) => prev.replace(GENERATING_PLACEHOLDER, '').trim());
          queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
        } else {
          toast.error(t('videoPlayer.aiSummaryFailed'), { id: 'ai-summary' });
          setNote((prev) => prev.replace(GENERATING_PLACEHOLDER, '').trim());
        }
      } catch {
        toast.error(t('videoPlayer.aiSummaryFailed'), { id: 'ai-summary' });
        setNote((prev) => prev.replace(GENERATING_PLACEHOLDER, '').trim());
      } finally {
        setIsGeneratingSummary(false);
      }
    },
    [cardId, queryClient, t, insertTextAtCursor]
  );

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

      setSlashMenu(false);
      slashPosRef.current = null;
      setCaretCoords(null);

      if (itemId === 'timestamp') {
        insertTimestamp(cleanedNote);
      } else if (itemId === 'capture') {
        insertCapture(cleanedNote);
      } else if (itemId === 'ai-summary') {
        triggerAiSummary(cleanedNote);
      } else {
        setNote(cleanedNote);
      }
    },
    [note, insertTimestamp, insertCapture, triggerAiSummary]
  );

  const handleSlashClose = useCallback(() => {
    setSlashMenu(false);
    slashPosRef.current = null;
    setCaretCoords(null);
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

  // Textarea change handler with slash detection
  // Capture selectionStart from the event target BEFORE any state update to avoid
  // React 18 batching / controlled-input DOM-sync issues.
  const handleTextareaChange = useCallback(
    (value: string, cursorPos: number) => {
      handleNoteChange(value);

      const textBeforeCursor = value.slice(0, cursorPos);
      const lastNewline = textBeforeCursor.lastIndexOf('\n');
      const currentLine = textBeforeCursor.slice(lastNewline + 1);

      if (currentLine.trimStart() === '/') {
        const slashPos = lastNewline + 1 + currentLine.indexOf('/');
        slashPosRef.current = slashPos;

        const textarea = textareaRef.current;
        if (textarea) {
          const coords = getCaretCoordinates(textarea, slashPos);
          const textareaRect = textarea.getBoundingClientRect();
          const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;

          const MENU_WIDTH = 208; // w-52 = 13rem = 208px

          const caretTop = textareaRect.top + coords.top - textarea.scrollTop;
          const caretLeft = textareaRect.left + coords.left;

          setCaretCoords({
            top: caretTop + lineHeight,
            left: Math.max(0, Math.min(caretLeft, window.innerWidth - MENU_WIDTH)),
          });
        }

        setSlashMenu(true);
      } else if (slashMenu && currentLine.trimStart() !== '/') {
        setSlashMenu(false);
        slashPosRef.current = null;
        setCaretCoords(null);
      }
    },
    [handleNoteChange, slashMenu]
  );

  return (
    <div
      className="relative h-full flex flex-col"
      style={{
        background: 'hsl(var(--bg-sunken) / 0.85)',
        backdropFilter: 'blur(18px)',
        borderTop: '1px solid hsl(var(--border) / 0.15)',
      }}
    >
      <div className="flex flex-col flex-1 min-h-0">
        {/* Header — buttons + inline capture gallery + hint */}
        <div className="px-3 py-2.5 flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-3 flex-shrink-0">
            {isYouTube && (
              <>
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => insertCapture()}
                  disabled={!playerReady}
                  className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40"
                  title={t('videoPlayer.insertCapture')}
                >
                  <Camera className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-foreground/60" />
              <span className="text-xs font-medium text-foreground/60">
                {t('videoPlayer.memo')}
              </span>
            </div>
          </div>

          {/* Inline capture gallery */}
          <CaptureGallery captures={captures} playerRef={playerRef} playerReady={playerReady} />

          {isEditing && (
            <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 whitespace-nowrap">
              {t('videoPlayer.slashHint')}
            </span>
          )}
        </div>

        {/* Content — fills remaining height from parent */}
        <div className="px-3 pb-2 flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          {isEditing ? (
            <Textarea
              ref={textareaRef}
              value={note}
              onChange={(e) => handleTextareaChange(e.target.value, e.target.selectionStart)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (!slashMenu) {
                  setTimeout(() => {
                    if (!slashMenu) setIsEditing(false);
                  }, 200);
                }
              }}
              readOnly={isGeneratingSummary}
              placeholder={t('videoPlayer.notePlaceholder')}
              className={cn(
                'w-full h-full resize-none border-0 bg-transparent',
                'focus-visible:ring-0 focus-visible:ring-offset-0',
                'text-sm text-foreground/60 scrollbar-thin min-h-0',
                isGeneratingSummary && 'opacity-70 cursor-wait'
              )}
              style={{ caretColor: 'hsl(var(--primary))' }}
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

      {/* SlashMenu — Portal to document.body to bypass overflow clip */}
      {slashMenu && caretCoords && createPortal(
        <div className="fixed z-[9999]" style={{ top: caretCoords.top, left: caretCoords.left }}>
          <SlashMenu onSelect={handleSlashSelect} onClose={handleSlashClose} />
        </div>,
        document.body
      )}
    </div>
  );
}
