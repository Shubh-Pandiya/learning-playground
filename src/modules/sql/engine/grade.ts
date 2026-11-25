/** Grading shared by the UI and the content validator. */
import type { Exercise } from '../types';
import { parseQuery, normalizeSql, tokenize } from './parse';
import { planText, type PlanSummary } from './plan';

/** Does the reference solution promise an order (top-level ORDER BY)? */
export function isOrdered(ex: Pick<Exercise, 'solution' | 'orderMatters'>): boolean {
  if (ex.orderMatters !== undefined) return ex.orderMatters;
  const q = parseQuery(ex.solution);
  if (q) return q.orderBy.length > 0;
  const toks = tokenize(normalizeSql(ex.solution)).filter((t) => t.depth === 0);
  return toks.some((t, i) => t.u === 'ORDER' && toks[i + 1]?.u === 'BY');
}

export interface PlanCheck {
  ok: boolean;
  problems: string[];
}

/** Check an 'optimize' exercise's plan requirements against the learner's plan. */
export function checkPlan(ex: Exercise, learner: PlanSummary, starter?: PlanSummary): PlanCheck {
  const req = ex.plan;
  if (!req) return { ok: true, problems: [] };
  const text = planText(learner);
  const problems: string[] = [];
  for (const s of req.mustNotContain ?? []) if (text.includes(s)) problems.push(`Plan still contains “${s}”.`);
  for (const s of req.mustContain ?? []) if (!text.includes(s)) problems.push(`Plan should use “${s}”.`);
  if (req.maxCostRatio !== undefined && starter && learner.totalCost > starter.totalCost * req.maxCostRatio)
    problems.push(`Estimated cost ${Math.round(learner.totalCost)} is not below ${Math.round(req.maxCostRatio * 100)}% of the original ${Math.round(starter.totalCost)}.`);
  return { ok: problems.length === 0, problems };
}
