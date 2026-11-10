import type { MetadataRoute } from 'next';

import { fetchFestivalSlugs, venueSlugs } from '@/lib/cityEvents';
import { festivalSitemapEntries, sitemapEntries, venueSitemapEntries } from '@/lib/seo';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // A Supabase hiccup should not take the city pages out of the sitemap.
  const festivals = await fetchFestivalSlugs().catch(() => []);
  const venues = await venueSlugs();
  return [
    ...sitemapEntries(),
    ...festivalSitemapEntries(festivals),
    ...venueSitemapEntries(venues),
  ].map(({ url, languages }) => ({
    url,
    alternates: { languages },
  }));
}
