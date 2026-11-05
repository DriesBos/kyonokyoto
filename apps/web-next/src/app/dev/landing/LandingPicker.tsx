'use client';

import { useState } from 'react';
import type { LandingBlocklist } from '@/lib/landingBlocklistFile';
import styles from './page.module.sass';

export type LandingPickerEvent = {
  id: string;
  title: string;
  institution: string;
  images: {
    url: string;
    src: string;
    landingOk: boolean | null;
    subject: string | null;
    busyness: string | null;
    score: number | null;
    rank: number;
  }[];
};

const verdictLabel = ({ landingOk, subject, busyness, score, rank }: LandingPickerImage) => {
  if (landingOk === null) return 'AI: unchecked';
  const tags = [landingOk ? 'clean' : 'rejected', subject, busyness, score && `${score}/10`];
  return `AI: ${tags.filter(Boolean).join(' · ')} → rank ${rank.toFixed(1)}`;
};

type LandingPickerImage = LandingPickerEvent['images'][number];

export default function LandingPicker({
  events,
  initialBlocklist,
}: {
  events: LandingPickerEvent[];
  initialBlocklist: LandingBlocklist;
}) {
  const [blocklist, setBlocklist] = useState(initialBlocklist);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (kind: 'images' | 'events', value: string, blocked: boolean) => {
    setError(null);
    const response = await fetch('/api/dev/landing-blocklist/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, value, blocked }),
    });
    if (response.ok) setBlocklist(await response.json());
    else setError(`Saving failed (${response.status})`);
  };

  return (
    <div className={styles.events}>
      {error && <p className={styles.error}>{error}</p>}
      {events.map((event) => {
        const eventBlocked = blocklist.events.includes(event.id);
        return (
          <section key={event.id} className={styles.event} data-blocked={eventBlocked || undefined}>
            <header className={styles.eventHeader}>
              <span>
                {event.institution}: {event.title}
              </span>
              <button type="button" onClick={() => toggle('events', event.id, !eventBlocked)}>
                {eventBlocked ? 'Unblock event' : 'Block event'}
              </button>
            </header>
            <div className={styles.images}>
              {event.images.map((image) => {
                const blocked = blocklist.images.includes(image.url);
                const shown = !eventBlocked && !blocked && image.landingOk !== false;
                return (
                  <figure key={image.url} className={styles.image} data-shown={shown || undefined}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.src} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    <figcaption>
                      <span>
                        {verdictLabel(image)}
                        {blocked ? ' · blocked' : ''}
                      </span>
                      <button type="button" onClick={() => toggle('images', image.url, !blocked)}>
                        {blocked ? 'Unblock' : 'Block'}
                      </button>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
