import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';
import { toast } from '@/shared/lib/use-toast';
import { Button } from '@/shared/ui/button';

/**
 * Admin → Billing — CP456 Phase 5 launch gate toggle.
 *
 * Single source of truth lives in `system_settings.billing_enabled` (BE);
 * this page is just a thin write surface on top of `PUT /admin/settings/:key`.
 *
 * On successful toggle we:
 *   1. Optimistically write to the public flag cache so the admin sees the
 *      flip take effect within the same render — no second round-trip needed.
 *   2. Invalidate `billing.featureFlag` so any other open tab / window picks
 *      it up within its 30s stale window.
 */
export function AdminBilling() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // The admin-only read endpoint returns `value: boolean`. We use it instead of
  // the public feature-flag endpoint here so the source of truth is consistent
  // (single setting key, single audit trail). Cache key is admin-scoped so the
  // public hook on /pricing keeps its own 30s cache.
  const settingQuery = useQuery({
    queryKey: ['admin', 'settings', 'billing_enabled'],
    queryFn: () => apiClient.getSystemSetting('billing_enabled'),
    staleTime: 0,
  });

  const currentValue = settingQuery.data?.value === true;

  const toggleMutation = useMutation({
    mutationFn: (next: boolean) => apiClient.setSystemSetting('billing_enabled', next),
    onSuccess: (res) => {
      const next = res.value === true;
      // Public-flag optimistic update so any open /pricing or /subscription
      // tab on this admin's session sees the change immediately.
      queryClient.setQueryData<{ enabled: boolean }>(queryKeys.billing.featureFlag(), {
        enabled: next,
      });
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'billing_enabled'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.featureFlag() });
      toast({
        title: t('admin.billing.savedToast'),
        description: next ? t('admin.billing.enabledDesc') : t('admin.billing.disabledDesc'),
      });
    },
    onError: (err) => {
      toast({
        title: t('admin.billing.errorToast'),
        description: err instanceof Error ? err.message : 'unknown error',
        variant: 'destructive',
      });
    },
  });

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('admin.billing.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('admin.billing.subtitle')}</p>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="font-medium text-foreground">{t('admin.billing.toggleLabel')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('admin.billing.toggleDesc')}</p>
          </div>
          <Button
            variant={currentValue ? 'default' : 'outline'}
            disabled={settingQuery.isLoading || toggleMutation.isPending}
            onClick={() => toggleMutation.mutate(!currentValue)}
            className="min-w-[140px]"
          >
            {currentValue ? (
              <>
                <ToggleRight className="w-4 h-4 mr-2" />
                {t('admin.billing.statusOn')}
              </>
            ) : (
              <>
                <ToggleLeft className="w-4 h-4 mr-2" />
                {t('admin.billing.statusOff')}
              </>
            )}
          </Button>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">{t('admin.billing.behaviorOn')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('admin.billing.behaviorOff')}</p>
        </div>
      </div>

      <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
        <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-yellow-200">
          <p className="font-medium">{t('admin.billing.kycNoteTitle')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('admin.billing.kycNoteDesc')}</p>
        </div>
      </div>
    </div>
  );
}
