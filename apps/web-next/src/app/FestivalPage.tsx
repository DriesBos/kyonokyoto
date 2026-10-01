import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/app/SiteFooter';
import { EventCardActions } from '@/app/EventCardDetail';
import type { CityConfig } from '@/lib/cities';
import { eventMediaDeliverySrcSet, eventMediaDeliveryUrl } from '@/lib/mediaDelivery';
import { fetchFestivalDetail } from '@/lib/cityEvents';
import { festivalPathFor } from '@/lib/festivalRoutes';
import type { AppLocale } from '@/lib/i18n';
import { routePathFor } from '@/lib/routeState';
import styles from './FestivalPage.module.sass';

const copy = {
  en: { events: 'events', website: 'Festival website', year: 'Edition' },
  ja: { events: 'イベント', website: 'フェスティバル公式サイト', year: '開催年' },
} as const;

export default async function FestivalPage({
  city,
  locale,
  slug,
}: {
  city: CityConfig;
  locale: AppLocale;
  slug: string;
}) {
  const detail = await fetchFestivalDetail({ city: city.slug, locale, slug });
  if (!detail) notFound();

  const { festival } = detail;
  const labels = copy[locale];
  const alternateLocale = city.locales.find((language) => language !== locale);
  const cover = festival.images[0];
  const previews = festival.images.slice(1, 5);

  return (
    <main className={styles.page} data-festival-page>
      <nav className={styles.navigation} aria-label="Breadcrumb">
        <Link href={routePathFor({ city: city.slug, locale })}>
          {city.label} {labels.events}
        </Link>
        {alternateLocale && (
          <Link
            href={festivalPathFor(city.slug, alternateLocale, festival.slug)}
            hrefLang={alternateLocale}
            lang={alternateLocale}
          >
            {alternateLocale === 'ja' ? '日本語' : 'English'}
          </Link>
        )}
      </nav>

      {cover && festival.sourceUrl && (
        <a
          className={styles.cover}
          href={festival.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${festival.name} ${labels.website}`}
        >
          <img
            src={eventMediaDeliveryUrl(cover.url) ?? undefined}
            srcSet={eventMediaDeliverySrcSet(cover.url) ?? undefined}
            width={cover.width ?? undefined}
            height={cover.height ?? undefined}
            alt={festival.title}
            fetchPriority="high"
          />
        </a>
      )}

      <header className={styles.header}>
        <p className={styles.date}>{festival.date}</p>
        <p className={styles.edition}>
          {festival.name}
          {festival.year && (
            <span>
              {labels.year}: {festival.year}
            </span>
          )}
        </p>
        <h1>{festival.title}</h1>
        {festival.description && <p className={styles.description}>{festival.description}</p>}
        <EventCardActions
          googleCalendarUrl={festival.googleCalendarUrl}
          appleCalendar={festival.appleCalendar}
          sourceUrl={festival.sourceUrl}
          locale={locale}
        />
      </header>

      {previews.length > 0 && festival.sourceUrl && (
        <section className={styles.gallery} aria-label={festival.title}>
          {previews.map((image, index) => (
            <a
              href={festival.sourceUrl!}
              target="_blank"
              rel="noopener noreferrer"
              key={image.url}
              aria-label={`${festival.name} ${labels.website}`}
            >
              <img
                src={eventMediaDeliveryUrl(image.url) ?? undefined}
                srcSet={eventMediaDeliverySrcSet(image.url) ?? undefined}
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                alt={`${festival.title} preview ${index + 1}`}
                loading="lazy"
              />
            </a>
          ))}
        </section>
      )}
      <SiteFooter cityLabel={city.label} locale={locale} />
    </main>
  );
}
