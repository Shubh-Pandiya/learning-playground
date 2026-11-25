import type { Problem, Tone, Variant } from '../engine/types.ts';
import { V, rc } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Binary search — halve a sorted (or monotone) search space every step.
// ---------------------------------------------------------------------------

/** Tones for a binary-search window: outside [l, r] muted, m active. */
function windowTones(n: number, l: number, r: number, m: number, extra: Record<number, Tone> = {}): Record<number, Tone> {
  const tn: Record<number, Tone> = {};
  for (let k = 0; k < n; k++) if (k < l || k > r) tn[k] = 'muted';
  Object.assign(tn, extra);
  if (m >= 0 && m < n) tn[m] = 'active';
  return tn;
}

const isSorted = (a: number[]) => a.every((x, i) => i === 0 || a[i - 1] <= x);
const isNums = (a: unknown): a is number[] => Array.isArray(a) && a.every((x) => typeof x === 'number');

// ---------------------------------------------------------------------------

const binarySearch: Problem<{ nums: number[]; target: number }> = {
  id: 'binary-search',
  num: 704,
  title: 'Binary Search',
  difficulty: 'Easy',
  category: 'binary-search',
  pattern: 'binary-search',
  statement: 'Given a sorted array of distinct integers and a target, return the target\'s index or −1 if it is absent, in O(log n) time.',
  signals: ['sorted array', '"O(log n)"', 'find a value / position', 'distinct values'],
  insight:
    'Looking at the middle element tells you which half cannot contain the target, so every comparison throws away half of the remaining candidates.',
  hints: [
    'What does comparing target with the middle element tell you about the left half?',
    'Keep a window [l, r] that still could contain the target.',
    'm = (l + r) // 2; if nums[m] < target the answer is right of m (l = m + 1), else left (r = m − 1). Loop while l ≤ r.',
  ],
  pitfall: 'Using while l < r or setting r = m: with an inclusive window you either skip the last candidate or loop forever.',
  backend: {
    title: 'Finding a log offset by timestamp',
    detail:
      'Kafka and most log-structured stores keep a sparse, sorted index of (timestamp/offset → file position). Seeking a consumer to "messages since 10:42" binary-searches that index instead of scanning gigabytes; `git bisect` uses the same halving to find the bad commit.',
  },
  complexity: { time: 'O(log n)', space: 'O(1)' },
  code: `
def search(nums, target):
    l, r = 0, len(nums) - 1             @init
    while l <= r:                       @while
        m = l + (r - l) // 2            @mid
        if nums[m] > target:            @gt
            r = m - 1                   @left
        elif nums[m] < target:          @lt
            l = m + 1                   @right
        else:
            return m                    @found
    return -1                           @miss
`,
  explain: {
    init: 'Inclusive window: every index in [l, r] is still a candidate.',
    while: 'l ≤ r means the window is non-empty (a single element still counts).',
    mid: 'Same as (l + r) // 2 but cannot overflow in fixed-width languages.',
    left: 'nums[m] is too big, and so is everything right of it — drop m and the right half.',
    right: 'nums[m] is too small, and so is everything left of it.',
    miss: 'The window became empty: the target is not present.',
  },
  distractors: [
    { text: '    while l < r:', why: 'With an inclusive window this stops while one candidate is still unchecked (e.g. a 1-element array).' },
    { text: '            r = m', why: 'm was already ruled out; r = m can loop forever when l == r.' },
    { text: '        m = (l + r) / 2', why: '/ gives a float in Python; indices must be integers — use //.' },
  ],
  input: { nums: [-1, 0, 3, 5, 9, 12, 15, 20], target: 9 },
  presets: [
    { label: 'absent', input: { nums: [-1, 0, 3, 5, 9, 12], target: 2 } },
    { label: 'single element', input: { nums: [5], target: 5 } },
    { label: 'first element', input: { nums: [1, 4, 6, 8, 10, 13, 17], target: 1 } },
  ],
  validate: ({ nums, target }) =>
    !isNums(nums) || typeof target !== 'number' ? 'Expected { nums: number[], target: number }' : nums.length > 20 ? 'Keep nums ≤ 20' : !isSorted(nums) ? 'nums must be sorted' : null,
  trace(t, { nums, target }) {
    let l = 0;
    let r = nums.length - 1;
    let m = -1;
    let hit = -1;
    let predicts = 0;
    t.draw(() => [
      V.array('nums', nums, { pointers: { l, m, r }, window: [l, r], tones: windowTones(nums.length, l, r, m, hit >= 0 ? { [hit]: 'good' } : {}) }),
    ]);
    t.step('init', `Window is the whole array [${l}, ${r}].`, { l, r, target });
    while (l <= r) {
      m = -1;
      t.step('while', `l = ${l} ≤ r = ${r}: ${r - l + 1} candidate(s) left.`, { l, r });
      m = l + Math.floor((r - l) / 2);
      t.step('mid', `m = ${l} + (${r} − ${l}) // 2 = ${m}; nums[m] = ${nums[m]}.`, { l, r, m, 'nums[m]': nums[m] });
      if (predicts < 3 && nums[m] !== target) {
        predicts++;
        t.predict(`nums[m] = ${nums[m]}, target = ${target}. Which half survives?`, ['left half (r = m − 1)', 'right half (l = m + 1)'], nums[m] > target ? 0 : 1, nums[m] > target ? `${nums[m]} > ${target}: everything from m rightwards is too big.` : `${nums[m]} < ${target}: everything from m leftwards is too small.`);
      }
      if (nums[m] > target) {
        t.step('gt', `${nums[m]} > ${target}: the target, if present, is left of m.`, { m });
        r = m - 1;
        t.step('left', `r = ${r}. Indices ${m}… are discarded.`, { l, r });
      } else if (nums[m] < target) {
        t.step('gt', `${nums[m]} is not > ${target}.`, { m });
        t.step('lt', `${nums[m]} < ${target}: the target is right of m.`, { m });
        l = m + 1;
        t.step('right', `l = ${l}. Indices …${m} are discarded.`, { l, r });
      } else {
        t.step('gt', `${nums[m]} is not > ${target}.`, { m });
        t.step('lt', `${nums[m]} is not < ${target} either — it must be equal.`, { m });
        hit = m;
        t.step('found', `Found ${target} at index ${m}.`, { result: m });
        return m;
      }
    }
    m = -1;
    t.step('while', `l = ${l} > r = ${r}: the window is empty.`, { l, r });
    t.step('miss', `${target} is not in the array → −1.`, { result: -1 });
    return -1;
  },
};

// ---------------------------------------------------------------------------

const search2DMatrix: Problem<{ matrix: number[][]; target: number }> = {
  id: 'search-a-2d-matrix',
  num: 74,
  title: 'Search a 2D Matrix',
  difficulty: 'Medium',
  category: 'binary-search',
  pattern: 'binary-search',
  statement:
    'Each row of a matrix is sorted, and every row starts above the last value of the previous row. Report whether a target value exists in O(log(rows·cols)).',
  signals: ['rows sorted AND row i+1 starts after row i ends', 'O(log(m·n)) required', 'membership test', 'the whole matrix is one sorted sequence'],
  insight:
    'The matrix is just a sorted list cut into rows. Binary-search the rows by their first/last value to find the only row that could hold the target, then binary-search inside that row.',
  hints: [
    'If you read the matrix row by row, what do you get?',
    'Compare the target with a row\'s first and last value — that decides above / below / inside.',
    'Binary search rows (top/bot) until target lies in [row[0], row[-1]], then a normal binary search in that row.',
  ],
  pitfall: 'Stopping at the first row with row[0] ≤ target without checking row[-1]; or forgetting the "no row matched" case (top > bot) before searching columns.',
  backend: {
    title: 'Paged, sorted index lookup (B-tree style)',
    detail:
      'A database index or an SSTable stores sorted keys in fixed-size pages; the page directory keeps each page\'s first/last key. A point lookup first binary-searches the directory to pick the page (row), then binary-searches keys inside it (columns) — exactly this two-level search.',
  },
  complexity: { time: 'O(log m + log n)', space: 'O(1)' },
  code: `
def searchMatrix(matrix, target):
    ROWS, COLS = len(matrix), len(matrix[0])     @init
    top, bot = 0, ROWS - 1                       @rowInit
    while top <= bot:                            @rowWhile
        row = (top + bot) // 2                   @rowMid
        if target > matrix[row][-1]:             @below
            top = row + 1                        @down
        elif target < matrix[row][0]:            @above
            bot = row - 1                        @up
        else:
            break                                @rowFound
    if not (top <= bot):                         @noRow
        return False                             @noRowRet
    row = (top + bot) // 2                       @row
    l, r = 0, COLS - 1                           @colInit
    while l <= r:                                @colWhile
        m = (l + r) // 2                         @colMid
        if target > matrix[row][m]:              @gt
            l = m + 1                            @right
        elif target < matrix[row][m]:            @lt
            r = m - 1                            @left
        else:
            return True                          @found
    return False                                 @miss
`,
  explain: {
    below: 'Target is bigger than this row\'s largest value — it can only be in a lower row.',
    above: 'Target is smaller than this row\'s smallest value — it can only be in a higher row.',
    rowFound: 'row[0] ≤ target ≤ row[-1]: this is the only row that can contain it.',
    noRow: 'The row search ran out: target falls outside every row\'s range (or between rows).',
    colWhile: 'Ordinary binary search inside the chosen row.',
  },
  distractors: [
    { text: '        if target > matrix[row][0]:', why: 'Comparing with the row\'s FIRST value cannot tell you the target is past this row; use the last value.' },
    { text: '    for row in matrix:', why: 'Scanning rows is O(m); the rows are sorted by range, so binary-search them.' },
    { text: '    l, r = 0, ROWS - 1', why: 'Inside a row the column range is 0..COLS−1, not the row count.' },
  ],
  input: { matrix: [[1, 3, 5, 7], [10, 11, 16, 20], [23, 30, 34, 60]], target: 16 },
  presets: [
    { label: 'absent (between rows)', input: { matrix: [[1, 3, 5, 7], [10, 11, 16, 20], [23, 30, 34, 60]], target: 21 } },
    { label: 'absent inside row', input: { matrix: [[1, 3, 5, 7], [10, 11, 16, 20], [23, 30, 34, 60], [61, 70, 80, 99]], target: 13 } },
    { label: 'single row', input: { matrix: [[2, 4, 6, 8, 10]], target: 2 } },
  ],
  validate: ({ matrix, target }) => {
    if (!Array.isArray(matrix) || !matrix.length || !matrix.every(isNums) || typeof target !== 'number') return 'Expected { matrix: number[][], target: number }';
    const cols = matrix[0].length;
    if (!cols || matrix.some((row) => row.length !== cols)) return 'All rows need the same, non-zero length';
    if (matrix.length > 5 || cols > 6) return 'Keep the matrix ≤ 5×6';
    if (!isSorted(matrix.flat())) return 'Rows must be sorted and each row must start after the previous row ends';
    return null;
  },
  trace(t, { matrix, target }) {
    const ROWS = matrix.length;
    const COLS = matrix[0].length;
    let top = 0;
    let bot = ROWS - 1;
    let row = -1;
    let l = -1;
    let r = -1;
    let m = -1;
    let found = false;
    let predicts = 0;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (let i = 0; i < ROWS; i++)
        for (let j = 0; j < COLS; j++) {
          if (l < 0) {
            if (i < top || i > bot) tn[rc(i, j)] = 'muted';
            else if (i === row) tn[rc(i, j)] = j === 0 || j === COLS - 1 ? 'active' : 'info';
          } else if (i !== row || j < l || j > r) tn[rc(i, j)] = 'muted';
        }
      if (l >= 0 && m >= 0) tn[rc(row, m)] = found ? 'good' : 'active';
      return [
        V.grid('matrix', matrix, {
          tones: tn,
          pointers: l < 0 ? { top: [top, -1], bot: [bot, -1], row: row >= 0 ? [row, -1] : null } : { l: [row, l], m: m >= 0 ? [row, m] : null, r: [row, r] },
          rowLabels: matrix.map((_, i) => i),
          colLabels: matrix[0].map((_, j) => j),
          caption: l < 0 ? 'phase 1: pick the row (compare with first/last value)' : `phase 2: binary search inside row ${row}`,
        }),
      ];
    });
    t.step('init', `${ROWS} rows × ${COLS} cols. Target ${target}.`, { ROWS, COLS, target });
    t.step('rowInit', 'Phase 1: binary search over ROWS, using each row\'s first and last value.', { top, bot });
    let rowFound = false;
    while (top <= bot) {
      row = -1;
      t.step('rowWhile', `Rows ${top}…${bot} are still possible.`, { top, bot });
      row = Math.floor((top + bot) / 2);
      t.step('rowMid', `Middle row ${row}: range [${matrix[row][0]}, ${matrix[row][COLS - 1]}].`, { row, first: matrix[row][0], last: matrix[row][COLS - 1] });
      if (predicts < 1) {
        predicts++;
        const ans = target > matrix[row][COLS - 1] ? 0 : target < matrix[row][0] ? 1 : 2;
        t.predict(`Target ${target} vs row ${row} range [${matrix[row][0]}, ${matrix[row][COLS - 1]}]. Where is it?`, ['in a lower row', 'in a higher row', 'in this row (if anywhere)'], ans, ans === 0 ? `${target} > ${matrix[row][COLS - 1]}, the largest value here.` : ans === 1 ? `${target} < ${matrix[row][0]}, the smallest value here.` : `${matrix[row][0]} ≤ ${target} ≤ ${matrix[row][COLS - 1]}.`);
      }
      if (target > matrix[row][COLS - 1]) {
        t.step('below', `${target} > ${matrix[row][COLS - 1]} (row's last) → look lower.`, { row });
        top = row + 1;
        t.step('down', `top = ${top}.`, { top, bot });
      } else if (target < matrix[row][0]) {
        t.step('below', `${target} ≤ ${matrix[row][COLS - 1]}, not below this row.`, { row });
        t.step('above', `${target} < ${matrix[row][0]} (row's first) → look higher.`, { row });
        bot = row - 1;
        t.step('up', `bot = ${bot}.`, { top, bot });
      } else {
        t.step('below', `${target} ≤ ${matrix[row][COLS - 1]}.`, { row });
        t.step('above', `${target} ≥ ${matrix[row][0]}.`, { row });
        t.step('rowFound', `Row ${row} is the only row whose range contains ${target}.`, { row });
        rowFound = true;
        break;
      }
    }
    if (!rowFound) {
      row = -1;
      t.step('noRow', `top = ${top} > bot = ${bot}: no row's range contains ${target}.`, { top, bot });
      t.step('noRowRet', 'Return False without searching columns.', { result: false });
      return false;
    }
    t.step('noRow', `top ≤ bot, so a candidate row exists.`, { top, bot });
    row = Math.floor((top + bot) / 2);
    t.step('row', `row = ${row}.`, { row });
    l = 0;
    r = COLS - 1;
    t.step('colInit', `Phase 2: ordinary binary search on row ${row}, columns ${l}…${r}.`, { l, r });
    while (l <= r) {
      m = -1;
      t.step('colWhile', `Columns ${l}…${r} remain.`, { l, r });
      m = Math.floor((l + r) / 2);
      t.step('colMid', `m = ${m}; matrix[${row}][${m}] = ${matrix[row][m]}.`, { m, value: matrix[row][m] });
      const v = matrix[row][m];
      if (predicts < 3 && v !== target) {
        predicts++;
        t.predict(`${v} vs target ${target}: which side survives?`, ['left (r = m − 1)', 'right (l = m + 1)'], v > target ? 0 : 1, v > target ? `${v} is too big.` : `${v} is too small.`);
      }
      if (target > v) {
        t.step('gt', `${target} > ${v} → go right.`, { m });
        l = m + 1;
        t.step('right', `l = ${l}.`, { l, r });
      } else if (target < v) {
        t.step('gt', `${target} is not > ${v}.`, { m });
        t.step('lt', `${target} < ${v} → go left.`, { m });
        r = m - 1;
        t.step('left', `r = ${r}.`, { l, r });
      } else {
        found = true;
        t.step('gt', `${target} is not > ${v}.`, { m });
        t.step('lt', `${target} is not < ${v}.`, { m });
        t.step('found', `matrix[${row}][${m}] = ${target} → True.`, { result: true });
        return true;
      }
    }
    m = -1;
    t.step('miss', `The column window emptied: ${target} is not in row ${row} → False.`, { result: false });
    return false;
  },
};

// ---------------------------------------------------------------------------

const koko: Problem<{ piles: number[]; h: number }> = {
  id: 'koko-eating-bananas',
  num: 875,
  title: 'Koko Eating Bananas',
  difficulty: 'Medium',
  category: 'binary-search',
  pattern: 'binary-search',
  statement:
    'Koko eats from one banana pile per hour at a fixed speed k (any leftover hour is wasted if the pile has fewer than k). Find the smallest integer k that lets her finish every pile within h hours.',
  signals: ['"minimum speed / capacity such that…"', 'a yes/no check that is monotone in k', 'answer is an integer in a known range [1, max]', 'no sorted array — search the ANSWER'],
  insight:
    'If speed k works, every faster speed works too — feasibility is monotone. So binary-search over the candidate speeds 1…max(piles), checking each guess with an O(n) hours count.',
  hints: [
    'What is the slowest speed that could possibly work? The fastest you ever need?',
    'If k = 5 is fast enough, is k = 6 fast enough? Use that.',
    'Binary search k in [1, max(piles)]: hours = Σ ceil(p / k); if hours ≤ h record k and try slower, else go faster.',
  ],
  pitfall: 'Using p // k instead of ceil(p / k): a partial pile still costs a full hour. Also searching r = sum(piles) — max(piles) is already enough.',
  backend: {
    title: 'Sizing worker throughput to meet a batch SLA',
    detail:
      'A nightly ETL must drain N partition backlogs within an h-hour window; each worker drains at most k records/hour from one partition at a time. Finding the minimum k (and thus the cheapest instance size) is a binary search over capacity with a "can we finish in time?" check — the same shape as picking the smallest Kafka consumer rate or minimum shipping capacity.',
  },
  complexity: { time: 'O(n log max(p))', space: 'O(1)' },
  code: `
def minEatingSpeed(piles, h):
    l, r = 1, max(piles)                         @init
    res = r                                      @res
    while l <= r:                                @while
        k = (l + r) // 2                         @mid
        hours = 0                                @hours0
        for p in piles:                          @each
            hours += math.ceil(p / k)            @hours
        if hours <= h:                           @fits
            res = min(res, k)                    @record
            r = k - 1                            @left
        else:
            l = k + 1                            @right
    return res                                   @done
`,
  explain: {
    init: 'Speed 1 is the slowest possible; max(piles) always finishes in len(piles) ≤ h hours.',
    res: 'max(piles) is a guaranteed-feasible answer to start from.',
    hours: 'A pile of p bananas takes ceil(p / k) hours — the last partial hour still counts.',
    fits: 'Monotone check: feasible here ⇒ feasible for every faster speed.',
    left: 'k works; look for something even slower.',
    right: 'k is too slow, and so is every slower speed.',
  },
  distractors: [
    { text: '            hours += p // k', why: 'Floor division under-counts: a pile of 7 at speed 3 takes 3 hours, not 2.' },
    { text: '    l, r = 0, max(piles)', why: 'k = 0 is meaningless and causes division by zero; the slowest speed is 1.' },
    { text: '            l = k + 1', why: 'When k fits you must try SLOWER speeds (r = k − 1); moving l right throws away better answers.' },
  ],
  input: { piles: [3, 6, 7, 11], h: 8 },
  presets: [
    { label: 'tight deadline (h = len)', input: { piles: [30, 11, 23, 4, 20], h: 5 } },
    { label: 'loose deadline', input: { piles: [30, 11, 23, 4, 20], h: 6 } },
  ],
  validate: ({ piles, h }) => {
    if (!isNums(piles) || typeof h !== 'number') return 'Expected { piles: number[], h: number }';
    if (!piles.length || piles.length > 8) return 'Use 1–8 piles';
    if (piles.some((p) => p < 1 || !Number.isInteger(p))) return 'Piles must be positive integers';
    if (Math.max(...piles) > 30) return 'Keep piles ≤ 30 so every candidate speed fits on screen';
    if (h < piles.length) return 'h must be ≥ number of piles (otherwise no speed works)';
    return null;
  },
  trace(t, { piles, h }) {
    const maxP = Math.max(...piles);
    const speeds = Array.from({ length: maxP }, (_, i) => i + 1);
    let l = 1;
    let r = maxP;
    let k = -1;
    let res = r;
    let pi = -1;
    let perPile: (number | string)[] = piles.map(() => '·');
    let predicts = 0;
    t.draw(() => {
      const tn = windowTones(maxP, l - 1, r - 1, k - 1, { [res - 1]: 'good' });
      return [
        V.array('candidate speeds k', speeds, { pointers: { l: l - 1, m: k > 0 ? k - 1 : null, r: r - 1 }, tones: tn, showIndex: false, caption: 'muted = eliminated, green = best feasible so far' }),
        V.array('piles', piles, { pointers: { p: pi }, tones: pi >= 0 ? { [pi]: 'active' as Tone } : {} }),
        V.array(k > 0 ? `hours per pile at k = ${k}` : 'hours per pile', perPile, { tones: pi >= 0 ? { [pi]: 'active' as Tone } : {} }),
      ];
    });
    t.step('init', `Speeds 1…${maxP} are the candidates: ${maxP} (the biggest pile) always finishes in ${piles.length} ≤ ${h} hours.`, { l, r, h });
    t.step('res', `res = ${res}, a known-feasible answer.`, { res });
    while (l <= r) {
      k = -1;
      perPile = piles.map(() => '·');
      t.step('while', `Speeds ${l}…${r} are still undecided.`, { l, r });
      k = Math.floor((l + r) / 2);
      t.step('mid', `Try the middle speed k = ${k}.`, { l, r, k });
      let hours = 0;
      t.step('hours0', `Count the hours needed at ${k} bananas/hour.`, { k, hours });
      for (pi = 0; pi < piles.length; pi++) {
        const need = Math.ceil(piles[pi] / k);
        hours += need;
        perPile[pi] = need;
        t.step('hours', `Pile ${piles[pi]}: ceil(${piles[pi]} / ${k}) = ${need} hour(s). Total ${hours}.`, { p: piles[pi], k, hours });
      }
      pi = -1;
      if (predicts < 3) {
        predicts++;
        t.predict(`At k = ${k} she needs ${hours} hours (limit ${h}). Which speeds get eliminated?`, [`slower ones ${l}…${k} (go faster)`, `faster ones ${k + 1}…${r} (record ${k}, try slower)`], hours <= h ? 1 : 0, hours <= h ? `${hours} ≤ ${h}: ${k} works, so every faster speed also works — they cannot beat ${k}.` : `${hours} > ${h}: ${k} is too slow, and anything slower is even worse.`);
      }
      if (hours <= h) {
        t.step('fits', `${hours} ≤ ${h}: speed ${k} is fast enough.`, { hours, h });
        res = Math.min(res, k);
        t.step('record', `res = ${res}.`, { res });
        r = k - 1;
        t.step('left', `Every speed above ${k} is feasible but worse — discard them; r = ${r}.`, { l, r });
      } else {
        t.step('fits', `${hours} > ${h}: speed ${k} is too slow.`, { hours, h });
        l = k + 1;
        t.step('right', `Speeds ≤ ${k} are all too slow — discard them; l = ${l}.`, { l, r });
      }
    }
    k = -1;
    t.step('while', `l = ${l} > r = ${r}: no candidates left.`, { l, r });
    t.step('done', `The smallest speed that finishes in ${h} hours is ${res}.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const findMinRotated: Problem<{ nums: number[] }> = {
  id: 'find-minimum-in-rotated-sorted-array',
  num: 153,
  title: 'Find Minimum in Rotated Sorted Array',
  difficulty: 'Medium',
  category: 'binary-search',
  pattern: 'binary-search',
  statement:
    'A sorted array of distinct numbers was rotated at an unknown pivot (e.g. [3,4,5,1,2]). Return its minimum in O(log n).',
  signals: ['"rotated sorted array"', 'O(log n) required', 'distinct values', 'find the pivot / smallest'],
  insight:
    'Any window is either already sorted (then its left end is the min) or contains the drop. Compare nums[m] with nums[l]: if the left part is sorted, the drop — and the min — must be to the right of m; otherwise it is at or left of m.',
  hints: [
    'A rotated sorted array is two sorted runs. Where is the minimum relative to them?',
    'If nums[l] < nums[r] the window is not rotated at all.',
    'Track res = min seen at m; if nums[m] ≥ nums[l] the left run is sorted → search right, else search left.',
  ],
  pitfall: 'Comparing with nums[l] using > instead of >=: when m == l (two elements left) the left "half" is just nums[m] itself and you must move right.',
  backend: {
    title: 'Finding the wrap point in a circular log / ring buffer',
    detail:
      'A ring-buffer write-ahead log (or a sharded ID range after a hash-ring rotation) stores monotonically increasing sequence numbers that wrap around. On recovery, finding the oldest entry is finding the minimum of a rotated sorted array — binary search avoids reading every block of the log.',
  },
  complexity: { time: 'O(log n)', space: 'O(1)' },
  code: `
def findMin(nums):
    l, r = 0, len(nums) - 1                 @init
    res = nums[0]                           @res
    while l <= r:                           @while
        if nums[l] < nums[r]:               @sorted
            res = min(res, nums[l])         @takeL
            break                           @break
        m = (l + r) // 2                    @mid
        res = min(res, nums[m])             @takeM
        if nums[m] >= nums[l]:              @leftSorted
            l = m + 1                       @goRight
        else:
            r = m - 1                       @goLeft
    return res                              @done
`,
  explain: {
    sorted: 'This window has no drop in it, so its smallest value is its left end.',
    takeM: 'm might be the minimum itself — record it before discarding m.',
    leftSorted: 'nums[l..m] is an increasing run, so the drop (minimum) is right of m.',
    goLeft: 'm sits in the right run; the minimum is at or left of m (m already recorded).',
  },
  distractors: [
    { text: '        if nums[m] > nums[l]:', why: 'When m == l (window of 2) this sends you left and misses the minimum at r — use >=.' },
    { text: '    return nums[l]', why: 'After the loop l can point past the minimum; the answer is the tracked res.' },
    { text: '        if nums[m] >= nums[r]:', why: 'Mixing the r-comparison with the l-based moves flips the decision; be consistent with one reference end.' },
  ],
  input: { nums: [4, 5, 6, 7, 0, 1, 2] },
  presets: [
    { label: 'not rotated', input: { nums: [11, 13, 15, 17] } },
    { label: 'min at end', input: { nums: [2, 3, 4, 5, 1] } },
    { label: 'two elements', input: { nums: [2, 1] } },
  ],
  validate: ({ nums }) => {
    if (!isNums(nums) || !nums.length) return 'Expected { nums: non-empty number[] }';
    if (nums.length > 16) return 'Keep nums ≤ 16';
    if (new Set(nums).size !== nums.length) return 'Values must be distinct';
    const k = nums.findIndex((x, i) => i > 0 && x < nums[i - 1]);
    if (k >= 0 && !(isSorted([...nums.slice(k), ...nums.slice(0, k)]))) return 'nums must be a rotation of a sorted array';
    return null;
  },
  trace(t, { nums }) {
    let l = 0;
    let r = nums.length - 1;
    let m = -1;
    let res = nums[0];
    let resIdx = 0;
    let predicts = 0;
    let sortedAsks = 0;
    t.draw(() => [
      V.array('nums', nums, { pointers: { l, m, r }, window: [l, r], tones: windowTones(nums.length, l, r, m, { [resIdx]: 'good' }) }),
    ]);
    t.step('init', 'Search window = whole array.', { l, r });
    t.step('res', `res starts as nums[0] = ${res}.`, { res });
    while (l <= r) {
      m = -1;
      t.step('while', `Window [${l}, ${r}].`, { l, r });
      if (sortedAsks < 2 && predicts + sortedAsks < 4 && l < r) {
        sortedAsks++;
        t.predict(`nums[l] = ${nums[l]}, nums[r] = ${nums[r]}. Is the window [${l}..${r}] free of rotation (already sorted)?`, ['Yes — nums[l] is the min', 'No — the drop is inside'], nums[l] < nums[r] ? 0 : 1, nums[l] < nums[r] ? `${nums[l]} < ${nums[r]}: with distinct values a rotated window would have its left end larger than its right end.` : `${nums[l]} > ${nums[r]}: the values wrapped around somewhere between l and r.`);
      }
      if (nums[l] < nums[r]) {
        t.step('sorted', `nums[l] = ${nums[l]} < nums[r] = ${nums[r]}: this window is not rotated, so its min is nums[l].`, { l, r });
        if (nums[l] < res) {
          res = nums[l];
          resIdx = l;
        }
        t.step('takeL', `res = min(res, ${nums[l]}) = ${res}.`, { res });
        t.step('break', 'Nothing smaller can hide in a sorted window — stop.', { res });
        break;
      }
      t.step('sorted', `nums[l] = ${nums[l]} ≥ nums[r] = ${nums[r]}: the drop is somewhere inside.`, { l, r });
      m = Math.floor((l + r) / 2);
      t.step('mid', `m = ${m}, nums[m] = ${nums[m]}.`, { m, 'nums[m]': nums[m] });
      if (nums[m] < res) {
        res = nums[m];
        resIdx = m;
      }
      t.step('takeM', `res = ${res}.`, { res });
      if (predicts < 3) {
        predicts++;
        t.predict(`nums[l] = ${nums[l]}, nums[m] = ${nums[m]}. Where is the minimum?`, ['right of m', 'left of m'], nums[m] >= nums[l] ? 0 : 1, nums[m] >= nums[l] ? `${nums[l]} ≤ ${nums[m]}: l..m is one increasing run, so the drop comes after m.` : `${nums[m]} < ${nums[l]}: the drop already happened between l and m.`);
      }
      if (nums[m] >= nums[l]) {
        t.step('leftSorted', `${nums[m]} ≥ ${nums[l]}: l..m is sorted — no drop there.`, { m });
        l = m + 1;
        t.step('goRight', `l = ${l}.`, { l, r });
      } else {
        t.step('leftSorted', `${nums[m]} < ${nums[l]}: m is already past the drop.`, { m });
        r = m - 1;
        t.step('goLeft', `r = ${r} (m itself is already recorded in res).`, { l, r });
      }
    }
    m = -1;
    t.step('done', `Minimum = ${res}.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const searchRotated: Problem<{ nums: number[]; target: number }> = {
  id: 'search-in-rotated-sorted-array',
  num: 33,
  title: 'Search in Rotated Sorted Array',
  difficulty: 'Medium',
  category: 'binary-search',
  pattern: 'binary-search',
  statement: 'A sorted array of distinct values was rotated at an unknown pivot. Return the index of a target, or −1, in O(log n).',
  signals: ['"rotated sorted array"', 'find target index', 'O(log n)', 'distinct values'],
  insight:
    'Cutting at m always leaves at least one half fully sorted. Find which one, then check whether the target lies within that sorted half\'s range: if so search it, otherwise search the other half.',
  hints: [
    'After picking m, one of [l..m] or [m..r] has no rotation in it. How can you tell which?',
    'For the sorted half you can test "is target inside?" with two comparisons.',
    'If nums[l] ≤ nums[m]: left is sorted — target in [nums[l], nums[m]) ? go left : go right. Else mirror for the right half.',
  ],
  pitfall: 'Using nums[l] < nums[m] (strict): when l == m the left half is a single sorted element, and the strict check picks the wrong branch.',
  backend: {
    title: 'Looking up a key on a consistent-hash ring snapshot',
    detail:
      'A shard router stores ring tokens sorted but starting from an arbitrary node (rotated after rebalancing). Finding the entry for a given token is a search in a rotated sorted array — one binary search instead of re-sorting the ring on every topology change.',
  },
  complexity: { time: 'O(log n)', space: 'O(1)' },
  code: `
def search(nums, target):
    l, r = 0, len(nums) - 1                             @init
    while l <= r:                                       @while
        m = (l + r) // 2                                @mid
        if nums[m] == target:                           @hit
            return m                                    @found
        if nums[l] <= nums[m]:                          @leftSorted
            if target > nums[m] or target < nums[l]:    @leftOut
                l = m + 1                               @goRightA
            else:
                r = m - 1                               @goLeftA
        else:
            if target < nums[m] or target > nums[r]:    @rightOut
                r = m - 1                               @goLeftB
            else:
                l = m + 1                               @goRightB
    return -1                                           @miss
`,
  explain: {
    leftSorted: 'nums[l..m] has no drop, so its values span exactly [nums[l], nums[m]].',
    leftOut: 'Target outside the sorted left range ⇒ it can only be on the right.',
    rightOut: 'Here nums[m..r] is the sorted half; outside its range ⇒ search left.',
  },
  distractors: [
    { text: '        if nums[l] < nums[m]:', why: 'With l == m the left half is one sorted element; < treats it as unsorted and goes the wrong way.' },
    { text: '            if target > nums[m] and target < nums[l]:', why: 'Both can\'t hold at once in a sorted half — the "outside the range" test needs or.' },
    { text: '        if nums[m] > target:', why: 'Plain binary-search logic ignores the rotation; a big nums[m] does not mean the target is to its left.' },
  ],
  input: { nums: [4, 5, 6, 7, 0, 1, 2], target: 0 },
  presets: [
    { label: 'absent', input: { nums: [4, 5, 6, 7, 0, 1, 2], target: 3 } },
    { label: 'target in left run', input: { nums: [6, 7, 8, 9, 1, 2, 3, 4], target: 8 } },
    { label: 'single element', input: { nums: [1], target: 0 } },
  ],
  validate: ({ nums, target }) => {
    if (!isNums(nums) || !nums.length || typeof target !== 'number') return 'Expected { nums: non-empty number[], target: number }';
    if (nums.length > 16) return 'Keep nums ≤ 16';
    if (new Set(nums).size !== nums.length) return 'Values must be distinct';
    const k = nums.findIndex((x, i) => i > 0 && x < nums[i - 1]);
    if (k >= 0 && !isSorted([...nums.slice(k), ...nums.slice(0, k)])) return 'nums must be a rotation of a sorted array';
    return null;
  },
  trace(t, { nums, target }) {
    let l = 0;
    let r = nums.length - 1;
    let m = -1;
    let sortedSide: 'L' | 'R' | null = null;
    let hit = -1;
    let predicts = 0;
    t.draw(() => {
      const extra: Record<number, Tone> = {};
      if (m >= 0 && sortedSide) {
        const [a, b] = sortedSide === 'L' ? [l, m] : [m, r];
        for (let k = a; k <= b; k++) extra[k] = 'info';
      }
      if (hit >= 0) extra[hit] = 'good';
      return [
        V.array('nums', nums, { pointers: { l, m, r }, window: [l, r], tones: windowTones(nums.length, l, r, hit >= 0 ? -1 : m, extra), caption: 'blue = the half known to be sorted' }),
      ];
    });
    t.step('init', `Window = whole array; target ${target}.`, { l, r, target });
    while (l <= r) {
      m = -1;
      sortedSide = null;
      t.step('while', `Window [${l}, ${r}].`, { l, r });
      m = Math.floor((l + r) / 2);
      t.step('mid', `m = ${m}, nums[m] = ${nums[m]}.`, { m, 'nums[m]': nums[m] });
      if (nums[m] === target) {
        hit = m;
        t.step('hit', `nums[m] == ${target}.`, { m });
        t.step('found', `Return ${m}.`, { result: m });
        return m;
      }
      t.step('hit', `${nums[m]} ≠ ${target}.`, { m });
      const leftSorted = nums[l] <= nums[m];
      if (predicts < 2) {
        predicts++;
        t.predict(`nums[l] = ${nums[l]}, nums[m] = ${nums[m]}, nums[r] = ${nums[r]}. Which half is guaranteed sorted?`, [`left [${l}..${m}]`, `right [${m}..${r}]`], leftSorted ? 0 : 1, leftSorted ? `${nums[l]} ≤ ${nums[m]}: no drop between l and m.` : `${nums[l]} > ${nums[m]}: the drop is in the left half, so the right half is clean.`);
      }
      sortedSide = leftSorted ? 'L' : 'R';
      if (leftSorted) {
        t.step('leftSorted', `${nums[l]} ≤ ${nums[m]}: left half is sorted, spanning [${nums[l]}, ${nums[m]}].`, { l, m });
        const out = target > nums[m] || target < nums[l];
        if (predicts < 3) {
          predicts++;
          t.predict(`Is ${target} inside [${nums[l]}, ${nums[m]}]?`, ['Yes — search left', 'No — search right'], out ? 1 : 0, out ? `${target} lies outside that range, so it can only be in the other half.` : `${nums[l]} ≤ ${target} < ${nums[m]}.`);
        }
        t.step('leftOut', out ? `${target} is outside [${nums[l]}, ${nums[m]}] → it must be on the right.` : `${target} is inside [${nums[l]}, ${nums[m]}) → search the left half.`, { target });
        if (out) {
          l = m + 1;
          t.step('goRightA', `l = ${l}.`, { l, r });
        } else {
          r = m - 1;
          t.step('goLeftA', `r = ${r}.`, { l, r });
        }
      } else {
        t.step('leftSorted', `${nums[l]} > ${nums[m]}: the drop is on the left, so the right half [${nums[m]}, ${nums[r]}] is sorted.`, { m, r });
        const out = target < nums[m] || target > nums[r];
        if (predicts < 3) {
          predicts++;
          t.predict(`Is ${target} inside [${nums[m]}, ${nums[r]}]?`, ['Yes — search right', 'No — search left'], out ? 1 : 0, out ? `${target} lies outside that range, so it can only be in the left half.` : `${nums[m]} < ${target} ≤ ${nums[r]}.`);
        }
        t.step('rightOut', out ? `${target} is outside [${nums[m]}, ${nums[r]}] → search left.` : `${target} is inside (${nums[m]}, ${nums[r]}] → search right.`, { target });
        if (out) {
          r = m - 1;
          t.step('goLeftB', `r = ${r}.`, { l, r });
        } else {
          l = m + 1;
          t.step('goRightB', `l = ${l}.`, { l, r });
        }
      }
    }
    m = -1;
    sortedSide = null;
    t.step('miss', `Window empty — ${target} is not present → −1.`, { result: -1 });
    return -1;
  },
};

// ---------------------------------------------------------------------------

type TmOp = (string | number)[];

const timeMap: Problem<{ ops: TmOp[] }> = {
  id: 'time-based-key-value-store',
  num: 981,
  title: 'Time Based Key-Value Store',
  difficulty: 'Medium',
  category: 'binary-search',
  pattern: 'binary-search',
  statement:
    'Build a key-value store where set(key, value, timestamp) records a version and get(key, timestamp) returns the value with the largest timestamp ≤ the query (or "" if none). Timestamps for set arrive in increasing order.',
  signals: ['"largest timestamp ≤ t" (floor search)', 'timestamps strictly increasing → each key\'s list is already sorted', 'many reads', 'versioned data'],
  insight:
    'Because sets come in increasing time order, each key\'s versions are appended already sorted. A get is a "rightmost element ≤ t" binary search: whenever values[m] is ≤ t, record it and keep looking right for a later one.',
  hints: [
    'Store a list of (value, timestamp) per key. Is it sorted?',
    'You need the LAST version whose timestamp is ≤ t, not an exact match.',
    'Binary search: if ts[m] ≤ t → res = value, l = m + 1; else r = m − 1.',
  ],
  pitfall: 'Returning only on an exact timestamp match — get must fall back to the most recent EARLIER version.',
  backend: {
    title: 'MVCC snapshot reads / config history',
    detail:
      'Postgres MVCC, etcd and feature-flag services keep every version of a key with its commit timestamp. A read "as of time t" (a snapshot read, or replaying config at incident time) finds the newest version ≤ t with exactly this floor binary search over the version list.',
  },
  complexity: { time: 'set O(1), get O(log n)', space: 'O(n)' },
  code: `
class TimeMap:
    def __init__(self):
        self.store = {}  # key -> [[value, timestamp], ...]       @init
    def set(self, key, value, timestamp):
        self.store.setdefault(key, []).append([value, timestamp])  @set
    def get(self, key, timestamp):
        res, values = "", self.store.get(key, [])                 @get
        l, r = 0, len(values) - 1                                 @gInit
        while l <= r:                                             @while
            m = (l + r) // 2                                      @mid
            if values[m][1] <= timestamp:                         @le
                res = values[m][0]                                @record
                l = m + 1                                         @right
            else:
                r = m - 1                                         @left
        return res                                                @ret
`,
  explain: {
    set: 'Timestamps only increase, so appending keeps each list sorted — no insertion sort needed.',
    get: 'Unknown key → empty list → the loop never runs and "" is returned.',
    le: 'This version existed at the query time: a candidate answer.',
    right: 'A later version might also be ≤ timestamp — keep searching right.',
    left: 'This version is from the future relative to the query.',
  },
  distractors: [
    { text: '            if values[m][1] == timestamp:', why: 'Exact match misses the "most recent earlier version" case — get(foo, 5) should return the version set at 4.' },
    { text: '                r = m - 1', why: 'After recording a valid version you must look RIGHT for a newer valid one, not left.' },
    { text: '        self.store[key] = [value, timestamp]', why: 'Overwrites history — older versions are needed for gets with earlier timestamps.' },
  ],
  input: {
    ops: [['set', 'foo', 'v1', 1], ['set', 'foo', 'v2', 4], ['set', 'foo', 'v3', 7], ['set', 'foo', 'v4', 10], ['get', 'foo', 5], ['get', 'foo', 10], ['get', 'foo', 0], ['get', 'bar', 3]],
  },
  presets: [
    { label: 'LeetCode-style', input: { ops: [['set', 'foo', 'bar', 1], ['get', 'foo', 1], ['get', 'foo', 3], ['set', 'foo', 'bar2', 4], ['get', 'foo', 4], ['get', 'foo', 5]] } },
    { label: 'two keys', input: { ops: [['set', 'a', 'x', 1], ['set', 'b', 'y', 2], ['set', 'a', 'z', 3], ['get', 'a', 2], ['get', 'b', 9]] } },
  ],
  validate: ({ ops }) => {
    if (!Array.isArray(ops)) return 'Expected { ops: [["set", key, value, ts], ["get", key, ts], ...] }';
    if (ops.length > 14) return 'Keep ≤ 14 operations';
    const last = new Map<string, number>();
    for (const op of ops) {
      if (!Array.isArray(op)) return 'Each op is an array';
      if (op[0] === 'set') {
        if (typeof op[1] !== 'string' || typeof op[2] !== 'string' || typeof op[3] !== 'number') return 'set looks like ["set", "key", "value", 3]';
        if ((last.get(op[1]) ?? -Infinity) >= op[3]) return 'set timestamps must increase per key';
        last.set(op[1], op[3]);
      } else if (op[0] === 'get') {
        if (typeof op[1] !== 'string' || typeof op[2] !== 'number') return 'get looks like ["get", "key", 3]';
      } else return `Unknown op ${String(op[0])}`;
    }
    return null;
  },
  trace(t, { ops }) {
    const store = new Map<string, [string, number][]>();
    const out: string[] = [];
    let cur = -1;
    let key: string | null = null;
    let l = -1;
    let r = -1;
    let m = -1;
    let best = -1;
    let predicts = 0;
    t.draw(() => {
      const vals = key !== null ? store.get(key) ?? [] : [];
      const tn = key !== null && l >= 0 ? windowTones(vals.length, l, r, m, best >= 0 ? { [best]: 'good' } : {}) : {};
      return [
        V.chips('operations', ops.map((o) => `${o[0]}(${o.slice(1).join(', ')})`), { tones: cur >= 0 ? { [cur]: 'active' as Tone } : {} }),
        V.map('store (key → versions)', [...store.entries()].map(([k, v]) => [k, v.map(([val, ts]) => `${val}@${ts}`).join('  ')] as [string, string]), { hl: key !== null ? [key] : [] }),
        key !== null && V.array(`versions of '${key}' (value@timestamp)`, vals.map(([val, ts]) => `${val}@${ts}`), { pointers: l >= 0 ? { l, m, r } : {}, window: l >= 0 ? [l, r] : null, tones: tn }),
        V.chips('get results', out.map((x) => (x === '' ? '""' : x))),
      ];
    });
    t.step('init', 'Empty store: each key will map to its list of versions.');
    for (cur = 0; cur < ops.length; cur++) {
      const op = ops[cur];
      l = r = m = best = -1;
      if (op[0] === 'set') {
        const k = op[1] as string;
        key = k;
        if (!store.has(k)) store.set(k, []);
        store.get(k)!.push([op[2] as string, op[3] as number]);
        t.step('set', `set(${k}, ${op[2]}, ${op[3]}): append — timestamps only grow, so the list stays sorted.`, { key: k, value: op[2], timestamp: op[3] });
        continue;
      }
      const k = op[1] as string;
      const ts = op[2] as number;
      key = k;
      const values = store.get(k) ?? [];
      let res = '';
      t.step('get', `get(${k}, ${ts}): ${values.length ? `search ${values.length} version(s) for the newest with timestamp ≤ ${ts}.` : 'no versions for this key.'}`, { key: k, timestamp: ts, res });
      l = 0;
      r = values.length - 1;
      t.step('gInit', `l = ${l}, r = ${r}.`, { l, r });
      while (l <= r) {
        m = -1;
        t.step('while', `Versions ${l}…${r} remain.`, { l, r });
        m = Math.floor((l + r) / 2);
        const [val, vts] = values[m];
        t.step('mid', `m = ${m}: ${val}@${vts}.`, { m, value: val, ts: vts });
        if (predicts < 3) {
          predicts++;
          t.predict(`${val} was written at ${vts}; the query time is ${ts}. What happens?`, ['record it and search right for a newer one', 'discard it and search left'], vts <= ts ? 0 : 1, vts <= ts ? `${vts} ≤ ${ts}: this version existed at query time, but a newer one might too.` : `${vts} > ${ts}: this version did not exist yet at time ${ts}.`);
        }
        if (vts <= ts) {
          t.step('le', `${vts} ≤ ${ts}: valid at the query time.`, { m });
          res = val;
          best = m;
          t.step('record', `res = '${val}' (best so far).`, { res });
          l = m + 1;
          t.step('right', `Look for a later valid version: l = ${l}.`, { l, r });
        } else {
          t.step('le', `${vts} > ${ts}: written after the query time.`, { m });
          r = m - 1;
          t.step('left', `r = ${r}.`, { l, r });
        }
      }
      m = -1;
      out.push(res);
      t.step('ret', res ? `Return '${res}', the newest version as of ${ts}.` : `No version existed at time ${ts} → "".`, { result: res });
    }
    cur = -1;
    key = null;
    t.step(null, `All operations done. get results: [${out.map((x) => `"${x}"`).join(', ')}].`, { results: out });
    return out;
  },
};

// ---------------------------------------------------------------------------

const medianTwoSorted: Problem<{ nums1: number[]; nums2: number[] }> = {
  id: 'median-of-two-sorted-arrays',
  num: 4,
  title: 'Median of Two Sorted Arrays',
  difficulty: 'Hard',
  category: 'binary-search',
  pattern: 'binary-search',
  statement: 'Given two individually sorted arrays, return the median of all their values combined, in O(log(min(m, n))) time.',
  signals: ['two sorted arrays', '"median" / k-th smallest of a union', 'logarithmic time required — so no merging', 'partition into left half / right half'],
  insight:
    'The median splits the combined values into a left half and right half. Choose how many elements the left half takes from the shorter array A (i+1); B must supply the rest (j+1 = half − (i+1)). The split is right when Aleft ≤ Bright and Bleft ≤ Aright — binary-search i until it is.',
  hints: [
    'Merging is O(m + n). The median only needs the right "cut" through both arrays.',
    'If the left half takes x items from A, how many must it take from B?',
    'Binary search x on the SHORTER array; compare the four border values: Aleft > Bright → take fewer from A; Bleft > Aright → take more.',
  ],
  pitfall: 'Forgetting the ±∞ sentinels when the cut is at an array\'s edge (taking 0 or all elements), or searching the longer array so j goes negative.',
  backend: {
    title: 'Global p50 latency across two pre-sorted shards',
    detail:
      'A metrics service stores sorted latency samples per shard (or per region). Computing the overall median — or any percentile — across shards without merging millions of samples uses this partition search: guess a cut in one shard, derive the cut in the other, and adjust by comparing border values, like distributed quantile queries in ClickHouse or Druid.',
  },
  complexity: { time: 'O(log min(m, n))', space: 'O(1)' },
  code: `
def findMedianSortedArrays(nums1, nums2):
    A, B = nums1, nums2                                       @init
    total = len(A) + len(B)                                   @total
    half = total // 2                                         @half
    if len(B) < len(A):                                       @swap
        A, B = B, A                                           @doSwap
    l, r = 0, len(A) - 1                                      @lr
    while True:                                               @loop
        i = (l + r) // 2          # A[0..i] go left           @i
        j = half - i - 2          # B[0..j] go left           @j
        Aleft = A[i] if i >= 0 else float("-inf")             @aL
        Aright = A[i + 1] if (i + 1) < len(A) else float("inf")  @aR
        Bleft = B[j] if j >= 0 else float("-inf")             @bL
        Bright = B[j + 1] if (j + 1) < len(B) else float("inf")  @bR
        if Aleft <= Bright and Bleft <= Aright:               @ok
            if total % 2:                                     @odd
                return min(Aright, Bright)                    @oddRet
            return (max(Aleft, Bleft) + min(Aright, Bright)) / 2  @evenRet
        elif Aleft > Bright:                                  @tooMany
            r = i - 1                                         @fewer
        else:
            l = i + 1                                         @more
`,
  explain: {
    half: 'Size of the left half (for odd totals the median is the first element of the right half).',
    swap: 'Binary-search the shorter array so j = half − i − 2 never goes out of range.',
    i: 'A contributes i + 1 elements to the left half (i = −1 means none).',
    j: 'B contributes the rest: (j + 1) = half − (i + 1).',
    aL: '±∞ sentinels make an empty side always satisfy the comparisons.',
    ok: 'Every left value ≤ every right value: the cut is the median cut.',
    oddRet: 'With total odd, the left half has total // 2 items, so the median is the smallest right value.',
    tooMany: 'A\'s last left value is bigger than B\'s first right value → A gave too many.',
    more: 'Otherwise B\'s left side is too big → take more from A.',
  },
  distractors: [
    { text: '        j = half - i', why: 'Off by two: i and j are LAST INDICES on the left (counts i+1 and j+1), so j = half − i − 2.' },
    { text: '            r = i + 1', why: 'If A gave too many, the cut in A must move LEFT: r = i − 1.' },
    { text: '    merged = sorted(nums1 + nums2)', why: 'Correct but O((m+n) log(m+n)); the problem asks for logarithmic time.' },
  ],
  input: { nums1: [1, 3, 8, 9, 15], nums2: [7, 11, 18, 19, 21, 25] },
  presets: [
    { label: 'even total', input: { nums1: [1, 2], nums2: [3, 4] } },
    { label: 'one empty', input: { nums1: [], nums2: [2, 5, 9] } },
    { label: 'all of A on the right', input: { nums1: [10, 20, 30], nums2: [1, 2, 3, 4, 5] } },
  ],
  validate: ({ nums1, nums2 }) => {
    if (!isNums(nums1) || !isNums(nums2)) return 'Expected { nums1: number[], nums2: number[] }';
    if (!nums1.length && !nums2.length) return 'At least one array must be non-empty';
    if (nums1.length > 12 || nums2.length > 12) return 'Keep each array ≤ 12';
    if (!isSorted(nums1) || !isSorted(nums2)) return 'Both arrays must be sorted';
    return null;
  },
  trace(t, { nums1, nums2 }) {
    let A = nums1;
    let B = nums2;
    let nameA = 'nums1';
    let nameB = 'nums2';
    let i: number | null = null;
    let j: number | null = null;
    let l = -1;
    let r = -1;
    let verdict: Tone | null = null;
    let predicts = 0;
    const tonesFor = (arr: number[], cut: number | null, isA: boolean): Record<number, Tone> => {
      const tn: Record<number, Tone> = {};
      if (cut === null) return tn;
      for (let k = 0; k < arr.length; k++) tn[k] = k <= cut ? 'info' : 'muted';
      if (cut >= 0) tn[cut] = verdict ?? 'active';
      if (cut + 1 < arr.length) tn[cut + 1] = verdict ?? 'warn';
      if (isA && l >= 0) for (let k = 0; k < arr.length; k++) if ((k < l || k > r) && k !== cut && k !== cut + 1) tn[k] = 'muted';
      return tn;
    };
    t.draw(() => [
      V.array(`A = ${nameA} (shorter)`, A, { pointers: i !== null ? { Aleft: i, Aright: i + 1, l: l >= 0 ? l : null, r: l >= 0 ? r : null } : {}, tones: tonesFor(A, i, true), caption: 'blue = goes to the left half' }),
      V.array(`B = ${nameB}`, B, { pointers: j !== null ? { Bleft: j, Bright: j + 1 } : {}, tones: tonesFor(B, j, false) }),
    ]);
    t.step('init', 'A and B are the two sorted arrays.', { 'len(A)': A.length, 'len(B)': B.length });
    const total = A.length + B.length;
    t.step('total', `total = ${total}.`, { total });
    const half = Math.floor(total / 2);
    t.step('half', `The left half must hold ${half} values.`, { half });
    if (B.length < A.length) {
      t.step('swap', `len(B) = ${B.length} < len(A) = ${A.length}: swap so we search the shorter one.`, {});
      [A, B] = [B, A];
      [nameA, nameB] = [nameB, nameA];
      t.step('doSwap', `Now A = ${nameA} (${A.length} values), B = ${nameB} (${B.length}).`, { 'len(A)': A.length, 'len(B)': B.length });
    } else t.step('swap', `A (${A.length}) is already the shorter array.`, {});
    l = 0;
    r = A.length - 1;
    t.step('lr', `Binary-search the last A-index on the left in [${l}, ${r}] (−1 would mean "take nothing from A").`, { l, r });
    for (let guard = 0; guard < 40; guard++) {
      verdict = null;
      t.step('loop', `Search range for i: [${l}, ${r}].`, { l, r });
      i = Math.floor((l + r) / 2);
      t.step('i', `i = ${i}: A gives ${i + 1} value(s) to the left half.`, { i });
      j = half - i - 2;
      t.step('j', `j = ${half} − ${i} − 2 = ${j}: B gives ${j + 1} value(s), so the left half has ${half}.`, { i, j });
      const Aleft = i >= 0 ? A[i] : -Infinity;
      const Aright = i + 1 < A.length ? A[i + 1] : Infinity;
      const Bleft = j >= 0 ? B[j] : -Infinity;
      const Bright = j + 1 < B.length ? B[j + 1] : Infinity;
      t.step('aL', `Aleft = ${i >= 0 ? Aleft : '-∞ (A gives nothing)'}.`, { Aleft });
      t.step('aR', `Aright = ${i + 1 < A.length ? Aright : '∞ (A gives everything)'}.`, { Aleft, Aright });
      t.step('bL', `Bleft = ${j >= 0 ? Bleft : '-∞'}.`, { Aleft, Aright, Bleft });
      t.step('bR', `Bright = ${j + 1 < B.length ? Bright : '∞'}.`, { Aleft, Aright, Bleft, Bright });
      const ok = Aleft <= Bright && Bleft <= Aright;
      if (predicts < 3) {
        predicts++;
        const ans = ok ? 0 : Aleft > Bright ? 1 : 2;
        t.predict(`Aleft=${Aleft === -Infinity ? '-∞' : Aleft}, Aright=${Aright === Infinity ? '∞' : Aright}, Bleft=${Bleft === -Infinity ? '-∞' : Bleft}, Bright=${Bright === Infinity ? '∞' : Bright}. What now?`, ['valid cut — compute the median', 'A gave too many → move i left', 'A gave too few → move i right'], ans, ans === 0 ? 'Both cross-checks hold: every left value ≤ every right value.' : ans === 1 ? `Aleft ${Aleft} > Bright ${Bright}: a value from A on the left is bigger than one on the right.` : `Bleft ${Bleft} > Aright ${Aright}: B's left side is too big, so A must contribute more.`);
      }
      if (ok) {
        verdict = 'good';
        t.step('ok', `Aleft ≤ Bright and Bleft ≤ Aright — the cut is the median cut.`, { Aleft, Aright, Bleft, Bright });
        if (total % 2) {
          const res = Math.min(Aright, Bright);
          t.step('odd', `total = ${total} is odd.`, { total });
          t.step('oddRet', `Median = min(Aright, Bright) = ${res}.`, { result: res });
          return res;
        }
        t.step('odd', `total = ${total} is even.`, { total });
        const res = (Math.max(Aleft, Bleft) + Math.min(Aright, Bright)) / 2;
        t.step('evenRet', `Median = (max(${Aleft === -Infinity ? '-∞' : Aleft}, ${Bleft === -Infinity ? '-∞' : Bleft}) + min(${Aright === Infinity ? '∞' : Aright}, ${Bright === Infinity ? '∞' : Bright})) / 2 = ${res}.`, { result: res });
        return res;
      } else if (Aleft > Bright) {
        verdict = 'bad';
        t.step('tooMany', `Aleft ${Aleft} > Bright ${Bright}: A put a too-large value on the left.`, { Aleft, Bright });
        r = i - 1;
        t.step('fewer', `r = ${r}: take fewer from A.`, { l, r });
      } else {
        verdict = 'bad';
        t.step('tooMany', `Bleft ${Bleft} > Aright ${Aright}: B's left side is too big.`, { Bleft, Aright });
        l = i + 1;
        t.step('more', `l = ${l}: take more from A.`, { l, r });
      }
    }
    throw new Error('Input arrays must be sorted');
  },
};

export const problems: Problem[] = [binarySearch, search2DMatrix, koko, findMinRotated, searchRotated, timeMap, medianTwoSorted];

export const variants: Variant[] = [
  {
    id: 'min-shipping-capacity',
    title: 'Minimum batch size to drain a queue on time',
    statement:
      'Jobs with given sizes must be processed in order, packed into one batch per minute; a batch may not exceed capacity C. Find the smallest C that finishes all jobs within D minutes.',
    pattern: 'binary-search',
    nearest: 'koko-eating-bananas',
    signals: ['"smallest capacity such that…"', 'feasibility is monotone in C', 'answer range [max(job), sum(jobs)]'],
    approach: 'Binary search C in [max, sum]; feasibility = greedily fill batches in order and count minutes ≤ D. Feasible → r = C − 1 (record), else l = C + 1.',
    backend: 'Choosing the smallest per-tick batch size for a rate-limited outbox/queue drain that must meet an SLA.',
  },
  {
    id: 'first-bad-deploy',
    title: 'First bad deploy',
    statement:
      'Deploys 1…n went out in order; from some deploy onward the health check fails. Given isBad(k), find the first failing deploy using as few checks as possible.',
    pattern: 'binary-search',
    nearest: 'binary-search',
    signals: ['good…good bad…bad (monotone predicate)', '"first" index where it flips', 'expensive check → minimize calls'],
    approach: 'Lower-bound search: l = 1, r = n; while l < r: m = (l + r) // 2; if isBad(m) r = m else l = m + 1. Return l.',
    backend: 'git bisect / automated regression bisection over a CI build history or canary releases.',
  },
  {
    id: 'logs-in-time-range',
    title: 'Count log lines in a time range',
    statement:
      'A log file\'s entries are sorted by timestamp. Answer many queries "how many entries fall in [t1, t2]?" efficiently.',
    pattern: 'binary-search',
    nearest: 'time-based-key-value-store',
    signals: ['sorted by time', 'range boundaries', 'many queries over static data'],
    approach: 'For each query: lower_bound(t1) = first index with ts ≥ t1, upper_bound(t2) = first index with ts > t2; answer = upper − lower. Two O(log n) searches.',
    backend: 'Serving "errors between 10:00 and 10:05" from a time-sorted segment index in a log store like Loki or Elasticsearch.',
  },
];
