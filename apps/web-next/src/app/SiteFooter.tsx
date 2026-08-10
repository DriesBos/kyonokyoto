'use client';

import { uiText, type AppLocale } from '@/lib/i18n';
import styles from './SiteFooter.module.sass';

function ArrowLong() {
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
  return (
    <footer
      className={`${styles.footer}${className ? ` ${className}` : ''}`}
      data-site-footer
      data-compact={compact || undefined}
    >
      <div className={styles.content}>
        <div className={styles.left}>
          <p className={styles.credit}>
            Site by{' '}
            <a href="https://driesbos.com" target="_blank" rel="noopener noreferrer">
              Dries Bos
            </a>
          </p>
          {!compact && (
            <span className={styles.mark} aria-hidden="true">
              <span />
              <span />
            </span>
          )}
          <p className={styles.note}>Enjoy {cityLabel} Culture</p>
        </div>
        <button
          className={styles.scrollTop}
          type="button"
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
    </footer>
  );
}
