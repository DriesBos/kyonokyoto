import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import CityEventsPage from '@/app/CityEventsPage';
import { cityConfigFor, cityConfigs, citySupportsLocale, defaultLocaleForCity } from '@/lib/cities';
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

export const revalidate = 300;

export function generateStaticParams() {
  return cityConfigs.flatMap((city) => city.locales.map((locale) => ({ city: city.slug, locale })));
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const state = await routeState(params);
  return state ? buildMetadata({ city: state.city.slug, locale: state.locale }) : {};
}

export async function generateViewport({ params }: RouteProps): Promise<Viewport> {
  const state = await routeState(params);
  return { themeColor: state?.city.themeColor ?? '#d2d3d5', width: 'device-width', initialScale: 1 };
}

export default async function LocaleRoute({ params }: RouteProps) {
  const values = await params;
  const city = cityConfigFor(values.city);
  if (!city) redirect('/kyoto/en/');
  const locale = normalizeLocale(values.locale);
  if (!locale || !citySupportsLocale(city, locale)) {
    redirect(routePathFor({ city: city.slug, locale: defaultLocaleForCity(city) }));
  }
  const state = { city, locale };
  if (state.city.locales.length === 1) redirect(routePathFor({ city: state.city.slug, locale: state.locale }));
  return <CityEventsPage {...state} />;
}
