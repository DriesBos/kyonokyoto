'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CITY_SWITCHER_ENABLED,
  alternateLocaleForCity,
  cityConfigs,
  defaultLocaleForCity,
  type AppCity,
} from '@/lib/cities';
import { uiText, type AppLocale } from '@/lib/i18n';
import type { FilterOptions, FilterTiming } from '@/lib/cityEvents';
import { FILTER_TYPES } from '../../../../data/categories.mjs';
import { FILTER_RESET_EVENT, SAVED_FILTER_TOKEN, isFilterToken } from '@/lib/eventFilters';
import { applyCardFilters } from '@/lib/applyCardFilters';
import { publishAppliedFilters } from '@/lib/filterStore';
import { useStarredIds } from '@/lib/useStarredIds';
import { fadeIn, setFadeHidden } from '@/lib/fadeTransition';
import { readLocaleHandoff, restoreLocaleHandoff, setLocaleHandoff } from '@/lib/localeHandoff';
import { persistPreference } from '@/lib/preferenceCookies';
import { routePathFor } from '@/lib/routeState';
import { SOCIALS_ENABLED } from '@/lib/socialPosts';
import ColorSchemeToggle from './ColorSchemeToggle';
import GeneralButton from './GeneralButton';
import GridDensityControls from './GridDensityControls';
import { BoxEdge, BoxSides, boxLift } from './blocks/BoxFrame';
import { scrollRoot, useDisclosurePanel, useHeaderCompact } from './header/headerMotion';
import { useFilterHash } from './header/useFilterHash';
import Wordmark from './header/Wordmark';

// Local builds only: its code never loads in production, where the page passes no venues.
const DevVenuePanel = dynamic(() => import('./header/DevVenuePanel'));
import styles from './SiteHeader.module.sass';

// Local builds only (testing aid): filter the grid by source.
export type HeaderVenue = { slug: string; label: string; count: number };

type SiteHeaderProps = {
  city: AppCity;
  locale: AppLocale;
  brandLabel: string;
  filterOptions?: FilterOptions;
  // Filter tokens picked on a fresh load (city pages: lib/eventFilters defaultCityFilterTokens).
  defaultFilters?: readonly string[];
  venues?: HeaderVenue[];
  mapOpen: boolean;
  onMapToggle: () => void;
};

// While a city page loads, the event cards show as empty boxes (page.module.sass). Cleared when
// the new page's header mounts, or when the page comes back from the back/forward cache.
const ROUTE_PENDING_ATTR = 'data-route-pending';

// A city whose route lives in the other root layout (single-locale /<city>/ vs /<city>/<locale>/)
// is a full page load, which the router cannot prefetch; warm its HTML in the browser cache.
const prefetchDocument = (href: string) => {
  if (document.head.querySelector(`link[rel="prefetch"][href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'document';
  link.href = href;
  document.head.appendChild(link);
};

const singleLocale = (slug: AppCity) =>
  cityConfigs.find((config) => config.slug === slug)?.locales.length === 1;
const sharesRootLayout = (a: AppCity, b: AppCity) => singleLocale(a) === singleLocale(b);

const localeForCity = (target: (typeof cityConfigs)[number], locale: AppLocale) =>
  target.locales.includes(locale) ? locale : defaultLocaleForCity(target);

const NO_FILTER_OPTIONS: FilterOptions = {
  timings: [],
  types: [],
  openTypes: [],
  subs: {},
  places: [],
};

export default function SiteHeader({
  city,
  locale,
  brandLabel,
  filterOptions = NO_FILTER_OPTIONS,
  defaultFilters = [],
  venues = [],
  mapOpen,
  onMapToggle,
}: SiteHeaderProps) {
  const rootRef = useRef<HTMLElement>(null);
  // set when this page was reached through the language switch (lib/localeHandoff)
  const [handoff] = useState(() => readLocaleHandoff(locale));
  const [filterOpen, setFilterOpen] = useState(false);
  const filterOpenRef = useRef(filterOpen);
  filterOpenRef.current = filterOpen;
  const [citiesOpen, setCitiesOpen] = useState(false);
  const [venuesOpen, setVenuesOpen] = useState(false);
  const [activeVenues, setActiveVenues] = useState<Set<string>>(() => new Set());
  // Picked filters as tokens: type:<type>, sub:<type>:<sub>, place:<place> (data/categories.mjs).
  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    () => new Set(handoff ? handoff.categories.filter(isFilterToken) : defaultFilters),
  );
  const [activeTiming, setActiveTiming] = useState(handoff?.timing ?? '');
  // Saved (starred) filter: client-only, kept out of activeFilters so it never reaches the locale
  // handoff or any URL. The block shows once a card on this page is starred (count from the DOM).
  const starredIds = useStarredIds();
  const [savedActive, setSavedActive] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const showSaved = savedCount > 0;
  // apps/web keeps the header controls in English in every locale.
  const copy = uiText.en;
  const label = (value: string) => copy.filterLabels[value] ?? value;
  const timingLabels: Record<FilterTiming, string> = {
    ending: copy.endingThisWeek,
    ongoing: copy.ongoing,
    upcoming: copy.upcoming,
    permanent: copy.permanent,
  };
  const pickedTypes = filterOptions.types.filter((type) => activeFilters.has(`type:${type}`));
  // Sub-picks of every picked type, plus the types the whole page shares (no button of their own).
  const subGroups = [...filterOptions.openTypes, ...pickedTypes]
    .filter((type, index, list) => list.indexOf(type) === index)
    .sort((a, b) => FILTER_TYPES.indexOf(a) - FILTER_TYPES.indexOf(b))
    .map((type) => ({ type, subs: filterOptions.subs[type] ?? [] }))
    .filter((group) => group.subs.length > 0);
  const showFilterControls =
    showSaved ||
    filterOptions.timings.length > 0 ||
    filterOptions.types.length > 0 ||
    Object.keys(filterOptions.subs).length > 0 ||
    filterOptions.places.length > 0;
  const filteringActive = activeFilters.size > 0 || Boolean(activeTiming) || savedActive;
  const homeHref = routePathFor({ city, locale });
  const otherLocale = alternateLocaleForCity(city, locale);
  const currentCityLabel = cityConfigs.find((config) => config.slug === city)?.label ?? city;
  const filterPanelRef = useDisclosurePanel(filterOpen);
  const cityPanelRef = useDisclosurePanel(citiesOpen);
  // Sub-picks appear while the panel is open (a type was picked): fade them in like the rest, since
  // the panel's own fade only covers the buttons that were there when it opened.
  const subGroupsKey = subGroups.map((group) => `${group.type}:${group.subs.join(',')}`).join('|');
  const seenSubButtons = useRef(new WeakSet<HTMLElement>());
  useLayoutEffect(() => {
    const panel = filterPanelRef.current;
    if (!panel) return;
    const fresh = Array.from(
      panel.querySelectorAll<HTMLElement>(
        '[data-sub-filters] [data-panel-button], [data-saved-filter] [data-panel-button]',
      ),
    ).filter((button) => !seenSubButtons.current.has(button));
    fresh.forEach((button) => seenSubButtons.current.add(button));
    if (!filterOpenRef.current || fresh.length === 0) return;
    setFadeHidden(fresh);
    fadeIn(fresh);
  }, [subGroupsKey, showSaved, filterPanelRef]);
  const showVenueControls = venues.length > 0;
  const mapOpenRef = useRef(mapOpen);
  mapOpenRef.current = mapOpen;

  useEffect(() => {
    persistPreference(city, locale);
  }, [city, locale]);

  useEffect(() => {
    document.documentElement.removeAttribute(ROUTE_PENDING_ATTR);
    const clear = () => document.documentElement.removeAttribute(ROUTE_PENDING_ATTR);
    window.addEventListener('pageshow', clear);
    return () => window.removeEventListener('pageshow', clear);
  }, [city, locale]);

  // Opening the city panel warms every other city, so the click finds its page already loaded:
  // the links in the same root layout prefetch themselves (prefetch={citiesOpen} below), the
  // others get their HTML warmed.
  useEffect(() => {
    if (!citiesOpen) return;
    cityConfigs.forEach((target) => {
      if (target.slug === city || sharesRootLayout(target.slug, city)) return;
      prefetchDocument(routePathFor({ city: target.slug, locale: localeForCity(target, locale) }));
    });
  }, [citiesOpen, city, locale]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setFilterOpen(false);
      setCitiesOpen(false);
      setVenuesOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setFilterOpen(false);
      setCitiesOpen(false);
      setVenuesOpen(false);
      if (mapOpenRef.current) onMapToggle();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [onMapToggle]);

  useHeaderCompact(rootRef, mapOpen);

  // Phones: the floating bottom box steps aside once the footer's content (credit, arrow) comes
  // within the box's reach of the screen bottom, so it never covers it (desktop ignores the flag).
  const [footerReached, setFooterReached] = useState(false);
  useEffect(() => {
    const content = document.querySelector<HTMLElement>('[data-site-footer] > *');
    if (!content) return;
    const observer = new IntersectionObserver(
      ([entry]) => setFooterReached(entry.isIntersecting || entry.boundingClientRect.top < 0),
      { rootMargin: '0px 0px 240px 0px' },
    );
    observer.observe(content);
    return () => observer.disconnect();
  }, [mapOpen]);

  // Open panels close once the page has scrolled half a viewport away from where they opened.
  useEffect(() => {
    if (!filterOpen && !citiesOpen && !venuesOpen) return;
    const root = scrollRoot();
    const target = root ?? window;
    const scrollTop = () => (root ? root.scrollTop : window.scrollY);
    const viewport = () => (root ? root.clientHeight : window.innerHeight);
    const origin = scrollTop();
    const onScroll = () => {
      if (Math.abs(scrollTop() - origin) <= viewport() * 0.5) return;
      setFilterOpen(false);
      setCitiesOpen(false);
      setVenuesOpen(false);
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => target.removeEventListener('scroll', onScroll);
  }, [filterOpen, citiesOpen, venuesOpen]);

  // Apply the picks to the cards (lib/applyCardFilters), then tell the map (lib/filterStore).
  useEffect(() => {
    const { starredCount } = applyCardFilters({
      tokens: activeFilters,
      timing: activeTiming,
      venues: activeVenues,
      saved: savedActive,
    });
    setSavedCount(starredCount);
    // Unstarring the last saved event switches the saved filter off (its block hides).
    if (savedActive && starredCount === 0) setSavedActive(false);
    publishAppliedFilters({
      tokens: [...activeFilters],
      timing: activeTiming,
      venues: [...activeVenues],
      saved: savedActive,
    });
  }, [activeFilters, activeTiming, activeVenues, savedActive, starredIds]);

  useFilterHash({
    enabled: !handoff,
    filterOptions,
    defaultFilters,
    activeFilters,
    activeTiming,
    setActiveFilters,
    setActiveTiming,
  });

  // After a language switch, put the reader back on the card they were looking at, once the
  // filter effect above (same commit, runs first) has hidden what it hides. React may keep this
  // header (and its state) across the switch or mount a fresh one, so this keys on the locale.
  useEffect(() => {
    const pending = readLocaleHandoff(locale);
    if (pending) restoreLocaleHandoff(pending);
  }, [locale]);

  // The empty state's "unset filters" button clears every row.
  useEffect(() => {
    const reset = () => {
      setActiveFilters(new Set());
      setActiveTiming('');
      setActiveVenues(new Set());
      setSavedActive(false);
    };
    document.addEventListener(FILTER_RESET_EVENT, reset);
    return () => document.removeEventListener(FILTER_RESET_EVENT, reset);
  }, []);

  // Unpicking a type also drops its sub-picks.
  const toggleFilter = (token: string) => {
    setActiveFilters((current) => {
      const next = new Set(current);
      if (next.has(token)) {
        next.delete(token);
        if (token.startsWith('type:')) {
          const subPrefix = `sub:${token.slice('type:'.length)}:`;
          next.forEach((item) => item.startsWith(subPrefix) && next.delete(item));
        }
      } else next.add(token);
      return next;
    });
  };
  const filterButton = (token: string, buttonLabel: string) => (
    <GeneralButton
      key={token}
      verticalPadding="full"
      label={`#${buttonLabel}`}
      showDot
      pressed={activeFilters.has(token)}
      tabIndex={filterOpen ? undefined : -1}
      data-panel-button
      data-filter-button
      data-filter-token={token}
      onClick={() => toggleFilter(token)}
    />
  );

  return (
    <header
      className={styles.header}
      ref={rootRef}
      data-category-filter
      data-main-header
      data-map-open={mapOpen || undefined}
    >
      <Link
        className={styles.logo}
        href={homeHref}
        prefetch={false}
        aria-label={`${brandLabel} home`}
        onClick={() => persistPreference(city, locale)}
      >
        <Wordmark label={brandLabel} />
      </Link>
      {/* Phones: the dock floats at the bottom as one box (toolbar + the panels that open above
          it) while the logo scrolls away with the page; elsewhere it is display: contents. */}
      <div
        className={styles.dock}
        data-header-dock
        data-footer-reached={footerReached || undefined}
      >
        {/* the event cards' 3D box (phones only; hidden elsewhere) */}
        <span className={styles.dockFrame}>
          <BoxSides />
        </span>
        <div className={`${styles.dockBody} ${boxLift}`}>
          <div
            className={styles.controls}
            aria-label={showFilterControls ? copy.filtersAria : copy.controlsAria}
            role="group"
          >
            <div className={styles.toolbar}>
              {showVenueControls && (
                // testing aid like venues (local builds only): rate event images at /dev/images/
                <GeneralButton
                  className={styles.imagesLink}
                  edge="first"
                  verticalPadding="full"
                  label="images"
                  href={`/dev/images/?city=${city}`}
                />
              )}
              {showVenueControls && (
                <GeneralButton
                  className={styles.venuesToggle}
                  verticalPadding="full"
                  label="venues"
                  showDot
                  pressed={venuesOpen || activeVenues.size > 0}
                  aria-expanded={venuesOpen}
                  aria-controls="site-header-venues"
                  onClick={() => {
                    setVenuesOpen((open) => !open);
                    setFilterOpen(false);
                    setCitiesOpen(false);
                  }}
                />
              )}
              {SOCIALS_ENABLED && (
                // local + preview builds: propose and approve Instagram posts at /dev/socials/
                <GeneralButton
                  className={styles.socialsLink}
                  edge={showVenueControls ? undefined : 'first'}
                  verticalPadding="full"
                  label="socials"
                  href={`/dev/socials/?city=${city}`}
                />
              )}
              {showFilterControls && (
                <GeneralButton
                  className={styles.filterToggle}
                  // the dev-only venues / socials buttons take the first slot on desktop (see the sass)
                  edge={showVenueControls || SOCIALS_ENABLED ? undefined : 'first'}
                  verticalPadding="full"
                  label={copy.filter}
                  showDot
                  pressed={filterOpen || filteringActive}
                  data-filter-disclosure
                  data-filtering-active={String(filteringActive)}
                  aria-expanded={filterOpen}
                  aria-controls="site-header-filters"
                  onClick={() => {
                    setFilterOpen((open) => !open);
                    setCitiesOpen(false);
                    setVenuesOpen(false);
                  }}
                />
              )}
              <GeneralButton
                edge={showFilterControls ? undefined : 'first'}
                verticalPadding="full"
                label={copy.map}
                showDot
                pressed={mapOpen}
                data-map-toggle
                aria-expanded={mapOpen}
                aria-controls="map-section"
                onClick={() => {
                  setFilterOpen(false);
                  setCitiesOpen(false);
                  setVenuesOpen(false);
                  onMapToggle();
                }}
              />
              {CITY_SWITCHER_ENABLED && (
                <GeneralButton
                  verticalPadding="full"
                  label={copy.cities}
                  showDot
                  pressed={citiesOpen}
                  aria-label={`${copy.cities}, ${copy.currentCity}: ${currentCityLabel}`}
                  data-city-disclosure
                  aria-expanded={citiesOpen}
                  aria-controls="site-header-cities"
                  onClick={() => {
                    setCitiesOpen((open) => !open);
                    setFilterOpen(false);
                    setVenuesOpen(false);
                  }}
                />
              )}
              {otherLocale && (
                <GeneralButton
                  verticalPadding="full"
                  href={routePathFor({ city, locale: otherLocale })}
                  hrefLang={otherLocale}
                  // warm the other language so the switch is instant; the page stays in place
                  prefetch
                  scroll={false}
                  label={otherLocale === 'en' ? 'eng' : 'jp'}
                  aria-label={`${copy.languageAria}: ${otherLocale === 'en' ? 'eng' : 'jp'}`}
                  onClick={() => {
                    persistPreference(city, otherLocale);
                    setLocaleHandoff({
                      locale: otherLocale,
                      mapOpen,
                      categories: Array.from(activeFilters),
                      timing: activeTiming,
                    });
                  }}
                />
              )}
              <div className={styles.icons}>
                <GridDensityControls />
                <ColorSchemeToggle />
              </div>
            </div>
          </div>
          {/* The panels sit outside the nav column so on phones they can span the header's full
              width under the logo (SiteHeader.module.sass); on desktop they stay right-aligned. */}
          {showVenueControls && (
            <DevVenuePanel
              venues={venues}
              open={venuesOpen}
              active={activeVenues}
              onToggle={(slug) =>
                setActiveVenues((current) => {
                  const next = new Set(current);
                  if (next.has(slug)) next.delete(slug);
                  else next.add(slug);
                  return next;
                })
              }
            />
          )}
          {showFilterControls && (
            <div
              className={styles.panel}
              id="site-header-filters"
              ref={filterPanelRef}
              data-filter-options
              data-open={filterOpen || undefined}
              aria-hidden={!filterOpen}
              inert={!filterOpen ? true : undefined}
            >
              {showSaved && (
                <div className={styles.group} role="group" aria-label="saved" data-saved-filter>
                  <GeneralButton
                    verticalPadding="full"
                    label={`${label('saved')} (${savedCount})`}
                    showDot
                    pressed={savedActive}
                    tabIndex={filterOpen ? undefined : -1}
                    data-panel-button
                    data-filter-button
                    data-filter-token={SAVED_FILTER_TOKEN}
                    onClick={() => setSavedActive((active) => !active)}
                  />
                </div>
              )}
              {filterOptions.timings.length > 0 && (
                <div className={styles.group} role="group" aria-label="when">
                  {filterOptions.timings.map((timing) => (
                    <GeneralButton
                      key={timing}
                      verticalPadding="full"
                      label={timingLabels[timing]}
                      showDot
                      pressed={activeTiming === timing}
                      tabIndex={filterOpen ? undefined : -1}
                      data-panel-button
                      data-filter-button
                      data-timing-button
                      data-timing={timing}
                      onClick={() =>
                        setActiveTiming((current) => (current === timing ? '' : timing))
                      }
                    />
                  ))}
                </div>
              )}
              {filterOptions.types.length > 0 && (
                <div className={styles.group} role="group" aria-label="type">
                  {filterOptions.types.map((type) => filterButton(`type:${type}`, label(type)))}
                </div>
              )}
              {subGroups.length > 0 && (
                <div className={styles.group} role="group" aria-label="subtype" data-sub-filters>
                  {subGroups.map((group) => (
                    <div
                      className={styles.subGroup}
                      role="group"
                      aria-label={label(group.type)}
                      key={group.type}
                    >
                      {group.subs.map((sub) =>
                        filterButton(`sub:${group.type}:${sub}`, label(sub)),
                      )}
                    </div>
                  ))}
                </div>
              )}
              {filterOptions.places.length > 0 && (
                <div className={styles.group} role="group" aria-label="venue">
                  {filterOptions.places.map((place) =>
                    filterButton(`place:${place}`, label(place)),
                  )}
                </div>
              )}
            </div>
          )}
          {CITY_SWITCHER_ENABLED && (
            <div
              className={styles.panel}
              id="site-header-cities"
              ref={cityPanelRef}
              data-city-options
              data-open={citiesOpen || undefined}
              aria-label={copy.citiesAria}
              role="group"
              aria-hidden={!citiesOpen}
              inert={!citiesOpen ? true : undefined}
            >
              {cityConfigs.map((target) => {
                const targetLocale = localeForCity(target, locale);
                return (
                  <GeneralButton
                    key={target.slug}
                    className={styles.cityButton}
                    verticalPadding="full"
                    href={routePathFor({ city: target.slug, locale: targetLocale })}
                    prefetch={citiesOpen && sharesRootLayout(target.slug, city)}
                    label={target.label}
                    showDot
                    tabIndex={citiesOpen ? undefined : -1}
                    data-panel-button
                    data-city-button
                    data-city-option={target.slug}
                    aria-current={target.slug === city ? 'page' : undefined}
                    onClick={() => {
                      persistPreference(target.slug, targetLocale);
                      if (target.slug !== city)
                        document.documentElement.setAttribute(ROUTE_PENDING_ATTR, '');
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
        <span className={styles.dockFrame}>
          <BoxEdge />
        </span>
      </div>
    </header>
  );
}
