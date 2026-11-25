import type { Pattern } from '../../types';
import { blobStorage, autoscaling, idempotency, leaderElection, searchIndexing } from './advanced';
import { cqrs, circuitBreaker, eventSourcing, saga, serviceDiscovery } from './architecture';
import { apiGateway, consistentHashing, pubsub, queues, rateLimiting } from './messaging';
import { caching, cdn, loadBalancing, readReplicas, sharding } from './scaling';

export const PATTERNS: Pattern[] = [
  loadBalancing,
  caching,
  cdn,
  readReplicas,
  sharding,
  consistentHashing,
  queues,
  pubsub,
  rateLimiting,
  apiGateway,
  circuitBreaker,
  serviceDiscovery,
  cqrs,
  eventSourcing,
  saga,
  leaderElection,
  idempotency,
  blobStorage,
  searchIndexing,
  autoscaling,
].sort((a, b) => a.num - b.num);

const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));
export const getPattern = (id: string | undefined): Pattern | undefined => (id ? BY_ID.get(id) : undefined);
