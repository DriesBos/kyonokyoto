import type { MetadataRoute } from 'next';

import { fetchFestivalSlugs } from '@/lib/cityEvents';
import { festivalSitemapEntries, sitemapEntries } from '@/lib/seo';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // A Supabase hiccup should not take the city pages out of the sitemap.
  const festivals = await fetchFestivalSlugs().catch(() => []);
  return [...sitemapEntries(), ...festivalSitemapEntries(festivals)].map(({ url, languages }) => ({
    url,
    alternates: { languages },
  }));
}
