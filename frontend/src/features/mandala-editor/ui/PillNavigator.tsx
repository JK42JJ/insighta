import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { EditorBlock } from '@/shared/types/mandala-ux';

interface PillNavigatorProps {
  blocks: EditorBlock[];
  currentIndex: number;
  onSelect: (idx: number) => void;
  onAiBlock: () => void;
}

const SPARKLE_SVG = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

export default function PillNavigator({
  blocks,
  currentIndex,
  onSelect,
  onAiBlock,
}: PillNavigatorProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Auto-scroll active pill into view
  useEffect(() => {
    const pill = pillRefs.current[currentIndex];
    if (pill) {
      pill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [currentIndex]);

  return (
    <div className="flex items-center gap-2 mb-9">
      {/* Pill bar */}
      <div
        ref={scrollRef}
        className="flex gap-1.5 overflow-x-auto flex-1 pb-1 scrollbar-none"
        role="tablist"
        aria-label={t('editor.navigator.aria')}
      >
        {blocks.map((block, i) => {
          const filled = block.items.filter((x) => x).length;
          const pct = Math.round((filled / 8) * 100);
          const isActive = i === currentIndex;
          const isFull = filled === 8;

          return (
            <button
              key={i}
              ref={(el) => {
                pillRefs.current[i] = el;
              }}
              role="tab"
              aria-selected={isActive}
              aria-label={`${block.name} ${filled}/8`}
              onClick={() => onSelect(i)}
              className={[
                'flex-shrink-0 flex flex-col items-center gap-1 px-4 py-2 pb-2.5',
                'rounded-xl border cursor-pointer transition-all duration-200 min-w-[72px]',
                isActive
                  ? 'border-primary/30 bg-primary/[0.04]'
                  : 'border-border bg-card hover:border-border/80 hover:bg-muted/30',
              ].join(' ')}
            >
              {/* Name */}
              <span
                className={[
                  'text-[11px] font-semibold whitespace-nowrap transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                ].join(' ')}
              >
                {block.isCenter && (
                  <span
                    className="text-primary text-[9px] mr-0.5"
                    aria-label={t('editor.navigator.centerBlock')}
                  >
                    ★{' '}
                  </span>
                )}
                {block.name}
              </span>

              {/* Progress bar */}
              <div className="w-full h-[3px] rounded-sm bg-white/[0.03] overflow-hidden">
                <div
                  className={[
                    'h-full rounded-sm transition-[width] duration-400',
                    isFull ? 'bg-teal-400' : 'bg-primary',
                  ].join(' ')}
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* Count */}
              <span
                className={[
                  'text-[9px] font-bold',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                ].join(' ')}
              >
                {filled}/8
              </span>
            </button>
          );
        })}
      </div>

      {/* AI block fill button */}
      <button
        onClick={onAiBlock}
        className={[
          'flex-shrink-0 w-10 h-14 rounded-xl flex items-center justify-center',
          'bg-card border border-dashed border-primary/20 text-primary',
          'transition-all duration-200 relative group',
          'hover:bg-primary/[0.04] hover:border-primary/35',
        ].join(' ')}
        aria-label={t('editor.navigator.aiFill')}
      >
        <span className="opacity-60 group-hover:opacity-100 transition-opacity">{SPARKLE_SVG}</span>
        <span
          className={[
            'absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap',
            'text-[9px] font-semibold text-primary',
            'opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none',
          ].join(' ')}
        >
          {t('editor.navigator.aiFill')}
        </span>
      </button>
    </div>
  );
}
