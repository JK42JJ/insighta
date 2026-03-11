import { useTranslation } from 'react-i18next';
import { X, ExternalLink } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { Separator } from '@/shared/ui/separator';
import type { InsightCard } from '@/entities/card/model/types';
import { SourceTypeBadge, SourceMetaInfo } from '@/entities/content';
import { upgradeYouTubeThumbnail, handleThumbnailError } from '@/shared/lib/image-utils';
import { NoteEditor } from './NoteEditor';

interface DetailPanelProps {
  card: InsightCard | null;
  onSaveNote?: (id: string, note: string) => void;
  onCardClick?: (card: InsightCard) => void;
  onClose?: () => void;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function DetailPanel({ card, onSaveNote, onCardClick, onClose }: DetailPanelProps) {
  const { t } = useTranslation();

  if (!card) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <div className="text-muted-foreground">
          <p className="text-sm">{t('view.noCardSelected')}</p>
          <p className="text-xs mt-1">{t('view.selectCardHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {card.linkType && <SourceTypeBadge linkType={card.linkType} />}
          <span className="text-xs text-muted-foreground truncate">
            {formatDate(card.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {card.videoUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onCardClick?.(card)}
              title={t('videoPlayer.viewOriginal')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Thumbnail */}
          {card.thumbnail && (
            <div
              className="w-full aspect-video rounded-lg overflow-hidden bg-muted cursor-pointer"
              onClick={() => onCardClick?.(card)}
            >
              <img
                src={upgradeYouTubeThumbnail(card.thumbnail) ?? card.thumbnail}
                alt={card.title}
                className="w-full h-full object-cover hover:scale-105 transition-transform"
                onError={handleThumbnailError}
              />
            </div>
          )}

          {/* Title */}
          <h3 className="text-base font-semibold leading-tight">{card.title || t('cards.untitled')}</h3>

          {/* Source-specific metadata */}
          <SourceMetaInfo card={card} view="detail" />

          <Separator />

          {/* Note Editor */}
          <NoteEditor
            value={card.userNote || ''}
            onSave={(note) => onSaveNote?.(card.id, note)}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
