import { useEffect } from 'react';
import { createPersistedStore, isDue, newCard, reportProgress, review, type RecallGrade, type ReviewCard } from '@/shared/progress';
import { PATTERNS, getPattern } from './data/patterns';
import type { GEdge, GNode } from './types';

export type Mode = 'learn' | 'build' | 'challenge';

export interface PatternProgress {
  guidedStep: number;
  guidedDone: boolean;
  buildSolved: boolean;
  buildBest: number;
  challengeSolved: boolean;
  challengeBest: number;
  /** guided step index → prediction was right */
  predictions: Record<number, boolean>;
  hintsUsed: number;
  lastVisited?: string;
}

export interface SavedCanvas {
  nodes: GNode[];
  edges: GEdge[];
  traffic?: number;
}

interface SdData {
  patterns: Record<string, PatternProgress>;
  /** quiz question id → spaced-repetition card */
  cards: Record<string, ReviewCard>;
  /** `${patternId}:${mode}` → user's canvas */
  canvases: Record<string, SavedCanvas>;
  last?: { id: string; mode: Mode };
  chaos: { right: number; total: number };
}

interface SdActions {
  visit: (id: string, mode: Mode) => void;
  setGuidedStep: (id: string, step: number) => void;
  completeGuided: (id: string) => void;
  recordPrediction: (id: string, step: number, right: boolean) => void;
  recordChaos: (right: boolean) => void;
  recordResult: (id: string, mode: 'build' | 'challenge', score: number, solved: boolean) => void;
  addHint: (id: string) => void;
  saveCanvas: (id: string, mode: Mode, c: SavedCanvas) => void;
  clearCanvas: (id: string, mode: Mode) => void;
  grade: (qid: string, g: RecallGrade) => void;
}

export type SdState = SdData & SdActions;

export const emptyProgress = (): PatternProgress => ({
  guidedStep: 0,
  guidedDone: false,
  buildSolved: false,
  buildBest: 0,
  challengeSolved: false,
  challengeBest: 0,
  predictions: {},
  hintsUsed: 0,
});

export const canvasKey = (id: string, mode: Mode) => `${id}:${mode}`;

export const useSd = createPersistedStore<SdState>(
  'sd',
  'progress',
  (set) => {
    const patch = (id: string, f: (p: PatternProgress) => Partial<PatternProgress>) =>
      set((s) => {
        const cur = s.patterns[id] ?? emptyProgress();
        return { patterns: { ...s.patterns, [id]: { ...cur, ...f(cur) } } };
      });
    return {
      patterns: {},
      cards: {},
      canvases: {},
      chaos: { right: 0, total: 0 },
      visit: (id, mode) => {
        patch(id, () => ({ lastVisited: new Date().toISOString() }));
        set({ last: { id, mode } });
      },
      setGuidedStep: (id, step) => patch(id, (p) => ({ guidedStep: step, guidedDone: p.guidedDone })),
      completeGuided: (id) => patch(id, () => ({ guidedDone: true })),
      recordPrediction: (id, step, right) => patch(id, (p) => ({ predictions: { ...p.predictions, [step]: right } })),
      recordChaos: (right) => set((s) => ({ chaos: { right: s.chaos.right + (right ? 1 : 0), total: s.chaos.total + 1 } })),
      recordResult: (id, mode, score, solved) =>
        patch(id, (p) =>
          mode === 'build'
            ? { buildBest: Math.max(p.buildBest, score), buildSolved: p.buildSolved || solved }
            : { challengeBest: Math.max(p.challengeBest, score), challengeSolved: p.challengeSolved || solved },
        ),
      addHint: (id) => patch(id, (p) => ({ hintsUsed: p.hintsUsed + 1 })),
      saveCanvas: (id, mode, c) => set((s) => ({ canvases: { ...s.canvases, [canvasKey(id, mode)]: c } })),
      clearCanvas: (id, mode) =>
        set((s) => {
          const next = { ...s.canvases };
          delete next[canvasKey(id, mode)];
          return { canvases: next };
        }),
      grade: (qid, g) => set((s) => ({ cards: { ...s.cards, [qid]: review(s.cards[qid] ?? newCard(), g) } })),
    };
  },
  {
    version: 1,
    partialize: (s) => ({ patterns: s.patterns, cards: s.cards, canvases: s.canvases, last: s.last, chaos: s.chaos }),
  },
);

/** A pattern is "mastered" once both its build and its transfer challenge are solved. */
export const isMastered = (p?: PatternProgress) => !!p && p.buildSolved && p.challengeSolved;

export function dueQuestions(cards: Record<string, ReviewCard>) {
  const out: { patternId: string; qid: string }[] = [];
  for (const p of PATTERNS) for (const q of p.quiz) if (isDue(cards[q.id])) out.push({ patternId: p.id, qid: q.id });
  return out;
}

const MODE_LABEL: Record<Mode, string> = { learn: 'Learn', build: 'Build', challenge: 'Challenge' };

/** Keeps the home-page card in sync. Call once at the module root. */
export function useSdReport() {
  const patterns = useSd((s) => s.patterns);
  const cards = useSd((s) => s.cards);
  const last = useSd((s) => s.last);
  const built = PATTERNS.filter((p) => patterns[p.id]?.buildSolved).length;
  const mastered = PATTERNS.filter((p) => isMastered(patterns[p.id])).length;
  const walked = PATTERNS.filter((p) => patterns[p.id]?.guidedDone).length;
  const lastP = getPattern(last?.id);
  const due = dueQuestions(cards).length;
  const resume = lastP && last ? { label: `${lastP.num}. ${lastP.title} · ${MODE_LABEL[last.mode]}`, path: `/system-design/p/${lastP.id}/${last.mode}` } : { label: 'Pattern map', path: '/system-design' };
  const detail = `${walked} walkthroughs · ${mastered} mastered (transfer challenge solved)`;
  useEffect(() => {
    try {
      reportProgress('system-design', { completed: built, total: PATTERNS.length, unit: 'patterns', detail, dueForReview: due, resume });
    } catch {
      // progress reporting must never break the module
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, detail, due, resume.path]);
}
