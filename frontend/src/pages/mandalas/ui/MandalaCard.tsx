import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MoreVertical,
  Pencil,
  Copy,
  Star,
  Share2,
  Trash2,
  Globe,
  Lock,
} from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { MandalaMiniPreview } from '@/widgets/mandala-mini-preview';
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

interface MandalaCardProps {
  mandala: {
    id: string;
    title: string;
    isDefault: boolean;
    isPublic: boolean;
    shareSlug?: string | null;
    createdAt: string;
    centerGoal?: string;
    subjects?: string[];
    cardCount?: number;
  };
  onRename: (id: string, currentTitle: string) => void;
  onDuplicate: (id: string) => void;
  onSetDefault: (id: string) => void;
  onToggleShare: (id: string, isPublic: boolean) => void;
  onDelete: (id: string) => void;
}

export function MandalaCard({
  mandala,
  onRename,
  onDuplicate,
  onSetDefault,
  onToggleShare,
  onDelete,
}: MandalaCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const centerGoal = mandala.centerGoal || mandala.title;
  const subjects = mandala.subjects || [];

  return (
    <>
      <div className="group rounded-xl border border-border/50 bg-card hover:border-primary/40 hover:shadow-lg transition-all duration-200">
        {/* Mini Preview */}
        <div
          className="p-4 cursor-pointer"
          onClick={() => navigate(`/mandalas/${mandala.id}/edit`)}
        >
          <MandalaMiniPreview
            centerGoal={centerGoal}
            subjects={subjects}
            size="md"
          />
        </div>

        {/* Info + Actions */}
        <div className="px-4 pb-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {mandala.title}
              </h3>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <span>{new Date(mandala.createdAt).toLocaleDateString()}</span>
                {mandala.isPublic ? (
                  <span className="flex items-center gap-0.5">
                    <Globe className="w-3 h-3" />
                    {t('mandalas.public')}
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5">
                    <Lock className="w-3 h-3" />
                    {t('mandalas.private')}
                  </span>
                )}
              </div>
            </div>

            {mandala.isDefault && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                {t('mandalas.isDefault')}
              </Badge>
            )}
          </div>

          {/* Action row */}
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => navigate(`/mandalas/${mandala.id}/edit`)}
            >
              <Pencil className="w-3 h-3" />
              {t('mandalas.edit')}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => navigate(`/mandalas/${mandala.id}/edit`)}>
                  <Pencil className="w-4 h-4 mr-2" />
                  {t('mandalas.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRename(mandala.id, mandala.title)}>
                  <Pencil className="w-4 h-4 mr-2" />
                  {t('mandalaSettings.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDuplicate(mandala.id)}>
                  <Copy className="w-4 h-4 mr-2" />
                  {t('mandalas.duplicate')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onToggleShare(mandala.id, !mandala.isPublic)}>
                  <Share2 className="w-4 h-4 mr-2" />
                  {mandala.isPublic ? t('share.disabled') : t('share.enabled')}
                </DropdownMenuItem>
                {!mandala.isDefault && (
                  <DropdownMenuItem onClick={() => onSetDefault(mandala.id)}>
                    <Star className="w-4 h-4 mr-2" />
                    {t('mandalas.setDefault')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {!mandala.isDefault && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {t('common.delete')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-surface-mid border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mandalaSettings.deleteConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('mandalaSettings.deleteConfirmDesc', { title: mandala.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDelete(mandala.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
