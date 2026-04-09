/**
 * Small footer indicator for the auto-save state machine.
 */
import type { AutoSaveStatus } from '../model/useAutoSave';

export interface SaveStatusIndicatorProps {
  status: AutoSaveStatus;
  onRetry: () => void;
}

export function SaveStatusIndicator({ status, onRetry }: SaveStatusIndicatorProps) {
  if (status === 'idle') return null;

  if (status === 'pending' || status === 'saving') {
    return (
      <span className="text-xs text-muted-foreground" aria-live="polite">
        저장 중…
      </span>
    );
  }

  if (status === 'saved') {
    return (
      <span className="text-xs text-muted-foreground" aria-live="polite">
        저장됨
      </span>
    );
  }

  // error
  return (
    <span className="flex items-center gap-2 text-xs text-destructive" role="alert">
      <span>저장 실패</span>
      <button
        type="button"
        onClick={onRetry}
        className="underline underline-offset-2 hover:text-destructive/80"
      >
        재시도
      </button>
    </span>
  );
}
