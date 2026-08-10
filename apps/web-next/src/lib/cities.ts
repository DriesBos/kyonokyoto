import type { AppLocale } from './i18n';

export type AppCity = 'kyoto' | 'osaka' | 'tokyo' | 'hong-kong';

export type CityConfig = {
  slug: AppCity;
  label: string;
  brandLabel: string;
  themeColor: string;
  locales: readonly [AppLocale, ...AppLocale[]];
  timeZone: string;
  mapCenter: { lat: number; lng: number };
};

export const CITY_COOKIE = 'kyo_city';
export const CITY_STORAGE_KEY = 'kyo_city';

export const cityConfigs: CityConfig[] = [
  {
    slug: 'kyoto',
    label: 'Kyōtō',
    brandLabel: 'Kyō-no-Kyōto',
    themeColor: '#138e00',
    locales: ['en', 'ja'],
    timeZone: 'Asia/Tokyo',
    mapCenter: { lat: 35.0240977, lng: 135.7621436 },
  },
  {
    slug: 'osaka',
    label: 'Osaka',
    brandLabel: 'Kyō-nō-Osaka',
    themeColor: '#7d4cff',
    locales: ['en', 'ja'],
    timeZone: 'Asia/Tokyo',
    mapCenter: { lat: 34.6937378, lng: 135.5021651 },
  },
  {
    slug: 'tokyo',
    label: 'Tōkiō',
    brandLabel: 'Kyō-nō-Tōkiō',
    themeColor: '#006fd6',
    locales: ['en', 'ja'],
    timeZone: 'Asia/Tokyo',
    mapCenter: { lat: 35.6651, lng: 139.7125 },
  },
  {
    slug: 'hong-kong',
    label: 'Hong Kong',
    brandLabel: 'Kyō-no-HongKong',
    themeColor: '#8c6500',
    locales: ['en'],
    timeZone: 'Asia/Hong_Kong',
    mapCenter: { lat: 22.28492, lng: 114.1583 },
  },
];

export const supportedCities = cityConfigs.map((city) => city.slug);

export function normalizeCity(value: unknown): AppCity | null {
  if (typeof value !== 'string') return null;
  const city = value.trim().toLowerCase() as AppCity;
  return supportedCities.includes(city) ? city : null;
}

export function cityConfigFor(value: unknown) {
  const city = normalizeCity(value);
  return cityConfigs.find((config) => config.slug === city) ?? null;
}

export const citySupportsLocale = (city: CityConfig, locale: AppLocale) =>
  city.locales.includes(locale);

export const defaultLocaleForCity = (city: CityConfig): AppLocale => city.locales[0];

export const alternateLocaleForCity = (city: AppCity, locale: AppLocale) =>
  cityConfigFor(city)?.locales.find((candidate) => candidate !== locale);

export const dateOnlyInTimeZone = (value: Date, timeZone: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone }).format(value);
