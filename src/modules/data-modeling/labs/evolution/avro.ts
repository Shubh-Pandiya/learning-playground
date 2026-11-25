/* Avro schema resolution + Confluent Schema Registry compatibility modes.
   Field-level model of a record: just enough to be faithful to the spec
   (https://avro.apache.org/docs/1.11.1/specification/#schema-resolution). */

export type Prim = 'int' | 'long' | 'float' | 'double' | 'string' | 'bytes' | 'boolean';
export type FType = { k: 'prim'; p: Prim } | { k: 'opt'; p: Prim } | { k: 'enum'; name: string; symbols: string[]; default?: string };

export interface Field {
  name: string;
  type: FType;
  /** JSON text of the default, if any */
  def?: string;
  aliases?: string[];
}

export interface Schema {
  fields: Field[];
}

export const prim = (p: Prim): FType => ({ k: 'prim', p });

export const V1: Schema = {
  fields: [
    { name: 'order_id', type: prim('string') },
    { name: 'customer_id', type: prim('long') },
    { name: 'amount', type: prim('long') },
    { name: 'quantity', type: prim('int') },
    { name: 'discount', type: prim('long') },
    { name: 'store_id', type: prim('int') },
    { name: 'status', type: { k: 'enum', name: 'OrderStatus', symbols: ['PLACED', 'PAID', 'SHIPPED'] } },
    { name: 'sales_rep', type: prim('string') },
    { name: 'legacy_channel', type: prim('string'), def: '"web"' },
  ],
};

export function typeText(t: FType): string {
  if (t.k === 'prim') return `"${t.p}"`;
  if (t.k === 'opt') return `["null", "${t.p}"]`;
  return `{"type": "enum", "name": "${t.name}", "symbols": [${t.symbols.map((s) => `"${s}"`).join(', ')}]${t.default ? `, "default": "${t.default}"` : ''}}`;
}
export const typeShort = (t: FType) => (t.k === 'prim' ? t.p : t.k === 'opt' ? `null|${t.p}` : `enum{${t.symbols.join(',')}}`);

const field = (s: Schema, n: string) => s.fields.find((f) => f.name === n);
export const has = (s: Schema, n: string) => !!field(s, n);

/* ── resolution ─────────────────────────────────────────────────────── */

const PROMO: Partial<Record<Prim, Prim[]>> = {
  int: ['long', 'float', 'double'],
  long: ['float', 'double'],
  float: ['double'],
  string: ['bytes'],
  bytes: ['string'],
};
const promotes = (w: Prim, r: Prim) => w === r || !!PROMO[w]?.includes(r);

/** null = resolvable; otherwise the reason */
function resolveType(w: FType, r: FType, name: string): { err?: string; note?: string } {
  if (w.k === 'enum' || r.k === 'enum') {
    if (w.k !== 'enum' || r.k !== 'enum') return { err: `\`${name}\`: an enum and a non-enum don’t resolve.` };
    const unknown = w.symbols.filter((x) => !r.symbols.includes(x));
    if (!unknown.length) return w.symbols.length === r.symbols.length ? {} : { note: `\`${name}\`: reader knows every symbol the writer can emit.` };
    if (r.default) return { note: `\`${name}\`: unknown symbol ${unknown.join(', ')} maps to the reader’s enum default \`${r.default}\`.` };
    return { err: `\`${name}\`: writer can emit **${unknown.join(', ')}**, which the reader’s enum doesn’t have, and the reader enum has no default → decode error.` };
  }
  if (w.k === 'opt' && r.k === 'prim') return { err: `\`${name}\`: writer may send null, but the reader type \`${r.p}\` isn’t nullable.` };
  if (promotes(w.p, r.p)) {
    if (w.p !== r.p) return { note: `\`${name}\`: ${w.p} → ${r.p} is a legal promotion (widening).` };
    if (w.k !== r.k) return { note: `\`${name}\`: writer’s ${w.p} fits the reader’s nullable union.` };
    return {};
  }
  return { err: `\`${name}\`: writer **${w.p}** can’t be read as **${r.p}** (only int→long/float/double, long→float/double, float→double, string↔bytes promote).` };
}

export interface Note {
  ok: boolean;
  text: string;
}
export interface Resolution {
  ok: boolean;
  notes: Note[];
}

/** Can a consumer with schema `reader` decode data written with `writer`? */
export function canRead(reader: Schema, writer: Schema): Resolution {
  const notes: Note[] = [];
  const used = new Set<string>();
  for (const rf of reader.fields) {
    let wf = field(writer, rf.name);
    let viaAlias = false;
    if (!wf && rf.aliases) {
      wf = writer.fields.find((f) => rf.aliases!.includes(f.name));
      viaAlias = !!wf;
    }
    if (!wf) {
      if (rf.def !== undefined) notes.push({ ok: true, text: `\`${rf.name}\` is absent from the data → reader fills its default \`${rf.def}\`.` });
      else notes.push({ ok: false, text: `Reader needs \`${rf.name}\`, the data doesn’t have it, and the reader schema gives **no default** → error.` });
      continue;
    }
    used.add(wf.name);
    if (viaAlias) notes.push({ ok: true, text: `Reader field \`${rf.name}\` matches writer field \`${wf.name}\` through its alias.` });
    const t = resolveType(wf.type, rf.type, rf.name);
    if (t.err) notes.push({ ok: false, text: t.err });
    else if (t.note) notes.push({ ok: true, text: t.note });
  }
  for (const wf of writer.fields) if (!used.has(wf.name)) notes.push({ ok: true, text: `\`${wf.name}\` is in the data but not in the reader schema → skipped.` });
  return { ok: notes.every((n) => n.ok), notes };
}

/* ── registry modes ─────────────────────────────────────────────────── */

export type Mode = 'NONE' | 'BACKWARD' | 'BACKWARD_TRANSITIVE' | 'FORWARD' | 'FORWARD_TRANSITIVE' | 'FULL' | 'FULL_TRANSITIVE';
export const MODES: { id: Mode; rule: string }[] = [
  { id: 'BACKWARD', rule: 'new schema reads data of the **latest** version (Confluent default)' },
  { id: 'BACKWARD_TRANSITIVE', rule: 'new schema reads data of **every** earlier version' },
  { id: 'FORWARD', rule: '**latest** schema reads data of the new version' },
  { id: 'FORWARD_TRANSITIVE', rule: '**every** earlier schema reads data of the new version' },
  { id: 'FULL', rule: 'BACKWARD and FORWARD against the latest' },
  { id: 'FULL_TRANSITIVE', rule: 'BACKWARD and FORWARD against every earlier version' },
  { id: 'NONE', rule: 'no checks: anything registers' },
];

export interface Check {
  version: number;
  dir: 'backward' | 'forward';
  res: Resolution;
}
export interface Attempt {
  accepted: boolean;
  checks: Check[];
  back: Resolution;
  fwd: Resolution;
}

export function attempt(mode: Mode, versions: Schema[], cand: Schema): Attempt {
  const latest = versions[versions.length - 1];
  const back = canRead(cand, latest);
  const fwd = canRead(latest, cand);
  const checks: Check[] = [];
  const targets = mode.endsWith('TRANSITIVE') ? versions.map((_, i) => i) : [versions.length - 1];
  const doBack = mode.startsWith('BACKWARD') || mode.startsWith('FULL');
  const doFwd = mode.startsWith('FORWARD') || mode.startsWith('FULL');
  for (const i of targets) {
    if (doBack) checks.push({ version: i + 1, dir: 'backward', res: canRead(cand, versions[i]) });
    if (doFwd) checks.push({ version: i + 1, dir: 'forward', res: canRead(versions[i], cand) });
  }
  return { accepted: checks.every((c) => c.res.ok), checks, back, fwd };
}

export function deployOrder(back: boolean, fwd: boolean): { title: string; text: string; tone: 'ok' | 'info' | 'bad' } {
  if (back && fwd) return { title: 'Any order', text: 'Fully compatible: old and new consumers read both old and new events. Upgrade producers and consumers independently.', tone: 'ok' };
  if (back) return { title: 'Consumers first', text: 'New consumers read old data, but old consumers can’t read new data. Upgrade every consumer, **then** let producers emit the new version.', tone: 'info' };
  if (fwd) return { title: 'Producers first', text: 'Old consumers read new data, but new consumers can’t read old data. Upgrade producers first; upgrade consumers once old events have aged out of the topic.', tone: 'info' };
  return { title: 'No safe order', text: 'Breaking both ways: publish to a new topic (`order-placed-v2`), dual-publish during migration, or translate in a stream job.', tone: 'bad' };
}

/* ── change catalogue ───────────────────────────────────────────────── */

export interface ChangeDef {
  id: string;
  label: string;
  /** null when it can be applied to this schema, else the reason it can't */
  blocked: (s: Schema) => string | null;
  apply: (s: Schema) => Schema;
}

const mapField = (s: Schema, n: string, f: (x: Field) => Field): Schema => ({ fields: s.fields.map((x) => (x.name === n ? f(x) : x)) });
const drop = (s: Schema, n: string): Schema => ({ fields: s.fields.filter((x) => x.name !== n) });
const add = (s: Schema, f: Field): Schema => ({ fields: [...s.fields, f] });
const isPrim = (s: Schema, n: string, p: Prim) => {
  const f = field(s, n);
  return !!f && f.type.k === 'prim' && f.type.p === p;
};

export const CHANGES: ChangeDef[] = [
  {
    id: 'add-optional',
    label: 'Add optional `coupon_code` (null|string, default null)',
    blocked: (s) => (has(s, 'coupon_code') ? 'already added' : null),
    apply: (s) => add(s, { name: 'coupon_code', type: { k: 'opt', p: 'string' }, def: 'null' }),
  },
  {
    id: 'add-required',
    label: 'Add required `channel` (string, no default)',
    blocked: (s) => (has(s, 'channel') ? 'already added' : null),
    apply: (s) => add(s, { name: 'channel', type: prim('string') }),
  },
  {
    id: 'remove-default',
    label: 'Remove `legacy_channel` (has default "web")',
    blocked: (s) => (!has(s, 'legacy_channel') ? 'already removed' : null),
    apply: (s) => drop(s, 'legacy_channel'),
  },
  {
    id: 'remove-required',
    label: 'Remove `sales_rep`',
    blocked: (s) => (!has(s, 'sales_rep') ? 'already removed' : null),
    apply: (s) => drop(s, 'sales_rep'),
  },
  {
    id: 'default-sales-rep',
    label: 'Give `sales_rep` a default ("")',
    blocked: (s) => (!has(s, 'sales_rep') ? 'field removed' : field(s, 'sales_rep')!.def !== undefined ? 'already has a default' : null),
    apply: (s) => mapField(s, 'sales_rep', (f) => ({ ...f, def: '""' })),
  },
  {
    id: 'rename-alias',
    label: 'Rename `amount` → `total_amount` with alias "amount"',
    blocked: (s) => (!has(s, 'amount') ? 'no field `amount`' : null),
    apply: (s) => mapField(s, 'amount', (f) => ({ ...f, name: 'total_amount', aliases: ['amount'] })),
  },
  {
    id: 'rename-noalias',
    label: 'Rename `amount` → `total_amount` (no alias)',
    blocked: (s) => (!has(s, 'amount') ? 'no field `amount`' : null),
    apply: (s) => mapField(s, 'amount', (f) => ({ ...f, name: 'total_amount' })),
  },
  {
    id: 'int-long',
    label: '`quantity` int → long',
    blocked: (s) => (!isPrim(s, 'quantity', 'int') ? 'quantity isn’t int' : null),
    apply: (s) => mapField(s, 'quantity', (f) => ({ ...f, type: prim('long') })),
  },
  {
    id: 'add-quantity-long',
    label: 'Add `quantity_long` (null|long, default null)',
    blocked: (s) => (has(s, 'quantity_long') ? 'already added' : null),
    apply: (s) => add(s, { name: 'quantity_long', type: { k: 'opt', p: 'long' }, def: 'null' }),
  },
  {
    id: 'long-int',
    label: '`discount` long → int',
    blocked: (s) => (!isPrim(s, 'discount', 'long') ? 'discount isn’t long' : null),
    apply: (s) => mapField(s, 'discount', (f) => ({ ...f, type: prim('int') })),
  },
  {
    id: 'int-string',
    label: '`store_id` int → string',
    blocked: (s) => (!isPrim(s, 'store_id', 'int') ? 'store_id isn’t int' : null),
    apply: (s) => mapField(s, 'store_id', (f) => ({ ...f, type: prim('string') })),
  },
  {
    id: 'enum-add',
    label: 'Add enum symbol `CANCELLED` to `status`',
    blocked: (s) => {
      const f = field(s, 'status');
      return !f || f.type.k !== 'enum' ? 'no enum' : f.type.symbols.includes('CANCELLED') ? 'already added' : null;
    },
    apply: (s) => mapField(s, 'status', (f) => (f.type.k === 'enum' ? { ...f, type: { ...f.type, symbols: [...f.type.symbols, 'CANCELLED'] } } : f)),
  },
];

/* ── missions (exercises) ───────────────────────────────────────────── */

export interface Goal {
  text: string;
  met: (s: Schema) => boolean;
}
export interface Mission {
  exId: 'contract-backward' | 'contract-full';
  mode: Mode;
  title: string;
  brief: string;
  goals: Goal[];
}

export const MISSIONS: Mission[] = [
  {
    exId: 'contract-backward',
    mode: 'BACKWARD',
    title: 'Ship four changes under BACKWARD',
    brief: 'The subject is BACKWARD (Confluent’s default). Get all four product asks registered. A rejected attempt costs nothing but shows you why.',
    goals: [
      { text: 'Optional `coupon_code` exists', met: (s) => has(s, 'coupon_code') },
      { text: '`amount` is now called `total_amount`', met: (s) => has(s, 'total_amount') && !has(s, 'amount') },
      { text: '`quantity` is a long', met: (s) => isPrim(s, 'quantity', 'long') },
      { text: '`sales_rep` is gone', met: (s) => !has(s, 'sales_rep') },
    ],
  },
  {
    exId: 'contract-full',
    mode: 'FULL',
    title: 'Ship the cleanup under FULL',
    brief: 'The subject is FULL: every version must work for old and new consumers. Some asks need a two-step path or a different shape.',
    goals: [
      { text: 'Optional `coupon_code` exists', met: (s) => has(s, 'coupon_code') },
      { text: '`legacy_channel` is gone', met: (s) => !has(s, 'legacy_channel') },
      { text: '`sales_rep` is gone', met: (s) => !has(s, 'sales_rep') },
      { text: 'Quantities above 2³¹ can be sent', met: (s) => isPrim(s, 'quantity', 'long') || has(s, 'quantity_long') },
    ],
  },
];

/** Field-level diff for rendering: status per field name of `next` plus removed ones from `prev`. */
export function diffSchemas(prev: Schema, next: Schema): { f: Field; st: 'same' | 'added' | 'removed' | 'changed' }[] {
  const out: { f: Field; st: 'same' | 'added' | 'removed' | 'changed' }[] = [];
  for (const f of next.fields) {
    const p = field(prev, f.name) ?? (f.aliases ? prev.fields.find((x) => f.aliases!.includes(x.name)) : undefined);
    if (!p) out.push({ f, st: 'added' });
    else out.push({ f, st: JSON.stringify(p) === JSON.stringify(f) ? 'same' : 'changed' });
  }
  for (const p of prev.fields) {
    const kept = next.fields.some((f) => f.name === p.name || f.aliases?.includes(p.name));
    if (!kept) out.push({ f: p, st: 'removed' });
  }
  return out;
}
