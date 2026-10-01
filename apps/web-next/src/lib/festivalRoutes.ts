import { cityConfigFor, type AppCity } from './cities.ts';
import type { AppLocale } from './i18n.ts';

export function festivalPathFor(city: AppCity, locale: AppLocale, slug: string) {
  const prefix = cityConfigFor(city)?.locales.length === 1 ? `/${city}` : `/${city}/${locale}`;
  return `${prefix}/festivals/${encodeURIComponent(slug)}/`;
}
