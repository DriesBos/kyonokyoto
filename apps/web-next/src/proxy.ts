import { NextResponse, type NextRequest } from 'next/server';
import { normalizeCity } from '@/lib/cities';
import { normalizeLocale } from '@/lib/i18n';

export function proxy(request: NextRequest) {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const city = normalizeCity(segments[0]) ?? 'kyoto';
  const locale = normalizeLocale(segments[1]) ?? normalizeLocale(segments[0]) ?? 'en';
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-kyo-city', city);
  requestHeaders.set('x-kyo-locale', locale);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon|.*\\..*).*)'],
};
