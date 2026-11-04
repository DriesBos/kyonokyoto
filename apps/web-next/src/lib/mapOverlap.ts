// Phones with the map open: the map (and its resize line) sticks over the top of the screen while
// the event list scrolls as the document (MapExperience.module.sass). Returns how far down the
// screen that covers, so scroll targets land below it; 0 when the map does not stick.
export function stickyMapOverlap(): number {
  const map = document.querySelector<HTMLElement>('[data-map-section]');
  if (!map || getComputedStyle(map).position !== 'sticky') return 0;
  const resizer = document.querySelector<HTMLElement>('[data-map-resizer]');
  return Math.max(
    0,
    map.getBoundingClientRect().bottom,
    resizer?.getBoundingClientRect().bottom ?? 0,
  );
}
