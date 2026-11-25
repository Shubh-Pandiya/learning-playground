/**
 * System-design playground domain model.
 * Patterns are pure content (see data/patterns); the engine interprets them.
 */

export type ComponentKind =
  // edge / entry
  | 'client'
  | 'dns'
  | 'cdn'
  | 'lb'
  | 'api-gateway'
  | 'rate-limiter'
  | 'ws-gateway'
  // compute
  | 'app'
  | 'service'
  | 'worker'
  | 'projector'
  | 'saga'
  | 'circuit-breaker'
  // data
  | 'cache'
  | 'db'
  | 'replica'
  | 'nosql'
  | 'shard-router'
  | 'hash-ring'
  | 'shard'
  | 'object-store'
  | 'search'
  | 'event-store'
  | 'read-model'
  | 'idem-store'
  | 'bloom'
  // messaging
  | 'queue'
  | 'stream'
  | 'pubsub'
  | 'cdc'
  | 'dlq'
  // control plane
  | 'registry'
  | 'coordinator'
  | 'autoscaler'
  | 'monitor'
  // distractors / anti-patterns
  | 'big-server'
  | 'sticky-lb'
  | 'local-cache'
  | 'nfs'
  | 'mod-hash'
  | 'two-pc'
  | 'redis-lock'
  | 'cron-poller'
  | 'sql-like'
  | 'blob-column'
  | 'naive-retry'
  | 'multi-master'
  | 'client-polling';

export type Category = 'entry' | 'compute' | 'data' | 'messaging' | 'control' | 'anti';

export type Shape = 'users' | 'block' | 'cylinder' | 'pipe' | 'cloud' | 'shield' | 'hex';

export type Tone = 'green' | 'blue' | 'violet' | 'orange' | 'rose' | 'teal' | 'sand' | 'slate' | 'yellow';

/** How a node handles traffic in the simulator. */
export interface FlowModel {
  /** Requests/s one healthy instance can serve before saturating. Infinity for managed/elastic. */
  capacity: number;
  /** Hop latency contribution in ms (roughly a p99 hop). */
  latencyMs: number;
  /** Single-instance availability (e.g. 0.999). */
  availability: number;
  /** Monthly cost per instance in USD (rough, for relative comparison). */
  cost: number;
  /** Which traffic it accepts from upstream. Control kinds accept none. */
  accepts: 'rw' | 'r' | 'w' | 'none';
  /** Fraction of incoming reads answered locally (cache hits, CDN hits, bloom negatives). Key into workload. */
  absorbs?: 'cacheHit' | 'cdnHit' | 'bloomNegative' | 'localCacheHit';
  /** Async buffer: acks writes immediately, drains to consumers at their capacity. */
  async?: 'queue' | 'fanout';
  /** Control-plane: never carries request traffic, modifies capabilities. */
  control?: boolean;
  /** Elastic/managed & multi-AZ by default — never a SPOF. */
  managed?: boolean;
  /** Routes around dead downstream instances (health checks). */
  healthChecks?: boolean;
  /** Is a durable store of record. */
  durable?: boolean;
  /** Same "family" members share reads (e.g. primary + replicas). Defaults to kind. */
  family?: string;
  /** Writes cost this many units of capacity (default 1). */
  writeCost?: number;
  /** Caps throughput at workload.rateLimit. */
  limiter?: boolean;
  /** Fails fast when its downstream is unhealthy. */
  breaker?: boolean;
  /** Constant multiplier on forwarded traffic (e.g. polling). */
  amplify?: number;
  /** Multiplies forwarded traffic ×3 when downstream is unhealthy (retry storm). */
  retryStorm?: boolean;
  /** Reads prefer this store over general-purpose stores (read models, search indexes). */
  readPreferred?: boolean;
  /** Calls every downstream node (orchestrators) instead of routing to one. */
  broadcast?: boolean;
}

export interface ComponentDef {
  kind: ComponentKind;
  name: string;
  /** Short subtitle like "Redis / Memcached". */
  tech: string;
  category: Category;
  shape: Shape;
  tone: Tone;
  /** lucide icon name, resolved in ui/icons.tsx */
  icon: string;
  /** What problem this component solves (one or two sentences). */
  solves: string;
  /** Tradeoffs to keep in mind. */
  tradeoffs: string[];
  /** Typical misuse / when not to use it. */
  pitfall: string;
  /** Real systems that use it. */
  usedBy: string;
  flow: FlowModel;
  /** Anti-pattern components describe why they are traps. */
  trap?: string;
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

export interface Workload {
  /** Peak user requests per second hitting the system. */
  qps: number;
  /** Fraction of requests that are reads (0..1). */
  readRatio: number;
  cacheHit?: number;
  cdnHit?: number;
  bloomNegative?: number;
  localCacheHit?: number;
  /** Allowed requests/s when a rate limiter is present. */
  rateLimit?: number;
  /** Abusive/bot fraction of traffic (only cut by rate limiter). */
  abusive?: number;
  /** Fraction of writes that clients retry (duplicates unless deduplicated by an idempotency store). */
  retryRate?: number;
}

export interface RefNode {
  id: string;
  kind: ComponentKind;
  /** Optional display label override, e.g. "Payment svc". */
  label?: string;
  /** Instances required (default 1). */
  count?: number;
  x: number;
  y: number;
  /** Why this node is in the reference design (scenario-specific). */
  why: string;
}

export interface RefEdge {
  from: string;
  to: string;
  why?: string;
  /** Guided mode: hide this edge once the given node id is visible (e.g. a naive link replaced by a new tier). */
  hideWhen?: string | string[];
}

export type Check =
  | { type: 'has'; kind: ComponentKind; min?: number }
  | { type: 'hasAny'; kinds: ComponentKind[] }
  | { type: 'edge'; from: ComponentKind; to: ComponentKind }
  | { type: 'maxQps'; gte: number }
  | { type: 'p99'; lte: number }
  | { type: 'noSpof' }
  | { type: 'availability'; gte: number }
  | { type: 'none'; kinds: ComponentKind[] }
  | { type: 'survives'; kind: ComponentKind }
  | { type: 'writesSurvive'; kind: ComponentKind }
  | { type: 'noEdge'; from: ComponentKind; to: ComponentKind }
  | { type: 'durability'; gte: 1 | 2 | 3 }
  | { type: 'spike'; factor: number }
  | { type: 'noDuplicates' }
  | { type: 'all'; checks: Check[] };

export interface Requirement {
  id: string;
  text: string;
  check: Check;
  /** Shown as a hint when unmet. */
  hint: string;
}

export interface Scenario {
  id: string;
  title: string;
  /** One-paragraph product context. */
  context: string;
  workload: Workload;
  requirements: Requirement[];
  /** Components available in the palette (correct ones and distractors). */
  palette: ComponentKind[];
  reference: { nodes: RefNode[]; edges: RefEdge[] };
  /** Scenario-specific explanation for components that are WRONG here. */
  wrong: Partial<Record<ComponentKind, { why: string; instead?: string }>>;
  /** Valid alternatives that differ from the reference (not penalised; explained). */
  alt?: Partial<Record<ComponentKind, string>>;
}

export type StepTag = 'problem' | 'technique' | 'tradeoff' | 'failure' | 'case' | 'recap';

export interface Predict {
  question: string;
  options: string[];
  answer: number;
  explain: string;
}

export interface GuidedStep {
  title: string;
  tag: StepTag;
  /** Short paragraphs. Supports **bold** and `code`. */
  body: string[];
  keyIdea?: string;
  goodToKnow?: string;
  /** Node ids (from reference or extras) visible from this step on. */
  add?: string[];
  remove?: string[];
  /** Kill these nodes during this step. */
  kill?: string[];
  /** Traffic multiplier for this step. */
  traffic?: number;
  predict?: Predict;
}

export interface QuizQ {
  id: string;
  q: string;
  options: string[];
  answer: number;
  why: string;
}

export interface Pattern {
  id: string;
  num: number;
  title: string;
  group: 'Scaling' | 'Data' | 'Messaging' | 'Reliability' | 'Architecture';
  tagline: string;
  minutes: number;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  /** Interview cues that should make you reach for this pattern. */
  signals: string[];
  /** What you'll learn checklist. */
  learn: string[];
  realWorld: { who: string; how: string }[];
  scenario: Scenario;
  /** Extra nodes/edges shown only in guided mode (naive designs etc). */
  extras?: { nodes: RefNode[]; edges: RefEdge[] };
  guided: GuidedStep[];
  quiz: QuizQ[];
  /** Transfer scenario: different domain, same pattern. */
  challenge: Scenario;
}

/* ------------------------------------------------------------------ */
/* Canvas graph                                                        */
/* ------------------------------------------------------------------ */

export interface GNode {
  id: string;
  kind: ComponentKind;
  label?: string;
  count: number;
  x: number;
  y: number;
  /** Instances currently down (failure injection). */
  down?: number;
}

export interface GEdge {
  id: string;
  from: string;
  to: string;
}

export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}

export type Verdict = 'good' | 'extra' | 'wrong';
