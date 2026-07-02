/**
 * Sidebar search trigger — an input-look button that opens the ⌘K palette.
 * Replaces the legacy inline SearchBar (ulc-only search) so there is ONE
 * consistent search experience (claude.ai pattern).
 */
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openCommandPalette } from '../model/palette-controller';

export function CommandPaletteTrigger() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className="w-full h-9 flex items-center gap-2 pl-2 pr-2 rounded-md bg-sidebar-foreground/[0.06] text-[13px] text-muted-foreground hover:bg-sidebar-foreground/[0.1] transition-colors duration-150"
      aria-label={t('palette.title', '검색 및 빠른 작업')}
    >
      <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-left truncate">{t('search.placeholder', '카드 검색...')}</span>
      <kbd className="shrink-0 px-1.5 py-0.5 rounded border border-border/50 bg-muted/40 text-[10px] font-mono leading-none">
        ⌘K
      </kbd>
    </button>
  );
}
