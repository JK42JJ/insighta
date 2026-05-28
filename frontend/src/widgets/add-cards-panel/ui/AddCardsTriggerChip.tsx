/**
 * Add Cards trigger chip — opens the slide-in panel scoped to the
 * current mandalaId. The count badge prefers the live Zustand value
 * (panel keeps it fresh on pick / search) and falls back to the
 * localStorage-persisted card list on reload so the badge survives a
 * full page refresh (user-reported 2026-05-18 "새로고침하면 카드수
 * 사라짐").
 *
 * Spec: docs/design/add-cards-2026-05-18.md §2.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark } from 'lucide-react';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';
import { loadAddCardsState } from '../lib/persistence';

interface AddCardsTriggerChipProps {
  mandalaId: string | null;
}

export function AddCardsTriggerChip({ mandalaId }: AddCardsTriggerChipProps) {
  const { t } = useTranslation();
  const openPanel = useAddCardsPanelStore((s) => s.openPanel);
  const storeCount = useAddCardsPanelStore((s) =>
    mandalaId ? s.visibleCountByMandala[mandalaId] : undefined
  );

  // Hydrate fallback from localStorage when the in-memory store has not
  // been populated yet (page reload — Zustand state is session-scoped).
  // Re-runs when mandalaId changes so switching mandalas refreshes the
  // badge without waiting for the panel to open.
  const [persistedCount, setPersistedCount] = useState<number>(0);
  useEffect(() => {
    if (!mandalaId) {
      setPersistedCount(0);
      return;
    }
    const stored = loadAddCardsState(mandalaId);
    // CP489 Phase 4 — persistence shape changed `cards[]` → `rounds[]`.
    // Sum across rounds for the badge total.
    const total = stored?.rounds.reduce((n, r) => n + r.cards.length, 0) ?? 0;
    setPersistedCount(total);
  }, [mandalaId]);

  const count = storeCount ?? persistedCount;

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
