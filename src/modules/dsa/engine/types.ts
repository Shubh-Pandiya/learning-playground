// Core types for the DSA playground: problems, patterns, trace frames and visualizations.

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export type CategoryId =
  | 'arrays-hashing'
  | 'two-pointers'
  | 'sliding-window'
  | 'stack'
  | 'binary-search'
  | 'linked-list'
  | 'trees'
  | 'tries'
  | 'heap'
  | 'backtracking'
  | 'graphs'
  | 'advanced-graphs'
  | 'dp-1d'
  | 'dp-2d'
  | 'greedy'
  | 'intervals'
  | 'math-geometry'
  | 'bit-manipulation';

export type PatternId =
  | 'hashing'
  | 'prefix-sum'
  | 'two-pointers'
  | 'sliding-window'
  | 'stack'
  | 'monotonic-stack'
  | 'binary-search'
  | 'linked-list'
  | 'fast-slow'
  | 'tree-dfs'
  | 'tree-bfs'
  | 'bst'
  | 'trie'
  | 'heap'
  | 'backtracking'
  | 'graph-traversal'
  | 'topo-sort'
  | 'union-find'
  | 'weighted-graph'
  | 'dp-1d'
  | 'dp-2d'
  | 'greedy'
  | 'intervals'
  | 'matrix'
  | 'math'
  | 'bits'
  | 'design';

/** Semantic colour of a cell / node / edge in a visualization. */
export type Tone = 'active' | 'good' | 'bad' | 'muted' | 'warn' | 'info';

// ---------------------------------------------------------------------------
// Visualizations (plain JSON so frames can be cloned & stored cheaply)
// ---------------------------------------------------------------------------

interface VizBase {
  /** Heading shown above the structure, e.g. "nums" or "count (num → freq)". */
  name: string;
  caption?: string;
}

export interface ArrayViz extends VizBase {
  kind: 'array';
  values: string[];
  /** pointer name → index (may be -1 or values.length to show "outside") */
  pointers: Record<string, number>;
  tones: Record<number, Tone>;
  /** inclusive [l, r] window shading */
  window: [number, number] | null;
  showIndex: boolean;
}

export interface MapViz extends VizBase {
  kind: 'map';
  entries: [string, string][];
  tones: Record<string, Tone>;
}

export interface SetViz extends VizBase {
  kind: 'set';
  items: string[];
  tones: Record<string, Tone>;
}

export interface StackViz extends VizBase {
  kind: 'stack';
  items: string[];
  tones: Record<number, Tone>;
  /** 'stack' renders vertically (top at top), 'queue' renders horizontally front→back */
  mode: 'stack' | 'queue';
}

export interface ListNodeViz {
  id: string;
  label: string;
  next: string | null;
  random?: string | null;
}

export interface ListViz extends VizBase {
  kind: 'list';
  nodes: ListNodeViz[];
  pointers: Record<string, string | null>;
  tones: Record<string, Tone>;
}

export interface TreeNodeViz {
  id: string;
  label: string;
  /** For binary trees: [left, right] (nulls keep the side). For n-ary trees: children ids. */
  children: (string | null)[];
  /** Optional label on the edge from parent to this node (used by tries). */
  edge?: string;
}

export interface TreeViz extends VizBase {
  kind: 'tree';
  root: string | null;
  nodes: TreeNodeViz[];
  binary: boolean;
  pointers: Record<string, string | null>;
  tones: Record<string, Tone>;
  /** small badge text per node id (e.g. height, count) */
  badges: Record<string, string>;
}

export interface GraphViz extends VizBase {
  kind: 'graph';
  nodes: { id: string; label: string; x?: number; y?: number }[];
  edges: { from: string; to: string; label?: string; tone?: Tone }[];
  directed: boolean;
  tones: Record<string, Tone>;
  badges: Record<string, string>;
}

export interface GridViz extends VizBase {
  kind: 'grid';
  cells: string[][];
  rowLabels?: string[];
  colLabels?: string[];
  /** key "r,c" */
  tones: Record<string, Tone>;
  /** pointer name → [r, c] */
  pointers: Record<string, [number, number]>;
}

export interface HeapViz extends VizBase {
  kind: 'heap';
  values: string[];
  tones: Record<number, Tone>;
}

export interface IntervalsViz extends VizBase {
  kind: 'intervals';
  items: { start: number; end: number; label?: string; tone?: Tone }[];
  /** vertical sweep line position */
  marker: number | null;
}

export interface BitsViz extends VizBase {
  kind: 'bits';
  width: number;
  rows: { label: string; value: number; tones: Record<number, Tone> }[];
}

export interface DecisionViz extends VizBase {
  kind: 'decision';
  nodes: { id: string; parent: string | null; label: string; tone?: Tone }[];
  current: string | null;
}

export interface ChipsViz extends VizBase {
  kind: 'chips';
  items: string[];
  tones: Record<number, Tone>;
}

export interface TextViz extends VizBase {
  kind: 'text';
  text: string;
  /** highlight character indices */
  tones: Record<number, Tone>;
}

export type Viz =
  | ArrayViz
  | MapViz
  | SetViz
  | StackViz
  | ListViz
  | TreeViz
  | GraphViz
  | GridViz
  | HeapViz
  | IntervalsViz
  | BitsViz
  | DecisionViz
  | ChipsViz
  | TextViz;

// ---------------------------------------------------------------------------
// Trace frames
// ---------------------------------------------------------------------------

export interface Prediction {
  question: string;
  options: string[];
  answer: number;
  why: string;
}

export interface Frame {
  /** key of the highlighted code line (see `@key` markers in Problem.code) */
  line: string | null;
  /** one-sentence narration of what just happened / is about to happen */
  note: string;
  /** watch panel: variable name → formatted value */
  vars: Record<string, string>;
  viz: Viz[];
  /** optional "predict what happens next" question asked before moving past this frame */
  predict?: Prediction;
}

export interface TraceResult {
  frames: Frame[];
  result: string | null;
  truncated: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Problems & patterns
// ---------------------------------------------------------------------------

export interface Distractor {
  /** Code text including leading indentation (4 spaces per level). */
  text: string;
  /** Why this block is wrong — shown as targeted feedback in the builder. */
  why: string;
}

export interface BackendUse {
  /** short headline, e.g. "Top abusive IPs for rate limiting" */
  title: string;
  /** 1–3 sentences describing the real backend scenario and how the pattern maps onto it */
  detail: string;
}

export interface Problem<I = any> {
  /** slug, e.g. "two-sum" */
  id: string;
  /** LeetCode problem number */
  num: number;
  title: string;
  difficulty: Difficulty;
  category: CategoryId;
  pattern: PatternId;
  /** Problem summary in our own words (do not copy LeetCode text). */
  statement: string;
  /** Recognition cues: phrases/constraints in the statement that should trigger this pattern. */
  signals: string[];
  /** The "aha" in one or two sentences. */
  insight: string;
  /** Progressive hints, least → most revealing. */
  hints: string[];
  /** The most common bug / wrong turn on this problem. */
  pitfall: string;
  backend: BackendUse;
  complexity: { time: string; space: string };
  /**
   * Python-flavoured solution. Each line may end with `@key` (preceded by whitespace) so the tracer
   * can highlight it, e.g. `    for i, n in enumerate(nums):   @loop`.
   * Indent with 4 spaces.
   */
  code: string;
  /** Optional per-line explanation (by line key) shown in worked-example mode and builder feedback. */
  explain?: Record<string, string>;
  /** Plausible-but-wrong blocks for the drag-and-drop builder. */
  distractors: Distractor[];
  /** Default editable input (JSON-serialisable object of named arguments). */
  input: I;
  /** Extra sample inputs (edge cases) the learner can switch to. */
  presets?: { label: string; input: I }[];
  /** Return an error message for invalid / too-large input, or null. */
  validate?: (input: I) => string | null;
  /** Runs the real algorithm on `input`, emitting frames through the tracer; returns the answer. */
  trace: (t: import('./tracer.ts').Tracer, input: I) => unknown;
}

export interface Variant {
  /** unique slug */
  id: string;
  title: string;
  /** A NEW problem (not on the NeetCode list) phrased like an interview question. */
  statement: string;
  pattern: PatternId;
  /** Which NeetCode problem it is closest to (problem id). */
  nearest: string;
  /** The signals that should have pointed at the pattern. */
  signals: string[];
  /** Short solution sketch. */
  approach: string;
  /** Where this shows up in backend engineering. */
  backend: string;
}

export interface Pattern {
  id: PatternId;
  name: string;
  /** one-line hook */
  tagline: string;
  /** plain-language mental model / analogy */
  intuition: string;
  /** When you read these in a problem, think of this pattern */
  signals: string[];
  /** Generic Python-flavoured template */
  template: string;
  /** What stays true on every iteration */
  invariants: string[];
  mistakes: string[];
  complexity: string;
  backend: BackendUse[];
  /** Questions that prompt the learner to explain the pattern in their own words. */
  selfExplain: string[];
  /** Generic wrong blocks for this pattern, mixed into the builder. */
  distractors: Distractor[];
}

export interface Category {
  id: CategoryId;
  name: string;
  /** order in the NeetCode roadmap */
  order: number;
  blurb: string;
}

export interface CodeLine {
  text: string;
  key: string | null;
  indent: number;
  index: number;
}
