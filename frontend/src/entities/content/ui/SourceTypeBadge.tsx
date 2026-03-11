import { cn } from '@/shared/lib/utils';
import type { SourceType } from '../model/types';
import type { LinkType } from '@/entities/card/model/types';
import { getSourceTypeConfig, getConfigFromLinkType } from './source-type-config';

interface SourceTypeBadgeProps {
  sourceType?: SourceType;
  linkType?: LinkType;
  showIcon?: boolean;
  className?: string;
}

export function SourceTypeBadge({
  sourceType,
  linkType,
  showIcon = true,
  className,
}: SourceTypeBadgeProps) {
  const config = sourceType
    ? getSourceTypeConfig(sourceType)
    : linkType
      ? getConfigFromLinkType(linkType)
      : null;

  if (!config) return null;

  const Icon = config.icon;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
        config.bgColor,
        className
      )}
    >
      {showIcon && <Icon className={cn('w-2.5 h-2.5', config.color)} aria-hidden="true" />}
      <span className={cn('text-[10px] font-medium', config.color)}>{config.label}</span>
    </div>
  );
}
