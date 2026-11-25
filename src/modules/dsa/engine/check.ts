// Validation harness for problem files. Runs every tracer on its default input and presets and
// checks metadata, code-line keys, predictions and frame counts.
//
//   /opt/homebrew/bin/node src/modules/dsa/engine/check.ts                 # all problem files
//   /opt/homebrew/bin/node src/modules/dsa/engine/check.ts trees backtracking  # selected files

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Problem, Variant } from './types.ts';
import { parseCode, runTrace } from './tracer.ts';

const PATTERNS = new Set([
  'hashing', 'prefix-sum', 'two-pointers', 'sliding-window', 'stack', 'monotonic-stack', 'binary-search',
  'linked-list', 'fast-slow', 'tree-dfs', 'tree-bfs', 'bst', 'trie', 'heap', 'backtracking', 'graph-traversal',
  'topo-sort', 'union-find', 'weighted-graph', 'dp-1d', 'dp-2d', 'greedy', 'intervals', 'matrix', 'math', 'bits', 'design',
]);

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'problems');
const wanted = process.argv.slice(2);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  .filter((f) => !wanted.length || wanted.includes(f.replace(/\.ts$/, '')));

let errors = 0;
let warnings = 0;
const err = (p: string, m: string) => {
  errors++;
  console.log(`  ✗ ${p}: ${m}`);
};
const warn = (p: string, m: string) => {
  warnings++;
  console.log(`  ! ${p}: ${m}`);
};

const ids = new Set<string>();
const nums = new Set<number>();
let total = 0;
const allVariants: Variant[] = [];

for (const f of files) {
  const mod = (await import(pathToFileURL(join(dir, f)).href)) as { problems?: Problem[]; variants?: Variant[] };
  const list = mod.problems ?? [];
  console.log(`${f}: ${list.length} problems, ${(mod.variants ?? []).length} variants`);
  allVariants.push(...(mod.variants ?? []));
  for (const p of list) {
    total++;
    const id = p.id ?? '(no id)';
    if (ids.has(id)) err(id, 'duplicate id');
    ids.add(id);
    if (nums.has(p.num)) err(id, `duplicate LeetCode number ${p.num}`);
    nums.add(p.num);
    for (const k of ['title', 'statement', 'insight', 'pitfall', 'code'] as const) if (!p[k] || typeof p[k] !== 'string') err(id, `missing ${k}`);
    if (!PATTERNS.has(p.pattern)) err(id, `unknown pattern ${p.pattern}`);
    if (!p.signals || p.signals.length < 2) err(id, 'need ≥2 signals');
    if (!p.hints || p.hints.length < 2) err(id, 'need ≥2 hints');
    if (!p.distractors || p.distractors.length < 2) err(id, 'need ≥2 distractors');
    if (!p.backend?.title || !p.backend?.detail) err(id, 'missing backend use-case');
    if (!p.complexity?.time || !p.complexity?.space) err(id, 'missing complexity');
    const lines = parseCode(p.code ?? '');
    const keys = lines.map((l) => l.key).filter(Boolean) as string[];
    const dupe = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dupe) err(id, `duplicate line key @${dupe}`);
    if (lines.length > 40) warn(id, `code is ${lines.length} lines (keep ≤ 40 for the builder)`);
    for (const k of Object.keys(p.explain ?? {})) if (!keys.includes(k)) err(id, `explain key ${k} not in code`);
    const inputs = [{ label: 'default', input: p.input }, ...(p.presets ?? [])];
    let predictions = 0;
    for (const { label, input } of inputs) {
      try {
        JSON.stringify(input);
      } catch {
        err(id, `${label}: input not JSON-serialisable`);
      }
      const r = runTrace(p, input);
      if (r.error) err(id, `${label}: ${r.error}`);
      if (r.truncated) err(id, `${label}: truncated (>600 frames)`);
      if (r.frames.length < 3) err(id, `${label}: only ${r.frames.length} frames`);
      if (r.result === null && !r.error && !r.truncated) warn(id, `${label}: trace returned nothing`);
      const missing = new Set(r.frames.map((fr) => fr.line).filter((l) => l !== null && !keys.includes(l)));
      if (missing.size) err(id, `${label}: frames reference unknown line keys ${[...missing].join(', ')}`);
      for (const fr of r.frames) {
        if (fr.predict) {
          predictions++;
          if (fr.predict.answer < 0 || fr.predict.answer >= fr.predict.options.length) err(id, `${label}: prediction answer out of range`);
        }
        if (!fr.viz.length) {
          warn(id, `${label}: a frame has no visualization`);
          break;
        }
      }
      const covered = new Set(r.frames.map((fr) => fr.line));
      if (label === 'default') {
        const unused = keys.filter((k) => !covered.has(k));
        if (unused.length > keys.length / 2) warn(id, `default trace only reaches ${keys.length - unused.length}/${keys.length} keyed lines`);
      }
    }
    if (!predictions) err(id, 'no t.predict(...) questions in any trace');
  }
}

for (const v of allVariants) {
  if (!v.id || !v.title || !v.statement || !v.approach || !v.backend) err(v.id ?? '(variant)', 'variant missing fields');
  if (!PATTERNS.has(v.pattern)) err(v.id, `variant has unknown pattern ${v.pattern}`);
  if (!wanted.length && !ids.has(v.nearest)) err(v.id, `variant.nearest ${v.nearest} is not a problem id`);
}

console.log(`\n${total} problems, ${allVariants.length} variants — ${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
