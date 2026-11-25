/**
 * A real (tiny) B+tree in TypeScript so the learner can watch how an index is designed:
 * search descends root → leaf, range scans walk the leaf chain, inserts split pages,
 * and composite keys show why only a leftmost prefix can seek.
 */
export type Key = number | [string, number];

export interface BNode {
  id: number;
  leaf: boolean;
  keys: Key[];
  children: BNode[];
  /** leaf: heap TID of each key ("page,slot") */
  tids: string[];
  next?: BNode;
}

export const cmp = (a: Key, b: Key): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const [a1, a2] = a as [string, number];
  const [b1, b2] = b as [string, number];
  return a1 < b1 ? -1 : a1 > b1 ? 1 : a2 - b2;
};
export const fmtKey = (k: Key) => (typeof k === 'number' ? String(k) : `${k[0]}·${k[1]}`);

export interface InsertEvent {
  kind: 'place' | 'split-leaf' | 'split-internal' | 'new-root';
  text: string;
  nodes: number[];
}

export class BPlusTree {
  root: BNode;
  private seq = 0;
  constructor(public maxKeys: number) {
    this.root = this.node(true);
  }
  private node(leaf: boolean): BNode {
    return { id: ++this.seq, leaf, keys: [], children: [], tids: [] };
  }

  insert(k: Key, tid: string, events?: InsertEvent[]) {
    const path: BNode[] = [];
    let n = this.root;
    while (!n.leaf) {
      path.push(n);
      let i = 0;
      while (i < n.keys.length && cmp(k, n.keys[i]) >= 0) i++;
      n = n.children[i];
    }
    let i = 0;
    while (i < n.keys.length && cmp(n.keys[i], k) <= 0) i++;
    n.keys.splice(i, 0, k);
    n.tids.splice(i, 0, tid);
    events?.push({ kind: 'place', text: `Descend to leaf page #${n.id} and insert ${fmtKey(k)} in sorted position ${i + 1}.`, nodes: [...path.map((p) => p.id), n.id] });
    if (n.keys.length <= this.maxKeys) return;

    // split leaf: right half moves to a new page, its first key is copied up
    const right = this.node(true);
    const mid = Math.ceil(n.keys.length / 2);
    right.keys = n.keys.splice(mid);
    right.tids = n.tids.splice(mid);
    right.next = n.next;
    n.next = right;
    let up: Key = right.keys[0];
    let newChild: BNode = right;
    events?.push({ kind: 'split-leaf', text: `Leaf #${n.id} overflowed (${this.maxKeys + 1} > ${this.maxKeys} keys) → split: keys ≥ ${fmtKey(up)} move to new leaf #${right.id}; ${fmtKey(up)} is copied up as a separator and the leaf chain is relinked.`, nodes: [n.id, right.id] });

    let child = n;
    while (true) {
      const parent = path.pop();
      if (!parent) {
        const r = this.node(false);
        r.keys = [up];
        r.children = [child, newChild];
        this.root = r;
        events?.push({ kind: 'new-root', text: `The root split, so a new root #${r.id} is created — the tree grows one level taller (always at the top, so every leaf stays at the same depth).`, nodes: [r.id] });
        return;
      }
      const at = parent.children.indexOf(child);
      parent.keys.splice(at, 0, up);
      parent.children.splice(at + 1, 0, newChild);
      if (parent.keys.length <= this.maxKeys) {
        events?.push({ kind: 'place', text: `Separator ${fmtKey(up)} inserted into internal page #${parent.id}.`, nodes: [parent.id] });
        return;
      }
      const r = this.node(false);
      const m = Math.floor(parent.keys.length / 2);
      const pushed = parent.keys[m];
      r.keys = parent.keys.splice(m + 1);
      parent.keys.splice(m, 1);
      r.children = parent.children.splice(m + 1);
      events?.push({ kind: 'split-internal', text: `Internal page #${parent.id} overflowed → split into #${parent.id} and #${r.id}; ${fmtKey(pushed)} moves up (internal splits move the key, leaf splits copy it).`, nodes: [parent.id, r.id] });
      up = pushed;
      newChild = r;
      child = parent;
    }
  }

  height(): number {
    let h = 1;
    let n = this.root;
    while (!n.leaf) {
      n = n.children[0];
      h++;
    }
    return h;
  }

  leaves(): BNode[] {
    let n = this.root;
    while (!n.leaf) n = n.children[0];
    const out: BNode[] = [];
    for (let x: BNode | undefined = n; x; x = x.next) out.push(x);
    return out;
  }

  levels(): BNode[][] {
    const out: BNode[][] = [];
    let cur = [this.root];
    while (cur.length) {
      out.push(cur);
      cur = cur.flatMap((n) => n.children);
    }
    return out;
  }
}

export function buildTree(keys: Key[], maxKeys: number, rowsPerHeapPage = 4) {
  const t = new BPlusTree(maxKeys);
  keys.forEach((k, i) => t.insert(k, `${Math.floor(i / rowsPerHeapPage)},${(i % rowsPerHeapPage) + 1}`));
  return t;
}

/* ------------------------------------------------------------------ traces */

export interface Frame {
  /** node id → indexes of keys to highlight */
  hl: Record<number, number[]>;
  visited: number[];
  current: number;
  text: string;
  pagesRead: number;
  heapPages: string[];
  matches: number;
}

const descend = (t: BPlusTree, k: Key, frames: Frame[], visited: number[]): BNode => {
  let n = t.root;
  while (!n.leaf) {
    let i = 0;
    while (i < n.keys.length && cmp(k, n.keys[i]) >= 0) i++;
    visited.push(n.id);
    const lo = i > 0 ? `≥ ${fmtKey(n.keys[i - 1])}` : '';
    const hi = i < n.keys.length ? `< ${fmtKey(n.keys[i])}` : '';
    frames.push({
      hl: { [n.id]: [i - 1, i].filter((x) => x >= 0 && x < n.keys.length) },
      visited: [...visited],
      current: n.id,
      text: `Page #${n.id} (${n === t.root ? 'root' : 'internal'}): binary-search the separators — ${fmtKey(k)} is ${[lo, hi].filter(Boolean).join(' and ')} → follow child ${i + 1} of ${n.children.length}.`,
      pagesRead: visited.length,
      heapPages: [],
      matches: 0,
    });
    n = n.children[i];
  }
  return n;
};

/** Seek to the first key ≥ lo (lo ≤ hi), then walk right along the leaf chain until > hi. */
export function traceRange(t: BPlusTree, lo: Key, hi: Key, match: (k: Key) => boolean = (k) => cmp(k, lo) >= 0 && cmp(k, hi) <= 0): Frame[] {
  const frames: Frame[] = [];
  const visited: number[] = [];
  let leaf: BNode | undefined = descend(t, lo, frames, visited);
  const heap = new Set<string>();
  let matches = 0;
  const point = cmp(lo, hi) === 0;
  while (leaf) {
    visited.push(leaf.id);
    const idx = leaf.keys.map((k, i) => (match(k) ? i : -1)).filter((i) => i >= 0);
    idx.forEach((i) => heap.add(leaf!.tids[i].split(',')[0]));
    matches += idx.length;
    const past = leaf.keys.length > 0 && cmp(leaf.keys[leaf.keys.length - 1], hi) > 0;
    frames.push({
      hl: { [leaf.id]: idx },
      visited: [...visited],
      current: leaf.id,
      text: idx.length
        ? `Leaf #${leaf.id}: ${idx.map((i) => fmtKey(leaf!.keys[i])).join(', ')} match → their TIDs point at heap page${idx.length > 1 ? 's' : ''} ${[...new Set(idx.map((i) => leaf!.tids[i].split(',')[0]))].join(', ')}.${past ? ' A key here is past the end of the range → stop.' : point ? '' : ' Keys may continue → follow the right-sibling link.'}`
        : `Leaf #${leaf.id}: no matching keys${past ? ' and we are past the range → stop.' : ' → follow the sibling link.'}`,
      pagesRead: visited.length,
      heapPages: [...heap],
      matches,
    });
    if (past || (point && idx.length && !leaf.next)) break;
    if (point && leaf.keys.some((k) => cmp(k, hi) > 0)) break;
    leaf = leaf.next;
  }
  return frames;
}

/** No usable leading column: the only option is reading every leaf (or the whole table). */
export function traceFullScan(t: BPlusTree, match: (k: Key) => boolean, why: string): Frame[] {
  const frames: Frame[] = [];
  const visited: number[] = [];
  const heap = new Set<string>();
  let matches = 0;
  t.leaves().forEach((leaf, n) => {
    visited.push(leaf.id);
    const idx = leaf.keys.map((k, i) => (match(k) ? i : -1)).filter((i) => i >= 0);
    idx.forEach((i) => heap.add(leaf.tids[i].split(',')[0]));
    matches += idx.length;
    frames.push({
      hl: { [leaf.id]: idx },
      visited: [...visited],
      current: leaf.id,
      text: `${n === 0 ? why + ' ' : ''}Leaf #${leaf.id}: ${idx.length ? `${idx.map((i) => fmtKey(leaf.keys[i])).join(', ')} match` : 'nothing here'} — matches are scattered, so every leaf must be read.`,
      pagesRead: visited.length,
      heapPages: [...heap],
      matches,
    });
  });
  return frames;
}

/** Levels needed for N rows at a given fan-out (keys per 8 KB page). */
export const levelsFor = (rows: number, fanout: number) => Math.max(1, Math.ceil(Math.log(Math.max(2, rows)) / Math.log(fanout)));
