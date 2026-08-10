import { cityConfigFor, normalizeCity, type AppCity } from './cities.ts';
import { normalizeLocale, type AppLocale } from './i18n.ts';

export const routePathFor = ({ city, locale }: { city: AppCity; locale: AppLocale }) => {
  const config = cityConfigFor(city);
  return config?.locales.length === 1 ? `/${city}/` : `/${city}/${locale}/`;
};

export function routeStateFromPath(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  return {
    city: normalizeCity(segments[0]),
    locale: segments.map(normalizeLocale).find(Boolean) ?? null,
  };
}
