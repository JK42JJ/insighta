import { useRef, useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { EditorBlock } from '@/shared/types/mandala-ux';
import '@/features/mandala-editor/ui/mandala-editor.css';

const SPARKLE_SVG = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="hsl(var(--primary))"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

interface FocusGridProps {
  block: EditorBlock;
  mandalaId?: string;
  onItemChange: (itemIdx: number, value: string) => void;
  onCenterChange: (value: string) => void;
  onAiCell: (itemIdx: number) => void;
  onAiBlock: () => void;
}

/**
 * Maps 9-cell grid position to item index.
 * Layout: cells[0-3] = items[0-3], cell[4] = center, cells[5-8] = items[4-7]
 */
function cellToItemIndex(cellIdx: number): number | 'center' {
  if (cellIdx === 4) return 'center';
  return cellIdx < 4 ? cellIdx : cellIdx - 1;
}

export default function FocusGrid({
  block,
  mandalaId,
  onItemChange,
  onCenterChange,
  onAiCell,
  onAiBlock,
}: FocusGridProps) {
  const { t } = useTranslation();
  const ghostSuggestions = t('editor.ghostSuggestions', { returnObjects: true }) as string[];
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [animKey, setAnimKey] = useState(0);

  // Trigger swap animation when block changes
  const prevBlockRef = useRef(block.name);
  useEffect(() => {
    if (prevBlockRef.current !== block.name) {
      prevBlockRef.current = block.name;
      setAnimKey((k) => k + 1);
    }
  }, [block.name]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, cellIdx: number) => {
      const input = e.currentTarget;
      const mapping = cellToItemIndex(cellIdx);

      // Tab: accept ghost placeholder if empty
      if (e.key === 'Tab' && !input.value && input.placeholder) {
        e.preventDefault();
        const accepted = input.placeholder;

        if (mapping === 'center') {
          onCenterChange(accepted);
        } else {
          onItemChange(mapping, accepted);
        }

        // Focus next cell
        const nextCell = cellIdx + 1;
        if (nextCell < 9) {
          inputRefs.current[nextCell]?.focus();
        }
      }
    },
    [onItemChange, onCenterChange]
  );

  const handleChange = useCallback(
    (cellIdx: number, value: string) => {
      const mapping = cellToItemIndex(cellIdx);
      if (mapping === 'center') {
        onCenterChange(value);
      } else {
        onItemChange(mapping, value);
      }
    },
    [onItemChange, onCenterChange]
  );

  return (
    <div className="mb-7">
      {/* Block label */}
      <div className="text-center mb-5">
        <div className="text-[22px] font-black text-primary tracking-tight">{block.name}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {block.isCenter ? t('editor.grid.centerLabel') : t('editor.grid.subLabel')}
        </div>
      </div>

      {/* 3x3 Grid */}
      <div
        key={animKey}
        className="grid grid-cols-3 gap-2 max-w-[420px] mx-auto editor-grid-swap"
        role="grid"
        aria-label={`${block.name} ${t('editor.grid.aria')}`}
      >
        {Array.from({ length: 9 }, (_, cellIdx) => {
          const mapping = cellToItemIndex(cellIdx);
          const isCenter = mapping === 'center';
          const itemIdx = isCenter ? -1 : mapping;
          const value = isCenter ? block.name : block.items[itemIdx] || '';
          const ghost = !value ? ghostSuggestions[itemIdx % ghostSuggestions.length] : '';
          const hasValue = !!value;

          return (
            <div
              key={cellIdx}
              className={[
                'aspect-square rounded-xl border relative flex items-center justify-center',
                'p-3 transition-all duration-200 group',
                isCenter
                  ? 'bg-gradient-to-br from-primary/[0.08] to-primary/[0.03] border-primary/20'
                  : 'bg-card border-border hover:border-border/80',
                // focus-within glow
                '[&:focus-within]:border-primary/30 [&:focus-within]:editor-cell-glow',
              ].join(' ')}
              role="gridcell"
            >
              {isCenter ? (
                /* ─── Center cell: dashboard link + AI block fill ─── */
                <div className="flex flex-col items-center gap-2 w-full">
                  {mandalaId ? (
                    <Link
                      to={`/mandalas/${mandalaId}`}
                      className="text-[14px] font-extrabold text-primary text-center leading-tight hover:underline"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {block.name}
                    </Link>
                  ) : (
                    <span
                      className="text-[14px] font-extrabold text-primary text-center leading-tight"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {block.name}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={onAiBlock}
                    className="flex flex-col items-center gap-0.5 opacity-50 hover:opacity-100 hover:scale-110 transition-all cursor-pointer"
                    title={t('editor.grid.aiBlockTooltip')}
                    aria-label={t('editor.navigator.aiFill')}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                    </svg>
                    <span className="text-[10px] font-semibold text-primary">
                      {t('editor.grid.aiFillLabel')}
                    </span>
                  </button>
                </div>
              ) : (
                /* ─── Regular cell: editable input with 2-line clamp display ─── */
                <>
                  {/* Cell number */}
                  <span className="absolute top-[7px] left-[9px] text-[9px] font-bold text-muted-foreground/50">
                    {itemIdx + 1}
                  </span>

                  {/* Display span (2-line clamp) — click to focus input */}
                  {hasValue && (
                    <span
                      className="w-full text-center text-[13px] font-semibold text-foreground leading-snug cursor-text peer-focus:hidden"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                      onClick={() => inputRefs.current[cellIdx]?.focus()}
                    >
                      {value}
                    </span>
                  )}
                  {/* Input (visible when focused or empty) */}
                  <input
                    ref={(el) => {
                      inputRefs.current[cellIdx] = el;
                    }}
                    type="text"
                    value={value}
                    placeholder={ghost}
                    onChange={(e) => handleChange(cellIdx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, cellIdx)}
                    className={[
                      'w-full text-center bg-transparent border-none outline-none leading-snug text-[13px] font-semibold text-foreground placeholder:text-primary/25 placeholder:italic placeholder:font-medium placeholder:text-xs',
                      hasValue ? 'absolute inset-0 opacity-0 focus:relative focus:opacity-100' : '',
                    ].join(' ')}
                    aria-label={t('editor.grid.item', { index: itemIdx + 1 })}
                  />

                  {/* Filled indicator: small teal dot (bottom-right) */}
                  {hasValue && (
                    <span className="absolute bottom-[7px] right-[9px] w-[5px] h-[5px] rounded-full bg-teal-400/50" />
                  )}

                  {/* AI sparkle icon (top-right, empty cells only) */}
                  {!hasValue && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAiCell(itemIdx);
                      }}
                      className={[
                        'absolute top-1.5 right-[7px] w-[22px] h-[22px] rounded-md',
                        'grid place-items-center bg-primary/[0.06] border border-primary/10',
                        'opacity-0 group-hover:opacity-100 group-hover:editor-sparkle-in',
                        'cursor-pointer z-[2] transition-opacity',
                        'hover:bg-primary/[0.12] hover:border-primary/25',
                      ].join(' ')}
                      aria-label={t('editor.grid.aiSuggestion', { index: itemIdx + 1 })}
                    >
                      {SPARKLE_SVG}
                    </button>
                  )}

                  {/* "Tab 수락" hint */}
                  {!hasValue && (
                    <span
                      className={[
                        'absolute bottom-1.5 left-1/2 -translate-x-1/2',
                        'text-[8px] font-semibold text-primary/20',
                        'opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none',
                      ].join(' ')}
                    >
                      {t('editor.grid.tabAccept')}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
