type EventCardRevealWindow = Window &
  typeof globalThis & {
    __eventCardRevealBound?: boolean;
    __eventCardRevealObserver?: IntersectionObserver;
  };

const cardSelector = "[data-event-card]";
const eventsSectionSelector = "[data-events-section]";
const revealTransition = {
  duration: 420,
  easing: "ease",
};

const revealWindow = window as EventCardRevealWindow;

const markVisible = (card: Element) => {
  if (!(card instanceof HTMLElement)) return;
  card.dataset.revealState = "visible";
};

const markQueued = (card: Element) => {
  if (!(card instanceof HTMLElement)) return;
  card.dataset.revealState = "queued";
};

const revealOpacity = (card: HTMLElement) => card.hasAttribute("data-beta") ? "0.5" : "1";

const revealCard = (card: Element, animate: boolean) => {
  if (!(card instanceof HTMLElement)) return;
  revealWindow.__eventCardRevealObserver?.unobserve(card);
  markVisible(card);

  const targetOpacity = revealOpacity(card);

  if (animate) {
    card.style.visibility = "visible";
    card.animate([{ opacity: 0 }, { opacity: targetOpacity }], revealTransition)
      .finished
      .then(() => {
        card.style.opacity = targetOpacity;
      })
      .catch(() => {});
  } else {
    card.style.opacity = targetOpacity;
    card.style.visibility = "visible";
  }
};

const isRendered = (card: HTMLElement) => !card.hidden && card.getClientRects().length > 0;

const getEventsSection = () => document.querySelector(eventsSectionSelector);

const isInScrollRoot = (card: HTMLElement, scrollRoot: Element | null) => {
  const rect = card.getBoundingClientRect();
  const rootRect = scrollRoot instanceof HTMLElement
    ? scrollRoot.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight };

  return rect.top < rootRect.bottom && rect.bottom > rootRect.top;
};

const buildAnimations = () => {
  const cards = Array.from(document.querySelectorAll(cardSelector));
  const eventsSection = getEventsSection();

  revealWindow.__eventCardRevealObserver?.disconnect();
  revealWindow.__eventCardRevealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        revealCard(entry.target, true);
      });
    },
    {
      root: eventsSection instanceof HTMLElement ? eventsSection : null,
      threshold: 0,
    },
  );

  cards.forEach((card) => {
    if (!(card instanceof HTMLElement)) return;

    if (!isRendered(card) || isInScrollRoot(card, eventsSection) || card.dataset.revealState === "visible") {
      revealCard(card, false);
      return;
    }

    markQueued(card);
    card.style.opacity = "0";
    card.style.visibility = "visible";
    revealWindow.__eventCardRevealObserver?.observe(card);
  });
};

export const initEventCardReveal = () => {
  if (revealWindow.__eventCardRevealBound) return;

  let rebuildFrame = 0;

  const scheduleBuildAnimations = () => {
    if (rebuildFrame) {
      window.cancelAnimationFrame(rebuildFrame);
    }

    rebuildFrame = window.requestAnimationFrame(() => {
      rebuildFrame = 0;
      buildAnimations();
    });
  };

  buildAnimations();

  document.addEventListener("astro:page-load", scheduleBuildAnimations);
  window.addEventListener("load", scheduleBuildAnimations, { once: true });
  window.addEventListener("resize", scheduleBuildAnimations);
  document.addEventListener("event-filter:updated", scheduleBuildAnimations);
  revealWindow.__eventCardRevealBound = true;
};
