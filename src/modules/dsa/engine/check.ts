// Validation harness for problem files. Runs every tracer on its default input and presets and
// checks metadata, code-line keys, predictions and frame counts.
//
//   /opt/homebrew/bin/node src/modules/dsa/engine/check.ts                 # all problem files
//   /opt/homebrew/bin/node src/modules/dsa/engine/check.ts trees backtracking  # selected files

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { LangPack, Pattern, Problem, Variant } from './types.ts';
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

// Java / C++ translations: problems/lang/<category>.ts → `langs: Record<problemId, LangPack>`
const langDir = join(dir, 'lang');
const langPacks: Record<string, LangPack> = {};
for (const f of readdirSync(langDir).filter((f) => f.endsWith('.ts'))) {
  const mod = (await import(pathToFileURL(join(langDir, f)).href)) as { langs?: Record<string, LangPack> };
  for (const [k, v] of Object.entries(mod.langs ?? {})) {
    if (langPacks[k]) err(k, `lang pack defined twice (lang/${f})`);
    langPacks[k] = v;
  }
}

/** Shared checks for a Java/C++ pack. `keys` = Python's @key set (problems) or null (pattern templates). */
function checkPack(id: string, pack: LangPack | undefined, keys: string[] | null, distractors: number) {
  if (!pack) return err(id, 'missing Java/C++ lang pack');
  for (const lang of ['java', 'cpp'] as const) {
    const code = pack[lang];
    if (!code || typeof code !== 'string' || !code.trim()) {
      err(id, `${lang}: missing code`);
      continue;
    }
    if (/\t/.test(code)) err(id, `${lang}: use 4 spaces, not tabs`);
    const lines = parseCode(code);
    const bad = lines.find((l) => l.text.trim() && (l.text.length - l.text.trimStart().length) % 4);
    if (bad) err(id, `${lang}: indentation not a multiple of 4 spaces: "${bad.text.trim()}"`);
    const open = (code.match(/{/g) ?? []).length;
    const close = (code.match(/}/g) ?? []).length;
    if (open !== close) err(id, `${lang}: unbalanced braces (${open} { vs ${close} })`);
    if (/@Override/.test(code)) err(id, `${lang}: do not use @Override (clashes with @key markers)`);
    if (/^\s*(import |#include|using namespace|package )/m.test(code)) err(id, `${lang}: no imports/includes — the snippet is a class body`);
    if (lines.length > 48) warn(id, `${lang}: ${lines.length} lines (keep ≤ 48 for the builder)`);
    const k = lines.map((l) => l.key).filter(Boolean) as string[];
    const dupe = k.find((x, i) => k.indexOf(x) !== i);
    if (dupe) err(id, `${lang}: duplicate line key @${dupe}`);
    if (keys) {
      const missing = keys.filter((x) => !k.includes(x));
      const extra = k.filter((x) => !keys.includes(x));
      if (missing.length) err(id, `${lang}: missing line keys ${missing.map((x) => '@' + x).join(' ')}`);
      if (extra.length) err(id, `${lang}: line keys not in the Python code ${extra.map((x) => '@' + x).join(' ')}`);
      const closing = lines.find((l) => l.key && /^\s*[})\];]+\s*$/.test(l.text));
      if (closing) err(id, `${lang}: @${closing.key} is on a closing-brace-only line — put it on a statement`);
    } else if (lines.some((l) => l.key)) err(id, `${lang}: templates must not use @key markers`);
  }
  if (!Array.isArray(pack.distractors) || pack.distractors.length !== distractors)
    err(id, `lang distractors: need exactly ${distractors} (one per Python distractor, same order), got ${pack.distractors?.length ?? 0}`);
  else pack.distractors.forEach((d, i) => (['java', 'cpp'] as const).forEach((l) => (!d?.[l]?.trim() ? err(id, `distractor ${i}: missing ${l}`) : 0)));
  for (const [l, g] of Object.entries(pack.gotchas ?? {})) {
    if (!['python', 'java', 'cpp'].includes(l)) err(id, `gotchas: unknown language ${l}`);
    if (!Array.isArray(g) || g.some((x) => typeof x !== 'string' || !x.trim())) err(id, `gotchas.${l}: must be non-empty strings`);
  }
}

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
    checkPack(id, langPacks[id], keys, p.distractors?.length ?? 0);
  }
}

for (const v of allVariants) {
  if (!v.id || !v.title || !v.statement || !v.approach || !v.backend) err(v.id ?? '(variant)', 'variant missing fields');
  if (!PATTERNS.has(v.pattern)) err(v.id, `variant has unknown pattern ${v.pattern}`);
  if (!wanted.length && !ids.has(v.nearest)) err(v.id, `variant.nearest ${v.nearest} is not a problem id`);
}

for (const k of Object.keys(langPacks)) if (!wanted.length && !ids.has(k)) err(k, 'lang pack for an unknown problem id');

// Pattern templates (only when checking everything, or when asked for with "patterns")
if (!wanted.length || wanted.includes('patterns')) {
  const { patterns } = (await import(pathToFileURL(join(here, '..', 'data', 'patterns.ts')).href)) as { patterns: Pattern[] };
  let packs = 0;
  for (const pt of patterns) {
    if (pt.langs) packs++;
    checkPack(`pattern:${pt.id}`, pt.langs, null, pt.distractors.length);
    for (const l of ['python', 'java', 'cpp'] as const)
      if (!pt.langs?.gotchas?.[l]?.length) err(`pattern:${pt.id}`, `gotchas.${l}: need ≥1 language-specific gotcha`);
  }
  console.log(`patterns: ${patterns.length} (${packs} with Java/C++)`);
}

console.log(`\n${total} problems, ${allVariants.length} variants — ${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
