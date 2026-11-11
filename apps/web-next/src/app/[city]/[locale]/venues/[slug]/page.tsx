import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import VenuePage from '@/app/VenuePage';
import { cityConfigFor, citySupportsLocale } from '@/lib/cities';
import { normalizeLocale } from '@/lib/i18n';
import { buildVenueMetadata } from '@/lib/venueMetadata';
import { venuePathFor } from '@/lib/venueRoutes';

type RouteProps = { params: Promise<{ city: string; locale: string; slug: string }> };

export const revalidate = 3600;

// Rendered on first request, not at build (CI builds without Supabase); each page is then cached
// (ISR, CDN-tagged city-<slug>), and a failed render is never stored.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const values = await params;
  const city = cityConfigFor(values.city);
  const locale = normalizeLocale(values.locale);
  if (!city || !locale || !citySupportsLocale(city, locale)) return {};
  return buildVenueMetadata({ city, locale, slug: values.slug });
}

export default async function VenueRoute({ params }: RouteProps) {
  const values = await params;
  const city = cityConfigFor(values.city);
  const locale = normalizeLocale(values.locale);
  if (!city || !locale || !citySupportsLocale(city, locale) || !values.slug) notFound();
  if (city.locales.length === 1) redirect(venuePathFor(city.slug, locale, values.slug));
  return <VenuePage city={city} locale={locale} slug={values.slug} />;
}
