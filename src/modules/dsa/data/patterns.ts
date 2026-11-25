import type { Pattern, PatternId } from '../engine/types.ts';
import { patternLangs } from './pattern-langs.ts';

const basePatterns: Pattern[] = [
  {
    id: 'hashing',
    name: 'Hash Map / Set',
    tagline: 'Remember what you have seen so every lookup is O(1).',
    intuition:
      'A hashmap is a notebook you keep while walking the data: before acting on an element you ask the notebook a question ("seen this before?", "where?", "how many?") instead of rescanning. You trade O(n) memory for turning an inner loop into a constant-time lookup.',
    signals: ['"have we seen…", "duplicate", "count occurrences", "frequency"', 'pairs that sum / complement lookups', 'group items by a key (anagrams, same signature)', 'O(n) required on unsorted input'],
    template: `
def solve(items):
    seen = {}                       # key -> what you need later
    for i, x in enumerate(items):
        key = signature(x)          # value, complement, sorted chars…
        if key in seen:             # O(1) question
            use(seen[key], i)
        seen[key] = update(seen.get(key), i)
    return answer
`,
    invariants: ['seen holds information about exactly the elements already processed', 'each element is inserted and looked up O(1) times'],
    mistakes: ['Inserting before checking (element matches itself)', 'Using a mutable list as a key — convert to tuple / string', 'Forgetting the map costs O(n) space when asked for O(1)'],
    complexity: 'O(n) time, O(n) space',
    backend: [
      { title: 'Idempotency keys', detail: 'APIs store request-id → response in a hash (Redis) so a retried POST returns the cached result instead of charging twice.' },
      { title: 'Hash joins & dedup', detail: 'Databases join tables by hashing the smaller side; stream processors dedupe events with a set of recent event ids.' },
      { title: 'Heavy-hitter counting', detail: 'Count requests per IP / user / endpoint in a map to drive rate limiting and dashboards.' },
    ],
    selfExplain: ['What question do you ask the hashmap on each step, and why does that remove the inner loop?', 'What is the key, and what is the value, for this problem?'],
    distractors: [
      { text: '        for j in range(len(items)):', why: 'An inner scan is exactly what the hashmap replaces.' },
      { text: '    seen = []', why: 'A list lookup is O(n); use a dict/set for O(1) membership.' },
    ],
  },
  {
    id: 'prefix-sum',
    name: 'Prefix / Suffix Accumulation',
    tagline: 'Precompute running totals so any range answer is O(1).',
    intuition:
      'Walk left→right carrying a running aggregate (sum, product, max). Anything "everything before i" is the prefix; a second right→left pass gives "everything after i". Combining both answers per-index questions without nested loops.',
    signals: ['"except self", "everything to the left/right"', 'range sum queries', 'subarray sum equals k (prefix + hashmap)', 'no division allowed'],
    template: `
def solve(nums):
    res = [1] * len(nums)
    prefix = 1
    for i in range(len(nums)):
        res[i] = prefix             # aggregate of nums[0..i-1]
        prefix *= nums[i]
    suffix = 1
    for i in range(len(nums) - 1, -1, -1):
        res[i] *= suffix            # aggregate of nums[i+1..]
        suffix *= nums[i]
    return res
`,
    invariants: ['before processing i, prefix = aggregate of nums[0..i-1]', 'suffix = aggregate of nums[i+1..n-1] on the backward pass'],
    mistakes: ['Updating the running value before writing res[i] (includes self)', 'Off-by-one in range bounds', 'Overflow of large products/sums'],
    complexity: 'O(n) time, O(1) extra space (output excluded)',
    backend: [
      { title: 'Time-series rollups', detail: 'Metrics stores keep cumulative counters so "requests between t1 and t2" is counter[t2] − counter[t1].' },
      { title: 'Billing / quota windows', detail: 'Cumulative usage per customer lets you answer usage in any billing range instantly.' },
    ],
    selfExplain: ['What does prefix hold right before you use it at index i?', 'Why do two passes beat one nested loop here?'],
    distractors: [{ text: '        res[i] = total / nums[i]', why: 'Division fails with zeros and is often disallowed — that is why we use prefix × suffix.' }],
  },
  {
    id: 'two-pointers',
    name: 'Two Pointers',
    tagline: 'Two indices squeeze a sorted or symmetric range, each move discarding impossible answers.',
    intuition:
      'Put one finger at each end. Compare, then move the finger whose side can no longer be part of a better answer. Because the input is sorted (or symmetric), one comparison rules out a whole row of pairs, collapsing O(n²) into O(n).',
    signals: ['sorted array', 'pair / triplet with a target sum', 'palindrome / symmetric check', '"in place", O(1) extra space', 'maximise area / width between two lines'],
    template: `
def solve(nums):
    l, r = 0, len(nums) - 1
    while l < r:
        cur = combine(nums[l], nums[r])
        if cur == target:
            return [l, r]
        elif cur < target:
            l += 1                  # need bigger -> drop the smallest
        else:
            r -= 1                  # need smaller -> drop the largest
`,
    invariants: ['the answer (if any) lies within [l, r]', 'every pair outside [l, r] has been ruled out'],
    mistakes: ['Using l <= r when l == r would pair an element with itself', 'Moving the wrong pointer (think: which side can still improve?)', 'Forgetting to skip duplicates in 3Sum'],
    complexity: 'O(n) per scan (O(n²) for 3Sum), O(1) space',
    backend: [
      { title: 'Merging sorted streams', detail: 'Merge-join of two sorted tables / SSTables in an LSM tree walks one pointer per input.' },
      { title: 'Reconciling sorted logs', detail: 'Diffing two sorted ID exports (source vs replica) to find missing rows in a single pass.' },
    ],
    selfExplain: ['When you move l, which pairs did you just prove are useless?', 'Why does sortedness make the greedy pointer move safe?'],
    distractors: [{ text: '    while l <= r:', why: 'When l == r both pointers are the same element — a pair needs two distinct indices.' }],
  },
  {
    id: 'sliding-window',
    name: 'Sliding Window',
    tagline: 'Grow right, shrink left while invalid — a contiguous range in O(n).',
    intuition:
      'Think of a caterpillar crawling over the array: the head (right) always advances; the tail (left) catches up only when the window breaks a rule. Each index enters and leaves once, so the total work is linear even though the loop looks nested.',
    signals: ['"contiguous subarray / substring"', 'longest / shortest / count windows with a property', '"at most k distinct / replacements"', 'window size k'],
    template: `
def solve(s):
    state = {}
    l = 0
    best = 0
    for r in range(len(s)):
        add(state, s[r])            # expand
        while invalid(state):       # shrink until valid again
            remove(state, s[l])
            l += 1
        best = max(best, r - l + 1)
    return best
`,
    invariants: ['after the while loop, window [l, r] is valid', 'state summarises exactly the elements in [l, r]', 'l never moves backwards'],
    mistakes: ['if instead of while when shrinking', 'Updating best before restoring validity', 'Forgetting to remove s[l] from state before moving l'],
    complexity: 'O(n) time, O(k) space for window state',
    backend: [
      { title: 'Sliding-window rate limiter', detail: 'Count requests in the last 60 s per API key; evict timestamps that fall out of the window before deciding.' },
      { title: 'Anomaly detection on metrics', detail: 'Rolling error-rate / p99 over the last N minutes in a monitoring pipeline.' },
      { title: 'TCP flow control', detail: 'The sender window advances as acks arrive — literally a sliding window over the byte stream.' },
    ],
    selfExplain: ['What exactly makes the window invalid in this problem?', 'Why is the algorithm O(n) even though there is a while inside a for?'],
    distractors: [
      { text: '        if invalid(state):', why: 'One shrink may not be enough — shrink in a while loop until the window is valid.' },
      { text: '        l = r', why: 'Jumping l to r throws away valid elements that could be part of the best window.' },
    ],
  },
  {
    id: 'stack',
    name: 'Stack',
    tagline: 'Last in, first out — the most recent unresolved thing is what matters.',
    intuition:
      'Use a stack when the next thing you must resolve is the most recently opened one: brackets, nested calls, undo, expression evaluation. Push when something opens, pop when it closes.',
    signals: ['matching / nested brackets', 'evaluate an expression (postfix)', 'undo, backtrack to the most recent state', 'simulate recursion iteratively'],
    template: `
def solve(tokens):
    stack = []
    for tok in tokens:
        if opens(tok):
            stack.append(tok)
        else:
            if not stack or not matches(stack[-1], tok):
                return False
            stack.pop()
    return not stack
`,
    invariants: ['stack holds the unresolved items in the order they were opened', 'the top is the only item that can be resolved next'],
    mistakes: ['Popping an empty stack', 'Forgetting to check the stack is empty at the end', 'Operand order for - and / in RPN (second popped is the left operand)'],
    complexity: 'O(n) time, O(n) space',
    backend: [
      { title: 'Parsers & template engines', detail: 'JSON/XML parsers keep a stack of open objects/tags; mismatched close → syntax error.' },
      { title: 'Call stacks & tracing spans', detail: 'Distributed tracing keeps a stack of active spans per request; ending a span pops it.' },
    ],
    selfExplain: ['Why is the most recent unresolved item always the one to match next?', 'What does a non-empty stack at the end mean?'],
    distractors: [{ text: '            stack.pop(0)', why: 'pop(0) removes the oldest item — that is a queue, not a stack.' }],
  },
  {
    id: 'monotonic-stack',
    name: 'Monotonic Stack',
    tagline: 'Keep a stack sorted so each element finds its next greater/smaller in amortised O(1).',
    intuition:
      'Elements wait on the stack for "someone bigger" (or smaller). When a new element arrives it resolves everyone shorter than it — they pop and record their answer. The stack stays monotonic, and every element is pushed and popped once.',
    signals: ['"next greater / warmer / smaller element"', '"how many days until…"', 'largest rectangle, span, visibility', 'for each element find the nearest element to the left/right satisfying a comparison'],
    template: `
def solve(nums):
    res = [0] * len(nums)
    stack = []                       # indices, values decreasing
    for i, x in enumerate(nums):
        while stack and nums[stack[-1]] < x:
            j = stack.pop()
            res[j] = i - j           # x is j's next greater
        stack.append(i)
    return res
`,
    invariants: ['values at stack indices are monotonic (e.g. decreasing)', 'every index still on the stack has not found its answer yet'],
    mistakes: ['Pushing values when you need indices (distances)', '< vs <= when equal values matter', 'Forgetting to flush the stack at the end (histogram)'],
    complexity: 'O(n) amortised time, O(n) space',
    backend: [
      { title: 'Latency spike attribution', detail: 'For each request find the next request slower than it — monotonic stacks compute "next greater" over latency series in one pass.' },
      { title: 'Stock / price alerts', detail: 'Span of days a price stayed below today’s price, computed incrementally per tick.' },
    ],
    selfExplain: ['When an element is popped, why is its answer final?', 'Why is the whole thing O(n) despite the inner while?'],
    distractors: [{ text: '        if stack and nums[stack[-1]] < x:', why: 'One new element can resolve several waiting elements — use while.' }],
  },
  {
    id: 'binary-search',
    name: 'Binary Search',
    tagline: 'Halve a monotonic search space every step — even when searching for an answer.',
    intuition:
      'If you can ask a yes/no question whose answers flip exactly once (false…false true…true), you can find the flip point by checking the middle and discarding half. The space can be indices of a sorted array OR a range of candidate answers (speeds, capacities, days).',
    signals: ['sorted / rotated sorted input', '"minimum x such that…", "maximum x that still works"', 'O(log n) required', 'monotonic feasibility function'],
    template: `
def solve(lo, hi):
    while lo <= hi:
        mid = (lo + hi) // 2
        if feasible(mid):
            ans = mid
            hi = mid - 1            # look for a smaller feasible value
        else:
            lo = mid + 1
    return ans
`,
    invariants: ['the answer is always within [lo, hi] (or already recorded in ans)', 'the range strictly shrinks every iteration'],
    mistakes: ['lo < hi vs lo <= hi mismatched with mid ± 1 → infinite loop', 'Overflow of lo + hi in fixed-width languages', 'Choosing a non-monotonic predicate'],
    complexity: 'O(log n) iterations × cost of the check',
    backend: [
      { title: 'Capacity planning', detail: 'Binary-search the minimum number of workers / throughput that meets an SLA by simulating load for a candidate value.' },
      { title: 'git bisect & log search', detail: 'Find the first bad deploy or the first log line after a timestamp in sorted segments.' },
      { title: 'Index lookups', detail: 'B-tree pages and SSTable indexes binary-search keys within a block.' },
    ],
    selfExplain: ['What is the yes/no question, and why is it monotonic?', 'Which half did you discard and why can the answer not be there?'],
    distractors: [{ text: '            hi = mid', why: 'With while lo <= hi, setting hi = mid can loop forever when lo == hi == mid.' }],
  },
  {
    id: 'linked-list',
    name: 'Linked List Pointer Surgery',
    tagline: 'Rewire next pointers carefully — save before you cut.',
    intuition:
      'A linked list is a chain of boxes where each knows only its successor. Every manipulation is: save the next box, rewire the current box, advance. A dummy head removes special cases for the first node.',
    signals: ['reverse / reorder / merge lists', 'remove nth node', 'O(1) extra space on a list', 'k-group operations'],
    template: `
def reverse(head):
    prev, curr = None, head
    while curr:
        nxt = curr.next             # save
        curr.next = prev            # rewire
        prev, curr = curr, nxt      # advance
    return prev
`,
    invariants: ['prev is the head of the already-processed part', 'curr is the head of the untouched remainder'],
    mistakes: ['Losing the rest of the list by rewiring before saving next', 'Not returning the new head', 'Forgetting a dummy node for head removals'],
    complexity: 'O(n) time, O(1) space',
    backend: [
      { title: 'LRU caches', detail: 'Redis/memcached-style LRU keeps a doubly linked list of entries; touching a key unlinks and relinks it at the head in O(1).' },
      { title: 'Free lists & queues', detail: 'Memory allocators and job queues chain free blocks / jobs with next pointers.' },
    ],
    selfExplain: ['What breaks if you rewire before saving next?', 'Why does a dummy node simplify the code?'],
    distractors: [{ text: '        curr = curr.next', why: 'curr.next was already rewired to prev — advance with the saved nxt.' }],
  },
  {
    id: 'fast-slow',
    name: 'Fast & Slow Pointers',
    tagline: 'One runner at 2× speed detects cycles and finds middles with O(1) memory.',
    intuition:
      'Two runners on a circular track: if there is a loop the fast one laps the slow one. If not, fast reaches the end when slow is in the middle. Floyd’s second phase (restart one pointer at head) lands both on the cycle entry.',
    signals: ['cycle detection without extra memory', 'find the middle of a list', 'sequence defined by f(x) that may repeat (happy number)', 'array values in range 1..n used as pointers'],
    template: `
def has_cycle(head):
    slow = fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:
            return True
    return False
`,
    invariants: ['fast has taken twice as many steps as slow', 'if a cycle exists the gap shrinks by 1 each step inside it'],
    mistakes: ['Checking fast.next before fast is non-null', 'Comparing before moving (both start equal)', 'Forgetting phase 2 to find the entry point'],
    complexity: 'O(n) time, O(1) space',
    backend: [
      { title: 'Detecting redirect / reference loops', detail: 'Follow URL redirects, symlinks or parent-pointer chains with two cursors to detect a loop without storing every hop.' },
      { title: 'Corrupted pointer chains', detail: 'Validating on-disk linked structures (WAL segments, free lists) for cycles with constant memory.' },
    ],
    selfExplain: ['Why must fast catch slow if there is a cycle?', 'Why does restarting one pointer at head find the cycle entry?'],
    distractors: [{ text: '    while fast:', why: 'fast.next.next fails when fast.next is None — check both fast and fast.next.' }],
  },
  {
    id: 'tree-dfs',
    name: 'Tree DFS (recursion)',
    tagline: 'Trust the subtrees: ask children for an answer, combine, return upward.',
    intuition:
      'Solve the problem for a node assuming the recursive calls already solved it for the left and right subtrees. Decide (1) what each call returns, (2) how to combine children, (3) the base case for None. Global answers (diameter, max path) are updated on the way up.',
    signals: ['binary tree + "depth / height / path / balanced / same"', 'answer for a node depends on answers of its children', 'serialize / build a tree', 'root-to-leaf conditions'],
    template: `
def dfs(node):
    if not node:
        return base_value
    left = dfs(node.left)
    right = dfs(node.right)
    update_global(left, right, node)
    return combine(left, right, node)
`,
    invariants: ['dfs(node) returns the fact for exactly that subtree', 'children are fully processed before the parent combines them (post-order)'],
    mistakes: ['Returning the global answer instead of the per-subtree value', 'Missing the None base case', 'Confusing depth (top-down) with height (bottom-up)'],
    complexity: 'O(n) time, O(h) recursion stack',
    backend: [
      { title: 'Org charts & permission trees', detail: 'Effective permissions or cost roll-ups over a hierarchy (folders, org units, cloud resource trees) are post-order aggregations.' },
      { title: 'Config / AST evaluation', detail: 'Evaluating expression trees, JSON documents and query plans recursively.' },
    ],
    selfExplain: ['What does dfs(node) return in this problem — in one sentence?', 'What does the parent do with the two returned values?'],
    distractors: [{ text: '    return dfs(node.left) + dfs(node.right)', why: 'Ignoring the node itself (and the combine rule) gives the wrong value; think about what one subtree should report.' }],
  },
  {
    id: 'tree-bfs',
    name: 'Tree BFS (level order)',
    tagline: 'Sweep the tree level by level with a queue.',
    intuition:
      'A queue processes nodes in the order they were discovered, which for a tree means by depth. Snapshot len(queue) at the start of each round to know exactly which nodes belong to the current level.',
    signals: ['"level", "layer", "row", "right side view"', 'minimum depth / nearest', 'zig-zag or per-level aggregates'],
    template: `
from collections import deque
def levels(root):
    q, res = deque([root] if root else []), []
    while q:
        level = []
        for _ in range(len(q)):
            node = q.popleft()
            level.append(node.val)
            if node.left: q.append(node.left)
            if node.right: q.append(node.right)
        res.append(level)
    return res
`,
    invariants: ['at the start of each round the queue holds exactly one full level', 'nodes leave the queue in non-decreasing depth'],
    mistakes: ['Using len(q) inside the loop condition (it changes as you push)', 'Using a stack (gives DFS order)', 'Pushing None children'],
    complexity: 'O(n) time, O(width) space',
    backend: [
      { title: 'Dependency fan-out by hop', detail: 'Blast-radius analysis: which services are 1, 2, 3 hops from a failing one.' },
      { title: 'Crawlers & breadth-limited fetches', detail: 'Web crawlers and social graph "friends of friends" fetch level by level with a depth cap.' },
    ],
    selfExplain: ['Why do we freeze len(q) before the inner loop?', 'Why does a queue give level order but a stack does not?'],
    distractors: [{ text: '            node = q.pop()', why: 'pop() takes from the back — that is DFS order. Use popleft().' }],
  },
  {
    id: 'bst',
    name: 'Binary Search Tree',
    tagline: 'Left < node < right everywhere — use the ordering to prune half the tree.',
    intuition:
      'A BST is a binary search frozen into a tree. Comparing with a node tells you which side the target must be on; an in-order walk visits values in sorted order. Validity needs bounds inherited from ALL ancestors, not just the parent.',
    signals: ['"binary search tree"', 'kth smallest / sorted order', 'lowest common ancestor in a BST', 'validate ordering'],
    template: `
def valid(node, low=-inf, high=inf):
    if not node:
        return True
    if not (low < node.val < high):
        return False
    return valid(node.left, low, node.val) and valid(node.right, node.val, high)
`,
    invariants: ['every node in the left subtree is < node.val < every node in the right subtree', 'in-order traversal is sorted'],
    mistakes: ['Only comparing with the direct parent', '<= vs < for duplicates', 'Not exploiting ordering (walking the whole tree)'],
    complexity: 'O(h) per search, O(n) for full traversals',
    backend: [
      { title: 'Ordered indexes', detail: 'Database indexes (B-trees, red-black trees in in-memory stores) answer range and kth queries using the same ordering.' },
      { title: 'Timer wheels / schedulers', detail: 'Ordered maps of next-fire times give the earliest job and range scans.' },
    ],
    selfExplain: ['Which subtree can you skip at this node, and why?', 'Why are parent-only checks insufficient for validation?'],
    distractors: [{ text: '    return node.left.val < node.val < node.right.val', why: 'Checks only direct children; a deeper node can still break the ordering w.r.t. an ancestor.' }],
  },
  {
    id: 'trie',
    name: 'Trie (Prefix Tree)',
    tagline: 'Share prefixes; walk one character per level.',
    intuition:
      'Store words as paths from the root, one character per edge. Words with the same prefix share the path, so prefix queries cost O(length) regardless of how many words exist. Mark nodes where a word ends.',
    signals: ['"prefix", "starts with", autocomplete', 'many words searched against a grid / text', 'wildcard character matching'],
    template: `
class TrieNode:
    def __init__(self):
        self.children = {}
        self.end = False

def insert(root, word):
    node = root
    for ch in word:
        node = node.children.setdefault(ch, TrieNode())
    node.end = True
`,
    invariants: ['the path from root to a node spells a prefix of some inserted word', 'end marks complete words'],
    mistakes: ['Forgetting the end flag (prefix vs word)', 'Rebuilding the trie per query', 'Not pruning found words in Word Search II'],
    complexity: 'O(L) per insert/search, O(total chars) space',
    backend: [
      { title: 'Autocomplete & search suggestions', detail: 'Typeahead services keep a trie of popular queries per prefix.' },
      { title: 'IP routing (longest prefix match)', detail: 'Routers and API gateways match route prefixes with radix tries (e.g. /api/v1/users/:id).' },
    ],
    selfExplain: ['Why is lookup cost independent of the number of stored words?', 'What is the difference between search and startsWith?'],
    distractors: [{ text: '        node.end = True', why: 'Marking end inside the loop marks every prefix as a word.' }],
  },
  {
    id: 'heap',
    name: 'Heap / Priority Queue',
    tagline: 'Always know the current min (or max) in O(log n).',
    intuition:
      'A heap is a partially-sorted tree: only the top is guaranteed to be the smallest. That is enough for "best k", "next event", "merge sorted streams" and "running median" (two heaps). Keep a size-k MIN-heap to track the k LARGEST.',
    signals: ['"k largest / smallest / closest / most frequent"', 'repeatedly take the min/max and push new items', 'merge k sorted inputs', 'streaming median', 'scheduling by time/priority'],
    template: `
import heapq
def k_largest(nums, k):
    heap = []
    for x in nums:
        heapq.heappush(heap, x)
        if len(heap) > k:
            heapq.heappop(heap)     # drop the smallest
    return heap                     # heap[0] is the kth largest
`,
    invariants: ['heap[0] is the minimum of the heap', 'a size-k min-heap holds the k largest seen so far'],
    mistakes: ['Using a max-heap of all n items when a size-k min-heap suffices', 'Python heapq is a min-heap — negate for max', 'Comparing tuples with non-comparable payloads'],
    complexity: 'O(n log k) time, O(k) space',
    backend: [
      { title: 'Job schedulers & timers', detail: 'Cron services and delayed-job queues pop the job with the earliest run-at time.' },
      { title: 'Top-k in streaming analytics', detail: 'Keep the k heaviest endpoints/IPs over a stream with a size-k heap.' },
      { title: 'Load balancing', detail: 'Least-connections balancers keep servers in a heap keyed by active connections.' },
    ],
    selfExplain: ['Why a MIN-heap to keep the k LARGEST?', 'What does heap[0] represent at every moment?'],
    distractors: [{ text: '    heap.sort()', why: 'Sorting costs O(n log n) every time; heap push/pop keep order in O(log n).' }],
  },
  {
    id: 'backtracking',
    name: 'Backtracking',
    tagline: 'Choose → explore → un-choose. Walk a decision tree and prune.',
    intuition:
      'Every answer is a path through a tree of decisions (take/skip, which number next, which cell next). DFS builds a partial path, recurses, then undoes the last choice to try the next one. Pruning cuts subtrees that can never succeed.',
    signals: ['"all subsets / permutations / combinations / partitions"', 'place items under constraints (N-Queens, sudoku)', 'find a path in a grid of letters', 'small n (≤ 15–20) with exponential answers'],
    template: `
def backtrack(path, choices):
    if is_solution(path):
        res.append(path[:])          # copy!
        return
    for c in choices:
        if not valid(c, path):
            continue                 # prune
        path.append(c)               # choose
        backtrack(path, next_choices(c))
        path.pop()                   # un-choose
`,
    invariants: ['path equals the sequence of choices on the current root→node route', 'after a recursive call returns, state is exactly as before it'],
    mistakes: ['Appending path instead of a copy', 'Forgetting to undo the choice', 'Not sorting + skipping duplicates when input has repeats'],
    complexity: 'Exponential (O(2ⁿ) subsets, O(n!) permutations) × copy cost',
    backend: [
      { title: 'Constraint solving / scheduling', detail: 'Assigning shifts, placing replicas across racks with anti-affinity rules, or config validation explores choices and prunes violations.' },
      { title: 'Feature-flag / test matrix generation', detail: 'Enumerating combinations of flags or parameters for integration tests.' },
    ],
    selfExplain: ['What is a single decision at each level of the tree?', 'What pruning rule cuts the tree, and why is it safe?'],
    distractors: [{ text: '        res.append(path)', why: 'Appends a reference that keeps changing — append a copy (path[:]).' }],
  },
  {
    id: 'graph-traversal',
    name: 'Graph BFS / DFS',
    tagline: 'Visit every reachable node once — flood fill, shortest hops, connectivity.',
    intuition:
      'Grids and adjacency lists are graphs. DFS (stack/recursion) explores deep and is great for "mark the whole component"; BFS (queue) explores in rings and gives shortest paths in unweighted graphs. Multi-source BFS starts from all sources at once. Always mark visited when you enqueue.',
    signals: ['grid of 0/1, islands, regions', '"minimum steps / minutes" with equal costs', 'connected components, reachability', 'transform word/state one step at a time'],
    template: `
from collections import deque
def bfs(sources):
    q = deque(sources)
    seen = set(sources)
    steps = 0
    while q:
        for _ in range(len(q)):
            node = q.popleft()
            for nei in neighbors(node):
                if nei not in seen:
                    seen.add(nei)
                    q.append(nei)
        steps += 1
`,
    invariants: ['each node is enqueued at most once', 'BFS dequeues nodes in non-decreasing distance'],
    mistakes: ['Marking visited on dequeue instead of enqueue (duplicates explode)', 'Out-of-bounds checks in grids', 'Recursion depth on large grids'],
    complexity: 'O(V + E) — O(rows × cols) for grids',
    backend: [
      { title: 'Service dependency impact', detail: 'Which services are affected if X goes down — reachability over the dependency graph.' },
      { title: 'Network / peer discovery', detail: 'Gossip protocols and crawlers expand outward from known nodes.' },
      { title: 'Failure propagation simulations', detail: 'Multi-source BFS models how an outage spreads per minute (like rotting oranges).' },
    ],
    selfExplain: ['Why mark visited on enqueue?', 'When do you choose BFS over DFS here?'],
    distractors: [{ text: '                    q.appendleft(nei)', why: 'Pushing to the front turns BFS into DFS-like order and breaks shortest-distance layering.' }],
  },
  {
    id: 'topo-sort',
    name: 'Topological Sort',
    tagline: 'Order tasks so every prerequisite comes first — or detect a cycle.',
    intuition:
      'Kahn’s algorithm: repeatedly take a node with no remaining prerequisites (in-degree 0), output it, and decrement its dependents. If you cannot output every node, a cycle blocks the rest.',
    signals: ['prerequisites, dependencies, "must happen before"', 'build order / course order', 'detect cycles in a directed graph', 'derive an ordering from pairwise comparisons'],
    template: `
from collections import deque
def topo(n, edges):
    adj = [[] for _ in range(n)]
    indeg = [0] * n
    for a, b in edges:              # a before b
        adj[a].append(b); indeg[b] += 1
    q = deque(i for i in range(n) if indeg[i] == 0)
    order = []
    while q:
        x = q.popleft(); order.append(x)
        for y in adj[x]:
            indeg[y] -= 1
            if indeg[y] == 0: q.append(y)
    return order if len(order) == n else []
`,
    invariants: ['queue holds exactly the nodes whose prerequisites are all done', 'output order respects every edge'],
    mistakes: ['Reversing edge direction', 'Forgetting nodes with no edges', 'Not checking len(order) == n for cycles'],
    complexity: 'O(V + E)',
    backend: [
      { title: 'Build systems & CI pipelines', detail: 'Bazel/Make/GitHub Actions run jobs in dependency order and fail on cycles.' },
      { title: 'DB migrations & service startup', detail: 'Apply migrations / boot services after their dependencies; Terraform plans resource creation order the same way.' },
    ],
    selfExplain: ['What does in-degree 0 mean in plain words?', 'How does the algorithm reveal a cycle?'],
    distractors: [{ text: '        indeg[a] += 1', why: 'The edge a→b means b waits on a — increment indeg[b].' }],
  },
  {
    id: 'union-find',
    name: 'Union-Find (Disjoint Set)',
    tagline: 'Merge groups and ask "same group?" in near O(1).',
    intuition:
      'Every node points toward a representative (root). union(a, b) links the roots; find(x) follows parents (compressing the path). Adding an edge between two nodes that already share a root means the edge creates a cycle.',
    signals: ['dynamic connectivity / number of components', '"redundant edge", detect cycle in undirected graph', 'group accounts / equivalence classes', 'Kruskal MST'],
    template: `
parent = list(range(n))
rank = [1] * n
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]   # path compression
        x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra == rb: return False          # already connected
    if rank[ra] < rank[rb]: ra, rb = rb, ra
    parent[rb] = ra; rank[ra] += rank[rb]
    return True
`,
    invariants: ['two nodes are connected iff find gives the same root', 'components = n − successful unions'],
    mistakes: ['Linking nodes instead of their roots', 'Skipping path compression / union by rank on big inputs', 'Off-by-one with 1-indexed nodes'],
    complexity: 'O(α(n)) amortised per operation',
    backend: [
      { title: 'Account / identity merging', detail: 'Merge user records that share an email or phone into one identity cluster.' },
      { title: 'Network partitions', detail: 'Track which nodes can still talk as links fail/recover; detect redundant links in topologies.' },
    ],
    selfExplain: ['What does it mean when find(a) == find(b) before union?', 'Why does path compression keep trees shallow?'],
    distractors: [{ text: '    parent[a] = b', why: 'Link the ROOTS, not the nodes, or you split existing groups.' }],
  },
  {
    id: 'weighted-graph',
    name: 'Weighted Graphs (Dijkstra / Prim / Bellman-Ford)',
    tagline: 'Greedy with a heap: always expand the cheapest frontier node.',
    intuition:
      'Dijkstra pops the closest unfinished node from a min-heap; its distance is final because all weights are non-negative. Prim is the same loop but keyed by edge cost to the tree. Bellman-Ford relaxes all edges k times to bound the number of hops.',
    signals: ['weighted edges, "minimum cost / time / effort"', 'network delay, cheapest route', 'connect all points cheaply (MST)', 'limit on number of stops → Bellman-Ford'],
    template: `
import heapq
def dijkstra(adj, src):
    dist = {src: 0}
    heap = [(0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, inf): continue
        for v, w in adj[u]:
            if d + w < dist.get(v, inf):
                dist[v] = d + w
                heapq.heappush(heap, (d + w, v))
    return dist
`,
    invariants: ['a node popped for the first time has its final shortest distance', 'heap may hold stale entries — skip them'],
    mistakes: ['Using BFS on weighted edges', 'Not skipping stale heap entries', 'Negative weights with Dijkstra'],
    complexity: 'O(E log V)',
    backend: [
      { title: 'Routing & latency-aware load balancing', detail: 'OSPF routing, service-mesh locality routing and CDNs choose lowest-cost paths.' },
      { title: 'Network design', detail: 'Laying out the cheapest set of links connecting data centers is an MST problem.' },
    ],
    selfExplain: ['Why is the first pop of a node final?', 'Why does a hop limit need Bellman-Ford instead?'],
    distractors: [{ text: '        q.popleft()', why: 'A FIFO queue ignores weights — use a min-heap keyed by distance.' }],
  },
  {
    id: 'dp-1d',
    name: '1-D Dynamic Programming',
    tagline: 'dp[i] from a few earlier answers — recursion with memory.',
    intuition:
      'Define what dp[i] means in words ("best loot from the first i houses"). Write how it depends on smaller i (the recurrence), seed the base cases, then fill left to right. Often only the last one or two values are needed → O(1) space.',
    signals: ['"number of ways", "minimum cost", "maximum value"', 'choices at each index that affect the next ones', 'overlapping subproblems in a recursive solution', 'can/can’t reach / form'],
    template: `
def solve(nums):
    dp = [0] * (len(nums) + 1)
    dp[0] = base
    for i in range(1, len(nums) + 1):
        dp[i] = best(dp[i - 1] + ..., dp[i - 2] + ...)
    return dp[len(nums)]
`,
    invariants: ['dp[j] is final for every j < i when computing dp[i]', 'dp[i] has a precise meaning in words'],
    mistakes: ['Vague dp meaning → wrong recurrence', 'Wrong base case / off-by-one with dp size n+1', 'Iterating in an order where dependencies are not ready'],
    complexity: 'O(n × choices) time, O(n) or O(1) space',
    backend: [
      { title: 'Retry / backoff cost modelling', detail: 'Minimum expected cost of a sequence of decisions (e.g. which batch sizes to use) builds on previous optimal prefixes.' },
      { title: 'Text segmentation', detail: 'Tokenisers and search engines split queries into dictionary words (word break) with DP.' },
    ],
    selfExplain: ['State dp[i] in one plain sentence.', 'Which earlier cells does dp[i] read, and why only those?'],
    distractors: [{ text: '    for i in range(len(nums), 0, -1):', why: 'Filling backwards means dp[i-1] is not computed yet when you need it.' }],
  },
  {
    id: 'dp-2d',
    name: '2-D Dynamic Programming',
    tagline: 'Two changing indices → a table filled in dependency order.',
    intuition:
      'When the state needs two numbers (positions in two strings, row/col, item/capacity), the answers form a grid. Each cell reads neighbours already filled (left, up, diagonal). Draw the table, fill the first row/column, then sweep.',
    signals: ['two strings compared (LCS, edit distance, interleaving)', 'grid paths', 'items × capacity (knapsack, coin change ways)', 'intervals i..j (burst balloons)'],
    template: `
def solve(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    return dp[len(a)][len(b)]
`,
    invariants: ['every cell a cell depends on is filled before it', 'dp[i][j] means the answer for prefixes a[:i], b[:j] (or similar)'],
    mistakes: ['Index shift between dp (1-based) and strings (0-based)', 'Wrong fill order for interval DP', 'Mixing up 0/1 knapsack (iterate capacity backwards) with unbounded'],
    complexity: 'O(m × n) time, O(n) space with rolling rows',
    backend: [
      { title: 'Diffs & fuzzy matching', detail: 'git diff (LCS), spell-check and fuzzy search (edit distance) on product names or log signatures.' },
      { title: 'Resource allocation', detail: 'Knapsack-style choice of which jobs fit a CPU/memory budget.' },
    ],
    selfExplain: ['What do i and j mean for this table?', 'Which three neighbours can a cell read, and what does each represent?'],
    distractors: [{ text: '                dp[i][j] = dp[i][j - 1] + 1', why: 'A match extends the DIAGONAL (both prefixes shrink), not the left cell.' }],
  },
  {
    id: 'greedy',
    name: 'Greedy',
    tagline: 'Take the locally best step — when an exchange argument proves it never hurts.',
    intuition:
      'Greedy keeps one running decision (best sum so far, farthest reachable index, current tank) and never revisits it. It works when you can argue that any optimal solution can be transformed to include the greedy choice.',
    signals: ['"maximum / minimum" with a single pass hint', 'reachability (jump game)', 'circular route feasibility', 'partition into fewest/most groups'],
    template: `
def solve(nums):
    best = cur = nums[0]
    for x in nums[1:]:
        cur = max(x, cur + x)       # drop a negative prefix
        best = max(best, cur)
    return best
`,
    invariants: ['cur is the best answer that ends exactly at the current index', 'best is the best answer seen so far'],
    mistakes: ['Applying greedy without a justification (counter-examples!)', 'Resetting at the wrong moment', 'Forgetting all-negative edge cases'],
    complexity: 'Usually O(n) or O(n log n) with sorting',
    backend: [
      { title: 'Autoscaling & bin packing heuristics', detail: 'Schedulers place pods on the best-fitting node greedily.' },
      { title: 'Circuit breakers on error streaks', detail: 'Kadane-style "worst streak" detection over error deltas.' },
    ],
    selfExplain: ['What local decision do you make, and why can it never hurt?', 'Give an input where a naive greedy would fail.'],
    distractors: [{ text: '        cur = cur + x', why: 'Never dropping a negative running sum keeps a prefix that only makes things worse.' }],
  },
  {
    id: 'intervals',
    name: 'Intervals & Sweep Line',
    tagline: 'Sort by start (or end), then sweep and merge/count overlaps.',
    intuition:
      'Sorting turns a tangle of ranges into a timeline. Walking it, you only compare the current interval with the last kept one. For "how many at once", split into start/end events and sweep a counter (or keep a heap of end times).',
    signals: ['meetings, bookings, ranges [start, end]', 'merge / insert / remove overlaps', 'minimum rooms / maximum concurrency', 'queries asking which interval covers x'],
    template: `
def merge(intervals):
    intervals.sort(key=lambda x: x[0])
    out = [intervals[0]]
    for s, e in intervals[1:]:
        if s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out
`,
    invariants: ['out is sorted and non-overlapping', 'only the last kept interval can overlap the next one'],
    mistakes: ['Forgetting to sort', 'Not taking max of ends when merging (contained intervals)', '< vs <= for touching intervals'],
    complexity: 'O(n log n)',
    backend: [
      { title: 'Calendar & booking services', detail: 'Detect double-bookings and compute free slots across attendees.' },
      { title: 'Capacity planning', detail: 'Max concurrent sessions/connections from login/logout events (meeting rooms II).' },
      { title: 'Log compaction', detail: 'Merge overlapping maintenance windows or byte ranges in storage engines.' },
    ],
    selfExplain: ['Why does sorting by start mean you only compare with the last kept interval?', 'When do you need a heap instead of a counter?'],
    distractors: [{ text: '            out[-1][1] = e', why: 'If the current interval is contained in the last one, e is smaller — take the max.' }],
  },
  {
    id: 'matrix',
    name: 'Matrix Traversal & Transforms',
    tagline: 'Indices are geometry: layers, boundaries, transposes.',
    intuition:
      'Treat the matrix as concentric layers or as boundaries that shrink (top, bottom, left, right). Rotations decompose into transpose + reflect. Use the first row/column as scratch markers for O(1) space.',
    signals: ['rotate / spiral / in-place matrix', 'O(1) extra space on a grid', 'boundaries that shrink'],
    template: `
def spiral(m):
    top, bottom, left, right = 0, len(m), 0, len(m[0])
    res = []
    while top < bottom and left < right:
        for j in range(left, right): res.append(m[top][j])
        top += 1
        for i in range(top, bottom): res.append(m[i][right - 1])
        right -= 1
        if not (top < bottom and left < right): break
        for j in range(right - 1, left - 1, -1): res.append(m[bottom - 1][j])
        bottom -= 1
        for i in range(bottom - 1, top - 1, -1): res.append(m[i][left])
        left += 1
    return res
`,
    invariants: ['unvisited cells are exactly those inside the boundaries', 'each layer is processed once'],
    mistakes: ['Double-counting the last row/column on non-square matrices', 'Overwriting cells before reading them during rotation'],
    complexity: 'O(rows × cols)',
    backend: [
      { title: 'Image & tile processing', detail: 'Thumbnail services rotate/transpose pixel buffers in place.' },
      { title: 'Sharded grids', detail: 'Geo-sharding maps lat/long tiles; matrix walks traverse neighbouring tiles.' },
    ],
    selfExplain: ['Which boundary moves after each side of the spiral?', 'How do transpose + reverse produce a rotation?'],
    distractors: [{ text: '        top -= 1', why: 'Boundaries only move inwards; top increases after the top row is consumed.' }],
  },
  {
    id: 'math',
    name: 'Math & Digits',
    tagline: 'Simulate arithmetic by hand — carries, digits, exponent halving.',
    intuition:
      'Big-number problems are grade-school arithmetic with arrays of digits (carry!). Fast exponentiation squares the base and halves the exponent, using the bits of n.',
    signals: ['digits as arrays/strings', 'huge numbers / no BigInteger', 'power, modular arithmetic', 'cycles in number sequences'],
    template: `
def power(x, n):
    if n < 0: x, n = 1 / x, -n
    res = 1
    while n:
        if n & 1: res *= x
        x *= x
        n >>= 1
    return res
`,
    invariants: ['res × xⁿ equals the original answer at every step'],
    mistakes: ['Forgetting the final carry', 'Negative exponents', 'Integer overflow'],
    complexity: 'O(log n) for power, O(len) for digit arithmetic',
    backend: [
      { title: 'Money & ID arithmetic', detail: 'Payments use integer minor units and arbitrary-precision decimals; snowflake IDs are bit-packed numbers.' },
      { title: 'Crypto & hashing', detail: 'Modular exponentiation is the core of RSA/Diffie-Hellman in TLS.' },
    ],
    selfExplain: ['What invariant does fast power keep?', 'Where does the carry go in digit arithmetic?'],
    distractors: [{ text: '        n -= 1', why: 'Decrementing makes it O(n); halve n to get O(log n).' }],
  },
  {
    id: 'bits',
    name: 'Bit Manipulation',
    tagline: 'XOR cancels pairs, n & (n−1) drops the lowest set bit, shifts walk bits.',
    intuition:
      'Integers are arrays of 32 booleans you can operate on in parallel. XOR is "toggle" (x^x = 0), AND isolates, OR sets, shifts move. Many O(n)-space tricks become O(1).',
    signals: ['"without extra space" + every element appears twice except…', 'count set bits', 'add without + / -', 'subsets as bitmasks'],
    template: `
def count_bits(n):
    count = 0
    while n:
        n &= n - 1          # drop the lowest set bit
        count += 1
    return count
`,
    invariants: ['each iteration removes exactly one set bit'],
    mistakes: ['Sign/infinite loops with negative numbers in Python vs 32-bit', 'Operator precedence (& binds weaker than ==)'],
    complexity: 'O(number of bits)',
    backend: [
      { title: 'Feature flags & permissions', detail: 'Permission sets stored as bitmasks (READ=1, WRITE=2, ADMIN=4) checked with AND.' },
      { title: 'Bloom filters & bitmaps', detail: 'Caches and databases use bitmaps to test membership and dedupe with tiny memory.' },
    ],
    selfExplain: ['Why does XOR of all numbers leave the single one?', 'What does n & (n − 1) do to the binary form?'],
    distractors: [{ text: '        n = n - 1', why: 'Subtracting 1 alone does not drop a set bit; combine with AND.' }],
  },
  {
    id: 'design',
    name: 'Data-Structure Design',
    tagline: 'Combine primitives so every operation hits its complexity target.',
    intuition:
      'Design problems list operations with required costs. Pick a structure per requirement (hash for O(1) lookup, linked list for O(1) reordering, stack for history, heap for min) and keep them consistent on every operation.',
    signals: ['"implement a class with methods…"', 'each operation must be O(1) / O(log n)', 'cache, stack, timeline, encoder'],
    template: `
class Design:
    def __init__(self):
        self.index = {}       # O(1) lookup
        self.order = ...      # O(1) reorder / min / history
    def op(self, key):
        node = self.index[key]
        # update both structures together
`,
    invariants: ['all internal structures always describe the same set of items'],
    mistakes: ['Updating one structure but not the other', 'Hidden O(n) operations (list.remove, list.index)'],
    complexity: 'Per-operation targets (usually O(1) or O(log n))',
    backend: [
      { title: 'Caches & session stores', detail: 'LRU/LFU caches, feed timelines and min-tracking stacks are everyday backend components.' },
      { title: 'Wire protocols', detail: 'Length-prefixed framing (encode/decode strings) is how gRPC/HTTP2/Kafka frame messages.' },
    ],
    selfExplain: ['Which structure satisfies which operation’s cost?', 'What could make the structures drift out of sync?'],
    distractors: [{ text: '        self.items.remove(key)', why: 'list.remove is O(n) — design problems usually need O(1).' }],
  },
];

/** Patterns with their Java / C++ templates attached. */
export const patterns: Pattern[] = basePatterns.map((p) => ({ ...p, langs: patternLangs[p.id] }));

export const patternById = Object.fromEntries(patterns.map((p) => [p.id, p])) as Record<PatternId, Pattern>;
