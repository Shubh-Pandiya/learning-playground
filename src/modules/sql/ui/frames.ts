/** Which rows feed a window function's value for a given row (for the hover highlight). */
import type { Cell } from '../engine/core';
import type { PipelineStage } from '../engine/pipeline';

export interface FrameInfo {
  rows: Set<number>;
  /** row(s) referenced directly (LAG/LEAD target) */
  target?: number;
  label: string;
}

type Bound = { kind: 'unbounded-pre' | 'pre' | 'current' | 'fol' | 'unbounded-fol'; n: number };

function parseBound(s: string): Bound {
  const t = s.trim().toUpperCase();
  if (t.startsWith('UNBOUNDED PRECEDING')) return { kind: 'unbounded-pre', n: 0 };
  if (t.startsWith('UNBOUNDED FOLLOWING')) return { kind: 'unbounded-fol', n: 0 };
  if (t.startsWith('CURRENT ROW')) return { kind: 'current', n: 0 };
  const m = /^(.+?)\s+(PRECEDING|FOLLOWING)/.exec(t);
  const n = m ? Number(m[1].replace(/^INTERVAL\s+'?|'$/g, '')) : 0;
  return { kind: m?.[2] === 'FOLLOWING' ? 'fol' : 'pre', n: Number.isFinite(n) ? n : 0 };
}

const eq = (a: Cell[], b: Cell[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function frameFor(stage: PipelineStage, i: number): FrameInfo | null {
  const w = stage.window;
  const gids = stage.groupIds;
  if (!w || !gids) return null;
  const part: number[] = [];
  gids.forEach((g, k) => g === gids[i] && part.push(k));
  const pos = part.indexOf(i);
  const spec = w.spec;
  const peersOf = (k: number) => part.filter((x) => eq(w.orderVals[x], w.orderVals[k]));

  if (/^(LAG|LEAD)$/.test(spec.fn)) {
    const off = Number(spec.args[1] ?? 1) || 1;
    const t = part[pos + (spec.fn === 'LAG' ? -off : off)];
    return { rows: new Set(t === undefined ? [] : [t]), target: t, label: t === undefined ? `${spec.fn} has no row ${off} ${spec.fn === 'LAG' ? 'back' : 'ahead'} in this partition → NULL / default` : `${spec.fn} reads the row ${off} ${spec.fn === 'LAG' ? 'before' : 'after'} it in the partition` };
  }
  if (/^(ROW_NUMBER|RANK|DENSE_RANK|NTILE|PERCENT_RANK|CUME_DIST)$/.test(spec.fn)) {
    const peers = spec.orderBy.length ? peersOf(i) : part;
    return { rows: new Set(peers.length > 1 ? peers : part), label: peers.length > 1 ? `${peers.length} peers tie on the ORDER BY key — ${spec.fn === 'ROW_NUMBER' ? 'ROW_NUMBER breaks the tie arbitrarily' : `${spec.fn} gives them the same rank`}` : `rank is position ${pos + 1} within its partition of ${part.length}` };
  }
  if (!spec.orderBy.length && !spec.frame) return { rows: new Set(part), label: `no ORDER BY in OVER(): every row sees the whole partition (${part.length} rows)` };

  let mode = 'RANGE';
  let start: Bound = { kind: 'unbounded-pre', n: 0 };
  let end: Bound = { kind: 'current', n: 0 };
  if (spec.frame) {
    const m = /^(ROWS|RANGE|GROUPS)\s+(?:BETWEEN\s+(.+?)\s+AND\s+(.+?)|(.+?))(\s+EXCLUDE.*)?$/i.exec(spec.frame.trim());
    if (m) {
      mode = m[1].toUpperCase();
      if (m[2]) {
        start = parseBound(m[2]);
        end = parseBound(m[3]);
      } else start = parseBound(m[4]);
    }
  }
  const out = new Set<number>();
  if (mode === 'ROWS') {
    const lo = start.kind === 'unbounded-pre' ? 0 : start.kind === 'pre' ? pos - start.n : start.kind === 'current' ? pos : start.kind === 'fol' ? pos + start.n : part.length;
    const hi = end.kind === 'unbounded-fol' ? part.length - 1 : end.kind === 'fol' ? pos + end.n : end.kind === 'current' ? pos : end.kind === 'pre' ? pos - end.n : -1;
    for (let k = Math.max(0, lo); k <= Math.min(part.length - 1, hi); k++) out.add(part[k]);
    return { rows: out, label: `ROWS frame: ${out.size} physical row${out.size === 1 ? '' : 's'} around the current one` };
  }
  // RANGE / GROUPS — peers of the current row are always included with CURRENT ROW
  const peerIdx = (k: number) => {
    let g = 0;
    for (let x = 1; x <= k; x++) if (!eq(w.orderVals[part[x]], w.orderVals[part[x - 1]])) g++;
    return g;
  };
  const myG = peerIdx(pos);
  const val = (k: number) => Number(w.orderVals[part[k]]?.[0]);
  const desc = w.desc[0];
  part.forEach((row, k) => {
    const g = peerIdx(k);
    const inStart = (() => {
      if (start.kind === 'unbounded-pre') return true;
      if (start.kind === 'current') return mode === 'GROUPS' ? g >= myG : g >= myG;
      if (mode === 'GROUPS') return start.kind === 'pre' ? g >= myG - start.n : g >= myG + start.n;
      const d = desc ? val(pos) - val(k) : val(k) - val(pos);
      return start.kind === 'pre' ? d >= -start.n : d >= start.n;
    })();
    const inEnd = (() => {
      if (end.kind === 'unbounded-fol') return true;
      if (end.kind === 'current') return g <= myG;
      if (mode === 'GROUPS') return end.kind === 'fol' ? g <= myG + end.n : g <= myG - end.n;
      const d = desc ? val(pos) - val(k) : val(k) - val(pos);
      return end.kind === 'fol' ? d <= end.n : d <= -end.n;
    })();
    if (inStart && inEnd) out.add(row);
  });
  const peers = peersOf(i).length;
  return {
    rows: out,
    label: `${spec.frame ? `${mode} frame` : 'default RANGE frame (UNBOUNDED PRECEDING → CURRENT ROW)'}: ${out.size} row${out.size === 1 ? '' : 's'}${peers > 1 ? ` — includes ${peers - 1} tied peer${peers > 2 ? 's' : ''}` : ''}`,
  };
}
