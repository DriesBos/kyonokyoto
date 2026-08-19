import { Fragment } from 'react';
import type { AppLocale } from '@/lib/i18n';
import { uiText } from '@/lib/i18n';
import { type CityEvent, mapLocationIdForEvent } from '@/lib/cityEvents';
import { eventMediaDeliverySrcSet, eventMediaDeliveryUrl } from '@/lib/mediaDelivery';
import EventCardDetail, { EventCardMedia } from './EventCardDetail';
import ExpandableGrid, { EventCardDisclosure } from './ExpandableGrid';
import TimeDivider from './TimeDivider';
import styles from './blocks/page.module.sass';

const groupOrder = ['ongoing', 'upcoming', 'permanent'] as const;

export default function EventsGrid({
  events,
  locale,
  cityLabel,
}: {
  events: CityEvent[];
  locale: AppLocale;
  cityLabel: string;
}) {
  const copy = uiText[locale];
  const groups = Object.fromEntries(
    groupOrder.map((group) => [group, events.filter((event) => event.group === group)]),
  ) as Record<(typeof groupOrder)[number], CityEvent[]>;
  let globalIndex = 0;

  if (events.length === 0) {
    return (
      <div className={styles.emptyState}>
        <h2>{copy.emptyTitle}</h2>
        <p>{copy.emptyDescription}</p>
      </div>
    );
  }

  return (
    <>
      <div className={styles.filteredEmpty} data-filter-empty hidden>
        <h2>{copy.noEvents}</h2>
        <p>{copy.unsetFilters}</p>
      </div>
      <ExpandableGrid className={styles.grid} ariaLabel={`${cityLabel} events`}>
        {groupOrder.map((group, groupIndex) => {
          const groupEvents = groups[group];
          if (groupEvents.length === 0) return null;
          const previousVisibleGroup = groupOrder
            .slice(0, groupIndex)
            .findLast((candidate) => groups[candidate].length > 0);
          const divider = previousVisibleGroup ? (
            <div
              className={styles.timeDivider}
              data-event-divider
              data-before-group={previousVisibleGroup}
              data-after-group={group}
            >
              <TimeDivider
                label={copy[group]}
                readyLabel={group === 'upcoming' ? copy.getReady : copy.permanent}
                ariaLabel={`${copy[group]} events`}
              />
            </div>
          ) : null;

          return (
            <Fragment key={group}>
              {divider}
              <section
                className={styles.eventGroup}
                data-event-group
                data-event-group-name={group}
                aria-label={copy[group]}
              >
                {groupEvents.map((event, groupItemIndex) => {
                  const index = globalIndex++;
                  const mediaImages = event.images.flatMap((item, imageIndex) => {
                    const src = eventMediaDeliveryUrl(item.url);
                    return src
                      ? [
                          {
                            src,
                            srcSet: eventMediaDeliverySrcSet(item.url),
                            width: item.width,
                            height: item.height,
                            alt: event.title,
                            sizes: '(max-width: 767px) 90vw, 20rem',
                            loading:
                              imageIndex === 0 && index === 0
                                ? ('eager' as const)
                                : ('lazy' as const),
                            fetchPriority:
                              imageIndex === 0 && index === 0
                                ? ('high' as const)
                                : ('auto' as const),
                          },
                        ]
                      : [];
                  });
                  const detailId = `event-card-detail-${event.id}`;
                  return (
                    <article
                      className={`${styles.block} ${[0, 4, 9].includes(index) ? styles.tall : ''}`}
                      data-event-card
                      data-event-id={event.id}
                      data-event-group-name={event.group}
                      data-categories={event.categories.join('|')}
                      data-map-location-id={mapLocationIdForEvent(event) ?? undefined}
                      key={event.id}
                      style={
                        {
                          '--block-i': groupItemIndex,
                          viewTransitionName: `ev-${event.id}`,
                        } as React.CSSProperties
                      }
                    >
                      <div className={styles.back} />
                      <div className={`${styles.face} ${styles.faceTop}`} />
                      <div className={`${styles.face} ${styles.faceBottom}`} />
                      <div className={`${styles.face} ${styles.faceLeft}`} />
                      <div className={`${styles.face} ${styles.faceRight}`} />
                      <div className={styles.front}>
                        <EventCardMedia
                          className={styles.media}
                          eventId={event.id}
                          label={event.title}
                          images={mediaImages}
                          embeds={event.mediaEmbeds.map((embed) => ({
                            videoId: embed.videoId,
                            title: `${event.title} video`,
                          }))}
                        />
                        <h2 className={styles.title}>{event.title}</h2>
                        <div className={styles.meta}>
                          <p>{event.date}</p>
                          <p>{event.institution}</p>
                        </div>
                        <EventCardDisclosure
                          eventId={event.id}
                          detailId={detailId}
                          label={event.title}
                          expandLabel={locale === 'ja' ? '開く' : 'Expand'}
                          collapseLabel={locale === 'ja' ? '閉じる' : 'Collapse'}
                          className={styles.disclosure}
                        />
                        <EventCardDetail
                          className={styles.detail}
                          eventId={event.id}
                          description={event.description}
                          mapsUrl={event.mapsUrl}
                          googleCalendarUrl={event.googleCalendarUrl}
                          appleCalendar={event.appleCalendar}
                          sourceUrl={event.sourceUrl}
                          locale={locale}
                        />
                      </div>
                    </article>
                  );
                })}
              </section>
            </Fragment>
          );
        })}
      </ExpandableGrid>
    </>
  );
}
