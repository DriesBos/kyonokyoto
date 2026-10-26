import type { ReactNode } from 'react';
import RootDocument, { rootMetadata, rootViewport } from '@/app/RootDocument';
import { normalizeCity } from '@/lib/cities';
import { normalizeLocale } from '@/lib/i18n';

export const metadata = rootMetadata;
export const viewport = rootViewport;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ city: string; locale: string }>;
}) {
  const values = await params;
  return (
    <RootDocument
      city={normalizeCity(values.city) ?? 'kyoto'}
      locale={normalizeLocale(values.locale) ?? 'en'}
    >
      {children}
    </RootDocument>
  );
}
