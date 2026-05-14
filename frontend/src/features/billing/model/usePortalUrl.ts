import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';

/**
 * Fetch LS customer portal URL on demand (signed, ~24h validity).
 * Mutation (not Query) because we only call it on user click + want a fresh URL each time.
 * Caller redirects via `window.open(res.portalUrl, '_blank')` or `window.location`.
 */
export function usePortalUrl() {
  return useMutation({
    mutationFn: () => apiClient.getBillingPortalUrl(),
  });
}
