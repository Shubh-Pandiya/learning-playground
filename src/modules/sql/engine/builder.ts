/** Turns builder slots (drag-and-drop blocks) into SQL. Shared by the UI and the validator. */
import type { BuildSpec, SlotId, TrapBlock } from '../types';

export const SLOTS: SlotId[] = ['select', 'from', 'join', 'where', 'groupBy', 'having', 'orderBy', 'limit'];

export const SLOT_LABEL: Record<SlotId, string> = {
  select: 'SELECT',
  from: 'FROM',
  join: 'JOIN',
  where: 'WHERE',
  groupBy: 'GROUP BY',
  having: 'HAVING',
  orderBy: 'ORDER BY',
  limit: 'LIMIT',
};

/** Logical evaluation order of the slots (what the builder teaches next to the written order). */
export const SLOT_EVAL_ORDER: SlotId[] = ['from', 'join', 'where', 'groupBy', 'having', 'select', 'orderBy', 'limit'];

export const MAIN = '__main';
export const scopeOf = (b: { scope?: string }) => b.scope ?? MAIN;
export const slotKey = (scope: string, slot: SlotId) => `${scope}:${slot}`;

/** Placed blocks: slotKey → ordered SQL fragments. */
export type Placement = Record<string, string[]>;

function selectSql(p: Placement, scope: string): string | null {
  const g = (slot: SlotId) => p[slotKey(scope, slot)] ?? [];
  const sel = g('select');
  const from = g('from');
  if (!sel.length || !from.length) return null;
  const lines = [`SELECT ${sel.join(',\n       ')}`, `FROM ${from.join(', ')}`];
  for (const j of g('join')) lines.push(j);
  if (g('where').length) lines.push(`WHERE ${g('where').join('\n  AND ')}`);
  if (g('groupBy').length) lines.push(`GROUP BY ${g('groupBy').join(', ')}`);
  if (g('having').length) lines.push(`HAVING ${g('having').join('\n   AND ')}`);
  if (g('orderBy').length) lines.push(`ORDER BY ${g('orderBy').join(', ')}`);
  if (g('limit').length) lines.push(`LIMIT ${g('limit')[g('limit').length - 1]}`);
  return lines.join('\n');
}

/** Assemble SQL; returns null while a scope is missing SELECT or FROM. */
export function assembleSql(spec: BuildSpec, p: Placement): string | null {
  const defs: string[] = [];
  if (spec.given) defs.push(spec.given.trim());
  for (const name of spec.ctes ?? []) {
    const body = selectSql(p, name);
    if (!body) return null;
    defs.push(`${name} AS (\n${body.replace(/^/gm, '  ')}\n)`);
  }
  const main = selectSql(p, MAIN);
  if (!main) return null;
  if (!defs.length) return main;
  return `WITH ${spec.recursive ? 'RECURSIVE ' : ''}${defs.join(',\n')}\n${main}`;
}

/** The reference placement (all correct blocks in authored order). */
export function correctPlacement(spec: BuildSpec): Placement {
  const p: Placement = {};
  for (const b of spec.blocks) (p[slotKey(scopeOf(b), b.slot)] ??= []).push(b.sql);
  return p;
}

/** Reference placement with one trap swapped in (or added). */
export function placementWithTrap(spec: BuildSpec, trap: TrapBlock): Placement {
  const p = correctPlacement(spec);
  const key = slotKey(scopeOf(trap), trap.slot);
  const list = [...(p[key] ?? [])];
  const at = trap.replaces ? list.indexOf(trap.replaces) : -1;
  if (at >= 0) list[at] = trap.sql;
  else list.push(trap.sql);
  p[key] = list;
  return p;
}

export const blockId = (i: number, kind: 'b' | 't') => `${kind}${i}`;
