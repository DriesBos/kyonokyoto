'use client';

import { useEffect } from 'react';
import { faviconDataUrl } from '@/lib/favicon';

const readColor = (style: CSSStyleDeclaration, name: string) => style.getPropertyValue(name).trim();

// Keeps the tab icon in the colours on screen: the city colour on the light or dark background.
// It follows data-city and the header toggle (data-color-scheme). Safari keeps
// the static icon, since it ignores favicon changes after load.
export default function LiveFavicon() {
  useEffect(() => {
    const root = document.documentElement;
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.dataset.liveFavicon = '';

    const update = () => {
      const style = getComputedStyle(root);
      const color = readColor(style, '--color-text');
      const background = readColor(style, '--color-background');
      if (!color || !background) return;
      const href = faviconDataUrl(color, background);
      if (link.getAttribute('href') !== href) link.setAttribute('href', href);
      // Last icon in <head> wins; route changes can re-render the metadata icons after it.
      if (link !== document.head.lastElementChild) document.head.append(link);
    };

    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-city', 'data-color-scheme'],
    });
    observer.observe(document.head, { childList: true });
    return () => {
      observer.disconnect();
      link.remove();
    };
  }, []);

  return null;
}
