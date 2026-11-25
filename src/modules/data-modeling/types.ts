/**
 * Data-modelling playground domain model.
 *
 * A scenario is described by *logical attributes* and the *functional dependencies* between them.
 * A user's schema places those attributes into tables. The engine (engine/analyze.ts) derives
 * everything else from that: keys, relationships (from foreign keys), normal forms, anomalies,
 * join paths per access pattern, rows touched per write, storage and duplication.
 */

export type AttrType = 'id' | 'text' | 'int' | 'money' | 'date' | 'ts' | 'bool' | 'enum' | 'json' | 'array' | 'hash';

export interface Attr {
  id: string;
  /** Column name shown in tables (defaults to id). */
  name?: string;
  type: AttrType;
  /** Bytes per value (defaults by type). */
  bytes?: number;
  /** Numeric measure additivity (facts). */
  measure?: 'additive' | 'semi' | 'non';
  /** Repeating group / list in one column: a 1NF violation in a relational table. */
  multi?: boolean;
  /** Surrogate/hash keys, load timestamps, SCD bookkeeping. Explained, not normalised. */
  technical?: boolean;
  /** One-line meaning shown in tooltips. */
  doc?: string;
}

/** lhs → rhs. */
export interface FD {
  lhs: string[];
  rhs: string[];
}

/** How many distinct values a key (set of attributes) has. Drives row counts. */
export interface Grain {
  key: string[];
  rows: number;
  /** Plural noun, e.g. "customers". */
  label: string;
}

export type TableKind =
  | 'entity'
  | 'bridge'
  | 'lookup'
  | 'flat'
  | 'fact'
  | 'snapshot'
  | 'factless'
  | 'dim'
  | 'junk'
  | 'obt'
  | 'aggregate'
  | 'hub'
  | 'link'
  | 'sat'
  | 'event'
  | 'feed';

export interface Column {
  attr: string;
  pk?: boolean;
  indexed?: boolean;
}

export interface TableTemplate {
  id: string;
  name: string;
  kind: TableKind;
  columns: Column[];
  /** One-line "what this is" for the palette tooltip. */
  blurb: string;
  /** A plausible wrong choice in this scenario. */
  trap?: boolean;
}

export interface DTable {
  id: string;
  /** Template it was created from (used for scoring and notes). */
  tpl: string;
  name: string;
  kind: TableKind;
  columns: Column[];
  x: number;
  y: number;
}

export interface Schema {
  tables: DTable[];
}

export interface ReadPattern {
  id: string;
  kind: 'read';
  name: string;
  /** Attributes the query returns or groups by. */
  attrs: string[];
  /** Lookup / filter attributes (WHERE). Used for index-seek vs scan. */
  by?: string[];
  /** Measures summed by the query (aggregation correctness checks). */
  sums?: string[];
  /** The sum runs across time (semi-additive measures must not be summed). */
  overTime?: boolean;
  /** Calls per second (relative importance). */
  perSec: number;
  /** Joins at or under this are "good" for this workload. */
  maxJoins: number;
}

export interface WritePattern {
  id: string;
  kind: 'write';
  name: string;
  /** Attributes changed. */
  changes: string[];
  /** The key the change is about (one customer, one product…). */
  by: string[];
  perSec: number;
}

export type AccessPattern = ReadPattern | WritePattern;

export type Paradigm = 'oltp' | 'olap' | 'vault';

/** Scenario-specific verdict and explanation for a palette table. */
export interface TplNote {
  verdict: 'good' | 'wrong' | 'meh';
  title: string;
  body: string;
  tradeoffs?: string[];
  instead?: string;
}

export interface Requirement {
  id: string;
  text: string;
  check: (ctx: ReqContext) => boolean;
  /** Fading hints: nudge → stronger → exact action. */
  hints: [string, string, string];
}

/** What a requirement check can see. Built by engine/evaluate.ts. */
export interface ReqContext {
  schema: Schema;
  impact: import('./engine/analyze').Impact;
  has: (tpl: string) => boolean;
  table: (tpl: string) => DTable | undefined;
  /** Attribute is a column of the table created from tpl. */
  attrIn: (attr: string, tpl: string) => boolean;
  /** Read pattern is answerable within its join budget, with no correctness issues. */
  readOk: (patternId: string) => boolean;
  /** Write pattern touches at most n rows per change. */
  writeAtMost: (patternId: string, n: number) => boolean;
  /** Table (by template) reaches at least this normal form (1..4, 4 = BCNF). */
  nfAtLeast: (tpl: string, nf: number) => boolean;
  /** Child table references parent (holds parent's full primary key). */
  refs: (childTpl: string, parentTpl: string) => boolean;
  /** No issue with this code is present. */
  noIssue: (code: IssueCode) => boolean;
  pkIs: (tpl: string, attrs: string[]) => boolean;
}

export type IssueCode =
  | 'no-pk'
  | 'pk-not-unique'
  | 'repeating-group'
  | 'partial-dep'
  | 'transitive-dep'
  | 'bcnf'
  | 'nm-in-fk'
  | 'no-join-path'
  | 'scan'
  | 'too-many-joins'
  | 'fan-trap'
  | 'coarse-measure'
  | 'non-additive-sum'
  | 'semi-additive-sum'
  | 'dim-attr-in-fact'
  | 'natural-key-fact'
  | 'duplicated'
  | 'write-amplification'
  | 'missing-attr'
  | 'orphan-table';

export interface Scenario {
  id: string;
  title: string;
  /** Short story with **bold** and `code` markup. */
  context: string;
  paradigm: Paradigm;
  attrs: Attr[];
  fds: FD[];
  grains: Grain[];
  /** Palette: correct parts and plausible traps. */
  templates: TableTemplate[];
  /** Templates on the canvas at the start (e.g. a flat spreadsheet to normalise). */
  start?: string[];
  /** Default canvas positions by template id. */
  layout: Record<string, { x: number; y: number }>;
  /** Reference model: template ids, using their template columns. */
  reference: string[];
  patterns: AccessPattern[];
  requirements: Requirement[];
  notes: Record<string, TplNote>;
}

export type StepTag = 'problem' | 'technique' | 'tradeoff' | 'failure' | 'case' | 'recap';

export type Op =
  | { add: string }
  | { remove: string }
  | { move: string; from: string; to: string }
  | { copy: string; from?: string; to: string }
  | { drop: string; from: string }
  | { pk: string[]; on: string }
  | { index: string; on: string };

export interface Predict {
  question: string;
  options: string[];
  answer: number;
  explain: string;
}

export interface GuidedStep {
  title: string;
  tag: StepTag;
  body: string[];
  /** Applied cumulatively to the scenario's start schema. */
  ops?: Op[];
  predict?: Predict;
  keyIdea?: string;
  goodToKnow?: string;
  /** Highlight this access pattern's join path. */
  focus?: string;
}

export interface QuizItem {
  id: string;
  q: string;
  options: string[];
  answer: number;
  why: string;
  source?: string;
}

export type TopicGroup = 'Foundations' | 'Relational design' | 'Analytics (OLAP)' | 'Modern data platforms' | 'NoSQL & access patterns' | 'Operating models';

export type LabId = 'normalize' | 'scd' | 'nosql' | 'layout' | 'evolution' | 'review' | 'tenancy';

interface TopicBase {
  id: string;
  num: number;
  title: string;
  group: TopicGroup;
  level: 'core' | 'intermediate' | 'advanced';
  minutes: number;
  tagline: string;
  /** Interview cues that should trigger this technique. */
  signals: string[];
  /** "You'll be able to…" */
  learn: string[];
  realWorld: { who: string; how: string }[];
  quiz: QuizItem[];
}

export interface CanvasTopic extends TopicBase {
  kind: 'canvas';
  scenario: Scenario;
  challenge: Scenario;
  guided: GuidedStep[];
}

export interface LabTopic extends TopicBase {
  kind: 'lab';
  lab: LabId;
  /** Exercises inside the lab. The topic is mastered when all are done. */
  exercises: { id: string; title: string }[];
}

export type Topic = CanvasTopic | LabTopic;
