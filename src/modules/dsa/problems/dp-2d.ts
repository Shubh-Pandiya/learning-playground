import type { Problem, Tone, Variant } from '../engine/types.ts';
import { V, fmt, rc } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// 2-D dynamic programming. Every trace fills a table cell by cell: the cell being computed is
// 'active', the cells its recurrence READS are 'info', and the narration states the recurrence with
// the real numbers.
// ---------------------------------------------------------------------------

type Cell = [number, number];

/** Tone map for a grid: `reads` → info, `at` → active (or custom tone). */
function gmark(at: Cell | null, reads: readonly Cell[], atTone: Tone = 'active'): Record<string, Tone> {
  const out: Record<string, Tone> = {};
  for (const [r, c] of reads) if (r >= 0 && c >= 0) out[rc(r, c)] = 'info';
  if (at) out[rc(at[0], at[1])] = atTone;
  return out;
}

/** Display a dp table: known cells show their value, the cell being computed shows '?', the rest '·'. */
function table<T>(dp: T[][], known: boolean[][], cur: Cell | null, show: (v: T) => unknown = (v) => v): unknown[][] {
  return dp.map((row, r) => row.map((v, c) => (known[r][c] ? show(v) : cur && cur[0] === r && cur[1] === c ? '?' : '·')));
}

/** De-duplicated, numerically sorted options; returns [options, answerIndex]. */
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

const grid2 = <T,>(rows: number, cols: number, v: T): T[][] => Array.from({ length: rows }, () => new Array<T>(cols).fill(v));
const isIntArray = (a: unknown): a is number[] => Array.isArray(a) && a.every((x) => Number.isInteger(x));
const TF = (b: boolean) => (b ? 'T' : 'F');
const py = (b: boolean) => (b ? 'True' : 'False');

// ---------------------------------------------------------------------------

const uniquePaths: Problem<{ m: number; n: number }> = {
  id: 'unique-paths',
  num: 62,
  title: 'Unique Paths',
  difficulty: 'Medium',
  category: 'dp-2d',
  pattern: 'dp-2d',
  statement: 'A robot starts in the top-left cell of an m × n grid and may only move right or down. Count the distinct routes to the bottom-right cell.',
  signals: ['"number of unique paths" in a grid', 'moves restricted to right/down (no cycles)', 'each cell is reached only from its top or left neighbour'],
  insight:
    'Every route into (r, c) arrives from above or from the left, so paths(r, c) = paths(r−1, c) + paths(r, c−1). The first row and column have exactly one route each.',
  hints: [
    'How many ways are there to reach any cell in the top row?',
    'The last move into a cell is either "down" or "right".',
    'dp[r][c] = dp[r−1][c] + dp[r][c−1], with the first row and column all 1.',
  ],
  pitfall: 'Initialising the first row/column with 0 — they must be 1 (one straight-line route), otherwise every cell becomes 0.',
  backend: {
    title: 'Counting routes through a staged deployment pipeline',
    detail:
      'A release moves through a grid of (region × stage) gates and may only advance stage or region, never go back. Counting how many distinct promotion orders exist (for test-matrix sizing) is this table: each gate’s count is the sum of the gate above and the gate to its left.',
  },
  complexity: { time: 'O(m·n)', space: 'O(m·n) (O(n) with one row)' },
  code: `
def uniquePaths(m, n):
    dp = [[1] * n for _ in range(m)]                 @init
    for r in range(1, m):                            @row
        for c in range(1, n):                        @col
            dp[r][c] = dp[r - 1][c] + dp[r][c - 1]   @calc
    return dp[m - 1][n - 1]                          @done
`,
  explain: {
    init: 'All 1s: in particular the first row and first column can only be reached by a straight line.',
    col: 'Row-major order guarantees the top and left neighbours are final before we read them.',
    calc: 'Routes from above + routes from the left (disjoint groups, so add).',
  },
  distractors: [
    { text: '    dp = [[0] * n for _ in range(m)]', why: 'With 0s on the edges every sum stays 0 — the edges need exactly one route each.' },
    { text: '            dp[r][c] = max(dp[r - 1][c], dp[r][c - 1])', why: 'We are counting routes, so the two disjoint groups are added, not compared.' },
    { text: '            dp[r][c] = dp[r - 1][c - 1] + 1', why: 'Diagonal moves are not allowed; a cell is entered only from above or the left.' },
  ],
  input: { m: 4, n: 5 },
  presets: [
    { label: '3 × 7', input: { m: 3, n: 7 } },
    { label: '2 × 2', input: { m: 2, n: 2 } },
    { label: 'single row', input: { m: 1, n: 4 } },
  ],
  validate: ({ m, n }) => (!Number.isInteger(m) || !Number.isInteger(n) ? 'Expected { m: integer, n: integer }' : m < 1 || n < 1 || m > 7 || n > 8 ? 'Keep 1 ≤ m ≤ 7 and 1 ≤ n ≤ 8' : null),
  trace(t, { m, n }) {
    const dp = grid2(m, n, 1);
    const known = grid2(m, n, false);
    let cur: Cell | null = null;
    let reads: Cell[] = [];
    let finished = false;
    t.draw(() => [
      V.grid('dp (routes from the start to each cell)', table(dp, known, cur), {
        tones: finished ? { [rc(m - 1, n - 1)]: 'good' } : gmark(cur, reads),
        pointers: { cell: cur },
        rowLabels: dp.map((_, r) => `r${r}`),
        colLabels: dp[0].map((_, c) => `c${c}`),
      }),
    ]);
    t.step('init', `Build an ${m} × ${n} table. dp[r][c] will hold the number of right/down routes from (0,0) to (r,c).`, { m, n });
    for (let r = 0; r < m; r++) for (let c = 0; c < n; c++) if (r === 0 || c === 0) known[r][c] = true;
    t.step('init', 'Row 0 and column 0 are all 1: to reach them you can only go straight right or straight down.', { m, n });
    let asked = 0;
    for (let r = 1; r < m; r++) {
      cur = null;
      reads = [];
      t.step('row', `Row ${r}: fill left to right so the left neighbour is always ready.`, { r });
      for (let c = 1; c < n; c++) {
        cur = [r, c];
        reads = [
          [r - 1, c],
          [r, c - 1],
        ];
        const up = dp[r - 1][c];
        const left = dp[r][c - 1];
        t.step('col', `Cell (${r},${c}) is entered from above (${up} routes) or from the left (${left} routes).`, { r, c, up, left });
        if (asked < 3 && ((r === 1 && c === 2) || (r === 2 && c === 2) || (r === m - 1 && c === n - 1))) {
          asked++;
          const [o, a] = choices(up + left, [Math.max(up, left), up * left, up + left + 1]);
          t.predict(`What is dp[${r}][${c}]?`, o, a, `${up} (from above) + ${left} (from the left) = ${up + left}.`);
        }
        dp[r][c] = up + left;
        known[r][c] = true;
        t.step('calc', `dp[${r}][${c}] = dp[${r - 1}][${c}] + dp[${r}][${c - 1}] = ${up} + ${left} = ${dp[r][c]}.`, { r, c, 'dp[r][c]': dp[r][c] });
      }
    }
    cur = null;
    reads = [];
    finished = true;
    t.step('done', `dp[${m - 1}][${n - 1}] = ${dp[m - 1][n - 1]} distinct routes.`, { result: dp[m - 1][n - 1] });
    return dp[m - 1][n - 1];
  },
};

// ---------------------------------------------------------------------------

const longestCommonSubsequence: Problem<{ text1: string; text2: string }> = {
  id: 'longest-common-subsequence',
  num: 1143,
  title: 'Longest Common Subsequence',
  difficulty: 'Medium',
  category: 'dp-2d',
  pattern: 'dp-2d',
  statement: 'Return the length of the longest sequence of characters that appears, in order but not necessarily contiguously, in both of two strings.',
  signals: ['two strings compared position by position', '"subsequence" (order kept, gaps allowed)', 'choice at each pair: match both, or drop a char from one side'],
  insight:
    'dp[i][j] = LCS of the prefixes text1[:i] and text2[:j]. If the last chars match they extend the diagonal (1 + dp[i−1][j−1]); otherwise drop one of them and take the better of top/left.',
  hints: [
    'Compare the LAST characters of the two prefixes. What if they are equal?',
    'If they differ, at least one of them is not in the LCS — try dropping each.',
    'dp[i][j] = 1 + dp[i−1][j−1] if equal else max(dp[i−1][j], dp[i][j−1]); add a row/column of 0s for empty prefixes.',
  ],
  pitfall: 'Using dp[i][j] = dp[i−1][j−1] + 1 on a match but forgetting the max(top, left) on a mismatch (or vice versa), or indexing text1[i] instead of text1[i−1] with the padded table.',
  backend: {
    title: 'diff / merge in version control',
    detail:
      'git diff and three-way merge find the longest common subsequence of lines between two file versions; everything not in the LCS is shown as an insertion or deletion. Lines of file A index the rows, lines of file B the columns, and backtracking the table yields the diff hunks.',
  },
  complexity: { time: 'O(m·n)', space: 'O(m·n) (O(n) with two rows)' },
  code: `
def longestCommonSubsequence(text1, text2):
    dp = [[0] * (len(text2) + 1) for _ in range(len(text1) + 1)]   @init
    for i in range(1, len(text1) + 1):                @row
        for j in range(1, len(text2) + 1):            @col
            if text1[i - 1] == text2[j - 1]:          @match
                dp[i][j] = 1 + dp[i - 1][j - 1]       @diag
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])   @skip
    return dp[-1][-1]                                 @done
`,
  explain: {
    init: 'Extra row/column 0 = empty prefix, whose LCS with anything is 0.',
    match: 'Compare the last characters of the two prefixes.',
    diag: 'Both chars join the subsequence: extend the LCS of both shorter prefixes.',
    skip: 'At least one char is useless here: drop it from text1 (top) or text2 (left), keep the better.',
  },
  distractors: [
    { text: '                dp[i][j] = 1 + max(dp[i - 1][j], dp[i][j - 1])', why: 'On a match you must extend the DIAGONAL; top/left may already have used one of these two characters.' },
    { text: '            if text1[i] == text2[j]:', why: 'The table is padded by one, so cell (i, j) compares text1[i−1] and text2[j−1]; this is off by one (and overflows).' },
    { text: '                dp[i][j] = dp[i - 1][j - 1]', why: 'On a mismatch the best may come from dropping just ONE char; the diagonal drops both and can undercount.' },
  ],
  input: { text1: 'abcbd', text2: 'bdcab' },
  presets: [
    { label: 'abcde / ace', input: { text1: 'abcde', text2: 'ace' } },
    { label: 'nothing common', input: { text1: 'abc', text2: 'xyz' } },
  ],
  validate: ({ text1, text2 }) =>
    typeof text1 !== 'string' || typeof text2 !== 'string' ? 'Expected { text1: string, text2: string }' : !text1.length || !text2.length || text1.length > 7 || text2.length > 8 ? 'Keep 1 ≤ len(text1) ≤ 7 and 1 ≤ len(text2) ≤ 8' : null,
  trace(t, { text1, text2 }) {
    const R = text1.length + 1;
    const C = text2.length + 1;
    const dp = grid2(R, C, 0);
    const known = grid2(R, C, false);
    let cur: Cell | null = null;
    let reads: Cell[] = [];
    let path: Cell[] = [];
    let lcs: string[] = [];
    t.draw(() => {
      const tn = path.length ? Object.fromEntries(path.map(([r, c]) => [rc(r, c), 'good' as Tone])) : gmark(cur, reads);
      return [
        V.grid('dp (LCS of text1[:i] and text2[:j])', table(dp, known, cur), { tones: tn, pointers: { cell: cur }, rowLabels: ['∅', ...text1], colLabels: ['∅', ...text2] }),
        path.length > 0 && V.chips('LCS', lcs, { tones: Object.fromEntries(lcs.map((_, k) => [k, 'good' as Tone])) }),
      ];
    });
    for (let i = 0; i < R; i++) known[i][0] = true;
    for (let j = 0; j < C; j++) known[0][j] = true;
    t.step('init', `A ${R} × ${C} table. Row 0 / column 0 stand for an empty prefix: LCS with anything is 0.`, { rows: R, cols: C });
    let askedDiag = false;
    let askedSkip = false;
    for (let i = 1; i < R; i++) {
      cur = null;
      reads = [];
      t.step('row', `Row ${i}: prefix text1[:${i}] = '${text1.slice(0, i)}' (last char '${text1[i - 1]}').`, { i });
      for (let j = 1; j < C; j++) {
        cur = [i, j];
        const same = text1[i - 1] === text2[j - 1];
        reads = same
          ? [[i - 1, j - 1]]
          : [
              [i - 1, j],
              [i, j - 1],
            ];
        t.step('match', same ? `'${text1[i - 1]}' == '${text2[j - 1]}' → they can both end the subsequence.` : `'${text1[i - 1]}' ≠ '${text2[j - 1]}' → drop one of them.`, { i, j, 'text1[i-1]': text1[i - 1], 'text2[j-1]': text2[j - 1] });
        if (same) {
          const val = 1 + dp[i - 1][j - 1];
          if (!askedDiag && val >= 2) {
            askedDiag = true;
            const [o, a] = choices(val, [val - 1, Math.max(dp[i - 1][j], dp[i][j - 1]) + 1 === val ? val + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]) + 1, dp[i - 1][j - 1]]);
            t.predict(`What is dp[${i}][${j}]?`, o, a, `Match → 1 + diagonal dp[${i - 1}][${j - 1}] = 1 + ${dp[i - 1][j - 1]} = ${val}.`);
          }
          dp[i][j] = val;
          known[i][j] = true;
          t.step('diag', `dp[${i}][${j}] = 1 + dp[${i - 1}][${j - 1}] = 1 + ${dp[i - 1][j - 1]} = ${val}.`, { i, j, 'dp[i][j]': val });
        } else {
          const top = dp[i - 1][j];
          const left = dp[i][j - 1];
          if (!askedSkip && top !== left) {
            askedSkip = true;
            t.predict(`Which neighbour wins for dp[${i}][${j}]?`, [`top dp[${i - 1}][${j}] = ${top}`, `left dp[${i}][${j - 1}] = ${left}`], top > left ? 0 : 1, `Dropping ${top > left ? `'${text1[i - 1]}' (go up)` : `'${text2[j - 1]}' (go left)`} keeps the longer LCS: max(${top}, ${left}) = ${Math.max(top, left)}.`);
          }
          dp[i][j] = Math.max(top, left);
          known[i][j] = true;
          reads = [top >= left ? [i - 1, j] : [i, j - 1]];
          t.step('skip', `dp[${i}][${j}] = max(top dp[${i - 1}][${j}]=${top}, left dp[${i}][${j - 1}]=${left}) = ${dp[i][j]}.`, { i, j, 'dp[i][j]': dp[i][j] });
        }
      }
    }
    // Backtrack one optimal subsequence.
    const p: Cell[] = [];
    const letters: string[] = [];
    let i = R - 1;
    let j = C - 1;
    while (i > 0 && j > 0) {
      p.push([i, j]);
      if (text1[i - 1] === text2[j - 1]) {
        letters.push(text1[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
      else j--;
    }
    cur = null;
    reads = [];
    path = p.length ? p : [[R - 1, C - 1]];
    lcs = letters.reverse();
    t.step('done', `dp[${R - 1}][${C - 1}] = ${dp[R - 1][C - 1]}${lcs.length ? ` — e.g. '${lcs.join('')}' (traced back along the green cells; diagonal steps are matches).` : '.'}`, { result: dp[R - 1][C - 1] });
    return dp[R - 1][C - 1];
  },
};

// ---------------------------------------------------------------------------

const stockCooldown: Problem<{ prices: number[] }> = {
  id: 'best-time-to-buy-and-sell-stock-with-cooldown',
  num: 309,
  title: 'Best Time to Buy and Sell Stock with Cooldown',
  difficulty: 'Medium',
  category: 'dp-2d',
  pattern: 'dp-2d',
  statement:
    'Given daily prices, make as many buy/sell round trips as you like (holding at most one share), but after selling you must sit out the next day. Return the maximum profit.',
  signals: ['"cooldown" / restrictions on consecutive actions', 'unlimited transactions with a state rule', 'each day you are in one of a few states'],
  insight:
    'Model each day as three states — hold (own a share), sold (just sold today), rest (free, not in cooldown). Each state’s best profit comes from yesterday’s states by a fixed rule: a 3-row table over days.',
  hints: [
    'What can you be doing at the end of a day? List the states.',
    'You can only buy from "rest" (not the day right after a sale).',
    'hold = max(hold, rest − p); sold = hold_prev + p; rest = max(rest, sold_prev).',
  ],
  pitfall: 'Allowing a buy from yesterday’s "sold" state — that skips the cooldown. Also updating states in place in the wrong order so a state reads today’s value instead of yesterday’s.',
  backend: {
    title: 'Circuit-breaker / cooldown-aware autoscaling decisions',
    detail:
      'An autoscaler can scale up (pay), scale down (save) but must wait one interval after a scale-down before scaling up again (cooldown). Modelling each interval as {scaled-up, just-scaled-down, idle} states and taking the best value per state is exactly this state-machine DP.',
  },
  complexity: { time: 'O(n)', space: 'O(1) (the table is O(3n) for display)' },
  code: `
def maxProfit(prices):
    hold, sold, rest = -prices[0], 0, 0               @init
    for p in prices[1:]:                              @loop
        prevHold = hold
        hold = max(hold, rest - p)                    @hold
        rest = max(rest, sold)                        @rest
        sold = prevHold + p                           @sold
    return max(sold, rest)                            @done
`,
  explain: {
    init: 'Day 0: holding means we bought at prices[0]; nothing sold yet.',
    hold: 'Keep yesterday’s share, or buy today — only allowed from rest (not right after selling).',
    rest: 'Stay idle, or yesterday was a sale and today is the cooldown day.',
    sold: 'Sell today the share held yesterday.',
    done: 'Ending while holding a share is never best.',
  },
  distractors: [
    { text: '        hold = max(hold, sold - p)', why: 'Buying straight after a sale ignores the cooldown day.' },
    { text: '        sold = hold + p', why: '`hold` was already overwritten for today; you would sell a share bought today. Use the previous day’s hold.' },
    { text: '    return max(hold, sold, rest)', why: 'hold is negative-cost inventory; ending with an unsold share never beats sold/rest.' },
  ],
  input: { prices: [1, 2, 3, 0, 2] },
  presets: [
    { label: 'one day', input: { prices: [1] } },
    { label: 'cooldown bites', input: { prices: [1, 4, 2, 7] } },
    { label: 'falling', input: { prices: [5, 4, 3, 2] } },
  ],
  validate: ({ prices }) => (!isIntArray(prices) || prices.some((x) => x < 0) ? 'Expected { prices: non-negative integer[] }' : prices.length < 1 || prices.length > 9 ? 'Keep 1 ≤ len(prices) ≤ 9' : null),
  trace(t, { prices }) {
    const D = prices.length;
    const tbl = grid2(3, D, 0); // rows: 0 hold, 1 sold, 2 rest
    const known = grid2(3, D, false);
    let cur: Cell | null = null;
    let reads: Cell[] = [];
    let day = -1;
    let win: Cell | null = null;
    const HOLD = 0;
    const SOLD = 1;
    const REST = 2;
    t.draw(() => [
      V.array('prices', prices, { pointers: { day: day >= 0 ? day : null }, tones: day >= 0 ? { [day]: 'active' } : {} }),
      V.grid('profit by state (rows) × day (cols)', table(tbl, known, cur), {
        tones: win ? { [rc(win[0], win[1])]: 'good' } : gmark(cur, reads),
        pointers: { cell: cur },
        rowLabels: ['hold', 'sold', 'rest'],
        colLabels: prices.map((p, d) => `d${d} $${p}`),
      }),
    ]);
    day = 0;
    tbl[HOLD][0] = -prices[0];
    known[HOLD][0] = known[SOLD][0] = known[REST][0] = true;
    t.step('init', `Day 0: hold = −${prices[0]} (bought today), sold = 0 and rest = 0 (no profit yet).`, { hold: -prices[0], sold: 0, rest: 0 });
    let askedHold = false;
    let askedSold = false;
    if (D === 1) t.step('loop', 'There are no later days, so no sale can happen.');
    for (day = 1; day < D; day++) {
      const p = prices[day];
      const d = day;
      cur = null;
      reads = [];
      t.step('loop', `Day ${d}, price ${p}. Each state today is built only from yesterday's column.`, { day: d, p });
      const h0 = tbl[HOLD][d - 1];
      const s0 = tbl[SOLD][d - 1];
      const r0 = tbl[REST][d - 1];
      cur = [HOLD, d];
      reads = [
        [HOLD, d - 1],
        [REST, d - 1],
      ];
      tbl[HOLD][d] = Math.max(h0, r0 - p);
      known[HOLD][d] = true;
      t.step('hold', `hold = max(keep yesterday's ${h0}, buy today from rest: ${r0} − ${p} = ${r0 - p}) = ${tbl[HOLD][d]}.`, { hold: tbl[HOLD][d] });
      cur = [REST, d];
      reads = [
        [REST, d - 1],
        [SOLD, d - 1],
      ];
      tbl[REST][d] = Math.max(r0, s0);
      known[REST][d] = true;
      t.step('rest', `rest = max(stay idle ${r0}, cooldown after yesterday's sale ${s0}) = ${tbl[REST][d]}.`, { rest: tbl[REST][d] });
      cur = [SOLD, d];
      reads = [[HOLD, d - 1]];
      if (!askedSold && h0 + p > Math.max(s0, r0)) {
        askedSold = true;
        const [o, a] = choices(h0 + p, [p, h0, tbl[HOLD][d] + p]);
        t.predict(`What is sold on day ${d}?`, o, a, `Sell the share held yesterday: hold[d${d - 1}] + ${p} = ${h0} + ${p} = ${h0 + p}.`);
      }
      tbl[SOLD][d] = h0 + p;
      known[SOLD][d] = true;
      t.step('sold', `sold = yesterday's hold + price = ${h0} + ${p} = ${tbl[SOLD][d]}.`, { sold: tbl[SOLD][d] });
      if (!askedHold && d + 1 < D) {
        const np = prices[d + 1];
        const keep = tbl[HOLD][d];
        const buy = tbl[REST][d] - np;
        if (keep !== buy) {
          askedHold = true;
          t.predict(`Tomorrow (price ${np}): does hold come from keeping (${keep}) or buying from rest (${tbl[REST][d]} − ${np} = ${buy})?`, [`keep (${keep})`, `buy (${buy})`], keep > buy ? 0 : 1, `max(${keep}, ${buy}) = ${Math.max(keep, buy)}.`);
        }
      }
    }
    day = -1;
    cur = null;
    reads = [];
    const last = D - 1;
    const res = Math.max(tbl[SOLD][last], tbl[REST][last]);
    win = tbl[SOLD][last] >= tbl[REST][last] ? [SOLD, last] : [REST, last];
    t.step('done', `Answer = max(sold ${tbl[SOLD][last]}, rest ${tbl[REST][last]}) = ${res}.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const coinChangeII: Problem<{ amount: number; coins: number[] }> = {
  id: 'coin-change-ii',
  num: 518,
  title: 'Coin Change II',
  difficulty: 'Medium',
  category: 'dp-2d',
  pattern: 'dp-2d',
  statement: 'Given coin denominations (unlimited supply) and an amount, count how many different combinations of coins (order does not matter) add up to the amount.',
  signals: ['"number of combinations" (order irrelevant)', 'unlimited reuse of each item (unbounded knapsack)', 'small target amount'],
  insight:
    'dp[i][a] = ways to make a using only the first i coin types. Either never use coin i (dp[i−1][a]) or use it at least once (dp[i][a−c], same row so it can be reused). Fixing the coin order avoids counting permutations.',
  hints: [
    'Why does a 1-D "for each amount, for each coin" loop count 1+2 and 2+1 separately?',
    'Decide coin types one at a time: how many ways with only the first i types?',
    'dp[i][a] = dp[i−1][a] + (dp[i][a−c] if a ≥ c); dp[i][0] = 1.',
  ],
  pitfall: 'Putting the amount loop outside the coin loop (or reading dp[i−1][a−c]) — the first counts permutations, the second forbids reusing a coin.',
  backend: {
    title: 'Counting bundle configurations for a pricing engine',
    detail:
      'A SaaS billing service sells usage packs (1, 2, 5 units, any quantity) and needs to know how many distinct pack bundles total exactly N units to pre-compute discount tables. Pack types are rows, unit totals are columns — skipping a pack type reads the row above, adding one more of it reads left in the same row.',
  },
  complexity: { time: 'O(n · amount)', space: 'O(n · amount) (O(amount) with one row)' },
  code: `
def change(amount, coins):
    dp = [[0] * (amount + 1) for _ in range(len(coins) + 1)]   @init
    for row in dp: row[0] = 1                         @seed
    for i in range(1, len(coins) + 1):                @row
        c = coins[i - 1]
        for a in range(1, amount + 1):                @col
            dp[i][a] = dp[i - 1][a]                   @skip
            if a >= c:                                @fits
                dp[i][a] += dp[i][a - c]              @use
    return dp[len(coins)][amount]                     @done
`,
  explain: {
    seed: 'Exactly one way to make 0: take nothing.',
    skip: 'Combinations that never use coin c — already counted in the row above.',
    use: 'Combinations that use c at least once: take one c, then any combination (still allowed to use c) for a − c.',
  },
  distractors: [
    { text: '                dp[i][a] += dp[i - 1][a - c]', why: 'Reading the row above allows coin c at most once (0/1 knapsack); coins here are unlimited.' },
    { text: '            dp[i][a] = dp[i][a - c]', why: 'Drops all combinations that never use coin c.' },
    { text: '    for row in dp: row[0] = 0', why: 'Amount 0 has exactly one combination (empty); 0 makes every count 0.' },
  ],
  input: { amount: 5, coins: [1, 2, 5] },
  presets: [
    { label: 'impossible', input: { amount: 3, coins: [2] } },
    { label: 'single coin', input: { amount: 4, coins: [1] } },
    { label: 'four amounts', input: { amount: 6, coins: [2, 3] } },
  ],
  validate: ({ amount, coins }) =>
    !Number.isInteger(amount) || !isIntArray(coins) ? 'Expected { amount: integer, coins: integer[] }' : amount < 0 || amount > 8 ? 'Keep 0 ≤ amount ≤ 8' : coins.length < 1 || coins.length > 5 || coins.some((c) => c < 1) ? 'Use 1–5 positive coins' : null,
  trace(t, { amount, coins }) {
    const R = coins.length + 1;
    const C = amount + 1;
    const dp = grid2(R, C, 0);
    const known = grid2(R, C, false);
    let cur: Cell | null = null;
    let reads: Cell[] = [];
    let finished = false;
    const rowLabels = coins.map((_, i) => `{${coins.slice(0, i + 1).join(',')}}`);
    t.draw(() => [
      V.grid('dp (ways to make a with the first i coin types)', table(dp, known, cur), {
        tones: finished ? { [rc(R - 1, C - 1)]: 'good' } : gmark(cur, reads),
        pointers: { cell: cur },
        rowLabels: ['{}', ...rowLabels],
        colLabels: dp[0].map((_, a) => a),
      }),
    ]);
    for (let a = 0; a < C; a++) known[0][a] = true;
    t.step('init', `Rows = which coin types are allowed, columns = amount 0…${amount}. With no coins (row {}) nothing positive can be made.`, { amount });
    for (let i = 0; i < R; i++) {
      dp[i][0] = 1;
      known[i][0] = true;
    }
    t.step('seed', 'Column 0 is all 1: the empty combination makes amount 0.');
    let asked = 0;
    for (let i = 1; i < R; i++) {
      const c = coins[i - 1];
      cur = null;
      reads = [];
      t.step('row', `Row ${rowLabels[i - 1]}: now coin ${c} is allowed too.`, { i, c });
      for (let a = 1; a < C; a++) {
        cur = [i, a];
        reads = [[i - 1, a]];
        const total = dp[i - 1][a] + (a >= c ? dp[i][a - c] : 0);
        if (asked < 3 && a >= c && dp[i][a - c] > 0 && dp[i - 1][a] > 0 && (asked < 2 || (i === R - 1 && a === C - 1))) {
          asked++;
          const [o, an] = choices(total, [dp[i - 1][a], dp[i][a - c], total + 1]);
          t.predict(`What will dp[${i}][${a}] be (ways to make ${a} with ${rowLabels[i - 1]})?`, o, an, `skip ${c}: dp[${i - 1}][${a}] = ${dp[i - 1][a]}, plus use ${c}: dp[${i}][${a - c}] = ${dp[i][a - c]} → ${total}.`);
        }
        dp[i][a] = dp[i - 1][a];
        known[i][a] = true;
        t.step('skip', `Never use coin ${c}: dp[${i}][${a}] starts as dp[${i - 1}][${a}] = ${dp[i - 1][a]}.${a < c ? ` Coin ${c} > ${a}, so that's all.` : ''}`, { i, a, 'dp[i][a]': dp[i][a] });
        if (a >= c) {
          reads = [
            [i - 1, a],
            [i, a - c],
          ];
          dp[i][a] += dp[i][a - c];
          t.step('use', `Use at least one ${c}: + dp[${i}][${a - c}] = ${dp[i][a - c]} → dp[${i}][${a}] = ${dp[i - 1][a]} + ${dp[i][a - c]} = ${dp[i][a]}.`, { i, a, 'dp[i][a]': dp[i][a] });
        }
      }
    }
    cur = null;
    reads = [];
    finished = true;
    t.step('done', `dp[${R - 1}][${amount}] = ${dp[R - 1][amount]} combinations.`, { result: dp[R - 1][amount] });
    return dp[R - 1][amount];
  },
};

// ---------------------------------------------------------------------------

const targetSum: Problem<{ nums: number[]; target: number }> = {
  id: 'target-sum',
  num: 494,
  title: 'Target Sum',
  difficulty: 'Medium',
  category: 'dp-2d',
  pattern: 'dp-2d',
  statement: 'Put a + or − sign in front of every number in an array. Count how many sign assignments make the expression equal a target value.',
  signals: ['"count the ways" to assign +/−', 'every element gets exactly one of two choices', 'running sum stays in a small bounded range'],
  insight:
    'The state after deciding the first i numbers is just the running sum. dp[i][s] = number of sign choices for the first i numbers that sum to s; each state branches into s + n and s − n, and branches landing on the same sum merge (counts add).',
  hints: [
    'Brute force is 2ⁿ. Which sign choices lead to the same situation?',
    'Only the running sum matters for the future — make it the second dp dimension.',
    'dp[0][0] = 1; for each (i, s): dp[i+1][s+n] += dp[i][s] and dp[i+1][s−n] += dp[i][s].',
  ],
  pitfall: 'Using a plain array indexed by the (possibly negative) sum without an offset, or overwriting (=) instead of accumulating (+=) when two branches land on the same sum.',
  backend: {
    title: 'Counting ways to reach a net quota with credits and debits',
    detail:
      'A quota service applies a sequence of adjustments, each of which may be granted as a credit or a debit, and wants to know how many grant/deny patterns end at an exact balance (for audit sampling). Adjustments are rows, balance is the column, and every reachable balance fans out to two in the next row.',
  },
  complexity: { time: 'O(n · total)', space: 'O(n · total)' },
  code: `
def findTargetSumWays(nums, target):
    dp = [{} for _ in range(len(nums) + 1)]           @init
    dp[0][0] = 1                                      @seed
    for i, n in enumerate(nums):                      @row
        for s, ways in dp[i].items():                 @cell
            dp[i + 1][s + n] = dp[i + 1].get(s + n, 0) + ways   @plus
            dp[i + 1][s - n] = dp[i + 1].get(s - n, 0) + ways   @minus
    return dp[len(nums)].get(target, 0)               @done
`,
  explain: {
    init: 'dp[i] maps running sum → number of sign patterns for the first i numbers.',
    seed: 'Before any number, the sum is 0 in exactly one way.',
    cell: 'Every reachable sum branches on the sign of the next number.',
    plus: '+n: all `ways` patterns move to s + n (adding to whatever is already there).',
    minus: '−n: the same patterns with a minus sign land on s − n.',
  },
  distractors: [
    { text: '            dp[i + 1][s + n] = ways', why: 'Overwrites instead of accumulating — two different sums can land on the same s + n.' },
    { text: '        for s, ways in dp[i + 1].items():', why: 'Reads the row being written; transitions go from row i to row i+1.' },
    { text: '    return dp[len(nums) - 1].get(target, 0)', why: 'That row has not used the last number yet.' },
  ],
  input: { nums: [1, 1, 1, 1, 1], target: 3 },
  presets: [
    { label: 'mixed sizes', input: { nums: [1, 2, 1], target: 2 } },
    { label: 'unreachable', input: { nums: [2, 2], target: 1 } },
    { label: 'single', input: { nums: [1], target: 1 } },
  ],
  validate: ({ nums, target }) =>
    !isIntArray(nums) || !Number.isInteger(target) || nums.some((x) => x < 0)
      ? 'Expected { nums: non-negative integer[], target: integer }'
      : nums.length < 1 || nums.length > 6
        ? 'Keep 1 ≤ len(nums) ≤ 6'
        : nums.reduce((a, b) => a + b, 0) > 7
          ? 'Keep sum(nums) ≤ 7 (the table has 2·sum + 1 columns)'
          : null,
  trace(t, { nums, target }) {
    const total = nums.reduce((a, b) => a + b, 0);
    const R = nums.length + 1;
    const C = 2 * total + 1;
    const rows: Map<number, number>[] = Array.from({ length: R }, () => new Map<number, number>());
    let cur: Cell | null = null;
    let reads: Cell[] = [];
    let idx = -1;
    let finished = false;
    const col = (s: number) => s + total;
    t.draw(() => {
      const cells = rows.map((m) => Array.from({ length: C }, (_, c) => (m.has(c - total) ? m.get(c - total)! : '·')));
      const tn: Record<string, Tone> = finished ? (Math.abs(target) <= total ? { [rc(R - 1, col(target))]: rows[R - 1].has(target) ? 'good' : 'bad' } : {}) : gmark(cur, reads);
      return [
        V.array('nums', nums, { pointers: { i: idx >= 0 ? idx : null }, tones: idx >= 0 ? { [idx]: 'active' } : {} }),
        V.grid('dp[i][s] (sign patterns of the first i numbers summing to s)', cells, {
          tones: tn,
          pointers: { cell: cur },
          rowLabels: ['start', ...nums.map((n, i) => `±${n} (#${i})`)],
          colLabels: Array.from({ length: C }, (_, c) => c - total),
        }),
      ];
    });
    t.step('init', `Rows = how many numbers have been signed, columns = running sum ${-total}…${total}.`, { total });
    rows[0].set(0, 1);
    cur = [0, col(0)];
    t.step('seed', 'dp[0][0] = 1: before any number the sum is 0, in one way.');
    let asked = 0;
    for (let i = 0; i < nums.length; i++) {
      const n = nums[i];
      idx = i;
      cur = null;
      reads = [];
      t.step('row', `Number ${n}: every sum in row ${i} splits into s + ${n} and s − ${n} in row ${i + 1}.`, { i, n });
      const next = rows[i + 1];
      for (const [s, ways] of [...rows[i].entries()]) {
        cur = null;
        reads = [[i, col(s)]];
        t.step('cell', `Sum ${s} is reached in ${ways} way${ways > 1 ? 's' : ''}.`, { i, s, ways });
        const already = next.get(s + n) ?? 0;
        if (asked < 2 && already > 0) {
          asked++;
          const [o, a] = choices(already + ways, [already, ways, already * ways === already + ways ? already + ways + 1 : already * ways]);
          t.predict(`dp[${i + 1}][${s + n}] already holds ${already}. What does it hold after adding the +${n} branch?`, o, a, `Two routes merge on the same sum: ${already} + ${ways} = ${already + ways}.`);
        }
        next.set(s + n, already + ways);
        cur = [i + 1, col(s + n)];
        t.step('plus', `+${n}: dp[${i + 1}][${s + n}] = ${already} + ${ways} = ${already + ways}.`, { s, 'dp[i+1][s+n]': already + ways });
        const before = next.get(s - n) ?? 0;
        next.set(s - n, before + ways);
        cur = [i + 1, col(s - n)];
        t.step('minus', `−${n}: dp[${i + 1}][${s - n}] = ${before} + ${ways} = ${before + ways}.`, { s, 'dp[i+1][s-n]': before + ways });
      }
    }
    idx = -1;
    cur = null;
    reads = [];
    finished = true;
    const res = rows[R - 1].get(target) ?? 0;
    t.step('done', `dp[${R - 1}][${target}] = ${res} sign assignments reach ${target}.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const interleavingString: Problem<{ s1: string; s2: string; s3: string }> = {
  id: 'interleaving-string',
  num: 97,
  title: 'Interleaving String',
  difficulty: 'Medium',
  category: 'dp-2d',
  pattern: 'dp-2d',
  statement: 'Decide whether a third string can be formed by merging two strings while keeping the internal character order of each.',
  signals: ['two sources merged keeping each one’s order', 'state = how much of each source has been consumed', 'greedy choice breaks when both sources offer the same char'],
  insight:
    'dp[i][j] = "s3[:i+j] can be built from s1[:i] and s2[:j]". The last char of s3[:i+j] came from s1 (needs dp[i−1][j]) or from s2 (needs dp[i][j−1]).',
  hints: [
    'If you have used i chars of s1 and j chars of s2, which char of s3 comes next?',
    'Greedy fails when s1 and s2 both offer the needed char — keep both options alive.',
    'dp[i][j] = (s1[i−1] == s3[i+j−1] and dp[i−1][j]) or (s2[j−1] == s3[i+j−1] and dp[i][j−1]).',
  ],
  pitfall: 'Forgetting the length check len(s1) + len(s2) == len(s3), or greedily preferring s1 when both match.',
  backend: {
    title: 'Validating a merged event log',
    detail:
      'Two services each emit an ordered event stream; an aggregator produced one merged log. To verify the merge preserved each stream’s order (no reordering bugs), check whether the merged log is an interleaving: events consumed from service A index rows, from service B columns.',
  },
  complexity: { time: 'O(m·n)', space: 'O(m·n)' },
  code: `
def isInterleave(s1, s2, s3):
    if len(s1) + len(s2) != len(s3):                  @len
        return False                                  @lenFail
    dp = [[False] * (len(s2) + 1) for _ in range(len(s1) + 1)]   @init
    dp[0][0] = True                                   @seed
    for i in range(len(s1) + 1):                      @row
        for j in range(len(s2) + 1):                  @col
            if i > 0 and s1[i - 1] == s3[i + j - 1] and dp[i - 1][j]:   @fromS1
                dp[i][j] = True                       @setS1
            if j > 0 and s2[j - 1] == s3[i + j - 1] and dp[i][j - 1]:   @fromS2
                dp[i][j] = True                       @setS2
    return dp[len(s1)][len(s2)]                       @done
`,
  explain: {
    len: 'Every char of s1 and s2 must be used exactly once.',
    seed: 'Empty + empty builds the empty prefix.',
    fromS1: 'The newest char of s3 came from s1 — then the rest must have worked with one fewer s1 char (cell above).',
    fromS2: 'Or it came from s2 — then the cell to the left must be True.',
  },
  distractors: [
    { text: '            if i > 0 and s1[i - 1] == s3[i + j - 1]:', why: 'A matching char is not enough: the prefix before it (dp[i−1][j]) must also be buildable.' },
    { text: '            elif j > 0 and s2[j - 1] == s3[i + j - 1] and dp[i][j - 1]:', why: '`elif` only tries s2 when the s1 test fails as a whole — fine — but writing the s1 branch as a greedy choice (using it whenever chars match) misses valid paths; both checks must be independent ORs.' },
    { text: '            if i > 0 and s1[i - 1] == s3[i + j] and dp[i - 1][j]:', why: 'Off by one: with i + j chars used, the newest one is s3[i + j − 1].' },
  ],
  input: { s1: 'aab', s2: 'axy', s3: 'aaxaby' },
  presets: [
    { label: 'order broken', input: { s1: 'ab', s2: 'cd', s3: 'abdc' } },
    { label: 'empty s1', input: { s1: '', s2: 'abc', s3: 'abc' } },
    { label: 'classic false', input: { s1: 'aabcc', s2: 'dbbca', s3: 'aadbbbaccc' } },
  ],
  validate: ({ s1, s2, s3 }) =>
    typeof s1 !== 'string' || typeof s2 !== 'string' || typeof s3 !== 'string' ? 'Expected { s1, s2, s3: string }' : s1.length > 6 || s2.length > 7 ? 'Keep len(s1) ≤ 6 and len(s2) ≤ 7' : null,
  trace(t, { s1, s2, s3 }) {
    const R = s1.length + 1;
    const C = s2.length + 1;
    let dp: boolean[][] | null = null;
    let known: boolean[][] | null = null;
    let cur: Cell | null = null;
    let reads: Cell[] = [];
    let finished = false;
    const textTones = (): [Record<number, Tone>, Record<number, Tone>, Record<number, Tone>] => {
      if (!cur) return [{}, {}, {}];
      const [i, j] = cur;
      const t3: Record<number, Tone> = {};
      for (let k = 0; k < i + j - 1; k++) t3[k] = 'info';
      if (i + j - 1 >= 0) t3[i + j - 1] = 'active';
      return [i > 0 ? { [i - 1]: 'active' } : {}, j > 0 ? { [j - 1]: 'active' } : {}, t3];
    };
    t.draw(() => {
      const [t1, t2, t3] = textTones();
      return [
        V.text('s1', s1 || '(empty)', { tones: s1 ? t1 : {} }),
        V.text('s2', s2 || '(empty)', { tones: s2 ? t2 : {} }),
        V.text('s3', s3 || '(empty)', { tones: s3 ? t3 : {} }),
        dp &&
          known &&
          V.grid('dp (s3[:i+j] from s1[:i] + s2[:j]?)', table(dp, known, cur, TF), {
            tones: finished ? { [rc(R - 1, C - 1)]: dp[R - 1][C - 1] ? 'good' : 'bad' } : gmark(cur, reads),
            pointers: { cell: cur },
            rowLabels: ['∅', ...s1],
            colLabels: ['∅', ...s2],
          }),
      ];
    });
    if (s1.length + s2.length !== s3.length) {
      t.step('len', `${s1.length} + ${s2.length} ≠ ${s3.length}: some characters would be missing or extra.`);
      t.step('lenFail', 'Return False.', { result: false });
      return false;
    }
    t.step('len', `Lengths fit: ${s1.length} + ${s2.length} = ${s3.length}.`);
    dp = grid2(R, C, false);
    known = grid2(R, C, false);
    t.step('init', `Table ${R} × ${C}: rows = chars used from s1, columns = chars used from s2.`);
    dp[0][0] = true;
    known[0][0] = true;
    cur = [0, 0];
    t.step('seed', 'dp[0][0] = True: nothing used builds the empty prefix of s3.');
    let askedT = false;
    let askedF = false;
    for (let i = 0; i < R; i++) {
      cur = null;
      reads = [];
      t.step('row', i === 0 ? 'Row 0: only s2 has been used.' : `Row ${i}: ${i} char${i > 1 ? 's' : ''} of s1 used ('${s1.slice(0, i)}').`, { i });
      for (let j = 0; j < C; j++) {
        if (i === 0 && j === 0) continue;
        cur = [i, j];
        reads = [];
        const ch = s3[i + j - 1];
        const viaS1 = i > 0 && s1[i - 1] === ch && dp[i - 1][j];
        const viaS2 = j > 0 && s2[j - 1] === ch && dp[i][j - 1];
        t.step('col', `Cell (${i},${j}): the newest char of s3[:${i + j}] is '${ch}'. Did it come from s1 or from s2?`, { i, j, 's3[i+j-1]': ch });
        if (i > 0 && j > 0 && ((!askedT && (viaS1 || viaS2)) || (!askedF && !viaS1 && !viaS2 && (dp[i - 1][j] || dp[i][j - 1])))) {
          const ans = viaS1 && viaS2 ? 2 : viaS1 ? 0 : viaS2 ? 1 : 3;
          if (ans === 3) askedF = true;
          else askedT = true;
          t.predict(`Which route makes dp[${i}][${j}] True?`, ['from above (s1)', 'from the left (s2)', 'both', 'neither — False'], ans, `s1 route: s1[${i - 1}]='${s1[i - 1]}' ${s1[i - 1] === ch ? '=' : '≠'} '${ch}', above = ${TF(dp[i - 1][j])}. s2 route: s2[${j - 1}]='${s2[j - 1]}' ${s2[j - 1] === ch ? '=' : '≠'} '${ch}', left = ${TF(dp[i][j - 1])}.`);
        }
        if (i > 0) {
          reads = [[i - 1, j]];
          t.step('fromS1', `From s1: s1[${i - 1}] = '${s1[i - 1]}' ${s1[i - 1] === ch ? '==' : '≠'} '${ch}'${s1[i - 1] === ch ? ` and above dp[${i - 1}][${j}] = ${py(dp[i - 1][j])}` : ''} → ${viaS1 ? 'works' : 'no'}.`, { i, j, viaS1 });
          if (viaS1) {
            dp[i][j] = true;
            known[i][j] = true;
            t.step('setS1', `dp[${i}][${j}] = True.`, { i, j });
          }
        }
        if (j > 0) {
          reads = [[i, j - 1]];
          t.step('fromS2', `From s2: s2[${j - 1}] = '${s2[j - 1]}' ${s2[j - 1] === ch ? '==' : '≠'} '${ch}'${s2[j - 1] === ch ? ` and left dp[${i}][${j - 1}] = ${py(dp[i][j - 1])}` : ''} → ${viaS2 ? 'works' : 'no'}.`, { i, j, viaS2 });
          if (viaS2) {
            dp[i][j] = true;
            known[i][j] = true;
            t.step('setS2', `dp[${i}][${j}] = True.`, { i, j });
          }
        }
        known[i][j] = true;
      }
    }
    cur = null;
    reads = [];
    finished = true;
    const res = dp[R - 1][C - 1];
    t.step('done', `dp[${R - 1}][${C - 1}] = ${py(res)}: '${s3}' ${res ? 'is' : 'is not'} an interleaving.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const longestIncreasingPath: Problem<{ matrix: number[][] }> = {
  id: 'longest-increasing-path-in-a-matrix',
  num: 329,
  title: 'Longest Increasing Path in a Matrix',
  difficulty: 'Hard',
  category: 'dp-2d',
  pattern: 'dp-2d',
  statement: 'In a grid of integers, moving up/down/left/right, find the length of the longest path whose values strictly increase at every step.',
  signals: ['grid + "longest path"', 'strictly increasing ⇒ no cycles (a DAG)', 'the best path from a cell never depends on how you got there'],
  insight:
    'Because values strictly increase, paths can never loop, so "longest path starting at (r,c)" is well-defined and reusable. DFS from every cell and memoise: each cell is solved once, giving O(m·n).',
  hints: [
    'Can an increasing path ever revisit a cell?',
    'The longest path from a cell = 1 + the best among larger neighbours.',
    'DFS with a memo dict keyed by (r, c); the answer is the max over all cells.',
  ],
  pitfall: 'Keeping a "visited" set like ordinary DFS and forgetting to memoise — that is exponential; the strictly-increasing rule already prevents cycles.',
  backend: {
    title: 'Longest dependency chain in a build graph',
    detail:
      'Build systems (Bazel, make) compute the critical path — the longest chain of dependent targets — to estimate minimum build time. Targets form a DAG (like increasing cells), and DFS + memo on "longest chain starting here" computes every target’s depth once.',
  },
  complexity: { time: 'O(m·n)', space: 'O(m·n)' },
  code: `
def longestIncreasingPath(matrix):
    ROWS, COLS = len(matrix), len(matrix[0])
    dp = {}                                           @init
    def dfs(r, c, prev):
        if r < 0 or r == ROWS or c < 0 or c == COLS or matrix[r][c] <= prev:   @guard
            return 0
        if (r, c) in dp:                              @memo
            return dp[(r, c)]                         @hit
        res = 1                                       @start
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):   @dir
            res = max(res, 1 + dfs(r + dr, c + dc, matrix[r][c]))   @recur
        dp[(r, c)] = res                              @store
        return res
    for r in range(ROWS):
        for c in range(COLS):                         @outer
            dfs(r, c, -1)                             @call
    return max(dp.values())                           @done
`,
  explain: {
    init: 'Memo: (r, c) → longest increasing path STARTING at that cell.',
    guard: 'Off the grid, or not strictly larger than where we came from → this direction contributes nothing.',
    hit: 'Already solved — reuse it. This is what makes the whole thing O(m·n).',
    recur: 'Step to a larger neighbour; the path from here is 1 + its best path.',
    store: 'Cache before returning so no cell is solved twice.',
  },
  distractors: [
    { text: '        if matrix[r][c] < prev:', why: 'Equal values must also stop the path — it must be STRICTLY increasing.' },
    { text: '        visited.add((r, c))', why: 'No visited set is needed (increasing paths cannot cycle); without the memo this is exponential.' },
    { text: '    return dfs(0, 0, -1)', why: 'The longest path may start anywhere, not just at the top-left.' },
  ],
  input: {
    matrix: [
      [3, 4, 5],
      [3, 2, 6],
      [2, 2, 1],
    ],
  },
  presets: [
    {
      label: 'LeetCode example',
      input: {
        matrix: [
          [9, 9, 4],
          [6, 6, 8],
          [2, 1, 1],
        ],
      },
    },
    { label: 'single row', input: { matrix: [[1, 2, 3, 2]] } },
  ],
  validate: ({ matrix }) =>
    !Array.isArray(matrix) || !matrix.length || !matrix.every((row) => isIntArray(row) && row.length === matrix[0].length && row.every((x) => x >= 0))
      ? 'Expected { matrix: rectangular non-negative integer[][] }'
      : matrix.length > 4 || matrix[0].length > 4 || !matrix[0].length
        ? 'Keep the matrix ≤ 4 × 4'
        : null,
  trace(t, { matrix }) {
    const ROWS = matrix.length;
    const COLS = matrix[0].length;
    const memo: (number | null)[][] = grid2<number | null>(ROWS, COLS, null);
    const stack: Cell[] = [];
    let cur: Cell | null = null;
    let probe: Cell | null = null;
    let probeTone: Tone = 'info';
    let best: Cell[] = [];
    const inside = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
    t.draw(() => {
      const mt: Record<string, Tone> = {};
      for (const [r, c] of stack) mt[rc(r, c)] = 'warn';
      for (const [r, c] of best) mt[rc(r, c)] = 'good';
      if (cur) mt[rc(cur[0], cur[1])] = 'active';
      if (probe && inside(probe[0], probe[1])) mt[rc(probe[0], probe[1])] = probeTone;
      const dt: Record<string, Tone> = {};
      for (const [r, c] of best) dt[rc(r, c)] = 'good';
      if (cur) dt[rc(cur[0], cur[1])] = 'active';
      if (probe && inside(probe[0], probe[1]) && memo[probe[0]][probe[1]] !== null) dt[rc(probe[0], probe[1])] = 'info';
      return [
        V.grid('matrix (orange = on the DFS stack)', matrix, { tones: mt, pointers: { cell: cur } }),
        V.grid('dp (longest increasing path starting here)', memo.map((row) => row.map((v) => (v === null ? '·' : v))), { tones: dt }),
        V.stack('call stack', stack.map(([r, c]) => `dfs(${r},${c}) val ${matrix[r][c]}`)),
      ];
    });
    // Precompute answers so predictions are honest.
    const ans: number[][] = grid2(ROWS, COLS, 0);
    const solve = (r: number, c: number): number => {
      if (ans[r][c]) return ans[r][c];
      let b = 1;
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nr = r + dr;
        const nc = c + dc;
        if (inside(nr, nc) && matrix[nr][nc] > matrix[r][c]) b = Math.max(b, 1 + solve(nr, nc));
      }
      return (ans[r][c] = b);
    };
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) solve(r, c);

    t.step('init', 'Empty memo. dp[(r,c)] will be the longest strictly increasing path that STARTS at (r,c).');
    let askedVal = 0;
    let askedHit = false;
    const DIRS: [number, number, string][] = [
      [1, 0, 'down'],
      [-1, 0, 'up'],
      [0, 1, 'right'],
      [0, -1, 'left'],
    ];
    const dfs = (r: number, c: number): number => {
      if (memo[r][c] !== null) {
        probe = [r, c];
        probeTone = 'info';
        t.step('hit', `(${r},${c}) is already in the memo: dp = ${memo[r][c]}. Reuse it — no second DFS.`, { r, c, 'dp[(r,c)]': memo[r][c] });
        return memo[r][c]!;
      }
      stack.push([r, c]);
      cur = [r, c];
      probe = null;
      let res = 1;
      t.step('start', `dfs(${r},${c}) value ${matrix[r][c]}: res = 1 (the path that is just this cell).`, { r, c, res });
      if (askedVal < 2 && ans[r][c] >= 3 && stack.length === 1) {
        askedVal++;
        const [o, a] = choices(ans[r][c], [ans[r][c] - 1, ans[r][c] + 1, 1]);
        t.predict(`What will dp[(${r},${c})] be?`, o, a, `The longest strictly increasing walk from value ${matrix[r][c]} has ${ans[r][c]} cells.`);
      }
      for (const [dr, dc, name] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        cur = [r, c];
        probe = [nr, nc];
        if (!inside(nr, nc)) {
          probeTone = 'bad';
          t.step('guard', `${name}: (${nr},${nc}) is off the grid → contributes 0; res stays ${res}.`, { r, c, res });
          continue;
        }
        if (matrix[nr][nc] <= matrix[r][c]) {
          probeTone = 'bad';
          t.step('guard', `${name}: ${matrix[nr][nc]} is not > ${matrix[r][c]} → not an increasing step; res stays ${res}.`, { r, c, res });
          continue;
        }
        probeTone = 'info';
        t.step('dir', `${name}: ${matrix[nr][nc]} > ${matrix[r][c]} → explore from (${nr},${nc}).`, { r, c, nr, nc });
        const sub = dfs(nr, nc);
        cur = [r, c];
        probe = [nr, nc];
        probeTone = 'info';
        const old = res;
        res = Math.max(res, 1 + sub);
        t.step('recur', `Back at (${r},${c}): res = max(${old}, 1 + dp[(${nr},${nc})]=${sub}) = ${res}.`, { r, c, res });
      }
      memo[r][c] = res;
      probe = null;
      t.step('store', `dp[(${r},${c})] = ${res}.`, { r, c, 'dp[(r,c)]': res });
      stack.pop();
      cur = stack.length ? stack[stack.length - 1] : null;
      return res;
    };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        cur = null;
        probe = [r, c];
        probeTone = 'info';
        t.step('call', `Outer loop: make sure dp[(${r},${c})] is known.`, { r, c });
        if (!askedHit && memo[r][c] !== null) {
          askedHit = true;
          t.predict(`Will dfs(${r},${c}) run its four directions again?`, ['Yes, recompute', 'No, reuse the memo'], 1, `It was solved during an earlier DFS (dp = ${memo[r][c]}).`);
        }
        dfs(r, c);
      }
    }
    let res = 0;
    let sr = 0;
    let sc = 0;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (memo[r][c]! > res) {
          res = memo[r][c]!;
          sr = r;
          sc = c;
        }
    // Walk one longest path for display.
    const path: Cell[] = [[sr, sc]];
    for (let k = res; k > 1; k--) {
      const [r, c] = path[path.length - 1];
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (inside(nr, nc) && matrix[nr][nc] > matrix[r][c] && memo[nr][nc] === k - 1) {
          path.push([nr, nc]);
          break;
        }
      }
    }
    cur = null;
    probe = null;
    best = path;
    t.step('done', `max(dp) = ${res}: ${path.map(([r, c]) => matrix[r][c]).join(' → ')}.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const distinctSubsequences: Problem<{ s: string; t: string }> = {
  id: 'distinct-subsequences',
  num: 115,
  title: 'Distinct Subsequences',
  difficulty: 'Hard',
  category: 'dp-2d',
  pattern: 'dp-2d',
  statement: 'Count the number of different ways (by chosen positions) to delete characters from s so that what remains is exactly t.',
  signals: ['"number of distinct subsequences of s equal to t"', 'two strings, prefix vs prefix', 'at each matching char: use it or skip it'],
  insight:
    'dp[i][j] = ways for s[:i] to produce t[:j]. The char s[i−1] can always be skipped (dp[i−1][j]); if it equals t[j−1] it can also be used to finish t[:j] (dp[i−1][j−1]).',
  hints: [
    'How many ways does any prefix of s produce the empty string?',
    'Consider the last char of the s-prefix: skip it, or (if it matches) use it.',
    'dp[i][j] = dp[i−1][j] + (s[i−1] == t[j−1]) · dp[i−1][j−1]; dp[i][0] = 1.',
  ],
  pitfall: 'When chars match, taking only dp[i−1][j−1] — you must ALSO count the ways that skip this s char.',
  backend: {
    title: 'Counting matches of an event funnel in a clickstream',
    detail:
      'Product analytics asks "in how many distinct ways does this session’s event stream contain the funnel view → cart → buy as a subsequence?" Events of the session are rows, funnel steps are columns, and each cell counts partial funnel matches — the same table, used to weight conversion attribution.',
  },
  complexity: { time: 'O(m·n)', space: 'O(m·n) (O(n) with one row)' },
  code: `
def numDistinct(s, t):
    dp = [[0] * (len(t) + 1) for _ in range(len(s) + 1)]   @init
    for i in range(len(s) + 1): dp[i][0] = 1         @seed
    for i in range(1, len(s) + 1):                    @row
        for j in range(1, len(t) + 1):                @col
            dp[i][j] = dp[i - 1][j]                   @skip
            if s[i - 1] == t[j - 1]:                  @match
                dp[i][j] += dp[i - 1][j - 1]          @use
    return dp[len(s)][len(t)]                         @done
`,
  explain: {
    seed: 'Deleting everything is exactly one way to produce the empty t.',
    skip: 'Ways that do not use s[i−1].',
    match: 'Only a matching char can be the last char of t[:j].',
    use: 'Use s[i−1] as t[j−1]: the rest of t[:j−1] must come from s[:i−1].',
  },
  distractors: [
    { text: '                dp[i][j] = dp[i - 1][j - 1]', why: 'Overwrites the "skip" ways; on a match both options count.' },
    { text: '    for j in range(len(t) + 1): dp[0][j] = 1', why: 'An empty s cannot produce a non-empty t: row 0 is 0 except dp[0][0].' },
    { text: '                dp[i][j] += dp[i][j - 1]', why: 'Reads the same s-prefix with a shorter t — that would reuse s[i−1] for two different t chars.' },
  ],
  input: { s: 'babgbag', t: 'bag' },
  presets: [
    { label: 'rabbbit', input: { s: 'rabbbit', t: 'rabbit' } },
    { label: 'impossible', input: { s: 'abc', t: 'abd' } },
  ],
  validate: (inp) =>
    typeof inp.s !== 'string' || typeof inp.t !== 'string' ? 'Expected { s: string, t: string }' : inp.s.length < 1 || inp.s.length > 8 || inp.t.length < 1 || inp.t.length > 7 ? 'Keep 1 ≤ len(s) ≤ 8 and 1 ≤ len(t) ≤ 7' : null,
  trace(tr, inp) {
    const s = inp.s;
    const tt = inp.t;
    const R = s.length + 1;
    const C = tt.length + 1;
    const dp = grid2(R, C, 0);
    const known = grid2(R, C, false);
    let cur: Cell | null = null;
    let reads: Cell[] = [];
    let finished = false;
    tr.draw(() => [
      V.grid('dp (ways s[:i] produces t[:j])', table(dp, known, cur), {
        tones: finished ? { [rc(R - 1, C - 1)]: dp[R - 1][C - 1] ? 'good' : 'bad' } : gmark(cur, reads),
        pointers: { cell: cur },
        rowLabels: ['∅', ...s],
        colLabels: ['∅', ...tt],
      }),
    ]);
    for (let j = 0; j < C; j++) known[0][j] = true;
    tr.step('init', `Rows = prefixes of s, columns = prefixes of t. Row 0 (empty s) is 0: you cannot produce a non-empty t from nothing.`);
    for (let i = 0; i < R; i++) {
      dp[i][0] = 1;
      known[i][0] = true;
    }
    tr.step('seed', 'Column 0 is all 1: delete every char to get the empty t — exactly one way.');
    let asked = 0;
    for (let i = 1; i < R; i++) {
      cur = null;
      reads = [];
      tr.step('row', `Row ${i}: s char '${s[i - 1]}' becomes available.`, { i });
      for (let j = 1; j < C; j++) {
        cur = [i, j];
        reads = [[i - 1, j]];
        const same = s[i - 1] === tt[j - 1];
        const val = dp[i - 1][j] + (same ? dp[i - 1][j - 1] : 0);
        if (asked < 3 && same && dp[i - 1][j] > 0 && dp[i - 1][j - 1] > 0) {
          asked++;
          const [o, a] = choices(val, [dp[i - 1][j], dp[i - 1][j - 1], val + 1]);
          tr.predict(`What will dp[${i}][${j}] be?`, o, a, `skip '${s[i - 1]}': ${dp[i - 1][j]} + use it as '${tt[j - 1]}': ${dp[i - 1][j - 1]} = ${val}.`);
        }
        dp[i][j] = dp[i - 1][j];
        known[i][j] = true;
        tr.step('skip', `Skip s[${i - 1}]='${s[i - 1]}': dp[${i}][${j}] starts at dp[${i - 1}][${j}] = ${dp[i - 1][j]}.${same ? '' : ` ('${s[i - 1]}' ≠ '${tt[j - 1]}', so that is all.)`}`, { i, j, 'dp[i][j]': dp[i][j] });
        if (same) {
          reads = [[i - 1, j - 1]];
          tr.step('match', `'${s[i - 1]}' == '${tt[j - 1]}': it can also serve as the last char of '${tt.slice(0, j)}'.`, { i, j });
          reads = [
            [i - 1, j],
            [i - 1, j - 1],
          ];
          dp[i][j] += dp[i - 1][j - 1];
          tr.step('use', `dp[${i}][${j}] = dp[${i - 1}][${j}] + dp[${i - 1}][${j - 1}] = ${dp[i - 1][j]} + ${dp[i - 1][j - 1]} = ${dp[i][j]}.`, { i, j, 'dp[i][j]': dp[i][j] });
        }
      }
    }
    cur = null;
    reads = [];
    finished = true;
    tr.step('done', `dp[${R - 1}][${C - 1}] = ${dp[R - 1][C - 1]} distinct ways.`, { result: dp[R - 1][C - 1] });
    return dp[R - 1][C - 1];
  },
};

// ---------------------------------------------------------------------------

const editDistance: Problem<{ word1: string; word2: string }> = {
  id: 'edit-distance',
  num: 72,
  title: 'Edit Distance',
  difficulty: 'Medium',
  category: 'dp-2d',
  pattern: 'dp-2d',
  statement: 'Return the fewest single-character insertions, deletions or replacements needed to turn one word into another.',
  signals: ['"minimum number of operations" to transform a string', 'insert / delete / replace', 'two strings → prefix × prefix table'],
  insight:
    'dp[i][j] = edits to turn word1[:i] into word2[:j]. Equal last chars cost nothing (diagonal). Otherwise pay 1 for the cheapest of delete (top), insert (left) or replace (diagonal).',
  hints: [
    'How many edits turn a prefix into the empty string?',
    'Look at the last chars. If equal, what is left to fix?',
    'dp[i][j] = dp[i−1][j−1] if equal else 1 + min(dp[i−1][j], dp[i][j−1], dp[i−1][j−1]).',
  ],
  pitfall: 'Seeding row 0 / column 0 with 0 — turning a prefix of length i into "" needs i deletions.',
  backend: {
    title: '"Did you mean…?" for CLI commands and search',
    detail:
      'kubectl, git and search backends suggest the closest valid command or term by edit (Levenshtein) distance. The typed token indexes rows, each candidate indexes columns, and the bottom-right cell is the typo distance used to rank suggestions.',
  },
  complexity: { time: 'O(m·n)', space: 'O(m·n) (O(n) with two rows)' },
  code: `
def minDistance(word1, word2):
    dp = [[0] * (len(word2) + 1) for _ in range(len(word1) + 1)]   @init
    for i in range(len(word1) + 1): dp[i][0] = i      @seedCol
    for j in range(len(word2) + 1): dp[0][j] = j      @seedRow
    for i in range(1, len(word1) + 1):                @row
        for j in range(1, len(word2) + 1):            @col
            if word1[i - 1] == word2[j - 1]:          @match
                dp[i][j] = dp[i - 1][j - 1]           @same
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])   @edit
    return dp[-1][-1]                                 @done
`,
  explain: {
    seedCol: 'word1[:i] → "" needs i deletions.',
    seedRow: '"" → word2[:j] needs j insertions.',
    same: 'Matching last chars: no edit, solve the shorter prefixes.',
    edit: 'top = delete word1[i−1], left = insert word2[j−1], diagonal = replace one with the other.',
  },
  distractors: [
    { text: '                dp[i][j] = 1 + dp[i - 1][j - 1]', why: 'Equal characters need no edit — paying 1 here overcounts.' },
    { text: '                dp[i][j] = min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])', why: 'Forgets to pay for the edit itself (+1).' },
    { text: '    for i in range(len(word1) + 1): dp[i][0] = 0', why: 'Turning a non-empty prefix into "" costs one deletion per char.' },
  ],
  input: { word1: 'horse', word2: 'ros' },
  presets: [
    { label: 'intention → execution', input: { word1: 'intent', word2: 'execut' } },
    { label: 'empty target', input: { word1: 'abc', word2: '' } },
  ],
  validate: ({ word1, word2 }) =>
    typeof word1 !== 'string' || typeof word2 !== 'string' ? 'Expected { word1: string, word2: string }' : word1.length > 7 || word2.length > 8 ? 'Keep len(word1) ≤ 7 and len(word2) ≤ 8' : null,
  trace(t, { word1, word2 }) {
    const R = word1.length + 1;
    const C = word2.length + 1;
    const dp = grid2(R, C, 0);
    const known = grid2(R, C, false);
    let cur: Cell | null = null;
    let reads: Cell[] = [];
    let path: Cell[] = [];
    let ops: string[] = [];
    t.draw(() => [
      V.grid('dp (edits: word1[:i] → word2[:j])', table(dp, known, cur), {
        tones: path.length ? Object.fromEntries(path.map(([r, c]) => [rc(r, c), 'good' as Tone])) : gmark(cur, reads),
        pointers: { cell: cur },
        rowLabels: ['∅', ...word1],
        colLabels: ['∅', ...word2],
      }),
      path.length > 0 && V.chips('edits', ops.length ? ops : ['(none)'], { tones: Object.fromEntries(ops.map((_, k) => [k, 'warn' as Tone])) }),
    ]);
    t.step('init', `A ${R} × ${C} table: rows = prefixes of '${word1}', columns = prefixes of '${word2}'.`);
    for (let i = 0; i < R; i++) {
      dp[i][0] = i;
      known[i][0] = true;
    }
    t.step('seedCol', `Column 0: turning word1[:i] into "" takes i deletions.`);
    for (let j = 0; j < C; j++) {
      dp[0][j] = j;
      known[0][j] = true;
    }
    t.step('seedRow', `Row 0: building word2[:j] from "" takes j insertions.`);
    let askedWin = 0;
    let askedSame = false;
    for (let i = 1; i < R; i++) {
      cur = null;
      reads = [];
      t.step('row', `Row ${i}: word1 prefix '${word1.slice(0, i)}'.`, { i });
      for (let j = 1; j < C; j++) {
        cur = [i, j];
        const same = word1[i - 1] === word2[j - 1];
        const del = dp[i - 1][j];
        const ins = dp[i][j - 1];
        const rep = dp[i - 1][j - 1];
        reads = same
          ? [[i - 1, j - 1]]
          : [
              [i - 1, j],
              [i, j - 1],
              [i - 1, j - 1],
            ];
        t.step('match', same ? `'${word1[i - 1]}' == '${word2[j - 1]}' → no edit needed for these last chars.` : `'${word1[i - 1]}' ≠ '${word2[j - 1]}' → one edit: delete (top ${del}), insert (left ${ins}) or replace (diagonal ${rep}).`, { i, j });
        if (same) {
          if (!askedSame && rep > 0) {
            askedSame = true;
            const [o, a] = choices(rep, [rep + 1, Math.min(del, ins) + 1 === rep ? rep + 2 : Math.min(del, ins) + 1, 0]);
            t.predict(`What is dp[${i}][${j}]?`, o, a, `The last chars match, so copy the diagonal: ${rep}.`);
          }
          dp[i][j] = rep;
          known[i][j] = true;
          t.step('same', `dp[${i}][${j}] = dp[${i - 1}][${j - 1}] = ${rep}.`, { i, j, 'dp[i][j]': rep });
        } else {
          const m = Math.min(del, ins, rep);
          const winners = [del, ins, rep].filter((x) => x === m).length;
          if (askedWin < 2 && winners === 1) {
            askedWin++;
            t.predict(`Which neighbour wins for dp[${i}][${j}]?`, [`delete (top ${del})`, `insert (left ${ins})`, `replace (diagonal ${rep})`], [del, ins, rep].indexOf(m), `min(${del}, ${ins}, ${rep}) = ${m}, so dp = 1 + ${m} = ${m + 1}.`);
          }
          dp[i][j] = 1 + m;
          known[i][j] = true;
          reads = [del === m ? [i - 1, j] : ins === m ? [i, j - 1] : [i - 1, j - 1]];
          t.step('edit', `dp[${i}][${j}] = 1 + min(del ${del}, ins ${ins}, rep ${rep}) = ${dp[i][j]}.`, { i, j, 'dp[i][j]': dp[i][j] });
        }
      }
    }
    // Recover one optimal edit script.
    const p: Cell[] = [[R - 1, C - 1]];
    const o: string[] = [];
    let i = R - 1;
    let j = C - 1;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && word1[i - 1] === word2[j - 1] && dp[i][j] === dp[i - 1][j - 1]) {
        i--;
        j--;
      } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
        o.push(`replace '${word1[i - 1]}'→'${word2[j - 1]}'`);
        i--;
        j--;
      } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
        o.push(`delete '${word1[i - 1]}'`);
        i--;
      } else {
        o.push(`insert '${word2[j - 1]}'`);
        j--;
      }
      p.push([i, j]);
    }
    cur = null;
    reads = [];
    path = p;
    ops = o.reverse();
    t.step('done', `dp[${R - 1}][${C - 1}] = ${dp[R - 1][C - 1]} edits (one optimal script shown; the green cells are the path back to (0,0)).`, { result: dp[R - 1][C - 1] });
    return dp[R - 1][C - 1];
  },
};

// ---------------------------------------------------------------------------

const burstBalloons: Problem<{ nums: number[] }> = {
  id: 'burst-balloons',
  num: 312,
  title: 'Burst Balloons',
  difficulty: 'Hard',
  category: 'dp-2d',
  pattern: 'dp-2d',
  statement:
    'Balloons carry numbers. Bursting balloon i earns left × nums[i] × right, where left/right are its current neighbours (1 beyond the ends). Burst all of them in the best order and return the maximum total.',
  signals: ['order of removals matters and neighbours change', 'small n with a "best order" question', 'interval structure: solve a range from its sub-ranges'],
  insight:
    'Think about which balloon is burst LAST in a range (l, r): its neighbours are then fixed to nums[l−1] and nums[r+1], and the left and right parts are independent sub-ranges. dp[l][r] = max over i of nums[l−1]·nums[i]·nums[r+1] + dp[l][i−1] + dp[i+1][r].',
  hints: [
    'Choosing the FIRST balloon to burst leaves neighbours that keep changing. What about the LAST?',
    'If i is last in (l, r), everything else in (l, r) is gone, so its neighbours are the balloons just outside the range.',
    'Pad with 1s, fill dp by increasing interval length; dp[1][n] is the answer.',
  ],
  pitfall: 'Multiplying by nums[i−1] and nums[i+1] (the original neighbours) instead of the range boundaries nums[l−1] and nums[r+1].',
  backend: {
    title: 'Optimal merge order for SSTables / matrix-chain style planning',
    detail:
      'Query planners and LSM-tree compactors choose the order of pairwise operations whose cost depends on the neighbours at the time (join ordering, matrix-chain multiplication, compaction merges). They use the same interval DP: cost of a range = best split point + cost of the two independent sub-ranges.',
  },
  complexity: { time: 'O(n³)', space: 'O(n²)' },
  code: `
def maxCoins(nums):
    nums = [1] + nums + [1]                           @pad
    n = len(nums)
    dp = [[0] * n for _ in range(n)]                  @init
    for length in range(1, n - 1):                    @len
        for l in range(1, n - length):                @left
            r = l + length - 1
            for i in range(l, r + 1):                 @last
                coins = nums[l - 1] * nums[i] * nums[r + 1] + dp[l][i - 1] + dp[i + 1][r]   @coins
                dp[l][r] = max(dp[l][r], coins)       @best
    return dp[1][n - 2]                               @done
`,
  explain: {
    pad: 'Virtual 1s at both ends make the boundary product well-defined.',
    len: 'Short ranges first, so every sub-range we read is already final.',
    last: 'Try every balloon as the LAST one burst in nums[l..r].',
    coins: 'Its neighbours are the boundaries l−1 and r+1; the two sides were solved independently.',
  },
  distractors: [
    { text: '                coins = nums[i - 1] * nums[i] * nums[i + 1] + dp[l][i - 1] + dp[i + 1][r]', why: 'When i is burst last in (l, r), its neighbours are nums[l−1] and nums[r+1], not its original neighbours.' },
    { text: '    for l in range(1, n - 1):', why: 'Iterating by left end alone reads dp[i+1][r] before it is computed — iterate by interval length.' },
    { text: '                dp[l][r] = coins', why: 'Keeps only the last split tried instead of the best one.' },
  ],
  input: { nums: [3, 1, 5, 8] },
  presets: [
    { label: 'two balloons', input: { nums: [1, 5] } },
    { label: 'three', input: { nums: [2, 4, 3] } },
  ],
  validate: ({ nums }) => (!isIntArray(nums) || nums.some((x) => x < 0) ? 'Expected { nums: non-negative integer[] }' : nums.length < 1 || nums.length > 4 ? 'Keep 1 ≤ len(nums) ≤ 4 (O(n³) frames)' : null),
  trace(t, { nums: raw }) {
    const nums = [1, ...raw, 1];
    const n = nums.length;
    const k = raw.length;
    const dp = grid2(n, n, 0);
    const known = grid2(k, k, false);
    let L = -1;
    let Rr = -1;
    let I = -1;
    let reads: Cell[] = [];
    let padded = false;
    let finished = false;
    // Display only l, r in 1..n−2 → table cell (l−1, r−1).
    t.draw(() => {
      const cells = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => (a > b ? '' : known[a][b] ? dp[a + 1][b + 1] : L - 1 === a && Rr - 1 === b ? '?' : '·')));
      const tn: Record<string, Tone> = {};
      for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) tn[rc(a, b)] = 'muted';
      if (finished) tn[rc(0, k - 1)] = 'good';
      else Object.assign(tn, gmark(L > 0 ? [L - 1, Rr - 1] : null, reads));
      const at: Record<number, Tone> = {};
      if (padded) {
        at[0] = 'muted';
        at[n - 1] = 'muted';
      }
      if (L > 0) {
        at[L - 1] = 'info';
        at[Rr + 1] = 'info';
        if (I >= 0) at[I] = 'active';
      }
      return [
        V.array(padded ? 'nums (padded with 1s)' : 'nums', padded ? nums : raw, { pointers: L > 0 ? { l: L, r: Rr, i: I >= 0 ? I : null } : {}, tones: padded ? at : {}, window: L > 0 ? [L, Rr] : null }),
        padded && V.grid('dp[l][r] (best coins for balloons l..r)', cells, { tones: tn, pointers: { cell: L > 0 ? [L - 1, Rr - 1] : null }, rowLabels: raw.map((v, a) => `l=${a + 1} (${v})`), colLabels: raw.map((v, b) => `r=${b + 1} (${v})`) }),
      ];
    });
    t.step('pad', 'Add a virtual balloon worth 1 at each end so every burst has two neighbours.');
    padded = true;
    t.step('init', `dp[l][r] = most coins from bursting exactly balloons l…r (indices into the padded array), with l−1 and r+1 still standing.`);
    let asked = 0;
    for (let len = 1; len <= k; len++) {
      L = -1;
      I = -1;
      reads = [];
      t.step('len', `Intervals of length ${len}${len === 1 ? ' (single balloons)' : ''}.`, { length: len });
      for (let l = 1; l + len - 1 <= k; l++) {
        const r = l + len - 1;
        L = l;
        Rr = r;
        I = -1;
        reads = [];
        t.step('left', `Range [${l}..${r}] = (${nums.slice(l, r + 1).join(', ')}), boundaries ${nums[l - 1]} and ${nums[r + 1]}.`, { l, r });
        const vals: number[] = [];
        for (let i = l; i <= r; i++) vals.push(nums[l - 1] * nums[i] * nums[r + 1] + dp[l][i - 1] + dp[i + 1][r]);
        const mx = Math.max(...vals);
        if (asked < 3 && len >= 2 && vals.filter((v) => v === mx).length === 1 && (len === k || (len === 2 && asked === 0) || (len === 3 && asked < 2))) {
          asked++;
          const opts = vals.map((_, d) => `${nums[l + d]} (index ${l + d})`);
          t.predict(`Which balloon should burst LAST in [${l}..${r}]?`, opts, vals.indexOf(mx), `Last-burst totals: ${vals.map((v, d) => `${nums[l + d]}→${v}`).join(', ')}; the best is ${mx}.`);
        }
        for (let i = l; i <= r; i++) {
          I = i;
          reads = [];
          if (i - 1 >= l) reads.push([l - 1, i - 2]);
          if (i + 1 <= r) reads.push([i, r - 1]);
          const left = dp[l][i - 1];
          const right = dp[i + 1][r];
          const coins = nums[l - 1] * nums[i] * nums[r + 1] + left + right;
          t.step('coins', `Burst ${nums[i]} last: ${nums[l - 1]}×${nums[i]}×${nums[r + 1]} + left dp[${l}][${i - 1}]=${left} + right dp[${i + 1}][${r}]=${right} = ${coins}.`, { l, r, i, coins });
          const old = dp[l][r];
          dp[l][r] = Math.max(old, coins);
          known[l - 1][r - 1] = true;
          t.step('best', coins > old ? `New best for [${l}..${r}]: ${coins}.` : `Keep ${old} (≥ ${coins}).`, { l, r, 'dp[l][r]': dp[l][r] });
        }
      }
    }
    L = -1;
    I = -1;
    reads = [];
    finished = true;
    t.step('done', `dp[1][${k}] = ${dp[1][k]} coins.`, { result: dp[1][k] });
    return dp[1][k];
  },
};

// ---------------------------------------------------------------------------

const regularExpressionMatching: Problem<{ s: string; p: string }> = {
  id: 'regular-expression-matching',
  num: 10,
  title: 'Regular Expression Matching',
  difficulty: 'Hard',
  category: 'dp-2d',
  pattern: 'dp-2d',
  statement:
    'Implement full-string matching for patterns where "." matches any single character and "x*" matches zero or more copies of the preceding element x.',
  signals: ['pattern with "*" meaning zero-or-more', 'must match the ENTIRE string', 'suffix of string vs suffix of pattern → 2-D state'],
  insight:
    'dp[i][j] = "s[i:] matches p[j:]". If p[j+1] is "*", either skip "x*" entirely (dp[i][j+2]) or, if s[i] matches x, consume one char and stay on "x*" (dp[i+1][j]). Otherwise the chars must match and both advance (dp[i+1][j+1]).',
  hints: [
    'Without "*", how would you match char by char?',
    'A "x*" offers two choices: use it zero times, or eat one matching char and keep the same "x*".',
    'Fill dp from the bottom-right: dp[len(s)][len(p)] = True.',
  ],
  pitfall: 'Treating "*" on its own instead of together with the previous char, or forgetting that "x*" can match zero chars (so "c*a" matches "a").',
  backend: {
    title: 'Route / topic pattern matching in a message broker',
    detail:
      'Brokers and API gateways match topics or paths against subscription patterns with wildcards (e.g. "orders.*.created"). Matching a topic against a pattern with repeatable wildcards is this table: topic position × pattern position, where a wildcard either matches nothing or eats one more segment.',
  },
  complexity: { time: 'O(m·n)', space: 'O(m·n)' },
  code: `
def isMatch(s, p):
    dp = [[False] * (len(p) + 1) for _ in range(len(s) + 1)]   @init
    dp[len(s)][len(p)] = True                         @seed
    for i in range(len(s), -1, -1):                   @row
        for j in range(len(p) - 1, -1, -1):           @col
            first = i < len(s) and p[j] in (s[i], ".")           @first
            if j + 1 < len(p) and p[j + 1] == "*":                @star
                dp[i][j] = dp[i][j + 2] or (first and dp[i + 1][j])   @starCalc
            else:
                dp[i][j] = first and dp[i + 1][j + 1]            @plain
    return dp[0][0]                                   @done
`,
  explain: {
    seed: 'Empty string matches empty pattern.',
    first: 'Does the current string char match the current pattern element?',
    starCalc: 'Skip "x*" (zero copies) OR use one copy and stay on "x*" for the rest of the string.',
    plain: 'No star: this char must match and both sides advance one.',
  },
  distractors: [
    { text: '                dp[i][j] = first and dp[i + 1][j + 2]', why: 'Using one copy and then leaving "x*" means "x*" can match at most one char — it must stay on j to allow more.' },
    { text: '                dp[i][j] = dp[i][j + 2]', why: 'Only the zero-copies case; "a*" could never match "aa".' },
    { text: '            first = p[j] in (s[i], ".")', why: 'Without `i < len(s)` this indexes past the end of s on the last row.' },
  ],
  input: { s: 'aab', p: 'c*a*b' },
  presets: [
    { label: '"aa" vs "a"', input: { s: 'aa', p: 'a' } },
    { label: '".*" matches all', input: { s: 'ab', p: '.*' } },
    { label: 'no match', input: { s: 'ab', p: '.*c' } },
  ],
  validate: ({ s, p }) =>
    typeof s !== 'string' || typeof p !== 'string' || !/^[a-z]*$/.test(s) || !/^[a-z.*]*$/.test(p) || /^\*|\*\*/.test(p)
      ? 'Expected { s: lowercase string, p: pattern of a-z, ".", "*" (each "*" after a char) }'
      : !p.length || s.length > 6 || p.length > 7
        ? 'Keep len(s) ≤ 6 and 1 ≤ len(p) ≤ 7'
        : null,
  trace(t, { s, p }) {
    const R = s.length + 1;
    const C = p.length + 1;
    const dp = grid2(R, C, false);
    const known = grid2(R, C, false);
    let cur: Cell | null = null;
    let reads: Cell[] = [];
    let finished = false;
    let ti = -1;
    let tj = -1;
    t.draw(() => [
      V.text('s', s || '(empty)', { tones: s && ti >= 0 && ti < s.length ? { [ti]: 'active' } : {} }),
      V.text('p', p, { tones: tj >= 0 ? (tj + 1 < p.length && p[tj + 1] === '*' ? { [tj]: 'active', [tj + 1]: 'active' } : { [tj]: 'active' }) : {} }),
      V.grid('dp (s[i:] matches p[j:]?)', table(dp, known, cur, TF), {
        tones: finished ? { [rc(0, 0)]: dp[0][0] ? 'good' : 'bad' } : gmark(cur, reads),
        pointers: { cell: cur },
        rowLabels: [...s, '∅'],
        colLabels: [...p, '∅'],
      }),
    ]);
    for (let i = 0; i < R; i++) known[i][C - 1] = true;
    t.step('init', 'Rows = where the remaining string starts, columns = where the remaining pattern starts. The last column (empty pattern) is False for any non-empty string.');
    dp[R - 1][C - 1] = true;
    cur = [R - 1, C - 1];
    t.step('seed', 'Bottom-right: empty string vs empty pattern → True. We fill upward/leftward from here.');
    let askedStar = 0;
    let askedPlain = false;
    for (let i = R - 1; i >= 0; i--) {
      cur = null;
      reads = [];
      ti = i;
      tj = -1;
      t.step('row', i === s.length ? 'Row for the EMPTY remaining string: only patterns made of "x*" pieces can match it.' : `Row ${i}: remaining string '${s.slice(i)}'.`, { i });
      for (let j = C - 2; j >= 0; j--) {
        cur = [i, j];
        reads = [];
        tj = j;
        const first = i < s.length && (p[j] === s[i] || p[j] === '.');
        const star = j + 1 < p.length && p[j + 1] === '*';
        if (p[j] === '*' && !star) {
          dp[i][j] = false;
          known[i][j] = true;
          t.step('plain', `p[${j}] is "*" — it only means something together with the char before it, so a match can never START here: False.`, { i, j });
          continue;
        }
        t.step('first', i >= s.length ? `No string char left, so first = False.` : `first = '${s[i]}' vs '${p[j]}' → ${py(first)}.`, { i, j, first });
        if (star) {
          const skip = dp[i][j + 2];
          const use = first && dp[i + 1][j];
          reads = [[i, j + 2]];
          if (first) reads.push([i + 1, j]);
          if (askedStar < 2 && (use || skip) && i < s.length) {
            askedStar++;
            t.predict(`"${p[j]}*" here: which choice makes dp[${i}][${j}] True?`, [`skip "${p[j]}*" (dp[${i}][${j + 2}])`, `use it on '${s[i]}' and stay (dp[${i + 1}][${j}])`], skip ? 0 : 1, skip ? `Zero copies already works: dp[${i}][${j + 2}] = True.` : `Skipping fails (dp[${i}][${j + 2}] = False) but '${s[i]}' matches '${p[j]}' and dp[${i + 1}][${j}] = True.`);
          }
          dp[i][j] = skip || use;
          known[i][j] = true;
          t.step('starCalc', `"${p[j]}*": skip it → dp[${i}][${j + 2}] = ${py(skip)}; use one copy → first and dp[${i + 1}][${j}] = ${first ? py(dp[i + 1][j]) : 'False'}. dp[${i}][${j}] = ${py(dp[i][j])}.`, { i, j, 'dp[i][j]': dp[i][j] });
        } else {
          if (first) reads = [[i + 1, j + 1]];
          if (!askedPlain && first && i < s.length - 0 && j < p.length - 1) {
            askedPlain = true;
            t.predict(`'${s[i]}' matches '${p[j]}'. Is dp[${i}][${j}] True?`, ['True', 'False'], dp[i + 1][j + 1] ? 0 : 1, `It copies the diagonal dp[${i + 1}][${j + 1}] = ${py(dp[i + 1][j + 1])}.`);
          }
          dp[i][j] = first && dp[i + 1][j + 1];
          known[i][j] = true;
          t.step('plain', first ? `Chars match → dp[${i}][${j}] = dp[${i + 1}][${j + 1}] = ${py(dp[i][j])}.` : `No match and no "*" to fall back on → False.`, { i, j, 'dp[i][j]': dp[i][j] });
        }
      }
    }
    cur = null;
    reads = [];
    ti = -1;
    tj = -1;
    finished = true;
    t.step('done', `dp[0][0] = ${py(dp[0][0])}: '${s}' ${dp[0][0] ? 'matches' : 'does not match'} '${p}'.`, { result: dp[0][0] });
    return dp[0][0];
  },
};

export const problems: Problem[] = [
  uniquePaths,
  longestCommonSubsequence,
  stockCooldown,
  coinChangeII,
  targetSum,
  interleavingString,
  longestIncreasingPath,
  distinctSubsequences,
  editDistance,
  burstBalloons,
  regularExpressionMatching,
];

export const variants: Variant[] = [
  {
    id: 'min-latency-grid-route',
    title: 'Lowest-Latency Route Through a Mesh',
    statement:
      'A grid of edge routers has a per-hop latency in each cell. Traffic enters at the top-left and must exit at the bottom-right, moving only right or down. Return the minimum total latency.',
    pattern: 'dp-2d',
    nearest: 'unique-paths',
    signals: ['grid with right/down moves only', '"minimum total cost" of a path', 'each cell reached from top or left'],
    approach: 'dp[r][c] = grid[r][c] + min(dp[r−1][c], dp[r][c−1]); first row/column are prefix sums. Answer dp[m−1][n−1].',
    backend: 'Choosing the cheapest path through a layered network or a staged pipeline where each stage/zone adds latency.',
  },
  {
    id: 'config-drift-deletions',
    title: 'Minimum Deletions to Reconcile Two Configs',
    statement:
      'Two versions of a config file are given as lists of lines. You may only delete lines (from either file). Return the minimum number of deletions so both files become identical.',
    pattern: 'dp-2d',
    nearest: 'longest-common-subsequence',
    signals: ['two sequences compared in order', '"make them equal" using deletions only', 'kept lines must appear in the same order in both'],
    approach: 'Compute the LCS length L with the prefix × prefix table; the answer is len(a) + len(b) − 2·L.',
    backend: 'Config-drift detection (Ansible/Terraform-style): the LCS of lines is what both versions share; the rest is the drift a reviewer must look at.',
  },
  {
    id: 'acl-wildcard-match',
    title: 'Wildcard ACL Path Matching',
    statement:
      'An access-control rule is a path pattern where "?" matches exactly one character and "*" matches any sequence (including empty). Decide whether a request path fully matches the rule.',
    pattern: 'dp-2d',
    nearest: 'regular-expression-matching',
    signals: ['pattern with "*" = any sequence', 'must match the whole string', 'string position × pattern position state'],
    approach:
      'dp[i][j] = s[i:] matches p[j:]. If p[j] == "*": dp[i][j] = dp[i][j+1] (empty) or (i < n and dp[i+1][j]) (eat one char). Else need s[i] == p[j] or p[j] == "?", then dp[i+1][j+1].',
    backend: 'Evaluating allow/deny rules in an API gateway or object-store bucket policy against request paths.',
  },
  {
    id: 'typo-tolerant-command',
    title: 'Closest CLI Command Within k Edits',
    statement:
      'Given a mistyped command and a list of valid commands, return every valid command reachable with at most k single-character insertions, deletions or substitutions.',
    pattern: 'dp-2d',
    nearest: 'edit-distance',
    signals: ['"minimum edits" between strings', 'insert / delete / replace', 'compare one string against many candidates'],
    approach: 'Run the edit-distance table for each candidate (optionally only a diagonal band of width k for speed) and keep those with dp[m][n] ≤ k.',
    backend: '"Did you mean…?" suggestions in CLIs, search query correction, fuzzy matching of hostnames in an inventory service.',
  },
];
