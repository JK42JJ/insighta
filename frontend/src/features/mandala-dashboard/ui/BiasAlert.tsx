import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';

import type { DashboardFilteredVideo } from '@/shared/types/mandala-ux';

interface BiasAlertProps {
  filteredVideos: DashboardFilteredVideo[];
}

export function BiasAlert({ filteredVideos }: BiasAlertProps) {
  const { t } = useTranslation();

  if (filteredVideos.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-yellow-500/10 bg-card px-4 py-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-yellow-400">
        <ShieldAlert className="h-3.5 w-3.5" />
        {t('dashboard.biasAlert.title')}
      </div>
      {filteredVideos.map((v, i) => (
        <div
          key={i}
          className="flex items-baseline gap-1.5 py-0.5 text-[11px] text-muted-foreground"
        >
          <span className="relative -top-px h-[3px] w-[3px] flex-shrink-0 rounded-full bg-yellow-400" />
          {v.title} -- {v.biasType}
        </div>
      ))}
    </div>
  );
}
