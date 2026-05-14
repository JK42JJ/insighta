import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBillingSubscription } from '@/features/billing/model/useBillingSubscription';
import { Sparkles } from 'lucide-react';
import { Button } from '@/shared/ui/button';

/**
 * /billing/success — fallback page only.
 *
 * Primary checkout flow uses the Lemon.js overlay (CP456) which fires
 * `Checkout.Success` in-place and never redirects. This route only runs when LS
 * forces a hard redirect (e.g., test mode without overlay, payment method that
 * requires off-site auth). It polls the BE until the webhook lands, then
 * redirects to /.
 *
 * Strings via i18n (`billing.success.*`).
 */
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 30_000;
const SUBLINE_KEYS = [
  'billing.success.subline0',
  'billing.success.subline1',
  'billing.success.subline2',
  'billing.success.subline3',
] as const;

export default function BillingSuccessPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);
  const [subLineIndex, setSubLineIndex] = useState(0);

  const { data } = useBillingSubscription({ refetchInterval: POLL_INTERVAL_MS });

  const isActive =
    data?.subscription?.status === 'ACTIVE' || data?.subscription?.status === 'PAST_DUE';

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsed((t) => t + POLL_INTERVAL_MS);
      setSubLineIndex((i) => (i + 1) % SUBLINE_KEYS.length);
    }, POLL_INTERVAL_MS * 2);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isActive) {
      const timer = window.setTimeout(() => navigate('/', { replace: true }), 1_200);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [isActive, navigate]);

  const timedOut = elapsed >= POLL_TIMEOUT_MS;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-4">
        {isActive ? (
          <>
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">
              {t('billing.success.activeHeading')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('billing.success.activeReturn')}</p>
          </>
        ) : timedOut ? (
          <>
            <h1 className="text-xl font-medium text-foreground">
              {t('billing.success.timedOutTitle')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('billing.success.timedOutDesc')}</p>
            <div className="flex gap-2 justify-center pt-2">
              <Button variant="outline" onClick={() => window.location.reload()}>
                {t('billing.success.refresh')}
              </Button>
              <Button onClick={() => navigate('/subscription', { replace: true })}>
                {t('billing.success.viewPlans')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-medium text-foreground">{t('billing.success.heading')}</h1>
            <p className="text-sm text-muted-foreground">{t(SUBLINE_KEYS[subLineIndex])}</p>
          </>
        )}
      </div>
    </div>
  );
}
