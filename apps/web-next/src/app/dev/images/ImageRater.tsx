'use client';

import { useState } from 'react';
import type { ImageRating } from '@/lib/imageRanking';
import styles from './page.module.sass';

export type ImageRaterImage = {
  url: string;
  src: string;
  eventId: string;
  eventLabel: string;
  landingOk: boolean | null;
  subject: string | null;
  busyness: string | null;
  score: number | null;
  confidence: string | null;
  /** rank from the AI tags alone (lib/imageRanking.ts), > 0 = the AI likes it */
  aiRank: number;
  shownOnCard: boolean;
  reviewPriority: number;
};

type View = 'queue' | 'events' | ImageRating;
const RATINGS: ImageRating[] = [-2, -1, 0, 1, 2];
const ratingLabel = (rating: number) =>
  rating > 0 ? `+${rating}` : rating < 0 ? `−${-rating}` : '0';

const aiLabel = ({ landingOk, subject, busyness, score, confidence, aiRank }: ImageRaterImage) => {
  if (landingOk === null) return 'AI: unchecked';
  const tags = [landingOk ? 'clean' : 'not clean', subject, busyness, score && `${score}/10`];
  const sure = confidence && confidence !== 'high' ? ` · ${confidence} confidence` : '';
  return `AI: ${tags.filter(Boolean).join(' · ')}${sure} → ${aiRank.toFixed(1)}`;
};

// A rated, AI-checked image agrees when the AI leans the same way: liked (+1/+2) and AI rank > 0,
// or disliked (-1/-2) and AI rank <= 0.
const agreement = (images: ImageRaterImage[], ratings: Record<string, ImageRating>) => {
  const rated = images.filter((image) => ratings[image.url] && image.landingOk !== null);
  const agreeing = rated.filter((image) =>
    ratings[image.url] > 0 ? image.aiRank > 0 : image.aiRank <= 0,
  );
  return { rated: rated.length, agreeing: agreeing.length };
};

export default function ImageRater({
  images,
  initialRatings,
}: {
  images: ImageRaterImage[];
  initialRatings: Record<string, ImageRating>;
}) {
  const [ratings, setRatings] = useState(initialRatings);
  const [view, setView] = useState<View>('queue');
  const [error, setError] = useState<string | null>(null);

  const rate = async (url: string, rating: ImageRating) => {
    setError(null);
    const previous = ratings;
    setRatings((current) => {
      const next = { ...current };
      delete next[url];
      if (rating !== 0) next[url] = rating;
      return next;
    });
    const response = await fetch('/api/dev/image-ratings/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, rating }),
    });
    if (response.ok) setRatings(await response.json());
    else {
      setRatings(previous);
      setError(`Saving failed (${response.status})`);
    }
  };

  const unique = images.filter(
    (image, index) => images.findIndex((other) => other.url === image.url) === index,
  );
  const ratingOf = (image: ImageRaterImage) => ratings[image.url] ?? 0;
  const queue = unique
    .filter((image) => !ratings[image.url])
    .toSorted((left, right) => right.reviewPriority - left.reviewPriority);
  const { rated, agreeing } = agreement(unique, ratings);

  const views: [View, string, number][] = [
    ['queue', 'review queue', queue.length],
    ['events', 'all by event', unique.length],
    ...[2, 1, -1, -2].map(
      (value) =>
        [
          value as ImageRating,
          ratingLabel(value),
          unique.filter((image) => ratingOf(image) === value).length,
        ] as [View, string, number],
    ),
  ];

  const card = (image: ImageRaterImage, showEvent: boolean) => {
    const rating = ratingOf(image);
    return (
      <figure key={image.url} className={styles.image} data-rating={rating}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {/* no referrer: some museum hosts block hotlinks from other sites */}
        <img src={image.src} alt="" loading="lazy" referrerPolicy="no-referrer" />
        <figcaption>
          {showEvent && <span className={styles.eventLabel}>{image.eventLabel}</span>}
          <span>
            {aiLabel(image)}
            {image.shownOnCard ? ' · on card' : ''}
          </span>
          <span className={styles.ratings} role="group" aria-label="Rating">
            {RATINGS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={rating === value}
                onClick={() => rate(image.url, value)}
              >
                {ratingLabel(value)}
              </button>
            ))}
          </span>
        </figcaption>
      </figure>
    );
  };

  const events = [...new Set(unique.map((image) => image.eventId))].map((eventId) =>
    unique.filter((image) => image.eventId === eventId),
  );

  return (
    <div className={styles.events}>
      <p className={styles.note}>
        {rated
          ? `AI agrees with ${agreeing} of ${rated} rated images (${Math.round((agreeing / rated) * 100)}%).`
          : 'Rate a few images to see how often the AI agrees with you.'}
      </p>
      <div className={styles.filters} role="group" aria-label="View">
        {views.map(([value, label, count]) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={view === value}
            onClick={() => setView(value)}
          >
            {label} ({count})
          </button>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {view === 'events' ? (
        events.map((eventImages) => (
          <section key={eventImages[0].eventId} className={styles.event}>
            <header className={styles.eventHeader}>{eventImages[0].eventLabel}</header>
            <div className={styles.images}>{eventImages.map((image) => card(image, false))}</div>
          </section>
        ))
      ) : (
        <div className={styles.images}>
          {(view === 'queue' ? queue : unique.filter((image) => ratingOf(image) === view)).map(
            (image) => card(image, true),
          )}
        </div>
      )}
    </div>
  );
}
