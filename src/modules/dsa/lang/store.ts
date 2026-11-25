import { createPersistedStore } from '@/shared/progress';
import type { Lang } from '../engine/types';

interface LangState {
  /** null until the learner picks one on their first visit. */
  lang: Lang | null;
  setLang: (l: Lang) => void;
}

/** Persisted at `lp:dsa:lang`. */
export const useLangStore = createPersistedStore<LangState>('dsa', 'lang', (set) => ({
  lang: null,
  setLang: (lang) => set({ lang }),
}));

/** The learner's language (Python until they choose). */
export const useLang = (): Lang => useLangStore((s) => s.lang) ?? 'python';
