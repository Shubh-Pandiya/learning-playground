import { useMemo } from 'react';
import { createPersistedStore, isDue, newCard, review, useReportProgress, type PlanItem, type RecallGrade, type ReviewCard } from '@/shared/progress';
import { DIVES } from './data/internals';
import { DECISIONS, INCIDENTS, SIZING, SPOT } from './data/drills';
import { LESSONS } from './data/lessons';
import type { KGraph } from './types';

export type Mode = 'learn' | 'build' | 'challenge';

export interface LessonProgress {
  learnStep: number;
  learnDone: boolean;
  buildSolved: boolean;
  buildBest: number;
  challengeSolved: boolean;
  challengeBest: number;
  /** learn step index → prediction right */
  predictions: Record<number, boolean>;
  hintsUsed: number;
  lastVisited?: string;
}

export interface DrillResult {
  best: number;
  attempts: number;
  at: string;
}

interface KData {
  lessons: Record<string, LessonProgress>;
  /** card id → SRS card. Ids: `q:<lesson>:<i>` (quiz) and `d:<dive>:<frame>` (deep-dive predicts). */
  cards: Record<string, ReviewCard>;
  /** `${lessonId}:${mode}` or `lab` → saved canvas */
  canvases: Record<string, KGraph>;
  last?: { id: string; mode: Mode | 'lab' | 'dive'; path: string; label: string };
  chaos: { right: number; total: number };
  predict: { right: number; total: number };
  dives: Record<string, { frame: number; done: boolean }>;
  /** `${type}:${id}` */
  drills: Record<string, DrillResult>;
}

interface KActions {
  visit: (last: KData['last']) => void;
  setLearnStep: (id: string, step: number) => void;
  completeLearn: (id: string) => void;
  recordPrediction: (id: string, step: number, right: boolean) => void;
  recordPredict: (right: boolean) => void;
  recordChaos: (right: boolean) => void;
  recordResult: (id: string, mode: 'build' | 'challenge', score: number, solved: boolean) => void;
  addHint: (id: string) => void;
  saveCanvas: (key: string, g: KGraph) => void;
  clearCanvas: (key: string) => void;
  grade: (cardId: string, g: RecallGrade) => void;
  setDive: (id: string, frame: number, done?: boolean) => void;
  recordDrill: (type: string, id: string, score: number) => void;
}

export type KState = KData & KActions;

export const emptyLesson = (): LessonProgress => ({ learnStep: 0, learnDone: false, buildSolved: false, buildBest: 0, challengeSolved: false, challengeBest: 0, predictions: {}, hintsUsed: 0 });

export const useKafka = createPersistedStore<KState>(
  'kafka',
  'progress',
  (set) => {
    const patch = (id: string, f: (p: LessonProgress) => Partial<LessonProgress>) =>
      set((s) => {
        const cur = s.lessons[id] ?? emptyLesson();
        return { lessons: { ...s.lessons, [id]: { ...cur, ...f(cur), lastVisited: new Date().toISOString() } } };
      });
    return {
      lessons: {},
      cards: {},
      canvases: {},
      chaos: { right: 0, total: 0 },
      predict: { right: 0, total: 0 },
      dives: {},
      drills: {},
      visit: (last) => set({ last }),
      setLearnStep: (id, step) => patch(id, () => ({ learnStep: step })),
      completeLearn: (id) => patch(id, () => ({ learnDone: true })),
      recordPrediction: (id, step, right) => {
        patch(id, (p) => ({ predictions: { ...p.predictions, [step]: right } }));
        set((s) => ({ predict: { right: s.predict.right + (right ? 1 : 0), total: s.predict.total + 1 } }));
      },
      recordPredict: (right) => set((s) => ({ predict: { right: s.predict.right + (right ? 1 : 0), total: s.predict.total + 1 } })),
      recordChaos: (right) => set((s) => ({ chaos: { right: s.chaos.right + (right ? 1 : 0), total: s.chaos.total + 1 } })),
      recordResult: (id, mode, score, solved) =>
        patch(id, (p) =>
          mode === 'build'
            ? { buildBest: Math.max(p.buildBest, score), buildSolved: p.buildSolved || solved }
            : { challengeBest: Math.max(p.challengeBest, score), challengeSolved: p.challengeSolved || solved },
        ),
      addHint: (id) => patch(id, (p) => ({ hintsUsed: p.hintsUsed + 1 })),
      saveCanvas: (key, g) => set((s) => ({ canvases: { ...s.canvases, [key]: g } })),
      clearCanvas: (key) =>
        set((s) => {
          const next = { ...s.canvases };
          delete next[key];
          return { canvases: next };
        }),
      grade: (cardId, g) => set((s) => ({ cards: { ...s.cards, [cardId]: review(s.cards[cardId] ?? newCard(), g) } })),
      setDive: (id, frame, done) => set((s) => ({ dives: { ...s.dives, [id]: { frame, done: done || !!s.dives[id]?.done } } })),
      recordDrill: (type, id, score) =>
        set((s) => {
          const k = `${type}:${id}`;
          const cur = s.drills[k];
          return { drills: { ...s.drills, [k]: { best: Math.max(cur?.best ?? 0, score), attempts: (cur?.attempts ?? 0) + 1, at: new Date().toISOString() } } };
        }),
    };
  },
  {
    version: 1,
    partialize: (s) => ({ lessons: s.lessons, cards: s.cards, canvases: s.canvases, last: s.last, chaos: s.chaos, predict: s.predict, dives: s.dives, drills: s.drills }),
  },
);

export const isMastered = (p?: LessonProgress) => !!p && p.buildSolved && p.challengeSolved;

/* ---------------- review cards ---------------- */

export interface CardRef {
  id: string;
  source: string;
  path: string;
  q: string;
  options: string[];
  answer: number;
  why: string;
}

/** Every recallable item: lesson quizzes, lesson predictions and deep-dive predictions. */
export const ALL_CARDS: CardRef[] = [
  ...LESSONS.flatMap((l) => [
    ...l.quiz.map((q, i) => ({ id: `q:${l.id}:${i}`, source: `${l.n}. ${l.title}`, path: `/kafka/l/${l.id}/learn`, q: q.q, options: q.options, answer: q.answer, why: q.explain })),
    ...l.learn.flatMap((s, i) => (s.predict ? [{ id: `p:${l.id}:${i}`, source: `${l.n}. ${l.title}`, path: `/kafka/l/${l.id}/learn`, q: s.predict.q, options: s.predict.options, answer: s.predict.answer, why: s.predict.explain }] : [])),
  ]),
  ...DIVES.flatMap((d) => d.frames.flatMap((f, i) => (f.predict ? [{ id: `d:${d.id}:${i}`, source: `Internals · ${d.title}`, path: `/kafka/internals/${d.id}`, q: f.predict.q, options: f.predict.options, answer: f.predict.answer, why: f.predict.explain }] : []))),
];

/** A card becomes reviewable once its source was studied; then the SM-2 schedule decides. */
export function dueCards(s: Pick<KData, 'cards' | 'lessons' | 'dives'>, now = new Date()): CardRef[] {
  return ALL_CARDS.filter((c) => {
    const card = s.cards[c.id];
    if (card) return isDue(card, now);
    const [kind, src] = c.id.split(':');
    if (kind === 'd') return !!s.dives[src]?.done;
    return !!s.lessons[src]?.learnDone;
  }).sort((a, b) => (s.cards[a.id]?.due ?? '').localeCompare(s.cards[b.id]?.due ?? ''));
}

/* ---------------- home-page report ---------------- */

const DRILL_TOTAL = INCIDENTS.length + SIZING.length + SPOT.length + DECISIONS.length;

function nextSteps(s: KData): PlanItem[] {
  const out: PlanItem[] = [];
  const l = LESSONS.find((x) => !isMastered(s.lessons[x.id]));
  if (l) {
    const p = s.lessons[l.id];
    if (!p?.learnDone) out.push({ label: `Kafka: ${l.n}. ${l.title}`, path: `/kafka/l/${l.id}/learn`, kind: 'learn', minutes: l.minutes, detail: l.tagline });
    else if (!p.buildSolved) out.push({ label: `Kafka build: ${l.build.title}`, path: `/kafka/l/${l.id}/build`, kind: 'practice', minutes: 12, detail: 'Fix a broken pipeline on the live cluster' });
    else out.push({ label: `Kafka challenge: ${l.challenge.title}`, path: `/kafka/l/${l.id}/challenge`, kind: 'challenge', minutes: 12, detail: `Transfer ${l.title.toLowerCase()} to a new system` });
  }
  const dive = l && DIVES.find((d) => l.deepDives.includes(d.id) && !s.dives[d.id]?.done);
  if (dive) out.push({ label: `Kafka internals: ${dive.title}`, path: `/kafka/internals/${dive.id}`, kind: 'learn', minutes: dive.minutes, detail: dive.tagline });
  if (Object.values(s.lessons).some((x) => x.buildSolved)) {
    const inc = INCIDENTS.find((x) => !s.drills[`incident:${x.id}`]);
    if (inc) out.push({ label: `Kafka incident: ${inc.title}`, path: `/kafka/drills/incident/${inc.id}`, kind: 'practice', minutes: 6, detail: 'Diagnose from symptoms, then watch the fix' });
  }
  return out.slice(0, 3);
}

function reviewPlan(due: CardRef[]): PlanItem[] {
  const per = new Map<string, { n: number; path: string }>();
  for (const c of due) per.set(c.source, { n: (per.get(c.source)?.n ?? 0) + 1, path: c.path });
  return [...per.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 5)
    .map(([src, v]) => ({ label: `Review Kafka: ${src}`, path: '/kafka/review', kind: 'review' as const, minutes: Math.max(2, Math.round(v.n * 1.2)), detail: `${v.n} recall card${v.n > 1 ? 's' : ''} due` }));
}

export function useKafkaReport() {
  const s = useKafka();
  const summary = useMemo(() => {
    const due = dueCards(s);
    const mastered = LESSONS.filter((l) => isMastered(s.lessons[l.id])).length;
    const divesDone = DIVES.filter((d) => s.dives[d.id]?.done).length;
    const drillsDone = Object.keys(s.drills).length;
    const resume = s.last ? { label: s.last.label, path: s.last.path } : { label: `Start: ${LESSONS[0].title}`, path: `/kafka/l/${LESSONS[0].id}/learn` };
    return {
      completed: mastered,
      total: LESSONS.length,
      unit: 'lessons',
      detail: `${divesDone}/${DIVES.length} internals · ${drillsDone}/${DRILL_TOTAL} drills`,
      dueForReview: due.length,
      resume,
      reviews: reviewPlan(due),
      nextSteps: nextSteps(s),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.lessons, s.cards, s.dives, s.drills, s.last]);
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useReportProgress('kafka', summary);
  } catch {
    /* reporting must never break the module */
  }
}
