type LandingScrollWindow = Window &
  typeof globalThis & {
    __landingScrollBound?: boolean;
    __landingScrollAnimation?: number;
  };

const landingSelector = "[data-landing]";
const landingTriggerSelector = "[data-landing-trigger]";
const mainContentSelector = "[data-main-content]";
const launchedAttribute = "data-landing-launched";
const wheelThreshold = 80;
const touchThreshold = 48;
const animationDurationMs = 820;

const landingWindow = window as LandingScrollWindow;

const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

const getElements = () => {
  const landing = document.querySelector(landingSelector);
  const mainContent = document.querySelector(mainContentSelector);

  if (!(landing instanceof HTMLElement) || !(mainContent instanceof HTMLElement)) return null;
  return { landing, mainContent };
};

const cancelCurrentAnimation = () => {
  if (!landingWindow.__landingScrollAnimation) return;
  window.cancelAnimationFrame(landingWindow.__landingScrollAnimation);
  landingWindow.__landingScrollAnimation = 0;
};

const scrollToMainContent = (mainContent: HTMLElement) => {
  const startY = window.scrollY;
  const targetY = mainContent.getBoundingClientRect().top + window.scrollY;
  const distance = targetY - startY;
  const startTime = performance.now();

  cancelCurrentAnimation();
  document.documentElement.setAttribute(launchedAttribute, "");

  const step = (time: number) => {
    const elapsed = time - startTime;
    const progress = Math.min(elapsed / animationDurationMs, 1);
    window.scrollTo(0, startY + distance * easeOutCubic(progress));

    if (progress < 1) {
      landingWindow.__landingScrollAnimation = window.requestAnimationFrame(step);
      return;
    }

    landingWindow.__landingScrollAnimation = 0;
    window.scrollTo(0, targetY);
  };

  landingWindow.__landingScrollAnimation = window.requestAnimationFrame(step);
};

const resetScrollPosition = () => {
  if (window.location.hash) return;
  cancelCurrentAnimation();
  document.documentElement.removeAttribute(launchedAttribute);
  window.scrollTo(0, 0);
};

export const initLandingScroll = () => {
  if (landingWindow.__landingScrollBound) return;

  const elements = getElements();
  if (!elements) return;

  let wheelDelta = 0;
  let touchStartY: number | null = null;
  let touchStartedOnLanding = false;
  let isAnimating = false;

  const launch = () => {
    if (isAnimating) return;
    isAnimating = true;
    scrollToMainContent(elements.mainContent);
    window.setTimeout(() => {
      isAnimating = false;
      wheelDelta = 0;
      touchStartY = null;
      touchStartedOnLanding = false;
    }, animationDurationMs + 80);
  };

  const isLandingActive = () => {
    const landingBottom = elements.landing.getBoundingClientRect().bottom;
    return landingBottom > 1 && window.scrollY < elements.mainContent.offsetTop - 1;
  };

  const handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(landingTriggerSelector)) return;
    event.preventDefault();
    launch();
  };

  const handleWheel = (event: WheelEvent) => {
    if (!isLandingActive()) return;
    if (event.deltaY <= 0) {
      wheelDelta = 0;
      return;
    }

    event.preventDefault();
    wheelDelta += event.deltaY;

    if (wheelDelta >= wheelThreshold) launch();
  };

  const handleTouchStart = (event: TouchEvent) => {
    const target = event.target;
    touchStartedOnLanding = target instanceof Element && Boolean(target.closest(landingSelector));
    touchStartY = event.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (!touchStartedOnLanding || !isLandingActive() || touchStartY === null) return;

    const currentY = event.touches[0]?.clientY;
    if (typeof currentY !== "number") return;

    const delta = touchStartY - currentY;
    if (delta <= 0) return;

    event.preventDefault();
    if (delta >= touchThreshold) launch();
  };

  resetScrollPosition();

  document.addEventListener("click", handleClick);
  window.addEventListener("wheel", handleWheel, { passive: false });
  window.addEventListener("touchstart", handleTouchStart, { passive: true });
  window.addEventListener("touchmove", handleTouchMove, { passive: false });
  window.addEventListener("pageshow", resetScrollPosition);
  document.addEventListener("astro:page-load", resetScrollPosition);

  landingWindow.__landingScrollBound = true;
};
