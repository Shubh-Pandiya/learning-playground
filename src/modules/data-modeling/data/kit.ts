/** Compact builders for scenario content. */
import type { Attr, AttrType, Column, FD, Grain, ReadPattern, TableKind, TableTemplate, WritePattern } from '../types';

export const at = (id: string, type: AttrType, extra: Partial<Attr> = {}): Attr => ({ id, type, ...extra });

const list = (x: string | string[]) => (Array.isArray(x) ? x : x.split(/[\s,]+/).filter(Boolean));

/** fd('order_id', 'order_date customer_id') */
export const fd = (lhs: string | string[], rhs: string | string[]): FD => ({ lhs: list(lhs), rhs: list(rhs) });

export const grain = (key: string | string[], rows: number, label: string): Grain => ({ key: list(key), rows, label });

/** Column spec: `order_id*` = primary key, `customer_id^` = indexed. */
export function cols(spec: string): Column[] {
  return list(spec).map((s) => {
    const pk = s.includes('*');
    const indexed = s.includes('^');
    return { attr: s.replace(/[*^]/g, ''), ...(pk ? { pk } : {}), ...(indexed ? { indexed } : {}) };
  });
}

export const tpl = (id: string, name: string, kind: TableKind, spec: string, blurb: string, trap?: boolean): TableTemplate => ({
  id,
  name,
  kind,
  columns: cols(spec),
  blurb,
  ...(trap ? { trap } : {}),
});

export const read = (
  id: string,
  name: string,
  attrs: string,
  o: { by?: string; sums?: string; overTime?: boolean; perSec: number; maxJoins: number },
): ReadPattern => ({
  id,
  kind: 'read',
  name,
  attrs: list(attrs),
  ...(o.by ? { by: list(o.by) } : {}),
  ...(o.sums ? { sums: list(o.sums) } : {}),
  ...(o.overTime ? { overTime: true } : {}),
  perSec: o.perSec,
  maxJoins: o.maxJoins,
});

export const write = (id: string, name: string, changes: string, by: string, perSec: number): WritePattern => ({
  id,
  kind: 'write',
  name,
  changes: list(changes),
  by: list(by),
  perSec,
});
