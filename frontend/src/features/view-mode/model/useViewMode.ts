import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ViewMode } from './types';
import { DEFAULT_VIEW_MODE } from './types';

const STORAGE_KEY = 'insighta-view-mode';

function isValidViewMode(value: unknown): value is ViewMode {
  return value === 'mandala' || value === 'grid' || value === 'list' || value === 'dashboard';
}

function getInitialMode(searchParams: URLSearchParams): ViewMode {
  const urlView = searchParams.get('view');
  if (isValidViewMode(urlView)) return urlView;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isValidViewMode(stored)) return stored;
  } catch {
    // localStorage unavailable
  }

  return DEFAULT_VIEW_MODE;
}

export function useViewMode() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewModeState] = useState<ViewMode>(() => getInitialMode(searchParams));

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeState(mode);
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        // localStorage unavailable
      }
      setSearchParams(
        (prev) => {
          if (mode === DEFAULT_VIEW_MODE) {
            prev.delete('view');
          } else {
            prev.set('view', mode);
          }
          return prev;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // Sync from URL changes (e.g. browser back/forward)
  useEffect(() => {
    const urlView = searchParams.get('view');
    if (isValidViewMode(urlView) && urlView !== viewMode) {
      setViewModeState(urlView);
      try {
        localStorage.setItem(STORAGE_KEY, urlView);
      } catch {
        // localStorage unavailable
      }
    }
  }, [searchParams, viewMode]);

  return { viewMode, setViewMode } as const;
}
