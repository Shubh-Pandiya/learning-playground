import { createPersistedStore, newCard, review, isDue, type RecallGrade, type ReviewCard } from '@/shared/progress';
import type { PatternId } from './engine/types';

export type BuildMode = 'worked' | 'faded' | 'scratch';

export interface ProblemProgress {
  /** watched a trace to the last frame */
  visualized?: boolean;
  /** correctly guessed the pattern before seeing it */
  recognized?: boolean;
  /** builder attempts / best mode completed */
  attempts?: number;
  built?: Partial<Record<BuildMode, boolean>>;
  hintsUsed?: number;
  predictRight?: number;
  predictTotal?: number;
  /** self-explanation notes */
  note?: string;
  backendNote?: string;
  card?: ReviewCard;
  lastVisited?: string;
}

export interface PatternProgress {
  drillRight?: number;
  drillTotal?: number;
  note?: string;
}

export interface DsaState {
  problems: Record<string, ProblemProgress>;
  patterns: Partial<Record<PatternId, PatternProgress>>;
  transfer: Record<string, { correct: boolean; at: string; plan?: string }>;
  /** YYYY-MM-DD days with any learning activity */
  activity: string[];
  lastProblem: string | null;
  predictMode: boolean;
  lineQuiz: boolean;

  touch: () => void;
  visit: (id: string) => void;
  patch: (id: string, p: Partial<ProblemProgress>) => void;
  recordPrediction: (id: string, correct: boolean) => void;
  recordBuild: (id: string, mode: BuildMode, success: boolean) => void;
  recordHint: (id: string) => void;
  recordDrill: (pattern: PatternId, correct: boolean) => void;
  recordTransfer: (variantId: string, pattern: PatternId, correct: boolean, plan?: string) => void;
  setPatternNote: (pattern: PatternId, note: string) => void;
  grade: (id: string, grade: RecallGrade) => void;
  setPredictMode: (v: boolean) => void;
  setLineQuiz: (v: boolean) => void;
}

const localDay = (d: Date) => d.toLocaleDateString('en-CA');
const today = () => localDay(new Date());

const withActivity = (activity: string[]) => {
  const d = today();
  return activity.includes(d) ? activity : [...activity, d].slice(-400);
};

export const useDsa = createPersistedStore<DsaState>(
  'dsa',
  'progress',
  (set) => {
    const upd = (id: string, fn: (p: ProblemProgress) => ProblemProgress) =>
      set((s) => ({ problems: { ...s.problems, [id]: fn(s.problems[id] ?? {}) }, activity: withActivity(s.activity) }));
    return {
      problems: {},
      patterns: {},
      transfer: {},
      activity: [],
      lastProblem: null,
      predictMode: true,
      lineQuiz: false,

      touch: () => set((s) => ({ activity: withActivity(s.activity) })),
      visit: (id) =>
        set((s) => ({
          lastProblem: id,
          problems: { ...s.problems, [id]: { ...(s.problems[id] ?? {}), lastVisited: new Date().toISOString() } },
        })),
      patch: (id, p) => upd(id, (x) => ({ ...x, ...p })),
      recordPrediction: (id, correct) =>
        upd(id, (x) => ({ ...x, predictRight: (x.predictRight ?? 0) + (correct ? 1 : 0), predictTotal: (x.predictTotal ?? 0) + 1 })),
      recordBuild: (id, mode, success) =>
        upd(id, (x) => {
          const built = success ? { ...(x.built ?? {}), [mode]: true } : x.built;
          // the first successful build enters the spaced-repetition queue
          const card = x.card ?? (success && mode !== 'worked' ? review(newCard(), mode === 'scratch' ? 2 : 1) : undefined);
          return { ...x, attempts: (x.attempts ?? 0) + 1, built, card };
        }),
      recordHint: (id) => upd(id, (x) => ({ ...x, hintsUsed: (x.hintsUsed ?? 0) + 1 })),
      recordDrill: (pattern, correct) =>
        set((s) => {
          const p = s.patterns[pattern] ?? {};
          return {
            activity: withActivity(s.activity),
            patterns: {
              ...s.patterns,
              [pattern]: { ...p, drillRight: (p.drillRight ?? 0) + (correct ? 1 : 0), drillTotal: (p.drillTotal ?? 0) + 1 },
            },
          };
        }),
      recordTransfer: (variantId, pattern, correct, plan) =>
        set((s) => {
          const p = s.patterns[pattern] ?? {};
          return {
            activity: withActivity(s.activity),
            transfer: { ...s.transfer, [variantId]: { correct, plan, at: new Date().toISOString() } },
            patterns: {
              ...s.patterns,
              [pattern]: { ...p, drillRight: (p.drillRight ?? 0) + (correct ? 1 : 0), drillTotal: (p.drillTotal ?? 0) + 1 },
            },
          };
        }),
      setPatternNote: (pattern, note) =>
        set((s) => ({ patterns: { ...s.patterns, [pattern]: { ...(s.patterns[pattern] ?? {}), note } } })),
      grade: (id, g) => upd(id, (x) => ({ ...x, card: review(x.card ?? newCard(), g) })),
      setPredictMode: (v) => set({ predictMode: v }),
      setLineQuiz: (v) => set({ lineQuiz: v }),
    };
  },
  {
    version: 1,
    partialize: (s) => ({
      problems: s.problems,
      patterns: s.patterns,
      transfer: s.transfer,
      activity: s.activity,
      lastProblem: s.lastProblem,
      predictMode: s.predictMode,
      lineQuiz: s.lineQuiz,
    }),
  },
);

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export const isSolved = (p?: ProblemProgress) => !!(p?.built?.faded || p?.built?.scratch);

/**
 * Mastery 0–4:
 * 0 new · 1 explored (visualized) · 2 built with scaffolding · 3 built from scratch ·
 * 4 recalled successfully after spaced reviews (card.reps ≥ 2)
 */
export function mastery(p?: ProblemProgress): number {
  if (!p) return 0;
  if (p.card && p.card.reps >= 3 && p.built?.scratch) return 4;
  if (p.built?.scratch) return 3;
  if (p.built?.faded) return 2;
  if (p.visualized || p.built?.worked || (p.predictTotal ?? 0) > 0) return 1;
  return 0;
}

export const MASTERY_LABELS = ['new', 'explored', 'built (scaffolded)', 'built from scratch', 'mastered'];

export const isProblemDue = (p?: ProblemProgress) => isDue(p?.card);

export function streak(activity: string[]): number {
  const set = new Set(activity);
  let n = 0;
  const d = new Date();
  // the streak survives until the end of today even if today has no activity yet
  if (!set.has(localDay(d))) d.setDate(d.getDate() - 1);
  while (set.has(localDay(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
