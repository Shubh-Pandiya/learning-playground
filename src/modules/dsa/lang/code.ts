import type { Distractor, Lang, Pattern, Problem } from '../engine/types';

export const LANG_META: Record<Lang, { label: string; short: string; prism: string; comment: string }> = {
  python: { label: 'Python', short: 'Py', prism: 'python', comment: '#' },
  java: { label: 'Java', short: 'Java', prism: 'java', comment: '//' },
  cpp: { label: 'C++', short: 'C++', prism: 'cpp', comment: '//' },
};

/** Solution code (with `@key` markers) in the chosen language; falls back to Python if a translation is missing. */
export function problemCode(p: Problem, lang: Lang): string {
  return lang === 'python' ? p.code : (p.langs?.[lang] ?? p.code);
}

export function problemDistractors(p: Problem, lang: Lang): Distractor[] {
  return translateDistractors(p.distractors, p.langs?.distractors, lang);
}

export function patternTemplate(p: Pattern, lang: Lang): string {
  return lang === 'python' ? p.template : (p.langs?.[lang] ?? p.template);
}

export function patternDistractors(p: Pattern, lang: Lang): Distractor[] {
  return translateDistractors(p.distractors, p.langs?.distractors, lang);
}

export function gotchas(x: Problem | Pattern | undefined, lang: Lang): string[] {
  return x?.langs?.gotchas?.[lang] ?? [];
}

function translateDistractors(base: Distractor[], alt: { java: string; cpp: string }[] | undefined, lang: Lang): Distractor[] {
  if (lang === 'python') return base;
  return base.map((d, i) => ({ ...d, text: alt?.[i]?.[lang] ?? d.text }));
}

/** Lines that only close a block (`}`, `};`, `});`) — structural noise in the builder. */
export const isClosingLine = (text: string) => /^\s*[})\];]+\s*$/.test(text);
