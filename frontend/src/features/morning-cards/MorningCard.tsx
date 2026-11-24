import type { MorningCardDto } from '@/features/morning-cards/api';

import { formatUploadDate } from '@/features/morning-cards/upload-date';

interface MorningCardProps {
  card: MorningCardDto;
  onPlay?: (card: MorningCardDto) => void;
}

/**
 * One vertical morning card. All YouTube-provided text is rendered as React
 * text children (escaped); no raw HTML injection.
 */
export function MorningCard({ card, onPlay }: MorningCardProps) {
  return (
    <article
      data-testid="morning-card"
      className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
    >
      <button
        type="button"
        className="block w-full min-w-0 text-left"
        onClick={() => onPlay?.(card)}
      >
        {card.thumbnail_url ? (
          <img
            src={card.thumbnail_url}
            alt=""
            draggable={false}
            className="aspect-video w-full object-cover"
          />
        ) : (
          <div className="aspect-video w-full bg-muted" />
        )}
      </button>
      <div className="flex min-w-0 flex-col gap-1 p-3">
        <h2 className="break-words text-base font-semibold">{card.title}</h2>
        <p className="break-words text-sm text-muted-foreground">{card.channel_name ?? ''}</p>
        <p data-testid="morning-card-date" className="text-sm text-muted-foreground">
          {formatUploadDate(card.published_at)}
        </p>
        <p className="break-words text-sm">{card.reason}</p>
      </div>
    </article>
  );
}
