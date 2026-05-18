/**
 * Keyword chip input (CP466).
 *
 * Enter or comma → addKeyword. X → removeKeyword.
 * Autocomplete (subjects + signal + history) deferred to follow-up PR
 * (spec §8 v2+ — chip suggestion source).
 *
 * Spec: docs/design/add-cards-2026-05-18.md §6 (FE widget).
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';

const MAX_CHIP_LEN = 200;

export function KeywordChipInput() {
  const { t } = useTranslation();
  const extraKeywords = useAddCardsPanelStore((s) => s.extraKeywords);
  const addKeyword = useAddCardsPanelStore((s) => s.addKeyword);
  const removeKeyword = useAddCardsPanelStore((s) => s.removeKeyword);
  const [draft, setDraft] = useState('');

  const commitDraft = useCallback(() => {
    const trimmed = draft.trim().slice(0, MAX_CHIP_LEN);
    if (trimmed.length === 0) return;
    addKeyword(trimmed);
    setDraft('');
  }, [draft, addKeyword]);

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
      {extraKeywords.map((kw) => (
        <span
          key={kw}
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-[12px] px-2.5 py-1"
        >
          {kw}
          <button
            type="button"
            onClick={() => removeKeyword(kw)}
            className="hover:bg-primary/15 rounded-full transition-colors"
            aria-label={t('addCards.panel.removeKeyword', {
              keyword: kw,
              defaultValue: 'Remove keyword {{keyword}}',
            })}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commitDraft();
          } else if (e.key === 'Backspace' && draft === '' && extraKeywords.length > 0) {
            const last = extraKeywords[extraKeywords.length - 1];
            if (last) removeKeyword(last);
          }
        }}
        onBlur={commitDraft}
        placeholder={t('addCards.panel.keywordPlaceholder', 'Add keyword…')}
        className="flex-1 min-w-[80px] bg-transparent text-[13px] placeholder:text-muted-foreground outline-none border-0"
        maxLength={MAX_CHIP_LEN}
      />
    </div>
  );
}
