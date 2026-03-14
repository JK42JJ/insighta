import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Badge } from '@/shared/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Loader2, Pencil, Plus, Trash2, ExternalLink } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/lib/use-toast';
import {
  useMandalaList,
  useCreateMandala,
  useDeleteMandala,
  useRenameMandala,
  useMandalaQuota,
} from '@/features/mandala';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog';

export function MandalaSettingsTab() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [inputValue, setInputValue] = useState('');

  const { data: mandalaListData, isLoading: isListLoading } = useMandalaList();
  const { data: quotaData } = useMandalaQuota();
  const createMandala = useCreateMandala();
  const deleteMandala = useDeleteMandala();
  const renameMandala = useRenameMandala();

  const mandalas = mandalaListData?.mandalas ?? [];

  const handleCreate = async () => {
    if (!inputValue.trim()) return;
    try {
      await createMandala.mutateAsync(inputValue.trim());
      toast({ title: t('mandalaSettings.created') });
      setCreateDialogOpen(false);
      setInputValue('');
    } catch {
      toast({ title: t('mandalaSettings.quotaExceeded'), variant: 'destructive' });
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !inputValue.trim()) return;
    try {
      await renameMandala.mutateAsync({ id: renameTarget.id, title: inputValue.trim() });
      toast({ title: t('mandalaSettings.renamed') });
      setRenameDialogOpen(false);
      setRenameTarget(null);
      setInputValue('');
    } catch {
      toast({ title: t('common.error'), variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMandala.mutateAsync(id);
      toast({ title: t('mandalaSettings.deleted') });
    } catch {
      toast({ title: t('common.error'), variant: 'destructive' });
    }
  };

  const quotaUsed = quotaData?.used ?? mandalas.length;
  const quotaLimit = quotaData?.limit ?? 3;
  const quotaPercent = quotaLimit > 0 ? Math.min((quotaUsed / quotaLimit) * 100, 100) : 0;

  return (
    <>
      <div className="space-y-6">
        <Card className="bg-surface-mid border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">{t('mandalaSettings.myMandalas')}</CardTitle>
                <CardDescription>{t('settings.mandalaDesc')}</CardDescription>
              </div>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setInputValue('');
                  setCreateDialogOpen(true);
                }}
              >
                <Plus className="w-4 h-4" />
                {t('mandalaSettings.createNew')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isListLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : mandalas.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t('mandalaSettings.createNewDesc')}
              </p>
            ) : (
              <div className="rounded-lg border border-border/50 overflow-hidden">
                {mandalas.map((mandala, idx) => (
                  <div
                    key={mandala.id}
                    className={cn(
                      'group flex items-center justify-between px-4 py-3 bg-surface-light hover:bg-muted/30 transition-colors',
                      idx < mandalas.length - 1 && 'border-b border-border/30'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {mandala.title || t('mandala.titleLoading')}
                        </span>
                        {mandala.isDefault && (
                          <Badge variant="secondary" className="text-xs px-1.5 py-0">
                            {t('mandalaSettings.current')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(mandala.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => {
                          setRenameTarget({ id: mandala.id, title: mandala.title });
                          setInputValue(mandala.title);
                          setRenameDialogOpen(true);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {!mandala.isDefault && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-surface-mid border-border/50">
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t('mandalaSettings.deleteConfirm')}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('mandalaSettings.deleteConfirmDesc', {
                                  title: mandala.title,
                                })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-surface-light border-border/50">
                                {t('common.cancel')}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(mandala.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {t('common.delete')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Editor link */}
        <Card
          className="bg-surface-mid border-border/50 cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => navigate('/mandala-settings')}
        >
          <CardContent className="flex items-center gap-3 py-4">
            <ExternalLink className="w-5 h-5 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{t('settings.openEditor')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.openEditorDesc')}</p>
            </div>
          </CardContent>
        </Card>

        {/* Quota */}
        <Card className="bg-surface-mid border-border/50">
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t('mandalaSettings.quota')}</span>
              <span className="text-sm font-medium text-foreground">
                {t('mandalaSettings.quotaDesc', {
                  used: quotaUsed,
                  limit: quotaLimit,
                })}
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-light overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${quotaPercent}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create Mandala Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="bg-surface-mid border-border/50">
          <DialogHeader>
            <DialogTitle>{t('mandalaSettings.createNew')}</DialogTitle>
            <DialogDescription>{t('mandalaSettings.createNewDesc')}</DialogDescription>
          </DialogHeader>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={t('mandalaSettings.createTitlePlaceholder')}
            className="bg-surface-light border-border/50"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              className="border-border/50"
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={!inputValue.trim() || createMandala.isPending}>
              {createMandala.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Mandala Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="bg-surface-mid border-border/50">
          <DialogHeader>
            <DialogTitle>{t('mandalaSettings.rename')}</DialogTitle>
            <DialogDescription>{renameTarget?.title}</DialogDescription>
          </DialogHeader>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={t('mandalaSettings.renamePlaceholder')}
            className="bg-surface-light border-border/50"
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
              className="border-border/50"
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleRename} disabled={!inputValue.trim() || renameMandala.isPending}>
              {renameMandala.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
