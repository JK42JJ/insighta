import { useQuery } from '@tanstack/react-query';
import { apiClient, ApiHttpError } from '@/shared/lib/api-client';
import { useAuthContext } from '@/features/auth/model/AuthContext';

const ADMIN_CHECK_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const MAX_TRANSIENT_RETRIES = 2;
const HTTP_FORBIDDEN = 403;
const HTTP_UNAUTHORIZED = 401;

/**
 * Checks if the current user is a super admin via GET /api/v1/admin/check.
 *
 * Key fix: uses `isPending` instead of `isLoading` to avoid TanStack Query v5
 * timing gap where enabled flips true but data hasn't arrived yet.
 */
export function useAdminCheck() {
  const { user, isTokenReady } = useAuthContext();
  const isEnabled = !!user && isTokenReady;

  const { data, isPending, error } = useQuery({
    queryKey: ['admin', 'check'],
    queryFn: () => apiClient.checkAdminAccess(),
    enabled: isEnabled,
    staleTime: ADMIN_CHECK_STALE_TIME,
    retry: (failureCount, err) => {
      if (err instanceof ApiHttpError && (err.statusCode === HTTP_FORBIDDEN || err.statusCode === HTTP_UNAUTHORIZED)) {
        return false;
      }
      return failureCount < MAX_TRANSIENT_RETRIES;
    },
  });

  if (!isEnabled) {
    return { isAdmin: false, isLoading: !!user, error: null };
  }

  return {
    isAdmin: data?.isAdmin ?? false,
    isLoading: isPending,
    error: error as ApiHttpError | null,
  };
}
