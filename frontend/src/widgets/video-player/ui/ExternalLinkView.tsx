import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FileText, Globe, Linkedin } from 'lucide-react';
import type { InsightCard, LinkType } from '@/entities/card/model/types';
import type { YTPlayer } from '../model/youtube-api';
import { MemoEditor } from './MemoEditor';

function getPlatformInfo(linkType: LinkType) {
  switch (linkType) {
    case 'linkedin':
      return {
        name: 'LinkedIn',
        icon: Linkedin,
        color: 'hsl(207, 90%, 54%)',
        bgColor: 'hsl(207, 90%, 54% / 0.1)',
      };
    case 'notion':
      return {
        name: 'Notion',
        icon: FileText,
        color: 'hsl(0, 0%, 20%)',
        bgColor: 'hsl(0, 0%, 96%)',
      };
    default:
      return {
        name: 'Link',
        icon: Globe,
        color: 'hsl(var(--primary))',
        bgColor: 'hsl(var(--primary) / 0.1)',
      };
  }
}

interface ExternalLinkViewProps {
  card: InsightCard;
  onSave: (id: string, note: string) => void;
}

export function ExternalLinkView({ card, onSave }: ExternalLinkViewProps) {
  const { t } = useTranslation();
  const linkType = card.linkType ?? 'other';
  const platform = getPlatformInfo(linkType);
  const PlatformIcon = platform.icon;
  const nullPlayerRef = useRef<YTPlayer | null>(null);

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Left Panel - Link Reference */}
      <div
        className="w-full md:w-80 flex-shrink-0 flex flex-col border-b md:border-b-0 md:border-r"
        style={{
          background: 'hsl(var(--bg-sunken) / 0.5)',
          borderColor: 'hsl(var(--border) / 0.3)',
        }}
      >
        {/* Platform Header */}
        <div
          className="px-4 py-3 flex items-center gap-3"
          style={{ borderBottom: '1px solid hsl(var(--border) / 0.2)' }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: platform.bgColor }}
          >
            <PlatformIcon className="w-5 h-5" style={{ color: platform.color }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" style={{ color: platform.color }}>
              {platform.name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {(() => {
                try {
                  return new URL(card.videoUrl).hostname;
                } catch {
                  return card.videoUrl;
                }
              })()}
            </p>
          </div>
        </div>

        {/* OG Image */}
        {card.metadata?.image && !card.metadata.image.includes('favicon') && (
          <div className="px-4 pt-3">
            <div className="relative w-full aspect-video rounded-lg overflow-hidden" style={{ background: 'hsl(var(--bg-mid))' }}>
              <img
                src={card.metadata.image}
                alt={card.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          </div>
        )}

        {/* Title & Description */}
        <div className="px-4 py-3 flex-1 overflow-auto">
          <h3 className="text-sm font-medium text-foreground leading-relaxed mb-2">
            {card.metadata?.title || card.title || t('videoPlayer.externalContent')}
          </h3>
          {card.metadata?.description && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {card.metadata.description}
            </p>
          )}
        </div>

        {/* Action Button */}
        <div className="px-4 py-3">
          <a
            href={card.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90"
            style={{ background: platform.color, color: 'white' }}
          >
            <ExternalLink className="w-4 h-4" />
            {t('videoPlayer.viewOriginal')}
          </a>
        </div>
      </div>

      {/* Right Panel - Memo Editor */}
      <div className="flex-1 min-h-0">
        <MemoEditor
          note={card.userNote ?? ''}
          cardId={card.id}
          videoId={null}
          playerRef={nullPlayerRef}
          playerReady={false}
          onSave={onSave}
          isYouTube={false}
        />
      </div>
    </div>
  );
}
