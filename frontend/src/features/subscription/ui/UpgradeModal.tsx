import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Zap } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { cn } from '@/lib/utils';
import { PRICING_TIERS } from '../model/constants';
import { QuotaProgressBar } from './QuotaProgressBar';

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUsed: number;
  currentLimit: number;
}

export function UpgradeModal({ open, onOpenChange, currentUsed, currentLimit }: UpgradeModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleViewPlans = () => {
    onOpenChange(false);
    navigate('/subscription');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface-mid max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-warning" />
            {t('upgrade.title')}
          </DialogTitle>
          <DialogDescription>{t('upgrade.description')}</DialogDescription>
        </DialogHeader>

        <QuotaProgressBar used={currentUsed} limit={currentLimit} />

        <div className="grid gap-3 mt-2">
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.id}
              className={cn(
                'rounded-lg border p-3 flex items-center justify-between',
                tier.highlight ? 'border-primary bg-primary/5' : 'border-border/50'
              )}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{t(tier.nameKey)}</span>
                  {tier.highlight && (
                    <Badge variant="default" className="text-[10px] px-1.5 py-0">
                      {t('upgrade.limitedTime')}
                    </Badge>
                  )}
                  {'badgeKey' in tier && tier.badgeKey && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {t(tier.badgeKey)}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(t(tier.featuresKey, { returnObjects: true }) as string[]).join(' · ')}
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <span className="font-bold">{tier.price}</span>
                <span className="text-xs text-muted-foreground">/{t(tier.periodKey)}</span>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('upgrade.maybeLater')}
          </Button>
          <Button onClick={handleViewPlans}>{t('upgrade.viewPlans')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
