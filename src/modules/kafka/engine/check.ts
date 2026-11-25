/**
 * Scenario requirements: predicates over the evaluated model (and, for resilience requirements,
 * over the model re-evaluated under injected chaos). Gives the "closeness" score and gap list.
 */
import type { Chaos, KGraph, KKind, Ordering, Semantics } from '../types';
import { NO_CHAOS } from '../types';
import { cfgOf } from './defaults';
import { evaluate, type Model } from './model';

export interface Ctx {
  g: KGraph;
  m: Model;
  /** Re-evaluate under chaos (memoised per call). */
  under: (c: Partial<Chaos>) => Model;
}

export interface Requirement {
  id: string;
  label: string;
  /** Why the business cares. */
  why: string;
  test: (c: Ctx) => boolean;
  /** Shown as the level-2 hint when this requirement fails. */
  hint?: string;
}

export interface CheckResult {
  passed: string[];
  failed: Requirement[];
  closeness: number;
  done: boolean;
}

export function makeCtx(g: KGraph, chaos: Chaos = NO_CHAOS): Ctx {
  const m = evaluate(g, chaos);
  const cache = new Map<string, Model>();
  return {
    g,
    m,
    under: (c) => {
      const k = JSON.stringify(c);
      if (!cache.has(k)) cache.set(k, evaluate(g, { ...NO_CHAOS, ...chaos, ...c }));
      return cache.get(k)!;
    },
  };
}

export function check(reqs: Requirement[], g: KGraph): CheckResult {
  const ctx = makeCtx(g);
  const passed: string[] = [];
  const failed: Requirement[] = [];
  for (const r of reqs) {
    let ok = false;
    try {
      ok = r.test(ctx);
    } catch {
      ok = false;
    }
    if (ok) passed.push(r.id);
    else failed.push(r);
  }
  const closeness = reqs.length ? passed.length / reqs.length : 0;
  return { passed, failed, closeness, done: failed.length === 0 && reqs.length > 0 };
}

/* -------- predicate helpers used by lesson content -------- */

const SEM: Semantics[] = ['none', 'at-most-once', 'at-least-once', 'effectively-once', 'exactly-once'];
const ORD: Ordering[] = ['n/a', 'none', 'per-key*', 'per-key', 'total'];

export const has = (g: KGraph, k: KKind) => g.nodes.some((n) => n.kind === k);
export const count = (g: KGraph, k: KKind) => g.nodes.filter((n) => n.kind === k).length;
export const semAtLeast = (m: Model, s: Semantics) => SEM.indexOf(m.metrics.semantics) >= SEM.indexOf(s) && m.metrics.connected;
export const ordAtLeast = (m: Model, o: Ordering) => ORD.indexOf(m.metrics.ordering) >= ORD.indexOf(o);
export const noLag = (m: Model) => m.metrics.connected && m.metrics.lagGrowth <= 1;
export const noFlag = (m: Model, prefix: string) => !m.flags.some((f) => f.id.startsWith(prefix));
export const noBad = (m: Model) => !m.flags.some((f) => f.level === 'bad');
export const flowing = (m: Model) => m.metrics.connected;
export const writesOk = (m: Model) => m.metrics.errorRate < 0.001;
export const topicsOf = (g: KGraph, role?: string) => g.nodes.filter((n) => n.kind === 'topic' && (!role || cfgOf(n).role === role));
export const groupsOf = (g: KGraph) => g.nodes.filter((n) => n.kind === 'group' || n.kind === 'streams');

/** Survives losing any single broker: writes keep working and no acked data lost. */
export function survivesBrokerLoss(c: Ctx): boolean {
  for (let b = 1; b <= c.g.cluster.brokers; b++) {
    const m = c.under({ brokersDown: [b] });
    if (m.metrics.errorRate > 0.001) return false;
    if (Object.values(m.topics).some((t) => t.offline || t.partitions.some((p) => p.unclean))) return false;
  }
  return c.m.metrics.durability.level === 2;
}

/** Stays healthy at k× traffic. */
export const handles = (c: Ctx, k: number) => {
  const m = c.under({ traffic: k });
  return m.metrics.lagGrowth <= 1 && m.metrics.errorRate < 0.001 && m.metrics.produceP99 < 1000;
};

/** The poison record doesn't stall any partition. */
export const poisonSafe = (c: Ctx) => {
  const m = c.under({ poison: true });
  return !Object.values(m.groups).some((g) => g.stuck > 0) && m.metrics.lagGrowth <= 1;
};
