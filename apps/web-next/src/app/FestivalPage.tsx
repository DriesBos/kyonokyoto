import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/app/SiteFooter';
import type { CityConfig } from '@/lib/cities';
import { fetchFestivalDetail } from '@/lib/cityEvents';
import { festivalPathFor } from '@/lib/festivalRoutes';
import type { AppLocale } from '@/lib/i18n';
import { routePathFor } from '@/lib/routeState';
import styles from './FestivalPage.module.sass';

const copy = {
  en: {
    events: 'events',
    website: 'Festival website',
    programme: 'Programme',
    details: 'Details',
    comingSoon: 'Programme details coming soon.',
  },
  ja: {
    events: 'イベント',
    website: 'フェスティバル公式サイト',
    programme: 'プログラム',
    details: '詳細',
    comingSoon: 'プログラム詳細は近日公開予定です。',
  },
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

  const { festival, programs } = detail;
  const labels = copy[locale];
  const alternateLocale = city.locales.find((language) => language !== locale);

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

      <header className={styles.header}>
        <p className={styles.date}>{festival.date}</p>
        <h1>{festival.title}</h1>
        {festival.description && <p className={styles.description}>{festival.description}</p>}
        {festival.sourceUrl && (
          <a href={festival.sourceUrl} target="_blank" rel="noopener noreferrer">
            {labels.website} ↗
          </a>
        )}
      </header>

      <section className={styles.programme} aria-labelledby="festival-programme-heading">
        <h2 id="festival-programme-heading">
          {labels.programme} <span>({programs.length})</span>
        </h2>
        {programs.length ? (
          <ol className={styles.programmes}>
            {programs.map((program) => (
              <li key={program.id}>
                <div className={styles.meta}>
                  <span>{program.date}</span>
                  {(program.venue || program.institution) && (
                    <span>{program.venue || program.institution}</span>
                  )}
                </div>
                <h3>{program.title}</h3>
                {program.description && <p>{program.description}</p>}
                {program.sourceUrl && (
                  <a href={program.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {labels.details} ↗
                  </a>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p>{labels.comingSoon}</p>
        )}
      </section>
      <SiteFooter cityLabel={city.label} locale={locale} />
    </main>
  );
}
