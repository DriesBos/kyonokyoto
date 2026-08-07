import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/styles/globals.sass';
import '@/styles/typography.sass';

export const metadata: Metadata = {
  title: 'Kyo no Kyoto',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
