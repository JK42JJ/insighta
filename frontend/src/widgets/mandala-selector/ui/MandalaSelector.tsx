import { useState } from 'react';
import {
  ChevronDown,
  Plus,
  Star,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  LayoutGrid,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Input } from '@/shared/ui/input';
import { useMandalas, type MandalaListItem } from '@/hooks/useMandalas';
import { useToast } from '@/hooks/use-toast';
import { QuotaProgressBar, TierBadge, UpgradeModal } from '@/features/subscription';

interface MandalaSelectorProps {
  onMandalaChange?: (mandalaId: string) => void;
}

export function MandalaSelector({ onMandalaChange }: MandalaSelectorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const {
    mandalas,
    quota,
    isLoading,
    createMandala,
    isCreating,
    deleteMandala,
    isDeleting,
    setDefaultMandala,
    isSettingDefault,
    renameMandala,
    isRenaming,
  } = useMandalas();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MandalaListItem | null>(null);
  const [renameTarget, setRenameTarget] = useState<MandalaListItem | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);

  const activeMandala = mandalas.find((m) => m.isDefault) ?? mandalas[0];
  const canCreate = quota ? quota.remaining > 0 : true;

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;

    try {
      await createMandala(title);
      setNewTitle('');
      setIsCreateOpen(false);
      toast({ title: t('mandalaSelector.created', { title }) });
    } catch (err: any) {
      toast({
        title: t('mandalaSelector.createFailed'),
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    try {
      await deleteMandala(deleteTarget.id);
      toast({ title: t('mandalaSelector.deleted', { title: deleteTarget.title }) });
      setDeleteTarget(null);
    } catch (err: any) {
      toast({
        title: t('mandalaSelector.deleteFailed'),
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  const handleSetDefault = async (mandala: MandalaListItem) => {
    if (mandala.isDefault) return;

    try {
      await setDefaultMandala(mandala.id);
      onMandalaChange?.(mandala.id);
      toast({ title: t('mandalaSelector.switched', { title: mandala.title }) });
    } catch (err: any) {
      toast({
        title: t('mandalaSelector.switchFailed'),
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const title = renameTitle.trim();
    if (!title || title === renameTarget.title) {
      setRenameTarget(null);
      return;
    }

    try {
      await renameMandala({ mandalaId: renameTarget.id, title });
      toast({ title: t('mandalaSelector.renamed', { title }) });
      setRenameTarget(null);
    } catch (err: any) {
      toast({
        title: t('mandalaSelector.renameFailed'),
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  if (isLoading || mandalas.length === 0) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg hover:bg-surface-light transition-all duration-200 gap-1.5 max-w-[200px]"
          >
            <LayoutGrid className="w-4 h-4 shrink-0" />
            <span className="truncate hidden sm:inline">
              {activeMandala?.title ?? t('mandalaSelector.select')}
            </span>
            {quota && <TierBadge tier={quota.tier} className="hidden sm:inline-flex" />}
            <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 bg-surface-mid border-border/50">
          {mandalas.map((mandala) => (
            <DropdownMenuItem
              key={mandala.id}
              className="gap-2 cursor-pointer hover:bg-surface-light group"
              onClick={() => handleSetDefault(mandala)}
              disabled={isSettingDefault}
            >
              <Star
                className={`w-3.5 h-3.5 shrink-0 ${
                  mandala.isDefault
                    ? 'text-yellow-500 fill-yellow-500'
                    : 'text-muted-foreground opacity-0 group-hover:opacity-50'
                }`}
              />
              <span className="flex-1 truncate text-sm">{mandala.title}</span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenameTarget(mandala);
                    setRenameTitle(mandala.title);
                  }}
                  className="p-1 rounded hover:bg-surface-light"
                  aria-label={t('common.rename')}
                >
                  <Pencil className="w-3 h-3 text-muted-foreground" />
                </button>
                {!mandala.isDefault && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(mandala);
                    }}
                    className="p-1 rounded hover:bg-destructive/10"
                    aria-label={t('common.delete')}
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </button>
                )}
              </div>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator className="bg-border/50" />

          {quota && (
            <div className="px-2 py-1.5">
              <QuotaProgressBar used={quota.used} limit={quota.limit} />
            </div>
          )}

          <DropdownMenuItem
            className="gap-2 cursor-pointer hover:bg-surface-light"
            disabled={isCreating}
            onClick={() => {
              if (!canCreate) {
                setIsUpgradeOpen(true);
              } else {
                setNewTitle('');
                setIsCreateOpen(true);
              }
            }}
          >
            {isCreating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span className="text-sm">{t('mandalaSelector.create')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create Dialog */}
      <AlertDialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <AlertDialogContent className="bg-surface-mid">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mandalaSelector.createTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('mandalaSelector.createDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t('mandalaSelector.titlePlaceholder')}
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCreate} disabled={!newTitle.trim() || isCreating}>
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t('common.create')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="bg-surface-mid">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mandalaSelector.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('mandalaSelector.deleteDescription', { title: deleteTarget?.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Dialog */}
      <AlertDialog open={!!renameTarget} onOpenChange={() => setRenameTarget(null)}>
        <AlertDialogContent className="bg-surface-mid">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mandalaSelector.renameTitle')}</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            placeholder={t('mandalaSelector.titlePlaceholder')}
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
            }}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRename} disabled={!renameTitle.trim() || isRenaming}>
              {isRenaming ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t('common.save')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Upgrade Modal */}
      {quota && (
        <UpgradeModal
          open={isUpgradeOpen}
          onOpenChange={setIsUpgradeOpen}
          currentUsed={quota.used}
          currentLimit={quota.limit}
        />
      )}
    </>
  );
}
