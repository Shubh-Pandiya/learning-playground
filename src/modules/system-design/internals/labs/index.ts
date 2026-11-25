import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { LabId } from '../types';

export const LABS: Record<LabId, LazyExoticComponent<ComponentType>> = {
  lb: lazy(() => import('./LbLab')),
  eviction: lazy(() => import('./EvictionLab')),
  storage: lazy(() => import('./StorageLab')),
  ratelimit: lazy(() => import('./RateLimitLab')),
  ring: lazy(() => import('./RingLab')),
  inverted: lazy(() => import('./InvertedLab')),
  bloom: lazy(() => import('./BloomLab')),
  breaker: lazy(() => import('./BreakerLab')),
  queue: lazy(() => import('./QueueLab')),
};

export const LAB_TITLE: Record<LabId, string> = {
  lb: 'Load-balancing algorithms',
  eviction: 'Cache eviction policies',
  storage: 'B-tree vs LSM storage engines',
  ratelimit: 'Rate-limiting algorithms',
  ring: 'Consistent hashing',
  inverted: 'Inverted index',
  bloom: 'Bloom filter',
  breaker: 'Circuit breaker & retries',
  queue: 'Queues, backlog & DLQ',
};
