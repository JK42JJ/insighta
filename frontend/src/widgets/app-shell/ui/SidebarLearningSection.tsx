import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
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

  // Group liked cards by cellIndex so each sub-goal lists its own videos.
  const cardsByCell = useMemo(() => {
    const map = new Map<number, InsightCard[]>();
    for (const card of mandalaCards) {
      if (typeof card.cellIndex !== 'number' || card.cellIndex < 1) continue;
      const list = map.get(card.cellIndex) ?? [];
      list.push(card);
      map.set(card.cellIndex, list);
    }
    return map;
  }, [mandalaCards]);

  // Pull v2 key-concept terms for every liked video so the sub-goal tree
  // can render keyword-style book-index entries instead of raw titles.
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
    return (
      <div className="px-2 py-1" onMouseEnter={() => setActiveRegion('sidebar')}>
        <button
          className="w-full flex items-center justify-center px-2 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          title={centerGoal || centerLabel || t('sidebar.learning', 'Learning')}
        >
          <BookOpen className="w-5 h-5" />
        </button>
      </div>
    );
  }

  // Header text prefers the short label; long goal moves to the tooltip.
  const headerText = centerLabel?.trim() || centerGoal || t('sidebar.learning', 'Learning');
  const headerTooltip = centerGoal && centerGoal !== headerText ? centerGoal : undefined;

  return (
    <div className="pl-5 pr-2 flex flex-col" onMouseEnter={() => setActiveRegion('sidebar')}>
      <div className="px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3
              className="text-[13px] font-bold text-sidebar-foreground leading-snug truncate"
              title={headerTooltip}
            >
              {headerText}
            </h3>
            {/* CP445 D18=B — 영상 모드 = 만다라 mapped 전체 영상 / 노트 모드 =
                mandala_books 가 인용한 distinct vid 수 (필수 영상). */}
            <p className="mt-0.5 text-[11px] text-sidebar-foreground/50">
              {t('learning.videoCount', {
                count:
                  centerViewMode === 'note' && typeof bookResponse?.book?.source_videos === 'number'
                    ? bookResponse.book.source_videos
                    : mandalaCards.length,
              })}
            </p>
          </div>
          {/* CP445.x — 전체 펼침/접힘 토글. default = 모두 펼침. */}
          {totalChapters > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              aria-label={isAllCollapsed ? '모두 펼치기' : '모두 접기'}
              title={isAllCollapsed ? '모두 펼치기' : '모두 접기'}
              className="mt-0.5 shrink-0 rounded p-1 text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/85"
            >
              {isAllCollapsed ? (
                <ChevronsUpDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronsDownUp className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      <div className="my-1 mx-2">
        <div className="h-px bg-sidebar-border" />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none pb-3">
        {subGoals.map((goal, idx) => {
          const bookChapter = bookChaptersByIdx.get(idx);
          const isExpanded = isChapterExpanded(idx);
          // Row text shows the short label; long goal text is the tooltip.
          const rowLabel = subjectLabels[idx]?.trim() || goal;
          const rowTooltip = goal && goal !== rowLabel ? goal : undefined;

          return (
            <div key={idx} className="mb-0.5">
              <button
                type="button"
                onClick={() => toggleChapter(idx)}
                title={rowTooltip}
                className="group flex w-full items-center gap-2 px-2 py-1 text-left transition-colors"
              >
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-sidebar-foreground/35 transition-colors group-hover:text-sidebar-foreground',
                    isExpanded && 'rotate-90'
                  )}
                />
                <span className="flex-1 truncate text-[13px] font-medium tracking-[-0.01em] text-sidebar-foreground/80 transition-colors group-hover:text-sidebar-foreground">
                  {rowLabel}
                </span>
              </button>

              {isExpanded && bookChapter && (
                <div className="ml-9 pt-0.5">
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
              {/* Book-index entries: keyword tokens distilled from v2
                  analysis.key_concepts. Cards without a v2 row are
                  omitted; they reappear once enrich-rich-summary lands. */}
              {isExpanded &&
                (() => {
                  const cellCards = cardsByCell.get(idx + 1) ?? [];
                  const indexedEntries = cellCards
                    .map((card) => {
                      let vid: string | null = null;
                      try {
                        vid = extractYouTubeVideoId(new URL(card.videoUrl));
                      } catch {
                        vid = null;
                      }
                      if (!vid) return null;
                      const v2 = summariesByVideoId.get(vid);
                      const primary = v2?.keyConcepts ?? [];
                      const fallback = v2?.fallbackTags ?? [];
                      const keywords = primary.length > 0 ? primary : fallback;
                      if (keywords.length === 0) return null;
                      const indexName = keywords.slice(0, 2).join(' · ');
                      return { cardId: card.id, vid, indexName };
                    })
                    .filter(
                      (e): e is { cardId: string; vid: string; indexName: string } => e !== null
                    );
                  if (indexedEntries.length === 0) return null;
                  return (
                    <ul className="ml-9 pt-0.5">
                      {indexedEntries.map((entry) => {
                        const isActive = entry.vid === currentVideoId;
                        return (
                          <li
                            key={entry.cardId}
                            onClick={() => navigate(`/learning/${mandalaId}/${entry.vid}`)}
                            title={entry.indexName}
                            className={cn(
                              'cursor-pointer pl-3 py-1.5 leading-[1.5] border-l-2 transition-colors',
                              isActive
                                ? 'border-[#818cf8] text-[14px] font-medium text-[#818cf8]'
                                : 'border-sidebar-foreground/10 text-[13px] text-sidebar-foreground/80 hover:border-sidebar-foreground/50 hover:text-sidebar-foreground'
                            )}
                          >
                            {entry.indexName}
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
              'cursor-pointer pl-3 py-1.5 leading-[1.5] border-l-2 transition-colors',
              isActiveSection
                ? 'border-[#818cf8] text-[14px] font-medium text-[#818cf8]'
                : 'border-sidebar-foreground/10 text-[13px] text-sidebar-foreground/80 hover:border-sidebar-foreground/50 hover:text-sidebar-foreground'
            )}
          >
            {sec.title}
          </li>
        );
      })}
    </ul>
  );
}
