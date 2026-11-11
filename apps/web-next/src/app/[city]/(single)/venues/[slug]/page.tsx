import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import VenuePage from '@/app/VenuePage';
import { cityConfigFor, defaultLocaleForCity } from '@/lib/cities';
import { buildVenueMetadata } from '@/lib/venueMetadata';

type RouteProps = { params: Promise<{ city: string; slug: string }> };

export const revalidate = 3600;

// Rendered on first request, not at build (CI builds without Supabase); each page is then cached
// (ISR, CDN-tagged city-<slug>), and a failed render is never stored.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const values = await params;
  const city = cityConfigFor(values.city);
  if (!city || city.locales.length !== 1) return {};
  return buildVenueMetadata({
    city,
    locale: defaultLocaleForCity(city),
    slug: values.slug,
  });
}

export default async function VenueRoute({ params }: RouteProps) {
  const values = await params;
  const city = cityConfigFor(values.city);
  if (!city || city.locales.length !== 1 || !values.slug) notFound();
  return <VenuePage city={city} locale={defaultLocaleForCity(city)} slug={values.slug} />;
}
