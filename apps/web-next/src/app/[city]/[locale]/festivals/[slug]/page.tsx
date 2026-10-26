import type { Metadata, Viewport } from 'next';
import { notFound, redirect } from 'next/navigation';
import FestivalPage from '@/app/FestivalPage';
import { cityConfigFor, citySupportsLocale } from '@/lib/cities';
import { fetchFestivalSlugs } from '@/lib/cityEvents';
import { buildFestivalMetadata } from '@/lib/festivalMetadata';
import { normalizeLocale } from '@/lib/i18n';
import { routePathFor } from '@/lib/routeState';

type RouteProps = { params: Promise<{ city: string; locale: string; slug: string }> };

export const revalidate = 300;

// Known festivals render at build; new ones are cached (ISR) once first rendered, and a failed
// render is never stored.
export async function generateStaticParams() {
  const festivals = await fetchFestivalSlugs().catch(() => []);
  return festivals.flatMap(({ city, slug }) => {
    const config = cityConfigFor(city);
    if (!config || config.locales.length === 1) return [];
    return config.locales.map((locale) => ({ city, locale, slug }));
  });
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const values = await params;
  const city = cityConfigFor(values.city);
  const locale = normalizeLocale(values.locale);
  if (!city || !locale || !citySupportsLocale(city, locale)) return {};
  return buildFestivalMetadata({ city, locale, slug: values.slug });
}

export async function generateViewport({ params }: RouteProps): Promise<Viewport> {
  const city = cityConfigFor((await params).city);
  return {
    themeColor: city?.themeColor ?? '#efefef',
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
  };
}

export default async function FestivalRoute({ params }: RouteProps) {
  const values = await params;
  const city = cityConfigFor(values.city);
  const locale = normalizeLocale(values.locale);
  if (!city || !locale || !citySupportsLocale(city, locale) || !values.slug) notFound();
  if (city.locales.length === 1)
    redirect(
      `${routePathFor({ city: city.slug, locale })}festivals/${encodeURIComponent(values.slug)}/`,
    );
  return <FestivalPage city={city} locale={locale} slug={values.slug} />;
}
