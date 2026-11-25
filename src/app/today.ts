import type { ModuleId, PlanItem, ProgressSummary } from '@/shared/progress';
import { createPersistedStore } from '@/shared/progress';
import type { ModuleDef } from './modules';

export interface TodayItem extends Required<Pick<PlanItem, 'label' | 'path' | 'kind' | 'minutes'>> {
  detail?: string;
  module: ModuleDef;
  /** Stable id used for the "done today" checkbox. */
  key: string;
}

const DEFAULT_MINUTES: Record<NonNullable<PlanItem['kind']>, number> = {
  review: 5,
  learn: 15,
  practice: 20,
  challenge: 25,
};

const MAX_REVIEWS = 6;
const MAX_NEXT = 3;

function toItem(m: ModuleDef, p: PlanItem, fallbackKind: NonNullable<PlanItem['kind']>): TodayItem {
  const kind = p.kind ?? fallbackKind;
  return {
    label: p.label,
    path: p.path,
    kind,
    minutes: p.minutes ?? DEFAULT_MINUTES[kind],
    detail: p.detail,
    module: m,
    key: `${m.id}:${kind}:${p.path}:${p.label}`,
  };
}

function reviewsFor(m: ModuleDef, s: ProgressSummary | undefined): TodayItem[] {
  if (!s) return [];
  const listed = (s.reviews ?? []).map((r) => toItem(m, r, 'review'));
  const remaining = (s.dueForReview ?? 0) - listed.length;
  if (remaining > 0) {
    listed.push(
      toItem(
        m,
        {
          label: `${listed.length ? `${remaining} more` : remaining} ${m.short} review${remaining === 1 ? '' : 's'} due`,
          path: s.resume?.path ?? m.path,
          minutes: Math.min(30, remaining * 3),
          detail: 'spaced recall — before you forget',
        },
        'review',
      ),
    );
  }
  return listed;
}

/**
 * Build today's session from what modules report via `useReportProgress`:
 * due reviews first (interleaved across modules, so you practise *choosing* the right
 * tool), then a few next steps, then one suggestion to start an untouched module.
 */
export function buildTodayPlan(
  modules: ModuleDef[],
  summaries: Partial<Record<ModuleId, ProgressSummary>>,
): TodayItem[] {
  const perModule = modules.map((m) => reviewsFor(m, summaries[m.id]));
  const reviews: TodayItem[] = [];
  for (let round = 0; reviews.length < MAX_REVIEWS && perModule.some((l) => l.length > round); round++) {
    for (const list of perModule) if (list[round] && reviews.length < MAX_REVIEWS) reviews.push(list[round]);
  }

  const next: TodayItem[] = [];
  for (const m of modules) {
    const s = summaries[m.id];
    if (!s) continue;
    const step = s.nextSteps?.[0];
    if (step) next.push(toItem(m, step, 'learn'));
    else if (s.resume) next.push(toItem(m, { label: `Continue · ${s.resume.label}`, path: s.resume.path }, 'learn'));
  }
  // Prefer modules with the least progress so the plan stays balanced.
  next.sort((a, b) => ratio(summaries[a.module.id]) - ratio(summaries[b.module.id]));

  const untouched = modules.find((m) => !summaries[m.id]?.completed && !next.some((n) => n.module.id === m.id));
  if (untouched && next.length < MAX_NEXT) {
    next.push(toItem(untouched, { label: `Start ${untouched.title}`, path: untouched.path, detail: 'new track — first look' }, 'learn'));
  }

  return [...reviews, ...next.slice(0, MAX_NEXT)];
}

function ratio(s: ProgressSummary | undefined): number {
  return s && s.total > 0 ? s.completed / s.total : 0;
}

export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface ActivityState {
  /** Local dates (YYYY-MM-DD) the app was used, ascending, capped. */
  days: string[];
  /** Plan items ticked off, only for `doneDay`. */
  doneDay: string;
  done: string[];
  touch: () => void;
  toggleDone: (key: string) => void;
}

/** Persisted at `lp:app:activity`: visit days (streak) + today's ticked-off plan items. */
export const useActivity = createPersistedStore<ActivityState>('app', 'activity', (set, get) => ({
  days: [],
  doneDay: '',
  done: [],
  touch: () => {
    const today = localDay();
    const { days } = get();
    if (days[days.length - 1] !== today) set({ days: [...days, today].slice(-400) });
  },
  toggleDone: (key) => {
    const today = localDay();
    const s = get();
    const done = s.doneDay === today ? s.done : [];
    set({ doneDay: today, done: done.includes(key) ? done.filter((k) => k !== key) : [...done, key] });
  },
}));

/** Consecutive active days ending today (or yesterday, so a streak isn't lost before you open the app). */
export function streak(days: string[], now = new Date()): number {
  const set = new Set(days);
  const d = new Date(now);
  if (!set.has(localDay(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(localDay(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
