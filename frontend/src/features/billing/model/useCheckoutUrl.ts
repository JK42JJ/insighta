import { useMutation } from '@tanstack/react-query';
import i18n from 'i18next';
import { apiClient } from '@/shared/lib/api-client';
import type { BillingPlanCode } from '@/shared/lib/api-client';

/**
 * Issue a Lemon Squeezy hosted checkout URL.
 * Caller redirects via `window.location.href = res.checkoutUrl`.
 *
 * Two per-user signals are forwarded so the LS hosted overlay matches the rest
 * of the app:
 *   - `dark` from Tailwind `.dark` class on `<html>` (user's theme toggle)
 *   - `locale` from `i18n.language` (user's language selection)
 */
function detectDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

function detectLocale(): string {
  // i18next exposes the resolved language (e.g., 'ko', 'en', 'ko-KR').
  // LS expects the ISO 2-letter code; strip any region suffix.
  const lang = (i18n.language || 'en').toLowerCase();
  return lang.split('-')[0] || 'en';
}

export function useCheckoutUrl() {
  return useMutation({
    mutationFn: (planCode: BillingPlanCode) =>
      apiClient.createBillingCheckout({
        planCode,
        successUrl: `${window.location.origin}/billing/success`,
        dark: detectDarkMode(),
        locale: detectLocale(),
      }),
  });
}
