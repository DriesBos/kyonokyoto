import type { ClassifiedEvent, EventImageMetadata } from './events';

export type LandingSlideImage = {
  src: string;
  width: number;
  height: number;
};

export type LandingSlide = {
  images: LandingSlideImage[];
  title: string;
  sourceSlug: string;
};

type LandingSlideEvent = Pick<
  ClassifiedEvent,
  'id' | 'title' | 'timing' | 'image_urls' | 'primary_image_url' | 'image_metadata'
>;

const isUsableImageMetadata = (
  image: EventImageMetadata,
): image is EventImageMetadata & { width: number; height: number } =>
  typeof image.url === 'string' &&
  image.url.length > 0 &&
  Number.isFinite(image.width) &&
  Number.isFinite(image.height) &&
  Number(image.width) > 0 &&
  Number(image.height) > 0;

const landingImagesForEvent = (event: LandingSlideEvent): LandingSlideImage[] => {
  const eventImageUrls = new Set(
    [event.primary_image_url, ...(event.image_urls ?? [])].filter(Boolean),
  );

  return (event.image_metadata ?? [])
    .filter(isUsableImageMetadata)
    .filter((image) => eventImageUrls.has(image.url))
    .map((image) => ({ src: image.url, width: image.width, height: image.height }));
};

export const landingSlidesForEvents = ({
  events,
  landingSourceSlugs,
  sourceSlugByEventId,
}: {
  events: LandingSlideEvent[];
  landingSourceSlugs: string[];
  sourceSlugByEventId: Map<string, string | null>;
}): LandingSlide[] => {
  const selectedSourceSlugs = new Set(landingSourceSlugs);
  const seenImages = new Set<string>();
  const slides: LandingSlide[] = [];

  for (const event of events) {
    if (event.timing === 'permanent') continue;

    const sourceSlug = sourceSlugByEventId.get(event.id);
    if (!sourceSlug || !selectedSourceSlugs.has(sourceSlug)) continue;

    const images = landingImagesForEvent(event).filter((image) => !seenImages.has(image.src));
    if (images.length === 0) continue;

    images.forEach((image) => seenImages.add(image.src));
    slides.push({ images, title: event.title, sourceSlug });
  }

  return slides;
};
