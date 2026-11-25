import type { Problem, Tone, Variant } from '../engine/types.ts';
import { V, DecisionTree, tones, rc, fmt } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const allTone = (n: number, tone: Tone) => tones(Array.from({ length: n }, (_, j) => j), tone);
const lastTone = (n: number, tone: Tone = 'good'): Record<number, Tone> => (n ? { [n - 1]: tone } : {});
const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));

function checkNums(nums: unknown, max: number, name = 'nums'): string | null {
  if (!Array.isArray(nums) || nums.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return `Expected ${name}: number[]`;
  if (nums.length > max) return `Keep ${name} ≤ ${max} elements so the recursion tree stays readable`;
  return null;
}

// ---------------------------------------------------------------------------
// 78. Subsets
// ---------------------------------------------------------------------------

const subsets: Problem<{ nums: number[] }> = {
  id: 'subsets',
  num: 78,
  title: 'Subsets',
  difficulty: 'Medium',
  category: 'backtracking',
  pattern: 'backtracking',
  statement: 'Given an array of distinct integers, return every possible subset (the power set), including the empty set. Order does not matter.',
  signals: ['"all subsets" / "power set"', 'every element is either in or out', 'output size 2ⁿ (small n)'],
  insight:
    'Walk the elements in order and make one yes/no decision per element. Each root-to-leaf path in that binary decision tree is one subset: choose → explore → un-choose, then explore the "skip" branch.',
  hints: ['For each element there are exactly two options. How many subsets is that?', 'Recurse on index i: include nums[i], recurse; exclude it, recurse.', 'Append a COPY of the subset at i == len(nums), and pop after the include branch.'],
  pitfall: 'Appending `subset` itself instead of `subset.copy()` — every entry in res is the same list object, which is empty at the end.',
  backend: {
    title: 'Enumerating feature-flag combinations for test matrices',
    detail:
      'A CI system that must test every combination of N optional feature flags (or every subset of optional query filters an API accepts) generates the power set with exactly this include/exclude recursion — each leaf is one config to run.',
  },
  complexity: { time: 'O(n · 2ⁿ)', space: 'O(n) recursion (plus output)' },
  code: `
def subsets(nums):
    res, subset = [], []                 @init
    def dfs(i):
        if i >= len(nums):               @base
            res.append(subset.copy())    @record
            return
        subset.append(nums[i])           @choose
        dfs(i + 1)                       @include
        subset.pop()                     @unchoose
        dfs(i + 1)                       @exclude
    dfs(0)                               @call
    return res                           @done
`,
  explain: {
    base: 'All elements decided → the current path is one complete subset.',
    record: 'Copy, because subset keeps being mutated by the rest of the search.',
    choose: 'Decision 1: nums[i] is in.',
    unchoose: 'Undo the choice so the "skip" branch starts from the same state.',
    exclude: 'Decision 2: nums[i] is out.',
  },
  distractors: [
    { text: '            res.append(subset)', why: 'Stores a reference to the one shared list; after backtracking every entry is the same (empty) list.' },
    { text: '        dfs(i)', why: 'Recursing with the same i never advances — infinite recursion.' },
    { text: '        for j in range(i, len(nums)): subset.append(nums[j])', why: 'Appending in a loop without popping keeps growing one list instead of branching include/exclude.' },
  ],
  input: { nums: [1, 2, 3] },
  presets: [
    { label: 'two elements', input: { nums: [5, 9] } },
    { label: 'four elements', input: { nums: [1, 2, 3, 4] } },
  ],
  validate: ({ nums }) => checkNums(nums, 4) ?? (new Set(nums).size !== nums.length ? 'Values must be distinct (see Subsets II for duplicates)' : null),
  trace(t, { nums }) {
    const n = nums.length;
    const dt = new DecisionTree();
    const res: number[][] = [];
    const subset: number[] = [];
    let idx = -1;
    t.draw(() => [
      V.array('nums', nums, { pointers: { i: idx }, tones: idx >= 0 && idx < n ? { [idx]: 'active' } : {} }),
      V.decision('decision tree (left = take nums[i], right = skip it)', dt),
      V.chips('subset (current path)', subset, { tones: allTone(subset.length, 'active') }),
      V.chips('res', res, { tones: lastTone(res.length) }),
    ]);
    const root = dt.add(null, 'start');
    dt.current = root;
    t.step('init', 'Empty result and an empty current subset. Every element will get a take / skip decision.', {});
    if (n >= 3) t.predict('How many subsets will res hold at the end?', [String(n), String(2 ** n), String(fact(n))], 1, `Each of the ${n} elements is independently in or out: 2^${n} = ${2 ** n}.`);
    t.step('call', 'Start deciding at index 0.', { i: 0 });
    let askedPop = false;
    let askedSkip = false;
    const dfs = (i: number, node: string) => {
      dt.current = node;
      idx = i;
      if (i >= n) {
        dt.tone(node, 'good');
        dt.label(node, fmt(subset));
        t.step('base', `i = ${i}: every element has been decided — this leaf is a complete subset ${fmt(subset)}.`, { i, subset: [...subset] });
        res.push([...subset]);
        t.step('record', `Record a COPY of ${fmt(subset)} (the list itself keeps changing).`, { 'len(res)': res.length });
        if (!askedPop && subset.length) {
          askedPop = true;
          const after = subset.slice(0, -1);
          t.predict('We return to the caller, which runs subset.pop(). What is subset afterwards?', [fmt(after), fmt(subset), '[]'].filter((x, k, a) => a.indexOf(x) === k), 0, `pop() removes the last choice (${subset[subset.length - 1]}), restoring ${fmt(after)}.`);
        }
        return;
      }
      t.step('base', `dfs(${i}): decide about nums[${i}] = ${nums[i]} — take it or leave it.`, { i, subset: [...subset] });
      subset.push(nums[i]);
      const c1 = dt.add(node, `+${nums[i]}`);
      dt.current = c1;
      t.step('choose', `Choose: put ${nums[i]} in → subset = ${fmt(subset)}.`, { i, subset: [...subset] });
      t.step('include', `Explore every subset that CONTAINS ${nums[i]} (recurse to i = ${i + 1}).`, { i, subset: [...subset] });
      dfs(i + 1, c1);
      dt.current = node;
      idx = i;
      subset.pop();
      t.step('unchoose', `Back in dfs(${i}). Un-choose: pop ${nums[i]} → subset = ${fmt(subset)}, the same state we had before the left branch.`, { i, subset: [...subset] });
      if (!askedSkip && i === 0) {
        askedSkip = true;
        t.predict(`The right branch skips ${nums[0]}. Will any subset found there contain ${nums[0]}?`, ['Yes', 'No'], 1, `${nums[0]} was decided "out" and dfs only looks at later indices, so it can never come back.`);
      }
      const c2 = dt.add(node, `−${nums[i]}`);
      dt.current = c2;
      t.step('exclude', `Now explore every subset WITHOUT ${nums[i]} (recurse to i = ${i + 1}).`, { i, subset: [...subset] });
      dfs(i + 1, c2);
      dt.current = node;
    };
    dfs(0, root);
    dt.current = null;
    idx = -1;
    t.step('done', `All ${res.length} subsets found: one per leaf of the decision tree.`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 39. Combination Sum
// ---------------------------------------------------------------------------

const combinationSum: Problem<{ candidates: number[]; target: number }> = {
  id: 'combination-sum',
  num: 39,
  title: 'Combination Sum',
  difficulty: 'Medium',
  category: 'backtracking',
  pattern: 'backtracking',
  statement: 'Given distinct positive integers and a target, list every multiset of them (each may be used any number of times) whose sum equals the target. Combinations, not orderings.',
  signals: ['"all combinations" that sum to a target', 'unlimited reuse of each number', 'order inside a combination does not matter'],
  insight:
    'Build combinations in non-decreasing index order: a child may pick index j again (reuse) or anything after it, never before — that is what prevents [2,3] and [3,2] both appearing. Sorting lets you break the loop as soon as a candidate overshoots.',
  hints: ['How do you avoid generating the same combination in two different orders?', 'Pass a start index; the child loop begins at the SAME index (reuse allowed).', 'Sort first; if total + candidates[j] > target, nothing later can fit either → break.'],
  pitfall: 'Starting each child loop at 0 — you get every permutation of each combination ([2,2,3], [2,3,2], [3,2,2]).',
  backend: {
    title: 'Composing a payment / resource bundle from fixed denominations',
    detail:
      'A cloud quota planner must list every way to assemble exactly N vCPUs from instance sizes (2, 4, 8, 16 — unlimited count each), or a payments service lists every way to split an amount into allowed voucher denominations. Same recursion: reuse allowed, non-decreasing order, prune once the sum overshoots.',
  },
  complexity: { time: 'O(n^(t/m)) — exponential in target / min candidate', space: 'O(t/m)' },
  code: `
def combinationSum(candidates, target):
    candidates.sort()                                @sort
    res, cur = [], []                                @init
    def dfs(start, total):
        if total == target:                          @hit
            res.append(cur.copy())                   @record
            return
        for j in range(start, len(candidates)):      @loop
            if total + candidates[j] > target:       @prune
                break                                @cut
            cur.append(candidates[j])                @choose
            dfs(j, total + candidates[j])            @explore
            cur.pop()                                @unchoose
    dfs(0, 0)                                        @call
    return res                                       @done
`,
  explain: {
    sort: 'Sorted order makes the overshoot check a valid reason to stop the whole loop.',
    prune: 'Too big already — and every later candidate is even bigger.',
    explore: 'Same j: the number may be used again; never go back to smaller indices.',
    unchoose: 'Undo so the next j starts from the same partial combination.',
  },
  distractors: [
    { text: '            dfs(j + 1, total + candidates[j])', why: 'j + 1 forbids reusing the same number — that is Combination Sum II\'s rule, not this one.' },
    { text: '        for j in range(0, len(candidates)):', why: 'Restarting at 0 lets smaller numbers come after larger ones, producing duplicate orderings.' },
    { text: '                continue', why: 'continue works but wastes time: after sorting, if this candidate overshoots so do all later ones — break.' },
  ],
  input: { candidates: [2, 3, 6, 7], target: 7 },
  presets: [
    { label: 'several answers', input: { candidates: [2, 3, 5], target: 8 } },
    { label: 'no answer', input: { candidates: [4, 6], target: 5 } },
  ],
  validate: ({ candidates, target }) => {
    const e = checkNums(candidates, 6, 'candidates');
    if (e) return e;
    if (candidates.some((x) => x < 1) || new Set(candidates).size !== candidates.length) return 'candidates must be distinct positive integers';
    if (typeof target !== 'number' || target < 1 || target > 12) return 'Keep target between 1 and 12';
    if (target / Math.min(...candidates) > 6) return 'target / smallest candidate must be ≤ 6 (keeps the tree small)';
    return null;
  },
  trace(t, { candidates, target }) {
    const c = candidates;
    const dt = new DecisionTree();
    const res: number[][] = [];
    const cur: number[] = [];
    let jj = -1;
    t.draw(() => [
      V.array('candidates', c, { pointers: { j: jj }, tones: jj >= 0 && jj < c.length ? { [jj]: 'active' } : {} }),
      V.decision('recursion tree (node = +pick, Σ running total)', dt),
      V.chips('cur', cur, { tones: allTone(cur.length, 'active') }),
      V.chips('res', res, { tones: lastTone(res.length) }),
    ]);
    c.sort((a, b) => a - b);
    t.step('sort', `Sort → ${fmt(c)}, so that once a candidate overshoots, every later one does too.`, { target });
    const root = dt.add(null, 'Σ0');
    dt.current = root;
    t.step('init', 'res collects answers; cur is the combination being built.', { target });
    t.step('call', 'dfs(0, 0): may use any candidate, total so far 0.', { start: 0, total: 0 });
    let askedReuse = false;
    let askedCut = false;
    const dfs = (start: number, total: number, node: string) => {
      dt.current = node;
      if (total === target) {
        dt.tone(node, 'good');
        t.step('hit', `total = ${target} — exactly the target!`, { total, cur: [...cur] });
        res.push([...cur]);
        t.step('record', `Record ${fmt(cur)}. Adding anything more would overshoot, so return.`, { res });
        return;
      }
      t.step('hit', `total = ${total} < ${target}: keep adding candidates from index ${start} on.`, { start, total });
      for (let j = start; j < c.length; j++) {
        jj = j;
        dt.current = node;
        t.step('loop', `Try candidates[${j}] = ${c[j]} (total would become ${total + c[j]}).`, { start, j, total });
        if (total + c[j] > target) {
          if (!askedCut) {
            askedCut = true;
            t.predict(`${total} + ${c[j]} = ${total + c[j]} > ${target}. What happens?`, ['recurse anyway and let the child fail', 'break — skip this and every larger candidate', 'continue with the next candidate'], 1, 'The list is sorted, so every later candidate overshoots too — stop the loop.');
          }
          dt.add(node, `+${c[j]} ✗`, 'bad');
          t.step('prune', `${total} + ${c[j]} = ${total + c[j]} overshoots ${target}.`, { j, total });
          t.step('cut', 'break: candidates are sorted, so all later ones overshoot as well — the whole rest of this level is pruned.', { j, total });
          break;
        }
        cur.push(c[j]);
        const ch = dt.add(node, `+${c[j]} Σ${total + c[j]}`);
        dt.current = ch;
        t.step('choose', `Choose ${c[j]} → cur = ${fmt(cur)}, total ${total + c[j]}.`, { j, cur: [...cur], total: total + c[j] });
        t.step('explore', `Recurse with start = ${j}: ${c[j]} may be picked again, but nothing smaller than it.`, { start: j, total: total + c[j] });
        if (!askedReuse) {
          askedReuse = true;
          t.predict('At which index does the child call\'s loop start?', [String(j), String(j + 1), '0'], 0, `start = j = ${j}: reusing ${c[j]} is allowed, going back to smaller indices is not (that would duplicate combinations).`);
        }
        dfs(j, total + c[j], ch);
        dt.current = node;
        jj = j;
        cur.pop();
        t.step('unchoose', `Back at Σ${total}. Un-choose ${c[j]} → cur = ${fmt(cur)}; try the next candidate.`, { j, cur: [...cur], total });
      }
      jj = -1;
    };
    dfs(0, 0, root);
    dt.current = null;
    t.step('done', res.length ? `${res.length} combination(s) found.` : 'No combination reaches the target.', { res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 46. Permutations
// ---------------------------------------------------------------------------

const permutations: Problem<{ nums: number[] }> = {
  id: 'permutations',
  num: 46,
  title: 'Permutations',
  difficulty: 'Medium',
  category: 'backtracking',
  pattern: 'backtracking',
  statement: 'Return every ordering of an array of distinct integers.',
  signals: ['"all orderings / arrangements"', 'every element used exactly once', 'output size n!'],
  insight:
    'Fill positions one at a time; at each level try every number that is not already in the path. A used[] array (or set) marks what is taken, and un-choosing frees it for the sibling branches.',
  hints: ['How many choices for the first slot? The second?', 'You need to know which numbers are already in the path.', 'Loop over all i; skip used ones; mark, recurse, unmark.'],
  pitfall: 'Forgetting to reset used[i] = False on the way back — later branches think the number is still taken and permutations go missing.',
  backend: {
    title: 'Trying every execution order of independent migration steps',
    detail:
      'A schema-migration verifier checks that a set of independent steps commutes by running them in every order against a scratch DB (small n). Each permutation is one path in the recursion tree; used[] tracks which steps are already applied on the current path.',
  },
  complexity: { time: 'O(n · n!)', space: 'O(n)' },
  code: `
def permute(nums):
    res, perm = [], []                               @init
    used = [False] * len(nums)                       @used
    def dfs():
        if len(perm) == len(nums):                   @base
            res.append(perm.copy())                  @record
            return
        for i in range(len(nums)):                   @loop
            if used[i]:                              @skipUsed
                continue
            used[i] = True; perm.append(nums[i])     @choose
            dfs()                                    @explore
            used[i] = False; perm.pop()              @unchoose
    dfs()                                            @call
    return res                                       @done
`,
  explain: {
    used: 'used[i] says whether nums[i] is already on the current path.',
    loop: 'Unlike subsets, every position may hold ANY unused number, so always start at 0.',
    unchoose: 'Free the number so sibling branches can place it in this position.',
  },
  distractors: [
    { text: '        for i in range(start, len(nums)):', why: 'A start index produces combinations (each set once), not permutations — later numbers could never come first.' },
    { text: '            used[i] = True; perm.append(nums[i]); dfs()', why: 'Missing the undo: used[i] stays True and perm keeps growing, so sibling branches break.' },
  ],
  input: { nums: [1, 2, 3] },
  presets: [
    { label: 'two elements', input: { nums: [0, 1] } },
    { label: 'single', input: { nums: [7] } },
  ],
  validate: ({ nums }) => checkNums(nums, 4) ?? (new Set(nums).size !== nums.length ? 'Values must be distinct' : nums.length === 0 ? 'Give at least one number' : null),
  trace(t, { nums }) {
    const n = nums.length;
    const dt = new DecisionTree();
    const res: number[][] = [];
    const perm: number[] = [];
    const used = nums.map(() => false);
    let idx = -1;
    let idxTone: Tone = 'active';
    t.draw(() => {
      const tn: Record<number, Tone> = {};
      used.forEach((u, k) => u && (tn[k] = 'muted'));
      if (idx >= 0) tn[idx] = idxTone;
      return [
        V.array('nums (grey = used on this path)', nums, { pointers: { i: idx }, tones: tn }),
        V.decision('recursion tree (each level fills one position)', dt),
        V.chips('perm', perm, { tones: allTone(perm.length, 'active') }),
        V.chips('res', res, { tones: lastTone(res.length) }),
      ];
    });
    const root = dt.add(null, '[]');
    dt.current = root;
    t.step('init', 'res collects permutations; perm is the arrangement being built.', {});
    t.step('used', 'used[] starts all False: nothing is placed yet.', { used: [...used] });
    if (n >= 3) t.predict('How many permutations will be produced?', [String(n), String(2 ** n), String(fact(n))], 2, `${n} choices for the first slot × ${n - 1} for the second × … = ${n}! = ${fact(n)}.`);
    t.step('call', 'Fill position 0.', {});
    let askedLast = false;
    const dfs = (node: string) => {
      dt.current = node;
      if (perm.length === n) {
        dt.tone(node, 'good');
        dt.label(node, fmt(perm));
        idx = -1;
        t.step('base', `All ${n} positions filled → ${fmt(perm)} is a complete permutation.`, { perm: [...perm] });
        res.push([...perm]);
        t.step('record', `Record a copy of ${fmt(perm)}.`, { 'len(res)': res.length });
        return;
      }
      idx = -1;
      t.step('loop', `Position ${perm.length}: try every number not already in ${fmt(perm)}.`, { perm: [...perm], used: [...used] });
      if (!askedLast && perm.length === n - 1 && n >= 2) {
        askedLast = true;
        const left = nums.filter((_, k) => !used[k])[0];
        t.predict('Which number is the only one that can go in the last position?', nums.map(String), nums.indexOf(left), `Every other number is already used on this path; only ${left} is free.`);
      }
      for (let i = 0; i < n; i++) {
        idx = i;
        dt.current = node;
        if (used[i]) {
          idxTone = 'bad';
          t.step('skipUsed', `${nums[i]} is already in the path — skip it.`, { i, used: [...used] });
          idxTone = 'active';
          continue;
        }
        used[i] = true;
        perm.push(nums[i]);
        const ch = dt.add(node, String(nums[i]));
        dt.current = ch;
        t.step('choose', `Place ${nums[i]} at position ${perm.length - 1} and mark it used → perm = ${fmt(perm)}.`, { i, perm: [...perm], used: [...used] });
        t.step('explore', 'Recurse to fill the next position.', { perm: [...perm] });
        dfs(ch);
        dt.current = node;
        idx = i;
        used[i] = false;
        perm.pop();
        t.step('unchoose', `Back: remove ${nums[i]} and mark it free again → perm = ${fmt(perm)}. Siblings may now use it.`, { i, perm: [...perm], used: [...used] });
      }
      idx = -1;
    };
    dfs(root);
    dt.current = null;
    t.step('done', `${res.length} permutations — one per leaf.`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 90. Subsets II
// ---------------------------------------------------------------------------

const subsetsII: Problem<{ nums: number[] }> = {
  id: 'subsets-ii',
  num: 90,
  title: 'Subsets II',
  difficulty: 'Medium',
  category: 'backtracking',
  pattern: 'backtracking',
  statement: 'The array may contain repeated values. Return all subsets without listing the same subset (as a multiset) twice.',
  signals: ['"all subsets" + "may contain duplicates"', '"no duplicate subsets" in the output', 'sorting is allowed'],
  insight:
    'Sort so equal values sit together. After exploring "take nums[i]", the "skip" branch must skip ALL copies of that value — otherwise skipping the first 2 and taking the second 2 rebuilds subsets you already have.',
  hints: ['Where do duplicate subsets come from in the plain Subsets tree?', 'Sorting groups equal values together.', 'In the exclude branch, advance i past every copy of nums[i] before recursing.'],
  pitfall: 'De-duplicating at the end with a set of tuples works but explores the whole 2ⁿ tree; and forgetting to sort makes the skip-while loop miss non-adjacent duplicates.',
  backend: {
    title: 'Distinct discount bundles from a cart with repeated items',
    detail:
      'A pricing engine evaluates every distinct sub-basket of a cart (e.g. two identical t-shirts + one mug) to find the best promo. Items with the same SKU are interchangeable, so the search must decide "how many of this SKU" — exactly the sort-and-skip-duplicates recursion.',
  },
  complexity: { time: 'O(n · 2ⁿ)', space: 'O(n)' },
  code: `
def subsetsWithDup(nums):
    nums.sort()                                                  @sort
    res, subset = [], []                                         @init
    def dfs(i):
        if i == len(nums):                                       @base
            res.append(subset.copy())                            @record
            return
        subset.append(nums[i])                                   @choose
        dfs(i + 1)                                               @include
        subset.pop()                                             @unchoose
        while i + 1 < len(nums) and nums[i] == nums[i + 1]:      @skipDup
            i += 1                                               @advance
        dfs(i + 1)                                               @exclude
    dfs(0)                                                       @call
    return res                                                   @done
`,
  explain: {
    sort: 'Puts equal values next to each other so they can be skipped as a block.',
    skipDup: 'The skip branch means "none of this value" — jump over every copy.',
    exclude: 'Recurse from the first DIFFERENT value.',
  },
  distractors: [
    { text: '        if nums[i] == nums[i - 1]: return', why: 'Returning blocks valid subsets like [2,2] that need both copies; only the SKIP branch must jump duplicates.' },
    { text: '        while i < len(nums) and nums[i] == nums[i + 1]:', why: 'Off by one: reads nums[i + 1] past the end when i is the last index.' },
  ],
  input: { nums: [1, 2, 2] },
  presets: [
    { label: 'unsorted input', input: { nums: [2, 1, 2] } },
    { label: 'all equal', input: { nums: [3, 3, 3] } },
  ],
  validate: ({ nums }) => checkNums(nums, 5),
  trace(t, { nums }) {
    const n = nums.length;
    const dt = new DecisionTree();
    const res: number[][] = [];
    const subset: number[] = [];
    let idx = -1;
    let skipTo = -1;
    t.draw(() => {
      const tn: Record<number, Tone> = {};
      if (skipTo > idx && idx >= 0) for (let k = idx; k <= skipTo && k < n; k++) tn[k] = 'muted';
      if (idx >= 0 && idx < n) tn[idx] = 'active';
      return [
        V.array('nums (sorted)', nums, { pointers: { i: idx }, tones: tn }),
        V.decision('decision tree (+ take, − skip all copies; red = pruned duplicate)', dt),
        V.chips('subset', subset, { tones: allTone(subset.length, 'active') }),
        V.chips('res', res, { tones: lastTone(res.length) }),
      ];
    });
    nums.sort((a, b) => a - b);
    t.step('sort', `Sort → ${fmt(nums)}: equal values are now neighbours.`, {});
    const counts = new Map<number, number>();
    for (const x of nums) counts.set(x, (counts.get(x) ?? 0) + 1);
    let distinct = 1;
    for (const v of counts.values()) distinct *= v + 1;
    const root = dt.add(null, 'start');
    dt.current = root;
    t.step('init', 'Same include/exclude search as Subsets, plus one rule for duplicates.', {});
    if (n >= 3) {
      const ch = [distinct, 2 ** n].map(String);
      if (ch[0] !== ch[1]) t.predict('How many DISTINCT subsets will res hold?', ch, 0, `For each value you choose how many copies to take (0…count): ${distinct} combinations, fewer than 2^${n} = ${2 ** n}.`);
    }
    t.step('call', 'Start at index 0.', {});
    let askedDup = false;
    const dfs = (i0: number, node: string) => {
      let i = i0;
      dt.current = node;
      idx = i;
      skipTo = -1;
      if (i === n) {
        dt.tone(node, 'good');
        dt.label(node, fmt(subset));
        t.step('base', `All values decided → ${fmt(subset)}.`, { subset: [...subset] });
        res.push([...subset]);
        t.step('record', `Record ${fmt(subset)}.`, { 'len(res)': res.length });
        return;
      }
      t.step('base', `dfs(${i}): decide about nums[${i}] = ${nums[i]}.`, { i, subset: [...subset] });
      subset.push(nums[i]);
      const c1 = dt.add(node, `+${nums[i]}`);
      dt.current = c1;
      t.step('choose', `Take ${nums[i]} → ${fmt(subset)}.`, { i, subset: [...subset] });
      t.step('include', `Explore everything that contains this ${nums[i]}.`, { i });
      dfs(i + 1, c1);
      dt.current = node;
      idx = i;
      skipTo = -1;
      subset.pop();
      t.step('unchoose', `Back in dfs(${i0}): pop ${nums[i]} → ${fmt(subset)}. Next: the branch WITHOUT ${nums[i]}.`, { i, subset: [...subset] });
      const hasDup = i + 1 < n && nums[i] === nums[i + 1];
      if (!askedDup && hasDup) {
        askedDup = true;
        t.predict(`nums[${i + 1}] is another ${nums[i]}. In the skip branch, may we take that second ${nums[i]}?`, ['Yes — it is a different index', 'No — that rebuilds subsets the take-branch already produced'], 1, `Taking "the second ${nums[i]}" gives exactly the same subsets as taking the first one did. Skip means skip every copy.`);
      }
      if (hasDup) {
        const v = nums[i];
        dt.add(node, `−${v} +${v}′ ✗`, 'bad');
        t.step('skipDup', `nums[${i + 1}] = ${v} too. Skipping one ${v} but taking the next would duplicate the left branch — prune it.`, { i, 'nums[i+1]': nums[i + 1] });
        while (i + 1 < n && nums[i] === nums[i + 1]) {
          i++;
          skipTo = i;
          idx = i0;
          t.step('advance', `i → ${i}: jump over this copy of ${v}.`, { i });
        }
      } else {
        t.step('skipDup', `nums[${i + 1}] ${i + 1 < n ? `= ${nums[i + 1]} differs` : 'does not exist'} — nothing to skip.`, { i });
      }
      const c2 = dt.add(node, i > i0 ? `−all ${nums[i]}` : `−${nums[i]}`);
      dt.current = c2;
      t.step('exclude', `Recurse from index ${i + 1}: no ${nums[i]} in any subset down this branch.`, { i: i + 1, subset: [...subset] });
      dfs(i + 1, c2);
      dt.current = node;
    };
    dfs(0, root);
    dt.current = null;
    idx = -1;
    t.step('done', `${res.length} distinct subsets, no duplicates generated.`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 40. Combination Sum II
// ---------------------------------------------------------------------------

const combinationSum2: Problem<{ candidates: number[]; target: number }> = {
  id: 'combination-sum-ii',
  num: 40,
  title: 'Combination Sum II',
  difficulty: 'Medium',
  category: 'backtracking',
  pattern: 'backtracking',
  statement: 'Candidates may repeat but each element can be used at most once. List every distinct combination that sums to the target.',
  signals: ['sum to target + "each number used once"', 'input has duplicates but output must not', 'combinations (order irrelevant)'],
  insight:
    'Like Combination Sum but the child starts at j + 1 (no reuse), and within ONE loop level a value equal to the previous one is skipped (j > start) — picking either copy at the same depth leads to identical combinations.',
  hints: ['What changes when a number can be used only once?', 'Why does [1,2,2] appear twice if you do nothing about duplicates?', 'Sort; in the loop skip j > start with candidates[j] == candidates[j − 1].'],
  pitfall: 'Skipping duplicates with j > 0 instead of j > start — that also forbids using the second copy DEEPER in the tree, losing answers like [1,2,2].',
  backend: {
    title: 'Selecting invoices that exactly settle a payment',
    detail:
      'An accounts-receivable service receives a payment of X and must find which open invoices (amounts may repeat, each used once) it settles exactly. The same recursion lists candidate invoice sets; skipping equal amounts at the same depth avoids presenting the same set twice.',
  },
  complexity: { time: 'O(2ⁿ)', space: 'O(n)' },
  code: `
def combinationSum2(candidates, target):
    candidates.sort()                                              @sort
    res, cur = [], []                                              @init
    def dfs(start, total):
        if total == target:                                        @hit
            res.append(cur.copy())                                 @record
            return
        for j in range(start, len(candidates)):                    @loop
            if j > start and candidates[j] == candidates[j - 1]:   @dup
                continue                                           @skip
            if total + candidates[j] > target:                     @prune
                break                                              @cut
            cur.append(candidates[j])                              @choose
            dfs(j + 1, total + candidates[j])                      @explore
            cur.pop()                                              @unchoose
    dfs(0, 0)                                                      @call
    return res                                                     @done
`,
  explain: {
    dup: 'Same value as its left neighbour at this SAME depth → its subtree would repeat the neighbour\'s.',
    explore: 'j + 1: this element is used up.',
    cut: 'Sorted: everything later overshoots too.',
  },
  distractors: [
    { text: '            if j > 0 and candidates[j] == candidates[j - 1]:', why: 'j > 0 also blocks taking the second copy one level deeper, so [1,2,2] style answers disappear.' },
    { text: '            dfs(j, total + candidates[j])', why: 'Passing j allows reusing the same element, which this problem forbids.' },
  ],
  input: { candidates: [2, 5, 2, 1, 2], target: 5 },
  presets: [
    { label: 'classic', input: { candidates: [10, 1, 2, 7, 6, 1, 5], target: 8 } },
    { label: 'all same', input: { candidates: [1, 1, 1, 1], target: 2 } },
  ],
  validate: ({ candidates, target }) => {
    const e = checkNums(candidates, 7, 'candidates');
    if (e) return e;
    if (candidates.some((x) => x < 1)) return 'candidates must be positive';
    if (typeof target !== 'number' || target < 1 || target > 12) return 'Keep target between 1 and 12';
    return null;
  },
  trace(t, { candidates, target }) {
    const c = candidates;
    const dt = new DecisionTree();
    const res: number[][] = [];
    const cur: number[] = [];
    let jj = -1;
    t.draw(() => [
      V.array('candidates', c, { pointers: { j: jj }, tones: jj >= 0 && jj < c.length ? { [jj]: 'active' } : {} }),
      V.decision('recursion tree (grey = duplicate skipped, red = overshoot)', dt),
      V.chips('cur', cur, { tones: allTone(cur.length, 'active') }),
      V.chips('res', res, { tones: lastTone(res.length) }),
    ]);
    c.sort((a, b) => a - b);
    t.step('sort', `Sort → ${fmt(c)}: duplicates become neighbours and overshoot can break the loop.`, { target });
    const root = dt.add(null, 'Σ0');
    dt.current = root;
    t.step('init', 'Each element may be used at most once.', { target });
    t.step('call', 'dfs(0, 0).', { start: 0, total: 0 });
    let askedDup = false;
    let askedNext = false;
    let askedCut = false;
    const dfs = (start: number, total: number, node: string) => {
      dt.current = node;
      if (total === target) {
        dt.tone(node, 'good');
        t.step('hit', `total = ${target} — exact hit.`, { total, cur: [...cur] });
        res.push([...cur]);
        t.step('record', `Record ${fmt(cur)}.`, { res });
        return;
      }
      t.step('hit', `total = ${total}: still need ${target - total}. Loop from index ${start}.`, { start, total });
      for (let j = start; j < c.length; j++) {
        jj = j;
        dt.current = node;
        t.step('loop', `Consider candidates[${j}] = ${c[j]}.`, { start, j, total });
        const isDup = j > start && c[j] === c[j - 1];
        if (isDup && !askedDup) {
          askedDup = true;
          t.predict(`j > start and candidates[${j}] equals candidates[${j - 1}] (${c[j]}). What happens?`, ['take it — it is a different element', 'skip it — at this depth it would repeat the previous branch'], 1, `The branch that picked candidates[${j - 1}] = ${c[j]} here already produced every combination this one could.`);
        }
        if (isDup) {
          dt.add(node, `+${c[j]} dup`, 'muted');
          t.step('dup', `Same value as candidates[${j - 1}] at this depth → its whole subtree would be a repeat.`, { j });
          t.step('skip', 'continue to the next index.', { j });
          continue;
        }
        if (total + c[j] > target) {
          if (!askedCut) {
            askedCut = true;
            t.predict(`${total} + ${c[j]} > ${target}. Continue or break?`, ['continue', 'break'], 1, 'Sorted input: every later value is ≥ this one, so they all overshoot.');
          }
          dt.add(node, `+${c[j]} ✗`, 'bad');
          t.step('prune', `${total} + ${c[j]} = ${total + c[j]} > ${target}.`, { j, total });
          t.step('cut', 'break — every later candidate is at least as big.', { j });
          break;
        }
        t.step('dup', j > start ? `${c[j]} differs from the previous value — not a duplicate at this depth.` : `j == start: the first option at this depth is always allowed.`, { j });
        cur.push(c[j]);
        const ch = dt.add(node, `+${c[j]} Σ${total + c[j]}`);
        dt.current = ch;
        t.step('choose', `Use candidates[${j}] = ${c[j]} → cur = ${fmt(cur)}.`, { j, cur: [...cur], total: total + c[j] });
        t.step('explore', `Recurse with start = ${j + 1}: element ${j} is now used up.`, { start: j + 1, total: total + c[j] });
        if (!askedNext) {
          askedNext = true;
          t.predict('At which index does the child loop start?', [String(j), String(j + 1), '0'], 1, 'j + 1 — each element may be used once.');
        }
        dfs(j + 1, total + c[j], ch);
        dt.current = node;
        jj = j;
        cur.pop();
        t.step('unchoose', `Back at Σ${total}: drop ${c[j]} → ${fmt(cur)}.`, { j, cur: [...cur] });
      }
      jj = -1;
    };
    dfs(0, 0, root);
    dt.current = null;
    t.step('done', `${res.length} distinct combination(s).`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 79. Word Search
// ---------------------------------------------------------------------------

const wordSearch: Problem<{ board: string[][]; word: string }> = {
  id: 'word-search',
  num: 79,
  title: 'Word Search',
  difficulty: 'Medium',
  category: 'backtracking',
  pattern: 'backtracking',
  statement: 'Given a grid of letters and a word, decide whether the word can be traced through horizontally/vertically adjacent cells without using any cell twice.',
  signals: ['grid + "adjacent cells"', '"each cell used at most once" on a path', 'find a path matching a sequence'],
  insight:
    'DFS from every cell, matching one letter per step. Mark the cell as on-the-path before exploring neighbours and UNMARK it when backtracking, so other routes may still use it.',
  hints: ['Where can the word start?', 'From a matching cell, the next letter must be in one of four neighbours.', 'Keep a path set; add before recursing, remove after.'],
  pitfall: 'Never un-marking a visited cell (using a global visited that persists across start cells/branches) — a cell used by a failed branch must be available to the next one.',
  backend: {
    title: 'Tracing a route through a service mesh or rack grid',
    detail:
      'A network tool checks whether a packet trace (sequence of switch labels) is physically possible on a grid of racks where each hop must go to an adjacent switch and no switch is revisited. DFS with a path set, un-marking on backtrack, is how such path-existence checks (and maze/route validators) work.',
  },
  complexity: { time: 'O(R · C · 4^L)', space: 'O(L)' },
  code: `
def exist(board, word):
    ROWS, COLS = len(board), len(board[0])
    path = set()                                                 @init
    def dfs(r, c, i):
        if i == len(word):                                       @done
            return True
        if (r < 0 or c < 0 or r >= ROWS or c >= COLS or
                board[r][c] != word[i] or (r, c) in path):       @reject
            return False                                         @fail
        path.add((r, c))                                         @choose
        res = (dfs(r + 1, c, i + 1) or dfs(r - 1, c, i + 1) or   @explore
               dfs(r, c + 1, i + 1) or dfs(r, c - 1, i + 1))
        path.remove((r, c))                                      @unchoose
        return res                                               @ret
    for r in range(ROWS):                                        @rows
        for c in range(COLS):
            if dfs(r, c, 0):                                     @start
                return True                                      @yes
    return False                                                 @no
`,
  explain: {
    reject: 'Off the board, wrong letter, or already on the current path.',
    choose: 'Claim the cell for this path only.',
    explore: 'Try down, up, right, left; `or` stops at the first success.',
    unchoose: 'Release the cell — a different route may legitimately pass through it.',
  },
  distractors: [
    { text: '        visited.add((r, c))  # never removed', why: 'A permanent visited set blocks cells for later branches and start points; backtracking must un-mark.' },
    { text: '        if i == len(word) - 1:', why: 'Off by one: you would succeed before checking that the last letter matches.' },
    { text: '        res = dfs(r + 1, c + 1, i + 1)', why: 'Diagonal moves are not allowed — only the 4 edge-adjacent neighbours.' },
  ],
  input: {
    board: [
      ['A', 'B', 'C', 'E'],
      ['S', 'F', 'C', 'S'],
      ['A', 'D', 'E', 'E'],
    ],
    word: 'ABCCED',
  },
  presets: [
    {
      label: 'needs a turn back',
      input: { board: [['A', 'B', 'C', 'E'], ['S', 'F', 'C', 'S'], ['A', 'D', 'E', 'E']], word: 'SEE' },
    },
    {
      label: 'would reuse a cell',
      input: { board: [['A', 'B', 'C', 'E'], ['S', 'F', 'C', 'S'], ['A', 'D', 'E', 'E']], word: 'ABCB' },
    },
  ],
  validate: ({ board, word }) => {
    if (!Array.isArray(board) || !board.length || !board.every((r) => Array.isArray(r) && r.length === board[0].length && r.every((x) => typeof x === 'string'))) return 'Expected board: string[][] (rectangular)';
    if (board.length > 4 || board[0].length > 5) return 'Keep the board ≤ 4×5';
    if (typeof word !== 'string' || !word.length || word.length > 8) return 'word must be 1–8 letters';
    return null;
  },
  trace(t, { board, word }) {
    const R = board.length;
    const C = board[0].length;
    const path = new Set<string>();
    const pathList: [number, number][] = [];
    let at: [number, number] | null = null;
    let bad: string | null = null;
    let goodCells: string[] = [];
    let wi = -1;
    const dt = new DecisionTree();
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const k of path) tn[k] = 'info';
      for (const k of goodCells) tn[k] = 'good';
      if (bad) tn[bad] = 'bad';
      else if (at && at[0] >= 0 && at[1] >= 0 && at[0] < R && at[1] < C && !goodCells.length) tn[rc(at[0], at[1])] = 'active';
      const wt: Record<number, Tone> = {};
      for (let k = 0; k < pathList.length; k++) wt[k] = 'good';
      if (wi >= 0 && wi < word.length) wt[wi] = wi < pathList.length ? 'good' : 'active';
      return [
        V.grid('board (blue = on current path)', board, { tones: tn, pointers: { at: at && at[0] >= 0 && at[1] >= 0 && at[0] < R && at[1] < C ? at : null } }),
        V.text('word', word, { tones: wt }),
        V.decision('search tree (in-board attempts)', dt),
        V.chips('path', pathList.map(([r, c]) => `${board[r][c]}@${r},${c}`)),
      ];
    });
    const root = dt.add(null, 'start');
    dt.current = root;
    t.step('init', `Look for "${word}". path holds the cells used by the current partial match.`, { word });
    let askedStart = false;
    let askedRevisit = false;
    let askedUn = false;
    const dfs = (r: number, c: number, i: number, parent: string): boolean => {
      at = [r, c];
      wi = i;
      bad = null;
      if (i === word.length) {
        at = null;
        goodCells = [...path];
        t.step('done', `i == ${word.length}: every letter matched — the word exists!`, { i });
        return true;
      }
      const inb = r >= 0 && c >= 0 && r < R && c < C;
      if (inb && path.has(rc(r, c)) && !askedRevisit) {
        askedRevisit = true;
        t.predict(`The next attempt is (${r},${c}), which is already on the path. Can it be used again?`, ['Yes', 'No'], 1, 'Each cell may appear once per path — (r, c) in path → return False.');
      }
      if (!inb) {
        t.step('fail', `(${r},${c}) is off the board → False.`, { r, c, i });
        return false;
      }
      const ch = board[r][c];
      if (ch !== word[i] || path.has(rc(r, c))) {
        bad = rc(r, c);
        dt.add(parent, `${ch}@${r},${c} ✗`, 'bad');
        t.step('fail', path.has(rc(r, c)) ? `(${r},${c}) is already on the path → False.` : `board[${r}][${c}] = '${ch}' but we need word[${i}] = '${word[i]}' → False.`, { r, c, i });
        bad = null;
        return false;
      }
      const node = dt.add(parent, `${ch}@${r},${c}`);
      dt.current = node;
      t.step('reject', `board[${r}][${c}] = '${ch}' matches word[${i}] and is not on the path ✓`, { r, c, i });
      path.add(rc(r, c));
      pathList.push([r, c]);
      t.step('choose', `Claim (${r},${c}) for this path.`, { r, c, i, path: pathList.length });
      t.step('explore', i + 1 < word.length ? `Look for word[${i + 1}] = '${word[i + 1]}' in the 4 neighbours: down, up, right, left.` : 'That was the last letter — the next call will confirm the match.', { r, c, i });
      const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let res = false;
      for (const [dr, dc] of dirs) {
        if (dfs(r + dr, c + dc, i + 1, node)) {
          res = true;
          break;
        }
        at = [r, c];
        wi = i;
        dt.current = node;
      }
      at = [r, c];
      wi = i;
      if (!res && !askedUn) {
        askedUn = true;
        t.predict(`Every neighbour of (${r},${c}) failed. What happens to this cell now?`, ['it stays blocked in path', 'it is removed from path so other routes can use it'], 1, 'Backtracking un-chooses: the cell is only off-limits for the path that is currently using it.');
      }
      path.delete(rc(r, c));
      pathList.pop();
      if (!res) dt.tone(node, 'bad');
      else dt.tone(node, 'good');
      t.step('unchoose', res ? `Success below — unwind, releasing (${r},${c}).` : `Dead end at (${r},${c}): remove it from the path.`, { r, c, i });
      t.step('ret', `Return ${res ? 'True' : 'False'} to the previous letter.`, { r, c, i });
      dt.current = parent;
      return res;
    };
    for (let r = 0; r < R; r++) {
      t.step('rows', `Row ${r}: try each cell as the first letter.`, { r });
      for (let c = 0; c < C; c++) {
        at = [r, c];
        wi = 0;
        dt.current = root;
        t.step('start', `Start a search at (${r},${c}).`, { r, c });
        if (!askedStart && board[r][c] === word[0]) {
          askedStart = true;
          t.predict(`board[${r}][${c}] = '${board[r][c]}'. Does it pass the first-letter check?`, ['Yes', 'No'], 0, `word[0] = '${word[0]}' — a match, so the DFS goes deeper.`);
        }
        if (dfs(r, c, 0, root)) {
          at = null;
          t.step('yes', `Found "${word}".`, { result: true });
          return true;
        }
      }
    }
    at = null;
    t.step('no', `No start cell leads to "${word}".`, { result: false });
    return false;
  },
};

// ---------------------------------------------------------------------------
// 131. Palindrome Partitioning
// ---------------------------------------------------------------------------

const isPal = (s: string) => s === [...s].reverse().join('');

const palPartition: Problem<{ s: string }> = {
  id: 'palindrome-partitioning',
  num: 131,
  title: 'Palindrome Partitioning',
  difficulty: 'Medium',
  category: 'backtracking',
  pattern: 'backtracking',
  statement: 'Cut a string into pieces so that every piece reads the same forwards and backwards. Return every way to do it.',
  signals: ['"all ways to partition / split" a string', 'each piece must satisfy a check', 'small input length'],
  insight:
    'At position i, the next piece is s[i..j] for some j. Only recurse when that piece is a palindrome — the check prunes whole subtrees. Reaching the end of the string means one valid partition.',
  hints: ['What choice do you make at each step?', 'The next cut ends at some j ≥ i; which j values are allowed?', 'for j in range(i, n): if s[i:j+1] is a palindrome → append, dfs(j+1), pop.'],
  pitfall: 'Recursing into non-palindromic pieces and filtering at the end — exponentially more work; prune at the choice.',
  backend: {
    title: 'Tokenising input into dictionary-valid pieces',
    detail:
      'A search service splits a concatenated query or hashtag ("cheapflightsparis") into dictionary words — every way to cut, pruned when a piece is not a valid token. Same choose-a-prefix / recurse-on-the-rest backtracking (with memoisation when only one answer or a count is needed).',
  },
  complexity: { time: 'O(n · 2ⁿ)', space: 'O(n)' },
  code: `
def partition(s):
    res, part = [], []                         @init
    def dfs(i):
        if i >= len(s):                        @base
            res.append(part.copy())            @record
            return
        for j in range(i, len(s)):             @loop
            if s[i:j + 1] == s[i:j + 1][::-1]: @check
                part.append(s[i:j + 1])        @choose
                dfs(j + 1)                     @explore
                part.pop()                     @unchoose
    dfs(0)                                     @call
    return res                                 @done
`,
  explain: {
    loop: 'Each j is a different length for the next piece.',
    check: 'Prune: only palindromic pieces are allowed to continue.',
    explore: 'The rest of the string starts right after the piece.',
  },
  distractors: [
    { text: '                dfs(i + 1)', why: 'The next piece must start after the END of this piece (j + 1), not one past its start.' },
    { text: '        for j in range(i + 1, len(s)):', why: 'Skips single-character pieces, which are always palindromes and always needed.' },
  ],
  input: { s: 'aab' },
  presets: [
    { label: 'two palindromic halves', input: { s: 'abba' } },
    { label: 'no long palindromes', input: { s: 'abc' } },
  ],
  validate: ({ s }) => (typeof s !== 'string' || !s.length ? 'Expected a non-empty string s' : s.length > 6 ? 'Keep s ≤ 6 characters' : null),
  trace(t, { s }) {
    const n = s.length;
    const dt = new DecisionTree();
    const res: string[][] = [];
    const part: string[] = [];
    let lo = -1;
    let hi = -1;
    let ok: boolean | null = null;
    let at = 0;
    t.draw(() => {
      const tn: Record<number, Tone> = {};
      for (let k = 0; k < at; k++) tn[k] = 'muted';
      for (let k = lo; k <= hi && k >= 0; k++) tn[k] = ok === null ? 'active' : ok ? 'good' : 'bad';
      return [
        V.text('s (grey = already partitioned)', s, { tones: tn }),
        V.decision('recursion tree (node = next piece)', dt),
        V.chips('part', part, { tones: allTone(part.length, 'active') }),
        V.chips('res', res, { tones: lastTone(res.length) }),
      ];
    });
    const root = dt.add(null, `"${s}"`);
    dt.current = root;
    t.step('init', 'Each level of recursion chooses the next piece, starting where the previous one ended.', {});
    t.step('call', 'Start at i = 0.', { i: 0 });
    let asked = 0;
    const dfs = (i: number, node: string) => {
      dt.current = node;
      at = i;
      lo = hi = -1;
      ok = null;
      if (i >= n) {
        dt.tone(node, 'good');
        t.step('base', `i = ${i}: the whole string is cut into palindromes → ${fmt(part)}.`, { part: [...part] });
        res.push([...part]);
        t.step('record', `Record ${fmt(part)}.`, { 'len(res)': res.length });
        return;
      }
      for (let j = i; j < n; j++) {
        const piece = s.slice(i, j + 1);
        at = i;
        lo = i;
        hi = j;
        ok = null;
        dt.current = node;
        t.step('loop', `Try the piece s[${i}..${j}] = "${piece}".`, { i, j, piece });
        const p = isPal(piece);
        if (asked < 2 && piece.length >= 2) {
          asked++;
          t.predict(`Is "${piece}" a palindrome?`, ['Yes', 'No'], p ? 0 : 1, p ? 'It reads the same both ways.' : `Reversed it is "${[...piece].reverse().join('')}".`);
        }
        ok = p;
        if (!p) {
          dt.add(node, `"${piece}" ✗`, 'bad');
          t.step('check', `"${piece}" is not a palindrome — prune: no partition can start with it.`, { piece });
          continue;
        }
        t.step('check', `"${piece}" is a palindrome ✓`, { piece });
        part.push(piece);
        const ch = dt.add(node, `"${piece}"`);
        dt.current = ch;
        t.step('choose', `Take "${piece}" → part = ${fmt(part)}.`, { part: [...part] });
        t.step('explore', j + 1 < n ? `Partition the rest "${s.slice(j + 1)}" (from i = ${j + 1}).` : 'Nothing left — the next call records the partition.', { i: j + 1 });
        dfs(j + 1, ch);
        dt.current = node;
        at = i;
        lo = i;
        hi = j;
        ok = true;
        part.pop();
        t.step('unchoose', `Back at i = ${i}: drop "${piece}" and try a longer piece.`, { part: [...part] });
      }
      lo = hi = -1;
    };
    dfs(0, root);
    dt.current = null;
    at = 0;
    t.step('done', `${res.length} palindrome partition(s).`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 17. Letter Combinations of a Phone Number
// ---------------------------------------------------------------------------

const PHONE: Record<string, string> = { '2': 'abc', '3': 'def', '4': 'ghi', '5': 'jkl', '6': 'mno', '7': 'pqrs', '8': 'tuv', '9': 'wxyz' };

const letterCombos: Problem<{ digits: string }> = {
  id: 'letter-combinations-of-a-phone-number',
  num: 17,
  title: 'Letter Combinations of a Phone Number',
  difficulty: 'Medium',
  category: 'backtracking',
  pattern: 'backtracking',
  statement: 'Given a string of digits 2–9, return every word you could type with them on an old phone keypad (each digit maps to 3–4 letters).',
  signals: ['"all combinations" of choices per position', 'each position has its own small option set', 'output is a Cartesian product'],
  insight:
    'One recursion level per digit; branch once per letter of that digit. Building cur + ch creates a NEW string, so there is nothing to undo — the un-choose is implicit.',
  hints: ['How many choices does the first digit give? The second?', 'Recurse on the digit index, carrying the word built so far.', 'When len(cur) == len(digits), record it.'],
  pitfall: 'Returning [""] for empty input — the expected answer is [] (no digits, no combinations).',
  backend: {
    title: 'Expanding a templated config into concrete variants',
    detail:
      'A deployment tool expands "region × instance-type × AZ" templates into every concrete stack to provision — a Cartesian product where each position has its own option list. Same one-level-per-slot recursion (or itertools.product).',
  },
  complexity: { time: 'O(n · 4ⁿ)', space: 'O(n)' },
  code: `
def letterCombinations(digits):
    res = []                                                @init
    phone = {"2": "abc", "3": "def", "4": "ghi", "5": "jkl",
             "6": "mno", "7": "pqrs", "8": "tuv", "9": "wxyz"}  @map
    def dfs(i, cur):
        if len(cur) == len(digits):                         @base
            res.append(cur)                                 @record
            return
        for ch in phone[digits[i]]:                         @loop
            dfs(i + 1, cur + ch)                            @explore
    if digits:                                              @guard
        dfs(0, "")                                          @call
    return res                                              @done
`,
  explain: {
    loop: 'Branch once per letter on this digit\'s key.',
    explore: 'cur + ch is a new string — the caller\'s cur is untouched, so no pop is needed.',
    guard: 'Empty input must give [], not [""].',
  },
  distractors: [
    { text: '            dfs(i, cur + ch)', why: 'Not advancing i keeps using the same digit forever (and never reaches the base case correctly).' },
    { text: '    dfs(0, "")', why: 'Without the `if digits` guard, empty input returns [""] instead of [].' },
  ],
  input: { digits: '23' },
  presets: [
    { label: 'one digit', input: { digits: '7' } },
    { label: 'empty', input: { digits: '' } },
  ],
  validate: ({ digits }) => (typeof digits !== 'string' || !/^[2-9]*$/.test(digits) ? 'digits must only contain 2–9' : digits.length > 2 ? 'Keep digits ≤ 2 (the tree grows ×4 per digit)' : null),
  trace(t, { digits }) {
    const dt = new DecisionTree();
    const res: string[] = [];
    let cur = '';
    let di = -1;
    t.draw(() => [
      V.text('digits', digits || '(empty)', { tones: di >= 0 && di < digits.length ? { [di]: 'active' } : {} }),
      V.map('phone (digit → letters)', [...new Set(digits)].map((d) => [d, PHONE[d]] as const), { hl: di >= 0 && di < digits.length ? [digits[di]] : [] }),
      V.decision('recursion tree (one level per digit)', dt),
      V.chips('cur', cur.split('')),
      V.chips('res', res, { tones: lastTone(res.length) }),
    ]);
    const root = dt.add(null, '""');
    dt.current = root;
    t.step('init', 'res will hold every typed word.', {});
    t.step('map', 'The keypad: each digit offers 3–4 letters.', {});
    const counts = [...digits].map((d) => PHONE[d].length);
    if (digits.length >= 2) {
      const opts = [counts.reduce((a, b) => a + b, 0), counts.reduce((a, b) => a * b, 1), digits.length].map(String);
      if (new Set(opts).size === 3) t.predict('How many combinations will there be?', opts, 1, `Every letter of one digit pairs with every letter of the next: ${counts.join(' × ')} = ${opts[1]}.`);
    }
    t.step('guard', digits ? 'digits is non-empty, so start the recursion.' : 'No digits → no combinations; return [].', { digits });
    if (!digits) {
      t.step('done', 'Result: [].', { res });
      return res;
    }
    t.step('call', 'dfs(0, "").', { i: 0, cur: '' });
    let askedCur = false;
    const dfs = (i: number, c: string, node: string) => {
      dt.current = node;
      cur = c;
      di = i;
      if (c.length === digits.length) {
        dt.tone(node, 'good');
        dt.label(node, c);
        t.step('base', `"${c}" has one letter per digit — complete.`, { cur: c });
        res.push(c);
        t.step('record', `Record "${c}".`, { 'len(res)': res.length });
        if (!askedCur && i >= 1) {
          askedCur = true;
          t.predict(`We return to the caller. What is cur there?`, [`"${c.slice(0, -1)}"`, `"${c}"`, '""'], 0, `The caller passed cur + ch as a NEW string; its own cur is still "${c.slice(0, -1)}" — nothing to pop.`);
        }
        return;
      }
      t.step('loop', `Digit '${digits[i]}' → letters "${PHONE[digits[i]]}". Branch once per letter.`, { i, cur: c });
      for (const ch of PHONE[digits[i]]) {
        const child = dt.add(node, ch);
        dt.current = child;
        cur = c;
        di = i;
        t.step('explore', `cur is "${c}". Append '${ch}' → "${c + ch}" and recurse to digit ${i + 1}.`, { i, cur: c, ch });
        dfs(i + 1, c + ch, child);
        dt.current = node;
      }
      cur = c;
    };
    dfs(0, '', root);
    dt.current = null;
    di = -1;
    cur = '';
    t.step('done', `${res.length} combinations.`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 51. N-Queens
// ---------------------------------------------------------------------------

const nQueens: Problem<{ n: number }> = {
  id: 'n-queens',
  num: 51,
  title: 'N-Queens',
  difficulty: 'Hard',
  category: 'backtracking',
  pattern: 'backtracking',
  statement: 'Place n queens on an n×n chessboard so that no two share a row, column or diagonal. Return every such board.',
  signals: ['place items under mutual-conflict constraints', '"all valid configurations"', 'one item per row (a natural recursion level)'],
  insight:
    'Place one queen per row. Track occupied columns, "/" diagonals (r + c is constant) and "\\" diagonals (r − c is constant) in three sets, so checking a square is O(1). Undo all three on backtrack.',
  hints: ['Two queens can never share a row — so what does each recursion level decide?', 'How can you tell two squares are on the same diagonal?', 'Sets for cols, r + c and r − c; skip a column if any set contains it.'],
  pitfall: 'Mixing up the diagonal keys (using r + c for both) or forgetting to remove from ALL three sets when backtracking.',
  backend: {
    title: 'Constraint-based scheduling (no two jobs may conflict)',
    detail:
      'Placing replicas so no two share a rack, power domain or switch (anti-affinity), or assigning exam slots so no student has two at once, is a constraint-satisfaction search: one decision per level, O(1) conflict sets, undo on backtrack — exactly N-Queens. Kubernetes\' scheduler and timetabling solvers prune the same way.',
  },
  complexity: { time: 'O(n!)', space: 'O(n²) board' },
  code: `
def solveNQueens(n):
    cols, pos, neg = set(), set(), set()                         @init
    res, board = [], [["."] * n for _ in range(n)]               @board
    def dfs(r):
        if r == n:                                               @base
            res.append(["".join(row) for row in board])          @record
            return
        for c in range(n):                                       @loop
            if c in cols or (r + c) in pos or (r - c) in neg:    @attacked
                continue                                         @skip
            cols.add(c); pos.add(r + c); neg.add(r - c)          @place
            board[r][c] = "Q"
            dfs(r + 1)                                           @explore
            cols.remove(c); pos.remove(r + c); neg.remove(r - c) @remove
            board[r][c] = "."
    dfs(0)                                                       @call
    return res                                                   @done
`,
  explain: {
    init: 'Occupied columns, "/" diagonals (r + c) and "\\" diagonals (r − c).',
    attacked: 'O(1) conflict test using the three sets.',
    remove: 'Undo every mark so the next column starts from a clean state.',
  },
  distractors: [
    { text: '            if c in cols or (r + c) in pos or (r + c) in neg:', why: 'Both diagonal sets keyed by r + c — the "\\" diagonal is identified by r − c.' },
    { text: '            cols.remove(c)', why: 'Removing only the column leaves stale diagonal marks that wrongly block later rows.' },
    { text: '        for r in range(n):', why: 'Looping over rows inside the recursion loses the "one queen per row" structure — each level should pick a COLUMN for row r.' },
  ],
  input: { n: 4 },
  presets: [
    { label: 'n = 1', input: { n: 1 } },
    { label: 'n = 5 (bigger tree)', input: { n: 5 } },
  ],
  validate: ({ n }) => (typeof n !== 'number' || !Number.isInteger(n) || n < 1 ? 'n must be a positive integer' : n > 5 ? 'Keep n ≤ 5 (frames grow factorially)' : null),
  trace(t, { n }) {
    const cols = new Set<number>();
    const pos = new Set<number>();
    const neg = new Set<number>();
    const board = Array.from({ length: n }, () => Array.from({ length: n }, () => '.'));
    const res: string[][] = [];
    const dt = new DecisionTree();
    let row = -1;
    let tryAt: [number, number] | null = null;
    let tryBad = false;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) {
          if (board[r][c] === 'Q') tn[rc(r, c)] = 'good';
          else if (r >= row && row >= 0 && (cols.has(c) || pos.has(r + c) || neg.has(r - c))) tn[rc(r, c)] = 'muted';
        }
      if (tryAt) tn[rc(tryAt[0], tryAt[1])] = tryBad ? 'bad' : 'active';
      return [
        V.grid('board (grey = attacked)', board, { tones: tn, pointers: { try: tryAt }, rowLabels: board.map((_, r) => `r${r}`), colLabels: board.map((_, c) => `c${c}`) }),
        V.set('cols', cols),
        V.set('pos (r + c)', pos),
        V.set('neg (r − c)', neg),
        V.decision('recursion tree (one level per row)', dt),
        V.chips('res', res.map((b) => b.join(' | ')), { tones: lastTone(res.length) }),
      ];
    });
    const root = dt.add(null, 'start');
    dt.current = root;
    t.step('init', 'Three sets make "is this square attacked?" an O(1) question.', { n });
    t.step('board', `Empty ${n}×${n} board. Each recursion level places the queen for one row.`, { n });
    t.step('call', 'dfs(0): place a queen in row 0.', { r: 0 });
    let askedSafe = 0;
    const dfs = (r: number, node: string) => {
      dt.current = node;
      row = r;
      tryAt = null;
      if (r === n) {
        dt.tone(node, 'good');
        t.step('base', `r == ${n}: every row has a queen and none attack each other — a solution!`, { r });
        res.push(board.map((x) => x.join('')));
        t.step('record', `Record this board (#${res.length}).`, { 'len(res)': res.length });
        return;
      }
      t.step('loop', `Row ${r}: try each column.`, { r, cols: [...cols], pos: [...pos], neg: [...neg] });
      const safe = Array.from({ length: n }, (_, c) => c).filter((c) => !cols.has(c) && !pos.has(r + c) && !neg.has(r - c));
      if (askedSafe < 2 && r >= 1 && n >= 4) {
        askedSafe++;
        const ch = numChoices(safe.length);
        t.predict(`How many squares in row ${r} are NOT attacked?`, ch.options, ch.answer, safe.length ? `Free columns: ${safe.join(', ')} (grey squares are attacked).` : 'None — every square is attacked, so this branch dead-ends and we backtrack.');
      }
      for (let c = 0; c < n; c++) {
        tryAt = [r, c];
        dt.current = node;
        if (cols.has(c) || pos.has(r + c) || neg.has(r - c)) {
          tryBad = true;
          const why = cols.has(c) ? `column ${c} is taken` : pos.has(r + c) ? `the "/" diagonal r+c = ${r + c} is taken` : `the "\\" diagonal r−c = ${r - c} is taken`;
          t.step('skip', `(${r},${c}) is attacked: ${why} — skip.`, { r, c });
          tryBad = false;
          continue;
        }
        t.step('attacked', `(${r},${c}) is safe: its column and both diagonals are free.`, { r, c });
        cols.add(c);
        pos.add(r + c);
        neg.add(r - c);
        board[r][c] = 'Q';
        const ch = dt.add(node, `r${r}c${c}`);
        dt.current = ch;
        t.step('place', `Place a queen at (${r},${c}); mark column ${c}, r+c = ${r + c}, r−c = ${r - c}.`, { r, c });
        t.step('explore', `Recurse to row ${r + 1}.`, { r: r + 1 });
        dfs(r + 1, ch);
        row = r;
        dt.current = node;
        if (!dt.nodes.some((x) => x.parent === ch) && r + 1 < n) dt.tone(ch, 'bad');
        cols.delete(c);
        pos.delete(r + c);
        neg.delete(r - c);
        board[r][c] = '.';
        tryAt = [r, c];
        t.step('remove', `Back in row ${r}: lift the queen from (${r},${c}) and unmark its column and diagonals; try the next column.`, { r, c });
      }
      tryAt = null;
    };
    dfs(0, root);
    dt.current = null;
    row = -1;
    t.step('done', `${res.length} solution(s) for n = ${n}.`, { 'len(res)': res.length });
    return res;
  },
};

function numChoices(ans: number): { options: string[]; answer: number } {
  const pos = Math.abs(ans) % 3;
  const start = ans - pos;
  return { options: [start, start + 1, start + 2].map(String), answer: pos };
}

// ---------------------------------------------------------------------------

export const problems: Problem[] = [subsets, combinationSum, permutations, subsetsII, combinationSum2, wordSearch, palPartition, letterCombos, nQueens];

export const variants: Variant[] = [
  {
    id: 'combinations-k-of-n',
    title: 'Choose k of n',
    statement: 'Given n and k, return every set of k distinct numbers chosen from 1..n.',
    pattern: 'backtracking',
    nearest: 'subsets',
    signals: ['"all ways to choose k"', 'order does not matter', 'fixed output size'],
    approach: 'dfs(start): if len(cur) == k record; for x in range(start, n+1): append x, dfs(x+1), pop. Prune when remaining numbers < slots left.',
    backend: 'Picking every k-node quorum out of n replicas to test failure scenarios (chaos testing of "any k nodes down").',
  },
  {
    id: 'restore-ip-addresses',
    title: 'Restore IPv4 Addresses',
    statement: 'Given a string of digits, insert three dots to produce every valid IPv4 address (four parts, each 0–255, no leading zeros).',
    pattern: 'backtracking',
    nearest: 'palindrome-partitioning',
    signals: ['"insert separators" / "split the string" in all valid ways', 'each piece must pass a validity check', 'fixed number of pieces'],
    approach: 'dfs(i, parts): if 4 parts and i == len → record; for length 1..3: piece = s[i:i+len]; skip if invalid (leading zero or > 255); recurse. Prune when the remaining length cannot fit the remaining parts.',
    backend: 'Parsing log lines where an IP was written without separators, or validating/expanding user-entered address ranges in a firewall rule UI.',
  },
  {
    id: 'partition-k-equal-sum-subsets',
    title: 'Split Work Into k Equal Buckets',
    statement: 'Given task durations and k workers, decide whether the tasks can be split into k groups with exactly equal total duration.',
    pattern: 'backtracking',
    nearest: 'combination-sum-ii',
    signals: ['"divide into k groups with equal sum"', 'each item used exactly once', 'small n, exhaustive search with pruning'],
    approach: 'target = sum / k. Sort descending; place each task into a bucket whose load + task ≤ target, recurse, remove. Prune: skip buckets with the same current load and stop if an empty bucket fails.',
    backend: 'Evenly sharding a fixed set of batch jobs across k identical workers so all finish at the same time (perfect load balancing).',
  },
];
