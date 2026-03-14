export type LinkType =
  | 'youtube'
  | 'youtube-shorts'
  | 'youtube-playlist'
  | 'linkedin'
  | 'facebook'
  | 'notion'
  | 'txt'
  | 'md'
  | 'pdf'
  | 'other';

export interface UrlMetadata {
  title: string;
  description: string;
  image: string;
  siteName: string;
  author: string;
  url: string;
}

/** @deprecated Use ContentEntity from '@/entities/content' instead. Will be removed after migration. */
export interface InsightCard {
  id: string;
  videoUrl: string; // keeping name for backward compatibility, but represents any URL
  title: string;
  thumbnail: string;
  userNote: string;
  createdAt: Date;
  cellIndex: number;
  levelId: string; // Which mandala level this card belongs to
  mandalaId?: string | null; // Which mandala this card belongs to
  sortOrder?: number;
  linkType?: LinkType;
  metadata?: UrlMetadata; // OG metadata for external links
  lastWatchPosition?: number; // Last playback position in seconds (for YouTube videos)
  isInIdeation?: boolean; // Whether the card is in ideation (scratchpad) or mandala grid
}

export interface MandalaLevel {
  id: string;
  centerGoal: string;
  subjects: string[];
  parentId: string | null;
  parentCellIndex: number | null;
  cards: InsightCard[];
}

export interface MandalaPath {
  id: string;
  label: string;
}
