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
