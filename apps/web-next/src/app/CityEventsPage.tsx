import BlockControls from '@/app/blocks/BlockControls';
import BlocksLanding from '@/app/blocks/BlocksLanding';
import styles from '@/app/blocks/page.module.sass';
import EventsGrid from '@/app/EventsGrid';
import ExperienceHeader from '@/app/ExperienceHeader';
import InlineBootScript from '@/app/InlineBootScript';
import MapExperience from '@/app/MapExperience';
import SiteFooter from '@/app/SiteFooter';
import { blocksLandingCandidatesForEvents, blocksLandingHeroOptions } from '@/lib/blocksLanding';
import type { CityConfig } from '@/lib/cities';
import { fetchCityEvents, filterOptionsForEvents, mapSourcesForEvents } from '@/lib/cityEvents';
import { defaultCityFilterTokens } from '@/lib/eventFilters';
import { DEV_PAGE_ENABLED } from '@/lib/devPage';
import { googleMapsEnv, imageCdnEnabled } from '@/lib/env';
import { uiText, type AppLocale } from '@/lib/i18n';
import { landingHeroScript } from '@/lib/landingHero';
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
  const landingHeroes = blocksLandingHeroOptions(landingCandidates);
  const heroScript = landingHeroScript(landingHeroes, imageCdnEnabled());
  const filterOptions = filterOptionsForEvents(events);
  const defaultFilters = defaultCityFilterTokens(filterOptions);
  const mapSources = mapSourcesForEvents(events);
  // Testing aid (local builds only): the header's venue filter lists every source with events.
  const venues = DEV_PAGE_ENABLED
    ? Array.from(
        events
          .reduce((bySlug, event) => {
            if (!event.sourceSlug) return bySlug;
            const venue = bySlug.get(event.sourceSlug) ?? {
              slug: event.sourceSlug,
              label: event.institution || event.sourceSlug,
              count: 0,
            };
            venue.count += 1;
            return bySlug.set(event.sourceSlug, venue);
          }, new Map<string, { slug: string; label: string; count: number }>())
          .values(),
      ).sort((a, b) => a.label.localeCompare(b.label))
    : [];
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
  ).replaceAll('<', '\\u003c');

  const copy = uiText[locale];

  return (
    <>
      <a className={styles.skipLink} href="#events">
        {copy.skipToEvents}
      </a>
      {landingCandidates.length > 0 && heroScript && (
        // picks this visit's first slide and preloads it before hydration (lib/landingHero.ts)
        <InlineBootScript html={heroScript} />
      )}
      {landingCandidates.length > 0 && (
        <BlocksLanding
          candidates={landingCandidates}
          heroOptions={landingHeroes}
          cityLabel={city.label}
          locale={locale}
          todayCount={events.filter((event) => event.group === 'ongoing').length}
        />
      )}
      {/* keyed by city: switching cities starts fresh, so filters, venue picks and the map reset
          to the new city's defaults instead of carrying over (Dries 2026-11-11) */}
      <MapExperience
        key={city.slug}
        header={
          <ExperienceHeader
            city={city.slug}
            locale={locale}
            brandLabel={city.brandLabel}
            filterOptions={filterOptions}
            defaultFilters={defaultFilters}
            venues={venues}
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
          <EventsGrid
            events={events}
            locale={locale}
            cityLabel={city.label}
            city={city.slug}
            initialFilters={defaultFilters}
          />
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
