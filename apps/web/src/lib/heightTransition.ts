import { gsap } from 'gsap';

type HeightTimeline = ReturnType<typeof gsap.timeline>;
type HeightPosition = Parameters<HeightTimeline['to']>[2];

export const heightTransition = {
  ease: 'power3.out',
  expandDuration: 0.25,
  collapseDuration: 0.25,
} as const;

export const getHeightTransitionDuration = (isExpanding: boolean) =>
  isExpanding
    ? heightTransition.expandDuration
    : heightTransition.collapseDuration;

export const createHeightTransitionTimeline = (
  options: Parameters<typeof gsap.timeline>[0] = {},
) =>
  gsap.timeline({
    ...options,
    defaults: {
      ease: heightTransition.ease,
      ...options.defaults,
    },
  });

export const killHeightTransitionTweens = (targets: gsap.TweenTarget) => {
  gsap.killTweensOf(targets);
};

export const toHeight = (
  timeline: HeightTimeline,
  element: HTMLElement,
  height: number,
  isExpanding: boolean,
  position: HeightPosition = 0,
) => {
  timeline.to(
    element,
    {
      height,
      duration: getHeightTransitionDuration(isExpanding),
    },
    position,
  );

  return timeline;
};
