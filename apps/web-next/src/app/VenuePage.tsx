import Link from 'next/link';
import { notFound } from 'next/navigation';
import styles from '@/app/blocks/page.module.sass';
import { EventCardActions } from '@/app/EventCardDetail';
import EventsGrid from '@/app/EventsGrid';
import ExperienceHeader from '@/app/ExperienceHeader';
import MapExperience from '@/app/MapExperience';
import SiteFooter from '@/app/SiteFooter';
import type { CityConfig } from '@/lib/cities';
import { fetchVenueDetail, filterOptionsForEvents, mapSourcesForEvents } from '@/lib/cityEvents';
import { googleMapsEnv } from '@/lib/env';
import { routePathFor } from '@/lib/routeState';
import type { AppLocale } from '@/lib/i18n';
import { venueStructuredData } from '@/lib/seo';
import venueStyles from './VenuePage.module.sass';

// Last-resort fallback; venues get their intros from data/venue-descriptions.json.
const placeholderDescription =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';

const eventCount = (count: number, locale: AppLocale) =>
  locale === 'ja' ? `${count}件のイベント` : `${count} ${count === 1 ? 'EVENT' : 'EVENTS'}`;

export default async function VenuePage({
  city,
  locale,
  slug,
}: {
  city: CityConfig;
  locale: AppLocale;
  slug: string;
}) {
  const venue = await fetchVenueDetail({ city: city.slug, locale, slug });
  if (!venue) notFound();

  const cityPath = routePathFor({ city: city.slug, locale });
  const { apiKey, mapId } = googleMapsEnv();
  const mapSources =
    venue.lat !== null && venue.lng !== null
      ? [
          {
            id: `${venue.lat.toFixed(6)},${venue.lng.toFixed(6)}`,
            sourceSlug: venue.slug,
            name: venue.name,
            categories: venue.categories.map((category) => category.slug),
            lat: venue.lat,
            lng: venue.lng,
          },
        ]
      : mapSourcesForEvents(venue.events);
  const mapCenter =
    venue.lat !== null && venue.lng !== null
      ? { lat: venue.lat, lng: venue.lng }
      : (mapSources[0] ?? city.mapCenter);
  const jsonLd = JSON.stringify(
    venueStructuredData({
      city: city.slug,
      locale,
      slug: venue.slug,
      venue: {
        name: venue.name,
        address: venue.addressText,
        lat: venue.lat,
        lng: venue.lng,
        url: venue.website,
        image: venue.image?.url ?? null,
      },
      events: venue.events.map((event) => ({
        name: event.title,
        startDate: event.calendarStartsAt,
        endDate: event.calendarEndsAt,
        place: venue.name,
        address: event.addressText ?? venue.addressText,
        image: event.images[0]?.url ?? null,
        url: event.sourceUrl,
      })),
    }),
  ).replaceAll('<', '\\u003c');

  return (
    <>
      <MapExperience
        header={
          <ExperienceHeader
            city={city.slug}
            locale={locale}
            brandLabel={city.brandLabel}
            filterOptions={filterOptionsForEvents(venue.events)}
          />
        }
        cityLabel={venue.name}
        locale={locale}
        mapCenter={{ lat: mapCenter.lat, lng: mapCenter.lng }}
        sources={mapSources}
        apiKey={apiKey}
        mapId={mapId}
        defaultOpen
      >
        <main className={styles.main} id="events" tabIndex={-1} data-main-content data-venue-page>
          <header className={venueStyles.intro}>
            <Link className={venueStyles.back} href={cityPath} prefetch={false}>
              <svg viewBox="0 0 48 16" aria-hidden="true" focusable="false">
                <path d="M47 8H2M9 1L2 8l7 7" />
              </svg>
              <span>{locale === 'ja' ? '戻る' : 'back'}</span>
            </Link>
            <h1 className={venueStyles.title}>{venue.name}</h1>
            <p className={venueStyles.description}>{venue.description || placeholderDescription}</p>
            <EventCardActions
              mapsUrl={venue.mapsUrl}
              sourceUrl={venue.website}
              googleCalendarUrl={null}
              appleCalendar={null}
              locale={locale}
            />
          </header>
          <hr className={venueStyles.divider} />
          {venue.events.length > 0 ? (
            <>
              <h2 className={venueStyles.count}>{eventCount(venue.events.length, locale)}</h2>
              <EventsGrid
                events={venue.events}
                locale={locale}
                cityLabel={venue.name}
                city={city.slug}
                linkVenues={false}
              />
            </>
          ) : (
            <section className={venueStyles.empty}>
              <p>{locale === 'ja' ? 'イベントはありません' : 'NO EVENTS FOUND'}</p>
            </section>
          )}
          <SiteFooter
            compact
            className={styles.blocksFooter}
            cityLabel={city.label}
            locale={locale}
          />
        </main>
      </MapExperience>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
    </>
  );
}
