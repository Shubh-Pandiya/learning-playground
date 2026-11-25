import { useEffect } from 'react';
import { createPersistedStore } from './persist';

/** Modules that report progress to the home page. */
export type ModuleId = 'dsa' | 'system-design';

export interface ProgressSummary {
  /** Items completed (problems solved, designs finished, …). */
  completed: number;
  /** Total items available. */
  total: number;
  /** Unit label, e.g. "problems" or "designs". */
  unit?: string;
  /** Optional short secondary line, e.g. "7 / 18 patterns started". */
  detail?: string;
  /** Items due for spaced review right now. */
  dueForReview?: number;
  /** Where "Continue" should take the user. */
  resume?: { label: string; path: string };
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
 * Hook form: re-reports whenever the summary values change.
 * Call it once near the root of your module with a summary derived from your store.
 */
export function useReportProgress(id: ModuleId, summary: ProgressSummary): void {
  const { completed, total, unit, detail, dueForReview, resume } = summary;
  useEffect(() => {
    reportProgress(id, { completed, total, unit, detail, dueForReview, resume });
  }, [id, completed, total, unit, detail, dueForReview, resume?.label, resume?.path]);
}

export function useModuleSummary(id: ModuleId): ProgressSummary | undefined {
  return useProgressSummaries((s) => s.summaries[id]);
}
