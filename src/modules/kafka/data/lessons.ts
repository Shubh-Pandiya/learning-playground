import type { Lesson } from './lesson';
import { L1, L2, L3, L4, L5 } from './lessons-a';
import { LESSONS_B } from './lessons-b';

export const LESSONS: Lesson[] = [L1, L2, L3, L4, L5, ...LESSONS_B];
export const lessonById = (id: string | undefined) => LESSONS.find((l) => l.id === id);
