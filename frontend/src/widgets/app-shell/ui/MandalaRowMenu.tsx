/**
 * MandalaRowMenu — ChatGPT-style "..." menu on hover for sidebar mandala rows.
 *
 * Reuses dashboard icons (Share2/Archive/Trash2) and the AlertDialog confirm
 * pattern. Trigger uses MoreHorizontal (ChatGPT-style horizontal "...") rather
 * than the dashboard's MoreVertical to match the user-specified sidebar
 * affordance. Share/Archive are
 * placeholders pending BE work — shown disabled with a "준비중 / Coming soon"
 * label. Delete is the only fully wired action; deletion is optimistic via
 * useDeleteMandala (`features/mandala/model/useMandalaQuery.ts`).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal, Share2, Archive, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useDeleteMandala } from '@/features/mandala';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/shared/config/query-client';
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

interface MandalaRowMenuProps {
  mandalaId: string;
  /** True when this is the only remaining mandala — delete is blocked. */
  isLastMandala: boolean;
  /** Called after the delete mutation is fired (synchronously). Parent uses
   * this to auto-select the next mandala in the sorted list. */
  onAfterDelete?: (deletedId: string) => void;
}

export function MandalaRowMenu({ mandalaId, isLastMandala, onAfterDelete }: MandalaRowMenuProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMutation = useDeleteMandala();

  const handleConfirmDelete = () => {
    // Close the confirm dialog immediately for snappy UX. Run the next-mandala
    // auto-select BEFORE the mutate call so subsequent re-renders see the new
    // selectedMandalaId (the deleted row would otherwise stay highlighted while
    // the optimistic cache update is in flight).
    setDeleteOpen(false);
    onAfterDelete?.(mandalaId);
    deleteMutation.mutate(mandalaId, {
      onSuccess: () => {
        // Force a list refetch on top of the hook-level invalidate (defensive
        // against placeholderData / keepPreviousData masking the optimistic
        // filter when invalidate runs).
        queryClient.invalidateQueries({ queryKey: queryKeys.mandala.list() });
        toast.success(t('sidebar.mandalaActions.deleteSuccess', '만다라가 삭제됐어요'));
      },
      onError: () => {
        toast.error(
          t('sidebar.mandalaActions.deleteError', '삭제에 실패했어요. 다시 시도해주세요.')
        );
      },
    });
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('sidebar.mandalaActions.openMenu')}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'shrink-0 rounded p-1 text-sidebar-foreground/60 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground',
              // Hidden until row hover OR menu open OR keyboard focus (focus-visible
              // skips the mouse-click focus state Radix restores on close — that
              // would otherwise keep the icon stuck on after dropdown dismiss).
              menuOpen
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            )}
          >
            <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            disabled
            className="opacity-60 focus:bg-foreground/[0.04] focus:text-foreground"
          >
            <Share2 className="mr-2 h-4 w-4" />
            <span>{t('sidebar.mandalaActions.share')}</span>
            <span className="ml-auto text-[10px] text-muted-foreground/70">
              {t('sidebar.mandalaActions.comingSoon')}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled
            className="opacity-60 focus:bg-foreground/[0.04] focus:text-foreground"
          >
            <Archive className="mr-2 h-4 w-4" />
            <span>{t('sidebar.mandalaActions.archive')}</span>
            <span className="ml-auto text-[10px] text-muted-foreground/70">
              {t('sidebar.mandalaActions.comingSoon')}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={isLastMandala}
            onSelect={(e) => {
              if (isLastMandala) {
                e.preventDefault();
                return;
              }
              setDeleteOpen(true);
            }}
            title={isLastMandala ? t('sidebar.mandalaActions.lastMandalaTooltip') : undefined}
            className={cn(
              !isLastMandala &&
                'text-destructive focus:bg-destructive/10 focus:text-destructive hover:bg-destructive/10',
              isLastMandala && 'opacity-60'
            )}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            <span>{t('sidebar.mandalaActions.delete')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-surface-mid border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.mandalaActions.deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.mandalaActions.deleteConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('sidebar.mandalaActions.deleteConfirm.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('sidebar.mandalaActions.deleteConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
