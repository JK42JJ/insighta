import { useState, useEffect, useCallback } from 'react';
import { useUIPreferences } from '@/features/ui-preferences/model/useUIPreferences';
import { useAuth } from '@/features/auth/model/useAuth';

import type { ViewMode } from '@/entities/user/model/types';

export type DockPosition = 'top' | 'bottom' | 'left' | 'right';

interface UseLayoutPreferencesReturn {
  // Scratch pad
  isScratchPadFloating: boolean;
  scratchPadDockPosition: DockPosition;
  handleSetScratchPadFloating: (floating: boolean) => void;
  handleSetScratchPadDockPosition: (position: DockPosition) => void;
  // Scratch pad position persistence
  prefScratchpadPosX: number | undefined;
  prefScratchpadPosY: number | undefined;
  setScratchPadPosition: (x: number, y: number) => void;
  setScratchPadSize: (w: number, h: number) => void;
  // Mandala
  mandalaPanelRatio: number;
  handleSetMandalaPanelRatio: (ratio: number) => void;
  // View mode
  viewMode: ViewMode;
  listPanelRatio: number;
  gridColumns: number;
  handleSetViewMode: (mode: ViewMode) => void;
  handleSetListPanelRatio: (ratio: number) => void;
  handleSetGridColumns: (columns: number) => void;
}

export function useLayoutPreferences(): UseLayoutPreferencesReturn {
  const { isLoggedIn } = useAuth();
  const {
    preferences,
    isLoading: isLoadingPreferences,
    setScratchPadFloating,
    setScratchPadDockPosition: updateScratchPadDockPosition,
    setScratchPadPosition,
    setScratchPadSize,
    setMandalaPanelRatio,
    setViewMode,
    setListPanelRatio,
    setGridColumns,
  } = useUIPreferences();

  const [hasInitializedPreferences, setHasInitializedPreferences] = useState(false);

  // Local state (optimistic, drives UI immediately)
  const [isScratchPadFloating, setIsScratchPadFloatingLocal] = useState(false);
  const [scratchPadDockPosition, setScratchPadDockPositionLocal] = useState<DockPosition>('top');
  const [mandalaPanelRatio, setMandalaPanelRatioLocal] = useState(30);
  const [viewMode, setViewModeLocal] = useState<ViewMode>('grid');
  const [listPanelRatio, setListPanelRatioLocal] = useState(40);
  const [gridColumns, setGridColumnsLocal] = useState(() => {
    const cached = localStorage.getItem('insighta-grid-columns');
    return cached ? Number(cached) : 4;
  });

  // Extract primitive values to avoid object reference issues in useEffect
  const prefScratchpadFloating = preferences?.scratchpad_is_floating;
  const prefScratchpadDock = preferences?.scratchpad_dock_position;
  const prefScratchpadPosX = preferences?.scratchpad_position_x;
  const prefScratchpadPosY = preferences?.scratchpad_position_y;
  const prefMandalaPanelRatio = preferences?.mandala_panel_ratio;
  const prefViewMode = preferences?.view_mode;
  const prefListPanelRatio = preferences?.list_panel_ratio;
  const prefGridColumns = preferences?.grid_columns;

  // Sync local state with preferences ONLY on initial load
  useEffect(() => {
    if (
      !hasInitializedPreferences &&
      !isLoadingPreferences &&
      prefScratchpadFloating !== undefined
    ) {
      setIsScratchPadFloatingLocal(prefScratchpadFloating ?? false);
      setScratchPadDockPositionLocal((prefScratchpadDock as DockPosition) ?? 'top');
      setMandalaPanelRatioLocal(prefMandalaPanelRatio ?? 30);
      setViewModeLocal((prefViewMode as ViewMode) ?? 'grid');
      setListPanelRatioLocal(prefListPanelRatio ?? 40);
      const cachedGridCols = localStorage.getItem('insighta-grid-columns');
      setGridColumnsLocal(prefGridColumns ?? (cachedGridCols ? Number(cachedGridCols) : 4));
      setHasInitializedPreferences(true);
    }
  }, [
    isLoadingPreferences,
    prefScratchpadFloating,
    prefScratchpadDock,
    prefMandalaPanelRatio,
    prefViewMode,
    prefListPanelRatio,
    prefGridColumns,
    hasInitializedPreferences,
  ]);

  // Handlers that update both local state and persist to preferences
  const handleSetScratchPadFloating = useCallback(
    (floating: boolean) => {
      setIsScratchPadFloatingLocal(floating);
      if (isLoggedIn) setScratchPadFloating(floating);
    },
    [isLoggedIn, setScratchPadFloating]
  );

  const handleSetScratchPadDockPosition = useCallback(
    (position: DockPosition) => {
      setScratchPadDockPositionLocal(position);
      if (isLoggedIn) updateScratchPadDockPosition(position);
    },
    [isLoggedIn, updateScratchPadDockPosition]
  );

  const handleSetMandalaPanelRatio = useCallback(
    (ratio: number) => {
      setMandalaPanelRatioLocal(ratio);
      if (isLoggedIn) setMandalaPanelRatio(ratio);
    },
    [isLoggedIn, setMandalaPanelRatio]
  );

  const handleSetViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeLocal(mode);
      if (isLoggedIn) setViewMode(mode);
    },
    [isLoggedIn, setViewMode]
  );

  const handleSetListPanelRatio = useCallback(
    (ratio: number) => {
      setListPanelRatioLocal(ratio);
      if (isLoggedIn) setListPanelRatio(ratio);
    },
    [isLoggedIn, setListPanelRatio]
  );

  const handleSetGridColumns = useCallback(
    (columns: number) => {
      setGridColumnsLocal(columns);
      localStorage.setItem('insighta-grid-columns', String(columns));
      if (isLoggedIn) setGridColumns(columns);
    },
    [isLoggedIn, setGridColumns]
  );

  return {
    isScratchPadFloating,
    scratchPadDockPosition,
    handleSetScratchPadFloating,
    handleSetScratchPadDockPosition,
    prefScratchpadPosX,
    prefScratchpadPosY,
    setScratchPadPosition,
    setScratchPadSize,
    mandalaPanelRatio,
    handleSetMandalaPanelRatio,
    viewMode,
    listPanelRatio,
    gridColumns,
    handleSetViewMode,
    handleSetListPanelRatio,
    handleSetGridColumns,
  };
}
