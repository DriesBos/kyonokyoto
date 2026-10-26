import { NextResponse, type NextRequest } from 'next/server';
import {
  CITY_COOKIE,
  cityConfigFor,
  citySupportsLocale,
  defaultLocaleForCity,
  normalizeCity,
} from '@/lib/cities';
import { LOCALE_COOKIE, normalizeLocale } from '@/lib/i18n';
import { routePathFor } from '@/lib/routeState';

// Only the cookie-driven entry redirects (/, /en/, /ja/) run here. City and festival pages read
// nothing per request, so they stay static and cacheable on the CDN.
export function proxy(request: NextRequest) {
  const [segment] = request.nextUrl.pathname.split('/').filter(Boolean);
  const routeLocale = normalizeLocale(segment);
  const city = cityConfigFor(normalizeCity(request.cookies.get(CITY_COOKIE)?.value) ?? 'kyoto')!;
  const requestedLocale = routeLocale ?? normalizeLocale(request.cookies.get(LOCALE_COOKIE)?.value);
  const locale =
    requestedLocale && citySupportsLocale(city, requestedLocale)
      ? requestedLocale
      : defaultLocaleForCity(city);
  const response = NextResponse.redirect(
    new URL(routePathFor({ city: city.slug, locale }), request.url),
    307,
  );
  // The target depends on cookies, so no shared cache may keep it.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: ['/', '/en', '/en/', '/ja', '/ja/'],
};
