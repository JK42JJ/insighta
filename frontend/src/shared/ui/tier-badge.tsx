import { cn } from '@/shared/lib/utils';
import { Star } from 'lucide-react';

type Tier = 'free' | 'pro' | 'lifetime' | 'admin';

const TIER_STYLES: Record<Tier, string> = {
  free: 'bg-muted text-muted-foreground border-border',
  pro: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  lifetime: 'bg-primary/10 text-primary border-primary/20',
  admin: 'bg-gradient-to-r from-primary/15 to-violet-500/15 text-primary border-primary/15',
};

interface TierBadgeProps {
  tier: string;
  className?: string;
  onClick?: () => void;
}

export function TierBadge({ tier, className, onClick }: TierBadgeProps) {
  const normalizedTier = (tier?.toLowerCase() ?? 'free') as Tier;
  const style = TIER_STYLES[normalizedTier] ?? TIER_STYLES.free;
  const label = normalizedTier.charAt(0).toUpperCase() + normalizedTier.slice(1);

  return (
    <span
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wide',
        style,
        onClick && 'cursor-pointer hover:opacity-80 transition-opacity',
        className
      )}
    >
      {(normalizedTier === 'admin' || normalizedTier === 'pro') && (
        <Star className="w-2.5 h-2.5 fill-current" />
      )}
      {label}
    </span>
  );
}
