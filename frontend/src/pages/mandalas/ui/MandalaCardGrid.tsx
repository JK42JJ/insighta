import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { MandalaCard } from './MandalaCard';

interface MandalaInfo {
  id: string;
  title: string;
  isDefault: boolean;
  isPublic: boolean;
  shareSlug?: string | null;
  createdAt: string;
  centerGoal?: string;
  subjects?: string[];
  cardCount?: number;
}

interface MandalaCardGridProps {
  mandalas: MandalaInfo[];
  onCreateNew: () => void;
  onRename: (id: string, currentTitle: string) => void;
  onDuplicate: (id: string) => void;
  onSetDefault: (id: string) => void;
  onToggleShare: (id: string, isPublic: boolean) => void;
  onDelete: (id: string) => void;
}

export function MandalaCardGrid({
  mandalas,
  onCreateNew,
  onRename,
  onDuplicate,
  onSetDefault,
  onToggleShare,
  onDelete,
}: MandalaCardGridProps) {
  const { t } = useTranslation();

  if (mandalas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-lg font-medium text-foreground mb-2">
          {t('mandalas.noMandalas')}
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          {t('mandalas.noMandalasDesc')}
        </p>
        <button
          onClick={onCreateNew}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('mandalaSettings.createNew')}
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {mandalas.map((mandala) => (
        <MandalaCard
          key={mandala.id}
          mandala={mandala}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onSetDefault={onSetDefault}
          onToggleShare={onToggleShare}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
