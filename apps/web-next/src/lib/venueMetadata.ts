import type { Metadata } from 'next';
import { type CityConfig } from './cities';
import { fetchVenueDetail } from './cityEvents';
import type { AppLocale } from './i18n';
import { eventShareImageUrl } from './mediaDelivery';
import { cityNameFor, siteOrigin } from './seo';
import { venuePathFor } from './venueRoutes';

const descriptionFor = {
  en: (name: string, city: string, count: number) =>
    `${name} in ${city}: ${count ? `${count} current and upcoming exhibitions and events, ` : ''}address, map and official website.`,
  ja: (name: string, city: string, count: number) =>
    `${city}の${name}。${count ? `開催中・開催予定の展覧会とイベント${count}件、` : ''}住所・地図・公式サイト。`,
} as const;

export async function buildVenueMetadata({
  city,
  locale,
  slug,
}: {
  city: CityConfig;
  locale: AppLocale;
  slug: string;
}): Promise<Metadata> {
  const venue = await fetchVenueDetail({ city: city.slug, locale, slug });
  if (!venue) return { robots: { index: false, follow: false } };

  const cityName = cityNameFor(city.slug, locale);
  const title =
    locale === 'ja'
      ? `${venue.name}の展覧会・イベント | 京の京都`
      : `${venue.name} exhibitions & events | Kyō no Kyōto`;
  const description = descriptionFor[locale](venue.name, cityName, venue.events.length);
  const url = `${siteOrigin()}${venuePathFor(city.slug, locale, venue.slug)}`;
  const image =
    eventShareImageUrl(venue.image?.url ?? null, siteOrigin()) ?? `${siteOrigin()}/og.png`;
  const languages = Object.fromEntries(
    city.locales.map((language) => [
      language,
      `${siteOrigin()}${venuePathFor(city.slug, language, venue.slug)}`,
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
      images: [{ url: image, alt: venue.name }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
