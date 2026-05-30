import { cn } from '@/shared/lib/utils';
import type { PoolHealthStatus } from '@/shared/lib/api-client';

// Tailwind preset color tokens (no hex literals) — emerald = ok, amber =
// warn, red = critical, zinc = na (metric disabled by config). Picked to
// stay legible on the dark admin shell.
const STATUS_CLASS: Record<PoolHealthStatus, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
  na: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
};

const STATUS_LABEL: Record<PoolHealthStatus, string> = {
  ok: 'OK',
  warn: 'WARN',
  critical: 'CRITICAL',
  na: 'N/A',
};

export interface PoolHealthBadgeProps {
  status: PoolHealthStatus;
  className?: string;
}

export function PoolHealthBadge({ status, className }: PoolHealthBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border',
        STATUS_CLASS[status],
        className
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
