import type { BlocksLandingCandidate } from './blocksLanding.ts';
import { landingMediaDeliveryUrl } from './mediaDelivery.ts';

// Both files of every landing event (at most 12 per city, so at most 24 URLs). The crawl cycle
// requests them right after a crawl so the first visitor hits a warm Netlify Image CDN entry.
// Each file has one cached version (fixed WebP), so a warm costs at most one Supabase fetch per file.
export const landingWarmUrls = (candidates: BlocksLandingCandidate[]): string[] => {
  const urls = new Set<string>();
  for (const candidate of candidates) {
    for (const src of [candidate.files.desktop, candidate.files.mobile]) {
      const url = landingMediaDeliveryUrl(src, true);
      if (url) urls.add(url);
    }
  }
  return [...urls];
};
