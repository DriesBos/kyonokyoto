'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { routePathFor } from '@/lib/routeState';
import GeneralButton from './GeneralButton';
import styles from './SiteHeader.module.sass';

export type HeaderCategory = { slug: string; label: string; dimension: string };

type SiteHeaderProps = {
  city: AppCity;
  locale: AppLocale;
  brandLabel: string;
  categories?: HeaderCategory[];
  mapOpen: boolean;
  onMapToggle: () => void;
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

export default function SiteHeader({
  city,
  locale,
  brandLabel,
  categories = [],
  mapOpen,
  onMapToggle,
}: SiteHeaderProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [citiesOpen, setCitiesOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(() => new Set());
  const [activeTiming, setActiveTiming] = useState('');
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
  const mapOpenRef = useRef(mapOpen);
  mapOpenRef.current = mapOpen;

  useEffect(() => {
    document.cookie = `${CITY_COOKIE}=${encodeURIComponent(city)}; path=/; max-age=31536000; samesite=lax`;
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=31536000; samesite=lax`;
    window.localStorage.setItem(CITY_STORAGE_KEY, city);
  }, [city, locale]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setFilterOpen(false);
      setCitiesOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setFilterOpen(false);
      setCitiesOpen(false);
      if (mapOpenRef.current) onMapToggle();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [onMapToggle]);

  // The divider line and the smaller logo appear once the sticky header reaches the top.
  useEffect(() => {
    const target = scrollRoot() ?? window;
    const sync = () => {
      const header = rootRef.current;
      if (!header) return;
      const root = scrollRoot();
      const rootTop = root ? root.getBoundingClientRect().top : 0;
      const pagePaddingY = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--page-padding-y'),
      );
      setStuck(
        header.getBoundingClientRect().top <=
          rootTop + (Number.isFinite(pagePaddingY) ? pagePaddingY : 0) + 0.5,
      );
    };
    sync();
    target.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      target.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [mapOpen]);

  // Open panels close once the page has scrolled half a viewport away from where they opened.
  useEffect(() => {
    if (!filterOpen && !citiesOpen) return;
    const root = scrollRoot();
    const target = root ?? window;
    const scrollTop = () => (root ? root.scrollTop : window.scrollY);
    const viewport = () => (root ? root.clientHeight : window.innerHeight);
    const origin = scrollTop();
    const onScroll = () => {
      if (Math.abs(scrollTop() - origin) <= viewport() * 0.5) return;
      setFilterOpen(false);
      setCitiesOpen(false);
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => target.removeEventListener('scroll', onScroll);
  }, [filterOpen, citiesOpen]);

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
      const matches = categoryMatches && (!activeTiming || timing === activeTiming);
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
  }, [activeCategories, activeTiming, categories]);

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
      data-stuck={stuck || undefined}
    >
      <Link
        className={styles.logo}
        href={homeHref}
        aria-label={`${brandLabel} home`}
        onClick={() => persistPreference()}
      >
        <Wordmark label={brandLabel} />
      </Link>
      <div
        className={styles.controls}
        aria-label={showFilterControls ? copy.filtersAria : copy.controlsAria}
        role="group"
      >
        <div className={styles.toolbar}>
          {showFilterControls && (
            <GeneralButton
              className={styles.filterToggle}
              edge="first"
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
              onMapToggle();
            }}
          />
          <GeneralButton
            edge={otherLocale ? undefined : 'last'}
            verticalPadding="full"
            label={copy.cities}
            showDot
            pressed={citiesOpen}
            aria-label={`Choose city. Current city: ${currentCityLabel}`}
            data-city-disclosure
            aria-expanded={citiesOpen}
            aria-controls="site-header-cities"
            onClick={() => {
              setCitiesOpen((open) => !open);
              setFilterOpen(false);
            }}
          />
          {otherLocale && (
            <GeneralButton
              edge="last"
              verticalPadding="full"
              href={routePathFor({ city, locale: otherLocale })}
              hrefLang={otherLocale}
              label={otherLocale === 'en' ? 'eng' : 'jp'}
              aria-label={`${copy.languageAria}: ${otherLocale === 'en' ? 'eng' : 'jp'}`}
              onClick={() => persistPreference(city, otherLocale)}
            />
          )}
        </div>
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
                aria-label={group.dimension.replace('_category', '')}
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
          aria-label="Cities"
          role="group"
          aria-hidden={!citiesOpen}
          inert={!citiesOpen ? true : undefined}
        >
          {cityConfigs.map((target) => {
            const targetLocale = target.locales.includes(locale)
              ? locale
              : defaultLocaleForCity(target);
            return (
              <GeneralButton
                key={target.slug}
                className={styles.cityButton}
                verticalPadding="full"
                href={routePathFor({ city: target.slug, locale: targetLocale })}
                label={target.label}
                showDot
                tabIndex={citiesOpen ? undefined : -1}
                data-panel-button
                data-city-button
                data-city-option={target.slug}
                aria-current={target.slug === city ? 'page' : undefined}
                onClick={() => persistPreference(target.slug, targetLocale)}
              />
            );
          })}
        </div>
      </div>
    </header>
  );
}
