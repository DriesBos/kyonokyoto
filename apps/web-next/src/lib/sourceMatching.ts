type SourceRelation = { slug: string | null } | { slug: string | null }[] | null;

type SourceCandidate = {
  sources: SourceRelation;
  source_id: string | null;
  source_url: string;
};

type SourceConfig = {
  slug: string;
  base_url?: string;
  start_urls?: string[];
  allowed_domains?: string[];
  event_page_patterns?: string[];
};

const normalizedUrl = (value: string | undefined) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url;
  } catch {
    return null;
  }
};

export const sourceMatchScore = (eventUrl: string, source: SourceConfig) => {
  const url = normalizedUrl(eventUrl);
  if (!url) return 0;

  const hostname = url.hostname.toLowerCase();
  let score = 0;
  let matchesHost = false;
  for (const domain of source.allowed_domains ?? []) {
    const normalizedDomain = domain.toLowerCase();
    if (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)) {
      matchesHost = true;
      score = Math.max(score, 10);
    }
  }
  for (const candidateValue of [source.base_url, ...(source.start_urls ?? [])]) {
    const candidate = normalizedUrl(candidateValue);
    if (!candidate) continue;
    if (hostname === candidate.hostname.toLowerCase()) matchesHost = true;
    if (url.toString().startsWith(candidate.toString())) {
      matchesHost = true;
      score = Math.max(score, 100 + candidate.pathname.length);
    }
  }
  if (!matchesHost) return 0;
  for (const pattern of source.event_page_patterns ?? []) {
    if (pattern && url.pathname.includes(pattern)) score = Math.max(score, 40 + pattern.length);
  }
  return score;
};

export const sourceSlugForEvent = (event: SourceCandidate, sources: SourceConfig[]) => {
  const relationSlug = Array.isArray(event.sources) ? event.sources[0]?.slug : event.sources?.slug;
  const sourceSlugs = new Set(sources.map((source) => source.slug));
  if (relationSlug && sourceSlugs.has(relationSlug)) return relationSlug;
  if (event.source_id && sourceSlugs.has(event.source_id)) return event.source_id;

  return (
    sources
      .map((source) => ({ slug: source.slug, score: sourceMatchScore(event.source_url, source) }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.slug ?? null
  );
};
