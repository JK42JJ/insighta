import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/model/useAuth';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Check, Crown, Zap, Star, X, Clock, ExternalLink } from 'lucide-react';
import { toast } from '@/shared/lib/use-toast';
import { useBillingSubscription } from '@/features/billing/model/useBillingSubscription';
import { useCheckoutUrl } from '@/features/billing/model/useCheckoutUrl';
import { useBillingEnabled } from '@/features/billing/model/useBillingEnabled';
import { usePortalUrl } from '@/features/billing/model/usePortalUrl';
import { setupOverlay, openCheckout, closeCheckout } from '@/shared/lib/lemonsqueezy-overlay';
import { queryKeys } from '@/shared/config/query-client';
import { ApiHttpError } from '@/shared/lib/api-client';
import type {
  BillingPlanCode,
  BillingSubscriptionMeResponse,
  BillingTier,
} from '@/shared/lib/api-client';

/**
 * Subscription page — 3-card layout with current-plan integration (CP476+1):
 *   - Top urgency banner (non-LTD users only) — "last chance" framing for LTD pricing.
 *   - Active subscription state is rendered inline on the matching grid card (no
 *     separate SubscriptionStatusCard above the grid — that caused information
 *     duplication; mockup reference: ~/Downloads/subscription_page_redesign.html).
 *   - Current plan card surfaces "현재 이용 중" badge + paid-state label
 *     ("결제 완료 · 평생 유효" / "결제 완료 · 다음 결제일 X") + portal CTA.
 *
 * Strings: all via t(...); see `subscription.*` namespace in locales/{ko,en}.json.
 */

type PlanRow = {
  id: 'free' | 'ltd' | 'pro';
  planCode?: BillingPlanCode;
  nameKey: string;
  price: string;
  originalPrice?: string;
  showPeriod: boolean;
  descriptionKey: string;
  icon: typeof Star;
  featuresKey: string;
  ctaKey: string;
  popular?: boolean;
};

const PLANS: PlanRow[] = [
  {
    id: 'free',
    nameKey: 'subscription.free.name',
    price: '$0',
    showPeriod: true,
    descriptionKey: 'subscription.free.description',
    icon: Star,
    featuresKey: 'subscription.free.features',
    ctaKey: 'subscription.currentPlan',
  },
  {
    id: 'ltd',
    planCode: 'pro_lifetime',
    nameKey: 'subscription.ltd.name',
    price: '$99',
    originalPrice: '$299',
    showPeriod: false,
    descriptionKey: 'subscription.ltd.description',
    icon: Crown,
    featuresKey: 'subscription.ltd.features',
    ctaKey: 'subscription.ltd.buy',
    popular: true,
  },
  {
    id: 'pro',
    planCode: 'pro_monthly',
    nameKey: 'subscription.pro.name',
    price: '$9',
    showPeriod: true,
    descriptionKey: 'subscription.pro.description',
    icon: Zap,
    featuresKey: 'subscription.pro.features',
    ctaKey: 'subscription.pro.buy',
  },
];

const LTD_FEATURES_FALLBACK = [
  'Unlimited mandalas',
  'AI summaries (500/mo)',
  'Playlist sync',
  'Lifetime updates',
  'Priority support',
];

function inferTierFromPlan(planCode: BillingPlanCode | null): BillingTier {
  if (planCode === 'pro_lifetime') return 'lifetime';
  return 'pro';
}

const POLLING_INTERVAL_MS = 5_000;
const POLLING_TIMEOUT_MS = 30_000;

export default function SubscriptionPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { userName } = useAuth();
  const queryClient = useQueryClient();
  const { data: billingData, isLoading: billingLoading } = useBillingSubscription();
  const checkout = useCheckoutUrl();
  const portal = usePortalUrl();
  const { data: flagData } = useBillingEnabled();
  const billingFlagOn = flagData?.enabled === true;
  const billingLocked = !billingFlagOn;
  const [redirecting, setRedirecting] = useState<BillingPlanCode | null>(null);
  const lastPlanRef = useRef<BillingPlanCode | null>(null);
  const autoCheckoutTriggeredRef = useRef(false);

  const currentTier = billingData?.tier ?? 'free';
  const hasActiveSub = !!billingData?.subscription;
  const sub = billingData?.subscription ?? null;
  const showLtdBanner = currentTier !== 'lifetime';

  useEffect(() => {
    const cleanup = setupOverlay((event) => {
      if (event.event !== 'Checkout.Success') return;
      closeCheckout();
      setRedirecting(null);

      const optimisticTier = inferTierFromPlan(lastPlanRef.current);
      queryClient.setQueryData<BillingSubscriptionMeResponse | undefined>(
        queryKeys.billing.me(),
        (prev) => ({
          tier: optimisticTier,
          subscription: prev?.subscription ?? null,
        })
      );
      toast({
        title: t('subscription.toast.checkoutSuccessTitle'),
        description: t('subscription.toast.checkoutSuccessDesc'),
      });

      const startedAt = Date.now();
      let webhookSynced = false;
      const interval = window.setInterval(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.billing.me() }).then(() => {
          const fresh = queryClient.getQueryData<BillingSubscriptionMeResponse>(
            queryKeys.billing.me()
          );
          if (fresh?.subscription) {
            webhookSynced = true;
            window.clearInterval(interval);
          }
        });
        if (Date.now() - startedAt >= POLLING_TIMEOUT_MS) {
          window.clearInterval(interval);
          if (!webhookSynced) {
            toast({
              title: t('subscription.toast.activationDelayedTitle'),
              description: t('subscription.toast.activationDelayedDesc'),
            });
          }
        }
      }, POLLING_INTERVAL_MS);
    });
    return cleanup;
  }, [queryClient, t]);

  const featuresFor = (plan: PlanRow): string[] => {
    const fallback = plan.id === 'ltd' ? LTD_FEATURES_FALLBACK : [];
    return t(plan.featuresKey, { returnObjects: true, defaultValue: fallback }) as string[];
  };

  const handleSelectPlan = async (plan: PlanRow) => {
    if (!plan.planCode) return;
    if (billingLocked) {
      toast({
        title: t('billing.disabled.title'),
        description: t('billing.disabled.desc'),
      });
      return;
    }
    if (currentTier === 'pro' && plan.planCode !== 'pro_lifetime') {
      toast({
        title: t('subscription.toast.alreadyProTitle'),
        description: t('subscription.toast.alreadyProDesc'),
      });
      return;
    }
    if (currentTier === 'lifetime') {
      toast({
        title: t('subscription.toast.lifetimeActiveTitle'),
        description: t('subscription.toast.lifetimeActiveDesc'),
      });
      return;
    }
    setRedirecting(plan.planCode);
    lastPlanRef.current = plan.planCode;
    try {
      const res = await checkout.mutateAsync(plan.planCode);
      openCheckout(res.checkoutUrl);
      setTimeout(() => setRedirecting(null), 1500);
    } catch (err) {
      setRedirecting(null);
      if (
        err instanceof ApiHttpError &&
        err.statusCode === 409 &&
        err.code === 'ALREADY_SUBSCRIBED'
      ) {
        const portalUrl =
          typeof err.details?.['portalUrl'] === 'string'
            ? (err.details['portalUrl'] as string)
            : null;
        toast({
          title: t('subscription.toast.alreadySubscribedTitle'),
          description: t('subscription.toast.alreadySubscribedDesc'),
        });
        if (portalUrl) window.open(portalUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      const message =
        err instanceof Error ? err.message : t('subscription.toast.checkoutFailedDesc');
      toast({
        title: t('subscription.toast.checkoutFailedTitle'),
        description: message,
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (autoCheckoutTriggeredRef.current) return;
    if (billingLoading) return;
    const planParam = searchParams.get('plan');
    const auto = searchParams.get('autoCheckout');
    if (!planParam || auto !== '1') return;
    const target = PLANS.find((p) => p.planCode === (planParam as BillingPlanCode));
    if (!target) return;
    autoCheckoutTriggeredRef.current = true;
    if (billingLocked) {
      navigate('/subscription', { replace: true });
      toast({
        title: t('billing.disabled.title'),
        description: t('billing.disabled.desc'),
      });
      return;
    }
    navigate('/subscription', { replace: true });
    setTimeout(() => {
      handleSelectPlan(target);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingLoading, searchParams]);

  const isCurrent = (plan: PlanRow): boolean => {
    if (plan.id === 'free') return currentTier === 'free';
    if (plan.id === 'ltd') return currentTier === 'lifetime';
    if (plan.id === 'pro') return currentTier === 'pro';
    return false;
  };

  const activeStateLabelFor = (planId: PlanRow['id']): string | null => {
    if (!sub) return null;
    if (planId === 'ltd' && currentTier === 'lifetime') {
      return t('subscription.activeStateLifetime');
    }
    if (planId === 'pro' && currentTier === 'pro' && sub.currentPeriodEnd) {
      const date = new Date(sub.currentPeriodEnd).toLocaleDateString(
        i18n.language === 'ko' ? 'ko-KR' : 'en-US',
        { year: 'numeric', month: 'long', day: 'numeric' }
      );
      return t('subscription.activeStateRecurring', { date });
    }
    return null;
  };

  const onPortal = async () => {
    try {
      const res = await portal.mutateAsync();
      window.open(res.portalUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      // BE returns BILLING_CUSTOMER_NOT_FOUND (404) when the user's row is
      // orphaned in LS (mode mismatch / admin-granted lifetime). Show a
      // distinct, actionable copy instead of a generic retry message.
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
    <div className="container mx-auto px-4 py-6 max-w-4xl relative">
      <button
        type="button"
        aria-label="Close and return to dashboard"
        onClick={() => navigate('/')}
        className="fixed top-4 right-4 z-50 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="text-center mb-4">
        <h1 className="text-2xl font-bold text-foreground mb-2">{t('subscription.title')}</h1>
        <p className="text-muted-foreground">{t('subscription.subtitle')}</p>
        {userName && (
          <p className="text-sm text-muted-foreground mt-1">
            {t('subscription.currentUser', { name: userName })}
          </p>
        )}
      </div>

      {showLtdBanner && (
        <div className="mb-4 max-w-md mx-auto flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2.5 text-sm text-amber-400">
          <Clock className="w-4 h-4 flex-shrink-0" />
          <span>{t('subscription.urgencyBannerLtd')}</span>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        {PLANS.map((plan) => {
          const current = isCurrent(plan);
          const isLoading = !!plan.planCode && redirecting === plan.planCode;
          const lockedForThisPlan = billingLocked && plan.id !== 'free';
          const showCurrentBadge = current && hasActiveSub;
          const showPopularBadge = plan.popular && !showCurrentBadge;
          const showPortalCta = current && hasActiveSub;
          const activeStateLabel = current ? activeStateLabelFor(plan.id) : null;

          const ctaLabel = isLoading
            ? t('subscription.checkoutInProgress')
            : showPortalCta
              ? portal.isPending
                ? t('subscription.checkoutInProgress')
                : t('subscription.managePlanCta')
              : current
                ? t('subscription.currentPlan')
                : lockedForThisPlan
                  ? t('billing.disabled.cta')
                  : t(plan.ctaKey);

          return (
            <Card
              key={plan.id}
              className={`bg-surface-mid border-border/50 relative transition-all duration-200 hover:border-primary/50 ${
                plan.popular || showCurrentBadge ? 'ring-2 ring-primary' : ''
              }`}
            >
              {(showPopularBadge || showCurrentBadge) && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                  {showCurrentBadge
                    ? t('subscription.currentlyUsing')
                    : t('subscription.recommended')}
                </Badge>
              )}
              <CardHeader className="text-center pb-2">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <plan.icon className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{t(plan.nameKey)}</CardTitle>
                <CardDescription>{t(plan.descriptionKey)}</CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <div className="mb-4">
                  {plan.originalPrice && (
                    <span className="text-lg text-muted-foreground line-through mr-2">
                      {plan.originalPrice}
                    </span>
                  )}
                  <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                  {plan.showPeriod && (
                    <span className="text-muted-foreground">/{t('subscription.monthly')}</span>
                  )}
                  {plan.id === 'ltd' && !activeStateLabel && (
                    <p className="text-xs text-primary mt-1 font-medium">
                      {t('subscription.ltd.oneTime')}
                    </p>
                  )}
                  {activeStateLabel && (
                    <p className="text-xs text-primary mt-1 font-medium">{activeStateLabel}</p>
                  )}
                </div>
                <ul className="space-y-3 text-left mb-6">
                  {featuresFor(plan).map((feature, index) => (
                    <li key={index} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
                {showPortalCta ? (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={onPortal}
                    disabled={portal.isPending}
                  >
                    {ctaLabel}
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={current ? 'outline' : 'default'}
                    disabled={current || isLoading || !plan.planCode || lockedForThisPlan}
                    onClick={() => handleSelectPlan(plan)}
                    title={lockedForThisPlan ? t('billing.disabled.desc') : undefined}
                  >
                    {ctaLabel}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center mt-6 max-w-xl mx-auto">
        {t('subscription.footer')}
      </p>
    </div>
  );
}
