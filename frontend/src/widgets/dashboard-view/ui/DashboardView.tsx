import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from 'lucide-react';

export function DashboardView() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground gap-4">
      <LayoutDashboard className="h-12 w-12 opacity-40" />
      <div className="text-center">
        <p className="text-lg font-medium text-foreground">{t('viewMode.dashboard')}</p>
        <p className="text-sm">{t('viewMode.comingSoon')}</p>
      </div>
    </div>
  );
}
