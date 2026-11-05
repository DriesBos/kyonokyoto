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

const event = (overrides = {}) => ({
  id: overrides.id ?? 'event',
  title: overrides.title ?? overrides.id ?? 'Event',
  institution: overrides.institution ?? 'Gallery',
  date: overrides.date ?? 'ongoing',
  group: overrides.group ?? 'ongoing',
  sourceSlug: overrides.sourceSlug ?? overrides.id ?? 'gallery',
  landingEligible: overrides.landingEligible ?? true,
  images: overrides.images ?? [
    { url: `https://example.com/${overrides.id ?? 'event'}.jpg`, width: 2400, height: 1600 },
  ],
});

test('Blocks landing prioritizes curated measured events and resolves three unique sources', () => {
  const candidates = blocksLandingCandidatesForEvents([
    event({ id: 'one', sourceSlug: 'one' }),
    event({ id: 'duplicate', sourceSlug: 'one' }),
    event({
      id: 'small',
      sourceSlug: 'small',
      images: [{ url: 'https://example.com/small.jpg', width: 600, height: 400 }],
    }),
    event({ id: 'two', sourceSlug: 'two' }),
    event({ id: 'three', sourceSlug: 'three' }),
    event({ id: 'four', sourceSlug: 'four' }),
    event({ id: 'five', sourceSlug: 'five' }),
    event({ id: 'six', sourceSlug: 'six' }),
    event({ id: 'seven', sourceSlug: 'seven' }),
    event({ id: 'momak', sourceSlug: 'momak' }),
    event({ id: 'kyocera', sourceSlug: 'kyoto-city-kyocera-museum-of-art' }),
    event({ id: 'not-curated', landingEligible: false }),
    event({ id: 'permanent', group: 'permanent' }),
    event({
      id: 'unmeasured',
      images: [{ url: 'https://example.com/unmeasured.jpg', width: null, height: null }],
    }),
  ]);

  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    // landing_slider sources only, once at least three of them have events
    ['one', 'duplicate', 'small', 'two', 'three', 'four', 'five', 'six', 'seven'],
  );

  const slides = resolveBlocksLandingSlides({
    candidates,
    viewportWidth: 1440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  });
  assert.deepEqual(
    slides.map((slide) => slide.id),
    ['one', 'small', 'two'],
  );

  const extendedSlides = resolveBlocksLandingSlides({
    candidates,
    viewportWidth: 1440,
    viewportHeight: 900,
    devicePixelRatio: 2,
    limit: 6,
  });
  assert.deepEqual(
    extendedSlides.map((slide) => slide.id),
    ['one', 'small', 'two', 'three', 'four', 'five'],
  );
});

test('Blocks landing uses capped V1-style Netlify cover transforms', () => {
  const [slide] = resolveBlocksLandingSlides({
    candidates: blocksLandingCandidatesForEvents([
      event({
        id: 'large',
        images: [{ url: 'https://example.com/large.jpg', width: 8000, height: 8000 }],
      }),
    ]),
    viewportWidth: 5120,
    viewportHeight: 2880,
    devicePixelRatio: 2,
  });
  const deliveredSrc = landingMediaDeliveryUrl(slide.src, slide.width, slide.height, true);
  const url = new URL(deliveredSrc, 'https://example.test');

  assert.equal(url.pathname, '/.netlify/images');
  assert.equal(url.searchParams.get('url'), 'https://example.com/large.jpg');
  assert.equal(url.searchParams.get('fit'), 'cover');
  assert.equal(url.searchParams.get('q'), '60');
  assert.deepEqual({ width: slide.width, height: slide.height }, { width: 2560, height: 1440 });
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

test('Blocks landing offers one large-screen hero per source', () => {
  const heroes = blocksLandingHeroOptions(
    blocksLandingCandidatesForEvents([
      event({
        id: 'small',
        images: [{ url: 'https://example.com/small.jpg', width: 1200, height: 800 }],
      }),
      event({
        id: 'big',
        sourceSlug: 'a',
        images: [
          { url: 'https://example.com/big-a.jpg', width: 1000, height: 700 },
          { url: 'https://example.com/big-b.jpg', width: 3000, height: 2000 },
        ],
      }),
      event({ id: 'big-too', sourceSlug: 'a' }),
      event({ id: 'other', sourceSlug: 'b' }),
    ]),
  );
  assert.deepEqual(heroes, [
    { id: 'big', sourceSlug: 'a', src: 'https://example.com/big-b.jpg', width: 3000, height: 2000 },
    {
      id: 'other',
      sourceSlug: 'b',
      src: 'https://example.com/other.jpg',
      width: 2400,
      height: 1600,
    },
  ]);

  const sources = landingPictureSourcesFor(heroes[0], true);
  assert.equal(sources.length, 4);
  assert.equal(sources[3].media, undefined);
  assert.match(sources[3].srcSet, /w=1920&h=1080/);
  assert.deepEqual(landingPictureSourcesFor(heroes[0], false), []);

  // a picture takes the first matching source, but every matching preload downloads
  assert.deepEqual(
    landingPreloadsFor(heroes[0], true).map((preload) => preload.media),
    [
      '(max-aspect-ratio: 11/18)',
      '(min-aspect-ratio: 11/18) and (max-aspect-ratio: 1/1)',
      '(min-aspect-ratio: 1/1) and (max-aspect-ratio: 20/13)',
      '(min-aspect-ratio: 20/13)',
    ],
  );

  const script = landingHeroScript(heroes, true);
  assert.match(script, /"id":"big"/);
  assert.match(script, /kyo-landing-seen/);
  assert.doesNotMatch(script, /<\//);
  assert.equal(landingHeroScript([], true), null);
});

test('Blocks landing falls back to other sources when fewer than three are curated', () => {
  const candidates = blocksLandingCandidatesForEvents([
    event({ id: 'one', sourceSlug: 'one' }),
    event({ id: 'two', sourceSlug: 'two' }),
    event({ id: 'other', sourceSlug: 'other', landingEligible: false }),
  ]);
  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    ['one', 'two', 'other'],
  );
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

test('Blocks landing snaps transforms to shared size buckets', () => {
  const [slide] = resolveBlocksLandingSlides({
    candidates: blocksLandingCandidatesForEvents([event({ id: 'one' })]),
    viewportWidth: 1366,
    viewportHeight: 768,
  });
  assert.deepEqual({ width: slide.width, height: slide.height }, { width: 1440, height: 810 });
});

test('Blocks landing leads with whichever image loaded first and rotates only ready slides', () => {
  assert.equal(firstReadySlideIndex(['a', 'b', 'c'], []), -1);
  assert.equal(firstReadySlideIndex(['a', 'b', 'c'], ['gone', 'c', 'a']), 2);
  assert.equal(nextReadySlideIndex(2, [true, false, true]), 0);
  assert.equal(nextReadySlideIndex(0, [true, false, true]), 2);
  assert.equal(nextReadySlideIndex(0, [true, false, false]), 0);
});

test('Landing warm list covers the hero srcset and phone and desktop slides', async () => {
  const { landingWarmUrls } = await import('../src/lib/landingWarm.ts');
  const candidates = [
    {
      id: 'a',
      title: 'A',
      institution: 'I',
      date: 'D',
      sourceSlug: 's1',
      images: [{ src: 'https://example.test/a.jpg', width: 3000, height: 2000 }],
    },
    {
      id: 'b',
      title: 'B',
      institution: 'I',
      date: 'D',
      sourceSlug: 's2',
      images: [{ src: 'https://example.test/b.jpg', width: 1600, height: 1200 }],
    },
  ];
  const urls = landingWarmUrls(candidates, [{ id: 'a', ...candidates[0].images[0] }]);
  const params = urls.map((url) => new URLSearchParams(url.split('?')[1]));

  assert.equal(new Set(urls).size, urls.length);
  assert.ok(params.every((p) => p.get('q') === '60' && p.get('fit') === 'cover'));
  // portrait phone crop and landscape desktop crop for both images
  for (const src of ['https://example.test/a.jpg', 'https://example.test/b.jpg']) {
    const sizes = params
      .filter((p) => p.get('url') === src)
      .map((p) => [Number(p.get('w')), Number(p.get('h'))]);
    assert.ok(
      sizes.some(([w, h]) => h > w),
      `${src} portrait`,
    );
    assert.ok(
      sizes.some(([w, h]) => w > h),
      `${src} landscape`,
    );
  }
});

test('Blocks landing drops images the landing check rejected and prefers approved ones', () => {
  const [candidate] = blocksLandingCandidatesForEvents([
    event({
      id: 'checked',
      sourceSlug: 'checked-source',
      images: [
        { url: 'https://example.test/flyer.jpg', width: 2400, height: 1600, landingOk: false },
        { url: 'https://example.test/unchecked.jpg', width: 2400, height: 1600, landingOk: null },
        { url: 'https://example.test/gallery.jpg', width: 2400, height: 1600, landingOk: true },
      ],
    }),
  ]);
  assert.deepEqual(
    candidate.images.map((image) => image.src),
    ['https://example.test/gallery.jpg', 'https://example.test/unchecked.jpg'],
  );
  assert.deepEqual(
    blocksLandingCandidatesForEvents([
      event({
        images: [
          { url: 'https://example.test/flyer.jpg', width: 2400, height: 1600, landingOk: false },
        ],
      }),
    ]),
    [],
  );
});
