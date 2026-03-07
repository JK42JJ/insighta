import { useTranslation } from 'react-i18next';
import { Sparkles, Crown } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { cn } from '@/lib/utils';

interface TierBadgeProps {
  tier: string;
  className?: string;
}

export function TierBadge({ tier, className }: TierBadgeProps) {
  const { t } = useTranslation();
  const isPro = tier === 'premium' || tier === 'pro';

  return (
    <Badge
      variant={isPro ? 'default' : 'outline'}
      className={cn('gap-1 text-[10px] px-1.5 py-0', className)}
    >
      {isPro ? <Crown className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
      {isPro ? t('upgrade.tierPro') : t('upgrade.tierFree')}
    </Badge>
  );
}
