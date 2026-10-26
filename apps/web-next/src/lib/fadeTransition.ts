import { gsap } from 'gsap';

export const fadeTransition = {
  duration: 0.66,
  delay: 0.66,
  stagger: 0.033,
  ease: 'ease',
} as const;

// Reduced motion: fades complete instantly (no duration, delay or stagger).
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type FadeOptions = {
  delay?: number;
  duration?: number;
  stagger?: number;
};

export const killFadeTransitionTweens = (targets: gsap.TweenTarget) => {
  gsap.killTweensOf(targets);
};

export const setFadeHidden = (targets: gsap.TweenTarget) => {
  gsap.set(targets, { opacity: 0, visibility: 'visible' });
};

export const setFadeVisible = (targets: gsap.TweenTarget) => {
  gsap.set(targets, { opacity: 1, visibility: 'visible' });
};

export const fadeIn = (targets: gsap.TweenTarget, options: FadeOptions = {}) =>
  gsap.to(targets, {
    opacity: 1,
    visibility: 'visible',
    ...(reducedMotion()
      ? { duration: 0, delay: 0, stagger: 0 }
      : {
          duration: options.duration ?? fadeTransition.duration,
          delay: options.delay ?? 0,
          stagger: options.stagger ?? fadeTransition.stagger,
        }),
    ease: fadeTransition.ease,
    overwrite: true,
  });

export const fadeOut = (targets: gsap.TweenTarget, options: FadeOptions = {}) =>
  gsap.to(targets, {
    opacity: 0,
    visibility: 'visible',
    ...(reducedMotion()
      ? { duration: 0, delay: 0, stagger: 0 }
      : {
          duration: options.duration ?? fadeTransition.duration,
          delay: options.delay ?? 0,
          stagger: options.stagger ?? 0,
        }),
    ease: fadeTransition.ease,
    overwrite: true,
  });
