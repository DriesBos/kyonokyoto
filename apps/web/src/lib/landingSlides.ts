import type { AppCity } from './cities';
import type { ClassifiedEvent } from './events';

export type LandingSlide = {
  src: string;
  title: string;
  sourceSlug: string;
};

export const landingSlideLimit = 6;

export const landingSliderSourceSlugsByCity = {
  kyoto: ['kcua-gallery', 'artro'],
  osaka: ['national-museum-of-art-osaka', 'abeno-harukas-art-museum'],
  tokyo: ['scai-the-bathhouse'],
} satisfies Record<AppCity, string[]>;

type LandingSlideEvent = Pick<
  ClassifiedEvent,
  'id' | 'title' | 'timing' | 'image_urls' | 'primary_image_url'
>;

const firstEventImage = (event: LandingSlideEvent) =>
  event.image_urls?.find(Boolean) ?? event.primary_image_url ?? null;

export const landingSlidesForEvents = ({
  city,
  events,
  sourceSlugByEventId,
  limit = landingSlideLimit,
}: {
  city: AppCity;
  events: LandingSlideEvent[];
  sourceSlugByEventId: Map<string, string | null>;
  limit?: number;
}): LandingSlide[] => {
  const selectedSourceSlugs = new Set(landingSliderSourceSlugsByCity[city]);
  const seenImages = new Set<string>();
  const slides: LandingSlide[] = [];

  for (const event of events) {
    if (event.timing === 'permanent') continue;

    const sourceSlug = sourceSlugByEventId.get(event.id);
    if (!sourceSlug || !selectedSourceSlugs.has(sourceSlug)) continue;

    const src = firstEventImage(event);
    if (!src || seenImages.has(src)) continue;

    seenImages.add(src);
    slides.push({ src, title: event.title, sourceSlug });

    if (slides.length >= limit) break;
  }

  return slides;
};
