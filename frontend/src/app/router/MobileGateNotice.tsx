import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MOBILE_GATE_FLAG_KEY } from '@/shared/lib/mobile-gate';

/**
 * One-line dismissible notice shown on the landing page right after the
 * mobile gate redirected an app route. Self-contained so LandingPage stays
 * untouched.
 */
export function MobileGateNotice() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(() => {
    try {
      return sessionStorage.getItem(MOBILE_GATE_FLAG_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (!visible) return null;

  const dismiss = () => {
    try {
      sessionStorage.removeItem(MOBILE_GATE_FLAG_KEY);
    } catch {
      /* noop */
    }
    setVisible(false);
  };

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[400] flex items-center justify-between gap-3 bg-card px-4 py-3 text-sm text-foreground border-t border-border"
    >
      <span>{t('mobileGate.notice')}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('mobileGate.dismiss')}
        className="shrink-0 rounded px-2 py-1 text-muted-foreground hover:text-foreground"
      >
        ✕
      </button>
    </div>
  );
}
