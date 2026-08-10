import type { Metadata } from 'next';

import { cityConfigFor, cityConfigs, defaultLocaleForCity, type AppCity } from './cities.ts';
import type { AppLocale } from './i18n.ts';

const APP_NAME = 'KyōNoKyōto';
const FALLBACK_ORIGIN = 'https://kyonokyoto.com';

const cityNames: Record<AppCity, { en: string; ja: string }> = {
  kyoto: { en: 'Kyoto', ja: '京都' },
  osaka: { en: 'Osaka', ja: '大阪' },
  tokyo: { en: 'Tokyo', ja: '東京' },
  'hong-kong': { en: 'Hong Kong', ja: '香港' },
};

export const SEO_TEXT = {
  en: {
    title: (city: string) => `${city} Art & Culture Calendar | Kyō no Kyōto`,
    description: (city: string) =>
      `Discover current and upcoming art exhibitions, museum shows, and cultural events across ${city}, with dates, venues, maps, and official links.`,
  },
  ja: {
    title: (city: string) => `${city}の展覧会・文化イベント | 京の京都`,
    description: (city: string) =>
      `${city}で開催中・開催予定の展覧会、美術館の企画展、文化イベントを、日程・会場・地図・公式リンクとともに紹介します。`,
  },
} as const;

// Compatibility with the V1 Netlify environment during cutover.
export const siteOrigin = () => {
  const configured = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? FALLBACK_ORIGIN;
  try {
    return new URL(configured).origin;
  } catch {
    return FALLBACK_ORIGIN;
  }
};

const routeUrl = (city: AppCity, locale: AppLocale) => {
  const config = cityConfigFor(city)!;
  return `${siteOrigin()}/${city}${config.locales.length === 1 ? '/' : `/${locale}/`}`;
};

const seoCopy = (city: AppCity, locale: AppLocale) => {
  const cityName = cityNames[city][locale];
  return {
    title: SEO_TEXT[locale].title(cityName),
    description: SEO_TEXT[locale].description(cityName),
  };
};

export const buildMetadata = ({ city, locale }: { city: AppCity; locale: AppLocale }): Metadata => {
  const { title, description } = seoCopy(city, locale);
  const canonical = routeUrl(city, locale);
  const config = cityConfigFor(city)!;
  const languages = Object.fromEntries(config.locales.map((language) => [language, routeUrl(city, language)]));
  const alternateLocales = config.locales
    .filter((language) => language !== locale)
    .map((language) => language === 'ja' ? 'ja_JP' : 'en_US');
  const image = `${siteOrigin()}/og.png`;

  return {
    title,
    description,
    alternates: { canonical, languages: { ...languages, 'x-default': routeUrl(city, defaultLocaleForCity(config)) } },
    robots: 'index, follow, max-image-preview:large',
    manifest: '/site.webmanifest',
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      ],
      shortcut: '/favicon.ico',
      apple: [
        { url: '/apple-touch-icon-512.png', sizes: '512x512' },
        { url: '/apple-touch-icon.png', sizes: '180x180' },
      ],
    },
    appleWebApp: { capable: true, statusBarStyle: 'default', title: APP_NAME },
    openGraph: {
      type: 'website',
      siteName: APP_NAME,
      title,
      description,
      url: canonical,
      locale: locale === 'ja' ? 'ja_JP' : 'en_US',
      alternateLocale: alternateLocales.length ? alternateLocales : undefined,
      images: [{ url: image, width: 1200, height: 530, alt: `${title} culture calendar` }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
};

export const structuredData = ({ city, locale }: { city: AppCity; locale: AppLocale }) => {
  const { title, description } = seoCopy(city, locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: routeUrl(city, locale),
    inLanguage: locale,
    isPartOf: { '@type': 'WebSite', name: APP_NAME, url: siteOrigin() },
  };
};

export const sitemapEntries = () => cityConfigs.flatMap((city) =>
  city.locales.map((locale) => ({
    city: city.slug,
    locale,
    url: routeUrl(city.slug, locale),
    languages: Object.fromEntries(city.locales.map((language) => [language, routeUrl(city.slug, language)])),
  })),
);
