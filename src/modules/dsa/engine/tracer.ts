// The tracer runs a real JS implementation of an algorithm and records a frame at each
// interesting point: which code line is "executing", a narration, a variable watch, and a
// snapshot of every data structure (via the draw function).

import type {
  CodeLine,
  DecisionViz,
  Frame,
  Lang,
  Prediction,
  Problem,
  Tone,
  TraceResult,
  TreeNodeViz,
  Viz,
} from './types.ts';

export const MAX_FRAMES = 600;

export class TraceLimitError extends Error {
  constructor() {
    super(`Stopped after ${MAX_FRAMES} steps — try a smaller input.`);
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

// Literal spelling for the learner's chosen language (set by runTrace for the duration of a trace).
let display: Lang = 'python';
const NULL_WORD: Record<Lang, string> = { python: 'None', java: 'null', cpp: 'nullptr' };

/** Format any value for display (Python-style by default). Strings are NOT quoted (use `fmtq` for that). */
export function fmt(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return NULL_WORD[display];
  if (typeof v === 'boolean') return display === 'python' ? (v ? 'True' : 'False') : v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (v === Infinity) return '∞';
    if (v === -Infinity) return '-∞';
    if (Number.isNaN(v)) return 'NaN';
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  }
  if (typeof v === 'string') return v;
  if (depth > 3) return '…';
  if (v instanceof ListNode || v instanceof TreeNode) return `Node(${fmt(v.val, depth + 1)})`;
  if (Array.isArray(v)) {
    const shown = v.slice(0, 40).map((x) => fmtq(x, depth + 1));
    return `[${shown.join(', ')}${v.length > 40 ? ', …' : ''}]`;
  }
  if (v instanceof Map) {
    const parts = [...v.entries()].slice(0, 30).map(([k, x]) => `${fmtq(k, depth + 1)}: ${fmtq(x, depth + 1)}`);
    return `{${parts.join(', ')}${v.size > 30 ? ', …' : ''}}`;
  }
  if (v instanceof Set) {
    if (v.size === 0) return display === 'python' ? 'set()' : '{}';
    const parts = [...v].slice(0, 30).map((x) => fmtq(x, depth + 1));
    return `{${parts.join(', ')}${v.size > 30 ? ', …' : ''}}`;
  }
  if (typeof v === 'object') {
    const parts = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${fmtq(x, depth + 1)}`);
    return `{${parts.join(', ')}}`;
  }
  return String(v);
}

/** Like fmt, but strings are quoted — used for the variable watch panel and nested values. */
export function fmtq(v: unknown, depth = 0): string {
  return typeof v === 'string' ? (display === 'python' ? `'${v}'` : `"${v}"`) : fmt(v, depth);
}

// ---------------------------------------------------------------------------
// Data-structure helpers that tracers can use directly
// ---------------------------------------------------------------------------

let uid = 0;
const nextId = (p: string) => `${p}${++uid}`;

export class ListNode<T = number> {
  id: string;
  val: T;
  next: ListNode<T> | null = null;
  random: ListNode<T> | null = null;
  constructor(val: T, next: ListNode<T> | null = null) {
    this.id = nextId('l');
    this.val = val;
    this.next = next;
  }
}

/** Build a linked list; returns the head and the nodes in order. */
export function buildList<T>(values: readonly T[]): { head: ListNode<T> | null; nodes: ListNode<T>[] } {
  const nodes = values.map((v) => new ListNode<T>(v));
  nodes.forEach((n, i) => (n.next = nodes[i + 1] ?? null));
  return { head: nodes[0] ?? null, nodes };
}

/** Collect values by following .next (stops on cycles). */
export function listValues<T>(head: ListNode<T> | null): T[] {
  const out: T[] = [];
  const seen = new Set<ListNode<T>>();
  for (let n = head; n && !seen.has(n); n = n.next) {
    seen.add(n);
    out.push(n.val);
  }
  return out;
}

export class TreeNode<T = number> {
  id: string;
  val: T;
  left: TreeNode<T> | null;
  right: TreeNode<T> | null;
  constructor(val: T, left: TreeNode<T> | null = null, right: TreeNode<T> | null = null) {
    this.id = nextId('t');
    this.val = val;
    this.left = left;
    this.right = right;
  }
}

/** Build a binary tree from LeetCode level-order array, e.g. [3,9,20,null,null,15,7]. */
export function buildTree<T>(arr: readonly (T | null)[]): TreeNode<T> | null {
  if (!arr.length || arr[0] === null || arr[0] === undefined) return null;
  const root = new TreeNode<T>(arr[0] as T);
  const q: TreeNode<T>[] = [root];
  let i = 1;
  while (q.length && i < arr.length) {
    const node = q.shift()!;
    const l = arr[i++];
    if (l !== null && l !== undefined) {
      node.left = new TreeNode<T>(l);
      q.push(node.left);
    }
    if (i >= arr.length) break;
    const r = arr[i++];
    if (r !== null && r !== undefined) {
      node.right = new TreeNode<T>(r);
      q.push(node.right);
    }
  }
  return root;
}

/** Serialize a tree back to LeetCode level-order (trailing nulls trimmed). */
export function treeToArray<T>(root: TreeNode<T> | null): (T | null)[] {
  const out: (T | null)[] = [];
  const q: (TreeNode<T> | null)[] = [root];
  while (q.length) {
    const n = q.shift()!;
    if (!n) {
      out.push(null);
      continue;
    }
    out.push(n.val);
    q.push(n.left, n.right);
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

export function findNode<T>(root: TreeNode<T> | null, val: T): TreeNode<T> | null {
  if (!root) return null;
  if (root.val === val) return root;
  return findNode(root.left, val) ?? findNode(root.right, val);
}

export class TrieNode {
  id: string;
  children = new Map<string, TrieNode>();
  end = false;
  word: string | null = null;
  constructor() {
    this.id = nextId('r');
  }
}

/** Binary heap. `less(a, b)` true when a should be closer to the top (min-heap by default). */
export class Heap<T> {
  data: T[] = [];
  private less: (a: T, b: T) => boolean;
  constructor(less: (a: T, b: T) => boolean = (a, b) => (a as any) < (b as any)) {
    this.less = less;
  }
  get size() {
    return this.data.length;
  }
  peek(): T | undefined {
    return this.data[0];
  }
  push(v: T) {
    const d = this.data;
    d.push(v);
    let i = d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(d[i], d[p])) break;
      [d[i], d[p]] = [d[p], d[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    const d = this.data;
    if (!d.length) return undefined;
    const top = d[0];
    const last = d.pop()!;
    if (d.length) {
      d[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < d.length && this.less(d[l], d[m])) m = l;
        if (r < d.length && this.less(d[r], d[m])) m = r;
        if (m === i) break;
        [d[i], d[m]] = [d[m], d[i]];
        i = m;
      }
    }
    return top;
  }
}

/** Incrementally builds a recursion / decision tree for backtracking visualizations. */
export class DecisionTree {
  nodes: DecisionViz['nodes'] = [];
  current: string | null = null;
  private n = 0;
  static readonly MAX = 160;
  /** Add a node; returns its id (or the parent id if the tree is full). */
  add(parent: string | null, label: string, tone?: Tone): string {
    if (this.nodes.length >= DecisionTree.MAX) return parent ?? 'root';
    const id = `d${++this.n}`;
    this.nodes.push({ id, parent, label, tone });
    return id;
  }
  tone(id: string | null, tone: Tone | undefined) {
    const node = this.nodes.find((x) => x.id === id);
    if (node) node.tone = tone;
  }
  /** Re-label an existing node */
  label(id: string | null, label: string) {
    const node = this.nodes.find((x) => x.id === id);
    if (node) node.label = label;
  }
}

// ---------------------------------------------------------------------------
// Visualization builders — call inside the draw function
// ---------------------------------------------------------------------------

type Ptrs<T> = Record<string, T | null | undefined>;

const cleanNum = (p: Ptrs<number> = {}) => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
};

/** Build a tone record from a list of keys. */
export function tones<K extends string | number>(keys: readonly K[], tone: Tone): Record<K, Tone> {
  const out = {} as Record<K, Tone>;
  for (const k of keys) out[k] = tone;
  return out;
}

/** Grid cell key helper */
export const rc = (r: number, c: number) => `${r},${c}`;

export const V = {
  array(
    name: string,
    values: readonly unknown[],
    o: {
      pointers?: Ptrs<number>;
      tones?: Record<number, Tone>;
      window?: [number, number] | null;
      caption?: string;
      showIndex?: boolean;
    } = {},
  ): Viz {
    return {
      kind: 'array',
      name,
      values: values.map((x) => fmt(x)),
      pointers: cleanNum(o.pointers),
      tones: { ...(o.tones ?? {}) },
      window: o.window && o.window[0] <= o.window[1] ? [o.window[0], o.window[1]] : null,
      showIndex: o.showIndex ?? true,
      caption: o.caption,
    };
  },

  /** Hash map. `hl` = raw keys to highlight (tone 'active'); `tones` keyed by formatted key. */
  map(
    name: string,
    m: Map<unknown, unknown> | Record<string, unknown> | readonly (readonly [unknown, unknown])[],
    o: { hl?: readonly unknown[]; tones?: Record<string, Tone>; caption?: string } = {},
  ): Viz {
    const entries: [unknown, unknown][] =
      m instanceof Map ? [...m.entries()] : Array.isArray(m) ? m.map(([a, b]) => [a, b]) : Object.entries(m);
    const t: Record<string, Tone> = { ...(o.tones ?? {}) };
    for (const k of o.hl ?? []) t[fmt(k)] = t[fmt(k)] ?? 'active';
    return { kind: 'map', name, entries: entries.map(([k, v]) => [fmt(k), fmt(v)]), tones: t, caption: o.caption };
  },

  set(
    name: string,
    s: Set<unknown> | readonly unknown[],
    o: { hl?: readonly unknown[]; tones?: Record<string, Tone>; caption?: string } = {},
  ): Viz {
    const t: Record<string, Tone> = { ...(o.tones ?? {}) };
    for (const k of o.hl ?? []) t[fmt(k)] = t[fmt(k)] ?? 'active';
    return { kind: 'set', name, items: [...s].map((x) => fmt(x)), tones: t, caption: o.caption };
  },

  /** Stack (bottom → top order in `items`) or queue (front → back) */
  stack(
    name: string,
    items: readonly unknown[],
    o: { tones?: Record<number, Tone>; mode?: 'stack' | 'queue'; caption?: string } = {},
  ): Viz {
    return {
      kind: 'stack',
      name,
      items: items.map((x) => fmt(x)),
      tones: { ...(o.tones ?? {}) },
      mode: o.mode ?? 'stack',
      caption: o.caption,
    };
  },

  queue(name: string, items: readonly unknown[], o: { tones?: Record<number, Tone>; caption?: string } = {}): Viz {
    return V.stack(name, items, { ...o, mode: 'queue' });
  },

  /**
   * Linked list. Pass every node you want drawn (in display order) — arrows follow each node's
   * current `.next`, so reversals and cycles render correctly. Pointers map a label to a node.
   */
  list(
    name: string,
    nodes: readonly (ListNode<any> | null | undefined)[],
    o: { pointers?: Ptrs<ListNode<any>>; tones?: Record<string, Tone>; caption?: string; showRandom?: boolean } = {},
  ): Viz {
    const real = nodes.filter((n): n is ListNode<any> => !!n);
    const ptrs: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(o.pointers ?? {})) ptrs[k] = v ? v.id : null;
    return {
      kind: 'list',
      name,
      nodes: real.map((n) => ({
        id: n.id,
        label: fmt(n.val),
        next: n.next ? n.next.id : null,
        random: o.showRandom ? (n.random ? n.random.id : null) : undefined,
      })),
      pointers: ptrs,
      tones: { ...(o.tones ?? {}) },
      caption: o.caption,
    };
  },

  /** Convenience: draw the list reachable from head (stops at cycles). */
  listFrom(
    name: string,
    head: ListNode<any> | null,
    o: { pointers?: Ptrs<ListNode<any>>; tones?: Record<string, Tone>; caption?: string } = {},
  ): Viz {
    const nodes: ListNode<any>[] = [];
    const seen = new Set<ListNode<any>>();
    for (let n = head; n && !seen.has(n); n = n.next) {
      seen.add(n);
      nodes.push(n);
    }
    return V.list(name, nodes, o);
  },

  /** Binary tree. tones / badges keyed by TreeNode.id */
  tree(
    name: string,
    root: TreeNode<any> | null,
    o: {
      pointers?: Ptrs<TreeNode<any>>;
      tones?: Record<string, Tone>;
      badges?: Record<string, string>;
      caption?: string;
    } = {},
  ): Viz {
    const nodes: TreeNodeViz[] = [];
    const walk = (n: TreeNode<any> | null, d: number) => {
      if (!n || d > 12) return;
      nodes.push({ id: n.id, label: fmt(n.val), children: [n.left?.id ?? null, n.right?.id ?? null] });
      walk(n.left, d + 1);
      walk(n.right, d + 1);
    };
    walk(root, 0);
    const ptrs: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(o.pointers ?? {})) ptrs[k] = v ? v.id : null;
    return {
      kind: 'tree',
      name,
      root: root?.id ?? null,
      nodes,
      binary: true,
      pointers: ptrs,
      tones: { ...(o.tones ?? {}) },
      badges: { ...(o.badges ?? {}) },
      caption: o.caption,
    };
  },

  /** Trie (n-ary tree). Word-end nodes get a ✓ badge and 'good' tone unless overridden. */
  trie(
    name: string,
    root: TrieNode,
    o: { pointers?: Ptrs<TrieNode>; tones?: Record<string, Tone>; caption?: string } = {},
  ): Viz {
    const nodes: TreeNodeViz[] = [];
    const t: Record<string, Tone> = {};
    const badges: Record<string, string> = {};
    const walk = (n: TrieNode, label: string) => {
      const kids = [...n.children.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
      nodes.push({ id: n.id, label, children: kids.map(([, c]) => c.id), edge: label });
      if (n.end) {
        t[n.id] = 'good';
        badges[n.id] = '✓';
      }
      for (const [ch, c] of kids) walk(c, ch);
    };
    walk(root, '•');
    const ptrs: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(o.pointers ?? {})) ptrs[k] = v ? v.id : null;
    return {
      kind: 'tree',
      name,
      root: root.id,
      nodes,
      binary: false,
      pointers: ptrs,
      tones: { ...t, ...(o.tones ?? {}) },
      badges,
      caption: o.caption,
    };
  },

  /**
   * Graph. Nodes are raw ids (numbers or strings). Edges are [from, to, label?].
   * tones / badges keyed by formatted node id; edgeTones keyed "from->to".
   * positions: optional fixed layout in a 0..100 coordinate space.
   */
  graph(
    name: string,
    nodes: readonly unknown[],
    edges: readonly (readonly [unknown, unknown, unknown?])[],
    o: {
      directed?: boolean;
      tones?: Record<string, Tone>;
      edgeTones?: Record<string, Tone>;
      badges?: Record<string, string>;
      positions?: Record<string, [number, number]>;
      labels?: Record<string, string>;
      caption?: string;
    } = {},
  ): Viz {
    const et = o.edgeTones ?? {};
    return {
      kind: 'graph',
      name,
      nodes: nodes.map((n) => {
        const id = fmt(n);
        const p = o.positions?.[id];
        return { id, label: o.labels?.[id] ?? id, x: p?.[0], y: p?.[1] };
      }),
      edges: edges.map(([a, b, w]) => {
        const from = fmt(a);
        const to = fmt(b);
        return {
          from,
          to,
          label: w === undefined || w === null ? undefined : fmt(w),
          tone: et[`${from}->${to}`] ?? (o.directed ? undefined : et[`${to}->${from}`]),
        };
      }),
      directed: !!o.directed,
      tones: { ...(o.tones ?? {}) },
      badges: { ...(o.badges ?? {}) },
      caption: o.caption,
    };
  },

  /** 2-D grid / matrix / DP table. tones keyed rc(r,c). */
  grid(
    name: string,
    cells: readonly (readonly unknown[])[],
    o: {
      tones?: Record<string, Tone>;
      pointers?: Ptrs<[number, number]>;
      rowLabels?: readonly unknown[];
      colLabels?: readonly unknown[];
      caption?: string;
    } = {},
  ): Viz {
    const ptrs: Record<string, [number, number]> = {};
    for (const [k, v] of Object.entries(o.pointers ?? {})) if (v) ptrs[k] = [v[0], v[1]];
    return {
      kind: 'grid',
      name,
      cells: cells.map((row) => row.map((x) => fmt(x))),
      rowLabels: o.rowLabels?.map((x) => fmt(x)),
      colLabels: o.colLabels?.map((x) => fmt(x)),
      tones: { ...(o.tones ?? {}) },
      pointers: ptrs,
      caption: o.caption,
    };
  },

  /** Heap drawn as both a tree and its backing array (index order). */
  heap(name: string, values: readonly unknown[], o: { tones?: Record<number, Tone>; caption?: string } = {}): Viz {
    return { kind: 'heap', name, values: values.map((x) => fmt(x)), tones: { ...(o.tones ?? {}) }, caption: o.caption };
  },

  intervals(
    name: string,
    items: readonly (readonly [number, number] | { start: number; end: number; label?: string; tone?: Tone })[],
    o: { tones?: Record<number, Tone>; marker?: number | null; caption?: string } = {},
  ): Viz {
    return {
      kind: 'intervals',
      name,
      items: items.map((it, i) => {
        const base = Array.isArray(it)
          ? { start: it[0] as number, end: it[1] as number }
          : { ...(it as { start: number; end: number; label?: string; tone?: Tone }) };
        return { ...base, tone: o.tones?.[i] ?? (base as { tone?: Tone }).tone };
      }),
      marker: o.marker ?? null,
      caption: o.caption,
    };
  },

  /** Binary rows. tones keyed by bit position (0 = least significant). */
  bits(
    name: string,
    rows: readonly { label: string; value: number; tones?: Record<number, Tone> }[],
    o: { width?: number; caption?: string } = {},
  ): Viz {
    return {
      kind: 'bits',
      name,
      width: o.width ?? 8,
      rows: rows.map((r) => ({ label: r.label, value: r.value, tones: { ...(r.tones ?? {}) } })),
      caption: o.caption,
    };
  },

  decision(name: string, tree: DecisionTree, o: { caption?: string } = {}): Viz {
    return {
      kind: 'decision',
      name,
      nodes: tree.nodes.map((n) => ({ ...n })),
      current: tree.current,
      caption: o.caption,
    };
  },

  chips(name: string, items: readonly unknown[], o: { tones?: Record<number, Tone>; caption?: string } = {}): Viz {
    return { kind: 'chips', name, items: items.map((x) => fmt(x)), tones: { ...(o.tones ?? {}) }, caption: o.caption };
  },

  text(name: string, text: string, o: { tones?: Record<number, Tone>; caption?: string } = {}): Viz {
    return { kind: 'text', name, text, tones: { ...(o.tones ?? {}) }, caption: o.caption };
  },
};

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

export class Tracer {
  frames: Frame[] = [];
  private drawFn: () => Viz[] = () => [];

  /** Register the function that snapshots all structures; called on every step. */
  draw(fn: () => (Viz | null | undefined | false)[]) {
    this.drawFn = () => fn().filter((v): v is Viz => !!v);
  }

  /**
   * Record a frame.
   * @param line key of the code line (the `@key` marker) or null
   * @param note narration — say what is happening and why, in plain words
   * @param vars variables for the watch panel (raw values; formatted automatically)
   */
  step(line: string | null, note: string, vars: Record<string, unknown> = {}) {
    if (this.frames.length >= MAX_FRAMES) throw new TraceLimitError();
    const v: Record<string, string> = {};
    for (const [k, x] of Object.entries(vars)) v[k] = fmtq(x);
    this.frames.push({ line, note, vars: v, viz: this.drawFn() });
  }

  /**
   * Attach a "predict before reveal" question to the most recent frame. The learner answers
   * before the next frame is shown. `answer` is the index into `options`.
   */
  predict(question: string, options: string[], answer: number, why: string) {
    const last = this.frames[this.frames.length - 1];
    if (!last || last.predict) return;
    const p: Prediction = { question, options, answer, why };
    last.predict = p;
  }
}

export function runTrace<I>(problem: Problem<I>, input: I, lang: Lang = 'python'): TraceResult {
  const err = problem.validate?.(input) ?? null;
  if (err) return { frames: [], result: null, truncated: false, error: err };
  const t = new Tracer();
  const prev = display;
  display = lang;
  try {
    const res = problem.trace(t, JSON.parse(JSON.stringify(input)) as I);
    return { frames: t.frames, result: res === undefined ? null : fmtq(res), truncated: false, error: null };
  } catch (e) {
    if (e instanceof TraceLimitError) return { frames: t.frames, result: null, truncated: true, error: null };
    return { frames: t.frames, result: null, truncated: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    display = prev;
  }
}

// ---------------------------------------------------------------------------
// Code parsing
// ---------------------------------------------------------------------------

const KEY_RE = /\s+@([A-Za-z][\w-]*)\s*$/;

/** Split a code block into lines, extracting trailing `@key` markers and dedenting. */
export function parseCode(code: string): CodeLine[] {
  const raw = code.replace(/\t/g, '    ').split('\n');
  while (raw.length && !raw[0].trim()) raw.shift();
  while (raw.length && !raw[raw.length - 1].trim()) raw.pop();
  const indents = raw.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
  const base = indents.length ? Math.min(...indents) : 0;
  return raw.map((l, index) => {
    const line = l.slice(base);
    const m = line.match(KEY_RE);
    const text = (m ? line.slice(0, m.index) : line).replace(/\s+$/, '');
    const indent = Math.floor((text.length - text.trimStart().length) / 4);
    return { text, key: m ? m[1] : null, indent, index };
  });
}
