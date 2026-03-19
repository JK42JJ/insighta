import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'app-settings';

function getCardFlipEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return true; // default: enabled
    const parsed = JSON.parse(raw);
    return parsed.cardFlipOnHover ?? true;
  } catch {
    return true;
  }
}

let cachedValue = getCardFlipEnabled();

function subscribe(callback: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      cachedValue = getCardFlipEnabled();
      callback();
    }
  };
  // Also listen for same-tab changes via custom event
  const customHandler = () => {
    cachedValue = getCardFlipEnabled();
    callback();
  };
  window.addEventListener('storage', handler);
  window.addEventListener('app-settings-changed', customHandler);
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener('app-settings-changed', customHandler);
  };
}

function getSnapshot(): boolean {
  return cachedValue;
}

/**
 * Read the "card flip on hover" setting from localStorage.
 * Reactively updates when settings change.
 */
export function useCardFlipSetting(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
