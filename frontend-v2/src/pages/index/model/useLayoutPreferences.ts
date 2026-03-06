import { useState, useEffect, useCallback } from 'react';
import { useUIPreferences } from '@/features/ui-preferences/model/useUIPreferences';
import { useAuth } from '@/features/auth/model/useAuth';

export type DockPosition = 'top' | 'bottom' | 'left' | 'right';
export type MandalaDockPosition = 'left' | 'right';

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
  isMandalaMinimized: boolean;
  isMandalaFloating: boolean;
  isMandalaFloatingMode: boolean;
  mandalaDockPosition: MandalaDockPosition;
  handleSetMandalaMinimized: (minimized: boolean) => void;
  handleSetMandalaFloating: (floating: boolean) => void;
  handleSetMandalaDockPosition: (position: MandalaDockPosition) => void;
  // Mandala position persistence
  prefMandalaPosX: number | undefined;
  prefMandalaPosY: number | undefined;
  setMandalaPosition: (x: number, y: number) => void;
}

/**
 * Manages all UI layout preferences.
 * Syncs local state with Supabase-backed preferences on initial load,
 * then writes back on user changes.
 */
export function useLayoutPreferences(): UseLayoutPreferencesReturn {
  const { isLoggedIn } = useAuth();
  const {
    preferences,
    isLoading: isLoadingPreferences,
    setScratchPadFloating,
    setScratchPadDockPosition: updateScratchPadDockPosition,
    setScratchPadPosition,
    setScratchPadSize,
    setMandalaFloating,
    setMandalaMinimized,
    setMandalaDockPosition: updateMandalaDockPosition,
    setMandalaPosition,
  } = useUIPreferences();

  // Track if initial preferences have been loaded
  const [hasInitializedPreferences, setHasInitializedPreferences] = useState(false);

  // Local state (optimistic, drives UI immediately)
  const [isScratchPadFloating, setIsScratchPadFloatingLocal] = useState(false);
  const [scratchPadDockPosition, setScratchPadDockPositionLocal] = useState<DockPosition>('top');
  const [isMandalaMinimized, setIsMandalaMinimizedLocal] = useState(false);
  const [isMandalaFloating, setIsMandalaFloatingLocal] = useState(false);
  const [isMandalaFloatingMode, setIsMandalaFloatingMode] = useState(false);
  const [mandalaDockPosition, setMandalaDockPositionLocal] = useState<MandalaDockPosition>('left');

  // Extract primitive values to avoid object reference issues in useEffect
  const prefScratchpadFloating = preferences?.scratchpad_is_floating;
  const prefScratchpadDock = preferences?.scratchpad_dock_position;
  const prefScratchpadPosX = preferences?.scratchpad_position_x;
  const prefScratchpadPosY = preferences?.scratchpad_position_y;
  const prefMandalaFloating = preferences?.mandala_is_floating;
  const prefMandalaMinimized = preferences?.mandala_is_minimized;
  const prefMandalaDock = preferences?.mandala_dock_position;
  const prefMandalaPosX = preferences?.mandala_position_x;
  const prefMandalaPosY = preferences?.mandala_position_y;

  // Sync local state with preferences ONLY on initial load
  useEffect(() => {
    if (!hasInitializedPreferences && !isLoadingPreferences && prefMandalaFloating !== undefined) {
      setIsScratchPadFloatingLocal(prefScratchpadFloating ?? false);
      setScratchPadDockPositionLocal((prefScratchpadDock as DockPosition) ?? 'top');
      setIsMandalaMinimizedLocal(prefMandalaMinimized ?? false);
      setIsMandalaFloatingLocal(prefMandalaFloating ?? false);
      setMandalaDockPositionLocal((prefMandalaDock as MandalaDockPosition) ?? 'left');
      setHasInitializedPreferences(true);
    }
  }, [
    isLoadingPreferences,
    prefScratchpadFloating,
    prefScratchpadDock,
    prefMandalaFloating,
    prefMandalaMinimized,
    prefMandalaDock,
    hasInitializedPreferences,
  ]);

  // Floating Mandala mode detection (must match FloatingMandala internal breakpoint)
  useEffect(() => {
    const check = () => {
      setIsMandalaFloatingMode(window.innerHeight < 800 || window.innerWidth < 1024);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Handlers that update both local state and persist to preferences
  const handleSetScratchPadFloating = useCallback(
    (floating: boolean) => {
      setIsScratchPadFloatingLocal(floating);
      if (isLoggedIn) setScratchPadFloating(floating);
    },
    [isLoggedIn, setScratchPadFloating],
  );

  const handleSetScratchPadDockPosition = useCallback(
    (position: DockPosition) => {
      setScratchPadDockPositionLocal(position);
      if (isLoggedIn) updateScratchPadDockPosition(position);
    },
    [isLoggedIn, updateScratchPadDockPosition],
  );

  const handleSetMandalaMinimized = useCallback(
    (minimized: boolean) => {
      setIsMandalaMinimizedLocal(minimized);
      if (isLoggedIn) setMandalaMinimized(minimized);
    },
    [isLoggedIn, setMandalaMinimized],
  );

  const handleSetMandalaFloating = useCallback(
    (floating: boolean) => {
      setIsMandalaFloatingLocal(floating);
      if (isLoggedIn) setMandalaFloating(floating);
    },
    [isLoggedIn, setMandalaFloating],
  );

  const handleSetMandalaDockPosition = useCallback(
    (position: MandalaDockPosition) => {
      setMandalaDockPositionLocal(position);
      if (isLoggedIn) updateMandalaDockPosition(position);
    },
    [isLoggedIn, updateMandalaDockPosition],
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
    isMandalaMinimized,
    isMandalaFloating,
    isMandalaFloatingMode,
    mandalaDockPosition,
    handleSetMandalaMinimized,
    handleSetMandalaFloating,
    handleSetMandalaDockPosition,
    prefMandalaPosX,
    prefMandalaPosY,
    setMandalaPosition,
  };
}
