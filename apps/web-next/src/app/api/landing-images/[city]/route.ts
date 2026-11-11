import { blocksLandingCandidatesForEvents } from '@/lib/blocksLanding';
import { cityConfigFor } from '@/lib/cities';
import { fetchCityEvents } from '@/lib/cityEvents';
import { landingWarmUrls } from '@/lib/landingWarm';

// Landing image URLs for a city (both files of each landing event), for the cache warm after each crawl
// (scripts/run-crawl-cycle.mjs). Cached like the city pages: rendered on first request, not at
// build (CI builds without Supabase); the crawl purge drops it through the city-<slug> fetch tag,
// and the warm request then renders the fresh list.
export const revalidate = 3600;

export function generateStaticParams() {
  return [];
}

export async function GET(_request: Request, { params }: { params: Promise<{ city: string }> }) {
  const city = cityConfigFor((await params).city);
  if (!city) return Response.json({ error: 'Unknown city' }, { status: 404 });

  const events = await fetchCityEvents({ city: city.slug, locale: city.locales[0] });
  const candidates = blocksLandingCandidatesForEvents(events);
  return Response.json({
    city: city.slug,
    urls: landingWarmUrls(candidates),
  });
}
