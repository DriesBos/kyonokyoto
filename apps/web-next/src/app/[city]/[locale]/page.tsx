import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import CityEventsPage from '@/app/CityEventsPage';
import { cityConfigFor, citySupportsLocale, defaultLocaleForCity } from '@/lib/cities';
import { normalizeLocale } from '@/lib/i18n';
import { routePathFor } from '@/lib/routeState';
import { buildMetadata } from '@/lib/seo';

type RouteProps = { params: Promise<{ city: string; locale: string }> };

const routeState = async (params: RouteProps['params']) => {
  const values = await params;
  const city = cityConfigFor(values.city);
  const locale = normalizeLocale(values.locale);
  return city && locale && citySupportsLocale(city, locale) ? { city, locale } : null;
};

export const revalidate = 3600;

// Rendered on first request, not at build (CI builds without Supabase); each page is then cached
// (ISR, CDN-tagged city-<slug>), and a failed render is never stored.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const state = await routeState(params);
  return state ? buildMetadata({ city: state.city.slug, locale: state.locale }) : {};
}

export default async function LocaleRoute({ params }: RouteProps) {
  const values = await params;
  const city = cityConfigFor(values.city);
  if (!city) notFound();
  const locale = normalizeLocale(values.locale);
  if (!locale || !citySupportsLocale(city, locale)) {
    redirect(routePathFor({ city: city.slug, locale: defaultLocaleForCity(city) }));
  }
  const state = { city, locale };
  if (state.city.locales.length === 1)
    redirect(routePathFor({ city: state.city.slug, locale: state.locale }));
  return <CityEventsPage {...state} />;
}
