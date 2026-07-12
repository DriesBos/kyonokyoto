import { gsap } from 'gsap';

type LandingScrollWindow = Window &
  typeof globalThis & {
    __landingScrollBound?: boolean;
    __landingScrollAnimation?: gsap.core.Tween;
    __landingScrollUnlockInteractions?: () => void;
  };

const landingSelector = '[data-landing]';
const landingTriggerSelector = '[data-landing-trigger]';
const cityToggleSelector = '[data-city-toggle]';
const activeAttribute = 'data-landing-active';
const landingExitEventName = 'kyo:landing-exit';
const cityCycleLandingKey = 'kyo:landing-city-cycle';
const beigeTheme = '#EFEFEF';
const wheelThreshold = 80;
const touchThreshold = 48;
const animationDurationSeconds = 0.5;
const animationDurationMs = animationDurationSeconds * 1000;
const revealDurationSeconds = 0.28;
const lockedInteractionEvents = [
  'click',
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
] as const;
const lockedInteractionOptions = { capture: true, passive: false };

const landingWindow = window as LandingScrollWindow;

const getElements = () => {
  const landing = document.querySelector(landingSelector);

  if (!(landing instanceof HTMLElement)) return null;
  return { landing };
};

const cancelCurrentAnimation = () => {
  if (landingWindow.__landingScrollAnimation) {
    landingWindow.__landingScrollAnimation.kill();
    landingWindow.__landingScrollAnimation = undefined;
  }
  unlockLandingInteractions();
};

const blockLockedInteraction = (event: Event) => {
  if (event.cancelable) event.preventDefault();
  event.stopImmediatePropagation();
};

const unlockLandingInteractions = () => {
  if (!landingWindow.__landingScrollUnlockInteractions) return;
  landingWindow.__landingScrollUnlockInteractions();
  landingWindow.__landingScrollUnlockInteractions = undefined;
};

const lockLandingInteractions = () => {
  unlockLandingInteractions();
  lockedInteractionEvents.forEach((eventName) => {
    window.addEventListener(eventName, blockLockedInteraction, lockedInteractionOptions);
  });
  landingWindow.__landingScrollUnlockInteractions = () => {
    lockedInteractionEvents.forEach((eventName) => {
      window.removeEventListener(eventName, blockLockedInteraction, lockedInteractionOptions);
    });
  };
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

const consumeCityCycleLanding = () => {
  try {
    const shouldAnimate = sessionStorage.getItem(cityCycleLandingKey) === '1';
    sessionStorage.removeItem(cityCycleLandingKey);
    return shouldAnimate;
  } catch {
    return false;
  }
};

const markCityCycleLanding = () => {
  try {
    sessionStorage.setItem(cityCycleLandingKey, '1');
  } catch {
    // Storage failure should not block navigation.
  }
};

const hideLanding = (landing: HTMLElement) => {
  cancelCurrentAnimation();
  window.dispatchEvent(new CustomEvent(landingExitEventName));

  landingWindow.__landingScrollAnimation = gsap.to(landing, {
    yPercent: -100,
    duration: animationDurationSeconds,
    ease: 'power3.inOut',
    onComplete: () => {
      landingWindow.__landingScrollAnimation = undefined;
      landing.hidden = true;
      landing.inert = true;
      document.documentElement.removeAttribute(activeAttribute);
      setThemeColor(beigeTheme);
    },
  });
};

const resetLanding = (landing: HTMLElement, animate = false) => {
  cancelCurrentAnimation();
  landing.hidden = false;
  landing.inert = false;
  document.documentElement.setAttribute(activeAttribute, '');
  setThemeColor(getActiveThemeColor());

  if (!animate) {
    gsap.set(landing, { yPercent: 0 });
    return;
  }

  lockLandingInteractions();
  gsap.set(landing, { yPercent: -100 });
  landingWindow.__landingScrollAnimation = gsap.to(landing, {
    yPercent: 0,
    duration: revealDurationSeconds,
    ease: 'power3.out',
    onComplete: () => {
      landingWindow.__landingScrollAnimation = undefined;
      unlockLandingInteractions();
    },
  });
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
    hideLanding(elements.landing);
    window.setTimeout(() => {
      isAnimating = false;
      wheelDelta = 0;
      touchStartY = null;
      touchStartedOnLanding = false;
    }, animationDurationMs + 80);
  };

  const isLandingActive = () => {
    return !elements.landing.hidden && document.documentElement.hasAttribute(activeAttribute);
  };

  const handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(landingTriggerSelector)) return;
    event.preventDefault();
    launch();
  };

  const handleCityToggleClick = (event: MouseEvent) => {
    const target = event.target;
    const link = target instanceof Element ? target.closest(cityToggleSelector) : null;
    if (
      !(link instanceof HTMLAnchorElement) ||
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      link.target
    ) {
      return;
    }

    markCityCycleLanding();
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

  resetLanding(elements.landing, consumeCityCycleLanding());

  document.addEventListener('click', handleClick);
  document.addEventListener('click', handleCityToggleClick);
  window.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('touchstart', handleTouchStart, { passive: true });
  window.addEventListener('touchmove', handleTouchMove, { passive: false });
  window.addEventListener('pageshow', () =>
    resetLanding(elements.landing, consumeCityCycleLanding()),
  );
  document.addEventListener('astro:page-load', () =>
    resetLanding(elements.landing, consumeCityCycleLanding()),
  );

  landingWindow.__landingScrollBound = true;
};
