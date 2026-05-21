import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { ExternalLink, CreditCard, ArrowRight } from 'lucide-react';
import { useLocalCardsAsInsight } from '@/features/card-management/model/useLocalCards';
import { useMandalaQuota } from '@/features/mandala/model/useMandalaQuery';
import { useBillingSubscription } from '@/features/billing/model/useBillingSubscription';
import { usePortalUrl } from '@/features/billing/model/usePortalUrl';
import { toast } from '@/shared/lib/use-toast';
import { cn } from '@/shared/lib/utils';
import { ApiHttpError } from '@/shared/lib/api-client';
import type { BillingSubscriptionStatus } from '@/shared/lib/api-client';

const TIER_STYLES: Record<string, string> = {
  admin: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  lifetime: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  pro: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  free: 'bg-muted text-muted-foreground border-border/50',
};

const STATUS_BADGE_VARIANT: Record<
  BillingSubscriptionStatus,
  'default' | 'secondary' | 'destructive'
> = {
  ACTIVE: 'default',
  PAST_DUE: 'destructive',
  CANCELLED: 'secondary',
  PAUSED: 'secondary',
  EXPIRED: 'destructive',
  PENDING: 'secondary',
};

function planLabelKey(planCode: string): string {
  if (planCode === 'pro_yearly') return 'billing.card.planYearly';
  if (planCode === 'pro_lifetime' || planCode === 'lifetime') return 'billing.card.planLifetime';
  return 'billing.card.planMonthly';
}

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
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { subscription } = useLocalCardsAsInsight();
  const { data: mandalaQuota } = useMandalaQuota();
  const { data: billingData } = useBillingSubscription();
  const portal = usePortalUrl();

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

  const billingSub = billingData?.subscription ?? null;
  const showRenewalNote =
    billingSub?.planCode === 'lifetime' || billingSub?.planCode === 'pro_lifetime';

  const onPortal = async () => {
    try {
      const res = await portal.mutateAsync();
      window.open(res.portalUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if (
        err instanceof ApiHttpError &&
        err.statusCode === 404 &&
        err.code === 'BILLING_CUSTOMER_NOT_FOUND'
      ) {
        toast({
          title: t('settings.billing.portalOrphanedTitle'),
          description: t('settings.billing.portalOrphanedDesc'),
          variant: 'destructive',
        });
        return;
      }
      const message = err instanceof Error ? err.message : t('settings.billing.portalErrorDesc');
      toast({
        title: t('settings.billing.portalErrorTitle'),
        description: message,
        variant: 'destructive',
      });
    }
  };

  const onViewPlans = () => navigate('/subscription');

  const periodEnd = billingSub?.currentPeriodEnd ? new Date(billingSub.currentPeriodEnd) : null;
  const periodEndLabel = periodEnd
    ? periodEnd.toLocaleDateString(i18n.language === 'ko' ? 'ko-KR' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;
  const periodEndLabelKey = billingSub?.cancelAtPeriodEnd
    ? 'settings.billing.endingOn'
    : 'settings.billing.nextBilling';

  return (
    <div className="space-y-4">
      <Card className="bg-surface-mid border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">{t('settings.subscription')}</CardTitle>
          <CardDescription>{t('settings.subscriptionDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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

      <Card className="bg-surface-mid border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{t('settings.billing.title')}</CardTitle>
              <CardDescription>{t('settings.billing.desc')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {billingSub ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t(planLabelKey(billingSub.planCode))}
                </span>
                <Badge variant={STATUS_BADGE_VARIANT[billingSub.status]}>
                  {t(`billing.status.${billingSub.status}`)}
                </Badge>
              </div>
              {periodEndLabel && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t(periodEndLabelKey)}</span>
                  <span className="text-foreground font-medium">{periodEndLabel}</span>
                </div>
              )}
              {showRenewalNote && (
                <p className="text-xs text-muted-foreground">
                  {t('settings.billing.lifetimeNote')}
                </p>
              )}
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={onPortal}
                disabled={portal.isPending}
              >
                {portal.isPending
                  ? t('settings.billing.openingPortal')
                  : t('settings.billing.manageButton')}
                <ExternalLink className="w-4 h-4" />
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                {t('settings.billing.portalFooter')}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {t('settings.billing.noSubscriptionDesc')}
              </p>
              <Button variant="outline" className="w-full gap-2" onClick={onViewPlans}>
                {t('settings.billing.viewPlans')}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
