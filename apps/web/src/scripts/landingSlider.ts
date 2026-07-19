import { gsap } from 'gsap';
import type { LandingSlide, LandingSlideImage } from '../lib/landingSlides';

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
const rowStaggerSeconds = 0.02;
const rowOverlapPixels = 1;
const minimumCoverDensity = 1.5;
const maximumCoverDensity = 2;
const imageQuality = 82;
const coveredClipPath = 'inset(0% 0 0 0)';
const collapsedTopClipPath = 'inset(0 0 100% 0)';
const collapsedBottomClipPath = 'inset(100% 0 0 0)';

type ResolvedLandingSlide = LandingSlide & {
  src: string;
  width: number;
  height: number;
};

const isLandingSlideImage = (image: unknown): image is LandingSlideImage => {
  if (!image || typeof image !== 'object') return false;
  const candidate = image as Partial<LandingSlideImage>;
  return (
    typeof candidate.src === 'string' &&
    candidate.src.length > 0 &&
    Number.isFinite(candidate.width) &&
    Number.isFinite(candidate.height) &&
    Number(candidate.width) > 0 &&
    Number(candidate.height) > 0
  );
};

const parseSlides = (payload: Element | null): LandingSlide[] => {
  if (!(payload instanceof HTMLScriptElement)) return [];

  try {
    const parsed = JSON.parse(payload.textContent ?? '[]');
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((slide) => {
      if (
        !slide ||
        typeof slide !== 'object' ||
        typeof slide.title !== 'string' ||
        typeof slide.sourceSlug !== 'string'
      ) {
        return [];
      }

      const images = Array.isArray(slide.images) ? slide.images.filter(isLandingSlideImage) : [];
      return images.length > 0 ? [{ ...slide, images }] : [];
    });
  } catch {
    return [];
  }
};

export const coverDensityFor = (
  image: Pick<LandingSlideImage, 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
) => Math.min(image.width / viewportWidth, image.height / viewportHeight);

const netlifyImageUrl = (src: string, width: number, height: number) => {
  try {
    if (!src.startsWith('/') && new URL(src).protocol !== 'https:') return null;
  } catch {
    return null;
  }

  if (import.meta.env?.DEV) return src;

  const params = new URLSearchParams({
    url: src,
    w: String(width),
    h: String(height),
    fit: 'cover',
    position: 'center',
    q: String(imageQuality),
  });
  return `/.netlify/images?${params}`;
};

export const resolveLandingSlides = ({
  slides,
  viewportWidth,
  viewportHeight,
  devicePixelRatio = 1,
}: {
  slides: LandingSlide[];
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio?: number;
}): ResolvedLandingSlide[] => {
  if (viewportWidth <= 0 || viewportHeight <= 0) return [];

  const preferredDensity = Math.min(
    maximumCoverDensity,
    Math.max(minimumCoverDensity, devicePixelRatio),
  );

  return slides.flatMap((slide) => {
    const image = slide.images.find(
      (candidate) =>
        coverDensityFor(candidate, viewportWidth, viewportHeight) >= minimumCoverDensity,
    );
    if (!image) return [];

    const density = Math.min(
      preferredDensity,
      coverDensityFor(image, viewportWidth, viewportHeight),
    );
    const width = Math.floor(viewportWidth * density);
    const height = Math.floor(viewportHeight * density);
    const src = netlifyImageUrl(image.src, width, height);
    return src ? [{ ...slide, src, width, height }] : [];
  });
};

const preloadImage = (src: string) =>
  new Promise<boolean>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () =>
      image.decode().then(
        () => resolve(true),
        () => resolve(true),
      );
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

const createSlideElements = (container: HTMLElement, slides: ResolvedLandingSlide[]) => {
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
    image.fetchPriority = index === 0 ? 'high' : 'low';
    image.width = slide.width;
    image.height = slide.height;
    frame.append(image);
    fragment.append(frame);
  });

  container.replaceChildren(fragment);
};

const createRows = (
  root: HTMLElement,
  container: HTMLElement,
  content: HTMLElement,
  fillClipPath: string,
) => {
  const preferredRowHeight = rowHeightFor(root);
  const { width, height } = root.getBoundingClientRect();
  const minimumRowCount = Math.ceil(height / preferredRowHeight);
  const rowCount = minimumRowCount + (minimumRowCount % 2 === 0 ? 1 : 0);
  const rowHeight = (height + (rowCount - 1) * rowOverlapPixels) / rowCount;
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < rowCount; index += 1) {
    const rowTop = index * (rowHeight - rowOverlapPixels);
    const row = document.createElement('span');
    const fill = document.createElement('span');
    const whiteContent = content.cloneNode(true) as HTMLElement;

    row.className = 'landing__shutter-row';
    row.style.flexBasis = `${rowHeight}px`;
    if (index < rowCount - 1) row.style.marginBottom = `-${rowOverlapPixels}px`;
    fill.className = 'landing__shutter-fill';
    fill.style.clipPath = fillClipPath;
    whiteContent.classList.add('landing__content--shutter');
    whiteContent.setAttribute('aria-hidden', 'true');
    whiteContent.style.width = `${width}px`;
    whiteContent.style.height = `${height}px`;
    whiteContent.style.setProperty('--landing-shutter-content-top', `${rowTop}px`);
    fill.append(whiteContent);
    row.append(fill);
    fragment.append(row);
  }

  container.replaceChildren(fragment);
};

export const initLandingSlider = () => {
  const sliderWindow = window as LandingSliderWindow;
  sliderWindow.__landingSliderCleanup?.();

  const root = document.querySelector(rootSelector);
  const slider = document.querySelector(sliderSelector);
  const slidesContainer = document.querySelector(slidesSelector);
  const shuttersContainer = document.querySelector(shuttersSelector);
  const content = root instanceof HTMLElement ? root.querySelector('.landing__content') : null;
  const slides = parseSlides(document.querySelector(payloadSelector));

  if (
    !(root instanceof HTMLElement) ||
    !(slider instanceof HTMLElement) ||
    !(slidesContainer instanceof HTMLElement) ||
    !(shuttersContainer instanceof HTMLElement) ||
    !(content instanceof HTMLElement) ||
    slides.length === 0
  ) {
    sliderWindow.__landingSliderCleanup = undefined;
    return;
  }

  const { width: rootWidth, height: rootHeight } = root.getBoundingClientRect();
  const resolvedSlides = resolveLandingSlides({
    slides,
    viewportWidth: rootWidth,
    viewportHeight: rootHeight,
    devicePixelRatio: window.devicePixelRatio,
  });
  if (resolvedSlides.length === 0) {
    slidesContainer.replaceChildren();
    shuttersContainer.replaceChildren();
    root.removeAttribute('data-landing-slider-ready');
    sliderWindow.__landingSliderCleanup = undefined;
    return;
  }

  let stopped = false;
  let visible = true;
  let activeTween: gsap.core.Tween | null = null;
  let activeIndex = 0;
  let fillClipPath = coveredClipPath;
  const failedIndexes = new Set<number>();

  const fills = () => gsap.utils.toArray<HTMLElement>('.landing__shutter-fill', shuttersContainer);

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

  const animateFills = (clipPath: string, duration: number, fromClipPath?: string) =>
    new Promise<void>((resolve) => {
      const targets = fills();
      if (fromClipPath) gsap.set(targets, { clipPath: fromClipPath });
      activeTween = gsap.to(targets, {
        clipPath,
        duration,
        ease: 'power2.inOut',
        stagger: rowStaggerSeconds,
        onComplete: () => {
          fillClipPath = clipPath;
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
      initLandingSlider();
    }, 120);
  };

  const run = async () => {
    while (!stopped && failedIndexes.size < resolvedSlides.length) {
      const loaded = await preloadImage(resolvedSlides[activeIndex].src);
      if (stopped) return;

      if (!loaded) {
        failedIndexes.add(activeIndex);
        activeIndex = (activeIndex + 1) % resolvedSlides.length;
        continue;
      }

      setActiveSlide(activeIndex);
      await wait(solidHoldSeconds);
      if (stopped) return;

      await animateFills(collapsedTopClipPath, revealSeconds);
      if (stopped) return;

      await wait(imageHoldSeconds);
      if (stopped) return;

      await animateFills(coveredClipPath, coverSeconds, collapsedBottomClipPath);
      activeIndex = (activeIndex + 1) % resolvedSlides.length;
    }
  };

  createSlideElements(slidesContainer, resolvedSlides);
  createRows(root, shuttersContainer, content, fillClipPath);
  root.toggleAttribute('data-landing-slider-ready', true);
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
    root.removeAttribute('data-landing-slider-ready');
    sliderWindow.__landingSliderCleanup = undefined;
  };
};
