import { landingMediaDeliveryUrl } from './mediaDelivery.ts';

// Each landing event has exactly two image files, made by the crawler (apps/crawler/src/
// landing-media.mjs): a 1920x1080 desktop crop and a 900x1600 mobile crop. Two fixed files per
// image keep Supabase egress small (docs/supabase-free-plan.md); CSS object-fit covers any screen.
export type LandingFiles = { desktop: string; mobile: string };
export type LandingImageSize = { width: number; height: number };

export const landingDesktopSize: LandingImageSize = { width: 1920, height: 1080 };
export const landingMobileSize: LandingImageSize = { width: 900, height: 1600 };

// Portrait and square screens get the mobile file.
export const landingMobileMedia = '(max-aspect-ratio: 1/1)';
const landingDesktopMedia = '(min-aspect-ratio: 1001/1000)';

export const landingUsesMobile = (viewportWidth: number, viewportHeight: number) =>
  viewportWidth > 0 && viewportHeight > 0 && viewportWidth <= viewportHeight;

export const landingFileFor = (
  files: LandingFiles,
  viewportWidth: number,
  viewportHeight: number,
): { src: string } & LandingImageSize =>
  landingUsesMobile(viewportWidth, viewportHeight)
    ? { src: files.mobile, ...landingMobileSize }
    : { src: files.desktop, ...landingDesktopSize };

// Server-rendered first slide: the <img> is the desktop file, this <source> swaps in the mobile one.
export const landingPictureSourcesFor = (files: LandingFiles, useNetlifyImageCdn: boolean) => {
  const mobile = landingMediaDeliveryUrl(files.mobile, useNetlifyImageCdn);
  return mobile ? [{ media: landingMobileMedia, srcSet: mobile }] : [];
};

// <link rel="preload"> for the first slide: exactly one of the two files matches any screen.
export const landingPreloadsFor = (files: LandingFiles, useNetlifyImageCdn: boolean) =>
  [
    { media: landingMobileMedia, href: landingMediaDeliveryUrl(files.mobile, useNetlifyImageCdn) },
    {
      media: landingDesktopMedia,
      href: landingMediaDeliveryUrl(files.desktop, useNetlifyImageCdn),
    },
  ].flatMap((preload) => (preload.href ? [{ media: preload.media, href: preload.href }] : []));
