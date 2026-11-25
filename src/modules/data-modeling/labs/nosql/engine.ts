import type { ChangeLine } from '../../ui/ChangeCard';
import { DDB, ENTITY_OPTS, GSI_OPTS, PATTERNS, SAMPLE } from './data';

/* ═════════════════════════ formatting ═════════════════════════ */

export function fmt(n: number): string {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  if (a > 0 && a < 1) return n.toFixed(1);
  return Math.round(n).toLocaleString('en-US');
}

export function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(b >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(b >= 10 * 1024 ? 0 : 1)} KB`;
  return `${Math.round(b)} B`;
}

/** 32-bit FNV-1a: stands in for the engines' real partitioners (DynamoDB's internal hash, Murmur3). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // murmur3 fmix32 finaliser: spreads short, similar keys across the whole range
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/* ═════════════════════════ DynamoDB ═════════════════════════ */

export type Entity = 'customer' | 'order' | 'item';
export type Var = 'cid' | 'oid' | 'date' | 'status' | 'n' | 'iid' | 'shard';
export type Part = string | { v: Var };
export type KeyT = Part[];
export type TableId = 'app' | 'customers' | 'orders' | 'order_items';
export type Slot = 'base' | 'gsi1' | 'gsi2';
export type Vals = Partial<Record<Var, string>>;
export type Verdict = 'good' | 'meh' | 'trap';

export interface EntityOpt {
  id: string;
  entity: Entity;
  table: TableId;
  pk: KeyT;
  sk: KeyT | null;
  verdict: Verdict;
  why: string;
  fix?: string;
  /** Children found through an id list stored on the parent (BatchGet). */
  viaHeaderList?: boolean;
}

export interface GsiOpt {
  id: string;
  slot: 'gsi1' | 'gsi2';
  label: string;
  verdict: Verdict;
  why: string;
  fix?: string;
  map: ((e: Entity, base: { pk: KeyT; sk: KeyT | null }) => { pk: KeyT; sk: KeyT | null } | null) | null;
}

export interface DDesign {
  customer: string;
  order: string;
  item: string;
  gsi1: string;
  gsi2: string;
}

export type PatternId = 'a1' | 'a2' | 'a3' | 'a4' | 'a5';
export interface DPattern {
  id: PatternId;
  name: string;
  short: string;
  /** Requests per second at peak. */
  rate: number;
  sample: Vals;
  ask: string;
}

export interface Inst {
  id: string;
  entity: Entity;
  vals: Vals;
  label: string;
}

export const TABLE_NAME: Record<TableId, string> = { app: 'app_table', customers: 'Customers', orders: 'Orders', order_items: 'OrderItems' };
const TABLE_ORDER: TableId[] = ['app', 'customers', 'orders', 'order_items'];

export const keyText = (k: KeyT | null) => (k ? k.map((p) => (typeof p === 'string' ? p : `<${p.v}>`)).join('') : '');
export const varsOf = (k: KeyT | null): Var[] => (k ?? []).flatMap((p) => (typeof p === 'string' ? [] : [p.v]));
export const renderKey = (k: KeyT | null, v: Vals) => (k ? k.map((p) => (typeof p === 'string' ? p : (v[p.v] ?? `<${p.v}>`))).join('') : '');

export const entityOpt = (id: string) => ENTITY_OPTS.find((o) => o.id === id) ?? ENTITY_OPTS[0];
export const gsiOpt = (id: string) => GSI_OPTS.find((o) => o.id === id) ?? GSI_OPTS[0];
export const optLabel = (o: EntityOpt) => (o.sk ? `PK=${keyText(o.pk)} · SK=${keyText(o.sk)}` : `PK=${keyText(o.pk)}`);

export function indexLabel(index: string): string {
  const [t, s] = index.split('.');
  return s ? `${TABLE_NAME[t as TableId]} · ${s.toUpperCase()}` : TABLE_NAME[t as TableId];
}
export const isGsi = (index: string) => index.includes('.');
export const keyNames = (index: string) => {
  const s = index.split('.')[1];
  return s ? { pk: `${s.toUpperCase()}PK`, sk: `${s.toUpperCase()}SK` } : { pk: 'PK', sk: 'SK' };
};

export interface Placement {
  entity: Entity;
  table: TableId;
  slot: Slot;
  index: string;
  pk: KeyT;
  sk: KeyT | null;
}

export function placements(d: DDesign): Placement[] {
  const ents = [entityOpt(d.customer), entityOpt(d.order), entityOpt(d.item)];
  const out: Placement[] = ents.map((o) => ({ entity: o.entity, table: o.table, slot: 'base', index: o.table, pk: o.pk, sk: o.sk }));
  const gt = entityOpt(d.order).table;
  for (const slot of ['gsi1', 'gsi2'] as const) {
    const g = gsiOpt(d[slot]);
    if (!g.map) continue;
    for (const o of ents) {
      if (o.table !== gt) continue;
      const k = g.map(o.entity, { pk: o.pk, sk: o.sk });
      if (k) out.push({ entity: o.entity, table: gt, slot, index: `${gt}.${slot}`, pk: k.pk, sk: k.sk });
    }
  }
  return out;
}

export function indexesOf(pl: Placement[]): string[] {
  const out: string[] = [];
  for (const t of TABLE_ORDER) for (const s of ['', '.gsi1', '.gsi2']) if (pl.some((p) => p.index === t + s)) out.push(t + s);
  return out;
}

export interface Row {
  key: string;
  id: string;
  entity: Entity;
  index: string;
  pk: string;
  sk: string;
  vals: Vals;
  label: string;
}

export function materialize(pl: Placement[]): Row[] {
  const rows: Row[] = [];
  for (const p of pl) {
    const need = [...varsOf(p.pk), ...varsOf(p.sk)];
    for (const s of SAMPLE) {
      if (s.entity !== p.entity || need.some((v) => s.vals[v] === undefined)) continue;
      rows.push({ key: `${p.index}|${s.id}`, id: s.id, entity: s.entity, index: p.index, pk: renderKey(p.pk, s.vals), sk: renderKey(p.sk, s.vals), vals: s.vals, label: s.label });
    }
  }
  return rows;
}

/** Physical partition (of 4 drawn) = top 2 bits of hash(PK): DynamoDB assigns hash *ranges* to partitions. */
export const partitionOf = (pk: string) => hash32(pk) >>> 30;
export const N_PARTS = 4;

/* ── production-scale model ── */

const total = (e: Entity) => (e === 'customer' ? DDB.customers : e === 'order' ? DDB.customers * DDB.ordersPerCustomer : DDB.customers * DDB.ordersPerCustomer * DDB.itemsPerOrder);
const maxShare = Math.max(...Object.values(DDB.statusShare));

/** Items of entity e under one partition-key value. */
function perKey(e: Entity, pkV: Var[], share: number, heavy = false): number {
  if (pkV.includes('oid')) return e === 'item' ? DDB.itemsPerOrder : 1;
  if (pkV.includes('iid')) return 1;
  if (pkV.includes('cid')) {
    const o = heavy ? DDB.heavyOrders : DDB.ordersPerCustomer;
    return e === 'customer' ? 1 : e === 'order' ? o : o * DDB.itemsPerOrder;
  }
  if (pkV.includes('status')) return Math.round((total('order') * share) / (pkV.includes('shard') ? DDB.shards : 1));
  if (pkV.includes('n')) return total('order');
  return total(e);
}
const concentrated = (pkV: Var[]) => !pkV.some((v) => v === 'cid' || v === 'oid' || v === 'iid');

const rcuOf = (bytes: number, strong: boolean) => Math.max(1, Math.ceil(bytes / 4096)) * (strong ? 1 : 0.5);

export type Kind = 'query' | 'gsi' | 'batch' | 'scan';
export const KIND_LABEL: Record<Kind, string> = {
  query: 'Query (1 round trip, item collection)',
  gsi: 'Query on GSI (eventually consistent)',
  batch: 'BatchGet / N+1 calls',
  scan: 'Scan (reads the whole table)',
};
export const KIND_SHORT: Record<Kind, string> = { query: 'Query', gsi: 'GSI Query', batch: 'multi-call', scan: 'Scan' };
const KIND_RANK: Record<Kind, number> = { query: 0, gsi: 1, batch: 2, scan: 3 };

export interface Step {
  seq: number;
  index: string;
  op: 'get' | 'query' | 'scan' | 'batch';
  pks?: string[];
  skPrefix?: string;
  /** Rows the request should return (others read are discarded by a filter). */
  match: { entity?: Entity; vals: Vals };
  limit?: number;
  desc?: boolean;
}

export interface Access {
  kind: Kind;
  /** Overrides KIND_LABEL, e.g. a Query that is as bad as a Scan. */
  label?: string;
  ok: boolean;
  calls: number;
  items: number;
  bytes: number;
  rcu: number;
  how: string[];
  note: string;
  steps: Step[];
  /** Concentrated keys this access reads (for hot-key read heat): index|pk string → RCU per call. */
  reads: Record<string, number>;
}

interface Need {
  e: Entity;
  known: Var[];
  mode: 'one' | 'list' | 'all';
  sample: Vals;
  desc?: boolean;
  page?: number;
  share?: number;
}

const pick = (v: Vals, keys: Var[]) => Object.fromEntries(keys.map((k) => [k, v[k]])) as Vals;
const allShards = () => Array.from({ length: DDB.shards }, (_, i) => String(i));

function viaPlacement(p: Placement, need: Need): Access | null {
  const pkV = varsOf(p.pk);
  if (pkV.some((v) => v !== 'shard' && !need.known.includes(v))) return null;
  const fan = pkV.includes('shard') ? DDB.shards : 1;
  let prefix = '';
  const pv: Var[] = [];
  let next: Var | null = null;
  for (const part of p.sk ?? []) {
    if (typeof part === 'string') prefix += part;
    else if (need.known.includes(part.v)) {
      prefix += need.sample[part.v] ?? '';
      pv.push(part.v);
    } else {
      next = part.v;
      break;
    }
  }
  const exact = next === null;
  const covered = new Set<Var>([...pkV, ...pv]);
  const missing = need.known.filter((v) => !covered.has(v));
  const coll = perKey(need.e, pkV, need.share ?? DDB.statusShare.PENDING);
  const gsi = p.slot !== 'base';
  const names = keyNames(p.index);
  const pks = fan > 1 ? allShards().map((s) => renderKey(p.pk, { ...need.sample, shard: s })) : [renderKey(p.pk, need.sample)];
  const pkShown = fan > 1 ? renderKey(p.pk, { ...need.sample, shard: '0..9' }) : pks[0];
  const size = DDB.bytes[need.e];
  const get = exact && !gsi && fan === 1 && need.mode === 'one' && missing.length === 0;
  let items: number;
  let ok = true;
  let note: string;
  let sorted = false;
  let kind: Kind = gsi ? 'gsi' : 'query';
  let label: string | undefined;
  const cond = [`${names.pk} = "${pkShown}"`];
  if (p.sk && prefix) cond.push(exact ? `${names.sk} = "${prefix}"` : `begins_with(${names.sk}, "${prefix}")`);
  const how = [`${get ? 'GetItem' : 'Query'} ${indexLabel(p.index)}${fan > 1 ? ` ×${fan} shards` : ''}`, cond.join(' AND ')];

  if (missing.length) {
    items = coll * fan;
    ok = false;
    how.push(`FilterExpression ${missing.map((v) => `${v} = :${v}`).join(' AND ')}`);
    if (pkV.length === 0) {
      kind = 'scan';
      label = 'Query + filter over one giant collection (Scan-equivalent)';
    }
    note = `\`${missing.join(', ')}\` is not in the key: reads all ${fmt(items)} items under \`${pkShown}\`, keeps the match.`;
  } else if (need.mode === 'one') {
    items = exact ? 1 : coll * fan;
    note = get ? 'Exact primary key: one item, strongly consistent if you ask.' : `Key names the item${items > 1 ? 's' : ''} directly.`;
  } else if (need.mode === 'list') {
    if (next === 'date') {
      sorted = true;
      items = Math.min(need.page ?? 10, coll) * fan;
      how.push(`ScanIndexForward=${need.desc ? 'false' : 'true'} · Limit ${need.page}`);
      note = fan > 1 ? `${fan} parallel Queries (one per shard), each Limit ${need.page}, merged by date in the app.` : `Reads exactly ${items} items in ${need.desc ? 'reverse ' : ''}SK (date) order.`;
    } else {
      items = coll * fan;
      ok = false;
      note = `SK is not date-ordered (${next ? `\`<${next}>\`` : 'none'}): reads all ${fmt(items)} items and sorts in the app; no newest-first paging.`;
    }
  } else {
    items = coll * fan;
    note = `All ${fmt(items)} children of the parent, one collection.`;
  }
  const bytes = items * size;
  const perShard = bytes / fan;
  const calls = fan * Math.max(1, Math.ceil(perShard / DDB.limits.pageBytes));
  const rcu = fan * rcuOf(perShard, !gsi);
  const reads: Record<string, number> = {};
  if (concentrated(pkV)) for (const k of pks) reads[`${p.index}|${k}`] = rcu / fan;
  return {
    kind,
    label,
    ok,
    calls,
    items,
    bytes,
    rcu,
    how,
    note,
    reads,
    steps: [{ seq: 1, index: p.index, op: get ? 'get' : 'query', pks, skPrefix: prefix, match: { entity: need.e, vals: pick(need.sample, need.known) }, limit: sorted ? need.page : undefined, desc: need.desc }],
  };
}

function scanFor(pl: Placement[], need: Need): Access {
  const base = pl.find((p) => p.slot === 'base' && p.entity === need.e)!;
  const ents = pl.filter((p) => p.slot === 'base' && p.table === base.table);
  const items = ents.reduce((s, p) => s + total(p.entity), 0);
  const bytes = ents.reduce((s, p) => s + total(p.entity) * DDB.bytes[p.entity], 0);
  return {
    kind: 'scan',
    ok: false,
    calls: Math.ceil(bytes / DDB.limits.pageBytes),
    items,
    bytes,
    rcu: rcuOf(bytes, false),
    how: [`Scan ${TABLE_NAME[base.table]}`, `FilterExpression ${need.known.map((v) => `${v} = :${v}`).join(' AND ')}`],
    note: `No key starts from \`${need.known.join(', ')}\`: reads all ${fmt(items)} items (${fmtBytes(bytes)}) in 1 MB pages, pays for every one.`,
    reads: {},
    steps: [{ seq: 1, index: base.table, op: 'scan', match: { entity: need.e, vals: pick(need.sample, need.known) } }],
  };
}

const better = (a: Access, b: Access) => (a.ok !== b.ok ? (a.ok ? -1 : 1) : KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.rcu - b.rcu);

function locate(pl: Placement[], need: Need): Access {
  const c = pl.filter((p) => p.entity === need.e).flatMap((p) => viaPlacement(p, need) ?? []);
  c.push(scanFor(pl, need));
  return c.sort(better)[0];
}

function evalA3(d: DDesign, pl: Placement[], sample: Vals): Access {
  for (const h of pl.filter((p) => p.entity === 'order'))
    for (const i of pl.filter((p) => p.entity === 'item')) {
      const v = varsOf(h.pk);
      if (h.index !== i.index || keyText(h.pk) !== keyText(i.pk) || !v.length || v.some((x) => x !== 'oid')) continue;
      const gsi = h.slot !== 'base';
      const bytes = DDB.bytes.order + DDB.itemsPerOrder * DDB.bytes.item;
      const pk = renderKey(h.pk, sample);
      return {
        kind: gsi ? 'gsi' : 'query',
        ok: true,
        calls: 1,
        items: 1 + DDB.itemsPerOrder,
        bytes,
        rcu: rcuOf(bytes, !gsi),
        how: [`Query ${indexLabel(h.index)}`, `${keyNames(h.index).pk} = "${pk}"`],
        note: 'Header and items share one item collection: one request returns both, header first.',
        reads: {},
        steps: [{ seq: 1, index: h.index, op: 'query', pks: [pk], skPrefix: '', match: { vals: sample } }],
      };
    }
  const hdr = locate(pl, { e: 'order', known: ['oid'], mode: 'one', sample });
  const io = entityOpt(d.item);
  let its: Access;
  if (io.viaHeaderList) {
    const bytes = DDB.itemsPerOrder * DDB.bytes.item;
    const ip = pl.find((p) => p.entity === 'item' && p.slot === 'base')!;
    its = {
      kind: 'batch',
      ok: false,
      calls: 1,
      items: DDB.itemsPerOrder,
      bytes,
      rcu: DDB.itemsPerOrder * rcuOf(DDB.bytes.item, true),
      how: [`BatchGetItem ${TABLE_NAME[ip.table]} ×${DDB.itemsPerOrder} keys (from order.item_ids)`],
      note: '',
      reads: {},
      steps: [{ seq: 2, index: ip.index, op: 'batch', match: { entity: 'item', vals: sample } }],
    };
  } else its = locate(pl, { e: 'item', known: ['oid'], mode: 'all', sample });
  const scan = hdr.kind === 'scan' || its.kind === 'scan';
  return {
    kind: scan ? 'scan' : 'batch',
    label: scan ? undefined : io.viaHeaderList ? 'GetItem, then BatchGetItem (2 sequential calls)' : '2 requests, joined in the app',
    ok: false,
    calls: hdr.calls + its.calls,
    items: hdr.items + its.items,
    bytes: hdr.bytes + its.bytes,
    rcu: hdr.rcu + its.rcu,
    how: [...hdr.how, '+ then', ...its.how],
    note: scan
      ? `${hdr.kind === 'scan' ? 'Finding the order' : 'Finding its items'} needs a Scan: ${hdr.kind === 'scan' ? hdr.note : its.note}`
      : io.viaHeaderList
        ? 'GetItem the order, read its `item_ids`, then BatchGetItem: 2 round trips in sequence; BatchGet rounds each item up to 4 KB.'
        : 'Header and items live under different keys: 2 requests and an app-side join (double latency, no single snapshot).',
    reads: { ...hdr.reads, ...its.reads },
    steps: [...hdr.steps.map((s) => ({ ...s, seq: 1 })), ...its.steps.map((s) => ({ ...s, seq: 2 }))],
  };
}

export interface PatternEval extends Access {
  id: PatternId;
  rcuPerSec: number;
}

export interface HotKey {
  index: string;
  pk: string;
  entity: Entity;
  wcu: number;
  rcu: number;
  level: 'hot' | 'warm';
  why: string;
}

export interface BigCollection {
  index: string;
  pk: string;
  bytes: number;
}

export interface DEval {
  pl: Placement[];
  indexes: string[];
  patterns: Record<PatternId, PatternEval>;
  hot: HotKey[];
  /** index|pk → heat of that key value (concentrated keys only). */
  heat: Record<string, { wcu: number; rcu: number }>;
  big: BigCollection[];
  /** WCU spent over one order's life (create + 3 status updates), across base table and GSIs. */
  wcuPerOrder: number;
}

/** Writes/s on one concrete key value of a concentrated placement. */
function writeHeat(p: Placement, vals: Vals): number {
  const pkV = varsOf(p.pk);
  const shard = pkV.includes('shard') ? DDB.shards : 1;
  const ups = DDB.ordersPerSec * DDB.statusUpdatesPerOrder;
  if (p.entity === 'customer') return DDB.customerWritesPerSec;
  if (p.entity === 'order') {
    if (pkV.includes('status')) {
      // a status key gets an insert when orders enter it and a delete when they leave it
      const i = DDB.statuses.indexOf(vals.status ?? '');
      const inflow = i <= DDB.statusUpdatesPerOrder ? DDB.ordersPerSec : DDB.ordersPerSec * DDB.statusShare.CANCELLED;
      const outflow = i < DDB.statusUpdatesPerOrder ? DDB.ordersPerSec : 0;
      return (inflow + outflow) / shard;
    }
    return DDB.ordersPerSec + ups;
  }
  if (pkV.includes('n')) return DDB.ordersPerSec * Math.max(0, 1 - (Number(vals.n ?? 1) - 1) * 0.3);
  return DDB.ordersPerSec * DDB.itemsPerOrder;
}

function keyValues(p: Placement): Vals[] {
  const pkV = varsOf(p.pk);
  let out: Vals[] = [{}];
  if (pkV.includes('status')) out = DDB.statuses.map((status) => ({ status }));
  if (pkV.includes('shard')) out = out.flatMap((v) => allShards().map((shard) => ({ ...v, shard })));
  if (pkV.includes('n')) out = ['1', '2', '3'].map((n) => ({ n }));
  return out;
}

export function evalDynamo(d: DDesign): DEval {
  const pl = placements(d);
  const P = Object.fromEntries(PATTERNS.map((p) => [p.id, p])) as Record<PatternId, DPattern>;
  const acc: Record<PatternId, Access> = {
    a1: locate(pl, { e: 'customer', known: ['cid'], mode: 'one', sample: P.a1.sample }),
    a2: locate(pl, { e: 'order', known: ['cid'], mode: 'list', desc: true, page: DDB.page.a2, sample: P.a2.sample }),
    a3: evalA3(d, pl, P.a3.sample),
    a4: locate(pl, { e: 'order', known: ['status'], mode: 'list', desc: false, page: DDB.page.a4, sample: P.a4.sample, share: DDB.statusShare.PENDING }),
    a5: locate(pl, { e: 'order', known: ['oid'], mode: 'one', sample: P.a5.sample }),
  };
  const patterns = Object.fromEntries(PATTERNS.map((p) => [p.id, { ...acc[p.id], id: p.id, rcuPerSec: acc[p.id].rcu * p.rate }])) as Record<PatternId, PatternEval>;

  // heat per concrete concentrated key
  const heat: Record<string, { wcu: number; rcu: number }> = {};
  const owner: Record<string, Placement> = {};
  for (const p of pl) {
    if (!concentrated(varsOf(p.pk))) continue;
    for (const v of keyValues(p)) {
      const k = `${p.index}|${renderKey(p.pk, v)}`;
      const h = (heat[k] ??= { wcu: 0, rcu: 0 });
      h.wcu += writeHeat(p, v) * Math.ceil(DDB.bytes[p.entity] / 1024);
      owner[k] ??= p;
    }
  }
  for (const p of PATTERNS) for (const [k, r] of Object.entries(patterns[p.id].reads)) if (heat[k]) heat[k].rcu += r * p.rate;

  const hot: HotKey[] = [];
  for (const [k, h] of Object.entries(heat)) {
    const fw = h.wcu / DDB.limits.wcu;
    const fr = h.rcu / DDB.limits.rcu;
    if (fw < 0.6 && fr < 0.6) continue;
    const [index, pk] = k.split('|');
    const level = fw > 1 || fr > 1 ? 'hot' : 'warm';
    const parts = [fw >= 0.6 ? `${fmt(h.wcu)} WCU/s (cap 1,000)` : '', fr >= 0.6 ? `${fmt(h.rcu)} RCU/s (cap 3,000)` : ''].filter(Boolean).join(' · ');
    hot.push({
      index,
      pk,
      entity: owner[k].entity,
      wcu: h.wcu,
      rcu: h.rcu,
      level,
      why: `${parts}${level === 'hot' ? (isGsi(index) ? ': throttles, and back-pressures base-table writes' : ': throttles') : ': no headroom left'}`,
    });
  }
  hot.sort((a, b) => Number(b.level === 'hot') - Number(a.level === 'hot') || b.wcu + b.rcu - (a.wcu + a.rcu));

  // largest item collection per (index, pk template)
  const groups = new Map<string, Placement[]>();
  for (const p of pl) {
    const g = `${p.index}|${keyText(p.pk)}`;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  const big: BigCollection[] = [];
  for (const [g, ps] of groups) {
    const bytes = ps.reduce((s, p) => s + perKey(p.entity, varsOf(p.pk), maxShare, true) * DDB.bytes[p.entity], 0);
    if (bytes > DDB.limits.collectionBytes) {
      const [index] = g.split('|');
      const p = ps[0];
      const v: Vals = varsOf(p.pk).includes('status') ? { status: 'DELIVERED', shard: '0' } : varsOf(p.pk).includes('n') ? { n: '1' } : {};
      big.push({ index, pk: renderKey(p.pk, v), bytes });
    }
  }

  let wcuPerOrder = 0;
  for (const p of pl) {
    const keyed = [...varsOf(p.pk), ...varsOf(p.sk)].includes('status');
    if (p.entity === 'order') wcuPerOrder += 1 + DDB.statusUpdatesPerOrder * (keyed ? 2 : 1);
    if (p.entity === 'item') wcuPerOrder += DDB.itemsPerOrder;
  }

  return { pl, indexes: indexesOf(pl), patterns, hot, heat, big, wcuPerOrder };
}

/** Rows a plan reads and returns on the sample data, with read order for the animation. */
export function traceSample(steps: Step[], rows: Row[]) {
  const read = new Map<string, { seq: number; order: number; kept: boolean }>();
  const parts = new Map<string, number>();
  const matches = (r: Row, m: Step['match']) => (!m.entity || r.entity === m.entity) && Object.entries(m.vals).every(([k, v]) => r.vals[k as Var] === v);
  for (const s of steps) {
    let hit = rows.filter((r) => r.index === s.index);
    if (s.op === 'batch') hit = hit.filter((r) => matches(r, s.match));
    else if (s.op !== 'scan') hit = hit.filter((r) => s.pks?.includes(r.pk) && r.sk.startsWith(s.skPrefix ?? ''));
    hit.sort((a, b) => (s.desc ? b.sk.localeCompare(a.sk) : a.sk.localeCompare(b.sk)));
    if (s.limit) {
      // per partition key (shard), keep the first `limit` rows
      const per = new Map<string, number>();
      hit = hit.filter((r) => {
        const n = (per.get(r.pk) ?? 0) + 1;
        per.set(r.pk, n);
        return n <= s.limit!;
      });
    }
    hit.forEach((r, i) => {
      read.set(r.key, { seq: s.seq, order: i, kept: matches(r, s.match) });
      const pk = `${s.index}|${partitionOf(r.pk)}`;
      parts.set(pk, Math.min(parts.get(pk) ?? 99, s.seq));
    });
    if (s.op === 'scan') for (let i = 0; i < N_PARTS; i++) parts.set(`${s.index}|${i}`, s.seq);
  }
  return { read, parts };
}

export const bigWhy = (c: BigCollection) =>
  isGsi(c.index) ? 'one key this large still gets one partition\'s throughput for its hottest range' : 'over 10 GB: fine today, but writes fail if the table ever gets an LSI';

const rank = (p: PatternEval) => KIND_RANK[p.kind] * 2 + (p.ok ? 0 : 1);

export function diffDynamo(a: DEval, b: DEval): ChangeLine[] {
  const lines: ChangeLine[] = [];
  for (const p of PATTERNS) {
    const x = a.patterns[p.id];
    const y = b.patterns[p.id];
    const rr = `RCU/call ${fmt(x.rcu)} → ${fmt(y.rcu)}`;
    if (x.kind !== y.kind || x.ok !== y.ok) {
      const up = rank(y) < rank(x);
      lines.push({
        tone: up ? 'ok' : 'bad',
        text: `**${p.short}**: ${KIND_SHORT[x.kind]}${x.ok ? '' : ' ✗'} → ${KIND_SHORT[y.kind]}${y.ok ? ' ✓' : ' ✗'} · ${rr}${!y.ok && y.kind !== 'scan' ? ` · ${y.note}` : ''}`,
      });
    } else if (Math.abs(x.rcu - y.rcu) / Math.max(x.rcu, y.rcu) > 0.2 || x.calls !== y.calls) {
      lines.push({ tone: y.rcu < x.rcu ? 'ok' : 'warn', text: `**${p.short}**: same ${KIND_SHORT[y.kind]}, ${rr} · calls ${fmt(x.calls)} → ${fmt(y.calls)}` });
    }
  }
  const hk = (h: HotKey) => `${h.index}|${h.pk}|${h.level}`;
  const aHot = new Set(a.hot.map(hk));
  const bHot = new Set(b.hot.map(hk));
  for (const h of b.hot) if (!aHot.has(hk(h))) lines.push({ tone: h.level === 'hot' ? 'bad' : 'warn', text: `${h.level === 'hot' ? 'Hot' : 'Warm'} key \`${h.pk}\` on ${indexLabel(h.index)}: ${h.why}` });
  for (const h of a.hot) if (!bHot.has(hk(h)) && !b.hot.some((x) => x.index === h.index && x.pk === h.pk)) lines.push({ tone: 'ok', text: `\`${h.pk}\` on ${indexLabel(h.index)} no longer hot (was ${fmt(h.wcu)} WCU/s)` });
  const bk = (c: BigCollection) => `${c.index}|${c.pk}`;
  for (const c of b.big) if (!a.big.some((x) => bk(x) === bk(c))) lines.push({ tone: 'warn', text: `Item collection \`${c.pk}\` on ${indexLabel(c.index)} ≈ ${fmtBytes(c.bytes)}: ${bigWhy(c)}` });
  if (a.wcuPerOrder !== b.wcuPerOrder) lines.push({ tone: 'info', text: `Write cost per order lifecycle: ${a.wcuPerOrder} → ${b.wcuPerOrder} WCU (every GSI copy is a write too)` });
  if (!lines.length) lines.push({ tone: 'info', text: 'No access pattern changed: items only moved between partitions.' });
  return lines;
}

export const dynamoAllQuery = (e: DEval) => Object.values(e.patterns).every((p) => p.ok && (p.kind === 'query' || p.kind === 'gsi')) && !e.hot.some((h) => h.level === 'hot');
export const dynamoGsiShard = (d: DDesign, e: DEval) => d.gsi1 === 'g1-shard' && e.patterns.a4.kind === 'gsi' && e.patterns.a4.ok && !e.hot.some((h) => h.level === 'hot' && h.index.endsWith('gsi1'));

/* ═════════════════════════ Cassandra ═════════════════════════ */

export type CPk = 'conv' | 'conv-day' | 'conv-month' | 'msg' | 'sender';
export type CCk = 'sent-desc' | 'sent-asc' | 'msgid' | 'none';
export interface CState {
  pk: CPk;
  ck: CCk;
  months: number;
  perDay: number;
}

export const CASS = {
  rowBytes: 250,
  maxRows: 100_000,
  maxBytes: 100 * 1024 ** 2,
  daysPerMonth: 30.4,
  nodes: 6,
  rf: 3,
  /** cluster-wide, for the ALLOW FILTERING cost */
  conversations: 2_000_000,
  avgPerDay: 20,
  stress: { months: 60, perDay: 2000 },
};

export const CPK_OPTS: { id: CPk; label: string; verdict: Verdict; why: string; fix?: string }[] = [
  { id: 'conv', label: '(conversation_id)', verdict: 'meh', why: 'Perfect for "latest 50", but a partition grows forever with the conversation.', fix: 'Add a time bucket: `(conversation_id, day_bucket)` or month for quieter chats.' },
  { id: 'conv-day', label: '(conversation_id, day_bucket)', verdict: 'good', why: 'Bounded: one day per partition. Readers compute today\'s bucket; quiet chats walk back several days.' },
  { id: 'conv-month', label: '(conversation_id, month_bucket)', verdict: 'good', why: 'Bounded for normal traffic (2,000/day ≈ 61k rows); quiet chats still fill a page from one partition.' },
  { id: 'msg', label: '(message_id)', verdict: 'trap', why: 'Even spread, but no query knows a message id up front: "latest 50 of a conversation" can\'t name a partition → ALLOW FILTERING across the cluster.', fix: 'Partition by what the read filters on: `conversation_id` (+ time bucket).' },
  { id: 'sender', label: '(sender_id)', verdict: 'trap', why: 'Models "messages by user", not "messages in a conversation": the read can\'t name a partition, and bots create unbounded partitions.', fix: 'Partition by `conversation_id` (+ bucket); add a separate `messages_by_sender` table if that read exists.' },
];
export const CCK_OPTS: { id: CCk; label: string; verdict: Verdict; why: string; fix?: string }[] = [
  { id: 'sent-desc', label: 'sent_at DESC, message_id', verdict: 'good', why: 'Newest row first on disk: latest 50 = first 50 rows. `message_id` keeps two messages in the same millisecond distinct.' },
  { id: 'sent-asc', label: 'sent_at ASC, message_id', verdict: 'meh', why: 'Works with `ORDER BY sent_at DESC` (reverse slice), slightly less efficient than reading forward.' },
  { id: 'msgid', label: 'message_id (random uuid)', verdict: 'trap', why: 'Rows sorted by a random UUID: no time order, so `ORDER BY sent_at` is impossible: read the whole partition and sort in the app.', fix: 'Cluster by `sent_at DESC, message_id` (or a timeuuid).' },
  { id: 'none', label: 'none', verdict: 'trap', why: 'The partition key is the whole primary key: every INSERT upserts the same row. Only the last message survives.', fix: 'Add clustering columns `sent_at DESC, message_id`.' },
];

export interface CEval {
  rows: number;
  bytes: number;
  bounded: boolean;
  size: 'ok' | 'warn' | 'bad';
  overwrite: boolean;
  partitionsPerConv: number;
  ddl: string;
  latest: { cql: string; error?: string; partitions: number; rows: number; nodes: number; single: boolean; sorted: boolean; filtering: boolean; ok: boolean; note: string };
}

export function cassRows(s: CState): number {
  const days = s.months * CASS.daysPerMonth;
  const overwrite = s.ck === 'none' && s.pk !== 'msg';
  if (overwrite || s.pk === 'msg') return 1;
  if (s.pk === 'conv') return Math.round(s.perDay * days);
  if (s.pk === 'conv-day') return s.perDay;
  if (s.pk === 'conv-month') return Math.round(s.perDay * Math.min(days, CASS.daysPerMonth));
  return Math.round(s.perDay * days);
}

export function evalCass(s: CState): CEval {
  const days = s.months * CASS.daysPerMonth;
  const overwrite = s.ck === 'none' && s.pk !== 'msg';
  const rows = cassRows(s);
  const bytes = rows * CASS.rowBytes;
  const bounded = s.pk === 'conv-day' || s.pk === 'conv-month' || s.pk === 'msg' || overwrite;
  const frac = Math.max(rows / CASS.maxRows, bytes / CASS.maxBytes);
  const size = frac > 1 ? 'bad' : frac > 0.5 ? 'warn' : 'ok';
  const partitionsPerConv = s.pk === 'conv' ? 1 : s.pk === 'conv-day' ? Math.ceil(days) : s.pk === 'conv-month' ? s.months : s.pk === 'msg' ? Math.round(s.perDay * days) : 0;

  const pkCols = { conv: 'conversation_id', 'conv-day': 'conversation_id, day_bucket', 'conv-month': 'conversation_id, month_bucket', msg: 'message_id', sender: 'sender_id' }[s.pk];
  const ckCols = s.pk === 'msg' || s.ck === 'none' ? [] : s.ck === 'msgid' ? ['message_id'] : ['sent_at', 'message_id'];
  const ddl = [
    'CREATE TABLE messages (',
    '  conversation_id uuid,',
    ...(s.pk === 'conv-day' ? ['  day_bucket      date,'] : s.pk === 'conv-month' ? ['  month_bucket    text,'] : []),
    '  sent_at         timestamp,',
    `  message_id      ${s.ck === 'msgid' ? 'uuid' : 'timeuuid'},`,
    '  sender_id       uuid,',
    '  body            text,',
    `  PRIMARY KEY ((${pkCols})${ckCols.length ? ', ' + ckCols.join(', ') : ''})`,
    `)${ckCols.length === 2 ? ` WITH CLUSTERING ORDER BY (sent_at ${s.ck === 'sent-asc' ? 'ASC' : 'DESC'}, message_id ${s.ck === 'sent-asc' ? 'ASC' : 'DESC'})` : ''};`,
  ].join('\n');

  let latest: CEval['latest'];
  if (s.pk === 'msg' || s.pk === 'sender') {
    const all = CASS.conversations * CASS.avgPerDay * days;
    latest = {
      cql: "SELECT * FROM messages\n WHERE conversation_id = ?\n LIMIT 50 ALLOW FILTERING;",
      error: 'InvalidRequest: Cannot execute this query as it might involve data filtering and thus may have unpredictable performance. If you want to execute this query despite the performance unpredictability, use ALLOW FILTERING',
      partitions: Infinity,
      rows: all,
      nodes: CASS.nodes,
      single: false,
      sorted: false,
      filtering: true,
      ok: false,
      note: `\`conversation_id\` is not the partition key, so no token can be computed: every node scans every partition (~${fmt(all)} rows) and the coordinator still can't ORDER BY.`,
    };
  } else if (overwrite) {
    latest = { cql: 'SELECT * FROM messages\n WHERE conversation_id = ?;', partitions: 1, rows: 1, nodes: 2, single: true, sorted: false, filtering: false, ok: false, note: 'Returns one row: every INSERT overwrote the previous message. The other messages are gone.' };
  } else {
    const perPart = s.pk === 'conv-day' ? s.perDay : s.pk === 'conv-month' ? s.perDay * CASS.daysPerMonth : Infinity;
    const buckets = s.pk === 'conv' ? 1 : Math.min(s.pk === 'conv-day' ? Math.ceil(days) : s.months, Math.ceil(50 / perPart));
    const sorted = s.ck !== 'msgid';
    const where = s.pk === 'conv' ? 'conversation_id = ?' : s.pk === 'conv-day' ? "conversation_id = ?\n   AND day_bucket = '2026-11-25'" : "conversation_id = ?\n   AND month_bucket = '2026-11'";
    const cql = sorted
      ? `SELECT * FROM messages\n WHERE ${where}\n${s.ck === 'sent-asc' ? ' ORDER BY sent_at DESC\n' : ''} LIMIT 50;${buckets > 1 ? `\n-- then the previous ${s.pk === 'conv-day' ? 'day' : 'month'}, … (${buckets} sequential queries)` : ''}`
      : `SELECT * FROM messages\n WHERE ${where};\n-- ORDER BY sent_at is impossible (not a clustering column):\n-- read everything, sort in the app`;
    const readRows = sorted ? 50 : buckets * rows;
    latest = {
      cql,
      partitions: buckets,
      rows: readRows,
      nodes: Math.min(CASS.nodes, 2 * buckets),
      single: buckets === 1,
      sorted,
      filtering: false,
      ok: buckets === 1 && sorted,
      note: !sorted
        ? `Clustering by a random UUID: reads all ${fmt(readRows)} rows of the partition${buckets > 1 ? 's' : ''} to find the newest 50.`
        : buckets > 1
          ? `Each ${s.pk === 'conv-day' ? 'day' : 'month'} bucket holds ~${fmt(perPart)} rows: the app walks ${buckets} partitions one after another (more if some are empty).`
          : `One partition, ${s.ck === 'sent-asc' ? 'read backwards (reverse slice)' : 'first 50 rows in on-disk order'}: a QUORUM read touches 2 of 3 replicas.`,
    };
  }
  return { rows, bytes, bounded, size, overwrite, partitionsPerConv, ddl, latest };
}

export function diffCass(a: CEval, b: CEval): ChangeLine[] {
  const lines: ChangeLine[] = [];
  if (a.rows !== b.rows || a.size !== b.size)
    lines.push({ tone: b.size === 'bad' ? 'bad' : b.size === 'warn' ? 'warn' : 'ok', text: `Biggest partition: ${fmt(a.rows)} rows / ${fmtBytes(a.bytes)} → **${fmt(b.rows)} rows / ${fmtBytes(b.bytes)}**${b.size === 'bad' ? ' · over 100 MB / 100k rows' : ''}` });
  if (a.bounded !== b.bounded) lines.push({ tone: b.bounded ? 'ok' : 'bad', text: b.bounded ? 'Partitions are now **bounded**: size no longer grows with history' : 'Partitions are now **unbounded**: they grow with every month of history' });
  const L = (e: CEval) => (e.latest.filtering ? 'ALLOW FILTERING (all nodes)' : e.latest.ok ? '1 partition, sorted slice' : !e.latest.sorted ? `${e.latest.partitions} partition(s), unsorted` : `${e.latest.partitions} partitions walked`);
  if (L(a) !== L(b) || a.latest.rows !== b.latest.rows)
    lines.push({ tone: b.latest.ok ? 'ok' : b.latest.filtering ? 'bad' : 'warn', text: `Latest 50: ${L(a)} → **${L(b)}** · rows read ${fmt(a.latest.rows)} → ${fmt(b.latest.rows)}` });
  if (a.overwrite !== b.overwrite) lines.push({ tone: b.overwrite ? 'bad' : 'ok', text: b.overwrite ? 'No clustering column: each INSERT **overwrites** the previous message' : 'Clustering columns restored: every message is its own row' });
  if (!lines.length) lines.push({ tone: 'info', text: 'No measurable change for the busy conversation.' });
  return lines;
}

export const cassBounded = (s: CState) => {
  const e = evalCass({ ...s, months: CASS.stress.months, perDay: Math.max(s.perDay, CASS.stress.perDay) });
  return e.bounded && !e.overwrite && e.size !== 'bad' && e.latest.ok;
};

/* ═════════════════════════ MongoDB ═════════════════════════ */

export type AuthorMode = 'embed' | 'ref';
export type CommentMode = 'embed' | 'collection' | 'subset';
export interface MState {
  author: AuthorMode;
  comments: CommentMode;
  count: number;
}

export const MONGO = { limit: 16 * 1024 ** 2, postBase: 6 * 1024, authorSnap: 120, authorRef: 30, comment: 350, subset: 10, postsPerAuthor: 300, userDoc: 1024, countField: 20, safe: 1024 ** 2, stress: 50_000 };

export const AUTHOR_OPTS: { id: AuthorMode; label: string; verdict: Verdict; why: string }[] = [
  { id: 'embed', label: 'Embed snapshot {_id, name, avatar}', verdict: 'good', why: 'Page needs only name + avatar: zero extra reads. Renames fan out to every post (or are accepted as "name at time of posting").' },
  { id: 'ref', label: 'Reference author_id → users', verdict: 'meh', why: 'One source of truth, rename = 1 write. Costs an extra read (or `$lookup`) on every page view.' },
];
export const COMMENT_OPTS: { id: CommentMode; label: string; verdict: Verdict; why: string; fix?: string }[] = [
  { id: 'embed', label: 'Embed array comments[]', verdict: 'trap', why: 'Unbounded array in one document: every comment rewrites the whole post, page views load all comments, and ~47k comments hit the 16 MB limit.', fix: 'Reference comments (own collection) or embed only the latest 10 (subset pattern).' },
  { id: 'collection', label: 'Separate comments collection', verdict: 'good', why: 'Bounded post size; one indexed extra read for the latest 10.' },
  { id: 'subset', label: 'Subset: latest 10 embedded + rest referenced', verdict: 'good', why: 'Page = one read; post stays ~10 KB; costs 2 writes per comment and a little duplication.' },
];

export interface MEval {
  reads: { coll: 'posts' | 'users' | 'comments'; op: string }[];
  bytesRead: number;
  docBytes: number;
  status: 'ok' | 'warn' | 'bad';
  fails: boolean;
  maxComments: number;
  embedded: number;
  fanout: number;
  write: { ops: number; bytes: number; how: string[] };
  indexes: string[];
}

export function evalMongo(s: MState): MEval {
  const embedded = s.comments === 'embed' ? s.count : s.comments === 'subset' ? Math.min(s.count, MONGO.subset) : 0;
  const head = MONGO.postBase + (s.author === 'embed' ? MONGO.authorSnap : MONGO.authorRef) + (s.comments === 'embed' ? 0 : MONGO.countField);
  const docBytes = head + embedded * MONGO.comment;
  const fails = docBytes > MONGO.limit;
  const maxComments = s.comments === 'embed' ? Math.floor((MONGO.limit - head) / MONGO.comment) : Infinity;
  const reads: MEval['reads'] = [{ coll: 'posts', op: 'posts.findOne({ _id: postId })' }];
  if (s.author === 'ref') reads.push({ coll: 'users', op: 'users.findOne({ _id: post.author_id })' });
  if (s.comments === 'collection') reads.push({ coll: 'comments', op: 'comments.find({ post_id }).sort({ created_at: -1 }).limit(10)' });
  const bytesRead = Math.min(docBytes, MONGO.limit) + (s.author === 'ref' ? MONGO.userDoc : 0) + (s.comments === 'collection' ? Math.min(10, s.count) * MONGO.comment : 0);
  const write =
    s.comments === 'embed'
      ? { ops: 1, bytes: docBytes, how: ['posts.updateOne({ _id }, { $push: { comments: c } })'] }
      : s.comments === 'collection'
        ? { ops: 1, bytes: MONGO.comment, how: ['comments.insertOne(c)'] }
        : { ops: 2, bytes: MONGO.comment + docBytes, how: ['comments.insertOne(c)', 'posts.updateOne({ _id }, { $push: { recent: { $each: [c], $slice: -10 } }, $inc: { comment_count: 1 } })'] };
  const indexes = ['posts { _id } (default)'];
  if (s.author === 'ref') indexes.push('users { _id } (default)');
  else indexes.push('posts { "author._id": 1 }: for the rename updateMany');
  if (s.comments !== 'embed') indexes.push('comments { post_id: 1, created_at: -1 }');
  return {
    reads,
    bytesRead,
    docBytes,
    status: fails ? 'bad' : docBytes > MONGO.safe ? 'warn' : 'ok',
    fails,
    maxComments,
    embedded,
    fanout: s.author === 'embed' ? MONGO.postsPerAuthor : 1,
    write,
    indexes,
  };
}

export function diffMongo(a: MEval, b: MEval): ChangeLine[] {
  const lines: ChangeLine[] = [];
  if (a.reads.length !== b.reads.length) lines.push({ tone: b.reads.length < a.reads.length ? 'ok' : 'warn', text: `Reads per page view: ${a.reads.length} → **${b.reads.length}**` });
  if (Math.abs(a.docBytes - b.docBytes) > 1)
    lines.push({
      tone: b.fails ? 'bad' : b.docBytes > MONGO.safe ? 'warn' : 'ok',
      text: `Post document: ${fmtBytes(a.docBytes)} → **${fmtBytes(b.docBytes)}** (${((b.docBytes / MONGO.limit) * 100).toFixed(b.docBytes < MONGO.limit / 100 ? 2 : 0)}% of 16 MB)${b.fails ? ': over the limit, `$push` fails with BSONObjectTooLarge' : ''}`,
    });
  if (Math.abs(a.bytesRead - b.bytesRead) / Math.max(a.bytesRead, b.bytesRead) > 0.1) lines.push({ tone: b.bytesRead < a.bytesRead ? 'ok' : 'warn', text: `Bytes loaded per page view: ${fmtBytes(a.bytesRead)} → ${fmtBytes(b.bytesRead)}` });
  if (a.fanout !== b.fanout) lines.push({ tone: b.fanout < a.fanout ? 'ok' : 'warn', text: `Author rename touches ${fmt(a.fanout)} → **${fmt(b.fanout)}** document${b.fanout > 1 ? 's' : ''}` });
  if (a.write.ops !== b.write.ops || Math.abs(a.write.bytes - b.write.bytes) / Math.max(a.write.bytes, b.write.bytes) > 0.1)
    lines.push({ tone: b.write.bytes < a.write.bytes ? 'ok' : 'warn', text: `New comment: ${a.write.ops} → ${b.write.ops} write${b.write.ops > 1 ? 's' : ''}, ~${fmtBytes(a.write.bytes)} → ~${fmtBytes(b.write.bytes)} rewritten` });
  const ni = b.indexes.filter((i) => !a.indexes.includes(i));
  if (ni.length) lines.push({ tone: 'info', text: `Needs index: ${ni.map((i) => `\`${i.split(':')[0]}\``).join(', ')}` });
  if (!lines.length) lines.push({ tone: 'info', text: 'No measurable change.' });
  return lines;
}

export const docEmbedOk = (s: MState) => {
  const e = evalMongo({ ...s, count: MONGO.stress });
  return e.reads.length <= 2 && e.docBytes <= MONGO.safe;
};
