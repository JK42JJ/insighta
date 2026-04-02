import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WizardTemplate } from '@/shared/types/mandala-ux';

interface WizardStepPreviewProps {
  template: WizardTemplate;
  isLoadingDetail?: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

export default function WizardStepPreview({
  template,
  isLoadingDetail,
  onConfirm,
  onBack,
}: WizardStepPreviewProps) {
  const { t } = useTranslation();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Build 3x3 cell array: [sub0..sub3, center, sub4..sub7]
  const cells = [
    ...template.subjects.slice(0, 4),
    template.centerGoal,
    ...template.subjects.slice(4),
  ];

  const CENTER_IDX = 4;

  // Determine detail content based on hovered cell
  const getDetail = () => {
    if (hoveredIdx === null) return null;

    if (hoveredIdx === CENTER_IDX) {
      return {
        name: template.centerGoal,
        sub: t('wizard.preview.centerGoal', { count: template.subjects.length }),
        items: template.subjects.map((s, i) => `${i + 1}. ${s}`),
      };
    }

    const subjectIdx = hoveredIdx < CENTER_IDX ? hoveredIdx : hoveredIdx - 1;
    const label = cells[hoveredIdx];
    const subItems = template.subDetails[subjectIdx] ?? [];

    return {
      name: label,
      sub: t('wizard.preview.subject', { index: subjectIdx + 1, count: subItems.length }),
      items: subItems,
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
      <div className="mt-9 flex items-start justify-center gap-9">
        {/* 3x3 Grid */}
        <div className="grid w-[300px] flex-shrink-0 grid-cols-3 gap-[5px]">
          {cells.map((label, idx) => {
            const isCenter = idx === CENTER_IDX;
            const isHovered = hoveredIdx === idx;

            return (
              <div
                key={idx}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className={`flex aspect-square cursor-pointer items-center justify-center rounded-[10px] border p-1.5 text-center text-[12.5px] font-semibold leading-tight transition-all duration-200 ${
                  isCenter
                    ? 'border-primary/[0.18] bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),hsl(var(--primary)/0.03))] text-[13px] font-extrabold text-primary'
                    : isHovered
                      ? 'border-primary/30 bg-primary/[0.05] text-primary'
                      : 'border-border bg-card text-muted-foreground'
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>

        {/* Detail area */}
        <div className="w-[200px] flex-shrink-0 pt-1.5">
          {detail === null ? (
            <div className="text-xs font-medium text-muted-foreground">
              {t('wizard.preview.hint.line1')}
              <br />
              {t('wizard.preview.hint.line2')}
            </div>
          ) : (
            <div className="wizard-content-swap">
              <div className="mb-0.5 text-[15px] font-extrabold tracking-tight text-primary">
                {detail.name}
              </div>
              <div className="mb-3.5 text-[10.5px] text-muted-foreground">{detail.sub}</div>
              <ul className="list-none space-y-0">
                {detail.items.map((item, i) => (
                  <li
                    key={i}
                    className="py-[3.5px] text-[12.5px] text-muted-foreground transition-colors duration-100 hover:text-foreground"
                  >
                    {item}
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
