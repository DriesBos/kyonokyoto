/// <reference types="astro/client" />

type NetlifyLocals = import('@astrojs/netlify').NetlifyLocals;

declare namespace App {
  interface Locals extends NetlifyLocals {
    cspNonce: string;
  }
}

interface Window {
  __appleCalendarBound?: boolean;
  __eventCardToggleBound?: boolean;
  __eventStarsBound?: boolean;
  __generalButtonDotBound?: boolean;
  __mapResizerBound?: boolean;
}
