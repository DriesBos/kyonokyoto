import { normalizeCity, type AppCity } from './cities.ts';
import { normalizeLocale, type AppLocale } from './i18n.ts';

export type AppRouteState = {
  city: AppCity;
  locale: AppLocale;
};

export type PartialRouteState = {
  city?: AppCity;
  locale?: AppLocale;
};

export function routePathFor({ city, locale }: AppRouteState) {
  return `/${city}/${locale}/`;
}

export function routeStateFromPath(pathname: string): {
  city: AppCity | null;
  locale: AppLocale | null;
} {
  const segments = pathname.split('/').filter(Boolean);
  const city = normalizeCity(segments[0]);
  const locale = segments.map(normalizeLocale).find(Boolean) ?? null;

  return { city, locale };
}

export function routeUrlWithState(
  currentUrl: URL | string,
  nextState: PartialRouteState,
  fallbackState: PartialRouteState = {},
) {
  const url = new URL(currentUrl.toString());
  const currentState = routeStateFromPath(url.pathname);
  const city = nextState.city ?? currentState.city ?? fallbackState.city ?? 'kyoto';
  const locale = nextState.locale ?? currentState.locale ?? fallbackState.locale ?? 'en';

  url.pathname = routePathFor({ city, locale });
  return url;
}
