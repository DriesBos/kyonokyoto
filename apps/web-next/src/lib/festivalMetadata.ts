import type { Metadata } from 'next';
import { type CityConfig } from './cities';
import { fetchFestivalDetail } from './cityEvents';
import { festivalPathFor } from './festivalRoutes';
import type { AppLocale } from './i18n';
import { eventShareImageUrl } from './mediaDelivery';
import { cityNameFor, siteOrigin } from './seo';

const fallbackDescription = {
  en: (title: string, city: string) => `${title}: programme, dates and venues in ${city}.`,
  ja: (title: string, city: string) => `${city}で開催される${title}のプログラム・日程・会場。`,
} as const;

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
  const description =
    festival.description ||
    fallbackDescription[locale](festival.title, cityNameFor(city.slug, locale));
  const url = `${siteOrigin()}${festivalPathFor(city.slug, locale, festival.slug)}`;
  const image =
    eventShareImageUrl(festival.images[0]?.url ?? null, siteOrigin()) ?? `${siteOrigin()}/og.png`;
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
    robots: 'index, follow, max-image-preview:large',
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      locale: locale === 'ja' ? 'ja_JP' : 'en_US',
      images: [{ url: image, alt: festival.title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
