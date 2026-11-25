import type { DTable, ReqContext, Scenario, Schema } from '../types';
import { analyze, Model, pkOf, referenceSchema, sameSet, type Impact } from './analyze';

export interface ReqStatus {
  id: string;
  text: string;
  met: boolean;
  hints: [string, string, string];
}

export interface Closeness {
  score: number;
  parts: { label: string; got: number; of: number }[];
  missing: string[];
}

export type Verdict = 'good' | 'wrong' | 'extra';

export interface Evaluation {
  impact: Impact;
  reqs: ReqStatus[];
  met: number;
  closeness: Closeness;
  verdicts: Record<string, Verdict>;
  solved: boolean;
}

export function makeCtx(_sc: Scenario, schema: Schema, impact: Impact): ReqContext {
  const byTpl = (tpl: string): DTable | undefined => schema.tables.find((t) => t.tpl === tpl);
  return {
    schema,
    impact,
    has: (tpl) => !!byTpl(tpl),
    table: byTpl,
    attrIn: (a, tpl) => !!byTpl(tpl)?.columns.some((c) => c.attr === a),
    readOk: (id) => impact.reads[id]?.level === 'ok',
    writeAtMost: (id, n) => (impact.writes[id]?.rows ?? Infinity) <= n,
    nfAtLeast: (tpl, nf) => {
      const t = byTpl(tpl);
      return !!t && (impact.tables[t.id]?.nf ?? 0) >= nf;
    },
    refs: (c, p) => {
      const ct = byTpl(c);
      const pt = byTpl(p);
      return !!ct && !!pt && impact.rels.some((r) => r.child === ct.id && r.parent === pt.id);
    },
    noIssue: (code) => !impact.issues.some((i) => i.code === code && i.severity !== 'info'),
    pkIs: (tpl, attrs) => {
      const t = byTpl(tpl);
      return !!t && sameSet(pkOf(t), attrs);
    },
  };
}

const tplRels = (schema: Schema, impact: Impact) => {
  const tplOf = new Map(schema.tables.map((t) => [t.id, t.tpl]));
  return new Set(impact.rels.map((r) => `${tplOf.get(r.parent)}>${tplOf.get(r.child)}`));
};

export function closeness(sc: Scenario, schema: Schema, impact: Impact, model: Model): Closeness {
  const ref = referenceSchema(sc);
  const refImpact = analyze(sc, ref, model);
  const used = new Set(schema.tables.map((t) => t.tpl));
  const refTpls = sc.reference;
  const traps = schema.tables.filter((t) => sc.templates.find((x) => x.id === t.tpl)?.trap);
  const missing: string[] = [];

  const tGot = refTpls.filter((t) => used.has(t)).length;
  for (const t of refTpls) if (!used.has(t)) missing.push(`Add the ${sc.templates.find((x) => x.id === t)?.name ?? t} table`);

  let pGot = 0;
  let pOf = 0;
  let kGot = 0;
  for (const rt of ref.tables) {
    const mine = schema.tables.find((t) => t.tpl === rt.tpl);
    for (const c of rt.columns) {
      pOf++;
      if (mine?.columns.some((x) => x.attr === c.attr)) pGot++;
    }
    if (mine && sameSet(pkOf(mine), pkOf(rt))) kGot++;
    else if (mine) missing.push(`Fix the key of ${mine.name} (should be ${pkOf(rt).map((a) => model.attr.get(a)?.name ?? a).join(', ')})`);
  }
  // attributes that belong nowhere in the reference table they sit in
  let stray = 0;
  for (const t of schema.tables) {
    const rt = ref.tables.find((r) => r.tpl === t.tpl);
    if (rt) stray += t.columns.filter((c) => !rt.columns.some((x) => x.attr === c.attr)).length;
  }
  if (pOf - pGot > 0 && tGot === refTpls.length) missing.push(`Place ${pOf - pGot} more column(s) in the right table`);
  if (stray) missing.push(`Move ${stray} column(s) that don't belong where they are`);

  const refR = tplRels(ref, refImpact);
  const mine = tplRels(schema, impact);
  const rGot = [...refR].filter((r) => mine.has(r)).length;
  if (refR.size - rGot > 0 && tGot === refTpls.length) missing.push(`Add ${refR.size - rGot} relationship(s)`);
  if (traps.length) missing.unshift(`Remove ${traps.map((t) => t.name).join(', ')}`);

  const frac = (g: number, o: number) => (o ? g / o : 1);
  const raw =
    0.35 * frac(tGot, refTpls.length) +
    0.3 * Math.max(0, frac(pGot, pOf) - stray * 0.02) +
    0.15 * frac(kGot, ref.tables.length) +
    0.2 * frac(rGot, refR.size);
  const score = Math.max(0, Math.round(100 * raw - traps.length * 12));
  return {
    score: Math.min(100, score),
    parts: [
      { label: 'tables', got: tGot, of: refTpls.length },
      { label: 'columns placed', got: pGot, of: pOf },
      { label: 'keys', got: kGot, of: ref.tables.length },
      { label: 'relationships', got: rGot, of: refR.size },
    ],
    missing,
  };
}

const cache = new WeakMap<Scenario, Model>();
export function modelOf(sc: Scenario): Model {
  let m = cache.get(sc);
  if (!m) {
    m = new Model(sc);
    cache.set(sc, m);
  }
  return m;
}

export function evaluate(sc: Scenario, schema: Schema): Evaluation {
  const model = modelOf(sc);
  const impact = analyze(sc, schema, model);
  const ctx = makeCtx(sc, schema, impact);
  const reqs = sc.requirements.map((r) => {
    let met = false;
    try {
      met = r.check(ctx);
    } catch {
      met = false;
    }
    return { id: r.id, text: r.text, met, hints: r.hints };
  });
  const verdicts: Record<string, Verdict> = {};
  for (const t of schema.tables) {
    const tpl = sc.templates.find((x) => x.id === t.tpl);
    verdicts[t.id] = tpl?.trap ? 'wrong' : sc.reference.includes(t.tpl) ? 'good' : 'extra';
  }
  const met = reqs.filter((r) => r.met).length;
  const hasTrap = Object.values(verdicts).includes('wrong');
  const solved = met === reqs.length && impact.counts.bad === 0 && !hasTrap;
  return { impact, reqs, met, closeness: closeness(sc, schema, impact, model), verdicts, solved };
}
