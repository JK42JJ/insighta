import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/integrations/supabase/client';
import { useAuth } from '@/features/auth/model/useAuth';
import { useCallback, useEffect, useRef } from 'react';
import type {
  UIPreferences,
  UIPreferencesUpdate,
  ScratchPadDockPosition,
  MandalaDockPosition,
  ViewMode,
} from '@/entities/user/model/types';
import { DEFAULT_UI_PREFERENCES } from '@/entities/user/model/types';

const UI_PREFERENCES_QUERY_KEY = 'ui-preferences';
const DEBOUNCE_DELAY = 500; // ms

interface UseUIPreferencesReturn {
  preferences: UIPreferences;
  isLoading: boolean;
  isUpdating: boolean;
  error: Error | null;
  updatePreferences: (updates: UIPreferencesUpdate) => void;
  // Convenience methods for common updates
  setScratchPadFloating: (isFloating: boolean) => void;
  setScratchPadDockPosition: (position: ScratchPadDockPosition) => void;
  setScratchPadPosition: (x: number, y: number) => void;
  setScratchPadSize: (width: number, height: number) => void;
  setMandalaFloating: (isFloating: boolean) => void;
  setMandalaMinimized: (isMinimized: boolean) => void;
  setMandalaDockPosition: (position: MandalaDockPosition) => void;
  setMandalaPosition: (x: number, y: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setListPanelRatio: (ratio: number) => void;
  setMandalaPanelRatio: (ratio: number) => void;
}

/**
 * Hook for managing user UI preferences with Supabase persistence
 *
 * Features:
 * - Fetches preferences from Supabase on mount
 * - Debounced updates to avoid excessive API calls
 * - Optimistic updates for responsive UI
 * - Fallback to defaults when not logged in
 */
export function useUIPreferences(): UseUIPreferencesReturn {
  const { isLoggedIn, user } = useAuth();
  const queryClient = useQueryClient();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdatesRef = useRef<UIPreferencesUpdate>({});
  // Ref to hold stable reference to mutate function (prevents infinite loop)
  const mutateRef = useRef<((updates: UIPreferencesUpdate) => void) | null>(null);

  // Fetch preferences from Supabase
  const {
    data,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: [UI_PREFERENCES_QUERY_KEY, user?.id],
    queryFn: async (): Promise<UIPreferences> => {
      if (!user?.id) {
        return DEFAULT_UI_PREFERENCES;
      }

      const { data, error } = await supabase
        .from('user_ui_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error) {
        // PGRST116 means no rows found - return defaults
        if (error.code === 'PGRST116') {
          return DEFAULT_UI_PREFERENCES;
        }
        // 42P01: table doesn't exist, 404: not found - return defaults silently
        if (error.code === '42P01' || (error as any).status === 404) {
          console.warn('user_ui_preferences table not found, using defaults');
          return DEFAULT_UI_PREFERENCES;
        }
        throw error;
      }

      return data as UIPreferences;
    },
    enabled: isLoggedIn && !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    // Prevent infinite retries on table not found or permission errors
    retry: (failureCount, error: any) => {
      if (error?.code === '42P01' || error?.status === 404 || error?.status === 403 || error?.status === 406) {
        return false;
      }
      return failureCount < 2;
    },
  });

  // Update preferences mutation
  const updateMutation = useMutation({
    mutationFn: async (updates: UIPreferencesUpdate) => {
      if (!user?.id) {
        throw new Error('User not logged in');
      }

      const { error } = await supabase
        .from('user_ui_preferences')
        .upsert(
          {
            user_id: user.id,
            ...updates,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id',
          }
        );

      if (error) throw error;
    },
    // Prevent infinite retries on table not found or permission errors
    retry: (failureCount, error: any) => {
      if (error?.code === '42P01' || error?.status === 404 || error?.status === 403 || error?.status === 406) {
        return false;
      }
      return failureCount < 2;
    },
    onError: (error) => {
      // Log error but don't crash the app - UI continues with local state
      console.warn('Failed to save UI preferences:', error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [UI_PREFERENCES_QUERY_KEY, user?.id],
      });
    },
  });

  // Keep mutateRef in sync with updateMutation.mutate
  // This prevents the infinite loop caused by useMutation creating new object each render
  useEffect(() => {
    mutateRef.current = updateMutation.mutate;
  }, [updateMutation.mutate]);

  // Debounced update function
  const updatePreferences = useCallback(
    (updates: UIPreferencesUpdate) => {
      if (!isLoggedIn || !user?.id) {
        console.warn('Cannot update preferences: user not logged in');
        return;
      }

      // Merge with pending updates
      pendingUpdatesRef.current = {
        ...pendingUpdatesRef.current,
        ...updates,
      };

      // Optimistically update local state
      queryClient.setQueryData(
        [UI_PREFERENCES_QUERY_KEY, user.id],
        (old: UIPreferences | undefined) => ({
          ...(old || DEFAULT_UI_PREFERENCES),
          ...updates,
        })
      );

      // Debounce the API call
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        const updatesToSend = { ...pendingUpdatesRef.current };
        pendingUpdatesRef.current = {};
        // Use ref to avoid dependency on updateMutation (prevents infinite loop)
        mutateRef.current?.(updatesToSend);
      }, DEBOUNCE_DELAY);
    },
    [isLoggedIn, user?.id, queryClient]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        // Flush pending updates on unmount
        if (Object.keys(pendingUpdatesRef.current).length > 0 && user?.id) {
          mutateRef.current?.(pendingUpdatesRef.current);
        }
      }
    };
  }, [user?.id]);

  // Convenience methods
  const setScratchPadFloating = useCallback(
    (isFloating: boolean) => {
      updatePreferences({ scratchpad_is_floating: isFloating });
    },
    [updatePreferences]
  );

  const setScratchPadDockPosition = useCallback(
    (position: ScratchPadDockPosition) => {
      updatePreferences({ scratchpad_dock_position: position });
    },
    [updatePreferences]
  );

  const setScratchPadPosition = useCallback(
    (x: number, y: number) => {
      updatePreferences({
        scratchpad_position_x: x,
        scratchpad_position_y: y,
      });
    },
    [updatePreferences]
  );

  const setScratchPadSize = useCallback(
    (width: number, height: number) => {
      updatePreferences({
        scratchpad_width: width,
        scratchpad_height: height,
      });
    },
    [updatePreferences]
  );

  const setMandalaFloating = useCallback(
    (isFloating: boolean) => {
      updatePreferences({ mandala_is_floating: isFloating });
    },
    [updatePreferences]
  );

  const setMandalaMinimized = useCallback(
    (isMinimized: boolean) => {
      updatePreferences({ mandala_is_minimized: isMinimized });
    },
    [updatePreferences]
  );

  const setMandalaDockPosition = useCallback(
    (position: MandalaDockPosition) => {
      updatePreferences({ mandala_dock_position: position });
    },
    [updatePreferences]
  );

  const setMandalaPosition = useCallback(
    (x: number, y: number) => {
      updatePreferences({
        mandala_position_x: x,
        mandala_position_y: y,
      });
    },
    [updatePreferences]
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      updatePreferences({ view_mode: mode });
    },
    [updatePreferences]
  );

  const setListPanelRatio = useCallback(
    (ratio: number) => {
      updatePreferences({ list_panel_ratio: ratio });
    },
    [updatePreferences]
  );

  const setMandalaPanelRatio = useCallback(
    (ratio: number) => {
      updatePreferences({ mandala_panel_ratio: ratio });
    },
    [updatePreferences]
  );

  return {
    preferences: data || DEFAULT_UI_PREFERENCES,
    isLoading,
    isUpdating: updateMutation.isPending,
    error: queryError as Error | null,
    updatePreferences,
    setScratchPadFloating,
    setScratchPadDockPosition,
    setScratchPadPosition,
    setScratchPadSize,
    setMandalaFloating,
    setMandalaMinimized,
    setMandalaDockPosition,
    setMandalaPosition,
    setViewMode,
    setListPanelRatio,
    setMandalaPanelRatio,
  };
}
