import { gsap } from 'gsap';
import type { LandingSlide } from '../lib/landingSlides';

type LandingSliderWindow = Window &
  typeof globalThis & {
    __landingSliderCleanup?: () => void;
  };

const rootSelector = '[data-landing]';
const sliderSelector = '[data-landing-slider]';
const slidesSelector = '[data-landing-slider-slides]';
const shuttersSelector = '[data-landing-slider-shutters]';
const payloadSelector = '[data-landing-slider-payload]';
const exitEventName = 'kyo:landing-exit';

const solidHoldSeconds = 1;
const revealSeconds = 0.75;
const imageHoldSeconds = 1.5;
const coverSeconds = 0.75;
const rowStaggerSeconds = 0;

const sliderWindow = window as LandingSliderWindow;

const parseSlides = (payload: Element | null): LandingSlide[] => {
  if (!(payload instanceof HTMLScriptElement)) return [];

  try {
    const parsed = JSON.parse(payload.textContent ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((slide) => typeof slide?.src === 'string' && slide.src)
      : [];
  } catch {
    return [];
  }
};

const preloadImage = (src: string) =>
  new Promise<boolean>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = src;
  });

const toPixels = (value: string, root: HTMLElement) => {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (trimmed.endsWith('px')) return Number.parseFloat(trimmed);

  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.height = trimmed;
  root.append(probe);
  const pixels = probe.getBoundingClientRect().height;
  probe.remove();
  return pixels;
};

const rowHeightFor = (root: HTMLElement) => {
  const rawHeight = getComputedStyle(root).getPropertyValue('--landing-slider-row-height');
  return toPixels(rawHeight, root) || 160;
};

const createSlideElements = (container: HTMLElement, slides: LandingSlide[]) => {
  const fragment = document.createDocumentFragment();

  slides.forEach((slide, index) => {
    const frame = document.createElement('span');
    const image = document.createElement('img');

    frame.className = 'landing__slide';
    frame.dataset.landingSlideIndex = String(index);
    frame.toggleAttribute('data-active', index === 0);
    image.src = slide.src;
    image.alt = '';
    image.decoding = 'async';
    image.loading = index === 0 ? 'eager' : 'lazy';
    frame.append(image);
    fragment.append(frame);
  });

  container.replaceChildren(fragment);
};

const createRows = (root: HTMLElement, container: HTMLElement, fillHeight: string) => {
  const rowHeight = rowHeightFor(root);
  const rowCount = Math.ceil(root.getBoundingClientRect().height / rowHeight) + 1;
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < rowCount; index += 1) {
    const row = document.createElement('span');
    const fill = document.createElement('span');

    row.className = 'landing__shutter-row';
    fill.className = 'landing__shutter-fill';
    fill.style.height = fillHeight;
    row.append(fill);
    fragment.append(row);
  }

  container.replaceChildren(fragment);
};

export const initLandingSlider = () => {
  sliderWindow.__landingSliderCleanup?.();

  const root = document.querySelector(rootSelector);
  const slider = document.querySelector(sliderSelector);
  const slidesContainer = document.querySelector(slidesSelector);
  const shuttersContainer = document.querySelector(shuttersSelector);
  const slides = parseSlides(document.querySelector(payloadSelector));

  if (
    !(root instanceof HTMLElement) ||
    !(slider instanceof HTMLElement) ||
    !(slidesContainer instanceof HTMLElement) ||
    !(shuttersContainer instanceof HTMLElement) ||
    slides.length === 0
  ) {
    sliderWindow.__landingSliderCleanup = undefined;
    return;
  }

  let stopped = false;
  let visible = true;
  let activeTween: gsap.core.Tween | null = null;
  let activeIndex = 0;
  let fillHeight = '100%';
  const failedIndexes = new Set<number>();

  const fills = () => gsap.utils.toArray<HTMLElement>('.landing__shutter-fill', shuttersContainer);
  const setFillOrigin = (origin: 'top' | 'bottom') => {
    fills().forEach((fill) => {
      fill.dataset.fillOrigin = origin;
    });
  };

  const pauseOrResume = () => {
    if (!activeTween) return;
    if (visible) activeTween.resume();
    else activeTween.pause();
  };

  const wait = (seconds: number) =>
    new Promise<void>((resolve) => {
      activeTween = gsap.delayedCall(seconds, () => {
        activeTween = null;
        resolve();
      });
      pauseOrResume();
    });

  const animateFills = (height: string, duration: number, origin: 'top' | 'bottom') =>
    new Promise<void>((resolve) => {
      setFillOrigin(origin);
      activeTween = gsap.to(fills(), {
        height,
        duration,
        ease: 'power2.inOut',
        stagger: rowStaggerSeconds,
        onComplete: () => {
          fillHeight = height;
          activeTween = null;
          resolve();
        },
      });
      pauseOrResume();
    });

  const setActiveSlide = (index: number) => {
    activeIndex = index;
    slidesContainer.querySelectorAll('.landing__slide').forEach((slide, slideIndex) => {
      slide.toggleAttribute('data-active', slideIndex === index);
    });
  };

  const stop = () => {
    stopped = true;
    activeTween?.kill();
    activeTween = null;
  };

  const observer =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          ([entry]) => {
            visible = Boolean(entry?.isIntersecting);
            pauseOrResume();
          },
          { threshold: 0.1 },
        )
      : null;

  let resizeTimer = 0;
  const handleResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (stopped) return;
      createRows(root, shuttersContainer, fillHeight);
    }, 120);
  };

  const run = async () => {
    while (!stopped && failedIndexes.size < slides.length) {
      const loaded = await preloadImage(slides[activeIndex].src);
      if (stopped) return;

      if (!loaded) {
        failedIndexes.add(activeIndex);
        activeIndex = (activeIndex + 1) % slides.length;
        continue;
      }

      setActiveSlide(activeIndex);
      await wait(solidHoldSeconds);
      if (stopped) return;

      await animateFills('0%', revealSeconds, 'top');
      if (stopped) return;

      await wait(imageHoldSeconds);
      if (stopped) return;

      await animateFills('100%', coverSeconds, 'bottom');
      activeIndex = (activeIndex + 1) % slides.length;
    }
  };

  createSlideElements(slidesContainer, slides);
  createRows(root, shuttersContainer, fillHeight);
  observer?.observe(root);
  window.addEventListener('resize', handleResize);
  window.addEventListener(exitEventName, stop);
  run();

  sliderWindow.__landingSliderCleanup = () => {
    stop();
    observer?.disconnect();
    window.removeEventListener('resize', handleResize);
    window.removeEventListener(exitEventName, stop);
    window.clearTimeout(resizeTimer);
    sliderWindow.__landingSliderCleanup = undefined;
  };
};
