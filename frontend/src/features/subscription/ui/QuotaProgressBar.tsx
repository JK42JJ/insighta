import { useTranslation } from 'react-i18next';
import { Progress } from '@/shared/ui/progress';
import { cn } from '@/lib/utils';

interface QuotaProgressBarProps {
  used: number;
  limit: number;
  className?: string;
}

export function QuotaProgressBar({ used, limit, className }: QuotaProgressBarProps) {
  const { t } = useTranslation();
  const percentage = limit > 0 ? Math.round((used / limit) * 100) : 0;

  const indicatorColor =
    percentage >= 100 ? 'bg-destructive' : percentage >= 66 ? 'bg-yellow-500' : 'bg-emerald-500';

  return (
    <div className={cn('space-y-1', className)}>
      <Progress value={percentage} className="h-2" indicatorClassName={indicatorColor} />
      <p className="text-xs text-muted-foreground">{t('upgrade.quotaUsage', { used, limit })}</p>
    </div>
  );
}
