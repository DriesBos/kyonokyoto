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

// How much of the scroll container's top the sticky header covers: all of it on the page, none
// when the cards scroll in their own panel below the header (map open). On phones with the map
// open the sticky map covers the top instead.
export function scrollHeaderOverlap(card: HTMLElement): number {
  const header = document.querySelector<HTMLElement>('[data-main-header]');
  if (!header) return stickyMapOverlap();
  let scrollerTop = 0;
  for (let node = card.parentElement; node && node !== document.body; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
      scrollerTop = node.getBoundingClientRect().top;
      break;
    }
  }
  return Math.max(
    0,
    header.getBoundingClientRect().bottom - scrollerTop,
    stickyMapOverlap() - scrollerTop,
  );
}
