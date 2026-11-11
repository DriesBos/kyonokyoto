import { gsap } from 'gsap';
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import {
  fadeIn,
  fadeOut,
  killFadeTransitionTweens,
  setFadeHidden,
  setFadeVisible,
} from '@/lib/fadeTransition';
import {
  createHeightTransitionTimeline,
  killHeightTransitionTweens,
  toHeight,
} from '@/lib/heightTransition';

// Height + fade disclosure from apps/web headerControls: the panel grows to its content height
// while its buttons fade in with a stagger, and collapses back to 0 with a fade out.
export function useDisclosurePanel(open: boolean) {
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const buttons = Array.from(panel.querySelectorAll<HTMLElement>('[data-panel-button]'));
    killHeightTransitionTweens(panel);
    killFadeTransitionTweens(buttons);

    if (!mounted.current) {
      mounted.current = true;
      panel.style.height = open ? 'auto' : '0px';
      panel.style.overflow = open ? '' : 'hidden';
      if (open) setFadeVisible(buttons);
      else setFadeHidden(buttons);
      return;
    }

    panel.style.height = `${panel.offsetHeight}px`;
    panel.style.overflow = 'hidden';
    if (open) setFadeHidden(buttons);
    else fadeOut(buttons);
    const timeline = createHeightTransitionTimeline({
      onComplete: () => {
        panel.style.height = open ? 'auto' : '0px';
        panel.style.overflow = open ? '' : 'hidden';
      },
    });
    toHeight(timeline, panel, open ? panel.scrollHeight : 0, open, 0);
    if (open) fadeIn(buttons, { delay: 0.06 });
    return () => {
      timeline.kill();
    };
  }, [open]);

  return panelRef;
}

// Compact header: small logo + divider line. It is either on or off, never in between, and both
// ways animate with the same tween, so a fast scroll and opening the map look alike. Compact
// once the page scrolls past COMPACT_AT, back to full only under EXPAND_BELOW (no flicker at
// the top), and always while the map is open above phones. --header-shrink runs 0 → 1.
const COMPACT_AT = 24;
const EXPAND_BELOW = 8;
const COMPACT_DURATION = 0.35;

export function useHeaderCompact(rootRef: RefObject<HTMLElement | null>, mapOpen: boolean) {
  // kept across map toggles so the effect re-run animates from the current state
  const compactRef = useRef<boolean | null>(null);

  useEffect(() => {
    const header = rootRef.current;
    if (!header) return;
    const desktop = window.matchMedia('(min-width: 769px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const apply = (compact: boolean) => {
      if (compact === compactRef.current) return;
      const first = compactRef.current === null;
      compactRef.current = compact;
      const value = compact ? 1 : 0;
      if (first || reducedMotion.matches) {
        gsap.killTweensOf(header);
        gsap.set(header, { '--header-shrink': value });
        return;
      }
      gsap.to(header, {
        '--header-shrink': value,
        duration: COMPACT_DURATION,
        ease: 'power3.out',
        overwrite: true,
      });
    };

    const update = () => {
      if (mapOpen && desktop.matches) return apply(true);
      const root = scrollRoot();
      const top = root ? root.scrollTop : window.scrollY;
      apply(compactRef.current ? top > EXPAND_BELOW : top >= COMPACT_AT);
    };

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    update();
    // capture catches the window and the events panel (its own scroller while the map is open)
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    document.addEventListener('map-layout:updated', schedule);
    desktop.addEventListener('change', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, { capture: true });
      document.removeEventListener('map-layout:updated', schedule);
      desktop.removeEventListener('change', schedule);
    };
  }, [rootRef, mapOpen]);

  useEffect(() => {
    const header = rootRef.current;
    return () => {
      if (header) gsap.killTweensOf(header);
    };
  }, [rootRef]);
}

export const scrollRoot = () => {
  const events = document.querySelector<HTMLElement>('[data-events-section]');
  if (!events) return null;
  const overflowY = getComputedStyle(events).overflowY;
  return overflowY !== 'visible' &&
    overflowY !== 'clip' &&
    events.scrollHeight > events.clientHeight + 1
    ? events
    : null;
};
