import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
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

/**
 * CP505 — sidebar TOC short label (chapter + topic, shared). Book chapter/topic
 * titles run 60-84 chars and wrap or ellipsis-truncate ("…"). Take the lead clause
 * (before the first colon / em-dash / middle-dot) as a short label. Sidebar-only —
 * the note BODY heading keeps the full title; `truncate` stays as a 1-line backstop.
 */
function tocShortLabel(title: string): string {
  return title.split(/[:：—–·]/)[0]?.trim() || title;
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

  // PR3c-a — player tab "videos I collected": all cards in the cell.
  // mandalaCards is already URL-deduped + cellIndex>=0 (useMandalaCards); no
  // bookmark / v2-oneLiner gate (the list reflects what the user collected).
  const cardsByCellAll = useMemo(() => {
    const map = new Map<number, InsightCard[]>();
    for (const card of mandalaCards) {
      // §3.5 — keep cell 0 (center/goal cell); its videos render as the "개요"
      // group above the numbered chapters (was: cell0 < 1 → silently dropped).
      if (typeof card.cellIndex !== 'number' || card.cellIndex < 0) continue;
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

  // §3.5 — "M개 요약됨" = videos that actually render a label in the list, using
  // the SAME criterion as renderPlayerList (v2 toc_label/one_liner; v1 rows have
  // neither via the v2-summaries API → not counted). So the header count ===
  // left-TOC card count. NOT coverage.v2Done (a §1④ book-fill field that is 0 on
  // stale / uncomputed books — the "0개 요약됨" bug).
  const summarizedCount = useMemo(() => {
    const seen = new Set<string>();
    let n = 0;
    for (const vid of likedVideoIds) {
      if (seen.has(vid)) continue;
      seen.add(vid);
      const v2 = summariesByVideoId.get(vid);
      if (v2?.tocLabel?.trim() || v2?.oneLiner?.trim()) n++;
    }
    return n;
  }, [likedVideoIds, summariesByVideoId]);

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

  // §3.5 — shared player-mode list render, reused by the numbered chapters AND
  // the cell-0 "개요" group. label = short toc_label, falls back to oneLiner;
  // videos without a v2 row are omitted (header "% 요약 중" accounts for them).
  const renderPlayerList = (cards: InsightCard[]) => {
    const entries = cards
      .map((card) => {
        let vid: string | null = null;
        try {
          vid = extractYouTubeVideoId(new URL(card.videoUrl));
        } catch {
          vid = null;
        }
        if (!vid) return null;
        const v2 = summariesByVideoId.get(vid);
        const label = v2?.tocLabel?.trim() || v2?.oneLiner?.trim();
        if (!label) return null;
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
              // §3.5 — 영상/노트 위계를 헤더로 구분 (같은 숫자 "N개 영상" → 혼란).
              //   노트 = book이 합성한 distinct 영상 = "N개 영상에서 종합" (정답 종합).
              //   영상 = 수집 원본 카드 + 요약 진척 = "N개 영상 · M개 요약됨".
              // 문구는 시작값 — James 화면 수렴 대상.
              if (centerViewMode === 'note') {
                const synthCount =
                  typeof bookResponse?.book?.source_videos === 'number'
                    ? bookResponse.book.source_videos
                    : 0;
                return (
                  <p className="mt-0.5 text-[13px] text-sidebar-foreground/50">
                    {t('learning.videoCountSynthesized', { count: synthCount })}
                  </p>
                );
              }
              // 영상 모드: 수집 카드 수 · 실제 렌더된(요약된) 카드 수 = 좌측 카드
              // 수와 일치. book-fill coverage 스피너는 영상 카드와 무관 → 제거.
              const collected = mandalaCards.length;
              return (
                <p className="mt-0.5 text-[13px] text-sidebar-foreground/50">
                  {t('learning.videoCountCollected', { count: collected, done: summarizedCount })}
                </p>
              );
            })()}
          </div>
          <div className="mt-0.5 flex shrink-0 items-center gap-0.5">
            {/* [VIDEO-VIEW] — strip ON/OFF toggle retired; the floating
                navigator button in CenterPanel's top bar replaces it. */}
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
        {centerViewMode === 'note'
          ? /* §4.5.1 NOTE mode — TOC = the book's OWN narrative chapters (SSOT =
               book_json). Iterate book.chapters DIRECTLY, not mandala cells: with
               the narrative skeleton chapters are cross-cell + reordered (ch ≠ cell
               index), and even in legacy cell mode build-book already empty-filters
               (#989) + orders them. So no cell-index join, no empty-heading leak
               (supersedes §3.1/#991), and bullets — not cell numbers (supersedes
               #992) — since narrative order has no spatial cell number. */
            (bookResponse?.book?.chapters ?? []).map((chapter) => {
              const isExpanded = isChapterExpanded(chapter.ch);
              const chapterActive = activeSectionRef?.chapterIdx === chapter.ch;
              return (
                <div key={chapter.ch} className="mb-0.5">
                  <button
                    type="button"
                    onClick={() => toggleChapter(chapter.ch)}
                    className="group flex w-full items-center gap-2 px-2 py-1 text-left transition-colors"
                  >
                    {/* narrative order ⇒ bullet (no spatial cell number). */}
                    <span
                      className={cn(
                        'shrink-0 text-[11px] leading-[1.5] transition-colors',
                        chapterActive ? 'text-sidebar-foreground/80' : 'text-sidebar-foreground/35'
                      )}
                    >
                      •
                    </span>
                    <span
                      className={cn(
                        'flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.10em] transition-colors',
                        chapterActive
                          ? 'text-sidebar-foreground/80'
                          : 'text-sidebar-foreground/55 group-hover:text-sidebar-foreground/80'
                      )}
                    >
                      {tocShortLabel(chapter.title)}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="ml-3.5 pt-0.5">
                      <BookChapterPreview
                        chapter={chapter}
                        mandalaId={mandalaId}
                        currentVideoId={currentVideoId}
                        activeSectionIdx={
                          activeSectionRef?.chapterIdx === chapter.ch
                            ? activeSectionRef.sectionIdx
                            : null
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })
          : /* PLAYER mode — collected videos by mandala cell (SSOT = cards),
               UNCHANGED. cell 0 = "개요" preface above the numbered cells; each
               cell keeps its 01–08 number (spatial position users navigate by). */
            (() => {
              const overview = renderPlayerList(cardsByCellAll.get(0) ?? []);
              return (
                <>
                  {overview && (
                    <div className="mb-0.5">
                      <div className="flex w-full items-center gap-2 px-2 py-1">
                        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.10em] text-sidebar-foreground/55">
                          {t('learning.overview', '개요')}
                        </span>
                      </div>
                      {overview}
                    </div>
                  )}
                  {subGoals.map((goal, idx) => {
                    const isExpanded = isChapterExpanded(idx);
                    const labelText = subjectLabels[idx]?.trim() ?? '';
                    const rowLabel = labelText || goal;
                    const rowTooltip = labelText && goal ? goal : undefined;
                    // Active = a collected card in this cell is the current video.
                    const chapterActive =
                      !!currentVideoId &&
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
                        <span
                          className={cn(
                            'shrink-0 font-mono text-[11px] tabular-nums transition-colors',
                            chapterActive
                              ? 'text-sidebar-foreground/80'
                              : 'text-sidebar-foreground/35'
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
                            <TooltipContent
                              side="bottom"
                              align="start"
                              className="text-[12px] max-w-[280px]"
                            >
                              {rowTooltip}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          chapterButton
                        )}
                        {isExpanded && renderPlayerList(cardsByCellAll.get(idx + 1) ?? [])}
                      </div>
                    );
                  })}
                </>
              );
            })()}
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
        // CP505 ② — sidebar TOC readability: topic titles run 60-84 chars and
        // wrapped to 2 lines. Show the lead clause (before the first colon) +
        // truncate as a 1-line backstop. The note BODY heading keeps the full
        // title (note-document-generator) — this shortening is sidebar-only.
        const tocLabel = tocShortLabel(sec.title);
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
              'cursor-pointer truncate pl-3.5 py-1.5 leading-[1.5] transition-colors',
              // §redesign — active section: 2px gold bar + strong text (시안).
              // sidebar-primary is gold within .note-mode (overridden in index.css).
              isActiveSection
                ? 'border-l-2 border-sidebar-primary text-[14px] font-medium text-sidebar-primary'
                : 'border-l border-sidebar-foreground/10 text-[13px] text-sidebar-foreground/50 hover:border-sidebar-foreground/50 hover:text-sidebar-foreground'
            )}
          >
            {tocLabel}
          </li>
        );
      })}
    </ul>
  );
}
