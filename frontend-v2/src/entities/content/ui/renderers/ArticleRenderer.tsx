import { Globe, Clock } from 'lucide-react';
import type { CardRendererProps } from '../CardRendererRegistry';
import type { ArticleMetadata } from '../../model/types';

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function estimateReadingTime(notes: string | null | undefined): number | null {
  if (!notes) return null;
  const wordCount = notes.split(/\s+/).length;
  const minutes = Math.ceil(wordCount / 200);
  return minutes > 0 ? minutes : null;
}

export function ArticleRenderer({ card, view }: CardRendererProps) {
  const meta = card.metadata as unknown as ArticleMetadata | null | undefined;
  const domain = meta?.site_name || extractDomain(card.sourceUrl);
  const author = meta?.author;
  const readingTime = estimateReadingTime(card.userNote);

  if (view === 'list' || view === 'compact') {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {domain && (
          <span className="flex items-center gap-0.5 truncate max-w-[120px]">
            <Globe className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
            {domain}
          </span>
        )}
        {domain && readingTime && <span>·</span>}
        {readingTime && (
          <span className="flex items-center gap-0.5 whitespace-nowrap">
            <Clock className="w-2.5 h-2.5" aria-hidden="true" />
            {readingTime}m
          </span>
        )}
      </div>
    );
  }

  // grid / detail
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {domain && (
        <span className="flex items-center gap-0.5 truncate">
          <Globe className="w-3 h-3 shrink-0" aria-hidden="true" />
          {domain}
        </span>
      )}
      {author && <span>· {author}</span>}
      {readingTime && (
        <span className="flex items-center gap-0.5 whitespace-nowrap">
          <Clock className="w-3 h-3" aria-hidden="true" />
          {readingTime}m
        </span>
      )}
    </div>
  );
}
