'use client';

import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, PointerEvent, ReactNode } from 'react';
import styles from './GeneralButton.module.sass';

// Port of apps/web GeneralButton.astro: a lowercase label under a top stroke, with an organic
// pink dot that appears where the button was pressed and stays while aria-pressed is true.

type Edge = 'first' | 'last';

type SharedProps = {
  label: ReactNode;
  pressed?: boolean;
  showDot?: boolean;
  edge?: Edge;
  verticalPadding?: 'none' | 'full';
  className?: string;
};

type ButtonProps = SharedProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & { href?: undefined };
type LinkProps = SharedProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'href'> & { href: string };

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

const placeDot = (event: PointerEvent<HTMLElement>) => {
  const button = event.currentTarget;
  const rect = button.getBoundingClientRect();
  button.style.setProperty(
    '--general-button-dot-left',
    `${event.clientX - rect.left - button.clientLeft}px`,
  );
  button.style.setProperty(
    '--general-button-dot-top',
    `${event.clientY - rect.top - button.clientTop}px`,
  );
  button.style.setProperty('--dot-mask', `var(--dot-mask-${Math.floor(Math.random() * 3) + 1})`);
  button.style.setProperty('--dot-rotation', `${randomBetween(-18, 18).toFixed(2)}deg`);
  button.style.setProperty('--dot-scale-x', randomBetween(0.94, 1.06).toFixed(3));
  button.style.setProperty('--dot-scale-y', randomBetween(0.96, 1.08).toFixed(3));
};

export default function GeneralButton(props: ButtonProps | LinkProps) {
  const {
    label,
    pressed,
    showDot = false,
    edge,
    verticalPadding = 'none',
    className,
    onPointerDown,
    ...rest
  } = props;
  const classes = [
    styles.button,
    edge === 'first' && styles.edgeFirst,
    edge === 'last' && styles.edgeLast,
    verticalPadding === 'full' && styles.verticalFull,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      <span className={styles.content}>
        <span className={styles.label} data-general-button-label>
          {label}
        </span>
      </span>
      {showDot && <span className={styles.dot} data-general-button-dot aria-hidden="true" />}
    </>
  );
  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (showDot) placeDot(event);
    (onPointerDown as ((event: PointerEvent<HTMLElement>) => void) | undefined)?.(event);
  };

  if (typeof rest.href === 'string') {
    const { href, ...anchorProps } = rest as Omit<LinkProps, keyof SharedProps>;
    return (
      <Link
        {...anchorProps}
        href={href}
        className={classes}
        aria-pressed={typeof pressed === 'boolean' ? pressed : undefined}
        onPointerDown={handlePointerDown}
      >
        {content}
      </Link>
    );
  }

  const { type = 'button', ...buttonProps } = rest as Omit<ButtonProps, keyof SharedProps>;
  return (
    <button
      {...buttonProps}
      type={type}
      className={classes}
      aria-pressed={typeof pressed === 'boolean' ? pressed : undefined}
      onPointerDown={handlePointerDown}
    >
      {content}
    </button>
  );
}
