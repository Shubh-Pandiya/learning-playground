import type { Problem, Tone, Variant } from '../engine/types.ts';
import { V, TreeNode, buildTree, treeToArray, findNode, fmt } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type T = TreeNode<number>;
type Lvl = (number | null)[];
type TreeIn = { root: Lvl };

/** Mutable view state for recursive tree walks: current node, tones, badges and call-stack frames. */
interface DS {
  cur: T | null;
  tn: Record<string, Tone>;
  badges: Record<string, string>;
  calls: string[];
}
const ds = (): DS => ({ cur: null, tn: {}, badges: {}, calls: [] });
const fv = (n: T | null | undefined) => (n ? String(n.val) : 'None');
const treeV = (name: string, root: T | null, s: DS, caption?: string) =>
  V.tree(name, root, { pointers: { node: s.cur }, tones: s.tn, badges: s.badges, caption });
const callV = (calls: string[]) =>
  V.stack('call stack', calls, {
    tones: calls.length ? { [calls.length - 1]: 'active' } : {},
    caption: 'top = the call running now; it returns its value to the frame below',
  });

function height(n: T | null): number {
  return n ? 1 + Math.max(height(n.left), height(n.right)) : 0;
}
function inorder(n: T | null, out: number[] = []): number[] {
  if (n) {
    inorder(n.left, out);
    out.push(n.val);
    inorder(n.right, out);
  }
  return out;
}
function isBST(n: T | null): boolean {
  const v = inorder(n);
  return v.every((x, i) => i === 0 || v[i - 1] < x);
}
function count(n: T | null): number {
  return n ? 1 + count(n.left) + count(n.right) : 0;
}
function sameSilent(a: T | null, b: T | null): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.val !== b.val) return false;
  return sameSilent(a.left, b.left) && sameSilent(a.right, b.right);
}

function checkLevel(arr: unknown, name = 'root', max = 15, needNode = false): string | null {
  if (!Array.isArray(arr)) return `Expected ${name} as a level-order array, e.g. [3,9,20,null,null,15,7]`;
  if (arr.some((x) => x !== null && (typeof x !== 'number' || !Number.isFinite(x)))) return `${name} may only contain numbers and null`;
  const n = arr.filter((x) => x !== null).length;
  if (needNode && (n === 0 || arr[0] === null)) return `${name} needs at least a root node`;
  if (n > max) return `Keep ${name} ≤ ${max} nodes so the tree fits on screen`;
  if (arr.length > 40) return `Keep the ${name} array ≤ 40 entries`;
  if (height(buildTree<number>(arr as Lvl)) > 6) return `Keep ${name} ≤ 6 levels deep`;
  return null;
}

/** Three numeric options with the answer at a deterministic position. */
function numChoices(ans: number): { options: string[]; answer: number } {
  const pos = Math.abs(ans) % 3;
  const start = ans - pos;
  return { options: [start, start + 1, start + 2].map(String), answer: pos };
}

// ---------------------------------------------------------------------------
// 226. Invert Binary Tree
// ---------------------------------------------------------------------------

const invertTree: Problem<TreeIn> = {
  id: 'invert-binary-tree',
  num: 226,
  title: 'Invert Binary Tree',
  difficulty: 'Easy',
  category: 'trees',
  pattern: 'tree-dfs',
  statement:
    'Turn a binary tree into its mirror image: at every node the left and right children trade places. Return the root of the mirrored tree.',
  signals: ['"mirror" / "flip" the tree', 'the same small operation at every node', 'a node only needs its own two children', 'return the (same) root'],
  insight:
    'Mirroring a tree = swap the root\'s two children, then mirror each child subtree. The same tiny job repeats at every node, so recursion (or any traversal) does all the bookkeeping.',
  hints: [
    'What would you do to a tree with just a root and two leaves?',
    'After swapping the root\'s children, are the subtrees underneath mirrored yet?',
    'Swap, then recurse into both children; an empty node is the base case.',
  ],
  pitfall:
    'Swapping with two separate assignments (root.left = root.right, then root.right = root.left) loses the original left subtree — both sides end up pointing at the same child.',
  backend: {
    title: 'Mirroring split-pane layouts for right-to-left locales',
    detail:
      'A UI-config service stores dashboard layouts as a binary tree of split panes (each split node has a left and right pane). Serving Arabic/Hebrew users means mirroring every split: one recursive swap per node, computed once per layout and cached — exactly this algorithm.',
  },
  complexity: { time: 'O(n)', space: 'O(h) recursion stack' },
  code: `
def invertTree(root):
    if not root:                                      @base
        return None                                   @null
    root.left, root.right = root.right, root.left     @swap
    invertTree(root.left)                             @goLeft
    invertTree(root.right)                            @goRight
    return root                                       @ret
`,
  explain: {
    base: 'Base case: an empty subtree is already its own mirror.',
    swap: 'Tuple assignment swaps both pointers at once — whole subtrees move with them.',
    goLeft: 'Mirror what is NOW on the left (the old right subtree).',
    ret: 'Hand the (same) node back up so the parent keeps its pointer.',
  },
  distractors: [
    { text: '    root.left = root.right', why: 'A one-sided assignment overwrites the left pointer before it was saved — the original left subtree is lost.' },
    { text: '    return invertTree(root.left)', why: 'Returning after the left call never mirrors the right subtree and returns the wrong node.' },
    { text: '    if not root.left and not root.right:', why: 'A leaf check is not a safe base case — a node with one child would still call invertTree(None) and crash on None.left.' },
  ],
  input: { root: [4, 2, 7, 1, 3, 6, 9] },
  presets: [
    { label: 'lopsided', input: { root: [1, 2, null, 3] } },
    { label: 'small', input: { root: [2, 1, 3] } },
  ],
  validate: ({ root }) => checkLevel(root),
  trace(t, { root: arr }) {
    const root = buildTree<number>(arr);
    const s = ds();
    t.draw(() => [treeV('tree', root, s, 'green = subtree fully mirrored'), callV(s.calls)]);
    let asked = 0;
    const inv = (node: T | null): T | null => {
      s.calls.push(`invert(${fv(node)})`);
      if (!node) {
        t.step('null', 'Empty child: nothing to swap — return None straight away.', {});
        s.calls.pop();
        return null;
      }
      s.cur = node;
      s.tn[node.id] = 'active';
      t.step('base', `invert(${node.val}): the node exists, so we handle it first (pre-order), then its children.`, { node: node.val });
      if (!asked && node.left && node.right && node.left.val !== node.right.val) {
        asked = 1;
        t.predict(`After the swap, what is ${node.val}.left?`, [fv(node.left), fv(node.right)], 1, `The tuple assignment puts the old right child (${fv(node.right)}) on the left.`);
      }
      [node.left, node.right] = [node.right, node.left];
      t.step('swap', `Swap the children of ${node.val}: left is now ${fv(node.left)}, right is now ${fv(node.right)}. Entire subtrees move with the pointers.`, { node: node.val });
      if (asked === 1) {
        asked = 2;
        t.predict('invertTree(root.left) runs next. Which ORIGINAL subtree is it about to mirror?', ['the original left subtree', 'the original right subtree'], 1, 'We already swapped, so root.left now points at what used to be the right subtree.');
      }
      s.tn[node.id] = 'info';
      t.step('goLeft', `Recurse into the new left child (${fv(node.left)}). ${node.val} waits on the call stack.`, { node: node.val });
      inv(node.left);
      s.cur = node;
      s.tn[node.id] = 'active';
      t.step('goRight', `Left side of ${node.val} is mirrored. Now recurse into the right child (${fv(node.right)}).`, { node: node.val });
      inv(node.right);
      s.cur = node;
      s.tn[node.id] = 'good';
      t.step('ret', `Both subtrees under ${node.val} are mirrored — return ${node.val} to its caller.`, { node: node.val });
      s.calls.pop();
      return node;
    };
    inv(root);
    return treeToArray(root);
  },
};

// ---------------------------------------------------------------------------
// 104. Maximum Depth of Binary Tree
// ---------------------------------------------------------------------------

const maxDepth: Problem<TreeIn> = {
  id: 'maximum-depth-of-binary-tree',
  num: 104,
  title: 'Maximum Depth of Binary Tree',
  difficulty: 'Easy',
  category: 'trees',
  pattern: 'tree-dfs',
  statement: 'Return how many nodes lie on the longest path from the root down to any leaf of a binary tree (0 for an empty tree).',
  signals: ['"depth" / "height" of a tree', 'answer for a node is built from its children\'s answers', 'longest root-to-leaf path'],
  insight:
    'A node\'s depth is 1 + the deeper of its two subtrees. Each call RETURNS its subtree\'s depth upward, so the answer bubbles up from the leaves (post-order).',
  hints: ['What is the depth of an empty tree? Of a single node?', 'If you knew the depth of both subtrees, how would you combine them?', 'Return 1 + max(left, right); None returns 0.'],
  pitfall: 'Returning 1 for None (instead of 0) counts phantom levels below every leaf, inflating the answer by one.',
  backend: {
    title: 'Rejecting over-nested GraphQL / JSON requests',
    detail:
      'GraphQL depth-limit middleware (and JSON parsers with max-depth guards) compute the maximum nesting depth of the parsed query tree recursively and reject requests deeper than N — a cheap defence against queries that would fan out into millions of resolver calls.',
  },
  complexity: { time: 'O(n)', space: 'O(h) recursion stack' },
  code: `
def maxDepth(root):
    if not root:                          @base
        return 0                          @zero
    left = maxDepth(root.left)            @left
    right = maxDepth(root.right)          @right
    return 1 + max(left, right)           @ret
`,
  explain: {
    zero: 'Empty subtree contributes no levels — this is where recursion bottoms out.',
    left: 'Trust the recursion: this returns the depth of the whole left subtree.',
    ret: 'This node is one more level on top of its deeper child.',
  },
  distractors: [
    { text: '        return 1', why: 'An empty subtree has depth 0; returning 1 adds a fake level under every leaf.' },
    { text: '    return 1 + left + right', why: 'Adding both sides counts nodes on two branches — depth follows only the deeper branch (max).' },
    { text: '    return max(left, right)', why: 'Forgets to count the current node, so every tree gets depth 0.' },
  ],
  input: { root: [3, 9, 20, null, null, 15, 7] },
  presets: [
    { label: 'skewed chain', input: { root: [1, null, 2, null, 3] } },
    { label: 'single node', input: { root: [1] } },
  ],
  validate: ({ root }) => checkLevel(root),
  trace(t, { root: arr }) {
    const root = buildTree<number>(arr);
    const s = ds();
    t.draw(() => [treeV('tree (badge ↑ = depth returned upward)', root, s), callV(s.calls)]);
    let asked = 0;
    const dfs = (node: T | null): number => {
      s.calls.push(`maxDepth(${fv(node)})`);
      if (!node) {
        t.step('zero', 'Empty subtree → depth 0. This is where every branch bottoms out.', { return: 0 });
        s.calls.pop();
        return 0;
      }
      s.cur = node;
      s.tn[node.id] = 'active';
      t.step('base', `maxDepth(${node.val}): the node exists, so its depth depends on its children — ask them first (post-order).`, { node: node.val });
      s.tn[node.id] = 'info';
      t.step('left', `Recurse left into ${fv(node.left)}. This call pauses on the stack until that answer comes back.`, { node: node.val });
      const left = dfs(node.left);
      s.cur = node;
      s.tn[node.id] = 'active';
      t.step('right', `Back in ${node.val}: the left subtree returned ${left}. Now recurse right into ${fv(node.right)}.`, { node: node.val, left });
      const right = dfs(node.right);
      s.cur = node;
      s.tn[node.id] = 'active';
      const res = 1 + Math.max(left, right);
      t.step('right', `Back in ${node.val}: the right subtree returned ${right}. Both answers are in.`, { node: node.val, left, right });
      if (asked < 2 && ((node.left && node.right) || node === root)) {
        asked++;
        const c = numChoices(res);
        t.predict(`What does maxDepth(${node.val}) return?`, c.options, c.answer, `1 (this node) + max(${left}, ${right}) = ${res}.`);
      }
      s.tn[node.id] = 'good';
      s.badges[node.id] = `↑${res}`;
      t.step('ret', `Return 1 + max(${left}, ${right}) = ${res}: this node is one level on top of its deeper child.`, { node: node.val, left, right, return: res });
      s.calls.pop();
      return res;
    };
    return dfs(root);
  },
};

// ---------------------------------------------------------------------------
// 543. Diameter of Binary Tree
// ---------------------------------------------------------------------------

const diameter: Problem<TreeIn> = {
  id: 'diameter-of-binary-tree',
  num: 543,
  title: 'Diameter of Binary Tree',
  difficulty: 'Easy',
  category: 'trees',
  pattern: 'tree-dfs',
  statement: 'Find the number of edges on the longest path between any two nodes of a binary tree. The path does not have to go through the root.',
  signals: ['"longest path between any two nodes"', 'path may not pass through the root', 'path = go up then down (bends once)'],
  insight:
    'Every path has one highest node where it bends; there its length is height(left) + height(right). So each call RETURNS its height upward, and on the side updates a global best with left + right.',
  hints: [
    'Pick the top-most node of the longest path. What do its two halves look like?',
    'The length through a node is the sum of the heights of its two subtrees.',
    'Return height to the parent, but record left + right in a nonlocal best.',
  ],
  pitfall: 'Returning left + right (the diameter) to the parent instead of 1 + max(left, right) (the height) — a parent can only extend ONE branch of a child, not both.',
  backend: {
    title: 'Worst-case hop count in a tree-shaped network',
    detail:
      'In a CDN cache hierarchy or the spanning tree a switch network uses, the worst latency between two edge nodes is the tree\'s diameter. Each router reports its deepest-branch height upward and the controller combines two branches at every hub — the same bottom-up height + global max.',
  },
  complexity: { time: 'O(n)', space: 'O(h)' },
  code: `
def diameterOfBinaryTree(root):
    res = 0                                   @init
    def dfs(node):
        nonlocal res
        if not node:                          @base
            return 0                          @zero
        left = dfs(node.left)                 @left
        right = dfs(node.right)               @right
        res = max(res, left + right)          @update
        return 1 + max(left, right)           @ret
    dfs(root)                                 @call
    return res                                @done
`,
  explain: {
    init: 'Best path length (in edges) seen anywhere in the tree.',
    update: 'Candidate path that bends at this node: down the left side plus down the right side.',
    ret: 'The parent can only continue along ONE of our branches, so report the height.',
  },
  distractors: [
    { text: '        return left + right', why: 'That is the path through this node (two branches); a parent can only extend one branch, so it must receive the height 1 + max(left, right).' },
    { text: '        res = max(res, 1 + left + right)', why: 'That counts nodes, not edges — the diameter is measured in edges.' },
    { text: '    return dfs(root)', why: 'dfs returns the root\'s height, not the best path — the longest path might not even touch the root.' },
  ],
  input: { root: [1, 2, 3, 4, 5] },
  presets: [
    { label: 'best path avoids root', input: { root: [1, 2, null, 3, 4, 5, null, null, 6] } },
    { label: 'two nodes', input: { root: [1, 2] } },
  ],
  validate: ({ root }) => checkLevel(root, 'root', 15, true),
  trace(t, { root: arr }) {
    const root = buildTree<number>(arr);
    const s = ds();
    let res = 0;
    t.draw(() => [treeV('tree (badge = height returned)', root, s, `res (best diameter so far) = ${res}`), callV(s.calls)]);
    t.step('init', 'res tracks the longest path seen anywhere. The path can bend at ANY node, not only the root.', { res });
    t.step('call', 'Start the post-order walk at the root.', { res });
    let asked = 0;
    const dfs = (node: T | null): number => {
      s.calls.push(`dfs(${fv(node)})`);
      if (!node) {
        t.step('zero', 'Empty subtree: height 0.', { return: 0 });
        s.calls.pop();
        return 0;
      }
      s.cur = node;
      s.tn[node.id] = 'active';
      t.step('base', `dfs(${node.val}): we need the heights of both subtrees before we can measure anything here.`, { node: node.val, res });
      s.tn[node.id] = 'info';
      t.step('left', `Get the height of the left subtree (${fv(node.left)}).`, { node: node.val, res });
      const left = dfs(node.left);
      s.cur = node;
      s.tn[node.id] = 'active';
      t.step('right', `Left height = ${left}. Now the right subtree (${fv(node.right)}).`, { node: node.val, left, res });
      const right = dfs(node.right);
      s.cur = node;
      s.tn[node.id] = 'active';
      t.step('right', `Right height = ${right}. A path bending at ${node.val} can go ${left} edges down-left and ${right} down-right.`, { node: node.val, left, right, res });
      if (asked < 2 && ((node.left && node.right) || node === root)) {
        asked++;
        const c = numChoices(left + right);
        t.predict(`How many edges does the longest path that bends at ${node.val} have?`, c.options, c.answer, `left height + right height = ${left} + ${right} = ${left + right}.`);
      }
      const before = res;
      res = Math.max(res, left + right);
      t.step('update', res > before ? `${left} + ${right} = ${left + right} beats ${before} → res = ${res}.` : `${left} + ${right} = ${left + right} does not beat res = ${res}.`, { node: node.val, left, right, res });
      const h = 1 + Math.max(left, right);
      s.tn[node.id] = 'good';
      s.badges[node.id] = `h${h}`;
      t.step('ret', `Return height ${h} (one branch only) — the parent can extend just one side of this node.`, { node: node.val, return: h, res });
      s.calls.pop();
      return h;
    };
    dfs(root);
    s.cur = null;
    t.step('done', `Every node has been the bend point once. Longest path = ${res} edges.`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 110. Balanced Binary Tree
// ---------------------------------------------------------------------------

const balanced: Problem<TreeIn> = {
  id: 'balanced-binary-tree',
  num: 110,
  title: 'Balanced Binary Tree',
  difficulty: 'Easy',
  category: 'trees',
  pattern: 'tree-dfs',
  statement: 'Decide whether, at every node of a binary tree, the heights of the left and right subtrees differ by at most one.',
  signals: ['"height-balanced"', 'a condition that must hold at EVERY node', 'needs subtree heights'],
  insight:
    'Check heights bottom-up: each call returns BOTH "am I balanced?" and "my height". That way every height is computed once — O(n) instead of recomputing heights at every node (O(n²)).',
  hints: [
    'Balanced at the root is not enough — every subtree must be balanced too.',
    'Computing height() separately for every node repeats work. Can one pass return two things?',
    'Return [balanced, height]; a node is balanced if both children are and |hL − hR| ≤ 1.',
  ],
  pitfall: 'Only comparing the root\'s two heights: a tree can be balanced at the root yet have a deeply lopsided subtree.',
  backend: {
    title: 'Detecting skew in a self-balancing index or shard tree',
    detail:
      'Storage engines that keep AVL / B-tree style indexes (and range-sharded key trees) run consistency checks that walk the structure once, returning each subtree\'s height upward and flagging any node whose branches drift more than one level apart — a sign that inserts all land in one shard.',
  },
  complexity: { time: 'O(n)', space: 'O(h)' },
  code: `
def isBalanced(root):
    def dfs(node):                                     # -> [balanced, height]
        if not node:                                   @base
            return [True, 0]                           @zero
        left = dfs(node.left)                          @left
        right = dfs(node.right)                        @right
        balanced = (left[0] and right[0] and           @check
                    abs(left[1] - right[1]) <= 1)
        return [balanced, 1 + max(left[1], right[1])]  @ret
    return dfs(root)[0]                                @done
`,
  explain: {
    zero: 'An empty tree is balanced and has height 0.',
    check: 'Both subtrees balanced AND their heights within one of each other.',
    ret: 'Pass both facts upward so the parent never has to recompute a height.',
  },
  distractors: [
    { text: '        balanced = abs(left[1] - right[1]) <= 1', why: 'Ignores whether the children themselves are balanced — an imbalance deep down would be forgotten.' },
    { text: '        return [balanced, 1 + left[1] + right[1]]', why: 'Height follows the deeper branch (max), not the sum of both — this returns the node count of a path through both sides.' },
    { text: '        balanced = abs(left[1] - right[1]) < 1', why: 'Strictly less than 1 demands equal heights; a difference of exactly one is allowed.' },
  ],
  input: { root: [3, 9, 20, null, null, 15, 7] },
  presets: [
    { label: 'unbalanced deep down', input: { root: [1, 2, 2, 3, 3, null, null, 4, 4] } },
    { label: 'chain of 3', input: { root: [1, null, 2, null, 3] } },
  ],
  validate: ({ root }) => checkLevel(root),
  trace(t, { root: arr }) {
    const root = buildTree<number>(arr);
    const s = ds();
    t.draw(() => [treeV('tree (badge = [height, balanced?] returned)', root, s), callV(s.calls)]);
    let asked = 0;
    const dfs = (node: T | null): [boolean, number] => {
      s.calls.push(`dfs(${fv(node)})`);
      if (!node) {
        t.step('zero', 'Empty subtree → [True, 0]: balanced, height 0.', { return: [true, 0] });
        s.calls.pop();
        return [true, 0];
      }
      s.cur = node;
      s.tn[node.id] = 'active';
      t.step('base', `dfs(${node.val}): we can only judge this node after hearing from both children.`, { node: node.val });
      s.tn[node.id] = 'info';
      t.step('left', `Ask the left subtree (${fv(node.left)}) for [balanced, height].`, { node: node.val });
      const left = dfs(node.left);
      s.cur = node;
      s.tn[node.id] = 'active';
      t.step('right', `Left returned ${fmt(left)}. Now ask the right subtree (${fv(node.right)}).`, { node: node.val, left });
      const right = dfs(node.right);
      s.cur = node;
      s.tn[node.id] = 'active';
      t.step('right', `Right returned ${fmt(right)}. Heights ${left[1]} vs ${right[1]}.`, { node: node.val, left, right });
      const ok = left[0] && right[0] && Math.abs(left[1] - right[1]) <= 1;
      if (asked < 3 && (node.left || node.right) && (!ok || asked < 2)) {
        asked++;
        t.predict(`Is the subtree rooted at ${node.val} balanced?`, ['Yes', 'No'], ok ? 0 : 1, !left[0] || !right[0] ? 'A child already reported False — imbalance below propagates up.' : `|${left[1]} − ${right[1]}| = ${Math.abs(left[1] - right[1])} ${ok ? '≤' : '>'} 1.`);
      }
      t.step('check', ok ? `Both children balanced and |${left[1]} − ${right[1]}| ≤ 1 → balanced here.` : !left[0] || !right[0] ? 'A child is unbalanced, so this subtree is unbalanced too.' : `|${left[1]} − ${right[1]}| = ${Math.abs(left[1] - right[1])} > 1 → NOT balanced.`, { node: node.val, balanced: ok });
      const h = 1 + Math.max(left[1], right[1]);
      s.tn[node.id] = ok ? 'good' : 'bad';
      s.badges[node.id] = `h${h} ${ok ? '✓' : '✗'}`;
      t.step('ret', `Return [${ok ? 'True' : 'False'}, ${h}] — the height comes along so the parent can do its own check in O(1).`, { node: node.val, return: [ok, h] });
      s.calls.pop();
      return [ok, h];
    };
    const [ok] = dfs(root);
    s.cur = null;
    t.step('done', `The root reports ${ok ? 'True' : 'False'}.`, { result: ok });
    return ok;
  },
};

// ---------------------------------------------------------------------------
// 100. Same Tree
// ---------------------------------------------------------------------------

const sameTree: Problem<{ p: Lvl; q: Lvl }> = {
  id: 'same-tree',
  num: 100,
  title: 'Same Tree',
  difficulty: 'Easy',
  category: 'trees',
  pattern: 'tree-dfs',
  statement: 'Given two binary trees, report whether they have exactly the same shape and the same value at every position.',
  signals: ['compare two trees', '"identical" / "same structure and values"', 'walk both trees in lock-step'],
  insight:
    'Walk both trees at the same time. A pair of positions matches if both are empty, or both exist with equal values AND their left pairs match AND their right pairs match.',
  hints: ['What are the possible cases for a pair (p, q) — both empty, one empty, both present?', 'If the roots match, what must also be true?', 'Recurse on (p.left, q.left) and (p.right, q.right); combine with and.'],
  pitfall: 'Comparing in-order (or any single) traversal lists — different shapes can produce the same list. You must compare the structure (including Nones).',
  backend: {
    title: 'Config-drift detection between two environments',
    detail:
      'A deployment tool parses the desired and the live config (e.g. Kubernetes manifests or Terraform state) into trees and walks them in lock-step, stopping at the first differing node. Merkle trees (git, Cassandra anti-entropy) speed this up by hashing subtrees so equal branches are skipped.',
  },
  complexity: { time: 'O(n)', space: 'O(h)' },
  code: `
def isSameTree(p, q):
    if not p and not q:                       @bothNull
        return True                           @true
    if not p or not q or p.val != q.val:      @mismatch
        return False                          @false
    return (isSameTree(p.left, q.left) and    @left
            isSameTree(p.right, q.right))     @right
`,
  explain: {
    bothNull: 'Two empty subtrees are identical.',
    mismatch: 'Exactly one is empty, or the values differ — shapes or values disagree.',
    left: '`and` short-circuits: if the left sides differ, the right side is never checked.',
  },
  distractors: [
    { text: '    if p.val != q.val:', why: 'Without the None checks this crashes when only one tree has a node at this position.' },
    { text: '    return inorder(p) == inorder(q)', why: 'Different shapes can share an in-order sequence (e.g. [1,2] vs [2,null,1] style trees); structure must be compared too.' },
    { text: '    return isSameTree(p.left, q.right) and isSameTree(p.right, q.left)', why: 'That checks whether the trees are MIRRORS of each other, not identical.' },
  ],
  input: { p: [1, 2, 3], q: [1, 2, 3] },
  presets: [
    { label: 'different shape', input: { p: [1, 2], q: [1, null, 2] } },
    { label: 'swapped values', input: { p: [1, 2, 1], q: [1, 1, 2] } },
  ],
  validate: ({ p, q }) => checkLevel(p, 'p', 10) ?? checkLevel(q, 'q', 10),
  trace(t, { p: pa, q: qa }) {
    const p = buildTree<number>(pa);
    const q = buildTree<number>(qa);
    let cp: T | null = null;
    let cq: T | null = null;
    const tp: Record<string, Tone> = {};
    const tq: Record<string, Tone> = {};
    const calls: string[] = [];
    t.draw(() => [
      V.tree('p', p, { pointers: { p: cp }, tones: tp }),
      V.tree('q', q, { pointers: { q: cq }, tones: tq }),
      callV(calls),
    ]);
    let askedMatch = false;
    let askedDiff = false;
    let askedNull = false;
    const same = (a: T | null, b: T | null): boolean => {
      if (!a && !b && !askedNull) {
        askedNull = true;
        t.predict('The next call compares two empty children: same(None, None). What does it return?', ['True', 'False'], 0, 'Two empty subtrees are identical — this is the base case that lets leaves match.');
      }
      calls.push(`same(${fv(a)}, ${fv(b)})`);
      cp = a;
      cq = b;
      if (!a && !b) {
        t.step('true', 'Both positions are empty → identical here; return True.', { p: null, q: null });
        calls.pop();
        return true;
      }
      if (a) tp[a.id] = 'active';
      if (b) tq[b.id] = 'active';
      t.step('bothNull', `Comparing p=${fv(a)} with q=${fv(b)}: not both empty, so look closer.`, { p: a?.val ?? null, q: b?.val ?? null });
      const differ = !a || !b || a.val !== b.val;
      if (!differ && !askedMatch) {
        askedMatch = true;
        t.predict('Does this pair pass the mismatch check?', ['Yes — go on to the children', 'No — return False'], 0, 'Both nodes exist and hold the same value.');
      } else if (differ && !askedDiff) {
        askedDiff = true;
        t.predict('Does this pair pass the mismatch check?', ['Yes — go on to the children', 'No — return False'], 1, !a || !b ? 'One side is None while the other is not — the shapes differ.' : `Values differ: ${a.val} ≠ ${b.val}.`);
      }
      if (!a || !b || a.val !== b.val) {
        if (a) tp[a.id] = 'bad';
        if (b) tq[b.id] = 'bad';
        t.step('false', !a || !b ? 'Only one tree has a node here — shapes differ. Return False.' : `${a.val} ≠ ${b.val} — values differ. Return False.`, { p: a?.val ?? null, q: b?.val ?? null });
        calls.pop();
        return false;
      }
      tp[a.id] = 'good';
      tq[b.id] = 'good';
      t.step('mismatch', `Both exist and both hold ${a.val}. This pair matches; the rest depends on the children.`, { p: a.val, q: b.val });
      t.step('left', `Compare the left subtrees of ${a.val}.`, { p: a.val, q: b.val });
      const l = same(a.left, b.left);
      cp = a;
      cq = b;
      if (!l) {
        t.step('left', `Left subtrees differ → \`and\` short-circuits: return False without looking right.`, { p: a.val, q: b.val });
        calls.pop();
        return false;
      }
      t.step('right', `Left subtrees match. Now the answer is whatever the right subtrees say.`, { p: a.val, q: b.val });
      const r = same(a.right, b.right);
      cp = a;
      cq = b;
      t.step('right', `Right subtrees ${r ? 'match' : 'differ'} → same(${a.val}, ${b.val}) returns ${r ? 'True' : 'False'}.`, { p: a.val, q: b.val, return: r });
      calls.pop();
      return r;
    };
    return same(p, q);
  },
};

// ---------------------------------------------------------------------------
// 572. Subtree of Another Tree
// ---------------------------------------------------------------------------

const subtree: Problem<{ root: Lvl; subRoot: Lvl }> = {
  id: 'subtree-of-another-tree',
  num: 572,
  title: 'Subtree of Another Tree',
  difficulty: 'Easy',
  category: 'trees',
  pattern: 'tree-dfs',
  statement: 'Decide whether some node of tree root has a subtree (that node and ALL its descendants) identical to the tree subRoot.',
  signals: ['"is X contained in Y" for trees', 'needs an exact-match check', 'try every node as a starting point'],
  insight:
    'Two nested recursions: the outer one visits every node of root as a candidate start, the inner one is Same Tree. Reuse the solution you already have.',
  hints: ['Where could a copy of subRoot start inside root?', 'Given a start node, how do you check it is an exact copy?', 'isSubtree(root) = sameTree(root, sub) or isSubtree(root.left) or isSubtree(root.right).'],
  pitfall: 'Matching only the values on the way down without requiring the WHOLE subtree to end where subRoot ends — extra descendants (like a 0 under the 2) make it not a subtree.',
  backend: {
    title: 'Finding a known-bad sub-plan in a query execution plan',
    detail:
      'Query monitoring tools parse EXPLAIN output into an operator tree and search it for anti-pattern subtrees (e.g. Nested Loop over Seq Scan on a big table). Every operator is tried as the root of the pattern and compared structurally — the same nested DFS. Code-clone detectors do this on ASTs.',
  },
  complexity: { time: 'O(m · n)', space: 'O(h)' },
  code: `
def isSubtree(root, subRoot):
    if not root:                                 @emptyRoot
        return False
    if sameTree(root, subRoot):                  @try
        return True                              @found
    return (isSubtree(root.left, subRoot) or     @left
            isSubtree(root.right, subRoot))      @right

def sameTree(p, q):
    if not p and not q:                          @sBoth
        return True
    if not p or not q or p.val != q.val:         @sDiff
        return False
    return (sameTree(p.left, q.left) and         @sRec
            sameTree(p.right, q.right))
`,
  explain: {
    try: 'Treat this node as the top of a possible copy and check it exactly.',
    left: 'No copy starts here — maybe one starts somewhere in the left subtree…',
    sDiff: 'Shape or value mismatch: this start node fails.',
  },
  distractors: [
    { text: '    if root.val == subRoot.val:', why: 'Equal root values are not enough — the entire subtree below must match too.' },
    { text: '    return isSubtree(root.left, subRoot) and isSubtree(root.right, subRoot)', why: 'The copy only needs to exist on ONE side — use or, not and.' },
    { text: '    return sameTree(root.left, subRoot.left) or sameTree(root.right, subRoot.right)', why: 'Compares misaligned positions instead of trying each root node as the start of a full match.' },
  ],
  input: { root: [3, 4, 5, 1, 2], subRoot: [4, 1, 2] },
  presets: [
    { label: 'extra child → false', input: { root: [3, 4, 5, 1, 2, null, null, null, null, 0], subRoot: [4, 1, 2] } },
    { label: 'match is a leaf', input: { root: [1, 2, 3], subRoot: [3] } },
  ],
  validate: ({ root, subRoot }) => checkLevel(root, 'root', 12, true) ?? checkLevel(subRoot, 'subRoot', 6, true),
  trace(t, { root: ra, subRoot: sa }) {
    const root = buildTree<number>(ra);
    const sub = buildTree<number>(sa)!;
    let start: T | null = null;
    let p: T | null = null;
    let q: T | null = null;
    let tr: Record<string, Tone> = {};
    let ts: Record<string, Tone> = {};
    const tried = new Set<string>();
    const calls: string[] = [];
    t.draw(() => [
      V.tree('root', root, { pointers: { start, p }, tones: tr, caption: 'grey = tried as a start and failed' }),
      V.tree('subRoot', sub, { pointers: { q }, tones: ts }),
      callV(calls),
    ]);
    const same = (a: T | null, b: T | null): boolean => {
      p = a;
      q = b;
      if (!a && !b) {
        t.step('sBoth', 'Both empty at this position — it matches.', {});
        return true;
      }
      if (!a || !b || a.val !== b.val) {
        if (a) tr[a.id] = 'bad';
        if (b) ts[b.id] = 'bad';
        t.step('sDiff', !a || !b ? `Mismatch: ${fv(a)} vs ${fv(b)} — one side has a node the other lacks.` : `Mismatch: ${a.val} ≠ ${b.val}.`, { p: a?.val ?? null, q: b?.val ?? null });
        return false;
      }
      tr[a.id] = 'good';
      ts[b.id] = 'good';
      t.step('sRec', `${a.val} = ${b.val}: matches so far — compare their children.`, { p: a.val, q: b.val });
      return same(a.left, b.left) && same(a.right, b.right);
    };
    let asked = 0;
    const isSub = (node: T | null): boolean => {
      calls.push(`isSubtree(${fv(node)})`);
      if (!node) {
        t.step('emptyRoot', 'Ran off the bottom of root: no start node here → False.', {});
        calls.pop();
        return false;
      }
      start = node;
      p = q = null;
      tr = {};
      for (const id of tried) tr[id] = 'muted';
      tr[node.id] = 'active';
      ts = {};
      t.step('try', `Try ${node.val} as the top of a copy of subRoot: run sameTree(${node.val}, ${sub.val}).`, { start: node.val });
      if (asked < 2) {
        asked++;
        const ok = sameSilent(node, sub);
        t.predict(`Will sameTree succeed starting at ${node.val}?`, ['Yes', 'No'], ok ? 0 : 1, ok ? 'Every node and every None lines up with subRoot.' : node.val !== sub.val ? `${node.val} ≠ ${sub.val} — it fails on the very first comparison.` : 'The roots agree but somewhere below the shapes or values differ.');
      }
      if (same(node, sub)) {
        p = q = null;
        t.step('found', `The whole subtree at ${node.val} is an exact copy of subRoot → True.`, { start: node.val });
        calls.pop();
        return true;
      }
      tried.add(node.id);
      p = q = null;
      tr = {};
      for (const id of tried) tr[id] = 'muted';
      ts = {};
      t.step('left', `No copy starts at ${node.val}. Search its left subtree (${fv(node.left)}).`, { start: node.val });
      if (isSub(node.left)) {
        calls.pop();
        return true;
      }
      start = node;
      t.step('right', `Not in the left subtree of ${node.val}; search the right (${fv(node.right)}).`, { start: node.val });
      const r = isSub(node.right);
      calls.pop();
      return r;
    };
    return isSub(root);
  },
};

// ---------------------------------------------------------------------------
// 235. Lowest Common Ancestor of a BST
// ---------------------------------------------------------------------------

const lcaBST: Problem<{ root: Lvl; p: number; q: number }> = {
  id: 'lowest-common-ancestor-of-a-binary-search-tree',
  num: 235,
  title: 'Lowest Common Ancestor of a Binary Search Tree',
  difficulty: 'Medium',
  category: 'trees',
  pattern: 'bst',
  statement: 'In a binary search tree, find the deepest node that has both given nodes p and q in its subtree (a node counts as its own descendant).',
  signals: ['"binary SEARCH tree" (ordering available)', '"lowest common ancestor"', 'two target values'],
  insight:
    'BST ordering tells you which side both nodes live on. While both are smaller go left, while both are larger go right; the first node where they split (or that equals one of them) is the LCA.',
  hints: ['Compare p and q to the root. If both are smaller, where must the LCA be?', 'What does it mean when p and q fall on different sides?', 'Walk down from the root; stop at the first split point.'],
  pitfall: 'Using the generic binary-tree LCA (searching both subtrees) ignores the BST order and does O(n) work instead of O(h).',
  backend: {
    title: 'Finding which split node owns a key range',
    detail:
      'In a range-partitioned store (e.g. a BST of shard split keys, like Bigtable tablet splits), the lowest node whose range contains both keys a and b is the narrowest partition that can answer the range query [a, b] — found by walking down and comparing to split keys, never scanning the whole tree.',
  },
  complexity: { time: 'O(h)', space: 'O(1)' },
  code: `
def lowestCommonAncestor(root, p, q):
    cur = root                                          @init
    while cur:                                          @loop
        if p.val > cur.val and q.val > cur.val:         @right
            cur = cur.right                             @goRight
        elif p.val < cur.val and q.val < cur.val:       @left
            cur = cur.left                              @goLeft
        else:
            return cur                                  @split
`,
  explain: {
    right: 'Both targets are bigger, so both live in the right subtree — and so does their LCA.',
    left: 'Both smaller → both in the left subtree.',
    split: 'They separate here (or one IS cur): no deeper node contains both.',
  },
  distractors: [
    { text: '        if p.val > cur.val or q.val > cur.val:', why: 'With or, a split (one bigger, one smaller) would wrongly go right and lose the other node.' },
    { text: '        if p.val >= cur.val and q.val >= cur.val:', why: 'If p equals cur, cur IS an ancestor of both — moving right skips the answer.' },
  ],
  input: { root: [6, 2, 8, 0, 4, 7, 9, null, null, 3, 5], p: 3, q: 5 },
  presets: [
    { label: 'split at root', input: { root: [6, 2, 8, 0, 4, 7, 9, null, null, 3, 5], p: 2, q: 8 } },
    { label: 'p is ancestor of q', input: { root: [6, 2, 8, 0, 4, 7, 9, null, null, 3, 5], p: 2, q: 4 } },
  ],
  validate: ({ root, p, q }) => {
    const e = checkLevel(root, 'root', 15, true);
    if (e) return e;
    const tr = buildTree<number>(root);
    if (!isBST(tr)) return 'root must be a valid BST with distinct values';
    if (typeof p !== 'number' || typeof q !== 'number' || !findNode(tr, p) || !findNode(tr, q)) return 'p and q must be values present in the tree';
    return null;
  },
  trace(t, { root: arr, p, q }) {
    const root = buildTree<number>(arr)!;
    const pn = findNode(root, p)!;
    const qn = findNode(root, q)!;
    let cur: T | null = root;
    const seen: string[] = [];
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const id of seen) tn[id] = 'muted';
      tn[pn.id] = 'info';
      tn[qn.id] = 'info';
      if (cur) tn[cur.id] = 'active';
      return [V.tree('BST', root, { pointers: { cur, p: pn, q: qn }, tones: tn, caption: `looking for the split point of p=${p} and q=${q}` })];
    });
    t.step('init', `Start at the root. p=${p} and q=${q} are both somewhere below.`, { cur: root.val, p, q });
    let asked = 0;
    while (cur) {
      const c: T = cur;
      const goR = p > c.val && q > c.val;
      const goL = p < c.val && q < c.val;
      t.step('loop', `cur = ${c.val}. Compare both targets to it.`, { cur: c.val, p, q });
      if (asked < 3) {
        asked++;
        t.predict(`p=${p}, q=${q}, cur=${c.val}. What happens next?`, ['go right', 'go left', 'split here → return cur'], goR ? 0 : goL ? 1 : 2, goR ? `Both are > ${c.val}, so both live in the right subtree.` : goL ? `Both are < ${c.val}, so both live in the left subtree.` : `They are on different sides of ${c.val} (or one equals it) — this is the lowest node containing both.`);
      }
      if (goR) {
        t.step('right', `${p} > ${c.val} and ${q} > ${c.val}: both are in the right subtree, so the LCA is too.`, { cur: c.val });
        seen.push(c.id);
        cur = c.right;
        t.step('goRight', `Move right to ${fv(cur)} — the whole left subtree is ruled out.`, { cur: cur?.val ?? null });
        continue;
      }
      t.step('right', `Not both bigger than ${c.val}.`, { cur: c.val });
      if (goL) {
        t.step('left', `${p} < ${c.val} and ${q} < ${c.val}: both are in the left subtree.`, { cur: c.val });
        seen.push(c.id);
        cur = c.left;
        t.step('goLeft', `Move left to ${fv(cur)} — the right subtree is ruled out.`, { cur: cur?.val ?? null });
        continue;
      }
      t.step('left', `Not both smaller than ${c.val} either.`, { cur: c.val });
      t.step('split', `p and q separate at ${c.val} (or one of them is ${c.val}). Any deeper node would contain only one of them → LCA = ${c.val}.`, { result: c.val });
      return c.val;
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// 102. Binary Tree Level Order Traversal
// ---------------------------------------------------------------------------

const levelOrder: Problem<TreeIn> = {
  id: 'binary-tree-level-order-traversal',
  num: 102,
  title: 'Binary Tree Level Order Traversal',
  difficulty: 'Medium',
  category: 'trees',
  pattern: 'tree-bfs',
  statement: 'List the values of a binary tree level by level, from the root downwards and left to right within each level.',
  signals: ['"level by level" / "row by row"', 'group nodes by depth', 'nearest-first order'],
  insight:
    'A queue processes nodes in the order they were discovered. Snapshot len(q) at the start of each round: exactly that many nodes belong to the current level, and their children (appended behind them) form the next level.',
  hints: ['Which data structure gives you "first discovered, first processed"?', 'How do you know where one level ends and the next starts in the queue?', 'Record len(q) before the inner loop and pop exactly that many.'],
  pitfall: 'Using `for _ in range(len(q))` is fine, but iterating `while q` inside the level loop (or re-reading len(q) after pushes) mixes the next level into the current one.',
  backend: {
    title: 'Fan-out by depth in a call tree or org chart',
    detail:
      'An incident-paging service escalates through a management tree one level at a time (BFS: notify all direct reports, then theirs). Distributed-tracing UIs (Jaeger, Zipkin) group spans of a request\'s call tree by depth the same way — each queue batch is one level.',
  },
  complexity: { time: 'O(n)', space: 'O(w) — widest level' },
  code: `
def levelOrder(root):
    res = []                                      @init
    q = deque([root] if root else [])             @seed
    while q:                                      @loop
        level = []                                @level
        for _ in range(len(q)):                   @each
            node = q.popleft()                    @pop
            level.append(node.val)                @take
            if node.left: q.append(node.left)     @pushL
            if node.right: q.append(node.right)   @pushR
        res.append(level)                         @save
    return res                                    @done
`,
  explain: {
    seed: 'The root alone is level 0.',
    each: 'len(q) is evaluated ONCE: it is the size of the current level.',
    pushL: 'Children go to the BACK of the queue, behind the rest of this level.',
    save: 'The inner loop drained exactly one level.',
  },
  distractors: [
    { text: '            node = q.pop()', why: 'pop() takes from the back — that is a stack (DFS order), not a queue; levels get scrambled.' },
    { text: '        while q:', why: 'Draining the whole queue in the inner loop also eats the children just added, so every node lands in one "level".' },
    { text: '    q = [root]', why: 'Seeding with root even when it is None crashes on node.val for an empty tree.' },
  ],
  input: { root: [3, 9, 20, null, null, 15, 7] },
  presets: [
    { label: 'full tree', input: { root: [1, 2, 3, 4, 5, 6, 7] } },
    { label: 'zig-zag shape', input: { root: [1, 2, null, null, 3, 4] } },
  ],
  validate: ({ root }) => checkLevel(root),
  trace(t, { root: arr }) {
    const root = buildTree<number>(arr);
    const res: number[][] = [];
    let level: number[] = [];
    let q: T[] = [];
    let cur: T | null = null;
    const done = new Set<string>();
    const badges: Record<string, string> = {};
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const id of done) tn[id] = 'good';
      for (const n of q) tn[n.id] = 'info';
      if (cur) tn[cur.id] = 'active';
      return [
        V.tree('tree (blue = waiting in queue, green = done)', root, { pointers: { node: cur }, tones: tn, badges }),
        V.queue('q (front → back)', q.map((n) => n.val)),
        V.chips('level', level, { tones: level.length ? { [level.length - 1]: 'active' } : {} }),
        V.chips('res', res),
      ];
    });
    t.step('init', 'res will hold one list per level.', {});
    if (root) {
      q = [root];
      badges[root.id] = 'L0';
    }
    t.step('seed', root ? 'Seed the queue with the root: level 0 is just the root.' : 'Empty tree: nothing to seed.', { 'len(q)': q.length });
    let depth = 0;
    let asked = 0;
    while (q.length) {
      level = [];
      cur = null;
      t.step('loop', `Queue holds ${q.length} node(s) — every one of them is on level ${depth}.`, { depth, 'len(q)': q.length });
      t.step('level', `Start a fresh list for level ${depth}.`, { depth, 'len(q)': q.length });
      if (asked < 2 && depth > 0) {
        asked++;
        const c = numChoices(q.length);
        t.predict(`How many nodes will level ${depth}'s inner loop pop?`, c.options, c.answer, `len(q) is captured before popping: ${q.length}. Children pushed during the loop wait for the next round.`);
      }
      const size = q.length;
      t.step('each', `Snapshot len(q) = ${size}: pop exactly ${size} node(s), no more.`, { size });
      for (let k = 0; k < size; k++) {
        cur = q.shift()!;
        t.step('pop', `Pop ${cur.val} from the front (the oldest node discovered).`, { node: cur.val, 'len(q)': q.length });
        level.push(cur.val);
        t.step('take', `Add ${cur.val} to this level's list.`, { node: cur.val, level: [...level] });
        if (cur.left) {
          q.push(cur.left);
          badges[cur.left.id] = `L${depth + 1}`;
          t.step('pushL', `Queue left child ${cur.left.val} at the BACK — it belongs to level ${depth + 1}.`, { node: cur.val, 'len(q)': q.length });
        }
        if (cur.right) {
          q.push(cur.right);
          badges[cur.right.id] = `L${depth + 1}`;
          t.step('pushR', `Queue right child ${cur.right.val} at the back.`, { node: cur.val, 'len(q)': q.length });
        }
        done.add(cur.id);
      }
      cur = null;
      res.push([...level]);
      t.step('save', `Level ${depth} complete: ${fmt(level)}. What is left in the queue is exactly level ${depth + 1}.`, { res });
      depth++;
    }
    t.step('done', `Queue empty — all ${res.length} level(s) collected.`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 199. Binary Tree Right Side View
// ---------------------------------------------------------------------------

const rightSide: Problem<TreeIn> = {
  id: 'binary-tree-right-side-view',
  num: 199,
  title: 'Binary Tree Right Side View',
  difficulty: 'Medium',
  category: 'trees',
  pattern: 'tree-bfs',
  statement: 'Imagine standing to the right of a binary tree. Return the values you can see from top to bottom — one per level, the rightmost node of each.',
  signals: ['"one value per level"', '"seen from the right / left side"', 'rightmost (or leftmost) node by depth'],
  insight:
    'Do a level-order BFS; the LAST node popped in each level is the one visible from the right. It is not always a right child — a left child is visible when nothing is to its right.',
  hints: ['Which traversal groups nodes by level?', 'Within a level, which node blocks the view of the others?', 'Track the index inside the level loop and keep the node at i == size − 1.'],
  pitfall: 'Following only right pointers from the root: a deeper left-subtree node is visible when the right subtree is shorter.',
  backend: {
    title: 'Latest span per depth in a distributed trace',
    detail:
      'A tracing dashboard summarises a request\'s call tree by showing, for each depth, the last span to start (children are appended in start order). That is a BFS by level that keeps only the last element of each batch — the "right side view" of the span tree.',
  },
  complexity: { time: 'O(n)', space: 'O(w)' },
  code: `
def rightSideView(root):
    res = []                                      @init
    q = deque([root] if root else [])             @seed
    while q:                                      @loop
        size = len(q)                             @size
        for i in range(size):                     @each
            node = q.popleft()                    @pop
            if i == size - 1:                     @last
                res.append(node.val)              @take
            if node.left: q.append(node.left)     @pushL
            if node.right: q.append(node.right)   @pushR
    return res                                    @done
`,
  explain: {
    size: 'Freeze the size of the current level before children are added.',
    last: 'Left-to-right order means the last node of the level is the rightmost one.',
  },
  distractors: [
    { text: '            if i == 0:', why: 'i == 0 is the leftmost node — that is the LEFT side view.' },
    { text: '        node = node.right', why: 'Walking right pointers only misses levels where the visible node lives in the left subtree.' },
  ],
  input: { root: [1, 2, 3, null, 5, null, 4] },
  presets: [
    { label: 'left node visible', input: { root: [1, 2, 3, 4] } },
    { label: 'deep left branch', input: { root: [1, 2, 3, 4, null, null, null, 5] } },
  ],
  validate: ({ root }) => checkLevel(root),
  trace(t, { root: arr }) {
    const root = buildTree<number>(arr);
    const res: number[] = [];
    let q: T[] = [];
    let cur: T | null = null;
    const done = new Set<string>();
    const seen = new Set<string>();
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const id of done) tn[id] = 'muted';
      for (const id of seen) tn[id] = 'good';
      for (const n of q) tn[n.id] = 'info';
      if (cur) tn[cur.id] = 'active';
      return [
        V.tree('tree (green = visible from the right)', root, { pointers: { node: cur }, tones: tn }),
        V.queue('q (front → back)', q.map((n) => n.val)),
        V.chips('res', res, { tones: Object.fromEntries(res.map((_, j) => [j, 'good' as Tone])) }),
      ];
    });
    t.step('init', 'res collects one visible value per level.', {});
    if (root) q = [root];
    t.step('seed', 'The root is level 0.', { 'len(q)': q.length });
    let asked = 0;
    while (q.length) {
      cur = null;
      t.step('loop', `A new level begins: the queue holds exactly its ${q.length} node(s), left to right.`, { 'len(q)': q.length });
      const size = q.length;
      t.step('size', `size = ${size}. The node popped at i = ${size - 1} will be the one seen from the right.`, { size });
      const vals = q.map((n) => String(n.val));
      if (asked < 2 && size >= 2 && new Set(vals).size === vals.length) {
        asked++;
        t.predict('Which node on this level is visible from the right?', vals.slice(0, 4), Math.min(size - 1, 3), `The last node in the queue for this level (${vals[size - 1]}) is the rightmost.`);
      }
      for (let i = 0; i < size; i++) {
        cur = q.shift()!;
        t.step('pop', `Pop ${cur.val} (i = ${i} of ${size}).${i === size - 1 ? '' : ' Something further right on this level hides it.'}`, { i, size, node: cur.val });
        if (i === size - 1) {
          t.step('last', `i == size − 1: ${cur.val} is the rightmost node on this level.`, { i, size });
          res.push(cur.val);
          seen.add(cur.id);
          t.step('take', `Record ${cur.val} as visible.`, { res: [...res] });
        }
        if (cur.left) {
          q.push(cur.left);
          t.step('pushL', `Queue left child ${cur.left.val} for the next level.`, { 'len(q)': q.length });
        }
        if (cur.right) {
          q.push(cur.right);
          t.step('pushR', `Queue right child ${cur.right.val} — added after the left, so it ends up further right.`, { 'len(q)': q.length });
        }
        done.add(cur.id);
      }
    }
    cur = null;
    t.step('done', `All levels processed. Right side view: ${fmt(res)}.`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 1448. Count Good Nodes in Binary Tree
// ---------------------------------------------------------------------------

const goodNodes: Problem<TreeIn> = {
  id: 'count-good-nodes-in-binary-tree',
  num: 1448,
  title: 'Count Good Nodes in Binary Tree',
  difficulty: 'Medium',
  category: 'trees',
  pattern: 'tree-dfs',
  statement: 'A node is "good" if no node on the path from the root down to it has a larger value. Count the good nodes.',
  signals: ['condition depends on the root-to-node PATH', '"no ancestor greater than"', 'carry information downward'],
  insight:
    'Pass the maximum seen so far DOWN as a parameter (top-down state), and return counts UP. A node is good iff node.val ≥ that running max.',
  hints: ['What do you need to know about the ancestors to judge a node?', 'Only one number about the path matters: its maximum.', 'dfs(node, maxSoFar) returns the number of good nodes in that subtree.'],
  pitfall: 'Using a single global max instead of a parameter — when recursion returns from a branch, the max must go back to the parent\'s value (a parameter undoes itself automatically).',
  backend: {
    title: 'Finding where latency is introduced in a trace',
    detail:
      'In a distributed-trace span tree, flag spans whose duration is ≥ every ancestor\'s on the path from the entry request — those are where new slowness first appears. A DFS carries the running max latency down each call chain and counts flagged spans on the way back up.',
  },
  complexity: { time: 'O(n)', space: 'O(h)' },
  code: `
def goodNodes(root):
    def dfs(node, maxVal):
        if not node:                              @base
            return 0                              @zero
        res = 1 if node.val >= maxVal else 0      @check
        maxVal = max(maxVal, node.val)            @max
        res += dfs(node.left, maxVal)             @left
        res += dfs(node.right, maxVal)            @right
        return res                                @ret
    return dfs(root, root.val)                    @call
`,
  explain: {
    check: '≥ (not >): equal to the path max still counts as good.',
    max: 'Update the path max BEFORE passing it to the children.',
    ret: 'Counts flow upward: me + good nodes in both subtrees.',
  },
  distractors: [
    { text: '        res = 1 if node.val > maxVal else 0', why: 'Strictly greater misses nodes equal to the path max (and even the root itself, since maxVal starts at root.val).' },
    { text: '        maxVal = node.val', why: 'Overwriting with the current value loses a larger ancestor — a later smaller child would wrongly look good.' },
  ],
  input: { root: [3, 1, 4, 3, null, 1, 5] },
  presets: [
    { label: 'all equal', input: { root: [2, 2, 2] } },
    { label: 'descending chain', input: { root: [3, 3, null, 4, 2] } },
  ],
  validate: ({ root }) => checkLevel(root, 'root', 15, true),
  trace(t, { root: arr }) {
    const root = buildTree<number>(arr)!;
    const s = ds();
    t.draw(() => [treeV('tree (green = good, grey = not good)', root, s, 'badge: max passed down → ↑count returned up'), callV(s.calls)]);
    t.step('call', `Start at the root with maxVal = ${root.val}: the root is always good (nothing above it).`, { maxVal: root.val });
    let asked = 0;
    const dfs = (node: T | null, maxVal: number): number => {
      s.calls.push(`dfs(${fv(node)}, max=${maxVal})`);
      if (!node) {
        t.step('zero', 'Empty subtree has 0 good nodes.', { return: 0 });
        s.calls.pop();
        return 0;
      }
      s.cur = node;
      s.tn[node.id] = 'active';
      s.badges[node.id] = `max ${maxVal}`;
      t.step('base', `Visit ${node.val}. The largest value on the path above it is ${maxVal}.`, { node: node.val, maxVal });
      const good = node.val >= maxVal;
      if (asked < 3 && node !== root) {
        asked++;
        t.predict(`Is ${node.val} a good node?`, ['Yes', 'No'], good ? 0 : 1, good ? `${node.val} ≥ ${maxVal}: nothing above it is larger.` : `${maxVal} > ${node.val}: an ancestor is larger.`);
      }
      let res = good ? 1 : 0;
      t.step('check', good ? `${node.val} ≥ ${maxVal} → good (res = 1).` : `${node.val} < ${maxVal} → not good (res = 0).`, { node: node.val, maxVal, res });
      s.tn[node.id] = good ? 'good' : 'muted';
      const nm = Math.max(maxVal, node.val);
      t.step('max', nm !== maxVal ? `${node.val} raises the path max to ${nm} for everything below it.` : `Path max stays ${nm} for the children.`, { node: node.val, maxVal: nm });
      t.step('left', `Count good nodes in the left subtree (${fv(node.left)}) with max ${nm}.`, { node: node.val, maxVal: nm, res });
      res += dfs(node.left, nm);
      s.cur = node;
      t.step('right', `Back at ${node.val}, res = ${res}. Now the right subtree (${fv(node.right)}), still with max ${nm} — the left branch's values do not leak over.`, { node: node.val, maxVal: nm, res });
      res += dfs(node.right, nm);
      s.cur = node;
      s.badges[node.id] = `↑${res}`;
      t.step('ret', `Return ${res}: good nodes in the subtree rooted at ${node.val}.`, { node: node.val, return: res });
      s.calls.pop();
      return res;
    };
    return dfs(root, root.val);
  },
};

// ---------------------------------------------------------------------------
// 98. Validate Binary Search Tree
// ---------------------------------------------------------------------------

const validateBST: Problem<TreeIn> = {
  id: 'validate-binary-search-tree',
  num: 98,
  title: 'Validate Binary Search Tree',
  difficulty: 'Medium',
  category: 'trees',
  pattern: 'bst',
  statement: 'Check whether a binary tree is a valid BST: every value in a node\'s left subtree is strictly smaller than it and every value in its right subtree strictly larger, at every node.',
  signals: ['"valid BST"', 'constraint involves ALL ancestors, not just the parent', 'strict ordering'],
  insight:
    'Each node must sit inside an open interval (low, high) inherited from its ancestors. Going left tightens high to the parent\'s value; going right tightens low.',
  hints: ['Is checking node.left.val < node.val < node.right.val enough? Try [5,4,6,null,null,3,7].', 'Which ancestors constrain a node, and how?', 'Pass (low, high) down; go left with (low, node.val), right with (node.val, high).'],
  pitfall: 'Only comparing each node with its direct children — a node deep in the right subtree can still be smaller than the root.',
  backend: {
    title: 'B-tree index consistency checks',
    detail:
      'Database checkers such as PostgreSQL\'s amcheck verify that every key on an index page lies between the fence keys (low, high) inherited from its parent page — exactly this bounds-passing DFS. A violation means a corrupt index that would return wrong query results.',
  },
  complexity: { time: 'O(n)', space: 'O(h)' },
  code: `
def isValidBST(root):
    def valid(node, low, high):
        if not node:                                  @base
            return True                               @true
        if not (low < node.val < high):               @check
            return False                              @false
        return (valid(node.left, low, node.val) and   @left
                valid(node.right, node.val, high))    @right
    return valid(root, float("-inf"), float("inf"))   @call
`,
  explain: {
    check: 'The node must be strictly inside the window its ancestors allow.',
    left: 'Everything on the left must also be below this node → new high = node.val.',
    right: 'Everything on the right must be above this node → new low = node.val.',
  },
  distractors: [
    { text: '        if node.left and node.left.val >= node.val:', why: 'Checks only the parent–child pair; a grandchild can still violate an older ancestor.' },
    { text: '        return (valid(node.left, low, high) and', why: 'Forgets to tighten the bound — the left subtree must be < node.val.' },
    { text: '        if not (low <= node.val <= high):', why: 'BST values are strictly ordered; allowing equality accepts duplicates like [2,2,2].' },
  ],
  input: { root: [5, 4, 6, null, null, 3, 7] },
  presets: [
    { label: 'valid', input: { root: [5, 3, 7, 1, 4, 6, 8] } },
    { label: 'duplicates', input: { root: [2, 2, 2] } },
  ],
  validate: ({ root }) => checkLevel(root),
  trace(t, { root: arr }) {
    const root = buildTree<number>(arr);
    const s = ds();
    t.draw(() => [treeV('tree (badge = allowed (low, high) window)', root, s), callV(s.calls)]);
    t.step('call', 'The root may hold any value: start with the window (−∞, ∞).', {});
    let asked = 0;
    const valid = (node: T | null, low: number, high: number): boolean => {
      s.calls.push(`valid(${fv(node)}, ${fmt(low)}, ${fmt(high)})`);
      if (!node) {
        t.step('true', 'Empty subtree: nothing can break the rule → True.', {});
        s.calls.pop();
        return true;
      }
      s.cur = node;
      s.tn[node.id] = 'active';
      s.badges[node.id] = `(${fmt(low)}, ${fmt(high)})`;
      t.step('base', `Visit ${node.val}. Its ancestors only allow values in (${fmt(low)}, ${fmt(high)}).`, { node: node.val, low, high });
      const ok = low < node.val && node.val < high;
      if (asked < 3 && node !== root && (asked < 2 || !ok)) {
        asked++;
        t.predict(`Is ${node.val} inside (${fmt(low)}, ${fmt(high)})?`, ['Yes', 'No'], ok ? 0 : 1, ok ? `${fmt(low)} < ${node.val} < ${fmt(high)}.` : `${node.val} breaks the window — an ancestor forbids it even though its parent might be fine.`);
      }
      if (!ok) {
        s.tn[node.id] = 'bad';
        t.step('check', `${node.val} is outside (${fmt(low)}, ${fmt(high)}).`, { node: node.val, low, high });
        t.step('false', `Invalid BST: ${node.val} ${node.val <= low ? `must be > ${fmt(low)}` : `must be < ${fmt(high)}`} because of an ancestor. Return False all the way up.`, { node: node.val });
        s.calls.pop();
        return false;
      }
      s.tn[node.id] = 'good';
      t.step('check', `${fmt(low)} < ${node.val} < ${fmt(high)} ✓`, { node: node.val, low, high });
      t.step('left', `Left subtree must stay below ${node.val}: window (${fmt(low)}, ${node.val}).`, { node: node.val, low, high: node.val });
      if (!valid(node.left, low, node.val)) {
        s.cur = node;
        t.step('left', `Left side of ${node.val} failed → \`and\` short-circuits, return False.`, { node: node.val });
        s.calls.pop();
        return false;
      }
      s.cur = node;
      t.step('right', `Right subtree must stay above ${node.val}: window (${node.val}, ${fmt(high)}).`, { node: node.val, low: node.val, high });
      const r = valid(node.right, node.val, high);
      s.cur = node;
      s.calls.pop();
      return r;
    };
    const res = valid(root, -Infinity, Infinity);
    s.cur = null;
    t.step('call', res ? 'Every node sat inside its window → valid BST.' : 'A node escaped its window → not a valid BST.', { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 230. Kth Smallest Element in a BST
// ---------------------------------------------------------------------------

const kthSmallest: Problem<{ root: Lvl; k: number }> = {
  id: 'kth-smallest-element-in-a-bst',
  num: 230,
  title: 'Kth Smallest Element in a BST',
  difficulty: 'Medium',
  category: 'trees',
  pattern: 'bst',
  statement: 'Return the k-th smallest value (1-indexed) stored in a binary search tree.',
  signals: ['BST + "k-th smallest / largest"', 'sorted order wanted', 'stop early once k items seen'],
  insight:
    'In-order traversal of a BST visits values in sorted order. Do it iteratively with an explicit stack so you can stop the moment you pop the k-th node.',
  hints: ['Which traversal of a BST produces sorted output?', 'You do not need the whole sorted list — only the first k.', 'Dive left pushing nodes; pop, count, then move to the right child.'],
  pitfall: 'Forgetting `cur = cur.right` after a pop (or diving right instead of left) — the stack then revisits or skips nodes and the order is no longer sorted.',
  backend: {
    title: 'OFFSET pagination over an ordered index',
    detail:
      '`SELECT … ORDER BY key LIMIT 1 OFFSET k` on a B-tree index walks entries in order with a cursor (an explicit stack of pages) and stops at the k-th — and that is why large OFFSETs are slow: the walk is O(h + k). Keyset pagination avoids it by seeking straight to the last key.',
  },
  complexity: { time: 'O(h + k)', space: 'O(h)' },
  code: `
def kthSmallest(root, k):
    stack, cur, n = [], root, 0           @init
    while cur or stack:                   @loop
        while cur:                        @dive
            stack.append(cur)             @push
            cur = cur.left                @goLeft
        cur = stack.pop()                 @pop
        n += 1                            @count
        if n == k:                        @check
            return cur.val                @found
        cur = cur.right                   @goRight
`,
  explain: {
    dive: 'Smaller values live to the left: go as far left as possible, remembering the path.',
    pop: 'The top of the stack is the smallest value not yet visited.',
    goRight: 'Everything in the right subtree is bigger than cur but smaller than what is below it on the stack.',
  },
  distractors: [
    { text: '            cur = cur.right', why: 'Diving right visits the LARGEST values first — that gives the k-th largest, not smallest.' },
    { text: '        cur = stack.pop(0)', why: 'pop(0) takes from the bottom (the root side) — that is not in-order.' },
  ],
  input: { root: [5, 3, 6, 2, 4, null, null, 1], k: 3 },
  presets: [
    { label: 'k = 1', input: { root: [3, 1, 4, null, 2], k: 1 } },
    { label: 'largest', input: { root: [3, 1, 4, null, 2], k: 4 } },
  ],
  validate: ({ root, k }) => {
    const e = checkLevel(root, 'root', 15, true);
    if (e) return e;
    const tr = buildTree<number>(root);
    if (!isBST(tr)) return 'root must be a valid BST with distinct values';
    if (typeof k !== 'number' || k < 1 || k > count(tr)) return `k must be between 1 and ${count(tr)}`;
    return null;
  },
  trace(t, { root: arr, k }) {
    const root = buildTree<number>(arr);
    const stack: T[] = [];
    let cur: T | null = root;
    let n = 0;
    let last: T | null = null;
    const badges: Record<string, string> = {};
    const visited = new Set<string>();
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const id of visited) tn[id] = 'good';
      for (const s of stack) tn[s.id] = 'info';
      if (last) tn[last.id] = 'active';
      return [
        V.tree('BST (badge = visit order, blue = on stack)', root, { pointers: { cur, popped: last }, tones: tn, badges }),
        V.stack('stack', stack.map((s) => s.val), { tones: stack.length ? { [stack.length - 1]: 'active' } : {} }),
      ];
    });
    t.step('init', `In-order = sorted for a BST. Count visits until n reaches k = ${k}.`, { k, n });
    let asked = 0;
    while (cur || stack.length) {
      t.step('loop', `Still nodes to visit (cur = ${fv(cur)}, stack size ${stack.length}).`, { cur: cur?.val ?? null, n });
      while (cur) {
        t.step('dive', `cur = ${cur.val} exists → keep diving left.`, { cur: cur.val });
        stack.push(cur);
        t.step('push', `Push ${cur.val}: we must come back to it after everything smaller.`, { stack: stack.map((s) => s.val) });
        cur = cur.left;
        t.step('goLeft', `Move to the left child (${fv(cur)}).`, { cur: cur?.val ?? null });
      }
      t.step('dive', 'cur is None: no smaller value left on this path. The stack top is the next smallest.', { cur: null });
      if (asked < 2 && stack.length >= 2) {
        asked++;
        const opts = stack.slice(-3).map((s) => String(s.val));
        t.predict('Which value is popped (visited) next?', opts, opts.length - 1, 'The top of the stack — the deepest node we pushed — is the smallest unvisited value.');
      }
      const node: T = stack.pop()!;
      last = node;
      cur = node;
      t.step('pop', `Pop ${node.val}: it is the next value in sorted order.`, { cur: node.val });
      n++;
      visited.add(node.id);
      badges[node.id] = `#${n}`;
      t.step('count', `That is visit #${n}.`, { n, k });
      if (n === k) {
        t.step('check', `n == k (${k}) → stop.`, { n, k });
        t.step('found', `The ${k}-th smallest value is ${node.val}.`, { result: node.val });
        return node.val;
      }
      t.step('check', `n = ${n} < k = ${k}, keep going.`, { n, k });
      cur = node.right;
      t.step('goRight', `Move to ${node.val}'s right child (${fv(cur)}): its subtree holds the next values between ${node.val} and the stack top.`, { cur: cur?.val ?? null });
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// 105. Construct Binary Tree from Preorder and Inorder Traversal
// ---------------------------------------------------------------------------

function consistent(pre: number[], ino: number[]): boolean {
  let ok = true;
  const go = (ps: number, is: number, n: number) => {
    if (!ok || n <= 0) return;
    const k = ino.indexOf(pre[ps]);
    if (k < is || k >= is + n) {
      ok = false;
      return;
    }
    const m = k - is;
    go(ps + 1, is, m);
    go(ps + 1 + m, k + 1, n - m - 1);
  };
  go(0, 0, pre.length);
  return ok;
}

const constructTree: Problem<{ preorder: number[]; inorder: number[] }> = {
  id: 'construct-binary-tree-from-preorder-and-inorder-traversal',
  num: 105,
  title: 'Construct Binary Tree from Preorder and Inorder Traversal',
  difficulty: 'Medium',
  category: 'trees',
  pattern: 'tree-dfs',
  statement: 'Given the pre-order and in-order listings of a binary tree with distinct values, rebuild the tree and return its root.',
  signals: ['two traversal orders given', 'rebuild / reconstruct a tree', 'values are unique (so positions can be looked up)'],
  insight:
    'Pre-order\'s first value is the root. Finding it in the in-order list splits that list into the left subtree (before it) and right subtree (after it); the count on the left tells you how to split pre-order too. Recurse on both halves.',
  hints: ['Which list tells you the root immediately?', 'Where is the root in the in-order list, and what lies on each side?', 'If mid values are on the left, preorder[1:mid+1] is the left subtree\'s pre-order.'],
  pitfall: 'Slicing preorder by the root\'s VALUE or using the wrong split size — the left subtree has exactly mid nodes, so its pre-order is preorder[1 : mid + 1].',
  backend: {
    title: 'Rebuilding a call tree from profiler event streams',
    detail:
      'A profiler emits span-enter events in pre-order; its flame-graph view lays the same spans out in an in-order (left-to-right) position. Combining both streams to rebuild the parent/child call hierarchy uses exactly this root-splits-the-range recursion; a value→index hashmap makes each split O(1).',
  },
  complexity: { time: 'O(n²) with slicing; O(n) with an index map', space: 'O(n)' },
  code: `
def buildTree(preorder, inorder):
    if not preorder or not inorder:                                 @base
        return None                                                 @none
    root = TreeNode(preorder[0])                                    @root
    mid = inorder.index(preorder[0])                                @mid
    root.left = buildTree(preorder[1:mid + 1], inorder[:mid])       @left
    root.right = buildTree(preorder[mid + 1:], inorder[mid + 1:])   @right
    return root                                                     @ret
`,
  explain: {
    root: 'Pre-order visits the root first.',
    mid: 'In-order puts the root between its left subtree and its right subtree; mid = size of the left subtree.',
    left: 'The next mid values of pre-order are exactly the left subtree.',
    right: 'Everything after that in pre-order is the right subtree.',
  },
  distractors: [
    { text: '    root.left = buildTree(preorder[1:mid], inorder[:mid])', why: 'Off by one: the left subtree has mid nodes, so its pre-order is preorder[1 : mid + 1].' },
    { text: '    root = TreeNode(inorder[0])', why: 'inorder[0] is the leftmost node, not the root — only pre-order starts with the root.' },
    { text: '    mid = preorder.index(inorder[0])', why: 'Looks up the wrong list — you must locate the ROOT (preorder[0]) inside inorder.' },
  ],
  input: { preorder: [3, 9, 20, 15, 7], inorder: [9, 3, 15, 20, 7] },
  presets: [
    { label: 'left chain', input: { preorder: [1, 2, 3], inorder: [3, 2, 1] } },
    { label: 'full tree', input: { preorder: [4, 2, 1, 3, 6, 5, 7], inorder: [1, 2, 3, 4, 5, 6, 7] } },
  ],
  validate: ({ preorder, inorder }) => {
    if (!Array.isArray(preorder) || !Array.isArray(inorder)) return 'Expected { preorder: number[], inorder: number[] }';
    if (preorder.length !== inorder.length) return 'preorder and inorder must have the same length';
    if (!preorder.length) return 'Give at least one value';
    if (preorder.length > 10) return 'Keep the tree ≤ 10 nodes';
    if (new Set(preorder).size !== preorder.length) return 'Values must be distinct';
    if (!consistent(preorder, inorder)) return 'These two lists do not describe the same tree';
    return null;
  },
  trace(t, { preorder, inorder }) {
    let built: T | null = null;
    let cur: T | null = null;
    let pw: [number, number] | null = null;
    let iw: [number, number] | null = null;
    let rootIdx = -1;
    let midIdx = -1;
    const done = new Set<string>();
    const calls: string[] = [];
    t.draw(() => {
      const it: Record<number, Tone> = {};
      if (iw && midIdx >= 0) {
        for (let x = iw[0]; x <= iw[1]; x++) it[x] = x < midIdx ? 'info' : x > midIdx ? 'warn' : 'active';
      }
      const tn: Record<string, Tone> = {};
      for (const id of done) tn[id] = 'good';
      if (cur) tn[cur.id] = 'active';
      return [
        V.array('preorder', preorder, { window: pw, pointers: { root: rootIdx }, tones: rootIdx >= 0 ? { [rootIdx]: 'active' } : {} }),
        V.array('inorder (blue = left subtree, amber = right)', inorder, { window: iw, pointers: { mid: midIdx }, tones: it }),
        V.tree('tree being built', built, { pointers: { node: cur }, tones: tn }),
        callV(calls),
      ];
    });
    let asked = 0;
    const build = (ps: number, is: number, n: number, attach: (x: T) => void): T | null => {
      calls.push(n ? `build(pre[${ps}:${ps + n}], in[${is}:${is + n}])` : 'build([], [])');
      pw = n ? [ps, ps + n - 1] : null;
      iw = n ? [is, is + n - 1] : null;
      rootIdx = -1;
      midIdx = -1;
      if (n === 0) {
        t.step('none', 'Both slices are empty: no subtree here → None.', {});
        calls.pop();
        return null;
      }
      t.step('base', `Build the subtree whose pre-order is ${fmt(preorder.slice(ps, ps + n))} and in-order is ${fmt(inorder.slice(is, is + n))}.`, { size: n });
      rootIdx = ps;
      const node = new TreeNode<number>(preorder[ps]);
      attach(node);
      cur = node;
      t.step('root', `Pre-order lists the root first → this subtree's root is ${node.val}.`, { root: node.val });
      const k = inorder.indexOf(node.val);
      midIdx = k;
      const m = k - is;
      t.step('mid', `${node.val} sits at in-order index ${k}: the ${m} value(s) before it form the left subtree, the ${n - m - 1} after it the right subtree.`, { root: node.val, mid: m });
      if (asked < 2 && m > 0) {
        asked++;
        const opts = [...new Set([preorder[ps + 1], inorder[is], preorder[ps + n - 1]])].map(String);
        const ans = opts.indexOf(String(preorder[ps + 1]));
        t.predict(`Which value becomes the root of ${node.val}'s LEFT subtree?`, opts, ans, `The left subtree's pre-order starts right after ${node.val}: preorder[${ps + 1}] = ${preorder[ps + 1]}.`);
      }
      t.step('left', m ? `Left: the next ${m} pre-order value(s) ${fmt(preorder.slice(ps + 1, ps + 1 + m))} with in-order ${fmt(inorder.slice(is, k))}.` : `${node.val} has no left subtree (nothing before it in in-order).`, { root: node.val, mid: m });
      build(ps + 1, is, m, (x) => (node.left = x));
      cur = node;
      pw = [ps, ps + n - 1];
      iw = [is, is + n - 1];
      rootIdx = ps;
      midIdx = k;
      t.step('right', n - m - 1 ? `Right: the remaining pre-order ${fmt(preorder.slice(ps + 1 + m, ps + n))} with in-order ${fmt(inorder.slice(k + 1, is + n))}.` : `${node.val} has no right subtree.`, { root: node.val });
      build(ps + 1 + m, k + 1, n - m - 1, (x) => (node.right = x));
      cur = node;
      done.add(node.id);
      pw = [ps, ps + n - 1];
      iw = [is, is + n - 1];
      rootIdx = ps;
      midIdx = k;
      t.step('ret', `Subtree rooted at ${node.val} is complete — return it to be hung on its parent.`, { root: node.val });
      calls.pop();
      return node;
    };
    build(0, 0, preorder.length, (x) => (built = x));
    return treeToArray(built);
  },
};

// ---------------------------------------------------------------------------
// 124. Binary Tree Maximum Path Sum
// ---------------------------------------------------------------------------

const maxPathSum: Problem<TreeIn> = {
  id: 'binary-tree-maximum-path-sum',
  num: 124,
  title: 'Binary Tree Maximum Path Sum',
  difficulty: 'Hard',
  category: 'trees',
  pattern: 'tree-dfs',
  statement: 'A path is any chain of connected nodes (each used at most once, need not touch the root). Values can be negative. Return the largest possible sum of a non-empty path.',
  signals: ['"any path", not necessarily through the root', 'negative values allowed', 'maximise a sum over paths in a tree'],
  insight:
    'Same shape as Diameter: at each node, the best path that BENDS here is val + left gain + right gain (update a global best), but the node RETURNS only val + the better single gain. Clamp negative gains to 0 — dropping a losing branch is always allowed.',
  hints: ['What does the best path look like at its highest node?', 'What may a child report upward if the parent wants to keep extending the path?', 'gain = max(dfs(child), 0); res = max(res, val + gL + gR); return val + max(gL, gR).'],
  pitfall: 'Returning val + left + right upward (a parent cannot use both branches), or forgetting max(…, 0) so a negative subtree drags the sum down.',
  backend: {
    title: 'Best contiguous chain in a cost/benefit hierarchy',
    detail:
      'A capacity planner scores each node of a service-dependency tree (throughput gained minus added latency cost, often negative) and wants the best connected chain to co-locate. Each node returns its best one-sided chain upward and ignores loss-making branches — the clamp-to-0 is "don\'t take a detour that costs more than it gives".',
  },
  complexity: { time: 'O(n)', space: 'O(h)' },
  code: `
def maxPathSum(root):
    res = root.val                                  @init
    def dfs(node):
        nonlocal res
        if not node:                                @base
            return 0                                @zero
        left = max(dfs(node.left), 0)               @left
        right = max(dfs(node.right), 0)             @right
        res = max(res, node.val + left + right)     @update
        return node.val + max(left, right)          @ret
    dfs(root)                                       @call
    return res                                      @done
`,
  explain: {
    init: 'Start with the root alone — at least one node must be in the path (all values could be negative).',
    left: 'A negative gain is dropped: better to not extend into that subtree at all.',
    update: 'Candidate path bending at this node uses both sides.',
    ret: 'Upward, the path can continue through only one side.',
  },
  distractors: [
    { text: '        return node.val + left + right', why: 'A parent can extend through only ONE side of this node; returning both would make a forked (invalid) path.' },
    { text: '        left = dfs(node.left)', why: 'Without max(…, 0) a negative subtree is forced into the path, lowering the sum.' },
    { text: '    res = 0', why: 'If every value is negative the answer is negative; starting at 0 reports an empty path.' },
  ],
  input: { root: [-10, 9, 20, null, null, 15, 7] },
  presets: [
    { label: 'negative child', input: { root: [2, -1, 3] } },
    { label: 'all negative', input: { root: [-3, -2, -5] } },
  ],
  validate: ({ root }) => checkLevel(root, 'root', 15, true),
  trace(t, { root: arr }) {
    const root = buildTree<number>(arr)!;
    const s = ds();
    let res = root.val;
    t.draw(() => [treeV('tree (badge ↑ = gain returned upward)', root, s, `res (best path sum) = ${res}`), callV(s.calls)]);
    t.step('init', `res starts at the root value ${root.val} — the path must contain at least one node.`, { res });
    t.step('call', 'Post-order DFS from the root.', { res });
    let asked = 0;
    const dfs = (node: T | null): number => {
      s.calls.push(`dfs(${fv(node)})`);
      if (!node) {
        t.step('zero', 'Empty subtree contributes a gain of 0.', { return: 0 });
        s.calls.pop();
        return 0;
      }
      s.cur = node;
      s.tn[node.id] = 'active';
      t.step('base', `dfs(${node.val}): first learn how much each child can add.`, { node: node.val, res });
      s.tn[node.id] = 'info';
      const rl = dfs(node.left);
      s.cur = node;
      s.tn[node.id] = 'active';
      const left = Math.max(rl, 0);
      t.step('left', rl < 0 ? `Left child offered ${rl} — negative, so clamp to 0 (just don't go left).` : `Left gain = ${left}.`, { node: node.val, left, res });
      const rr = dfs(node.right);
      s.cur = node;
      s.tn[node.id] = 'active';
      const right = Math.max(rr, 0);
      t.step('right', rr < 0 ? `Right child offered ${rr} — negative, clamp to 0.` : `Right gain = ${right}.`, { node: node.val, left, right, res });
      const through = node.val + left + right;
      if (asked < 2 && (node.left || node.right)) {
        asked++;
        t.predict(`Best path bending at ${node.val} = ${node.val} + ${left} + ${right} = ${through}. Does res (${res}) change?`, ['Yes', 'No'], through > res ? 0 : 1, through > res ? `${through} > ${res}.` : `${through} ≤ ${res} — a path found deeper down is still better.`);
      }
      const before = res;
      res = Math.max(res, through);
      t.step('update', res > before ? `${through} beats ${before} → res = ${res}.` : `${through} does not beat res = ${res}.`, { node: node.val, through, res });
      const gain = node.val + Math.max(left, right);
      s.tn[node.id] = 'good';
      s.badges[node.id] = `↑${gain}`;
      t.step('ret', `Return ${node.val} + max(${left}, ${right}) = ${gain}: the best one-sided chain the parent can extend.`, { node: node.val, return: gain, res });
      s.calls.pop();
      return gain;
    };
    dfs(root);
    s.cur = null;
    t.step('done', `Maximum path sum = ${res}.`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 297. Serialize and Deserialize Binary Tree
// ---------------------------------------------------------------------------

const serialize: Problem<TreeIn> = {
  id: 'serialize-and-deserialize-binary-tree',
  num: 297,
  title: 'Serialize and Deserialize Binary Tree',
  difficulty: 'Hard',
  category: 'trees',
  pattern: 'tree-dfs',
  statement: 'Design a way to turn a binary tree into a string and back again, so that decoding the string rebuilds exactly the original tree.',
  signals: ['encode / decode, serialize / deserialize', 'must preserve exact structure', 'round-trip'],
  insight:
    'A pre-order walk that writes an explicit marker ("N") for every empty child is unambiguous: when reading back, the same pre-order recursion consumes tokens left to right and the N markers tell it exactly where each subtree ends.',
  hints: ['Why is a plain list of values not enough?', 'What if you also record where the children are missing?', 'Pre-order with "N" for None; read it back with a shared index i.'],
  pitfall: 'Leaving out the None markers — then [1,2] and [1,null,2] serialize the same and cannot be told apart.',
  backend: {
    title: 'Shipping tree-shaped data over the wire',
    detail:
      'Caching a parsed AST or decision-tree model in Redis, or sending a nested comment thread between services, needs a flat format that round-trips. Pre-order with explicit null markers is a streaming-friendly encoding: the decoder rebuilds nodes as tokens arrive, with no lookahead or level bookkeeping.',
  },
  complexity: { time: 'O(n)', space: 'O(n)' },
  code: `
def serialize(root):
    res = []                                  @sInit
    def dfs(node):
        if not node:
            res.append("N"); return           @sN
        res.append(str(node.val))             @sVal
        dfs(node.left)                        @sLeft
        dfs(node.right)                       @sRight
    dfs(root)
    return ",".join(res)                      @sJoin

def deserialize(data):
    vals, i = data.split(","), 0              @dInit
    def dfs():
        nonlocal i
        if vals[i] == "N":
            i += 1; return None               @dN
        node = TreeNode(int(vals[i]))         @dVal
        i += 1                                @dInc
        node.left = dfs()                     @dLeft
        node.right = dfs()                    @dRight
        return node                           @dRet
    return dfs()
`,
  explain: {
    sN: 'The marker that makes the encoding unambiguous: it says "this subtree ends here".',
    sVal: 'Pre-order: write the node before its children.',
    dN: 'Consume the marker and report an empty child.',
    dLeft: 'Tokens are consumed in exactly the order serialize produced them.',
  },
  distractors: [
    { text: '        if not node: return', why: 'Skipping the "N" marker loses the shape — the decoder cannot tell where a subtree ends.' },
    { text: '        node.left = dfs(); i += 1', why: 'Advancing i after recursing reads the child from the parent\'s token; the index must move before descending.' },
    { text: '    vals = data.split(","); return dfs(vals)', why: 'Each recursive call must share ONE position i; passing the list and reading vals[0] every time restarts from the beginning.' },
  ],
  input: { root: [1, 2, 3, null, null, 4, 5] },
  presets: [
    { label: 'right chain', input: { root: [1, null, 2, null, 3] } },
    { label: 'single node', input: { root: [7] } },
  ],
  validate: ({ root }) => checkLevel(root, 'root', 9, true),
  trace(t, { root: arr }) {
    const root = buildTree<number>(arr);
    const tokens: string[] = [];
    let phase: 'ser' | 'des' = 'ser';
    let cur: T | null = null;
    const tn: Record<string, Tone> = {};
    let rebuilt: T | null = null;
    let rcur: T | null = null;
    const rtn: Record<string, Tone> = {};
    let i = -1;
    const calls: string[] = [];
    t.draw(() =>
      phase === 'ser'
        ? [
            V.tree('original tree', root, { pointers: { node: cur }, tones: tn }),
            V.chips('res (tokens written)', tokens, { tones: tokens.length ? { [tokens.length - 1]: 'active' } : {} }),
            callV(calls),
          ]
        : [
            V.array('vals', tokens, { pointers: { i }, tones: Object.fromEntries(tokens.map((_, j) => [j, (j < i ? 'muted' : j === i ? 'active' : 'info') as Tone])) }),
            V.tree('rebuilt tree', rebuilt, { pointers: { node: rcur }, tones: rtn }),
            callV(calls),
          ],
    );
    t.step('sInit', 'Serialize: walk the tree in pre-order, writing a token for every node AND every empty child.', {});
    let asked = 0;
    const ser = (node: T | null) => {
      calls.push(`ser(${fv(node)})`);
      if (!node) {
        tokens.push('N');
        t.step('sN', 'Empty child → write "N" so the decoder knows this branch stops here.', { res: tokens.join(',') });
        calls.pop();
        return;
      }
      cur = node;
      tn[node.id] = 'active';
      tokens.push(String(node.val));
      t.step('sVal', `Write ${node.val} before its children (pre-order).`, { res: tokens.join(',') });
      if (!asked && node.left) {
        asked++;
        const opts = [...new Set([String(node.left.val), node.right ? String(node.right.val) : 'N', 'N'])];
        t.predict('What is the NEXT token written?', opts, opts.indexOf(String(node.left.val)), `Pre-order goes left first: ${node.left.val}.`);
      }
      tn[node.id] = 'good';
      t.step('sLeft', `Serialize ${node.val}'s left subtree (${fv(node.left)}).`, { res: tokens.join(',') });
      ser(node.left);
      cur = node;
      t.step('sRight', `Then ${node.val}'s right subtree (${fv(node.right)}).`, { res: tokens.join(',') });
      ser(node.right);
      calls.pop();
    };
    ser(root);
    cur = null;
    const data = tokens.join(',');
    t.step('sJoin', `Joined string: "${data}". ${tokens.filter((x) => x === 'N').length} N markers make the shape explicit.`, { data });
    phase = 'des';
    i = 0;
    t.step('dInit', 'Deserialize: split the string and read tokens left to right with ONE shared index i.', { i });
    let askedN = false;
    const des = (attach: (x: T | null) => void): T | null => {
      calls.push(`des() @ i=${i}`);
      if (tokens[i] === 'N') {
        if (!askedN) {
          askedN = true;
          t.predict(`vals[${i}] is "N". What does this call do?`, ['i += 1 and return None', 'return None without moving i', 'stop the whole decode'], 0, 'Consume the marker (so the next call reads the next token) and report an empty child.');
        }
        i++;
        attach(null);
        t.step('dN', '"N" → consume it and return None: this child is empty.', { i });
        calls.pop();
        return null;
      }
      const node = new TreeNode<number>(Number(tokens[i]));
      attach(node);
      rcur = node;
      rtn[node.id] = 'active';
      t.step('dVal', `vals[${i}] = ${node.val} → create node ${node.val} (drawn already attached where its parent will hang it).`, { i, node: node.val });
      i++;
      t.step('dInc', `Advance i to ${i} — the next token belongs to ${node.val}'s left subtree.`, { i });
      rtn[node.id] = 'info';
      t.step('dLeft', `Rebuild ${node.val}.left from the tokens starting at i = ${i}.`, { i });
      des((x) => (node.left = x));
      rcur = node;
      t.step('dRight', `Left subtree of ${node.val} done; i = ${i}. Rebuild ${node.val}.right.`, { i });
      des((x) => (node.right = x));
      rcur = node;
      rtn[node.id] = 'good';
      t.step('dRet', `Node ${node.val} is complete — return it.`, { i });
      calls.pop();
      return node;
    };
    des((x) => (rebuilt = x));
    rcur = null;
    return { data, rebuilt: treeToArray(rebuilt) };
  },
};

// ---------------------------------------------------------------------------

export const problems: Problem[] = [
  invertTree,
  maxDepth,
  diameter,
  balanced,
  sameTree,
  subtree,
  lcaBST,
  levelOrder,
  rightSide,
  goodNodes,
  validateBST,
  kthSmallest,
  constructTree,
  maxPathSum,
  serialize,
];

export const variants: Variant[] = [
  {
    id: 'deepest-leaves-sum',
    title: 'Sum of the Deepest Leaves',
    statement: 'Given a binary tree, return the sum of the values of the nodes on its deepest level.',
    pattern: 'tree-bfs',
    nearest: 'binary-tree-level-order-traversal',
    signals: ['"deepest level"', 'answer depends on grouping nodes by depth'],
    approach: 'Level-order BFS; reset a running sum at the start of each level and keep the last level\'s sum. (DFS alternative: track max depth and sum nodes at it.)',
    backend: 'Finding the leaf tier of a service-dependency tree (the services with no downstream calls at the deepest hop) to estimate their total load.',
  },
  {
    id: 'max-ancestor-difference',
    title: 'Largest Gap Between a Node and an Ancestor',
    statement: 'Return the largest |a.val − b.val| where a is an ancestor of b in a binary tree.',
    pattern: 'tree-dfs',
    nearest: 'count-good-nodes-in-binary-tree',
    signals: ['condition along the root-to-node path', '"ancestor"', 'only extremes of the path matter'],
    approach: 'DFS passing the min and max seen on the path down; at each node update the answer with |val − min| and |val − max|, then recurse with updated min/max.',
    backend: 'In a trace span tree, finding the largest latency jump between any span and one of its callers — carrying min/max down each call chain.',
  },
  {
    id: 'range-sum-of-bst',
    title: 'Sum of BST Values in a Range',
    statement: 'Given a BST and bounds lo ≤ hi, return the sum of all values v with lo ≤ v ≤ hi, visiting as few nodes as possible.',
    pattern: 'bst',
    nearest: 'validate-binary-search-tree',
    signals: ['BST + value range', '"visit as few nodes as possible" → prune using order'],
    approach: 'DFS: if node.val < lo only the right subtree can help; if > hi only the left; otherwise add it and recurse both sides.',
    backend: 'A range scan on an ordered index (`WHERE ts BETWEEN a AND b`): skip whole subtrees whose key ranges fall outside the bounds.',
  },
];
