import { useQuery } from '@tanstack/react-query';
import { apiClient, ApiHttpError } from '@/shared/lib/api-client';
import { useAuth } from '@/features/auth/model/useAuth';

/**
 * Is the current user an admin (is_super_admin)?
 * Hits the existing `/api/v1/admin/check` endpoint which returns 200 for
 * admins and 403 otherwise; we treat 403 as a non-error "false" result.
 *
 * Only fires when the user is logged in. For logged-out callers the hook
 * resolves to `{ data: { isAdmin: false } }` without an HTTP round-trip.
 */
export function useIsAdmin() {
  const { isLoggedIn, isTokenReady } = useAuth();
  return useQuery<{ isAdmin: boolean }>({
    queryKey: ['admin', 'check'],
    queryFn: async () => {
      try {
        return await apiClient.checkAdminAccess();
      } catch (err) {
        if (err instanceof ApiHttpError && (err.statusCode === 403 || err.statusCode === 401)) {
          return { isAdmin: false };
        }
        throw err;
      }
    },
    enabled: isLoggedIn && isTokenReady,
    staleTime: 5 * 60_000,
  });
}
