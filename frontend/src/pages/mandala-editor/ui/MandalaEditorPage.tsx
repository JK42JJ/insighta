import { useEffect, useCallback, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

import { Switch } from '@/shared/ui/switch';
import { useEditor, PillNavigator, FocusGrid, CompletionBar } from '@/features/mandala-editor';

export default function MandalaEditorPage() {
  const { t } = useTranslation();
  const ghostSuggestions = t('editor.ghostSuggestions', { returnObjects: true }) as string[];
  const { id } = useParams<{ id: string }>();
  const {
    currentBlockIndex,
    blocks,
    isDirty,
    isLoading,
    error,
    isSaving,
    setBlockItem,
    setBlockName,
    selectBlock,
    save,
  } = useEditor(id);

  const [isPublic, setIsPublic] = useState(false);

  // ─── beforeunload warning ───
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ─── Keyboard navigation (ArrowLeft/Right for block switching) ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (blocks.length === 0) return;

      if (e.key === 'ArrowLeft') {
        selectBlock((currentBlockIndex - 1 + blocks.length) % blocks.length);
      } else if (e.key === 'ArrowRight') {
        selectBlock((currentBlockIndex + 1) % blocks.length);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentBlockIndex, blocks.length, selectBlock]);

  // ─── AI block fill (accept ghost text for all empty cells) ───
  const handleAiBlock = useCallback(() => {
    const block = blocks[currentBlockIndex];
    if (!block) return;

    block.items.forEach((val, itemIdx) => {
      if (!val) {
        const ghost = ghostSuggestions[itemIdx % ghostSuggestions.length];
        setBlockItem(currentBlockIndex, itemIdx, ghost);
      }
    });
  }, [blocks, currentBlockIndex, setBlockItem, ghostSuggestions]);

  // ─── AI cell fill (single cell) ───
  const handleAiCell = useCallback(
    (itemIdx: number) => {
      const block = blocks[currentBlockIndex];
      if (!block || block.items[itemIdx]) return;
      const ghost = ghostSuggestions[itemIdx % ghostSuggestions.length];
      setBlockItem(currentBlockIndex, itemIdx, ghost);
    },
    [blocks, currentBlockIndex, setBlockItem, ghostSuggestions]
  );

  // ─── Item / center change handlers ───
  const handleItemChange = useCallback(
    (itemIdx: number, value: string) => {
      setBlockItem(currentBlockIndex, itemIdx, value);
    },
    [currentBlockIndex, setBlockItem]
  );

  const handleCenterChange = useCallback(
    (value: string) => {
      setBlockName(currentBlockIndex, value);
    },
    [currentBlockIndex, setBlockName]
  );

  // ─── Loading / Error states ───
  if (isLoading) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-8 w-8 rounded-lg bg-card border border-border animate-pulse" />
          <div className="h-5 w-32 rounded bg-card animate-pulse" />
        </div>
        <div className="grid grid-cols-3 gap-2 max-w-[420px] mx-auto">
          {Array.from({ length: 9 }, (_, i) => (
            <div
              key={i}
              className="aspect-square rounded-xl bg-card border border-border animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-10">
        <p className="text-sm text-destructive">{t('editor.error.loadFailed')}</p>
        <Link
          to={`/mandalas/${id}`}
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          {t('editor.error.backButton')}
        </Link>
      </div>
    );
  }

  const currentBlock = blocks[currentBlockIndex];

  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between mb-7">
        <div className="flex items-center gap-2.5">
          <Link
            to={`/mandalas/${id}`}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/10 transition-colors"
            aria-label={t('editor.header.back')}
          >
            &larr;
          </Link>
          <h1 className="text-lg font-extrabold tracking-tight">{t('editor.header.title')}</h1>
          {blocks.length > 0 && blocks[4] && (
            <span className="text-sm text-muted-foreground truncate max-w-[200px]">
              {blocks[4].name}
            </span>
          )}
        </div>
        <button
          onClick={save}
          disabled={isSaving || !isDirty}
          className={[
            'px-6 py-2 text-sm font-bold rounded-xl text-white transition-all duration-200',
            isDirty
              ? 'bg-primary shadow-[0_3px_12px_hsl(var(--primary)/0.25)] hover:-translate-y-px hover:shadow-[0_5px_20px_hsl(var(--primary)/0.35)]'
              : 'bg-primary/50 cursor-not-allowed',
          ].join(' ')}
        >
          {isSaving ? t('editor.header.saving') : t('editor.header.save')}
        </button>
      </div>

      {/* ─── Pill Navigator ─── */}
      {blocks.length > 0 && (
        <PillNavigator blocks={blocks} currentIndex={currentBlockIndex} onSelect={selectBlock} />
      )}

      {/* ─── Focus Grid ─── */}
      {currentBlock && (
        <FocusGrid
          block={currentBlock}
          mandalaId={id}
          onItemChange={handleItemChange}
          onCenterChange={handleCenterChange}
          onAiCell={handleAiCell}
          onAiBlock={handleAiBlock}
        />
      )}

      {/* ─── Completion Bar ─── */}
      {blocks.length > 0 && <CompletionBar blocks={blocks} currentBlockIndex={currentBlockIndex} />}

      {/* ─── Explore link ─── */}
      <div className="text-center">
        <Link
          to="/explore"
          className="text-xs font-semibold text-muted-foreground hover:text-primary transition-colors"
        >
          &rarr; {t('editor.exploreLink')}
        </Link>
      </div>

      {/* ─── Share toggle ─── */}
      <div className="flex items-center justify-between p-3.5 px-[18px] bg-card border border-border rounded-xl mt-5">
        <div>
          <div className="text-[13px] font-semibold flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            {t('editor.share.title')}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {t('editor.share.subtitle')}
          </div>
        </div>
        <Switch
          checked={isPublic}
          onCheckedChange={setIsPublic}
          aria-label={t('editor.share.aria')}
        />
      </div>

      {/* ─── Keyboard hints ─── */}
      <div className="text-center mt-4 text-[10.5px] text-muted-foreground/40">
        <kbd className="inline-block px-1.5 py-px rounded border border-border bg-card text-[10px] font-semibold mx-0.5">
          Tab
        </kbd>{' '}
        {t('editor.keyboard.nextCell')} \u00B7{' '}
        <kbd className="inline-block px-1.5 py-px rounded border border-border bg-card text-[10px] font-semibold mx-0.5">
          &larr;
        </kbd>
        <kbd className="inline-block px-1.5 py-px rounded border border-border bg-card text-[10px] font-semibold mx-0.5">
          &rarr;
        </kbd>{' '}
        {t('editor.keyboard.switchBlock')} \u00B7{' '}
        <kbd className="inline-block px-1.5 py-px rounded border border-border bg-card text-[10px] font-semibold mx-0.5">
          Esc
        </kbd>{' '}
        {t('editor.keyboard.exit')}
      </div>
    </div>
  );
}
