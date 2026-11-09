import type { BlocksLandingHeroOption } from './blocksLanding.ts';
import { landingPreloadsFor } from './landingImages.ts';
import { LANDING_SEEN_KEY } from './landingSeen.ts';
import { landingMediaDeliveryUrl } from './mediaDelivery.ts';

export const LANDING_HERO_GLOBAL = '__kyoLandingHero';

// Inline script, rendered in the page HTML before the landing: picks this visit's first slide
// (one the browser hasn't shown yet, else the one shown longest ago, see lib/landingSeen.ts) and
// preloads its image straight from the HTML, before hydration. The page itself is CDN-cached,
// so this is where per-visit randomness can happen without delaying the first image.
// BlocksLanding reads the pick from window[LANDING_HERO_GLOBAL].
export const landingHeroScript = (
  options: BlocksLandingHeroOption[],
  useNetlifyImageCdn: boolean,
): string | null => {
  const data = options.flatMap((option) => {
    const fallback = landingMediaDeliveryUrl(option.files.desktop, useNetlifyImageCdn);
    if (!fallback) return [];
    return [
      {
        id: option.id,
        preloads: landingPreloadsFor(option.files, useNetlifyImageCdn),
        fallback,
      },
    ];
  });
  if (data.length === 0) return null;
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  const key = JSON.stringify(LANDING_SEEN_KEY);
  const global = JSON.stringify(LANDING_HERO_GLOBAL);
  return `(function(){try{var o=${json},s=[];try{s=JSON.parse(localStorage.getItem(${key})||"[]")}catch(e){}if(!Array.isArray(s))s=[];var u=o.filter(function(x){return s.indexOf(x.id)<0}),h;if(u.length)h=u[Math.floor(Math.random()*u.length)];else h=o.slice().sort(function(a,b){return s.indexOf(a.id)-s.indexOf(b.id)})[0];window[${global}]=h.id;var l=h.preloads.length?h.preloads:[{href:h.fallback}];l.forEach(function(p){var e=document.createElement("link");e.rel="preload";e.as="image";e.setAttribute("fetchpriority","high");if(p.href)e.href=p.href;if(p.srcSet){e.setAttribute("imagesrcset",p.srcSet);e.setAttribute("imagesizes",p.sizes)}if(p.media)e.media=p.media;document.head.appendChild(e)})}catch(e){}})();`;
};
