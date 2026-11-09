'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  firstReadySlideIndex,
  landingVisitOrder,
  nextReadySlideIndex,
  resolveBlocksLandingSlides,
  type BlocksLandingCandidate,
  type BlocksLandingHeroOption,
} from '@/lib/blocksLanding';
import { LANDING_HERO_GLOBAL } from '@/lib/landingHero';
import { readLandingSeen, rememberLandingSeen } from '@/lib/landingSeen';
import { imageCdnEnabled } from '@/lib/env';
import { uiText, type AppLocale } from '@/lib/i18n';
import { stickyMapOverlap } from '@/lib/mapOverlap';
import { landingDesktopSize, landingPictureSourcesFor } from '@/lib/landingImages';
import { landingMediaDeliveryUrl } from '@/lib/mediaDelivery';
import { EXPAND_EVENT_CARD_EVENT } from '../ExpandableGrid';
import { BoxEdge, BoxSides } from './BoxFrame';
import { readLocaleHandoff } from '@/lib/localeHandoff';
import styles from './page.module.sass';

// stable default, so the visit effect doesn't re-run on every render
const noHeroOptions: BlocksLandingHeroOption[] = [];
const slideHoldMs = 3000;
// a box gets its next event once the image it just showed has faded out (.landingImage 400ms)
const replaceAfterMs = 800;
const exitMs = 500;
const wheelThreshold = 80;
const touchThreshold = 48;
// Intro: boxes fade in flat (depth 0; 800ms, 100ms apart, see .landingBlock). As soon as the
// first image has decoded (and the boxes are at least introMinFadeMs in) they rise to their depth
// (600ms); the box whose image loaded first goes straight to its active depth while its image
// fades in, then becomes active. Without a loaded image the boxes stay flat and nothing activates.
const introMinFadeMs = 600;
const introRaiseMs = 600;
// settle margin so the intro ends after the rise transitions have fully finished
const introSettleMs = 100;

// The events list scrolls inside [data-events-section] when the map is open, else the window.
const eventsScrollRoot = () => {
  const events = document.querySelector<HTMLElement>('[data-events-section]');
  if (!events) return null;
  const overflowY = getComputedStyle(events).overflowY;
  return overflowY !== 'visible' &&
    overflowY !== 'clip' &&
    events.scrollHeight > events.clientHeight + 1
    ? events
    : null;
};

// Scrolls the event's card to just below the sticky header (header height + 2rem). The header
// shrinks as the page scrolls, so the target is measured again when the first scroll settles.
const scrollToEventCard = (eventId: string) => {
  const card = document.querySelector<HTMLElement>(
    `[data-event-card][data-event-id="${CSS.escape(eventId)}"]`,
  );
  if (!card || card.offsetParent === null) return;
  const root = eventsScrollRoot();
  const target: HTMLElement | Window = root ?? window;
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
  const targetTop = () => {
    const header = document.querySelector<HTMLElement>('[data-main-header]');
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const rootTop = root ? root.getBoundingClientRect().top : 0;
    const scrollTop = root ? root.scrollTop : window.scrollY;
    const offset =
      Math.max(header?.getBoundingClientRect().height ?? 0, stickyMapOverlap()) + 2 * rem;
    return Math.max(0, card.getBoundingClientRect().top - rootTop + scrollTop - offset);
  };
  const currentTop = () => (root ? root.scrollTop : window.scrollY);

  target.scrollTo({ top: targetTop(), behavior });
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    target.removeEventListener('scrollend', settle);
    const top = targetTop();
    if (Math.abs(top - currentTop()) > 2) target.scrollTo({ top, behavior });
  };
  target.addEventListener('scrollend', settle);
  window.setTimeout(settle, 1200);
};

export default function BlocksLanding({
  candidates,
  heroOptions = noHeroOptions,
  slideLimit = 3,
  cityLabel = 'Kyoto',
  locale = 'en',
  todayCount = 0,
}: {
  candidates: BlocksLandingCandidate[];
  heroOptions?: BlocksLandingHeroOption[];
  slideLimit?: number;
  cityLabel?: string;
  locale?: AppLocale;
  // events on today (the grid's ongoing group), shown in the bottom CTA
  todayCount?: number;
}) {
  const copy = uiText[locale];
  const rootRef = useRef<HTMLElement>(null);
  const exitTimer = useRef<number | null>(null);
  const pendingScrollId = useRef<string | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, density: 1 });
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const [cycleVersion, setCycleVersion] = useState(0);
  const [exiting, setExiting] = useState(false);
  // after a language switch the landing stays dismissed if it was (lib/localeHandoff)
  const [hidden, setHidden] = useState(() => readLocaleHandoff(locale)?.landingHidden ?? false);
  const [hoverPaused, setHoverPaused] = useState(false);
  // ids in the order their images finished decoding
  const [loadedOrder, setLoadedOrder] = useState<string[]>([]);
  const [introMinElapsed, setIntroMinElapsed] = useState(false);
  const [boxesRaised, setBoxesRaised] = useState(false);
  const [boxesGrown, setBoxesGrown] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  // Images fade in only once decoded, so they never paint top to bottom while downloading.
  const markLoaded = useCallback((id: string, image: HTMLImageElement) => {
    image
      .decode()
      .catch(() => undefined)
      .then(() => setLoadedOrder((current) => (current.includes(id) ? current : [...current, id])));
  }, []);
  // The server-rendered hero can finish loading before hydration, when onLoad is never fired.
  const loadedRef = (id: string) => (image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth > 0) markLoaded(id, image);
  };

  // This visit's order (random, unseen first) and first slide (picked by the page's inline script,
  // lib/landingHero.ts). Set after mount: the server-rendered page is shared by every visitor.
  const [visit, setVisit] = useState<{
    order: BlocksLandingCandidate[];
    hero: BlocksLandingHeroOption | null;
  } | null>(null);
  useEffect(() => {
    const picked = (window as unknown as Record<string, unknown>)[LANDING_HERO_GLOBAL];
    const hero = heroOptions.find((option) => option.id === picked) ?? null;
    const order = landingVisitOrder(candidates, readLandingSeen(), Math.random, hero?.id);
    setVisit({ order, hero });
  }, [candidates, heroOptions]);
  const hero = visit?.hero ?? null;

  const usableCandidates = useMemo(
    () => (visit?.order ?? []).filter((candidate) => !failedIds.has(candidate.id)),
    [visit, failedIds],
  );
  // every event of the pool, one per source first; the boxes show `slideLimit` of them at a time
  const rawPool = useMemo(
    () =>
      resolveBlocksLandingSlides({
        candidates: usableCandidates,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        limit: usableCandidates.length,
      }),
    [usableCandidates, viewport],
  );
  const pool = useMemo(
    () =>
      rawPool.flatMap((slide) => {
        const src = landingMediaDeliveryUrl(slide.src, imageCdnEnabled());
        return src ? [{ ...slide, src }] : [];
      }),
    [rawPool],
  );
  const poolKey = pool.map((slide) => slide.id).join('|');
  // the events in the boxes, by position; rotation swaps in the rest of the pool one by one
  const [slotIds, setSlotIds] = useState<string[]>([]);
  // pool events waiting for a box, in order; a replaced event goes to the back
  const queueRef = useRef<string[]>([]);
  const replaceTimer = useRef<number | null>(null);
  useEffect(() => {
    const available = new Set(poolKey ? poolKey.split('|') : []);
    const poolIds = [...available];
    setSlotIds((current) => {
      const kept = current.map((id) => (available.has(id) ? id : null));
      const used = new Set(kept);
      const free = poolIds.filter((id) => !used.has(id));
      const filled = kept.map((id) => id ?? free.shift() ?? null);
      while (filled.length < Math.min(slideLimit, poolIds.length))
        filled.push(free.shift() ?? null);
      const next = filled.filter((id): id is string => Boolean(id));
      return next.join('|') === current.join('|') ? current : next;
    });
  }, [poolKey, slideLimit]);
  const slides = useMemo(() => {
    const byId = new Map(pool.map((slide) => [slide.id, slide]));
    return slotIds.flatMap((id) => {
      const slide = byId.get(id);
      return slide ? [slide] : [];
    });
  }, [pool, slotIds]);
  const takeFromQueue = useCallback(
    (inSlots: string[], replaced: string) => {
      const poolIds = poolKey ? poolKey.split('|') : [];
      const waiting = poolIds.filter((id) => !inSlots.includes(id));
      const queue = [
        ...queueRef.current.filter((id) => waiting.includes(id)),
        ...waiting.filter((id) => !queueRef.current.includes(id)),
      ];
      const next = queue.shift() ?? null;
      if (next) queueRef.current = [...queue, replaced];
      return next;
    },
    [poolKey],
  );
  // read by the rotation timer, so a box swap doesn't restart the current slide's hold
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const takeFromQueueRef = useRef(takeFromQueue);
  takeFromQueueRef.current = takeFromQueue;
  const loadedIds = useMemo(() => new Set(loadedOrder), [loadedOrder]);
  const slideIds = useMemo(() => slides.map((slide) => slide.id), [slides]);
  const readySlides = useMemo(() => slideIds.map((id) => loadedIds.has(id)), [loadedIds, slideIds]);
  const firstReadyIndex = firstReadySlideIndex(slideIds, loadedOrder);
  const normalizedActiveIndex = slides.length > 0 ? activeIndex % slides.length : 0;
  const activeReady = readySlides[normalizedActiveIndex] ?? false;
  // nothing is active until the intro has run, and a box only activates once its image is in;
  // the first image fades in during the rise (delayed in CSS) so it is in when its box lands
  const shownIndex = introDone && activeReady ? normalizedActiveIndex : -1;
  const imageIndex = boxesRaised ? normalizedActiveIndex : -1;
  const introIndex = boxesRaised && !introDone ? normalizedActiveIndex : -1;

  const useNetlifyImageCdn = imageCdnEnabled();
  const heroSources = useMemo(
    () => (hero ? landingPictureSourcesFor(hero.files, useNetlifyImageCdn) : []),
    [hero, useNetlifyImageCdn],
  );
  const heroFallbackSrc = hero
    ? landingMediaDeliveryUrl(hero.files.desktop, useNetlifyImageCdn)
    : null;
  const heroIndex = hero ? slides.findIndex((slide) => slide.id === hero.id) : -1;
  // before the client resolves slides only the hero exists; after, it shows while it's active
  const heroVisible =
    Boolean(hero && heroFallbackSrc && !failedIds.has(hero.id)) &&
    (slides.length === 0 || heroIndex >= 0);
  const heroActive = heroIndex >= 0 && heroIndex === imageIndex;

  const dismiss = useCallback(() => {
    if (exiting || hidden) return;
    setExiting(true);
    exitTimer.current = window.setTimeout(() => {
      setHidden(true);
      exitTimer.current = null;
    }, exitMs);
  }, [exiting, hidden]);

  // a block click closes the landing, then scrolls to that event's card once the page is unlocked
  const openSlide = (eventId: string) => {
    pendingScrollId.current = eventId;
    dismiss();
  };

  // hover activates a block and holds rotation; only for real pointers (not touch)
  const canHover = (event: ReactPointerEvent) =>
    event.pointerType !== 'touch' && window.matchMedia('(hover: hover)').matches;
  const hoverSlide = (event: ReactPointerEvent, index: number) => {
    if (!introDone || !canHover(event) || !readySlides[index]) return;
    setHoverPaused(true);
    if (index !== normalizedActiveIndex) setActiveIndex(index);
  };
  const leaveSlide = (event: ReactPointerEvent) => {
    if (!introDone || !canHover(event)) return;
    setHoverPaused(false);
    setCycleVersion((current) => current + 1);
  };

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewport({ width, height, density: window.devicePixelRatio || 1 });
    };
    // One re-render per frame while resizing, not one per resize event.
    const scheduleMeasure = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('resize', scheduleMeasure);
    return () => {
      window.removeEventListener('resize', scheduleMeasure);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    setCycleVersion((current) => current + 1);
  }, [poolKey]);

  // what this visitor has seen leads to something else next visit (lib/landingSeen.ts)
  const shownId = shownIndex >= 0 ? slides[shownIndex]?.id : undefined;
  useEffect(() => {
    if (shownId) rememberLandingSeen(shownId);
  }, [shownId]);

  const hasSlides = slides.length > 0;
  useEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setBoxesRaised(true);
    setBoxesGrown(true);
    setIntroDone(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroMinElapsed(true), introMinFadeMs);
    return () => window.clearTimeout(timer);
  }, []);

  // rise as soon as any image is ready, with the box whose image loaded first leading
  useEffect(() => {
    if (boxesRaised || !introMinElapsed || firstReadyIndex < 0) return;
    setActiveIndex(firstReadyIndex);
    setBoxesRaised(true);
  }, [boxesRaised, firstReadyIndex, introMinElapsed]);

  useEffect(() => {
    if (!boxesRaised || boxesGrown) return;
    const grown = window.setTimeout(() => setBoxesGrown(true), introRaiseMs + introSettleMs);
    return () => window.clearTimeout(grown);
  }, [boxesGrown, boxesRaised]);

  useEffect(() => {
    if (boxesGrown && !introDone) setIntroDone(true);
  }, [boxesGrown, introDone]);

  // the active slide lost its image (slides re-resolved, reduced motion skipped the intro):
  // move to the first ready one
  useEffect(() => {
    if (!boxesRaised || activeReady || firstReadyIndex < 0) return;
    setActiveIndex(firstReadyIndex);
  }, [activeReady, boxesRaised, firstReadyIndex]);

  // nothing to show once this visit's pool resolved empty (slots fill one render after the pool)
  useEffect(() => {
    if (visit && viewport.width > 0 && pool.length === 0) setHidden(true);
  }, [pool.length, viewport.width, visit]);

  useEffect(() => {
    if (hidden) {
      document.documentElement.removeAttribute('data-blocks-landing-active');
      const eventId = pendingScrollId.current;
      pendingScrollId.current = null;
      if (eventId) {
        // open the card first so the scroll lands on its expanded layout
        window.dispatchEvent(new CustomEvent(EXPAND_EVENT_CARD_EVENT, { detail: { eventId } }));
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() => scrollToEventCard(eventId)),
        );
      }
      return;
    }
    document.documentElement.setAttribute('data-blocks-landing-active', '');
    return () => document.documentElement.removeAttribute('data-blocks-landing-active');
  }, [hidden]);

  useEffect(() => {
    if (!introDone || hidden || exiting || hoverPaused || slides.length === 0) return;
    const timer = window.setTimeout(() => {
      const slides = slidesRef.current;
      const current = activeIndex % slides.length;
      const next = nextReadySlideIndex(current, readySlides);
      setActiveIndex(next);
      if (next === current) return;
      // the box just left gets the next pool event, once its image has faded out
      const leaving = slides[current].id;
      if (replaceTimer.current !== null) window.clearTimeout(replaceTimer.current);
      replaceTimer.current = window.setTimeout(() => {
        replaceTimer.current = null;
        setSlotIds((ids) => {
          if (!ids.includes(leaving)) return ids;
          const replacement = takeFromQueueRef.current(ids, leaving);
          return replacement ? ids.map((id) => (id === leaving ? replacement : id)) : ids;
        });
      }, replaceAfterMs);
    }, slideHoldMs);
    return () => window.clearTimeout(timer);
    // readySlides: a slide that finishes loading later joins the rotation on the next tick
  }, [
    activeIndex,
    cycleVersion,
    exiting,
    hidden,
    hoverPaused,
    introDone,
    readySlides,
    slides.length,
  ]);

  useEffect(() => {
    if (hidden || exiting) return;

    let wheelDelta = 0;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY <= 0) {
        wheelDelta = 0;
        return;
      }
      event.preventDefault();
      wheelDelta += event.deltaY;
      if (wheelDelta >= wheelThreshold) dismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dismiss, exiting, hidden]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || hidden || exiting) return;

    let touchStartY: number | null = null;
    const handleTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (touchStartY === null || typeof currentY !== 'number') return;
      const delta = touchStartY - currentY;
      if (delta <= 0) return;
      event.preventDefault();
      if (delta >= touchThreshold) dismiss();
    };
    root.addEventListener('touchstart', handleTouchStart, { passive: true });
    root.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      root.removeEventListener('touchstart', handleTouchStart);
      root.removeEventListener('touchmove', handleTouchMove);
    };
  }, [dismiss, exiting, hidden]);

  useEffect(
    () => () => {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
      if (replaceTimer.current !== null) window.clearTimeout(replaceTimer.current);
    },
    [],
  );

  return (
    <section
      ref={rootRef}
      className={styles.landing}
      data-exiting={exiting || undefined}
      data-boxes-raised={boxesRaised || undefined}
      data-intro-done={introDone || undefined}
      hidden={hidden}
      inert={hidden ? true : undefined}
      aria-label={copy.eventHighlights(cityLabel)}
    >
      <h2 className={styles.visuallyHidden}>{copy.eventHighlights(cityLabel)}</h2>
      <div className={styles.landingSlides} aria-hidden="true">
        {heroVisible && hero && (
          // This visit's first slide: the page's inline script picked it and preloaded these
          // exact sources before hydration (lib/landingHero.ts).
          // and the viewport measure; it stays mounted as the hero's slide afterwards.
          <picture key={hero.id}>
            {heroSources.map((source) => (
              <source key={source.media ?? 'default'} media={source.media} srcSet={source.srcSet} />
            ))}
            <img
              ref={loadedRef(hero.id)}
              className={styles.landingImage}
              data-active={heroActive || undefined}
              data-loaded={loadedIds.has(hero.id) || undefined}
              src={heroFallbackSrc ?? undefined}
              width={landingDesktopSize.width}
              height={landingDesktopSize.height}
              alt=""
              decoding="async"
              loading="eager"
              fetchPriority="high"
              onLoad={(event) => markLoaded(hero.id, event.currentTarget)}
              onError={() => setFailedIds((current) => new Set(current).add(hero.id))}
            />
          </picture>
        )}
        {slides.map((slide, index) =>
          slide.id === hero?.id && heroVisible ? null : (
            <img
              key={slide.id}
              ref={loadedRef(slide.id)}
              className={styles.landingImage}
              data-active={index === imageIndex || undefined}
              data-loaded={loadedIds.has(slide.id) || undefined}
              src={slide.src}
              width={slide.width}
              height={slide.height}
              alt=""
              decoding="async"
              // all slides load at once; whichever decodes first leads the intro
              loading="eager"
              fetchPriority={hero ? 'low' : 'auto'}
              onLoad={(event) => markLoaded(slide.id, event.currentTarget)}
              onError={() =>
                setFailedIds((current) => {
                  const next = new Set(current);
                  next.add(slide.id);
                  return next;
                })
              }
            />
          ),
        )}
      </div>
      <button
        className={styles.landingExit}
        type="button"
        aria-label={copy.viewAllEvents(cityLabel)}
        onClick={dismiss}
      />
      <button className={styles.landingCta} type="button" onClick={dismiss}>
        <span>{todayCount > 0 ? copy.eventsToday(todayCount, cityLabel) : copy.viewAllEvents(cityLabel)}</span>
        <svg className={styles.landingCtaArrow} viewBox="0 0 16 20" aria-hidden="true">
          <path d="M8 1v17M1.5 11.5 8 18l6.5-6.5" />
        </svg>
      </button>
      <div className={styles.landingBlocks}>
        {slides.map((slide, index) => {
          const active = index === shownIndex;
          return (
            <button
              className={styles.landingBlock}
              data-position={index + 1}
              data-active={active || undefined}
              data-intro-active={index === introIndex || undefined}
              // by position: rotation swaps a box's event in place
              key={index}
              type="button"
              onClick={() => openSlide(slide.id)}
              onPointerEnter={(event) => hoverSlide(event, index)}
              onPointerLeave={leaveSlide}
            >
              <span className={`${styles.landingFace} ${styles.landingFaceX}`} aria-hidden="true" />
              <span className={`${styles.landingFace} ${styles.landingFaceY}`} aria-hidden="true" />
              <BoxSides />
              <span className={`${styles.front} ${styles.boxLift}`}>
                <span className={styles.landingMeta}>
                  <span>{slide.institution}</span>
                  <span>{slide.date}</span>
                </span>
                <span className={styles.landingTitle}>{slide.title}</span>
              </span>
              <BoxEdge />
            </button>
          );
        })}
      </div>
    </section>
  );
}
