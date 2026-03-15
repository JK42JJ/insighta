import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { useLocalCardsAsInsight } from '@/features/card-management/model/useLocalCards';
import { useMandalaQuota } from '@/features/mandala/model/useMandalaQuery';

function UsageBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}

export function SubscriptionSettingsTab() {
  const { t } = useTranslation();
  const { subscription } = useLocalCardsAsInsight();
  const { data: mandalaQuota } = useMandalaQuota();

  const cardPercent = subscription.limit > 0
    ? Math.round((subscription.used / subscription.limit) * 100)
    : 0;

  const mandalaUsed = mandalaQuota?.used ?? 0;
  const mandalaLimit = mandalaQuota?.limit ?? subscription.mandalaLimit ?? 3;
  const mandalaPercent = mandalaLimit > 0
    ? Math.round((mandalaUsed / mandalaLimit) * 100)
    : 0;

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
          <Badge variant="outline" className="capitalize">
            {subscription.tier}
          </Badge>
        </div>

        {/* Card Usage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('settings.cardUsage')}</span>
            <span className="text-foreground font-medium">
              {subscription.used} / {subscription.limit}
            </span>
          </div>
          <UsageBar value={cardPercent} />
        </div>

        {/* Mandala Usage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('settings.mandalaUsage')}</span>
            <span className="text-foreground font-medium">
              {mandalaUsed} / {mandalaLimit}
            </span>
          </div>
          <UsageBar value={mandalaPercent} />
        </div>
      </CardContent>
    </Card>
  );
}
