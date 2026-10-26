import type { PointerEvent } from 'react';

// Top-line "spring" on buttons (styles/globals.sass --press-*): hovering pushes the line down,
// and releasing a click lets it spring back up while the pointer is still over the button.
// data-released holds it up until the pointer leaves, so the next hover can press it again.
export const pressSpringHandlers = {
  onPointerUp: (event: PointerEvent<HTMLElement>) =>
    event.currentTarget.setAttribute('data-released', ''),
  onPointerLeave: (event: PointerEvent<HTMLElement>) =>
    event.currentTarget.removeAttribute('data-released'),
};
