import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { useLocalCardsAsInsight } from '@/features/card-management/model/useLocalCards';
import { useMandalaQuota } from '@/features/mandala/model/useMandalaQuery';
import { cn } from '@/shared/lib/utils';

const TIER_STYLES: Record<string, string> = {
  admin: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  pro: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  free: 'bg-muted text-muted-foreground border-border/50',
};

function formatQuota(
  used: number,
  limit: number | null,
  t: (key: string, opts?: Record<string, unknown>) => string
) {
  if (limit === null) {
    return {
      display: t('settings.quotaUsed', { count: used }),
      suffix: t('settings.unlimited'),
      showBar: false,
    };
  }
  return { display: `${used} / ${limit}`, suffix: '', showBar: true };
}

function UsageBar({ value, exceeded }: { value: number; exceeded?: boolean }) {
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div
        className={cn(
          'h-full rounded-full transition-all',
          exceeded ? 'bg-destructive' : 'bg-primary'
        )}
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}

export function SubscriptionSettingsTab() {
  const { t } = useTranslation();
  const { subscription } = useLocalCardsAsInsight();
  const { data: mandalaQuota } = useMandalaQuota();

  const cardQuota = formatQuota(subscription.used, subscription.limit, t);
  const cardPercent =
    subscription.limit > 0 ? Math.round((subscription.used / subscription.limit) * 100) : 0;

  const mandalaUsed = mandalaQuota?.used ?? 0;
  const mandalaLimit = mandalaQuota?.limit ?? null;
  const mandalaQuotaFmt = formatQuota(mandalaUsed, mandalaLimit, t);
  const mandalaPercent =
    mandalaLimit !== null && mandalaLimit > 0 ? Math.round((mandalaUsed / mandalaLimit) * 100) : 0;

  const tierKey = subscription.tier?.toLowerCase() ?? 'free';
  const tierStyle = TIER_STYLES[tierKey] ?? TIER_STYLES.free;

  return (
    <Card className="bg-surface-mid border-border/50">
      <CardHeader>
        <CardTitle className="text-lg">{t('settings.subscription')}</CardTitle>
        <CardDescription>{t('settings.subscriptionDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Tier */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">{t('settings.currentTier')}</span>
          <span
            className={cn(
              'text-xs font-bold px-2.5 py-0.5 rounded-full border capitalize',
              tierStyle
            )}
          >
            {subscription.tier}
          </span>
        </div>

        {/* Card Usage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('settings.cardUsage')}</span>
            <span className="text-foreground font-medium">
              {cardQuota.display}
              {cardQuota.suffix && (
                <span className="ml-1.5 text-xs text-muted-foreground">{cardQuota.suffix}</span>
              )}
            </span>
          </div>
          {cardQuota.showBar ? (
            <UsageBar value={cardPercent} />
          ) : (
            <div className="h-2 w-full rounded-full bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />
          )}
        </div>

        {/* Mandala Usage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('settings.mandalaUsage')}</span>
            <span className="text-foreground font-medium">
              {mandalaQuotaFmt.display}
              {mandalaQuotaFmt.suffix && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {mandalaQuotaFmt.suffix}
                </span>
              )}
            </span>
          </div>
          {mandalaQuotaFmt.showBar ? (
            <UsageBar value={mandalaPercent} exceeded={mandalaPercent > 100} />
          ) : (
            <div className="h-2 w-full rounded-full bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
