import Link from 'next/link';
import { cityConfigFor, defaultLocaleForCity, type AppCity } from '@/lib/cities';
import type { AppLocale } from '@/lib/i18n';
import { routePathFor } from '@/lib/routeState';
import styles from './FestivalPage.module.sass';

const copy = {
  en: { title: 'Page not found', back: (city: string) => `Back to ${city} events` },
  ja: { title: 'ページが見つかりません', back: (city: string) => `${city}のイベントへ戻る` },
} as const;

export default function NotFoundContent({
  city = 'kyoto',
  locale,
}: {
  city?: AppCity;
  locale?: AppLocale;
}) {
  const config = cityConfigFor(city)!;
  const language = locale ?? defaultLocaleForCity(config);
  const labels = copy[language];
  return (
    <main className={styles.page} data-not-found>
      <header className={styles.header}>
        <h1>{labels.title}</h1>
        <Link href={routePathFor({ city: config.slug, locale: language })} prefetch={false}>
          {labels.back(config.label)}
        </Link>
      </header>
    </main>
  );
}
