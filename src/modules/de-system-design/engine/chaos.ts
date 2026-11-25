import type { ChaosId, ComponentKind, Graph, OutcomeKey, Workload } from '../types';
import { aliveOf, bufferedBefore, buildCtx, controlled, d, isStreamProc, killOne, simulate, UPSERT_STORES, type Ctx, type Metrics } from './simulate';

/** Outcome scale, ordered from harmless to worst. Silent wrongness ranks worse than a loud failure. */
export const OUTCOMES: { key: OutcomeKey; label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }[] = [
  { key: 'absorbed', label: 'Absorbed: no impact', tone: 'ok' },
  { key: 'delayed', label: 'Delayed, but still correct', tone: 'info' },
  { key: 'broken', label: 'Pipeline breaks loudly', tone: 'warn' },
  { key: 'wrong', label: 'Silently wrong numbers', tone: 'bad' },
  { key: 'lost', label: 'Data permanently lost', tone: 'bad' },
];
const RANK: OutcomeKey[] = OUTCOMES.map((o) => o.key);
export const outcomeLabel = (k: OutcomeKey) => OUTCOMES.find((o) => o.key === k)!.label;
export const worseOf = (a: OutcomeKey, b: OutcomeKey) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a);

export interface ChaosDef {
  id: ChaosId;
  name: string;
  icon: string;
  /** What we inject. */
  blurb: string;
  /** Predict-first question. */
  question: string;
}

export const CHAOS: ChaosDef[] = [
  {
    id: 'late',
    name: 'Late-data burst',
    icon: 'Clock',
    blurb: '15% of yesterday’s events arrive 2 hours late: phones were offline and a region’s collector lagged.',
    question: 'A burst of events arrives hours after they happened. What happens to the numbers?',
  },
  {
    id: 'schema',
    name: 'Upstream schema change',
    icon: 'FileWarning',
    blurb: 'A product team renames `amount` to `amount_cents` and changes its type, with no heads-up.',
    question: 'An upstream team changes a field’s name and type without telling you. What happens?',
  },
  {
    id: 'skew',
    name: 'Hot key',
    icon: 'Flame',
    blurb: 'One key (a viral post, a mega-merchant, a city on New Year’s Eve) suddenly carries 40% of all records.',
    question: 'One key suddenly carries 40% of the traffic. What happens?',
  },
  {
    id: 'crash',
    name: 'Job crash mid-write',
    icon: 'Skull',
    blurb: 'The processing job is killed halfway through writing its output, then restarts.',
    question: 'The job crashes halfway through a write and restarts. What do consumers see?',
  },
  {
    id: 'replay',
    name: 'Duplicate replay',
    icon: 'Copy',
    blurb: 'An upstream producer retries and re-sends the last hour of records (offsets reset / at-least-once retry).',
    question: 'An hour of records is delivered a second time. What happens to the totals?',
  },
  {
    id: 'outage',
    name: 'Source outage',
    icon: 'Unplug',
    blurb: 'The source (or its ingestion endpoint) is unreachable for 2 hours, then comes back.',
    question: 'The source is unreachable for 2 hours, then recovers. What happens?',
  },
  {
    id: 'smallfiles',
    name: 'Small-files explosion',
    icon: 'Files',
    blurb: 'Traffic triples and every writer commits every few seconds: file counts in the tables explode.',
    question: 'Writers commit tiny files every few seconds for a week. What happens?',
  },
];

export const chaosDef = (id: ChaosId) => CHAOS.find((c) => c.id === id)!;

export interface ChaosResult {
  outcome: OutcomeKey;
  /** Explanations, worst first. */
  why: string[];
  /** Node ids where the effect shows up. */
  hot: string[];
}

interface Finding {
  o: OutcomeKey;
  why: string;
  at?: string;
}

const name = (ctx: Ctx, id: string) => {
  const n = ctx.byId.get(id)!;
  return n.label ?? d(n.kind).name;
};
const F = (ctx: Ctx, id: string) => d(ctx.byId.get(id)!.kind).flow;
const K = (ctx: Ctx, id: string): ComponentKind => ctx.byId.get(id)!.kind;
const isProc = (ctx: Ctx, id: string) => F(ctx, id).role === 'process' && !F(ctx, id).spreadsKeys;

function combine(found: Finding[], none: string): ChaosResult {
  if (!found.length) return { outcome: 'absorbed', why: [none], hot: [] };
  let outcome: OutcomeKey = 'absorbed';
  for (const f of found) outcome = worseOf(outcome, f.o);
  const sorted = [...found].sort((a, b) => RANK.indexOf(b.o) - RANK.indexOf(a.o));
  const why: string[] = [];
  for (const f of sorted) if (!why.includes(f.why)) why.push(f.why);
  const hot = [...new Set(sorted.filter((f) => f.o === outcome && f.at).map((f) => f.at!))];
  return { outcome, why: why.slice(0, 4), hot };
}

function late(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const p of ctx.paths) {
    const pt = p.find((id) => F(ctx, id).procTime);
    if (pt) {
      out.push({ o: 'wrong', at: pt, why: `${name(ctx, pt)} windows by arrival time, so late events are counted in the window they arrived in, not the one they happened in. Yesterday’s totals are short and today’s are inflated, and nothing errors.` });
      continue;
    }
    const st = p.find((id) => isStreamProc(ctx.byId.get(id)!) && F(ctx, id).eventTime);
    if (st) {
      out.push({ o: 'absorbed', at: st, why: `${name(ctx, st)} windows by event time. The watermark plus allowed lateness keep windows open, and late events update the right window.` });
      continue;
    }
    const naive = p.find((id) => F(ctx, id).role === 'process' && F(ctx, id).mode === 'batch' && !F(ctx, id).dedup);
    if (naive) {
      out.push({ o: 'wrong', at: naive, why: `${name(ctx, naive)} processed yesterday’s partition once. Rows that land after the run are never picked up, so the numbers stay short.` });
      continue;
    }
    const batch = p.find((id) => F(ctx, id).role === 'process' && F(ctx, id).mode === 'batch');
    if (batch) {
      out.push({ o: 'delayed', at: batch, why: `${name(ctx, batch)} re-processes a lookback window on its next run (or a MERGE picks up the late rows), so the numbers are correct after the next run.` });
      continue;
    }
    const ev = p.find((id) => F(ctx, id).eventTime);
    if (ev) {
      out.push({ o: 'absorbed', at: ev, why: `${name(ctx, ev)} stores raw rows with their event timestamp, so queries bucket late rows correctly.` });
      continue;
    }
    out.push({ o: 'delayed', why: 'Raw rows keep their event time, so late rows show up once they land and queries group them by event time.' });
  }
  return out;
}

function schema(ctx: Ctx): Finding[] {
  const reg = controlled(ctx, 'schema-registry');
  const dq = controlled(ctx, 'dq');
  const out: Finding[] = [];
  for (const p of ctx.paths) {
    const r = p.find((id) => reg.has(id) && K(ctx, id) === 'kafka');
    if (r) {
      out.push({ o: 'absorbed', at: r, why: `The schema registry rejects the incompatible schema at produce time (BACKWARD compatibility check), so the breaking change fails in the producer’s CI or deploy, not in your pipeline.` });
      continue;
    }
    const q = p.find((id) => dq.has(id));
    if (q) {
      out.push({ o: 'delayed', at: q, why: `The data contract check on ${name(ctx, q)} quarantines the bad batch and pages the owner. Good data keeps flowing; you fix the mapping and replay.` });
      continue;
    }
    const proc = p.find((id) => isProc(ctx, id) || K(ctx, id) === 'cdc');
    if (proc) {
      out.push({ o: 'broken', at: proc, why: `${name(ctx, proc)} fails to deserialise or cast the new field and the job crash-loops. That is loud, and better than wrong, but the pipeline is down until someone fixes it.` });
      continue;
    }
    const last = p[p.length - 2] ?? p[0];
    out.push({ o: 'wrong', at: last, why: 'Nothing validates the shape. The loader adds a new column and the old one goes NULL, so dashboards silently show zero revenue.' });
  }
  return out;
}

function skew(ctx: Ctx, g: Graph, wl: Workload): Finding[] {
  const share = Math.max(wl.skew ?? 0, 0.4);
  const sim = simulate(g, wl, { skew: share });
  const out: Finding[] = [];
  for (const p of ctx.paths) {
    let found = false;
    p.forEach((id, i) => {
      const ns = sim.nodes[id];
      if (!ns.skewed || found) return;
      found = true;
      if (ns.util > 1)
        out.push(
          bufferedBefore(ctx, p, i)
            ? { o: 'delayed', at: id, why: `${name(ctx, id)}: one instance owns the hot key and saturates (${Math.round(ns.util * 100)}%) while the others idle. Lag builds up in the durable log in front of it and freshness collapses, but nothing is lost.` }
            : { o: 'lost', at: id, why: `${name(ctx, id)}: one instance owns the hot key and saturates, and nothing durable buffers in front of it, so records are dropped.` },
        );
      else
        out.push({ o: 'delayed', at: id, why: `${name(ctx, id)}: one straggler task holds ${Math.round(share * 100)}% of the data, so the whole stage waits on it and the run finishes late.` });
    });
    if (found) continue;
    const salt = p.find((id) => F(ctx, id).spreadsKeys);
    if (salt) out.push({ o: 'absorbed', at: salt, why: `${name(ctx, salt)} spreads the hot key over N sub-keys and aggregates in two phases, so no single instance is overwhelmed.` });
  }
  return out;
}

function crash(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const p of ctx.paths) {
    const vol = p.find((id) => F(ctx, id).volatile);
    if (vol) {
      out.push({ o: 'lost', at: vol, why: `${name(ctx, vol)} held records only in memory, and they died with the process.` });
      continue;
    }
    const dual = p.find((id) => F(ctx, id).inconsistent);
    if (dual) {
      out.push({ o: 'wrong', at: dual, why: `${name(ctx, dual)}: the DB commit succeeded but the event send didn’t (or the reverse). The two systems now disagree for good.` });
      continue;
    }
    const rerun = p.find((id) => F(ctx, id).rerunDups);
    if (rerun) {
      out.push({ o: 'wrong', at: rerun, why: `${name(ctx, rerun)} restarts and re-writes rows it already wrote (plain INSERT/append, no transaction), so totals are double-counted for that window.` });
      continue;
    }
    const procs = p.filter((id) => isProc(ctx, id));
    let f: Finding | undefined;
    for (const id of procs) {
      const fl = F(ctx, id);
      const sinkId = p[p.indexOf(id) + 1];
      const sink = sinkId ? F(ctx, sinkId) : undefined;
      if (sink?.noAcid) {
        f = { o: 'wrong', at: sinkId, why: `${name(ctx, sinkId)} has no atomic commit: readers see the half-written files, and the retry writes them again.` };
        break;
      }
      if (fl.mode === 'stream' && !fl.checkpoint) {
        f = { o: 'wrong', at: id, why: `${name(ctx, id)} has no consistent checkpoint, so it restarts from the last committed offset with empty state. Windows are re-emitted or lost, and the numbers drift.` };
        break;
      }
      if (fl.mode === 'stream') f = { o: 'absorbed', at: id, why: `${name(ctx, id)} restores state and offsets from its last checkpoint, and the ${sink?.sink === 'transactional' ? 'transactional (two-phase commit)' : 'idempotent'} sink discards the half-finished write. The result is exactly-once.` };
      else if (!f) f = { o: 'delayed', at: id, why: `${name(ctx, id)} retries the task. The output is committed atomically (overwrite partition / MERGE in a transaction), so readers never see half a run, only a late one.` };
    }
    out.push(f ?? { o: 'absorbed', why: 'No custom writer here: the managed ingestion tracks offsets with each segment commit.' });
  }
  return out;
}

function replay(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const p of ctx.paths) {
    const rerun = p.find((id) => F(ctx, id).rerunDups);
    if (rerun) {
      out.push({ o: 'wrong', at: rerun, why: `${name(ctx, rerun)} appends whatever it receives, so the replayed hour is counted twice. The dashboard doubles overnight.` });
      continue;
    }
    const dd = p.find((id) => F(ctx, id).dedup);
    if (dd) {
      out.push({ o: 'absorbed', at: dd, why: `${name(ctx, dd)} deduplicates by event id (keyed state / MERGE on a unique key), so replays are no-ops.` });
      continue;
    }
    const stores = p.filter((id) => F(ctx, id).role === 'store');
    const last = stores[stores.length - 1];
    if (last && UPSERT_STORES.includes(K(ctx, last))) {
      out.push({ o: 'absorbed', at: last, why: `${name(ctx, last)} upserts by key, so writing the same record twice leaves one row.` });
      continue;
    }
    out.push({ o: 'wrong', at: last ?? p[p.length - 1], why: `Nothing on this path deduplicates: ${last ? name(ctx, last) : 'the sink'} appends the replayed records, so counts and sums double for that hour.` });
  }
  return out;
}

function outage(ctx: Ctx): Finding[] {
  const airflow = controlled(ctx, 'airflow');
  const out: Finding[] = [];
  for (const p of ctx.paths) {
    const src = p[0];
    const atRest = !!F(ctx, src).durable;
    const dual = p.find((id) => F(ctx, id).inconsistent);
    if (dual) {
      out.push({ o: 'wrong', at: dual, why: `${name(ctx, dual)}: writes keep landing in the DB while the event sends fail. The event stream has a hole that never heals.` });
      continue;
    }
    const vol = p.find((id) => F(ctx, id).volatile);
    if (vol) {
      out.push({ o: 'lost', at: vol, why: `${name(ctx, vol)} can’t flush, its memory fills, and it drops records. They never existed anywhere durable.` });
      continue;
    }
    if (atRest) {
      const live = p.find((id) => F(ctx, id).role === 'query' && F(ctx, id).oltpLoad);
      if (live) {
        out.push({ o: 'broken', at: live, why: `${name(ctx, live)} queries the source live, so every dashboard errors until it comes back.` });
        continue;
      }
      const inc = p.find((id) => K(ctx, id) === 'cdc' || K(ctx, id) === 'connector');
      if (inc) {
        out.push({ o: 'delayed', at: inc, why: `${name(ctx, inc)} resumes from its saved position (WAL/LSN or incremental cursor) and catches up, so the data is complete, just late.` });
        continue;
      }
      const batch = p.find((id) => F(ctx, id).mode === 'batch' && F(ctx, id).role !== 'serve');
      if (batch && airflow.has(batch)) {
        out.push({ o: 'delayed', at: batch, why: `The orchestrator retries ${name(ctx, batch)} with backoff and marks the run failed if retries run out, so someone re-runs that date. It ends up late but complete.` });
        continue;
      }
      if (batch) {
        out.push({ o: 'wrong', at: batch, why: `${name(ctx, batch)} failed at 2 a.m. and nothing retried or alerted, so that day’s partition is simply missing. The dashboard shows a dip, not an error.` });
        continue;
      }
      out.push({ o: 'delayed', why: 'The source keeps its data, so the pipeline catches up when it recovers.' });
      continue;
    }
    const log = p.find((id) => K(ctx, id) === 'kafka' && aliveOf(ctx.byId.get(id)!) > 0);
    if (log) {
      out.push({ o: 'delayed', at: log, why: `Producers buffer and retry while the endpoint is unreachable, and ${name(ctx, log)} absorbs the catch-up burst. Consumers resume from their offsets. There’s a gap on the live chart that fills in.` });
      continue;
    }
    out.push({ o: 'lost', at: p[1], why: 'No durable log sits between the producers and processing. Client buffers overflow after minutes, and the outage window is gone.' });
  }
  return out;
}

function smallfiles(ctx: Ctx, g: Graph, wl: Workload): Finding[] {
  const sim = simulate(g, wl, { traffic: 3 });
  const out: Finding[] = [];
  for (const n of g.nodes) {
    const sf = sim.nodes[n.id]?.smallFiles;
    if (sf === 'tiny') out.push({ o: 'broken', at: n.id, why: `${name(ctx, n.id)} gets one object per record: millions of files. Listing and PUT throttling make writers fail, and queries time out planning the scan.` });
    else if (sf === 'many') out.push({ o: 'delayed', at: n.id, why: `${name(ctx, n.id)} piles up thousands of small files per hour and nothing compacts them. Every query opens more files, so queries get slower each day (still correct).` });
    else if (sf === 'compacted') out.push({ o: 'absorbed', at: n.id, why: `Compaction regularly rewrites ${name(ctx, n.id)}’s small files into ~512 MB files and expires old snapshots, so read performance stays flat.` });
  }
  return out;
}

const NONE: Record<ChaosId, string> = {
  late: 'Nothing on this path depends on arrival order.',
  schema: 'Nothing on this path depends on that field.',
  skew: 'No component partitions by key here, so the hot key doesn’t concentrate anywhere.',
  crash: 'No writer here can leave a half-written output.',
  replay: 'Replays have nowhere to double-count.',
  outage: 'The pipeline catches up when the source recovers.',
  smallfiles: 'Writers here commit large batches; no small-file buildup.',
};

export function runChaos(g: Graph, wl: Workload, id: ChaosId): ChaosResult {
  const ctx = buildCtx(g, wl);
  if (!ctx.paths.length) return { outcome: 'broken', why: ['There is no connected path from a source to a consumer yet.'], hot: [] };
  const found =
    id === 'late' ? late(ctx)
    : id === 'schema' ? schema(ctx)
    : id === 'skew' ? skew(ctx, g, wl)
    : id === 'crash' ? crash(ctx)
    : id === 'replay' ? replay(ctx)
    : id === 'outage' ? outage(ctx)
    : smallfiles(ctx, g, wl);
  return combine(found, NONE[id]);
}

/* ------------------------------------------------------------------ */
/* kill one instance                                                   */
/* ------------------------------------------------------------------ */

export interface KillResult {
  outcome: OutcomeKey;
  why: string;
  before: Metrics;
  after: Metrics;
}

export function predictKill(g: Graph, wl: Workload, nodeId: string): KillResult {
  const before = simulate(g, wl).metrics;
  const killed = killOne(g, nodeId);
  const after = simulate(killed, wl).metrics;
  const n = g.nodes.find((x) => x.id === nodeId)!;
  const def = d(n.kind);
  const fl = def.flow;
  const nm = n.label ?? def.name;
  const left = aliveOf(n) - 1;
  const res = (outcome: OutcomeKey, why: string): KillResult => ({ outcome, why, before, after });

  if (fl.role === 'control') {
    if (n.kind === 'airflow') {
      const ctx = buildCtx(g, wl);
      const batch = [...(ctx.controls.get(n.id) ?? [])].some((id) => F(ctx, id).mode === 'batch');
      return batch
        ? res('delayed', `The scheduler is down, so no new runs start. Running tasks finish, and when it comes back, catchup runs the missed intervals. Data ends up late, not wrong, because tasks are idempotent per interval.`)
        : res('absorbed', 'Nothing it schedules is on the data path yet.');
    }
    if (n.kind === 'schema-registry') return res('absorbed', 'Producers and consumers cache schemas by id. Only brand-new schemas can’t register until it’s back.');
    if (n.kind === 'compaction') return res('absorbed', 'Compaction pauses. Small files accumulate slowly, and the next run catches up.');
    return res('absorbed', `${nm} is out of band: checks and metadata pause, but records keep flowing.`);
  }
  if (left > 0) {
    if (n.kind === 'kafka')
      return res('absorbed', `Partition leaders fail over to in-sync replicas on the other ${left} broker(s). ${left < 3 ? 'But with fewer than 3 brokers left, another failure risks acknowledged data.' : 'With RF=3 nothing acknowledged is lost.'}`);
    if (fl.role === 'store' && fl.query) return res('absorbed', `Replicas on the remaining ${left} node(s) serve queries; segments re-replicate in the background.`);
    return res('absorbed', `The remaining ${left} instance(s) take over its partitions after a rebalance${fl.checkpoint ? ', restoring state from the last checkpoint' : ''}.`);
  }
  if (fl.managed && fl.role !== 'serve') return res('absorbed', `${nm} is a managed, multi-AZ service: the provider replaces the failed node, and you see a retry, not an outage.`);
  if (fl.role === 'serve') return res('broken', `${nm} is down, so its users see errors. The data pipeline behind it is unaffected.`);
  if (fl.volatile) return res('lost', `${nm} kept records only in memory, so everything it held is gone and there’s no replay.`);
  if (fl.rerunDups) return res('wrong', `When ${nm} is restarted it re-processes input it had partly written, and its append-only writes double-count those rows.`);
  if (fl.role === 'process' && fl.mode === 'stream' && !fl.checkpoint && !fl.spreadsKeys)
    return res('wrong', `${nm} has no checkpoint, so it restarts with empty window state from the last committed offset. Windows are emitted twice or partially.`);

  const ctx = buildCtx(g, wl);
  const through = ctx.paths.filter((p) => p.includes(nodeId));
  if (fl.query) {
    const readers = ctx.targets.some((t) => d(t.kind).flow.queries && ctx.inn.get(t.id)!.some((e) => e.from === nodeId));
    if (readers && !through.some((p) => p.indexOf(nodeId) < p.length - 2)) return res('broken', `Every dashboard and query that reads ${nm} errors until it’s back; there’s no replica. Ingestion upstream ${fl.durable ? 'buffers and resumes' : 'is unaffected'}.`);
  }
  if (!through.length) return res('absorbed', `${nm} isn’t on any source → consumer path.`);
  const lost = through.some((p) => !bufferedBefore(ctx, p, p.indexOf(nodeId)));
  if (lost) return res('lost', `Nothing durable sits before ${nm}: records arriving while it’s down have nowhere to wait, so they’re dropped.`);
  return res(
    'delayed',
    `Records wait in the durable layer upstream (log retention or the source itself) and ${nm} resumes from its last offset or checkpoint when restarted, so freshness suffers but nothing is lost.`,
  );
}
