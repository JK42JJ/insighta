import { cn } from '@/shared/lib/utils';
import type { SourceType } from '../model/types';
import type { LinkType } from '@/entities/card/model/types';
import { getSourceTypeConfig, getConfigFromLinkType } from './source-type-config';

export interface SourceTypeBadgeProps {
  sourceType?: SourceType;
  linkType?: LinkType;
  showIcon?: boolean;
  /** 'overlay' renders white text on semi-transparent black for use on thumbnails */
  variant?: 'default' | 'overlay';
  className?: string;
}

export function SourceTypeBadge({
  sourceType,
  linkType,
  showIcon = true,
  variant = 'default',
  className,
}: SourceTypeBadgeProps) {
  const config = sourceType
    ? getSourceTypeConfig(sourceType)
    : linkType
      ? getConfigFromLinkType(linkType)
      : null;

  if (!config) return null;

  const Icon = config.icon;
  const isOverlay = variant === 'overlay';

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
        isOverlay ? 'bg-black/70' : config.bgColor,
        className
      )}
    >
      {showIcon && <Icon className={cn('w-2.5 h-2.5', isOverlay ? 'text-white' : config.color)} aria-hidden="true" />}
      <span className={cn('text-[10px] font-medium', isOverlay ? 'text-white' : config.color)}>{config.label}</span>
    </div>
  );
}
