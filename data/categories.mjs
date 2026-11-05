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
    'temple',
    'shrine',
    'garden',
    'historic-site',
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
