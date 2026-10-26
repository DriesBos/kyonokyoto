import { NextResponse, type NextRequest } from 'next/server';
import { cachedCityPagePath, cityPageCacheHeaders } from '@/lib/cdnCache';
import { normalizeCity } from '@/lib/cities';
import { normalizeLocale } from '@/lib/i18n';

export function proxy(request: NextRequest) {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const city = normalizeCity(segments[0]) ?? 'kyoto';
  const locale = normalizeLocale(segments[1]) ?? normalizeLocale(segments[0]) ?? 'en';
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-kyo-city', city);
  requestHeaders.set('x-kyo-locale', locale);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  const cachedCity = cachedCityPagePath(request.nextUrl.pathname);
  if (cachedCity) {
    for (const [name, value] of Object.entries(
      cityPageCacheHeaders(cachedCity.slug, cachedCity.timeZone),
    )) {
      response.headers.set(name, value);
    }
  }
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon|.*\\..*).*)'],
};
