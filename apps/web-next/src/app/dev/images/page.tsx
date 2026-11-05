import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cityConfigFor, cityConfigs } from '@/lib/cities';
import { fetchCityEvents } from '@/lib/cityEvents';
import { DEV_PAGE_ENABLED } from '@/lib/devPage';
import { aiImageRank, isLeftOut } from '@/lib/imageRanking';
import { readImageRatings } from '@/lib/imageRatingsFile';
import { eventMediaDeliveryUrl } from '@/lib/mediaDelivery';
import ImageRater, { type ImageRaterImage } from './ImageRater';
import styles from './page.module.sass';

// Local-only: every event image of a city (each event's first three) with the crawler's AI tags
// and a manual -2..2 rating saved to data/image-ratings.json. Ratings override the site's ranking
// after deploy (lib/imageRanking.ts) and teach the crawler's AI (its latest +2/-2 are examples).
// The review queue puts the images that matter most first: shown on a card and the AI unsure.
export const metadata: Metadata = {
  title: 'images | dev',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const confidencePriority = { low: 3, medium: 1, high: 0 } as const;

export default async function ImagesPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  if (!DEV_PAGE_ENABLED) notFound();
  const city = cityConfigFor((await searchParams).city ?? 'kyoto') ?? cityConfigs[0];
  const [events, ratings] = await Promise.all([
    fetchCityEvents({ city: city.slug, locale: 'en', keepLeftOutImages: true }),
    readImageRatings(),
  ]);
  const images: ImageRaterImage[] = events.flatMap((event) => {
    const cardImage = event.images.find((image) => !isLeftOut(image)) ?? event.images[0];
    return event.images.map((image) => {
      const shownOnCard = image === cardImage;
      const unchecked = typeof image.landingOk !== 'boolean';
      return {
        url: image.url,
        // same delivery as the cards (Yutaka proxy, http -> https, CDN on Netlify)
        src: eventMediaDeliveryUrl(image.url) ?? image.url,
        eventId: event.id,
        eventLabel: `${event.institution}: ${event.title}`,
        landingOk: image.landingOk ?? null,
        subject: image.subject ?? null,
        busyness: image.busyness ?? null,
        score: image.score ?? null,
        confidence: image.confidence ?? null,
        aiRank: aiImageRank(image),
        shownOnCard,
        reviewPriority:
          (shownOnCard ? 4 : 0) +
          (image.confidence ? confidencePriority[image.confidence] : 0) +
          (unchecked ? 1 : 0) +
          (shownOnCard && image.landingOk === false ? 3 : 0),
      };
    });
  });

  return (
    <main className={styles.main}>
      <h1>Images</h1>
      <nav className={styles.cities}>
        {cityConfigs.map((option) => (
          <Link
            key={option.slug}
            href={`/dev/images/?city=${option.slug}`}
            aria-current={option.slug === city.slug ? 'page' : undefined}
          >
            {option.label}
          </Link>
        ))}
        <Link href={`/${city.slug}/`}>Back to {city.label}</Link>
      </nav>
      <p className={styles.note}>
        +2 preferred (front) · +1 keep · 0 neutral · −1 not preferred · −2 leave out (an event keeps
        one image if all are −2). Ratings save to data/image-ratings.json, change the site after
        deploy, and teach the crawler&apos;s AI (run images:recheck to re-tag stored images).
      </p>
      <ImageRater images={images} initialRatings={ratings} />
    </main>
  );
}
