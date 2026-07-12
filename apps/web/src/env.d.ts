/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
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
