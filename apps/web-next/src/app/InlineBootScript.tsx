'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

// An inline script that runs from the server HTML, before hydration. React never executes a script
// it creates on the client (e.g. after a soft navigation) and warns about it in dev, so a client
// render returns nothing instead. useSyncExternalStore uses the server snapshot (false) during SSR
// and hydration, so the hydrated markup matches the HTML; the script has already run by then.
export default function InlineBootScript({ html }: { html: string }) {
  const clientRender = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (clientRender) return null;
  return <script dangerouslySetInnerHTML={{ __html: html }} />;
}
