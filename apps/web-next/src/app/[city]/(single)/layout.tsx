import type { ReactNode } from 'react';
import RootDocument, { rootMetadata, rootViewport } from '@/app/RootDocument';
import { cityConfigFor, defaultLocaleForCity } from '@/lib/cities';

export const metadata = rootMetadata;
export const viewport = rootViewport;

// Root layout for /<city>/ and /<city>/festivals/<slug>/: the single-locale city pages and the
// redirects to /<city>/<locale>/ for cities with more than one locale.
export default async function CityLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ city: string }>;
}) {
  const city = cityConfigFor((await params).city);
  return (
    <RootDocument city={city?.slug ?? 'kyoto'} locale={city ? defaultLocaleForCity(city) : 'en'}>
      {children}
    </RootDocument>
  );
}
