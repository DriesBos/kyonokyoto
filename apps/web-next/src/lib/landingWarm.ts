import {
  resolveBlocksLandingSlides,
  type BlocksLandingCandidate,
  type BlocksLandingHero,
} from './blocksLanding.ts';
import { landingAspectClasses, transformCandidatesFor } from './landingImages.ts';
import { landingMediaDeliveryUrl } from './mediaDelivery.ts';

// Common screens (CSS width, height, devicePixelRatio). The crawl cycle requests the landing
// transforms these produce right after a crawl, so real visitors hit a warm Netlify Image CDN
// entry instead of waiting for Netlify to fetch the original and transform it.
export const landingWarmViewports: [number, number, number][] = [
  [360, 800, 3],
  [375, 812, 3],
  [390, 844, 3],
  [393, 852, 3],
  [412, 915, 2.625],
  [430, 932, 3],
  [844, 390, 3],
  [768, 1024, 2],
  [820, 1180, 2],
  [1024, 1366, 2],
  [1280, 800, 2],
  [1366, 768, 1],
  [1440, 900, 2],
  [1512, 982, 2],
  [1536, 864, 1.25],
  [1728, 1117, 2],
  [1920, 1080, 1],
  [2560, 1440, 1],
];

// Same URLs the client builds: every srcset entry of each possible hero (the browser picks one by
// screen), plus every event in the pool for each common viewport, since each visit picks its
// own random order and rotation runs through the whole pool.
export const landingWarmUrls = (
  candidates: BlocksLandingCandidate[],
  heroes: BlocksLandingHero[],
): string[] => {
  const urls = new Set<string>();
  const add = (src: string, width: number, height: number) => {
    const url = landingMediaDeliveryUrl(src, width, height, true);
    if (url) urls.add(url);
  };

  for (const hero of heroes) {
    for (const aspectClass of landingAspectClasses) {
      for (const size of transformCandidatesFor(hero, aspectClass)) {
        add(hero.src, size.width, size.height);
      }
    }
  }

  for (const [viewportWidth, viewportHeight, devicePixelRatio] of landingWarmViewports) {
    const slides = resolveBlocksLandingSlides({
      candidates,
      viewportWidth,
      viewportHeight,
      devicePixelRatio,
      limit: candidates.length,
    });
    for (const slide of slides) add(slide.src, slide.width, slide.height);
  }

  return [...urls];
};
