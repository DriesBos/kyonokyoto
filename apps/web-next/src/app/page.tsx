import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  CITY_COOKIE,
  cityConfigFor,
  citySupportsLocale,
  defaultLocaleForCity,
  normalizeCity,
} from '@/lib/cities';
import { LOCALE_COOKIE, normalizeLocale } from '@/lib/i18n';
import { routePathFor } from '@/lib/routeState';

export default async function Home() {
  const store = await cookies();
  const city = normalizeCity(store.get(CITY_COOKIE)?.value) ?? 'kyoto';
  const config = cityConfigFor(city)!;
  const requestedLocale = normalizeLocale(store.get(LOCALE_COOKIE)?.value);
  const locale =
    requestedLocale && citySupportsLocale(config, requestedLocale)
      ? requestedLocale
      : defaultLocaleForCity(config);
  redirect(routePathFor({ city: config.slug, locale }));
}
