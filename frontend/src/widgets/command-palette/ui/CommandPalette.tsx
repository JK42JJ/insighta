/**
 * ⌘K Command Palette — centered global search modal (design:
 * docs/design/global-search-cmdk-2026-07-02.md §4, claude.ai ⌘K reference).
 *
 * - Global Cmd/Ctrl+K opens it on ANY route (mounted at AppShell level).
 * - Empty input → Quick actions (새 만다라 / 템플릿 찾기).
 * - Typed input → grouped results (cards / mandalas / notes / summaries)
 *   from GET /api/v1/search; groups report honest totals + partial flags.
 * - ↑↓ move / ↵ run / esc close; footer shows the hints.
 * - Card hits navigate to the dashboard, switch mandala and hand off a
 *   highlight request via mandalaStore.pendingCardHighlight (Q3).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Loader2,
  Plus,
  Compass,
  SquarePlay,
  Grid3X3,
  NotebookText,
  Sparkles,
  CornerDownLeft,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog';
import { cn } from '@/shared/lib/utils';
import { useAuth } from '@/features/auth/model/useAuth';
import { useMandalaStore } from '@/stores/mandalaStore';
import type {
  GlobalSearchCardHit,
  GlobalSearchMandalaHit,
  GlobalSearchNoteHit,
  GlobalSearchSummaryHit,
} from '@/shared/lib/api-client';
import { useGlobalSearch } from '../model/useGlobalSearch';
import { subscribePaletteOpen } from '../model/palette-controller';

/** One flat keyboard-navigable row (quick action or search hit). */
interface PaletteRow {
  key: string;
  group: 'actions' | 'cards' | 'mandalas' | 'notes' | 'summaries';
  title: string;
  subtitle?: string | null;
  icon: React.ReactNode;
  run: () => void;
}

const INPUT_MAX_LEN = 100;

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();
  const selectMandala = useMandalaStore((s) => s.selectMandala);
  const setPendingCardHighlight = useMandalaStore((s) => s.setPendingCardHighlight);

  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isActive } = useGlobalSearch(term, open);

  // Global hotkey — palette owns Cmd/Ctrl+K app-wide (SearchBar's old
  // focus-binding was removed in this PR to avoid double firing).
  useEffect(() => {
    if (!isLoggedIn) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isLoggedIn]);

  // External open requests (sidebar trigger / collapsed icon).
  useEffect(() => subscribePaletteOpen(() => setOpen(true)), []);

  // Reset transient state whenever the palette closes.
  useEffect(() => {
    if (!open) {
      setTerm('');
      setActiveIndex(0);
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const goCard = useCallback(
    (hit: GlobalSearchCardHit) => {
      if (hit.mandalaId) selectMandala(hit.mandalaId);
      setPendingCardHighlight({ cardId: hit.id, videoId: hit.videoId });
      navigate('/');
      close();
    },
    [selectMandala, setPendingCardHighlight, navigate, close]
  );

  const goMandala = useCallback(
    (hit: GlobalSearchMandalaHit) => {
      selectMandala(hit.id);
      navigate('/');
      close();
    },
    [selectMandala, navigate, close]
  );

  const goNote = useCallback(
    (hit: GlobalSearchNoteHit) => {
      // /learning route requires a videoId — Phase 1 lands on the mandala.
      selectMandala(hit.mandalaId);
      navigate('/');
      close();
    },
    [selectMandala, navigate, close]
  );

  const goSummary = useCallback(
    (hit: GlobalSearchSummaryHit) => {
      if (hit.mandalaId) {
        navigate(`/learning/${hit.mandalaId}/${hit.videoId}`);
      } else {
        navigate('/');
      }
      close();
    },
    [navigate, close]
  );

  // Flat, ordered row list drives both rendering and ↑↓ navigation.
  const rows = useMemo<PaletteRow[]>(() => {
    const out: PaletteRow[] = [];
    if (!isActive) {
      out.push(
        {
          key: 'qa-new-mandala',
          group: 'actions',
          title: t('palette.actionNewMandala', '새 만다라'),
          icon: <Plus className="w-4 h-4" />,
          run: () => {
            navigate('/mandalas/new');
            close();
          },
        },
        {
          key: 'qa-templates',
          group: 'actions',
          title: t('palette.actionTemplates', '템플릿 찾기'),
          icon: <Compass className="w-4 h-4" />,
          run: () => {
            // Same destination as the sidebar 템플릿 찾기 menu (in-app explore,
            // NOT the /templates marketing page) — user-reported mismatch.
            navigate('/explore');
            close();
          },
        }
      );
      return out;
    }
    const g = data?.groups;
    for (const hit of g?.cards.items ?? []) {
      out.push({
        key: `card-${hit.kind}-${hit.id}`,
        group: 'cards',
        title: hit.title ?? t('palette.untitled', '(제목 없음)'),
        subtitle: hit.channelTitle ?? hit.note ?? hit.url,
        icon: <SquarePlay className="w-4 h-4" />,
        run: () => goCard(hit),
      });
    }
    for (const hit of g?.mandalas.items ?? []) {
      out.push({
        key: `mandala-${hit.id}`,
        group: 'mandalas',
        title: hit.centerLabel ?? hit.title ?? t('palette.untitled', '(제목 없음)'),
        subtitle: hit.centerLabel ? hit.title : null,
        icon: <Grid3X3 className="w-4 h-4" />,
        run: () => goMandala(hit),
      });
    }
    for (const hit of g?.notes.items ?? []) {
      out.push({
        key: `note-${hit.id}`,
        group: 'notes',
        title: hit.mandalaTitle ?? t('palette.noteFallback', '노트'),
        subtitle: hit.snippet,
        icon: <NotebookText className="w-4 h-4" />,
        run: () => goNote(hit),
      });
    }
    for (const hit of g?.summaries.items ?? []) {
      out.push({
        key: `summary-${hit.videoId}`,
        group: 'summaries',
        title: hit.videoTitle ?? t('palette.untitled', '(제목 없음)'),
        subtitle: hit.oneLiner,
        icon: <Sparkles className="w-4 h-4" />,
        run: () => goSummary(hit),
      });
    }
    return out;
  }, [isActive, data, t, navigate, close, goCard, goMandala, goNote, goSummary]);

  // Clamp the cursor when the row set changes.
  useEffect(() => {
    setActiveIndex((prev) => Math.min(prev, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((p) => (rows.length === 0 ? 0 : (p + 1) % rows.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((p) => (rows.length === 0 ? 0 : (p - 1 + rows.length) % rows.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        rows[activeIndex]?.run();
      }
    },
    [rows, activeIndex]
  );

  // Keep the active row visible while arrowing through a long list.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-palette-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const groupLabel: Record<PaletteRow['group'], string> = {
    actions: t('palette.groupActions', '빠른 작업'),
    cards: t('palette.groupCards', '카드'),
    mandalas: t('palette.groupMandalas', '만다라'),
    notes: t('palette.groupNotes', '노트'),
    summaries: t('palette.groupSummaries', '요약'),
  };
  const groupTotal: Partial<Record<PaletteRow['group'], number>> = {
    cards: data?.groups.cards.total,
    mandalas: data?.groups.mandalas.total,
    notes: data?.groups.notes.total,
    summaries: data?.groups.summaries.total,
  };

  if (!isLoggedIn) return null;

  let lastGroup: PaletteRow['group'] | null = null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        // Palette chrome — elevated popover surface, larger radius, deep shadow,
        // built-in dialog X hidden ([&>button]:hidden targets the direct child).
        // Width matched to the claude.ai ⌘K reference (~768px measured).
        className="max-w-3xl p-0 gap-0 overflow-hidden top-[18%] translate-y-0 rounded-xl border-border/40 bg-popover shadow-2xl [&>button]:hidden"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{t('palette.title', '검색 및 빠른 작업')}</DialogTitle>

        {/* Input row — seamless (no inner box); the global input:focus-visible
            ring (app/styles/index.css:328) is suppressed for the palette. */}
        <div className="flex items-center gap-2.5 px-4 h-[52px] border-b border-border/40">
          <Search className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={term}
            maxLength={INPUT_MAX_LEN}
            onChange={(e) => {
              setTerm(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('palette.placeholder', '카드, 만다라, 노트, 요약 검색…')}
            className="flex-1 h-full bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-haspopup="listbox"
          />
          {isLoading && <Loader2 className="w-4 h-4 shrink-0 text-muted-foreground animate-spin" />}
        </div>

        {/* Rows */}
        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto py-1.5 scrollbar-pro"
          role="listbox"
        >
          {rows.length === 0 && isActive && !isLoading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t('palette.empty', '결과가 없습니다')}
            </div>
          )}
          {rows.map((row, i) => {
            const showHeader = row.group !== lastGroup;
            lastGroup = row.group;
            const total = groupTotal[row.group];
            return (
              <div key={row.key}>
                {showHeader && (
                  <div className="px-4 pt-2 pb-1 text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                    {groupLabel[row.group]}
                    {typeof total === 'number' && total > 0 && (
                      <span className="opacity-60">{total}</span>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  data-palette-index={i}
                  onClick={row.run}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors',
                    i === activeIndex ? 'bg-accent text-accent-foreground' : 'text-foreground/85'
                  )}
                  role="option"
                  aria-selected={i === activeIndex}
                >
                  <span className="shrink-0 text-muted-foreground">{row.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{row.title}</span>
                    {row.subtitle && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.subtitle}
                      </span>
                    )}
                  </span>
                  {i === activeIndex && (
                    <CornerDownLeft
                      className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer hints — keycap chips (claude.ai reference) */}
        <div className="flex items-center gap-4 px-4 h-10 border-t border-border/40 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 min-w-[18px] text-center rounded border border-border/50 bg-muted/40 text-[10px] font-mono leading-none">
              ↑
            </kbd>
            <kbd className="px-1 py-0.5 min-w-[18px] text-center rounded border border-border/50 bg-muted/40 text-[10px] font-mono leading-none">
              ↓
            </kbd>
            {t('palette.hintSelect', '선택')}
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 min-w-[18px] text-center rounded border border-border/50 bg-muted/40 text-[10px] font-mono leading-none">
              ↵
            </kbd>
            {t('palette.hintOpen', '이동')}
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded border border-border/50 bg-muted/40 text-[10px] font-mono leading-none">
              esc
            </kbd>
            {t('palette.hintClose', '닫기')}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
