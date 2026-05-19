import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  Zap,
  BookText,
  Play,
  BookOpen,
  Pencil,
  Download,
  FileText,
  RotateCcw,
  MoreVertical,
} from 'lucide-react';
import { EditorContent } from '@tiptap/react';
import { toast } from 'sonner';
import { PanelVideoPlayer } from '@/features/video-side-panel/ui/PanelVideoPlayer';
import { PanelAISummary } from '@/features/video-side-panel/ui/PanelAISummary';
import { useMandalaBook } from '@/features/mandala/model/useMandalaBook';
import { useRichSummary } from '@/features/video-side-panel/model/useRichSummary';
import { useHighlightReel, HIGHLIGHT_RELEVANCE_THRESHOLD } from '../model/useHighlightReel';
import { useLearningStore } from '@/pages/learning/model/useLearningStore';
import { useNoteDocument } from '@/pages/learning/model/useNoteDocument';
import { useNoteAutoFollow } from '@/pages/learning/model/useNoteAutoFollow';
import { exportToMarkdown, exportToHtml } from '@/pages/learning/lib/note-export';
import { cn } from '@/shared/lib/utils';
import type { MandalaBookChapter, MandalaBookSection } from '@/shared/lib/api-client';
import type { Editor } from '@tiptap/react';
import type { TiptapDoc } from '@/features/video-side-panel/lib/note-parser';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';

interface CenterPanelProps {
  mandalaId: string;
  videoId: string;
  playerRef: React.MutableRefObject<YTPlayer | null>;
  shouldAutoplay?: boolean;
  onUserPlayed?: () => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  startTime?: number;
  onPlayerHoverIn?: () => void;
  onPlayerHoverOut?: () => void;
}

type CenterTabId = 'summary' | 'section';

export function CenterPanel({
  mandalaId,
  videoId,
  playerRef,
  shouldAutoplay = false,
  onUserPlayed,
  onPlayStateChange,
  startTime,
  onPlayerHoverIn,
  onPlayerHoverOut,
}: CenterPanelProps) {
  const { t } = useTranslation();
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Highlight reel — auto-skip to sections whose relevance_pct >= threshold.
  // Dormant until pre-CP474 rows are backfilled with segments + relevance.
  const { richSummary: highlightRich } = useRichSummary(videoId);
  const highlightSections = highlightRich?.segments?.sections ?? undefined;
  const highlightReel = useHighlightReel({
    sections: highlightSections,
    playerRef,
  });
  const centerTab = useLearningStore((s) => s.centerTab);
  const setCenterTab = useLearningStore((s) => s.setCenterTab);
  const centerViewMode = useLearningStore((s) => s.centerViewMode);
  const activeSectionRef = useLearningStore((s) => s.activeSectionRef);
  const setActiveRegion = useLearningStore((s) => s.setActiveRegion);
  const setPlayerState = useLearningStore((s) => s.setPlayerState);
  const { book } = useMandalaBook(mandalaId);
  const setActiveNoteVideoKey = useLearningStore((s) => s.setActiveNoteVideoKey);
  const noteAutoFollowEnabled = useLearningStore((s) => s.noteAutoFollowEnabled);
  const setNoteAutoFollow = useLearningStore((s) => s.setNoteAutoFollow);

  // CP445.x — VideoBlock owns its click → inline YouTube iframe (autoplay)
  // via Zustand `activeNoteVideoKey`. No external player.seekTo needed.
  const noteDoc = useNoteDocument({ mandalaId });

  // CP446.x — visibility-driven auto-follow: scrolling drives activeKey
  // once the user has explicitly clicked at least one VideoBlock. Disabled
  // in edit mode and outside note mode (idempotent: hook early-returns).
  useNoteAutoFollow({
    editor: noteDoc.editor,
    isEditable: noteDoc.isEditing,
    enabled: noteAutoFollowEnabled && centerViewMode === 'note',
  });

  // CP445 B3 — when entering note mode the player wrapper is hidden via CSS
  // (CP442 mount-preserve) but the YouTube iframe keeps playing audio in the
  // background. Pause on every transition INTO 'note'; do NOT auto-resume on
  // return — user re-clicks play.
  useEffect(() => {
    if (centerViewMode !== 'note') return;
    try {
      playerRef.current?.pauseVideo();
    } catch {
      // player not ready
    }
  }, [centerViewMode, playerRef]);

  // CP445.x / CP446.x — auto-collapse the inline-iframe VideoBlock AND
  // disable auto-follow when:
  //   (a) leaving note mode (player mode shouldn't keep a hidden iframe playing)
  //   (b) entering edit mode (spec: edit mode = static thumbnails only)
  // Auto-follow OFF here ensures next note-mode entry begins in "explicit
  // play activity" state — user must click a VideoBlock to enable scrolling
  // auto-switch (Q1 default).
  useEffect(() => {
    if (centerViewMode !== 'note' || noteDoc.isEditing) {
      setActiveNoteVideoKey(null);
      setNoteAutoFollow(false);
    }
  }, [centerViewMode, noteDoc.isEditing, setActiveNoteVideoKey, setNoteAutoFollow]);

  // CP446.x — mandala 변경 시 auto-follow 초기화. 다른 mandala 의 노트 doc
  // 으로 진입 시 explicit click 다시 필요하도록.
  useEffect(() => {
    setActiveNoteVideoKey(null);
    setNoteAutoFollow(false);
  }, [mandalaId, setActiveNoteVideoKey, setNoteAutoFollow]);

  // CP445 Q-D=B+C — Toast on save failure (silent on success — dot indicator
  // covers normal feedback). useRef-equivalent guard: only toast when status
  // transitions INTO 'error' (not on every render).
  useEffect(() => {
    if (noteDoc.saveStatus === 'error') {
      toast.error(t('learning.noteSaveError'));
    }
  }, [noteDoc.saveStatus, t]);

  // CP445 — when book index sets activeSection while in note view, scroll
  // to the matching <h3> inside the TipTap editor. Note doc is per-mandala
  // multi-video so we use the chapter/section index pair to find the Nth
  // h3 element in editor DOM (deterministic order from generator).
  useEffect(() => {
    if (centerViewMode !== 'note' || !activeSectionRef || !noteDoc.editor || !book?.book) return;
    const chapters = (book.book.chapters ?? []).slice().sort((a, b) => (a.ch ?? 0) - (b.ch ?? 0));
    let flatIdx = 0;
    let found = false;
    for (const ch of chapters) {
      if (ch.ch === activeSectionRef.chapterIdx) {
        flatIdx += activeSectionRef.sectionIdx;
        found = true;
        break;
      }
      flatIdx += ch.sections?.length ?? 0;
    }
    if (!found) return;
    const editorEl = noteDoc.editor.view.dom as HTMLElement;
    const h3s = editorEl.querySelectorAll('h3');
    const target = h3s[flatIdx] as HTMLElement | undefined;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Note mode: do NOT auto-seek the (hidden) player — multi-vid section
    // makes the target ambiguous. Player seek stays user-initiated via
    // VideoBlock click.
  }, [activeSectionRef, centerViewMode, noteDoc.editor, book]);

  const activeSection = (() => {
    if (!activeSectionRef || !book?.book?.chapters) return null;
    const chapter = book.book.chapters.find((c) => c.ch === activeSectionRef.chapterIdx);
    if (!chapter) return null;
    const sec = chapter.sections?.[activeSectionRef.sectionIdx];
    if (!sec) return null;
    return { chapter, section: sec };
  })();

  const tabs: Array<{
    id: CenterTabId;
    labelKey: string;
    fallback: string;
    icon: typeof Sparkles;
  }> = [
    { id: 'summary', labelKey: 'learning.tabSummary', fallback: 'AI 요약', icon: Sparkles },
    { id: 'section', labelKey: 'learning.tabSection', fallback: '섹션 내용', icon: BookText },
  ];

  return (
    <div className="flex flex-1 min-w-0 flex-col overflow-hidden pl-4 pr-3 pt-[5px]">
      <div
        className={cn('shrink-0', centerViewMode === 'note' && 'hidden')}
        onMouseEnter={() => {
          setActiveRegion('player');
          onPlayerHoverIn?.();
        }}
        onMouseLeave={() => onPlayerHoverOut?.()}
      >
        <PanelVideoPlayer
          videoUrl={videoUrl}
          playerRef={playerRef}
          shouldAutoplay={shouldAutoplay}
          onUserPlayed={onUserPlayed}
          onPlayStateChange={onPlayStateChange}
          onTimeUpdate={setPlayerState}
          startTime={startTime}
        />
      </div>

      {centerViewMode === 'player' && (
        // CP445 B2 — ViewModeToggle moved to LearningPage toprow (tb-right).
        // This row holds only the [AI 요약][섹션 내용] tabs and is hidden in
        // note mode (toprow toggle covers the mode switch).
        // CP445.x — tabs / 본문 wrapper 의 가로폭 = 영상 (49.5vh*16/9) 동일
        // mx-auto. 영상 ↔ AI요약/섹션 좌우 시각 정렬 일치.
        <div
          className="mx-auto w-full shrink-0"
          style={{ maxWidth: 'calc(49.5vh * 16 / 9)' }}
          onMouseEnter={() => setActiveRegion('book-index')}
        >
          <div className="flex items-center justify-between">
            <div className="flex">
              {tabs.map(({ id, labelKey, fallback, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setCenterTab(id)}
                  className={cn(
                    'flex items-center gap-1.5 py-2.5 px-3 text-[12px] transition-colors border-b-2',
                    centerTab === id
                      ? 'border-primary text-foreground font-semibold'
                      : 'border-transparent text-muted-foreground font-normal hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(labelKey, fallback)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={highlightReel.active ? highlightReel.stop : highlightReel.start}
              disabled={!highlightReel.enabled}
              title={
                !highlightReel.enabled
                  ? t('learning.highlightReelDisabledTooltip', {
                      threshold: HIGHLIGHT_RELEVANCE_THRESHOLD,
                    })
                  : highlightReel.active
                    ? t('learning.highlightReelActiveTooltip')
                    : t('learning.highlightReelReadyTooltip', {
                        count: highlightReel.highlights.length,
                      })
              }
              className={cn(
                'flex items-center gap-1 px-2.5 py-[3px] text-[11.5px] font-medium rounded-full transition-colors',
                highlightReel.active
                  ? 'bg-[rgba(129,140,248,0.12)] text-[#818cf8] hover:bg-[rgba(129,140,248,0.22)]'
                  : 'bg-[#818cf8] text-white shadow-sm hover:bg-[#6c78de]',
                !highlightReel.enabled && 'opacity-40 cursor-not-allowed hover:bg-[#818cf8]'
              )}
            >
              <Zap className="h-3 w-3" aria-hidden="true" />
              {t('learning.highlightReel')}
            </button>
          </div>
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto scrollbar-pro"
        onMouseEnter={() => setActiveRegion('book-index')}
      >
        {centerViewMode === 'note' ? (
          <NoteEditorView
            editor={noteDoc.editor}
            loading={noteDoc.loading}
            error={noteDoc.error}
            isEditing={noteDoc.isEditing}
            setIsEditing={noteDoc.setIsEditing}
            restoreOriginal={noteDoc.restoreOriginal}
            hasBook={Boolean(book?.book?.chapters?.length)}
          />
        ) : (
          // CP445.x — 본문 영역 max-width = 영상 (49.5vh*16/9) 동일 + mx-auto
          // 좌우 정렬. 영상 ↔ AI요약/섹션 시각 일관성.
          <div className="mx-auto w-full p-4" style={{ maxWidth: 'calc(49.5vh * 16 / 9)' }}>
            {centerTab === 'summary' && (
              <PanelAISummary videoSummary={undefined} videoUrl={videoUrl} />
            )}
            {centerTab === 'section' &&
              (activeSection ? (
                <SectionContentView
                  chapter={activeSection.chapter}
                  section={activeSection.section}
                  mandalaId={mandalaId}
                />
              ) : (
                <div className="text-[12px] text-muted-foreground">
                  {t('learning.noActiveSection', '좌측 북인덱스에서 섹션을 선택하세요.')}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionContentView({
  chapter,
  section,
  mandalaId,
}: {
  chapter: MandalaBookChapter;
  section: MandalaBookSection;
  mandalaId: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t('learning.chapterLabel', { n: chapter.ch + 1 })}
        </p>
        <h2 className="mt-1 text-[16px] font-semibold text-foreground">{chapter.title}</h2>
      </div>
      <div>
        <h3 className="text-[14px] font-semibold text-foreground">{section.title}</h3>
        {section.narrative && (
          <p className="mt-2 text-[13px] leading-[1.6] text-foreground/80">{section.narrative}</p>
        )}
      </div>
      {section.atoms && section.atoms.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t('learning.atomsLabel')}
          </p>
          <ul className="mt-2 space-y-1.5">
            {section.atoms.map((atom, idx) => (
              <li key={idx} className="text-[12px] leading-[1.5] text-foreground/75">
                <span className="text-muted-foreground/60 mr-1">·</span>
                {atom.text}
                {atom.vid && Number.isFinite(atom.ts) && (
                  <Link
                    to={`/learning/${mandalaId}/${atom.vid}?t=${Math.floor(atom.ts ?? 0)}`}
                    className="ml-1 inline-block rounded-[3px] bg-[rgba(129,140,248,0.15)] px-1 font-mono text-[10px] text-[#818cf8]"
                  >
                    {`▶ ${Math.floor((atom.ts ?? 0) / 60)}:${String(Math.floor((atom.ts ?? 0) % 60)).padStart(2, '0')}`}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {section.qa && section.qa.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t('learning.qaLabel')}
          </p>
          <ul className="mt-2 space-y-3">
            {section.qa.map((item, idx) => (
              <li key={idx} className="text-[12px] leading-[1.5]">
                <p className="font-semibold text-foreground">Q. {item.q}</p>
                <p className="mt-1 text-foreground/75">A. {item.a}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Exported for LearningPage toprow mount (CP445 B2 / Phase 6).
export function ViewModeToggle({
  mode,
  onChange,
  noteDisabled = false,
}: {
  mode: 'player' | 'note';
  onChange: (mode: 'player' | 'note') => void;
  noteDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const items: Array<{
    id: 'player' | 'note';
    labelKey: string;
    Icon: typeof Play;
  }> = [
    { id: 'player', labelKey: 'learning.viewModePlayer', Icon: Play },
    { id: 'note', labelKey: 'learning.viewModeNote', Icon: BookOpen },
  ];
  return (
    <div className="flex items-center gap-0.5 self-center rounded-md border border-border bg-secondary/30 p-0.5">
      {items.map(({ id, labelKey, Icon }) => {
        const dimmed = id === 'note' && noteDisabled;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-[12px] transition-colors',
              mode === id
                ? 'bg-background text-foreground font-semibold shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
              dimmed && 'opacity-50'
            )}
            aria-pressed={mode === id}
            aria-disabled={dimmed}
          >
            <Icon className="h-3 w-3" />
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CP445 Phase 5 — TipTap-based note editor view (replaces static NoteView).
// ---------------------------------------------------------------------------

const NOTE_PROSE_STYLE = `
.note-prose-root .ProseMirror {
  font-family: 'Source Serif 4', 'Noto Serif KR', Georgia, serif;
  font-size: 18px;
  line-height: 1.78;
  letter-spacing: -0.003em;
  color: hsl(var(--foreground));
  /* CP445.x v3(1) — max-width 제거 (중앙 column 가용 폭 전체). padding
     48px 48px 140px (mockup spec). */
  padding: 48px 48px 140px;
  outline: none;
  word-break: keep-all;
}
.note-prose-root .ProseMirror h2 {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.22;
  letter-spacing: -0.015em;
  margin: 0 0 16px;
  color: hsl(var(--foreground));
}
.note-prose-root .ProseMirror h3 {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 21px;
  font-weight: 500;
  line-height: 1.3;
  letter-spacing: -0.01em;
  margin: 0 0 24px;
  color: hsl(var(--foreground));
}
.note-prose-root .ProseMirror p {
  margin: 0 0 1.6em;
  color: hsl(var(--foreground) / 0.92);
}
.note-prose-root .ProseMirror p strong {
  font-weight: 600;
  color: hsl(var(--foreground));
}
.note-prose-root .ProseMirror p em:only-child {
  /* Eyebrow paragraph (italic-only by generator convention) — sans, 11px,
     uppercase, tertiary color. */
  font-style: normal;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
}
/* CP445.x v3(2) — eyebrow paragraphs hidden in read mode; visible only
   when the editor wrapper has class "editing" (toggled from isEditing). */
.note-prose-root:not(.editing) .ProseMirror p:has(> em:only-child) {
  display: none;
}
.note-prose-root .ProseMirror hr {
  border: none;
  border-top: 0.5px solid hsl(var(--border));
  margin: 3.2em 0;
}
.note-prose-root .ProseMirror blockquote {
  border-left: 2.5px solid rgba(129, 140, 248, 0.4);
  padding: 2px 0 2px 24px;
  color: hsl(var(--foreground) / 0.75);
  margin: 2em 0 2.2em;
  font-style: italic;
  font-family: 'Source Serif 4', 'Noto Serif KR', Georgia, serif;
  font-size: 18px;
  line-height: 1.78;
  letter-spacing: -0.003em;
}
.note-prose-root .ProseMirror code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 14px;
  background: hsl(var(--secondary));
  padding: 1px 5px;
  border-radius: 3px;
}
.note-prose-root .ProseMirror a {
  color: #818cf8;
  text-decoration: underline;
}
.note-prose-root .ProseMirror[contenteditable='false'] p:hover,
.note-prose-root .ProseMirror[contenteditable='false'] h2:hover,
.note-prose-root .ProseMirror[contenteditable='false'] h3:hover {
  background: transparent;
}
.note-prose-root .ProseMirror[contenteditable='true'] p:focus,
.note-prose-root .ProseMirror[contenteditable='true'] h2:focus,
.note-prose-root .ProseMirror[contenteditable='true'] h3:focus {
  outline: 1.5px solid #818cf8;
  outline-offset: 2px;
  border-radius: 3px;
}

/* CP445.x — VideoBlock styling (mockup-aligned, inline-iframe ready). */
/* CP445.x v3(2) — 영상만 560px 컴팩트 중앙 정렬. 본문 텍스트는 가용 폭 전체. */
.note-prose-root .video-block-wrap {
  margin: 18px auto 6px;
  max-width: 560px;
}
.note-prose-root .video-block-frame {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: none;
  padding: 0;
  background: #111;
  overflow: hidden;
  cursor: pointer;
}
.note-prose-root .video-block-frame--active {
  cursor: default;
}
.note-prose-root .video-block-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
.note-prose-root .video-block-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.85;
  transition: opacity 0.2s;
}
.note-prose-root .video-block-frame:hover .video-block-thumb {
  opacity: 1;
}
.note-prose-root .video-block-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.30));
}
.note-prose-root .video-block-play {
  position: absolute;
  top: 50%;
  left: 50%;
  /* CP445.x v3(2) — 48px (이전 52px) — 컴팩트 frame 에 비례. */
  width: 48px;
  height: 48px;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.10);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 50%;
  color: #fff;
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
}
.note-prose-root .video-block-play-icon {
  width: 18px;
  height: 18px;
  fill: currentColor;
  stroke: none;
  margin-left: 1px;
}
.note-prose-root .video-block-frame:hover .video-block-play {
  transform: translate(-50%, -50%) scale(1.08);
  background: rgba(255, 255, 255, 0.18);
}
.note-prose-root .video-block-ts {
  position: absolute;
  bottom: 10px;
  right: 10px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  padding: 2px 7px;
  border-radius: 4px;
  pointer-events: none;
}
.note-prose-root .video-block-caption {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  text-align: center;
  margin: 0 0 28px;
}
`;

function NoteEditorView({
  editor,
  loading,
  error,
  isEditing,
  setIsEditing,
  restoreOriginal,
  hasBook,
}: {
  editor: Editor | null;
  loading: boolean;
  error: boolean;
  isEditing: boolean;
  setIsEditing: (next: boolean) => void;
  restoreOriginal: () => Promise<void>;
  hasBook: boolean;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        {t('learning.noteLoading')}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        {t('learning.noteLoadError')}
      </div>
    );
  }
  if (!hasBook) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
        {t('learning.bookNotReady')}
      </div>
    );
  }
  if (!editor) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        {t('learning.editorPreparing')}
      </div>
    );
  }
  return (
    <div className={cn('relative note-prose-root', isEditing && 'editing')}>
      <style>{NOTE_PROSE_STYLE}</style>
      <NoteToolbar
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        restoreOriginal={restoreOriginal}
        editor={editor}
      />
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * CP445.x v3(1) — single [편집/완료] toggle + divider + [⋯] dropdown.
 * Dropdown items: Markdown / HTML download + 0.5px divider + 원본 복원 (red).
 * Silent auto-save (no inline dot indicator); failure surfaces via toast
 * from the parent useEffect.
 */
function NoteToolbar({
  isEditing,
  setIsEditing,
  restoreOriginal,
  editor,
}: {
  isEditing: boolean;
  setIsEditing: (next: boolean) => void;
  restoreOriginal: () => Promise<void>;
  editor: Editor;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // CP443 lesson — outside-close uses `click` (not mousedown) to avoid races
  // with TipTap / dnd-kit pointerdown event paths.
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleRestore = async () => {
    if (!window.confirm(t('learning.restoreConfirm'))) {
      return;
    }
    try {
      await restoreOriginal();
      toast.success(t('learning.restoreSuccess'));
    } catch {
      toast.error(t('learning.restoreError'));
    }
  };

  const downloadBlob = (content: string, mime: string, ext: string) => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `note-${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMarkdown = () => {
    try {
      downloadBlob(exportToMarkdown(editor.getJSON() as TiptapDoc), 'text/markdown', 'md');
    } catch {
      toast.error(t('learning.markdownExportError'));
    }
  };

  const handleExportHtml = () => {
    try {
      downloadBlob(exportToHtml(editor), 'text/html', 'html');
    } catch {
      toast.error(t('learning.htmlExportError'));
    }
  };

  return (
    <div className="pointer-events-none sticky top-0 z-20 flex justify-end pb-9">
      <div
        ref={containerRef}
        className="pointer-events-auto relative inline-flex items-center gap-0.5 rounded-md border border-border bg-background/85 px-1 py-0.5 backdrop-blur-md"
      >
        <button
          type="button"
          onClick={() => setIsEditing(!isEditing)}
          className="flex items-center gap-1 rounded px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <Pencil className="h-3.5 w-3.5" />
          {isEditing ? t('learning.editorDone') : t('learning.editorEdit')}
        </button>
        <span className="mx-0.5 h-4 w-[0.5px] bg-border" aria-hidden />
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="More"
          aria-expanded={menuOpen}
          className="flex items-center rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-9 z-30 min-w-[180px] rounded-md border border-border bg-background/95 p-1 shadow-md backdrop-blur-md"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                handleExportMarkdown();
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-1.5 rounded px-2.5 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              {t('learning.downloadMarkdown')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                handleExportHtml();
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-1.5 rounded px-2.5 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <FileText className="h-3.5 w-3.5" />
              {t('learning.downloadHtml')}
            </button>
            <div className="my-1 h-[0.5px] bg-border" aria-hidden />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                handleRestore();
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-1.5 rounded px-2.5 py-1.5 text-left text-[12px] text-destructive transition-colors hover:bg-destructive/10"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('learning.restoreOriginal')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
