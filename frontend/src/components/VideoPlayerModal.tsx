import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { X, ExternalLink, MessageSquare, Timer, Rewind, FastForward, Play, Linkedin, FileText, Globe } from "lucide-react";
import { useState, useEffect, useRef, DragEvent, useCallback } from "react";
import { InsightCard, LinkType } from "@/types/mandala";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { detectLinkType } from "@/data/mockData";

// Declare YouTube IFrame API types
declare global {
  interface Window {
    YT: {
      Player: new (elementId: string, options: {
        events?: {
          onReady?: (event: { target: YTPlayer }) => void;
          onStateChange?: (event: { data: number }) => void;
        };
      }) => YTPlayer;
      PlayerState: {
        PLAYING: number;
        PAUSED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  getCurrentTime: () => number;
  getPlayerState: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  destroy: () => void;
}

interface VideoPlayerModalProps {
  card: InsightCard | null;
  isOpen: boolean;
  onClose: () => void;
  onSave?: (id: string, note: string) => void;
  onSaveWatchPosition?: (id: string, positionSeconds: number) => void;
}

// Extract video ID from YouTube URL
const getYouTubeVideoId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
    /youtube\.com\/watch\?.*v=([^&\s]+)/,
    /youtube\.com\/shorts\/([^&\s?]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
};

// Extract timestamp from URL
const getTimestamp = (url: string): number => {
  const match = url.match(/[?&]t=(\d+)s?/);
  return match ? parseInt(match[1], 10) : 0;
};

// Load YouTube IFrame API
const loadYouTubeAPI = (): Promise<void> => {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      resolve();
    };
  });
};

// Get platform info for non-YouTube links
const getPlatformInfo = (linkType: LinkType) => {
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
};

export function VideoPlayerModal({ card, isOpen, onClose, onSave, onSaveWatchPosition }: VideoPlayerModalProps) {
  const [note, setNote] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [seekIndicator, setSeekIndicator] = useState<{ direction: 'forward' | 'backward'; seconds: number } | null>(null);
  const [iframeLoading, setIframeLoading] = useState(true);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSeekRef = useRef<{ direction: 'forward' | 'backward'; seconds: number; baseTime: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const watchPositionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedPositionRef = useRef<number>(0);
  
  // Stable iframe ID that doesn't change on re-renders
  const iframeIdRef = useRef<string | null>(null);
  if (!iframeIdRef.current && card) {
    iframeIdRef.current = `yt-player-${card.id}`;
  }
  const iframeId = iframeIdRef.current || "yt-player-default";

  // Determine link type
  const linkType = card?.linkType || (card ? detectLinkType(card.videoUrl) : 'youtube');
  const isYouTube = linkType === 'youtube' || linkType === 'youtube-shorts';
  const videoId = card && isYouTube ? getYouTubeVideoId(card.videoUrl) : null;
  const urlTimestamp = card && isYouTube ? getTimestamp(card.videoUrl) : 0;
  // Use URL timestamp if specified, otherwise use last watch position
  const startTime = urlTimestamp > 0 ? urlTimestamp : (card?.lastWatchPosition || 0);
  const platformInfo = !isYouTube ? getPlatformInfo(linkType) : null;

  // Initialize YouTube Player (only when modal opens and it's a YouTube video)
  useEffect(() => {
    if (!isOpen || !videoId || !isYouTube) return;

    const initPlayer = async () => {
      await loadYouTubeAPI();

      // Wait for iframe to be in DOM
      setTimeout(() => {
        if (document.getElementById(iframeId)) {
          playerRef.current = new window.YT.Player(iframeId, {
            events: {
              onReady: () => {
                setPlayerReady(true);
              },
            },
          });
        }
      }, 500);
    };

    initPlayer();

    return () => {
      // Clean up only when modal is actually closing or videoId changes
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch (e) {
          // Ignore destroy errors
        }
        playerRef.current = null;
      }
      setPlayerReady(false);
    };
  }, [isOpen, videoId, iframeId, isYouTube]);

  // Fix blank screen after exiting fullscreen
  useEffect(() => {
    if (!isOpen) return;

    const handleFullscreenChange = () => {
      // Force a repaint when exiting fullscreen
      if (!document.fullscreenElement) {
        // Trigger a reflow to fix rendering issues
        requestAnimationFrame(() => {
          document.body.style.display = 'none';
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          document.body.offsetHeight; // Force reflow
          document.body.style.display = '';
        });
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [isOpen]);

  // Save watch position periodically and on close
  useEffect(() => {
    if (!isOpen || !isYouTube || !card || !onSaveWatchPosition) return;

    // Function to save current position
    const saveCurrentPosition = () => {
      if (playerRef.current && playerReady) {
        try {
          const currentTime = Math.floor(playerRef.current.getCurrentTime());
          // Only save if position changed significantly (at least 5 seconds difference)
          if (Math.abs(currentTime - lastSavedPositionRef.current) >= 5) {
            lastSavedPositionRef.current = currentTime;
            onSaveWatchPosition(card.id, currentTime);
          }
        } catch (e) {
          // Player might not be ready or destroyed
        }
      }
    };

    // Initialize last saved position
    lastSavedPositionRef.current = card.lastWatchPosition || 0;

    // Save every 30 seconds while watching
    watchPositionIntervalRef.current = setInterval(saveCurrentPosition, 30000);

    // Save on unmount (modal close)
    return () => {
      if (watchPositionIntervalRef.current) {
        clearInterval(watchPositionIntervalRef.current);
        watchPositionIntervalRef.current = null;
      }
      // Final save when closing
      saveCurrentPosition();
    };
  }, [isOpen, isYouTube, card?.id, playerReady, onSaveWatchPosition]);

  // Sync note with card when modal opens (only on card ID change, not on every card prop update)
  const prevCardIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (card && isOpen && card.id !== prevCardIdRef.current) {
      setNote(card.userNote || "");
      setIframeLoading(true); // Reset loading state for new card
      prevCardIdRef.current = card.id;
    }
    if (!isOpen) {
      prevCardIdRef.current = null;
      setIframeLoading(true); // Reset when closing
    }
  }, [card?.id, card?.userNote, isOpen]);

  // Keyboard controls for video seek with debounce
  useEffect(() => {
    if (!isOpen || !playerReady) return;

    const executeSeek = () => {
      if (!pendingSeekRef.current || !playerRef.current) return;
      
      const { direction, seconds, baseTime } = pendingSeekRef.current;
      const targetTime = direction === 'forward' 
        ? baseTime + seconds 
        : Math.max(0, baseTime - seconds);
      
      playerRef.current.seekTo(targetTime, true);
      pendingSeekRef.current = null;
      
      // Hide indicator after seek
      setTimeout(() => setSeekIndicator(null), 300);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in textarea
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        return;
      }

      if (!playerRef.current) return;

      const SEEK_SECONDS = 5;
      
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        
        // Initialize or accumulate pending seek
        if (!pendingSeekRef.current || pendingSeekRef.current.direction !== 'backward') {
          const currentTime = playerRef.current.getCurrentTime();
          pendingSeekRef.current = { direction: 'backward', seconds: SEEK_SECONDS, baseTime: currentTime };
        } else {
          pendingSeekRef.current.seconds += SEEK_SECONDS;
        }
        
        // Update indicator
        setSeekIndicator({ direction: 'backward', seconds: pendingSeekRef.current.seconds });
        
        // Reset and restart debounce timer
        if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
        seekTimeoutRef.current = setTimeout(executeSeek, 300);
        
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        
        // Initialize or accumulate pending seek
        if (!pendingSeekRef.current || pendingSeekRef.current.direction !== 'forward') {
          const currentTime = playerRef.current.getCurrentTime();
          pendingSeekRef.current = { direction: 'forward', seconds: SEEK_SECONDS, baseTime: currentTime };
        } else {
          pendingSeekRef.current.seconds += SEEK_SECONDS;
        }
        
        // Update indicator
        setSeekIndicator({ direction: 'forward', seconds: pendingSeekRef.current.seconds });
        
        // Reset and restart debounce timer
        if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
        seekTimeoutRef.current = setTimeout(executeSeek, 300);
      } else if (e.key === ' ') {
        e.preventDefault();
        // Toggle play/pause
        const playerState = playerRef.current.getPlayerState();
        if (playerState === 1) {
          playerRef.current.pauseVideo();
        } else {
          playerRef.current.playVideo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    };
  }, [isOpen, playerReady]);

  // Add current timestamp to note
  const addCurrentTimestamp = useCallback(() => {
    if (!playerRef.current || !videoId) {
      toast.error("플레이어가 준비되지 않았습니다");
      return;
    }

    try {
      const currentTime = Math.floor(playerRef.current.getCurrentTime());
      const minutes = Math.floor(currentTime / 60);
      const seconds = currentTime % 60;
      const timestamp = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      const link = `[${timestamp}](https://www.youtube.com/watch?v=${videoId}&t=${currentTime}s)`;
      
      const prefix = note + (note.length > 0 ? "\n" : "");
      const newNote = prefix + link + " ";
      // Cursor position: right after timestamp, before "]" -> prefix + "[" + timestamp
      const cursorPosition = prefix.length + 1 + timestamp.length;
      setNote(newNote);
      setIsEditing(true);
      
      // Set cursor position after state update
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
        }
      }, 50);
      
      toast.success(`${timestamp} 타임스탬프 추가됨`);
    } catch (e) {
      toast.error("타임스탬프를 가져올 수 없습니다");
    }
  }, [note, videoId]);

  if (!card) return null;
  // Allow non-YouTube links to proceed without videoId
  if (isYouTube && !videoId) return null;

  // Generate embed URL based on link type
  const getEmbedUrl = () => {
    if (isYouTube && videoId) {
      return `https://www.youtube.com/embed/${videoId}?start=${startTime}&autoplay=1&rel=0&modestbranding=1&enablejsapi=1`;
    }
    // For LinkedIn/Notion, use the original URL directly
    return card.videoUrl;
  };
  
  const embedUrl = getEmbedUrl();

  // Timestamp utilities
  const extractTimestampFromUrl = (url: string): { timestamp: string; totalSeconds: number } | null => {
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

  const extractTimestampFromText = (text: string): { timestamp: string; label: string } | null => {
    const match = text.match(/(\d{1,2}:\d{2})/);
    if (match) {
      const timestamp = match[1];
      const label = text.replace(timestamp, "").replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "").trim();
      return { timestamp, label };
    }
    return null;
  };

  const createTimestampLink = (timestamp: string, totalSeconds: number, label: string): string => {
    const linkText = label ? `${timestamp} ${label}` : timestamp;
    return `[${linkText}](https://www.youtube.com/watch?v=${videoId}&t=${totalSeconds}s)`;
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const droppedUrl = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    const droppedText = e.dataTransfer.getData("text/plain");
    
    if (droppedUrl && (droppedUrl.includes("youtube.com") || droppedUrl.includes("youtu.be"))) {
      const urlTimestamp = extractTimestampFromUrl(droppedUrl);
      if (urlTimestamp) {
        const link = createTimestampLink(urlTimestamp.timestamp, urlTimestamp.totalSeconds, "");
        const cursorPos = textareaRef.current?.selectionStart || note.length;
        const newNote = note.slice(0, cursorPos) + (note.length > 0 && cursorPos > 0 ? "\n" : "") + link + note.slice(cursorPos);
        setNote(newNote);
        toast.success("타임스탬프 링크가 추가되었습니다");
        return;
      }
    }

    if (droppedText) {
      const extracted = extractTimestampFromText(droppedText);
      if (extracted) {
        const [minutes, seconds] = extracted.timestamp.split(":").map(Number);
        const totalSeconds = minutes * 60 + seconds;
        const link = createTimestampLink(extracted.timestamp, totalSeconds, extracted.label);
        const cursorPos = textareaRef.current?.selectionStart || note.length;
        const newNote = note.slice(0, cursorPos) + (note.length > 0 && cursorPos > 0 ? "\n" : "") + link + note.slice(cursorPos);
        setNote(newNote);
        toast.success("타임스탬프 링크가 추가되었습니다");
        return;
      }
      
      const cursorPos = textareaRef.current?.selectionStart || note.length;
      const newNote = note.slice(0, cursorPos) + droppedText + note.slice(cursorPos);
      setNote(newNote);
    }
  };

  const handleSave = () => {
    if (onSave && card) {
      onSave(card.id, note);
      toast.success("메모가 저장되었습니다");
    }
    setIsEditing(false);
  };

  // Extract timestamp from YouTube URL (returns seconds)
  const extractTimestampSeconds = (url: string): number | null => {
    const tMatch = url.match(/[?&]t=(\d+)/);
    if (tMatch) return parseInt(tMatch[1], 10);
    return null;
  };

  // Render markdown links in preview
  const renderNotePreview = () => {
    if (!note) return <span className="text-muted-foreground">클릭하여 메모 작성...</span>;
    
    return note.split('\n').map((line, lineIdx) => {
      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match;
      
      while ((match = linkRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          parts.push(<span key={`text-${lineIdx}-${lastIndex}`}>{line.slice(lastIndex, match.index)}</span>);
        }
        const url = match[2];
        const isYouTubeTimestamp = url.includes('youtube.com') || url.includes('youtu.be');
        const timestampSeconds = isYouTubeTimestamp ? extractTimestampSeconds(url) : null;
        
        parts.push(
          <a
            key={`link-${lineIdx}-${match.index}`}
            href={url}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isYouTubeTimestamp && timestampSeconds !== null && playerRef.current && playerReady) {
                // Seek to timestamp within the current video player
                playerRef.current.seekTo(timestampSeconds, true);
              } else {
                // Non-YouTube link or no timestamp - open externally
                window.open(url, '_blank', 'noopener,noreferrer');
              }
            }}
            className="text-primary hover:underline inline-flex items-center gap-0.5 cursor-pointer"
          >
            {match[1]}
            {isYouTubeTimestamp && timestampSeconds !== null ? (
              <Play className="w-3 h-3" />
            ) : (
              <ExternalLink className="w-3 h-3" />
            )}
          </a>
        );
        lastIndex = match.index + match[0].length;
      }
      
      if (lastIndex < line.length) {
        parts.push(<span key={`text-${lineIdx}-end`}>{line.slice(lastIndex)}</span>);
      }
      
      if (parts.length === 0 && line) {
        parts.push(<span key={`line-${lineIdx}`}>{line}</span>);
      }
      
      return parts.length > 0 ? <div key={lineIdx}>{parts}</div> : null;
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open) {
          // Defer onClose to next event loop to prevent race condition with route navigation
          setTimeout(() => {
            onClose();
          }, 0);
        }
      }}>
      <DialogContent 
        className="max-w-4xl w-[90vw] p-0 gap-0 overflow-hidden border-0 outline-none"
        style={{
          background: 'hsl(var(--bg-mid))',
          boxShadow: '0 25px 80px -12px rgba(0, 0, 0, 0.7)',
          borderRadius: '0',
          border: 'none',
        }}
      >
        <VisuallyHidden>
          <DialogTitle>{card.title}</DialogTitle>
        </VisuallyHidden>


        {/* Content Area - Video or External Page */}
        <div className="relative w-full aspect-video bg-surface-base">
          {isYouTube ? (
            // YouTube iframe
            <>
              <iframe
                id={iframeId}
                src={embedUrl}
                title={card.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="absolute inset-0 w-full h-full border-0"
              />
              
              {/* Seek Indicator Overlay - YouTube only */}
              {seekIndicator && (
                <div className="absolute bottom-16 left-0 right-0 flex justify-center pointer-events-none z-10">
                  <div 
                    className="flex items-center gap-2 px-4 py-2 rounded-full animate-fade-in"
                    style={{ background: 'transparent' }}
                  >
                    {seekIndicator.direction === 'backward' ? (
                      <>
                        <Rewind className="w-5 h-5 text-foreground/50" />
                        <span className="text-sm font-medium text-foreground/50">{seekIndicator.seconds}초</span>
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-medium text-foreground/50">{seekIndicator.seconds}초</span>
                        <FastForward className="w-5 h-5 text-foreground/50" />
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            // Custom card view for external links (LinkedIn, Notion, etc.)
            // Two-panel layout: Link reference + Content/Notes area
            <div className="absolute inset-0 w-full h-full flex flex-col md:flex-row bg-surface-base">
              {/* Left Panel - Link Reference (smaller) */}
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
                    style={{ background: platformInfo?.bgColor }}
                  >
                    {platformInfo && (
                      <platformInfo.icon 
                        className="w-5 h-5" 
                        style={{ color: platformInfo.color }} 
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: platformInfo?.color }}>
                      {platformInfo?.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {new URL(card.videoUrl).hostname}
                    </p>
                  </div>
                </div>
                
                {/* OG Image - if available */}
                {card.metadata?.image && !card.metadata.image.includes('favicon') && (
                  <div className="px-4 pt-3">
                    <div className="relative w-full aspect-video bg-surface-mid rounded-lg overflow-hidden">
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
                    {card.metadata?.title || card.title || "외부 콘텐츠"}
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
                    style={{ 
                      background: platformInfo?.color,
                      color: 'white',
                    }}
                  >
                    <ExternalLink className="w-4 h-4" />
                    원본 보기
                  </a>
                </div>
              </div>
              
              {/* Right Panel - Content Paste Area */}
              <div className="flex-1 flex flex-col min-h-0">
                {/* Content Header */}
                <div 
                  className="px-4 py-2 flex items-center justify-between"
                  style={{ 
                    background: 'hsl(var(--bg-mid) / 0.5)',
                    borderBottom: '1px solid hsl(var(--border) / 0.2)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">콘텐츠 요약</span>
                  </div>
                  <span className="text-xs text-muted-foreground/60">
                    원본 페이지에서 텍스트를 복사하여 붙여넣으세요
                  </span>
                </div>
                
                {/* Content Input Area */}
                <div className="flex-1 p-4 overflow-auto">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        handleSave();
                      }
                    }}
                    placeholder={`📋 원본 페이지에서 중요한 내용을 복사해서 붙여넣으세요.\n\n💡 나의 인사이트:\n- 핵심 내용 요약\n- 적용할 점\n- 참고할 아이디어\n\n(Ctrl+Enter로 저장)`}
                    className="w-full h-full min-h-[200px] resize-none text-sm border-0 focus:ring-0 focus:outline-none p-3 rounded-lg"
                    style={{ 
                      background: 'hsl(var(--bg-sunken) / 0.3)',
                      caretColor: 'hsl(var(--primary))',
                    }}
                  />
                </div>
                
                {/* Save Bar */}
                <div 
                  className="px-4 py-3 flex items-center justify-between"
                  style={{ 
                    background: 'hsl(var(--bg-mid) / 0.5)',
                    borderTop: '1px solid hsl(var(--border) / 0.2)',
                  }}
                >
                  <span className="text-xs text-muted-foreground">
                    Ctrl+Enter로 저장
                  </span>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    className="px-4"
                  >
                    저장
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Memo Panel - Below video, only for YouTube */}
        {isYouTube && (
          <div 
            className="p-3"
            style={{
              background: 'linear-gradient(to top, hsl(var(--bg-base) / 0.96), hsl(var(--bg-base) / 0.8))',
              backdropFilter: 'blur(12px)',
            }}
          >
            {/* Memo Section - Compact Layout */}
            <div 
              className={`transition-all duration-200 ${isDragOver ? "ring-2 ring-primary" : ""}`}
              style={{
                background: 'hsl(var(--bg-sunken) / 0.85)',
                backdropFilter: 'blur(18px)',
                boxShadow: '0 -12px 40px hsl(var(--bg-base) / 0.75)',
                border: '1px solid hsl(var(--border) / 0.3)',
              }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
                {/* Memo Header - Compact with inline actions */}
                <div className="px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* Timestamp button - YouTube only */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={addCurrentTimestamp}
                      disabled={!playerReady}
                      className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40"
                      title="현재 재생 시점을 메모에 추가"
                    >
                      <Timer className="w-3.5 h-3.5" />
                    </Button>
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-3.5 h-3.5 text-foreground/60" />
                      <span className="text-xs font-medium text-foreground/60">메모</span>
                    </div>
                  </div>
                  {/* X Share Button */}
                  <button
                    onClick={() => {
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
                        shareText = card.title || "Check out this video!";
                        shareUrl = card.videoUrl;
                      }
                      
                      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
                      window.open(twitterUrl, '_blank', 'noopener,noreferrer,width=550,height=420');
                      toast.success("X 공유 창이 열렸습니다");
                    }}
                    className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-mid rounded transition-colors"
                    title="X에 공유"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </button>
                </div>

                {/* Memo Content - Compact */}
                <div className="px-3 pb-3">
                  {isEditing ? (
                    <Textarea
                      ref={textareaRef}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSave();
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                      autoFocus
                      placeholder="메모 입력... (Enter 저장, Shift+Enter 줄바꿈)"
                      className="w-full min-h-[50px] max-h-[200px] resize-none text-sm bg-transparent border-0 focus:ring-0 focus:outline-none p-0 text-foreground/60 placeholder:text-muted-foreground/40 overflow-y-auto scrollbar-thin"
                      style={{ caretColor: 'hsl(var(--primary))' }}
                    />
                  ) : (
                    <div
                      className="text-sm min-h-[40px] max-h-[200px] overflow-y-auto cursor-text rounded-lg transition-colors py-1 scrollbar-thin"
                      onClick={() => setIsEditing(true)}
                    >
                      {note ? (
                        <div className="space-y-0.5 text-foreground/60">
                          {renderNotePreview()}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/60 text-xs">클릭하여 메모 작성...</span>
                      )}
                    </div>
                  )}
                </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
