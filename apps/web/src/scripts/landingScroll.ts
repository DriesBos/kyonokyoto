import { gsap } from 'gsap';

type LandingScrollWindow = Window &
  typeof globalThis & {
    __landingScrollBound?: boolean;
    __landingScrollAnimation?: gsap.core.Tween;
  };

const landingSelector = '[data-landing]';
const landingTriggerSelector = '[data-landing-trigger]';
const mainContentSelector = '[data-main-content]';
const launchedAttribute = 'data-landing-launched';
const activeAttribute = 'data-landing-active';
const landingExitEventName = 'kyo:landing-exit';
const beigeTheme = '#EFEFEF';
const wheelThreshold = 80;
const touchThreshold = 48;
const animationDurationSeconds = 0.5;
const animationDurationMs = animationDurationSeconds * 1000;

const landingWindow = window as LandingScrollWindow;

const getElements = () => {
  const landing = document.querySelector(landingSelector);
  const mainContent = document.querySelector(mainContentSelector);

  if (!(landing instanceof HTMLElement) || !(mainContent instanceof HTMLElement)) return null;
  return { landing, mainContent };
};

const cancelCurrentAnimation = () => {
  if (!landingWindow.__landingScrollAnimation) return;
  landingWindow.__landingScrollAnimation.kill();
  landingWindow.__landingScrollAnimation = undefined;
};

const setThemeColor = (color: string) => {
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor instanceof HTMLMetaElement) {
    themeColor.content = color;
  }
};

const getActiveThemeColor = () => {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--color-green').trim();
  return color || '#138e00';
};

const scrollToMainContent = (mainContent: HTMLElement) => {
  const startY = window.scrollY;
  const targetY = mainContent.getBoundingClientRect().top + window.scrollY;
  const scrollState = { y: startY };

  cancelCurrentAnimation();
  document.documentElement.setAttribute(launchedAttribute, '');
  window.dispatchEvent(new CustomEvent(landingExitEventName));

  landingWindow.__landingScrollAnimation = gsap.to(scrollState, {
    y: targetY,
    duration: animationDurationSeconds,
    ease: 'power3.inOut',
    onUpdate: () => {
      window.scrollTo(0, scrollState.y);
    },
    onComplete: () => {
      landingWindow.__landingScrollAnimation = undefined;
      window.scrollTo(0, targetY);
      document.documentElement.removeAttribute(activeAttribute);
      setThemeColor(beigeTheme);
    },
  });
};

const resetScrollPosition = () => {
  if (window.location.hash) return;
  cancelCurrentAnimation();
  document.documentElement.setAttribute(activeAttribute, '');
  document.documentElement.removeAttribute(launchedAttribute);
  setThemeColor(getActiveThemeColor());
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
    if (typeof currentY !== 'number') return;

    const delta = touchStartY - currentY;
    if (delta <= 0) return;

    event.preventDefault();
    if (delta >= touchThreshold) launch();
  };

  resetScrollPosition();

  document.addEventListener('click', handleClick);
  window.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('touchstart', handleTouchStart, { passive: true });
  window.addEventListener('touchmove', handleTouchMove, { passive: false });
  window.addEventListener('pageshow', resetScrollPosition);
  document.addEventListener('astro:page-load', resetScrollPosition);

  landingWindow.__landingScrollBound = true;
};
