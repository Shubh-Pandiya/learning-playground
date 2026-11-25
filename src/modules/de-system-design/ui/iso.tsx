import {
  Archive,
  BarChart3,
  Box,
  Boxes,
  Braces,
  BrainCircuit,
  Clock,
  Cloud,
  Combine,
  Copy,
  Database,
  Download,
  EyeOff,
  FileCheck2,
  FileStack,
  FileWarning,
  Files,
  Gauge,
  GitCompare,
  KeyRound,
  Layers,
  Library,
  ListPlus,
  MemoryStick,
  Plug,
  ScanSearch,
  ScrollText,
  Search,
  Send,
  Server,
  ShieldCheck,
  Shuffle,
  Smartphone,
  Sparkles,
  Timer,
  Warehouse,
  Waves,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { COMPONENTS } from '../data/components';
import type { ComponentKind, Shape, Tone } from '../types';

const ICONS: Record<string, LucideIcon> = {
  Archive,
  BarChart3,
  Box,
  Boxes,
  Braces,
  BrainCircuit,
  Clock,
  Cloud,
  Combine,
  Copy,
  Database,
  Download,
  EyeOff,
  FileCheck2,
  FileStack,
  FileWarning,
  Files,
  Gauge,
  GitCompare,
  KeyRound,
  Layers,
  Library,
  ListPlus,
  MemoryStick,
  Plug,
  ScanSearch,
  ScrollText,
  Search,
  Send,
  Server,
  ShieldCheck,
  Shuffle,
  Smartphone,
  Sparkles,
  Timer,
  Warehouse,
  Waves,
  Workflow,
  Zap,
};

export const iconFor = (kind: ComponentKind): LucideIcon => ICONS[COMPONENTS[kind].icon] ?? Box;

/** top / left / right face fills + outline, per component tone. Muted so they sit well on paper and dark. */
const TONES: Record<Tone, [string, string, string, string]> = {
  green: ['#b9dcb0', '#8fbf86', '#6fa266', '#3f6b39'],
  blue: ['#b7cfe8', '#8eb0d6', '#6f93bd', '#36557a'],
  violet: ['#d1c3ea', '#ad99d6', '#8e78bf', '#4f3f7a'],
  orange: ['#f3c9a2', '#e3a571', '#c98650', '#7a4a22'],
  rose: ['#f0bcbc', '#dc9191', '#c07272', '#7a3434'],
  teal: ['#acdcd5', '#7fc0b7', '#5fa29a', '#2d635c'],
  sand: ['#eadcc0', '#d6c29c', '#bba57c', '#6e5c3a'],
  slate: ['#cfd3d8', '#aab0b8', '#8c939c', '#4a5058'],
  yellow: ['#f2e2a0', '#e0c970', '#c4ad52', '#6e5e1c'],
};

const C = 0.866;

interface Box3 {
  a: number;
  b: number;
  h: number;
}

const SHAPES: Record<Shape, Box3 | 'cyl'> = {
  block: { a: 24, b: 24, h: 18 },
  hex: { a: 24, b: 24, h: 12 },
  shield: { a: 26, b: 26, h: 8 },
  cloud: { a: 28, b: 28, h: 7 },
  users: { a: 26, b: 26, h: 6 },
  pipe: { a: 40, b: 15, h: 13 },
  cylinder: 'cyl',
};

const pts = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** Isometric glyph: a shaded 3D block / cylinder / pipe with the component icon projected onto its top face. */
export function IsoGlyph({ kind, size = 64, dim = false }: { kind: ComponentKind; size?: number; dim?: boolean }) {
  const def = COMPONENTS[kind];
  const Icon = iconFor(kind);
  const [top, left, right, stroke] = TONES[def.tone];
  const shape = SHAPES[def.shape];
  const W = 64;
  const H = 58;
  const style = dim ? { filter: 'grayscale(1)', opacity: 0.55 } : undefined;

  if (shape === 'cyl') {
    const cx = 32,
      rx = 22,
      ry = 10,
      y0 = 14,
      h = 26;
    return (
      <svg width={size} height={(size * H) / W} viewBox={`0 0 ${W} ${H}`} style={style} aria-hidden>
        <path d={`M${cx - rx},${y0} v${h} a${rx},${ry} 0 0 0 ${2 * rx},0 v${-h}`} fill={left} stroke={stroke} strokeWidth={1} />
        <path d={`M${cx},${y0 + ry} v${h}`} stroke={stroke} strokeOpacity={0.15} />
        <path d={`M${cx - rx},${y0 + 9} a${rx},${ry} 0 0 0 ${2 * rx},0`} fill="none" stroke={stroke} strokeOpacity={0.35} />
        <path d={`M${cx - rx},${y0 + 18} a${rx},${ry} 0 0 0 ${2 * rx},0`} fill="none" stroke={stroke} strokeOpacity={0.35} />
        <ellipse cx={cx} cy={y0} rx={rx} ry={ry} fill={top} stroke={stroke} strokeWidth={1} />
        <g transform={`matrix(0.62,0,0,0.3,${cx - 7.4},${y0 - 3.6})`}>
          <Icon width={24} height={24} color={stroke} strokeWidth={2.2} />
        </g>
      </svg>
    );
  }

  const { a, b, h } = shape;
  const tx = b * C + (W - (a + b) * C) / 2;
  const ty = (H - ((a + b) * 0.5 + h)) / 2;
  const T: [number, number] = [tx, ty];
  const Rv: [number, number] = [T[0] + a * C, T[1] + a * 0.5];
  const Lv: [number, number] = [T[0] - b * C, T[1] + b * 0.5];
  const B: [number, number] = [T[0] + a * C - b * C, T[1] + a * 0.5 + b * 0.5];
  const dn = ([x, y]: [number, number]): [number, number] => [x, y + h];
  const inset = 0.18;
  const ia = a * (1 - 2 * inset);
  const ib = b * (1 - 2 * inset);
  const s = Math.min(ia, ib);
  // map the 24×24 icon box onto the top face (u → right edge, v → left edge)
  const ox = T[0] + a * inset * C - b * inset * C + ((ia - s) / 2) * C - ((ib - s) / 2) * C;
  const oy = T[1] + a * inset * 0.5 + b * inset * 0.5 + ((ia - s) / 2) * 0.5 + ((ib - s) / 2) * 0.5;
  const k = s / 24;
  const m = `matrix(${C * k},${0.5 * k},${-C * k},${0.5 * k},${ox},${oy})`;
  const stripes = def.shape === 'pipe' ? [0.25, 0.5, 0.75] : [];

  return (
    <svg width={size} height={(size * H) / W} viewBox={`0 0 ${W} ${H}`} style={style} aria-hidden>
      <polygon points={pts([Lv, B, dn(B), dn(Lv)])} fill={left} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
      <polygon points={pts([B, Rv, dn(Rv), dn(B)])} fill={right} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
      {stripes.map((f) => {
        const p1: [number, number] = [B[0] + (Rv[0] - B[0]) * f, B[1] + (Rv[1] - B[1]) * f];
        return <line key={f} x1={p1[0]} y1={p1[1] + 2} x2={p1[0]} y2={p1[1] + h - 2} stroke={stroke} strokeOpacity={0.45} />;
      })}
      {def.shape === 'block' && (
        <g stroke={stroke} strokeOpacity={0.35}>
          <line x1={Lv[0]} y1={Lv[1] + h / 2} x2={B[0]} y2={B[1] + h / 2} />
          <line x1={B[0]} y1={B[1] + h / 2} x2={Rv[0]} y2={Rv[1] + h / 2} />
        </g>
      )}
      <polygon points={pts([T, Rv, B, Lv])} fill={top} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
      <g transform={m}>
        <Icon width={24} height={24} color={stroke} strokeWidth={2.2} />
      </g>
    </svg>
  );
}
