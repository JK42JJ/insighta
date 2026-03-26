import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Loader2, Plus, ExternalLink, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/lib/use-toast';
import {
  useMandalaList,
  useCreateMandala,
  useDeleteMandala,
  useRenameMandala,
  useSwitchMandala,
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
  const [inputValue, setInputValue] = useState('');
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const { data: mandalaListData, isLoading: isListLoading } = useMandalaList();
  const { data: quotaData } = useMandalaQuota();
  const createMandala = useCreateMandala();
  const deleteMandala = useDeleteMandala();
  const renameMandala = useRenameMandala();
  const switchMandala = useSwitchMandala();

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

  const handleSetCurrent = async (id: string) => {
    try {
      await switchMandala.mutateAsync(id);
      toast({ title: t('mandalaSettings.currentChanged', 'Default mandala changed') });
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

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await renameMandala.mutateAsync({ id: renameTarget.id, title: renameValue.trim() });
      toast({ title: t('mandalaSettings.renamed', 'Mandala renamed') });
      setRenameTarget(null);
      setRenameValue('');
    } catch {
      toast({ title: t('common.error'), variant: 'destructive' });
    }
  };

  const quotaUsed = quotaData?.used ?? mandalas.length;
  const quotaLimit = quotaData?.limit ?? 3;
  const quotaPercent = quotaLimit > 0 ? Math.min((quotaUsed / quotaLimit) * 100, 100) : 0;
  const isUnlimited = quotaLimit >= 999999;

  /** Extract sector count from root level subjects */
  const getSectorCount = (levels: Array<{ subjects: string[]; depth: number }>) => {
    const root = levels.find((l) => l.depth === 0);
    if (!root) return 0;
    return root.subjects.filter((s) => s.trim()).length;
  };

  return (
    <>
      <div className="space-y-4">
        {/* Header with Create button */}
        <Card className="bg-surface-mid border-border/50">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border/30">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
              </svg>
            </div>
            <h3 className="text-sm font-bold flex-1">{t('mandalaSettings.myMandalas')}</h3>
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => {
                setInputValue('');
                setCreateDialogOpen(true);
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('mandalaSettings.createNew')}
            </Button>
          </div>

          <CardContent className="p-0">
            {isListLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : mandalas.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                {t('mandalaSettings.createNewDesc')}
              </p>
            ) : (
              <>
                {mandalas.map((mandala, idx) => {
                  const sectorCount = getSectorCount(mandala.levels);
                  const centerGoal = mandala.levels.find((l) => l.depth === 0)?.centerGoal;
                  const displayTitle = mandala.title || centerGoal || t('mandala.titleLoading');
                  const updatedDate = new Date(mandala.updatedAt).toLocaleDateString(undefined, {
                    month: 'numeric',
                    day: 'numeric',
                  });

                  return (
                    <div
                      key={mandala.id}
                      onClick={() => !mandala.isDefault && handleSetCurrent(mandala.id)}
                      className={cn(
                        'group flex items-center gap-3.5 px-5 py-3.5 transition-colors cursor-pointer',
                        idx < mandalas.length - 1 && 'border-b border-border/20',
                        'hover:bg-muted/30'
                      )}
                    >
                      {/* Emoji placeholder */}
                      <div className="w-9 h-9 rounded-lg bg-surface-light flex items-center justify-center text-lg shrink-0">
                        {mandala.title?.match(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u)?.[0] || '📋'}
                      </div>

                      {/* Meta */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground truncate">
                            {displayTitle}
                          </span>
                          {mandala.isDefault && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
                              Current
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2.5 mt-0.5 text-xs text-muted-foreground">
                          <span className={cn(sectorCount === 0 && 'text-muted-foreground/50')}>
                            {sectorCount} {t('mandalaSettings.sectors', 'sectors')}
                          </span>
                          <span>·</span>
                          <span>{t('mandalaSettings.updated', 'Updated')} {updatedDate}</span>
                        </div>
                      </div>

                      {/* Action menu */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted/50 transition-all"
                          >
                            <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-surface-mid border-border/50 w-44">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetCurrent(mandala.id);
                            }}
                            disabled={mandala.isDefault}
                            className="text-sm"
                          >
                            {t('mandalaSettings.setAsCurrent', 'Set as Current')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenameTarget({ id: mandala.id, title: displayTitle });
                              setRenameValue(displayTitle);
                            }}
                            className="text-sm"
                          >
                            {t('mandalaSettings.rename', 'Rename')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/mandalas/${mandala.id}/edit`);
                            }}
                            className="text-sm"
                          >
                            {t('mandalaSettings.edit', 'Edit')}
                            <ExternalLink className="w-3 h-3 ml-auto" />
                          </DropdownMenuItem>
                          {!mandala.isDefault && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(mandala.id);
                              }}
                              className="text-sm text-destructive focus:text-destructive"
                            >
                              {t('common.delete')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>

          {/* Quota bar */}
          <div className="px-5 py-3 border-t border-border/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground">{t('mandalaSettings.quota')}</span>
              <span className={cn('text-xs font-bold font-mono', !isUnlimited && quotaUsed > quotaLimit && 'text-destructive')}>
                {quotaUsed} / {isUnlimited ? '∞' : quotaLimit}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-700',
                  !isUnlimited && quotaUsed > quotaLimit
                    ? 'bg-destructive'
                    : 'bg-gradient-to-r from-primary to-primary/70'
                )}
                style={{ width: isUnlimited ? '5%' : `${Math.min(quotaPercent, 100)}%` }}
              />
            </div>
            {!isUnlimited && quotaUsed > quotaLimit && (
              <p className="text-xs text-destructive mt-2">
                {t('mandalaSettings.quotaExceededMsg', "You've exceeded your mandala limit. Upgrade or remove a mandala.")}
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Rename Mandala Dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="bg-surface-mid border-border/50">
          <DialogHeader>
            <DialogTitle>{t('mandalaSettings.rename', 'Rename')}</DialogTitle>
            <DialogDescription>{t('mandalaSettings.renameDesc', 'Enter a new name for this mandala.')}</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder={t('mandalaSettings.createTitlePlaceholder')}
            className="bg-surface-light border-border/50"
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} className="border-border/50">
              {t('common.cancel')}
            </Button>
            <Button onClick={handleRename} disabled={!renameValue.trim() || renameMandala.isPending}>
              {renameMandala.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </>
  );
}
