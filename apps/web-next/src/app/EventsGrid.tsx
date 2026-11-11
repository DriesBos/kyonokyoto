import { Fragment } from 'react';
import type { AppLocale } from '@/lib/i18n';
import { uiText } from '@/lib/i18n';
import { boxClusterLabels } from '@/lib/boxCluster';
import type { AppCity } from '@/lib/cities';
import { type CityEvent, mapLocationIdForEvent } from '@/lib/cityEvents';
import { imageCdnEnabled } from '@/lib/env';
import { festivalPathFor } from '@/lib/festivalRoutes';
import { venuePathFor } from '@/lib/venueRoutes';
import { withoutCalendarDetails } from '@/lib/appleCalendar';
import EventCardDetail, { EventCardMedia } from './EventCardDetail';
import ExpandableGrid, { EventCardDisclosure } from './ExpandableGrid';
import { EventCardMediaDots, EventCardMediaPager } from './EventCardMediaPager';
import BoxCluster from './BoxCluster';
import EventStarButton from './EventStarButton';
import UnsetFiltersButton from './UnsetFiltersButton';
import { LastWeekPill } from './LastWeekBadge';
import { BoxEdge, BoxSides } from './blocks/BoxFrame';
import styles from './blocks/page.module.sass';

// First cards cover the first viewport on phone (3 columns) and desktop grids.
const HIGH_PRIORITY_CARD_COUNT = 3;
const EAGER_CARD_COUNT = 6;

const groupOrder = ['ongoing', 'upcoming', 'permanent'] as const;

export default function EventsGrid({
  events,
  locale,
  cityLabel,
  city,
  linkVenues = true,
}: {
  events: CityEvent[];
  locale: AppLocale;
  cityLabel: string;
  city: AppCity;
  // Off on a venue page, where every card is that venue.
  linkVenues?: boolean;
}) {
  const copy = uiText[locale];
  const groups = Object.fromEntries(
    groupOrder.map((group) => [group, events.filter((event) => event.group === group)]),
  ) as Record<(typeof groupOrder)[number], CityEvent[]>;
  let globalIndex = 0;
  const useImageCdn = imageCdnEnabled();

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
        <UnsetFiltersButton label={copy.unsetFilters} />
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
              <BoxCluster
                labels={boxClusterLabels(
                  group === 'permanent' ? copy.alsoVisit : copy[group],
                  group === 'upcoming' ? copy.getReady : copy.permanent,
                  copy.comingSoon,
                )}
                seed={`${city}-${group}`}
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
                  const detailId = `event-card-detail-${event.id}`;
                  return (
                    <article
                      className={`${styles.block} ${[0, 4, 9].includes(index) ? styles.tall : ''}`}
                      data-event-card
                      data-event-id={event.id}
                      data-event-group-name={event.group}
                      data-beta={event.beta || undefined}
                      data-filter-tags={(event.filterTags ?? []).join('|')}
                      data-ends-soon={event.endsSoon || undefined}
                      data-source={event.sourceSlug ?? undefined}
                      data-map-location-id={mapLocationIdForEvent(event) ?? undefined}
                      key={event.id}
                      style={
                        {
                          '--block-i': groupItemIndex,
                          viewTransitionName: `ev-${event.id}`,
                        } as React.CSSProperties
                      }
                    >
                      <BoxSides />
                      <div className={`${styles.front} ${styles.boxLift}`}>
                        <EventCardMediaPager>
                          <EventCardMedia
                            className={styles.media}
                            eventId={event.id}
                            label={event.title}
                            locale={locale}
                            images={event.images}
                            useImageCdn={useImageCdn}
                            // The LCP is usually one of the first cards, and which one depends on
                            // column count and tall cards, so the first rows load eagerly and the
                            // first few get high fetch priority (Lighthouse lcp-lazy-loaded).
                            priority={index < HIGH_PRIORITY_CARD_COUNT}
                            eager={index < EAGER_CARD_COUNT}
                            embeds={event.mediaEmbeds.map((embed) => ({
                              videoId: embed.videoId,
                              title: `${event.title} video`,
                            }))}
                          />
                          {event.endsSoon ? (
                            <LastWeekPill label={copy.lastWeek} />
                          ) : event.startsSoon ? (
                            <LastWeekPill label={copy.comingSoon} kind="coming-soon" />
                          ) : null}
                          <EventStarButton
                            eventId={event.id}
                            endsAt={event.group === 'permanent' ? null : event.calendarEndsAt}
                            label={event.title}
                            starLabel={copy.starEvent}
                            unstarLabel={copy.unstarEvent}
                          />
                          <div className={styles.content}>
                            <EventCardMediaDots label={locale === 'ja' ? '画像' : 'Image'} />
                            <div className={styles.meta}>
                              {linkVenues && !event.festival && event.venueSlug ? (
                                <p className={styles.venueLink}>
                                  <a href={venuePathFor(city, locale, event.venueSlug)}>
                                    {event.institution}
                                  </a>
                                </p>
                              ) : (
                                <p>
                                  {event.festival
                                    ? event.venue || event.institution
                                    : event.institution}
                                </p>
                              )}
                              <p>
                                {event.date}
                                {event.eventKind === 'festival' ? ' — FESTIVAL' : null}
                              </p>
                              {event.festival && (
                                <p className={styles.festivalMeta}>
                                  {event.festival.slug ? (
                                    <a href={festivalPathFor(city, locale, event.festival.slug)}>
                                      {[event.festival.title, event.festival.year]
                                        .filter(Boolean)
                                        .join(' · ')}{' '}
                                      ↗
                                    </a>
                                  ) : (
                                    <span>{event.festival.title}</span>
                                  )}
                                </p>
                              )}
                            </div>
                            <h2 className={styles.title}>{event.title}</h2>
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
                            googleCalendarUrl={
                              event.description && event.googleCalendarUrl
                                ? withoutCalendarDetails(event.googleCalendarUrl)
                                : event.googleCalendarUrl
                            }
                            appleCalendar={
                              event.description && event.appleCalendar
                                ? { ...event.appleCalendar, details: undefined }
                                : event.appleCalendar
                            }
                            sourceUrl={event.sourceUrl}
                            locale={locale}
                          />
                        </EventCardMediaPager>
                      </div>
                      <BoxEdge />
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
