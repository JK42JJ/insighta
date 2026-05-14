import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/model/useAuth';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Check, Crown, Zap, Star, X } from 'lucide-react';
import { toast } from '@/shared/lib/use-toast';
import { useBillingSubscription } from '@/features/billing/model/useBillingSubscription';
import { useCheckoutUrl } from '@/features/billing/model/useCheckoutUrl';
import { useBillingEnabled } from '@/features/billing/model/useBillingEnabled';
import { SubscriptionStatusCard } from '@/features/billing/ui/SubscriptionStatusCard';
import { setupOverlay, openCheckout, closeCheckout } from '@/shared/lib/lemonsqueezy-overlay';
import { queryKeys } from '@/shared/config/query-client';
import { ApiHttpError } from '@/shared/lib/api-client';
import type {
  BillingPlanCode,
  BillingSubscriptionMeResponse,
  BillingTier,
} from '@/shared/lib/api-client';

/**
 * Subscription page — 3-card layout (Free / Pioneer Lifetime / Pro) with LS billing wiring.
 *
 * Design: preserved from prior prod design — Card + Badge + Crown/Zap/Star + Recommended
 * + ✓ feature list + urgency footer. CP456 wires `handleSelectPlan` to the LS hosted
 * checkout opened as an **in-page overlay** (Lemon.js, never leaves insighta.one).
 *
 * Strings: all via `t(...)` (i18n) — see `subscription.*` namespace in locales/{ko,en}.json.
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

/**
 * Map planCode → optimistic tier for setQueryData after Checkout.Success.
 * Lets the UI flip "Subscribe to Pro" → "Current Plan" instantly even when the
 * webhook hasn't landed yet (e.g., local dev without a tunnel). The eventual
 * webhook-driven invalidation overwrites this with authoritative server data.
 */
function inferTierFromPlan(planCode: BillingPlanCode | null): BillingTier {
  if (planCode === 'pro_lifetime') return 'lifetime';
  return 'pro';
}

const POLLING_INTERVAL_MS = 5_000;
const POLLING_TIMEOUT_MS = 30_000;

export default function SubscriptionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { userName } = useAuth();
  const queryClient = useQueryClient();
  const { data: billingData, isLoading: billingLoading } = useBillingSubscription();
  const checkout = useCheckoutUrl();
  // CP456 Phase 5 (strict gate): flag=false → CTA disabled for everyone,
  // admins included. Admins flip the flag from /admin/billing first.
  const { data: flagData } = useBillingEnabled();
  const billingFlagOn = flagData?.enabled === true;
  const billingLocked = !billingFlagOn;
  const [redirecting, setRedirecting] = useState<BillingPlanCode | null>(null);
  const lastPlanRef = useRef<BillingPlanCode | null>(null);
  const autoCheckoutTriggeredRef = useRef(false);

  const currentTier = billingData?.tier ?? 'free';
  const hasActiveSub = !!billingData?.subscription;

  // Register LS overlay event handler. Checkout.Success flow:
  //   1. Close the overlay + cleanup loader DOM.
  //   2. Optimistically set `billing.me` cache to the matching tier so the page
  //      reflects the new plan immediately (webhook may take seconds to land,
  //      or in local dev without a tunnel may never land — see project_prod_architecture).
  //   3. Start a 30s polling window (every 5s) to invalidate the cache; webhook
  //      arrival overrides the optimistic value with server truth. If polling
  //      times out without server data catching up, surface an "activation
  //      delayed" toast so the user understands the delay is expected.
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
          // Webhook landed → server data has subscription row.
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
      // setRedirecting cleared by Checkout.Success event OR manual close.
      // Reset after a short delay in case the user closes the overlay without buying.
      setTimeout(() => setRedirecting(null), 1500);
    } catch (err) {
      setRedirecting(null);
      // ALREADY_SUBSCRIBED: BE-side preflight detected an active LS subscription
      // (webhook may not have synced to local DB). Open the portal URL provided
      // in the error details instead of letting the user open a stuck checkout.
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

  // Auto-checkout on landing from /pricing (or any deep link): when the URL
  // carries `?plan=<code>&autoCheckout=1` and the user does not yet have that
  // tier, fire handleSelectPlan once. Strips the query immediately so a refresh
  // or in-app navigation does not re-trigger an infinite loop.
  useEffect(() => {
    if (autoCheckoutTriggeredRef.current) return;
    if (billingLoading) return; // wait for tier resolution
    const planParam = searchParams.get('plan');
    const auto = searchParams.get('autoCheckout');
    if (!planParam || auto !== '1') return;
    const target = PLANS.find((p) => p.planCode === (planParam as BillingPlanCode));
    if (!target) return;
    autoCheckoutTriggeredRef.current = true;
    // Strip query first to avoid loop, then surface the disabled-feature toast.
    if (billingLocked) {
      navigate('/subscription', { replace: true });
      toast({
        title: t('billing.disabled.title'),
        description: t('billing.disabled.desc'),
      });
      return;
    }
    // Strip query before triggering (replace, no history entry).
    navigate('/subscription', { replace: true });
    // Defer one tick so navigate completes before opening the overlay.
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

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl relative">
      {/* Close → back to dashboard. Mirrors the X button on the LS checkout overlay
          so the user has a consistent escape affordance throughout the billing flow. */}
      <button
        type="button"
        aria-label="Close and return to dashboard"
        onClick={() => navigate('/')}
        className="fixed top-4 right-4 z-50 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-2">{t('subscription.title')}</h1>
        <p className="text-muted-foreground">{t('subscription.subtitle')}</p>
        {userName && (
          <p className="text-sm text-muted-foreground mt-1">
            {t('subscription.currentUser', { name: userName })}
          </p>
        )}
      </div>

      {hasActiveSub && billingData && (
        <div className="mb-8 max-w-md mx-auto">
          <SubscriptionStatusCard data={billingData} />
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        {PLANS.map((plan) => {
          const current = isCurrent(plan);
          const isLoading = !!plan.planCode && redirecting === plan.planCode;
          // Paid plans gate behind the launch flag. Free stays clickable as it's not a checkout.
          const lockedForThisPlan = billingLocked && plan.id !== 'free';
          const ctaLabel = isLoading
            ? t('subscription.checkoutInProgress')
            : current
              ? t('subscription.currentPlan')
              : lockedForThisPlan
                ? t('billing.disabled.cta')
                : t(plan.ctaKey);
          return (
            <Card
              key={plan.id}
              className={`bg-surface-mid border-border/50 relative transition-all duration-200 hover:border-primary/50 ${
                plan.popular ? 'ring-2 ring-primary' : ''
              }`}
            >
              {plan.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                  {t('subscription.recommended')}
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
                <div className="mb-6">
                  {plan.originalPrice && (
                    <span className="text-lg text-muted-foreground line-through mr-2">
                      {plan.originalPrice}
                    </span>
                  )}
                  <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                  {plan.showPeriod && (
                    <span className="text-muted-foreground">/{t('subscription.monthly')}</span>
                  )}
                  {plan.id === 'ltd' && (
                    <p className="text-xs text-primary mt-1 font-medium">
                      {t('subscription.ltd.oneTime')}
                    </p>
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
                <Button
                  className="w-full"
                  variant={current ? 'outline' : 'default'}
                  disabled={current || isLoading || !plan.planCode || lockedForThisPlan}
                  onClick={() => handleSelectPlan(plan)}
                  title={lockedForThisPlan ? t('billing.disabled.desc') : undefined}
                >
                  {ctaLabel}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-center text-sm text-muted-foreground mt-6">{t('subscription.urgency')}</p>

      <p className="text-xs text-muted-foreground text-center mt-8 max-w-xl mx-auto">
        {t('subscription.footer')}
      </p>
    </div>
  );
}
