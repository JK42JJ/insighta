/**
 * Add Cards trigger chip (CP466).
 *
 * Rendered in the grid view trailing action slot. Click opens the
 * slide-in panel scoped to the current mandalaId.
 *
 * CP466 amendment 11 — count badge mirrors the panel header badge
 * (IdeaSpot pattern, IndexPage.tsx:688). Reads
 * `useAddCardsPanelStore.visibleCountByMandala[mandalaId]` which the
 * panel keeps in sync with its visible card count even after close,
 * so the chip surfaces "N cards waiting" to the user.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §2.
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
  const count = useAddCardsPanelStore((s) =>
    mandalaId ? (s.visibleCountByMandala[mandalaId] ?? 0) : 0
  );

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
      {count > 0 && (
        <span
          className="ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-tight"
          style={{
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
