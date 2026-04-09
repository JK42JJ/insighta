/**
 * Footer: save status indicator + word count.
 *
 * Design tokens: insighta-side-editor-mockup-v3.html
 */
import { cn } from '@/shared/lib/utils';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface PanelFooterProps {
  saveStatus: SaveStatus;
  wordCount: number;
  onRetry: () => void;
}

export function PanelFooter({ saveStatus, wordCount, onRetry }: PanelFooterProps) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t border-[rgba(255,255,255,0.04)] px-4 py-[7px]">
      {/* Save status */}
      <div className="flex items-center gap-1 text-[10px] text-[#4e4f5c]">
        {saveStatus === 'saving' && <span>저장 중...</span>}

        {saveStatus === 'saved' && (
          <>
            <span className="inline-block h-1 w-1 rounded-full bg-[#34d399]" aria-hidden />
            <span>저장됨</span>
          </>
        )}

        {saveStatus === 'error' && (
          <button type="button" onClick={onRetry} className="text-red-400 hover:text-red-300">
            저장 실패 — 재시도
          </button>
        )}

        {/* idle: nothing shown */}
      </div>

      {/* Word count */}
      <span className={cn("font-['JetBrains_Mono',monospace] text-[10px] text-[#353642]")}>
        {wordCount}w
      </span>
    </div>
  );
}
