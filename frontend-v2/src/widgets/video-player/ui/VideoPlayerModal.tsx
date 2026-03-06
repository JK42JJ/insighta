import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { InsightCard } from '@/entities/card/model/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Textarea } from '@/shared/ui/textarea';
import { cn } from '@/shared/lib/utils';
import { Save, ExternalLink } from 'lucide-react';

interface VideoPlayerModalProps {
  card: InsightCard | null;
  isOpen: boolean;
  onClose: () => void;
  onSave?: (id: string, note: string) => void;
  onSaveWatchPosition?: (id: string, position: number) => void;
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function VideoPlayerModal({
  card,
  isOpen,
  onClose,
  onSave,
  onSaveWatchPosition,
}: VideoPlayerModalProps) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Sync note state when card changes
  useEffect(() => {
    if (card) {
      setNote(card.userNote ?? '');
    }
  }, [card]);

  const handleSave = useCallback(() => {
    if (!card) return;
    setIsSaving(true);
    onSave?.(card.id, note);
    // Brief visual feedback
    setTimeout(() => setIsSaving(false), 400);
  }, [card, note, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        // Save watch position on close if available
        if (card && onSaveWatchPosition) {
          // YouTube iframe API does not support direct position read from sandboxed iframe.
          // The parent page would need the YT Player API for this. For now, we skip auto-save.
        }
        onClose();
      }
    },
    [card, onClose, onSaveWatchPosition],
  );

  if (!card) return null;

  const videoId = extractYouTubeId(card.videoUrl);
  const isYouTube = videoId !== null;
  const startTime = card.lastWatchPosition ? Math.floor(card.lastWatchPosition) : 0;
  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?autoplay=1&start=${startTime}&rel=0`
    : null;

  const channelName = card.metadata?.author || card.metadata?.siteName || '';

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto p-0',
          'flex flex-col',
        )}
        aria-describedby="video-player-description"
      >
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="text-base font-semibold line-clamp-2 pr-8">
            {card.title}
          </DialogTitle>
          <DialogDescription id="video-player-description" className="sr-only">
            {t('videoPlayer.description')}
          </DialogDescription>
          {channelName && (
            <p className="text-xs text-muted-foreground">{channelName}</p>
          )}
        </DialogHeader>

        {/* Video embed */}
        <div className="px-4">
          {isYouTube && embedUrl ? (
            <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-muted">
              <iframe
                ref={iframeRef}
                src={embedUrl}
                title={card.title}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-muted flex items-center justify-center">
              <img
                src={card.thumbnail}
                alt={card.title}
                className="w-full h-full object-cover"
              />
              <a
                href={card.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/50 transition-colors"
              >
                <div className="flex items-center gap-2 bg-background/90 rounded-lg px-4 py-2 text-sm font-medium">
                  <ExternalLink className="w-4 h-4" />
                  {t('videoPlayer.openExternal')}
                </div>
              </a>
            </div>
          )}
        </div>

        {/* Notes section */}
        <div className="p-4 space-y-3">
          <label htmlFor="video-note" className="text-sm font-medium">
            {t('videoPlayer.notes')}
          </label>
          <Textarea
            id="video-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('videoPlayer.notePlaceholder')}
            className="min-h-[80px] resize-y"
            rows={3}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {t('videoPlayer.saveHint')}
            </p>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="gap-1.5"
            >
              <Save className="w-3.5 h-3.5" aria-hidden="true" />
              {isSaving ? t('videoPlayer.saving') : t('videoPlayer.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
