import { useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// AnimatedNumber - spring-based rolling number animation
// ---------------------------------------------------------------------------

interface AnimatedNumberProps {
  /** Target numeric value to animate towards */
  value: number;
  /** Optional suffix appended after the animated number (e.g. "%") */
  suffix?: string;
  /** Optional prefix prepended before the animated number (e.g. "$") */
  prefix?: string;
}

function AnimatedNumber({ value, suffix = '', prefix = '' }: AnimatedNumberProps) {
  const spring = useSpring(0, { stiffness: 100, damping: 30 });
  const display = useTransform(spring, (v) => `${prefix}${Math.round(v)}${suffix}`);

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  return <motion.span>{display}</motion.span>;
}

// ---------------------------------------------------------------------------
// parseStatValue - extract numeric part, prefix, and suffix from a stat value
// ---------------------------------------------------------------------------

function parseStatValue(value: string | number): {
  numeric: number;
  prefix: string;
  suffix: string;
} | null {
  if (typeof value === 'number') {
    return { numeric: value, prefix: '', suffix: '' };
  }

  // Match patterns like "85%", "$1,234", "1,200+", "42.5h"
  const match = value.match(/^([^0-9+-]*)([+-]?\d[\d,]*\.?\d*)(.*)$/);
  if (!match) return null;

  const prefix = match[1];
  const numStr = match[2].replace(/,/g, '');
  const suffix = match[3];
  const numeric = parseFloat(numStr);

  if (isNaN(numeric)) return null;
  return { numeric, prefix, suffix };
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtitle?: string;
  className?: string;
}

export function StatCard({ icon: Icon, label, value, subtitle, className }: StatCardProps) {
  // Track whether component has mounted to skip animation on first render
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);

  const parsed = parseStatValue(value);
  const shouldAnimate = hasMounted && parsed !== null;

  return (
    <div className={cn('rounded-xl border bg-card p-4 flex items-start gap-3', className)}>
      <div className="rounded-lg bg-primary/10 p-2.5">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tracking-tight">
          {shouldAnimate && parsed ? (
            <AnimatedNumber value={parsed.numeric} prefix={parsed.prefix} suffix={parsed.suffix} />
          ) : (
            value
          )}
        </p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}
