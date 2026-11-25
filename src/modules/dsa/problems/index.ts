import type { CategoryId, LangPack, PatternId, Problem, Variant } from '../engine/types';
import { categories } from '../data/categories';

// Every category file in this folder exports `problems` and `variants`.
const modules = import.meta.glob<{ problems?: Problem[]; variants?: Variant[] }>(['./*.ts', '!./index.ts'], {
  eager: true,
});

// Java / C++ translations live in ./lang/<category>.ts as `langs: Record<problemId, LangPack>`.
const langModules = import.meta.glob<{ langs?: Record<string, LangPack> }>('./lang/*.ts', { eager: true });
const langPacks: Record<string, LangPack> = Object.assign({}, ...Object.values(langModules).map((m) => m.langs ?? {}));

const order = Object.fromEntries(categories.map((c) => [c.id, c.order])) as Record<CategoryId, number>;

const collected: Problem[] = [];
const collectedVariants: Variant[] = [];
for (const mod of Object.values(modules)) {
  collected.push(...(mod.problems ?? []));
  collectedVariants.push(...(mod.variants ?? []));
}

/** All problems in NeetCode roadmap order (category order, then file order). */
export const problems: Problem[] = collected
  .map((p, i) => ({ p, i }))
  .sort((a, b) => order[a.p.category] - order[b.p.category] || a.i - b.i)
  .map(({ p }) => (langPacks[p.id] ? { ...p, langs: langPacks[p.id] } : p));

export const variants: Variant[] = collectedVariants;

export const problemById: Record<string, Problem> = Object.fromEntries(problems.map((p) => [p.id, p]));

export const problemsByCategory = (id: CategoryId) => problems.filter((p) => p.category === id);

export const problemsByPattern = (id: PatternId) => problems.filter((p) => p.pattern === id);

export const TOTAL_PROBLEMS = 150;
