# Authoring problems

Each NeetCode category lives in `problems/<category-id>.ts` and exports:

```ts
export const problems: Problem[] = [...];   // in NeetCode roadmap order
export const variants: Variant[] = [...];   // ≥2 NEW "transfer" problems for the category
```

Types are in `engine/types.ts`; tracer + visualization helpers in `engine/tracer.ts`.
`problems/arrays-hashing.ts` (Two Sum, Top K Frequent) is the reference — copy its shape.

**Always import with explicit `.ts` extensions** (`'../engine/tracer.ts'`) — the validation
harness runs the files directly with Node's type stripping. For the same reason: no `enum`,
no constructor parameter properties, no `namespace`, no JSX in problem files.

## Validate

```sh
/opt/homebrew/bin/node src/modules/dsa/engine/check.ts <file-without-.ts> [...]
```

It must report **0 errors**. It runs every tracer on `input` and each `presets[].input` and checks
metadata, that every frame's `line` key exists in `code`, that at least one `t.predict` exists, etc.

## Field checklist (per problem)

| field | rules |
|---|---|
| `id` | LeetCode slug, e.g. `longest-substring-without-repeating-characters` |
| `statement` | 1–3 sentences **in our own words** (never paste LeetCode text) |
| `signals` | 2–5 phrases/constraints in the statement that should make you think of the pattern |
| `insight` | the "aha" in 1–2 sentences |
| `hints` | 2–3 progressive hints, vague → specific |
| `pitfall` | the most common bug |
| `backend` | a **concrete** backend-engineering scenario where the same pattern solves a real problem (services, logs, queues, caches, DBs, schedulers, rate limiters, routing…). Name the system and explain the mapping (what is the array / window / heap / graph in that system). |
| `code` | Python-flavoured NeetCode-style solution, 4-space indent, ≤ ~25 lines. Mark lines the tracer highlights with a trailing ` @key` (whitespace then `@word`). Every line that executes in a loop should have a key. |
| `explain` | optional `key → why this line exists` (used in worked-example mode and builder feedback). Give it for the non-obvious lines. |
| `distractors` | ≥2 plausible-but-wrong lines (with indentation) + **why** each is wrong (off-by-one, wrong comparison, wrong order, missing while, wrong data structure…). These power the drag-and-drop builder's targeted feedback. |
| `input` | small default input (fits on screen: arrays ≤ ~10, grids ≤ 5×6, trees ≤ ~10 nodes) |
| `presets` | 1–3 edge cases (empty, duplicates, all same, no answer…) |
| `validate` | reject wrong shapes and inputs that would make the animation huge |
| `trace(t, input)` | real algorithm + frames (below). Return the answer. |

## Writing a trace

```ts
trace(t, { nums }) {
  let l = 0, r = nums.length - 1;
  t.draw(() => [                       // called on EVERY step → snapshot of all structures
    V.array('nums', nums, { pointers: { l, r }, window: [l, r] }),
  ]);
  t.step('init', 'Plain-English narration of what just happened and WHY.', { l, r });
  ...
  t.predict('Which pointer moves next?', ['l', 'r'], 0, 'Because sum < target we need a bigger number.');
}
```

- `t.step(lineKey, note, vars)` records one frame. `vars` feed the watch panel (raw values).
  Step at every meaningful line in loops so the learner sees each iteration; aim for 15–150
  frames on the default input (hard limit 600).
- Narration explains *why*, not just *what* ("r moves left because the sum is too big — every pair
  with this r is too big too").
- `t.predict(question, options, answerIndex, why)` attaches a predict-before-reveal question to the
  frame just recorded; it must be answerable from what is on screen and its answer is revealed by the
  NEXT frame. Add **2–4 per default trace** at the decision points that define the pattern (pointer
  moves, window shrink, push/pop, which branch, dp cell value). Compute the answer from real state.
- Draw helpers (`V.*`): `array` (pointers, tones, window), `map`, `set`, `stack`, `queue`, `list`
  (linked list; pass all nodes, arrows follow `.next`), `listFrom`, `tree` (binary, uses `TreeNode`
  from `buildTree`), `trie` (`TrieNode`), `graph` (nodes, edges, tones, positions 0–100), `grid`
  (matrix / DP table, tones keyed `rc(r,c)`, pointers `[r,c]`), `heap` (backing array; use the `Heap`
  class), `intervals`, `bits`, `decision` (recursion tree via `DecisionTree`), `chips` (result lists),
  `text` (strings, tones by char index). Return `null`/`false` in the draw array to hide something.
- Tones: `active` (current), `good` (kept/answer), `bad` (rejected/conflict), `muted` (discarded /
  out of range), `warn`, `info`.
- Design problems (Min Stack, LRU, Trie, Twitter…) take `{ ops: [["push", 3], ["getMin"]] }` style
  input and step through each operation.
- Keep it deterministic and terminating; guard recursion depth.

## Languages (Java / C++)

Learners pick Python, Java or C++. `Problem.code` stays the canonical Python. Each category gets
`problems/lang/<category>.ts` (same file name as the category file) exporting
`langs: Record<problemId, LangPack>`; see `lang/arrays-hashing.ts` for reference entries.

```ts
'two-sum': {
  java: `…`,            // method(s) / class body — NO imports, NO `class Solution` wrapper
  cpp: `…`,             // same; C++ STL, `using namespace std` is assumed
  distractors: [{ java, cpp }, …],   // exactly one per Python distractor, same order and meaning
  gotchas: { python?: [], java?: [], cpp?: [] },  // optional language traps specific to this problem
}
```

Rules (enforced by `engine/check.ts` and `engine/compile-check.ts`):

1. **Same `@key` set** as the Python code — every key exactly once in each language, no extra keys.
   The tracer's frames point at keys, so a key must sit on the line that does the same job. When the
   Python line does two things, put the key on the statement that best matches the narration. Never put a
   key on a `}`-only line.
2. **Same variable names** as the Python code (the watch panel shows the tracer's names). Method name
   keeps LeetCode's camelCase. If Python uses a tuple (`l, r = 0, n - 1`) declare both on one line.
3. **Idiomatic code**: Java `HashMap`/`HashSet`/`ArrayDeque` (not `Stack`)/`PriorityQueue`
   (comparator for max-heap)/`int[]`; C++ `unordered_map`/`unordered_set`/`vector`/`priority_queue`
   (`greater<>` for min-heap)/`deque`/`pair`, `auto& [a, b]` bindings, `(int)x.size()` in comparisons.
   Recursion helpers become private methods (Java) or member functions / lambdas via `function<>` (C++).
   Class-level state (e.g. `res`, `visited`) becomes fields. Design problems are a full class
   (`class LRUCache { … }` — C++ with `public:`).
4. **4-space indentation**, braces on the same line, closing `}` on its own line. Avoid `@Override`.
   Keep it ≤ 48 lines; the builder shows one block per non-`}` line.
5. Must **compile**: snippets are pasted into `class Solution { … }` with `java.util.*`, `java.util.function.*`,
   `java.util.stream.*` (Java) / standard headers + `using namespace std;` (C++) and LeetCode's
   `ListNode`, `TreeNode` and `Node` (val, next, random, left, right, neighbors). Use those types — do
   not redefine them (a design problem's private inner node class must use another name, e.g. `DNode`).
6. Distractors mirror the Python trap in the target language (same mistake, same indentation depth).

Run:

    /opt/homebrew/bin/node src/modules/dsa/engine/check.ts <category>          # keys, distractors, shape
    /opt/homebrew/bin/node src/modules/dsa/engine/compile-check.ts <category>  # javac + clang++
