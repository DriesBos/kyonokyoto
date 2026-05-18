import { gsap } from "gsap";

type LandingCountUpWindow = Window &
  typeof globalThis & {
    __landingCountUpBound?: boolean;
  };

const landingSelector = "[data-landing]";
const countSelector = "[data-landing-count]";
const previousSelector = "[data-landing-count-previous]";
const currentSelector = "[data-landing-count-current]";

const landingWindow = window as LandingCountUpWindow;

export const initLandingCountUp = () => {
  if (landingWindow.__landingCountUpBound) return;

  const landing = document.querySelector(landingSelector);
  if (!(landing instanceof HTMLElement)) return;

  const counts = gsap.utils.toArray<HTMLElement>(countSelector, landing);
  if (counts.length === 0) return;

  counts.forEach((count) => {
    const previous = count.querySelector(previousSelector);
    const current = count.querySelector(currentSelector);

    if (!(previous instanceof HTMLElement) || !(current instanceof HTMLElement)) return;

    gsap.set(previous, { yPercent: 0 });
    gsap.set(current, { yPercent: -100 });

    gsap
      .timeline({
        delay: 0.25,
        defaults: {
          duration: 0.48,
          ease: "power3.out",
        },
      })
      .to(previous, { yPercent: 100 }, 0)
      .to(current, { yPercent: 0 }, 0);
  });

  landingWindow.__landingCountUpBound = true;
};
