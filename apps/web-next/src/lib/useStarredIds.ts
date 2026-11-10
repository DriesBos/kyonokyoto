'use client';

import { useSyncExternalStore } from 'react';
import { readStarredIds, subscribeStarredIds } from './eventStars';

const NO_STARS: string[] = [];

// Starred event ids, live across star toggles and tabs. Empty on the server and first paint.
export const useStarredIds = () =>
  useSyncExternalStore(subscribeStarredIds, readStarredIds, () => NO_STARS);
