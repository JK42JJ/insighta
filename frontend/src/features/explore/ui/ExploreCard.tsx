import { Heart, Copy } from 'lucide-react';
import type { MandalaDomain } from '@/shared/config/domain-colors';
import { DOMAIN_STYLES, domainCssVars } from '@/shared/config/domain-colors';

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
  likeCount: number;
  cloneCount: number;
  updatedAt: string;
  isNew?: boolean;
  onClick: () => void;
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
  likeCount,
  cloneCount,
  updatedAt,
  isNew,
  onClick,
}: Props) {
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

      {/* NEW tag */}
      {isNew && (
        <span
          className="absolute top-3.5 right-3.5 text-[9px] font-bold px-[7px] py-0.5 rounded tracking-wide uppercase"
          style={{ background: 'rgba(52,211,153,0.10)', color: '#34d399' }}
        >
          New
        </span>
      )}

      {/* Title + Badge */}
      <div className="flex justify-between items-start mb-4 gap-3">
        <span
          className="text-[15px] font-semibold leading-snug flex-1 tracking-tight"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          {title}
        </span>
        {ds && (
          <span className="explore-domain-badge text-[10px] font-semibold px-2.5 py-0.5 rounded whitespace-nowrap shrink-0 tracking-wide">
            {ds.label}
          </span>
        )}
      </div>

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
      </div>

      {/* Mini 3×3 mandala */}
      <div className="grid grid-cols-3 gap-0.5 mb-4 rounded-lg overflow-hidden">
        {[
          ...(subjectLabels ?? subjects).slice(0, 4),
          centerLabel ?? centerGoal,
          ...(subjectLabels ?? subjects).slice(4),
        ].map((text, i) => (
          <div
            key={i}
            className={`aspect-square flex items-center justify-center p-1 text-center leading-tight overflow-hidden ${
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

      {/* Meta */}
      <div
        className="flex items-center gap-3.5 text-xs"
        style={{ color: 'hsl(var(--muted-foreground) / 0.35)' }}
      >
        <span className="inline-flex items-center gap-1">
          <Heart size={14} />
          {likeCount}
        </span>
        <span className="inline-flex items-center gap-1">
          <Copy size={13} />
          {cloneCount}
        </span>
        <span className="flex-1" />
        <span>{updatedAt}</span>
      </div>
    </div>
  );
}
