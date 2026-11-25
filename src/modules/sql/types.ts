/**
 * Content model for the Advanced SQL playground.
 * Every concept is plain data; every SQL string in here runs for real against the
 * seeded Postgres (PGlite) database and is checked by `scripts/validate.ts`.
 */

export type TrackId = 'mechanics' | 'windows' | 'ctes' | 'analytics' | 'performance' | 'transactions';

export type Level = 'core' | 'intermediate' | 'advanced';

/** Which visualizer the concept's "Visualize" tab uses. */
export type VizKind =
  /** step through logical query processing (FROM → … → LIMIT) of `worked.sql` */
  | 'pipeline'
  /** pipeline + iteration-by-iteration view of a recursive CTE (`worked.recursiveLevel`) */
  | 'recursive'
  /** B+tree index lab (search / range / insert-split / composite order) + real EXPLAIN */
  | 'index'
  /** EXPLAIN plan explorer: run variants of a query and compare real plans */
  | 'plan'
  /** two-transaction MVCC / isolation simulator */
  | 'isolation';

/** Stages of logical query processing, in the order Postgres evaluates them. */
export type StageId = 'cte' | 'from' | 'join' | 'where' | 'group' | 'having' | 'window' | 'select' | 'distinct' | 'order' | 'limit';

export interface Prediction {
  /** Stage at which the prompt appears (the first stage of that type). */
  stage: StageId;
  question: string;
  /**
   * `rowcount`: the learner types a number; the answer is the stage's real output row count.
   * `choice`: multiple choice with `answer` = index into `options`.
   */
  kind: 'rowcount' | 'choice';
  options?: string[];
  answer?: number;
  /** Shown after answering: why the real outcome happened. */
  explain: string;
}

export interface Worked {
  /** The business question the query answers. */
  question: string;
  /** A single SELECT (optionally WITH …). Must parse into a pipeline for viz 'pipeline'/'recursive'. */
  sql: string;
  /** Narration per stage (adds to the auto-generated "what changed" text). */
  notes?: Partial<Record<StageId, string>>;
  predictions?: Prediction[];
  /** For 'recursive': name of the column holding the recursion depth in the recursive CTE. */
  recursiveLevel?: string;
  /** One-sentence lesson after stepping through. */
  takeaway: string;
}

export type SlotId = 'select' | 'from' | 'join' | 'where' | 'groupBy' | 'having' | 'orderBy' | 'limit';

export interface BuildBlock {
  /** CTE name the block belongs to, or omitted for the main query. */
  scope?: string;
  slot: SlotId;
  /** SQL fragment, e.g. `COUNT(*) AS orders`, `LEFT JOIN orders o ON o.user_id = u.id`, `o.status = 'paid'`. */
  sql: string;
  /** Why this block is needed (worked-example annotation). */
  why: string;
}

export interface TrapBlock {
  scope?: string;
  slot: SlotId;
  sql: string;
  /**
   * The correct block (exact `sql`) this trap is a tempting alternative to. When placed,
   * the validator checks the query with the trap *instead of* that block. Omit for additive traps.
   */
  replaces?: string;
  /** What goes wrong if you use it — shown the moment it's placed. */
  why: string;
}

export interface BuildSpec {
  /** Task shown above the skeleton. */
  prompt: string;
  /** Non-recursive CTEs built in the builder, in order (each gets its own skeleton). */
  ctes?: string[];
  /**
   * Fixed, already-written CTE definitions shown locked above the skeleton, without the WITH
   * keyword, e.g. `tree AS (SELECT … UNION ALL SELECT …)`. They come before the built CTEs.
   */
  given?: string;
  /** Emit `WITH RECURSIVE` (needed when `given` contains a recursive CTE). */
  recursive?: boolean;
  /** Correct blocks; their order within a slot is the order they are assembled in. */
  blocks: BuildBlock[];
  traps: TrapBlock[];
}

export type ExerciseKind = 'write' | 'fix-bug' | 'optimize';

export interface Exercise {
  id: string;
  kind: ExerciseKind;
  title: string;
  prompt: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  /** Pre-filled editor text (for fix-bug/optimize: the buggy / slow query). */
  starter?: string;
  /** Reference solution; the learner's result must equal this result. */
  solution: string;
  /** Compare row order too (default: only when the solution has a top-level ORDER BY). */
  orderMatters?: boolean;
  /** Statements run (inside the same rolled-back transaction) before both queries, e.g. CREATE INDEX. */
  setup?: string;
  /** 'optimize' only: requirements on the learner's EXPLAIN plan. */
  plan?: { mustNotContain?: string[]; mustContain?: string[]; maxCostRatio?: number };
  hints: string[];
  /** Shown after solving: why the reference works, tradeoffs, alternatives. */
  explanation: string;
}

export type JudgmentKind = 'spot-bug' | 'slow-query' | 'peer-review';

/** "Engineer judgment" drill: read a realistic query, find the problem, pick the fix, see the impact. */
export interface JudgmentItem {
  id: string;
  kind: JudgmentKind;
  title: string;
  /** Who wrote it and why (a PR description, a dashboard ticket…). */
  context: string;
  sql: string;
  /** 1-based line numbers of the problem in `sql` (learner clicks a line first). */
  bugLines: number[];
  /** Diagnosis options; exactly one `correct`. */
  options: { text: string; correct?: boolean; why: string }[];
  /** The fixed query; both run so the learner sees the concrete impact (result / plan diff). */
  fixedSql: string;
  /** Run EXPLAIN for both instead of only results (slow-query). */
  comparePlans?: boolean;
  setup?: string;
  lesson: string;
}

export interface RecallQ {
  q: string;
  a: string;
}

/** Unseen business scenario that needs this concept (recognition drill + transfer). */
export interface TransferItem {
  id: string;
  scenario: string;
  /** Approach sketch revealed after answering. */
  approach: string;
}

/** One query variant in the plan / index lab ("what if I add this index / rewrite it like this?"). */
export interface PlanVariant {
  label: string;
  sql: string;
  /** e.g. `CREATE INDEX … ; ANALYZE big_orders;` — runs in the same rolled-back transaction. */
  setup?: string;
  /** What changed versus the previous variant and its impact on the plan. */
  note: string;
}

/** Scenarios implemented by the isolation simulator (ui/isolation). */
export type IsolationScenarioId = 'dirty-read' | 'non-repeatable-read' | 'phantom' | 'lost-update' | 'lost-update-fixed' | 'write-skew' | 'deadlock';

export interface Concept {
  id: string;
  track: TrackId;
  title: string;
  tagline: string;
  level: Level;
  minutes: number;
  /** 1 = sometimes, 2 = common, 3 = asked in most DE / backend SQL rounds. */
  interview: 1 | 2 | 3;
  viz: VizKind;
  /** Short paragraphs. Supports `code` and **bold**. */
  intuition: string[];
  /** How the database actually implements it (executor nodes, data structures, costs). */
  internals: string[];
  /** Phrases in a question that should make you reach for this concept. */
  signals: string[];
  /** Canonical SQL shape. */
  template: string;
  realWorld: { title: string; body: string }[];
  mistakes: { title: string; why: string; fix: string }[];
  worked: Worked;
  build?: BuildSpec;
  /** viz 'plan' / 'index': variants compared side by side with real EXPLAIN (ANALYZE). */
  variants?: PlanVariant[];
  /** viz 'isolation': simulator scenarios to show, in order. */
  scenarios?: IsolationScenarioId[];
  exercises: Exercise[];
  judgment?: JudgmentItem[];
  recall: RecallQ[];
  transfer: TransferItem[];
  /** Concepts it is often confused with (used as drill distractors). */
  confusable: string[];
}

export interface Track {
  id: TrackId;
  name: string;
  blurb: string;
  order: number;
}
