/**
 * Data-engineering system-design playground domain model.
 * Patterns are pure content (see data/patterns); the engine interprets them.
 */

export type ComponentKind =
  // sources
  | 'app-db'
  | 'events'
  | 'saas'
  | 'logs'
  // ingest
  | 'kafka'
  | 'cdc'
  | 'connector'
  | 'schema-registry'
  // processing & orchestration
  | 'flink'
  | 'spark-ss'
  | 'spark'
  | 'dbt'
  | 'salt'
  | 'airflow'
  | 'compaction'
  // storage
  | 'object-store'
  | 'lakehouse'
  | 'warehouse'
  | 'olap'
  | 'kv'
  | 'feature-store'
  | 'search'
  | 'trino'
  // quality & governance
  | 'dq'
  | 'catalog'
  | 'pii'
  // consumers
  | 'bi'
  | 'app-api'
  | 'ml'
  | 'reverse-etl'
  // anti-patterns / traps
  | 'cron-script'
  | 'dual-write'
  | 'full-dump'
  | 'prod-analytics'
  | 'append-sink'
  | 'proc-time'
  | 'raw-files'
  | 'tiny-writer'
  | 'mem-buffer';

export type Category = 'source' | 'ingest' | 'process' | 'store' | 'govern' | 'serve' | 'anti';

export type Shape = 'users' | 'block' | 'cylinder' | 'pipe' | 'cloud' | 'shield' | 'hex';

export type Tone = 'green' | 'blue' | 'violet' | 'orange' | 'rose' | 'teal' | 'sand' | 'slate' | 'yellow';

/** How a node behaves in the pipeline simulator. */
export interface FlowModel {
  /** Pipeline role. Control nodes never carry records; they change capabilities. */
  role: 'source' | 'ingest' | 'process' | 'store' | 'query' | 'serve' | 'control';
  /** Records/s one healthy instance handles. Infinity for elastic/managed. */
  capacity: number;
  /** Seconds this hop adds to end-to-end freshness (batch interval, commit interval, poll interval). */
  delaySec: number;
  /** Monthly base cost per instance in USD (relative comparison only). */
  cost: number;
  /** Extra monthly USD per 1k records/s flowing through (usage-based services). */
  costPerKeps?: number;
  /** Batch vs streaming hop (edge rendering + explanations). */
  mode?: 'stream' | 'batch';
  /** Elastic & multi-AZ by default: never a SPOF. */
  managed?: boolean;
  /** Instances needed before one failure stops loses data (e.g. Kafka RF=3 → 3 brokers). */
  minHa?: number;
  /** Persists what it receives (survives restarts). */
  durable?: boolean;
  /** History can be re-read from here: a retention-bounded log, or the full history. */
  replay?: 'log' | 'full';
  /** Windows/partitions by event time (handles late, out-of-order data). */
  eventTime?: boolean;
  /** Windows by processing (arrival) time: late events land in the wrong window. */
  procTime?: boolean;
  /** Consistent snapshots: restarts resume from a checkpoint (no loss, no double state). */
  checkpoint?: boolean;
  /** Can drop duplicates by key (keyed state, MERGE, dropDuplicates, unique_key). */
  dedup?: boolean;
  /** How writes into this node behave when retried/replayed. */
  sink?: 'transactional' | 'idempotent' | 'append';
  /** Partitions work by key: one hot key lands on one instance. */
  keyed?: boolean;
  /** Spreads hot keys (salting / two-phase aggregation). */
  spreadsKeys?: boolean;
  /** Keeps data only in memory: a crash loses it. */
  volatile?: boolean;
  /** Writes to two systems without a transaction: they silently diverge. */
  inconsistent?: boolean;
  /** Reads an OLTP source in a way that loads production (full scans). */
  oltpLoad?: boolean;
  /** Read by low-level queries: per-instance query capacity (queries/s) and p99 latency (ms). */
  query?: { qps: number; ms: number };
  /** A consumer that issues interactive queries (adds workload.queryQps to the store it reads). */
  queries?: boolean;
  /** Writes many small files (streaming commits / per-event files). */
  smallFiles?: 'many' | 'tiny';
  /** Rewrites small files into big ones (maintenance). */
  compacts?: boolean;
  /** Schema behaviour: enforce compatibility at write, quarantine contract violations, or evolve additively. */
  schema?: 'enforce' | 'contract' | 'evolve';
  /** Files without a table format: no atomic commits, readers can see partial writes. */
  noAcid?: boolean;
  /** A non-idempotent writer: re-running or restarting it writes the same records again. */
  rerunDups?: boolean;
}

export interface ComponentDef {
  kind: ComponentKind;
  name: string;
  /** Short subtitle like "Apache Flink". */
  tech: string;
  category: Category;
  shape: Shape;
  tone: Tone;
  /** lucide icon name, resolved in ui/iso.tsx */
  icon: string;
  /** What problem this component solves (one or two sentences). */
  solves: string;
  /** Tradeoffs to keep in mind. */
  tradeoffs: string[];
  /** Typical misuse / when not to use it. */
  pitfall: string;
  /** Real companies/systems that use it. */
  usedBy: string;
  flow: FlowModel;
  /** Anti-pattern components describe why they are traps. */
  trap?: string;
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

export interface Workload {
  /** Peak records/s produced by all sources together. */
  eps: number;
  /** Interactive queries/s from dashboards/apps (0 = batch reporting only). */
  queryQps?: number;
  /** Fraction of events arriving late / out of order (e.g. offline phones). */
  late?: number;
  /** Fraction of records delivered twice by at-least-once producers / retries. */
  dup?: number;
  /** Share of all records belonging to the single hottest key (0..1). */
  skew?: number;
  /** Human label for a record, e.g. "click", "order", "log line". */
  unit?: string;
}

export interface RefNode {
  id: string;
  kind: ComponentKind;
  /** Optional display label override, e.g. "Bronze table". */
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
  /** Guided mode: hide this edge once the given node id is visible. */
  hideWhen?: string | string[];
}

export type ChaosId = 'late' | 'schema' | 'skew' | 'crash' | 'replay' | 'outage' | 'smallfiles';

export type OutcomeKey = 'absorbed' | 'delayed' | 'wrong' | 'broken' | 'lost';

export type Check =
  | { type: 'has'; kind: ComponentKind; min?: number }
  | { type: 'hasAny'; kinds: ComponentKind[] }
  | { type: 'edge'; from: ComponentKind; to: ComponentKind }
  | { type: 'none'; kinds: ComponentKind[] }
  | { type: 'noEdge'; from: ComponentKind; to: ComponentKind }
  /** End-to-end freshness (seconds) at the consumers. */
  | { type: 'freshness'; lte: number }
  /** Sustainable records/s before something saturates. */
  | { type: 'throughput'; gte: number }
  | { type: 'exactlyOnce' }
  | { type: 'noLoss' }
  | { type: 'lateData' }
  | { type: 'backfill'; level: 'log' | 'full' }
  | { type: 'schemaSafe' }
  | { type: 'quality' }
  | { type: 'lineage' }
  | { type: 'noSpof' }
  | { type: 'noOltpLoad' }
  | { type: 'queryP99'; lte: number }
  | { type: 'cost'; lte: number }
  /** The design survives this chaos event with one of the allowed outcomes (default absorbed/delayed). */
  | { type: 'chaos'; id: ChaosId; allow?: OutcomeKey[] }
  /** Killing one instance of this kind doesn't lose or corrupt data. */
  | { type: 'survives'; kind: ComponentKind }
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
  /** Volume multiplier for this step. */
  traffic?: number;
  /** Chaos event shown during this step. */
  chaos?: ChaosId;
  predict?: Predict;
}

export interface QuizQ {
  id: string;
  q: string;
  options: string[];
  answer: number;
  why: string;
}

export type PatternGroup = 'Batch' | 'Lakehouse' | 'Streaming' | 'Serving' | 'Trust' | 'Interview';

export interface Pattern {
  id: string;
  num: number;
  title: string;
  group: PatternGroup;
  tagline: string;
  minutes: number;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  /** Interview / on-the-job cues that should make you reach for this pattern. */
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
  /** Deep-dive links to sibling modules. */
  deeper?: { label: string; to: string }[];
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
