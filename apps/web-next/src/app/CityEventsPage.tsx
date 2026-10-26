import BlockControls from '@/app/blocks/BlockControls';
import BlocksLanding from '@/app/blocks/BlocksLanding';
import styles from '@/app/blocks/page.module.sass';
import EventsGrid from '@/app/EventsGrid';
import ExperienceHeader from '@/app/ExperienceHeader';
import MapExperience from '@/app/MapExperience';
import SiteFooter from '@/app/SiteFooter';
import {
  blocksLandingCandidatesForEvents,
  blocksLandingCandidatesWithHero,
} from '@/lib/blocksLanding';
import type { CityConfig } from '@/lib/cities';
import { categoriesForEvents, fetchCityEvents, mapSourcesForEvents } from '@/lib/cityEvents';
import { googleMapsEnv } from '@/lib/env';
import { uiText, type AppLocale } from '@/lib/i18n';
import { structuredData } from '@/lib/seo';

export default async function CityEventsPage({
  city,
  locale,
}: {
  city: CityConfig;
  locale: AppLocale;
}) {
  const events = await fetchCityEvents({ city: city.slug, locale });
  const landing = blocksLandingCandidatesWithHero(blocksLandingCandidatesForEvents(events));
  const categories = categoriesForEvents(events);
  const mapSources = mapSourcesForEvents(events);
  const jsonLd = JSON.stringify(
    structuredData({
      city: city.slug,
      locale,
      events: events.map((event) => ({
        name: event.title,
        startDate: event.calendarStartsAt,
        endDate: event.calendarEndsAt,
        place: event.venue ?? event.institution,
        address: event.addressText,
        image: event.images[0]?.url ?? null,
        url: event.sourceUrl,
      })),
    }),
  ).replaceAll(
    '<',
    '\\u003c',
  );

  const copy = uiText[locale];

  return (
    <>
      <a className={styles.skipLink} href="#events">
        {copy.skipToEvents}
      </a>
      {landing.candidates.length > 0 && (
        <BlocksLanding
          candidates={landing.candidates}
          hero={landing.hero}
          cityLabel={city.label}
          locale={locale}
        />
      )}
      <MapExperience
        header={
          <ExperienceHeader
            city={city.slug}
            locale={locale}
            brandLabel={city.brandLabel}
            categories={categories}
          />
        }
        cityLabel={city.label}
        locale={locale}
        mapCenter={city.mapCenter}
        sources={mapSources}
        apiKey={googleMapsEnv().apiKey}
        mapId={googleMapsEnv().mapId}
      >
        <main className={styles.main} id="events" tabIndex={-1} data-main-content>
          <h1 className={styles.visuallyHidden}>{copy.pageHeading(city.label)}</h1>
          <BlockControls />
          <EventsGrid events={events} locale={locale} cityLabel={city.label} city={city.slug} />
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
