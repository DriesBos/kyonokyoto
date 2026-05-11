const starButtonSelector = "[data-event-star-toggle]";
const cardSelector = "[data-event-card]";
const storageKey = "kyo_starred_events";
const burstDurationMs = 900;
const burstTimeouts = new WeakMap<HTMLElement, number>();

const readStarredEventIds = () => {
  try {
    const value = window.localStorage.getItem(storageKey);
    const parsed = value ? JSON.parse(value) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
};

const writeStarredEventIds = (eventIds: Set<string>) => {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(eventIds)));
  } catch {}
};

const emitStarredUpdate = (eventIds: Set<string>) => {
  document.dispatchEvent(
    new CustomEvent("event-stars:updated", {
      detail: {
        starredEventIds: Array.from(eventIds),
      },
    })
  );
};

const syncStarredCards = (eventIds: Set<string>) => {
  document.querySelectorAll(cardSelector).forEach((card) => {
    if (!(card instanceof HTMLElement)) return;

    const eventId = card.dataset.eventId ?? "";
    const isStarred = Boolean(eventId && eventIds.has(eventId));
    card.dataset.starred = String(isStarred);

    const button = card.querySelector(starButtonSelector);
    if (!(button instanceof HTMLElement)) return;

    button.setAttribute("aria-pressed", String(isStarred));
    button.setAttribute("aria-label", isStarred ? "Unstar event" : "Star event");
  });
};

const restartStarBurst = (button: HTMLElement) => {
  const activeTimeout = burstTimeouts.get(button);
  if (activeTimeout) window.clearTimeout(activeTimeout);

  button.removeAttribute("data-star-burst");
  void button.offsetWidth;
  button.setAttribute("data-star-burst", "");

  const nextTimeout = window.setTimeout(() => {
    button.removeAttribute("data-star-burst");
    burstTimeouts.delete(button);
  }, burstDurationMs);
  burstTimeouts.set(button, nextTimeout);
};

export const initEventStars = () => {
  if (window.__eventStarsBound) {
    const eventIds = readStarredEventIds();
    syncStarredCards(eventIds);
    emitStarredUpdate(eventIds);
    return;
  }

  let starredEventIds = readStarredEventIds();
  syncStarredCards(starredEventIds);
  emitStarredUpdate(starredEventIds);

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest(starButtonSelector);
    if (!(button instanceof HTMLElement)) return;

    const card = button.closest(cardSelector);
    if (!(card instanceof HTMLElement)) return;

    const eventId = card.dataset.eventId ?? "";
    if (!eventId) return;

    event.preventDefault();
    event.stopPropagation();

    starredEventIds = readStarredEventIds();
    if (starredEventIds.has(eventId)) {
      starredEventIds.delete(eventId);
    } else {
      starredEventIds.add(eventId);
      restartStarBurst(button);
    }

    writeStarredEventIds(starredEventIds);
    syncStarredCards(starredEventIds);
    emitStarredUpdate(starredEventIds);
  });

  window.__eventStarsBound = true;
};
