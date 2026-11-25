/**
 * Kafka playground domain model.
 * A pipeline graph (producers → topics → consumer groups → sinks) lives on a simulated cluster.
 * Content (lessons, drills, deep dives) is pure data; the engine in `engine/` interprets it.
 */

export type KKind =
  | 'service' // an app that produces events (the Kafka producer client lives here)
  | 'postgres' // OLTP database the service writes to
  | 'cdc' // Debezium source connector on Kafka Connect, tails the WAL
  | 'topic'
  | 'group' // consumer group: N instances of one consuming app
  | 'streams' // Kafka Streams / Flink app: consume → transform → produce
  | 'sink' // downstream store (DB, search index, warehouse, external API)
  | 'registry' // schema registry
  // traps
  | 'poller'
  | 'memqueue'
  | 'rabbit';

export type KeyStrategy = 'entity' | 'random' | 'null' | 'hot';
export type Acks = '0' | '1' | 'all';
export type Compression = 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';
export type Cleanup = 'delete' | 'compact';
export type CommitMode = 'auto' | 'before' | 'after' | 'txn';
export type Assignor = 'range' | 'roundrobin' | 'sticky' | 'coop';
export type OnError = 'crash' | 'skip' | 'block-retry' | 'retry-dlq';
export type Isolation = 'uncommitted' | 'committed';
export type TopicRole = 'main' | 'retry' | 'dlq' | 'changelog';

/** One flat config bag; each kind reads the keys it understands (see `engine/defaults.ts`). */
export interface NodeCfg {
  // producer (service, cdc, streams output)
  rate: number; // events/s at 1× traffic
  msgBytes: number;
  key: KeyStrategy;
  acks: Acks;
  idempotence: boolean;
  retries: boolean;
  maxInFlight: number;
  lingerMs: number;
  batchKb: number;
  compression: Compression;
  transactional: boolean;
  // topic
  partitions: number;
  rf: number;
  minIsr: number;
  cleanup: Cleanup;
  retentionH: number; // -1 = forever
  unclean: boolean;
  role: TopicRole;
  // group / streams
  consumers: number;
  procMs: number;
  commit: CommitMode;
  assignor: Assignor;
  staticMembership: boolean;
  isolation: Isolation;
  onError: OnError;
  maxPollRecords: number;
  eos: boolean;
  // sink
  idempotentSink: boolean;
  capacity: number; // writes/s
}

export interface KNode {
  id: string;
  kind: KKind;
  x: number;
  y: number;
  label?: string;
  cfg: Partial<NodeCfg>;
}

export interface KEdge {
  id: string;
  from: string;
  to: string;
}

export interface ClusterCfg {
  brokers: number;
  kraft: boolean;
}

/** Injected failures. Never persisted as part of a design. */
export interface Chaos {
  traffic: number;
  brokersDown: number[];
  /** A broker whose followers fall behind (slow disk / GC) and drop out of the ISR. */
  slowBroker?: number;
  /** Consumer group / streams id whose processing is 5× slower. */
  slowGroup?: string;
  poison: boolean;
  hotKey: boolean;
}

export interface KGraph {
  nodes: KNode[];
  edges: KEdge[];
  cluster: ClusterCfg;
}

export const NO_CHAOS: Chaos = { traffic: 1, brokersDown: [], poison: false, hotKey: false };

export type Tone = 'green' | 'blue' | 'violet' | 'orange' | 'rose' | 'teal' | 'sand' | 'slate' | 'yellow';
export type Shape = 'block' | 'hex' | 'cylinder' | 'pipe' | 'shield';

export interface KindDef {
  kind: KKind;
  name: string;
  tech: string;
  category: 'produce' | 'kafka' | 'consume' | 'data' | 'trap';
  icon: string;
  tone: Tone;
  shape: Shape;
  /** What it solves, in one line. */
  solves: string;
  /** How it is actually built: the internals an interviewer probes. */
  internals: string[];
  tradeoffs: string[];
  pitfall: string;
  usedBy: string;
  /** For traps: why it's wrong and what to use instead. */
  trap?: { why: string; instead: string };
}

export type Level = 'bad' | 'warn' | 'info';

export interface Flag {
  id: string;
  level: Level;
  nodeId?: string;
  title: string;
  why: string;
  fix?: string;
}

/** Delivery guarantee seen by a consumer group's side effects. */
export type Semantics = 'at-most-once' | 'at-least-once' | 'effectively-once' | 'exactly-once' | 'none';
export type Ordering = 'total' | 'per-key' | 'per-key*' | 'none' | 'n/a';
