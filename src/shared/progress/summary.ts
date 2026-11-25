import { useEffect } from 'react';
import { createPersistedStore } from './persist';

/** Modules that report progress to the home page. Each owns routes at `/<id>/*`. */
export type ModuleId = 'dsa' | 'system-design' | 'kafka' | 'sql' | 'data-modeling' | 'de-system-design';

export const MODULE_IDS: readonly ModuleId[] = ['dsa', 'system-design', 'kafka', 'sql', 'data-modeling', 'de-system-design'];

/** One actionable entry for the home page's cross-module "Today" plan. */
export interface PlanItem {
  /** Short, specific label, e.g. "Review: Sliding Window · Longest Substring". */
  label: string;
  /** In-app route to open, e.g. "/dsa/problem/3sum". */
  path: string;
  /** review = spaced-repetition recall; learn = new concept; practice = build/solve; challenge = transfer/new problem. */
  kind?: 'review' | 'learn' | 'practice' | 'challenge';
  /** Rough time estimate, used to fit the plan into a session. */
  minutes?: number;
  /** One-line reason / context ("last reviewed 6 days ago", "next in your roadmap"). */
  detail?: string;
}

export interface ProgressSummary {
  /** Items completed (problems solved, designs finished, …). */
  completed: number;
  /** Total items available. */
  total: number;
  /** Unit label, e.g. "problems" or "designs". */
  unit?: string;
  /** Optional short secondary line, e.g. "7 / 18 patterns started". */
  detail?: string;
  /** Items due for spaced review right now (count). */
  dueForReview?: number;
  /** Where "Continue" should take the user. */
  resume?: { label: string; path: string };
  /** The specific items due for review now, most overdue first (up to ~5). Feeds the Today plan. */
  reviews?: PlanItem[];
  /** Suggested next things to learn/practice, best first (up to ~3). Feeds the Today plan. */
  nextSteps?: PlanItem[];
  updatedAt?: string;
}

interface SummaryState {
  summaries: Partial<Record<ModuleId, ProgressSummary>>;
  report: (id: ModuleId, summary: ProgressSummary) => void;
}

/**
 * Persisted at `lp:app:summaries` so the home page can show progress without
 * loading the (lazy) module bundles.
 */
export const useProgressSummaries = createPersistedStore<SummaryState>('app', 'summaries', (set) => ({
  summaries: {},
  report: (id, summary) =>
    set((s) => ({
      summaries: { ...s.summaries, [id]: { ...summary, updatedAt: new Date().toISOString() } },
    })),
}));

/** Imperatively report a module's progress summary (safe to call often). */
export function reportProgress(id: ModuleId, summary: ProgressSummary): void {
  useProgressSummaries.getState().report(id, summary);
}

/**
 * Hook form: re-reports whenever the summary's content changes.
 * Call it once near the root of your module with a summary derived from your store.
 */
export function useReportProgress(id: ModuleId, summary: ProgressSummary): void {
  const { updatedAt: _ignored, ...content } = summary;
  const key = JSON.stringify(content);
  useEffect(() => {
    reportProgress(id, JSON.parse(key) as ProgressSummary);
  }, [id, key]);
}

export function useModuleSummary(id: ModuleId): ProgressSummary | undefined {
  return useProgressSummaries((s) => s.summaries[id]);
}
