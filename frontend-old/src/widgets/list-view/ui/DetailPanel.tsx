import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Trash2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { InsightCard } from '@/types/mandala';

interface DetailPanelProps {
  card: InsightCard | null;
  onSaveNote?: (id: string, note: string) => void;
  onDeleteCards?: (cardIds: string[]) => void;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function DetailPanel({ card, onSaveNote, onDeleteCards }: DetailPanelProps) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');

  useEffect(() => {
    setNote(card?.userNote ?? '');
  }, [card?.id]);

  const handleSaveNote = () => {
    if (card && note !== (card.userNote ?? '')) {
      onSaveNote?.(card.id, note);
    }
  };

  if (!card) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground p-6">
        <FileText className="h-10 w-10 opacity-30" />
        <p className="text-sm">{t('listView.selectCard')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Thumbnail */}
      {card.thumbnail && (
        <div className="w-full">
          <img src={card.thumbnail} alt={card.title} className="w-full aspect-video object-cover" />
        </div>
      )}

      <div className="flex flex-col gap-4 p-4">
        {/* Title + badges */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold leading-tight">{card.title}</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {card.linkType && (
              <Badge variant="secondary" className="text-[10px]">
                {card.linkType}
              </Badge>
            )}
            <span>{formatDate(card.createdAt)}</span>
          </div>
        </div>

        {/* External link */}
        {card.videoUrl && (
          <Button variant="outline" size="sm" className="w-fit" asChild>
            <a href={card.videoUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              {t('listView.openExternal')}
            </a>
          </Button>
        )}

        <Separator />

        {/* Note editor */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('listView.noteLabel')}</label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={handleSaveNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSaveNote();
              }
            }}
            placeholder={t('listView.notePlaceholder')}
            className="min-h-[120px] resize-none"
          />
        </div>

        {/* Metadata */}
        {card.metadata && (
          <>
            <Separator />
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{t('listView.metadata')}</h3>
              <dl className="space-y-1 text-xs text-muted-foreground">
                {card.metadata.siteName && (
                  <div className="flex gap-2">
                    <dt className="font-medium">{t('listView.source')}:</dt>
                    <dd>{card.metadata.siteName}</dd>
                  </div>
                )}
                {card.metadata.author && (
                  <div className="flex gap-2">
                    <dt className="font-medium">Author:</dt>
                    <dd>{card.metadata.author}</dd>
                  </div>
                )}
                {card.metadata.description && (
                  <div>
                    <dd className="mt-1 line-clamp-3">{card.metadata.description}</dd>
                  </div>
                )}
              </dl>
            </div>
          </>
        )}

        {/* Delete */}
        <div className="mt-auto pt-4">
          <Button variant="destructive" size="sm" onClick={() => onDeleteCards?.([card.id])}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {t('listView.deleteCard')}
          </Button>
        </div>
      </div>
    </div>
  );
}
