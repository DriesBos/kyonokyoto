import BlockControls from '@/app/blocks/BlockControls';
import BlocksLanding from '@/app/blocks/BlocksLanding';
import styles from '@/app/blocks/page.module.sass';
import EventsGrid from '@/app/EventsGrid';
import ExperienceHeader from '@/app/ExperienceHeader';
import MapExperience from '@/app/MapExperience';
import SiteFooter from '@/app/SiteFooter';
import { blocksLandingCandidatesForEvents } from '@/lib/blocksLanding';
import type { CityConfig } from '@/lib/cities';
import { categoriesForEvents, fetchCityEvents, mapSourcesForEvents } from '@/lib/cityEvents';
import type { AppLocale } from '@/lib/i18n';
import { structuredData } from '@/lib/seo';

export default async function CityEventsPage({
  city,
  locale,
}: {
  city: CityConfig;
  locale: AppLocale;
}) {
  const events = await fetchCityEvents({ city: city.slug, locale });
  const landingCandidates = blocksLandingCandidatesForEvents(events);
  const categories = categoriesForEvents(events, city.slug);
  const mapSources = mapSourcesForEvents(events);
  const jsonLd = JSON.stringify(structuredData({ city: city.slug, locale })).replaceAll(
    '<',
    '\\u003c',
  );

  return (
    <>
      {landingCandidates.length > 0 && (
        <BlocksLanding candidates={landingCandidates} cityLabel={city.label} />
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
        apiKey={
          process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? process.env.PUBLIC_GOOGLE_MAPS_API_KEY
        }
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? process.env.PUBLIC_GOOGLE_MAPS_MAP_ID}
      >
        <main className={styles.main} data-main-content>
          <BlockControls />
          <EventsGrid events={events} locale={locale} cityLabel={city.label} />
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
