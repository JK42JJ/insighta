import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, BookOpen, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMandalaQuery } from '@/features/mandala';
import { useMandalaBook } from '@/features/mandala/model/useMandalaBook';
import { useMandalaCards } from '@/pages/learning/model/useMandalaCards';
import type { InsightCard } from '@/entities/card/model/types';
import type { MandalaBookChapter } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';

interface SidebarLearningSectionProps {
  mandalaId: string;
  currentVideoId?: string;
  collapsed: boolean;
}

export function SidebarLearningSection({ mandalaId, collapsed }: SidebarLearningSectionProps) {
  const { t } = useTranslation();
  const [selectedCell, setSelectedCell] = useState<number | null>(null);

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

  const cardsByCell = new Map<number, InsightCard[]>();
  for (const card of mandalaCards) {
    const list = cardsByCell.get(card.cellIndex) ?? [];
    list.push(card);
    cardsByCell.set(card.cellIndex, list);
  }

  if (collapsed) {
    return (
      <div className="px-2 py-1">
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
    <div className="px-2 flex flex-col">
      <div className="px-3 py-2">
        <h3 className="text-[13px] font-bold text-sidebar-foreground leading-snug truncate">
          {centerGoal || t('sidebar.learning', 'Learning')}
        </h3>
        <p className="mt-0.5 text-[11px] text-sidebar-foreground/50">
          {t('learning.videoCount', { count: mandalaCards.length })}
        </p>
      </div>

      <div className="my-1 mx-2">
        <div className="h-px bg-sidebar-border" />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none">
        {subGoals.map((goal, idx) => {
          const cellCards = cardsByCell.get(idx + 1) ?? [];
          const isExpanded = selectedCell === idx + 1;
          // CP438+1 — book chapter `ch` is 0-based but cellIndex is 1-based.
          const bookChapter = bookChaptersByIdx.get(idx);
          const sectionCount = bookChapter?.sections?.length ?? 0;

          return (
            <div key={idx}>
              <button
                onClick={() => setSelectedCell(isExpanded ? null : idx + 1)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left rounded-lg transition-colors',
                  isExpanded
                    ? 'bg-sidebar-accent text-sidebar-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50'
                )}
              >
                <ChevronRight
                  className={cn('h-3 w-3 shrink-0 transition-transform', isExpanded && 'rotate-90')}
                />
                <span className="flex-1 truncate text-[12px] font-medium">{goal}</span>
                {sectionCount > 0 ? (
                  <span className="shrink-0 rounded-full bg-[rgba(45,212,191,0.15)] px-1.5 py-0.5 text-[10px] font-semibold text-[#2dd4bf]">
                    📖 {sectionCount}
                  </span>
                ) : (
                  cellCards.length > 0 && (
                    <span className="shrink-0 rounded-full bg-sidebar-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-sidebar-primary">
                      {cellCards.length}
                    </span>
                  )
                )}
              </button>

              {isExpanded && (
                <div className="px-3 pl-8 py-2">
                  {bookChapter ? (
                    <BookChapterPreview chapter={bookChapter} mandalaId={mandalaId} />
                  ) : (
                    <div className="flex items-center gap-1.5 text-[11px] text-sidebar-foreground/40">
                      <Sparkles className="w-3 h-3 shrink-0" />
                      <span>
                        {cellCards.length > 0
                          ? t('learning.reportPreparing', '보고서 작성 준비중 ...')
                          : t('learning.contentCollecting', '콘텐츠 수집 중...')}
                      </span>
                    </div>
                  )}
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
 * CP438+1 — In-sidebar preview of a book chapter (PoC).
 * Shows section titles + atom count + jump-to-video links. Atom
 * timestamp clicks navigate same-tab to /learning/:mandala/:vid?t=N
 * which LearningPage handles via the seekTo effect (no new YouTube tab).
 */
function BookChapterPreview({
  chapter,
  mandalaId,
}: {
  chapter: MandalaBookChapter;
  mandalaId: string;
}) {
  const sections = chapter.sections ?? [];

  return (
    <div className="space-y-2">
      {chapter.intro && (
        <p className="text-[11px] leading-[1.5] text-sidebar-foreground/50">{chapter.intro}</p>
      )}
      <ul className="space-y-2">
        {sections.map((sec, sIdx) => {
          const atoms = sec.atoms ?? [];
          return (
            <li
              key={sIdx}
              className="rounded-[6px] border border-sidebar-border bg-sidebar-accent/30 px-2 py-2"
            >
              <p className="text-[11px] font-semibold text-sidebar-foreground/80">{sec.title}</p>
              {sec.narrative && (
                <p className="mt-1 text-[10px] leading-[1.45] text-sidebar-foreground/55">
                  {sec.narrative}
                </p>
              )}
              {atoms.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {atoms.slice(0, 5).map((atom, aIdx) => (
                    <li
                      key={aIdx}
                      className="flex gap-1 text-[10px] leading-[1.4] text-sidebar-foreground/60"
                    >
                      <span className="shrink-0 text-sidebar-foreground/40">·</span>
                      <span className="flex-1">
                        {atom.text.slice(0, 60)}
                        {atom.text.length > 60 ? '…' : ''}
                        {atom.vid && Number.isFinite(atom.ts) && (
                          <Link
                            to={`/learning/${mandalaId}/${atom.vid}?t=${Math.floor(atom.ts ?? 0)}`}
                            className="ml-1 inline-block rounded-[3px] bg-[rgba(129,140,248,0.15)] px-1 font-mono text-[9px] text-[#818cf8]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            ▶ {Math.floor((atom.ts ?? 0) / 60)}:
                            {String(Math.floor((atom.ts ?? 0) % 60)).padStart(2, '0')}
                          </Link>
                        )}
                      </span>
                    </li>
                  ))}
                  {atoms.length > 5 && (
                    <li className="text-[10px] text-sidebar-foreground/40">
                      +{atoms.length - 5} more
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
