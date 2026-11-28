import { createPersistedStore, isDue, newCard, review, type RecallGrade, type ReviewCard } from '@/shared/progress';
import { TOPICS, type Topic } from './data';
import { COUNTERFACTUALS } from './scenarios';

interface State {
  studied: Record<string, boolean>;
  solved: Record<string, boolean>;
  ordered: Record<string, boolean>;
  cards: Record<string, ReviewCard>;
  confidence: { attempts: number; high: number; highWrong: number };
  last?: string;
  visit: (id: string) => void;
  study: (id: string) => void;
  solve: (id: string) => void;
  order: (id: string) => void;
  grade: (id: string, grade: RecallGrade, confident: boolean, correct: boolean) => void;
}

export const useJava = createPersistedStore<State>('java', 'progress', (set) => ({
  studied: {}, solved: {}, ordered: {}, cards: {},
  confidence: { attempts: 0, high: 0, highWrong: 0 },
  visit: (last) => set({ last }),
  study: (id) => set((s) => ({ studied: { ...s.studied, [id]: true } })),
  solve: (id) => set((s) => ({ solved: { ...s.solved, [id]: true } })),
  order: (id) => set((s) => ({ ordered: { ...s.ordered, [id]: true } })),
  grade: (id, grade, confident, correct) => set((s) => ({
    cards: { ...s.cards, [id]: review(s.cards[id] ?? newCard(), correct ? grade : 0) },
    confidence: {
      attempts: s.confidence.attempts + 1,
      high: s.confidence.high + Number(confident),
      highWrong: s.confidence.highWrong + Number(confident && !correct),
    },
  })),
}), { version: 1, partialize: (s) => ({ studied: s.studied, solved: s.solved, ordered: s.ordered, cards: s.cards, confidence: s.confidence, last: s.last }) });

export interface ReviewItem { id: string; topic: Topic; kind: 'prediction' | 'recall' | 'drill' | 'counterfactual' }
export const REVIEW_ITEMS: ReviewItem[] = TOPICS.flatMap((topic) =>
  (['prediction', 'recall', 'drill'] as const).map((kind) => ({ id: `${topic.id}:${kind}`, topic, kind })),
);

export function dueItems(state: Pick<State, 'studied' | 'cards'>, now = new Date()): ReviewItem[] {
  // Round-robin across topics and domains instead of blocking all cards from one lesson.
  const java = TOPICS.filter((t) => t.domain === 'Java');
  const spring = TOPICS.filter((t) => t.domain === 'Spring');
  const topics = java.flatMap((t, i) => spring[i] ? [t, spring[i]] : [t]);
  topics.push(...spring.slice(java.length));
  return (['prediction', 'recall', 'drill', 'counterfactual'] as const).flatMap((kind) => topics.flatMap((topic) => {
    const id = `${topic.id}:${kind}`;
    if (kind === 'counterfactual' && (!COUNTERFACTUALS[topic.id] || !state.cards[id])) return [];
    return state.studied[topic.id] && (!state.cards[id] || isDue(state.cards[id], now))
      ? [{ id, topic, kind }] : [];
  }));
}

export function mastered(topic: Topic, state: Pick<State, 'studied' | 'solved' | 'ordered' | 'cards'>): boolean {
  return !!state.studied[topic.id] && !!state.solved[topic.id]
    && (!topic.order || !!state.ordered[topic.id])
    && (state.cards[`${topic.id}:recall`]?.reps ?? 0) > 0;
}
