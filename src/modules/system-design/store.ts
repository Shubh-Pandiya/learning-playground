import { useEffect } from 'react';
import { createPersistedStore, isDue, newCard, reportProgress, review, type PlanItem, type RecallGrade, type ReviewCard } from '@/shared/progress';
import { PATTERNS, getPattern } from './data/patterns';
import { ADRS } from './judgment/data/adrs';
import { INCIDENTS } from './judgment/data/incidents';
import { REVIEWS } from './judgment/data/reviews';
import type { ComponentKind, GEdge, GNode } from './types';

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

/** Progress on a component's "Inside" (internals) view. */
export interface InsideProgress {
  seen?: boolean;
  assembled?: boolean;
  lab?: boolean;
  /** Read the deep guide to the end. */
  guide?: boolean;
  /** Attempted the SDE-3 interview questions. */
  interview?: boolean;
}

export type DrillType = 'review' | 'incident' | 'adr';

export interface DrillResult {
  /** best score 0..100 */
  best: number;
  attempts: number;
  at: string;
}

export interface AdrDraft {
  choice: number | null;
  text: string;
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
  inside: Partial<Record<ComponentKind, InsideProgress>>;
  /** `${type}:${id}` → result */
  drills: Record<string, DrillResult>;
  adrDrafts: Record<string, AdrDraft>;
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
  markInside: (kind: ComponentKind, field: keyof InsideProgress) => void;
  recordDrill: (type: DrillType, id: string, score: number) => void;
  saveAdrDraft: (id: string, d: AdrDraft) => void;
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
      inside: {},
      drills: {},
      adrDrafts: {},
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
      markInside: (kind, field) =>
        set((s) => (s.inside[kind]?.[field] ? {} : { inside: { ...s.inside, [kind]: { ...s.inside[kind], [field]: true } } })),
      recordDrill: (type, id, score) =>
        set((s) => {
          const k = `${type}:${id}`;
          const cur = s.drills[k];
          return { drills: { ...s.drills, [k]: { best: Math.max(cur?.best ?? 0, score), attempts: (cur?.attempts ?? 0) + 1, at: new Date().toISOString() } } };
        }),
      saveAdrDraft: (id, d) => set((s) => ({ adrDrafts: { ...s.adrDrafts, [id]: d } })),
    };
  },
  {
    version: 1,
    partialize: (s) => ({
      patterns: s.patterns,
      cards: s.cards,
      canvases: s.canvases,
      last: s.last,
      chaos: s.chaos,
      inside: s.inside,
      drills: s.drills,
      adrDrafts: s.adrDrafts,
    }),
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

/** Due recall cards grouped per pattern, most cards first. */
function reviewPlan(cards: Record<string, ReviewCard>): PlanItem[] {
  const per = new Map<string, number>();
  for (const d of dueQuestions(cards)) per.set(d.patternId, (per.get(d.patternId) ?? 0) + 1);
  return [...per.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n]) => {
      const p = getPattern(id)!;
      return { label: `Review: ${p.title}`, path: '/system-design/review', kind: 'review' as const, minutes: Math.max(2, n * 1.5), detail: `${n} recall card${n > 1 ? 's' : ''} due` };
    });
}

/** The next pattern step in curriculum order, then a judgment drill not yet attempted. */
function nextPlan(patterns: Record<string, PatternProgress>, drills: Record<string, DrillResult>): PlanItem[] {
  const out: PlanItem[] = [];
  const p = PATTERNS.find((x) => !isMastered(patterns[x.id]));
  if (p) {
    const pr = patterns[p.id];
    if (!pr?.guidedDone) out.push({ label: `Learn: ${p.num}. ${p.title}`, path: `/system-design/p/${p.id}/learn`, kind: 'learn', minutes: 10, detail: 'Narrated walkthrough with predictions' });
    else if (!pr.buildSolved) out.push({ label: `Build: ${p.title}`, path: `/system-design/p/${p.id}/build`, kind: 'practice', minutes: 15, detail: 'Rebuild the design from a blank canvas' });
    else out.push({ label: `Challenge: ${p.challenge.title}`, path: `/system-design/p/${p.id}/challenge`, kind: 'challenge', minutes: 15, detail: `Transfer ${p.title} to a new domain` });
  }
  const builtAny = Object.values(patterns).some((x) => x.buildSolved);
  if (builtAny) {
    const inc = INCIDENTS.find((x) => !drills[`incident:${x.id}`]);
    if (inc) out.push({ label: `Incident drill: ${inc.title}`, path: `/system-design/practice/incident/${inc.id}`, kind: 'practice', minutes: 8, detail: 'Diagnose and mitigate a live outage' });
    const rev = REVIEWS.find((x) => !drills[`review:${x.id}`]);
    if (rev) out.push({ label: `Design review: ${rev.title}`, path: `/system-design/practice/review/${rev.id}`, kind: 'practice', minutes: 8, detail: 'Find the flaws a senior reviewer would' });
    const adr = ADRS.find((x) => !drills[`adr:${x.id}`]);
    if (adr) out.push({ label: `Decision record: ${adr.title}`, path: `/system-design/practice/adr/${adr.id}`, kind: 'challenge', minutes: 10, detail: 'Write a tradeoff decision, compare with an expert' });
  }
  return out.slice(0, 3);
}

/** Keeps the home-page card in sync. Call once at the module root. */
export function useSdReport() {
  const patterns = useSd((s) => s.patterns);
  const cards = useSd((s) => s.cards);
  const last = useSd((s) => s.last);
  const drills = useSd((s) => s.drills);
  const built = PATTERNS.filter((p) => patterns[p.id]?.buildSolved).length;
  const mastered = PATTERNS.filter((p) => isMastered(patterns[p.id])).length;
  const walked = PATTERNS.filter((p) => patterns[p.id]?.guidedDone).length;
  const lastP = getPattern(last?.id);
  const due = dueQuestions(cards).length;
  const resume = lastP && last ? { label: `${lastP.num}. ${lastP.title} · ${MODE_LABEL[last.mode]}`, path: `/system-design/p/${lastP.id}/${last.mode}` } : { label: 'Pattern map', path: '/system-design' };
  const nDrills = Object.keys(drills).length;
  const detail = `${walked} walkthroughs · ${mastered} mastered · ${nDrills} judgment drills`;
  const reviews = reviewPlan(cards);
  const nextSteps = nextPlan(patterns, drills);
  const planKey = [...reviews, ...nextSteps].map((x) => x.label + x.detail).join('|');
  useEffect(() => {
    try {
      reportProgress('system-design', { completed: built, total: PATTERNS.length, unit: 'patterns', detail, dueForReview: due, resume, reviews, nextSteps });
    } catch {
      // progress reporting must never break the module
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, detail, due, resume.path, planKey]);
}
