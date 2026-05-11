import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MandalaDomain } from '@/shared/config/domain-colors';
import { DOMAIN_STYLES, domainCssVars, getDomainLabel } from '@/shared/config/domain-colors';

interface Props {
  id: string;
  title: string;
  centerGoal: string;
  centerLabel?: string;
  subjects: string[];
  subjectLabels?: string[];
  domain: MandalaDomain | null;
  isTemplate: boolean;
  author: { displayName: string; avatarInitial: string } | null;
  cloneCount: number;
  isNew?: boolean;
  /** Owner-vs-other branching: MY badge + hover inline actions + footer cta + click behavior. */
  isMine?: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function ExploreCard({
  title,
  centerGoal,
  centerLabel,
  subjects,
  subjectLabels,
  domain,
  isTemplate,
  author,
  cloneCount,
  isNew,
  isMine,
  onClick,
  onEdit,
  onDelete,
}: Props) {
  const { t, i18n } = useTranslation();
  const ds = domain ? DOMAIN_STYLES[domain] : null;

  return (
    <div
      className="group/card relative rounded-[14px] p-[22px] cursor-pointer overflow-hidden transition-all duration-300"
      style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border) / 0.3)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px hsl(var(--border) / 0.1)',
        ...domainCssVars(domain),
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = 'hsl(var(--border) / 0.5)';
        el.style.transform = 'translateY(-3px)';
        el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px hsl(var(--border) / 0.2)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = 'hsl(var(--border) / 0.3)';
        el.style.transform = 'none';
        el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px hsl(var(--border) / 0.1)';
      }}
    >
      {/* Accent line */}
      <div className="explore-accent-line explore-domain-accent" />

      {/* NEW tag (left corner — right corner reserved for owner inline actions) */}
      {isNew && (
        <span
          className="absolute top-3.5 left-3.5 text-[9px] font-bold px-[7px] py-0.5 rounded tracking-wide uppercase"
          style={{ background: 'rgba(52,211,153,0.10)', color: '#34d399' }}
        >
          New
        </span>
      )}

      {/* Inline actions (mine 카드만, hover 시 우상단 노출). event.stopPropagation
          으로 카드 클릭과 분리. mockup v6 spec. */}
      {isMine && (
        <div
          className="absolute top-2.5 right-2.5 z-[5] flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity duration-150 pointer-events-none group-hover/card:pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {onEdit && (
            <button
              type="button"
              aria-label={t('explore.card.actions.edit')}
              title={t('explore.card.actions.edit')}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
              style={{
                background: 'hsl(var(--card) / 0.92)',
                border: '1px solid hsl(var(--border) / 0.4)',
                color: 'hsl(var(--muted-foreground))',
                backdropFilter: 'blur(8px)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#fbbf24';
                e.currentTarget.style.borderColor = 'hsl(var(--border) / 0.7)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'hsl(var(--muted-foreground))';
                e.currentTarget.style.borderColor = 'hsl(var(--border) / 0.4)';
              }}
            >
              <Pencil size={13} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              aria-label={t('explore.card.actions.delete')}
              title={t('explore.card.actions.delete')}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
              style={{
                background: 'hsl(var(--card) / 0.92)',
                border: '1px solid hsl(var(--border) / 0.4)',
                color: 'hsl(var(--muted-foreground))',
                backdropFilter: 'blur(8px)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#fb7185';
                e.currentTarget.style.borderColor = 'hsl(var(--border) / 0.7)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'hsl(var(--muted-foreground))';
                e.currentTarget.style.borderColor = 'hsl(var(--border) / 0.4)';
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}

      {/* Top row: Domain badge only (Title moved to bottom — 배지 때문에 3줄 차지하던 문제 해소) */}
      {ds && (
        <div className="mb-3 flex justify-end">
          <span className="explore-domain-badge text-[10px] font-semibold px-2.5 py-0.5 rounded whitespace-nowrap shrink-0 tracking-wide">
            {getDomainLabel(domain!, i18n.language)}
          </span>
        </div>
      )}

      {/* Author */}
      <div
        className="flex items-center gap-1.5 text-[11px] mb-3.5"
        style={{ color: 'hsl(var(--muted-foreground) / 0.4)' }}
      >
        {isTemplate ? (
          <>
            <span
              className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-semibold"
              style={{ background: 'hsl(var(--primary) / 0.15)', color: 'hsl(var(--primary))' }}
            >
              I
            </span>
            Insighta
            <span
              className="text-[9px] px-1.5 py-px rounded font-semibold"
              style={{ background: 'hsl(var(--primary) / 0.10)', color: 'hsl(var(--primary))' }}
            >
              AI
            </span>
          </>
        ) : author ? (
          <>
            <span
              className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-semibold"
              style={{
                background: 'hsl(var(--border) / 0.3)',
                color: 'hsl(var(--muted-foreground))',
              }}
            >
              {author.avatarInitial}
            </span>
            {author.displayName}
          </>
        ) : null}
        {isMine && (
          <span
            className="ml-1 text-[9px] font-bold px-[6px] py-px rounded tracking-wide"
            style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399' }}
          >
            {t('explore.card.myBadge')}
          </span>
        )}
      </div>

      {/* Mini 3×3 mandala — 색상 ORIGINAL prod 그대로 (insighta.one 동일) */}
      <div className="grid grid-cols-3 gap-0.5 mb-4 rounded-lg overflow-hidden">
        {[
          ...(subjectLabels ?? subjects).slice(0, 4),
          centerLabel ?? centerGoal,
          ...(subjectLabels ?? subjects).slice(4),
        ].map((text, i) => (
          <div
            key={i}
            className={`aspect-square flex items-center justify-center p-1 text-center leading-tight overflow-hidden break-keep ${
              i === 4
                ? 'explore-domain-center text-[11px] font-semibold rounded-sm'
                : 'text-[10px] font-medium'
            }`}
            style={
              i !== 4
                ? {
                    background: 'hsl(var(--muted) / 0.15)',
                    color: 'hsl(var(--muted-foreground) / 0.4)',
                  }
                : undefined
            }
          >
            {text}
          </div>
        ))}
      </div>

      {/* Title (BOTTOM, line-clamp-2 강제 — `<h4>` 사용 (이전 `<span block>` 은 line-clamp 의 display:-webkit-box 를 덮어써서 영문 5줄 풀어짐)). title attribute = native browser tooltip showing full text on hover. */}
      <h4
        className="line-clamp-2 text-[14px] font-semibold leading-snug tracking-tight mb-3 break-keep"
        style={{ color: 'hsl(var(--foreground))' }}
        title={title}
      >
        {title}
      </h4>

      {/* Footer (mockup v6 — Heart/Copy meta retired; left = N people started, right = preview CTA). Owner-aware label branching is Step 2B. */}
      <div className="flex items-center justify-between text-[11.5px]">
        <span
          className="inline-flex items-center gap-1.5"
          style={{ color: 'hsl(var(--muted-foreground) / 0.55)' }}
        >
          <MessageSquare size={11} />
          {t('explore.card.starts', { count: cloneCount })}
        </span>
        <span className="font-semibold" style={{ color: 'var(--d-color, hsl(var(--primary)))' }}>
          {isMine ? t('explore.card.ctaOpenDashboard') : t('explore.card.ctaPreview')}
        </span>
      </div>
    </div>
  );
}
