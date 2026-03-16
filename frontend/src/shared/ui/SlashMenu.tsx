import { useEffect, useRef, useCallback, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { getAvailableCommands, CATEGORY_LABELS, type SlashCommand } from '@/shared/lib/slash-commands';

interface SlashMenuProps {
  onSelect: (itemId: string) => void;
  onClose: () => void;
  hasPlayer?: boolean;
}

function groupByCategory(items: SlashCommand[]): Record<string, SlashCommand[]> {
  const grouped: Record<string, SlashCommand[]> = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }
  return grouped;
}

export function SlashMenu({ onSelect, onClose, hasPlayer = true }: SlashMenuProps) {
  const { t } = useTranslation();
  const items = getAvailableCommands(hasPlayer);
  const grouped = groupByCategory(items);
  const selectedIndexRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        selectedIndexRef.current = Math.min(selectedIndexRef.current + 1, items.length - 1);
        forceUpdate();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        selectedIndexRef.current = Math.max(selectedIndexRef.current - 1, 0);
        forceUpdate();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const item = items[selectedIndexRef.current];
        if (item.enabled) {
          onSelect(item.id);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [items, onSelect, onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Build flat index for keyboard navigation across category groups
  let flatIndex = 0;

  return (
    <div
      ref={menuRef}
      className="w-52 rounded-lg border shadow-lg overflow-hidden"
      style={{
        background: 'hsl(var(--bg-mid))',
        borderColor: 'hsl(var(--border) / 0.3)',
      }}
    >
      {Object.entries(grouped).map(([category, categoryItems], groupIdx) => (
        <div key={category}>
          <div
            className={`px-3 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider ${
              groupIdx > 0 ? 'border-t border-border/10' : ''
            }`}
          >
            {CATEGORY_LABELS[category] ?? category}
          </div>
          {categoryItems.map((item: SlashCommand) => {
            const currentFlatIndex = flatIndex++;
            return (
              <button
                key={item.id}
                className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 transition-colors ${
                  currentFlatIndex === selectedIndexRef.current ? 'bg-primary/10' : ''
                } ${item.enabled ? 'cursor-pointer hover:bg-primary/5' : 'opacity-50 cursor-default'}`}
                onClick={() => {
                  if (item.enabled) onSelect(item.id);
                }}
                onMouseEnter={() => {
                  selectedIndexRef.current = currentFlatIndex;
                  forceUpdate();
                }}
              >
                <span className="text-sm">{item.icon}</span>
                <span className={item.enabled ? 'text-foreground' : 'text-muted-foreground'}>
                  {t(item.labelKey)}
                </span>
                {!item.enabled && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {t('videoPlayer.comingSoon')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
