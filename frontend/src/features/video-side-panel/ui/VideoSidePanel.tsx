/**
 * Main video side panel — resizable right panel.
 * Pure CSS div, NOT Radix Sheet (avoids Dialog conflicts).
 *
 * Design tokens: insighta-side-editor-mockup-v3.html
 */
import { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useVideoPanelStore } from '../model/useVideoPanelStore';
// Panel width managed by react-resizable-panels in IndexPage
import { PanelVideoPlayer } from './PanelVideoPlayer';
import { PanelVideoInfo } from './PanelVideoInfo';
import { PanelTabs } from './PanelTabs';
import { PanelNoteEditor } from './PanelNoteEditor';
import { PanelAISummary } from './PanelAISummary';
import { PanelFooter } from './PanelFooter';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';

export function VideoSidePanel() {
  const isOpen = useVideoPanelStore((s) => s.isOpen);
  const card = useVideoPanelStore((s) => s.card);
  const activeTab = useVideoPanelStore((s) => s.activeTab);
  const startTime = useVideoPanelStore((s) => s.startTime);
  const closeSidebar = useVideoPanelStore((s) => s.closeSidebar);
  const setTab = useVideoPanelStore((s) => s.setTab);
  const shouldAutoplay = useVideoPanelStore((s) => s.shouldAutoplay);
  const consumeAutoplay = useVideoPanelStore((s) => s.consumeAutoplay);

  const playerRef = useRef<YTPlayer | null>(null);
  const playerReadyRef = useRef(false);

  const handlePlayerReady = useCallback(() => {
    playerReadyRef.current = true;
  }, []);

  // Reset ready state when panel closes
  useEffect(() => {
    if (!isOpen) playerReadyRef.current = false;
  }, [isOpen]);

  // ESC handler — capture phase so it doesn't propagate to the modal underneath.
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSidebar();
      }
    };

    document.addEventListener('keydown', handleEsc, true);
    return () => document.removeEventListener('keydown', handleEsc, true);
  }, [isOpen, closeSidebar]);

  const handleTabChange = useCallback((tab: 'notes' | 'ai-summary') => setTab(tab), [setTab]);

  /** Seek the video player to a specific position (used by TimestampNode clicks). */
  const handleSeek = useCallback((seconds: number) => {
    if (playerRef.current && playerReadyRef.current) {
      try {
        playerRef.current.seekTo(seconds, true);
      } catch {
        // Player might not be ready
      }
    }
  }, []);

  return (
    <div
      role="complementary"
      aria-label="Video side panel"
      className={cn(
        'flex flex-col w-full h-full bg-background overflow-hidden',
        !isOpen && 'hidden'
      )}
    >
      {/* Close button — overlaid on the video player area */}
      <button
        type="button"
        aria-label="Close panel"
        onClick={closeSidebar}
        className={cn(
          'absolute top-2 right-2 z-10',
          'flex h-7 w-7 items-center justify-center rounded-[6px]',
          'bg-[rgba(0,0,0,0.45)] text-[rgba(255,255,255,0.6)]',
          'backdrop-blur-[6px] transition-all duration-150',
          'hover:bg-[rgba(0,0,0,0.65)] hover:text-white'
        )}
      >
        <X className="h-[13px] w-[13px]" />
      </button>

      {/* Video player — unmounts on close to stop audio; card kept for resume */}
      {isOpen && card && (
        <PanelVideoPlayer
          videoUrl={card.videoUrl}
          startTime={startTime}
          playerRef={playerRef}
          onReady={() => {
            handlePlayerReady();
            // Mark autoplay consumed so subsequent re-renders don't re-trigger
            if (shouldAutoplay) consumeAutoplay();
          }}
          shouldAutoplay={shouldAutoplay}
        />
      )}

      {/* Video info */}
      {card && <PanelVideoInfo card={card} />}

      {/* Tabs */}
      <PanelTabs activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Scrollable content area */}
      <div className={cn('flex-1 overflow-y-auto px-4 py-3.5 scrollbar-pro')}>
        {activeTab === 'notes' ? (
          <PanelNoteEditor
            initialContent={card?.userNote ?? ''}
            onDocChange={() => {
              // TODO: wire to useAutoSave in next PR
            }}
            onTimestampClick={handleSeek}
            playerRef={playerRef}
            videoUrl={card?.videoUrl}
          />
        ) : (
          <PanelAISummary videoSummary={card?.videoSummary} />
        )}
      </div>

      {/* Footer */}
      <PanelFooter
        saveStatus="idle"
        wordCount={0}
        onRetry={() => {
          // TODO: wire to useAutoSave in next PR
        }}
      />
    </div>
  );
}
