import type { AppLocale } from './i18n.ts';

// The language switch is a client navigation to the other locale's (prefetched) page. This hands
// the reader's place over to that page: landing dismissed or not, map open, filters, and the event
// card at the top of the view with its offset, so the switch reads as a toggle in place.
// Kept in memory only: a full reload starts fresh, and the server render never sees it.
export type LocaleHandoff = {
  locale: AppLocale;
  landingHidden: boolean;
  mapOpen: boolean;
  categories: string[];
  timing: string;
  anchorId: string | null;
  anchorTop: number;
  scrollTop: number;
};

let pending: (LocaleHandoff & { at: number }) | null = null;
const maxAgeMs = 10_000;

// The events list scrolls inside [data-events-section] when the map is open, else the window.
export const eventsScrollRoot = () => {
  const events = document.querySelector<HTMLElement>('[data-events-section]');
  if (!events) return null;
  const overflowY = getComputedStyle(events).overflowY;
  return overflowY !== 'visible' &&
    overflowY !== 'clip' &&
    events.scrollHeight > events.clientHeight + 1
    ? events
    : null;
};

const headerBottom = () =>
  document.querySelector<HTMLElement>('[data-main-header]')?.getBoundingClientRect().bottom ?? 0;

// First visible card whose top is at or below the header: the card the reader is looking at.
const anchorCard = () => {
  const limit = headerBottom();
  const cards = document.querySelectorAll<HTMLElement>('[data-event-card]:not([hidden])');
  for (const card of cards) {
    if (card.offsetParent === null) continue;
    const { top, bottom } = card.getBoundingClientRect();
    if (bottom > limit) return { id: card.dataset.eventId ?? null, top };
  }
  return null;
};

export function setLocaleHandoff(
  state: Omit<LocaleHandoff, 'landingHidden' | 'anchorId' | 'anchorTop' | 'scrollTop'>,
) {
  const root = eventsScrollRoot();
  const anchor = anchorCard();
  pending = {
    ...state,
    landingHidden: !document.documentElement.hasAttribute('data-blocks-landing-active'),
    anchorId: anchor?.id ?? null,
    anchorTop: anchor?.top ?? 0,
    scrollTop: root ? root.scrollTop : window.scrollY,
    at: Date.now(),
  };
}

// Read by each part of the new page as it mounts; null unless a switch to this locale is pending.
export function readLocaleHandoff(locale: AppLocale): LocaleHandoff | null {
  if (typeof window === 'undefined' || !pending) return null;
  if (pending.locale !== locale || Date.now() - pending.at > maxAgeMs) return null;
  return pending;
}

// Puts the anchor card back where it was on screen, then clears the handoff. Card heights can
// still settle for a moment (fonts, media), so it re-aligns on layout changes for a short while,
// until the reader scrolls themselves.
export function restoreLocaleHandoff(handoff: LocaleHandoff) {
  pending = null;
  const align = () => {
    const root = eventsScrollRoot();
    const target: HTMLElement | Window = root ?? window;
    const card = handoff.anchorId
      ? document.querySelector<HTMLElement>(
          `[data-event-card][data-event-id="${CSS.escape(handoff.anchorId)}"]`,
        )
      : null;
    if (!card || card.offsetParent === null) {
      target.scrollTo({ top: handoff.scrollTop, behavior: 'instant' });
      return;
    }
    const current = root ? root.scrollTop : window.scrollY;
    const delta = card.getBoundingClientRect().top - handoff.anchorTop;
    if (Math.abs(delta) > 1)
      target.scrollTo({ top: Math.max(0, current + delta), behavior: 'instant' });
  };
  align();
  const grid = document.querySelector<HTMLElement>('[data-main-content]');
  if (!grid) return;
  const observer = new ResizeObserver(align);
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timeout);
    userInput.forEach((type) => window.removeEventListener(type, stop, true));
  };
  const userInput = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  userInput.forEach((type) =>
    window.addEventListener(type, stop, { capture: true, passive: true }),
  );
  const timeout = window.setTimeout(stop, 1000);
  observer.observe(grid);
}
