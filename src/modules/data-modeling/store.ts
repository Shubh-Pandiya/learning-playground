import { useEffect } from 'react';
import { createPersistedStore, isDue, newCard, reportProgress, review, type PlanItem, type RecallGrade, type ReviewCard } from '@/shared/progress';
import { TOPICS, getTopic } from './data/topics';
import type { Schema, Topic } from './types';

export type Mode = 'learn' | 'build' | 'challenge' | 'lab';

export interface TopicProgress {
  guidedStep: number;
  guidedDone: boolean;
  buildSolved: boolean;
  buildBest: number;
  challengeSolved: boolean;
  challengeBest: number;
  /** prediction key → was right */
  predictions: Record<string, boolean>;
  hintsUsed: number;
  /** lab exercise id → done */
  exercises: Record<string, boolean>;
  lastVisited?: string;
}

interface DmData {
  topics: Record<string, TopicProgress>;
  /** quiz question id → spaced-repetition card */
  cards: Record<string, ReviewCard>;
  /** `${topicId}:${mode}` → user's schema */
  canvases: Record<string, Schema>;
  last?: { id: string; mode: Mode };
}

interface DmActions {
  visit: (id: string, mode: Mode) => void;
  setGuidedStep: (id: string, step: number) => void;
  completeGuided: (id: string) => void;
  /** Record a predict-before-reveal answer. `key` is unique within the topic. */
  recordPrediction: (id: string, key: string, right: boolean) => void;
  recordResult: (id: string, mode: 'build' | 'challenge', score: number, solved: boolean) => void;
  addHint: (id: string) => void;
  /** Mark a lab exercise as completed. */
  markExercise: (id: string, exerciseId: string) => void;
  saveCanvas: (id: string, mode: Mode, s: Schema) => void;
  clearCanvas: (id: string, mode: Mode) => void;
  grade: (qid: string, g: RecallGrade) => void;
}

export type DmState = DmData & DmActions;

export const emptyProgress = (): TopicProgress => ({
  guidedStep: 0,
  guidedDone: false,
  buildSolved: false,
  buildBest: 0,
  challengeSolved: false,
  challengeBest: 0,
  predictions: {},
  hintsUsed: 0,
  exercises: {},
});

export const canvasKey = (id: string, mode: Mode) => `${id}:${mode}`;

export const useDm = createPersistedStore<DmState>(
  'dm',
  'progress',
  (set) => {
    const patch = (id: string, f: (p: TopicProgress) => Partial<TopicProgress>) =>
      set((s) => {
        const cur = { ...emptyProgress(), ...s.topics[id] };
        return { topics: { ...s.topics, [id]: { ...cur, ...f(cur) } } };
      });
    return {
      topics: {},
      cards: {},
      canvases: {},
      visit: (id, mode) => {
        patch(id, () => ({ lastVisited: new Date().toISOString() }));
        set({ last: { id, mode } });
      },
      setGuidedStep: (id, step) => patch(id, () => ({ guidedStep: step })),
      completeGuided: (id) => patch(id, () => ({ guidedDone: true })),
      recordPrediction: (id, key, right) => patch(id, (p) => (key in p.predictions ? {} : { predictions: { ...p.predictions, [key]: right } })),
      recordResult: (id, mode, score, solved) =>
        patch(id, (p) =>
          mode === 'build'
            ? { buildBest: Math.max(p.buildBest, score), buildSolved: p.buildSolved || solved }
            : { challengeBest: Math.max(p.challengeBest, score), challengeSolved: p.challengeSolved || solved },
        ),
      addHint: (id) => patch(id, (p) => ({ hintsUsed: p.hintsUsed + 1 })),
      markExercise: (id, ex) => patch(id, (p) => (p.exercises[ex] ? {} : { exercises: { ...p.exercises, [ex]: true } })),
      saveCanvas: (id, mode, sc) => set((s) => ({ canvases: { ...s.canvases, [canvasKey(id, mode)]: sc } })),
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
    partialize: (s) => ({ topics: s.topics, cards: s.cards, canvases: s.canvases, last: s.last }),
  },
);

/** Read one topic's progress with defaults filled in. */
export const progressOf = (topics: Record<string, TopicProgress>, id: string): TopicProgress | undefined =>
  topics[id] ? { ...emptyProgress(), ...topics[id] } : undefined;

export function exercisesDone(t: Topic, p?: TopicProgress): number {
  if (t.kind !== 'lab' || !p) return 0;
  return t.exercises.filter((e) => p.exercises?.[e.id]).length;
}

/** Canvas topics: build + transfer challenge solved. Labs: every exercise done. */
export function isMastered(t: Topic, p?: TopicProgress): boolean {
  if (!p) return false;
  if (t.kind === 'lab') return exercisesDone(t, p) === t.exercises.length;
  return p.buildSolved && p.challengeSolved;
}

export function isStarted(t: Topic, p?: TopicProgress): boolean {
  if (!p) return false;
  return t.kind === 'lab' ? exercisesDone(t, p) > 0 || !!p.lastVisited : p.guidedDone || p.buildBest > 0;
}

/** Where a topic card should send you next. */
export function nextMode(t: Topic, p?: TopicProgress): Mode {
  if (t.kind === 'lab') return 'lab';
  if (!p?.guidedDone) return 'learn';
  return p.buildSolved ? 'challenge' : 'build';
}

export const topicPath = (t: Topic, mode: Mode) => (t.kind === 'lab' ? `/data-modeling/t/${t.id}` : `/data-modeling/t/${t.id}/${mode}`);

export function dueQuestions(cards: Record<string, ReviewCard>) {
  const out: { topicId: string; qid: string; due: string }[] = [];
  for (const t of TOPICS) for (const q of t.quiz) if (isDue(cards[q.id])) out.push({ topicId: t.id, qid: q.id, due: cards[q.id].due });
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

const MODE_LABEL: Record<Mode, string> = { learn: 'Learn', build: 'Build', challenge: 'Challenge', lab: 'Lab' };

/** Keeps the home-page card and Today plan in sync. Call once at the module root. */
export function useDmReport() {
  const topics = useDm((s) => s.topics);
  const cards = useDm((s) => s.cards);
  const last = useDm((s) => s.last);
  const mastered = TOPICS.filter((t) => isMastered(t, progressOf(topics, t.id))).length;
  const started = TOPICS.filter((t) => isStarted(t, progressOf(topics, t.id))).length;
  const due = dueQuestions(cards);
  const lastT = getTopic(last?.id);
  const resume = lastT && last ? { label: `${lastT.title} · ${MODE_LABEL[last.mode]}`, path: topicPath(lastT, last.mode) } : { label: 'Topic map', path: '/data-modeling' };
  const detail = `${started} / ${TOPICS.length} topics started · ${mastered} mastered`;

  const reviewsKey = due.map((d) => d.qid).join(',');
  const nextKey = JSON.stringify(topics);
  useEffect(() => {
    try {
      const seen = new Set<string>();
      const reviews: PlanItem[] = [];
      for (const d of due) {
        if (seen.has(d.topicId)) continue;
        seen.add(d.topicId);
        const t = getTopic(d.topicId)!;
        const n = due.filter((x) => x.topicId === d.topicId).length;
        reviews.push({ label: `Recall: ${t.title}`, path: '/data-modeling/review', kind: 'review', minutes: Math.max(2, n), detail: `${n} question${n > 1 ? 's' : ''} due` });
        if (reviews.length >= 5) break;
      }
      const nextSteps: PlanItem[] = [];
      for (const t of TOPICS) {
        const p = progressOf(topics, t.id);
        if (isMastered(t, p)) continue;
        const m = nextMode(t, p);
        nextSteps.push({
          label: `${t.title} · ${MODE_LABEL[m]}`,
          path: topicPath(t, m),
          kind: m === 'learn' ? 'learn' : m === 'challenge' ? 'challenge' : 'practice',
          minutes: m === 'learn' ? Math.round(t.minutes / 2) : Math.round(t.minutes / 2) || 10,
          detail: m === 'challenge' ? 'transfer: same technique, new domain' : t.tagline,
        });
        if (nextSteps.length >= 3) break;
      }
      reportProgress('data-modeling', { completed: mastered, total: TOPICS.length, unit: 'topics', detail, dueForReview: due.length, resume, reviews, nextSteps });
    } catch {
      // progress reporting must never break the module
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mastered, detail, reviewsKey, resume.path, nextKey]);
}
