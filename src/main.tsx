import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let waitingRegistration: ServiceWorkerRegistration | undefined;
  let reloadRequested = false;
  const notifyUpdate = (registration: ServiceWorkerRegistration) => {
    if (!registration.waiting) return;
    waitingRegistration = registration;
    window.dispatchEvent(new CustomEvent('app-update-ready', { detail: { registration } }));
  };
  window.addEventListener('app-check-update', () => {
    if (waitingRegistration) notifyUpdate(waitingRegistration);
  });
  window.addEventListener('app-apply-update', () => {
    if (!waitingRegistration?.waiting) return;
    reloadRequested = true;
    waitingRegistration.waiting.postMessage('SKIP_WAITING');
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).then(registration => {
      notifyUpdate(registration);
      const watchInstalling = () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate(registration);
        });
      };
      registration.addEventListener('updatefound', watchInstalling);
      watchInstalling();
    }).catch(() => {
      console.warn('离线缓存未启用，联网使用和本地记录不受影响。');
    });
  });
}
