'use client';

import { useEffect, useRef, useState } from 'react';
import { uiText, type AppLocale } from '@/lib/i18n';
import { pressSpringHandlers } from '@/lib/pressSpring';
import styles from './SiteFooter.module.sass';

export function ArrowLong() {
  return (
    <svg className={styles.arrow} viewBox="0 0 25 50" fill="none" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.5024 50.02L11.5028 3.82202L1.9113 13.4239L0.500055 12.0109L11.0888 1.40902L11.0875 1.40756L12.4932 5.34058e-05L12.4948 0.00201797L12.4956 5.34058e-05L13.9068 1.41309L13.9068 1.41502L24.4888 12.0108L23.0831 13.4183L13.4988 3.82202L13.4982 50.02H11.5024Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function SiteFooter({
  className,
  compact = false,
  cityLabel = 'Kyōtō',
  locale = 'en',
}: {
  className?: string;
  compact?: boolean;
  cityLabel?: string;
  locale?: AppLocale;
}) {
  const scrollTopRef = useRef<HTMLButtonElement>(null);
  // The scroll-up arrow only shows when its scroller (the events panel, or the page when the
  // panel does not scroll) overflows; short pages such as a venue with few events have nothing
  // to scroll back to. Rechecked on resize, content size changes and map layout updates.
  const [canScroll, setCanScroll] = useState(true);

  useEffect(() => {
    const button = scrollTopRef.current;
    if (!button) return;
    const events = button.closest<HTMLElement>('[data-events-section]');
    const root = document.documentElement;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const overflows = (element: HTMLElement) => element.scrollHeight > element.clientHeight + 1;
        setCanScroll((events !== null && overflows(events)) || overflows(root));
      });
    };
    const observer = new ResizeObserver(check);
    for (const element of [root, document.body, events, ...(events ? events.children : [])]) {
      if (element) observer.observe(element);
    }
    window.addEventListener('resize', check);
    document.addEventListener('map-layout:updated', check);
    check();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', check);
      document.removeEventListener('map-layout:updated', check);
    };
  }, []);

  return (
    <footer
      className={`${styles.footer}${className ? ` ${className}` : ''}`}
      data-site-footer
      data-compact={compact || undefined}
    >
      <div className={styles.content}>
        <div className={styles.half}>
          <p className={styles.credit}>
            {uiText[locale].siteBy}{' '}
            <a
              href="https://driesbos.com"
              target="_blank"
              rel="noopener noreferrer"
              {...pressSpringHandlers}
            >
              Dries Bos
            </a>
          </p>
        </div>
        <div className={`${styles.half} ${styles.end}`}>
          {!compact && (
            <span className={styles.mark} aria-hidden="true">
              <span />
              <span />
            </span>
          )}
          <p className={styles.note}>{uiText[locale].enjoyCulture(cityLabel)}</p>
          <button
            ref={scrollTopRef}
            className={styles.scrollTop}
            type="button"
            data-no-scroll={canScroll ? undefined : true}
            {...pressSpringHandlers}
            aria-label={uiText[locale].scrollTop}
            onClick={(event) => {
              const events = event.currentTarget.closest<HTMLElement>('[data-events-section]');
              if (events && events.scrollHeight > events.clientHeight) {
                events.scrollTo({ top: 0, behavior: 'smooth' });
              } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
          >
            <ArrowLong />
          </button>
        </div>
      </div>
    </footer>
  );
}
