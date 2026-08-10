import type { MetadataRoute } from 'next';

import { sitemapEntries } from '@/lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries().map(({ url, languages }) => ({ url, alternates: { languages } }));
}
