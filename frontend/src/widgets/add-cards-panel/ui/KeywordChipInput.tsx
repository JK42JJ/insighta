/**
 * Keyword chip input (CP466).
 *
 * Enter or comma → addKeyword. X → removeKeyword.
 * Autocomplete (subjects + signal + history) deferred to follow-up PR
 * (spec §8 v2+ — chip suggestion source).
 *
 * CP466 amendment 11 — Korean IME composition guard. While the IME is
 * composing a 한글 syllable (e.g. "ㅅ" + "ㅡ" + "ㅂ" → "습"), an Enter
 * keypress used to commit the half-composed string AND fire Enter on
 * the SAME tick, producing one chip "일일 학습" + a leftover chip
 * "습" (user-reported 2026-05-18). Fix mirrors `WizardStepContext.tsx`
 * pattern: track `isComposing` via onCompositionStart/End and ignore
 * Enter / comma / blur while composing. Also defensive-check
 * `e.nativeEvent.isComposing` (React 18 native flag) so the guard
 * works even if composition events fire out of order in some browsers.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §6 (FE widget).
 */

import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';
import { apiClient } from '@/shared/lib/api-client';

const MAX_CHIP_LEN = 200;

export function KeywordChipInput() {
  const { t } = useTranslation();
  const extraKeywords = useAddCardsPanelStore((s) => s.extraKeywords);
  const addKeyword = useAddCardsPanelStore((s) => s.addKeyword);
  const removeKeyword = useAddCardsPanelStore((s) => s.removeKeyword);
  const mandalaId = useAddCardsPanelStore((s) => s.mandalaId);
  const [draft, setDraft] = useState('');
  const isComposingRef = useRef(false);

  // Persist chip removal at the DB layer. FE-only veto was lost on
  // reload + clobbered by the wizard-meta seed in the next search
  // response, causing removed chips (e.g. "박문호") to come back.
  const persistRemoval = useCallback(
    (kw: string) => {
      removeKeyword(kw);
      if (!mandalaId) return;
      const next = extraKeywords.filter((k) => k !== kw);
      void apiClient.updateMandalaFocusTags(mandalaId, next).catch(() => {
        // Non-fatal — the local store already removed the chip. If the
        // DB write fails the wizard-meta seed may re-add it on next
        // panel open, but that is a recoverable annoyance, not data
        // loss.
      });
    },
    [extraKeywords, mandalaId, removeKeyword]
  );

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
            onClick={() => persistRemoval(kw)}
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
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false;
        }}
        onKeyDown={(e) => {
          // Korean IME composition guard — skip commit triggers while
          // the syllable is still being assembled. Two layers because
          // browser implementations vary on which signal lands first.
          const composing = isComposingRef.current || e.nativeEvent.isComposing;
          if (e.key === 'Enter' || e.key === ',') {
            if (composing) return;
            e.preventDefault();
            commitDraft();
          } else if (e.key === 'Backspace' && draft === '' && extraKeywords.length > 0) {
            const last = extraKeywords[extraKeywords.length - 1];
            if (last) persistRemoval(last);
          }
        }}
        onBlur={() => {
          // Blur during composition would also commit a partial
          // syllable; defer until composition ends.
          if (isComposingRef.current) return;
          commitDraft();
        }}
        placeholder={t('addCards.panel.keywordPlaceholder', 'Add keyword…')}
        className="flex-1 min-w-[80px] bg-transparent text-[13px] placeholder:text-muted-foreground outline-none border-0"
        maxLength={MAX_CHIP_LEN}
      />
    </div>
  );
}
