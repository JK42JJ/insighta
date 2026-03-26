/**
 * Share Mandala Modal — create share links with mode/expiry selection.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { useToast } from '@/shared/lib/use-toast';
import { cn } from '@/shared/lib/utils';
import { Link2, Copy, Check, Trash2, Loader2, ExternalLink } from 'lucide-react';
import { useShareLinks, useCreateShareLink, useDeleteShareLink } from '../model/useSharing';

type ShareMode = 'view' | 'view_cards' | 'clone';

const SHARE_MODES: Array<{ value: ShareMode; label: string; desc: string }> = [
  { value: 'view', label: 'View Only', desc: 'Structure only, card content hidden' },
  { value: 'view_cards', label: 'View + Cards', desc: 'Structure and card titles visible' },
  { value: 'clone', label: 'Clone', desc: 'Recipients can copy to their account' },
];

const EXPIRY_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '0', label: 'Never expires' },
];

interface ShareMandalaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mandalaId: string;
  mandalaTitle: string;
}

export function ShareMandalaModal({ open, onOpenChange, mandalaId, mandalaTitle }: ShareMandalaModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [mode, setMode] = useState<ShareMode>('view');
  const [expiryDays, setExpiryDays] = useState('30');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: existingLinks, isLoading } = useShareLinks(mandalaId);
  const createLink = useCreateShareLink();
  const deleteLink = useDeleteShareLink();

  const handleCreate = async () => {
    try {
      const result = await createLink.mutateAsync({
        mandalaId,
        mode,
        expiresInDays: expiryDays === '0' ? undefined : parseInt(expiryDays),
      });
      await copyToClipboard(result.shareCode);
      toast({ title: t('sharing.linkCreated', 'Share link created and copied') });
    } catch {
      toast({ title: t('sharing.createFailed', 'Failed to create share link'), variant: 'destructive' });
    }
  };

  const copyToClipboard = async (code: string) => {
    const url = `${window.location.origin}/m/${code}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(code);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (shareId: string) => {
    try {
      await deleteLink.mutateAsync({ shareId, mandalaId });
      toast({ title: t('sharing.linkDeleted', 'Share link deleted') });
    } catch {
      toast({ title: t('sharing.deleteFailed', 'Failed to delete'), variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface-mid border-border/50 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            {t('sharing.title', 'Share Mandala')}
          </DialogTitle>
          <DialogDescription>{mandalaTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Create new link */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('sharing.mode', 'Access')}</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as ShareMode)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHARE_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        <span className="font-medium">{m.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t('sharing.expires', 'Expires')}</Label>
                <Select value={expiryDays} onValueChange={setExpiryDays}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {SHARE_MODES.find((m) => m.value === mode)?.desc}
            </p>
            <Button onClick={handleCreate} disabled={createLink.isPending} className="w-full gap-2">
              {createLink.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {t('sharing.createLink', 'Create Share Link')}
            </Button>
          </div>

          {/* Existing links */}
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : existingLinks && existingLinks.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-xs">{t('sharing.existingLinks', 'Active Links')} ({existingLinks.length})</Label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {existingLinks.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-surface-light/50 border border-border/20"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          'text-[10px] font-medium px-1.5 py-0.5 rounded',
                          link.mode === 'clone' ? 'bg-primary/10 text-primary' :
                          link.mode === 'view_cards' ? 'bg-amber-500/10 text-amber-600' :
                          'bg-muted text-muted-foreground'
                        )}>
                          {link.mode}
                        </span>
                        {link.expiresAt && (
                          <span className="text-[10px] text-muted-foreground">
                            expires {new Date(link.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {window.location.origin}/m/{link.shareCode}
                      </p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(link.shareCode)}
                      className="p-1.5 rounded hover:bg-muted/50 transition-colors"
                      title="Copy link"
                    >
                      {copiedId === link.shareCode ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                    <a
                      href={`/m/${link.shareCode}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded hover:bg-muted/50 transition-colors"
                      title="Preview"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    </a>
                    <button
                      onClick={() => handleDelete(link.id)}
                      className="p-1.5 rounded hover:bg-destructive/10 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
