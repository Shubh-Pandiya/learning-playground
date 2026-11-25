import type { Check, ComponentKind, RefEdge, RefNode, Requirement } from '../../types';

/** Reference node. Columns are ~190px apart, rows ~110px. */
export const N = (id: string, kind: ComponentKind, x: number, y: number, why: string, o: { count?: number; label?: string } = {}): RefNode => ({
  id,
  kind,
  x,
  y,
  why,
  ...o,
});

export const E = (from: string, to: string, why?: string, hideWhen?: string | string[]): RefEdge => ({ from, to, why, hideWhen });

export const R = (id: string, text: string, check: Check, hint: string): Requirement => ({ id, text, check, hint });

export const X = [0, 190, 380, 570, 760, 950] as const;

/** Frequently reused requirement shapes. */
export const req = {
  qps: (q: number, hint = 'Find the bottleneck: the node that turns red first when you raise traffic.') =>
    R('qps', `Serve ${q.toLocaleString()} req/s with < 1% errors`, { type: 'maxQps', gte: q }, hint),
  p99: (ms: number, hint = 'Something slow sits on the request path. Serve the common case from somewhere faster.') =>
    R('p99', `p99 latency ≤ ${ms} ms`, { type: 'p99', lte: ms }, hint),
  survives: (kind: ComponentKind, text: string, hint: string) => R(`survive-${kind}`, text, { type: 'survives', kind }, hint),
  writes: (kind: ComponentKind, text: string, hint: string) => R(`writes-${kind}`, text, { type: 'writesSurvive', kind }, hint),
  has: (kind: ComponentKind, text: string, hint: string, min?: number) => R(`has-${kind}`, text, { type: 'has', kind, min }, hint),
  edge: (from: ComponentKind, to: ComponentKind, text: string, hint: string) => R(`edge-${from}-${to}`, text, { type: 'edge', from, to }, hint),
  none: (kinds: ComponentKind[], text: string, hint: string) => R(`none-${kinds.join('-')}`, text, { type: 'none', kinds }, hint),
  noSpof: (hint = 'Kill each node in turn. Anything with a single instance on the path takes the site down.') =>
    R('nospof', 'No single point of failure on the request path', { type: 'noSpof' }, hint),
};

/** Stock explanations for distractors that are wrong in most scenarios. */
export const W = {
  bigServer: {
    why: 'Scaling up buys time, not a design: there is a ceiling (the biggest box), it costs super-linearly, and it is still one machine — a single point of failure.',
    instead: 'Several small stateless instances behind a load balancer.',
  },
  sticky: {
    why: 'Sticky sessions pin a user to one server. When it dies their session dies, and load can never rebalance evenly. Keep the tier stateless instead.',
    instead: 'A plain load balancer + session state in a shared store (Redis/DB).',
  },
  multiMaster: {
    why: 'Accepting writes on several SQL primaries creates write conflicts (last-write-wins silently drops data) and every write is still replicated to every node, so it does not multiply write capacity.',
    instead: 'Single-leader replication, or partition the data (sharding).',
  },
  polling: {
    why: 'Polling every second multiplies load ~10× (most polls return nothing) while still being up to a second stale.',
    instead: 'Push (WebSocket/SSE) or longer TTLs behind a CDN.',
  },
  cronPoller: {
    why: 'Using a database table as a queue polled by cron adds seconds of latency, hammers the DB with SELECT … FOR UPDATE, and needs hand-rolled locking and retries.',
    instead: 'A real message queue with acks, visibility timeouts and a DLQ.',
  },
  twoPc: {
    why: 'Two-phase commit across services is blocking: locks are held across network round-trips and a crashed coordinator leaves participants stuck. Most cloud datastores and brokers do not even support XA.',
    instead: 'A saga with compensating actions, or design so one service owns the transaction.',
  },
  naiveRetry: {
    why: 'Immediate retries without backoff turn a slow dependency into a dead one: every failure triples the load on the thing that is already struggling (retry storm).',
    instead: 'Retries with exponential backoff + jitter, a retry budget, and a circuit breaker.',
  },
  blobColumn: {
    why: 'Storing multi-MB files in database rows bloats the buffer pool, slows backups and replication, and makes every byte pass through your app and DB.',
    instead: 'Object storage (S3/GCS) with the DB holding only the key + metadata.',
  },
  nfs: {
    why: 'A shared NFS volume is a single, slow, hard-to-scale box that every server mounts — when it hiccups, every server hangs on I/O.',
    instead: 'Object storage accessed over HTTP.',
  },
  redisLock: {
    why: 'A single-node Redis SETNX lock has no fencing token: after a GC pause or a Redis failover two holders can both believe they own the lock.',
    instead: 'A consensus store (etcd/ZooKeeper) with leases + fencing tokens, or make the operation idempotent.',
  },
  modHash: {
    why: '`hash(key) % N` remaps almost every key when N changes, so adding or losing a node triggers a near-total data reshuffle (or cache miss storm).',
    instead: 'A consistent-hash ring (only ~1/N of keys move).',
  },
  sqlLike: {
    why: "`WHERE name LIKE '%term%'` can't use a B-tree index: every query scans the whole table. It also has no relevance ranking, typo tolerance or stemming.",
    instead: 'A search index (inverted index) fed from the DB.',
  },
  localCache: {
    why: 'Each server keeps its own copy: N servers = N cold caches with a low hit rate, and they disagree with each other after writes (no shared invalidation).',
    instead: 'A shared cache tier (Redis/Memcached).',
  },
} as const;
