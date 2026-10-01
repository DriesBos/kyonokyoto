import type { Metadata } from 'next';
import { type CityConfig } from './cities';
import { fetchFestivalDetail } from './cityEvents';
import { festivalPathFor } from './festivalRoutes';
import type { AppLocale } from './i18n';
import { siteOrigin } from './seo';

export async function buildFestivalMetadata({
  city,
  locale,
  slug,
}: {
  city: CityConfig;
  locale: AppLocale;
  slug: string;
}): Promise<Metadata> {
  const detail = await fetchFestivalDetail({ city: city.slug, locale, slug });
  if (!detail) return { robots: { index: false, follow: false } };

  const { festival } = detail;
  const title = `${festival.title} | Kyō no Kyōto`;
  const description = festival.description || `${festival.title} programme`;
  const url = `${siteOrigin()}${festivalPathFor(city.slug, locale, festival.slug)}`;
  const languages = Object.fromEntries(
    city.locales.map((language) => [
      language,
      `${siteOrigin()}${festivalPathFor(city.slug, language, festival.slug)}`,
    ]),
  );

  return {
    title,
    description,
    alternates: { canonical: url, languages },
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      locale: locale === 'ja' ? 'ja_JP' : 'en_US',
    },
  };
}
