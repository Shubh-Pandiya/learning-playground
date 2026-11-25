import type { Concept, TrackId } from '../types';
import { TRACKS } from './tracks';
import { mechanics } from './mechanics';
import { windows } from './windows';
import { ctes } from './ctes';
import { analytics } from './analytics';
import { perfConcepts } from './performance';
import { transactions } from './transactions';

export { TRACKS } from './tracks';

const byTrackId: Record<TrackId, Concept[]> = { mechanics, windows, ctes, analytics, performance: perfConcepts, transactions };

/** All concepts in curriculum order (track order, then authored order). */
export const CONCEPTS: Concept[] = [...TRACKS].sort((a, b) => a.order - b.order).flatMap((t) => byTrackId[t.id]);

export const conceptById = (id: string) => CONCEPTS.find((c) => c.id === id);
export const conceptsInTrack = (id: TrackId) => byTrackId[id];
