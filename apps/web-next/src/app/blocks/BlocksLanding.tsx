'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveBlocksLandingSlides, type BlocksLandingCandidate } from '@/lib/blocksLanding';
import { landingMediaDeliveryUrl } from '@/lib/mediaDelivery';
import styles from './page.module.sass';

const slideHoldMs = 4000;
const exitMs = 500;
const wheelThreshold = 80;
const touchThreshold = 48;

export default function BlocksLanding({
  candidates,
  slideLimit = 3,
  cityLabel = 'Kyoto',
}: {
  candidates: BlocksLandingCandidate[];
  slideLimit?: number;
  cityLabel?: string;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const exitTimer = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, density: 1 });
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const [cycleVersion, setCycleVersion] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [hidden, setHidden] = useState(false);

  const usableCandidates = useMemo(
    () => candidates.filter((candidate) => !failedIds.has(candidate.id)),
    [candidates, failedIds],
  );
  const rawSlides = useMemo(
    () =>
      resolveBlocksLandingSlides({
        candidates: usableCandidates,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        devicePixelRatio: viewport.density,
        limit: slideLimit,
      }),
    [slideLimit, usableCandidates, viewport],
  );
  const slides = useMemo(
    () =>
      rawSlides.flatMap((slide) => {
        const src = landingMediaDeliveryUrl(
          slide.src,
          slide.width,
          slide.height,
          process.env.NODE_ENV === 'production',
        );
        return src ? [{ ...slide, src }] : [];
      }),
    [rawSlides],
  );
  const normalizedActiveIndex = slides.length > 0 ? activeIndex % slides.length : 0;
  const slideKey = slides.map((slide) => slide.id).join('|');

  const dismiss = useCallback(() => {
    if (exiting || hidden) return;
    setExiting(true);
    exitTimer.current = window.setTimeout(() => {
      setHidden(true);
      exitTimer.current = null;
    }, exitMs);
  }, [exiting, hidden]);

  const selectSlide = (index: number) => {
    setActiveIndex(index);
    setCycleVersion((current) => current + 1);
  };

  useEffect(() => {
    const measure = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewport({ width, height, density: window.devicePixelRatio || 1 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    setCycleVersion((current) => current + 1);
  }, [slideKey]);

  useEffect(() => {
    if (viewport.width > 0 && slides.length === 0) setHidden(true);
  }, [slides.length, viewport.width]);

  useEffect(() => {
    if (hidden) {
      document.documentElement.removeAttribute('data-blocks-landing-active');
      return;
    }
    document.documentElement.setAttribute('data-blocks-landing-active', '');
    return () => document.documentElement.removeAttribute('data-blocks-landing-active');
  }, [hidden]);

  useEffect(() => {
    if (hidden || exiting || slides.length === 0) return;
    const timer = window.setTimeout(
      () => setActiveIndex((current) => (current + 1) % slides.length),
      slideHoldMs,
    );
    return () => window.clearTimeout(timer);
  }, [activeIndex, cycleVersion, exiting, hidden, slides.length]);

  useEffect(() => {
    if (hidden || slides.length < 2) return;
    const next = slides[(normalizedActiveIndex + 1) % slides.length];
    const image = new Image();
    image.decoding = 'async';
    image.src = next.src;
  }, [hidden, normalizedActiveIndex, slides]);

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
    },
    [],
  );

  return (
    <section
      ref={rootRef}
      className={styles.landing}
      data-exiting={exiting || undefined}
      hidden={hidden}
      inert={hidden ? true : undefined}
      aria-label={`${cityLabel} event highlights`}
    >
      <h1 className={styles.visuallyHidden}>{cityLabel} event highlights</h1>
      <div className={styles.landingSlides} aria-hidden="true">
        {slides.map((slide, index) => (
          <img
            key={slide.id}
            className={styles.landingImage}
            data-active={index === normalizedActiveIndex || undefined}
            src={slide.src}
            width={slide.width}
            height={slide.height}
            alt=""
            decoding="async"
            loading={index === 0 ? 'eager' : 'lazy'}
            fetchPriority={index === 0 ? 'high' : 'low'}
            onError={() =>
              setFailedIds((current) => {
                const next = new Set(current);
                next.add(slide.id);
                return next;
              })
            }
          />
        ))}
      </div>
      <button
        className={styles.landingExit}
        type="button"
        aria-label={`View all ${cityLabel} events`}
        onClick={dismiss}
      />
      <div className={styles.landingBlocks}>
        {slides.map((slide, index) => {
          const active = index === normalizedActiveIndex;
          return (
            <button
              className={styles.landingBlock}
              data-position={index + 1}
              data-active={active || undefined}
              key={slide.id}
              type="button"
              aria-label={`Show ${slide.title}`}
              aria-pressed={active}
              onClick={() => selectSlide(index)}
            >
              <span className={styles.back} aria-hidden="true" />
              <span className={`${styles.face} ${styles.faceTop}`} aria-hidden="true" />
              <span className={`${styles.face} ${styles.faceBottom}`} aria-hidden="true" />
              <span className={`${styles.face} ${styles.faceLeft}`} aria-hidden="true" />
              <span className={`${styles.face} ${styles.faceRight}`} aria-hidden="true" />
              <span
                className={styles.front}
                style={{ backdropFilter: active ? 'blur(10px)' : 'blur(0)' }}
              >
                <span className={styles.landingMeta}>
                  <span>{slide.institution}</span>
                  <span>{slide.date}</span>
                </span>
                <span className={styles.landingTitle}>{slide.title}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
