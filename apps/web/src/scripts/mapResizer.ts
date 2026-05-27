const contentSelector = "[data-content-container]";
const eventsSelector = "[data-events-section]";
const mapSelector = "[data-map-section]";
const resizerSelector = "[data-map-resizer]";
const mobileQuery = window.matchMedia("(max-width: 768px)");
const minDesktopPanelRem = 20;
const minMobileMapRem = 10;
const maxMobileMapSvh = 70;
const keyboardStepPx = 24;
const keyboardLargeStepPx = 72;

type ResizeState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startEventsSize: number;
  startMapSize: number;
};

const pxFromRem = (value: number) => {
  const rootSize = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return value * (Number.isFinite(rootSize) ? rootSize : 16);
};

const svhToPx = (value: number) => window.innerHeight * (value / 100);

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getElements = () => {
  const content = document.querySelector(contentSelector);
  const events = document.querySelector(eventsSelector);
  const map = document.querySelector(mapSelector);
  const resizer = document.querySelector(resizerSelector);

  if (
    !(content instanceof HTMLElement) ||
    !(events instanceof HTMLElement) ||
    !(map instanceof HTMLElement) ||
    !(resizer instanceof HTMLElement)
  ) {
    return null;
  }

  return { content, events, map, resizer };
};

let layoutFrame = 0;
const emitLayoutUpdated = () => {
  if (layoutFrame) return;

  layoutFrame = window.requestAnimationFrame(() => {
    layoutFrame = 0;
    document.dispatchEvent(new CustomEvent("map-layout:updated"));
    window.dispatchEvent(new Event("resize"));
  });
};

const isMobileLayout = () => mobileQuery.matches;

const setOrientation = () => {
  const elements = getElements();
  if (!elements) return;

  elements.resizer.setAttribute(
    "aria-orientation",
    isMobileLayout() ? "horizontal" : "vertical",
  );
};

const getDesktopBounds = (content: HTMLElement) => {
  const minSize = pxFromRem(minDesktopPanelRem);
  const maxSize = Math.max(minSize, content.clientWidth - minSize);
  return { minSize, maxSize };
};

const getMobileBounds = () => ({
  minSize: pxFromRem(minMobileMapRem),
  maxSize: Math.max(pxFromRem(minMobileMapRem), svhToPx(maxMobileMapSvh)),
});

const setDesktopEventsSize = (content: HTMLElement, nextSize: number) => {
  const { minSize, maxSize } = getDesktopBounds(content);
  content.style.setProperty(
    "--events-panel-size",
    `${clamp(nextSize, minSize, maxSize)}px`,
  );
};

const setMobileMapSize = (content: HTMLElement, nextSize: number) => {
  const { minSize, maxSize } = getMobileBounds();
  content.style.setProperty(
    "--map-panel-size",
    `${clamp(nextSize, minSize, maxSize)}px`,
  );
};

const startDrag = (
  event: PointerEvent,
  elements: NonNullable<ReturnType<typeof getElements>>,
) => {
  if (!elements.content.hasAttribute("data-map-visible")) return null;

  event.preventDefault();
  elements.resizer.setPointerCapture(event.pointerId);
  elements.content.toggleAttribute("data-map-resizing", true);
  elements.resizer.toggleAttribute("data-dragging", true);

  return {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startEventsSize: elements.events.getBoundingClientRect().width,
    startMapSize: elements.map.getBoundingClientRect().height,
  };
};

const stopDrag = (
  state: ResizeState | null,
  elements: NonNullable<ReturnType<typeof getElements>>,
) => {
  if (!state) return;

  if (elements.resizer.hasPointerCapture(state.pointerId)) {
    elements.resizer.releasePointerCapture(state.pointerId);
  }

  elements.content.toggleAttribute("data-map-resizing", false);
  elements.resizer.toggleAttribute("data-dragging", false);
  emitLayoutUpdated();
};

const applyDrag = (
  event: PointerEvent,
  state: ResizeState,
  elements: NonNullable<ReturnType<typeof getElements>>,
) => {
  if (isMobileLayout()) {
    const delta = event.clientY - state.startClientY;
    setMobileMapSize(elements.content, state.startMapSize + delta);
  } else {
    const delta = event.clientX - state.startClientX;
    setDesktopEventsSize(elements.content, state.startEventsSize + delta);
  }

  emitLayoutUpdated();
};

const applyKeyboardResize = (
  event: KeyboardEvent,
  elements: NonNullable<ReturnType<typeof getElements>>,
) => {
  if (!elements.content.hasAttribute("data-map-visible")) return;

  const isMobile = isMobileLayout();
  const keys = isMobile
    ? ["ArrowUp", "ArrowDown"]
    : ["ArrowLeft", "ArrowRight"];
  if (!keys.includes(event.key)) return;

  event.preventDefault();
  const step = event.shiftKey ? keyboardLargeStepPx : keyboardStepPx;

  if (isMobile) {
    const currentSize = elements.map.getBoundingClientRect().height;
    setMobileMapSize(
      elements.content,
      currentSize + (event.key === "ArrowDown" ? step : -step),
    );
  } else {
    const currentSize = elements.events.getBoundingClientRect().width;
    setDesktopEventsSize(
      elements.content,
      currentSize + (event.key === "ArrowRight" ? step : -step),
    );
  }

  emitLayoutUpdated();
};

export const initMapResizer = () => {
  if (window.__mapResizerBound) return;

  const elements = getElements();
  if (!elements) return;

  let dragState: ResizeState | null = null;

  setOrientation();
  mobileQuery.addEventListener("change", () => {
    setOrientation();
    emitLayoutUpdated();
  });

  elements.resizer.addEventListener("pointerdown", (event) => {
    dragState = startDrag(event, elements);
  });

  elements.resizer.addEventListener("pointermove", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    applyDrag(event, dragState, elements);
  });

  elements.resizer.addEventListener("pointerup", () => {
    stopDrag(dragState, elements);
    dragState = null;
  });

  elements.resizer.addEventListener("pointercancel", () => {
    stopDrag(dragState, elements);
    dragState = null;
  });

  elements.resizer.addEventListener("keydown", (event) => {
    applyKeyboardResize(event, elements);
  });

  window.__mapResizerBound = true;
};
