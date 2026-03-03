import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './ui/toast';
import './global.css';

// Stabilize dynamic viewport height on iOS Safari/WKWebView (keyboard + URL bar)
function syncViewportVars() {
  const vv = window.visualViewport;
  const h = vv?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--tt-app-h', `${Math.round(h)}px`);
}

syncViewportVars();
window.visualViewport?.addEventListener('resize', syncViewportVars);
window.addEventListener('resize', syncViewportVars);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
