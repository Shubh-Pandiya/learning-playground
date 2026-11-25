import type { Change, ChangeLine } from '../../ui/ChangeCard';
import { CUSTOMER_ID, HIST_ROW_BYTES, ROW_BYTES, SCALE_CUSTOMERS, SIGNUP, TIMELINE, type Attr, type Dim, type Profile, type ScdType } from './data';

export const OPEN_END = '9999-12-31';

export interface DimRow {
  /** Stable React key: `d<sk>` for dim rows, `h<n>` for history rows. */
  rid: string;
  sk: number;
  custId: string;
  name: string;
  city: string;
  segment: string;
  channel: string;
  prevCity?: string | null;
  prevSegment?: string | null;
  curCity?: string;
  curSegment?: string;
  validFrom?: string;
  validTo?: string;
  isCurrent?: boolean;
  /** 1-based version number, used to colour-link facts to the row they reference. */
  version: number;
}

export interface FactRow {
  id: string;
  date: string;
  month: string;
  amount: number;
  sk: number;
  version: number;
}

export type Touch = 'insert' | 'update' | 'expire';

export interface Frame {
  step: number;
  dim: DimRow[];
  hist: DimRow[];
  facts: FactRow[];
  touched: Record<string, Touch>;
  /** rid → fields whose value changed this step */
  changed: Record<string, string[]>;
  ops: string[];
  inserts: number;
  updates: number;
  /** A source change arrived and the type discarded it (Type 0). */
  ignored: boolean;
  /** Source-of-truth profile after this step. */
  truth: Profile;
}

const fieldOf = (a: Attr) => a;
const prevKey = (a: Attr): keyof DimRow => (a === 'city' ? 'prevCity' : 'prevSegment');
const curKey = (a: Attr): keyof DimRow => (a === 'city' ? 'curCity' : 'curSegment');
const colName: Record<string, string> = { city: 'city', segment: 'segment', name: 'name', prevCity: 'prev_city', prevSegment: 'prev_seg', curCity: 'cur_city', curSegment: 'cur_seg' };

function patchRow(row: DimRow, patch: Partial<DimRow>, changed: Record<string, string[]>): DimRow {
  const next = { ...row, ...patch };
  const a = row as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  const fields = Object.keys(patch).filter((k) => a[k] !== b[k]);
  if (fields.length) changed[row.rid] = [...(changed[row.rid] ?? []), ...fields];
  return next;
}

/** Replays the whole timeline under one SCD type; one frame per month. */
export function simulate(type: ScdType): Frame[] {
  const frames: Frame[] = [];
  let dim: DimRow[] = [];
  let hist: DimRow[] = [];
  const facts: FactRow[] = [];
  let truth: Profile = { ...SIGNUP };
  let histSeq = 0;
  const versioned = type === 2 || type === 6;

  TIMELINE.forEach((ev, step) => {
    const touched: Record<string, Touch> = {};
    const changed: Record<string, string[]> = {};
    const ops: string[] = [];
    let inserts = 0;
    let updates = 0;
    let ignored = false;
    const c = ev.change;

    if (c?.kind === 'signup') {
      truth = { ...SIGNUP };
      const row: DimRow = { rid: 'd1', sk: 1, custId: CUSTOMER_ID, ...SIGNUP, version: 1 };
      if (versioned) Object.assign(row, { validFrom: c.date, validTo: OPEN_END, isCurrent: true });
      if (type === 3) Object.assign(row, { prevCity: null, prevSegment: null });
      if (type === 6) Object.assign(row, { curCity: SIGNUP.city, curSegment: SIGNUP.segment });
      dim = [row];
      touched.d1 = 'insert';
      inserts++;
      ops.push(`INSERT INTO dim_customer … → sk 1 (${SIGNUP.city}, ${SIGNUP.segment})`);
      if (type === 4) {
        histSeq++;
        hist = [{ rid: `h${histSeq}`, sk: histSeq, custId: CUSTOMER_ID, ...SIGNUP, validFrom: c.date, validTo: OPEN_END, version: 1 }];
        touched[`h${histSeq}`] = 'insert';
        inserts++;
        ops.push(`INSERT INTO dim_customer_history … → version 1 [${c.date}, ∞)`);
      }
    } else if (c && c.attr && c.to !== undefined) {
      const attr = c.attr;
      const to = c.to;
      const f = fieldOf(attr);
      truth = { ...truth, [attr]: to };
      if (type === 0) {
        ignored = true;
        ops.push(`-- source sent ${attr} = '${to}': discarded (Type 0 keeps '${c.from}')`);
      } else if (c.kind === 'correction') {
        // Corrections are Type 1 in every design: overwrite every row that carries the value.
        const all = type === 2 || type === 6;
        dim = dim.map((r, i) => {
          if (!all && i !== dim.length - 1) return r;
          touched[r.rid] = 'update';
          updates++;
          return patchRow(r, { [f]: to } as Partial<DimRow>, changed);
        });
        ops.push(`UPDATE dim_customer SET ${attr} = '${to}' WHERE customer_id = '${CUSTOMER_ID}'  -- ${dim.length} row${dim.length > 1 ? 's' : ''}`);
        if (type === 4) {
          hist = hist.map((r) => {
            touched[r.rid] = 'update';
            updates++;
            return patchRow(r, { [f]: to } as Partial<DimRow>, changed);
          });
          ops.push(`UPDATE dim_customer_history SET ${attr} = '${to}' WHERE customer_id = '${CUSTOMER_ID}'  -- ${hist.length} rows`);
        }
      } else if (type === 1) {
        dim = dim.map((r) => patchRow(r, { [f]: to } as Partial<DimRow>, changed));
        touched[dim[0].rid] = 'update';
        updates++;
        ops.push(`UPDATE dim_customer SET ${attr} = '${to}' WHERE customer_id = '${CUSTOMER_ID}'`);
      } else if (type === 3) {
        dim = dim.map((r) => patchRow(r, { [prevKey(attr)]: r[f], [f]: to } as Partial<DimRow>, changed));
        touched[dim[0].rid] = 'update';
        updates++;
        ops.push(`UPDATE dim_customer SET ${colName[prevKey(attr)]} = ${attr}, ${attr} = '${to}'`);
      } else if (type === 4) {
        dim = dim.map((r) => patchRow(r, { [f]: to } as Partial<DimRow>, changed));
        touched[dim[0].rid] = 'update';
        updates++;
        ops.push(`UPDATE dim_customer SET ${attr} = '${to}'  -- current table, Type 1`);
        const open = hist[hist.length - 1];
        hist = hist.map((r) => (r.rid === open.rid ? patchRow(r, { validTo: c.date }, changed) : r));
        touched[open.rid] = 'expire';
        updates++;
        histSeq++;
        const nh: DimRow = { ...open, rid: `h${histSeq}`, sk: histSeq, [f]: to, validFrom: c.date, validTo: OPEN_END, version: open.version + 1 };
        hist = [...hist, nh];
        touched[nh.rid] = 'insert';
        inserts++;
        ops.push(`UPDATE dim_customer_history SET valid_to = '${c.date}' WHERE hist_id = ${open.sk}`);
        ops.push(`INSERT INTO dim_customer_history … → version ${nh.version} [${c.date}, ∞)`);
      } else {
        // Type 2 / Type 6: expire current version, insert new one.
        const cur = dim.find((r) => r.isCurrent)!;
        const sk = Math.max(...dim.map((r) => r.sk)) + 1;
        dim = dim.map((r) => {
          if (r.rid === cur.rid) {
            touched[r.rid] = 'expire';
            updates++;
            return patchRow(r, { validTo: c.date, isCurrent: false, ...(type === 6 ? { [curKey(attr)]: to } : {}) }, changed);
          }
          if (type === 6) {
            touched[r.rid] = 'update';
            updates++;
            return patchRow(r, { [curKey(attr)]: to } as Partial<DimRow>, changed);
          }
          return r;
        });
        const nr: DimRow = { ...cur, rid: `d${sk}`, sk, [f]: to, validFrom: c.date, validTo: OPEN_END, isCurrent: true, version: cur.version + 1 };
        if (type === 6) Object.assign(nr, { [curKey(attr)]: to });
        dim = [...dim, nr];
        touched[nr.rid] = 'insert';
        inserts++;
        ops.push(`UPDATE dim_customer SET valid_to = '${c.date}', is_current = false WHERE customer_sk = ${cur.sk}`);
        if (type === 6) ops.push(`UPDATE dim_customer SET ${colName[curKey(attr)]} = '${to}' WHERE customer_id = '${CUSTOMER_ID}'  -- all ${dim.length - 1} old version${dim.length > 2 ? 's' : ''}`);
        ops.push(`INSERT INTO dim_customer … → sk ${sk} (${nr.city}, ${nr.segment}) [${c.date}, ∞)`);
      }
    }

    // The sale: facts resolve the surrogate key valid on the sale date.
    const s = ev.sale;
    const row = versioned ? dim.find((r) => r.validFrom! <= s.date && s.date < r.validTo!)! : dim[0];
    facts.push({ id: s.id, date: s.date, month: ev.month, amount: s.amount, sk: row.sk, version: row.version });
    frames.push({ step, dim, hist, facts: [...facts], touched, changed, ops, inserts, updates, ignored, truth: { ...truth } });
  });
  return frames;
}

/** Source-of-truth profile on a given date. */
export function truthAt(date: string): Profile {
  let p = { ...SIGNUP };
  for (const ev of TIMELINE) {
    const c = ev.change;
    if (c && c.kind !== 'signup' && c.attr && c.to !== undefined && c.date <= date) p = { ...p, [c.attr]: c.to };
  }
  return p;
}

export interface View {
  totals: Record<string, number>;
  perFact: Record<string, string>;
  how: string;
  /** Can this type answer the question at all (vs silently returning something else)? */
  supported: boolean;
  correct: boolean;
}

export interface Report {
  asWas: View;
  asIs: View;
  truthWas: Record<string, number>;
  truthIs: Record<string, number>;
  values: string[];
}

export const DIM_VALUES: Record<Dim, string[]> = { city: ['Pune', 'Mumbai'], segment: ['Silver', 'Gold'] };

function view(facts: FactRow[], pick: (f: FactRow) => string, truth: (f: FactRow) => string, how: string, supported: boolean): View {
  const totals: Record<string, number> = {};
  const perFact: Record<string, string> = {};
  let correct = true;
  for (const f of facts) {
    const v = pick(f);
    perFact[f.id] = v;
    totals[v] = (totals[v] ?? 0) + f.amount;
    if (v !== truth(f)) correct = false;
  }
  return { totals, perFact, how, supported, correct };
}

const sumBy = (facts: FactRow[], key: (f: FactRow) => string) =>
  facts.reduce<Record<string, number>>((acc, f) => ({ ...acc, [key(f)]: (acc[key(f)] ?? 0) + f.amount }), {});

/** Runs "revenue by <dim>" both as-was and as-is against the tables this type produced. */
export function report(type: ScdType, fr: Frame, dim: Dim): Report {
  const bySk = (sk: number) => fr.dim.find((r) => r.sk === sk)!;
  const ck = curKey(dim) as 'curCity' | 'curSegment';
  const tWas = (f: FactRow) => truthAt(f.date)[dim];
  const tIs = () => fr.truth[dim];
  const col = `d.${dim}`;

  let asWas: View;
  if (type === 2 || type === 6) asWas = view(fr.facts, (f) => bySk(f.sk)[dim], tWas, `JOIN dim ON customer_sk · GROUP BY ${col}`, true);
  else if (type === 4)
    asWas = view(
      fr.facts,
      (f) => fr.hist.find((h) => h.validFrom! <= f.date && f.date < h.validTo!)![dim],
      tWas,
      `JOIN history h ON sale_date ∈ [valid_from, valid_to) · GROUP BY h.${dim}`,
      true,
    );
  else
    asWas = view(
      fr.facts,
      (f) => bySk(f.sk)[dim],
      tWas,
      type === 0 ? `GROUP BY ${col}: frozen at signup` : type === 3 ? `no dates on prev_${dim === 'city' ? 'city' : 'seg'}: falls back to current` : `GROUP BY ${col}: only the current value exists`,
      false,
    );

  let asIs: View;
  if (type === 2)
    asIs = view(
      fr.facts,
      (f) => fr.dim.find((r) => r.custId === bySk(f.sk).custId && r.isCurrent)![dim],
      tIs,
      `self-join d2 ON customer_id AND d2.is_current · GROUP BY d2.${dim}`,
      true,
    );
  else if (type === 6) asIs = view(fr.facts, (f) => bySk(f.sk)[ck] as string, tIs, `same row · GROUP BY d.${dim === 'city' ? 'cur_city' : 'cur_seg'}`, true);
  else asIs = view(fr.facts, (f) => bySk(f.sk)[dim], tIs, type === 0 ? `GROUP BY ${col}: frozen at signup` : type === 4 ? `JOIN dim_customer (current table) · GROUP BY ${col}` : `JOIN ON customer_sk · GROUP BY ${col}`, true);

  return { asWas, asIs, truthWas: sumBy(fr.facts, tWas), truthIs: sumBy(fr.facts, tIs), values: DIM_VALUES[dim] };
}

export const fmtK = (n: number) => `₹${Math.round(n / 1000)}k`;
export function fmtBytes(b: number) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}
export function fmtRows(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

export const rowsOf = (fr: Frame) => fr.dim.length + fr.hist.length;
export const bytesOf = (type: ScdType, fr: Frame) => fr.dim.length * ROW_BYTES[type] + fr.hist.length * HIST_ROW_BYTES;

const MONTH: Record<string, string> = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June' };
const listMonths = (facts: FactRow[]) => facts.map((f) => `${MONTH[f.month]}’s ${fmtK(f.amount)}`).join(' + ');

/** "What changed → impact" for one timeline step under one type. */
export function describe(type: ScdType, frames: Frame[], step: number): Change {
  const fr = frames[step];
  const prev = step > 0 ? frames[step - 1] : undefined;
  const ev = TIMELINE[step];
  const c = ev.change;
  const lines: ChangeLine[] = [];
  const fact = fr.facts[fr.facts.length - 1];
  const rowsBefore = prev ? rowsOf(prev) : 0;
  const rowsAfter = rowsOf(fr);
  const bytesDelta = bytesOf(type, fr) - (prev ? bytesOf(type, prev) : 0);

  const title = c ? `${c.date} · ${c.text}` : `${ev.month} · no dimension change, just a sale`;

  if (!c) {
    lines.push({ tone: 'ok', text: `0 dimension writes. Dimensions change slowly; facts arrive every day.` });
  } else if (fr.ignored) {
    lines.push({
      tone: 'bad',
      text:
        c.kind === 'correction'
          ? `Type 0 discarded the fix: \`${c.from}\` is now permanent. Type 0 is only for immutable attributes (signup_channel, date of birth).`
          : `Type 0 discarded the change: the dim still says **${c.from}**. 0 rows written, but every report from now on is wrong.`,
    });
  } else {
    const tables = type === 4 ? 'dim_customer + dim_customer_history' : 'dim_customer';
    lines.push({
      tone: 'info',
      text: `**${fr.inserts} INSERT · ${fr.updates} UPDATE** on ${tables} · rows for Asha ${rowsBefore} → **${rowsAfter}** (${bytesDelta >= 0 ? '+' : ''}${bytesDelta} B)`,
    });
  }

  if (c && c.kind === 'change' && c.attr && c.attr !== 'name' && prev) {
    const d = c.attr as Dim;
    const rp = report(type, prev, d);
    const rn = report(type, fr, d);
    const old = prev.facts;
    const moved = old.filter((f) => rp.asWas.perFact[f.id] !== rn.asWas.perFact[f.id]);
    if (moved.length) {
      lines.push({
        tone: 'bad',
        text: `Type ${type} rewrote history: ${listMonths(moved)} now show${moved.length === 1 ? 's' : ''} under **${c.to}** in the as-was report (they happened in ${c.from}).`,
      });
    } else if (!fr.ignored) {
      lines.push({ tone: 'ok', text: `As-was intact: ${listMonths(old)} stay${old.length === 1 ? 's' : ''} under **${c.from}** (${rn.asWas.how}).` });
    }
    if (rn.asIs.correct) {
      lines.push({
        tone: type === 2 ? 'warn' : 'ok',
        text:
          type === 2
            ? `As-is works but costs a self-join to the \`is_current\` row of the same \`customer_id\` (an extra join on every as-is report).`
            : `As-is follows the change: all ${fmtK(fr.facts.reduce((a, f) => a + f.amount, 0))} under **${c.to}** (${rn.asIs.how}).`,
      });
    } else {
      const wrong = fr.facts.filter((f) => rn.asIs.perFact[f.id] !== fr.truth[d]);
      lines.push({ tone: 'bad', text: `As-is wrong: ${fmtK(wrong.reduce((a, f) => a + f.amount, 0))} still reported under **${c.from}** although she is in ${c.to}.` });
    }
    if (type === 3) lines.push({ tone: 'warn', text: `\`prev_${d === 'city' ? 'city' : 'seg'} = ${c.from}\` holds one step only and has no date: a second change overwrites ${c.from} for good.` });
    if (type === 4 && d === 'segment')
      lines.push({
        tone: 'info',
        text: 'Kimball’s Type 4 **mini-dimension** does this for volatile attributes: `dim_profile(profile_sk, segment, …)` has one row per *combination* (a few dozen rows), and each fact stores `profile_sk`.',
      });
  }

  if (c?.kind === 'correction' && !fr.ignored) {
    lines.push({
      tone: 'ok',
      text:
        type === 2 || type === 6
          ? `Corrected on all ${fr.dim.length} versions in place: no fake version, because \`name\` is excluded from the hashdiff (a Type 1 attribute inside a Type 2 dim).`
          : type === 4
            ? `Fixed in the current table and in all ${fr.hist.length} history rows: corrections are not history.`
            : `One row fixed in place.`,
    });
    lines.push({ tone: 'info', text: 'No report regroups: `name` labels rows but isn’t a grouping key for revenue by city/segment.' });
  }

  if (c?.kind === 'signup')
    lines.push({ tone: 'info', text: `\`customer_sk\` is a warehouse-generated surrogate key; \`customer_id = ${CUSTOMER_ID}\` is the source’s natural key.` });

  lines.push({
    tone: 'info',
    text: `New fact ${fact.date} ${fmtK(fact.amount)} → \`customer_sk = ${fact.sk}\`${type === 2 || type === 6 ? ' (the version valid on the sale date)' : type === 4 ? ' (durable key; as-was is resolved through history)' : ''}.`,
  });

  const perCust = rowsOf(fr);
  lines.push({
    tone: perCust > 2 ? 'warn' : 'info',
    text: `Storage: ${fmtBytes(bytesOf(type, fr))} for Asha · if all ${fmtRows(SCALE_CUSTOMERS)} customers did this: **${fmtRows(perCust * SCALE_CUSTOMERS)} rows ≈ ${fmtBytes(bytesOf(type, fr) * SCALE_CUSTOMERS)}**.`,
  });

  return { key: `${type}-${step}`, title, lines };
}
