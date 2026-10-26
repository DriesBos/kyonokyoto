'use client';

import { useEffect } from 'react';

// Production registers the offline worker; dev removes it so stale caches never mask changes.
export default function ServiceWorker({ register }: { register: boolean }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (register) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Ignore registration failures so the app still loads normally.
      });
      return;
    }

    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
    if ('caches' in window) {
      caches.keys().then((keys) => {
        keys.filter((key) => key.startsWith('kyo-no-kyoto')).forEach((key) => caches.delete(key));
      });
    }
  }, [register]);

  return null;
}
