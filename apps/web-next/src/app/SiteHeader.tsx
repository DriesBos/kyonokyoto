'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  CITY_COOKIE,
  CITY_STORAGE_KEY,
  alternateLocaleForCity,
  cityConfigs,
  defaultLocaleForCity,
  type AppCity,
} from '@/lib/cities';
import { LOCALE_COOKIE, uiText, type AppLocale } from '@/lib/i18n';
import { routePathFor } from '@/lib/routeState';
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
  const [activeCategories, setActiveCategories] = useState<Set<string>>(() => new Set());
  const [activeTiming, setActiveTiming] = useState('');
  const copy = uiText[locale];
  const timingFilters = [
    { slug: 'ongoing', label: copy.ongoing },
    { slug: 'upcoming', label: copy.upcoming },
  ];
  const hasFilters = true;
  const homeHref = routePathFor({ city, locale });
  const otherLocale = alternateLocaleForCity(city, locale);

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
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);

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
      divider.toggleAttribute('hidden', visibleGroups < 2 || before?.hidden || after?.hidden);
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
    <header className={styles.header} ref={rootRef} data-category-filter data-main-header>
      <Link
        className={styles.logo}
        href={homeHref}
        aria-label={`${brandLabel} home`}
        onClick={() => persistPreference()}
      >
        <Wordmark label={brandLabel} />
      </Link>
      <div className={styles.controls} aria-label={copy.controlsAria} role="group">
        <div className={styles.toolbar}>
          {hasFilters && (
            <button
              className={styles.control}
              type="button"
              data-filter-button
              aria-pressed={filterOpen || activeCategories.size > 0 || Boolean(activeTiming)}
              aria-expanded={filterOpen}
              aria-controls="site-header-filters"
              onClick={() => {
                setFilterOpen((open) => !open);
                setCitiesOpen(false);
              }}
            >
              {copy.filter}
            </button>
          )}
          <button
            className={styles.control}
            type="button"
            aria-pressed={mapOpen}
            aria-expanded={mapOpen}
            aria-controls="map-section"
            onClick={onMapToggle}
          >
            {copy.map}
          </button>
          <button
            className={styles.control}
            type="button"
            data-city-button
            aria-pressed={citiesOpen}
            aria-expanded={citiesOpen}
            aria-controls="site-header-cities"
            onClick={() => {
              setCitiesOpen((open) => !open);
              setFilterOpen(false);
            }}
          >
            {copy.cities}
          </button>
          {otherLocale && (
            <Link
              className={styles.control}
              href={routePathFor({ city, locale: otherLocale })}
              hrefLang={otherLocale}
              aria-label={`Language: ${otherLocale === 'en' ? 'eng' : 'jp'}`}
              onClick={() => persistPreference(city, otherLocale)}
            >
              {otherLocale === 'en' ? 'eng' : 'jp'}
            </Link>
          )}
        </div>
        <div
          className={styles.panel}
          id="site-header-filters"
          aria-hidden={!filterOpen}
          inert={!filterOpen ? true : undefined}
          data-open={filterOpen || undefined}
        >
          {categories.map((category) => (
            <button
              className={styles.control}
              type="button"
              key={`${category.dimension}:${category.slug}`}
              data-category-button
              data-category={category.slug}
              data-category-dimension={category.dimension}
              aria-pressed={activeCategories.has(category.slug)}
              onClick={() => toggleCategory(category.slug)}
            >
              #{category.label}
            </button>
          ))}
          {timingFilters.map((timing) => (
            <button
              className={styles.control}
              type="button"
              key={timing.slug}
              data-timing-button
              data-timing={timing.slug}
              aria-pressed={activeTiming === timing.slug}
              onClick={() =>
                setActiveTiming((current) => (current === timing.slug ? '' : timing.slug))
              }
            >
              {timing.label}
            </button>
          ))}
        </div>
        <div
          className={styles.panel}
          id="site-header-cities"
          aria-label="Cities"
          aria-hidden={!citiesOpen}
          inert={!citiesOpen ? true : undefined}
          data-open={citiesOpen || undefined}
        >
          {cityConfigs.map((target) => {
            const targetLocale = target.locales.includes(locale)
              ? locale
              : defaultLocaleForCity(target);
            return (
              <Link
                className={styles.control}
                data-city-option
                href={routePathFor({ city: target.slug, locale: targetLocale })}
                key={target.slug}
                aria-current={target.slug === city ? 'page' : undefined}
                onClick={() => persistPreference(target.slug, targetLocale)}
              >
                {target.label}
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
