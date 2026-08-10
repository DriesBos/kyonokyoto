'use client';

import type { AppCity } from '@/lib/cities';
import type { AppLocale } from '@/lib/i18n';
import { useMapExperience } from './MapExperience';
import SiteHeader, { type HeaderCategory } from './SiteHeader';

export default function ExperienceHeader({
  city,
  locale,
  brandLabel,
  categories,
}: {
  city: AppCity;
  locale: AppLocale;
  brandLabel: string;
  categories: HeaderCategory[];
}) {
  const { mapOpen, toggleMap } = useMapExperience();
  return (
    <SiteHeader
      city={city}
      locale={locale}
      brandLabel={brandLabel}
      categories={categories}
      mapOpen={mapOpen}
      onMapToggle={toggleMap}
    />
  );
}
