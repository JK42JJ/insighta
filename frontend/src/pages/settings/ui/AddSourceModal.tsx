import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Loader2, X, Bot, Link } from 'lucide-react';
import { apiClient } from '@/shared/lib/api-client';
import { toast } from '@/shared/lib/use-toast';
import { cn } from '@/shared/lib/utils';
import { YouTubeImportPanel } from './YouTubeImportPanel';
import { useYouTubeSync } from '@/features/youtube-sync/model/useYouTubeSync';
import { useMandalaList, useCreateSourceMappings } from '@/features/mandala';

interface AddSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSourceAdded: () => void;
}

const COMING_SOON_SOURCES = ['URL', 'RSS', 'LinkedIn', 'Notion', 'Pocket', 'Podcast'];

export function AddSourceModal({ isOpen, onClose, onSourceAdded }: AddSourceModalProps) {
  const { t } = useTranslation();
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [selectedMandalaId, setSelectedMandalaId] = useState<string | null>(null);

  const ytSync = useYouTubeSync();
  const { data: mandalaListData } = useMandalaList();
  const mandalaOptions = mandalaListData?.mandalas ?? [];
  const createSourceMappings = useCreateSourceMappings();

  const registeredPlaylistIds = new Set(ytSync.playlists.map((p) => p.youtube_playlist_id));

  const handleAddPlaylist = async () => {
    const url = playlistUrl.trim();
    if (!url) return;
    setIsAdding(true);
    try {
      const result = await apiClient.importPlaylist(url);
      toast({ title: t('youtube.playlistAdded') });

      // Create mandala mapping if selected
      if (selectedMandalaId && result?.youtubeId) {
        try {
          await createSourceMappings.mutateAsync({
            sourceType: 'playlist',
            sourceIds: [result.youtubeId],
            mandalaId: selectedMandalaId,
          });
        } catch {
          // Non-fatal: source added, mapping failed
        }
      }

      onSourceAdded();
      handleClose();
    } catch {
      toast({ title: t('youtube.addFailed'), variant: 'destructive' });
    } finally {
      setIsAdding(false);
    }
  };

  const handleClose = () => {
    setPlaylistUrl('');
    setSelectedMandalaId(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Modal — 640px wide */}
      <div className="relative bg-surface-mid border border-border/50 rounded-xl shadow-2xl w-full max-w-[640px] mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/30">
          <h2 className="text-base font-semibold">{t('settings.addSource')}</h2>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-6 overflow-y-auto">
          {/* URL Input */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Link className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm font-medium">{t('sources.youtube.playlist')}</Label>
            </div>
            <div className="flex gap-2">
              <Input
                value={playlistUrl}
                onChange={(e) => setPlaylistUrl(e.target.value)}
                placeholder={t('youtube.playlistUrlPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddPlaylist();
                }}
                className="bg-surface-light border-border/50 flex-1"
              />
              <Button
                onClick={handleAddPlaylist}
                disabled={!playlistUrl.trim() || isAdding}
                className="gap-1.5 px-4"
              >
                {isAdding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('common.add', 'Add')}
              </Button>
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-border/30" />
            <span className="text-xs text-muted-foreground font-medium">
              {t('common.or', 'or')}
            </span>
            <div className="flex-1 h-px bg-border/30" />
          </div>

          {/* YouTube Import Panel */}
          <YouTubeImportPanel
            registeredPlaylistIds={registeredPlaylistIds}
            onImportComplete={onSourceAdded}
          />

          {/* Mandala Assignment — Radio List */}
          {mandalaOptions.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-border/30" />
                <span className="text-xs text-muted-foreground font-medium">
                  {t('sources.assignMandala')}
                </span>
                <div className="flex-1 h-px bg-border/30" />
              </div>
              <p className="text-xs text-muted-foreground">{t('sources.assignMandalaDesc')}</p>
              <p className="text-[11px] text-muted-foreground/70">
                {t(
                  'sources.mandalaApplyNote',
                  'Applies to all sources added in this session. For individual mapping, use the mandala pills on each source card.'
                )}
              </p>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {/* AI auto (default) */}
                <button
                  onClick={() => setSelectedMandalaId(null)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                    selectedMandalaId === null
                      ? 'bg-primary/5 border border-primary/30'
                      : 'hover:bg-muted/50 border border-transparent'
                  )}
                >
                  <div
                    className={cn(
                      'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                      selectedMandalaId === null ? 'border-primary' : 'border-muted-foreground/40'
                    )}
                  >
                    {selectedMandalaId === null && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <Bot className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{t('sources.aiAuto')}</span>
                    <p className="text-xs text-muted-foreground">
                      {t('sources.aiAutoDesc', 'AI classifies videos automatically')}
                    </p>
                  </div>
                </button>

                {/* Mandala options */}
                {mandalaOptions.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMandalaId(m.id === selectedMandalaId ? null : m.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                      selectedMandalaId === m.id
                        ? 'bg-primary/5 border border-primary/30'
                        : 'hover:bg-muted/50 border border-transparent'
                    )}
                  >
                    <div
                      className={cn(
                        'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                        selectedMandalaId === m.id ? 'border-primary' : 'border-muted-foreground/40'
                      )}
                    >
                      {selectedMandalaId === m.id && (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <span className="text-sm font-medium truncate">{m.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Coming Soon */}
          <p className="text-xs text-muted-foreground text-center pt-2 pb-1">
            {COMING_SOON_SOURCES.join(' · ')} — {t('common.comingSoon')}
          </p>
        </div>
      </div>
    </div>
  );
}
