/**
 * Add Cards trigger chip (CP466).
 *
 * Renders the "+ Add Cards" chip rendered by IndexPage in the grid
 * view header trailing slot. Click opens the slide-in panel scoped to
 * the current mandalaId.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §2 (trigger).
 */

import { useTranslation } from 'react-i18next';
import { Bookmark } from 'lucide-react';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';

interface AddCardsTriggerChipProps {
  mandalaId: string | null;
}

export function AddCardsTriggerChip({ mandalaId }: AddCardsTriggerChipProps) {
  const { t } = useTranslation();
  const openPanel = useAddCardsPanelStore((s) => s.openPanel);

  if (!mandalaId) return null;

  return (
    <button
      type="button"
      onClick={() => openPanel(mandalaId)}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      style={{
        borderColor: 'hsl(var(--border) / 0.4)',
        color: 'hsl(var(--foreground))',
      }}
      aria-label={t('addCards.triggerChip', '+ Add Cards')}
    >
      <Bookmark className="h-3.5 w-3.5" strokeWidth={2.2} />
      <span>{t('addCards.triggerChip', '+ Add Cards')}</span>
    </button>
  );
}
