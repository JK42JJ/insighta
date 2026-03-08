import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { reportWebVitals } from '@shared/lib/web-vitals';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

reportWebVitals();
