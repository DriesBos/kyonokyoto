import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import GoogleAnalytics from '@/app/GoogleAnalytics';
import LiveFavicon from '@/app/LiveFavicon';
import ServiceWorker from '@/app/ServiceWorker';
import type { AppCity } from '@/lib/cities';
import type { AppLocale } from '@/lib/i18n';
import { siteOrigin } from '@/lib/seo';
import '@/styles/globals.sass';
import '@/styles/typography.sass';

const gtWalsheim = localFont({
  src: './fonts/GT-Walsheim-Regular.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  variable: '--font-gt-walsheim',
});

export const rootMetadata: Metadata = {
  title: 'Kyō no Kyōto',
  applicationName: 'KyōNoKyōto',
  metadataBase: new URL(siteOrigin()),
  robots: { index: true, follow: true },
};

// viewport-fit=cover lets the page run under notches and the home indicator, so the
// env(safe-area-inset-*) paddings in the styles take effect. Pages add their themeColor on top.
export const rootViewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// Shared <html> shell for the root layouts. City and locale come from route params rather than
// request headers, so city and festival pages stay static (ISR) and the Netlify runtime can put
// them on the CDN with their city-<slug> cache tag. A failed render is never cached that way.
export default function RootDocument({
  city,
  locale,
  children,
}: {
  city: AppCity;
  locale: AppLocale;
  children: ReactNode;
}) {
  return (
    <html
      className={gtWalsheim.variable}
      lang={locale}
      data-city={city}
      data-locale={locale}
      suppressHydrationWarning
    >
      <head>
      </head>
      <body>
        {children}
        <LiveFavicon />
        <ServiceWorker register={process.env.NODE_ENV === 'production'} />
        {process.env.NODE_ENV === 'production' && <GoogleAnalytics />}
      </body>
    </html>
  );
}
