import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';
import type { BillingSubscriptionMeResponse } from '@/shared/lib/api-client';

/**
 * Read current user's billing subscription state.
 * Returns `subscription: null` when no active row (free tier).
 * Used by both SubscriptionStatusCard (show plan + portal entry) and /billing/success polling.
 */
export function useBillingSubscription(options?: {
  refetchInterval?: number | false;
  enabled?: boolean;
}) {
  return useQuery<BillingSubscriptionMeResponse>({
    queryKey: queryKeys.billing.me(),
    queryFn: () => apiClient.getMyBillingSubscription(),
    refetchInterval: options?.refetchInterval ?? false,
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}
