const imageSelector = '.event-card__image';
const frameSelector = '.event-card__image-frame';
const mediaSelector = '.event-card__media';

// Hide images whose origin is down or blocked instead of showing a broken-image box.
const hideBrokenImage = (image: HTMLImageElement) => {
  const frame = image.closest(frameSelector);
  if (!(frame instanceof HTMLElement)) return;
  frame.style.display = 'none';

  const media = frame.closest(mediaSelector);
  if (!(media instanceof HTMLElement)) return;
  const hasVisibleMedia = Array.from(media.querySelectorAll(`${frameSelector}, [data-youtube-embed]`)).some(
    (element) => !(element instanceof HTMLElement && element.style.display === 'none'),
  );
  if (!hasVisibleMedia) media.style.display = 'none';
};

const isBrokenImage = (image: HTMLImageElement) => image.complete && image.naturalWidth === 0;

export const initEventImageFallback = () => {
  document.querySelectorAll<HTMLImageElement>(imageSelector).forEach((image) => {
    if (isBrokenImage(image) && image.currentSrc) hideBrokenImage(image);
  });

  if (window.__eventImageFallbackBound) return;

  document.addEventListener(
    'error',
    (event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement && target.matches(imageSelector)) {
        hideBrokenImage(target);
      }
    },
    true,
  );

  window.__eventImageFallbackBound = true;
};
