/**
 * MandalaRowMenu — ChatGPT-style "..." menu on hover for sidebar mandala rows.
 *
 * Reuses dashboard icons (Share2/Archive/Trash2) and the AlertDialog confirm
 * pattern. Trigger uses MoreHorizontal (horizontal "...") rather than the
 * dashboard's MoreVertical to match the user-specified sidebar affordance.
 * Share/Archive are placeholders pending BE work — shown disabled with a
 * "준비중 / Coming soon" label.
 *
 * Delete itself is owned by the PARENT (SidebarMandalaSection) — see
 * onConfirmDelete. Hosting the mutation in the parent keeps its useMutation
 * observer alive when the row unmounts via the local deletingIds mask, so
 * the success/error toast still fires.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Share2, Archive, Trash2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
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
  /** Parent-hosted delete handler. Called on AlertDialog confirm with the
   * mandala id. The parent runs the mutation + toast + optimistic mask. */
  onConfirmDelete: (mandalaId: string) => void;
}

export function MandalaRowMenu({ mandalaId, isLastMandala, onConfirmDelete }: MandalaRowMenuProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
              onClick={() => {
                setDeleteOpen(false);
                onConfirmDelete(mandalaId);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('sidebar.mandalaActions.deleteConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
