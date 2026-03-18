import { cn } from '@/shared/lib/utils';

type PreviewSize = 'sm' | 'md' | 'lg';

interface MandalaMiniPreviewProps {
  centerGoal: string;
  subjects: string[];
  size?: PreviewSize;
  className?: string;
}

const SIZE_CONFIG: Record<PreviewSize, { gap: string; padding: string; fontSize: string }> = {
  sm: { gap: 'gap-0.5', padding: 'p-2', fontSize: 'text-[7px]' },
  md: { gap: 'gap-1', padding: 'p-3', fontSize: 'text-[8px] sm:text-[9px]' },
  lg: { gap: 'gap-1.5', padding: 'p-4', fontSize: 'text-xs' },
};

/**
 * Reusable 3x3 mandala grid preview.
 * Renders center goal in the middle cell with 8 surrounding subject cells.
 */
export function MandalaMiniPreview({
  centerGoal,
  subjects,
  size = 'md',
  className,
}: MandalaMiniPreviewProps) {
  const config = SIZE_CONFIG[size];

  return (
    <div
      className={cn(
        'grid grid-cols-3 rounded-lg bg-surface-base',
        config.gap,
        config.padding,
        className,
      )}
    >
      {Array.from({ length: 9 }).map((_, i) => {
        const isCenter = i === 4;
        const subjectIndex = i < 4 ? i : i > 4 ? i - 1 : -1;
        const label = isCenter ? centerGoal : subjects[subjectIndex] || '';

        return (
          <div
            key={i}
            className={cn(
              'aspect-square rounded-md flex items-center justify-center leading-tight text-center',
              config.fontSize,
              isCenter
                ? 'bg-primary/15 text-primary font-semibold border border-primary/30'
                : label
                  ? 'bg-card text-foreground/70 border border-border/30'
                  : 'bg-surface-light',
            )}
          >
            <span className="line-clamp-2 px-0.5">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
