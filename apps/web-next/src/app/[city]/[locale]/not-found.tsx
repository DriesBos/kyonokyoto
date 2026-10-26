'use client';

import { useParams } from 'next/navigation';
import NotFoundContent from '@/app/NotFoundContent';
import { normalizeCity } from '@/lib/cities';
import { normalizeLocale } from '@/lib/i18n';

// Missing festivals and other notFound() calls under /<city>/<locale>/, in that city's colours.
export default function LocaleNotFound() {
  const params = useParams<{ city: string; locale: string }>();
  return (
    <NotFoundContent
      city={normalizeCity(params.city) ?? 'kyoto'}
      locale={normalizeLocale(params.locale) ?? undefined}
    />
  );
}
