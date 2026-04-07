import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WizardTemplate } from '@/shared/types/mandala-ux';

interface WizardStepPreviewProps {
  template: WizardTemplate;
  isLoadingDetail?: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

const CENTER_IDX = 4;

/**
 * Highlight occurrences of `label` inside `fullText` with a primary-tinted span.
 * Used in the detail panel so the short label is visually anchored within the
 * full sub-goal sentence.
 */
function HighlightedText({ text, highlight }: { text: string; highlight?: string | null }) {
  if (!highlight || highlight.trim().length === 0 || !text.includes(highlight)) {
    return <>{text}</>;
  }
  const idx = text.indexOf(highlight);
  return (
    <>
      {text.slice(0, idx)}
      <span className="rounded-[3px] bg-primary/15 px-[3px] font-semibold text-primary">
        {highlight}
      </span>
      {text.slice(idx + highlight.length)}
    </>
  );
}

export default function WizardStepPreview({
  template,
  isLoadingDetail: _isLoadingDetail,
  onConfirm,
  onBack,
}: WizardStepPreviewProps) {
  const { t } = useTranslation();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Resolve center cell label: prefer centerLabel → centerGoal (full)
  const centerCellText = template.centerLabel ?? template.centerGoal ?? '';

  // Build cell label per index: prefer subLabels (full, never truncated) → fall back to subjects
  const cellLabel = (idx: number): string => {
    const label = template.subLabels?.[idx];
    if (label && label.trim().length > 0) return label;
    return template.subjects[idx] ?? '';
  };

  // 9-cell layout: cells[0..3], center, cells[4..7]
  const cells: string[] = [];
  for (let i = 0; i < 9; i++) {
    if (i === CENTER_IDX) cells.push(centerCellText);
    else cells.push(cellLabel(i < CENTER_IDX ? i : i - 1));
  }

  // Detail content for hovered cell (full text + actions)
  const getDetail = () => {
    if (hoveredIdx === null) return null;

    if (hoveredIdx === CENTER_IDX) {
      return {
        title: template.centerGoal,
        highlight: template.centerLabel ?? null,
        sub: t('wizard.preview.centerGoal', { count: template.subjects.length }),
        items: template.subjects.map((s, i) => ({
          text: `${i + 1}. ${s}`,
          highlight: template.subLabels?.[i] ?? null,
        })),
      };
    }

    const subjectIdx = hoveredIdx < CENTER_IDX ? hoveredIdx : hoveredIdx - 1;
    const fullSubject = template.subjects[subjectIdx] ?? cells[hoveredIdx];
    const actions = template.subDetails[subjectIdx] ?? [];

    return {
      title: fullSubject,
      highlight: template.subLabels?.[subjectIdx] ?? null,
      sub: t('wizard.preview.subject', { index: subjectIdx + 1, count: actions.length }),
      items: actions.map((a) => ({ text: a, highlight: null })),
    };
  };

  const detail = getDetail();

  return (
    <div className="wizard-step-enter">
      <h1 className="text-[28px] font-black leading-tight tracking-tight">{template.title}</h1>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">
        {t('wizard.preview.subtitle')}
      </p>

      {/* Preview unit: grid + detail area */}
      <div className="mt-9 flex items-start justify-center gap-10">
        {/* 3x3 Grid (uses short labels for cells) */}
        <div className="grid w-[320px] flex-shrink-0 grid-cols-3 gap-[6px]">
          {cells.map((label, idx) => {
            const isCenter = idx === CENTER_IDX;
            const isHovered = hoveredIdx === idx;

            return (
              <div
                key={idx}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className={`flex aspect-square cursor-pointer items-center justify-center rounded-[10px] border p-2 text-center text-[13px] font-semibold leading-tight transition-all duration-200 ${
                  isCenter
                    ? 'border-primary/[0.18] bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),hsl(var(--primary)/0.03))] text-[14px] font-extrabold text-primary'
                    : isHovered
                      ? 'border-primary/30 bg-primary/[0.05] text-primary'
                      : 'border-border bg-card text-muted-foreground'
                }`}
              >
                <span className="break-keep">{label}</span>
              </div>
            );
          })}
        </div>

        {/* Detail area — wider, no wrap on titles, comfortable line-height for action items */}
        <div className="w-[360px] flex-shrink-0 pt-1.5">
          {detail === null ? (
            <div className="text-xs font-medium text-muted-foreground">
              {t('wizard.preview.hint.line1')}
              <br />
              {t('wizard.preview.hint.line2')}
            </div>
          ) : (
            <div className="wizard-content-swap">
              <div className="mb-1 break-keep text-[16px] font-extrabold leading-snug tracking-tight text-primary">
                <HighlightedText text={detail.title} highlight={detail.highlight} />
              </div>
              <div className="mb-3.5 text-[10.5px] text-muted-foreground">{detail.sub}</div>
              <ul className="list-none space-y-[5px]">
                {detail.items.map((item, i) => (
                  <li
                    key={i}
                    className="break-keep text-[12.5px] leading-[1.55] text-muted-foreground transition-colors duration-100 hover:text-foreground"
                  >
                    <HighlightedText text={item.text} highlight={item.highlight} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="mt-9 text-center">
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex items-center gap-[7px] rounded-xl border-0 bg-primary px-7 py-[11px] text-sm font-bold text-primary-foreground shadow-[0_3px_14px_hsl(var(--primary)/0.25),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_5px_22px_hsl(var(--primary)/0.35)] active:translate-y-0"
        >
          {t('wizard.preview.startButton')} &rarr;
        </button>
        <button
          type="button"
          onClick={onBack}
          className="ml-2 inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-transparent px-5 py-[9px] text-[13px] font-semibold text-muted-foreground transition-all duration-[180ms] hover:border-foreground/10 hover:bg-foreground/[0.02] hover:text-foreground"
        >
          {t('wizard.preview.backButton')}
        </button>
      </div>
    </div>
  );
}
