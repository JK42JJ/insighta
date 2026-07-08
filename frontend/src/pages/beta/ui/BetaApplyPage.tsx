import { useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/shared/lib/api-client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Public closed-beta application page (/beta). Standalone marketing surface —
 * reachable on mobile (mobile-gate allowlist) since most email opens are mobile.
 */
export default function BetaApplyPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      setState('error');
      return;
    }
    setState('submitting');
    try {
      await apiClient.applyForBeta(normalized);
      setState('done');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <span className="inline-block rounded-full border border-border px-3 py-1 text-xs tracking-widest text-muted-foreground">
          CLOSED BETA
        </span>
        <h1 className="mt-6 text-3xl font-bold leading-snug">{t('beta.title')}</h1>
        <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{t('beta.subtitle')}</p>

        {state === 'done' ? (
          <div role="status" className="mt-8 rounded-xl border border-border bg-card px-6 py-8">
            <p className="font-medium">{t('beta.doneTitle')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t('beta.doneDesc')}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (state === 'error') setState('idle');
              }}
              placeholder={t('beta.emailPlaceholder')}
              aria-label={t('beta.emailPlaceholder')}
              className="flex-1 rounded-lg border border-border bg-card px-4 py-3 text-sm outline-none focus:border-ring"
            />
            <button
              type="submit"
              disabled={state === 'submitting'}
              className="rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {state === 'submitting' ? t('beta.submitting') : t('beta.submit')}
            </button>
          </form>
        )}

        {state === 'error' && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {t('beta.error')}
          </p>
        )}

        <p className="mt-6 text-xs text-muted-foreground">{t('beta.note')}</p>
      </div>
    </div>
  );
}
