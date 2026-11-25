import { useId } from 'react';
import type { DecisionViz, GraphViz, HeapViz, ListViz, Tone, TreeViz } from '../engine/types';
import { pointerTone, pointerVar, rgb, toneVar } from './tones';
import { Empty } from './basic';

const T = 'transform 350ms cubic-bezier(.2,.8,.2,1), opacity 300ms';
const ink = rgb('var(--c-ink)');
const line = rgb('var(--c-line)');
const faint = rgb('var(--c-faint)');
const surface = rgb('var(--c-surface)');

function Arrowhead({ id, color }: { id: string; color: string }) {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill={color} />
    </marker>
  );
}

function nodeColors(tone?: Tone) {
  if (!tone) return { fill: surface, stroke: rgb('var(--c-muted)'), text: ink, opacity: 1 };
  if (tone === 'muted') return { fill: surface, stroke: line, text: faint, opacity: 0.55 };
  return { fill: rgb(toneVar[tone], 0.18), stroke: rgb(toneVar[tone]), text: ink, opacity: 1 };
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function Svg({ w, h, minScale = 0.55, children }: { w: number; h: number; minScale?: number; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto pb-1">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        className="font-mono"
        style={{ maxWidth: '100%', minWidth: Math.min(w, w * minScale), height: 'auto' }}
      >
        {children}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linked list
// ---------------------------------------------------------------------------

export function ListView({ v }: { v: ListViz }) {
  const uid = useId().replace(/:/g, '');
  if (!v.nodes.length) {
    const ptrs = Object.entries(v.pointers).map(([k, id]) => `${k} → ${id ?? 'None'}`);
    return <Empty>empty list {ptrs.length ? `· ${ptrs.join(' · ')}` : ''}</Empty>;
  }
  const NW = 46;
  const NH = 32;
  const GAP = 34;
  const hasRandom = v.nodes.some((n) => n.random !== undefined);
  const top = 30 + (hasRandom ? 34 : 0);
  const idx = new Map(v.nodes.map((n, i) => [n.id, i]));
  const xOf = (i: number) => 16 + i * (NW + GAP);
  const cy = top + NH / 2;

  // pointers grouped by node
  const ptrs = new Map<string, string[]>();
  const nullPtrs: string[] = [];
  for (const [name, id] of Object.entries(v.pointers)) {
    if (id === null || !idx.has(id)) nullPtrs.push(name);
    else ptrs.set(id, [...(ptrs.get(id) ?? []), name]);
  }
  const maxStack = Math.max(0, ...[...ptrs.values()].map((p) => p.length));
  const W = xOf(v.nodes.length) + 40;
  const H = top + NH + 34 + maxStack * 14;

  return (
    <Svg w={W} h={H}>
      <defs>
        <Arrowhead id={`${uid}a`} color={rgb('var(--c-muted)')} />
        <Arrowhead id={`${uid}r`} color={rgb('var(--c-violet)')} />
      </defs>
      {v.nodes.map((n, i) => {
        if (n.next === null) {
          const x = xOf(i) + NW;
          return (
            <g key={`e${n.id}`} style={{ transition: T }}>
              <line x1={x} y1={cy} x2={x + 14} y2={cy} stroke={faint} strokeWidth={1.5} />
              <text x={x + 16} y={cy + 4} fontSize={10} fill={faint}>
                ∅
              </text>
            </g>
          );
        }
        const j = idx.get(n.next);
        if (j === undefined) return null;
        let d: string;
        if (j === i + 1) d = `M${xOf(i) + NW} ${cy} L${xOf(j) - 2} ${cy}`;
        else if (j === i - 1) d = `M${xOf(i)} ${cy + 8} L${xOf(j) + NW + 2} ${cy + 8}`;
        else {
          const x1 = xOf(i) + NW / 2;
          const x2 = xOf(j) + NW / 2;
          const dip = 26 + Math.abs(j - i) * 4;
          d = `M${x1} ${top + NH} C${x1} ${top + NH + dip}, ${x2} ${top + NH + dip}, ${x2} ${top + NH + 2}`;
        }
        return <path key={`e${n.id}`} d={d} fill="none" stroke={rgb('var(--c-muted)')} strokeWidth={1.5} markerEnd={`url(#${uid}a)`} />;
      })}
      {hasRandom &&
        v.nodes.map((n, i) => {
          if (!n.random || !idx.has(n.random)) return null;
          const j = idx.get(n.random)!;
          const x1 = xOf(i) + NW / 2;
          const x2 = xOf(j) + NW / 2 + (i === j ? 10 : 0);
          const lift = 18 + Math.abs(j - i) * 4;
          return (
            <path
              key={`r${n.id}`}
              d={`M${x1} ${top} C${x1} ${top - lift}, ${x2} ${top - lift}, ${x2} ${top - 2}`}
              fill="none"
              stroke={rgb('var(--c-violet)')}
              strokeDasharray="3 3"
              strokeWidth={1.2}
              markerEnd={`url(#${uid}r)`}
            />
          );
        })}
      {v.nodes.map((n, i) => {
        const c = nodeColors(v.tones[n.id]);
        return (
          <g key={n.id} style={{ transform: `translate(${xOf(i)}px, ${top}px)`, transition: T }} opacity={c.opacity}>
            <rect width={NW} height={NH} rx={6} fill={c.fill} stroke={c.stroke} strokeWidth={1.5} style={{ transition: 'all 300ms' }} />
            <text x={NW / 2} y={NH / 2 + 4} textAnchor="middle" fontSize={12} fill={c.text}>
              {truncate(n.label, 6)}
            </text>
          </g>
        );
      })}
      {[...ptrs.entries()].flatMap(([id, names]) =>
        names.map((name, k) => {
          const i = idx.get(id)!;
          const col = rgb(pointerVar[pointerTone(name)]);
          return (
            <g key={name} style={{ transform: `translate(${xOf(i) + NW / 2}px, ${top + NH + 12 + k * 14}px)`, transition: T }}>
              {k === 0 && <path d="M0 -10 L-4 -4 L4 -4 z" fill={col} />}
              <text y={6} textAnchor="middle" fontSize={11} fontWeight={700} fill={col}>
                {name}
              </text>
            </g>
          );
        }),
      )}
      {nullPtrs.length > 0 && (
        <text x={W - 6} y={14} textAnchor="end" fontSize={10} fill={faint}>
          {nullPtrs.join(', ')} → None
        </text>
      )}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Tree layout helpers
// ---------------------------------------------------------------------------

interface Placed {
  x: number;
  y: number;
}

/** Binary: x = in-order rank. N-ary: leaves get consecutive slots, parents centre over children. */
function layoutTree(root: string | null, kids: (id: string) => (string | null)[], binary: boolean) {
  const pos = new Map<string, Placed>();
  if (!root) return { pos, cols: 0, depth: 0 };
  let slot = 0;
  let depth = 0;
  const seen = new Set<string>();
  const visit = (id: string, d: number): number => {
    if (seen.has(id)) return pos.get(id)?.x ?? slot;
    seen.add(id);
    depth = Math.max(depth, d);
    const ch = kids(id);
    if (binary) {
      const [l, r] = ch;
      if (l) visit(l, d + 1);
      const x = slot++;
      pos.set(id, { x, y: d });
      if (r) visit(r, d + 1);
      return x;
    }
    const real = ch.filter((c): c is string => !!c);
    if (!real.length) {
      const x = slot++;
      pos.set(id, { x, y: d });
      return x;
    }
    const xs = real.map((c) => visit(c, d + 1));
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    pos.set(id, { x, y: d });
    return x;
  };
  visit(root, 0);
  return { pos, cols: slot, depth };
}

// ---------------------------------------------------------------------------
// Tree / Trie
// ---------------------------------------------------------------------------

export function TreeView({ v }: { v: TreeViz }) {
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  const { pos, cols, depth } = layoutTree(v.root, (id) => byId.get(id)?.children ?? [], v.binary);
  if (!v.root || !pos.size) {
    return <Empty>empty tree (None)</Empty>;
  }
  const R = 16;
  const DX = v.binary ? 40 : 38;
  const DY = 56;
  const ptrNames = new Map<string, string[]>();
  for (const [name, id] of Object.entries(v.pointers)) if (id && pos.has(id)) ptrNames.set(id, [...(ptrNames.get(id) ?? []), name]);
  const W = Math.max(120, cols * DX + 40);
  const H = (depth + 1) * DY + 30;
  const px = (p: Placed) => 20 + p.x * DX + DX / 2;
  const py = (p: Placed) => 28 + p.y * DY;

  return (
    <Svg w={W} h={H}>
      {[...pos.entries()].flatMap(([id, p]) =>
        (byId.get(id)?.children ?? []).map((c, k) => {
          if (!c || !pos.has(c)) return null;
          const q = pos.get(c)!;
          const childNode = byId.get(c);
          const ct = v.tones[c];
          const col = ct && ct !== 'muted' ? rgb(toneVar[ct]) : line;
          return (
            <g key={`${id}-${c}-${k}`}>
              <line x1={px(p)} y1={py(p)} x2={px(q)} y2={py(q)} stroke={col} strokeWidth={ct && ct !== 'muted' ? 2 : 1.5} style={{ transition: 'all 300ms' }} />
              {childNode?.edge && (
                <text
                  x={(px(p) + px(q)) / 2 + (px(q) >= px(p) ? 6 : -6)}
                  y={(py(p) + py(q)) / 2}
                  textAnchor={px(q) >= px(p) ? 'start' : 'end'}
                  fontSize={11}
                  fontWeight={700}
                  fill={rgb('var(--c-accent)')}
                >
                  {childNode.edge}
                </text>
              )}
            </g>
          );
        }),
      )}
      {[...pos.entries()].map(([id, p]) => {
        const n = byId.get(id)!;
        const c = nodeColors(v.tones[id]);
        const badge = v.badges[id];
        const names = ptrNames.get(id);
        return (
          <g key={id} style={{ transform: `translate(${px(p)}px, ${py(p)}px)`, transition: T }} opacity={c.opacity}>
            <circle r={R} fill={c.fill} stroke={c.stroke} strokeWidth={1.6} style={{ transition: 'all 300ms' }} />
            <text y={4} textAnchor="middle" fontSize={n.label.length > 3 ? 9 : 12} fill={c.text}>
              {truncate(n.label, 5)}
            </text>
            {badge && (
              <g transform={`translate(${R - 2}, ${-R + 2})`}>
                <rect x={-2} y={-9} width={badge.length * 6.5 + 6} height={13} rx={6} fill={rgb('var(--c-sunken)')} stroke={line} />
                <text x={1} y={1} fontSize={9} fill={rgb('var(--c-muted)')}>
                  {badge}
                </text>
              </g>
            )}
            {names && (
              <text y={-R - 5} textAnchor="middle" fontSize={10} fontWeight={700} fill={rgb(pointerVar[pointerTone(names[0])])}>
                {names.join(',')}
              </text>
            )}
          </g>
        );
      })}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Heap (array-backed binary tree + the array itself)
// ---------------------------------------------------------------------------

export function HeapView({ v }: { v: HeapViz }) {
  if (!v.values.length) return <Empty>empty heap</Empty>;
  const nodes = v.values.map((label, i) => {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    return { id: String(i), label, children: [l < v.values.length ? String(l) : null, r < v.values.length ? String(r) : null] };
  });
  const tones: Record<string, Tone> = {};
  for (const [k, t] of Object.entries(v.tones)) tones[k] = t;
  return (
    <div className="space-y-2">
      <TreeView v={{ kind: 'tree', name: v.name, root: '0', nodes, binary: true, pointers: {}, tones, badges: {} }} />
      <div className="flex flex-wrap gap-1 font-mono text-[11px]">
        {v.values.map((x, i) => (
          <span
            key={i}
            className="rounded border border-line px-1.5 py-0.5"
            style={v.tones[i] && v.tones[i] !== 'muted' ? { borderColor: rgb(toneVar[v.tones[i]]), background: rgb(toneVar[v.tones[i]], 0.15) } : undefined}
          >
            <span className="mr-1 text-faint">{i}</span>
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export function GraphView({ v }: { v: GraphViz }) {
  const uid = useId().replace(/:/g, '');
  if (!v.nodes.length) return <Empty>empty graph</Empty>;
  const W = 520;
  const H = v.nodes.length <= 4 ? 220 : 300;
  const pad = 32;
  const n = v.nodes.length;
  const pos = new Map<string, { x: number; y: number }>();
  const positioned = v.nodes.every((p) => p.x !== undefined && p.y !== undefined);
  v.nodes.forEach((p, i) => {
    if (positioned) pos.set(p.id, { x: pad + (p.x! / 100) * (W - 2 * pad), y: pad + (p.y! / 100) * (H - 2 * pad) });
    else {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      pos.set(p.id, { x: W / 2 + Math.cos(a) * (W / 2 - pad - 10), y: H / 2 + Math.sin(a) * (H / 2 - pad) });
    }
  });
  const R = 17;
  // undirected graphs often list both directions — draw each pair once
  const seen = new Set<string>();
  const edges = v.edges.filter((e) => {
    if (v.directed) return true;
    const k = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const pairCount = new Set(v.edges.map((e) => `${e.from}|${e.to}`));

  return (
    <Svg w={W} h={H}>
      <defs>
        <Arrowhead id={`${uid}g`} color={rgb('var(--c-muted)')} />
        {(['active', 'good', 'bad', 'warn', 'info', 'muted'] as Tone[]).map((t) => (
          <Arrowhead key={t} id={`${uid}${t}`} color={rgb(toneVar[t])} />
        ))}
      </defs>
      {edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const col = e.tone ? rgb(toneVar[e.tone]) : rgb('var(--c-muted)', 0.7);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // bend when the reverse edge also exists so both are visible
        const bend = v.directed && pairCount.has(`${e.to}|${e.from}`) ? 18 : 0;
        const x1 = a.x + ux * R;
        const y1 = a.y + uy * R;
        const x2 = b.x - ux * (R + 2);
        const y2 = b.y - uy * (R + 2);
        const mx = (x1 + x2) / 2 - uy * bend;
        const my = (y1 + y2) / 2 + ux * bend;
        if (e.from === e.to) return null;
        return (
          <g key={i} opacity={e.tone === 'muted' ? 0.4 : 1}>
            <path
              d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`}
              fill="none"
              stroke={col}
              strokeWidth={e.tone && e.tone !== 'muted' ? 2.4 : 1.4}
              markerEnd={v.directed ? `url(#${uid}${e.tone ?? 'g'})` : undefined}
              style={{ transition: 'stroke 300ms' }}
            />
            {e.label && (
              <g transform={`translate(${mx}, ${my})`}>
                <rect x={-e.label.length * 3.4 - 3} y={-8} width={e.label.length * 6.8 + 6} height={15} rx={4} fill={rgb('var(--c-paper)')} />
                <text y={4} textAnchor="middle" fontSize={10} fill={rgb('var(--c-muted)')}>
                  {e.label}
                </text>
              </g>
            )}
          </g>
        );
      })}
      {v.nodes.map((p) => {
        const q = pos.get(p.id)!;
        const c = nodeColors(v.tones[p.id]);
        const badge = v.badges[p.id];
        return (
          <g key={p.id} style={{ transform: `translate(${q.x}px, ${q.y}px)`, transition: T }} opacity={c.opacity}>
            <circle r={R} fill={c.fill} stroke={c.stroke} strokeWidth={1.6} style={{ transition: 'all 300ms' }} />
            <text y={4} textAnchor="middle" fontSize={p.label.length > 3 ? 9 : 12} fill={c.text}>
              {truncate(p.label, 6)}
            </text>
            {badge && (
              <text y={R + 13} textAnchor="middle" fontSize={10} fontWeight={600} fill={rgb('var(--c-accent)')}>
                {badge}
              </text>
            )}
          </g>
        );
      })}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Decision tree (backtracking recursion)
// ---------------------------------------------------------------------------

export function DecisionView({ v }: { v: DecisionViz }) {
  if (!v.nodes.length) return <Empty>no calls yet</Empty>;
  const kids = new Map<string, string[]>();
  let root: string | null = null;
  for (const n of v.nodes) {
    if (n.parent === null) root ??= n.id;
    else kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
  }
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  const { pos, cols, depth } = layoutTree(root, (id) => kids.get(id) ?? [], false);
  const maxLabel = Math.max(...v.nodes.map((n) => n.label.length));
  const DX = Math.min(90, Math.max(30, maxLabel * 6.4 + 10));
  const DY = 46;
  const W = Math.max(160, cols * DX + 20);
  const H = (depth + 1) * DY + 20;
  const px = (p: Placed) => 10 + p.x * DX + DX / 2;
  const py = (p: Placed) => 20 + p.y * DY;
  // path from root to current gets emphasised
  const onPath = new Set<string>();
  for (let c = v.current; c; c = byId.get(c)?.parent ?? null) onPath.add(c);

  return (
    <Svg w={W} h={H} minScale={0.4}>
      {[...pos.entries()].map(([id, p]) => {
        const parent = byId.get(id)?.parent;
        const q = parent ? pos.get(parent) : undefined;
        if (!q) return null;
        return (
          <line
            key={`e${id}`}
            x1={px(q)}
            y1={py(q) + 9}
            x2={px(p)}
            y2={py(p) - 9}
            stroke={onPath.has(id) ? rgb('var(--c-accent)') : line}
            strokeWidth={onPath.has(id) ? 2 : 1.2}
          />
        );
      })}
      {[...pos.entries()].map(([id, p]) => {
        const n = byId.get(id)!;
        const cur = id === v.current;
        const c = nodeColors(cur ? 'active' : n.tone);
        const w = Math.max(22, n.label.length * 6.4 + 10);
        return (
          <g key={id} style={{ transform: `translate(${px(p)}px, ${py(p)}px)`, transition: T }} opacity={c.opacity}>
            <rect x={-w / 2} y={-10} width={w} height={20} rx={5} fill={c.fill} stroke={c.stroke} strokeWidth={cur ? 2.4 : 1.2} />
            <text y={4} textAnchor="middle" fontSize={10} fill={c.text}>
              {n.label}
            </text>
          </g>
        );
      })}
    </Svg>
  );
}
