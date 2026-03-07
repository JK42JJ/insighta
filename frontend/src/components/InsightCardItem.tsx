import { useState, useEffect, useRef, DragEvent } from 'react';
import { InsightCard } from '@/types/mandala';
import { ExternalLink, MessageSquare, GripVertical, Save, Clock, Play } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { VideoPlayerModal } from './VideoPlayerModal';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { duration, easing } from '@/lib/motion';

interface InsightCardItemProps {
  card: InsightCard;
  onClick?: () => void;
  onCtrlClick?: (e: React.MouseEvent) => void;
  onDragStart?: (card: InsightCard) => void;
  onInternalDragStart?: (e: React.DragEvent) => void;
  onSave?: (id: string, note: string) => void;
  isDraggable?: boolean; // Control whether card is draggable (default: true)
}

export function InsightCardItem({
  card,
  onClick,
  onCtrlClick,
  onDragStart,
  onInternalDragStart,
  onSave,
  isDraggable = true,
}: InsightCardItemProps) {
  const { t } = useTranslation();
  const [isFlipped, setIsFlipped] = useState(false);
  const [note, setNote] = useState(card.userNote || '');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [videoModalUrl, setVideoModalUrl] = useState(card.videoUrl);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Open video modal with specific URL (can include timestamp)
  const openVideoModal = (url: string) => {
    setVideoModalUrl(url);
    setIsVideoModalOpen(true);
  };

  // Extract timestamp from URL (e.g., "t=211s" → "03:31")
  const extractTimestampFromUrl = (
    url: string
  ): { timestamp: string; totalSeconds: number } | null => {
    const match = url.match(/[?&]t=(\d+)s?/);
    if (match) {
      const totalSeconds = parseInt(match[1], 10);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const timestamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      return { timestamp, totalSeconds };
    }
    return null;
  };

  // Extract timestamps from dropped text
  const extractTimestampFromText = (text: string): { timestamp: string; label: string } | null => {
    const match = text.match(/(\d{1,2}:\d{2})/);
    if (match) {
      const timestamp = match[1];
      const label = text
        .replace(timestamp, '')
        .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
        .trim();
      return { timestamp, label };
    }
    return null;
  };

  // Create YouTube timestamp link
  const createTimestampLink = (
    timestamp: string,
    totalSeconds: number,
    label: string,
    videoUrl: string
  ): string => {
    const videoIdMatch = videoUrl.match(/[?&]v=([^&]+)/);
    const videoId = videoIdMatch ? videoIdMatch[1] : '';
    const linkText = label ? `${timestamp} ${label}` : timestamp;
    return `[${linkText}](https://www.youtube.com/watch?v=${videoId}&t=${totalSeconds}s)`;
  };

  const handleContainerDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleTextareaDragOver = (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleContainerDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleTextareaDragLeave = (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const processDroppedData = (e: DragEvent<HTMLTextAreaElement | HTMLDivElement>) => {
    const droppedUrl =
      e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    const droppedText = e.dataTransfer.getData('text/plain');

    // Check if it's a YouTube URL with timestamp
    if (droppedUrl && (droppedUrl.includes('youtube.com') || droppedUrl.includes('youtu.be'))) {
      const urlTimestamp = extractTimestampFromUrl(droppedUrl);
      if (urlTimestamp) {
        const link = createTimestampLink(
          urlTimestamp.timestamp,
          urlTimestamp.totalSeconds,
          '',
          card.videoUrl
        );
        const cursorPos = textareaRef.current?.selectionStart || note.length;
        const newNote =
          note.slice(0, cursorPos) +
          (note.length > 0 && cursorPos > 0 ? '\n' : '') +
          link +
          note.slice(cursorPos);
        setNote(newNote);
        toast.success(t('videoPlayer.timestampLinkAdded'));
        return true;
      }
    }

    // Fallback: check for plain text timestamp format
    if (droppedText) {
      const extracted = extractTimestampFromText(droppedText);
      if (extracted) {
        const [minutes, seconds] = extracted.timestamp.split(':').map(Number);
        const totalSeconds = minutes * 60 + seconds;
        const link = createTimestampLink(
          extracted.timestamp,
          totalSeconds,
          extracted.label,
          card.videoUrl
        );
        const cursorPos = textareaRef.current?.selectionStart || note.length;
        const newNote =
          note.slice(0, cursorPos) +
          (note.length > 0 && cursorPos > 0 ? '\n' : '') +
          link +
          note.slice(cursorPos);
        setNote(newNote);
        toast.success(t('videoPlayer.timestampLinkAdded'));
        return true;
      }

      // If no timestamp found, just add the text
      const cursorPos = textareaRef.current?.selectionStart || note.length;
      const newNote = note.slice(0, cursorPos) + droppedText + note.slice(cursorPos);
      setNote(newNote);
      return true;
    }
    return false;
  };

  const handleContainerDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    processDroppedData(e);
  };

  const handleTextareaDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    processDroppedData(e);
  };

  // Sync note with card prop when card changes
  useEffect(() => {
    setNote(card.userNote || '');
  }, [card.userNote]);

  const handleDragStart = (e: React.DragEvent) => {
    if (isFlipped) {
      e.preventDefault();
      return;
    }
    // Call internal drag handler for card reorder if provided
    if (onInternalDragStart) {
      onInternalDragStart(e);
    }
    e.dataTransfer.setData('application/card-id', card.id);
    e.dataTransfer.setData('text/plain', card.videoUrl);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(card);
  };

  const handleFlip = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Check for Ctrl/Meta key for multi-select
    if (e.ctrlKey || e.metaKey) {
      onCtrlClick?.(e);
      return;
    }
    setIsFlipped(!isFlipped);
  };

  const handleSave = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onSave?.(card.id, note);
    setIsFlipped(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="perspective-1000" style={{ perspective: '1000px' }}>
      <div
        className={`relative w-full transition-transform duration-500 transform-style-preserve-3d ${isFlipped ? 'rotate-y-180' : ''}`}
        style={{
          transformStyle: 'preserve-3d',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* Front Side */}
        <motion.div
          className={`backface-hidden ${isDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} group rounded-2xl overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 ${isFlipped ? 'invisible' : ''}`}
          tabIndex={0}
          style={{
            backfaceVisibility: 'hidden',
            background: 'hsl(var(--bg-light))',
            boxShadow: 'var(--shadow-sm)',
            border: '1px solid hsl(var(--border) / 0.4)',
          }}
          whileHover={{ scale: 1.02, boxShadow: 'var(--shadow-lg)' }}
          whileTap={{ scale: 0.97 }}
          transition={{ duration: duration.fast, ease: easing.enter }}
          onClick={handleFlip}
          draggable={isDraggable && !isFlipped}
          onDragStart={handleDragStart}
        >
          {/* Drag Handle */}
          <div className="absolute top-2.5 left-2.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div
              className="bg-surface-mid/90 backdrop-blur-md rounded-lg p-1.5 border border-border/30"
              style={{ boxShadow: 'var(--shadow-sm)' }}
            >
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </div>

          {/* Thumbnail with refined gradient */}
          <div
            className="aspect-video relative overflow-hidden cursor-pointer"
            onClick={(e) => {
              if (e.shiftKey) {
                e.stopPropagation();
                openVideoModal(card.videoUrl);
              }
            }}
          >
            <img
              src={card.thumbnail}
              alt={card.title}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  'https://via.placeholder.com/320x180?text=Thumbnail';
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

            {/* Play Button Overlay - shown on hover */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <div
                className="p-4 rounded-full transition-all duration-300 hover:scale-110"
                style={{
                  background: 'hsl(var(--primary) / 0.9)',
                  boxShadow: '0 8px 32px hsl(var(--primary) / 0.4), var(--shadow-lg)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <Play className="w-6 h-6 text-primary-foreground fill-primary-foreground" />
              </div>
              <span className="absolute bottom-12 text-xs text-white/80 font-medium px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm">
                {t('insightCard.shiftClickToPlay')}
              </span>
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-3">
              <h3 className="text-sm font-semibold text-white line-clamp-2 drop-shadow-md">
                {card.title}
              </h3>
            </div>
          </div>

          {/* Content Area */}
          <div className="p-3 relative">
            <div className="flex items-start gap-2 h-[40px]">
              <div
                className="p-1 rounded-lg bg-primary/10"
                style={{ boxShadow: 'var(--shadow-inset-raised)' }}
              >
                <MessageSquare className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed pt-0.5 overflow-hidden">
                {card.userNote
                  ? // Render markdown links
                    (() => {
                      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
                      const parts: React.ReactNode[] = [];
                      let lastIndex = 0;
                      let match;
                      const text = card.userNote;

                      while ((match = linkRegex.exec(text)) !== null) {
                        if (match.index > lastIndex) {
                          parts.push(
                            <span key={`text-${lastIndex}`}>
                              {text.slice(lastIndex, match.index)}
                            </span>
                          );
                        }
                        const url = match[2];
                        parts.push(
                          <a
                            key={`link-${match.index}`}
                            href={url}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openVideoModal(url);
                            }}
                            className="text-primary hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                            title={t('insightCard.clickToPlayInApp')}
                          >
                            {match[1]}
                            <Play className="w-2.5 h-2.5" />
                          </a>
                        );
                        lastIndex = match.index + match[0].length;
                      }

                      if (lastIndex < text.length) {
                        parts.push(<span key={`text-end`}>{text.slice(lastIndex)}</span>);
                      }

                      return parts.length > 0 ? parts : text;
                    })()
                  : t('insightCard.noMemo')}
              </div>
            </div>

            <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-border/30">
              <span className="text-xs text-muted-foreground font-medium">
                {new Date(card.createdAt).toLocaleDateString('ko-KR')}
              </span>
              <motion.a
                href={card.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors duration-200"
                style={{ boxShadow: 'var(--shadow-sm)' }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </motion.a>
            </div>
          </div>
        </motion.div>

        {/* Back Side (Memo Editor) */}
        <div
          className={`absolute inset-0 backface-hidden rotate-y-180 overflow-hidden rounded-2xl ${!isFlipped ? 'invisible' : ''}`}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            background: 'hsl(var(--bg-light))',
            boxShadow: 'var(--shadow-md)',
            border: '1px solid hsl(var(--border) / 0.4)',
          }}
          onClick={handleFlip}
        >
          <div className="p-3 h-full flex flex-col relative overflow-hidden">
            {/* Header - Fixed, no wrap */}
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div
                  className="p-1 rounded-lg bg-primary/10"
                  style={{ boxShadow: 'var(--shadow-inset-raised)' }}
                >
                  <MessageSquare className="w-3 h-3 text-primary" />
                </div>
                <span className="text-xs font-semibold text-foreground whitespace-nowrap">
                  {t('insightCard.memoEdit')}
                </span>
              </div>
              <span className="text-xs text-muted-foreground flex items-center gap-1 bg-surface-sunken px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
                <Clock className="w-2.5 h-2.5" />
                {new Date(card.createdAt).toLocaleDateString('ko-KR')}
              </span>
            </div>

            {/* Memo Area with Toggle - Dynamic height */}
            <div
              ref={containerRef}
              className={`flex-1 min-h-0 rounded-xl transition-all duration-200 overflow-hidden ${isDragOver ? 'ring-2 ring-primary border-primary bg-primary/5' : ''}`}
              onDragOver={handleContainerDragOver}
              onDragLeave={handleContainerDragLeave}
              onDrop={handleContainerDrop}
              onClick={(e) => e.stopPropagation()}
            >
              {isEditing ? (
                /* Editing Mode - Textarea */
                <Textarea
                  ref={textareaRef}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={() => setIsEditing(false)}
                  onDragOver={handleTextareaDragOver}
                  onDragLeave={handleTextareaDragLeave}
                  onDrop={handleTextareaDrop}
                  autoFocus
                  placeholder={t('insightCard.dragTimestamp')}
                  className="w-full h-full resize-none text-xs bg-surface-mid border-border/30 rounded-xl focus:ring-primary/30 focus:border-primary/40 transition-all duration-200"
                />
              ) : (
                /* Preview Mode - Link Preview */
                <div
                  className="p-2.5 rounded-xl text-xs space-y-1 h-full overflow-y-auto cursor-text hover:bg-surface-mid/60 transition-colors"
                  style={{
                    background: 'hsl(var(--bg-sunken))',
                    boxShadow: 'var(--shadow-inset-sunken)',
                  }}
                  onClick={() => setIsEditing(true)}
                >
                  {note ? (
                    note.split('\n').map((line, lineIdx) => {
                      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
                      const parts: React.ReactNode[] = [];
                      let lastIndex = 0;
                      let match;

                      while ((match = linkRegex.exec(line)) !== null) {
                        if (match.index > lastIndex) {
                          parts.push(
                            <span key={`text-${lineIdx}-${lastIndex}`}>
                              {line.slice(lastIndex, match.index)}
                            </span>
                          );
                        }
                        const url = match[2];
                        parts.push(
                          <a
                            key={`link-${lineIdx}-${match.index}`}
                            href={url}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openVideoModal(url);
                            }}
                            className="text-primary hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                            title={t('insightCard.clickToPlayInApp')}
                          >
                            {match[1]}
                            <Play className="w-3 h-3" />
                          </a>
                        );
                        lastIndex = match.index + match[0].length;
                      }

                      if (lastIndex < line.length) {
                        parts.push(
                          <span key={`text-${lineIdx}-end`}>{line.slice(lastIndex)}</span>
                        );
                      }

                      if (parts.length === 0 && line) {
                        parts.push(<span key={`line-${lineIdx}`}>{line}</span>);
                      }

                      return parts.length > 0 ? <div key={lineIdx}>{parts}</div> : null;
                    })
                  ) : (
                    <span className="text-muted-foreground">
                      {t('insightCard.clickToWriteNote')}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Action Button - Fixed at bottom */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30 flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Extract first timestamp link from memo
                  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/;
                  const linkMatch = note.match(linkPattern);

                  let shareUrl: string;
                  let shareText: string;

                  if (linkMatch) {
                    const linkLabel = linkMatch[1];
                    const linkUrl = linkMatch[2];
                    const memoWithoutLink = note.replace(linkMatch[0], '').trim();
                    shareText = memoWithoutLink ? `${linkLabel} ${memoWithoutLink}` : linkLabel;
                    shareUrl = linkUrl;
                  } else {
                    shareText = card.title || 'Check out this video!';
                    shareUrl = card.videoUrl;
                  }

                  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
                  window.open(twitterUrl, '_blank', 'noopener,noreferrer,width=550,height=420');
                  toast.success(t('videoPlayer.xShareOpened'));
                }}
                className="h-11 w-11 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-mid transition-colors"
                title={t('videoPlayer.shareOnX')}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </button>
              <Button
                size="sm"
                onClick={handleSave}
                className="h-11 w-11 p-0 rounded-lg"
                style={{ boxShadow: 'var(--shadow-md)' }}
              >
                <Save className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Video Player Modal */}
      <VideoPlayerModal
        card={{ ...card, videoUrl: videoModalUrl }}
        isOpen={isVideoModalOpen}
        onClose={() => {
          setIsVideoModalOpen(false);
          setVideoModalUrl(card.videoUrl); // Reset to original URL
        }}
        onSave={onSave}
      />
    </div>
  );
}
