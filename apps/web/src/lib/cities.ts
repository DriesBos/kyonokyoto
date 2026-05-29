export type AppCity = "kyoto" | "osaka" | "tokyo";

export type CityConfig = {
  slug: AppCity;
  label: string;
  themeColor: string;
  mapCenter: {
    lat: number;
    lng: number;
  };
  mapIdEnvKey: string;
  sourceFile: string;
  permanentFile: string;
};

export const CITY_COOKIE = "kyo_city";
export const CITY_STORAGE_KEY = "kyo_city";

export const cityConfigs: CityConfig[] = [
  {
    slug: "kyoto",
    label: "Kyoto",
    themeColor: "#138e00",
    mapCenter: { lat: 35.0240977, lng: 135.7621436 },
    mapIdEnvKey: "PUBLIC_GOOGLE_MAPS_MAP_ID_KYOTO",
    sourceFile: "kyoto-sources.json",
    permanentFile: "kyoto-permanent.json",
  },
  {
    slug: "osaka",
    label: "Osaka",
    themeColor: "#7d4cff",
    mapCenter: { lat: 34.6937378, lng: 135.5021651 },
    mapIdEnvKey: "PUBLIC_GOOGLE_MAPS_MAP_ID_OSAKA",
    sourceFile: "osaka-sources.json",
    permanentFile: "osaka-permanent.json",
  },
  {
    slug: "tokyo",
    label: "Tokyo",
    themeColor: "#006fd6",
    mapCenter: { lat: 35.6651, lng: 139.7125 },
    mapIdEnvKey: "PUBLIC_GOOGLE_MAPS_MAP_ID_TOKYO",
    sourceFile: "tokyo-sources.json",
    permanentFile: "tokyo-permanent.json",
  },
];

export const supportedCities = cityConfigs.map((city) => city.slug);

export function normalizeCity(value: unknown): AppCity | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return supportedCities.includes(normalized as AppCity)
    ? (normalized as AppCity)
    : null;
}

export function cityConfigFor(value: unknown): CityConfig | null {
  const city = normalizeCity(value);
  return cityConfigs.find((config) => config.slug === city) ?? null;
}

export function nextCityFor(city: AppCity): CityConfig {
  const index = cityConfigs.findIndex((config) => config.slug === city);
  return cityConfigs[(index + 1) % cityConfigs.length];
}

export function cityPathFor(city: AppCity, locale: string) {
  return `/${city}/${locale}/`;
}
