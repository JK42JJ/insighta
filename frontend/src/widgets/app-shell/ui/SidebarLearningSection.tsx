import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMandalaQuery } from '@/features/mandala';
import { useMandalaBook } from '@/features/mandala/model/useMandalaBook';
import { useMandalaCards } from '@/pages/learning/model/useMandalaCards';
import { useLearningStore } from '@/pages/learning/model/useLearningStore';
import type { InsightCard } from '@/entities/card/model/types';
import type { MandalaBookChapter } from '@/shared/lib/api-client';
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
  const subGoals = rootLevel?.subjects ?? [];

  const { cards: mandalaCards } = useMandalaCards(mandalaId);
  // CP438+1 — book index PoC; non-null when a book has been generated.
  const { book: bookResponse } = useMandalaBook(mandalaId);
  const bookChaptersByIdx = new Map<number, MandalaBookChapter>();
  if (bookResponse?.book?.chapters) {
    for (const ch of bookResponse.book.chapters) {
      bookChaptersByIdx.set(ch.ch, ch);
    }
  }

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

  const cardsByCell = new Map<number, InsightCard[]>();
  for (const card of mandalaCards) {
    const list = cardsByCell.get(card.cellIndex) ?? [];
    list.push(card);
    cardsByCell.set(card.cellIndex, list);
  }

  if (collapsed) {
    return (
      <div className="px-2 py-1" onMouseEnter={() => setActiveRegion('sidebar')}>
        <button
          className="w-full flex items-center justify-center px-2 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          title={centerGoal || t('sidebar.learning', 'Learning')}
        >
          <BookOpen className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 flex flex-col" onMouseEnter={() => setActiveRegion('sidebar')}>
      <div className="px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-bold text-sidebar-foreground leading-snug truncate">
              {centerGoal || t('sidebar.learning', 'Learning')}
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
        {/* CP445.x — single-chapter accordion. 클릭 시 해당 chapter 만 펼치고
            나머지 자동 collapse. 보라색 active highlight 없음 (사용자 spec). */}
        {subGoals.map((goal, idx) => {
          const cellCards = cardsByCell.get(idx + 1) ?? [];
          const bookChapter = bookChaptersByIdx.get(idx);
          const sectionCount = bookChapter?.sections?.length ?? 0;
          const isExpanded = isChapterExpanded(idx);

          return (
            <div key={idx} className="mb-1">
              <button
                type="button"
                onClick={() => toggleChapter(idx)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/40"
              >
                <ChevronRight
                  className={cn(
                    'h-3 w-3 shrink-0 text-sidebar-foreground/50 transition-transform',
                    isExpanded && 'rotate-90'
                  )}
                />
                <span className="flex-1 truncate text-[12px] font-medium text-sidebar-foreground/85">
                  {idx + 1}. {goal}
                </span>
                {(sectionCount > 0 || cellCards.length > 0) && (
                  <span className="shrink-0 rounded-full bg-sidebar-accent/40 px-1.5 py-0.5 text-[10px] tabular-nums text-sidebar-foreground/60">
                    {sectionCount > 0 ? sectionCount : cellCards.length}
                  </span>
                )}
              </button>

              {isExpanded && bookChapter && (
                <div className="pl-6 pt-1">
                  <BookChapterPreview
                    chapter={bookChapter}
                    mandalaId={mandalaId}
                    currentVideoId={currentVideoId}
                    // CP445.x — single source of truth = activeSectionRef
                    // (사용자 click). activeMatch fallback 제거 — multi-vid
                    // section 시 다른 chapter 까지 동시 highlight 되는 bug
                    // 회피.
                    activeSectionIdx={
                      activeSectionRef?.chapterIdx === bookChapter.ch
                        ? activeSectionRef.sectionIdx
                        : null
                    }
                  />
                </div>
              )}
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
    <ul className="space-y-0.5">
      {sections.map((sec, sIdx) => {
        const isActiveSection = sIdx === activeSectionIdx;
        const firstAtom = sec.atoms?.[0];
        return (
          <li
            key={sIdx}
            onClick={() => {
              setActiveSection({ chapterIdx: chapter.ch, sectionIdx: sIdx });
              setCenterTab('section');
              // CP445.x — section 클릭 시 첫 atom 의 vid 로 player 교체. 같은
              // 영상이면 ?t= query 만 갱신해 같은 vid 안 timestamp seek.
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
              'cursor-pointer rounded-[4px] px-2 py-1 leading-[1.5] transition-colors',
              // CP445.x — 비활성 단일 색상, 활성 = 보라색 highlight + 폰트
              // 한 단계 크게 (11px → 12px) + medium weight.
              isActiveSection
                ? 'text-[12px] font-medium text-[#818cf8]'
                : 'text-[11px] text-sidebar-foreground/80 hover:text-sidebar-foreground'
            )}
          >
            {chapter.ch + 1}.{sIdx + 1} {sec.title}
          </li>
        );
      })}
    </ul>
  );
}
