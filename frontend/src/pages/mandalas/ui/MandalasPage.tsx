import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

import { toast } from '@/shared/lib/use-toast';
import {
  useMandalaList,
  useCreateMandala,
  useDeleteMandala,
  useRenameMandala,
  useSwitchMandala,
  useMandalaQuota,
  useToggleMandalaShare,
} from '@/features/mandala';
import { MandalaCardGrid } from './MandalaCardGrid';
import { TemplatesTab } from './TemplatesTab';

type Tab = 'my' | 'templates';

export default function MandalasPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: Tab = searchParams.get('tab') === 'templates' ? 'templates' : 'my';

  const { data: listData, isLoading } = useMandalaList();
  const { data: quotaData } = useMandalaQuota();
  const createMandala = useCreateMandala();
  const deleteMandala = useDeleteMandala();
  const renameMandala = useRenameMandala();
  const switchMandala = useSwitchMandala();
  const toggleShare = useToggleMandalaShare();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [inputValue, setInputValue] = useState('');

  const mandalas = listData?.mandalas ?? [];
  const quotaUsed = quotaData?.used ?? mandalas.length;
  const quotaLimit = quotaData?.limit ?? 3;
  const quotaPercent = quotaLimit > 0 ? Math.min((quotaUsed / quotaLimit) * 100, 100) : 0;

  const setTab = (tab: Tab) => {
    if (tab === 'my') {
      searchParams.delete('tab');
    } else {
      searchParams.set('tab', tab);
    }
    setSearchParams(searchParams, { replace: true });
  };

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

  const handleSetDefault = async (id: string) => {
    const mandala = mandalas.find((m) => m.id === id);
    try {
      await switchMandala.mutateAsync(id);
      toast({
        title: t('mandalas.defaultSet'),
        description: t('mandalas.defaultSetDesc', { title: mandala?.title ?? '' }),
      });
    } catch {
      toast({ title: t('common.error'), variant: 'destructive' });
    }
  };

  const handleToggleShare = async (id: string, isPublic: boolean) => {
    try {
      await toggleShare.mutateAsync({ id, isPublic });
      toast({
        title: isPublic ? t('share.enabled') : t('share.disabled'),
        description: isPublic ? t('share.enabledDesc') : t('share.disabledDesc'),
      });
    } catch {
      toast({ title: t('common.error'), variant: 'destructive' });
    }
  };

  const handleDuplicate = async (id: string) => {
    const mandala = mandalas.find((m) => m.id === id);
    if (!mandala) return;
    try {
      await createMandala.mutateAsync(`${mandala.title} (copy)`);
      toast({
        title: t('mandalas.duplicated'),
        description: t('mandalas.duplicatedDesc', { title: mandala.title }),
      });
    } catch {
      toast({ title: t('mandalaSettings.quotaExceeded'), variant: 'destructive' });
    }
  };

  const openRename = (id: string, currentTitle: string) => {
    setRenameTarget({ id, title: currentTitle });
    setInputValue(currentTitle);
    setRenameDialogOpen(true);
  };

  return (
    <>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t('mandalas.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('mandalas.subtitle')}</p>
          </div>
          <Button
            className="gap-1.5"
            onClick={() => {
              setInputValue('');
              setCreateDialogOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            {t('mandalas.newMandala')}
          </Button>
        </div>

        {/* Quota bar */}
        <div className="mb-6 p-3 rounded-lg bg-surface-mid border border-border/50">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-muted-foreground">{t('mandalaSettings.quota')}</span>
            <span className="text-sm font-medium text-foreground">
              {t('mandalaSettings.quotaDesc', { used: quotaUsed, limit: quotaLimit })}
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-light overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${quotaPercent}%` }}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-border/50">
          <button
            onClick={() => setTab('my')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'my'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('mandalas.tabMyMandalas')}
          </button>
          <button
            onClick={() => setTab('templates')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'templates'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('mandalas.tabTemplates')}
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'my' ? (
          isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <MandalaCardGrid
              mandalas={mandalas}
              onCreateNew={() => {
                setInputValue('');
                setCreateDialogOpen(true);
              }}
              onRename={openRename}
              onDuplicate={handleDuplicate}
              onSetDefault={handleSetDefault}
              onToggleShare={handleToggleShare}
              onDelete={handleDelete}
            />
          )
        ) : (
          <TemplatesTab />
        )}
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
            autoFocus
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
            autoFocus
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
