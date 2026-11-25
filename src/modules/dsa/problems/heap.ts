import type { Problem, Tone, Variant } from '../engine/types.ts';
import { Heap, V, tones } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Heap / Priority Queue — keep "the best k", repeatedly take the extreme, two-heap medians.
// Python's heapq is a min-heap; max-heaps are simulated by pushing negated values. The
// visualizations show the real (positive) values and say which way the heap is ordered.
// ---------------------------------------------------------------------------

const isNumList = (a: unknown, max: number) => Array.isArray(a) && a.length <= max && a.every((x) => typeof x === 'number');
const opLabel = (o: readonly unknown[]) => `${o[0]}(${o.slice(1).join(',')})`;
/** Tone record from [index, tone] pairs; negative indices are skipped (later pairs win). */
function toneAt(...pairs: [number, Tone][]): Record<number, Tone> {
  const r: Record<number, Tone> = {};
  for (const [i, tn] of pairs) if (i >= 0) r[i] = tn;
  return r;
}

/** Deduplicated, numerically sorted options for a predict question; returns [options, answerIndex]. */
function choice(answer: unknown, others: unknown[]): [string[], number] {
  const opts = [...new Set([answer, ...others].map(String))].sort((a, b) => (Number(a) - Number(b)) || (a < b ? -1 : a > b ? 1 : 0));
  return [opts, opts.indexOf(String(answer))];
}

const kthLargestStream: Problem<{ k: number; nums: number[]; ops: [string, number][] }> = {
  id: 'kth-largest-element-in-a-stream',
  num: 703,
  title: 'Kth Largest Element in a Stream',
  difficulty: 'Easy',
  category: 'heap',
  pattern: 'heap',
  statement:
    'Build a class that is created with k and some starting numbers, then receives numbers one at a time via add(val). After every add, return the k-th largest number seen so far.',
  signals: ['"k-th largest"', 'numbers arrive one at a time (stream)', 'only the top k matter', 'repeated queries after each insert'],
  insight:
    'Keep a min-heap holding only the k largest values seen. Its root is the smallest of those k — exactly the k-th largest. A new value either beats the root (it enters, the root leaves) or is irrelevant forever.',
  hints: [
    'Sorting after every add is O(n log n) per call. Which values can never be the answer again?',
    'Anything smaller than the current k-th largest can be thrown away.',
    'A MIN-heap of size k puts the k-th largest at the top.',
  ],
  pitfall: 'Using a max-heap of all values — the k-th largest is then buried k levels deep and memory grows without bound.',
  backend: {
    title: 'Live "top-k slowest requests" panel / p-th percentile alerting',
    detail:
      'An APM agent watches a stream of request latencies and must always know the k-th slowest one (e.g. to alert when the 10th-worst latency exceeds an SLO). A size-k min-heap of latencies keeps exactly the k worst with O(log k) per request and O(k) memory, no matter how many requests flow through.',
  },
  complexity: { time: 'O(log k) per add', space: 'O(k)' },
  code: `
class KthLargest:
    def __init__(self, k, nums):
        self.minHeap, self.k = nums, k           @init
        heapq.heapify(self.minHeap)              @heapify
        while len(self.minHeap) > k:             @trimLoop
            heapq.heappop(self.minHeap)          @trim
    def add(self, val):
        heapq.heappush(self.minHeap, val)        @push
        if len(self.minHeap) > self.k:           @check
            heapq.heappop(self.minHeap)          @pop
        return self.minHeap[0]                   @top
`,
  explain: {
    heapify: 'O(n) to arrange the starting numbers into a min-heap.',
    trim: 'Drop the smallest until only the k largest remain.',
    push: 'Tentatively admit the new value.',
    pop: 'Too many: the smallest of k + 1 values can never be the k-th largest again.',
    top: 'Root of a size-k min-heap = k-th largest overall.',
  },
  distractors: [
    { text: '        heapq.heappush(self.minHeap, -val)', why: 'Negating builds a max-heap; then the root is the LARGEST, not the k-th largest.' },
    { text: '        if len(self.minHeap) >= self.k:', why: 'Pops when the heap has exactly k values, leaving only k − 1 — the root is then the (k−1)-th largest.' },
    { text: '        return max(self.minHeap)', why: 'max is the largest of the kept values, not the k-th largest (and it is O(k)).' },
  ],
  input: {
    k: 3,
    nums: [4, 5, 8, 2],
    ops: [
      ['add', 3],
      ['add', 5],
      ['add', 10],
      ['add', 9],
      ['add', 4],
    ],
  },
  presets: [
    { label: 'starts short of k', input: { k: 2, nums: [1], ops: [['add', 3], ['add', 0], ['add', 5]] } },
    { label: 'k = 1 (running max)', input: { k: 1, nums: [], ops: [['add', -3], ['add', 2], ['add', 1]] } },
  ],
  validate: ({ k, nums, ops }) => {
    if (typeof k !== 'number' || k < 1 || k > 6) return 'k must be 1–6';
    if (!isNumList(nums, 8)) return 'nums: ≤ 8 numbers';
    if (!Array.isArray(ops) || ops.length < 1 || ops.length > 8) return '1–8 ops like ["add", 3]';
    if (ops.some((o) => !Array.isArray(o) || o[0] !== 'add' || typeof o[1] !== 'number')) return 'Each op is ["add", number]';
    if (nums.length + 1 < k) return 'Need at least k − 1 starting numbers so the first add has an answer';
    return null;
  },
  trace(t, { k, nums, ops }) {
    const heap = new Heap<number>();
    const out: number[] = [];
    let opIdx = -1;
    let hot: number | null = null;
    let gone: number | null = null;
    t.draw(() => [
      V.array('ops', ops.map(opLabel), { pointers: { op: opIdx }, tones: opIdx >= 0 && opIdx < ops.length ? { [opIdx]: 'active' } : {}, showIndex: false }),
      V.heap(`minHeap (the ${k} largest so far)`, heap.data, {
        tones: toneAt([heap.size === k ? 0 : -1, 'good'], [hot !== null ? heap.data.indexOf(hot) : -1, 'active']),
        caption: heap.size === k ? 'root = k-th largest' : `holds ${heap.size} < k values`,
      }),
      gone !== null && V.chips('just discarded', [gone], { tones: { 0: 'muted' } }),
      V.chips('returned', out),
    ]);
    t.step('init', `Start from nums = [${nums.join(', ')}], k = ${k}.`, { k });
    for (const n of nums) heap.push(n);
    t.step('heapify', `heapify arranges them so the smallest is at the root (index 0).`, { size: heap.size });
    while (heap.size > k) {
      t.step('trimLoop', `${heap.size} values but we only keep ${k}.`, { size: heap.size });
      gone = heap.pop()!;
      t.step('trim', `Pop the smallest (${gone}); it can never be the ${k}-th largest.`, { size: heap.size });
    }
    t.step('trimLoop', `Heap holds the ${k} largest starting values (or fewer).`, { size: heap.size });
    gone = null;
    let askedPop = false;
    let askedTop = false;
    for (opIdx = 0; opIdx < ops.length; opIdx++) {
      const val = ops[opIdx][1];
      gone = null;
      heap.push(val);
      hot = val;
      t.step('push', `add(${val}): push ${val}; it sifts up to its place.`, { val, size: heap.size });
      const over = heap.size > k;
      t.step('check', `size ${heap.size} ${over ? '>' : '≤'} k = ${k}.`, { size: heap.size, k });
      if (over && !askedPop) {
        askedPop = true;
        const root = heap.peek()!;
        const [o, a] = choice(root, [val, Math.max(...heap.data)]);
        t.predict('Which value gets popped?', o, a, `heappop always removes the root = smallest of the ${k + 1} values (${root}).`);
      }
      if (over) {
        gone = heap.pop()!;
        hot = null;
        t.step('pop', `Pop ${gone}: the smallest of ${k + 1} values is not among the top ${k}.`, { popped: gone, size: heap.size });
      }
      if (!askedTop && opIdx >= 1 && heap.size === k) {
        askedTop = true;
        const [o, a] = choice(heap.peek(), [Math.max(...heap.data), val]);
        t.predict(`What does add(${val}) return?`, o, a, `The root of the size-${k} min-heap is the ${k}-th largest.`);
      }
      out.push(heap.peek()!);
      t.step('top', `Return minHeap[0] = ${heap.peek()}.`, { result: heap.peek() });
    }
    opIdx = ops.length;
    hot = null;
    gone = null;
    t.step(null, `Done. Returned: ${out.join(', ')}.`, {});
    return out;
  },
};

const lastStoneWeight: Problem<{ stones: number[] }> = {
  id: 'last-stone-weight',
  num: 1046,
  title: 'Last Stone Weight',
  difficulty: 'Easy',
  category: 'heap',
  pattern: 'heap',
  statement:
    'Repeatedly take the two heaviest stones and smash them: equal weights both disappear, otherwise the heavier one survives with the difference as its new weight. Return the last stone\'s weight, or 0 if none remain.',
  signals: ['"repeatedly take the two largest"', 'results are put back into the pool', 'the max changes after every step', 'simulation'],
  insight: 'A max-heap gives the two heaviest in O(log n) each and absorbs the leftover stone back in O(log n); re-sorting every round would cost O(n log n) per round.',
  hints: [
    'Sorting once is not enough — the new stone can land anywhere.',
    'You need "remove max" and "insert" over and over: that is a priority queue.',
    'Python only has a min-heap: store negative weights.',
  ],
  pitfall: 'Forgetting the negation trick (or un-negating) — heapq then hands you the LIGHTEST stones.',
  backend: {
    title: 'Merging the two largest segments first (compaction / Huffman-style)',
    detail:
      'Storage engines and log compactors repeatedly pick the largest (or smallest) segments to merge and push the merged result back as a new candidate. A heap keyed by segment size makes "pick the top two, push the result" O(log n) per merge — the same loop as building a Huffman code.',
  },
  complexity: { time: 'O(n log n)', space: 'O(n)' },
  code: `
def lastStoneWeight(stones):
    stones = [-s for s in stones]              @negate
    heapq.heapify(stones)                      @heapify
    while len(stones) > 1:                     @loop
        first = heapq.heappop(stones)          @pop1
        second = heapq.heappop(stones)         @pop2
        if second > first:                     @cmp
            heapq.heappush(stones, first - second)   @push
    stones.append(0)                           @pad
    return abs(stones[0])                      @done
`,
  explain: {
    negate: 'heapq is a min-heap; negating makes the heaviest stone the "smallest" number.',
    pop1: 'Heaviest stone (most negative).',
    cmp: 'In negatives: second > first means |second| < |first| — weights differ.',
    push: 'first − second is negative: the survivor\'s (negated) weight.',
    pad: 'If the heap is empty, the answer is 0.',
  },
  distractors: [
    { text: '    stones.sort(reverse=True)', why: 'A one-time sort does not stay sorted after the leftover stone is put back.' },
    { text: '            heapq.heappush(stones, second - first)', why: 'second − first is positive; in a negated heap that would be treated as a tiny stone.' },
    { text: '    while stones:', why: 'With one stone left there is nothing to smash; popping a second stone from an empty heap crashes.' },
  ],
  input: { stones: [2, 7, 4, 1, 8, 1] },
  presets: [
    { label: 'all cancel', input: { stones: [3, 3] } },
    { label: 'single stone', input: { stones: [5] } },
  ],
  validate: ({ stones }) =>
    !isNumList(stones, 10) || !stones.length ? 'Expected { stones: number[] } with 1–10 weights' : stones.some((s) => s < 1) ? 'Weights must be ≥ 1' : null,
  trace(t, { stones }) {
    const heap = new Heap<number>((a, b) => a > b);
    let y: number | null = null;
    let x: number | null = null;
    const log: string[] = [];
    t.draw(() => [
      V.heap('maxHeap (weights; stored negated in Python)', heap.data, { tones: heap.size ? { 0: 'active' } : {} }),
      V.chips('smashed', [y, x].filter((v) => v !== null), { tones: tones([0, 1], 'warn') }),
      V.chips('history', log),
    ]);
    t.step('negate', `Negate weights so Python's min-heap behaves like a max-heap.`, { stones });
    for (const s of stones) heap.push(s);
    t.step('heapify', `Heapify: the heaviest stone (${heap.peek()}) is at the root.`, { size: heap.size });
    let round = 0;
    while (heap.size > 1) {
      t.step('loop', `${heap.size} stones — keep smashing.`, { size: heap.size });
      y = heap.pop()!;
      t.step('pop1', `Pop the heaviest: ${y}.`, { first: y });
      x = heap.pop()!;
      t.step('pop2', `Pop the next heaviest: ${x}.`, { first: y, second: x });
      if (round === 0) t.predict(`Smash ${y} and ${x}. What is pushed back?`, ['nothing', String(y - x), String(y + x)], y === x ? 0 : 1, y === x ? 'Equal stones destroy each other.' : `The heavier one survives with ${y} − ${x} = ${y - x}.`);
      const diff = y - x;
      t.step('cmp', diff ? `${y} ≠ ${x}, so a stone of ${diff} survives.` : `${y} = ${x}: both are destroyed.`, { first: y, second: x });
      if (diff) {
        heap.push(diff);
        log.push(`${y}-${x}→${diff}`);
        t.step('push', `Push ${diff} back; it sifts to its place.`, { pushed: diff, size: heap.size });
      } else log.push(`${y}-${x}→0`);
      y = x = null;
      round++;
    }
    t.step('loop', heap.size ? 'Only one stone left.' : 'No stones left.', { size: heap.size });
    const [ro, ra] = choice(heap.peek() ?? 0, [0, Math.max(...stones)]);
    t.predict('What is returned?', ro, ra, heap.size ? `The last stone weighs ${heap.peek()}.` : 'The padded 0 is returned when nothing is left.');
    t.step('pad', 'Append 0 so an empty heap still has an answer at index 0.', {});
    const res = heap.peek() ?? 0;
    t.step('done', `Return ${res}.`, { result: res });
    return res;
  },
};

const kClosest: Problem<{ points: [number, number][]; k: number }> = {
  id: 'k-closest-points-to-origin',
  num: 973,
  title: 'K Closest Points to Origin',
  difficulty: 'Medium',
  category: 'heap',
  pattern: 'heap',
  statement: 'Given points on a plane and k, return the k points nearest to (0, 0) by Euclidean distance, in any order.',
  signals: ['"k closest" / "k smallest"', 'order inside the answer does not matter', 'n can be much larger than k', 'distance can be compared squared'],
  insight:
    'Scan the points once while keeping a MAX-heap of the k closest so far. The root is the farthest of the kept points, so whenever the heap grows past k you pop the root — the worst candidate. Squared distances avoid sqrt.',
  hints: [
    'Sorting everything is O(n log n). Do you need the far points sorted?',
    'Keep only k candidates; which one should be kicked out when a new one arrives?',
    'A max-heap (negated distance in Python) exposes the farthest kept point at the root.',
  ],
  pitfall: 'Using a min-heap of size k — popping its root throws away the CLOSEST point.',
  backend: {
    title: 'Nearest drivers / edge servers for a request',
    detail:
      'A ride-hailing dispatcher (or a geo-DNS picking edge PoPs) scans candidate drivers and keeps the k nearest to the rider. A size-k max-heap keyed by squared distance means each candidate costs O(log k), and the farthest kept driver is instantly replaceable — no need to sort the whole fleet.',
  },
  complexity: { time: 'O(n log k)', space: 'O(k)' },
  code: `
def kClosest(points, k):
    maxHeap = []                                   @init
    for x, y in points:                            @loop
        dist = x * x + y * y                       @dist
        heapq.heappush(maxHeap, (-dist, x, y))     @push
        if len(maxHeap) > k:                       @check
            heapq.heappop(maxHeap)                 @evict
    return [[x, y] for _, x, y in maxHeap]         @done
`,
  explain: {
    dist: 'Squared distance preserves the order and avoids sqrt.',
    push: 'Negated distance turns heapq into a max-heap: the farthest point is the root.',
    evict: 'k + 1 candidates: drop the farthest one.',
  },
  distractors: [
    { text: '        heapq.heappush(maxHeap, (dist, x, y))', why: 'Without negation the root is the CLOSEST point, so evicting the root throws away the best answer.' },
    { text: '        dist = abs(x) + abs(y)', why: 'Manhattan distance orders points differently from Euclidean distance (e.g. (3,0) vs (2,2)).' },
    { text: '        if len(maxHeap) >= k:', why: 'Evicts when the heap has exactly k points, so only k − 1 survive.' },
  ],
  input: {
    points: [
      [1, 3],
      [-2, 2],
      [5, 8],
      [0, 1],
      [3, -3],
    ],
    k: 2,
  },
  presets: [
    { label: 'k = all points', input: { points: [[3, 3], [5, -1], [-2, 4]], k: 3 } },
    { label: 'k = 1', input: { points: [[2, 2], [1, 0], [0, -2]], k: 1 } },
  ],
  validate: ({ points, k }) => {
    if (!Array.isArray(points) || !points.length || points.length > 8) return 'Expected 1–8 points';
    if (points.some((p) => !isNumList(p, 2) || p.length !== 2)) return 'Each point is [x, y]';
    return typeof k !== 'number' || k < 1 || k > points.length ? 'k must be between 1 and the number of points' : null;
  },
  trace(t, { points, k }) {
    type E = [number, number, number];
    const heap = new Heap<E>((a, b) => a[0] > b[0]);
    const lbl = (e: E) => `d${e[0]} (${e[1]},${e[2]})`;
    let i = -1;
    const evicted = new Set<number>();
    const kept = new Set<number>();
    const idxOf = new Map<E, number>();
    t.draw(() => [
      V.array('points', points.map(([x, y]) => `(${x},${y})`), {
        pointers: { i },
        tones: { ...tones([...kept], 'good'), ...tones([...evicted], 'muted'), ...(i >= 0 && i < points.length ? { [i]: 'active' as Tone } : {}) },
      }),
      V.heap(`maxHeap by distance² (size ≤ ${k})`, heap.data.map(lbl), { tones: heap.size ? { 0: 'warn' } : {}, caption: 'root = farthest kept point' }),
    ]);
    t.step('init', `Empty max-heap; it will hold at most k = ${k} candidates.`, { k });
    let askedEvict = false;
    let askedSurvive = false;
    for (i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      t.step('loop', `Point (${x}, ${y}).`, { x, y });
      const dist = x * x + y * y;
      t.step('dist', `dist² = ${x}² + ${y}² = ${dist}.`, { x, y, dist });
      if (!askedSurvive && askedEvict && heap.size === k) {
        askedSurvive = true;
        const far = heap.peek()!;
        t.predict(`The farthest kept point has d² = ${far[0]}. After pushing (${x},${y}) with d² = ${dist}, which point gets evicted?`, [`(${far[1]},${far[2]})`, `(${x},${y})`], dist >= far[0] ? 1 : 0, dist >= far[0] ? 'The new point is the farthest of the k + 1, so it lands on the root and is popped right away.' : 'The new point is closer, so the old root (farthest) is popped.');
      }
      const e: E = [dist, x, y];
      idxOf.set(e, i);
      heap.push(e);
      kept.add(i);
      t.step('push', `Push (d²=${dist}). If it is the farthest kept point it rises to the root.`, { dist, size: heap.size });
      const over = heap.size > k;
      t.step('check', `size ${heap.size} ${over ? '> k — one candidate too many' : '≤ k — keep everything'}.`, { size: heap.size, k });
      if (over) {
        if (!askedEvict) {
          askedEvict = true;
          t.predict('Which point is popped?', ['the closest kept point', 'the farthest kept point (root)', 'the newest point'], 1, 'The root of a max-heap is the largest distance — the worst candidate.');
        }
        const out = heap.pop()!;
        const j = idxOf.get(out)!;
        kept.delete(j);
        evicted.add(j);
        t.step('evict', `Evict (${out[1]},${out[2]}) with d² = ${out[0]}: it is farther than the ${k} we keep.`, { evicted: `(${out[1]},${out[2]})` });
      }
    }
    i = points.length;
    const res = heap.data.map((e) => [e[1], e[2]]);
    t.step('done', `The heap holds the ${k} closest points.`, { result: res });
    return res;
  },
};

const kthLargestArray: Problem<{ nums: number[]; k: number }> = {
  id: 'kth-largest-element-in-an-array',
  num: 215,
  title: 'Kth Largest Element in an Array',
  difficulty: 'Medium',
  category: 'heap',
  pattern: 'heap',
  statement: 'Return the k-th largest value of an unsorted array (by sorted position, so duplicates count separately). Aim to beat a full sort.',
  signals: ['"k-th largest"', 'unsorted input', 'better than O(n log n) hinted', 'k is often much smaller than n'],
  insight:
    'Stream the array through a min-heap capped at size k. Whatever falls out of the bottom is smaller than k other values, so it cannot be the answer; at the end the root is the k-th largest. (Quickselect is the O(n)-average alternative.)',
  hints: [
    'You only care about the k biggest values. What is the smallest of those?',
    'Keep a min-heap of at most k elements; pop when it overflows.',
    'After the scan, heap[0] is the answer.',
  ],
  pitfall: 'Building a max-heap of everything and popping k times works but is O(n + k log n) memory-heavy; popping from a min-heap of size k is the streaming-friendly version — and mixing the two directions gives the k-th SMALLEST.',
  backend: {
    title: 'Threshold for the top-k scores in a batch job',
    detail:
      'A nightly ranking job over millions of documents needs the score of the 1000-th best document (to set a cut-off for a search index tier). Streaming scores through a size-1000 min-heap uses constant memory and one pass over the data — no global sort of the whole corpus.',
  },
  complexity: { time: 'O(n log k)', space: 'O(k)' },
  code: `
def findKthLargest(nums, k):
    heap = []                              @init
    for n in nums:                         @loop
        heapq.heappush(heap, n)            @push
        if len(heap) > k:                  @check
            heapq.heappop(heap)            @pop
    return heap[0]                         @done
`,
  explain: {
    push: 'Every value gets a chance to enter the top k.',
    pop: 'The smallest of k + 1 values has k values above it — it is out for good.',
    done: 'Root of the size-k min-heap = smallest of the k largest = k-th largest.',
  },
  distractors: [
    { text: '    return heap[-1]', why: 'The last array slot of a heap is not the maximum or minimum — only index 0 has a guaranteed meaning.' },
    { text: '        heapq.heappush(heap, -n)', why: 'Negating makes a max-heap; popping it discards the LARGEST values and returns the k-th smallest.' },
    { text: '    return sorted(nums)[k]', why: 'Ascending order and 0-based indexing: this is the (k+1)-th smallest. It would be sorted(nums)[-k], at O(n log n).' },
  ],
  input: { nums: [3, 2, 1, 5, 6, 4], k: 2 },
  presets: [
    { label: 'duplicates', input: { nums: [3, 2, 3, 1, 2, 4, 5, 5, 6], k: 4 } },
    { label: 'k = n (minimum)', input: { nums: [7, 1, 4], k: 3 } },
  ],
  validate: ({ nums, k }) =>
    !isNumList(nums, 12) || !nums.length ? 'Expected { nums: number[] } with 1–12 values' : typeof k !== 'number' || k < 1 || k > nums.length ? 'k must be between 1 and len(nums)' : null,
  trace(t, { nums, k }) {
    const heap = new Heap<number>();
    let i = -1;
    const out: number[] = [];
    t.draw(() => [
      V.array('nums', nums, { pointers: { i }, tones: i >= 0 && i < nums.length ? { [i]: 'active' } : {} }),
      V.heap(`minHeap (size ≤ ${k})`, heap.data, { tones: heap.size === k ? { 0: 'good' } : {}, caption: 'root = smallest of the kept values' }),
      V.chips('popped (can never be the answer)', out, { tones: tones(out.map((_, j) => j), 'muted') }),
    ]);
    t.step('init', `Empty min-heap; it will keep the ${k} largest values seen.`, { k });
    let asked = 0;
    for (i = 0; i < nums.length; i++) {
      const n = nums[i];
      t.step('loop', `Next value: ${n}.`, { n });
      heap.push(n);
      t.step('push', `Push ${n}.`, { n, size: heap.size });
      const over = heap.size > k;
      t.step('check', `size ${heap.size} ${over ? `> ${k}: one too many` : `≤ ${k}`}.`, { size: heap.size });
      if (over) {
        if (asked === 0) {
          asked++;
          const [o, a] = choice(heap.peek(), [n, Math.max(...heap.data)]);
          t.predict('Which value is popped?', o, a, `The min-heap root (${heap.peek()}) is the smallest of the ${k + 1} values.`);
        }
        out.push(heap.pop()!);
        t.step('pop', `Pop ${out[out.length - 1]} — at least ${k} values beat it.`, { popped: out[out.length - 1] });
      }
    }
    i = nums.length;
    const [o, a] = choice(heap.peek(), [Math.max(...heap.data), out[out.length - 1] ?? Math.min(...nums)]);
    t.predict(`Scan finished. What is the ${k}-th largest?`, o, a, `heap[0] = ${heap.peek()}: the smallest of the ${k} largest values.`);
    t.step('done', `Return heap[0] = ${heap.peek()}.`, { result: heap.peek() });
    return heap.peek();
  },
};

const taskScheduler: Problem<{ tasks: string[]; n: number }> = {
  id: 'task-scheduler',
  num: 621,
  title: 'Task Scheduler',
  difficulty: 'Medium',
  category: 'heap',
  pattern: 'heap',
  statement:
    'A CPU runs one task per time unit; tasks are letters and may repeat. Two runs of the same letter must be at least n units apart (the CPU may idle). Return the minimum total time to run every task.',
  signals: ['cooldown between identical tasks', '"minimum time / intervals"', 'always want the most frequent remaining task', 'greedy simulation with waiting items'],
  insight:
    'Greedy: at each tick run the task with the most copies left (max-heap of counts), because it is the one most likely to force idles later. A task that just ran waits in a FIFO queue with the time it becomes available again, then returns to the heap.',
  hints: [
    'Which task is the riskiest to postpone?',
    'Track "count left" for each task in a max-heap; after running one, it cannot run for n ticks.',
    'Put it in a queue as (count, readyTime); move it back to the heap when time == readyTime.',
  ],
  pitfall: 'Pushing a task back into the heap immediately after running it — that ignores the cooldown and undercounts idle time.',
  backend: {
    title: 'Per-tenant rate-limited job dispatch',
    detail:
      'A job dispatcher must not hit the same downstream tenant (or the same API key) more than once per n seconds. It keeps runnable tenants in a max-heap by backlog size and parks a tenant in a cooldown queue with its next-allowed time after dispatching — exactly this heap + queue loop, which also tells you how many idle slots the rate limit costs.',
  },
  complexity: { time: 'O(T · log 26)', space: 'O(26)' },
  code: `
def leastInterval(tasks, n):
    count = Counter(tasks)                          @count
    maxHeap = [-cnt for cnt in count.values()]      @build
    heapq.heapify(maxHeap)                          @heapify
    time, q = 0, deque()   # [-cnt, readyTime]      @init
    while maxHeap or q:                             @loop
        time += 1                                   @tick
        if maxHeap:                                 @has
            cnt = 1 + heapq.heappop(maxHeap)        @run
            if cnt:                                 @left
                q.append([cnt, time + n])           @cool
        if q and q[0][1] == time:                   @ready
            heapq.heappush(maxHeap, q.popleft()[0]) @back
    return time                                     @done
`,
  explain: {
    build: 'Only counts matter, not letters; negated for a max-heap.',
    tick: 'Every loop iteration is one unit of CPU time (busy or idle).',
    run: 'Run the task with the most copies left (count goes down by one: −3 + 1 = −2).',
    cool: 'It may run again at time + n; until then it waits in FIFO order.',
    ready: 'Cooldowns are pushed in time order, so only the front of the queue can be ready.',
    back: 'Cooldown over — eligible to run again.',
  },
  distractors: [
    { text: '                heapq.heappush(maxHeap, cnt)', why: 'Skips the cooldown: the same task could run on the very next tick.' },
    { text: '                q.append([cnt, time + n + 1])', why: 'Off by one: a task that ran at time t may run again at t + n + 1, which is the tick AFTER readyTime = t + n is processed.' },
    { text: '    while maxHeap:', why: 'Stops while tasks are still cooling down in the queue, so their remaining runs (and idles) are never counted.' },
  ],
  input: { tasks: ['A', 'A', 'A', 'B', 'B', 'B'], n: 2 },
  presets: [
    { label: 'no cooldown', input: { tasks: ['A', 'A', 'B', 'C'], n: 0 } },
    { label: 'one dominant task', input: { tasks: ['A', 'A', 'A', 'B', 'C'], n: 2 } },
  ],
  validate: ({ tasks, n }) => {
    if (!Array.isArray(tasks) || !tasks.length || tasks.length > 12) return 'Expected 1–12 tasks';
    if (tasks.some((x) => typeof x !== 'string' || !/^[A-Z]$/.test(x))) return 'Tasks are single uppercase letters';
    return typeof n !== 'number' || n < 0 || n > 4 ? 'n must be 0–4' : null;
  },
  trace(t, { tasks, n }) {
    type E = { task: string; cnt: number };
    type Q = { task: string; cnt: number; ready: number };
    const count = new Map<string, number>();
    const heap = new Heap<E>((a, b) => a.cnt > b.cnt || (a.cnt === b.cnt && a.task < b.task));
    const q: Q[] = [];
    const timeline: string[] = [];
    let time = 0;
    t.draw(() => [
      V.map('count', count),
      V.heap('maxHeap (runnable, most copies left on top)', heap.data.map((e) => `${e.task}×${e.cnt}`), { tones: heap.size ? { 0: 'active' } : {} }),
      V.queue('cooldown queue (count, readyTime)', q.map((e) => `${e.task}×${e.cnt} @${e.ready}`), { tones: q.length && q[0].ready === time ? { 0: 'good' } : {} }),
      V.chips(`timeline (t = ${time})`, timeline, { tones: Object.fromEntries(timeline.map((x, j) => [j, x === 'idle' ? 'muted' : 'info'])) as Record<number, Tone> }),
    ]);
    for (const x of tasks) count.set(x, (count.get(x) ?? 0) + 1);
    t.step('count', `Count each task: ${[...count].map(([k, v]) => `${k}×${v}`).join(', ')}.`, {});
    for (const [task, cnt] of count) heap.push({ task, cnt });
    t.step('build', 'Only the counts matter. Put them in a max-heap (negated in Python).', {});
    t.step('heapify', `Heapify: ${heap.peek()!.task} (${heap.peek()!.cnt} copies) is on top.`, {});
    t.step('init', `time = 0, cooldown queue empty, n = ${n}.`, { time, n });
    let askedRun = false;
    let askedIdle = false;
    let askedReady = false;
    while (heap.size || q.length) {
      t.step('loop', `${heap.size} runnable, ${q.length} cooling down.`, { time });
      time++;
      t.step('tick', `Tick ${time}.`, { time });
      if (!askedIdle && !heap.size) {
        askedIdle = true;
        t.predict(`Tick ${time}: nothing is runnable. What does the CPU do?`, ['Runs the front of the cooldown queue', 'Idles'], 1, `The front task is only ready at ${q[0].ready}; waiting tasks cannot run early.`);
      }
      if (heap.size) {
        t.step('has', 'Something is runnable.', { time });
        if (!askedRun) {
          askedRun = true;
          const opts = [...new Set(heap.data.map((e) => e.task))].sort();
          t.predict('Which task runs now?', opts, opts.indexOf(heap.peek()!.task), 'The heap root: the task with the most copies left (ties broken alphabetically here).');
        }
        const e = heap.pop()!;
        const left = e.cnt - 1;
        timeline.push(e.task);
        t.step('run', `Run ${e.task}; ${left} cop${left === 1 ? 'y' : 'ies'} left.`, { time, task: e.task, cnt: left });
        t.step('left', left ? `${e.task} still has work.` : `${e.task} is finished — it never returns.`, { cnt: left });
        if (left) {
          q.push({ task: e.task, cnt: left, ready: time + n });
          t.step('cool', `${e.task} cools down until time ${time + n}.`, { time, readyTime: time + n });
        }
      } else {
        timeline.push('idle');
        t.step('has', `Heap empty — tick ${time} is idle.`, { time });
      }
      const ready = q.length > 0 && q[0].ready === time;
      if (!askedReady && q.length && n > 0) {
        if (ready) {
          askedReady = true;
          t.predict(`time = ${time}. Does ${q[0].task} come off cooldown now?`, ['Yes', 'No'], 0, `Its readyTime is ${q[0].ready} = time, so it can run from the next tick.`);
        }
      }
      t.step('ready', ready ? `Front of queue (${q[0].task}) is ready at ${time}.` : q.length ? `Front of queue (${q[0].task}) is ready at ${q[0].ready}, not yet.` : 'Nothing cooling down.', { time });
      if (ready) {
        const e = q.shift()!;
        heap.push({ task: e.task, cnt: e.cnt });
        t.step('back', `${e.task}×${e.cnt} goes back into the heap.`, { time });
      }
    }
    t.step('loop', 'Heap and queue are both empty — every task ran.', { time });
    t.step('done', `Return time = ${time} (${timeline.filter((x) => x === 'idle').length} idle).`, { result: time });
    return time;
  },
};

type TwOp = ['postTweet', number, number] | ['getNewsFeed', number] | ['follow', number, number] | ['unfollow', number, number];

const designTwitter: Problem<{ ops: TwOp[] }> = {
  id: 'design-twitter',
  num: 355,
  title: 'Design Twitter',
  difficulty: 'Medium',
  category: 'heap',
  pattern: 'heap',
  statement:
    'Design a mini Twitter: postTweet(userId, tweetId), follow(a, b), unfollow(a, b), and getNewsFeed(userId), which returns the 10 most recent tweet ids posted by the user or anyone they follow, newest first.',
  signals: ['merge several per-user lists that are each already in time order', '"10 most recent" = top k across lists', 'many lists, few items needed'],
  insight:
    'Each user\'s tweets are already sorted by time. The feed is a k-way merge: seed a heap with the newest tweet of every followee, pop the newest overall, and push that same user\'s next-older tweet. Stop after 10 pops — you never touch older tweets.',
  hints: [
    'Store tweets per user with a global, increasing timestamp.',
    'Getting the newest across several sorted lists is the "merge k sorted lists" problem.',
    'A heap entry needs (time, tweetId, userId, index of the next-older tweet).',
  ],
  pitfall: 'Concatenating every followee\'s full history and sorting it — O(total tweets · log) per feed call, even though only 10 are needed.',
  backend: {
    title: 'Fan-in timelines (pull model)',
    detail:
      'Social feeds, activity streams and "recent changes across my repositories" pages read the newest N events from many per-source logs that are each time-ordered (e.g. per-user partitions or Cassandra rows clustered by time). A heap-based k-way merge reads only about N + k rows instead of scanning every source fully.',
  },
  complexity: { time: 'O(f log f) per feed (f = followees, 10 pops)', space: 'O(f)' },
  code: `
class Twitter:
    def __init__(self):
        self.count = 0                                    @init
        self.tweetMap = defaultdict(list)  # uid -> [[count, tweetId]]
        self.followMap = defaultdict(set)  # uid -> followees
    def postTweet(self, userId, tweetId):
        self.tweetMap[userId].append([self.count, tweetId]) @post
        self.count -= 1                                   @tick
    def getNewsFeed(self, userId):
        res, minHeap = [], []                             @feed
        self.followMap[userId].add(userId)                @self
        for f in self.followMap[userId]:                  @seed
            if f in self.tweetMap:                        @hasTweets
                index = len(self.tweetMap[f]) - 1         @latest
                count, tweetId = self.tweetMap[f][index]
                heapq.heappush(minHeap, [count, tweetId, f, index - 1]) @seedPush
        while minHeap and len(res) < 10:                  @loop
            count, tweetId, f, index = heapq.heappop(minHeap) @pop
            res.append(tweetId)                           @take
            if index >= 0:                                @more
                count, tweetId = self.tweetMap[f][index]  @older
                heapq.heappush(minHeap, [count, tweetId, f, index - 1]) @next
        return res                                        @ret
    def follow(self, followerId, followeeId):
        self.followMap[followerId].add(followeeId)        @follow
    def unfollow(self, followerId, followeeId):
        self.followMap[followerId].discard(followeeId)    @unfollow
`,
  explain: {
    tick: 'count goes DOWN, so newer tweets have smaller counts and the MIN-heap pops the newest first.',
    seedPush: 'One entry per followee: their newest tweet, plus where their next-older tweet lives.',
    pop: 'Newest tweet among all candidates.',
    next: 'Replace the popped tweet with the same author\'s next-older one — the heap always holds at most one tweet per followee.',
    loop: 'At most 10 pops, no matter how long the histories are.',
  },
  distractors: [
    { text: '        self.count += 1', why: 'With increasing counts the min-heap pops the OLDEST tweet first (unless you also negate).' },
    { text: '                heapq.heappush(minHeap, [count, tweetId, f, index + 1])', why: 'index + 1 walks toward newer tweets and runs off the end of the list.' },
    { text: '        while minHeap:', why: 'Without the len(res) < 10 cap it merges every tweet of every followee.' },
  ],
  input: {
    ops: [
      ['postTweet', 1, 5],
      ['postTweet', 2, 6],
      ['postTweet', 1, 7],
      ['follow', 1, 2],
      ['postTweet', 2, 8],
      ['getNewsFeed', 1],
      ['unfollow', 1, 2],
      ['getNewsFeed', 1],
    ],
  },
  presets: [
    {
      label: 'three authors',
      input: {
        ops: [
          ['postTweet', 2, 1],
          ['postTweet', 3, 2],
          ['postTweet', 2, 3],
          ['postTweet', 3, 4],
          ['follow', 1, 2],
          ['follow', 1, 3],
          ['postTweet', 1, 9],
          ['getNewsFeed', 1],
        ],
      },
    },
    { label: 'follows nobody', input: { ops: [['postTweet', 1, 3], ['postTweet', 2, 4], ['getNewsFeed', 1]] } },
  ],
  validate: ({ ops }) => {
    if (!Array.isArray(ops) || !ops.length || ops.length > 12) return '1–12 ops';
    for (const o of ops) {
      if (!Array.isArray(o) || !o.slice(1).every((x) => typeof x === 'number')) return 'Each op is ["name", numbers...]';
      const arity = { postTweet: 3, getNewsFeed: 2, follow: 3, unfollow: 3 }[o[0] as string];
      if (arity === undefined || o.length !== arity) return `Unknown op or wrong argument count: ${JSON.stringify(o)}`;
    }
    return null;
  },
  trace(t, { ops }) {
    type Entry = [number, number, number, number];
    let count = 0;
    const tweetMap = new Map<number, [number, number][]>();
    const followMap = new Map<number, Set<number>>();
    const heap = new Heap<Entry>((a, b) => a[0] < b[0]);
    let res: number[] | null = null;
    let opIdx = -1;
    let who: number | null = null;
    const outs: string[] = [];
    t.draw(() => [
      V.array('ops', ops.map(opLabel), { pointers: { op: opIdx }, tones: opIdx >= 0 && opIdx < ops.length ? { [opIdx]: 'active' } : {}, showIndex: false }),
      V.map('tweetMap (uid → [count, tweetId] …, oldest first)', [...tweetMap].map(([u, l]): [number, string] => [u, l.map(([c, id]) => `t${id}@${c}`).join(' ')]), { hl: who !== null ? [who] : [] }),
      V.map('followMap', [...followMap].map(([u, s]): [number, string] => [u, `{${[...s].join(', ')}}`]), { hl: who !== null ? [who] : [] }),
      res !== null && V.heap('minHeap [count, tweetId, user, nextIndex]', heap.data.map((e) => `t${e[1]} (c=${e[0]}, u${e[2]}, i=${e[3]})`), { tones: heap.size ? { 0: 'active' } : {}, caption: 'smallest count = newest' }),
      res !== null && V.chips('res (feed being built)', res, { tones: tones(res.map((_, j) => j), 'good') }),
      V.chips('returned feeds', outs),
    ]);
    t.step('init', 'count = 0; empty tweetMap and followMap.', { count });
    let feedNo = 0;
    for (opIdx = 0; opIdx < ops.length; opIdx++) {
      const o = ops[opIdx];
      res = null;
      heap.data.length = 0;
      if (o[0] === 'postTweet') {
        const [, u, id] = o;
        who = u;
        if (!tweetMap.has(u)) tweetMap.set(u, []);
        tweetMap.get(u)!.push([count, id]);
        t.step('post', `User ${u} posts tweet ${id} with count ${count}.`, { userId: u, tweetId: id, count });
        count--;
        t.step('tick', `count → ${count}: the next tweet will be "smaller", i.e. newer.`, { count });
      } else if (o[0] === 'follow') {
        const [, a, b] = o;
        who = a;
        if (!followMap.has(a)) followMap.set(a, new Set());
        followMap.get(a)!.add(b);
        t.step('follow', `User ${a} follows ${b}.`, { followerId: a, followeeId: b });
      } else if (o[0] === 'unfollow') {
        const [, a, b] = o;
        who = a;
        followMap.get(a)?.delete(b);
        t.step('unfollow', `User ${a} unfollows ${b} (discard: no error if absent).`, { followerId: a, followeeId: b });
      } else {
        const u = o[1];
        who = u;
        feedNo++;
        res = [];
        t.step('feed', `getNewsFeed(${u}): empty result and heap.`, { userId: u });
        if (!followMap.has(u)) followMap.set(u, new Set());
        followMap.get(u)!.add(u);
        t.step('self', `A user always sees their own tweets: add ${u} to their own follow set.`, { userId: u });
        const fs = [...followMap.get(u)!];
        if (feedNo === 2 && opIdx > 0 && ops.slice(0, opIdx).some((p) => p[0] === 'unfollow' && p[1] === u)) {
          const gone = ops.slice(0, opIdx).filter((p) => p[0] === 'unfollow' && p[1] === u).map((p) => p[2] as number);
          const g = gone[gone.length - 1];
          const appears = fs.includes(g) && (tweetMap.get(g)?.length ?? 0) > 0;
          t.predict(`After unfollowing ${g}, will any of user ${g}'s tweets appear in this feed?`, ['Yes', 'No'], appears ? 0 : 1, appears ? `${u} follows ${g} again.` : `${g} is no longer in followMap[${u}], so their tweets are never seeded into the heap.`);
        }
        for (const f of fs) {
          t.step('seed', `Followee ${f}.`, { f });
          const list = tweetMap.get(f);
          t.step('hasTweets', list ? `${f} has ${list.length} tweet(s).` : `${f} has never posted.`, { f });
          if (!list) continue;
          const index = list.length - 1;
          t.step('latest', `Their newest tweet is at index ${index}: t${list[index][1]}.`, { index });
          heap.push([list[index][0], list[index][1], f, index - 1]);
          t.step('seedPush', `Push [${list[index][0]}, ${list[index][1]}, ${f}, ${index - 1}].`, { heapSize: heap.size });
        }
        let askedPop = feedNo !== 1;
        let askedNext = feedNo !== 1;
        while (true) {
          const go = heap.size > 0 && res.length < 10;
          t.step('loop', go ? `${heap.size} candidate(s), ${res.length} taken.` : heap.size ? 'Feed already has 10 tweets.' : 'Heap empty — every followed tweet is in the feed.', { taken: res.length });
          if (!go) break;
          if (!askedPop && heap.size > 1) {
            askedPop = true;
            const [ops2, a] = choice(heap.peek()![1], heap.data.map((e) => e[1]));
            t.predict('Which tweet id is popped first?', ops2, a, `It has the smallest count (${heap.peek()![0]}) = the most recent post.`);
          }
          const [c, id, f, index] = heap.pop()!;
          t.step('pop', `Pop tweet ${id} (count ${c}) by user ${f}.`, { count: c, tweetId: id, f, index });
          res.push(id);
          t.step('take', `Append ${id} to the feed.`, { res: `[${res.join(', ')}]` });
          t.step('more', index >= 0 ? `User ${f} has an older tweet at index ${index}.` : `User ${f} has no older tweets.`, { index });
          if (index >= 0) {
            const [c2, id2] = tweetMap.get(f)![index];
            if (!askedNext) {
              askedNext = true;
              const others = heap.data.map((e) => e[1]);
              const [o2, a2] = choice(id2, others.length ? others : [id]);
              t.predict(`Which tweet replaces ${id} in the heap?`, o2, a2, `The same author's next-older tweet (index ${index}) — the heap keeps one frontier tweet per followee.`);
            }
            t.step('older', `Their next-older tweet: t${id2} (count ${c2}).`, { count: c2, tweetId: id2 });
            heap.push([c2, id2, f, index - 1]);
            t.step('next', `Push [${c2}, ${id2}, ${f}, ${index - 1}].`, { heapSize: heap.size });
          }
        }
        outs.push(`u${u}: [${res.join(', ')}]`);
        t.step('ret', `Return [${res.join(', ')}].`, { result: `[${res.join(', ')}]` });
      }
    }
    opIdx = ops.length;
    res = null;
    who = null;
    return outs;
  },
};

type MedOp = ['addNum', number] | ['findMedian'];

const findMedian: Problem<{ ops: MedOp[] }> = {
  id: 'find-median-from-data-stream',
  num: 295,
  title: 'Find Median from Data Stream',
  difficulty: 'Hard',
  category: 'heap',
  pattern: 'heap',
  statement:
    'Design a structure with addNum(num), which adds an integer from a stream, and findMedian(), which returns the median of all numbers added so far (the mean of the two middle values when the count is even).',
  signals: ['running median', 'numbers arrive one at a time', 'need the middle, not the extremes', 'many queries interleaved with inserts'],
  insight:
    'Split the numbers into a lower half and an upper half. Keep the lower half in a MAX-heap and the upper half in a MIN-heap, with every value in small ≤ every value in large and sizes differing by at most 1. The median then sits at one or both heap roots.',
  hints: [
    'The median only depends on the one or two values in the middle.',
    'What if the lower half could tell you its largest value and the upper half its smallest, each in O(1)?',
    'After each insert, restore two invariants: order (max(small) ≤ min(large)) and size (difference ≤ 1).',
  ],
  pitfall: 'Fixing only the sizes and forgetting the order check: a big number pushed into small would then become the "lower median".',
  backend: {
    title: 'Live p50 latency on a metrics dashboard',
    detail:
      'A monitoring agent that reports the running median request latency (or the median price in a trading window) cannot re-sort all samples per scrape. Two heaps give O(log n) inserts and O(1) reads; production systems swap in approximate sketches (t-digest, HDR histograms) once the sample count is unbounded.',
  },
  complexity: { time: 'O(log n) add, O(1) find', space: 'O(n)' },
  code: `
class MedianFinder:
    def __init__(self):
        self.small, self.large = [], []  # max-heap (negated), min-heap @init
    def addNum(self, num):
        heapq.heappush(self.small, -num)                         @pushSmall
        if self.small and self.large and -self.small[0] > self.large[0]: @order
            heapq.heappush(self.large, -heapq.heappop(self.small)) @fixOrder
        if len(self.small) > len(self.large) + 1:                @tooSmall
            heapq.heappush(self.large, -heapq.heappop(self.small)) @moveUp
        if len(self.large) > len(self.small) + 1:                @tooLarge
            heapq.heappush(self.small, -heapq.heappop(self.large)) @moveDown
    def findMedian(self):
        if len(self.small) > len(self.large):                    @oddS
            return -self.small[0]                                @retS
        if len(self.large) > len(self.small):                    @oddL
            return self.large[0]                                 @retL
        return (-self.small[0] + self.large[0]) / 2              @even
`,
  explain: {
    pushSmall: 'Always enter through the lower half first.',
    order: 'Order invariant: the biggest "low" value may not exceed the smallest "high" value.',
    fixOrder: 'It belonged in the upper half — move small\'s max across.',
    tooSmall: '"small" is the name of the heap, not its size: here the lower half has 2 more than the upper.',
    moveUp: 'Rebalance by moving the lower half\'s max to the upper half.',
    moveDown: 'Rebalance by moving the upper half\'s min to the lower half.',
    even: 'Equal sizes: the two middle values are the two roots.',
  },
  distractors: [
    { text: '        heapq.heappush(self.small, num)', why: 'Without negation small becomes a MIN-heap, so small[0] is the smallest low value rather than the largest.' },
    { text: '        return (self.small[0] + self.large[0]) / 2', why: 'small stores negated values; forgetting the minus sign subtracts instead of adds.' },
    { text: '        if len(self.small) > len(self.large):', why: 'Rebalancing at a difference of 1 ping-pongs one value between the heaps forever; odd counts need a difference of 1.' },
  ],
  input: { ops: [['addNum', 5], ['addNum', 2], ['findMedian'], ['addNum', 8], ['findMedian'], ['addNum', 1], ['addNum', 9], ['findMedian']] },
  presets: [
    { label: 'descending stream', input: { ops: [['addNum', 9], ['addNum', 7], ['addNum', 5], ['findMedian'], ['addNum', 3], ['findMedian']] } },
    { label: 'ascending stream', input: { ops: [['addNum', 1], ['addNum', 2], ['addNum', 3], ['addNum', 4], ['findMedian']] } },
  ],
  validate: ({ ops }) => {
    if (!Array.isArray(ops) || !ops.length || ops.length > 12) return '1–12 ops';
    let added = 0;
    for (const o of ops) {
      if (Array.isArray(o) && o[0] === 'addNum' && o.length === 2 && typeof o[1] === 'number') added++;
      else if (Array.isArray(o) && o[0] === 'findMedian' && o.length === 1) {
        if (!added) return 'findMedian needs at least one addNum before it';
      } else return 'Each op is ["addNum", n] or ["findMedian"]';
    }
    return null;
  },
  trace(t, { ops }) {
    const small = new Heap<number>((a, b) => a > b);
    const large = new Heap<number>();
    let opIdx = -1;
    let moved: number | null = null;
    const outs: number[] = [];
    t.draw(() => [
      V.array('ops', ops.map(opLabel), { pointers: { op: opIdx }, tones: opIdx >= 0 && opIdx < ops.length ? { [opIdx]: 'active' } : {}, showIndex: false }),
      V.heap('small — lower half (max-heap; stored negated in Python)', small.data, {
        tones: toneAt([small.size ? 0 : -1, 'info'], [moved !== null ? small.data.indexOf(moved) : -1, 'active']),
        caption: small.size ? `max = ${small.peek()}` : 'empty',
      }),
      V.heap('large — upper half (min-heap)', large.data, {
        tones: toneAt([large.size ? 0 : -1, 'info'], [moved !== null ? large.data.indexOf(moved) : -1, 'active']),
        caption: large.size ? `min = ${large.peek()}` : 'empty',
      }),
      V.chips('medians returned', outs),
    ]);
    t.step('init', 'Two empty heaps: small holds the lower half, large the upper half.', {});
    let askedOrder = false;
    let askedSize = false;
    let askedMed = false;
    for (opIdx = 0; opIdx < ops.length; opIdx++) {
      const o = ops[opIdx];
      if (o[0] === 'addNum') {
        const num = o[1];
        small.push(num);
        moved = num;
        t.step('pushSmall', `addNum(${num}): push into small.`, { num, small: small.size, large: large.size });
        const bad = small.size > 0 && large.size > 0 && small.peek()! > large.peek()!;
        if (!askedOrder && large.size > 0) {
          askedOrder = true;
          t.predict(`max(small) = ${small.peek()}, min(large) = ${large.peek()}. Does the order fix fire?`, ['Yes', 'No'], bad ? 0 : 1, bad ? `${small.peek()} > ${large.peek()}: a lower-half value is bigger than an upper-half value.` : `${small.peek()} ≤ ${large.peek()}: the halves are already ordered.`);
        }
        t.step('order', large.size ? `max(small) ${small.peek()} ${bad ? '>' : '≤'} min(large) ${large.peek()}.` : 'large is empty — nothing to compare.', {});
        if (bad) {
          moved = small.pop()!;
          large.push(moved);
          t.step('fixOrder', `Move ${moved} from small to large.`, { small: small.size, large: large.size });
        }
        const s1 = small.size > large.size + 1;
        const l1 = large.size > small.size + 1;
        if (!askedSize && (s1 || l1)) {
          askedSize = true;
          t.predict(`Sizes: small ${small.size}, large ${large.size}. Which heap is too big?`, ['small', 'large', 'neither'], s1 ? 0 : 1, `A difference of 2 breaks the size invariant; ${s1 ? 'small' : 'large'} gives up its root.`);
        }
        t.step('tooSmall', `len(small) ${small.size} ${s1 ? '>' : '≤'} len(large) + 1.`, { small: small.size, large: large.size });
        if (s1) {
          moved = small.pop()!;
          large.push(moved);
          t.step('moveUp', `Move small's max ${moved} up to large.`, { small: small.size, large: large.size });
        }
        t.step('tooLarge', `len(large) ${large.size} ${l1 ? '>' : '≤'} len(small) + 1.`, { small: small.size, large: large.size });
        if (l1) {
          moved = large.pop()!;
          small.push(moved);
          t.step('moveDown', `Move large's min ${moved} down to small.`, { small: small.size, large: large.size });
        }
      } else {
        moved = null;
        const med = small.size > large.size ? small.peek()! : large.size > small.size ? large.peek()! : (small.peek()! + large.peek()!) / 2;
        t.step('oddS', `findMedian(): len(small) ${small.size} ${small.size > large.size ? '>' : '≤'} len(large) ${large.size}.`, {});
        if (!askedMed) {
          askedMed = true;
          const [mo, ma] = choice(med, [small.peek(), large.peek(), small.peek()! + large.peek()!].filter((x) => x !== undefined));
          t.predict(`findMedian() with small = ${small.size} values and large = ${large.size}. What is returned?`, mo, ma, small.size === large.size ? `Even count: average of the roots (${small.peek()} + ${large.peek()}) / 2.` : 'Odd count: the root of the bigger heap is the middle value.');
        }
        if (small.size > large.size) {
          outs.push(med);
          t.step('retS', `Odd count, extra value in small: return ${med}.`, { result: med });
          continue;
        }
        t.step('oddL', `len(large) ${large.size} ${large.size > small.size ? '>' : '≤'} len(small) ${small.size}.`, {});
        if (large.size > small.size) {
          outs.push(med);
          t.step('retL', `Odd count, extra value in large: return ${med}.`, { result: med });
          continue;
        }
        outs.push(med);
        t.step('even', `Even count: (${small.peek()} + ${large.peek()}) / 2 = ${med}.`, { result: med });
      }
    }
    opIdx = ops.length;
    moved = null;
    return outs;
  },
};

export const problems: Problem[] = [kthLargestStream, lastStoneWeight, kClosest, kthLargestArray, taskScheduler, designTwitter, findMedian];

export const variants: Variant[] = [
  {
    id: 'running-p50-latency',
    title: 'Running Median Latency per Endpoint',
    statement:
      'Latency samples arrive as (endpoint, ms). After each sample, report that endpoint\'s median latency so far. There are a few dozen endpoints and millions of samples.',
    pattern: 'heap',
    nearest: 'find-median-from-data-stream',
    signals: ['running median', 'stream of values', 'query after every insert'],
    approach:
      'Keep one MedianFinder (max-heap of the lower half + min-heap of the upper half) per endpoint in a hash map. Each sample is an O(log n) addNum; reading the median is O(1) from the roots.',
    backend: 'APM dashboards (p50 per route). Past a memory budget, switch to a t-digest, which keeps the same "two halves" idea approximately.',
  },
  {
    id: 'top-k-slowest-endpoints-stream',
    title: 'Alert Threshold: 100th-Slowest Request Today',
    statement:
      'Requests stream in with their latency. At any moment, report the latency of the 100th-slowest request seen today, using memory independent of the request count.',
    pattern: 'heap',
    nearest: 'kth-largest-element-in-a-stream',
    signals: ['"k-th largest" over a stream', 'bounded memory', 'answer after every event'],
    approach: 'A min-heap capped at 100: push each latency, pop when the size exceeds 100. The root is the answer. O(log k) per request, O(k) memory.',
    backend: 'Tail-latency alerting and "top-N slow queries" panels in database monitors (pg_stat_statements-style views).',
  },
  {
    id: 'least-loaded-worker-assignment',
    title: 'Assign Jobs to the Least-Loaded Worker',
    statement:
      'You have w workers and a list of jobs with durations, arriving in order. Each job goes to the worker that becomes free first (ties → lowest id). Return the worker id for every job and the time the last job finishes.',
    pattern: 'heap',
    nearest: 'task-scheduler',
    signals: ['repeatedly pick the "best" resource right now', 'resources come back after some time', 'simulation over time'],
    approach:
      'Min-heap of (freeAt, workerId). For each job pop the root, assign the job, push (freeAt + duration, workerId). The answer is the max freeAt. O(n log w).',
    backend: 'Thread-pool / Kubernetes-style schedulers and connection pools that hand work to the least-busy worker.',
  },
  {
    id: 'merge-k-sorted-log-files',
    title: 'Merge Sorted Log Files from k Servers',
    statement:
      'Each of k servers writes a log file sorted by timestamp. Produce one combined, timestamp-sorted stream, reading each file only once and holding at most one line per file in memory.',
    pattern: 'heap',
    nearest: 'design-twitter',
    signals: ['k inputs, each already sorted', 'need a single sorted output', 'cannot load everything'],
    approach:
      'Seed a min-heap with the first line of each file as (timestamp, fileIndex, line). Pop the smallest, emit it, push the next line from that same file. O(N log k) time, O(k) memory.',
    backend: 'Log aggregation, LSM-tree compaction (merging sorted SSTables) and external merge sort all run this loop.',
  },
];
