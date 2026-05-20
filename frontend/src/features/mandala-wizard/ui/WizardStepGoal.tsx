import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  Code,
  TrendingUp,
  Languages,
  Brain,
  Activity,
  Sparkles,
  Bot,
  Wallet,
  Bitcoin,
} from 'lucide-react';

import { apiClient } from '@/shared/lib/api-client';
import type { MandalaSearchResult, GeneratedMandala } from '@/shared/types/mandala-ux';
import { cn } from '@/shared/lib/utils';
import MandalaCard from './MandalaCard';
import { WizardSearchBar } from './WizardSearchBar';

const SUGGESTIONS = [
  { key: 's_vibe', Icon: Sparkles, hoverIcon: 'group-hover:text-amber-400' },
  { key: 's_agent', Icon: Bot, hoverIcon: 'group-hover:text-sky-400' },
  { key: 's_side', Icon: Wallet, hoverIcon: 'group-hover:text-emerald-400' },
  { key: 's_crypto', Icon: Bitcoin, hoverIcon: 'group-hover:text-orange-400' },
  { key: 's1', Icon: Code, hoverIcon: 'group-hover:text-indigo-400' },
  { key: 's2', Icon: TrendingUp, hoverIcon: 'group-hover:text-teal-400' },
  { key: 's3', Icon: Languages, hoverIcon: 'group-hover:text-violet-400' },
  { key: 's4', Icon: Brain, hoverIcon: 'group-hover:text-pink-400' },
  { key: 's5', Icon: Activity, hoverIcon: 'group-hover:text-rose-400' },
] as const;

// ─── CP361 Issue #375 — phased AI loading label thresholds ───
//
// Client-side timer thresholds for the "ai-loading" progress label.
// Calibrated against observed prod LoRA+LLM completion times (30-45s
// typical). The three phases are EXPECTATION MANAGEMENT strings, not
// real progress reporting — backend has no streaming hook.
//
// Invariant: AI_PHASE_ANALYSIS_MS < AI_PHASE_DRAFT_MS < GENERATE_DELAY_MS
// (the last threshold is owned by useWizard.ts). Bumping any of these
// WITHOUT also bumping the next tier downstream will compress one phase
// into invisibility.
const AI_PHASE_ANALYSIS_MS = 10_000;
const AI_PHASE_DRAFT_MS = 30_000;
/** Poll interval for the AI phase label timer. 1s matches human-perceptible
 *  label transitions without causing wasted re-renders. */
const AI_PROGRESS_POLL_MS = 1_000;

// ─── Component ───

interface WizardStepGoalProps {
  goalInput: string;
  searchResults: MandalaSearchResult[];
  isSearching: boolean;
  /** True only after the search mutation has successfully resolved at least once.
   *  Used to gate the "no templates found" empty state to avoid a 1-frame
   *  flicker between reset() and mutate() when the user re-submits. */
  searchSucceeded: boolean;
  /** CP361 Issue #375 — search has crossed the soft-slow threshold but is
   *  still in flight (no error). Caller should show inline hint, NOT amber. */
  isSearchSoftSlow: boolean;
  /** CP361 Issue #375 — search mutation has actually errored. Show amber
   *  DelayedCard with Retry button. */
  isSearchFailed: boolean;
  onRetrySearch: () => void;
  aiGenerated: GeneratedMandala | null;
  aiSource: 'lora' | 'llm-fallback' | null;
  isGenerating: boolean;
  /** CP361 Issue #375 — AI generation has crossed the soft-slow threshold
   *  but is still in flight. Caller should show inline hint, NOT amber. */
  isGenerateSoftSlow: boolean;
  /** CP361 Issue #375 — AI generation mutation has actually errored. */
  isGenerateFailed: boolean;
  onRetryGenerate: () => void;
  generateError: Error | null;
  onSetGoalInput: (goal: string) => void;
  onSubmitGoal: (goal: string) => void;
  onCancelGoal: () => void;
  onClearGoal: () => void;
  onSelectSearchResult: (result: MandalaSearchResult) => void;
  onSelectGeneratedMandala: (generated: GeneratedMandala) => void;
  onCreateBlank: () => void;
  isCreatingBlank?: boolean;
  /** True only on step 3 (results). When false (step 1 idle), suppresses
   *  results-view UI (titleResults swap + similar templates section + AI grid)
   *  even if goalInput has a leftover value from a prior submit. */
  isResultsView?: boolean;
  /** Step-2 focus tags carried into step 3, shown read-only as chips inside
   *  the locked search bar so the user retains context while picking. */
  focusTags?: string[];
  /** Step 3 only — back to step 2 (context). Renders a small inline back link
   *  above the hero so the user is not stuck on the results page. */
  onBackToContext?: () => void;
}

export default function WizardStepGoal({
  goalInput,
  searchResults,
  isSearching,
  searchSucceeded,
  isSearchSoftSlow,
  isSearchFailed,
  onRetrySearch,
  aiGenerated,
  isGenerating,
  isGenerateSoftSlow,
  isGenerateFailed,
  onRetryGenerate,
  onSetGoalInput,
  onSubmitGoal,
  onCancelGoal,
  onClearGoal,
  onSelectSearchResult,
  onSelectGeneratedMandala,
  onCreateBlank,
  isCreatingBlank = false,
  isResultsView = false,
  focusTags,
  onBackToContext,
}: WizardStepGoalProps) {
  const { t } = useTranslation();
  const [localGoal, setLocalGoal] = useState(goalInput);

  // Sync local input with external state changes
  useEffect(() => {
    setLocalGoal(goalInput);
  }, [goalInput]);

  // Pre-warm Mac Mini Ollama model on first mount.
  // Eliminates ~45s cold-start when the user clicks "Start". Fire-and-forget.
  // Guard against React StrictMode double-mount (dev) so we only ping once.
  const prewarmedRef = useRef(false);
  useEffect(() => {
    if (prewarmedRef.current) return;
    prewarmedRef.current = true;
    void apiClient.prewarmMandalaModel();
  }, []);

  // CP453+ — placeholder is a single hero message; trending examples surface
  // as suggestion chips below the input instead of inline rotation, so the
  // old TRENDING_EXAMPLES table + rotation interval were dropped (CP454).
  const placeholder = t('wizard.goal.placeholder', '');

  // BUSY = any in-flight request (search or generate)
  const isBusy = isSearching || isGenerating;

  const handleWizardSubmit = () => {
    const trimmed = localGoal.trim();
    if (!trimmed) return;
    onSetGoalInput(trimmed);
    onSubmitGoal(trimmed);
  };

  const handleClear = () => {
    setLocalGoal('');
    onClearGoal();
  };

  const handleSuggestionClick = (text: string) => {
    setLocalGoal(text);
    onSetGoalInput(text);
    // Do NOT auto-submit; user reviews/edits the text in the search bar
    // and presses the submit button (or enter) to advance to step 2.
  };

  // Step 3 — selected template (template id) or 'ai' (generated mandala).
  // Card click only marks selection; the explicit "검색하기" button on the
  // search bar fires the actual create+search call.
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const handleResultsSubmit = () => {
    if (!isResultsView || !selectedItem) return;
    if (selectedItem === 'ai' && aiGenerated) {
      onSelectGeneratedMandala(aiGenerated);
      return;
    }
    const target = searchResults.find((r) => r.mandala_id === selectedItem);
    if (target) onSelectSearchResult(target);
  };

  // Results view = explicit prop only. Step 1 with leftover goalInput must
  // NOT render results UI (titleResults swap / similar templates section).
  const hasSubmitted = isResultsView && goalInput.length > 0;
  // Empty state fires only when the search has actually resolved successfully
  // with zero hits. CP358: gating on `searchSucceeded` (mutation.isSuccess)
  // instead of `!isSearching` removes the 1-frame race between reset() and
  // mutate() that briefly rendered a fake "no results" card.
  // CP361 Issue #375: split isSearchDelayed → isSearchSoftSlow + isSearchFailed.
  // Don't fire empty state during soft-slow either (request still in flight).
  const showNoResults =
    hasSubmitted &&
    searchSucceeded &&
    !isSearchSoftSlow &&
    !isSearchFailed &&
    searchResults.length === 0;

  // ─── CP361 Issue #375 — phased AI loading label (Bug B) ───
  //
  // AI generation (LoRA + LLM race) runs 30-45s normally. The user used to
  // see a single "생성중" label the whole time and wonder "why is this stuck?".
  // Client-side timer cycles a progress label through 3 phases based on
  // elapsed time — NO backend streaming required. Purpose is expectation
  // management, not real progress reporting.
  //
  // Phase boundaries are defined by AI_PHASE_ANALYSIS_MS / AI_PHASE_DRAFT_MS
  // at module scope (above) — see that block for the invariant with
  // GENERATE_DELAY_MS.
  const [aiElapsedMs, setAiElapsedMs] = useState(0);
  useEffect(() => {
    if (!isGenerating) {
      setAiElapsedMs(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => setAiElapsedMs(Date.now() - start), AI_PROGRESS_POLL_MS);
    return () => window.clearInterval(id);
  }, [isGenerating]);

  const aiPhaseLabel =
    aiElapsedMs < AI_PHASE_ANALYSIS_MS
      ? t('wizard.goal.ai.phase1', 'Analyzing goal...')
      : aiElapsedMs < AI_PHASE_DRAFT_MS
        ? t('wizard.goal.ai.phase2', 'Generating 8 sub-goals...')
        : t('wizard.goal.ai.phase3', 'Finalizing mandala...');

  // Soft-slow inline hint text (shown below skeleton, never amber).
  const searchSoftSlowHint = isSearchSoftSlow
    ? t('wizard.goal.softSlow.search', 'Taking longer than usual...')
    : undefined;
  const generateSoftSlowHint = isGenerateSoftSlow
    ? t('wizard.goal.softSlow.generate', 'Please wait a bit longer...')
    : undefined;

  return (
    <div className="wizard-step-enter">
      <div className="text-center">
        <h1
          className="text-[36px] font-bold leading-[1.2]"
          style={{ color: 'hsl(var(--foreground))', letterSpacing: '-0.03em' }}
        >
          {hasSubmitted
            ? t('wizard.goal.titleResults', 'Pick a mandala — AI will find videos for you')
            : t('wizard.goal.title', 'What goal do you want to start with?')}
        </h1>
      </div>

      <div className="mt-9">
        <WizardSearchBar
          value={localGoal}
          onChange={setLocalGoal}
          onSubmit={isResultsView ? handleResultsSubmit : handleWizardSubmit}
          onCancel={onCancelGoal}
          onClear={handleClear}
          placeholder={placeholder}
          isBusy={isBusy}
          readOnly={isResultsView}
          // Step-1-only feature: typeahead dropdown of matching template
          // titles. Disabled on step 3 (read-only locked bar). Step 2 uses a
          // different component entirely (focus tags input), so unaffected.
          enableTypeahead={!isResultsView}
          submitLabel={isResultsView ? t('wizard.goal.searchSelected', '검색하기') : undefined}
          submitDisabled={isResultsView && !selectedItem}
          focusTagsContext={isResultsView ? focusTags : undefined}
          ariaLabel={t('wizard.goal.inputAria', 'Goal input')}
          ariaSubmitLabel={
            isBusy
              ? t('wizard.goal.cancel', 'Cancel')
              : isResultsView
                ? t('wizard.goal.searchSelected', '검색하기')
                : t('wizard.goal.submit', 'Go')
          }
        />
      </div>

      {!hasSubmitted && (
        <div className="mx-auto mt-6 flex flex-col items-center gap-2">
          {[SUGGESTIONS.slice(0, 4), SUGGESTIONS.slice(4, 7), SUGGESTIONS.slice(7, 9)].map(
            (row, ri) => (
              <div key={ri} className="flex flex-nowrap justify-center gap-2">
                {row.map(({ key, Icon, hoverIcon }) => {
                  const text = t(`wizard.goal.suggestions.${key}`, '');
                  if (!text) return null;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSuggestionClick(text)}
                      className="group inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-[12.5px] font-medium transition-colors"
                      style={{
                        background: 'transparent',
                        border: '1px solid hsl(var(--border) / 0.4)',
                        color: 'hsl(var(--muted-foreground))',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'hsl(var(--foreground))';
                        e.currentTarget.style.borderColor = 'hsl(var(--border))';
                        e.currentTarget.style.background = 'hsl(var(--accent) / 0.3)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'hsl(var(--muted-foreground))';
                        e.currentTarget.style.borderColor = 'hsl(var(--border) / 0.4)';
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <Icon
                        className={`h-3.5 w-3.5 transition-colors ${hoverIcon}`}
                        strokeWidth={1.8}
                        aria-hidden="true"
                      />
                      {text}
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}

      {/* Unified card grid: similar templates + AI card (last slot) */}
      {hasSubmitted && (
        <div className="mt-6">
          <div className="mb-4 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            {t('wizard.goal.similar.title', 'Similar templates')}
          </div>

          {showNoResults &&
          !isGenerating &&
          !isGenerateSoftSlow &&
          !isGenerateFailed &&
          !aiGenerated ? (
            <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-xs text-muted-foreground">
              {t('wizard.goal.similar.empty', 'No similar templates found.')}
            </div>
          ) : (
            // Fixed 4-slot grid: 3 template slots + 1 AI slot.
            // Sorted ascending by similarity so the highest-match card sits
            // closest to the AI slot — left→right reads as "least → best fit".
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2].map((slotIdx) => {
                const sortedResults = [...searchResults].sort(
                  (a, b) => a.similarity - b.similarity
                );
                const result = sortedResults[slotIdx];
                if (result) {
                  const isSelected = isResultsView && selectedItem === result.mandala_id;
                  return (
                    <MandalaCard
                      key={result.mandala_id}
                      variant="template"
                      domain={result.domain}
                      centerLabel={result.center_label ?? result.center_goal}
                      subjectLabels={result.sub_labels}
                      subjects={result.sub_goals}
                      title={result.center_goal}
                      matchPct={Math.round(result.similarity * 100)}
                      isSelected={isSelected}
                      onClick={() =>
                        isResultsView
                          ? setSelectedItem(result.mandala_id)
                          : onSelectSearchResult(result)
                      }
                    />
                  );
                }
                if (isSearchFailed) {
                  // Real error — amber card with Retry in slot 0 only
                  if (slotIdx === 0) {
                    return (
                      <MandalaCard
                        key="tpl-delayed"
                        variant="template-delayed"
                        onRetry={onRetrySearch}
                      />
                    );
                  }
                  return <div key={`tpl-empty-${slotIdx}`} aria-hidden="true" />;
                }
                if (isSearching) {
                  // Soft-slow shows inline hint, otherwise plain skeleton.
                  // Hint rendered ONLY on slot 0 so it doesn't repeat 3x.
                  return (
                    <MandalaCard
                      key={`tpl-skel-${slotIdx}`}
                      variant="template-loading"
                      hint={slotIdx === 0 ? searchSoftSlowHint : undefined}
                    />
                  );
                }
                return <div key={`tpl-empty-${slotIdx}`} aria-hidden="true" />;
              })}

              {/* Slot 4: AI card — same 3-way split + phased loading label */}
              {aiGenerated ? (
                <MandalaCard
                  variant="ai-complete"
                  domain={aiGenerated.domain}
                  centerLabel={aiGenerated.center_label ?? aiGenerated.center_goal}
                  subjectLabels={aiGenerated.sub_labels}
                  subjects={aiGenerated.sub_goals}
                  title={aiGenerated.center_goal}
                  matchPct={100}
                  isSelected={isResultsView && selectedItem === 'ai'}
                  onClick={() =>
                    isResultsView ? setSelectedItem('ai') : onSelectGeneratedMandala(aiGenerated)
                  }
                />
              ) : isGenerateFailed ? (
                <MandalaCard variant="ai-delayed" onRetry={onRetryGenerate} />
              ) : isGenerating ? (
                <MandalaCard
                  variant="ai-loading"
                  centerLabel={aiPhaseLabel}
                  hint={generateSoftSlowHint}
                />
              ) : (
                <div aria-hidden="true" />
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer row — back (left) + createBlank (center), same visual weight */}
      <div className="mt-8 grid grid-cols-3 items-center">
        <div className="justify-self-start">
          {isResultsView && onBackToContext && (
            <button
              type="button"
              onClick={onBackToContext}
              className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-medium text-muted-foreground transition hover:bg-foreground/[0.04] hover:text-foreground"
            >
              {t('common.back', 'Back')}
            </button>
          )}
        </div>
        <div className="text-center">
          <button
            type="button"
            onClick={onCreateBlank}
            disabled={isCreatingBlank}
            className="text-[13px] font-medium text-muted-foreground/70 underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreatingBlank
              ? t('wizard.domain.creating', 'Creating...')
              : t('wizard.domain.createBlank', 'Start from scratch →')}
          </button>
        </div>
        <div />
      </div>
    </div>
  );
}
