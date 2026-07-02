import { markOnboardingTask } from '@/features/onboarding';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  Zap,
  BookText,
  List,
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
import { LearningShareMenu } from '@/features/learning-share';
import { useMandalaBook } from '@/features/mandala/model/useMandalaBook';
import { useRichSummary } from '@/features/video-side-panel/model/useRichSummary';
import { useHighlightReel, HIGHLIGHT_RELEVANCE_THRESHOLD } from '../model/useHighlightReel';
import { useMandalaCards } from '../model/useMandalaCards';
import { FloatingVideoNavigator } from './FloatingVideoNavigator';
import {
  relevanceLevel,
  relevanceCssVar,
  relevanceBars,
  type RelevanceLevel,
} from '../lib/relevance-level';
import { useLearningStore } from '@/pages/learning/model/useLearningStore';
import { useNoteDocument } from '@/pages/learning/model/useNoteDocument';
import { useNoteAutoFollow } from '@/pages/learning/model/useNoteAutoFollow';
import { exportToMarkdown, exportToHtml } from '@/pages/learning/lib/note-export';
import { cn } from '@/shared/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import type {
  MandalaBookChapter,
  MandalaBookSection,
  VideoRichSummarySection,
} from '@/shared/lib/api-client';
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
}

type CenterTabId = 'chapters' | 'summary' | 'section';

function formatMMSS(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

/** Mockup chapter time format — unpadded minutes ("0:00", "12:00"). */
function fmtChapterTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const YT_ID_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/;

export function CenterPanel({
  mandalaId,
  videoId,
  playerRef,
  shouldAutoplay = false,
  onUserPlayed,
  onPlayStateChange,
  startTime,
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
  const setActiveSection = useLearningStore((s) => s.setActiveSection);
  const setActiveRegion = useLearningStore((s) => s.setActiveRegion);
  // scrollspy guard — marks the "ch:sec" that was set BY scrolling, so the
  // scroll-to effect below doesn't re-scroll (which would fight free scrolling).
  const scrollSpyRef = useRef<string | null>(null);
  const setPlayerState = useLearningStore((s) => s.setPlayerState);
  const setCenterViewMode = useLearningStore((s) => s.setCenterViewMode);
  const playerDurationSec = useLearningStore((s) => s.playerDurationSec);
  const { book, isLoading: bookLoading } = useMandalaBook(mandalaId);
  const setActiveNoteVideoKey = useLearningStore((s) => s.setActiveNoteVideoKey);
  const noteAutoFollowEnabled = useLearningStore((s) => s.noteAutoFollowEnabled);
  const setNoteAutoFollow = useLearningStore((s) => s.setNoteAutoFollow);
  // Video meta header (mockup ②) — title from the mandala card set.
  const { cards } = useMandalaCards(mandalaId);
  const currentCard = cards.find((c) => c.videoUrl.match(YT_ID_RE)?.[1] === videoId);
  // Floating navigator expand state — breadcrumb hides while expanded.
  const [navExpanded, setNavExpanded] = useState(false);

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

  // Onboarding task detection — summary tab visible / note view entered.
  useEffect(() => {
    if (centerTab === 'summary') markOnboardingTask('summary');
  }, [centerTab]);
  useEffect(() => {
    if (centerViewMode === 'note') markOnboardingTask('note');
  }, [centerViewMode]);

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
    const key = `${activeSectionRef.chapterIdx}:${activeSectionRef.sectionIdx}`;
    // Scroll-driven change (from the scrollspy below) → do NOT re-scroll, just
    // clear the marker. Only click-driven changes (TOC) scroll into view.
    if (scrollSpyRef.current === key) {
      scrollSpyRef.current = null;
      return;
    }
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

  // Scrollspy — observe section <h3> headings; the topmost one in view drives
  // the active section (→ left TOC highlight + chatbot "지금 읽는 구간", both
  // derived from activeSectionRef). Read-position sync that was missing; the
  // §2 VIDEO auto-follow (useNoteAutoFollow) is separate and untouched.
  useEffect(() => {
    if (centerViewMode !== 'note' || !noteDoc.editor || !book?.book) return;
    const editorEl = noteDoc.editor.view.dom as HTMLElement;
    // Flat list of {ch, sec} in the same order the generator emits <h3>s.
    const chapters = (book.book.chapters ?? []).slice().sort((a, b) => (a.ch ?? 0) - (b.ch ?? 0));
    const flat: Array<{ ch: number; sec: number }> = [];
    for (const ch of chapters) {
      const n = ch.sections?.length ?? 0;
      for (let s = 0; s < n; s++) flat.push({ ch: ch.ch, sec: s });
    }
    const h3s = Array.from(editorEl.querySelectorAll('h3'));
    if (h3s.length === 0 || flat.length === 0) return;

    // Find the editor's scroll container so visibility is relative to it.
    let root: HTMLElement | null = editorEl.parentElement;
    while (root && root !== document.body) {
      const oy = getComputedStyle(root).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && root.scrollHeight > root.clientHeight) break;
      root = root.parentElement;
    }
    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = h3s.indexOf(e.target as HTMLElement);
          if (i < 0) continue;
          if (e.isIntersecting) visible.add(i);
          else visible.delete(i);
        }
        if (visible.size === 0) return;
        const topIdx = Math.min(...visible);
        const ref = flat[topIdx];
        if (!ref) return;
        const cur = useLearningStore.getState().activeSectionRef;
        if (cur && cur.chapterIdx === ref.ch && cur.sectionIdx === ref.sec) return;
        scrollSpyRef.current = `${ref.ch}:${ref.sec}`; // mark scroll-driven (no re-scroll)
        setActiveSection({ chapterIdx: ref.ch, sectionIdx: ref.sec });
      },
      { root: root ?? null, rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );
    h3s.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [centerViewMode, noteDoc.editor, book, setActiveSection]);

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
    { id: 'chapters', labelKey: 'learning.tabChapters', fallback: '챕터', icon: List },
    { id: 'summary', labelKey: 'learning.tabSummary', fallback: 'AI 요약', icon: Sparkles },
    { id: 'section', labelKey: 'learning.tabSection', fallback: '섹션 내용', icon: BookText },
  ];

  // Chapters = v2 segment sections (same source as the highlight reel).
  const chapterSections = (highlightSections ?? [])
    .filter((s) => s.to_sec > s.from_sec)
    .slice()
    .sort((a, b) => a.from_sec - b.from_sec);

  const handleModeChange = (mode: 'player' | 'note') => {
    if (mode === 'note' && !bookLoading && !book) {
      toast(t('learning.noteNotReady', '노트가 아직 생성되지 않았어요'));
      return;
    }
    setCenterViewMode(mode);
  };

  return (
    <div
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
      // [VIDEO-VIEW] mockup center bg — subtle top glow over near-black.
      style={{
        background: 'radial-gradient(110% 60% at 50% 0%, var(--lp-bg-1) 0%, var(--lp-bg-0) 55%)',
      }}
    >
      {/* Top bar (mockup ①) — navigator + breadcrumb left, ⚡/share/mode-toggle
          right. Rendered in BOTH modes: single home of the mode toggle. */}
      <div className="flex h-[60px] shrink-0 items-center justify-between gap-3 px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {centerViewMode === 'player' && (
            <FloatingVideoNavigator
              mandalaId={mandalaId}
              currentVideoId={videoId}
              expanded={navExpanded}
              onExpandedChange={setNavExpanded}
            />
          )}
          {!(navExpanded && centerViewMode === 'player') && activeSection && (
            <div className="flex min-w-0 items-center gap-2.5 text-[12.5px] text-[var(--lp-faint)]">
              <span className="shrink-0 font-semibold text-[var(--lp-accent)]">
                {t('learning.topicGroup', '주제군')}{' '}
                {String((activeSection.chapter.ch ?? 0) + 1).padStart(2, '0')}
              </span>
              <span aria-hidden>·</span>
              <span className="truncate">{activeSection.chapter.title}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* While the navigator strip is expanded, yield width to it — hide the
              secondary reel/share cluster (mode toggle stays). */}
          {centerViewMode === 'player' && !navExpanded && (
            <>
              {highlightReel.enabled && (
                <span
                  className={cn(
                    'text-[11px] tabular-nums font-medium transition-colors',
                    highlightReel.active ? 'text-[var(--lp-strong)]' : 'text-[var(--lp-dim)]'
                  )}
                  aria-live="polite"
                >
                  {formatMMSS(
                    highlightReel.active ? highlightReel.remainingSec : highlightReel.totalSec
                  )}
                </span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={highlightReel.active ? highlightReel.stop : highlightReel.start}
                    disabled={!highlightReel.enabled}
                    aria-label={t('learning.highlightReel')}
                    className={cn(
                      'inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                      highlightReel.active
                        ? 'text-[var(--lp-strong)] hover:bg-white/10'
                        : 'text-[var(--lp-dim)] hover:bg-white/10 hover:text-[var(--lp-strong)]',
                      !highlightReel.enabled && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    <Zap className="h-[18px] w-[18px]" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[12px] max-w-[280px]">
                  {!highlightReel.enabled
                    ? t('learning.highlightReelDisabledTooltip', {
                        threshold: HIGHLIGHT_RELEVANCE_THRESHOLD,
                      })
                    : highlightReel.active
                      ? t('learning.highlightReelActiveTooltip')
                      : t('learning.highlightReelReadyTooltip', {
                          count: highlightReel.highlights.length,
                        })}
                </TooltipContent>
              </Tooltip>
            </>
          )}
          {!navExpanded && <LearningShareMenu mandalaId={mandalaId} videoId={videoId} />}
          <ViewModeToggle
            mode={centerViewMode}
            noteDisabled={!bookLoading && !book}
            onChange={handleModeChange}
          />
        </div>
      </div>

      {/* Player — kept MOUNTED in note mode (CP442 mount-preserve), hidden via CSS.
          The wrapper now lives inside the scrolling 880px column below, so in note
          mode we render it here hidden to preserve the iframe instance. */}
      <div
        className="flex-1 overflow-y-auto scrollbar-pro"
        onMouseEnter={() => setActiveRegion('book-index')}
      >
        <div
          className={cn(
            'mx-auto w-full max-w-[880px] px-10 pb-[120px] pt-[18px]',
            centerViewMode === 'note' && 'hidden'
          )}
        >
          {/* Video meta header (mockup ②) */}
          <div className="mb-[18px] flex items-center gap-[13px]">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] text-[var(--lp-avatar-fg)]"
              style={{ background: 'var(--lp-avatar-grad)' }}
              aria-hidden
            >
              {(currentCard?.title ?? 'Y').slice(0, 1)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[17px] font-semibold leading-[1.35] tracking-[-0.01em] text-[var(--lp-strong)]">
                {currentCard?.title ?? t('learning.videoFallbackTitle', '영상')}
              </div>
              <div className="mt-0.5 text-[12.5px] text-[var(--lp-faint)]">
                YouTube{playerDurationSec > 0 ? ` · ${fmtChapterTime(playerDurationSec)}` : ''}
              </div>
            </div>
          </div>

          {/* Player hero frame (mockup ③ outer frame; custom chrome = Phase 4) */}
          <div
            className="overflow-hidden rounded-2xl border border-[var(--lp-line-8)] bg-black"
            style={{ boxShadow: 'var(--lp-player-shadow)' }}
            onMouseEnter={() => setActiveRegion('player')}
          >
            <PanelVideoPlayer
              videoUrl={videoUrl}
              playerRef={playerRef}
              shouldAutoplay={shouldAutoplay}
              onUserPlayed={onUserPlayed}
              onPlayStateChange={onPlayStateChange}
              onTimeUpdate={setPlayerState}
              startTime={startTime}
              fill
            />
          </div>

          {/* Tab switch row (mockup ④) — segment tabs + relevance legend */}
          <div className="mb-1.5 mt-[30px] flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1 rounded-[10px] border border-[var(--lp-line-7)] bg-[var(--lp-surface)] p-1">
              {tabs.map(({ id, labelKey, fallback, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setCenterTab(id)}
                  className={cn(
                    'flex items-center gap-[7px] rounded-[7px] px-4 py-2 text-[13.5px] font-semibold transition-colors',
                    centerTab === id
                      ? 'bg-[var(--lp-toggle-active-bg)] text-[var(--lp-tab-active-fg)]'
                      : 'text-[var(--lp-dim)] hover:text-[var(--lp-strong)]'
                  )}
                >
                  <Icon className="h-[15px] w-[15px]" />
                  {t(labelKey, fallback)}
                </button>
              ))}
            </div>
            {chapterSections.length > 0 && (
              <div className="flex items-center gap-[13px] text-[11.5px] text-[var(--lp-faint)]">
                <div className="flex items-center gap-[9px]">
                  <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--lp-mute)]">
                    {t('learning.relevanceLabel', '관련도')}
                  </span>
                  <span className="text-[10.5px] text-[var(--lp-mute)]">
                    {t('learning.relevanceLow', '낮음')}
                  </span>
                  <RelevanceMeter level="low" />
                  <RelevanceMeter level="mid" />
                  <RelevanceMeter level="high" />
                  <span className="text-[10.5px] text-[var(--lp-mute)]">
                    {t('learning.relevanceHigh', '높음')}
                  </span>
                </div>
                <span className="h-[11px] w-px bg-white/10" aria-hidden />
                <span>
                  {t('learning.chaptersCount', '{{count}}개 챕터', {
                    count: chapterSections.length,
                  })}
                </span>
              </div>
            )}
          </div>

          {/* Panels */}
          {centerTab === 'chapters' && (
            <ChapterList
              sections={chapterSections}
              playerRef={playerRef}
              onUserPlayed={onUserPlayed}
              onGoSummary={() => setCenterTab('summary')}
            />
          )}
          {centerTab === 'summary' && (
            <div data-onboarding="ai-summary" className="mt-[18px]">
              <PanelAISummary videoSummary={undefined} videoUrl={videoUrl} />
            </div>
          )}
          {centerTab === 'section' && (
            <div className="mt-[18px]">
              {activeSection ? (
                <SectionContentView
                  chapter={activeSection.chapter}
                  section={activeSection.section}
                  mandalaId={mandalaId}
                />
              ) : (
                <div className="text-[12px] text-muted-foreground">
                  {t('learning.noActiveSection', '좌측 북인덱스에서 섹션을 선택하세요.')}
                </div>
              )}
            </div>
          )}
        </div>

        {centerViewMode === 'note' ? (
          <>
            {/* §1④ PR2 — "준비 중": when the book is still filling (v2 pending),
                show progress instead of letting empty chapters read as a bug. */}
            {(book?.coverage?.v2Pending ?? 0) > 0 && (
              <div className="mx-auto mt-3 flex max-w-[680px] items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.03] px-3.5 py-2 text-[12px] text-muted-foreground">
                <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                <span>
                  {book?.coverage?.v2Pending}개 영상이 북인덱스에 추가되는 중이에요 ·{' '}
                  {book?.coverage?.v2Done}/{book?.coverage?.gatePassed} 완료
                </span>
              </div>
            )}
            {/* PR3b — note is behind the (settled) book: new cards/translations
                landed after this note was generated. User-triggered refresh only
                (no auto-overwrite); edits are preserved on regenerate. */}
            {/* CP504 — show the refresh affordance whenever the note is stale
                (book version > note's based_on version). The old `v2Pending === 0`
                gate hid it for the entire enrich window, so a note built early
                (e.g. v3) could never refresh to a newer book (v6) while videos
                without captions kept v2Pending perpetually > 0. A stale note
                should always be refreshable to the CURRENT book. */}
            {noteDoc.stale && (
              <div className="mx-auto mt-3 flex max-w-[680px] items-center justify-between gap-3 rounded-md border border-white/[0.07] bg-white/[0.03] px-3.5 py-2 text-[12px] text-muted-foreground">
                <span>새 내용이 북인덱스에 추가됐어요. 노트를 새로고침하면 반영됩니다.</span>
                <button
                  type="button"
                  onClick={() => void noteDoc.regenerate()}
                  disabled={noteDoc.regenerating}
                  className="shrink-0 rounded-md border border-white/[0.12] px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-white/[0.06] disabled:opacity-50"
                >
                  {noteDoc.regenerating ? '새로고침 중…' : '새로고침'}
                </button>
              </div>
            )}
            <NoteEditorView
              editor={noteDoc.editor}
              loading={noteDoc.loading}
              error={noteDoc.error}
              isEditing={noteDoc.isEditing}
              setIsEditing={noteDoc.setIsEditing}
              restoreOriginal={noteDoc.restoreOriginal}
              hasBook={Boolean(book?.book?.chapters?.length)}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** 3-bar ascending signal meter — wordless relevance indicator (mockup ⑤). */
function RelevanceMeter({ level }: { level: RelevanceLevel }) {
  const lit = relevanceBars(level);
  const color = relevanceCssVar(level);
  return (
    <span className="inline-flex h-[11px] items-end gap-[2.5px]" aria-hidden>
      {[5, 8, 11].map((h, k) => (
        <span
          key={h}
          className="w-[3px] rounded-[1px]"
          style={{ height: h, background: k < lit ? color : 'var(--lp-meter-off)' }}
        />
      ))}
    </span>
  );
}

/** Chapter list (mockup ⑤) — v2 segment sections with time range, relevance
 *  edge/meter, hover-expand description, click-to-seek. Subscribes to player
 *  time HERE so the 1s tick re-renders only this list. */
function ChapterList({
  sections,
  playerRef,
  onUserPlayed,
  onGoSummary,
}: {
  sections: VideoRichSummarySection[];
  playerRef: React.MutableRefObject<YTPlayer | null>;
  onUserPlayed?: () => void;
  onGoSummary: () => void;
}) {
  const { t } = useTranslation();
  const playerTimeSec = useLearningStore((s) => s.playerTimeSec);
  const playerState = useLearningStore((s) => s.playerState);

  if (sections.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-[var(--lp-line-6)] bg-[var(--lp-surface)] px-5 py-6 text-center">
        <p className="text-[13px] leading-[1.6] text-[var(--lp-dim)]">
          {t(
            'learning.chaptersEmpty',
            '챕터 정보가 아직 준비되지 않았어요. AI 요약이 생성되면 챕터가 나타납니다.'
          )}
        </p>
        <button
          type="button"
          onClick={onGoSummary}
          className="mt-3 rounded-md border border-[var(--lp-line-8)] px-3 py-1.5 text-[12px] text-[var(--lp-text)] transition-colors hover:bg-[var(--lp-hover-tint)]"
        >
          {t('learning.tabSummary', 'AI 요약')}
        </button>
      </div>
    );
  }

  const activeIdx = sections.findIndex(
    (s) => playerTimeSec >= s.from_sec && playerTimeSec < s.to_sec
  );

  return (
    <div className="mt-3.5 flex flex-col">
      {sections.map((s, i) => {
        const level = typeof s.relevance_pct === 'number' ? relevanceLevel(s.relevance_pct) : null;
        const color = level ? relevanceCssVar(level) : 'var(--lp-meter-off)';
        const active = i === activeIdx;
        const playing = active && playerState === 'playing';
        return (
          <button
            key={`${s.from_sec}-${i}`}
            type="button"
            onClick={() => {
              try {
                playerRef.current?.seekTo(s.from_sec, true);
                playerRef.current?.playVideo?.();
                onUserPlayed?.();
              } catch {
                // player not ready
              }
            }}
            className={cn(
              'group relative flex w-full gap-4 rounded-xl border px-4 py-3.5 pl-[18px] text-left transition-colors',
              active
                ? 'border-[var(--lp-accent-border)] bg-[var(--lp-accent-tint)]'
                : 'border-transparent hover:bg-[var(--lp-hover-tint)]'
            )}
          >
            <span
              className="absolute bottom-3.5 left-0 top-3.5 w-[3px] rounded-[3px] transition-opacity"
              style={{ background: color, opacity: active ? 1 : 0.55 }}
              aria-hidden
            />
            <span
              className={cn(
                'w-[88px] shrink-0 pt-px text-[13px] font-semibold tabular-nums tracking-[0.01em]',
                active ? 'text-[var(--lp-accent)]' : 'text-[var(--lp-dim)]'
              )}
            >
              {fmtChapterTime(s.from_sec)}–{fmtChapterTime(s.to_sec)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-[9px]">
                <span
                  className={cn(
                    'text-[11px] font-bold tabular-nums',
                    active ? 'text-[var(--lp-accent)]' : 'text-[var(--lp-num)]'
                  )}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className={cn(
                    'text-[15px] font-semibold leading-[1.4] tracking-[-0.01em]',
                    active ? 'text-[var(--lp-strong)]' : 'text-[var(--lp-text)]'
                  )}
                >
                  {s.title}
                </span>
                {playing && (
                  <span className="flex shrink-0 items-center gap-[5px] whitespace-nowrap text-[10.5px] font-semibold text-[var(--lp-accent)]">
                    <span
                      className="h-[5px] w-[5px] rounded-full bg-[var(--lp-accent)]"
                      aria-hidden
                    />
                    {t('learning.playingNow', '재생 중')}
                  </span>
                )}
              </span>
              {s.summary && (
                <span
                  className={cn(
                    'block overflow-hidden text-[13.5px] leading-[1.65] text-[var(--lp-desc)] transition-all duration-300',
                    active
                      ? 'mt-[7px] max-h-[60px] opacity-100'
                      : 'mt-0 max-h-0 opacity-0 group-hover:mt-[7px] group-hover:max-h-[60px] group-hover:opacity-100'
                  )}
                >
                  {s.summary}
                </span>
              )}
            </span>
            {level && (
              <span className="shrink-0 self-center pt-px">
                <RelevanceMeter level={level} />
              </span>
            )}
          </button>
        );
      })}
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
                    className="ml-1 inline-block rounded-[3px] bg-white/10 px-1 font-mono text-[10px] text-white/80"
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
    // [VIDEO-VIEW] mockup skin — dark pill container, active item flips to a
    // light chip with dark text.
    <div className="flex shrink-0 items-center rounded-[9px] border border-[var(--lp-line-8)] bg-[var(--lp-surface-2)] p-[3px]">
      {items.map(({ id, labelKey, Icon }) => {
        const dimmed = id === 'note' && noteDisabled;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={cn(
              'flex items-center gap-1.5 rounded-[7px] px-[13px] py-1.5 text-[13px] transition-colors',
              mode === id
                ? 'bg-[var(--lp-toggle-active-bg)] font-semibold text-[var(--lp-toggle-active-fg)]'
                : 'text-[var(--lp-dim)] hover:text-[var(--lp-strong)]',
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
/* §-redesign — editorial note prose (시안 spec). Color/font tokens come from
   .note-mode (index.css); this block styles the TipTap document + inline players. */
.note-prose-root .ProseMirror {
  /* Korean longform: 16.5px (≈ Medium 18px English feel — Korean glyphs are
     denser, so 19px read as a picture-book). line-height kept generous. */
  font-family: var(--nm-serif);
  font-size: 16.5px;
  line-height: 1.9;
  letter-spacing: 0.001em;
  color: var(--nm-text);
  max-width: 680px;
  margin: 0 auto;
  padding: 64px 24px 200px;
  outline: none;
  word-break: keep-all;
}
.note-prose-root .ProseMirror h2 {
  /* chapter doc-title — 29px (Korean-comfortable; 40px read oversized). */
  font-family: var(--nm-serif);
  font-weight: 700;
  font-size: 29px;
  line-height: 1.24;
  letter-spacing: -0.018em;
  margin: 8px 0 14px;
  color: var(--nm-strong);
}
.note-prose-root .ProseMirror h3 {
  font-family: var(--nm-serif);
  font-weight: 700;
  font-size: 21px;
  line-height: 1.36;
  letter-spacing: -0.012em;
  margin: 64px 0 22px;
  color: var(--nm-strong);
}
.note-prose-root .ProseMirror p {
  margin: 0 0 1.55em;
  color: var(--nm-text);
}
/* C8 — keyword highlight (NOT plain bold): subtle gold tint block, distinct from
   the code chip (no border, sans). Sparse by the generator heuristic. */
.note-prose-root .ProseMirror p strong {
  font-weight: 500;
  color: var(--nm-gold-text, #e7c79a);
  background: rgba(194, 168, 120, 0.13);
  padding: 0 3px;
  border-radius: 3px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
/* B5 — sec-eyebrow ("N.N · 다음 토픽" = em-only paragraph right before an h3) is
   an editing index; hide it in READ mode. kicker(before doc-meta)+doc-meta stay. */
.note-prose-root:not(.editing) .ProseMirror p:has(> em:only-child):has(+ h3) {
  display: none;
}
/* A4 — keypoint inner paragraph: kill the body 1.55em margin so the quote has no
   leading gap under the "핵심 포인트" label. */
.note-prose-root .ProseMirror blockquote p { margin: 0; }
.note-prose-root .ProseMirror p em:only-child {
  /* editorial label (kicker / sec-eyebrow) — gold, uppercase, small. Visible in
     BOTH read & edit mode (these are design labels, not editing-only eyebrows). */
  font-style: normal;
  font-family: var(--nm-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nm-accent);
  margin: 0 0 14px;
}
/* doc-meta = the italic paragraph immediately AFTER the kicker (영상 N · 토픽 N).
   Dimmer, not uppercase, sits under the kicker as a meta dot-row (시안 doc-meta). */
.note-prose-root .ProseMirror p:has(> em:only-child) + p:has(> em:only-child) em:only-child {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
  font-size: 12.5px;
  color: var(--nm-dim);
}
.note-prose-root .ProseMirror p:has(> em:only-child) + p:has(> em:only-child) {
  /* pull up under the kicker + 1px hairline rule below (시안 doc-meta 하단 rule) */
  margin: -8px 0 0;
  padding-bottom: 22px;
  border-bottom: 1px solid var(--nm-line);
}
.note-prose-root .ProseMirror p:has(> em:only-child) + p:has(> em:only-child) + * {
  margin-top: 32px; /* breathing room after the meta rule */
}
.note-prose-root .ProseMirror hr {
  border: none;
  border-top: 1px solid var(--nm-line);
  margin: 64px 0;
}
.note-prose-root .ProseMirror blockquote {
  border-left: 2px solid var(--nm-accent);
  padding: 2px 0 2px 26px;
  margin: 40px 0;
  color: var(--nm-strong);
  font-style: normal;
  font-family: var(--nm-serif);
  font-weight: 500;
  font-size: 17.5px;
  line-height: 1.7;
}
/* NOTE-DENSITY ① (revised) — "핵심 포인트" label gated to the generated key-point
   quote (data-keypoint) so plain markdown quotes from narrative stay UNlabeled. */
.note-prose-root .ProseMirror blockquote[data-keypoint="true"]::before {
  content: "핵심 포인트";
  display: block;
  font-family: var(--nm-sans);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nm-accent);
  margin-bottom: 10px;
}
.note-prose-root .ProseMirror code {
  font-family: var(--nm-mono);
  font-size: 0.82em;
  color: #dcc69e;
  background: rgba(255,255,255,0.045);
  border: 1px solid rgba(255,255,255,0.06);
  padding: 1.5px 6px;
  border-radius: 5px;
  white-space: nowrap;
}
.note-prose-root .ProseMirror a {
  color: var(--nm-accent);
  text-decoration: underline;
  text-decoration-color: rgba(194,168,120,0.4);
}
.note-prose-root .ProseMirror[contenteditable='true'] p:focus,
.note-prose-root .ProseMirror[contenteditable='true'] h2:focus,
.note-prose-root .ProseMirror[contenteditable='true'] h3:focus {
  outline: 1.5px solid var(--nm-accent);
  outline-offset: 2px;
  border-radius: 3px;
}

/* inline player — clean 16:9, no youtube chrome (시안). 2 states: paused
   (thumbnail dim + minimal play + timecode), playing (iframe + accent ring). */
.note-prose-root .video-block-wrap { margin: 38px auto; max-width: 600px; }
.note-prose-root .video-block-frame {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--nm-line);
  border-radius: 12px;
  padding: 0;
  background: #000;
  overflow: hidden;
  cursor: pointer;
}
.note-prose-root .video-block-frame--active {
  cursor: default;
  border-color: rgba(194,168,120,0.38);
  box-shadow: 0 0 0 1px rgba(194,168,120,0.12);
}
.note-prose-root .video-block-iframe { width: 100%; height: 100%; border: 0; display: block; }
/* gold playing progress bar (시안) — overlaid at the bottom of the active frame */
.note-prose-root .video-block-progress {
  position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
  background: rgba(255,255,255,0.12); z-index: 3; pointer-events: none;
}
.note-prose-root .video-block-progress > i {
  display: block; height: 100%; width: 0;
  background: var(--nm-accent); transition: width 0.5s linear;
}
.note-prose-root .video-block-thumb {
  width: 100%; height: 100%;
  object-fit: cover;
  opacity: 0.42;
  filter: grayscale(0.2);
  transition: opacity 0.2s;
}
.note-prose-root .video-block-frame:hover .video-block-thumb { opacity: 0.6; }
.note-prose-root .video-block-overlay {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%);
}
.note-prose-root .video-block-play {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  width: 54px; height: 54px; border-radius: 50%;
  background: rgba(20,20,20,0.55);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.22);
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  transition: background 0.2s;
}
.note-prose-root .video-block-frame:hover .video-block-play { background: rgba(20,20,20,0.72); }
.note-prose-root .video-block-play-icon { width: 18px; height: 18px; margin-left: 3px; }
.note-prose-root .video-block-ts {
  position: absolute; left: 12px; bottom: 12px;
  font-family: var(--nm-mono); font-size: 11.5px; letter-spacing: -0.02em;
  color: #fff; background: rgba(0,0,0,0.5);
  padding: 2px 7px; border-radius: 5px;
}
.note-prose-root .video-block-caption {
  margin: 12px 0 28px;
  text-align: center;
  font-family: var(--nm-mono);
  font-size: 12px;
  letter-spacing: -0.01em;
  color: var(--nm-dim);
}

/* [CV-FIGURE-PRESENTATION] — CV figures (svg chart/diagram, table, equation).
   Framed on an ink-tinted plate; theme='auto' SVG ink is currentColor (= --nm-figure-ink
   = note body ink), so the figure adapts to the note's text color. Scaled to body
   width, with a muted caption + dimmer "video title · mm:ss" source line below. */
.note-prose-root .note-figure-block { margin: 40px auto; max-width: 600px; }
.note-prose-root .note-figure-block.hidden { display: none; }
.note-prose-root .note-figure {
  margin: 0;
  background: var(--nm-figure-bg);
  border: 1px solid var(--nm-figure-border);
  border-radius: 12px;
  padding: 20px 20px 16px;
  overflow: hidden;
  color: var(--nm-figure-ink); /* KaTeX/table text + the currentColor SVG ink inherit this */
}
.note-prose-root .note-figure-canvas {
  display: flex;
  justify-content: center;
  align-items: center;
}
.note-prose-root .note-figure-canvas > * { max-width: 100%; }
/* fix #1 size — inline SVG scales to the plate width, aspect ratio preserved. */
.note-prose-root .note-figure-svg { width: 100%; }
.note-prose-root .note-figure-svg svg {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
  /* fix #2 bg — theme='auto' SVG bg is transparent; keep belt so only the plate shows. */
  background: transparent;
}
/* fix #3 font — override graphviz/matplotlib default sans so labels (esp.
   Korean) use the note body font. !important beats inline style/presentation. */
.note-prose-root .note-figure-svg svg text,
.note-prose-root .note-figure-svg svg tspan {
  font-family: var(--nm-sans) !important;
}
.note-prose-root .note-figure-canvas img {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
  border-radius: 6px;
}
.note-prose-root .note-figure-equation {
  width: 100%;
  overflow-x: auto;
  text-align: center;
}
.note-prose-root .note-figure-latex-fallback {
  font-family: var(--nm-mono);
  font-size: 13px;
  color: var(--nm-figure-ink);
}
/* table figure — struct headers/rows as a clean bordered table on the plate. */
.note-prose-root .note-figure-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--nm-sans);
  font-size: 13px;
  line-height: 1.5;
  color: var(--nm-figure-ink);
}
.note-prose-root .note-figure-table th,
.note-prose-root .note-figure-table td {
  border: 1px solid var(--nm-figure-border);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
.note-prose-root .note-figure-table thead th {
  background: var(--nm-figure-th-bg);
  font-weight: 600;
}
/* fix #4 caption + source — muted caption, dimmer source, centered below figure. */
.note-prose-root .note-figure-meta { margin-top: 14px; text-align: center; }
.note-prose-root .note-figure-caption {
  font-family: var(--nm-sans);
  font-size: 13px;
  line-height: 1.5;
  color: var(--nm-dim);
}
.note-prose-root .note-figure-source {
  margin-top: 4px;
  font-family: var(--nm-mono);
  font-size: 11.5px;
  letter-spacing: -0.01em;
  color: var(--nm-faint);
}

/* [NOTE-FULL-TOOLSET] — markdown narrative now emits real lists, code blocks,
   callouts, mermaid diagrams and GFM tables. Below styles each in note-mode tokens. */

/* lists (top-level bullet/ordered from narrative) */
.note-prose-root .ProseMirror ul,
.note-prose-root .ProseMirror ol {
  margin: 0 0 1.55em;
  padding-left: 1.4em;
}
.note-prose-root .ProseMirror ul { list-style: disc; }
.note-prose-root .ProseMirror ol { list-style: decimal; }
.note-prose-root .ProseMirror li {
  margin: 0 0 0.4em;
  color: var(--nm-text);
}
.note-prose-root .ProseMirror li::marker { color: var(--nm-accent); }
.note-prose-root .ProseMirror li > p { margin: 0 0 0.4em; }

/* fenced code block (CodeBlockLowlight → pre > code) */
.note-prose-root .ProseMirror pre {
  font-family: var(--nm-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--nm-strong);
  background: var(--nm-figure-bg);
  border: 1px solid var(--nm-line);
  border-radius: 10px;
  padding: 16px 18px;
  margin: 28px 0;
  overflow-x: auto;
}
.note-prose-root .ProseMirror pre code {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  background: none;
  border: none;
  padding: 0;
  white-space: pre;
}

/* admonition callout (note / tip / warning) */
.note-prose-root .note-callout {
  margin: 32px 0;
  padding: 16px 18px;
  border: 1px solid var(--nm-callout-border);
  border-radius: 10px;
  background: var(--nm-callout-bg);
  color: var(--nm-callout-ink);
}
.note-prose-root .note-callout[data-kind="note"] {
  --nm-callout-bg: var(--nm-callout-note-bg);
  --nm-callout-border: var(--nm-callout-note-border);
  --nm-callout-accent: var(--nm-callout-note-accent);
}
.note-prose-root .note-callout[data-kind="tip"] {
  --nm-callout-bg: var(--nm-callout-tip-bg);
  --nm-callout-border: var(--nm-callout-tip-border);
  --nm-callout-accent: var(--nm-callout-tip-accent);
}
.note-prose-root .note-callout[data-kind="warning"] {
  --nm-callout-bg: var(--nm-callout-warning-bg);
  --nm-callout-border: var(--nm-callout-warning-border);
  --nm-callout-accent: var(--nm-callout-warning-accent);
}
.note-prose-root .note-callout-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: var(--nm-callout-accent);
}
.note-prose-root .note-callout-icon { width: 15px; height: 15px; flex: 0 0 auto; }
.note-prose-root .note-callout-label {
  font-family: var(--nm-sans);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.note-prose-root .note-callout-body > :last-child { margin-bottom: 0; }
.note-prose-root .note-callout-body p {
  margin: 0 0 0.6em;
  font-size: 15.5px;
  line-height: 1.7;
  color: var(--nm-text);
}

/* mermaid diagram (rendered SVG, centered) + raw-source fallback */
.note-prose-root .note-mermaid { margin: 32px auto; max-width: 600px; text-align: center; }
.note-prose-root .note-mermaid-canvas svg { max-width: 100%; height: auto; }
.note-prose-root .note-mermaid-fallback {
  font-family: var(--nm-mono);
  font-size: 13px;
  line-height: 1.6;
  text-align: left;
  color: var(--nm-strong);
  background: var(--nm-figure-bg);
  border: 1px solid var(--nm-line);
  border-radius: 10px;
  padding: 16px 18px;
  overflow-x: auto;
}

/* GFM table (legacy read-only markdownTable node — kept for unmigrated docs) */
.note-prose-root .note-md-table-block { margin: 28px 0; overflow-x: auto; }
.note-prose-root .note-md-table-block.hidden { display: none; }
.note-prose-root .note-md-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--nm-sans);
  font-size: 14px;
  line-height: 1.55;
  color: var(--nm-text);
}
.note-prose-root .note-md-table th,
.note-prose-root .note-md-table td {
  border: 1px solid var(--nm-line);
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
}
.note-prose-root .note-md-table thead th {
  background: var(--nm-figure-th-bg);
  font-weight: 600;
  color: var(--nm-strong);
}

/* Native editable table (@tiptap/extension-table) — matches .note-md-table */
.note-prose-root .ProseMirror table {
  width: 100%;
  border-collapse: collapse;
  margin: 28px 0;
  font-family: var(--nm-sans);
  font-size: 14px;
  line-height: 1.55;
  color: var(--nm-text);
  overflow: hidden;
}
.note-prose-root .ProseMirror th,
.note-prose-root .ProseMirror td {
  border: 1px solid var(--nm-line);
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
  position: relative;
}
.note-prose-root .ProseMirror th {
  background: var(--nm-figure-th-bg);
  font-weight: 600;
  color: var(--nm-strong);
}
.note-prose-root .ProseMirror th > p,
.note-prose-root .ProseMirror td > p { margin: 0; }
/* selected-cell highlight (table editing) — accent tint via token */
.note-prose-root .ProseMirror .selectedCell::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--nm-accent);
  opacity: 0.12;
  pointer-events: none;
}

/* Obsidian-style editable source (mermaid diagram / equation LaTeX) */
.note-prose-root .note-source-edit { margin-top: 12px; text-align: left; }
.note-prose-root .note-source-textarea {
  width: 100%;
  min-height: 96px;
  font-family: var(--nm-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--nm-strong);
  background: var(--nm-figure-bg);
  border: 1px solid var(--nm-line);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 8px;
  resize: vertical;
}
.note-prose-root .note-source-textarea:focus { outline: 1.5px solid var(--nm-accent); }
.note-prose-root .note-source-btn {
  font-family: var(--nm-sans);
  font-size: 12px;
  color: var(--nm-accent);
  background: transparent;
  border: 1px solid var(--nm-line);
  border-radius: 8px;
  padding: 4px 12px;
  cursor: pointer;
}
.note-prose-root .note-source-btn:hover { border-color: var(--nm-accent); }
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
