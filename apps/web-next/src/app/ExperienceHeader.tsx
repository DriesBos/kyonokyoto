'use client';

import type { AppCity } from '@/lib/cities';
import type { FilterOptions } from '@/lib/cityEvents';
import type { AppLocale } from '@/lib/i18n';
import { useMapExperience } from './MapExperience';
import SiteHeader, { type HeaderVenue } from './SiteHeader';

export default function ExperienceHeader({
  city,
  locale,
  brandLabel,
  filterOptions,
  defaultFilters,
  venues,
}: {
  city: AppCity;
  locale: AppLocale;
  brandLabel: string;
  filterOptions: FilterOptions;
  defaultFilters?: readonly string[];
  venues?: HeaderVenue[];
}) {
  const { mapOpen, toggleMap } = useMapExperience();
  return (
    <SiteHeader
      city={city}
      locale={locale}
      brandLabel={brandLabel}
      filterOptions={filterOptions}
      defaultFilters={defaultFilters}
      venues={venues}
      mapOpen={mapOpen}
      onMapToggle={toggleMap}
    />
  );
}
