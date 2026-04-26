import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NotebookPen, Bot } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { PanelNoteEditor } from '@/features/video-side-panel/ui/PanelNoteEditor';
import { ChatAssistant } from './ChatAssistant';
import { useMandalaCards } from '../model/useMandalaCards';
import { apiClient } from '@/shared/lib/api-client';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';
import type { TiptapDoc } from '@/features/video-side-panel/lib/note-parser';

interface RightPanelProps {
  mandalaId: string;
  videoId: string;
  playerRef: React.MutableRefObject<YTPlayer | null>;
}

type RightTab = 'notes' | 'chatbot';

export function RightPanel({ mandalaId, videoId, playerRef }: RightPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<RightTab>('notes');
  const { cards } = useMandalaCards(mandalaId);

  const currentCard = cards.find((c) => {
    const match = c.videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    return match?.[1] === videoId;
  });

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const [richNote, setRichNote] = useState<TiptapDoc | null>(null);
  const [noteLoaded, setNoteLoaded] = useState(false);
  const prevCardIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentCard?.id || prevCardIdRef.current === currentCard.id) return;
    prevCardIdRef.current = currentCard.id;
    setNoteLoaded(false);
    setRichNote(null);
    apiClient
      .getRichNote(currentCard.id)
      .then((res) => {
        if (res?.note) setRichNote(res.note as TiptapDoc);
      })
      .finally(() => setNoteLoaded(true));
  }, [currentCard?.id]);

  const noteContent = richNote ?? currentCard?.userNote ?? '';

  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const handleDocChange = useCallback(
    (doc: unknown) => {
      if (!currentCard?.id) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        apiClient.saveRichNote(currentCard.id, doc).catch(() => {});
      }, 1500);
    },
    [currentCard?.id]
  );

  const handleSeek = useCallback(
    (seconds: number) => {
      playerRef.current?.seekTo(seconds, true);
    },
    [playerRef]
  );

  const tabs: { id: RightTab; labelKey: string; fallback: string; icon: typeof NotebookPen }[] = [
    { id: 'notes', labelKey: 'learning.tabNotes', fallback: '노트', icon: NotebookPen },
    { id: 'chatbot', labelKey: 'learning.tabChatbot', fallback: 'AI 챗봇', icon: Bot },
  ];

  return (
    <div className="flex w-[340px] shrink-0 flex-col border-l border-border">
      <div className="flex shrink-0 border-b border-border/30">
        {tabs.map(({ id, labelKey, fallback, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[12px] font-semibold transition-colors',
              activeTab === id
                ? 'border-b border-border/30 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(labelKey, fallback)}
          </button>
        ))}
      </div>

      <div
        className={cn(
          'flex flex-1 flex-col overflow-y-auto scrollbar-pro px-4 py-3.5',
          activeTab !== 'notes' && 'hidden'
        )}
      >
        {(noteLoaded || !currentCard?.id) && (
          <PanelNoteEditor
            initialContent={noteContent}
            onDocChange={handleDocChange}
            onTimestampClick={handleSeek}
            playerRef={playerRef}
            videoUrl={videoUrl}
          />
        )}
      </div>
      {activeTab === 'chatbot' && (
        <div className="relative min-h-0 flex-1 overflow-hidden pb-[35px]">
          <ChatAssistant videoId={videoId} onSeek={handleSeek} />
          <p className="absolute bottom-2 left-0 w-full text-center text-[10px] text-muted-foreground/60">
            {t('learning.chatDisclaimer')}
          </p>
        </div>
      )}
    </div>
  );
}
