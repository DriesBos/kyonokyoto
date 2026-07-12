export const PUBLIC_CATEGORIES = Object.freeze([
  'exhibition',
  'museum',
  'gallery',
  'art',
  'photography',
  'design',
  'craft',
  'event',
  'music',
  'performance',
  'ceramics',
  'workshop',
  'festival',
  'fair',
  'architecture',
  'graphic',
  'new-media',
  'sculpture',
  'textiles',
  'ukiyoe',
  'campus',
]);

export const SOURCE_TYPES = Object.freeze([
  'art-center',
  'design',
  'fair',
  'festival',
  'gallery',
  'museum',
  'university',
  'venue',
]);

const publicCategorySet = new Set(PUBLIC_CATEGORIES);
const sourceTypeSet = new Set(SOURCE_TYPES);

export const isPublicCategory = (value) => publicCategorySet.has(value);
export const isSourceType = (value) => sourceTypeSet.has(value);

export function assertPublicCategories(values = [], owner = 'item') {
  const invalid = values.filter((value) => !isPublicCategory(value));
  if (invalid.length) {
    throw new Error(`${owner}: unsupported public categories: ${invalid.join(', ')}`);
  }

  return values;
}
