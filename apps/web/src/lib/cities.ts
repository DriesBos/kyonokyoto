export type AppCity = 'kyoto' | 'osaka' | 'tokyo' | 'hong-kong';

export type CityConfig = {
  slug: AppCity;
  label: string;
  brandLabel: string;
  themeColor: string;
  timeZone: string;
  mapCenter: {
    lat: number;
    lng: number;
  };
  sourceFile: string;
  permanentFile: string;
};

export const CITY_COOKIE = 'kyo_city';
export const CITY_STORAGE_KEY = 'kyo_city';

export const cityConfigs: CityConfig[] = [
  {
    slug: 'kyoto',
    label: 'Kyōtō',
    brandLabel: 'Kyō-no-Kyōto',
    themeColor: '#138e00',
    timeZone: 'Asia/Tokyo',
    mapCenter: { lat: 35.0240977, lng: 135.7621436 },
    sourceFile: 'kyoto-sources.json',
    permanentFile: 'kyoto-permanent.json',
  },
  {
    slug: 'osaka',
    label: 'Osaka',
    brandLabel: 'Kyō-nō-Osaka',
    themeColor: '#7d4cff',
    timeZone: 'Asia/Tokyo',
    mapCenter: { lat: 34.6937378, lng: 135.5021651 },
    sourceFile: 'osaka-sources.json',
    permanentFile: 'osaka-permanent.json',
  },
  {
    slug: 'tokyo',
    label: 'Tōkiō',
    brandLabel: 'Kyō-nō-Tōkiō',
    themeColor: '#006fd6',
    timeZone: 'Asia/Tokyo',
    mapCenter: { lat: 35.6651, lng: 139.7125 },
    sourceFile: 'tokyo-sources.json',
    permanentFile: 'tokyo-permanent.json',
  },
  {
    slug: 'hong-kong',
    label: 'Hong Kong',
    brandLabel: 'Kyō-no-HongKong',
    themeColor: '#8c6500',
    timeZone: 'Asia/Hong_Kong',
    mapCenter: { lat: 22.28492, lng: 114.1583 },
    sourceFile: 'hong-kong-sources.json',
    permanentFile: 'hong-kong-permanent.json',
  },
];

export const supportedCities = cityConfigs.map((city) => city.slug);

export function normalizeCity(value: unknown): AppCity | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return supportedCities.includes(normalized as AppCity) ? (normalized as AppCity) : null;
}

export function cityConfigFor(value: unknown): CityConfig | null {
  const city = normalizeCity(value);
  return cityConfigs.find((config) => config.slug === city) ?? null;
}

export function nextCityFor(city: AppCity): CityConfig {
  const index = cityConfigs.findIndex((config) => config.slug === city);
  return cityConfigs[(index + 1) % cityConfigs.length];
}

export const dateOnlyInTimeZone = (value: Date, timeZone: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone }).format(value);
