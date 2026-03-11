import { Play, FileText, Headphones, BookOpen, Link } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SourceType } from '../model/types';
import type { LinkType } from '@/entities/card/model/types';
import { linkTypeToSourceType } from '../model/converters';

export interface SourceTypeConfig {
  icon: LucideIcon;
  color: string;
  bgColor: string;
  label: string;
}

const SOURCE_TYPE_MAP: Record<SourceType, SourceTypeConfig> = {
  youtube: { icon: Play, color: 'text-red-500', bgColor: 'bg-red-500/10', label: 'YouTube' },
  article: { icon: FileText, color: 'text-blue-500', bgColor: 'bg-blue-500/10', label: 'Article' },
  podcast: {
    icon: Headphones,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    label: 'Podcast',
  },
  book: { icon: BookOpen, color: 'text-amber-500', bgColor: 'bg-amber-500/10', label: 'Book' },
};

const DEFAULT_CONFIG: SourceTypeConfig = {
  icon: Link,
  color: 'text-muted-foreground',
  bgColor: 'bg-muted',
  label: 'Link',
};

export function getSourceTypeConfig(sourceType: SourceType): SourceTypeConfig {
  return SOURCE_TYPE_MAP[sourceType] ?? DEFAULT_CONFIG;
}

export function getConfigFromLinkType(linkType: LinkType): SourceTypeConfig {
  return getSourceTypeConfig(linkTypeToSourceType(linkType));
}
