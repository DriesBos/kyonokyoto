export const CATEGORY_REGISTRY = Object.freeze({
  venue_category: Object.freeze([
    'fair',
    'festival',
    'campus',
    'museum',
    'gallery',
    'institute',
    'theatre',
    'cafe',
    'historic-site',
    'garden',
  ]),
  display_category: Object.freeze([
    'photography',
    'architecture',
    'painting',
    'textile',
    'ukiyoe',
    'performance',
    'design',
    'graphic',
    'ceramics',
    'new-media',
    'sculpture',
    'music',
    'contemporary',
  ]),
  event_category: Object.freeze([
    'workshop',
    'exhibition',
    'fair',
    'festival',
    'event',
    'special-opening',
  ]),
  collection: Object.freeze(['temples-gardens']),
});

export const CATEGORY_DIMENSIONS = Object.freeze(Object.keys(CATEGORY_REGISTRY));
const REQUIRED_CATEGORY_DIMENSIONS = Object.freeze(
  CATEGORY_DIMENSIONS.filter((dimension) => dimension !== 'collection'),
);

export function normalizeTaxonomy(value = {}) {
  return Object.fromEntries(
    CATEGORY_DIMENSIONS.filter(
      (dimension) => dimension !== 'collection' || Array.isArray(value?.[dimension]),
    ).map((dimension) => [
      dimension,
      [
        ...new Set(
          (Array.isArray(value?.[dimension]) ? value[dimension] : [])
            .filter((item) => typeof item === 'string')
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean),
        ),
      ],
    ]),
  );
}

export function taxonomyErrors(value = {}, owner = 'item') {
  const errors = [];
  const keys = Object.keys(value ?? {});

  for (const key of keys) {
    if (!CATEGORY_DIMENSIONS.includes(key))
      errors.push(`${owner}: unsupported taxonomy key "${key}"`);
  }

  for (const dimension of CATEGORY_DIMENSIONS) {
    const categories = value?.[dimension];
    if (!Array.isArray(categories)) {
      if (
        REQUIRED_CATEGORY_DIMENSIONS.includes(dimension) ||
        (Object.hasOwn(value ?? {}, dimension) && categories !== undefined)
      ) {
        errors.push(`${owner}: missing taxonomy.${dimension}`);
      }
      continue;
    }

    for (const category of categories) {
      if (!CATEGORY_REGISTRY[dimension].includes(category)) {
        errors.push(`${owner}: unsupported ${dimension} "${category}"`);
      }
    }
  }

  if (Array.isArray(value?.venue_category) && !value.venue_category.length) {
    errors.push(`${owner}: missing venue_category`);
  }
  return errors;
}

export function assertTaxonomy(value = {}, owner = 'item') {
  const errors = taxonomyErrors(value, owner);
  if (errors.length) throw new Error(errors.join('\n'));
  return normalizeTaxonomy(value);
}

export const categoryToken = (dimension, category) => `${dimension}:${category}`;

export function parseCategoryToken(token) {
  const [dimension, category, ...rest] = String(token ?? '').split(':');
  if (rest.length || !CATEGORY_REGISTRY[dimension]?.includes(category)) return null;
  return { dimension, category };
}

export function flattenTaxonomy(value = {}) {
  const taxonomy = assertTaxonomy(value);
  return CATEGORY_DIMENSIONS.flatMap((dimension) =>
    (taxonomy[dimension] ?? []).map((category) => categoryToken(dimension, category)),
  );
}

export const primaryVenueCategory = (value = {}) => assertTaxonomy(value).venue_category[0];

// Visitor filters (header): a small set derived from the taxonomy tokens above, so no data has to
// be re-tagged. Tokens: type:<type>, sub:<type>:<sub>, place:<place>. Rows combine with AND,
// picks inside a row with OR, and a sub-pick only narrows its own type.
export const FILTER_TYPES = Object.freeze(['art', 'architecture', 'historic', 'garden']);
export const FILTER_SUBS = Object.freeze({
  art: Object.freeze([
    'contemporary',
    'photography',
    'painting',
    'ukiyoe',
    'ceramics',
    'textile',
    'sculpture',
    'design',
    'graphic',
    'new-media',
    'performance',
    'music',
  ]),
  historic: Object.freeze(['temple', 'shrine', 'palace-castle']),
});
export const FILTER_PLACES = Object.freeze(['museum', 'gallery', 'festival', 'fair', 'other']);

const ART_VENUES = new Set(['museum', 'gallery', 'fair', 'campus', 'institute', 'theatre', 'cafe']);
const OTHER_PLACES = new Set(['campus', 'institute', 'theatre', 'cafe']);
// Same signals as apps/crawler/src/temple-sources.mjs, plus the curated English names
// (data/temple-venue-names.json: "X-ji Temple", "X Shrine").
const HISTORIC_KINDS = [
  ['temple', /寺|院|庵|堂|\btemple\b/i],
  ['shrine', /神社|神宮|大社|八幡|稲荷|\bshrine\b/i],
  ['palace-castle', /御所|城|離宮|\bpalace\b|\bcastle\b|\bimperial villa\b/i],
];

export const filterToken = {
  type: (type) => `type:${type}`,
  sub: (type, sub) => `sub:${type}:${sub}`,
  place: (place) => `place:${place}`,
};

/**
 * @param {string[]} [categoryTokens]
 * @param {{ venueNames?: (string | null | undefined)[] }} [options]
 * @returns {string[]}
 */
export function filterTagsFor(categoryTokens = [], { venueNames = [] } = {}) {
  const byDimension = {
    venue_category: new Set(),
    display_category: new Set(),
    event_category: new Set(),
  };
  for (const token of categoryTokens) {
    const parsed = parseCategoryToken(token);
    if (parsed && byDimension[parsed.dimension]) byDimension[parsed.dimension].add(parsed.category);
  }
  const venues = byDimension.venue_category;
  const displays = byDimension.display_category;
  const events = byDimension.event_category;
  const historic = venues.has('historic-site');
  const garden = venues.has('garden');
  const architecture = displays.has('architecture');
  const mediums = FILTER_SUBS.art.filter((medium) => displays.has(medium));
  // Art is everything that is not only historic, garden or architecture.
  const art =
    !historic &&
    !garden &&
    (mediums.length > 0 || [...venues].some((venue) => ART_VENUES.has(venue)) || !architecture);

  const tags = [];
  if (art) {
    tags.push(filterToken.type('art'));
    mediums.forEach((medium) => tags.push(filterToken.sub('art', medium)));
  }
  if (architecture) tags.push(filterToken.type('architecture'));
  if (historic) {
    tags.push(filterToken.type('historic'));
    const names = venueNames.filter((name) => typeof name === 'string' && name.trim());
    HISTORIC_KINDS.forEach(([kind, pattern]) => {
      if (names.some((name) => pattern.test(name))) tags.push(filterToken.sub('historic', kind));
    });
  }
  if (garden) tags.push(filterToken.type('garden'));

  if (venues.has('museum')) tags.push(filterToken.place('museum'));
  if (venues.has('gallery')) tags.push(filterToken.place('gallery'));
  if (venues.has('festival') || events.has('festival')) tags.push(filterToken.place('festival'));
  if (venues.has('fair') || events.has('fair')) tags.push(filterToken.place('fair'));
  if ([...venues].some((venue) => OTHER_PLACES.has(venue))) tags.push(filterToken.place('other'));
  return tags;
}

// state: { types, subs, places } of picked values; subs as "<type>:<sub>". A picked sub also counts
// as its type, so subs work while the type row is hidden (one type on the page).
/**
 * @param {Set<string> | string[]} tags
 * @param {{ types?: string[], subs?: string[], places?: string[] }} [state]
 * @returns {boolean}
 */
export function matchesFilterState(tags, { types = [], subs = [], places = [] } = {}) {
  const has = tags instanceof Set ? (tag) => tags.has(tag) : (tag) => tags.includes(tag);
  const activeTypes = new Set([...types, ...subs.map((sub) => sub.split(':')[0])]);
  const typeMatches =
    activeTypes.size === 0 ||
    [...activeTypes].some((type) => {
      if (!has(filterToken.type(type))) return false;
      const picked = subs.filter((sub) => sub.startsWith(`${type}:`));
      return picked.length === 0 || picked.some((sub) => has(`sub:${sub}`));
    });
  const placeMatches = places.length === 0 || places.some((place) => has(filterToken.place(place)));
  return typeMatches && placeMatches;
}
