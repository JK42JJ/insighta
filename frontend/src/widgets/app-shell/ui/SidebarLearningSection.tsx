import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronsDownUp, ChevronsUpDown, PanelTop } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMandalaQuery } from '@/features/mandala';
import { useMandalaBook } from '@/features/mandala/model/useMandalaBook';
import { useMandalaCards } from '@/pages/learning/model/useMandalaCards';
import { useLearningStore } from '@/pages/learning/model/useLearningStore';
import type { MandalaBookChapter } from '@/shared/lib/api-client';
import type { InsightCard } from '@/entities/card/model/types';
import { extractYouTubeVideoId } from '@/shared/lib/url-normalize';
import { useV2Summaries } from '@/features/card-management/model/useV2Summaries';
import { cn } from '@/shared/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';

interface SidebarLearningSectionProps {
  mandalaId: string;
  currentVideoId?: string;
  collapsed: boolean;
}

export function SidebarLearningSection({
  mandalaId,
  currentVideoId,
  collapsed,
}: SidebarLearningSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveSection = useLearningStore((s) => s.setActiveSection);
  const activeSectionRef = useLearningStore((s) => s.activeSectionRef);
  const setActiveRegion = useLearningStore((s) => s.setActiveRegion);
  const centerViewMode = useLearningStore((s) => s.centerViewMode);
  const videoStripEnabled = useLearningStore((s) => s.videoStripEnabled);
  const setVideoStripEnabled = useLearningStore((s) => s.setVideoStripEnabled);
  // CP445.x — multi-chapter expand state. `null` = default (모두 펼침).
  // 사용자가 individual/all 토글 시 explicit Set 으로 전환.
  const [expandedIdxs, setExpandedIdxs] = useState<Set<number> | null>(null);

  const { mandalaLevels } = useMandalaQuery(mandalaId);
  const rootLevel = mandalaLevels.root;
  const centerGoal = rootLevel?.centerGoal ?? '';
  // Short cell labels in the tree; long goals move to the hover tooltip.
  const centerLabel = rootLevel?.centerLabel ?? null;
  const subGoals = rootLevel?.subjects ?? [];
  const subjectLabels = rootLevel?.subjectLabels ?? [];

  const { cards: mandalaCards } = useMandalaCards(mandalaId);
  // CP438+1 — book index PoC; non-null when a book has been generated.
  const { book: bookResponse } = useMandalaBook(mandalaId);
  const bookChaptersByIdx = new Map<number, MandalaBookChapter>();
  if (bookResponse?.book?.chapters) {
    for (const ch of bookResponse.book.chapters) {
      bookChaptersByIdx.set(ch.ch, ch);
    }
  }

  // PR3c-a — player tab "videos I collected": all cards in the cell.
  // mandalaCards is already URL-deduped + cellIndex>=0 (useMandalaCards); no
  // bookmark / v2-oneLiner gate (the list reflects what the user collected).
  const cardsByCellAll = useMemo(() => {
    const map = new Map<number, InsightCard[]>();
    for (const card of mandalaCards) {
      if (typeof card.cellIndex !== 'number' || card.cellIndex < 1) continue;
      const list = map.get(card.cellIndex) ?? [];
      list.push(card);
      map.set(card.cellIndex, list);
    }
    return map;
  }, [mandalaCards]);

  // PR3c-a label source — v2 oneLiner per collected video. Player list shows
  // only summarized videos (label = oneLiner) for a uniform look; videos still
  // summarizing are omitted from the list and accounted for by the header
  // "% 요약 중" progress. Bookmark gate stays removed (only the v2 filter).
  const likedVideoIds = useMemo(() => {
    const ids: string[] = [];
    for (const card of mandalaCards) {
      try {
        const vid = extractYouTubeVideoId(new URL(card.videoUrl));
        if (vid) ids.push(vid);
      } catch {
        /* skip cards whose URL cannot be parsed */
      }
    }
    return ids;
  }, [mandalaCards]);
  const { summariesByVideoId } = useV2Summaries(likedVideoIds);

  // CP438+1: find which chapter+section contains an atom whose vid matches
  // the currently-playing video. Used to highlight the active section in
  // the sidebar AND auto-expand the chapter on first match.
  const activeMatch: { chapterIdx: number; sectionIdx: number } | null = (() => {
    if (!currentVideoId || !bookResponse?.book?.chapters) return null;
    for (const ch of bookResponse.book.chapters) {
      const sections = ch.sections ?? [];
      for (let s = 0; s < sections.length; s++) {
        const atoms = sections[s].atoms ?? [];
        if (atoms.some((a) => a.vid === currentVideoId)) {
          return { chapterIdx: ch.ch, sectionIdx: s };
        }
      }
    }
    return null;
  })();

  // CP445.x — auto-set activeSection 은 첫 mount 1회만 (initial cue). 이후
  // 사용자 click (BookChapterPreview onClick) 이 single source of truth.
  // 이전 logic: activeMatch 변경 시마다 자동 setActiveSection → URL navigate
  // 시 currentVideoId 변경 → activeMatch 재계산 → 사용자 click 위치 덮어씀.
  const autoSetOnceRef = useRef(false);
  useEffect(() => {
    if (autoSetOnceRef.current) return;
    if (!activeMatch) return;
    setActiveSection({
      chapterIdx: activeMatch.chapterIdx,
      sectionIdx: activeMatch.sectionIdx,
    });
    setExpandedIdxs((prev) => {
      if (prev === null) return prev;
      const next = new Set(prev);
      next.add(activeMatch.chapterIdx);
      return next;
    });
    autoSetOnceRef.current = true;
  }, [activeMatch, setActiveSection]);

  // CP445.x — multi-chapter expand helpers
  const isChapterExpanded = (idx: number): boolean =>
    expandedIdxs === null ? true : expandedIdxs.has(idx);

  const totalChapters = subGoals.length;
  const isAllCollapsed = expandedIdxs !== null && expandedIdxs.size === 0;

  const toggleChapter = (idx: number) => {
    setExpandedIdxs((prev) => {
      // null (default 모두 펼침) → explicit Set 으로 전환 후 해당 idx 만 collapse
      const base = prev ?? new Set<number>(Array.from({ length: totalChapters }, (_, i) => i));
      const next = new Set(base);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (isAllCollapsed) {
      // 모두 접힘 → 모두 펼침 (default 로 복귀)
      setExpandedIdxs(null);
    } else {
      // 그 외 (default null 또는 일부/전부 펼침) → 모두 접힘
      setExpandedIdxs(new Set());
    }
  };

  if (collapsed) {
    const collapsedLabel = centerGoal || centerLabel || t('sidebar.learning', 'Learning');
    return (
      <div className="px-2 py-1" onMouseEnter={() => setActiveRegion('sidebar')}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={collapsedLabel}
              className="w-full flex items-center justify-center px-2 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <BookOpen className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-[12px]">
            {collapsedLabel}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Header row text = short label (cell name). Tooltip = long-form goal.
  // When the label is explicitly set, the tooltip always surfaces the goal
  // (even if the two strings happen to match). When no label is set, the
  // goal becomes the row text and the tooltip is suppressed to avoid a
  // redundant duplicate.
  const centerLabelText = centerLabel?.trim() ?? '';
  const headerText = centerLabelText || centerGoal || t('sidebar.learning', 'Learning');
  const headerTooltip = centerLabelText && centerGoal ? centerGoal : undefined;

  return (
    <div className="pl-2 pr-2 flex flex-col" onMouseEnter={() => setActiveRegion('sidebar')}>
      <div className="px-2 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {headerTooltip ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <h3 className="text-[14px] font-bold text-sidebar-foreground leading-snug truncate cursor-default">
                    {headerText}
                  </h3>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[12px] max-w-[280px]">
                  {headerTooltip}
                </TooltipContent>
              </Tooltip>
            ) : (
              <h3 className="text-[14px] font-bold text-sidebar-foreground leading-snug truncate">
                {headerText}
              </h3>
            )}
            {/* CP445 D18=B — 영상 모드 = 만다라 mapped 전체 영상 / 노트 모드 =
                mandala_books 가 인용한 distinct vid 수 (필수 영상). */}
            {(() => {
              const headerCount =
                centerViewMode === 'note' && typeof bookResponse?.book?.source_videos === 'number'
                  ? bookResponse.book.source_videos
                  : mandalaCards.length;
              // §1④ book-fill progress — surface coverage, no new compute.
              // v2Pending > 0 ⇒ "N · {pct}% 요약 중" + spinner; else "N 영상".
              const coverage = bookResponse?.coverage;
              if ((coverage?.v2Pending ?? 0) > 0) {
                const pct =
                  coverage && coverage.gatePassed > 0
                    ? Math.round((coverage.v2Done / coverage.gatePassed) * 100)
                    : 0;
                return (
                  <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-sidebar-foreground/50">
                    <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                    <span>{t('learning.videoCountSummarizing', { count: headerCount, pct })}</span>
                  </p>
                );
              }
              return (
                <p className="mt-0.5 text-[13px] text-sidebar-foreground/50">
                  {t('learning.videoCount', { count: headerCount })}
                </p>
              );
            })()}
          </div>
          <div className="mt-0.5 flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setVideoStripEnabled(!videoStripEnabled)}
                  aria-label={videoStripEnabled ? '동영상 썸네일 바 끄기' : '동영상 썸네일 바 켜기'}
                  aria-pressed={videoStripEnabled}
                  className={cn(
                    'rounded p-1 transition-colors hover:bg-sidebar-accent/40',
                    videoStripEnabled
                      ? 'text-sidebar-foreground/85 hover:text-sidebar-foreground'
                      : 'text-sidebar-foreground/35 hover:text-sidebar-foreground/85'
                  )}
                >
                  <PanelTop className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[12px]">
                {videoStripEnabled ? '동영상 썸네일 바 끄기' : '동영상 썸네일 바 켜기'}
              </TooltipContent>
            </Tooltip>
            {/* CP445.x — 전체 펼침/접힘 토글. default = 모두 펼침. */}
            {totalChapters > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleAll}
                    aria-label={isAllCollapsed ? '모두 펼치기' : '모두 접기'}
                    className="rounded p-1 text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/85"
                  >
                    {isAllCollapsed ? (
                      <ChevronsUpDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronsDownUp className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[12px]">
                  {isAllCollapsed ? '모두 펼치기' : '모두 접기'}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      <div className="my-1 mx-2">
        <div className="h-px bg-sidebar-border" />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none pb-3">
        {subGoals.map((goal, idx) => {
          const bookChapter = bookChaptersByIdx.get(idx);
          const isExpanded = isChapterExpanded(idx);
          // Row text = short cell label; tooltip = long-form sub-goal.
          // When the label is explicitly set, the tooltip always surfaces
          // the goal (mirrors header logic above). When no label exists,
          // the goal becomes the row text and the tooltip is suppressed.
          const labelText = subjectLabels[idx]?.trim() ?? '';
          const rowLabel = labelText || goal;
          const rowTooltip = labelText && goal ? goal : undefined;

          // Highlight the chapter (sector) that contains the active item, and
          // keep it lit (mirrors the hover-bright look). note: activeSectionRef
          // is in this chapter; player: a card in this cell == currentVideoId.
          const chapterActive =
            centerViewMode === 'note'
              ? !!bookChapter && activeSectionRef?.chapterIdx === bookChapter.ch
              : !!currentVideoId &&
                (cardsByCellAll.get(idx + 1) ?? []).some((c) => {
                  try {
                    return extractYouTubeVideoId(new URL(c.videoUrl)) === currentVideoId;
                  } catch {
                    return false;
                  }
                });

          const chapterButton = (
            <button
              type="button"
              onClick={() => toggleChapter(idx)}
              className="group flex w-full items-center gap-2 px-2 py-1 text-left transition-colors"
            >
              {/* §redesign — chapter number replaces the chevron (시안 .toc-chapter
                  .n). Row click still toggles expand/collapse. */}
              <span
                className={cn(
                  'shrink-0 font-mono text-[11px] tabular-nums transition-colors',
                  chapterActive ? 'text-sidebar-foreground/80' : 'text-sidebar-foreground/35'
                )}
              >
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span
                className={cn(
                  'flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.10em] transition-colors',
                  chapterActive
                    ? 'text-sidebar-foreground/80'
                    : 'text-sidebar-foreground/55 group-hover:text-sidebar-foreground/80'
                )}
              >
                {rowLabel}
              </span>
            </button>
          );
          return (
            <div key={idx} className="mb-0.5">
              {rowTooltip ? (
                <Tooltip>
                  <TooltipTrigger asChild>{chapterButton}</TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="text-[12px] max-w-[280px]">
                    {rowTooltip}
                  </TooltipContent>
                </Tooltip>
              ) : (
                chapterButton
              )}

              {/* PR3c-a — branch the TOC by centerViewMode so the two SSOTs
                  never co-render (was: both blocks always rendered → one video
                  highlighted as oneLiner AND auto-set section = double-select +
                  1px/2px asymmetry, James-observed prod bug).
                  note   = book sections (SSOT book_json). active = activeSectionRef
                           (disambiguates a vid cited by multiple sections).
                  player = collected cards (SSOT cards). active = vid===currentVideoId.
                  Same 2px bar in both; one block per tab = bug structurally gone. */}
              {isExpanded && centerViewMode === 'note' && bookChapter && (
                <div className="ml-3.5 pt-0.5">
                  <BookChapterPreview
                    chapter={bookChapter}
                    mandalaId={mandalaId}
                    currentVideoId={currentVideoId}
                    activeSectionIdx={
                      activeSectionRef?.chapterIdx === bookChapter.ch
                        ? activeSectionRef.sectionIdx
                        : null
                    }
                  />
                </div>
              )}
              {isExpanded &&
                centerViewMode === 'player' &&
                (() => {
                  const entries = (cardsByCellAll.get(idx + 1) ?? [])
                    .map((card) => {
                      let vid: string | null = null;
                      try {
                        vid = extractYouTubeVideoId(new URL(card.videoUrl));
                      } catch {
                        vid = null;
                      }
                      if (!vid) return null;
                      // CP504 — TOC label = short toc_label; fall back to oneLiner
                      // when a v2 row predates toc_label (legacy/quick rows).
                      const v2 = summariesByVideoId.get(vid);
                      const label = v2?.tocLabel?.trim() || v2?.oneLiner?.trim();
                      if (!label) return null; // not yet summarized → header accounts for it
                      return { cardId: card.id, vid, label };
                    })
                    .filter((e): e is { cardId: string; vid: string; label: string } => e !== null);
                  if (entries.length === 0) return null;
                  return (
                    <ul className="ml-3.5 pt-0.5">
                      {entries.map((entry) => {
                        const isActive = entry.vid === currentVideoId;
                        return (
                          <li
                            key={entry.cardId}
                            onClick={() => navigate(`/learning/${mandalaId}/${entry.vid}`)}
                            className={cn(
                              'cursor-pointer pl-3.5 py-1.5 leading-[1.5] transition-colors',
                              isActive
                                ? 'border-l-2 border-sidebar-primary text-[14px] font-medium text-sidebar-primary'
                                : 'border-l border-sidebar-foreground/10 text-[13px] text-sidebar-foreground/50 hover:border-sidebar-foreground/50 hover:text-sidebar-foreground'
                            )}
                          >
                            {entry.label}
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * CP445.x — book navigator. Section title only (no intro/narrative/atoms).
 * Click → setActiveSection + setCenterTab + (CP445.x bug fix) navigate to
 * the section's first atom vid (cross-video). LearningPage's ?t= effect
 * handles seekTo on the live player.
 */
function BookChapterPreview({
  chapter,
  mandalaId,
  currentVideoId,
  activeSectionIdx,
}: {
  chapter: MandalaBookChapter;
  mandalaId: string;
  currentVideoId?: string;
  activeSectionIdx: number | null;
}) {
  const sections = chapter.sections ?? [];
  const setActiveSection = useLearningStore((s) => s.setActiveSection);
  const setCenterTab = useLearningStore((s) => s.setCenterTab);
  const navigate = useNavigate();

  if (sections.length === 0) return null;

  return (
    <ul>
      {sections.map((sec, sIdx) => {
        const isActiveSection = sIdx === activeSectionIdx;
        const firstAtom = sec.atoms?.[0];
        return (
          <li
            key={sIdx}
            onClick={() => {
              setActiveSection({ chapterIdx: chapter.ch, sectionIdx: sIdx });
              setCenterTab('section');
              if (firstAtom?.vid && Number.isFinite(firstAtom.ts)) {
                const ts = Math.floor(firstAtom.ts ?? 0);
                if (firstAtom.vid !== currentVideoId) {
                  navigate(`/learning/${mandalaId}/${firstAtom.vid}?t=${ts}`);
                } else {
                  navigate(`/learning/${mandalaId}/${currentVideoId}?t=${ts}`, { replace: true });
                }
              }
            }}
            className={cn(
              'cursor-pointer pl-3.5 py-1.5 leading-[1.5] transition-colors',
              // §redesign — active section: 2px gold bar + strong text (시안).
              // sidebar-primary is gold within .note-mode (overridden in index.css).
              isActiveSection
                ? 'border-l-2 border-sidebar-primary text-[14px] font-medium text-sidebar-primary'
                : 'border-l border-sidebar-foreground/10 text-[13px] text-sidebar-foreground/50 hover:border-sidebar-foreground/50 hover:text-sidebar-foreground'
            )}
          >
            {sec.title}
          </li>
        );
      })}
    </ul>
  );
}
