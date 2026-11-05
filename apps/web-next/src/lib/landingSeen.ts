// Landing events this browser has already shown, oldest first, so the next visit leads with
// something new (lib/blocksLanding.ts landingVisitOrder, lib/landingHero.ts).
export const LANDING_SEEN_KEY = 'kyo-landing-seen';
export const LANDING_SEEN_LIMIT = 120;

export const readLandingSeen = (): string[] => {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(LANDING_SEEN_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

export const rememberLandingSeen = (id: string) => {
  try {
    const ids = [...readLandingSeen().filter((seen) => seen !== id), id];
    window.localStorage.setItem(LANDING_SEEN_KEY, JSON.stringify(ids.slice(-LANDING_SEEN_LIMIT)));
  } catch {
    // storage unavailable (private mode): every visit is a fresh random pick
  }
};
