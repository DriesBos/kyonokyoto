import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import '@/styles/globals.sass';
import '@/styles/typography.sass';

const gtWalsheim = localFont({
  src: './fonts/GT-Walsheim-Regular.woff2',
  weight: '400',
  style: 'normal',
  display: 'block',
  variable: '--font-gt-walsheim',
});

export const metadata: Metadata = {
  title: 'Kyō no Kyōto',
  applicationName: 'KyōNoKyōto',
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const locale = requestHeaders.get('x-kyo-locale') === 'ja' ? 'ja' : 'en';
  const city = requestHeaders.get('x-kyo-city') ?? 'kyoto';

  return (
    <html
      className={gtWalsheim.variable}
      lang={locale}
      data-city={city}
      data-locale={locale}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
