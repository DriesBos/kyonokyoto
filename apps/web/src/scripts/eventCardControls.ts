const actionSelector = ".event-card__body__actions .general-button";
const actionContainerSelector = ".event-card__body__actions";
const starSelector = "[data-event-star-toggle]";
const cardSelector = "[data-event-card-toggle]";
const cardDotClass = "event-card-dot";
const contentSelector = ".event-card__body__content";
const fadeSelector = "[data-event-card-fade]";
const mediaSelector = ".event-card__media";
const mediaHeightProperty = "--event-card-media-row-height-current";
const mediaScrollThreshold = 6;
const mediaPointerState = new Map();
const mediaScrollClickSuppressions = new WeakSet();
const heightTransition = {
  duration: 250,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
};
const fadeTransition = {
  duration: 180,
  easing: "ease",
};

const cancelAnimations = (targets) => {
  const elements = Array.isArray(targets) ? targets : [targets];

  elements.forEach((target) => {
    if (!(target instanceof Element)) return;
    target.getAnimations().forEach((animation) => animation.cancel());
  });
};

const setFadeHidden = (targets) => {
  const elements = Array.isArray(targets) ? targets : [targets];

  elements.forEach((target) => {
    if (!(target instanceof HTMLElement)) return;
    target.style.opacity = "0";
    target.style.visibility = "visible";
  });
};

const setFadeVisible = (targets) => {
  const elements = Array.isArray(targets) ? targets : [targets];

  elements.forEach((target) => {
    if (!(target instanceof HTMLElement)) return;
    target.style.opacity = "1";
    target.style.visibility = "visible";
  });
};

const animateHeight = async (element, from, to) => {
  element.style.height = `${to}px`;
  const animation = element.animate(
    [{ height: `${from}px` }, { height: `${to}px` }],
    heightTransition
  );

  try {
    await animation.finished;
  } catch {}
};

const fadeIn = (targets, options = {}) => {
  const elements = Array.isArray(targets) ? targets : [targets];

  elements.forEach((target) => {
    if (!(target instanceof HTMLElement)) return;
    target.style.visibility = "visible";
    target.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: options.duration ?? fadeTransition.duration,
        delay: options.delay ?? 0,
        easing: fadeTransition.easing,
        fill: "forwards",
      }
    ).finished
      .then(() => {
        target.style.opacity = "1";
      })
      .catch(() => {});
  });
};

const fadeOut = (targets, options = {}) => {
  const elements = Array.isArray(targets) ? targets : [targets];

  elements.forEach((target) => {
    if (!(target instanceof HTMLElement)) return;
    target.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      {
        duration: options.duration ?? fadeTransition.duration,
        delay: options.delay ?? 0,
        easing: fadeTransition.easing,
        fill: "forwards",
      }
    ).finished
      .then(() => {
        target.style.opacity = "0";
        target.style.visibility = "visible";
      })
      .catch(() => {});
  });
};

const canScrollMedia = (media) => media.scrollWidth > media.clientWidth + 1;

const releaseMediaPointer = (pointerId, state) => {
  if (!state?.capturedPointer) return;
  if (typeof state.media.hasPointerCapture !== "function") return;
  if (!state.media.hasPointerCapture(pointerId)) return;
  state.media.releasePointerCapture(pointerId);
};

const getCardDot = (card) => {
  const existingDot = document.querySelector(`.${cardDotClass}`);
  if (existingDot instanceof HTMLElement) {
    card.append(existingDot);
    return existingDot;
  }

  const dot = document.createElement("div");
  dot.className = cardDotClass;
  dot.setAttribute("aria-hidden", "true");
  dot.hidden = true;
  card.append(dot);
  return dot;
};

const randomBetween = (min, max) => min + Math.random() * (max - min);

const setOrganicDotShape = (dot) => {
  const variant = Math.floor(Math.random() * 3) + 1;
  dot.style.setProperty("--dot-mask", `var(--dot-mask-${variant})`);
  dot.style.setProperty("--dot-rotation", `${randomBetween(-18, 18).toFixed(2)}deg`);
  dot.style.setProperty("--dot-scale-x", randomBetween(0.94, 1.06).toFixed(3));
  dot.style.setProperty("--dot-scale-y", randomBetween(0.96, 1.08).toFixed(3));
};

const hasActiveCardBefore = (card) =>
  Array.from(document.querySelectorAll(`${cardSelector}[data-active='true']`)).some((activeCard) => {
    if (!(activeCard instanceof HTMLElement) || activeCard === card) return false;
    return Boolean(activeCard.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING);
  });

const setCardDotPosition = (card, clientX, clientY, anchorFromBottom = false) => {
  const rect = card.getBoundingClientRect();
  const dot = getCardDot(card);
  dot.style.left = `${clientX - rect.left - card.clientLeft}px`;
  dot.style.removeProperty("top");
  dot.style.removeProperty("bottom");

  if (anchorFromBottom) {
    const bottomBorderWidth = card.offsetHeight - card.clientHeight - card.clientTop;
    dot.style.bottom = `${rect.bottom - clientY - bottomBorderWidth}px`;
    dot.style.setProperty("--event-card-dot-translate-y", "50%");
  } else {
    dot.style.top = `${clientY - rect.top - card.clientTop}px`;
    dot.style.setProperty("--event-card-dot-translate-y", "-50%");
  }

  setOrganicDotShape(dot);
  dot.hidden = false;
};

const hideCardDot = () => {
  const dot = document.querySelector(`.${cardDotClass}`);
  if (dot instanceof HTMLElement) dot.hidden = true;
};

const getMediaHeight = (card, isActive) => {
  const styles = window.getComputedStyle(card);
  return styles
    .getPropertyValue(isActive ? "--event-card-media-row-height-active" : "--event-card-media-row-height")
    .trim();
};

const measureCardHeight = (card, content, contentHeight, mediaHeight) => {
  const previousHeight = card.style.height;
  const previousContentHeight = content.style.height;
  const previousMediaHeight = card.style.getPropertyValue(mediaHeightProperty);

  card.style.height = "auto";
  content.style.height = contentHeight;
  card.style.setProperty(mediaHeightProperty, mediaHeight);
  const measuredHeight = card.offsetHeight;

  card.style.height = previousHeight;
  content.style.height = previousContentHeight;
  if (previousMediaHeight) {
    card.style.setProperty(mediaHeightProperty, previousMediaHeight);
  } else {
    card.style.removeProperty(mediaHeightProperty);
  }

  return measuredHeight;
};

const syncActionInteractivity = (card, isActive) => {
  const actionContainers = Array.from(card.querySelectorAll(actionContainerSelector));
  if (!actionContainers.length) return;

  actionContainers.forEach((actions) => {
    if (!(actions instanceof HTMLElement)) return;

    actions.toggleAttribute("inert", !isActive);
    actions.setAttribute("aria-hidden", String(!isActive));

    actions.querySelectorAll("a, button").forEach((control) => {
      if (!(control instanceof HTMLElement)) return;

      if (isActive) {
        const storedTabIndex = control.dataset.eventCardInactiveTabindex;

        if (storedTabIndex === "__none__") {
          control.removeAttribute("tabindex");
        } else if (typeof storedTabIndex === "string") {
          control.setAttribute("tabindex", storedTabIndex);
        }

        delete control.dataset.eventCardInactiveTabindex;
        return;
      }

      if (control.dataset.eventCardInactiveTabindex === undefined) {
        control.dataset.eventCardInactiveTabindex = control.getAttribute("tabindex") ?? "__none__";
      }

      control.setAttribute("tabindex", "-1");
    });
  });
};

const emitCardActiveChange = (card, isActive) => {
  document.dispatchEvent(
    new CustomEvent("event-card:active-change", {
      detail: {
        active: isActive,
        eventId: card.dataset.eventId || "",
        sourceSlug: card.dataset.mapSourceSlug || "",
        locationId: card.dataset.mapLocationId || "",
      },
    })
  );
};

const setContentState = (card, isActive) => {
  const content = card.querySelector(contentSelector);
  if (!(content instanceof HTMLElement)) return;

  const fadeTargets = Array.from(content.querySelectorAll(fadeSelector));
  card.dataset.toggleReady = "true";

  cancelAnimations([card, content, ...fadeTargets]);
  syncActionInteractivity(card, isActive);

  if (isActive) {
    content.style.height = "auto";
    card.style.setProperty(mediaHeightProperty, getMediaHeight(card, true));
    setFadeVisible(fadeTargets);
  } else {
    content.style.height = "0px";
    card.style.setProperty(mediaHeightProperty, getMediaHeight(card, false));
    setFadeHidden(fadeTargets);
  }
};

const setCardActiveState = (card, isActive) => {
  card.setAttribute("data-active", String(isActive));
  card.setAttribute("aria-pressed", String(isActive));
  syncActionInteractivity(card, isActive);
};

const animateCardState = (card, isActive) => {
  const content = card.querySelector(contentSelector);
  if (!(content instanceof HTMLElement)) {
    setCardActiveState(card, isActive);
    emitCardActiveChange(card, isActive);
    return Promise.resolve();
  }

  const startHeight = card.offsetHeight;
  const targetMediaHeight = getMediaHeight(card, isActive);
  const fadeTargets = Array.from(content.querySelectorAll(fadeSelector));

  cancelAnimations([card, content, ...fadeTargets]);
  card.toggleAttribute("data-height-transitioning", true);
  card.style.overflow = "hidden";

  if (isActive) {
    setCardActiveState(card, true);
    emitCardActiveChange(card, true);
    const targetContentHeight = content.scrollHeight;
    const expandedCardHeight = measureCardHeight(card, content, "auto", targetMediaHeight);
    content.style.height = "0px";
    card.style.height = `${startHeight}px`;
    setFadeHidden(fadeTargets);

    card.style.setProperty(mediaHeightProperty, targetMediaHeight);

    const transition = Promise.all([
      animateHeight(card, startHeight, expandedCardHeight),
      animateHeight(content, 0, targetContentHeight),
    ]).then(() => {
      if (card.getAttribute("data-active") !== "true") return;
      card.style.height = "";
      card.style.overflow = "";
      card.toggleAttribute("data-height-transitioning", false);
      content.style.height = "auto";
    });
    fadeIn(fadeTargets, { delay: heightTransition.duration });
    return transition;
  }

  setCardActiveState(card, false);
  emitCardActiveChange(card, false);
  fadeOut(fadeTargets);
  const collapsedCardHeight = measureCardHeight(card, content, "0px", targetMediaHeight);
  card.style.height = `${startHeight}px`;
  content.style.height = `${content.offsetHeight}px`;
  card.style.setProperty(mediaHeightProperty, targetMediaHeight);

  return Promise.all([
    animateHeight(content, content.offsetHeight, 0),
    animateHeight(card, startHeight, collapsedCardHeight),
  ]).then(() => {
    if (card.getAttribute("data-active") !== "false") return;
    card.style.height = "";
    card.style.overflow = "";
    card.toggleAttribute("data-height-transitioning", false);
    content.style.height = "0px";
  });
};

const toggleCard = (card) => {
  const isActive = card.getAttribute("data-active") === "true";
  const next = !isActive;

  document.querySelectorAll(cardSelector).forEach((otherCard) => {
    if (!(otherCard instanceof HTMLElement)) return;
    if (otherCard === card) return;
    if (otherCard.getAttribute("data-active") !== "true") return;
    animateCardState(otherCard, false);
  });

  animateCardState(card, next);
};

const activateCard = (card) => {
  if (!(card instanceof HTMLElement)) return;

  document.querySelectorAll(cardSelector).forEach((otherCard) => {
    if (!(otherCard instanceof HTMLElement)) return;
    const shouldActivate = otherCard === card;
    if (otherCard.getAttribute("data-active") === String(shouldActivate)) return;

    animateCardState(otherCard, shouldActivate);
  });
};

const deactivateAllCards = () => {
  hideCardDot();
  const transitions = Array.from(document.querySelectorAll(`${cardSelector}[data-active='true']`))
    .filter((card): card is HTMLElement => card instanceof HTMLElement)
    .map((card) => animateCardState(card, false));

  Promise.all(transitions).then(() => {
    document.dispatchEvent(new CustomEvent("event-card:deactivated-all"));
  });
};

const getVisibleCards = () =>
  Array.from(document.querySelectorAll(cardSelector)).filter((card) => {
    if (!(card instanceof HTMLElement)) return false;
    return !card.hidden && !card.closest("[hidden]") && card.getClientRects().length > 0;
  });

const scrollCardIntoEventsView = (card) => {
  const eventsSection = card.closest("[data-events-section]");
  if (!(eventsSection instanceof HTMLElement)) {
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }

  const eventsSectionRect = eventsSection.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const mainHeader = eventsSection.querySelector("[data-main-header]");
  const scrollPadding = mainHeader instanceof HTMLElement
    ? mainHeader.getBoundingClientRect().bottom - eventsSectionRect.top
    : 0;
  const nextScrollTop = eventsSection.scrollTop + cardRect.top - eventsSectionRect.top - scrollPadding;

  eventsSection.scrollTo({
    top: Math.max(0, nextScrollTop),
    behavior: "smooth",
  });
};

const activateAdjacentCard = (direction) => {
  const visibleCards = getVisibleCards();
  const activeIndex = visibleCards.findIndex(
    (card) => card instanceof HTMLElement && card.getAttribute("data-active") === "true"
  );
  if (activeIndex === -1) return;

  const nextIndex = activeIndex + direction;
  if (nextIndex < 0 || nextIndex >= visibleCards.length) return;

  const nextCard = visibleCards[nextIndex];
  if (!(nextCard instanceof HTMLElement)) return;

  activateCard(nextCard);
  scrollCardIntoEventsView(nextCard);
  nextCard.focus({ preventScroll: true });
};

export const initEventCardControls = () => {
  if (window.__eventCardToggleBound) return;

  document.querySelectorAll(cardSelector).forEach((card) => {
    if (!(card instanceof HTMLElement)) return;
    setContentState(card, card.getAttribute("data-active") === "true");
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const media = target.closest(mediaSelector);
    if (!(media instanceof HTMLElement)) return;

    mediaPointerState.set(event.pointerId, {
      media,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: media.scrollLeft,
      pointerType: event.pointerType,
      dragging: false,
      capturedPointer: false,
    });

    const state = mediaPointerState.get(event.pointerId);
    if (canScrollMedia(media) && typeof media.setPointerCapture === "function") {
      media.setPointerCapture(event.pointerId);
      state.capturedPointer = true;
    }
  });

  document.addEventListener("pointermove", (event) => {
    const state = mediaPointerState.get(event.pointerId);
    if (!state) return;

    const deltaX = event.clientX - state.x;
    const deltaY = event.clientY - state.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (!state.dragging) {
      if (absX <= mediaScrollThreshold || absX <= absY || !canScrollMedia(state.media)) return;
      state.dragging = true;
    }

    state.media.scrollLeft = state.scrollLeft - deltaX;
    event.preventDefault();
  });

  document.addEventListener("pointerup", (event) => {
    const state = mediaPointerState.get(event.pointerId);
    if (!state) return;

    releaseMediaPointer(event.pointerId, state);
    mediaPointerState.delete(event.pointerId);

    const deltaX = Math.abs(event.clientX - state.x);
    const deltaY = Math.abs(event.clientY - state.y);
    const scrollDelta = Math.abs(state.media.scrollLeft - state.scrollLeft);
    const wasHorizontalScroll = state.dragging || scrollDelta > 0 || (deltaX > mediaScrollThreshold && deltaX > deltaY);

    if (wasHorizontalScroll) {
      mediaScrollClickSuppressions.add(state.media);
    }
  });

  document.addEventListener("pointercancel", (event) => {
    const state = mediaPointerState.get(event.pointerId);
    releaseMediaPointer(event.pointerId, state);
    mediaPointerState.delete(event.pointerId);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const media = target.closest(mediaSelector);
    if (media instanceof HTMLElement && mediaScrollClickSuppressions.has(media)) {
      mediaScrollClickSuppressions.delete(media);
      event.preventDefault();
      return;
    }

    const card = target.closest(cardSelector);
    if (!(card instanceof HTMLElement)) return;
    if (target.closest(starSelector)) return;
    if (target.closest(actionSelector)) return;

    if (card.getAttribute("data-active") === "true") {
      hideCardDot();
    } else {
      setCardDotPosition(card, event.clientX, event.clientY, hasActiveCardBefore(card));
    }
    toggleCard(card);
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches(cardSelector)) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    if (target.getAttribute("data-active") === "true") {
      hideCardDot();
    } else {
      const rect = target.getBoundingClientRect();
      setCardDotPosition(
        target,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        hasActiveCardBefore(target)
      );
    }
    toggleCard(target);
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, button, a, [contenteditable='true']")
    ) {
      return;
    }

    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const beforeActive = document.querySelector(`${cardSelector}[data-active='true']`);
    if (!(beforeActive instanceof HTMLElement)) return;

    event.preventDefault();
    activateAdjacentCard(direction);
  });

  document.addEventListener("event-card:activate", (event) => {
    if (!(event instanceof CustomEvent)) return;

    const detail = event.detail ?? {};
    const eventId = typeof detail.eventId === "string" ? detail.eventId : "";
    const sourceSlug = typeof detail.sourceSlug === "string" ? detail.sourceSlug : "";
    const locationId = typeof detail.locationId === "string" ? detail.locationId : "";
    const cards = Array.from(document.querySelectorAll(cardSelector));
    const targetCard = cards.find((card) => {
      if (!(card instanceof HTMLElement)) return false;
      if (card.hidden || card.closest("[hidden]") || card.getClientRects().length === 0) return false;
      if (eventId) return card.dataset.eventId === eventId;
      if (locationId) return card.dataset.mapLocationId === locationId;
      return Boolean(sourceSlug && card.dataset.mapSourceSlug === sourceSlug);
    });

    if (targetCard instanceof HTMLElement) activateCard(targetCard);
  });

  document.addEventListener("event-card:deactivate-all", deactivateAllCards);

  window.__eventCardToggleBound = true;
};
