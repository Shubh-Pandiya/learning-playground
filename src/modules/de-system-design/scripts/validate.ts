/**
 * Content validator for the data-engineering system-design playground.
 * - every scenario's and challenge's reference design solves at 100% with nothing overloaded
 * - every trap (scenario `wrong` kinds + anti components in the palette) is flagged, and adding one breaks "solved"
 * - guided steps, predictions, quizzes, extras and drills are well-formed
 * - palette components have "Inside" internals (warning)
 *
 *   export PATH=/opt/homebrew/bin:$PATH
 *   npx rolldown src/modules/de-system-design/scripts/validate.ts --file node_modules/.cache/desd-validate.mjs \
 *     --platform node --format esm && node node_modules/.cache/desd-validate.mjs [patternId] [--verbose]
 */
import { ALL_KINDS, COMPONENTS } from '../data/components';
import { PATTERNS } from '../data/patterns';
import { CHAOS, predictKill, runChaos } from '../engine/chaos';
import { evaluate, nodeFeedback } from '../engine/evaluate';
import { guidedFrame, referenceGraph } from '../engine/graph';
import { simulate } from '../engine/simulate';
import { ALL_INTERNALS } from '../internals';
import { ADRS, INCIDENTS, REVIEWS } from '../judgment/data';
import type { ComponentKind, Graph, Pattern, Scenario } from '../types';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const filter = args.find((a) => !a.startsWith('--'));
let errors = 0;
let warnings = 0;
const err = (where: string, m: string) => {
  errors++;
  console.log(`  ✗ [${where}] ${m}`);
};
const warn = (where: string, m: string) => {
  warnings++;
  console.log(`  ⚠ [${where}] ${m}`);
};

const internalsKinds = new Set(ALL_INTERNALS.map((i) => i.kind));
const noInternals = new Set(['source', 'anti', 'serve']);

function checkScenario(p: Pattern, s: Scenario) {
  const where = `${p.id}/${s.id}`;
  const ids = new Set<string>();
  for (const n of s.reference.nodes) {
    if (ids.has(n.id)) err(where, `duplicate node id ${n.id}`);
    ids.add(n.id);
    if (!COMPONENTS[n.kind]) err(where, `unknown kind ${n.kind}`);
    else if (!s.palette.includes(n.kind)) err(where, `reference kind ${n.kind} missing from palette`);
  }
  for (const e of s.reference.edges) if (!ids.has(e.from) || !ids.has(e.to)) err(where, `edge ${e.from}->${e.to} references an unknown node`);
  for (const k of s.palette) if (!COMPONENTS[k]) err(where, `unknown palette kind ${k}`);
  if (new Set(s.palette).size !== s.palette.length) warn(where, 'duplicate palette entries');

  const g = referenceGraph(s);
  const ev = evaluate(g, s);
  const m = ev.sim.metrics;
  if (verbose) {
    console.log(
      `  · ${s.id}: fresh=${m.freshness.toFixed(0)}s maxEps=${Math.round(m.maxEps)} sem=${m.semantics} late=${m.late} backfill=${m.backfill} schema=${m.schema} p99=${Math.round(m.queryP99)}ms cost=$${m.cost} spofs=${m.spofs.length} loss=${m.lossRisks.length} files=${m.smallFiles}`,
    );
  }
  for (const r of ev.reqs) if (!r.met) err(where, `reference fails requirement "${r.req.text}" ${JSON.stringify(r.req.check)}`);
  if (ev.close.score !== 100) err(where, `closeness ${ev.close.score} ≠ 100: ${ev.close.missing.join('; ')}`);
  if (!ev.solved) err(where, `reference not solved${ev.close.missing.length ? `: ${ev.close.missing.join('; ')}` : ''}`);
  for (const [id, v] of Object.entries(ev.close.nodeVerdicts)) if (v !== 'good') err(where, `reference node ${id} verdict ${v}`);
  for (const [id, v] of Object.entries(ev.close.edgeVerdicts)) if (v !== 'good') err(where, `reference edge ${id} verdict ${v}: ${ev.close.edgeNotes[id] ?? ''}`);
  for (const n of g.nodes) {
    const ns = ev.sim.nodes[n.id];
    if (!ns) continue;
    if (ns.status === 'overloaded' || ns.status === 'dead') err(where, `reference node ${n.id} is ${ns.status}${ns.note ? `: ${ns.note}` : ''}`);
    if (ns.status === 'hot') warn(where, `reference node ${n.id} runs hot (${Math.round(ns.util * 100)}%)`);
  }

  // traps
  for (const k of Object.keys(s.wrong) as ComponentKind[]) {
    if (nodeFeedback(s, k).verdict !== 'wrong') err(where, `wrong kind ${k} not flagged`);
    if (!s.palette.includes(k)) warn(where, `wrong kind ${k} isn't in the palette`);
    if (s.reference.nodes.some((n) => n.kind === k)) err(where, `wrong kind ${k} is used in the reference`);
  }
  for (const k of s.palette) {
    if (COMPONENTS[k]?.category === 'anti' && nodeFeedback(s, k).verdict !== 'wrong') err(where, `anti component ${k} not flagged`);
  }
  const traps = s.palette.filter((k) => nodeFeedback(s, k).verdict === 'wrong');
  if (traps.length < 2) warn(where, `only ${traps.length} trap(s) in the palette`);
  for (const k of traps) {
    const g2: Graph = { nodes: [...g.nodes, { id: '__trap', kind: k, count: 1, x: 0, y: 0 }], edges: g.edges };
    if (evaluate(g2, s).solved) err(where, `adding trap ${k} still counts as solved`);
  }
  for (const [k] of Object.entries(s.alt ?? {})) if (!s.palette.includes(k as ComponentKind)) warn(where, `alt kind ${k} isn't in the palette`);
  for (const k of s.palette) {
    if (COMPONENTS[k] && !noInternals.has(COMPONENTS[k].category) && !internalsKinds.has(k)) warn(where, `no internals for ${k}`);
  }
}

function checkPattern(p: Pattern) {
  console.log(`${String(p.num).padStart(2)}. ${p.title} (${p.id})`);
  checkScenario(p, p.scenario);
  checkScenario(p, p.challenge);
  if (p.scenario.id === p.challenge.id) err(p.id, 'scenario and challenge share an id');

  const allIds = new Set([...p.scenario.reference.nodes, ...(p.extras?.nodes ?? [])].map((n) => n.id));
  for (const n of p.extras?.nodes ?? []) if (!COMPONENTS[n.kind]) err(p.id, `extra node ${n.id} has unknown kind ${n.kind}`);
  for (const e of p.extras?.edges ?? []) if (!allIds.has(e.from) || !allIds.has(e.to)) err(p.id, `extra edge ${e.from}->${e.to} references an unknown node`);

  p.guided.forEach((st, i) => {
    const w = `${p.id} step ${i + 1}`;
    for (const id of [...(st.add ?? []), ...(st.remove ?? []), ...(st.kill ?? [])]) if (!allIds.has(id)) err(w, `unknown node ${id}`);
    if (st.predict && (st.predict.answer < 0 || st.predict.answer >= st.predict.options.length)) err(w, 'predict answer out of range');
    const fr = guidedFrame(p, i);
    for (const id of st.kill ?? []) {
      if (!fr.visible.has(id)) err(w, `kills ${id} which isn't visible`);
      const r = predictKill(guidedFrame(p, i, false).graph, p.scenario.workload, id);
      if (verbose) console.log(`    ${w}: kill ${id} → ${r.outcome} — ${r.why}`);
    }
    if (fr.chaos) {
      const r = runChaos(fr.graph, p.scenario.workload, fr.chaos);
      if (verbose) console.log(`    ${w}: chaos ${fr.chaos} → ${r.outcome} — ${r.why[0] ?? ''}`);
    }
    simulate(fr.graph, p.scenario.workload, { traffic: fr.traffic });
  });
  const final = guidedFrame(p, p.guided.length - 1).visible;
  for (const n of p.scenario.reference.nodes) if (!final.has(n.id)) err(p.id, `reference node ${n.id} isn't visible at the last guided step`);
  if (p.guided.length < 4) warn(p.id, `only ${p.guided.length} guided steps`);
  if (p.quiz.length < 3) warn(p.id, `only ${p.quiz.length} quiz questions`);
  const qids = new Set<string>();
  for (const q of p.quiz) {
    if (qids.has(q.id)) err(p.id, `duplicate quiz id ${q.id}`);
    qids.add(q.id);
    if (q.answer < 0 || q.answer >= q.options.length) err(p.id, `quiz ${q.id} answer out of range`);
  }
}

const nums = new Set<number>();
const pids = new Set<string>();
const sids = new Set<string>();
for (const p of PATTERNS) {
  if (nums.has(p.num)) err(p.id, `duplicate num ${p.num}`);
  if (pids.has(p.id)) err(p.id, 'duplicate pattern id');
  for (const sid of [p.scenario.id, p.challenge.id]) {
    if (sids.has(sid)) err(p.id, `duplicate scenario id ${sid}`);
    sids.add(sid);
  }
  nums.add(p.num);
  pids.add(p.id);
  if (filter && p.id !== filter) continue;
  checkPattern(p);
}

if (!filter) {
  console.log('Internals');
  const seen = new Set<string>();
  for (const i of ALL_INTERNALS) {
    const w = `inside/${i.kind}`;
    if (seen.has(i.kind)) err(w, 'duplicate internals');
    seen.add(i.kind);
    if (!COMPONENTS[i.kind]) err(w, 'unknown kind');
    if (i.parts.length < 4 || i.parts.length > 7) warn(w, `${i.parts.length} parts (want 4–7)`);
    const parts = new Set(i.parts.map((x) => x.id));
    for (const f of i.flow) if (!parts.has(f.part)) err(w, `flow step "${f.title}" references unknown part ${f.part}`);
  }
  for (const k of ALL_KINDS) if (!noInternals.has(COMPONENTS[k].category) && !internalsKinds.has(k)) warn('inside', `missing internals for ${k}`);

  console.log('Judgment drills');
  const checkDrillGraph = (w: string, g: { nodes: { id: string; kind: ComponentKind }[]; edges: { from: string; to: string }[] }) => {
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const n of g.nodes) if (!COMPONENTS[n.kind]) err(w, `unknown kind ${n.kind}`);
    for (const e of g.edges) if (!ids.has(e.from) || !ids.has(e.to)) err(w, `edge ${e.from}->${e.to} references an unknown node`);
    return ids;
  };
  for (const r of REVIEWS) {
    const w = `review/${r.id}`;
    const ids = checkDrillGraph(w, r.graph);
    for (const f of r.flaws) {
      const t = f.target.split('->');
      if (!t.every((x) => ids.has(x))) err(w, `flaw target ${f.target} unknown`);
      else if (t.length === 2 && !r.graph.edges.some((e) => e.from === t[0] && e.to === t[1])) err(w, `flaw edge ${f.target} isn't in the graph`);
    }
    for (const pid of r.patterns) if (!pids.has(pid)) err(w, `unknown pattern ${pid}`);
  }
  for (const c of INCIDENTS) {
    const w = `incident/${c.id}`;
    const ids = checkDrillGraph(w, c.graph);
    for (const d of c.inject.down ?? []) if (!ids.has(d.node)) err(w, `inject down unknown node ${d.node}`);
    for (const st of c.stages) if (st.answer < 0 || st.answer >= st.options.length) err(w, `stage "${st.title}" answer out of range`);
    for (const pid of c.patterns) if (!pids.has(pid)) err(w, `unknown pattern ${pid}`);
  }
  for (const a of ADRS) {
    if (a.recommended < 0 || a.recommended >= a.options.length) err(`adr/${a.id}`, 'recommended out of range');
    for (const pid of a.patterns) if (!pids.has(pid)) err(`adr/${a.id}`, `unknown pattern ${pid}`);
  }
  console.log(`  ${REVIEWS.length} reviews · ${INCIDENTS.length} incidents · ${ADRS.length} ADRs · ${CHAOS.length} chaos events`);
}

console.log(`\n${PATTERNS.length} patterns · ${ALL_INTERNALS.length} internals · ${errors} error(s) · ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
