/**
 * Main video side panel — slides in from the right (560px).
 * Pure CSS div, NOT Radix Sheet (avoids Dialog conflicts).
 *
 * Design tokens: insighta-side-editor-mockup-v3.html
 */
import { useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useVideoPanelStore } from '../model/useVideoPanelStore';
import { PANEL_WIDTH_PX, PANEL_TRANSITION } from '../config';
import { PanelVideoPlayer } from './PanelVideoPlayer';
import { PanelVideoInfo } from './PanelVideoInfo';
import { PanelTabs } from './PanelTabs';
import { PanelNoteEditor } from './PanelNoteEditor';
import { PanelAISummary } from './PanelAISummary';
import { PanelFooter } from './PanelFooter';

export function VideoSidePanel() {
  const isOpen = useVideoPanelStore((s) => s.isOpen);
  const card = useVideoPanelStore((s) => s.card);
  const activeTab = useVideoPanelStore((s) => s.activeTab);
  const closeSidebar = useVideoPanelStore((s) => s.closeSidebar);
  const setTab = useVideoPanelStore((s) => s.setTab);

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

  return (
    <div
      role="complementary"
      aria-label="Video side panel"
      className={cn(
        'flex-shrink-0 flex flex-col sticky top-0 h-screen bg-background',
        'border-l border-[rgba(255,255,255,0.06)]',
        !isOpen && 'hidden'
      )}
      style={{
        width: `${PANEL_WIDTH_PX}px`,
      }}
    >
      {/* Close button — overlaid on the video player area */}
      <button
        type="button"
        aria-label="패널 닫기"
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

      {/* Video player */}
      {card && <PanelVideoPlayer videoUrl={card.videoUrl} />}

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
