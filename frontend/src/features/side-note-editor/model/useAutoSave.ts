/**
 * Auto-save hook with debounce + finite state machine.
 *
 * State transitions:
 *   idle → (trigger) → pending → (debounce AUTO_SAVE_DEBOUNCE_MS) → saving
 *        → (success) → saved → (SAVED_DISPLAY_MS) → idle
 *        → (error)   → error (user can retry)
 *
 * Consumers:
 *   const { status, trigger, retry } = useAutoSave(save);
 *   // call trigger(doc) on every editor update
 *   // render status to show the "저장됨 / 저장 중… / 재시도" indicator
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTO_SAVE_DEBOUNCE_MS, SAVED_DISPLAY_MS } from '../config';
import type { TiptapDoc } from '../lib/note-parser';

export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface UseAutoSaveResult {
  status: AutoSaveStatus;
  /** Call whenever the document changes. */
  trigger: (doc: TiptapDoc) => void;
  /** Retry the last failed save. */
  retry: () => void;
  /** Immediately save any pending change (no debounce). */
  flush: () => void;
}

export function useAutoSave(
  save: (doc: TiptapDoc) => Promise<void>,
  debounceMs: number = AUTO_SAVE_DEBOUNCE_MS
): UseAutoSaveResult {
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRevertRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDocRef = useRef<TiptapDoc | null>(null);
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const clearDebounce = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  const clearSavedRevert = () => {
    if (savedRevertRef.current) {
      clearTimeout(savedRevertRef.current);
      savedRevertRef.current = null;
    }
  };

  const runSave = useCallback(async () => {
    const doc = latestDocRef.current;
    if (!doc) return;
    setStatus('saving');
    try {
      await saveRef.current(doc);
      setStatus('saved');
      clearSavedRevert();
      savedRevertRef.current = setTimeout(() => {
        setStatus('idle');
      }, SAVED_DISPLAY_MS);
    } catch {
      setStatus('error');
    }
  }, []);

  const trigger = useCallback(
    (doc: TiptapDoc) => {
      latestDocRef.current = doc;
      setStatus('pending');
      clearDebounce();
      debounceRef.current = setTimeout(() => {
        void runSave();
      }, debounceMs);
    },
    [debounceMs, runSave]
  );

  const retry = useCallback(() => {
    if (!latestDocRef.current) return;
    void runSave();
  }, [runSave]);

  const flush = useCallback(() => {
    clearDebounce();
    if (latestDocRef.current) {
      void runSave();
    }
  }, [runSave]);

  // Cleanup timers on unmount.
  useEffect(() => {
    return () => {
      clearDebounce();
      clearSavedRevert();
    };
  }, []);

  return { status, trigger, retry, flush };
}
