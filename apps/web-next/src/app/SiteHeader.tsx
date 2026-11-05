'use client';

import { gsap } from 'gsap';
import Link from 'next/link';
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CITY_COOKIE,
  CITY_STORAGE_KEY,
  alternateLocaleForCity,
  cityConfigs,
  defaultLocaleForCity,
  type AppCity,
} from '@/lib/cities';
import { LOCALE_COOKIE, uiText, type AppLocale } from '@/lib/i18n';
import { CATEGORY_DIMENSIONS } from '../../../../data/categories.mjs';
import {
  fadeIn,
  fadeOut,
  killFadeTransitionTweens,
  setFadeHidden,
  setFadeVisible,
} from '@/lib/fadeTransition';
import {
  createHeightTransitionTimeline,
  killHeightTransitionTweens,
  toHeight,
} from '@/lib/heightTransition';
import { readLocaleHandoff, restoreLocaleHandoff, setLocaleHandoff } from '@/lib/localeHandoff';
import { routePathFor } from '@/lib/routeState';
import ColorSchemeToggle from './ColorSchemeToggle';
import GeneralButton from './GeneralButton';
import GridDensityControls from './GridDensityControls';
import { BoxEdge, BoxSides, boxLift } from './blocks/BoxFrame';
import styles from './SiteHeader.module.sass';

export type HeaderCategory = { slug: string; label: string; dimension: string };
// Local builds only (testing aid): filter the grid by source.
export type HeaderVenue = { slug: string; label: string; count: number };

type SiteHeaderProps = {
  city: AppCity;
  locale: AppLocale;
  brandLabel: string;
  categories?: HeaderCategory[];
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

function Wordmark({ label }: { label: string }) {
  if (label !== 'Kyō-no-Kyōto') return <span className={styles.wordmark}>{label}</span>;

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 251 48" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        d="M24.344 8.67 10.768 23.167 24.344 38h-4.902L7.165 24.383V38H3.352V8.67h3.813v13.701L19.484 8.67zm15.193 10.014h3.603v19.693c0 3.059-.922 5.405-2.598 6.956-1.55 1.34-3.687 2.095-6.327 2.095-2.765 0-5.028-.713-6.536-2.012-1.383-1.173-2.137-2.849-2.179-4.986h3.645c.168 2.347 1.425 3.939 5.028 3.939 3.269 0 5.364-1.844 5.364-6.243v-3.604c-1.132 2.347-3.436 3.939-6.704 3.939-5.028 0-7.333-3.352-7.333-8.254V18.684h3.604v10.768c0 3.436 1.13 5.783 4.944 5.783 3.729 0 5.489-3.143 5.489-6.62zm10.91-3.939v-2.932H63.77v2.932zm6.704 23.758c-6.285 0-10.056-4.525-10.056-10.14 0-5.657 3.77-10.182 10.056-10.182 6.243 0 10.056 4.525 10.056 10.182 0 5.615-3.813 10.14-10.056 10.14m0-3.268c4.064 0 6.41-3.017 6.41-6.872 0-3.897-2.346-6.913-6.41-6.913-4.065 0-6.453 3.016-6.453 6.913 0 3.855 2.388 6.872 6.453 6.872m12.975-6.579v-3.268h12.78v3.268zM87.396 38V18.684h3.645v3.562c1.048-2.472 3.394-4.065 6.746-4.065 4.735 0 7.165 2.766 7.165 7.92V38h-3.603V27.693c0-4.316-1.425-6.37-4.86-6.37-3.604 0-5.448 2.557-5.448 6.453V38zm31.318.503c-6.285 0-10.056-4.525-10.056-10.14 0-5.657 3.771-10.182 10.056-10.182 6.243 0 10.056 4.525 10.056 10.182 0 5.615-3.813 10.14-10.056 10.14m0-3.268c4.064 0 6.411-3.017 6.411-6.872 0-3.897-2.347-6.913-6.411-6.913s-6.452 3.016-6.452 6.913c0 3.855 2.388 6.872 6.452 6.872m12.976-6.579v-3.268h12.78v3.268zM170.161 8.67l-13.576 14.497L170.161 38h-4.902l-12.277-13.617V38h-3.813V8.67h3.813v13.701L165.3 8.67zm15.192 10.014h3.604v19.693c0 3.059-.922 5.405-2.598 6.956-1.55 1.34-3.687 2.095-6.327 2.095-2.765 0-5.028-.713-6.536-2.012-1.383-1.173-2.137-2.849-2.179-4.986h3.645c.168 2.347 1.425 3.939 5.028 3.939 3.268 0 5.363-1.844 5.363-6.243v-3.604c-1.131 2.347-3.435 3.939-6.704 3.939-5.028 0-7.332-3.352-7.332-8.254V18.684h3.603v10.768c0 3.436 1.132 5.783 4.945 5.783 3.729 0 5.488-3.143 5.488-6.62zm10.911-3.939v-2.932h13.324v2.932zm6.704 23.758c-6.285 0-10.056-4.525-10.056-10.14 0-5.657 3.771-10.182 10.056-10.182 6.243 0 10.056 4.525 10.056 10.182 0 5.615-3.813 10.14-10.056 10.14m0-3.268c4.064 0 6.41-3.017 6.41-6.872 0-3.897-2.346-6.913-6.41-6.913-4.065 0-6.453 3.016-6.453 6.913 0 3.855 2.388 6.872 6.453 6.872m21.82-.252c.713 0 1.886-.125 2.43-.251v3.226c-.712.168-2.011.293-3.268.293-2.262 0-5.908-.419-5.908-6.662v-9.846h-3.477v-3.059h3.477v-6.117h3.646v6.117h4.86v3.059h-4.86v9.05c0 3.687 1.257 4.19 3.1 4.19m14.271 3.52c-6.285 0-10.056-4.525-10.056-10.14 0-5.657 3.771-10.182 10.056-10.182 6.243 0 10.056 4.525 10.056 10.182 0 5.615-3.813 10.14-10.056 10.14m0-3.268c4.064 0 6.411-3.017 6.411-6.872 0-3.897-2.347-6.913-6.411-6.913s-6.453 3.016-6.453 6.913c0 3.855 2.389 6.872 6.453 6.872M25.5 11.699h4v3h-4zM39.5 11.699H43v3h-3.5zM171.7 11.699h4v3h-4zM185.7 11.699h3.5v3h-3.5z"
      />
    </svg>
  );
}

// Height + fade disclosure from apps/web headerControls: the panel grows to its content height
// while its buttons fade in with a stagger, and collapses back to 0 with a fade out.
function useDisclosurePanel(open: boolean) {
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const buttons = Array.from(panel.querySelectorAll<HTMLElement>('[data-panel-button]'));
    killHeightTransitionTweens(panel);
    killFadeTransitionTweens(buttons);

    if (!mounted.current) {
      mounted.current = true;
      panel.style.height = open ? 'auto' : '0px';
      panel.style.overflow = open ? '' : 'hidden';
      if (open) setFadeVisible(buttons);
      else setFadeHidden(buttons);
      return;
    }

    panel.style.height = `${panel.offsetHeight}px`;
    panel.style.overflow = 'hidden';
    if (open) setFadeHidden(buttons);
    else fadeOut(buttons);
    const timeline = createHeightTransitionTimeline({
      onComplete: () => {
        panel.style.height = open ? 'auto' : '0px';
        panel.style.overflow = open ? '' : 'hidden';
      },
    });
    toHeight(timeline, panel, open ? panel.scrollHeight : 0, open, 0);
    if (open) fadeIn(buttons, { delay: 0.06 });
    return () => {
      timeline.kill();
    };
  }, [open]);

  return panelRef;
}

// Compact header: small logo + divider line. It is either on or off, never in between, and both
// ways animate with the same tween, so a fast scroll and opening the map look alike. Compact
// once the page scrolls past COMPACT_AT, back to full only under EXPAND_BELOW (no flicker at
// the top), and always while the map is open above phones. --header-shrink runs 0 → 1.
const COMPACT_AT = 24;
const EXPAND_BELOW = 8;
const COMPACT_DURATION = 0.35;

function useHeaderCompact(rootRef: RefObject<HTMLElement | null>, mapOpen: boolean) {
  // kept across map toggles so the effect re-run animates from the current state
  const compactRef = useRef<boolean | null>(null);

  useEffect(() => {
    const header = rootRef.current;
    if (!header) return;
    const desktop = window.matchMedia('(min-width: 769px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const apply = (compact: boolean) => {
      if (compact === compactRef.current) return;
      const first = compactRef.current === null;
      compactRef.current = compact;
      const value = compact ? 1 : 0;
      if (first || reducedMotion.matches) {
        gsap.killTweensOf(header);
        gsap.set(header, { '--header-shrink': value });
        return;
      }
      gsap.to(header, {
        '--header-shrink': value,
        duration: COMPACT_DURATION,
        ease: 'power3.out',
        overwrite: true,
      });
    };

    const update = () => {
      if (mapOpen && desktop.matches) return apply(true);
      const root = scrollRoot();
      const top = root ? root.scrollTop : window.scrollY;
      apply(compactRef.current ? top > EXPAND_BELOW : top >= COMPACT_AT);
    };

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    update();
    // capture catches the window and the events panel (its own scroller while the map is open)
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    document.addEventListener('map-layout:updated', schedule);
    desktop.addEventListener('change', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, { capture: true });
      document.removeEventListener('map-layout:updated', schedule);
      desktop.removeEventListener('change', schedule);
    };
  }, [rootRef, mapOpen]);

  useEffect(() => {
    const header = rootRef.current;
    return () => {
      if (header) gsap.killTweensOf(header);
    };
  }, [rootRef]);
}

const scrollRoot = () => {
  const events = document.querySelector<HTMLElement>('[data-events-section]');
  if (!events) return null;
  const overflowY = getComputedStyle(events).overflowY;
  return overflowY !== 'visible' &&
    overflowY !== 'clip' &&
    events.scrollHeight > events.clientHeight + 1
    ? events
    : null;
};

const singleLocale = (slug: AppCity) =>
  cityConfigs.find((config) => config.slug === slug)?.locales.length === 1;
const sharesRootLayout = (a: AppCity, b: AppCity) => singleLocale(a) === singleLocale(b);

const localeForCity = (target: (typeof cityConfigs)[number], locale: AppLocale) =>
  target.locales.includes(locale) ? locale : defaultLocaleForCity(target);

export default function SiteHeader({
  city,
  locale,
  brandLabel,
  categories = [],
  venues = [],
  mapOpen,
  onMapToggle,
}: SiteHeaderProps) {
  const rootRef = useRef<HTMLElement>(null);
  // set when this page was reached through the language switch (lib/localeHandoff)
  const [handoff] = useState(() => readLocaleHandoff(locale));
  const [filterOpen, setFilterOpen] = useState(false);
  const [citiesOpen, setCitiesOpen] = useState(false);
  const [venuesOpen, setVenuesOpen] = useState(false);
  const [activeVenues, setActiveVenues] = useState<Set<string>>(() => new Set());
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    () => new Set(handoff?.categories),
  );
  const [activeTiming, setActiveTiming] = useState(handoff?.timing ?? '');
  // apps/web keeps the header controls in English in every locale.
  const copy = uiText.en;
  const timingFilters = [
    { slug: 'ongoing', label: copy.ongoing },
    { slug: 'upcoming', label: copy.upcoming },
  ];
  const categoryGroups = CATEGORY_DIMENSIONS.map((dimension) => ({
    dimension,
    categories: categories.filter((category) => category.dimension === dimension),
  })).filter((group) => group.categories.length > 0);
  const showFilterControls = categories.length > 0 || timingFilters.length > 0;
  const filteringActive = activeCategories.size > 0 || Boolean(activeTiming);
  const homeHref = routePathFor({ city, locale });
  const otherLocale = alternateLocaleForCity(city, locale);
  const currentCityLabel = cityConfigs.find((config) => config.slug === city)?.label ?? city;
  const filterPanelRef = useDisclosurePanel(filterOpen);
  const cityPanelRef = useDisclosurePanel(citiesOpen);
  const venuePanelRef = useDisclosurePanel(venuesOpen);
  const showVenueControls = venues.length > 0;
  const mapOpenRef = useRef(mapOpen);
  mapOpenRef.current = mapOpen;

  useEffect(() => {
    document.cookie = `${CITY_COOKIE}=${encodeURIComponent(city)}; path=/; max-age=31536000; samesite=lax`;
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=31536000; samesite=lax`;
    window.localStorage.setItem(CITY_STORAGE_KEY, city);
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

  useEffect(() => {
    const activeByDimension = new Map<string, Set<string>>();
    categories.forEach(({ slug, dimension }) => {
      if (!activeCategories.has(slug)) return;
      const selected = activeByDimension.get(dimension) ?? new Set<string>();
      selected.add(slug);
      activeByDimension.set(dimension, selected);
    });
    const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-event-group]'));
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-event-card]'));
    let visibleGroups = 0;

    cards.forEach((card) => {
      const cardCategories = new Set(
        (card.dataset.categories ?? '')
          .split('|')
          .map((item) => item.trim())
          .filter(Boolean),
      );
      const timing =
        card.dataset.timing ??
        card.closest<HTMLElement>('[data-event-group]')?.dataset.eventGroupName ??
        '';
      const categoryMatches = Array.from(activeByDimension.values()).every((selected) =>
        Array.from(selected).some((slug) => cardCategories.has(slug)),
      );
      const venueMatches = activeVenues.size === 0 || activeVenues.has(card.dataset.source ?? '');
      const matches = categoryMatches && venueMatches && (!activeTiming || timing === activeTiming);
      card.toggleAttribute('hidden', !matches);
    });
    groups.forEach((group) => {
      const visible = Boolean(group.querySelector('[data-event-card]:not([hidden])'));
      group.toggleAttribute('hidden', !visible);
      if (visible) visibleGroups += 1;
    });
    document.querySelectorAll<HTMLElement>('[data-event-divider]').forEach((divider) => {
      const before = groups.find(
        (group) => group.dataset.eventGroupName === divider.dataset.beforeGroup,
      );
      const after = groups.find(
        (group) => group.dataset.eventGroupName === divider.dataset.afterGroup,
      );
      divider.toggleAttribute(
        'hidden',
        visibleGroups < 2 || Boolean(before?.hidden) || Boolean(after?.hidden),
      );
    });
    document
      .querySelector<HTMLElement>('[data-filter-empty]')
      ?.toggleAttribute('hidden', visibleGroups > 0);
    document.dispatchEvent(new CustomEvent('event-filter:updated'));
  }, [activeCategories, activeTiming, activeVenues, categories]);

  // After a language switch, put the reader back on the card they were looking at, once the
  // filter effect above (same commit, runs first) has hidden what it hides. React may keep this
  // header (and its state) across the switch or mount a fresh one, so this keys on the locale.
  useEffect(() => {
    const pending = readLocaleHandoff(locale);
    if (pending) restoreLocaleHandoff(pending);
  }, [locale]);

  const toggleCategory = (slug: string) => {
    setActiveCategories((current) => {
      const next = new Set(current);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  };
  const persistPreference = (nextCity = city, nextLocale = locale) => {
    document.cookie = `${CITY_COOKIE}=${encodeURIComponent(nextCity)}; path=/; max-age=31536000; samesite=lax`;
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(nextLocale)}; path=/; max-age=31536000; samesite=lax`;
    window.localStorage.setItem(CITY_STORAGE_KEY, nextCity);
  };

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
        onClick={() => persistPreference()}
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
              {showFilterControls && (
                <GeneralButton
                  className={styles.filterToggle}
                  // the dev-only venues button takes the first slot on desktop (see the sass)
                  edge={showVenueControls ? undefined : 'first'}
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
                      categories: Array.from(activeCategories),
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
            <div
              className={`${styles.panel} ${styles.venuesPanel}`}
              id="site-header-venues"
              ref={venuePanelRef}
              data-open={venuesOpen || undefined}
              aria-label="venues"
              role="group"
              aria-hidden={!venuesOpen}
              inert={!venuesOpen ? true : undefined}
            >
              {venues.map((venue) => (
                <GeneralButton
                  key={venue.slug}
                  verticalPadding="full"
                  label={`${venue.label} (${venue.count})`}
                  showDot
                  pressed={activeVenues.has(venue.slug)}
                  tabIndex={venuesOpen ? undefined : -1}
                  data-panel-button
                  data-venue={venue.slug}
                  onClick={() =>
                    setActiveVenues((current) => {
                      const next = new Set(current);
                      next.has(venue.slug) ? next.delete(venue.slug) : next.add(venue.slug);
                      return next;
                    })
                  }
                />
              ))}
            </div>
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
              {categoryGroups.map((group) => (
                <div
                  className={styles.group}
                  role="group"
                  aria-label={
                    group.dimension === 'collection'
                      ? uiText[locale].collections
                      : group.dimension.replace('_category', '')
                  }
                  key={group.dimension}
                >
                  {group.categories.map((category) => (
                    <GeneralButton
                      key={category.slug}
                      verticalPadding="full"
                      label={`#${category.label}`}
                      showDot
                      pressed={activeCategories.has(category.slug)}
                      tabIndex={filterOpen ? undefined : -1}
                      data-panel-button
                      data-filter-button
                      data-category-button
                      data-category={category.slug}
                      data-category-dimension={category.dimension}
                      onClick={() => toggleCategory(category.slug)}
                    />
                  ))}
                </div>
              ))}
              {timingFilters.map((timing) => (
                <GeneralButton
                  key={timing.slug}
                  verticalPadding="full"
                  label={timing.label}
                  showDot
                  pressed={activeTiming === timing.slug}
                  tabIndex={filterOpen ? undefined : -1}
                  data-panel-button
                  data-filter-button
                  data-timing-button
                  data-timing={timing.slug}
                  onClick={() =>
                    setActiveTiming((current) => (current === timing.slug ? '' : timing.slug))
                  }
                />
              ))}
            </div>
          )}
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
        </div>
        <span className={styles.dockFrame}>
          <BoxEdge />
        </span>
      </div>
    </header>
  );
}
