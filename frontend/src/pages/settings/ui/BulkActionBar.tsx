import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { ChevronUp, Pause, Trash2, X as XIcon } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

const DROPDOWN_Z_INDEX = 9998;

interface BulkActionBarProps {
  count: number;
  mandalaOptions: Array<{ id: string; title: string }>;
  onAssignMandala: (mandalaId: string) => void;
  onPause: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function BulkActionBar({
  count,
  mandalaOptions,
  onAssignMandala,
  onPause,
  onDelete,
  onCancel,
}: BulkActionBarProps) {
  const { t } = useTranslation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ left: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const closeDropdown = useCallback(() => setShowDropdown(false), []);

  const toggleDropdown = () => {
    if (!showDropdown && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    }
    setShowDropdown(!showDropdown);
  };

  useEffect(() => {
    if (!showDropdown) return;
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        dropRef.current &&
        !dropRef.current.contains(t) &&
        btnRef.current &&
        !btnRef.current.contains(t)
      ) {
        closeDropdown();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDropdown();
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [showDropdown, closeDropdown]);

  if (count === 0) return null;

  const label = count === 1 ? t('sources.assignMandala', 'Mandala') : t('sources.bulkAssign');

  return (
    <>
      {/* Bar — sticky within content flow */}
      <div className="sticky bottom-0 z-[80] -mx-6 mt-3">
        <div className="mx-6 mb-2 rounded-xl bg-surface-base/95 border border-border px-5 py-3 flex items-center gap-3 shadow-2xl backdrop-blur-xl">
          {/* Count */}
          <span className="text-[13px] font-semibold text-primary tabular-nums">{count}</span>
          <span className="text-[12px] text-muted-foreground mr-1">
            {t('sources.selected', 'selected')}
          </span>

          {/* Divider */}
          <div className="w-px h-5 bg-border/40" />

          {/* Mandala assign */}
          <button
            ref={btnRef}
            onClick={toggleDropdown}
            className={cn(
              'h-8 px-3.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition-all border',
              showDropdown
                ? 'bg-primary/15 border-primary/40 text-primary'
                : 'bg-white/[.04] border-transparent text-muted-foreground hover:text-foreground hover:bg-white/[.06]'
            )}
          >
            {label}
            <ChevronUp
              className={cn('w-3 h-3 transition-transform', showDropdown && 'rotate-180')}
            />
          </button>

          {/* Pause */}
          <button
            onClick={onPause}
            className="h-8 px-3.5 rounded-lg text-[12px] font-medium bg-white/[.04] border border-transparent text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10 hover:border-amber-400/20 transition-all flex items-center gap-1.5"
          >
            <Pause className="w-3 h-3" />
            {t('playlist.pause')}
          </button>

          {/* Delete */}
          <button
            onClick={onDelete}
            className="h-8 px-3.5 rounded-lg text-[12px] font-medium bg-white/[.04] border border-transparent text-muted-foreground hover:text-red-400 hover:bg-red-400/10 hover:border-red-400/20 transition-all flex items-center gap-1.5"
          >
            <Trash2 className="w-3 h-3" />
            {t('common.delete')}
          </button>

          {/* Spacer + Cancel */}
          <button
            onClick={onCancel}
            className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-white/[.06] transition-all"
            title={t('common.cancel')}
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Dropdown portal */}
      {showDropdown &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropRef}
            className="fixed w-56 bg-surface-mid border border-border rounded-xl shadow-xl py-1.5 max-h-52 overflow-y-auto"
            style={{ left: dropdownPos.left, bottom: dropdownPos.bottom, zIndex: DROPDOWN_Z_INDEX }}
          >
            {mandalaOptions.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  onAssignMandala(m.id);
                  closeDropdown();
                }}
                className="w-full text-left px-3.5 py-2 text-[13px] text-foreground/80 hover:text-foreground hover:bg-white/[.04] transition-colors truncate"
              >
                {m.title}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
