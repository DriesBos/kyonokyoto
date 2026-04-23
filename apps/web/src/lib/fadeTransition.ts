import { gsap } from 'gsap';

export const fadeTransition = {
  duration: 0.66,
  delay: 0.66,
  stagger: 0.033,
  ease: 'ease',
} as const;

type FadeOptions = {
  delay?: number;
  duration?: number;
  stagger?: number;
};

export const killFadeTransitionTweens = (targets: gsap.TweenTarget) => {
  gsap.killTweensOf(targets);
};

export const setFadeHidden = (targets: gsap.TweenTarget) => {
  gsap.set(targets, { autoAlpha: 0 });
};

export const setFadeVisible = (targets: gsap.TweenTarget) => {
  gsap.set(targets, { autoAlpha: 1 });
};

export const fadeIn = (targets: gsap.TweenTarget, options: FadeOptions = {}) =>
  gsap.to(targets, {
    autoAlpha: 1,
    duration: options.duration ?? fadeTransition.duration,
    delay: options.delay ?? 0,
    ease: fadeTransition.ease,
    stagger: options.stagger ?? fadeTransition.stagger,
    overwrite: true,
  });

export const fadeOut = (targets: gsap.TweenTarget, options: FadeOptions = {}) =>
  gsap.to(targets, {
    autoAlpha: 0,
    duration: options.duration ?? fadeTransition.duration,
    delay: options.delay ?? 0,
    ease: fadeTransition.ease,
    stagger: options.stagger ?? 0,
    overwrite: true,
  });
