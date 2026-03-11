/**
 * useYouTubeAuth Hook
 *
 * Manages YouTube OAuth authentication state and operations.
 * Uses Supabase Edge Functions for secure OAuth flow.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffect, useCallback } from 'react';

interface YouTubeAuthStatus {
  isConnected: boolean;
  isExpired: boolean | null;
  expiresAt: string | null;
  syncInterval: string;
  autoSyncEnabled: boolean;
}

interface AuthUrlResponse {
  authUrl: string;
}

// Query Keys
export const youtubeAuthKeys = {
  status: ['youtube', 'auth', 'status'] as const,
};

// Edge Function URL helper
function getEdgeFunctionUrl(action: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  return `${supabaseUrl}/functions/v1/youtube-auth?action=${action}`;
}

// Get auth headers (includes apikey for Kong API Gateway)
async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    'apikey': apiKey,
  };
}

/**
 * Hook to check YouTube OAuth connection status
 */
export function useYouTubeAuthStatus() {
  return useQuery({
    queryKey: youtubeAuthKeys.status,
    queryFn: async (): Promise<YouTubeAuthStatus> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('status'), { headers });

      if (!response.ok) {
        throw new Error('Failed to get auth status');
      }

      return response.json();
    },
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to initiate YouTube OAuth flow
 */
export function useYouTubeConnect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('auth-url'), { headers });

      if (!response.ok) {
        throw new Error('Failed to get auth URL');
      }

      const data: AuthUrlResponse = await response.json();

      // Open OAuth popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        data.authUrl,
        'youtube-auth',
        `width=${width},height=${height},left=${left},top=${top},popup=1`
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }

      // Wait for popup to close or receive success message
      return new Promise((resolve, reject) => {
        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', handleMessage);
            // Don't reject - user might have successfully connected
            resolve();
          }
        }, 500);

        const handleMessage = (event: MessageEvent) => {
          if (event.data?.type === 'youtube-auth-success') {
            clearInterval(checkClosed);
            window.removeEventListener('message', handleMessage);
            popup.close();
            resolve();
          }
        };

        window.addEventListener('message', handleMessage);

        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          if (!popup.closed) {
            popup.close();
          }
          reject(new Error('Authentication timeout'));
        }, 5 * 60 * 1000);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: youtubeAuthKeys.status });
    },
  });
}

/**
 * Hook to disconnect YouTube account
 */
export function useYouTubeDisconnect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('disconnect'), {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to disconnect');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: youtubeAuthKeys.status });
    },
  });
}

/**
 * Hook to refresh YouTube access token
 */
export function useYouTubeRefreshToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('refresh'), {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: youtubeAuthKeys.status });
    },
  });
}

/**
 * Combined hook for YouTube authentication state and actions
 */
export function useYouTubeAuth() {
  const status = useYouTubeAuthStatus();
  const connect = useYouTubeConnect();
  const disconnect = useYouTubeDisconnect();
  const refresh = useYouTubeRefreshToken();

  // Auto-refresh token if expired
  useEffect(() => {
    if (status.data?.isConnected && status.data?.isExpired) {
      refresh.mutate();
    }
  }, [status.data?.isConnected, status.data?.isExpired]);

  const handleConnect = useCallback(() => {
    connect.mutate();
  }, [connect]);

  const handleDisconnect = useCallback(() => {
    disconnect.mutate();
  }, [disconnect]);

  return {
    // Status
    isConnected: status.data?.isConnected ?? false,
    isExpired: status.data?.isExpired ?? null,
    expiresAt: status.data?.expiresAt ? new Date(status.data.expiresAt) : null,
    syncInterval: status.data?.syncInterval ?? 'manual',
    autoSyncEnabled: status.data?.autoSyncEnabled ?? false,

    // Loading states
    isLoading: status.isLoading,
    isConnecting: connect.isPending,
    isDisconnecting: disconnect.isPending,
    isRefreshing: refresh.isPending,

    // Error states
    error: status.error || connect.error || disconnect.error || refresh.error,

    // Actions
    connect: handleConnect,
    disconnect: handleDisconnect,
    refresh: () => refresh.mutate(),
    refetch: status.refetch,
  };
}
