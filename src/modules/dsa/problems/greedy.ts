import type { Problem, Tone, Variant } from '../engine/types.ts';
import { Heap, V, rc, tones } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Greedy — make the locally best move and prove you never need to undo it.
// ---------------------------------------------------------------------------

const span = (a: number, b: number): number[] => (b < a ? [] : Array.from({ length: b - a + 1 }, (_, k) => a + k));
const isNums = (x: unknown): x is number[] => Array.isArray(x) && x.every((v) => typeof v === 'number' && Number.isFinite(v));

const maxSubarray: Problem<{ nums: number[] }> = {
  id: 'maximum-subarray',
  num: 53,
  title: 'Maximum Subarray',
  difficulty: 'Medium',
  category: 'greedy',
  pattern: 'greedy',
  statement:
    'Given an integer array (it may contain negatives), find the contiguous, non-empty slice whose elements add up to the largest total and return that total.',
  signals: ['"contiguous subarray" + "largest sum"', 'negatives allowed (so you cannot just take everything)', 'only the value is asked, not all subarrays', 'O(n) expected'],
  insight:
    'A running sum that has gone negative can only hurt whatever comes next, so drop it and start fresh at the current element (Kadane). Track the best running sum ever seen.',
  hints: [
    'Brute force tries every (start, end) pair. What do you learn about a prefix whose sum is negative?',
    'If the sum of the current slice is below zero, would any future slice want to include it?',
    'Keep cur (best sum ending here) and res (best overall); reset cur to 0 whenever it goes negative.',
  ],
  pitfall: 'Initialising res = 0 instead of nums[0] — an all-negative array then wrongly returns 0 (an empty slice).',
  backend: {
    title: 'Worst sustained latency regression in a metrics stream',
    detail:
      'A monitoring job reads per-minute deltas (p99 latency minus baseline) from Prometheus and wants the contiguous time window with the largest cumulative regression to attach to an incident. Kadane runs in one streaming pass: the array is the time series, cur is the "regression still ongoing" window and a negative cur means the service recovered, so the window restarts.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def maxSubArray(nums):
    res, cur = nums[0], 0              @init
    for n in nums:                     @loop
        if cur < 0:                    @check
            cur = 0                    @reset
        cur += n                       @add
        res = max(res, cur)            @best
    return res                         @done
`,
  explain: {
    init: 'res starts at a real element so an all-negative array still answers correctly; cur = 0 is the empty running slice.',
    check: 'A negative running sum is dead weight: any slice that starts after it is strictly better.',
    reset: 'Drop the prefix — the new slice starts at the current element.',
    add: 'Extend the current slice by n.',
    best: 'Every slice ending here has been considered implicitly; cur is the best of them.',
  },
  distractors: [
    { text: '    res, cur = 0, 0', why: 'res = 0 claims an empty slice is allowed — an all-negative array returns 0 instead of its largest element.' },
    { text: '        if n < 0:', why: 'A single negative element is fine to cross if the slice before it is big ([5, -1, 5] = 9). Only a negative RUNNING SUM should be dropped.' },
    { text: '        cur = max(cur, n)', why: 'This forgets to add n to the running slice; it just tracks the max element.' },
  ],
  input: { nums: [-2, 1, -3, 4, -1, 2, 1, -5, 4] },
  presets: [
    { label: 'all negative', input: { nums: [-3, -1, -2] } },
    { label: 'cross a dip', input: { nums: [5, 4, -1, 7, 8] } },
    { label: 'single', input: { nums: [-7] } },
  ],
  validate: ({ nums }) => (!isNums(nums) || !nums.length ? 'Expected { nums: number[] } (non-empty)' : nums.length > 16 ? 'Keep nums ≤ 16 elements' : null),
  trace(t, { nums }) {
    let res = nums[0];
    let cur = 0;
    let start = 0;
    let i = -1;
    let best: [number, number] = [0, 0];
    let asked = 0;
    t.draw(() => [
      V.array('nums', nums, {
        pointers: { i: i >= 0 && i < nums.length ? i : null },
        window: i >= 0 ? [start, Math.min(i, nums.length - 1)] : null,
        tones: { ...tones(span(best[0], best[1]), 'good'), ...(i >= 0 && i < nums.length ? { [i]: 'active' as Tone } : {}) },
        caption: 'shaded = current slice (cur) · green = best slice so far (res)',
      }),
      V.map('running state', [
        ['cur', cur],
        ['res', res],
      ]),
    ]);
    t.step('init', `res = nums[0] = ${res} (a real slice), cur = 0 (nothing accumulated yet).`, { res, cur });
    for (i = 0; i < nums.length; i++) {
      const n = nums[i];
      t.step('loop', `Next element nums[${i}] = ${n}. The running slice currently sums to cur = ${cur}.`, { i, n, cur, res });
      if (i >= 1 && asked < 3) {
        asked++;
        t.predict(
          `cur = ${cur}. Do we throw the running slice away before adding ${n}?`,
          ['Yes — restart at this element', 'No — extend the slice'],
          cur < 0 ? 0 : 1,
          cur < 0 ? `A negative prefix (${cur}) can only drag ${n} down; starting fresh is strictly better.` : `cur = ${cur} is not negative, so it helps (or is neutral) — keep extending.`,
        );
      }
      if (cur < 0) {
        t.step('check', `cur = ${cur} < 0: everything accumulated so far is a net loss.`, { cur });
        cur = 0;
        start = i;
        t.step('reset', `Drop it — the new slice starts at index ${i}.`, { cur, start });
      } else {
        t.step('check', `cur = ${cur} ≥ 0: the slice so far is worth keeping.`, { cur });
      }
      cur += n;
      t.step('add', `cur += ${n} → ${cur} (slice ${start}..${i}).`, { cur, start, i });
      if (cur > res) {
        res = cur;
        best = [start, i];
        t.step('best', `${cur} beats the old best — res = ${res} (slice ${start}..${i}).`, { res, cur });
      } else {
        t.step('best', `${cur} ≤ res = ${res}; best stays.`, { res, cur });
      }
    }
    i = nums.length - 1;
    t.step('done', `Return res = ${res} — the slice ${best[0]}..${best[1]}.`, { res });
    return res;
  },
};

const jumpGame: Problem<{ nums: number[] }> = {
  id: 'jump-game',
  num: 55,
  title: 'Jump Game',
  difficulty: 'Medium',
  category: 'greedy',
  pattern: 'greedy',
  statement:
    'You stand on index 0 of an array where each value is the longest jump you may take from that spot. Decide whether the last index can be reached.',
  signals: ['"can you reach the end"', 'each cell gives a maximum step', 'yes/no answer, not the path', 'n up to 10⁴ (DP over all jumps is too slow)'],
  insight:
    'Walk backwards with a "goal": if index i can jump to the goal, then reaching i is as good as reaching the end, so the goal moves to i. The answer is whether the goal reaches 0.',
  hints: [
    'A DP "can I reach the end from i?" works but checks many jumps per cell.',
    'From the right: which is the left-most index already known to reach the end?',
    'Keep goal = that index; if i + nums[i] ≥ goal, set goal = i.',
  ],
  pitfall: 'Requiring i + nums[i] == goal (an exact landing) — you can jump anywhere up to nums[i], so ≥ is correct.',
  backend: {
    title: 'Can a request reach a healthy region through failover hops?',
    detail:
      'A global load balancer has an ordered chain of PoPs; each PoP can forward a request up to k PoPs downstream (its max hop budget). To decide whether traffic from the edge can reach the origin, sweep from the origin backwards keeping the closest PoP that is known to make it — one O(n) pass instead of a graph search.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def canJump(nums):
    goal = len(nums) - 1                       @init
    for i in range(len(nums) - 1, -1, -1):     @loop
        if i + nums[i] >= goal:                @check
            goal = i                           @move
    return goal == 0                           @done
`,
  explain: {
    init: 'The last index trivially reaches itself.',
    loop: 'Go right → left so the goal is always already proven.',
    check: 'From i we can land anywhere in i..i+nums[i]; reaching the goal (or past it) is enough.',
    move: 'Reaching i now guarantees reaching the end, so i becomes the new, closer goal.',
  },
  distractors: [
    { text: '        if i + nums[i] == goal:', why: 'A jump can be shorter than the maximum, so overshooting the goal is fine — use ≥.' },
    { text: '    for i in range(len(nums)):', why: 'Scanning left → right compares against a goal that has not been proven yet.' },
    { text: '    return goal == len(nums) - 1', why: 'The goal starts at the last index; success means it walked all the way down to 0.' },
  ],
  input: { nums: [2, 3, 1, 1, 4] },
  presets: [
    { label: 'blocked by a 0', input: { nums: [3, 2, 1, 0, 4] } },
    { label: 'single cell', input: { nums: [0] } },
    { label: 'hop over zeros', input: { nums: [3, 0, 0, 1] } },
  ],
  validate: ({ nums }) =>
    !isNums(nums) || !nums.length ? 'Expected { nums: number[] } (non-empty)' : nums.length > 14 ? 'Keep nums ≤ 14 elements' : nums.some((v) => v < 0) ? 'Jump lengths must be ≥ 0' : null,
  trace(t, { nums }) {
    const n = nums.length;
    let goal = n - 1;
    let i = n;
    let asked = 0;
    t.draw(() => [
      V.array('nums (max jump)', nums, {
        pointers: { i: i < n ? i : null, goal },
        window: i < n ? [i, Math.min(n - 1, i + nums[i])] : null,
        tones: { ...tones(span(goal, n - 1), 'good'), ...(i < n ? { [i]: 'active' as Tone } : {}) },
        caption: 'green = proven to reach the end · shaded = cells a jump from i can land on',
      }),
    ]);
    t.step('init', `goal = ${goal}: the last index already "reaches the end".`, { goal });
    for (i = n - 1; i >= 0; i--) {
      t.step('loop', `Index ${i}: from here we can land anywhere up to ${i} + ${nums[i]} = ${i + nums[i]}.`, { i, 'nums[i]': nums[i], goal });
      if (i < n - 1 && asked < 3) {
        asked++;
        t.predict(
          `Does a jump from ${i} reach goal = ${goal}?`,
          ['Yes — goal moves to i', 'No — goal stays'],
          i + nums[i] >= goal ? 0 : 1,
          i + nums[i] >= goal ? `${i + nums[i]} ≥ ${goal}, so reaching ${i} is enough.` : `${i + nums[i]} < ${goal}: from ${i} we fall short of every proven index.`,
        );
      }
      if (i + nums[i] >= goal) {
        t.step('check', `${i + nums[i]} ≥ goal ${goal} — index ${i} can reach a proven cell.`, { i, goal });
        goal = i;
        t.step('move', `goal = ${i}. Now we only need to reach index ${i}.`, { goal });
      } else {
        t.step('check', `${i + nums[i]} < goal ${goal} — index ${i} can't get there; goal stays.`, { i, goal });
      }
    }
    i = n;
    t.step('done', goal === 0 ? 'goal reached index 0 — the start is proven: True.' : `goal stopped at ${goal}; index 0 cannot reach it: False.`, { goal, result: goal === 0 });
    return goal === 0;
  },
};

const jumpGameII: Problem<{ nums: number[] }> = {
  id: 'jump-game-ii',
  num: 45,
  title: 'Jump Game II',
  difficulty: 'Medium',
  category: 'greedy',
  pattern: 'greedy',
  statement:
    'Each array value is the longest jump allowed from that index. Starting at index 0, return the fewest jumps needed to land on the last index (it is always reachable).',
  signals: ['"minimum number of jumps"', 'every index has a max reach', 'end is guaranteed reachable', 'shortest path on an implicit graph with unit edges'],
  insight:
    'This is BFS without a queue: the indices reachable in exactly k jumps form a contiguous window [l, r]. The next window is [r + 1, farthest reach from any index in the current window].',
  hints: [
    'Think of BFS where each "level" is the set of cells reachable with the same number of jumps.',
    'Is each level a contiguous range of indices?',
    'For window [l, r], scan it for the farthest i + nums[i]; that becomes the next r.',
  ],
  pitfall: 'Looping while r < len(nums) instead of len(nums) - 1 — that counts one jump too many once the last index is already inside the window.',
  backend: {
    title: 'Fewest relay hops in a store-and-forward network',
    detail:
      'Satellites (or edge caches) on a line can each forward a message up to k nodes ahead. Planning the minimum number of relay rounds is BFS by levels; because coverage is contiguous, each round is just a window [l, r] — the same trick CDNs use to compute rollout "waves" over an ordered list of regions.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def jump(nums):
    res = 0                                    @init
    l = r = 0
    while r < len(nums) - 1:                   @loop
        farthest = 0                           @far0
        for i in range(l, r + 1):              @scan
            farthest = max(farthest, i + nums[i])   @far
        l = r + 1                              @nextL
        r = farthest                           @nextR
        res += 1                               @count
    return res                                 @done
`,
  explain: {
    init: 'Window [0, 0]: with 0 jumps we can only be at the start.',
    loop: 'Stop as soon as the current level already contains the last index.',
    far: 'The farthest any index of this level can jump defines the right edge of the next level.',
    nextL: 'The next level starts right after this one — everything up to r is already reachable with fewer jumps.',
    count: 'Moving to the next level costs exactly one jump.',
  },
  distractors: [
    { text: '    while r < len(nums):', why: 'Once r ≥ last index we are done; this loops one extra level and over-counts.' },
    { text: '        l = farthest', why: 'The next level begins at r + 1 — the cells between r + 1 and farthest are all reachable in one more jump.' },
    { text: '            farthest = i + nums[i]', why: 'Overwrites instead of taking the max, so a later short jump hides an earlier long one.' },
  ],
  input: { nums: [2, 3, 1, 1, 4] },
  presets: [
    { label: 'long first jump', input: { nums: [5, 1, 1, 1, 1, 1] } },
    { label: 'one step at a time', input: { nums: [1, 1, 1, 1] } },
    { label: 'single cell', input: { nums: [0] } },
  ],
  validate: ({ nums }) => {
    if (!isNums(nums) || !nums.length) return 'Expected { nums: number[] } (non-empty)';
    if (nums.length > 14) return 'Keep nums ≤ 14 elements';
    let reach = 0;
    for (let i = 0; i < nums.length && i <= reach; i++) reach = Math.max(reach, i + nums[i]);
    return reach < nums.length - 1 ? 'The last index must be reachable' : null;
  },
  trace(t, { nums }) {
    const n = nums.length;
    let res = 0;
    let l = 0;
    let r = 0;
    let i = -1;
    let farthest = -1;
    let asked = 0;
    t.draw(() => [
      V.array('nums', nums, {
        pointers: { l, r: Math.min(r, n - 1), i: i >= 0 ? i : null, far: farthest >= 0 ? Math.min(farthest, n - 1) : null },
        window: [Math.min(l, n - 1), Math.min(r, n - 1)],
        tones: i >= 0 ? { [i]: 'active' } : {},
        caption: 'shaded = cells reachable with exactly res jumps (one BFS level)',
      }),
      V.map('state', [
        ['res (jumps)', res],
        ['farthest', farthest < 0 ? '–' : farthest],
      ]),
    ]);
    t.step('init', 'res = 0, window [0, 0]: with zero jumps we are only at the start.', { res, l, r });
    while (r < n - 1) {
      t.step('loop', `r = ${r} < last index ${n - 1}: the end is not in this level yet, so we need another jump.`, { l, r, res });
      farthest = 0;
      t.step('far0', `Scan level [${l}, ${r}] for the farthest landing spot.`, { l, r });
      for (i = l; i <= r; i++) {
        farthest = Math.max(farthest, i + nums[i]);
        t.step('far', `From ${i} we reach ${i + nums[i]}; farthest = ${farthest}.`, { i, 'i + nums[i]': i + nums[i], farthest });
      }
      i = -1;
      t.step('nextL', `Everything up to ${r} is already reachable, so the next level starts at l = ${r + 1}.`, { l: r + 1, r });
      l = r + 1;
      if (asked < 2) {
        asked++;
        const opts = [...new Set([farthest, r + 1, Math.min(n - 1, r + 2)].map(String))].sort((a, b) => Number(a) - Number(b));
        t.predict('Where does the next level end (new r)?', opts, opts.indexOf(String(farthest)), `The farthest landing spot from the current level is ${farthest}.`);
      }
      r = farthest;
      t.step('nextR', `r = farthest = ${r}: one more jump reaches anything in [${l}, ${Math.min(r, n - 1)}].`, { l, r });
      res++;
      t.step('count', `That level costs one jump: res = ${res}.`, { res });
    }
    t.step('loop', `r = ${r} ≥ ${n - 1}: the last index is inside the current level.`, { r, res });
    t.step('done', `Return ${res} jump${res === 1 ? '' : 's'}.`, { res });
    return res;
  },
};

const gasStation: Problem<{ gas: number[]; cost: number[] }> = {
  id: 'gas-station',
  num: 134,
  title: 'Gas Station',
  difficulty: 'Medium',
  category: 'greedy',
  pattern: 'greedy',
  statement:
    'Stations sit on a circular road; station i gives gas[i] fuel and driving to the next station burns cost[i]. With an empty tank, find the one starting station that lets you drive a full lap, or -1 if none does.',
  signals: ['circular route', '"unique starting index" (only one valid answer)', 'running balance must stay ≥ 0', 'O(n²) simulation is too slow'],
  insight:
    'If total gas ≥ total cost a start exists. Simulate from a candidate; when the tank goes negative at i, no station between the candidate and i can work either, so jump the candidate to i + 1.',
  hints: [
    'When is a full lap impossible no matter where you start?',
    'Starting at s you run dry at i. Could any station between s and i do better? It would arrive at i with even less fuel.',
    'Keep a running tank; on a negative tank reset it and set start = i + 1.',
  ],
  pitfall: 'Retrying from s + 1 after a failure (O(n²)) — every station up to the failure point is also ruled out, so restart at i + 1.',
  backend: {
    title: 'Choosing a safe start offset for a cyclic batch schedule',
    detail:
      'A nightly ETL rotates through shards in a fixed ring; each shard frees some worker credits (gas) and the next transfer consumes some (cost). To pick the shard to start with so the credit balance never goes negative, run the same single pass: the ring is the array, the tank is the running credit balance and a negative balance disqualifies the whole stretch you just tried.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def canCompleteCircuit(gas, cost):
    if sum(gas) < sum(cost):                   @feasible
        return -1                              @none
    total, res = 0, 0                          @init
    for i in range(len(gas)):                  @loop
        total += gas[i] - cost[i]              @add
        if total < 0:                          @check
            total, res = 0, i + 1              @reset
    return res                                 @done
`,
  explain: {
    feasible: 'If the whole lap burns more than it collects, no start can work. If it does not, exactly one start works — so we never have to wrap around.',
    add: 'Net change in the tank for leaving station i.',
    check: 'A negative tank means the current candidate fails before reaching i + 1.',
    reset: 'Every station from res to i would also fail (they would reach i with ≤ this much fuel), so try i + 1 with an empty tank.',
  },
  distractors: [
    { text: '            total, res = 0, res + 1', why: 'Only discards one candidate; every station from res through i is already ruled out, so jump to i + 1.' },
    { text: '        if total <= 0:', why: 'Arriving with exactly 0 fuel is allowed; only a negative tank fails.' },
    { text: '    for i in range(2 * len(gas)):', why: 'No wrap-around is needed: the total check already guarantees the surviving candidate completes the lap.' },
  ],
  input: { gas: [3, 1, 1, 4, 2], cost: [1, 3, 3, 1, 1] },
  presets: [
    { label: 'fail one by one', input: { gas: [1, 2, 3, 4, 5], cost: [3, 4, 5, 1, 2] } },
    { label: 'impossible', input: { gas: [2, 3, 4], cost: [3, 4, 3] } },
    { label: 'start at 0', input: { gas: [5, 1, 2], cost: [4, 2, 1] } },
  ],
  validate: ({ gas, cost }) =>
    !isNums(gas) || !isNums(cost) || !gas.length
      ? 'Expected { gas: number[], cost: number[] }'
      : gas.length !== cost.length
        ? 'gas and cost must have the same length'
        : gas.length > 10
          ? 'Keep ≤ 10 stations'
          : null,
  trace(t, { gas, cost }) {
    const n = gas.length;
    const net = gas.map((g, k) => g - cost[k]);
    const sg = gas.reduce((a, b) => a + b, 0);
    const sc = cost.reduce((a, b) => a + b, 0);
    let total = 0;
    let res = 0;
    let i = -1;
    let asked = 0;
    let resetAsked = false;
    t.draw(() => [
      V.array('gas', gas, { pointers: { i: i >= 0 ? i : null } }),
      V.array('cost', cost, { pointers: { i: i >= 0 ? i : null } }),
      V.array('gas − cost (net)', net, {
        pointers: { res, i: i >= 0 ? i : null },
        window: i >= 0 ? [res, i] : null,
        tones: { ...tones(span(0, res - 1), 'muted'), ...(i >= 0 ? { [i]: 'active' as Tone } : {}) },
        caption: 'shaded = stretch driven from candidate res · grey = ruled-out starts',
      }),
      V.map('state', [
        ['total (tank)', total],
        ['res (candidate start)', res],
      ]),
    ]);
    t.step('feasible', 'First: is there enough fuel in the whole loop for ANY start? Add up both rows.', {});
    t.predict('Can any start complete the lap?', ['Yes', 'No — return -1'], sg >= sc ? 0 : 1, sg >= sc ? `${sg} ≥ ${sc}: there is enough fuel overall, so some start works.` : `${sg} < ${sc}: the lap burns more than it ever collects.`);
    t.step('feasible', `Total gas ${sg} vs total cost ${sc}: ${sg >= sc ? 'enough' : 'not enough'}.`, { 'sum(gas)': sg, 'sum(cost)': sc });
    if (sg < sc) {
      t.step('none', 'Not enough fuel in the whole loop — return -1.', { result: -1 });
      return -1;
    }
    t.step('init', 'Enough fuel exists overall. Try station 0 with an empty tank.', { total, res });
    for (i = 0; i < n; i++) {
      t.step('loop', `Leave station ${i}: +${gas[i]} gas, −${cost[i]} to drive on (net ${net[i]}).`, { i, total, res });
      if (asked < 2) {
        asked++;
        t.predict(`Tank is ${total}. After adding net ${net[i]}, does it go negative?`, ['Yes', 'No'], total + net[i] < 0 ? 0 : 1, `${total} + ${net[i]} = ${total + net[i]}.`);
      }
      total += net[i];
      t.step('add', `total = ${total}.`, { i, total });
      if (total < 0) {
        t.step('check', `total = ${total} < 0: starting at ${res} we cannot reach station ${i + 1}.`, { total, res });
        if (!resetAsked && i > res) {
          resetAsked = true;
          t.predict(
            'Which station should be the next candidate start?',
            [`${res + 1} (res + 1)`, `${i + 1} (i + 1)`, '0 (start over)'],
            1,
            `Any station between ${res} and ${i} would reach ${i} with no more fuel than we had, so all of them fail too — skip to ${i + 1}.`,
          );
        }
        const ruled = res === i ? `station ${i}` : `stations ${res}..${i}`;
        total = 0;
        res = i + 1;
        t.step('reset', `Rule out ${ruled}; new candidate res = ${res}, tank back to 0.`, { total, res });
      } else {
        t.step('check', `total = ${total} ≥ 0 — candidate ${res} survives.`, { total, res });
      }
    }
    i = -1;
    t.step('done', `The surviving candidate is station ${res}.`, { result: res });
    return res;
  },
};

const handOfStraights: Problem<{ hand: number[]; groupSize: number }> = {
  id: 'hand-of-straights',
  num: 846,
  title: 'Hand of Straights',
  difficulty: 'Medium',
  category: 'greedy',
  pattern: 'greedy',
  statement:
    'Given card values and a group size k, decide whether every card can be used in groups of exactly k consecutive values (like 4-5-6), each card in exactly one group.',
  signals: ['"groups of consecutive values"', 'every element used exactly once', 'duplicates allowed (counts matter)', 'order of input does not matter'],
  insight:
    'The smallest remaining card has no choice: it can only be the START of a group. So repeatedly take the minimum (min-heap over distinct values) and consume minimum, minimum+1, …, minimum+k−1 from a count map.',
  hints: [
    'Which card has only one possible role in a valid arrangement?',
    'The smallest card must begin a run. Count duplicates with a hashmap.',
    'Use a min-heap of distinct values; when a value\'s count hits 0 it must be the heap\'s top, otherwise a gap appears.',
  ],
  pitfall: 'Popping a value from the heap when its count hits 0 without checking it is the minimum — a smaller value still has cards left that can no longer be completed.',
  backend: {
    title: 'Packing sequence-numbered messages into fixed-size ordered batches',
    detail:
      'A Kafka consumer must ship events in batches of exactly k consecutive sequence numbers (for idempotent bulk writes). A count map of pending sequence numbers plus a min-heap of the lowest outstanding one tells you whether the buffered events can be flushed as complete batches, or which gap is blocking.',
  },
  complexity: { time: 'O(n log n)', space: 'O(n)' },
  code: `
def isNStraightHand(hand, groupSize):
    if len(hand) % groupSize:                        @size
        return False                                 @badSize
    count = Counter(hand)                            @count
    minH = list(count.keys())                        @keys
    heapq.heapify(minH)                              @heapify
    while minH:                                      @loop
        first = minH[0]                              @first
        for i in range(first, first + groupSize):    @group
            if i not in count:                       @missing
                return False                         @fail
            count[i] -= 1                            @use
            if count[i] == 0:                        @zero
                if i != minH[0]:                     @order
                    return False                     @gap
                heapq.heappop(minH)                  @pop
    return True                                      @done
`,
  explain: {
    size: 'Cards must split evenly into groups of k.',
    count: 'Duplicates matter — track how many of each value remain.',
    heapify: 'A min-heap over DISTINCT values gives the smallest remaining card in O(1).',
    first: 'The smallest remaining card can only start a group.',
    missing: 'A hole in the run means this group can never be completed.',
    order: 'If a value runs out while a smaller value still has cards, that smaller value can never be grouped.',
    pop: 'Value exhausted and it is the minimum — remove it from the heap.',
  },
  distractors: [
    { text: '        first = max(count)', why: 'Groups must be built from the smallest card upward; the largest card has several possible roles.' },
    { text: '                if i == minH[0]:', why: 'Inverted check: returning False exactly when the exhausted value IS the minimum rejects every valid hand.' },
    { text: '    hand.sort()', why: 'Sorting alone does not help: duplicates mean a valid hand is not one long run (e.g. [1,1,2,2] with k = 2) — you still need counts.' },
  ],
  input: { hand: [1, 2, 3, 6, 2, 3, 4, 7, 8], groupSize: 3 },
  presets: [
    { label: 'size mismatch', input: { hand: [1, 2, 3, 4, 5], groupSize: 4 } },
    { label: 'gap appears', input: { hand: [1, 1, 2, 3, 3, 4], groupSize: 3 } },
    { label: 'missing card', input: { hand: [1, 2, 4, 5, 6, 7], groupSize: 3 } },
  ],
  validate: ({ hand, groupSize }) =>
    !isNums(hand) || typeof groupSize !== 'number' || !hand.length
      ? 'Expected { hand: number[], groupSize: number }'
      : hand.length > 14
        ? 'Keep hand ≤ 14 cards'
        : groupSize < 1 || groupSize > 6
          ? 'groupSize must be 1..6'
          : null,
  trace(t, { hand, groupSize }) {
    const count = new Map<number, number>();
    const heap = new Heap<number>();
    const groups: string[] = [];
    let cur: number[] = [];
    let hl: number[] = [];
    let built = false;
    let firstAsked = 0;
    let zeroAsked = false;
    t.draw(() => [
      V.array('hand', hand),
      built && V.map('count (value → cards left)', [...count.entries()].sort((a, b) => a[0] - b[0]), { hl }),
      built && V.heap('minH (distinct values)', heap.data, { tones: heap.size ? { 0: 'active' } : {} }),
      V.chips('current group', cur, { tones: tones(cur.map((_, k) => k), 'active') }),
      V.chips('groups formed', groups, { tones: tones(groups.map((_, k) => k), 'good') }),
    ]);
    t.step('size', `${hand.length} cards, groups of ${groupSize}. Quick sanity check before any real work.`, { 'len(hand)': hand.length, groupSize });
    t.predict(`Can ${hand.length} cards split into groups of ${groupSize}?`, ['Yes, evenly', 'No — leftovers'], hand.length % groupSize ? 1 : 0, `${hand.length} % ${groupSize} = ${hand.length % groupSize}.`);
    t.step('size', `${hand.length} % ${groupSize} = ${hand.length % groupSize}: ${hand.length % groupSize ? 'does not divide evenly' : 'divides evenly'}.`, { 'len(hand)': hand.length, groupSize });
    if (hand.length % groupSize) {
      t.step('badSize', 'Leftover cards can never form a full group — False.', { result: false });
      return false;
    }
    for (const c of hand) count.set(c, (count.get(c) ?? 0) + 1);
    built = true;
    t.step('count', 'Count each value — duplicates must each land in a different group.', {});
    for (const k of count.keys()) heap.push(k);
    t.step('heapify', `Heap of the ${count.size} distinct values; the top is always the smallest card left.`, { 'minH[0]': heap.peek() });
    while (heap.size) {
      t.step('loop', `Heap not empty — cards remain. Smallest left: ${heap.peek()}.`, { 'minH[0]': heap.peek() });
      const first = heap.peek()!;
      cur = [];
      t.step('first', `first = ${first}: the smallest card cannot sit in the middle of a run, so it starts one.`, { first });
      if (firstAsked < 2) {
        firstAsked++;
        t.predict(
          'Which cards must this group use?',
          [`${span(first, first + groupSize - 1).join(', ')}`, `${first} plus the next ${groupSize - 1} smallest values in the heap`, `any ${groupSize} cards`],
          0,
          'Consecutive means exact values first, first+1, … — the heap only tells us where to start.',
        );
      }
      for (let i = first; i < first + groupSize; i++) {
        hl = [i];
        t.step('group', `Need a ${i}.`, { i });
        if (!count.has(i)) {
          t.step('missing', `No ${i} exists at all — the run ${first}..${first + groupSize - 1} breaks.`, { i });
          t.step('fail', 'False.', { result: false });
          return false;
        }
        count.set(i, count.get(i)! - 1);
        cur.push(i);
        t.step('use', `Use one ${i}; ${count.get(i)} left.`, { i, 'count[i]': count.get(i) });
        if (count.get(i) === 0) {
          t.step('zero', `${i} is used up.`, { i, 'minH[0]': heap.peek() });
          if (!zeroAsked || i !== heap.peek()) {
            zeroAsked = true;
            t.predict(
              `${i} ran out. Is it the heap's smallest value (minH[0] = ${heap.peek()})?`,
              ['Yes — pop it', 'No — impossible'],
              i === heap.peek() ? 0 : 1,
              i === heap.peek()
                ? 'Smallest value exhausted: drop it from the heap and move on.'
                : `${heap.peek()} still has cards but every group from now on starts above it… it can never be placed.`,
            );
          }
          if (i !== heap.peek()) {
            t.step('order', `${i} ≠ minH[0] = ${heap.peek()}: a smaller value still has cards but its runs would need ${i}.`, { i });
            t.step('gap', 'False.', { result: false });
            return false;
          }
          t.step('order', `${i} is the minimum — safe to remove.`, { i });
          heap.pop();
          t.step('pop', `Pop ${i}; next smallest is ${heap.peek() ?? '— (empty)'}.`, { 'minH[0]': heap.peek() ?? null });
        }
      }
      groups.push(`[${cur.join(',')}]`);
      cur = [];
      hl = [];
    }
    t.step('done', `Every card landed in a group of ${groupSize} — True.`, { result: true });
    return true;
  },
};

const mergeTriplets: Problem<{ triplets: number[][]; target: number[] }> = {
  id: 'merge-triplets-to-form-target-triplet',
  num: 1899,
  title: 'Merge Triplets to Form Target Triplet',
  difficulty: 'Medium',
  category: 'greedy',
  pattern: 'greedy',
  statement:
    'You may repeatedly merge two triplets by taking the element-wise maximum. Decide whether some sequence of merges can produce a given target triplet.',
  signals: ['the operation is element-wise max (values only grow)', '"can we obtain target"', 'order of merges does not matter', 'each position is independent'],
  insight:
    'Max can never shrink a value, so any triplet with a component above the target poisons the result — skip it. Among the rest, merging all of them is safe; just check that each target position is hit exactly by someone.',
  hints: [
    'What happens to a position once it becomes larger than the target?',
    'Ignore every triplet that exceeds the target anywhere.',
    'From the safe triplets, record which positions match the target exactly; you need all three.',
  ],
  pitfall: 'Requiring a single triplet that matches the target in all positions — different triplets can supply different positions.',
  backend: {
    title: 'Building a compatible version vector from replica snapshots',
    detail:
      'Replicas report version vectors and a merge takes the per-key max. To restore exactly target version (a, b, c) you may only merge snapshots that are not ahead of the target on any key; then check every key is reached by at least one snapshot — the same filter-then-cover logic used when picking backup segments for point-in-time recovery.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def mergeTriplets(triplets, target):
    good = set()                                    @init
    for t in triplets:                              @loop
        if t[0] > target[0] or t[1] > target[1] or t[2] > target[2]:   @skip
            continue                                @cont
        for i, v in enumerate(t):                   @each
            if v == target[i]:                      @match
                good.add(i)                         @add
    return len(good) == 3                           @done
`,
  explain: {
    init: 'Which target positions have been matched by a safe triplet.',
    skip: 'Max only grows values — one oversized component makes this triplet unusable forever.',
    match: 'A safe triplet that hits target[i] exactly can supply that position.',
    done: 'All three positions covered → merging all safe triplets gives exactly the target.',
  },
  distractors: [
    { text: '        if t == target:', why: 'No single triplet has to equal the target; different triplets may supply different positions.' },
    { text: '        if t[0] < target[0] or t[1] < target[1] or t[2] < target[2]:', why: 'Smaller components are harmless (max ignores them). Only components ABOVE the target are fatal.' },
    { text: '            if v >= target[i]:', why: 'v > target[i] was already filtered; with ≥ the intent is unclear and it hides the "exact match" requirement.' },
  ],
  input: { triplets: [[2, 5, 3], [1, 8, 4], [1, 7, 5]], target: [2, 7, 5] },
  presets: [
    { label: 'impossible', input: { triplets: [[3, 4, 5], [4, 5, 6]], target: [3, 2, 5] } },
    { label: 'needs three', input: { triplets: [[2, 5, 3], [2, 3, 4], [1, 2, 5], [5, 2, 3]], target: [5, 5, 5] } },
  ],
  validate: ({ triplets, target }) =>
    !Array.isArray(triplets) || !triplets.every((x) => isNums(x) && x.length === 3) || !isNums(target) || target.length !== 3
      ? 'Expected { triplets: number[3][], target: number[3] }'
      : triplets.length > 8
        ? 'Keep ≤ 8 triplets'
        : null,
  trace(t, { triplets, target }) {
    const good = new Set<number>();
    const rejected = new Set<number>();
    const matched = new Set<string>();
    let row = -1;
    let cell = -1;
    let asked = 0;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      triplets.forEach((tr, r) =>
        tr.forEach((v, c) => {
          const key = rc(r, c);
          if (rejected.has(r)) tn[key] = v > target[c] ? 'bad' : 'muted';
          else if (matched.has(key)) tn[key] = 'good';
          else if (r === row) tn[key] = c === cell ? 'warn' : 'active';
        }),
      );
      return [
        V.grid('triplets', triplets, { tones: tn, rowLabels: triplets.map((_, k) => `t${k}`), colLabels: ['[0]', '[1]', '[2]'], caption: 'red = exceeds target (row unusable) · green = matches target exactly' }),
        V.array('target', target, { tones: tones([...good], 'good') }),
        V.set('good (matched positions)', good),
      ];
    });
    t.step('init', 'No target position matched yet.', {});
    for (row = 0; row < triplets.length; row++) {
      const tr = triplets[row];
      cell = -1;
      t.step('loop', `Look at t${row} = [${tr.join(', ')}].`, { t: tr });
      const bad = tr.some((v, c) => v > target[c]);
      if (asked < 3) {
        asked++;
        t.predict(`Is t${row} safe to merge into the result?`, ['Yes', 'No — skip it'], bad ? 1 : 0, bad ? 'One component is above the target, and max can never bring it back down.' : 'Every component is ≤ the target, so merging it can never overshoot.');
      }
      if (bad) {
        rejected.add(row);
        const c = tr.findIndex((v, k) => v > target[k]);
        t.step('skip', `t${row}[${c}] = ${tr[c]} > target[${c}] = ${target[c]}: merging it would overshoot forever.`, { t: tr });
        t.step('cont', 'Skip this triplet.', {});
        continue;
      }
      t.step('skip', `Nothing in t${row} exceeds the target — it is safe.`, { t: tr });
      for (cell = 0; cell < 3; cell++) {
        const v = tr[cell];
        t.step('each', `Position ${cell}: ${v} vs target ${target[cell]}.`, { i: cell, v });
        if (v === target[cell]) {
          matched.add(rc(row, cell));
          good.add(cell);
          t.step('add', `Exact match — position ${cell} can be supplied. good = {${[...good].sort().join(', ')}}.`, { good: [...good] });
        }
      }
    }
    row = -1;
    const ok = good.size === 3;
    t.step('done', ok ? 'All three positions covered: merge every safe triplet → target. True.' : `Only positions {${[...good].sort().join(', ')}} can be matched — False.`, { result: ok });
    return ok;
  },
};

const partitionLabels: Problem<{ s: string }> = {
  id: 'partition-labels',
  num: 763,
  title: 'Partition Labels',
  difficulty: 'Medium',
  category: 'greedy',
  pattern: 'greedy',
  statement:
    'Cut a lowercase string into as many consecutive pieces as possible so that no letter shows up in more than one piece. Return the piece lengths in order.',
  signals: ['"each letter appears in at most one part"', '"as many parts as possible"', 'parts are contiguous and keep order', 'only 26 distinct letters'],
  insight:
    'A piece that contains letter c must stretch at least to c\'s LAST occurrence. Precompute last positions, grow the current piece\'s end to the max last-position seen, and cut the moment i reaches that end.',
  hints: [
    'If a piece contains an "a", where is the earliest it may end?',
    'Precompute the last index of every letter.',
    'Scan with end = max(end, last[c]); when i == end, nothing inside the piece appears later — cut.',
  ],
  pitfall: 'Cutting when the current character\'s last occurrence equals i, instead of when i reaches the max end of the whole piece.',
  backend: {
    title: 'Splitting a log stream into independent parallel chunks',
    detail:
      'A batch job wants to shard an ordered event log so that all events of one session id land in the same chunk (sessions must be processed together), with as many chunks as possible for parallelism. Precompute each session\'s last offset; sweep and cut whenever the current offset equals the furthest last-offset of sessions opened in this chunk.',
  },
  complexity: { time: 'O(n)', space: 'O(1) (≤ 26 letters)' },
  code: `
def partitionLabels(s):
    last = {c: i for i, c in enumerate(s)}    @last
    res = []                                  @init
    start = end = 0
    for i, c in enumerate(s):                 @loop
        end = max(end, last[c])               @extend
        if i == end:                          @check
            res.append(end - start + 1)       @cut
            start = i + 1                     @reset
    return res                                @done
`,
  explain: {
    last: 'Last position of every letter — one pass, at most 26 keys.',
    extend: 'This piece now contains c, so it must reach at least c\'s final occurrence.',
    check: 'When i reaches end, every letter seen in the piece has had its last occurrence inside it.',
    cut: 'Close the piece as early as possible to maximise the number of pieces.',
  },
  distractors: [
    { text: '        end = last[c]', why: 'Overwrites the end; an earlier letter may need the piece to go further. Use max.' },
    { text: '        if last[c] == i:', why: 'Only says THIS letter ends here — other letters in the piece may still appear later.' },
    { text: '            res.append(end - start)', why: 'Off by one: the piece start..end is inclusive, so its length is end − start + 1.' },
  ],
  input: { s: 'ababcbacadefegdehijhklij' },
  presets: [
    { label: 'one piece', input: { s: 'eccbbbbdec' } },
    { label: 'all distinct', input: { s: 'abcd' } },
  ],
  validate: ({ s }) =>
    typeof s !== 'string' || !/^[a-z]+$/.test(s) ? 'Expected { s: string } of lowercase letters' : s.length > 30 ? 'Keep s ≤ 30 characters' : null,
  trace(t, { s }) {
    const chars = [...s];
    const last = new Map<string, number>();
    const res: number[] = [];
    const parts: [number, number][] = [];
    let start = 0;
    let end = 0;
    let i = -1;
    let hl: string[] = [];
    let built = false;
    let moveAsked = 0;
    let cutAsked = false;
    t.draw(() => {
      const tn: Record<number, Tone> = {};
      parts.forEach(([a, b], k) => span(a, b).forEach((x) => (tn[x] = k % 2 ? 'info' : 'good')));
      if (i >= 0 && i < chars.length) tn[i] = 'active';
      return [
        V.array('s', chars, { pointers: { i: i >= 0 && i < chars.length ? i : null, end: i >= 0 ? end : null }, window: i >= 0 && start < chars.length ? [start, end] : null, tones: tn, caption: 'shaded = current piece (start..end) · coloured = finished pieces' }),
        built && V.map('last (letter → last index)', last, { hl }),
        V.chips('res', res, { tones: tones(res.map((_, k) => k), 'good') }),
      ];
    });
    chars.forEach((c, k) => last.set(c, k));
    built = true;
    t.step('last', 'Record the last index of every letter.', {});
    t.step('init', 'Start the first piece at 0.', { start, end });
    for (i = 0; i < chars.length; i++) {
      const c = chars[i];
      hl = [c];
      const willEnd = Math.max(end, last.get(c)!);
      end = willEnd;
      t.step('extend', `Read '${c}' (last at ${last.get(c)}). The piece must reach at least ${last.get(c)} → end = ${end}.`, { i, c, end });
      if (i === end && !cutAsked) {
        cutAsked = true;
        t.predict(`i = ${i}, end = ${end}. Can we cut the piece here?`, ['Yes', 'No'], 0, 'i reached end: every letter in this piece has already shown its last occurrence.');
      }
      if (i === end) {
        t.step('check', `i == end = ${end}: no letter in ${start}..${end} appears later — cut!`, { i, end });
        res.push(end - start + 1);
        parts.push([start, end]);
        t.step('cut', `Piece ${start}..${end} has length ${end - start + 1}.`, { res: [...res] });
        start = i + 1;
        t.step('reset', `Next piece starts at ${start}.`, { start });
      } else {
        t.step('check', `i = ${i} < end = ${end}: some letter in the piece still appears later — keep going.`, { i, end });
        const nx = chars[i + 1];
        if (nx !== undefined && moveAsked < 2 && last.get(nx)! > end) {
          moveAsked++;
          const opts = [...new Set([end, last.get(nx)!, i + 1].map(String))].sort((a, b) => Number(a) - Number(b));
          t.predict(`Next letter is '${nx}' (see the last map). What will end become?`, opts, opts.indexOf(String(last.get(nx))), `'${nx}' last appears at ${last.get(nx)}, beyond the current end ${end}, so the piece has to stretch.`);
        }
      }
    }
    i = chars.length;
    hl = [];
    t.step('done', `Return [${res.join(', ')}].`, { res });
    return res;
  },
};

const validParenthesisString: Problem<{ s: string }> = {
  id: 'valid-parenthesis-string',
  num: 678,
  title: 'Valid Parenthesis String',
  difficulty: 'Medium',
  category: 'greedy',
  pattern: 'greedy',
  statement:
    'A string holds "(", ")" and "*", where each "*" may act as "(", ")" or nothing. Decide whether some choice for the stars makes the parentheses balanced.',
  signals: ['wildcard that can be several things', '"is it possible to make it valid"', 'parentheses balance (open count)', 'trying all 3^k choices explodes'],
  insight:
    'Instead of tracking one open-count, track the RANGE [leftMin, leftMax] of open-counts reachable by some choice of stars. Fail if even the max goes negative; clamp the min at 0; succeed if 0 is reachable at the end.',
  hints: [
    'Without stars you keep one counter of open brackets. What does a star do to that counter?',
    'A star makes the counter one of three values — keep only the smallest and largest possible.',
    'leftMax < 0 → too many ")" no matter what. leftMin < 0 → reset to 0 (we would not choose that). Answer: leftMin == 0.',
  ],
  pitfall: 'Returning False as soon as leftMin < 0 — a star treated as ")" was merely a bad choice; clamp leftMin to 0 instead.',
  backend: {
    title: 'Validating partially-unknown open/close events',
    detail:
      'A connection tracker sees OPEN and CLOSE events, plus some events whose type was lost in a lossy log pipeline. To check whether the log could be consistent (never more closes than opens, all closed at the end), keep the min/max possible open-connection count instead of branching on every unknown — interval tracking under uncertainty.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def checkValidString(s):
    leftMin, leftMax = 0, 0                              @init
    for c in s:                                          @loop
        if c == "(":                                     @isOpen
            leftMin, leftMax = leftMin + 1, leftMax + 1  @open
        elif c == ")":                                   @isClose
            leftMin, leftMax = leftMin - 1, leftMax - 1  @close
        else:
            leftMin, leftMax = leftMin - 1, leftMax + 1  @star
        if leftMax < 0:                                  @tooMany
            return False                                 @fail
        leftMin = max(leftMin, 0)                        @clamp
    return leftMin == 0                                  @done
`,
  explain: {
    init: 'Range of possible unmatched "(" counts — starts at exactly 0.',
    star: 'A star could close one (min − 1) or open one (max + 1) or do nothing (in between).',
    tooMany: 'Even treating every star as "(" leaves more ")" than "(" — no choice can fix it.',
    clamp: 'A negative open-count is never valid; those star choices are simply discarded.',
    done: 'Valid iff zero open brackets is one of the reachable outcomes.',
  },
  distractors: [
    { text: '        if leftMin < 0: return False', why: 'leftMin < 0 only means "treating stars as ) went too far" — clamp to 0 rather than failing.' },
    { text: '    return leftMax == 0', why: 'leftMax counts stars as "("; the string is valid if 0 is merely reachable, i.e. leftMin == 0.' },
    { text: '            leftMin, leftMax = leftMin + 1, leftMax - 1', why: 'Backwards: a star can lower the minimum and raise the maximum, widening the range.' },
  ],
  input: { s: '((*)*)' },
  presets: [
    { label: 'leftover (', input: { s: '(*)*)(' } },
    { label: 'starts with )', input: { s: ')(' } },
    { label: 'star as )', input: { s: '(*' } },
  ],
  validate: ({ s }) => (typeof s !== 'string' || !/^[()*]*$/.test(s) ? 'Expected { s: string } of ( ) *' : s.length > 14 ? 'Keep s ≤ 14 characters' : null),
  trace(t, { s }) {
    let lo = 0;
    let hi = 0;
    let i = -1;
    let starAsked = false;
    let clampAsked = false;
    t.draw(() => {
      const tn: Record<number, Tone> = tones(span(0, i - 1), 'muted');
      if (i >= 0 && i < s.length) tn[i] = 'active';
      return [
        V.text('s', s, { tones: tn }),
        V.intervals('possible open "(" counts', [{ start: lo, end: hi, label: `[${lo}, ${hi}]`, tone: hi < 0 ? 'bad' : lo === 0 ? 'good' : 'info' }], {
          marker: 0,
          caption: 'every count in [leftMin, leftMax] is reachable by some choice of stars · marker = 0',
        }),
      ];
    });
    t.step('init', 'Before reading anything exactly 0 brackets are open: range [0, 0].', { leftMin: lo, leftMax: hi });
    for (i = 0; i < s.length; i++) {
      const c = s[i];
      t.step('loop', `Read '${c}' at index ${i}.`, { c, leftMin: lo, leftMax: hi });
      if (c === '*' && !starAsked) {
        starAsked = true;
        t.predict(
          `Range is [${lo}, ${hi}]. What does a '*' do to it?`,
          [`[${lo - 1}, ${hi + 1}] — it widens`, `[${lo + 1}, ${hi + 1}] — treat it as (`, `[${lo}, ${hi}] — ignore it`],
          0,
          'The star could close one bracket (min − 1), open one (max + 1) or vanish — the range covers all three.',
        );
      }
      if (c === '(') {
        t.step('isOpen', "It's an opening bracket.", { c });
        lo++;
        hi++;
        t.step('open', `Every outcome gains one open bracket → [${lo}, ${hi}].`, { leftMin: lo, leftMax: hi });
      } else if (c === ')') {
        t.step('isClose', "It's a closing bracket.", { c });
        lo--;
        hi--;
        t.step('close', `Every outcome closes one → [${lo}, ${hi}].`, { leftMin: lo, leftMax: hi });
      } else {
        lo--;
        hi++;
        t.step('star', `Star: could close (${lo}) or open (${hi}) or be empty → [${lo}, ${hi}].`, { leftMin: lo, leftMax: hi });
      }
      if (hi < 0) {
        t.step('tooMany', `leftMax = ${hi} < 0: even with every star as "(" there are more ")" than "(".`, { leftMax: hi });
        t.step('fail', 'False.', { result: false });
        return false;
      }
      t.step('tooMany', `leftMax = ${hi} ≥ 0 — still possible.`, { leftMax: hi });
      if (lo < 0 && !clampAsked) {
        clampAsked = true;
        t.predict(`leftMin is ${lo}. What happens?`, ['Return False', 'Clamp leftMin to 0', 'Keep it negative'], 1, 'A negative count just means some star choices were bad; we drop those choices, not the whole string.');
      }
      const was = lo;
      lo = Math.max(lo, 0);
      t.step('clamp', was < 0 ? `leftMin ${was} → 0: choices that over-close are discarded.` : `leftMin = ${lo} already ≥ 0.`, { leftMin: lo, leftMax: hi });
    }
    i = s.length;
    t.step('done', lo === 0 ? `0 is reachable (range [${lo}, ${hi}]) — True.` : `At least ${lo} "(" stay open in every choice — False.`, { result: lo === 0 });
    return lo === 0;
  },
};

export const problems: Problem[] = [
  maxSubarray,
  jumpGame,
  jumpGameII,
  gasStation,
  handOfStraights,
  mergeTriplets,
  partitionLabels,
  validParenthesisString,
];

export const variants: Variant[] = [
  {
    id: 'greedy-max-revenue-window',
    title: 'Best Contiguous Promotion Window',
    statement:
      'You have the daily net revenue change (can be negative) caused by a promotion. Marketing may run the promo for one contiguous block of days. Return the largest total net gain they could have achieved, and the start/end day.',
    pattern: 'greedy',
    nearest: 'maximum-subarray',
    signals: ['"one contiguous block"', 'values can be negative', 'maximise a sum', 'also need the boundaries'],
    approach: 'Kadane: keep the running sum and its start day; reset when the running sum drops below 0; update the best (sum, start, end) whenever it improves.',
    backend: 'Finding the worst contiguous error-budget burn (or best throughput window) in a time series for an SLO report.',
  },
  {
    id: 'greedy-cover-time-range-with-segments',
    title: 'Fewest Log Segments to Cover an Outage',
    statement:
      'Log segment files each cover a time range [start, end]. Pick the fewest segments whose union covers [0, T] completely, or return -1 if impossible.',
    pattern: 'greedy',
    nearest: 'jump-game-ii',
    signals: ['"fewest" pieces to cover a range', 'each piece reaches as far as its end', 'contiguous coverage required', 'levels of reachability'],
    approach:
      'Sort by start. Like Jump Game II: among segments starting ≤ the current covered end, take the farthest end; each time you must extend beyond the current end, count one segment. If no segment extends it, return -1.',
    backend: 'Choosing the minimum set of backup / WAL segments to download for a point-in-time restore of a database.',
  },
  {
    id: 'greedy-batch-consecutive-ids',
    title: 'Split Order IDs into Consecutive Batches',
    statement:
      'Given order ids (possibly duplicated across retries), decide whether they can be split into batches of exactly k consecutive ids, each id in one batch.',
    pattern: 'greedy',
    nearest: 'hand-of-straights',
    signals: ['"consecutive" groups of fixed size', 'every item used exactly once', 'duplicates'],
    approach: 'Count ids; repeatedly take the smallest remaining id (sorted keys or min-heap) and consume id..id+k−1 from the counts; fail on any missing id.',
    backend: 'Grouping sequence-numbered events into gap-free fixed-size batches before an idempotent bulk insert.',
  },
];
