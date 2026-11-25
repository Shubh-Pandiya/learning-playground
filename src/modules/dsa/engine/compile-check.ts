// Compiles every Java / C++ translation (problems/lang/*.ts) so the code learners read is real,
// type-correct code. Snippets are class bodies; this wraps them in `class Solution { … }` with the
// usual LeetCode helper types (ListNode, TreeNode, Node).
//
//   /opt/homebrew/bin/node src/modules/dsa/engine/compile-check.ts                 # everything
//   /opt/homebrew/bin/node src/modules/dsa/engine/compile-check.ts trees heap      # selected categories
//   ... compile-check.ts --java | --cpp                                             # one language

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { LangPack, Problem } from './types.ts';
import { parseCode } from './tracer.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'problems');
const args = process.argv.slice(2);
const only = args.includes('--java') ? 'java' : args.includes('--cpp') ? 'cpp' : null;
const wanted = args.filter((a) => !a.startsWith('--'));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  .filter((f) => !wanted.length || wanted.includes(f.replace(/\.ts$/, '')));

const packs: Record<string, LangPack> = {};
for (const f of readdirSync(join(dir, 'lang')).filter((f) => f.endsWith('.ts'))) {
  const mod = (await import(pathToFileURL(join(dir, 'lang', f)).href)) as { langs?: Record<string, LangPack> };
  Object.assign(packs, mod.langs ?? {});
}
const items: { id: string; pack: LangPack }[] = [];
let missing = 0;
for (const f of files) {
  const mod = (await import(pathToFileURL(join(dir, f)).href)) as { problems?: Problem[] };
  for (const p of mod.problems ?? []) {
    if (packs[p.id]) items.push({ id: p.id, pack: packs[p.id] });
    else missing++;
  }
}

const strip = (code: string) => parseCode(code).map((l) => l.text).join('\n');
const safe = (id: string) => 'p_' + id.replace(/[^a-zA-Z0-9]/g, '_');
const work = mkdtempSync(join(tmpdir(), 'dsa-compile-'));
const failed = new Map<string, string[]>();
const fail = (id: string, lang: string, msg: string) => {
  const k = `${id} [${lang}]`;
  failed.set(k, [...(failed.get(k) ?? []), msg]);
};

// ---------------------------------------------------------------- Java
const JAVA_PRELUDE = (pkg: string) => `package ${pkg};
import java.util.*;
import java.util.function.*;
import java.util.stream.*;
class ListNode { int val; ListNode next; ListNode() {} ListNode(int v) { val = v; } ListNode(int v, ListNode n) { val = v; next = n; } }
class TreeNode { int val; TreeNode left, right; TreeNode() {} TreeNode(int v) { val = v; } TreeNode(int v, TreeNode l, TreeNode r) { val = v; left = l; right = r; } }
class Node { int val; Node next, random, left, right; List<Node> neighbors = new ArrayList<>(); Node() {} Node(int v) { val = v; } Node(int v, ArrayList<Node> n) { val = v; neighbors = n; } }
class Solution {
`;
if (only !== 'cpp' && items.length) {
  const srcs: string[] = [];
  const offset = JAVA_PRELUDE('x').split('\n').length - 1;
  for (const { id, pack } of items) {
    const d = join(work, 'java', safe(id));
    mkdirSync(d, { recursive: true });
    const f = join(d, 'Solution.java');
    writeFileSync(f, JAVA_PRELUDE(safe(id)) + strip(pack.java) + '\n}\n');
    srcs.push(f);
  }
  try {
    execFileSync('javac', ['-nowarn', '-Xmaxerrs', '2000', '-proc:none', '-d', join(work, 'out'), ...srcs], { stdio: 'pipe' });
  } catch (e) {
    const out = String((e as { stderr?: Buffer }).stderr ?? e);
    for (const m of out.matchAll(/java\/(p_[\w]+)\/Solution\.java:(\d+): error: (.*)/g)) {
      const item = items.find((x) => safe(x.id) === m[1]);
      const line = +m[2] - offset;
      const text = item ? strip(item.pack.java).split('\n')[line - 1]?.trim() : '';
      fail(item?.id ?? m[1], 'java', `line ${line}: ${m[3]}${text ? `   ⟶ ${text}` : ''}`);
    }
    if (!failed.size) console.log(out.slice(0, 3000));
  }
}

// ---------------------------------------------------------------- C++
const CPP_HEAD = `#include <algorithm>
#include <climits>
#include <cmath>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
#include <array>
#include <list>
#include <bitset>
using namespace std;
`;
const CPP_NS = (ns: string) => `namespace ${ns} {
struct ListNode { int val; ListNode* next; ListNode(int x = 0, ListNode* n = nullptr) : val(x), next(n) {} };
struct TreeNode { int val; TreeNode* left; TreeNode* right; TreeNode(int x = 0, TreeNode* l = nullptr, TreeNode* r = nullptr) : val(x), left(l), right(r) {} };
class Node { public: int val; Node* next; Node* random; Node* left; Node* right; vector<Node*> neighbors; Node(int x = 0) : val(x), next(nullptr), random(nullptr), left(nullptr), right(nullptr) {} Node(int x, vector<Node*> n) : Node(x) { neighbors = n; } };
class Solution {
public:
`;
if (only !== 'java' && items.length) {
  let src = CPP_HEAD;
  const ranges: { id: string; start: number; code: string }[] = [];
  for (const { id, pack } of items) {
    const code = strip(pack.cpp);
    src += CPP_NS(safe(id));
    ranges.push({ id, start: src.split('\n').length, code });
    src += code + '\n};\n}\n';
  }
  const f = join(work, 'all.cpp');
  writeFileSync(f, src);
  try {
    execFileSync('clang++', ['-std=c++17', '-fsyntax-only', '-ferror-limit=0', '-w', f], { stdio: 'pipe' });
  } catch (e) {
    const out = String((e as { stderr?: Buffer }).stderr ?? e);
    for (const m of out.matchAll(/all\.cpp:(\d+):\d+: error: (.*)/g)) {
      const n = +m[1];
      const r = [...ranges].reverse().find((x) => x.start <= n);
      if (!r) {
        fail('(prelude)', 'cpp', m[2]);
        continue;
      }
      const line = n - r.start + 1;
      const text = r.code.split('\n')[line - 1]?.trim();
      fail(r.id, 'cpp', `line ${line}: ${m[2]}${text ? `   ⟶ ${text}` : ''}`);
    }
    if (!failed.size) console.log(out.slice(0, 3000));
  }
}

rmSync(work, { recursive: true, force: true });
for (const [k, msgs] of failed) {
  console.log(`✗ ${k}`);
  for (const m of msgs.slice(0, 6)) console.log(`    ${m}`);
}
console.log(`\ncompiled ${items.length} problems${only ? ` (${only} only)` : ''}; ${missing} without a lang pack; ${failed.size} failing`);
process.exit(failed.size ? 1 : 0);
