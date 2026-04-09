import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, Pencil, Trash2, Check, Loader2, Globe, Eye } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
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
import { useToast } from '@/shared/lib/use-toast';
import {
  useMandalaList,
  useCreateMandala,
  useDeleteMandala,
  useRenameMandala,
  useSwitchMandala,
  useSubscriptions,
} from '../model/useMandalaQuery';

export function MandalaSelector() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: listData, isLoading } = useMandalaList();
  const { data: subsData } = useSubscriptions();
  const createMutation = useCreateMandala();
  const deleteMutation = useDeleteMandala();
  const renameMutation = useRenameMandala();
  const switchMutation = useSwitchMandala();

  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameId, setRenameId] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState('');
  const [deleteTitle, setDeleteTitle] = useState('');

  const mandalas = listData?.mandalas ?? [];
  const subscriptions = subsData?.subscriptions ?? [];
  const currentMandala = mandalas.find((m) => m.isDefault) ?? mandalas[0];

  const handleCreate = async () => {
    if (!createTitle.trim()) return;
    try {
      await createMutation.mutateAsync(createTitle.trim());
      toast({ title: t('mandalaSettings.created') });
      setCreateOpen(false);
      setCreateTitle('');
    } catch {
      toast({
        title: t('mandalaSettings.quotaExceeded'),
        variant: 'destructive',
      });
    }
  };

  const handleRename = async () => {
    if (!renameTitle.trim() || !renameId) return;
    try {
      await renameMutation.mutateAsync({ id: renameId, title: renameTitle.trim() });
      toast({ title: t('mandalaSettings.renamed') });
      setRenameOpen(false);
    } catch {
      toast({ title: t('common.saveFailed'), variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast({ title: t('mandalaSettings.deleted') });
      setDeleteOpen(false);
    } catch {
      toast({ title: t('mandalaSettings.deleteFailed'), variant: 'destructive' });
    }
  };

  const handleSwitch = async (id: string) => {
    try {
      await switchMutation.mutateAsync(id);
      toast({ title: t('mandalaSettings.switched') });
    } catch {
      toast({ title: t('common.error'), variant: 'destructive' });
    }
  };

  const openRename = (id: string, title: string) => {
    setRenameId(id);
    setRenameTitle(title);
    setRenameOpen(true);
  };

  const openDelete = (id: string, title: string) => {
    setDeleteId(id);
    setDeleteTitle(title);
    setDeleteOpen(true);
  };

  if (isLoading) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t('common.loading')}
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2 max-w-[200px]">
            <span className="truncate">
              {currentMandala?.title ?? t('mandalaSettings.myMandalas')}
            </span>
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {mandalas.map((m) => (
            <DropdownMenuItem
              key={m.id}
              className="flex items-center justify-between gap-2 group"
              onSelect={(e) => {
                e.preventDefault();
                if (!m.isDefault) handleSwitch(m.id);
              }}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {m.isDefault && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                <span className={`truncate ${!m.isDefault ? 'ml-5' : ''}`}>{m.title}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openRename(m.id, m.title);
                  }}
                  className="p-1 hover:bg-accent rounded"
                  aria-label={t('mandalaSettings.rename')}
                >
                  <Pencil className="w-3 h-3" />
                </button>
                {!m.isDefault && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openDelete(m.id, m.title);
                    }}
                    className="p-1 hover:bg-destructive/20 rounded text-destructive"
                    aria-label={t('common.delete')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-2" />
            {t('mandalaSettings.createNew')}
          </DropdownMenuItem>
          {subscriptions.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {t('mandalaSettings.subscribed')}
              </div>
              {subscriptions.map((sub) => (
                <DropdownMenuItem
                  key={sub.id}
                  className="flex items-center gap-2"
                  onSelect={() => sub.shareSlug && navigate(`/explore/${sub.shareSlug}`)}
                >
                  <Eye className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{sub.title}</span>
                  <Globe className="w-3 h-3 text-muted-foreground/50 ml-auto flex-shrink-0" />
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface-mid border-border/50 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('mandalaSettings.createNew')}</DialogTitle>
            <DialogDescription>{t('mandalaSettings.createNewDesc')}</DialogDescription>
          </DialogHeader>
          <Input
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            placeholder={t('mandalaSettings.createTitlePlaceholder')}
            maxLength={50}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!createTitle.trim() || createMutation.isPending}
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {t('common.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="bg-surface-mid border-border/50 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('mandalaSettings.rename')}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            placeholder={t('mandalaSettings.renamePlaceholder')}
            maxLength={50}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleRename}
              disabled={!renameTitle.trim() || renameMutation.isPending}
            >
              {renameMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-surface-mid border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mandalaSettings.deleteConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('mandalaSettings.deleteConfirmDesc', { title: deleteTitle })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
