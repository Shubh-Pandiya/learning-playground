/**
 * Minimal SM-2-style spaced-repetition scheduler (Leitner-like intervals).
 * Store `ReviewCard` per item in your module's persisted store.
 */
export interface ReviewCard {
  /** Consecutive successful recalls. */
  reps: number;
  /** Current interval in days. */
  interval: number;
  /** Ease factor (>= 1.3). */
  ease: number;
  /** ISO date when the item is next due. */
  due: string;
  lastReviewed?: string;
}

/** 0 = forgot, 1 = hard, 2 = good, 3 = easy */
export type RecallGrade = 0 | 1 | 2 | 3;

const DAY = 24 * 60 * 60 * 1000;

export function newCard(now = new Date()): ReviewCard {
  return { reps: 0, interval: 0, ease: 2.5, due: now.toISOString() };
}

export function review(card: ReviewCard, grade: RecallGrade, now = new Date()): ReviewCard {
  let { reps, interval, ease } = card;
  if (grade === 0) {
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    if (reps === 1) interval = grade === 1 ? 1 : 2;
    else if (reps === 2) interval = grade === 1 ? 3 : 6;
    else interval = Math.round(interval * ease * (grade === 1 ? 0.6 : grade === 3 ? 1.3 : 1));
  }
  ease = Math.max(1.3, ease + (grade === 3 ? 0.15 : grade === 2 ? 0 : grade === 1 ? -0.15 : -0.2));
  return {
    reps,
    interval,
    ease,
    due: new Date(now.getTime() + interval * DAY).toISOString(),
    lastReviewed: now.toISOString(),
  };
}

export function isDue(card: ReviewCard | undefined, now = new Date()): boolean {
  return !!card && new Date(card.due).getTime() <= now.getTime();
}
