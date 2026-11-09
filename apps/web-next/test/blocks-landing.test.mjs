import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const {
  blocksLandingCandidatesForEvents,
  blocksLandingHeroOptions,
  landingVisitOrder,
  firstReadySlideIndex,
  nextReadySlideIndex,
  resolveBlocksLandingSlides,
} = await import('../src/lib/blocksLanding.ts');
const { landingPictureSourcesFor, landingPreloadsFor } =
  await import('../src/lib/landingImages.ts');
const { landingHeroScript } = await import('../src/lib/landingHero.ts');
const { landingMediaDeliveryUrl } = await import('../src/lib/mediaDelivery.ts');
const { sourceSlugForEvent } = await import('../src/lib/sourceMatching.ts');

const landingImage = (id, extra = {}) => ({
  url: `https://example.com/${id}.jpg`,
  landingDesktop: `https://project.supabase.co/landing/${id}-desktop.webp`,
  landingMobile: `https://project.supabase.co/landing/${id}-mobile.webp`,
  ...extra,
});

const event = (overrides = {}) => ({
  id: overrides.id ?? 'event',
  title: overrides.title ?? overrides.id ?? 'Event',
  institution: overrides.institution ?? 'Gallery',
  date: overrides.date ?? 'ongoing',
  group: overrides.group ?? 'ongoing',
  sourceSlug: overrides.sourceSlug ?? overrides.id ?? 'gallery',
  landingEligible: overrides.landingEligible ?? true,
  images: overrides.images ?? [landingImage(overrides.id ?? 'event')],
});

test('Blocks landing pool: landing_slider events with landing files, spread over sources', () => {
  const candidates = blocksLandingCandidatesForEvents([
    event({ id: 'one', sourceSlug: 'one' }),
    event({ id: 'duplicate', sourceSlug: 'one' }),
    event({ id: 'two', sourceSlug: 'two' }),
    event({ id: 'three', sourceSlug: 'three' }),
    event({ id: 'momak', sourceSlug: 'momak' }),
    event({ id: 'kyocera', sourceSlug: 'kyoto-city-kyocera-museum-of-art' }),
    event({ id: 'not-curated', landingEligible: false }),
    event({ id: 'permanent', group: 'permanent' }),
    event({ id: 'no-files', images: [{ url: 'https://example.com/no-files.jpg' }] }),
  ]);

  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    ['one', 'two', 'three', 'duplicate'],
  );

  const slides = resolveBlocksLandingSlides({
    candidates,
    viewportWidth: 1440,
    viewportHeight: 900,
  });
  assert.deepEqual(
    slides.map((slide) => slide.id),
    ['one', 'two', 'three'],
  );
  assert.deepEqual(
    resolveBlocksLandingSlides({
      candidates,
      viewportWidth: 1440,
      viewportHeight: 900,
      limit: 6,
    }).map((slide) => slide.id),
    ['one', 'two', 'three', 'duplicate'],
  );
});

test('Blocks landing keeps at most 12 events per city', () => {
  const events = Array.from({ length: 20 }, (_, index) =>
    event({ id: `e${index}`, sourceSlug: `s${index % 5}` }),
  );
  const candidates = blocksLandingCandidatesForEvents(events);
  assert.equal(candidates.length, 12);
  assert.equal(new Set(candidates.slice(0, 5).map((candidate) => candidate.sourceSlug)).size, 5);
});

test('Blocks landing serves the desktop file on wide screens and the mobile file on tall ones', () => {
  const candidates = blocksLandingCandidatesForEvents([event({ id: 'one' })]);
  const [desktop] = resolveBlocksLandingSlides({
    candidates,
    viewportWidth: 5120,
    viewportHeight: 2880,
  });
  assert.equal(desktop.src, 'https://project.supabase.co/landing/one-desktop.webp');
  assert.deepEqual({ width: desktop.width, height: desktop.height }, { width: 1920, height: 1080 });

  const [mobile] = resolveBlocksLandingSlides({
    candidates,
    viewportWidth: 390,
    viewportHeight: 844,
  });
  assert.equal(mobile.src, 'https://project.supabase.co/landing/one-mobile.webp');
  assert.deepEqual({ width: mobile.width, height: mobile.height }, { width: 900, height: 1600 });

  // one cached version per file: no resizing, fixed format
  const url = new URL(landingMediaDeliveryUrl(desktop.src, true), 'https://example.test');
  assert.equal(url.pathname, '/.netlify/images');
  assert.equal(url.searchParams.get('url'), desktop.src);
  assert.equal(url.searchParams.get('fm'), 'webp');
  assert.equal(url.searchParams.get('w'), null);
  assert.equal(landingMediaDeliveryUrl(desktop.src, false), desktop.src);
});

test('Blocks landing fills all three slots when only two sources are available', () => {
  const slides = resolveBlocksLandingSlides({
    candidates: blocksLandingCandidatesForEvents([
      event({ id: 'one-a', sourceSlug: 'one' }),
      event({ id: 'one-b', sourceSlug: 'one' }),
      event({ id: 'two', sourceSlug: 'two' }),
    ]),
    viewportWidth: 1440,
    viewportHeight: 900,
  });

  assert.deepEqual(
    slides.map((slide) => slide.id),
    ['one-a', 'two', 'one-b'],
  );
});

test('landing source matching falls back to source URL when relation is unavailable', () => {
  const sources = [
    {
      slug: 'gallery-yamahon',
      base_url: 'https://gallery-yamahon.com/?page_id=1396',
      allowed_domains: ['gallery-yamahon.com'],
      event_page_patterns: ['/'],
    },
    {
      slug: 'other',
      base_url: 'https://other.example/events/',
      allowed_domains: ['other.example'],
    },
  ];

  assert.equal(
    sourceSlugForEvent(
      {
        sources: null,
        source_id: 'database-uuid',
        source_url: 'https://gallery-yamahon.com/?page_id=1396',
      },
      sources,
    ),
    'gallery-yamahon',
  );
});

test('Blocks landing changes slides with a direct fade and no shutter rows', async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL('../src/app/blocks/BlocksLanding.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/blocks/page.module.sass', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(component, /landingShutters|ShutterPhase/);
  // the 3D box svg clips its own duplicate lines; anything else clipping is a shutter coming back
  const withoutBox = styles.replace(/\/\/ Box lines are SVG strokes[\s\S]*?\n(?=\.front\n)/, '');
  assert.doesNotMatch(withoutBox, /landingShutter|clip-path/);
  assert.match(styles, /transition: opacity 400ms ease/);
  assert.match(
    styles,
    /--landing-block-width: min\(calc\(\(100cqw - \(var\(--landing-cols\) - 1\) \* var\(--landing-col-gap\)\)/,
  );
});

test('Blocks landing offers one hero per source', () => {
  const heroes = blocksLandingHeroOptions(
    blocksLandingCandidatesForEvents([
      event({ id: 'big', sourceSlug: 'a' }),
      event({ id: 'big-too', sourceSlug: 'a' }),
      event({ id: 'other', sourceSlug: 'b' }),
    ]),
  );
  assert.deepEqual(
    heroes.map((hero) => [hero.id, hero.sourceSlug]),
    [
      ['big', 'a'],
      ['other', 'b'],
    ],
  );
  assert.equal(heroes[0].files.mobile, 'https://project.supabase.co/landing/big-mobile.webp');

  const sources = landingPictureSourcesFor(heroes[0].files, true);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].media, '(max-aspect-ratio: 1/1)');
  assert.match(sources[0].srcSet, /big-mobile\.webp/);

  // exactly one of the two preloads matches any screen
  assert.deepEqual(
    landingPreloadsFor(heroes[0].files, true).map((preload) => preload.media),
    ['(max-aspect-ratio: 1/1)', '(min-aspect-ratio: 1001/1000)'],
  );

  const script = landingHeroScript(heroes, true);
  assert.match(script, /"id":"big"/);
  assert.match(script, /kyo-landing-seen/);
  assert.doesNotMatch(script, /<\//);
  assert.equal(landingHeroScript([], true), null);
});

test('Landing visit order leads with unseen sources and puts the picked hero first', () => {
  const candidates = blocksLandingCandidatesForEvents([
    event({ id: 'a1', sourceSlug: 'a' }),
    event({ id: 'a2', sourceSlug: 'a' }),
    event({ id: 'b1', sourceSlug: 'b' }),
    event({ id: 'c1', sourceSlug: 'c' }),
    event({ id: 'd1', sourceSlug: 'd' }),
  ]);
  const ids = (order) => order.map((candidate) => candidate.id);

  // one event per source before any second event of a source
  for (let run = 0; run < 20; run += 1) {
    const order = ids(landingVisitOrder(candidates, []));
    assert.equal(order.length, 5);
    assert.equal(new Set(order.slice(0, 4).map((id) => id[0])).size, 4);
  }

  // seen events go last, the one seen longest ago first; a source's unseen event leads it
  const order = ids(landingVisitOrder(candidates, ['c1', 'a1', 'b1']));
  assert.deepEqual(order.slice(0, 2).toSorted(), ['a2', 'd1']);
  assert.deepEqual(order.slice(2), ['c1', 'b1', 'a1']);

  assert.equal(ids(landingVisitOrder(candidates, [], Math.random, 'c1'))[0], 'c1');

  // a random visit doesn't always start the same way
  const firsts = new Set(
    Array.from({ length: 40 }, () => ids(landingVisitOrder(candidates, []))[0]),
  );
  assert.ok(firsts.size > 1);
});

test('Blocks landing leads with whichever image loaded first and rotates only ready slides', () => {
  assert.equal(firstReadySlideIndex(['a', 'b', 'c'], []), -1);
  assert.equal(firstReadySlideIndex(['a', 'b', 'c'], ['gone', 'c', 'a']), 2);
  assert.equal(nextReadySlideIndex(2, [true, false, true]), 0);
  assert.equal(nextReadySlideIndex(0, [true, false, true]), 2);
  assert.equal(nextReadySlideIndex(0, [true, false, false]), 0);
});

test('Landing warm list is both files of each landing event', async () => {
  const { landingWarmUrls } = await import('../src/lib/landingWarm.ts');
  const urls = landingWarmUrls(
    blocksLandingCandidatesForEvents([
      event({ id: 'a', sourceSlug: 's1' }),
      event({ id: 'b', sourceSlug: 's2' }),
    ]),
  );
  assert.deepEqual(
    urls.map((url) => new URLSearchParams(url.split('?')[1]).get('url')),
    [
      'https://project.supabase.co/landing/a-desktop.webp',
      'https://project.supabase.co/landing/a-mobile.webp',
      'https://project.supabase.co/landing/b-desktop.webp',
      'https://project.supabase.co/landing/b-mobile.webp',
    ],
  );
});

test('Blocks landing skips images the landing check rejected', () => {
  const [candidate] = blocksLandingCandidatesForEvents([
    event({
      id: 'checked',
      images: [
        landingImage('flyer', { landingOk: false }),
        landingImage('gallery', { landingOk: true }),
      ],
    }),
  ]);
  assert.equal(candidate.files.desktop, 'https://project.supabase.co/landing/gallery-desktop.webp');
  assert.deepEqual(
    blocksLandingCandidatesForEvents([
      event({ images: [landingImage('flyer', { landingOk: false })] }),
    ]),
    [],
  );
});
