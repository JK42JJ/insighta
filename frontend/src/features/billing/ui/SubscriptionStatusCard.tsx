import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { ExternalLink, Crown } from 'lucide-react';
import { usePortalUrl } from '../model/usePortalUrl';
import { toast } from '@/shared/lib/use-toast';
import { ApiHttpError } from '@/shared/lib/api-client';
import type {
  BillingSubscriptionMeResponse,
  BillingSubscriptionStatus,
} from '@/shared/lib/api-client';

/**
 * Active subscription state — plan label, status badge, period_end, portal entry.
 * Portal click → BE fetches LS signed URL → open in new tab.
 *
 * Shown only when `data.subscription` is non-null.
 * All strings via i18n (`billing.card.*`, `billing.status.*`).
 */
export interface SubscriptionStatusCardProps {
  data: BillingSubscriptionMeResponse;
}

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
  if (planCode === 'pro_lifetime') return 'billing.card.planLifetime';
  return 'billing.card.planMonthly';
}

export function SubscriptionStatusCard({ data }: SubscriptionStatusCardProps) {
  const { t, i18n } = useTranslation();
  const portal = usePortalUrl();
  const sub = data.subscription;
  if (!sub) return null;

  const variant = STATUS_BADGE_VARIANT[sub.status];
  const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const periodEndLabel = periodEnd
    ? periodEnd.toLocaleDateString(i18n.language === 'ko' ? 'ko-KR' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;
  const periodEndLabelKey = sub.cancelAtPeriodEnd
    ? 'billing.card.endingOn'
    : 'billing.card.nextBillingDate';

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
          title: t('billing.card.portalOrphanedTitle'),
          description: t('billing.card.portalOrphanedDesc'),
          variant: 'destructive',
        });
        return;
      }
      const message = err instanceof Error ? err.message : t('billing.card.portalErrorDesc');
      toast({
        title: t('billing.card.portalErrorTitle'),
        description: message,
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="bg-card border-border/50">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Crown className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{t(planLabelKey(sub.planCode))}</CardTitle>
              <CardDescription>{t('billing.card.currentSubscription')}</CardDescription>
            </div>
          </div>
          <Badge variant={variant}>{t(`billing.status.${sub.status}`)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground mb-1">{t('billing.card.amount')}</div>
            <div className="font-medium">
              {(sub.amountCents / 100).toLocaleString('en-US', {
                style: 'currency',
                currency: sub.currency || 'USD',
              })}
            </div>
          </div>
          {periodEndLabel && (
            <div>
              <div className="text-muted-foreground mb-1">{t(periodEndLabelKey)}</div>
              <div className="font-medium">{periodEndLabel}</div>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={onPortal}
          disabled={portal.isPending}
        >
          {portal.isPending ? t('billing.card.portalOpening') : t('billing.card.portalCta')}
          <ExternalLink className="w-4 h-4" />
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          {t('billing.card.portalFooter')}
        </p>
      </CardContent>
    </Card>
  );
}
