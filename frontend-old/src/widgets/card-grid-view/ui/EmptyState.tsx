import { useTranslation } from 'react-i18next';
import { LayoutGrid, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  type: 'no-cards' | 'no-results';
  onReset?: () => void;
}

export function EmptyState({ type, onReset }: EmptyStateProps) {
  const { t } = useTranslation();

  if (type === 'no-cards') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground gap-4">
        <LayoutGrid className="h-12 w-12 opacity-40" />
        <div className="text-center">
          <p className="text-lg font-medium text-foreground">{t('gridView.emptyTitle')}</p>
          <p className="text-sm mt-1">{t('gridView.emptyDescription')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-[40vh] text-muted-foreground gap-3">
      <Search className="h-10 w-10 opacity-30" />
      <p className="text-sm">{t('gridView.noResults')}</p>
      {onReset && (
        <Button variant="outline" size="sm" onClick={onReset}>
          {t('gridView.resetFilters')}
        </Button>
      )}
    </div>
  );
}
