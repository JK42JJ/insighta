import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Link2, Pencil, Heart, Copy, Share2 } from 'lucide-react';
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
  likeCount: number;
  cloneCount: number;
  updatedAt: string;
  onClone: () => void;
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
  likeCount,
  cloneCount,
  updatedAt,
  onClone,
  onCopyLink,
}: Props) {
  const { i18n } = useTranslation();
  // ESC key
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
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div className="mb-7 pr-11">
          <h2
            className="text-2xl font-bold tracking-tight mb-2 leading-snug"
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
                  Insighta AI 템플릿
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

        {/* 9×9 Full mandala */}
        <MandalaFullPreview
          rootLevel={rootLevel}
          subLevels={subLevels}
          domain={domain}
          centerLabel={centerLabel}
          subLabels={subLabels}
        />

        {/* Action buttons */}
        <div className="flex gap-2.5 items-center mb-5">
          <button
            onClick={onClone}
            className="px-7 py-2.5 rounded-[10px] text-sm font-semibold transition-all duration-200 hover:brightness-110 hover:-translate-y-px"
            style={{
              background: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
              boxShadow: '0 2px 12px hsl(var(--primary) / 0.25)',
              border: 'none',
            }}
          >
            내 만다라로 복제
          </button>
          <button
            onClick={onCopyLink}
            className="px-5 py-2.5 rounded-[10px] text-sm font-medium transition-all duration-200 inline-flex items-center gap-1.5"
            style={{
              background: 'transparent',
              color: 'hsl(var(--muted-foreground))',
              border: '1px solid hsl(var(--border) / 0.5)',
            }}
          >
            <Link2 size={14} />
            링크 복사
          </button>
          <button
            className="px-5 py-2.5 rounded-[10px] text-sm font-medium transition-all duration-200 inline-flex items-center gap-1.5"
            style={{
              background: 'transparent',
              color: 'hsl(var(--muted-foreground))',
              border: '1px solid hsl(var(--border) / 0.5)',
            }}
          >
            <Pencil size={14} />
            개선하기
          </button>
        </div>

        {/* Stats */}
        <div
          className="flex gap-5 text-[13px]"
          style={{ color: 'hsl(var(--muted-foreground) / 0.45)' }}
        >
          <span className="flex items-center gap-1.5">
            <Heart size={14} /> {likeCount}
          </span>
          <span className="flex items-center gap-1.5">
            <Copy size={13} /> {cloneCount} 복제
          </span>
          <span>업데이트 {updatedAt}</span>
        </div>

        {/* Share prompt */}
        <div
          className="mt-6 p-4 px-5 rounded-xl flex items-center gap-3 text-[13px]"
          style={{
            background: 'hsl(var(--primary) / 0.08)',
            border: '1px solid hsl(var(--primary) / 0.12)',
            color: 'hsl(var(--muted-foreground))',
          }}
        >
          <Share2 size={18} style={{ color: 'hsl(var(--primary))' }} />
          <span>
            <strong style={{ color: 'hsl(var(--primary))', fontWeight: 600 }}>
              나의 만다라트도 공유해보세요.
            </strong>{' '}
            다른 사람들에게 영감을 줄 수 있어요.
          </span>
        </div>
      </div>
    </div>
  );
}
