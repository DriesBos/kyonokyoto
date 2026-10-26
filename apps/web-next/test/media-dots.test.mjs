import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = new URL('../src/app/', import.meta.url);

test('open cards with several items show square slider dots under the image, on the right', async () => {
  const [grid, media, pager, mediaStyles, blockStyles] = await Promise.all([
    readFile(new URL('EventsGrid.tsx', app), 'utf8'),
    readFile(new URL('EventCardDetail.tsx', app), 'utf8'),
    readFile(new URL('EventCardMediaPager.tsx', app), 'utf8'),
    readFile(new URL('EventCardDetail.module.sass', app), 'utf8'),
    readFile(new URL('blocks/page.module.sass', app), 'utf8'),
  ]);
  // The pager wraps the card so the media and the meta dots share one scroll position.
  assert.match(grid, /<EventCardMediaPager>/);
  assert.match(grid, /<EventCardMediaDots label=/);
  assert.ok(grid.indexOf('className={styles.content}') < grid.indexOf('<EventCardMediaDots'));
  assert.ok(grid.indexOf('<EventCardMediaDots') < grid.indexOf('className={styles.meta}'));
  assert.match(pager, /pager\.count < 2\) return null/);
  assert.match(pager, /aria-current=\{index === pager\.active/);
  assert.match(media, /setPagerCount\(hasOverflow|setPagerCount\(itemCount\)/);
  assert.match(media, /prefers-reduced-motion: reduce/);
  assert.match(mediaStyles, /border: 1.5px solid currentColor/);
  assert.match(mediaStyles, /&\[aria-current='true'\]\n    background: currentColor/);
  assert.match(mediaStyles, /scroll-snap-type: x mandatory/);
  assert.match(blockStyles, /media-dots'\]\n    position: absolute\n    top: 0\.5rem\n    right: 0\.5rem/);
});
