import type { MetadataRoute } from 'next';

import { LIGHT_BACKGROUND } from '@/lib/colorScheme';

// Served at /manifest.webmanifest; Next adds the <link rel="manifest"> to every page.
// A manifest over HTTPS is what Chrome/Edge/Android need to offer "Install app" (no service
// worker requirement). theme_color only colours the installed window / splash: the pages
// themselves keep no theme-color meta so the iOS status bar stays transparent.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Kyō-no-Kyōto',
    short_name: 'KyōNoKyōto',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: LIGHT_BACKGROUND,
    theme_color: LIGHT_BACKGROUND,
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/android-chrome-192x192-maskable.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/android-chrome-512x512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
