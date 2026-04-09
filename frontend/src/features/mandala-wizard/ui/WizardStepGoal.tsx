import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Search, X } from 'lucide-react';

import { apiClient } from '@/shared/lib/api-client';
import type { MandalaSearchResult, GeneratedMandala } from '@/shared/types/mandala-ux';
import MandalaCard from './MandalaCard';

// ─── Trending example placeholders (MVP — static fallback before YouTube API integration) ───
const TRENDING_EXAMPLES: Record<string, string[]> = {
  ko: [
    'AI 활용해 부업 월 100만원',
    '퇴근 후 1시간으로 토익 900점',
    '3개월 안에 5kg 감량',
    'React 풀스택 포트폴리오 완성',
    '주식 투자 첫 1000만원 굴리기',
    '유튜브 채널 구독자 1000명',
    '매일 운동하는 습관 만들기',
    '디지털 노마드 1년 안에 떠나기',
  ],
  en: [
    'Earn $1K/month with AI side project',
    'Score TOEIC 900 in 6 months',
    'Lose 5kg in 3 months',
    'Build a full-stack React portfolio',
    'Invest first $10K in stocks',
    'Grow YouTube channel to 1K subs',
    'Build a daily workout habit',
    'Become a digital nomad in 1 year',
  ],
};

const PLACEHOLDER_ROTATE_MS = 3500;

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
}: WizardStepGoalProps) {
  const { t, i18n } = useTranslation();
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

  // ─── Rotating placeholder (trending examples) ───
  const examples = useMemo(() => {
    const lang = i18n.language?.startsWith('ko') ? 'ko' : 'en';
    return TRENDING_EXAMPLES[lang] ?? TRENDING_EXAMPLES.en;
  }, [i18n.language]);

  const [exampleIdx, setExampleIdx] = useState(() => Math.floor(Math.random() * examples.length));

  // Rotate placeholder while input is empty + idle
  useEffect(() => {
    if (localGoal.length > 0) return;
    const id = window.setInterval(() => {
      setExampleIdx((prev) => (prev + 1) % examples.length);
    }, PLACEHOLDER_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [localGoal.length, examples.length]);

  const placeholder = `${t('wizard.goal.placeholderPrefix', 'e.g.')} ${examples[exampleIdx]}`;

  // BUSY = any in-flight request (search or generate)
  const isBusy = isSearching || isGenerating;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) {
      onCancelGoal();
      return;
    }
    const trimmed = localGoal.trim();
    if (trimmed) {
      onSetGoalInput(trimmed);
      onSubmitGoal(trimmed);
    }
  };

  const handleClear = () => {
    setLocalGoal('');
    onClearGoal();
  };

  const hasSubmitted = goalInput.length > 0;
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
      ? t('wizard.goal.ai.phase1', '목표 분석 중...')
      : aiElapsedMs < AI_PHASE_DRAFT_MS
        ? t('wizard.goal.ai.phase2', '세부목표 8개 생성 중...')
        : t('wizard.goal.ai.phase3', '만다라 완성 중...');

  // Soft-slow inline hint text (shown below skeleton, NEVER amber).
  const searchSoftSlowHint = isSearchSoftSlow
    ? t('wizard.goal.softSlow.search', '평소보다 조금 걸리고 있어요...')
    : undefined;
  const generateSoftSlowHint = isGenerateSoftSlow
    ? t('wizard.goal.softSlow.generate', '조금만 더 기다려 주세요...')
    : undefined;

  return (
    <div className="wizard-step-enter">
      <h1 className="text-[28px] font-black leading-tight tracking-tight">
        {t('wizard.goal.title', 'What is your goal?')}
      </h1>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">
        {t(
          'wizard.goal.subtitle',
          'Enter your goal — we’ll find similar templates and generate a custom mandala.'
        )}
      </p>

      {/* Goal input */}
      <form onSubmit={handleSubmit} className="mt-8">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <input
            type="text"
            value={localGoal}
            onChange={(e) => setLocalGoal(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-2xl border border-border bg-card py-[18px] pl-12 pr-36 text-[15px] outline-none transition-colors focus:border-primary/40 focus:bg-primary/[0.02]"
            aria-label={t('wizard.goal.inputAria', 'Goal input')}
          />
          {/* Clear button (X) — only visible in idle state with text */}
          {!isBusy && localGoal.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-[76px] top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
              aria-label={t('wizard.goal.clear', 'Clear input')}
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
          {/* Go / Cancel toggle button (single source of action) */}
          <button
            type="submit"
            disabled={!isBusy && !localGoal.trim()}
            className={`absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
              isBusy
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                : 'bg-primary text-primary-foreground'
            }`}
          >
            {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isBusy ? t('wizard.goal.cancel', 'Cancel') : t('wizard.goal.submit', 'Go')}
          </button>
        </div>
      </form>

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
            // Order is stable from the moment user submits — slots fill in as data arrives.
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              {/* Slots 1-3: template results.
                  CP361 Issue #375 — 3-way state branching:
                    1. Real error  (isSearchFailed)   → amber DelayedCard + Retry
                    2. Soft-slow   (isSearchSoftSlow) → skeleton + inline hint
                    3. Loading     (isSearching)      → plain skeleton
                  Failed takes priority over soft-slow. */}
              {[0, 1, 2].map((slotIdx) => {
                const result = searchResults[slotIdx];
                if (result) {
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
                      onClick={() => onSelectSearchResult(result)}
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
                  onClick={() => onSelectGeneratedMandala(aiGenerated)}
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

      {/* Separator + blank create */}
      <div className="my-8 text-center text-[11px] font-semibold text-foreground/[0.06]">
        {t('wizard.domain.separator', '— or —')}
      </div>
      <div className="text-center">
        <button
          type="button"
          onClick={onCreateBlank}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-transparent px-5 py-2.5 text-[13px] font-semibold text-muted-foreground transition-all duration-[180ms] hover:border-foreground/10 hover:bg-foreground/[0.02] hover:text-foreground"
        >
          {t('wizard.domain.createBlank', 'Create from scratch')} &rarr;
        </button>
      </div>
    </div>
  );
}
