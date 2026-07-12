export const CATEGORY_REGISTRY = Object.freeze({
  venue_category: Object.freeze([
    'fair',
    'festival',
    'campus',
    'museum',
    'gallery',
    'institute',
    'theatre',
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
    'craft',
    'new-media',
    'sculpture',
    'music',
    'contemporary',
  ]),
  event_category: Object.freeze(['workshop', 'exhibition', 'fair', 'festival', 'event']),
});

export const CATEGORY_DIMENSIONS = Object.freeze(Object.keys(CATEGORY_REGISTRY));

export function normalizeTaxonomy(value = {}) {
  return Object.fromEntries(
    CATEGORY_DIMENSIONS.map((dimension) => [
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
      errors.push(`${owner}: missing taxonomy.${dimension}`);
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
    taxonomy[dimension].map((category) => categoryToken(dimension, category)),
  );
}

export const primaryVenueCategory = (value = {}) => assertTaxonomy(value).venue_category[0];
