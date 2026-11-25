import type { Topic } from '../types';

/** Learning order. Topics are discovered from their files, so the registry never imports a missing module. */
const ORDER = [
  'er-keys',
  'normal-forms',
  'normalization',
  'denormalization',
  'schema-review',
  'star-schema',
  'fact-types',
  'advanced-dims',
  'scd',
  'data-vault',
  'event-modeling',
  'lakehouse-layout',
  'nosql-access-patterns',
  'schema-evolution',
  'multi-tenancy',
];

const found = new Map<string, Topic>();
const mods = {
  ...import.meta.glob<Record<string, unknown>>('./canvas/*.ts', { eager: true }),
  ...import.meta.glob<Record<string, unknown>>('../labs/*/topic.ts', { eager: true }),
};
for (const m of Object.values(mods))
  for (const v of Object.values(m)) {
    const t = v as Topic;
    if (t && typeof t === 'object' && (t.kind === 'canvas' || t.kind === 'lab') && typeof t.id === 'string') found.set(t.id, t);
  }

const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

export const TOPICS: Topic[] = [...found.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.title.localeCompare(b.title)).map((t, i) => ({ ...t, num: i + 1 }));

export const getTopic = (id?: string): Topic | undefined => TOPICS.find((t) => t.id === id);
