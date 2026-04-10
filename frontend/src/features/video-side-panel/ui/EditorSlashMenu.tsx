/**
 * Minimal slash command menu for the Tiptap side panel editor.
 * Appears inline below the cursor when '/' is typed.
 * Styled to match the editor's dark theme (no boxy borders).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface SlashMenuItem {
  id: string;
  icon: React.ReactNode;
  i18nKey: string;
  shortcut?: string;
}

const ITEMS: SlashMenuItem[] = [
  {
    id: 'timestamp',
    icon: <Clock className="w-3.5 h-3.5" />,
    i18nKey: 'videoPlayer.slashTimestamp',
    shortcut: '⌘⇧T',
  },
];

interface EditorSlashMenuProps {
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function EditorSlashMenu({ onSelect, onClose }: EditorSlashMenuProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelected((s) => Math.min(s + 1, ITEMS.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onSelect(ITEMS[selected].id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key !== 'Shift' && e.key !== 'Meta' && e.key !== 'Control' && e.key !== 'Alt') {
        onClose();
      }
    },
    [selected, onSelect, onClose]
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

  return (
    <div
      ref={menuRef}
      className={cn(
        'w-48 rounded-lg py-1 overflow-hidden',
        'bg-[rgba(22,24,35,0.96)] backdrop-blur-xl',
        'border border-[rgba(255,255,255,0.06)]',
        'shadow-[0_8px_30px_rgba(0,0,0,0.5)]'
      )}
    >
      {ITEMS.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          onMouseEnter={() => setSelected(i)}
          className={cn(
            'flex items-center gap-2.5 w-full px-3 py-1.5 text-left text-[12px] transition-colors',
            i === selected
              ? 'bg-[rgba(129,140,248,0.12)] text-[#ededf0]'
              : 'text-[#9394a0] hover:text-[#ededf0]'
          )}
        >
          <span className={i === selected ? 'text-[#818cf8]' : 'text-[#5a5b68]'}>{item.icon}</span>
          <span className="flex-1">{t(item.i18nKey)}</span>
          {item.shortcut && <span className="text-[10px] text-[#3a3b46]">{item.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}
