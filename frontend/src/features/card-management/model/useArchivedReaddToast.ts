/**
 * useArchivedReaddToast — surface a toast when the user re-adds a video that
 * is currently archived for this (user, video, mandala). The BE rejects the
 * re-add with HTTP 409 + code 'ALREADY_ARCHIVED' (no re-insert); this hook
 * returns a notifier that shows the message plus a one-tap "Restore" action
 * wired to the existing unarchive mutation.
 *
 * Uses sonner's `toast` directly (NOT the shared use-toast adapter, which
 * drops the `action` button).
 */

import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useArchiveCard } from './useArchiveCard';

export function useArchivedReaddToast() {
  const { unarchive } = useArchiveCard();
  const { t } = useTranslation();

  return (videoId: string) => {
    toast(t('cards.alreadyArchived'), {
      action: {
        label: t('cards.restore'),
        onClick: () => unarchive.mutate(videoId),
      },
    });
  };
}
