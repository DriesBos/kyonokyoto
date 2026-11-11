'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EventCardDetailData } from '@/lib/eventDetails';
import { scrollHeaderOverlap } from '@/lib/mapOverlap';

// Lets code outside the grid (the landing) open a card: dispatch with { detail: { eventId } }.
export const EXPAND_EVENT_CARD_EVENT = 'kyo:expand-event-card';

type Expansion = {
  expanded: boolean;
  toggle: () => void;
};

const ExpansionContext = createContext<{
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  detailsUrl: string | null;
} | null>(null);

type EventDetailsMap = Record<string, EventCardDetailData>;

// One request per details URL and page view; a failed one is dropped so the next open retries.
const detailRequests = new Map<string, Promise<EventDetailsMap>>();
export const loadEventDetails = (url: string) => {
  let request = detailRequests.get(url);
  if (!request) {
    request = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Event details request failed: ${response.status}`);
      return response.json() as Promise<EventDetailsMap>;
    });
    request.catch(() => detailRequests.delete(url));
    detailRequests.set(url, request);
  }
  return request;
};

// The open card's details: undefined while loading (or closed), null when the card has none.
export function useEventCardDetail(eventId: string, expanded: boolean) {
  const context = useContext(ExpansionContext);
  const detailsUrl = context?.detailsUrl ?? null;
  const [detail, setDetail] = useState<EventCardDetailData | null | undefined>(undefined);
  useEffect(() => {
    if (!expanded || !detailsUrl || detail !== undefined) return;
    let cancelled = false;
    loadEventDetails(detailsUrl)
      .then((details) => {
        if (!cancelled) setDetail(details[eventId] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [detail, detailsUrl, eventId, expanded]);
  return detail;
}

export function useEventCardExpansion(eventId: string): Expansion {
  const context = useContext(ExpansionContext);
  if (!context) throw new Error('Event card expansion must be inside ExpandableGrid');

  const expanded = context.activeId === eventId;
  return {
    expanded,
    toggle: () => context.setActiveId(expanded ? null : eventId),
  };
}

export function EventCardDisclosure({
  eventId,
  detailId,
  label,
  className,
  expandLabel = 'Expand',
  collapseLabel = 'Collapse',
}: {
  eventId: string;
  detailId: string;
  label: string;
  className?: string;
  expandLabel?: string;
  collapseLabel?: string;
}) {
  const { expanded, toggle } = useEventCardExpansion(eventId);
  const detailsUrl = useContext(ExpansionContext)?.detailsUrl;
  // start loading the details on intent, so they are usually there by the time the card opens
  const prefetch = () => {
    if (detailsUrl) void loadEventDetails(detailsUrl).catch(() => undefined);
  };

  return (
    <button
      onPointerEnter={prefetch}
      onFocus={prefetch}
      onTouchStart={prefetch}
      className={className}
      type="button"
      aria-expanded={expanded}
      aria-controls={detailId}
      aria-label={`${expanded ? collapseLabel : expandLabel} ${label}`}
      onClick={toggle}
    />
  );
}

export default function ExpandableGrid({
  className,
  children,
  ariaLabel = 'Events',
  detailsUrl = null,
}: {
  className: string;
  children: ReactNode;
  ariaLabel?: string;
  // where expanded cards load their details from (lib/eventDetails.ts eventDetailsPath)
  detailsUrl?: string | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const gridRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const expand = (event: Event) => {
      const eventId = (event as CustomEvent<{ eventId?: unknown }>).detail?.eventId;
      if (typeof eventId !== 'string') return;
      if (detailsUrl) void loadEventDetails(detailsUrl).catch(() => undefined);
      setActiveId(eventId);
    };
    window.addEventListener(EXPAND_EVENT_CARD_EVENT, expand);
    return () => window.removeEventListener(EXPAND_EVENT_CARD_EVENT, expand);
  }, [detailsUrl]);

  // An expanded card can move to a new row and end up partly off screen. Once the grid has laid
  // it out, scroll just enough to show it (nothing moves if it is already fully visible). The
  // scroll margins in page.module.sass keep the 3D depth and the sticky header clear of it.
  useEffect(() => {
    if (!activeId) return;
    const frame = requestAnimationFrame(() => {
      const card = gridRef.current?.querySelector<HTMLElement>(
        `[data-event-card][data-event-id="${CSS.escape(activeId)}"]`,
      );
      if (!card) return;
      card.style.setProperty('--scroll-header', `${scrollHeaderOverlap(card)}px`);
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId]);

  return (
    <ExpansionContext.Provider value={{ activeId, setActiveId, detailsUrl }}>
      <section className={className} aria-label={ariaLabel} data-event-grid ref={gridRef}>
        {children}
      </section>
    </ExpansionContext.Provider>
  );
}
