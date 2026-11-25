import type { Tone } from '../engine/types';

/** Tailwind classes for HTML cells by tone. */
export const cellTone: Record<Tone, string> = {
  active: 'border-accent bg-accent/15 text-ink',
  good: 'border-ok bg-ok/15 text-ink',
  bad: 'border-bad bg-bad/15 text-ink',
  warn: 'border-warn bg-warn/15 text-ink',
  info: 'border-info bg-info/15 text-ink',
  muted: 'border-line/60 bg-transparent text-faint opacity-50',
};

export const cellDefault = 'border-line bg-surface text-ink';

/** CSS colour for SVG strokes/fills by tone. */
export const toneVar: Record<Tone, string> = {
  active: 'var(--c-accent)',
  good: 'var(--c-ok)',
  bad: 'var(--c-bad)',
  warn: 'var(--c-warn)',
  info: 'var(--c-info)',
  muted: 'var(--c-faint)',
};

export const rgb = (v: string, a = 1) => (a === 1 ? `rgb(${v})` : `rgb(${v} / ${a})`);

type PtrTone = 'info' | 'violet' | 'accent' | 'ok' | 'warn' | 'bad';

const named: Record<string, PtrTone> = {
  i: 'info', l: 'info', left: 'info', lo: 'info', low: 'info', slow: 'info', prev: 'info', start: 'info', p1: 'info', a: 'info', top: 'info',
  j: 'violet', r: 'violet', right: 'violet', hi: 'violet', high: 'violet', fast: 'violet', nxt: 'violet', next: 'violet', end: 'violet', p2: 'violet', b: 'violet', bottom: 'violet',
  m: 'accent', mid: 'accent', curr: 'accent', cur: 'accent', node: 'accent', k: 'accent', n: 'accent', x: 'accent',
};

/** Stable colour per pointer name so `l` is always blue, `r` always violet, etc. */
export function pointerTone(name: string): PtrTone {
  if (named[name]) return named[name];
  const pool: PtrTone[] = ['ok', 'warn', 'info', 'violet', 'accent'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

export const pointerVar: Record<PtrTone, string> = {
  info: 'var(--c-info)',
  violet: 'var(--c-violet)',
  accent: 'var(--c-accent)',
  ok: 'var(--c-ok)',
  warn: 'var(--c-warn)',
  bad: 'var(--c-bad)',
};

export const pointerText: Record<PtrTone, string> = {
  info: 'text-info',
  violet: 'text-violet',
  accent: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
};
