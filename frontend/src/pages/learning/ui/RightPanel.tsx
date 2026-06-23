import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NotebookPen, Bot, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/shared/lib/utils';
import { PanelNoteEditor } from '@/features/video-side-panel/ui/PanelNoteEditor';
import { ChatAssistant } from './ChatAssistant';
import { ViewModeToggle } from './CenterPanel';
import { useMandalaBook } from '@/features/mandala/model/useMandalaBook';
import { useMandalaCards } from '../model/useMandalaCards';
import { useLearningStore } from '../model/useLearningStore';
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
  const [activeTab, setActiveTab] = useState<RightTab>('chatbot');
  const setActiveRegion = useLearningStore((s) => s.setActiveRegion);
  const setNoteContext = useLearningStore((s) => s.setNoteContext);
  const centerViewMode = useLearningStore((s) => s.centerViewMode);
  const setCenterViewMode = useLearningStore((s) => s.setCenterViewMode);
  const activeSectionRef = useLearningStore((s) => s.activeSectionRef);
  const { cards } = useMandalaCards(mandalaId);
  const { book, isLoading: bookLoading } = useMandalaBook(mandalaId);
  // §redesign — "지금 읽는 구간" context for the chatbot header (시안 chat-ctx).
  const activeSectionTitle = (() => {
    if (!activeSectionRef || !book?.book?.chapters) return null;
    const ch = book.book.chapters.find((c) => c.ch === activeSectionRef.chapterIdx);
    return ch?.sections?.[activeSectionRef.sectionIdx]?.title ?? null;
  })();

  const currentCard = cards.find((c) => {
    const match = c.videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    return match?.[1] === videoId;
  });

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const [richNote, setRichNote] = useState<TiptapDoc | null>(null);
  const [noteLoaded, setNoteLoaded] = useState(false);
  const prevCardIdRef = useRef<string | null>(null);
  const noteWrapperRef = useRef<HTMLDivElement>(null);

  const focusNoteEditor = useCallback(() => {
    noteWrapperRef.current?.querySelector<HTMLElement>('.ProseMirror')?.focus();
  }, []);

  useEffect(() => {
    if (!currentCard?.id || prevCardIdRef.current === currentCard.id) return;
    prevCardIdRef.current = currentCard.id;
    setNoteLoaded(false);
    setRichNote(null);
    apiClient
      .getRichNote(currentCard.id, currentCard.sourceTable)
      .then((res) => {
        if (res?.note) setRichNote(res.note as TiptapDoc);
      })
      .finally(() => setNoteLoaded(true));
  }, [currentCard?.id, currentCard?.sourceTable]);

  const noteContent = richNote ?? currentCard?.userNote ?? '';

  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const handleDocChange = useCallback(
    (doc: unknown) => {
      if (!currentCard?.id) return;
      const cardId = currentCard.id;
      const sourceTable = currentCard.sourceTable;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        // CP501 — route by sourceTable so ulc notes persist; surface failures
        // instead of swallowing them (previously `.catch(() => {})` hid the
        // ulc 404 → silent data loss).
        apiClient.saveRichNote(cardId, doc, sourceTable).catch((err) => {
          console.error('saveRichNote failed', err);
          toast.error(t('learning.noteSaveFailed', '노트 저장에 실패했어요. 다시 시도해 주세요.'));
        });
      }, 1500);
    },
    [currentCard?.id, currentCard?.sourceTable, t]
  );

  const handleSeek = useCallback(
    (seconds: number) => {
      playerRef.current?.seekTo(seconds, true);
    },
    [playerRef]
  );

  const tabs: { id: RightTab; labelKey: string; icon: typeof NotebookPen }[] = [
    { id: 'notes', labelKey: 'learning.tabNotes', icon: NotebookPen },
    { id: 'chatbot', labelKey: 'learning.tabChatbot', icon: Bot },
  ];

  return (
    <div
      // §redesign — left divider EXACTLY matches the left sidebar's right divider
      // (Sidebar.tsx: border-sidebar-border/40) so both panel seams are identical.
      // Previous border-white/[0.06] read heavier/cruder than the left edge.
      className="flex w-[400px] shrink-0 flex-col border-l border-sidebar-border/40 pl-5 pr-5"
      onMouseEnter={() => setActiveRegion(activeTab === 'notes' ? 'notes' : 'chat')}
    >
      {/* CP445 (사용자 directive) — ViewModeToggle + [⋯] 우측 사이드바 상단
          고정. 영상/노트 모드 전환 시 위치 변동 없음 (toggle 의 단일 home). */}
      <div className="flex shrink-0 items-center justify-between py-2 pr-3">
        <ViewModeToggle
          mode={centerViewMode}
          noteDisabled={!bookLoading && !book}
          onChange={(mode) => {
            if (mode === 'note' && !bookLoading && !book) {
              toast(t('learning.noteNotReady', '노트가 아직 생성되지 않았어요'));
              return;
            }
            setCenterViewMode(mode);
          }}
        />
        <button
          type="button"
          aria-label="More"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onClick={() => {
            /* CP445 D8 — placeholder, no-op (별 PR) */
          }}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex shrink-0">
        {tabs.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            onClick={() => {
              setActiveTab(id);
              setActiveRegion(id === 'notes' ? 'notes' : 'chat');
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[12px] transition-colors',
              activeTab === id
                ? 'border-b-2 border-primary text-foreground font-semibold'
                : 'border-b-2 border-transparent text-muted-foreground font-normal hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div
        ref={noteWrapperRef}
        className={cn(
          'group flex flex-1 flex-col overflow-y-auto scrollbar-pro pl-0 pr-4 py-3.5',
          activeTab !== 'notes' && 'hidden'
        )}
      >
        {/* CP477+9 — Standalone hint `<p>` removed. TipTap Placeholder
            extension (videoPlayer.panelPlaceholder via useNoteEditor)
            already renders the placeholder text inside the editor's empty
            first paragraph via ::before, so the cursor sits at the hint
            origin and the hint disappears on first keystroke (Notion-style). */}
        {(noteLoaded || !currentCard?.id) && (
          <PanelNoteEditor
            initialContent={noteContent}
            onDocChange={handleDocChange}
            onTimestampClick={handleSeek}
            playerRef={playerRef}
            videoUrl={videoUrl}
            onContextChange={setNoteContext}
          />
        )}
      </div>
      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden pb-[35px]',
          activeTab !== 'chatbot' && 'hidden'
        )}
      >
        {activeSectionTitle && (
          // §redesign — chat context (시안 chat-ctx): "지금 읽는 구간 · {제목}".
          <div className="border-b border-white/[0.06] px-1 pb-2.5 pt-0.5 text-[12px] text-muted-foreground/70">
            지금 읽는 구간 · <span className="text-muted-foreground">{activeSectionTitle}</span>
          </div>
        )}
        <ChatAssistant key={videoId} mandalaId={mandalaId} videoId={videoId} onSeek={handleSeek} />
        <p className="absolute bottom-2 left-0 w-full text-center text-[10px] text-muted-foreground/60">
          {t('learning.chatDisclaimer')}
        </p>
      </div>
    </div>
  );
}
