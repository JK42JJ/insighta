import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { reportWebVitals } from '@shared/lib/web-vitals';
import { initAdapters } from '@/entities/content';
import { initCardRenderers } from '@/entities/content';

// Initialize registries before rendering
initAdapters();
initCardRenderers();

if (import.meta.env.DEV) {
  import('@axe-core/react').then((axe) => {
    axe.default(React, ReactDOM, 1000);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

reportWebVitals();
