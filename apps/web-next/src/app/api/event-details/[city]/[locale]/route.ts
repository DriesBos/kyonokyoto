import { cityConfigFor, citySupportsLocale } from '@/lib/cities';
import { fetchCityEvents } from '@/lib/cityEvents';
import { eventDetailsById } from '@/lib/eventDetails';
import { normalizeLocale } from '@/lib/i18n';

// Card details (description, links) for every event of a city page and its venue pages, fetched
// by the first card a visitor expands (ExpandableGrid). Cached like the city pages: rendered on
// first request, CDN-tagged city-<slug> through the Supabase fetch, so the crawl purge drops it.
export const revalidate = 3600;

export function generateStaticParams() {
  return [];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ city: string; locale: string }> },
) {
  const values = await params;
  const city = cityConfigFor(values.city);
  const locale = normalizeLocale(values.locale);
  if (!city || !locale || !citySupportsLocale(city, locale)) {
    return Response.json({ error: 'Unknown city or locale' }, { status: 404 });
  }
  const events = await fetchCityEvents({ city: city.slug, locale });
  return Response.json(eventDetailsById(events));
}
