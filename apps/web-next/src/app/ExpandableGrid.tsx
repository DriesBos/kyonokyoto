'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { stickyMapOverlap } from '@/lib/mapOverlap';

// How much of the scroll container's top the sticky header covers: all of it on the page, none
// when the cards scroll in their own panel below the header (map open). On phones with the map
// open the sticky map covers the top instead.
function headerOverlap(card: HTMLElement): number {
  const header = document.querySelector<HTMLElement>('[data-main-header]');
  if (!header) return stickyMapOverlap();
  let scrollerTop = 0;
  for (let node = card.parentElement; node && node !== document.body; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
      scrollerTop = node.getBoundingClientRect().top;
      break;
    }
  }
  return Math.max(0, header.getBoundingClientRect().bottom - scrollerTop, stickyMapOverlap() - scrollerTop);
}

// Lets code outside the grid (the landing) open a card: dispatch with { detail: { eventId } }.
export const EXPAND_EVENT_CARD_EVENT = 'kyo:expand-event-card';

type Expansion = {
  expanded: boolean;
  toggle: () => void;
};

const ExpansionContext = createContext<{
  activeId: string | null;
  setActiveId: (id: string | null) => void;
} | null>(null);

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

  return (
    <button
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
}: {
  className: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const gridRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const expand = (event: Event) => {
      const eventId = (event as CustomEvent<{ eventId?: unknown }>).detail?.eventId;
      if (typeof eventId === 'string') setActiveId(eventId);
    };
    window.addEventListener(EXPAND_EVENT_CARD_EVENT, expand);
    return () => window.removeEventListener(EXPAND_EVENT_CARD_EVENT, expand);
  }, []);

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
      card.style.setProperty('--scroll-header', `${headerOverlap(card)}px`);
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
    <ExpansionContext.Provider value={{ activeId, setActiveId }}>
      <section className={className} aria-label={ariaLabel} data-event-grid ref={gridRef}>
        {children}
      </section>
    </ExpansionContext.Provider>
  );
}
