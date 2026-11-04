import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cityConfigFor, cityConfigs } from '@/lib/cities';
import { fetchCityEvents } from '@/lib/cityEvents';
import { DEV_PAGE_ENABLED } from '@/lib/devPage';
import { readLandingBlocklist } from '@/lib/landingBlocklistFile';
import LandingPicker from './LandingPicker';
import styles from './page.module.sass';

// Local-only review of the landing images: the crawler's AI verdict per image, plus a manual
// block list (data/landing-blocklist.json) for anything it gets wrong. Green outline = can show.
export const metadata: Metadata = {
  title: 'landing images | dev',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function LandingImagesPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  if (!DEV_PAGE_ENABLED) notFound();
  const city = cityConfigFor((await searchParams).city ?? 'kyoto') ?? cityConfigs[0];
  const [events, blocklist] = await Promise.all([
    fetchCityEvents({ city: city.slug, locale: 'en' }),
    readLandingBlocklist(),
  ]);
  const landingEvents = events
    .filter((event) => event.landingEligible && event.group !== 'permanent')
    .map((event) => ({
      id: event.id,
      title: event.title,
      institution: event.institution,
      images: event.images.map((image) => ({ url: image.url, landingOk: image.landingOk ?? null })),
    }))
    .filter((event) => event.images.length > 0);

  return (
    <main className={styles.main}>
      <h1>Landing images</h1>
      <nav className={styles.cities}>
        {cityConfigs.map((option) => (
          <Link
            key={option.slug}
            href={`/dev/landing/?city=${option.slug}`}
            aria-current={option.slug === city.slug ? 'page' : undefined}
          >
            {option.label}
          </Link>
        ))}
      </nav>
      <p className={styles.note}>
        Landing-slider sources only. Outlined images can show on the landing. Blocking writes
        data/landing-blocklist.json, which goes live with the next deploy.
      </p>
      <LandingPicker events={landingEvents} initialBlocklist={blocklist} />
    </main>
  );
}
