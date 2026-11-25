import type { Problem, Tone, Variant } from '../engine/types.ts';
import { V, fmt, tones } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// 1-D dynamic programming. Every trace shows the dp array filling left→right (or right→left):
// the cell being computed is 'active', the cells the recurrence READS are 'info'.
// ---------------------------------------------------------------------------

/** Tone map for a 1-D dp row: `reads` → info, `at` → active (or a custom tone). */
function mark(at: number | null, reads: readonly number[], atTone: Tone = 'active'): Record<number, Tone> {
  const out: Record<number, Tone> = {};
  for (const r of reads) if (r >= 0) out[r] = 'info';
  if (at !== null && at >= 0) out[at] = atTone;
  return out;
}

/** Build de-duplicated, numerically sorted multiple-choice options; returns [options, answerIndex]. */
function choices(correct: unknown, wrong: readonly unknown[]): [string[], number] {
  const opts: string[] = [];
  for (const v of [correct, ...wrong]) {
    const s = fmt(v);
    if (!opts.includes(s) && opts.length < 4) opts.push(s);
  }
  const num = (s: string) => (s === '∞' ? Infinity : s === '-∞' ? -Infinity : Number(s));
  if (opts.every((s) => !Number.isNaN(num(s)))) opts.sort((a, b) => num(a) - num(b));
  return [opts, opts.indexOf(fmt(correct))];
}

/** Show only the cells computed so far; the rest render as '·'. */
const shown = (dp: readonly unknown[], isFilled: (k: number) => boolean) => dp.map((v, k) => (isFilled(k) ? v : '·'));

const isIntArray = (a: unknown): a is number[] => Array.isArray(a) && a.every((x) => Number.isInteger(x));

// ---------------------------------------------------------------------------

const climbingStairs: Problem<{ n: number }> = {
  id: 'climbing-stairs',
  num: 70,
  title: 'Climbing Stairs',
  difficulty: 'Easy',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement:
    'A staircase has n steps and each move climbs either 1 or 2 of them. Count how many different move sequences take you from the ground exactly to the top.',
  signals: ['"how many distinct ways"', 'each move has a small fixed set of sizes (1 or 2)', 'answer for n depends on answers for n−1 and n−2', 'brute-force recursion repeats the same sub-counts'],
  insight:
    'The last move onto step i was either a 1-step from i−1 or a 2-step from i−2, so ways(i) = ways(i−1) + ways(i−2). Fill those answers bottom-up and each one is computed exactly once.',
  hints: [
    'Think about the very last move you make onto step i.',
    'Every route to i ends with "+1 from i−1" or "+2 from i−2" — and those two groups never overlap.',
    'dp[i] = dp[i−1] + dp[i−2] with dp[0] = dp[1] = 1. (It is Fibonacci.)',
  ],
  pitfall: 'Plain recursion without memoisation recomputes the same steps exponentially often (O(2ⁿ)); also forgetting dp[0] = 1 gives dp[2] = 1 instead of 2.',
  backend: {
    title: 'Counting retry schedules for a job runner',
    detail:
      'A job scheduler can advance a backoff timeline by 1 or 2 ticks per retry; capacity planning asks how many distinct retry schedules fill exactly n ticks. The tick counter is the dp index and each tick count is the sum of the two shorter schedules — the same bottom-up table avoids enumerating every schedule.',
  },
  complexity: { time: 'O(n)', space: 'O(n) (O(1) with two variables)' },
  code: `
def climbStairs(n):
    dp = [0] * (n + 1)                   @init
    dp[0], dp[1] = 1, 1                  @seed
    for i in range(2, n + 1):            @loop
        dp[i] = dp[i - 1] + dp[i - 2]    @calc
    return dp[n]                         @done
`,
  explain: {
    init: 'dp[i] = number of distinct ways to land exactly on step i.',
    seed: 'One way to "be" on the ground (do nothing) and one way to reach step 1 (a single 1-step).',
    loop: 'Bottom-up: when we compute step i, steps i−1 and i−2 are already final.',
    calc: 'Last move was a 1-step (from i−1) or a 2-step (from i−2): add the two disjoint groups.',
  },
  distractors: [
    { text: '        dp[i] = dp[i - 1] * dp[i - 2]', why: 'The two groups of routes are alternatives (OR), so their counts add; multiplying would count pairs of routes.' },
    { text: '    for i in range(2, n):', why: 'Off-by-one: range stops before n, so dp[n] is never filled and the function returns 0.' },
    { text: '        dp[i] = dp[i - 1] + 1', why: 'Adding 1 counts "one more step" rather than the number of routes that could have come from i−2.' },
  ],
  input: { n: 7 },
  presets: [
    { label: 'n = 1', input: { n: 1 } },
    { label: 'n = 3', input: { n: 3 } },
    { label: 'n = 10', input: { n: 10 } },
  ],
  validate: ({ n }) => (!Number.isInteger(n) ? 'Expected { n: integer }' : n < 1 || n > 25 ? 'Keep 1 ≤ n ≤ 25' : null),
  trace(t, { n }) {
    const dp: number[] = new Array(n + 1).fill(0);
    let i = -1;
    let filled = -1;
    let reads: number[] = [];
    let finished = false;
    t.draw(() => [
      V.array('dp (ways to land on step i)', shown(dp, (k) => k <= filled), {
        pointers: { i: i >= 0 ? i : null },
        tones: mark(i, reads, finished ? 'good' : 'active'),
      }),
    ]);
    t.step('init', `Create dp with ${n + 1} slots (steps 0…${n}). dp[i] will hold the number of ways to land exactly on step i.`, { n });
    dp[0] = 1;
    dp[1] = 1;
    filled = 1;
    t.step('seed', 'Base cases: dp[0] = 1 (standing on the ground is one way — do nothing) and dp[1] = 1 (a single 1-step).', { 'dp[0]': 1, 'dp[1]': 1 });
    for (i = 2; i <= n; i++) {
      reads = [i - 1, i - 2];
      t.step('loop', `Step ${i}: the last move onto it came from step ${i - 1} (a 1-step) or step ${i - 2} (a 2-step). Both are already final.`, { i });
      const val = dp[i - 1] + dp[i - 2];
      if (i === 3 || (i === n && n >= 6)) {
        const [o, a] = choices(val, [dp[i - 1], dp[i - 1] * 2, dp[i - 1] + 1]);
        t.predict(`What is dp[${i}]?`, o, a, `dp[${i}] = dp[${i - 1}] + dp[${i - 2}] = ${dp[i - 1]} + ${dp[i - 2]} = ${val}.`);
      }
      dp[i] = val;
      filled = i;
      t.step('calc', `dp[${i}] = dp[${i - 1}] + dp[${i - 2}] = ${dp[i - 1]} + ${dp[i - 2]} = ${val}.`, { i, 'dp[i-1]': dp[i - 1], 'dp[i-2]': dp[i - 2], 'dp[i]': val });
    }
    i = n;
    reads = [];
    finished = true;
    t.step('done', `dp[${n}] = ${dp[n]} distinct ways to reach the top.`, { result: dp[n] });
    return dp[n];
  },
};

// ---------------------------------------------------------------------------

const minCostClimbingStairs: Problem<{ cost: number[] }> = {
  id: 'min-cost-climbing-stairs',
  num: 746,
  title: 'Min Cost Climbing Stairs',
  difficulty: 'Easy',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement:
    'Each stair i charges cost[i] when you step off it, and from it you may climb 1 or 2 stairs. You may start on stair 0 or 1. Return the cheapest total to get past the last stair.',
  signals: ['"minimum cost to reach the top"', 'choice between 1 or 2 steps at each point', 'optimal answer at i built from optimal answers at i−1 and i−2'],
  insight:
    'The cheapest way to stand on stair i is the cheaper of arriving from i−1 (paying cost[i−1]) or from i−2 (paying cost[i−2]). The top is just index n.',
  hints: [
    'Define dp[i] = cheapest cost to be standing on stair i (before paying stair i).',
    'You can start on 0 or 1 for free, so dp[0] = dp[1] = 0.',
    'dp[i] = min(dp[i−1] + cost[i−1], dp[i−2] + cost[i−2]); the answer is dp[n].',
  ],
  pitfall: 'Returning dp[n−1] — the top is one past the last stair, so the answer lives at index n.',
  backend: {
    title: 'Cheapest hop sequence through a pipeline of proxies',
    detail:
      'A request can traverse a chain of edge proxies, skipping at most one hop each time, and every proxy it lands on adds a known processing cost. The proxy index is the dp index; dp[i] = cheapest cost of having reached proxy i, taking min over the two possible previous hops — exactly this recurrence.',
  },
  complexity: { time: 'O(n)', space: 'O(n) (O(1) possible)' },
  code: `
def minCostClimbingStairs(cost):
    n = len(cost)
    dp = [0] * (n + 1)                   @init
    for i in range(2, n + 1):            @loop
        one = dp[i - 1] + cost[i - 1]    @one
        two = dp[i - 2] + cost[i - 2]    @two
        dp[i] = min(one, two)            @calc
    return dp[n]                         @done
`,
  explain: {
    init: 'dp[0] = dp[1] = 0 because you may start on either stair for free. Index n is the top.',
    one: 'Arrive with a 1-step from i−1, paying the stair you leave.',
    two: 'Arrive with a 2-step from i−2, paying that stair instead.',
    calc: 'Keep only the cheaper way in — that is the optimal-substructure step.',
  },
  distractors: [
    { text: '    return dp[n - 1]', why: 'The top is beyond the last stair: index n, not n−1.' },
    { text: '        dp[i] = min(dp[i - 1], dp[i - 2]) + cost[i]', why: 'Pays the cost of the stair you land on, and cost[n] does not exist — the cost is paid when you LEAVE a stair.' },
    { text: '        dp[i] = max(one, two)', why: 'We want the cheapest route, so take the min.' },
  ],
  input: { cost: [1, 100, 1, 1, 1, 100, 1, 1, 100, 1] },
  presets: [
    { label: 'three stairs', input: { cost: [10, 15, 20] } },
    { label: 'two stairs', input: { cost: [5, 3] } },
  ],
  validate: ({ cost }) => (!isIntArray(cost) ? 'Expected { cost: integer[] }' : cost.length < 2 || cost.length > 14 ? 'Keep 2 ≤ len(cost) ≤ 14' : null),
  trace(t, { cost }) {
    const n = cost.length;
    const dp: number[] = new Array(n + 1).fill(0);
    let i = -1;
    let filled = -1;
    let reads: number[] = [];
    let finished = false;
    t.draw(() => [
      V.array('cost', cost, { tones: mark(null, reads) }),
      V.array('dp (cheapest cost to stand on stair i; index n = top)', shown(dp, (k) => k <= filled), {
        pointers: { i: i >= 0 ? i : null },
        tones: mark(i, reads, finished ? 'good' : 'active'),
      }),
    ]);
    filled = 1;
    t.step('init', `dp has ${n + 1} slots; index ${n} is the top. dp[0] = dp[1] = 0 because you may start on stair 0 or 1 for free.`, { n });
    let asked = 0;
    for (i = 2; i <= n; i++) {
      reads = [];
      t.step('loop', `Stair ${i}${i === n ? ' (the top)' : ''}: you arrive either from ${i - 1} or from ${i - 2}.`, { i });
      reads = [i - 1];
      const one = dp[i - 1] + cost[i - 1];
      t.step('one', `From stair ${i - 1}: dp[${i - 1}] + cost[${i - 1}] = ${dp[i - 1]} + ${cost[i - 1]} = ${one}.`, { i, one });
      reads = [i - 2];
      const two = dp[i - 2] + cost[i - 2];
      t.step('two', `From stair ${i - 2}: dp[${i - 2}] + cost[${i - 2}] = ${dp[i - 2]} + ${cost[i - 2]} = ${two}.`, { i, one, two });
      if (asked < 3 && one !== two && (i === 2 || i === 3 || i === n)) {
        asked++;
        t.predict(`Which arrival into stair ${i} is cheaper?`, [`from ${i - 1} (one = ${one})`, `from ${i - 2} (two = ${two})`], one < two ? 0 : 1, `min(${one}, ${two}) = ${Math.min(one, two)}.`);
      }
      dp[i] = Math.min(one, two);
      filled = i;
      reads = [one <= two ? i - 1 : i - 2];
      t.step('calc', `dp[${i}] = min(dp[${i - 1}]+cost[${i - 1}]=${one}, dp[${i - 2}]+cost[${i - 2}]=${two}) = ${dp[i]}.`, { i, one, two, 'dp[i]': dp[i] });
    }
    i = n;
    reads = [];
    finished = true;
    t.step('done', `The top (index ${n}) costs ${dp[n]} at minimum.`, { result: dp[n] });
    return dp[n];
  },
};

// ---------------------------------------------------------------------------

const houseRobber: Problem<{ nums: number[] }> = {
  id: 'house-robber',
  num: 198,
  title: 'House Robber',
  difficulty: 'Medium',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement:
    'Houses along a street hold given amounts of cash. You may not take from two adjacent houses. Return the largest total you can collect.',
  signals: ['"maximise total" with a "no two adjacent" rule', 'each element is take-or-skip', 'greedy (take the biggest) fails'],
  insight:
    'At house i you either skip it (keep the best for the first i−1 houses) or take it (its cash plus the best for the first i−2). dp[i] = max(dp[i−1], dp[i−2] + nums[i]).',
  hints: [
    'For each house there are only two choices. What does each choice rule out?',
    'Taking house i forbids house i−1, so you build on the best answer up to i−2.',
    'dp[i] = max(dp[i−1], dp[i−2] + nums[i]); seed dp[0] = nums[0], dp[1] = max(nums[0], nums[1]).',
  ],
  pitfall: 'Seeding dp[1] = nums[1] instead of max(nums[0], nums[1]) — dp[i] means "best using houses 0…i", not "best that robs house i".',
  backend: {
    title: 'Scheduling maintenance on adjacent shards',
    detail:
      'A DB fleet wants to run heavy compaction on shards laid out in a ring-free sequence, but two neighbouring shards (which share replicas) must not compact in the same window. Each shard has a "space reclaimed" value; dp over the shard list picks the non-adjacent set with the largest total reclaimed.',
  },
  complexity: { time: 'O(n)', space: 'O(n) (O(1) with two variables)' },
  code: `
def rob(nums):
    if len(nums) == 1:                   @single
        return nums[0]                   @ret1
    dp = [0] * len(nums)                 @init
    dp[0] = nums[0]                      @seed0
    dp[1] = max(nums[0], nums[1])        @seed1
    for i in range(2, len(nums)):        @loop
        dp[i] = max(dp[i - 1], dp[i - 2] + nums[i])   @calc
    return dp[-1]                        @done
`,
  explain: {
    init: 'dp[i] = most cash obtainable from houses 0…i (house i may or may not be robbed).',
    seed1: 'With two houses you can only take one of them — the bigger.',
    calc: 'Skip house i → dp[i−1]. Rob it → its cash + dp[i−2] (house i−1 is forbidden).',
  },
  distractors: [
    { text: '        dp[i] = dp[i - 2] + nums[i]', why: 'Forces robbing every house i; sometimes skipping it (dp[i−1]) is better.' },
    { text: '    dp[1] = nums[1]', why: 'dp[1] is the best over houses 0..1, which might be house 0 alone.' },
    { text: '        dp[i] = max(dp[i - 1], dp[i - 1] + nums[i])', why: 'Building on dp[i−1] may include house i−1, which is adjacent to i.' },
  ],
  input: { nums: [2, 7, 9, 3, 1, 5] },
  presets: [
    { label: 'two houses', input: { nums: [3, 8] } },
    { label: 'alternating', input: { nums: [5, 1, 1, 5] } },
    { label: 'classic', input: { nums: [1, 2, 3, 1] } },
  ],
  validate: ({ nums }) => (!isIntArray(nums) ? 'Expected { nums: integer[] }' : nums.length < 1 || nums.length > 12 ? 'Keep 1 ≤ len(nums) ≤ 12' : null),
  trace(t, { nums }) {
    const n = nums.length;
    const dp: number[] = new Array(n).fill(0);
    let i = -1;
    let filled = -1;
    let reads: number[] = [];
    let chosen: number[] = [];
    t.draw(() => [
      V.array('nums (cash per house)', nums, { pointers: { i: i >= 0 && i < n ? i : null }, tones: { ...mark(chosen.length ? null : i, chosen.length ? [] : reads.filter((r) => r === i - 2)), ...tones(chosen, 'good') } }),
      V.array('dp (best total using houses 0..i)', shown(dp, (k) => k <= filled), { pointers: { i: i >= 0 && i < n ? i : null }, tones: chosen.length ? { [n - 1]: 'good' } : mark(i, reads) }),
    ]);
    t.step('single', `There are ${n} house${n === 1 ? '' : 's'}.`, { n });
    if (n === 1) {
      t.step('ret1', `Only one house: take its ${nums[0]}.`, { result: nums[0] });
      return nums[0];
    }
    t.step('init', 'dp[i] will hold the best total from houses 0…i — whether or not house i itself is robbed.');
    i = 0;
    dp[0] = nums[0];
    filled = 0;
    t.step('seed0', `dp[0] = ${nums[0]}: with one house, rob it.`, { 'dp[0]': dp[0] });
    i = 1;
    dp[1] = Math.max(nums[0], nums[1]);
    filled = 1;
    reads = [0];
    t.step('seed1', `dp[1] = max(${nums[0]}, ${nums[1]}) = ${dp[1]}: they are neighbours, so only one of them.`, { 'dp[1]': dp[1] });
    let asked = 0;
    for (i = 2; i < n; i++) {
      reads = [i - 1, i - 2];
      const skip = dp[i - 1];
      const take = dp[i - 2] + nums[i];
      t.step('loop', `House ${i} (cash ${nums[i]}): skip it → keep dp[${i - 1}] = ${skip}; rob it → nums[${i}] + dp[${i - 2}] = ${nums[i]} + ${dp[i - 2]} = ${take}.`, { i, skip, take });
      if (asked < 3 && (i === 2 || i === 3 || i === n - 1)) {
        asked++;
        if (i === n - 1 && asked > 2) {
          const [o, a] = choices(Math.max(skip, take), [Math.min(skip, take), skip + nums[i], nums[i]]);
          t.predict(`What is dp[${i}]?`, o, a, `max(${skip}, ${take}) = ${Math.max(skip, take)}.`);
        } else {
          t.predict(`Rob house ${i} or skip it?`, [`Rob (${take})`, `Skip (${skip})`], take > skip ? 0 : 1, take > skip ? `${take} > ${skip}: robbing beats keeping dp[${i - 1}].` : `${skip} ≥ ${take}: skipping keeps the better total.`);
        }
      }
      dp[i] = Math.max(skip, take);
      filled = i;
      reads = [take > skip ? i - 2 : i - 1];
      t.step('calc', `dp[${i}] = max(dp[${i - 1}]=${skip}, dp[${i - 2}]+nums[${i}]=${dp[i - 2]}+${nums[i]}=${take}) = ${dp[i]}.`, { i, 'dp[i]': dp[i] });
    }
    // Walk back through the table to show which houses were robbed.
    const pick: number[] = [];
    for (let k = n - 1; k >= 0; ) {
      if (k === 0 || (k >= 1 && dp[k] !== dp[k - 1])) {
        pick.push(k);
        k -= 2;
      } else k -= 1;
    }
    chosen = pick.reverse();
    i = n;
    reads = [];
    t.step('done', `Best total = dp[${n - 1}] = ${dp[n - 1]} (rob houses ${chosen.join(', ')}).`, { result: dp[n - 1], houses: chosen });
    return dp[n - 1];
  },
};

// ---------------------------------------------------------------------------

const houseRobberII: Problem<{ nums: number[] }> = {
  id: 'house-robber-ii',
  num: 213,
  title: 'House Robber II',
  difficulty: 'Medium',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement:
    'Same as House Robber, but the houses stand in a circle, so the first and last houses are also neighbours. Return the largest total you can collect without robbing two adjacent houses.',
  signals: ['"arranged in a circle" / wrap-around adjacency', 'take-or-skip with no two adjacent', 'reduce a circular constraint to linear sub-problems'],
  insight:
    'First and last can never both be robbed, so the answer is the better of two straight-line problems: houses 0…n−2 (drop the last) and houses 1…n−1 (drop the first).',
  hints: [
    'What is the only extra conflict compared to the straight street?',
    'At least one of house 0 and house n−1 is NOT robbed — try both possibilities.',
    'Run the linear House Robber on nums[:-1] and nums[1:] and take the max.',
  ],
  pitfall: 'Forgetting the single-house case: nums[1:] and nums[:-1] are both empty, so the answer would wrongly be 0.',
  backend: {
    title: 'Picking on-call days in a weekly rotation',
    detail:
      'An on-call rota repeats weekly, so Sunday is adjacent to the next Monday. Each day has a "coverage value" and nobody may be paged two days in a row. Breaking the cycle (exclude Monday, or exclude Sunday) gives two linear dp passes over days — the max is the best rota.',
  },
  complexity: { time: 'O(n)', space: 'O(n) (O(1) possible)' },
  code: `
def rob(nums):
    if len(nums) == 1:                    @single
        return nums[0]                    @ret1
    a = robLine(nums[:-1])                @skipLast
    b = robLine(nums[1:])                 @skipFirst
    return max(a, b)                      @done

def robLine(h):
    dp = [0] * (len(h) + 1)               @init
    dp[1] = h[0]                          @seed
    for i in range(2, len(h) + 1):        @loop
        dp[i] = max(dp[i - 1], dp[i - 2] + h[i - 1])   @calc
    return dp[-1]                         @ret
`,
  explain: {
    skipLast: 'Case A: house n−1 is never robbed, so the circle becomes a line 0…n−2.',
    skipFirst: 'Case B: house 0 is never robbed, so the line is 1…n−1.',
    init: 'dp[i] = best total from the first i houses of this line (dp[0] = 0 houses → 0).',
    calc: 'Skip house i−1 → dp[i−1], or rob it → h[i−1] + dp[i−2].',
  },
  distractors: [
    { text: '    return robLine(nums)', why: 'Ignores the wrap-around: it may rob both house 0 and house n−1.' },
    { text: '    b = robLine(nums[1:-1])', why: 'Dropping both ends throws away valid answers that rob exactly one end.' },
    { text: '    return a + b', why: 'The two cases are alternatives, not parts — take the better one, not the sum.' },
  ],
  input: { nums: [2, 7, 9, 3, 1, 6] },
  presets: [
    { label: 'three houses', input: { nums: [2, 3, 2] } },
    { label: 'four houses', input: { nums: [1, 2, 3, 1] } },
  ],
  validate: ({ nums }) => (!isIntArray(nums) ? 'Expected { nums: integer[] }' : nums.length < 1 || nums.length > 12 ? 'Keep 1 ≤ len(nums) ≤ 12' : null),
  trace(t, { nums }) {
    const n = nums.length;
    let lo = -1;
    let hi = -1;
    let dpA: number[] | null = null;
    let dpB: number[] | null = null;
    let cur: 'A' | 'B' | null = null;
    let i = -1;
    let filled = -1;
    let reads: number[] = [];
    let winner: 'A' | 'B' | null = null;
    const houseOf = (k: number) => lo + k - 1;
    t.draw(() => {
      const hTones: Record<number, Tone> = {};
      if (cur === 'A' && n > 1) hTones[n - 1] = 'muted';
      if (cur === 'B') hTones[0] = 'muted';
      if (cur && i >= 1) hTones[houseOf(i)] = 'active';
      const dpViz = (which: 'A' | 'B', dp: number[] | null) =>
        dp &&
        V.array(which === 'A' ? 'dp A (houses 0..n−2)' : 'dp B (houses 1..n−1)', shown(dp, (k) => cur !== which || k <= filled), {
          pointers: { i: cur === which && i >= 0 ? i : null },
          tones: winner ? (winner === which ? { [dp.length - 1]: 'good' } : {}) : cur === which ? mark(i, reads) : {},
        });
      return [
        V.array('nums (houses in a circle)', nums, { tones: hTones, window: cur ? [lo, hi] : null }),
        dpViz('A', dpA),
        dpViz('B', dpB),
      ];
    });
    t.step('single', `${n} house${n === 1 ? '' : 's'} in a circle${n > 1 ? `: house 0 and house ${n - 1} are neighbours` : ''}.`, { n });
    if (n === 1) {
      t.step('ret1', `One house — take ${nums[0]}.`, { result: nums[0] });
      return nums[0];
    }
    const robLine = (which: 'A' | 'B', start: number, end: number): number => {
      const h = nums.slice(start, end + 1);
      const dp: number[] = new Array(h.length + 1).fill(0);
      if (which === 'A') dpA = dp;
      else dpB = dp;
      cur = which;
      lo = start;
      hi = end;
      i = 0;
      filled = 0;
      reads = [];
      t.step('init', `Case ${which}: dp over houses ${start}…${end}. dp[k] = best from the first k of them; dp[0] = 0.`, { case: which });
      i = 1;
      dp[1] = h[0];
      filled = 1;
      t.step('seed', `dp[1] = h[0] = ${h[0]} (house ${start} alone).`, { 'dp[1]': dp[1] });
      for (i = 2; i <= h.length; i++) {
        reads = [i - 1, i - 2];
        const skip = dp[i - 1];
        const take = dp[i - 2] + h[i - 1];
        t.step('loop', `Next house ${houseOf(i)} (cash ${h[i - 1]}). Skip → dp[${i - 1}] = ${skip}; rob → ${h[i - 1]} + dp[${i - 2}] = ${take}.`, { i, skip, take });
        if (which === 'B' && i === 3) {
          const [o, a] = choices(Math.max(skip, take), [Math.min(skip, take), skip + h[i - 1], h[i - 1]]);
          t.predict(`What is dp B[${i}]?`, o, a, `max(${skip}, ${take}) = ${Math.max(skip, take)}.`);
        }
        dp[i] = Math.max(skip, take);
        filled = i;
        reads = [take > skip ? i - 2 : i - 1];
        t.step('calc', `dp[${i}] = max(${skip}, ${dp[i - 2]}+${h[i - 1]}=${take}) = ${dp[i]}.`, { i, 'dp[i]': dp[i] });
      }
      i = h.length;
      reads = [];
      t.step('ret', `Case ${which} best = dp[${h.length}] = ${dp[h.length]}.`, { [`case ${which}`]: dp[h.length] });
      return dp[h.length];
    };
    t.step('skipLast', `Case A: never rob house ${n - 1}, so the circle opens into the line 0…${n - 2}.`);
    const a = robLine('A', 0, n - 2);
    cur = null;
    i = -1;
    t.step('skipFirst', `Case A gave ${a}. Case B: never rob house 0, so the line is 1…${n - 1}.`, { a });
    const b = robLine('B', 1, n - 1);
    t.predict('Which case wins?', ['Case A (skip last)', 'Case B (skip first)', 'Tie'], a > b ? 0 : b > a ? 1 : 2, `A = ${a}, B = ${b}.`);
    cur = null;
    i = -1;
    winner = a >= b ? 'A' : 'B';
    const res = Math.max(a, b);
    t.step('done', `max(A=${a}, B=${b}) = ${res}.`, { a, b, result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

/** Length of the palindrome grown from (l, r). */
function palSpan(s: string, l: number, r: number): [number, number] {
  while (l >= 0 && r < s.length && s[l] === s[r]) {
    l--;
    r++;
  }
  return [l + 1, r - 1];
}

const longestPalindromicSubstring: Problem<{ s: string }> = {
  id: 'longest-palindromic-substring',
  num: 5,
  title: 'Longest Palindromic Substring',
  difficulty: 'Medium',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement: 'Given a string, return its longest contiguous piece that reads the same forwards and backwards.',
  signals: ['"longest palindromic substring"', 'contiguous piece of a string', 'a palindrome stays a palindrome when you peel matching ends'],
  insight:
    'Every palindrome has a centre (one char or a gap between two). Grow outwards from all 2n−1 centres while the ends match; each expansion reuses "inner part is a palindrome" — the dp fact — without storing a table.',
  hints: [
    'If s[l..r] is a palindrome, when is s[l−1..r+1] one?',
    'Instead of checking every substring, start from a centre and expand.',
    'Try both odd centres (i, i) and even centres (i, i+1); record the widest span.',
  ],
  pitfall: 'Only trying odd-length centres — misses even palindromes like "abba".',
  backend: {
    title: 'Detecting mirrored payload segments in packet captures',
    detail:
      'A network IDS flags payloads containing long symmetric byte runs (a signature of some padding attacks). Expanding from each byte offset finds the longest mirrored region in O(n²) time and O(1) memory — important when scanning many packets on a hot path without allocating a table.',
  },
  complexity: { time: 'O(n²)', space: 'O(1)' },
  code: `
def longestPalindrome(s):
    res, resLen = "", 0                                   @init
    for i in range(len(s)):                               @loop
        for l, r in ((i, i), (i, i + 1)):                 @center
            while l >= 0 and r < len(s) and s[l] == s[r]: @expand
                if r - l + 1 > resLen:                    @better
                    res, resLen = s[l:r + 1], r - l + 1   @record
                l, r = l - 1, r + 1                       @grow
    return res                                            @done
`,
  explain: {
    center: 'Odd centre (i, i) and even centre (i, i+1).',
    expand: 'Ends match and the inside is already a palindrome → the wider span is a palindrome too.',
    record: 'Keep the longest span seen so far.',
    grow: 'Peel outward by one on each side.',
  },
  distractors: [
    { text: '        for l, r in ((i, i),):', why: 'Odd centres only — even-length palindromes such as "abba" are never found.' },
    { text: '            if s[l] == s[r]:', why: '`if` checks only one expansion; the palindrome must keep growing while the ends match.' },
    { text: '                l, r = l + 1, r - 1', why: 'Moves the ends inward — expansion must go outward from the centre.' },
  ],
  input: { s: 'babadada' },
  presets: [
    { label: 'even palindrome', input: { s: 'cbbd' } },
    { label: 'all same', input: { s: 'aaaa' } },
    { label: 'single char', input: { s: 'x' } },
  ],
  validate: ({ s }) => (typeof s !== 'string' ? 'Expected { s: string }' : s.length < 1 || s.length > 12 ? 'Keep 1 ≤ len(s) ≤ 12' : null),
  trace(t, { s }) {
    let res = '';
    let bl = -1;
    let br = -1;
    let l = -1;
    let r = -1;
    let fail = false;
    let finished = false;
    t.draw(() => {
      const tn: Record<number, Tone> = {};
      for (let k = bl; k >= 0 && k <= br; k++) tn[k] = 'good';
      if (!finished) {
        for (let k = Math.max(l + 1, 0); k < r && k < s.length; k++) if (fail) tn[k] = 'info';
        if (!fail) for (let k = Math.max(l, 0); k <= r && k < s.length; k++) tn[k] = 'active';
        if (fail) {
          if (l >= 0 && l < s.length) tn[l] = 'bad';
          if (r >= 0 && r < s.length) tn[r] = 'bad';
        }
      }
      return [V.text('s', s, { tones: tn, caption: finished ? undefined : `l = ${l}, r = ${r}` }), V.chips('res (best so far)', res ? [res] : [], { tones: { 0: 'good' } })];
    });
    t.step('init', 'No palindrome recorded yet. We will try every centre and grow outward.', { res, resLen: 0 });
    let askedEven = false;
    let askedLen = 0;
    for (let i = 0; i < s.length; i++) {
      l = i;
      r = i - 1;
      fail = false;
      t.step('loop', `Centres around index ${i} ('${s[i]}').`, { i });
      for (const [l0, r0] of [
        [i, i],
        [i, i + 1],
      ]) {
        l = l0;
        r = r0;
        fail = false;
        const odd = l0 === r0;
        t.step('center', `${odd ? 'Odd' : 'Even'} centre: l = ${l}, r = ${r}.`, { i, l, r });
        const [pl, pr] = palSpan(s, l0, r0);
        const plen = Math.max(0, pr - pl + 1);
        if (!odd && !askedEven && r0 < s.length) {
          askedEven = true;
          t.predict(`Will the even centre (${l0}, ${r0}) expand at all?`, ['Yes', 'No'], s[l0] === s[r0] ? 0 : 1, s[l0] === s[r0] ? `s[${l0}] = s[${r0}] = '${s[l0]}'.` : `'${s[l0]}' ≠ '${s[r0]}'.`);
        } else if (odd && askedLen < 2 && plen >= 3 && plen > res.length) {
          askedLen++;
          const [o, a] = choices(plen, [1, plen - 2, plen + 2]);
          t.predict(`How long a palindrome will grow around centre ${i}?`, o, a, `It grows to s[${pl}..${pr}] = '${s.slice(pl, pr + 1)}' (length ${plen}).`);
        }
        while (l >= 0 && r < s.length && s[l] === s[r]) {
          t.step('expand', `s[${l}] = s[${r}] = '${s[l]}' → s[${l}..${r}] = '${s.slice(l, r + 1)}' is a palindrome.`, { l, r });
          if (r - l + 1 > res.length) {
            res = s.slice(l, r + 1);
            bl = l;
            br = r;
            t.step('record', `Length ${r - l + 1} beats the old best → res = '${res}'.`, { res, resLen: res.length });
          }
          l--;
          r++;
        }
        fail = true;
        const why = l < 0 || r >= s.length ? 'the span hit the edge of the string' : `s[${l}] = '${s[l]}' ≠ s[${r}] = '${s[r]}'`;
        t.step('expand', `Stop: ${why}.`, { l, r });
      }
    }
    finished = true;
    t.step('done', `Longest palindrome: '${res}' (length ${res.length}).`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const palindromicSubstrings: Problem<{ s: string }> = {
  id: 'palindromic-substrings',
  num: 647,
  title: 'Palindromic Substrings',
  difficulty: 'Medium',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement: 'Count how many contiguous substrings of a string are palindromes. Substrings at different positions count separately even if they look the same.',
  signals: ['"count palindromic substrings"', 'contiguous pieces of a string', 'inner palindrome + matching ends ⇒ outer palindrome'],
  insight:
    'Each successful outward step from a centre is exactly one new palindrome, so expanding from all 2n−1 centres and counting the steps gives the total in O(n²) time and O(1) space.',
  hints: [
    'Every palindrome has a unique centre.',
    'From a centre, each matching pair of ends you add produces one more palindrome.',
    'Expand from (i, i) and (i, i+1) for every i and add 1 per successful expansion.',
  ],
  pitfall: 'Counting distinct strings instead of positions, or forgetting the even centres.',
  backend: {
    title: 'Scoring symmetric patterns in time-series',
    detail:
      'An anomaly detector counts "mirror" windows in a metric stream (e.g. latency spikes that rise and fall symmetrically). Treat the bucketed series as a string; centre expansion counts every symmetric window without materialising an n×n table.',
  },
  complexity: { time: 'O(n²)', space: 'O(1)' },
  code: `
def countSubstrings(s):
    res = 0                                               @init
    for i in range(len(s)):                               @loop
        for l, r in ((i, i), (i, i + 1)):                 @center
            while l >= 0 and r < len(s) and s[l] == s[r]: @expand
                res += 1                                  @count
                l, r = l - 1, r + 1                       @grow
    return res                                            @done
`,
  explain: {
    expand: 'Matching ends around a palindrome → a new, longer palindrome.',
    count: 'Each successful expansion is exactly one palindromic substring.',
  },
  distractors: [
    { text: '                res = max(res, r - l + 1)', why: 'That finds the LONGEST palindrome; here we count all of them.' },
    { text: '        for l, r in ((i, i),):', why: 'Skips even centres, so "aa" and "abba" are never counted.' },
  ],
  input: { s: 'aabaa' },
  presets: [
    { label: 'distinct letters', input: { s: 'abc' } },
    { label: 'all same', input: { s: 'aaaa' } },
  ],
  validate: ({ s }) => (typeof s !== 'string' ? 'Expected { s: string }' : s.length < 1 || s.length > 10 ? 'Keep 1 ≤ len(s) ≤ 10' : null),
  trace(t, { s }) {
    let res = 0;
    const found: string[] = [];
    let l = -1;
    let r = -1;
    let fail = false;
    let finished = false;
    t.draw(() => {
      const tn: Record<number, Tone> = {};
      if (!finished) {
        if (!fail) for (let k = Math.max(l, 0); k <= r && k < s.length; k++) tn[k] = 'active';
        else {
          for (let k = Math.max(l + 1, 0); k < r && k < s.length; k++) tn[k] = 'info';
          if (l >= 0) tn[l] = 'bad';
          if (r < s.length) tn[r] = 'bad';
        }
      }
      return [V.text('s', s, { tones: tn, caption: finished ? undefined : `l = ${l}, r = ${r}` }), V.chips(`palindromes found (${res})`, found, { tones: found.length ? { [found.length - 1]: 'good' } : {} })];
    });
    t.step('init', 'res = 0. Every successful expansion from a centre will add exactly one palindrome.', { res });
    let asked = 0;
    for (let i = 0; i < s.length; i++) {
      l = i;
      r = i - 1;
      fail = false;
      t.step('loop', `Centres around index ${i}.`, { i, res });
      for (const [l0, r0] of [
        [i, i],
        [i, i + 1],
      ]) {
        l = l0;
        r = r0;
        fail = false;
        t.step('center', `${l0 === r0 ? 'Odd' : 'Even'} centre (${l0}, ${r0}).`, { l, r, res });
        const [pl, pr] = palSpan(s, l0, r0);
        const adds = Math.max(0, Math.floor((pr - pl + 2 - (r0 - l0)) / 2));
        if (asked < 3 && ((l0 === r0 && adds >= 2) || (asked === 0 && l0 !== r0 && r0 < s.length))) {
          asked++;
          const [o, a] = choices(adds, [0, 1, 2, 3].filter((x) => x !== adds));
          t.predict(`How many palindromes will centre (${l0}, ${r0}) add?`, o, a, adds ? `It grows to '${s.slice(pl, pr + 1)}' with ${adds} successful expansion${adds > 1 ? 's' : ''}.` : 'The very first comparison fails.');
        }
        while (l >= 0 && r < s.length && s[l] === s[r]) {
          t.step('expand', `s[${l}] = s[${r}] = '${s[l]}'.`, { l, r });
          res++;
          found.push(s.slice(l, r + 1));
          t.step('count', `'${s.slice(l, r + 1)}' is a palindrome → res = ${res}.`, { res });
          l--;
          r++;
        }
        fail = true;
        t.step('expand', l < 0 || r >= s.length ? 'Hit the edge of the string — this centre is done.' : `s[${l}] = '${s[l]}' ≠ s[${r}] = '${s[r]}' — stop.`, { l, r, res });
      }
    }
    finished = true;
    t.step('done', `${res} palindromic substrings.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const decodeWays: Problem<{ s: string }> = {
  id: 'decode-ways',
  num: 91,
  title: 'Decode Ways',
  difficulty: 'Medium',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement:
    'Letters A–Z are encoded as 1–26. Given a digit string, count how many ways it can be split into valid codes (no code may start with 0).',
  signals: ['"number of ways to decode/split"', 'each step consumes 1 or 2 characters', 'validity depends only on the next one or two characters'],
  insight:
    'dp[i] = ways to decode the suffix s[i:]. From i you can take one digit (if not "0") → dp[i+1], and/or two digits (if 10–26) → dp[i+2]. Fill from the right.',
  hints: [
    'It is Climbing Stairs with rules about which steps are allowed.',
    'A "0" can never start a code; "10"…"26" are the only valid pairs.',
    'dp[n] = 1; dp[i] = (s[i] != "0") * dp[i+1] + (10 ≤ s[i:i+2] ≤ 26) * dp[i+2].',
  ],
  pitfall: 'Treating "0" as decodable on its own, or accepting "06" as a valid two-digit code.',
  backend: {
    title: 'Counting parses of a compact wire protocol',
    detail:
      'A legacy telemetry protocol packs opcodes as 1- or 2-digit numbers with no separators. To detect ambiguous frames, a decoder counts how many valid opcode sequences a payload admits: position in the payload is the dp index and each valid opcode width is a transition.',
  },
  complexity: { time: 'O(n)', space: 'O(n) (O(1) possible)' },
  code: `
def numDecodings(s):
    dp = [0] * (len(s) + 1)                       @init
    dp[len(s)] = 1                                @seed
    for i in range(len(s) - 1, -1, -1):           @loop
        if s[i] == "0":                           @zero
            dp[i] = 0                             @dead
            continue
        dp[i] = dp[i + 1]                         @one
        if i + 1 < len(s) and 10 <= int(s[i:i + 2]) <= 26:   @twoCheck
            dp[i] += dp[i + 2]                    @two
    return dp[0]                                  @done
`,
  explain: {
    seed: 'The empty suffix has exactly one decoding: nothing left to decode.',
    zero: 'No code starts with 0, so a suffix starting with "0" is undecodable.',
    one: 'Decode s[i] alone, then any decoding of s[i+1:].',
    twoCheck: 'A pair is a valid code only from 10 to 26.',
    two: 'Decode s[i:i+2] as one letter, then any decoding of s[i+2:].',
  },
  distractors: [
    { text: '        if 1 <= int(s[i:i + 2]) <= 26:', why: 'Accepts "01"…"09" as two-digit codes — a leading zero is invalid.' },
    { text: '    for i in range(len(s)):', why: 'dp[i] reads dp[i+1] and dp[i+2], so we must fill from the right.' },
    { text: '            dp[i] = dp[i + 1]', why: 'A "0" cannot be decoded on its own; dp[i] must be 0 there.' },
  ],
  input: { s: '226105' },
  presets: [
    { label: '"226"', input: { s: '226' } },
    { label: 'leading zero', input: { s: '06' } },
    { label: 'many ways', input: { s: '11111' } },
  ],
  validate: ({ s }) => (typeof s !== 'string' || !/^[0-9]+$/.test(s) ? 'Expected { s: digit string }' : s.length > 14 ? 'Keep len(s) ≤ 14' : null),
  trace(t, { s }) {
    const n = s.length;
    const dp: number[] = new Array(n + 1).fill(0);
    let i = n + 1;
    let reads: number[] = [];
    let sTones: Record<number, Tone> = {};
    let finished = false;
    t.draw(() => [
      V.text('s', s, { tones: sTones }),
      V.array('dp (ways to decode s[i:])', shown(dp, (k) => k >= i), { pointers: { i: i <= n ? i : null }, tones: mark(i <= n ? i : null, reads, finished ? 'good' : 'active') }),
    ]);
    t.step('init', `dp[i] = number of ways to decode the suffix s[${'i'}:]. We fill it right → left.`, { n });
    i = n;
    dp[n] = 1;
    t.step('seed', `dp[${n}] = 1: the empty suffix has exactly one decoding.`, { [`dp[${n}]`]: 1 });
    let asked = 0;
    let askedZero = false;
    for (i = n - 1; i >= 0; i--) {
      reads = [];
      sTones = { [i]: 'active' };
      t.step('loop', `i = ${i}: decode starting at '${s[i]}'.`, { i });
      if (s[i] === '0') {
        if (!askedZero) {
          askedZero = true;
          t.predict(`s[${i}] is '0'. What is dp[${i}]?`, ['0', String(dp[i + 1]), String(dp[i + 1] + (i + 2 <= n ? dp[i + 2] : 0))].filter((x, k, arr) => arr.indexOf(x) === k), 0, 'No code starts with 0, so the suffix cannot be decoded.');
        }
        t.step('zero', `s[${i}] is '0' — no letter has a code starting with 0.`, { i });
        dp[i] = 0;
        sTones = { [i]: 'bad' };
        t.step('dead', `dp[${i}] = 0.`, { i, 'dp[i]': 0 });
        continue;
      }
      t.step('zero', `'${s[i]}' is not 0, so it can be decoded on its own.`, { i });
      const pair = i + 1 < n ? Number(s.slice(i, i + 2)) : NaN;
      const pairOk = i + 1 < n && pair >= 10 && pair <= 26;
      const final = dp[i + 1] + (pairOk ? dp[i + 2] : 0);
      if (asked < 2 && i <= n - 2 && dp[i + 1] > 0) {
        asked++;
        const [o, a] = choices(final, [dp[i + 1], dp[i + 1] + (i + 2 <= n ? dp[i + 2] : 0), dp[i + 1] + 1]);
        t.predict(`What will dp[${i}] end up as?`, o, a, pairOk ? `'${s[i]}' alone → dp[${i + 1}] = ${dp[i + 1]}, plus '${pair}' is a valid pair → dp[${i + 2}] = ${dp[i + 2]}: total ${final}.` : `'${s[i]}' alone → dp[${i + 1}] = ${dp[i + 1]}; '${s.slice(i, i + 2)}' is not in 10–26, so ${final}.`);
      }
      dp[i] = dp[i + 1];
      reads = [i + 1];
      t.step('one', `Take '${s[i]}' alone → dp[${i}] = dp[${i + 1}] = ${dp[i + 1]}.`, { i, 'dp[i]': dp[i] });
      if (i + 1 < n) {
        sTones = { [i]: 'active', [i + 1]: pairOk ? 'active' : 'bad' };
        t.step('twoCheck', pairOk ? `'${s.slice(i, i + 2)}' = ${pair} is between 10 and 26 → a valid pair.` : `'${s.slice(i, i + 2)}' is not between 10 and 26 → no two-digit option.`, { i, pair: s.slice(i, i + 2) });
        if (pairOk) {
          dp[i] += dp[i + 2];
          reads = [i + 1, i + 2];
          t.step('two', `dp[${i}] = dp[${i + 1}] + dp[${i + 2}] = ${dp[i + 1]} + ${dp[i + 2]} = ${dp[i]}.`, { i, 'dp[i]': dp[i] });
        }
      } else t.step('twoCheck', 'No second digit after this one.', { i });
    }
    i = 0;
    reads = [];
    sTones = {};
    finished = true;
    t.step('done', `dp[0] = ${dp[0]} ways to decode '${s}'.`, { result: dp[0] });
    return dp[0];
  },
};

// ---------------------------------------------------------------------------

const coinChange: Problem<{ coins: number[]; amount: number }> = {
  id: 'coin-change',
  num: 322,
  title: 'Coin Change',
  difficulty: 'Medium',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement:
    'Given coin denominations (unlimited supply of each) and a target amount, return the fewest coins that add up to it, or −1 if it cannot be made.',
  signals: ['"fewest/minimum number of coins"', 'unlimited reuse of each item', 'greedy (biggest coin first) gives wrong answers', 'target value is small enough to index an array'],
  insight:
    'dp[a] = fewest coins for amount a. The last coin used is some c, leaving a − c, so dp[a] = 1 + min over coins of dp[a − c]. Fill a = 1…amount.',
  hints: [
    'Why does "largest coin first" fail for coins [1, 3, 4] and amount 6?',
    'If you knew the best answer for every smaller amount, how would you build amount a?',
    'dp[0] = 0, others start at ∞; dp[a] = min(dp[a], 1 + dp[a − c]) for each coin c ≤ a.',
  ],
  pitfall: 'Initialising dp with 0 (then min() never changes anything) or returning the sentinel instead of −1 when the amount is unreachable.',
  backend: {
    title: 'Fewest instances to hit a capacity target',
    detail:
      'An autoscaler can add VM shapes with fixed capacities (e.g. 1, 3, 4 units) and wants to reach exactly the requested capacity with the fewest machines (fewer nodes = less overhead). Capacity is the dp index and each shape is a coin; dp[cap] is the minimum node count.',
  },
  complexity: { time: 'O(amount × coins)', space: 'O(amount)' },
  code: `
def coinChange(coins, amount):
    dp = [amount + 1] * (amount + 1)              @init
    dp[0] = 0                                     @seed
    for a in range(1, amount + 1):                @loop
        for c in coins:                           @coin
            if a - c >= 0:                        @fits
                dp[a] = min(dp[a], 1 + dp[a - c]) @relax
    return dp[amount] if dp[amount] != amount + 1 else -1   @done
`,
  explain: {
    init: 'amount + 1 acts as ∞: no answer can need more coins than that.',
    seed: 'Zero coins make amount 0.',
    fits: 'Coin c can only be the last coin if it does not overshoot a.',
    relax: 'Use coin c last: 1 coin + the best way to make a − c.',
    done: 'Still the sentinel → amount unreachable.',
  },
  distractors: [
    { text: '    dp = [0] * (amount + 1)', why: 'With 0s, min(dp[a], …) always stays 0 — unreached amounts must start as ∞.' },
    { text: '                dp[a] = min(dp[a], dp[a - c])', why: 'Forgets to count coin c itself (+1).' },
    { text: '    coins.sort(reverse=True)', why: 'Greedy largest-first is the tempting wrong idea — it gives 3 coins (4+1+1) for amount 6 with [1,3,4], but 3+3 needs only 2.' },
  ],
  input: { coins: [1, 3, 4], amount: 6 },
  presets: [
    { label: 'impossible', input: { coins: [2], amount: 3 } },
    { label: 'classic', input: { coins: [1, 2, 5], amount: 11 } },
    { label: 'amount 0', input: { coins: [1], amount: 0 } },
  ],
  validate: ({ coins, amount }) =>
    !isIntArray(coins) || !Number.isInteger(amount)
      ? 'Expected { coins: integer[], amount: integer }'
      : coins.length < 1 || coins.length > 4 || coins.some((c) => c < 1)
        ? 'Use 1–4 positive coins'
        : amount < 0 || amount > 15
          ? 'Keep 0 ≤ amount ≤ 15'
          : null,
  trace(t, { coins, amount }) {
    const INF = amount + 1;
    const dp: number[] = new Array(amount + 1).fill(INF);
    let a = -1;
    let reads: number[] = [];
    let coinIdx = -1;
    let finished = false;
    t.draw(() => [
      V.array('coins', coins, { tones: coinIdx >= 0 ? { [coinIdx]: 'active' } : {} }),
      V.array('dp (fewest coins for amount a)', dp.map((v) => (v === INF ? '∞' : v)), { pointers: { a: a >= 0 ? a : null }, tones: mark(a, reads, finished ? 'good' : 'active') }),
    ]);
    t.step('init', `dp[0…${amount}] all start at ${INF} (shown as ∞): "not reachable yet".`, { amount });
    dp[0] = 0;
    a = 0;
    t.step('seed', 'dp[0] = 0: zero coins make amount 0.', { 'dp[0]': 0 });
    const fmtv = (v: number) => (v === INF ? '∞' : String(v));
    let asked = 0;
    for (a = 1; a <= amount; a++) {
      reads = [];
      coinIdx = -1;
      t.step('loop', `Amount ${a}: which coin should be the last one?`, { a });
      if (asked < 2 && (a === 3 || a === amount) && a >= 2) {
        let best = INF;
        for (const c of coins) if (a - c >= 0) best = Math.min(best, 1 + dp[a - c]);
        asked++;
        const greedyish = coins.filter((c) => c <= a).length ? 1 + dp[a - Math.max(...coins.filter((c) => c <= a))] : INF;
        const [o, a2] = choices(best === INF ? '∞' : best, [greedyish === INF ? '∞' : greedyish + (greedyish === best ? 1 : 0), best === INF ? 1 : best + 1, a]);
        t.predict(`What will dp[${a}] be?`, o, a2, `min over coins of 1 + dp[${a} − c] = ${fmtv(best)}.`);
      }
      for (let k = 0; k < coins.length; k++) {
        const c = coins[k];
        coinIdx = k;
        if (a - c >= 0) {
          const old = dp[a];
          const cand = 1 + dp[a - c];
          dp[a] = Math.min(old, cand);
          reads = [a - c];
          t.step('relax', `Coin ${c}: 1 + dp[${a - c}] = 1 + ${fmtv(dp[a - c])} = ${fmtv(cand)}. dp[${a}] = min(${fmtv(old)}, ${fmtv(cand)}) = ${fmtv(dp[a])}.`, { a, c, 'dp[a]': fmtv(dp[a]) });
        } else {
          reads = [];
          t.step('fits', `Coin ${c} > ${a} — it would overshoot, skip.`, { a, c });
        }
      }
    }
    coinIdx = -1;
    reads = [];
    a = amount;
    finished = true;
    const res = dp[amount] === INF ? -1 : dp[amount];
    t.step('done', res === -1 ? `dp[${amount}] is still ∞ — the amount cannot be made: return -1.` : `dp[${amount}] = ${res} coins.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const maximumProductSubarray: Problem<{ nums: number[] }> = {
  id: 'maximum-product-subarray',
  num: 152,
  title: 'Maximum Product Subarray',
  difficulty: 'Medium',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement: 'Return the largest product of any non-empty contiguous slice of an integer array (which may contain negatives and zeros).',
  signals: ['"maximum product of a contiguous subarray"', 'negative numbers flip signs', 'like Kadane but products'],
  insight:
    'A negative number turns the smallest product into the largest. So track BOTH the max and the min product of a subarray ending at i: each new number extends either, or starts fresh.',
  hints: [
    'Try Kadane’s idea with products. Which input breaks it?',
    'Multiplying by a negative swaps the roles of the biggest and smallest products.',
    'Keep curMax and curMin ending here; candidates are n, n·curMax, n·curMin.',
  ],
  pitfall: 'Updating curMax first and then using the NEW curMax to compute curMin — compute both from the old values.',
  backend: {
    title: 'Worst compounding of multiplicative risk factors',
    detail:
      'A fraud-scoring pipeline multiplies per-event risk multipliers (some invert the signal, i.e. negative), and analysts want the contiguous run of events with the most extreme compound score. Tracking best/worst products ending at each event is a single streaming pass over the event log.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def maxProduct(nums):
    res = nums[0]                                   @init
    curMin, curMax = 1, 1                           @seed
    for n in nums:                                  @loop
        cand = (n, n * curMax, n * curMin)          @cand
        curMax, curMin = max(cand), min(cand)       @update
        res = max(res, curMax)                      @best
    return res                                      @done
`,
  explain: {
    seed: '1 is the neutral element for multiplication: an "empty" product before the first number.',
    cand: 'Start fresh at n, or extend the best/worst product ending at the previous index.',
    update: 'Both from the OLD values (tuple assignment) — a negative n swaps which one is largest.',
    best: 'The answer is the best product ending anywhere.',
  },
  distractors: [
    { text: '        curMax = max(n, n * curMax)', why: 'Ignores curMin: after a negative, the most negative product times another negative becomes the maximum.' },
    { text: '    res = 0', why: 'If every number is negative (e.g. [-3]), the answer is negative; start from nums[0].' },
    { text: '        curMin = min(n, n * curMax, n * curMin)', why: 'If written after curMax was already updated, it reads the NEW curMax — update both at once.' },
  ],
  input: { nums: [2, 3, -2, 4, -1] },
  presets: [
    { label: 'with zero', input: { nums: [-2, 0, -1] } },
    { label: 'all negative', input: { nums: [-2, -3, -4] } },
  ],
  validate: ({ nums }) => (!isIntArray(nums) ? 'Expected { nums: integer[] }' : nums.length < 1 || nums.length > 10 ? 'Keep 1 ≤ len(nums) ≤ 10' : null),
  trace(t, { nums }) {
    const maxEnd: number[] = nums.map(() => 0);
    const minEnd: number[] = nums.map(() => 0);
    let i = -1;
    let filled = -1;
    let reads: number[] = [];
    let res = nums[0];
    let curMax = 1;
    let curMin = 1;
    let bestAt = -1;
    t.draw(() => [
      V.array('nums', nums, { pointers: { i: i >= 0 && i < nums.length ? i : null }, tones: i >= 0 && i < nums.length ? { [i]: 'active' } : {} }),
      V.array('curMax (largest product ending at i)', shown(maxEnd, (k) => k <= filled), { tones: { ...mark(i < nums.length ? i : null, reads), ...(bestAt >= 0 ? { [bestAt]: 'good' as Tone } : {}) } }),
      V.array('curMin (smallest product ending at i)', shown(minEnd, (k) => k <= filled), { tones: mark(i < nums.length ? i : null, reads) }),
    ]);
    t.step('init', `res starts as nums[0] = ${res} (the answer is never smaller than some single element).`, { res });
    t.step('seed', 'curMax = curMin = 1: the neutral "empty product" before index 0.', { curMax, curMin });
    let asked = 0;
    for (i = 0; i < nums.length; i++) {
      const n = nums[i];
      reads = [];
      t.step('loop', `n = ${n}.`, { i, n, curMax, curMin });
      reads = i > 0 ? [i - 1] : [];
      const cand = [n, n * curMax, n * curMin];
      t.step('cand', `Candidates: start fresh ${n}, ${n}×curMax = ${n}×${curMax} = ${cand[1]}, ${n}×curMin = ${n}×${curMin} = ${cand[2]}.`, { n, cand });
      const mx = Math.max(...cand);
      const which = cand.indexOf(mx);
      if (asked < 3 && i > 0 && cand.filter((x) => x === mx).length === 1 && (n < 0 || n === 0 || asked === 0)) {
        asked++;
        const why =
          which === 2
            ? `Negative × negative: the smallest product so far (${curMin}) times ${n} becomes the largest, ${mx}.`
            : which === 0
              ? `Extending would only make it worse (${cand[1]}, ${cand[2]}), so the best product ending here starts fresh at ${n}.`
              : `${n} × ${curMax} = ${mx} is the biggest of (${cand.join(', ')}).`;
        t.predict(`Which candidate becomes the new curMax?`, [`n alone (${cand[0]})`, `n × curMax (${cand[1]})`, `n × curMin (${cand[2]})`], which, why);
      }
      curMax = mx;
      curMin = Math.min(...cand);
      maxEnd[i] = curMax;
      minEnd[i] = curMin;
      filled = i;
      t.step('update', `curMax = max(${cand.join(', ')}) = ${curMax}; curMin = min(…) = ${curMin}.`, { curMax, curMin });
      if (curMax > res) bestAt = i;
      if (i === 0 && bestAt < 0) bestAt = 0;
      const old = res;
      res = Math.max(res, curMax);
      reads = [];
      t.step('best', res > old ? `New best: res = max(${old}, ${curMax}) = ${res}.` : `res stays max(${old}, ${curMax}) = ${res}.`, { res });
    }
    i = nums.length;
    t.step('done', `Largest product = ${res}.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const wordBreak: Problem<{ s: string; wordDict: string[] }> = {
  id: 'word-break',
  num: 139,
  title: 'Word Break',
  difficulty: 'Medium',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement: 'Decide whether a string can be cut into a sequence of words that all appear in a given dictionary (words may be reused).',
  signals: ['"can be segmented into dictionary words"', 'prefix/suffix decisions that overlap', 'naive recursion revisits the same suffix many times'],
  insight:
    'dp[i] = "s[i:] can be segmented". It is True if some word w matches at i and dp[i + len(w)] is True. Fill right → left with dp[n] = True.',
  hints: [
    'What smaller question do you need answered after you cut off the first word?',
    'Whether a suffix is breakable never depends on how you got there — cache it.',
    'dp[n] = True; for i from n−1 down: dp[i] = any(s.startswith(w, i) and dp[i+len(w)]).',
  ],
  pitfall: 'Greedily taking the first matching word ("cats" vs "cat") without exploring alternatives.',
  backend: {
    title: 'Tokenising concatenated identifiers',
    detail:
      'A log-search service splits run-together tokens like "userloginfailed" into known vocabulary terms so they can be indexed. dp over string positions (dp[i] = suffix tokenisable) with the vocabulary as the word list avoids exponential backtracking on adversarial inputs.',
  },
  complexity: { time: 'O(n · m · k) (m words of length ≤ k)', space: 'O(n)' },
  code: `
def wordBreak(s, wordDict):
    dp = [False] * (len(s) + 1)                    @init
    dp[len(s)] = True                              @seed
    for i in range(len(s) - 1, -1, -1):            @loop
        for w in wordDict:                         @word
            if s[i:i + len(w)] == w:               @match
                dp[i] = dp[i + len(w)]             @take
            if dp[i]:                              @check
                break                              @stop
    return dp[0]                                   @done
`,
  explain: {
    seed: 'The empty suffix is trivially segmented.',
    match: 'Word w sits exactly at position i.',
    take: 'Then s[i:] is breakable iff what remains after w is breakable.',
    stop: 'One successful way is enough.',
  },
  distractors: [
    { text: '                dp[i] = True', why: 'Matching a word at i is not enough — the rest of the string after it must also be breakable.' },
    { text: '    for i in range(len(s)):', why: 'dp[i] reads dp[i + len(w)], which must already be known: iterate from the right.' },
    { text: '                break', why: 'Breaking on the first matching word (not the first SUCCESS) misses longer/shorter alternatives like "cat" vs "cats".' },
  ],
  input: { s: 'catsanddog', wordDict: ['cat', 'cats', 'and', 'sand', 'dog'] },
  presets: [
    { label: 'no split', input: { s: 'catsandog', wordDict: ['cats', 'dog', 'sand', 'and', 'cat'] } },
    { label: 'reuse words', input: { s: 'applepenapple', wordDict: ['apple', 'pen'] } },
  ],
  validate: ({ s, wordDict }) =>
    typeof s !== 'string' || !Array.isArray(wordDict) || wordDict.some((w) => typeof w !== 'string' || !w)
      ? 'Expected { s: string, wordDict: non-empty string[] }'
      : s.length > 14 || wordDict.length > 6
        ? 'Keep len(s) ≤ 14 and ≤ 6 words'
        : null,
  trace(t, { s, wordDict }) {
    const n = s.length;
    const dp: boolean[] = new Array(n + 1).fill(false);
    let i = n + 1;
    let reads: number[] = [];
    let sTones: Record<number, Tone> = {};
    let wIdx = -1;
    let finished = false;
    t.draw(() => [
      V.text('s', s, { tones: sTones }),
      V.chips('wordDict', wordDict, { tones: wIdx >= 0 ? { [wIdx]: 'active' } : {} }),
      V.array('dp (s[i:] breakable?)', dp.map((v, k) => (k >= i ? (v ? 'T' : 'F') : '·')), { pointers: { i: i <= n ? i : null }, tones: mark(i <= n ? i : null, reads, finished ? (dp[0] ? 'good' : 'bad') : 'active') }),
    ]);
    t.step('init', 'dp[i] answers "can the suffix s[i:] be split into words?" — all False to start.', { n });
    i = n;
    dp[n] = true;
    t.step('seed', `dp[${n}] = True: the empty suffix needs no words.`);
    let asked = 0;
    for (i = n - 1; i >= 0; i--) {
      reads = [];
      sTones = {};
      wIdx = -1;
      t.step('loop', `i = ${i}: can '${s.slice(i)}' be segmented?`, { i });
      const willBe = wordDict.some((w) => s.startsWith(w, i) && dp[i + w.length]);
      const anyMatch = wordDict.some((w) => s.startsWith(w, i));
      if (asked < 3 && (anyMatch || i === 0) && (i === 0 || asked < 2)) {
        asked++;
        t.predict(`Will dp[${i}] become True?`, ['True', 'False'], willBe ? 0 : 1, willBe ? `Some word matches at ${i} and lands on a True cell.` : anyMatch ? 'Words match here, but each lands on a suffix that cannot be split (dp = F).' : 'No dictionary word starts at this position.');
      }
      for (let k = 0; k < wordDict.length; k++) {
        const w = wordDict[k];
        wIdx = k;
        const end = i + w.length;
        const ok = s.slice(i, end) === w;
        sTones = {};
        for (let c = i; c < Math.min(end, n); c++) sTones[c] = ok ? 'active' : 'bad';
        reads = ok ? [end] : [];
        t.step('match', ok ? `'${w}' matches s[${i}:${end}].` : `'${w}' does not match '${s.slice(i, end)}'.`, { i, w });
        if (ok) {
          dp[i] = dp[end];
          t.step('take', `dp[${i}] = dp[${end}] = ${dp[end] ? 'True' : 'False'}${dp[end] ? ` — the rest '${s.slice(end)}' is breakable.` : ` — the rest '${s.slice(end)}' is not.`}`, { i, w, 'dp[i]': dp[i] });
        }
        if (dp[i]) {
          t.step('stop', `dp[${i}] is True — no need to try other words.`, { i });
          break;
        }
      }
    }
    i = 0;
    reads = [];
    sTones = {};
    wIdx = -1;
    finished = true;
    t.step('done', `dp[0] = ${dp[0] ? 'True' : 'False'}: '${s}' ${dp[0] ? 'can' : 'cannot'} be segmented.`, { result: dp[0] });
    return dp[0];
  },
};

// ---------------------------------------------------------------------------

const longestIncreasingSubsequence: Problem<{ nums: number[] }> = {
  id: 'longest-increasing-subsequence',
  num: 300,
  title: 'Longest Increasing Subsequence',
  difficulty: 'Medium',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement: 'Return the length of the longest strictly increasing sequence you can pick from an array while keeping the original order (elements need not be adjacent).',
  signals: ['"longest increasing subsequence"', 'order must be preserved, gaps allowed', 'answer at i depends on all earlier smaller elements'],
  insight:
    'dp[i] = length of the longest increasing subsequence that ENDS at i. It extends the best dp[j] for any earlier j with nums[j] < nums[i]. The answer is max(dp).',
  hints: [
    'Fix the last element of the subsequence. What could come right before it?',
    'Any earlier j with a smaller value can be the previous element.',
    'dp[i] = 1 + max(dp[j] for j < i if nums[j] < nums[i]), default 1. Return max(dp).',
  ],
  pitfall: 'Returning dp[-1]: the longest subsequence need not end at the last element.',
  backend: {
    title: 'Longest run of monotonically increasing deploy versions',
    detail:
      'Given a log of (out-of-order) version numbers reported by hosts over time, find the longest chain of strictly increasing versions to detect how far a rollout progressed without regressions. Log position is the index; dp[i] is the longest valid chain ending at that report.',
  },
  complexity: { time: 'O(n²) (O(n log n) with patience sorting)', space: 'O(n)' },
  code: `
def lengthOfLIS(nums):
    dp = [1] * len(nums)                          @init
    for i in range(len(nums)):                    @loop
        for j in range(i):                        @inner
            if nums[j] < nums[i]:                 @less
                dp[i] = max(dp[i], dp[j] + 1)     @extend
    return max(dp)                                @done
`,
  explain: {
    init: 'Every element alone is an increasing subsequence of length 1.',
    less: 'Only a smaller earlier value can come right before nums[i].',
    extend: 'Append nums[i] to the best chain ending at j.',
    done: 'The best chain can end anywhere.',
  },
  distractors: [
    { text: '    return dp[-1]', why: 'The longest chain may end before the last index.' },
    { text: '            if nums[j] <= nums[i]:', why: 'Strictly increasing: equal values may not follow each other.' },
    { text: '                dp[i] = dp[j] + 1', why: 'Overwrites with the LAST valid j instead of the best one — needs max.' },
  ],
  input: { nums: [10, 9, 2, 5, 3, 7, 101, 18] },
  presets: [
    { label: 'all equal', input: { nums: [7, 7, 7, 7] } },
    { label: 'zig-zag', input: { nums: [0, 1, 0, 3, 2, 3] } },
  ],
  validate: ({ nums }) => (!isIntArray(nums) ? 'Expected { nums: integer[] }' : nums.length < 1 || nums.length > 10 ? 'Keep 1 ≤ len(nums) ≤ 10' : null),
  trace(t, { nums }) {
    const n = nums.length;
    const dp: number[] = new Array(n).fill(1);
    let i = -1;
    let j = -1;
    let filled = -1;
    let ok = false;
    let best: number[] = [];
    t.draw(() => {
      const nt: Record<number, Tone> = { ...tones(best, 'good') };
      if (j >= 0) nt[j] = ok ? 'info' : 'muted';
      if (i >= 0 && i < n) nt[i] = 'active';
      return [
        V.array('nums', nums, { pointers: { i: i >= 0 && i < n ? i : null, j: j >= 0 ? j : null }, tones: nt }),
        V.array('dp (LIS ending at i)', shown(dp, (k) => k <= filled || k === i), { pointers: { i: i >= 0 && i < n ? i : null, j: j >= 0 ? j : null }, tones: best.length ? tones(best, 'good') : mark(i < n ? i : null, j >= 0 && ok ? [j] : []) }),
      ];
    });
    t.step('init', 'dp[i] = longest increasing subsequence that ENDS at index i. Each element alone gives 1.');
    let asked = 0;
    for (i = 0; i < n; i++) {
      j = -1;
      t.step('loop', `i = ${i} (value ${nums[i]}): which earlier element could come right before it?`, { i, 'dp[i]': dp[i] });
      let final = 1;
      for (let k = 0; k < i; k++) if (nums[k] < nums[i]) final = Math.max(final, dp[k] + 1);
      if (asked < 3 && i >= 3 && (final >= 3 || i === n - 1)) {
        asked++;
        const [o, a] = choices(final, [final - 1, final + 1, 1]);
        t.predict(`What will dp[${i}] be after scanning every j < ${i}?`, o, a, `Best earlier smaller element has dp = ${final - 1}, so dp[${i}] = ${final}.`);
      }
      for (j = 0; j < i; j++) {
        ok = nums[j] < nums[i];
        t.step('less', ok ? `nums[${j}] = ${nums[j]} < ${nums[i]} → can extend the chain ending at ${j} (dp[${j}] = ${dp[j]}).` : `nums[${j}] = ${nums[j]} ≥ ${nums[i]} → cannot come before it.`, { i, j });
        if (ok) {
          const old = dp[i];
          dp[i] = Math.max(dp[i], dp[j] + 1);
          t.step('extend', `dp[${i}] = max(${old}, dp[${j}]+1 = ${dp[j] + 1}) = ${dp[i]}.`, { i, j, 'dp[i]': dp[i] });
        }
      }
      ok = false;
      j = -1;
      filled = i;
    }
    const res = Math.max(...dp);
    // Reconstruct one longest chain to highlight it.
    const chain: number[] = [];
    let need = res;
    let lastVal = Infinity;
    for (let k = n - 1; k >= 0 && need > 0; k--) {
      if (dp[k] === need && nums[k] < lastVal) {
        chain.push(k);
        lastVal = nums[k];
        need--;
      }
    }
    best = chain.reverse();
    i = n;
    t.step('done', `max(dp) = ${res} — e.g. ${best.map((k) => nums[k]).join(' < ')}.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const partitionEqualSubsetSum: Problem<{ nums: number[] }> = {
  id: 'partition-equal-subset-sum',
  num: 416,
  title: 'Partition Equal Subset Sum',
  difficulty: 'Medium',
  category: 'dp-1d',
  pattern: 'dp-1d',
  statement: 'Decide whether an array of positive integers can be split into two groups whose sums are equal.',
  signals: ['"split into two equal-sum subsets"', 'each item used at most once (0/1 knapsack)', 'sum of values is small enough to index'],
  insight:
    'Equal halves means some subset sums to total/2. dp[s] = "some subset of the items seen so far sums to s". Each new number n turns on dp[s] if dp[s − n] was on — iterate s downward so n is used at most once.',
  hints: [
    'If the total is odd, stop immediately. Otherwise what must one half sum to?',
    'Think of the set of reachable sums and how adding one number changes it.',
    'dp[s] = dp[s] or dp[s − n], looping s from target down to n.',
  ],
  pitfall: 'Looping s upward lets the same number be used repeatedly (dp[n] turns on, then dp[2n] reads it in the same pass).',
  backend: {
    title: 'Balancing shards across two data centres',
    detail:
      'You must place shards (sizes in GB) into two data centres with exactly equal storage. The dp bitmap over possible GB totals (0…total/2) records which totals are reachable with the shards considered so far — the classic 0/1-knapsack table used by bin-balancing schedulers.',
  },
  complexity: { time: 'O(n · sum)', space: 'O(sum)' },
  code: `
def canPartition(nums):
    total = sum(nums)                             @total
    if total % 2:                                 @odd
        return False                              @oddRet
    target = total // 2                           @target
    dp = [False] * (target + 1)                   @init
    dp[0] = True                                  @seed
    for n in nums:                                @loop
        for s in range(target, n - 1, -1):        @sum
            dp[s] = dp[s] or dp[s - n]            @update
    return dp[target]                             @done
`,
  explain: {
    odd: 'An odd total cannot be halved into integers.',
    seed: 'The empty subset sums to 0.',
    sum: 'Downward so dp[s − n] still reflects the state BEFORE n was added (each item once).',
    update: 'Either s was already reachable, or it becomes reachable by adding n to s − n.',
  },
  distractors: [
    { text: '        for s in range(n, target + 1):', why: 'Upward iteration reuses n within the same pass (unbounded knapsack), e.g. [1, 2, 5] would wrongly reach 4 = 2 + 2.' },
    { text: '            dp[s] = dp[s - n]', why: 'Forgets sums that were already reachable without n.' },
    { text: '    target = total / 2', why: 'True division gives a float; the table needs an integer size (and odd totals must be rejected first).' },
  ],
  input: { nums: [1, 5, 11, 5] },
  presets: [
    { label: 'odd total', input: { nums: [1, 2, 4] } },
    { label: 'even but impossible', input: { nums: [1, 2, 5] } },
    { label: 'small', input: { nums: [3, 1, 2, 2] } },
  ],
  validate: ({ nums }) =>
    !isIntArray(nums) || nums.some((x) => x < 1)
      ? 'Expected { nums: positive integer[] }'
      : nums.length < 1 || nums.length > 8
        ? 'Keep 1 ≤ len(nums) ≤ 8'
        : nums.reduce((a, b) => a + b, 0) > 40
          ? 'Keep sum(nums) ≤ 40'
          : null,
  trace(t, { nums }) {
    const total = nums.reduce((a, b) => a + b, 0);
    let dp: boolean[] | null = null;
    let idx = -1;
    let s = -1;
    let reads: number[] = [];
    let finished = false;
    t.draw(() => [
      V.array('nums', nums, { pointers: { n: idx >= 0 ? idx : null }, tones: idx >= 0 ? { [idx]: 'active' } : {} }),
      dp &&
        V.array('dp (sum s reachable?)', dp.map((v) => (v ? 'T' : 'F')), {
          pointers: { s: s >= 0 ? s : null },
          tones: { ...tones(dp.map((v, k) => (v ? k : -1)).filter((k) => k >= 0), 'good'), ...mark(finished ? null : s, reads), ...(finished ? { [dp.length - 1]: dp[dp.length - 1] ? ('good' as Tone) : ('bad' as Tone) } : {}) },
        }),
    ]);
    t.step('total', `total = ${total}.`, { total });
    if (total % 2) {
      t.step('odd', `${total} is odd — two equal integer halves are impossible.`, { total });
      t.step('oddRet', 'Return False.', { result: false });
      return false;
    }
    t.step('odd', `${total} is even, so we need a subset summing to ${total / 2}.`, { total });
    const target = total / 2;
    t.step('target', `target = ${target}.`, { target });
    dp = new Array(target + 1).fill(false);
    t.step('init', `dp[s] = "some subset of the numbers seen so far sums to s", for s = 0…${target}.`, { target });
    dp[0] = true;
    s = 0;
    t.step('seed', 'dp[0] = True: pick nothing.', { 'dp[0]': true });
    let asked = 0;
    for (idx = 0; idx < nums.length; idx++) {
      const n = nums[idx];
      s = -1;
      reads = [];
      const before = [...dp];
      t.step('loop', `Add number ${n}: every reachable sum s − ${n} makes s reachable.`, { n });
      if (asked < 2 && (idx === nums.length - 1 || (idx >= 1 && !before[target]))) {
        asked++;
        const will = before[target] || (target - n >= 0 && before[target - n]);
        t.predict(`After this pass, will dp[${target}] (the target) be True?`, ['True', 'False'], will ? 0 : 1, will ? (before[target] ? 'It was already True.' : `dp[${target} − ${n}] = dp[${target - n}] was True.`) : target - n >= 0 ? `dp[${target - n}] is False, so adding ${n} cannot reach ${target}.` : `${n} is larger than the target.`);
      }
      for (s = target; s >= n; s--) {
        reads = [s - n];
        const was = dp[s];
        dp[s] = dp[s] || dp[s - n];
        t.step('update', was ? `dp[${s}] was already True.` : dp[s] ? `dp[${s - n}] is True → ${s - n} + ${n} = ${s} is now reachable.` : `dp[${s - n}] is False → ${s} still unreachable.`, { n, s, 'dp[s]': dp[s] });
      }
      if (n > target) t.step('sum', `${n} > target ${target}: it cannot be part of the half, nothing to update.`, { n });
    }
    idx = -1;
    s = target;
    reads = [];
    finished = true;
    t.step('done', `dp[${target}] = ${dp[target] ? 'True' : 'False'}.`, { result: dp[target] });
    return dp[target];
  },
};

export const problems: Problem[] = [
  climbingStairs,
  minCostClimbingStairs,
  houseRobber,
  houseRobberII,
  longestPalindromicSubstring,
  palindromicSubstrings,
  decodeWays,
  coinChange,
  maximumProductSubarray,
  wordBreak,
  longestIncreasingSubsequence,
  partitionEqualSubsetSum,
];

export const variants: Variant[] = [
  {
    id: 'cheapest-compute-reservations',
    title: 'Cheapest Compute Reservations',
    statement:
      'Your batch cluster must run on a given sorted list of days in the year. You can buy a 1-day, 7-day or 30-day compute reservation, each with its own price. Return the minimum total spend that covers every listed day.',
    pattern: 'dp-1d',
    nearest: 'coin-change',
    signals: ['"minimum total cost to cover"', 'a few fixed "sizes" of purchase (like coin values)', 'decision at day d depends on cheapest cover of earlier days'],
    approach:
      'dp[d] = cheapest cost to cover all required days up to d. If d is not required, dp[d] = dp[d−1]; else dp[d] = min(dp[d−1] + p1, dp[d−7] + p7, dp[d−30] + p30) (clamping indices at 0). Answer dp[last day].',
    backend: 'Choosing on-demand vs. 1-week vs. 1-month reserved capacity for a known job calendar to minimise the cloud bill.',
  },
  {
    id: 'non-conflicting-feature-flags',
    title: 'Maximise Value of Non-Conflicting Releases',
    statement:
      'Features are numbered by integer ids, each with a business value. Shipping feature v blocks features v−1 and v+1 this sprint (they touch the same module). Several features can share an id-value pair. Return the maximum total value you can ship.',
    pattern: 'dp-1d',
    nearest: 'house-robber',
    signals: ['"cannot pick neighbours"', 'maximise a sum under an adjacency conflict', 'collapse duplicates into per-id totals first'],
    approach:
      'Sum the value per id into an array gain[v]. Then it is House Robber over v = 0…max: dp[v] = max(dp[v−1], dp[v−2] + gain[v]).',
    backend: 'Release planning where adjacent modules cannot both change in one deploy window — maximise shipped value.',
  },
  {
    id: 'count-packet-splits',
    title: 'Count Ways to Packetise a Payload',
    statement:
      'A payload of n bytes must be sent as a sequence of packets of sizes 1, 2 or 4 bytes, and a packet may not start at any offset listed in a "forbidden" set (checksum boundaries). How many different packet sequences send the payload exactly?',
    pattern: 'dp-1d',
    nearest: 'decode-ways',
    signals: ['"how many ways" to cover a length', 'each step consumes one of a few fixed widths', 'some positions are invalid starting points (like a leading 0)'],
    approach:
      'dp[i] = ways to send bytes i…n−1; dp[n] = 1. If i is forbidden, dp[i] = 0; else dp[i] = Σ dp[i+w] for w in (1, 2, 4) with i+w ≤ n. Return dp[0].',
    backend: 'Estimating how many framings a protocol encoder can produce — e.g. to test a decoder against every legal fragmentation of a message.',
  },
];
