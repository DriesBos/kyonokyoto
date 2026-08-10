'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

type Expansion = {
  expanded: boolean;
  toggle: () => void;
};

const ExpansionContext = createContext<{ activeId: string | null; setActiveId: (id: string | null) => void } | null>(
  null,
);

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

  return (
    <ExpansionContext.Provider value={{ activeId, setActiveId }}>
      <section className={className} aria-label={ariaLabel} data-event-grid>
        {children}
      </section>
    </ExpansionContext.Provider>
  );
}
