import type { Metadata, Viewport } from 'next';
import { notFound, redirect } from 'next/navigation';
import CityEventsPage from '@/app/CityEventsPage';
import { cityConfigFor, cityConfigs, defaultLocaleForCity } from '@/lib/cities';
import { routePathFor } from '@/lib/routeState';
import { buildMetadata } from '@/lib/seo';

type RouteProps = { params: Promise<{ city: string }> };

const cityForParams = async (params: RouteProps['params']) => cityConfigFor((await params).city);

export const revalidate = 300;

export function generateStaticParams() {
  return cityConfigs.map(({ slug: city }) => ({ city }));
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const city = await cityForParams(params);
  return city?.locales.length === 1
    ? buildMetadata({ city: city.slug, locale: defaultLocaleForCity(city) })
    : {};
}

export async function generateViewport({ params }: RouteProps): Promise<Viewport> {
  const city = await cityForParams(params);
  return {
    themeColor: city?.themeColor ?? '#efefef',
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
  };
}

export default async function CityRoute({ params }: RouteProps) {
  // /en/ and /ja/ redirect by cookie in src/proxy.ts, so this page reads nothing per request.
  const city = cityConfigFor((await params).city);
  if (!city) notFound();
  const locale = defaultLocaleForCity(city);
  if (city.locales.length > 1) redirect(routePathFor({ city: city.slug, locale }));
  return <CityEventsPage city={city} locale={locale} />;
}
