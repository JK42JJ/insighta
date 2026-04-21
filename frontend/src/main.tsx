import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { reportWebVitals } from '@shared/lib/web-vitals';
import { initAdapters } from '@/entities/content';
import { initCardRenderers } from '@/entities/content';
import { initPostHog } from '@/shared/lib/posthog';

// Initialize registries before rendering
initAdapters();
initCardRenderers();
initPostHog();

if (import.meta.env.DEV) {
  import('@axe-core/react').then((axe) => {
    axe.default(React, ReactDOM, 1000);
  });
}

// Service worker auto-update (Phase 2 re-scoped, 2026-04-22).
//
// VitePWA `registerType: 'autoUpdate'` emits a virtual module that we
// can import lazily to register the worker with `immediate: true`.
// Combined with the workbox `skipWaiting` + `clientsClaim` flags in
// vite.config.ts, a freshly-deployed JS bundle activates on the next
// page navigation (not mid-session), which prevents input loss during
// wizard entry while still guaranteeing no user stays pinned to an
// old cached bundle indefinitely.
//
// DEV imports the no-op stub so hot reload keeps working; the real SW
// only runs in production builds.
if (!import.meta.env.DEV) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
