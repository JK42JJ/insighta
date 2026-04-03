import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import {
  Loader2,
  ListVideo,
  Globe,
  Rss,
  Linkedin,
  BookOpen,
  Twitter,
  FileText,
  Headphones,
  X,
} from 'lucide-react';
import { apiClient } from '@/shared/lib/api-client';
import { toast } from '@/shared/lib/use-toast';
import { cn } from '@/shared/lib/utils';

interface AddSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSourceAdded: () => void;
}

type SourceTypeId = 'youtube' | 'url' | 'rss';

interface SourceTypeOption {
  id: SourceTypeId;
  name: string;
  descKey: string;
  icon: React.ComponentType<{ className?: string }>;
  available: boolean;
}

const COMING_SOON_SOURCES = [
  { id: 'linkedin', icon: Linkedin, nameKey: 'LinkedIn' },
  { id: 'notion', icon: BookOpen, nameKey: 'Notion' },
  { id: 'twitter', icon: Twitter, nameKey: 'X/Twitter' },
  { id: 'file', icon: FileText, nameKey: 'File' },
  { id: 'pocket', icon: BookOpen, nameKey: 'Pocket' },
  { id: 'podcast', icon: Headphones, nameKey: 'Podcast' },
];

export function AddSourceModal({ isOpen, onClose, onSourceAdded }: AddSourceModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<SourceTypeId | null>(null);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const SOURCE_TYPES: SourceTypeOption[] = [
    {
      id: 'youtube',
      name: 'YouTube',
      descKey: 'sources.youtube.desc',
      icon: ListVideo,
      available: true,
    },
    { id: 'url', name: 'URL', descKey: 'sources.url.desc', icon: Globe, available: false },
    { id: 'rss', name: 'RSS', descKey: 'sources.rss.desc', icon: Rss, available: false },
  ];

  const handleSelectType = (typeId: SourceTypeId) => {
    setSelectedType(typeId);
    setStep(2);
  };

  const handleAddPlaylist = async () => {
    const url = playlistUrl.trim();
    if (!url) return;
    setIsAdding(true);
    try {
      await apiClient.importPlaylist(url);
      toast({ title: t('youtube.playlistAdded') });
      onSourceAdded();
      handleClose();
    } catch {
      toast({ title: t('youtube.addFailed'), variant: 'destructive' });
    } finally {
      setIsAdding(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setSelectedType(null);
    setPlaylistUrl('');
    onClose();
  };

  const handleBack = () => {
    setStep(1);
    setSelectedType(null);
    setPlaylistUrl('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Modal */}
      <div className="relative bg-surface-mid border border-border/50 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div>
            <h2 className="text-base font-semibold">{t('settings.addSource')}</h2>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span className={cn('font-medium', step === 1 && 'text-primary')}>
                1 {t('settings.selectSource')}
              </span>
              <span>{'>'}</span>
              <span className={cn('font-medium', step === 2 && 'text-primary')}>
                2 {t('settings.detailInput')}
              </span>
            </div>
          </div>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5">
          {step === 1 && (
            <div className="space-y-4">
              {/* Available */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-3">
                  {t('settings.available', 'Available')}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {SOURCE_TYPES.map((src) => {
                    const SrcIcon = src.icon;
                    return (
                      <button
                        key={src.id}
                        onClick={() => src.available && handleSelectType(src.id)}
                        disabled={!src.available}
                        className={cn(
                          'flex flex-col items-center gap-2 p-4 rounded-lg border transition-colors',
                          src.available
                            ? 'border-border/50 hover:border-primary/40 hover:bg-primary/5 cursor-pointer'
                            : 'border-border/30 opacity-40 cursor-not-allowed'
                        )}
                      >
                        <div className="w-9 h-9 rounded-lg bg-surface-light flex items-center justify-center">
                          <SrcIcon className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-medium">{src.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Coming Soon */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-3">
                  {t('common.comingSoon')}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {COMING_SOON_SOURCES.map((src) => {
                    const SrcIcon = src.icon;
                    return (
                      <div
                        key={src.id}
                        className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border/20 opacity-30"
                      >
                        <div className="w-9 h-9 rounded-lg bg-surface-light flex items-center justify-center">
                          <SrcIcon className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-medium">{src.nameKey}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 2 && selectedType === 'youtube' && (
            <div className="space-y-4">
              <button
                onClick={handleBack}
                className="text-xs text-muted-foreground hover:text-foreground mb-2"
              >
                {'<'} {t('common.back')}
              </button>

              <div className="space-y-2">
                <Label>{t('sources.youtube.playlist')}</Label>
                <p className="text-xs text-muted-foreground">{t('sources.youtube.playlistDesc')}</p>
                <Input
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  placeholder={t('youtube.playlistUrlPlaceholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddPlaylist();
                  }}
                  className="bg-surface-light border-border/50"
                />
              </div>

              <Button
                onClick={handleAddPlaylist}
                disabled={!playlistUrl.trim() || isAdding}
                className="w-full gap-2"
              >
                {isAdding && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('settings.addSource')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
