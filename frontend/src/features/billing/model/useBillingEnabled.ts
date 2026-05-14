import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';

/**
 * Read the public `billing_enabled` flag (CP456 Phase 5).
 * Unauthenticated endpoint — usable from /pricing (logged-out marketing LP) and
 * from /subscription (logged-in). Admins bypass this flag at the BE / FE layer
 * so the toggle they see in the admin panel doesn't lock them out of their own
 * testing.
 */
export function useBillingEnabled() {
  return useQuery<{ enabled: boolean }>({
    queryKey: queryKeys.billing.featureFlag(),
    queryFn: () => apiClient.getBillingFeatureFlag(),
    staleTime: 30_000,
  });
}
