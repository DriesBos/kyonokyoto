'use client';

import { useCallback, useState, type CSSProperties } from 'react';
import { buildAppleCalendarIcs, type AppleCalendarEvent } from '@/lib/appleCalendar';
import { uiText, type AppLocale } from '@/lib/i18n';
import { buildYouTubeEmbedSrc } from '@/lib/youtubeEmbed';
import { useEventCardExpansion } from './ExpandableGrid';
import styles from './EventCardDetail.module.sass';

export type EventCardImage = {
  src: string;
  srcSet?: string | null;
  width?: number | null;
  height?: number | null;
  alt: string;
  sizes?: string;
  loading?: 'eager' | 'lazy';
  fetchPriority?: 'high' | 'low' | 'auto';
};

export type EventCardEmbed = {
  videoId: string;
  title: string;
};

const imageAspectRatio = (image?: EventCardImage) => {
  const width = Number(image?.width);
  const height = Number(image?.height);
  return width > 0 && height > 0 ? width / height : null;
};

export type EventCardActionsProps = {
  mapsUrl?: string | null;
  googleCalendarUrl?: string | null;
  sourceUrl?: string | null;
  appleCalendar?: AppleCalendarEvent | null;
};

type EventCardDetailProps = EventCardActionsProps & {
  eventId: string;
  description: string | null;
  className?: string;
  locale?: AppLocale;
};

const externalLink = { target: '_blank', rel: 'noopener noreferrer' };

export function EventCardMedia({
  eventId,
  label,
  images = [],
  embeds = [],
  className,
}: {
  eventId: string;
  label: string;
  images?: EventCardImage[];
  embeds?: EventCardEmbed[];
  className?: string;
}) {
  const { expanded } = useEventCardExpansion(eventId);
  const [naturalLeadAspectRatio, setNaturalLeadAspectRatio] = useState<number | null>(null);
  const leadAspectRatio = naturalLeadAspectRatio ?? imageAspectRatio(images[0]);
  const visibleImages = images.slice(0, expanded ? 3 : 1);
  const visibleEmbeds = expanded ? embeds : [];
  const hasOverflow = expanded && visibleImages.length + visibleEmbeds.length > 1;
  const syncNaturalLeadAspectRatio = useCallback((image: HTMLImageElement | null) => {
    if (!image?.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
    setNaturalLeadAspectRatio(image.naturalWidth / image.naturalHeight);
  }, []);

  if (visibleImages.length + visibleEmbeds.length === 0) return null;

  return (
    <div
      className={`${styles.media}${className ? ` ${className}` : ''}`}
      data-event-card-part="media"
      data-expanded={expanded}
      data-overflow={hasOverflow}
      data-lead-aspect-ratio={leadAspectRatio ? 'true' : undefined}
      style={leadAspectRatio
        ? { '--media-lead-aspect-ratio': String(leadAspectRatio) } as CSSProperties
        : undefined}
      role={hasOverflow ? 'region' : undefined}
      aria-label={hasOverflow ? `${label} media` : undefined}
      tabIndex={hasOverflow ? 0 : undefined}
    >
      <div className={styles.mediaTrack} data-event-card-part="media-track">
        {visibleImages.map((image, imageIndex) => (
          <figure className={styles.frame} data-event-card-part="media-image" key={image.src}>
            <img
              src={image.src}
              srcSet={image.srcSet ?? undefined}
              sizes={image.sizes}
              width={image.width ?? undefined}
              height={image.height ?? undefined}
              alt={image.alt}
              loading={image.loading ?? 'lazy'}
              fetchPriority={image.fetchPriority}
              decoding="async"
              ref={imageIndex === 0 ? syncNaturalLeadAspectRatio : undefined}
              onLoad={imageIndex === 0
                ? (event) => syncNaturalLeadAspectRatio(event.currentTarget)
                : undefined}
            />
          </figure>
        ))}
        {visibleEmbeds.map((embed) => (
          <iframe
            className={styles.embed}
            data-event-card-part="media-embed"
            key={embed.videoId}
            src={buildYouTubeEmbedSrc(embed.videoId)}
            title={embed.title}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ))}
      </div>
    </div>
  );
}

function ActionIcon({ name }: { name: 'calendar' | 'map' | 'exit' }) {
  if (name === 'exit') {
    return (
      <svg className={styles.icon} viewBox="0 -960 960 960" aria-hidden="true">
        <path d="m256-240-56-56 384-384H240v-80h480v480h-80v-344L256-240Z" fill="currentColor" />
      </svg>
    );
  }

  if (name === 'map') {
    return (
      <svg className={styles.icon} viewBox="0 0 25 25" aria-hidden="true">
        <path
          d="M16.7125 23.5L9.04582 20.8167L3.10415 23.1167C2.67822 23.287 2.28424 23.2391 1.92221 22.9729C1.56017 22.7067 1.37915 22.35 1.37915 21.9028V4.01389C1.37915 3.73704 1.45901 3.49213 1.61873 3.27917C1.77846 3.0662 1.99674 2.90648 2.27359 2.8L9.04582 0.5L16.7125 3.18333L22.6542 0.883333C23.0801 0.712963 23.4741 0.76088 23.8361 1.02708C24.1981 1.29329 24.3792 1.65 24.3792 2.09722V19.9861C24.3792 20.263 24.2993 20.5079 24.1396 20.7208C23.9798 20.9338 23.7616 21.0935 23.4847 21.2L16.7125 23.5ZM15.4347 20.3694V5.41944L10.3236 3.63056V18.5806L15.4347 20.3694ZM17.9903 20.3694L21.8236 19.0917V3.95L17.9903 5.41944V20.3694ZM3.93471 20.05L7.76804 18.5806V3.63056L3.93471 4.90833V20.05Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg className={styles.icon} viewBox="0 0 25 25" aria-hidden="true">
      <path
        d="M3.69995 25C3.01245 25 2.42391 24.7552 1.93433 24.2656C1.44474 23.776 1.19995 23.1875 1.19995 22.5V5C1.19995 4.3125 1.44474 3.72396 1.93433 3.23438C2.42391 2.74479 3.01245 2.5 3.69995 2.5H4.94995V0H7.44995V2.5H17.45V0H19.95V2.5H21.2C21.8875 2.5 22.476 2.74479 22.9656 3.23438C23.4552 3.72396 23.7 4.3125 23.7 5V22.5C23.7 23.1875 23.4552 23.776 22.9656 24.2656C22.476 24.7552 21.8875 25 21.2 25H3.69995ZM3.69995 22.5H21.2V10H3.69995V22.5ZM3.69995 7.5H21.2V5H3.69995V7.5ZM12.45 15C12.0958 15 11.7989 14.8802 11.5593 14.6406C11.3197 14.401 11.2 14.1042 11.2 13.75C11.2 13.3958 11.3197 13.099 11.5593 12.8594C11.7989 12.6198 12.0958 12.5 12.45 12.5C12.8041 12.5 13.101 12.6198 13.3406 12.8594C13.5802 13.099 13.7 13.3958 13.7 13.75C13.7 14.1042 13.5802 14.401 13.3406 14.6406C13.101 14.8802 12.8041 15 12.45 15ZM6.55933 14.6406C6.31974 14.401 6.19995 14.1042 6.19995 13.75C6.19995 13.3958 6.31974 13.099 6.55933 12.8594C6.79891 12.6198 7.09578 12.5 7.44995 12.5C7.80412 12.5 8.10099 12.6198 8.34058 12.8594C8.58016 13.099 8.69995 13.3958 8.69995 13.75C8.69995 14.1042 8.58016 14.401 8.34058 14.6406C8.10099 14.8802 7.80412 15 7.44995 15C7.09578 15 6.79891 14.8802 6.55933 14.6406ZM17.45 15C17.0958 15 16.7989 14.8802 16.5593 14.6406C16.3197 14.401 16.2 14.1042 16.2 13.75C16.2 13.3958 16.3197 13.099 16.5593 12.8594C16.7989 12.6198 17.0958 12.5 17.45 12.5C17.8041 12.5 18.101 12.6198 18.3406 12.8594C18.5802 13.099 18.7 13.3958 18.7 13.75C18.7 14.1042 18.5802 14.401 18.3406 14.6406C18.101 14.8802 17.8041 15 17.45 15ZM12.45 20C12.0958 20 11.7989 19.8802 11.5593 19.6406C11.3197 19.401 11.2 19.1042 11.2 18.75C11.2 18.3958 11.3197 18.099 11.5593 17.8594C11.7989 17.6198 12.0958 17.5 12.45 17.5C12.8041 17.5 13.101 17.6198 13.3406 17.8594C13.5802 18.099 13.7 18.3958 13.7 18.75C13.7 19.1042 13.5802 19.401 13.3406 19.6406C13.101 19.8802 12.8041 20 12.45 20ZM6.55933 19.6406C6.31974 19.401 6.19995 19.1042 6.19995 18.75C6.19995 18.3958 6.31974 18.099 6.55933 17.8594C6.79891 17.6198 7.09578 17.5 7.44995 17.5C7.80412 17.5 8.10099 17.6198 8.34058 17.8594C8.58016 18.099 8.69995 18.3958 8.69995 18.75C8.69995 19.1042 8.58016 19.401 8.34058 19.6406C8.10099 19.8802 7.80412 20 7.44995 20C7.09578 20 6.79891 19.8802 6.55933 19.6406ZM17.45 20C17.0958 20 16.7989 19.8802 16.5593 19.6406C16.3197 19.401 16.2 19.1042 16.2 18.75C16.2 18.3958 16.3197 18.099 16.5593 17.8594C16.7989 17.6198 17.0958 17.5 17.45 17.5C17.8041 17.5 18.101 17.6198 18.3406 17.8594C18.5802 18.099 18.7 18.3958 18.7 18.75C18.7 19.1042 18.5802 19.401 18.3406 19.6406C18.101 19.8802 17.8041 20 17.45 20Z"
        fill="currentColor"
      />
    </svg>
  );
}

function downloadAppleCalendar(event: AppleCalendarEvent) {
  const ics = buildAppleCalendarIcs(event);
  if (!ics) return;

  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'kyoto-event'}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url));
}

export function EventCardActions({
  mapsUrl,
  googleCalendarUrl,
  sourceUrl,
  appleCalendar,
  locale = 'en',
}: EventCardActionsProps & { locale?: AppLocale }) {
  if (!mapsUrl && !googleCalendarUrl && !sourceUrl && !appleCalendar) return null;
  const copy = uiText[locale];

  return (
    <nav
      className={styles.links}
      data-event-card-part="links"
      aria-label={copy.eventLinks}
      onClick={(event) => event.stopPropagation()}
    >
      {mapsUrl && (
        <a data-event-card-part="link" href={mapsUrl} {...externalLink}>
          <span className={styles.actionContent}>
            <span>{copy.directions}</span>
            <ActionIcon name="map" />
          </span>
        </a>
      )}
      {googleCalendarUrl && (
        <a data-event-card-part="link" href={googleCalendarUrl} {...externalLink}>
          <span className={styles.actionContent}>
            <span>{copy.google}</span>
            <ActionIcon name="calendar" />
          </span>
        </a>
      )}
      {appleCalendar && (
        <button data-event-card-part="link" type="button" onClick={() => downloadAppleCalendar(appleCalendar)}>
          <span className={styles.actionContent}>
            <span>{copy.apple}</span>
            <ActionIcon name="calendar" />
          </span>
        </button>
      )}
      {sourceUrl && (
        <a data-event-card-part="link" href={sourceUrl} {...externalLink}>
          <span className={styles.actionContent}>
            <span>{copy.website}</span>
            <ActionIcon name="exit" />
          </span>
        </a>
      )}
    </nav>
  );
}

export default function EventCardDetail({
  eventId,
  description,
  mapsUrl,
  googleCalendarUrl,
  sourceUrl,
  appleCalendar,
  className,
  locale = 'en',
}: EventCardDetailProps) {
  const { expanded } = useEventCardExpansion(eventId);
  const detailId = `event-card-detail-${eventId}`;

  return (
    <div
      id={detailId}
      className={`${styles.detail}${className ? ` ${className}` : ''}`}
      data-event-card-detail
      data-expanded={expanded}
      aria-hidden={!expanded}
    >
      {expanded && description && <p data-event-card-part="description">{description}</p>}
      {expanded && (
        <EventCardActions
          mapsUrl={mapsUrl}
          googleCalendarUrl={googleCalendarUrl}
          appleCalendar={appleCalendar}
          sourceUrl={sourceUrl}
          locale={locale}
        />
      )}
    </div>
  );
}
