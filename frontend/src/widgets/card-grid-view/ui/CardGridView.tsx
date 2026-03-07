import { useTranslation } from 'react-i18next';
import { LayoutGrid } from 'lucide-react';

export function CardGridView() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground gap-4">
      <LayoutGrid className="h-12 w-12 opacity-40" />
      <div className="text-center">
        <p className="text-lg font-medium text-foreground">{t('viewMode.grid')}</p>
        <p className="text-sm">{t('viewMode.comingSoon')}</p>
      </div>
    </div>
  );
}
