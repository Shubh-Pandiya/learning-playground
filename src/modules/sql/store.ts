import { createPersistedStore, isDue, newCard, review, type RecallGrade, type ReviewCard } from '@/shared/progress';
import type { Concept } from './types';

export type BuildMode = 'worked' | 'faded' | 'scratch';

export interface ConceptProgress {
  /** stepped through the visualizer to the end */
  visualized?: boolean;
  predictRight?: number;
  predictTotal?: number;
  built?: Partial<Record<BuildMode, boolean>>;
  /** exercise id → solved */
  solved?: Record<string, boolean>;
  /** judgment id → diagnosed correctly on first try */
  judged?: Record<string, boolean>;
  hintsUsed?: number;
  /** self-explanation ("explain it to a junior") */
  note?: string;
  card?: ReviewCard;
  lastVisited?: string;
}

export interface SqlState {
  concepts: Record<string, ConceptProgress>;
  /** concept id → recognition drill stats */
  drill: Record<string, { right: number; total: number }>;
  /** transfer item id → answered correctly */
  transfer: Record<string, boolean>;
  activity: string[];
  lastConcept: string | null;
  predictMode: boolean;
  /** Lab editor contents survive reloads */
  labSql: string;

  visit: (id: string) => void;
  patch: (id: string, p: Partial<ConceptProgress>) => void;
  recordPrediction: (id: string, correct: boolean) => void;
  recordBuild: (id: string, mode: BuildMode) => void;
  recordSolve: (id: string, exerciseId: string) => void;
  recordHint: (id: string) => void;
  recordJudgment: (id: string, itemId: string, correct: boolean) => void;
  recordDrill: (id: string, transferId: string, correct: boolean) => void;
  grade: (id: string, g: RecallGrade) => void;
  setPredictMode: (v: boolean) => void;
  setLabSql: (sql: string) => void;
}

const today = () => new Date().toLocaleDateString('en-CA');
const withActivity = (a: string[]) => (a.includes(today()) ? a : [...a, today()].slice(-400));

/** Concepts enter spaced review once they have been built or practised. */
const ensureCard = (p: ConceptProgress): ConceptProgress => (p.card ? p : { ...p, card: newCard() });

export const useSql = createPersistedStore<SqlState>(
  'sql',
  'progress',
  (set) => {
    const upd = (id: string, fn: (p: ConceptProgress) => ConceptProgress) =>
      set((s) => ({ concepts: { ...s.concepts, [id]: fn(s.concepts[id] ?? {}) }, activity: withActivity(s.activity) }));
    return {
      concepts: {},
      drill: {},
      transfer: {},
      activity: [],
      lastConcept: null,
      predictMode: true,
      labSql: '',

      visit: (id) =>
        set((s) => ({
          lastConcept: id,
          concepts: { ...s.concepts, [id]: { ...(s.concepts[id] ?? {}), lastVisited: new Date().toISOString() } },
        })),
      patch: (id, p) => upd(id, (c) => ({ ...c, ...p })),
      recordPrediction: (id, ok) => upd(id, (c) => ({ ...c, predictRight: (c.predictRight ?? 0) + (ok ? 1 : 0), predictTotal: (c.predictTotal ?? 0) + 1 })),
      recordBuild: (id, mode) => upd(id, (c) => (mode === 'worked' ? { ...c, built: { ...c.built, worked: true } } : ensureCard({ ...c, built: { ...c.built, [mode]: true } }))),
      recordSolve: (id, ex) => upd(id, (c) => ensureCard({ ...c, solved: { ...c.solved, [ex]: true } })),
      recordHint: (id) => upd(id, (c) => ({ ...c, hintsUsed: (c.hintsUsed ?? 0) + 1 })),
      recordJudgment: (id, item, ok) => upd(id, (c) => ({ ...c, judged: { ...c.judged, [item]: c.judged?.[item] ?? ok } })),
      recordDrill: (id, tid, ok) =>
        set((s) => {
          const d = s.drill[id] ?? { right: 0, total: 0 };
          return {
            drill: { ...s.drill, [id]: { right: d.right + (ok ? 1 : 0), total: d.total + 1 } },
            transfer: { ...s.transfer, [tid]: s.transfer[tid] || ok },
            activity: withActivity(s.activity),
          };
        }),
      grade: (id, g) => upd(id, (c) => ({ ...c, card: review(c.card ?? newCard(), g) })),
      setPredictMode: (v) => set({ predictMode: v }),
      setLabSql: (sql) => set({ labSql: sql }),
    };
  },
  { version: 1 },
);

export const MASTERY_LABELS = ['new', 'explored', 'built', 'practised', 'mastered'] as const;

/** 0 new · 1 visualised · 2 built (faded/scratch) · 3 solved an exercise · 4 scratch build + all exercises + 1 successful review */
export function mastery(c: Concept, p?: ConceptProgress): 0 | 1 | 2 | 3 | 4 {
  if (!p) return 0;
  const solved = c.exercises.filter((e) => p.solved?.[e.id]).length;
  if (solved === c.exercises.length && c.exercises.length > 0 && (p.built?.scratch || !c.build) && (p.card?.reps ?? 0) >= 1) return 4;
  if (solved > 0) return 3;
  if (p.built?.faded || p.built?.scratch) return 2;
  if (p.visualized || p.built?.worked || (p.predictTotal ?? 0) > 0) return 1;
  return 0;
}

export const isConceptDue = (p?: ConceptProgress) => isDue(p?.card);
