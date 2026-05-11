import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Link2, ArrowRight, Copy, Loader2 } from 'lucide-react';
import { MandalaFullPreview } from '@/widgets/mandala-full-preview';
import type { MandalaDomain } from '@/shared/config/domain-colors';
import { DOMAIN_STYLES, domainCssVars, getDomainLabel } from '@/shared/config/domain-colors';

interface MandalaLevel {
  centerGoal: string;
  subjects: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  domain: MandalaDomain | null;
  isTemplate: boolean;
  author: { displayName: string; avatarInitial: string } | null;
  rootLevel: MandalaLevel;
  subLevels?: (MandalaLevel | null)[];
  centerLabel?: string;
  subLabels?: string[];
  cloneCount: number;
  updatedAt: string;
  onStart: () => void;
  isStarting?: boolean;
  onCopyLink: () => void;
}

export function ExploreExpandModal({
  isOpen,
  onClose,
  title,
  domain,
  isTemplate,
  author,
  rootLevel,
  subLevels,
  centerLabel,
  subLabels,
  cloneCount,
  updatedAt,
  onStart,
  isStarting,
  onCopyLink,
}: Props) {
  const { i18n, t } = useTranslation();
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const ds = domain ? DOMAIN_STYLES[domain] : null;

  return (
    <div
      className="fixed inset-0 z-[200] flex justify-center items-start pt-10 px-5 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(20px) saturate(120%)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="explore-modal-enter rounded-2xl w-full max-w-[820px] p-9 relative"
        style={{
          background: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border) / 0.5)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
          ...domainCssVars(domain),
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-[18px] right-[18px] w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 text-base"
          style={{
            background: 'hsl(var(--muted) / 0.2)',
            border: '1px solid hsl(var(--border) / 0.3)',
            color: 'hsl(var(--muted-foreground) / 0.5)',
          }}
          aria-label={t('common.close', 'Close')}
        >
          <X size={16} />
        </button>

        {/* Top bar: title + meta (left) | actions (right) */}
        <div className="mb-6 pr-11 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2
              className="text-2xl font-bold tracking-tight mb-2 leading-snug break-keep"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              {title}
            </h2>
            <div className="flex items-center gap-2.5 flex-wrap">
              {ds && (
                <span className="explore-domain-badge text-xs font-semibold px-2.5 py-1 rounded">
                  {getDomainLabel(domain!, i18n.language)}
                </span>
              )}
              <span
                className="text-[13px] flex items-center gap-1.5"
                style={{ color: 'hsl(var(--muted-foreground) / 0.5)' }}
              >
                {isTemplate ? (
                  <>
                    <span
                      className="w-[22px] h-[22px] rounded-full inline-flex items-center justify-center text-[11px] font-semibold"
                      style={{
                        background: 'hsl(var(--primary) / 0.15)',
                        color: 'hsl(var(--primary))',
                      }}
                    >
                      I
                    </span>
                    {t('explore.modal.aiTemplate', 'Insighta AI 템플릿')}
                  </>
                ) : author ? (
                  <>
                    <span
                      className="w-[22px] h-[22px] rounded-full inline-flex items-center justify-center text-[11px] font-semibold"
                      style={{ background: 'hsl(var(--border) / 0.3)' }}
                    >
                      {author.avatarInitial}
                    </span>
                    {author.displayName}
                  </>
                ) : null}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onCopyLink}
              className="px-3 py-2 rounded-lg text-[12.5px] font-medium transition-all duration-150 inline-flex items-center gap-1.5"
              style={{
                background: 'transparent',
                color: 'hsl(var(--muted-foreground))',
                border: '1px solid hsl(var(--border) / 0.5)',
              }}
            >
              <Link2 size={13} />
              {t('explore.modal.copyLink', '링크 복사')}
            </button>
            <button
              onClick={onStart}
              disabled={isStarting}
              className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-all duration-150 hover:brightness-110 hover:-translate-y-px disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:transform-none inline-flex items-center gap-1.5"
              style={{
                background: 'hsl(var(--primary))',
                color: 'hsl(var(--primary-foreground))',
                boxShadow: '0 2px 12px hsl(var(--primary) / 0.25)',
                border: 'none',
              }}
            >
              {isStarting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t('explore.modal.starting', '시작하는 중…')}
                </>
              ) : (
                <>
                  {t('explore.modal.start', '이 템플릿으로 시작')}
                  <ArrowRight size={14} strokeWidth={2.5} />
                </>
              )}
            </button>
          </div>
        </div>

        {/* 9×9 Full mandala (landing preview component — do NOT modify its classNames). */}
        <MandalaFullPreview
          rootLevel={rootLevel}
          subLevels={subLevels}
          domain={domain}
          centerLabel={centerLabel}
          subLabels={subLabels}
        />

        {/* What-next info strip (per spec §5.2) */}
        <div
          className="mt-4 mb-4 rounded-[10px] p-3.5"
          style={{
            background: 'hsl(var(--primary) / 0.08)',
            border: '1px solid hsl(var(--primary) / 0.15)',
          }}
        >
          <div
            className="text-[10px] font-bold uppercase tracking-[0.08em] mb-2"
            style={{ color: 'hsl(var(--primary))' }}
          >
            {t('explore.modal.whatNextLabel', '이 템플릿으로 시작하면')}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <WhatNextStep n={1} text={t('explore.modal.whatNext1', '9×9 구조 자동 복제')} />
            <WhatNextArrow />
            <WhatNextStep n={2} text={t('explore.modal.whatNext2', 'AI가 셀마다 영상 3개 배치')} />
            <WhatNextArrow />
            <WhatNextStep n={3} text={t('explore.modal.whatNext3', '대시보드 도착, 바로 시청')} />
          </div>
        </div>

        {/* Stats — likes removed per VISION anti-pattern. "N명 시작" reuses
            cloneCount (each clone = one user who started). */}
        <div
          className="flex gap-5 text-[13px] flex-wrap"
          style={{ color: 'hsl(var(--muted-foreground) / 0.55)' }}
        >
          <span className="inline-flex items-center gap-1.5">
            <ArrowRight size={13} />
            {t('explore.modal.startedCount', '{{count}}명이 시작함', { count: cloneCount })}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Copy size={13} />
            {t('explore.modal.cloneCount', '{{count}}회 복제', { count: cloneCount })}
          </span>
          <span>{t('explore.modal.updatedAt', '업데이트 {{date}}', { date: updatedAt })}</span>
        </div>
      </div>
    </div>
  );
}

function WhatNextStep({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex-1 min-w-[140px] flex items-center gap-2 text-[11.5px] leading-snug">
      <span
        className="w-[18px] h-[18px] rounded-full inline-flex items-center justify-center text-[9.5px] font-bold shrink-0"
        style={{
          background: 'hsl(var(--primary))',
          color: 'hsl(var(--primary-foreground))',
        }}
      >
        {n}
      </span>
      <span style={{ color: 'hsl(var(--muted-foreground))' }}>{text}</span>
    </div>
  );
}

function WhatNextArrow() {
  return (
    <span
      className="text-[13px] shrink-0"
      style={{ color: 'hsl(var(--primary) / 0.5)' }}
      aria-hidden="true"
    >
      →
    </span>
  );
}
