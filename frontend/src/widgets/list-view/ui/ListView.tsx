import { useTranslation } from 'react-i18next';
import { List } from 'lucide-react';

export function ListView() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground gap-4">
      <List className="h-12 w-12 opacity-40" />
      <div className="text-center">
        <p className="text-lg font-medium text-foreground">{t('viewMode.list')}</p>
        <p className="text-sm">{t('viewMode.comingSoon')}</p>
      </div>
    </div>
  );
}
