import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Search, Sparkles } from 'lucide-react';

import { apiClient } from '@/shared/lib/api-client';
import { DOMAIN_STYLES, type MandalaDomain, getDomainLabel } from '@/shared/config/domain-colors';

const DEFAULT_BADGE_CLASS = 'bg-muted text-muted-foreground';
const AI_BADGE_CLASS = 'bg-primary/20 text-primary';

function getDomainBadgeStyle(domain: string | null | undefined): CSSProperties | undefined {
  if (!domain) return undefined;
  const ds = DOMAIN_STYLES[domain as MandalaDomain];
  if (!ds) return undefined;
  return { backgroundColor: ds.dim, color: ds.color };
}

// ─── Mini cell text rendering ───
//
// IMPORTANT: Labels MUST be displayed in full — that is the entire purpose
// of using `subLabels` instead of full `sub_goals`. Never truncate a label.
// Long fallback text (when no label exists) is allowed to wrap naturally.
function renderCellText(text: string): string {
  return text ?? '';
}

// ─── Component ───

export type MandalaCardVariant =
  | 'template'
  | 'template-loading'
  | 'template-delayed'
  | 'ai-loading'
  | 'ai-complete'
  | 'ai-delayed';

export interface MandalaCardProps {
  variant: MandalaCardVariant;
  domain?: string | null;
  centerLabel?: string | null;
  /** Short labels (2-4 chars) for grid cells. Preferred over `subjects`. */
  subjectLabels?: string[];
  /** Full sub-goal text — used as fallback if subjectLabels missing. */
  subjects?: string[];
  title?: string;
  matchPct?: number;
  onClick?: () => void;
  /** Retry handler for delayed variants. */
  onRetry?: () => void;
  /**
   * CP361 Issue #375 — inline hint text shown below the skeleton on
   * `template-loading` / `ai-loading` variants. Used to communicate the
   * soft-slow state ("평소보다 조금 걸리고 있어요") WITHOUT transitioning
   * to the amber DelayedCard. Renders in neutral `text-muted-foreground`
   * color — NEVER amber. Undefined / empty string = no hint shown.
   */
  hint?: string;
}

export default function MandalaCard({
  variant,
  domain,
  centerLabel,
  subjectLabels,
  subjects = [],
  title,
  matchPct,
  onClick,
  onRetry,
  hint,
}: MandalaCardProps) {
  const { t, i18n } = useTranslation();

  // CP358 hotfix: ALL hooks must be called before any conditional return,
  // otherwise React error #300 ("Rendered fewer hooks than expected") fires
  // when the variant transitions between delayed ↔ non-delayed.
  // Async label generation fallback: when no labels exist, fetch short labels via OpenRouter.
  const [generatedLabels, setGeneratedLabels] = useState<{
    center_label: string;
    sub_labels: string[];
  } | null>(null);

  const isAiLoading = variant === 'ai-loading';
  const isTemplateLoading = variant === 'template-loading';
  const isLoading = isAiLoading || isTemplateLoading;
  const isAiComplete = variant === 'ai-complete';
  const isAi = isAiLoading || isAiComplete;
  const isDelayed = variant === 'template-delayed' || variant === 'ai-delayed';

  // Resolve domain → localized label + inline color style via SSOT
  // (domain-colors.ts). DB stores the English enum ('finance', 'tech', …);
  // the badge text is the translated label.
  const domainStyle = isAi ? undefined : getDomainBadgeStyle(domain);
  const domainLabel =
    domain && DOMAIN_STYLES[domain as MandalaDomain]
      ? getDomainLabel(domain as MandalaDomain, i18n.language)
      : t('wizard.goal.card.domainGeneral', 'general');

  // Distinguish real short labels from full sub_goal text. We check
  // maxLen instead of avgLen because it is language-agnostic:
  //   - Korean labels:  2-8 chars  ("시장 기초")
  //   - English labels: 10-25 chars ("Country Selection")
  //   - Full sub_goals: 40-100+ chars
  // 30 sits comfortably above the longest real label and below the
  // shortest full sub_goal, so Korean and English templates both pass.
  const validLabels = (subjectLabels ?? []).filter((l) => l && l.trim().length > 0);
  const maxLabelLen = validLabels.reduce((m, l) => (l.length > m ? l.length : m), 0);
  const hasRealLabels = validLabels.length >= 4 && maxLabelLen > 0 && maxLabelLen <= 30;
  const goalForLabels = title ?? centerLabel ?? '';
  // Delayed variants don't render the rich card, so they never need generated
  // labels — but the hook still has to be called unconditionally.
  const needsLabels =
    !isLoading && !isDelayed && !hasRealLabels && subjects.length >= 4 && goalForLabels.length > 0;

  useEffect(() => {
    if (!needsLabels) return;
    let cancelled = false;
    apiClient
      .generateLabels({ center_goal: goalForLabels, sub_goals: subjects })
      .then((res) => {
        if (!cancelled) setGeneratedLabels(res);
      })
      .catch(() => {
        // Silent fail — fall back to truncated subjects
      });
    return () => {
      cancelled = true;
    };
  }, [needsLabels, goalForLabels, subjects]);

  // Delayed state short-circuits the rich card — rendered as its own
  // amber stalled card so the layout stays visually stable (same slot
  // dimensions) while the in-flight request is still retryable. This
  // early return MUST be after all hooks above to keep hook order stable.
  if (isDelayed) {
    return <DelayedCard variant={variant} onRetry={onRetry} />;
  }

  // Prefer (in order): generated sub labels → provided labels → full sub_goals
  // NOTE: We intentionally do NOT use generatedLabels.center_label.
  // The center label must be the user's actual goal (already short), not an LLM rewrite.
  const cellSource = (idx: number): string => {
    const generated = generatedLabels?.sub_labels?.[idx];
    if (generated && generated.trim().length > 0) return generated;
    const label = subjectLabels?.[idx];
    if (label && label.trim().length > 0) return label;
    return subjects[idx] ?? '';
  };

  const effectiveCenterLabel = centerLabel;

  // Build 9-cell grid: cells[0..3], center, cells[4..7]
  const gridCells: Array<{ text: string; isCenter: boolean }> = [];
  for (let i = 0; i < 9; i++) {
    if (i === 4) {
      gridCells.push({ text: effectiveCenterLabel ?? '', isCenter: true });
    } else {
      const idx = i < 4 ? i : i - 1;
      gridCells.push({ text: cellSource(idx), isCenter: false });
    }
  }

  const cardClass = [
    'group relative overflow-hidden rounded-xl px-5 pb-5 pt-[20px] text-left transition-all duration-200',
    isAiLoading
      ? 'border border-dashed border-primary/40 bg-primary/[0.05] cursor-default ai-loading-shimmer'
      : isTemplateLoading
        ? 'border border-border-subtle bg-card/60 cursor-default'
        : isAiComplete
          ? 'border-[1.5px] border-primary bg-card shadow-[0_0_0_3px_hsl(var(--primary)/0.15)] cursor-pointer hover:-translate-y-[2px]'
          : 'border border-border-subtle bg-card cursor-pointer hover:-translate-y-[2px] hover:bg-card/80 hover:border-border hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)]',
  ].join(' ');

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      className={cardClass}
      aria-label={title ?? 'Mandala card'}
    >
      {/* Top row: domain badge (left) + hover arrow (right) */}
      <div className="mb-3 flex items-start justify-between gap-2">
        {isTemplateLoading ? (
          <div className="h-[18px] w-16 animate-pulse rounded bg-foreground/[0.06]" />
        ) : (
          <div
            className={`inline-flex items-center gap-1 rounded px-2 py-[2px] text-[10px] font-semibold ${
              isAi ? AI_BADGE_CLASS : domainStyle ? '' : DEFAULT_BADGE_CLASS
            }`}
            style={domainStyle}
          >
            {isAiLoading && (
              <Sparkles
                className="h-2.5 w-2.5 animate-pulse"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            )}
            {isAiComplete && (
              <Sparkles className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden="true" />
            )}
            {isAiLoading
              ? t('wizard.goal.card.aiLoadingBadge', 'AI generating...')
              : isAiComplete
                ? t('wizard.goal.card.aiCompleteBadge', 'AI custom')
                : domainLabel}
          </div>
        )}
        {!isLoading && (
          <ArrowRight
            className="h-4 w-4 flex-shrink-0 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-[2px] group-hover:opacity-100"
            strokeWidth={2}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Mini 9-cell grid */}
      <div className="mb-3 grid grid-cols-3 gap-1">
        {gridCells.map((cell, idx) => {
          const baseClass =
            'flex aspect-square items-center justify-center overflow-hidden rounded p-1 text-center text-[10px] leading-[1.2]';
          const fillClass = cell.isCenter
            ? isAi
              ? 'bg-primary/30 font-semibold text-primary'
              : 'bg-primary/20 font-semibold text-primary'
            : isAiLoading
              ? `bg-primary/[0.10] ai-cell-pulse-${(idx * 137) % 9}`
              : isTemplateLoading
                ? 'bg-foreground/[0.04] animate-pulse'
                : 'bg-background/60 text-muted-foreground';
          return (
            <div key={idx} className={`${baseClass} ${fillClass}`}>
              <span className="line-clamp-3 break-keep">
                {isLoading ? '' : renderCellText(cell.text)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Title */}
      {isLoading ? (
        <>
          <div
            className={`mb-1.5 h-[10px] w-[60%] animate-pulse rounded ${
              isAiLoading ? 'bg-primary/[0.18]' : 'bg-foreground/[0.06]'
            }`}
          />
          <div
            className={`h-[10px] w-[40%] animate-pulse rounded ${
              isAiLoading ? 'bg-primary/[0.18]' : 'bg-foreground/[0.06]'
            }`}
          />
        </>
      ) : (
        <h4 className="mb-2.5 line-clamp-2 text-[13px] font-semibold leading-snug text-foreground break-keep">
          {title}
        </h4>
      )}

      {/* Match bar */}
      {!isLoading ? (
        <div className="flex items-center gap-2">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-background/60">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: isAiComplete ? '100%' : `${matchPct ?? 0}%` }}
            />
          </div>
          <div
            className={`min-w-[32px] text-right text-[11px] font-semibold ${
              isAiComplete ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            {isAiComplete ? t('wizard.goal.card.matchLabel', 'Best') : `${matchPct ?? 0}%`}
          </div>
        </div>
      ) : (
        <>
          <div
            className={`h-[3px] w-full animate-pulse rounded-full ${
              isAiLoading ? 'bg-primary/20' : 'bg-foreground/[0.06]'
            }`}
          />
          {/* CP361 Issue #375 — soft-slow inline hint. Only visible when the
              caller passes a hint string (via isSearchSoftSlow / isGenerateSoftSlow).
              Neutral color — NEVER amber. Announced via aria-live for a11y. */}
          {hint && (
            <div
              className="mt-3 text-center text-[11px] leading-snug text-muted-foreground"
              aria-live="polite"
            >
              {hint}
            </div>
          )}
        </>
      )}
    </button>
  );
}

// ─── Delayed card ───
//
// Amber stalled state used when a slow in-flight request crosses its
// soft-timeout threshold. Keeps the same slot dimensions as a regular
// card so the grid does not reflow. The underlying request is NOT
// canceled by this state — if it resolves, the parent replaces the
// delayed card with the real result. The retry button is an explicit
// opt-in to re-fire the mutation.

interface DelayedCardProps {
  variant: 'template-delayed' | 'ai-delayed';
  onRetry?: () => void;
}

function DelayedCard({ variant, onRetry }: DelayedCardProps) {
  const { t } = useTranslation();
  const isAi = variant === 'ai-delayed';

  const title = isAi
    ? t('wizard.goal.delayed.aiTitle', 'This is taking a while')
    : t('wizard.goal.delayed.templateTitle', 'Template search is slower than usual');
  const subtitle = isAi
    ? t('wizard.goal.delayed.aiSubtitle', 'Want to try again?')
    : t('wizard.goal.delayed.templateSubtitle', 'Want to try again?');
  const retryLabel = t('wizard.goal.delayed.retry', 'Retry');

  // Amber palette (hsl) — matches the mockup's --amber / --amber-bg
  const AMBER = 'hsl(38, 90%, 60%)';
  const AMBER_BG = 'hsl(38, 40%, 12%)';
  const AMBER_BG_HOVER = 'hsl(38, 40%, 16%)';

  return (
    <div
      className="group flex min-h-[260px] flex-col items-center justify-center rounded-[14px] px-5 py-7 text-center"
      style={{
        border: `1px dashed ${AMBER}`,
        background: AMBER_BG,
      }}
      role="status"
      aria-live="polite"
    >
      <div
        className="mb-4 flex h-11 w-11 items-center justify-center rounded-full"
        style={{ background: 'hsl(38, 50%, 20%)' }}
      >
        {isAi ? (
          <Sparkles className="h-5 w-5" style={{ color: AMBER }} strokeWidth={2} />
        ) : (
          <Search className="h-5 w-5" style={{ color: AMBER }} strokeWidth={2} />
        )}
      </div>
      <div className="mb-1 text-[13.5px] font-semibold leading-snug text-foreground">{title}</div>
      <div className="mb-5 text-[12px] leading-snug text-muted-foreground">{subtitle}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border bg-transparent px-4 py-1.5 text-[12px] font-semibold transition-colors"
          style={{
            borderColor: AMBER,
            color: AMBER,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = AMBER_BG_HOVER;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
