import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import CityEventsPage from '@/app/CityEventsPage';
import { CITY_COOKIE, cityConfigFor, cityConfigs, defaultLocaleForCity, normalizeCity } from '@/lib/cities';
import { normalizeLocale } from '@/lib/i18n';
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
  return city?.locales.length === 1 ? buildMetadata({ city: city.slug, locale: defaultLocaleForCity(city) }) : {};
}

export async function generateViewport({ params }: RouteProps): Promise<Viewport> {
  const city = await cityForParams(params);
  return { themeColor: city?.themeColor ?? '#d2d3d5', width: 'device-width', initialScale: 1 };
}

export default async function CityRoute({ params }: RouteProps) {
  const { city: value } = await params;
  const routeLocale = normalizeLocale(value);

  if (routeLocale) {
    const store = await cookies();
    const city = cityConfigFor(normalizeCity(store.get(CITY_COOKIE)?.value) ?? 'kyoto')!;
    const locale = city.locales.includes(routeLocale) ? routeLocale : defaultLocaleForCity(city);
    redirect(routePathFor({ city: city.slug, locale }));
  }

  const city = cityConfigFor(value);
  if (!city) redirect('/kyoto/en/');
  const locale = defaultLocaleForCity(city);
  if (city.locales.length > 1) redirect(routePathFor({ city: city.slug, locale }));
  return <CityEventsPage city={city} locale={locale} />;
}
