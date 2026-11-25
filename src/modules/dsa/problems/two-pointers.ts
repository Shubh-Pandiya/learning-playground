import type { Problem, Tone, Variant } from '../engine/types.ts';
import type { Tracer } from '../engine/tracer.ts';
import { V, rc, tones } from '../engine/tracer.ts';

/** Attach a prediction whose options are de-duplicated and ordered deterministically. */
function ask(t: Tracer, question: string, correct: string, wrong: string[], why: string) {
  const options = [...new Set([correct, ...wrong])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  t.predict(question, options, options.indexOf(correct), why);
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);

/** Indices outside the live [l, r] range, for muting discarded cells. */
const outside = (n: number, l: number, r: number) => range(0, n).filter((k) => k < l || k > r);

/** Bar chart of heights as a grid (top row = tallest). `water[c]` cells are drawn as ≈. */
function barGrid(height: readonly number[], water: readonly number[], active: readonly number[]) {
  const maxH = Math.max(1, ...height, ...height.map((h, c) => h + (water[c] ?? 0)));
  const cells: string[][] = [];
  const tn: Record<string, Tone> = {};
  for (let row = 0; row < maxH; row++) {
    const level = maxH - row;
    const line: string[] = [];
    for (let c = 0; c < height.length; c++) {
      if (height[c] >= level) {
        line.push('█');
        if (active.includes(c)) tn[rc(row, c)] = 'active';
      } else if (height[c] + (water[c] ?? 0) >= level) {
        line.push('≈');
        tn[rc(row, c)] = 'info';
      } else line.push('');
    }
    cells.push(line);
  }
  return { cells, tones: tn, rowLabels: range(0, maxH).map((r) => maxH - r) };
}

const show = (ch: string) => (ch === ' ' ? '␣' : ch);
const isAlnum = (ch: string) => /^[a-z0-9]$/i.test(ch);

const validPalindrome: Problem<{ s: string }> = {
  id: 'valid-palindrome',
  num: 125,
  title: 'Valid Palindrome',
  difficulty: 'Easy',
  category: 'two-pointers',
  pattern: 'two-pointers',
  statement: 'Ignoring case and every character that is not a letter or digit, decide whether a string reads the same forwards and backwards.',
  signals: ['"reads the same forward and backward"', 'compare mirrored positions', 'skip some characters', 'O(1) extra space'],
  insight:
    'Mirror positions must match. Put l at the start and r at the end, skip anything that is not alphanumeric, compare case-insensitively, then move both inward — no cleaned copy needed.',
  hints: [
    'The easy way builds a cleaned, lower-cased copy and reverses it. Can you avoid the copy?',
    'Which two characters must be equal first? Then which two?',
    'Two indices moving inward; each skips non-alphanumerics before comparing.',
  ],
  pitfall: 'Forgetting `l < r` in the inner skip loops — on input like ".," the pointers run past each other (or off the string).',
  backend: {
    title: 'Zero-copy "equal ignoring separators" checks in a payments API',
    detail:
      'Matching a card, IBAN or phone number typed as "4111-1111 1111" against a stored value must ignore spaces, dashes and case. Two cursors that skip separators and compare in place do it without allocating normalised strings on every request — the same skip-then-compare loop as this palindrome check.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def isPalindrome(s):
    l, r = 0, len(s) - 1                            @init
    while l < r:                                    @loop
        while l < r and not s[l].isalnum():         @skipL
            l += 1                                  @incL
        while l < r and not s[r].isalnum():         @skipR
            r -= 1                                  @decR
        if s[l].lower() != s[r].lower():            @cmp
            return False                            @fail
        l, r = l + 1, r - 1                         @move
    return True                                     @ok
`,
  explain: {
    init: 'Mirror pair: first and last character.',
    skipL: 'Punctuation and spaces do not count — slide past them (but never past r).',
    skipR: 'Same on the right side.',
    cmp: 'Compare case-insensitively; one mismatch is enough to fail.',
    move: 'This pair matched; the next mirror pair is one step inward on both sides.',
  },
  distractors: [
    { text: '        if not s[l].isalnum():\n            l += 1', why: '"if" only skips ONE bad character; runs like ", " need a while loop.' },
    { text: '        if s[l] != s[r]:', why: 'Case-sensitive: "A" vs "a" would wrongly fail.' },
    { text: '    while l <= r:', why: 'Harmless but wasteful when l == r — a middle char always matches itself. The real bug is dropping "l < r" from the inner loops.' },
  ],
  input: { s: 'Step on no pets!' },
  presets: [
    { label: 'not a palindrome', input: { s: 'race a car' } },
    { label: 'only punctuation', input: { s: ' .,' } },
    { label: 'digits count', input: { s: '0P' } },
  ],
  validate: ({ s }) => (typeof s !== 'string' ? 'Expected { s: string }' : s.length > 24 ? 'Keep s ≤ 24 characters' : null),
  trace(t, { s }) {
    let l = 0;
    let r = s.length - 1;
    const skipped: number[] = [];
    const matched: number[] = [];
    let bad: number[] = [];
    t.draw(() => [
      V.array('s', s.split('').map(show), {
        pointers: { l, r },
        window: [l, r],
        tones: { ...tones(skipped, 'muted'), ...tones(matched, 'good'), ...tones(bad, 'bad') },
      }),
    ]);
    t.step('init', `l = 0, r = ${r}: the first and last characters are a mirror pair.`, { l, r });
    let askedSkipL = false;
    let askedSkipR = false;
    let askedCmp = 0;
    for (;;) {
      t.step('loop', l < r ? `l = ${l} < r = ${r}: there is still a pair to compare.` : `l = ${l}, r = ${r}: the pointers met — nothing left to compare.`, { l, r });
      if (l >= r) break;
      while (l < r && !isAlnum(s[l])) {
        if (!askedSkipL) {
          askedSkipL = true;
          t.step('skipL', `Check the left side: s[${l}] = '${show(s[l])}'.`, { l, r });
          ask(t, `s[${l}] = '${show(s[l])}'. What happens to l?`, 'l moves right', ['l stays, compare now', 'return False'], `'${show(s[l])}' is not alphanumeric, so it is ignored — l slides past it.`);
        } else t.step('skipL', `s[${l}] = '${show(s[l])}' is not a letter/digit — skip it.`, { l, r });
        skipped.push(l);
        l++;
        t.step('incL', `l → ${l}.`, { l, r });
      }
      while (l < r && !isAlnum(s[r])) {
        if (!askedSkipR) {
          askedSkipR = true;
          t.step('skipR', `Check the right side: s[${r}] = '${show(s[r])}'.`, { l, r });
          ask(t, `s[${r}] = '${show(s[r])}'. What happens to r?`, 'r moves left', ['r stays, compare now', 'return False'], `'${show(s[r])}' is not alphanumeric, so it is ignored — r slides past it.`);
        } else t.step('skipR', `s[${r}] = '${show(s[r])}' is not a letter/digit — skip it.`, { l, r });
        skipped.push(r);
        r--;
        t.step('decR', `r → ${r}.`, { l, r });
      }
      const same = s[l].toLowerCase() === s[r].toLowerCase();
      t.step('cmp', `Compare s[${l}] = '${s[l]}' with s[${r}] = '${s[r]}' (ignoring case).`, { l, r, 's[l]': s[l], 's[r]': s[r] });
      if (askedCmp < 2 && s[l] !== s[r]) {
        askedCmp++;
        t.predict(`Do '${s[l]}' and '${s[r]}' match?`, ['Yes', 'No'], same ? 0 : 1, same ? 'Lower-casing both makes them identical.' : 'Different letters even after lower-casing.');
      }
      if (!same) {
        bad = [l, r];
        t.step('fail', `'${s[l]}' ≠ '${s[r]}' — mirrored positions differ, so it is not a palindrome.`, { result: false });
        return false;
      }
      matched.push(l, r);
      l++;
      r--;
      t.step('move', `Pair matched. Move both inward: l = ${l}, r = ${r}.`, { l, r });
    }
    t.step('ok', 'Every mirrored pair matched — it is a palindrome.', { result: true });
    return true;
  },
};

const twoSumII: Problem<{ numbers: number[]; target: number }> = {
  id: 'two-sum-ii-input-array-is-sorted',
  num: 167,
  title: 'Two Sum II - Input Array Is Sorted',
  difficulty: 'Medium',
  category: 'two-pointers',
  pattern: 'two-pointers',
  statement: 'The array is sorted ascending. Find the two different positions whose values add up to the target and return them 1-indexed, using only constant extra space.',
  signals: ['sorted input', '"pair" with a target sum', 'O(1) extra space (rules out the hashmap)', '1-indexed answer'],
  insight:
    'With l at the smallest and r at the largest value, the sum tells you which pointer is useless: too big → numbers[r] cannot pair with anything left, so r moves left; too small → l moves right. Each step discards one candidate forever.',
  hints: [
    'The hashmap from Two Sum works but uses O(n) space. What does sortedness buy you?',
    'Start with the extremes. If their sum is too large, which element can never be part of the answer?',
    'sum > target → r -= 1; sum < target → l += 1.',
  ],
  pitfall: 'Returning 0-indexed positions (or moving both pointers at once and skipping the answer).',
  backend: {
    title: 'Merge-join style matching on an index-ordered scan',
    detail:
      'A reconciliation job looks for two invoices that together match a wire transfer. If the invoices table is read via a B-tree index on amount, one cursor from the low end and one from the high end find the pair in a single pass with O(1) memory — the same reason databases prefer merge joins on sorted inputs over building a hash table.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def twoSum(numbers, target):
    l, r = 0, len(numbers) - 1          @init
    while l < r:                        @loop
        cur = numbers[l] + numbers[r]   @sum
        if cur > target:                @gt
            r -= 1                      @decR
        elif cur < target:              @lt
            l += 1                      @incL
        else:
            return [l + 1, r + 1]       @found
`,
  explain: {
    init: 'Smallest and largest candidates.',
    gt: 'numbers[r] is too big even with the smallest partner — it can never be in the answer.',
    lt: 'numbers[l] is too small even with the largest partner — discard it.',
    found: 'The problem wants 1-indexed positions.',
  },
  distractors: [
    { text: '        if cur > target:\n            l += 1', why: 'Moving l right makes the sum BIGGER — the wrong direction when it is already too big.' },
    { text: '            return [l, r]', why: 'The answer is 1-indexed; return [l + 1, r + 1].' },
    { text: '    while l <= r:', why: 'l == r would use the same element twice.' },
  ],
  input: { numbers: [1, 3, 4, 5, 7, 10, 11], target: 9 },
  presets: [
    { label: 'classic', input: { numbers: [2, 7, 11, 15], target: 9 } },
    { label: 'negatives', input: { numbers: [-3, -1, 0, 2, 6], target: -1 } },
  ],
  validate: ({ numbers, target }) =>
    !Array.isArray(numbers) || typeof target !== 'number'
      ? 'Expected { numbers: number[], target: number }'
      : numbers.length > 14
        ? 'Keep numbers ≤ 14 elements'
        : numbers.some((x, i) => i > 0 && x < numbers[i - 1])
          ? 'numbers must be sorted ascending'
          : null,
  trace(t, { numbers, target }) {
    let l = 0;
    let r = numbers.length - 1;
    let found: number[] = [];
    t.draw(() => [
      V.array('numbers', numbers, {
        pointers: { l, r },
        window: [l, r],
        tones: { ...tones(outside(numbers.length, l, r), 'muted'), ...tones(found, 'good') },
        caption: 'grey = ruled out forever',
      }),
    ]);
    t.step('init', `l = 0 (smallest), r = ${r} (largest). Target ${target}.`, { l, r, target });
    let asked = 0;
    while (l < r) {
      t.step('loop', `${r - l + 1} candidates left between l and r.`, { l, r });
      const cur = numbers[l] + numbers[r];
      t.step('sum', `numbers[${l}] + numbers[${r}] = ${numbers[l]} + ${numbers[r]} = ${cur}.`, { l, r, cur, target });
      if (asked < 3) {
        asked++;
        const correct = cur > target ? 'r moves left' : cur < target ? 'l moves right' : 'pair found';
        t.predict(`Sum ${cur} vs target ${target}: what happens next?`, ['l moves right', 'r moves left', 'pair found'], ['l moves right', 'r moves left', 'pair found'].indexOf(correct), cur > target ? `Too big. Even the smallest remaining partner (${numbers[l]}) makes ${numbers[r]} overshoot, so ${numbers[r]} is useless.` : cur < target ? `Too small. Even the largest remaining partner (${numbers[r]}) cannot lift ${numbers[l]} to the target, so ${numbers[l]} is useless.` : 'Exactly the target.');
      }
      if (cur > target) {
        t.step('gt', `${cur} > ${target}: too big, and only shrinking the larger value can help.`, { cur });
        r--;
        t.step('decR', `Discard ${numbers[r + 1]}: r → ${r}.`, { l, r });
      } else if (cur < target) {
        t.step('gt', `${cur} is not > ${target}.`, { cur });
        t.step('lt', `${cur} < ${target}: too small, so the smaller value must grow.`, { cur });
        l++;
        t.step('incL', `Discard ${numbers[l - 1]}: l → ${l}.`, { l, r });
      } else {
        found = [l, r];
        t.step('found', `${cur} == ${target}! Return 1-indexed [${l + 1}, ${r + 1}].`, { result: [l + 1, r + 1] });
        return [l + 1, r + 1];
      }
    }
    t.step('loop', 'Pointers met without a match (the problem promises this cannot happen).', { l, r });
    return null;
  },
};

const threeSum: Problem<{ nums: number[] }> = {
  id: '3sum',
  num: 15,
  title: '3Sum',
  difficulty: 'Medium',
  category: 'two-pointers',
  pattern: 'two-pointers',
  statement: 'Return every distinct triple of values from the array (taken from three different positions) whose sum is zero. No triple may be listed twice.',
  signals: ['"triplets" summing to a target', '"no duplicate triplets"', 'O(n²) is acceptable', 'order of output does not matter → sort first'],
  insight:
    'Sort, fix the first value a, and the rest is Two Sum II on the suffix with target −a. Duplicates are avoided by skipping equal neighbours — for a, and for l after each hit.',
  hints: [
    'Brute force is O(n³). If you fix one number, what problem is left?',
    'Sorting lets you use the two-pointer Two Sum II for the remaining pair.',
    'Skip a when it equals the previous a; after a hit, advance l past equal values.',
  ],
  pitfall: 'Not skipping duplicates (for a, or for l after a match) — the same triple gets reported several times.',
  backend: {
    title: 'Finding offsetting adjustments in ledger reconciliation',
    detail:
      'A finance job looks for three adjustment entries that net to zero (e.g. a charge refunded via two partial chargebacks). Sorting the day\'s amounts, fixing one and two-pointer scanning the rest gives all such triples in O(n²) with no hash tables; the duplicate-skip keeps each combination reported once in the audit file.',
  },
  complexity: { time: 'O(n²)', space: 'O(1) extra (sorting aside)' },
  code: `
def threeSum(nums):
    res = []                                         @init
    nums.sort()                                      @sort
    for i, a in enumerate(nums):                     @loop
        if a > 0:                                    @pos
            break
        if i > 0 and a == nums[i - 1]:               @dupA
            continue
        l, r = i + 1, len(nums) - 1                  @lr
        while l < r:                                 @while
            s = a + nums[l] + nums[r]                @sum
            if s > 0:                                @gt
                r -= 1                               @decR
            elif s < 0:                              @lt
                l += 1                               @incL
            else:
                res.append([a, nums[l], nums[r]])    @found
                l += 1                               @next
                while nums[l] == nums[l - 1] and l < r:   @dupL
                    l += 1                           @skipL
    return res                                       @done
`,
  explain: {
    sort: 'Sorting enables both the two-pointer scan and duplicate skipping.',
    pos: 'If the smallest of the three is positive, no triple can reach 0.',
    dupA: 'Same a as last time would rediscover the same triples.',
    lr: 'Two Sum II on the part to the right of i.',
    next: 'Keep searching: another pair may also work with this a.',
    dupL: 'Skip equal l values so the same pair is not found again.',
  },
  distractors: [
    { text: '        if a == nums[i + 1]:\n            continue', why: 'Compares with the NEXT value: skips the first copy and loses triples like [-1, -1, 2].' },
    { text: '                res.append([a, nums[l], nums[r]])\n                break', why: 'Breaking after the first hit misses other pairs for the same a (e.g. [-4,1,3] and [-4,0,4]).' },
    { text: '        l, r = 0, len(nums) - 1', why: 'l must start after i, otherwise a can be reused and triples repeat.' },
  ],
  input: { nums: [-1, 0, 1, 2, -1, -4] },
  presets: [
    { label: 'all zeros', input: { nums: [0, 0, 0, 0] } },
    { label: 'no triple', input: { nums: [0, 1, 1] } },
    { label: 'several per a', input: { nums: [-4, -1, 0, 1, 3, 4, -1, 2] } },
  ],
  validate: ({ nums }) => (!Array.isArray(nums) ? 'Expected { nums: number[] }' : nums.length < 3 ? 'Need at least 3 numbers' : nums.length > 10 ? 'Keep nums ≤ 10 elements' : null),
  trace(t, { nums }) {
    const res: number[][] = [];
    let i = -1;
    let l = -1;
    let r = -1;
    let hit: number[] = [];
    t.draw(() => [
      V.array('nums', nums, {
        pointers: { i, l, r },
        window: l >= 0 && l <= r ? [l, r] : null,
        tones: { ...(i >= 0 ? tones(range(0, i), 'muted') : {}), ...(i >= 0 && i < nums.length ? { [i]: 'info' as Tone } : {}), ...tones(hit, 'good') },
      }),
      V.chips('res', res.map((x) => `[${x.join(', ')}]`), { tones: tones(range(0, res.length), 'good') }),
    ]);
    t.step('init', 'Empty result list.');
    nums.sort((a, b) => a - b);
    t.step('sort', `Sorted: [${nums.join(', ')}]. Equal values are now neighbours, and order tells us which way to move.`);
    let askedDup = false;
    let askedPos = false;
    let askedNeg = false;
    let askedNext = false;
    for (i = 0; i < nums.length; i++) {
      const a = nums[i];
      l = r = -1;
      hit = [];
      t.step('loop', `Fix a = nums[${i}] = ${a}; look for a pair summing to ${-a} to its right.`, { i, a });
      if (a > 0) {
        t.step('pos', `a = ${a} > 0: every value to the right is ≥ a, so no triple can sum to 0. Stop.`, { a });
        break;
      }
      if (i > 0 && a === nums[i - 1]) {
        t.step('dupA', `a = ${a} equals the previous a — every triple it could form was already found. Skip.`, { i, a });
        continue;
      }
      if (!askedDup && i + 1 < nums.length && nums[i + 1] === a) {
        askedDup = true;
        t.step('dupA', `a = ${a} is new (the next value is also ${a}, but we handle the first copy).`, { i, a });
        t.predict(`When the loop reaches i = ${i + 1} (also ${a}), what will it do?`, ['Run the two-pointer scan again', 'Skip it'], 1, 'Every pair that works with the second copy also works with the first, so it would only produce duplicates.');
      } else t.step('dupA', i === 0 ? 'First a — nothing to compare with.' : `a = ${a} differs from the previous ${nums[i - 1]}.`, { i, a });
      l = i + 1;
      r = nums.length - 1;
      t.step('lr', `l = ${l}, r = ${r}: Two Sum II on the sorted suffix.`, { i, l, r });
      while (l < r) {
        t.step('while', `l = ${l} < r = ${r}.`, { l, r });
        const s = a + nums[l] + nums[r];
        t.step('sum', `${a} + ${nums[l]} + ${nums[r]} = ${s}.`, { a, l, r, s });
        if ((s > 0 && !askedPos) || (s < 0 && !askedNeg)) {
          if (s > 0) askedPos = true;
          else askedNeg = true;
          t.predict(`The sum is ${s}. Which pointer moves?`, ['l moves right', 'r moves left'], s > 0 ? 1 : 0, s > 0 ? 'Too big: only a smaller nums[r] can bring it down.' : 'Too small: only a larger nums[l] can raise it.');
        }
        if (s > 0) {
          t.step('gt', `${s} > 0: too big.`, { s });
          r--;
          t.step('decR', `r → ${r} (smaller value).`, { l, r });
        } else if (s < 0) {
          t.step('gt', `${s} is not > 0.`, { s });
          t.step('lt', `${s} < 0: too small.`, { s });
          l++;
          t.step('incL', `l → ${l} (larger value).`, { l, r });
        } else {
          res.push([a, nums[l], nums[r]]);
          hit = [i, l, r];
          t.step('found', `Zero! Record [${a}, ${nums[l]}, ${nums[r]}].`, { res: res.map((x) => [...x]) });
          l++;
          hit = [];
          if (!askedNext && l < r && nums[l] === nums[l - 1]) {
            askedNext = true;
            t.step('next', `l → ${l}. But nums[${l}] = ${nums[l]} equals the value we just used.`, { l, r });
            t.predict(`Should the scan test nums[${l}] = ${nums[l]} with this a?`, ['Yes', 'No, skip it'], 1, 'Same a and same l value would force the same r value — a duplicate triple.');
          } else t.step('next', `l → ${l}: other pairs may still work with a = ${a}.`, { l, r });
          while (l < r && nums[l] === nums[l - 1]) {
            t.step('dupL', `nums[${l}] = ${nums[l]} repeats the previous l value — skip.`, { l, r });
            l++;
            t.step('skipL', `l → ${l}.`, { l, r });
          }
        }
      }
      t.step('while', `l = ${l} ≥ r = ${r}: done with a = ${a}.`, { l, r });
    }
    i = l = r = -1;
    hit = [];
    t.step('done', `${res.length} distinct triple(s).`, { result: res });
    return res;
  },
};

const containerWater: Problem<{ height: number[] }> = {
  id: 'container-with-most-water',
  num: 11,
  title: 'Container With Most Water',
  difficulty: 'Medium',
  category: 'two-pointers',
  pattern: 'two-pointers',
  statement: 'Vertical lines stand at each index with the given heights. Pick two lines that, with the x-axis, hold the most water; return that amount (width × the shorter line).',
  signals: ['choose a PAIR maximising (distance × min of the two)', 'O(n²) pairs is too slow', 'start widest, then shrink'],
  insight:
    'Start with the widest pair. The shorter line caps the area, and any narrower container that keeps it can only be worse — so the shorter line is never useful again. Move it inward.',
  hints: [
    'Which pair has the largest width?',
    'Area = width × min(h[l], h[r]). Moving which pointer could possibly increase it?',
    'Always move the pointer at the shorter line.',
  ],
  pitfall: 'Moving the taller line (or both) — that can skip the optimal pair because width shrinks while the cap stays the same.',
  backend: {
    title: 'Choosing a backfill window under an endpoint throughput cap',
    detail:
      'A migration job may start at hour l and finish at hour r of tomorrow\'s plan, and its throttle is set to the lower of the spare IOPS at those two boundary hours. Rows moved = (r − l) × min(spare[l], spare[r]). Scanning from the widest window and always dropping the tighter boundary finds the best window in O(n) instead of testing all pairs.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def maxArea(height):
    l, r = 0, len(height) - 1                          @init
    res = 0                                            @res0
    while l < r:                                       @loop
        area = (r - l) * min(height[l], height[r])     @area
        res = max(res, area)                           @best
        if height[l] < height[r]:                      @cmp
            l += 1                                     @incL
        else:
            r -= 1                                     @decR
    return res                                         @done
`,
  explain: {
    init: 'Widest possible container.',
    area: 'Water level is set by the shorter wall.',
    cmp: 'The shorter wall already gave its best possible area (it was at maximum width). Discard it.',
  },
  distractors: [
    { text: '        if height[l] > height[r]:\n            l += 1', why: 'Moves the TALLER wall: the width shrinks while the short wall still caps the level, so area cannot improve.' },
    { text: '        area = (r - l) * max(height[l], height[r])', why: 'Water spills over the shorter wall — the level is the min, not the max.' },
    { text: '        area = (r - l + 1) * min(height[l], height[r])', why: 'Width is the distance between the lines, r − l (no +1).' },
  ],
  input: { height: [1, 8, 6, 2, 5, 4, 8, 3, 7] },
  presets: [
    { label: 'two lines', input: { height: [1, 1] } },
    { label: 'increasing', input: { height: [1, 2, 3, 4, 5] } },
  ],
  validate: ({ height }) =>
    !Array.isArray(height) || height.some((h) => typeof h !== 'number' || h < 0)
      ? 'Expected { height: number[] } of non-negative numbers'
      : height.length < 2 || height.length > 12
        ? 'Use 2–12 lines'
        : Math.max(...height) > 10
          ? 'Keep heights ≤ 10'
          : null,
  trace(t, { height }) {
    let l = 0;
    let r = height.length - 1;
    let res = 0;
    let best: [number, number] | null = null;
    const chart = () => {
      const lvl = l < r ? Math.min(height[l], height[r]) : 0;
      const water = height.map((h, c) => (c > l && c < r ? Math.max(0, lvl - h) : 0));
      return barGrid(height, water, [l, r]);
    };
    t.draw(() => {
      const g = chart();
      return [
        V.array('height', height, { pointers: { l, r }, window: [l, r], tones: { ...tones(outside(height.length, l, r), 'muted') } }),
        V.grid('container', g.cells, { tones: g.tones, rowLabels: g.rowLabels, colLabels: range(0, height.length), caption: best ? `best so far: lines ${best[0]} & ${best[1]} → ${res}` : undefined }),
      ];
    });
    t.step('init', `Widest container: l = 0, r = ${r}.`, { l, r });
    t.step('res0', 'Best area so far: 0.', { res });
    let asked = 0;
    while (l < r) {
      t.step('loop', `Width ${r - l}.`, { l, r });
      const area = (r - l) * Math.min(height[l], height[r]);
      t.step('area', `(${r} − ${l}) × min(${height[l]}, ${height[r]}) = ${area}.`, { l, r, area });
      if (area > res) best = [l, r];
      res = Math.max(res, area);
      t.step('best', `res = ${res}.`, { area, res });
      if (asked < 3 && height[l] !== height[r]) {
        asked++;
        t.predict(`height[l] = ${height[l]}, height[r] = ${height[r]}. Which pointer moves?`, ['l', 'r'], height[l] < height[r] ? 0 : 1, `The shorter wall (${Math.min(height[l], height[r])}) caps the water; every narrower container that keeps it is worse, so it is discarded.`);
      }
      t.step('cmp', `${height[l]} ${height[l] < height[r] ? '<' : '≥'} ${height[r]}: the ${height[l] < height[r] ? 'left' : 'right'} wall is the bottleneck.`, { 'height[l]': height[l], 'height[r]': height[r] });
      if (height[l] < height[r]) {
        l++;
        t.step('incL', `Drop the short left wall: l → ${l}.`, { l, r });
      } else {
        r--;
        t.step('decR', `Drop the right wall: r → ${r}.`, { l, r });
      }
    }
    t.step('done', `Pointers met. Maximum water = ${res}.`, { result: res });
    return res;
  },
};

const trappingRain: Problem<{ height: number[] }> = {
  id: 'trapping-rain-water',
  num: 42,
  title: 'Trapping Rain Water',
  difficulty: 'Hard',
  category: 'two-pointers',
  pattern: 'two-pointers',
  statement: 'Bars of width 1 have the given heights. After rain, water collects in the dips between bars. Compute the total units of water held.',
  signals: ['water above each bar = min(max left, max right) − height', '"elevation map"', 'O(1) space wanted → two pointers instead of prefix/suffix max arrays'],
  insight:
    'Water at i is min(maxLeft, maxRight) − h[i]. If leftMax < rightMax, the left side is the bottleneck for position l no matter what lies between — so l can be settled using leftMax alone.',
  hints: [
    'How much water sits on top of a single bar? It depends on the tallest bars on each side.',
    'Prefix-max and suffix-max arrays give an O(n)-space solution.',
    'Two pointers: process the side whose running max is smaller; that max is the true limit there.',
  ],
  pitfall: 'Moving the pointer on the side with the LARGER max — then the water level there is not yet known.',
  backend: {
    title: 'Estimating requests lost during an incident dip',
    detail:
      'Given requests-per-minute during an outage, SREs estimate the traffic shortfall: each minute\'s expected level is bounded by the healthy peaks before and after it, so lost(i) = min(peak before, peak after) − actual(i). Summing those "puddles" in one two-pointer pass over the metric series gives the incident-report number without extra arrays.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def trap(height):
    if not height:                                 @empty
        return 0
    l, r = 0, len(height) - 1                      @init
    leftMax, rightMax = height[l], height[r]       @max0
    res = 0                                        @res0
    while l < r:                                   @loop
        if leftMax < rightMax:                     @cmp
            l += 1                                 @incL
            leftMax = max(leftMax, height[l])      @lmax
            res += leftMax - height[l]             @addL
        else:
            r -= 1                                 @decR
            rightMax = max(rightMax, height[r])    @rmax
            res += rightMax - height[r]            @addR
    return res                                     @done
`,
  explain: {
    cmp: 'The smaller running max is the binding limit for that side — the other side is guaranteed at least as tall.',
    lmax: 'Update the max BEFORE adding, so a new tallest bar holds 0 water instead of going negative.',
    addL: 'leftMax ≤ rightMax, so the water level at l is exactly leftMax.',
    addR: 'Symmetric: rightMax is the level at r.',
  },
  distractors: [
    { text: '            res += leftMax - height[l]\n            leftMax = max(leftMax, height[l])', why: 'Adding before updating the max can add a negative amount when height[l] is a new peak.' },
    { text: '        if leftMax > rightMax:\n            l += 1', why: 'Processes the side with the LARGER max — its true water level is not known yet.' },
    { text: '            res += min(leftMax, rightMax)', why: 'Forgets to subtract the bar\'s own height; that counts the bar as water.' },
  ],
  input: { height: [0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1] },
  presets: [
    { label: 'one deep pit', input: { height: [4, 2, 0, 3, 2, 5] } },
    { label: 'no dips', input: { height: [1, 2, 3, 4] } },
    { label: 'empty', input: { height: [] } },
  ],
  validate: ({ height }) =>
    !Array.isArray(height) || height.some((h) => typeof h !== 'number' || h < 0)
      ? 'Expected { height: number[] } of non-negative numbers'
      : height.length > 14
        ? 'Keep ≤ 14 bars'
        : height.length && Math.max(...height) > 8
          ? 'Keep heights ≤ 8'
          : null,
  trace(t, { height }) {
    const n = height.length;
    const water = height.map(() => 0);
    let l = -1;
    let r = -1;
    let cur = -1;
    t.draw(() => {
      const g = barGrid(height, water, cur >= 0 ? [cur] : []);
      return [
        V.array('height', height, {
          pointers: { l, r },
          window: l >= 0 ? [l, r] : null,
          tones: { ...(l >= 0 ? tones(range(0, n).filter((k) => k < l || k > r), 'good') : {}), ...(cur >= 0 ? { [cur]: 'active' as Tone } : {}) },
          caption: 'green = settled',
        }),
        n > 0 && V.grid('elevation (≈ water found so far)', g.cells, { tones: g.tones, rowLabels: g.rowLabels, colLabels: range(0, n) }),
        n > 0 && V.array('water[i]', water, { tones: cur >= 0 ? { [cur]: 'active' } : {} }),
      ];
    });
    t.step('empty', n ? `${n} bars.` : 'No bars at all.', { n });
    if (!n) {
      t.step(null, 'Nothing can hold water.');
      t.step('done', 'Return 0.', { result: 0 });
      return 0;
    }
    l = 0;
    r = n - 1;
    t.step('init', `l = 0, r = ${r}. The two outer bars can never hold water themselves.`, { l, r });
    let leftMax = height[l];
    let rightMax = height[r];
    t.step('max0', `leftMax = ${leftMax}, rightMax = ${rightMax}.`, { leftMax, rightMax });
    let res = 0;
    t.step('res0', 'Total water = 0.', { res });
    let askedSideL = false;
    let askedSideR = false;
    let askedAmt = false;
    while (l < r) {
      cur = -1;
      t.step('loop', l + 1 <= r - 1 ? `Unsettled bars: ${l + 1}…${r - 1}.` : `l = ${l}, r = ${r}: one more step closes the gap.`, { l, r, leftMax, rightMax });
      const sideL = leftMax < rightMax;
      if (!(sideL ? askedSideL : askedSideR)) {
        if (sideL) askedSideL = true;
        else askedSideR = true;
        t.predict(`leftMax = ${leftMax}, rightMax = ${rightMax}. Which side do we settle next?`, ['left (l moves)', 'right (r moves)'], sideL ? 0 : 1, leftMax === rightMax ? 'A tie takes the else branch (r moves). Either side would be safe: both walls are equally tall.' : `The smaller max (${Math.min(leftMax, rightMax)}) is the binding wall on its side: the other side is known to be at least that tall.`);
      }
      if (leftMax < rightMax) {
        t.step('cmp', `${leftMax} < ${rightMax}: the left side is the bottleneck, so bar l + 1's level depends only on leftMax.`, { leftMax, rightMax });
        l++;
        cur = l;
        t.step('incL', `l → ${l} (height ${height[l]}).`, { l });
        leftMax = Math.max(leftMax, height[l]);
        t.step('lmax', `leftMax = max(…, ${height[l]}) = ${leftMax}.`, { leftMax });
        const w = leftMax - height[l];
        if (!askedAmt && w > 0) {
          askedAmt = true;
          ask(t, `How much water sits on bar ${l} (height ${height[l]})?`, String(w), [String(w + 1), String(Math.max(0, w - 1)), String(height[l])], `leftMax − height = ${leftMax} − ${height[l]}.`);
        }
        water[l] = w;
        res += w;
        t.step('addL', w ? `${leftMax} − ${height[l]} = ${w} unit(s) of water at ${l}. Total ${res}.` : `Bar ${l} is as tall as leftMax — no water. Total ${res}.`, { 'water[l]': w, res });
      } else {
        t.step('cmp', `${leftMax} ≥ ${rightMax}: the right side is the bottleneck.`, { leftMax, rightMax });
        r--;
        cur = r;
        t.step('decR', `r → ${r} (height ${height[r]}).`, { r });
        rightMax = Math.max(rightMax, height[r]);
        t.step('rmax', `rightMax = max(…, ${height[r]}) = ${rightMax}.`, { rightMax });
        const w = rightMax - height[r];
        water[r] = w;
        res += w;
        t.step('addR', w ? `${rightMax} − ${height[r]} = ${w} unit(s) at ${r}. Total ${res}.` : `Bar ${r} reaches rightMax — no water. Total ${res}.`, { 'water[r]': w, res });
      }
    }
    cur = -1;
    t.step('done', `Pointers met at ${l}. Total trapped water = ${res}.`, { result: res });
    return res;
  },
};

export const problems: Problem[] = [validPalindrome, twoSumII, threeSum, containerWater, trappingRain];

export const variants: Variant[] = [
  {
    id: 'merge-sorted-event-streams',
    title: 'Merge two sorted event logs without duplicates',
    statement: 'Two services each emit a log of event timestamps sorted ascending (with possible duplicates across logs). Produce one sorted list containing every distinct timestamp, using O(1) extra space beyond the output.',
    pattern: 'two-pointers',
    nearest: 'two-sum-ii-input-array-is-sorted',
    signals: ['two inputs that are already sorted', 'merge / intersect / union', 'avoid hashing (memory bound)'],
    approach:
      'One pointer per list. Append the smaller head (skip it if it equals the last appended value) and advance that pointer; when one list ends, drain the other the same way.',
    backend:
      'Merging per-shard change logs or SSTables during LSM compaction: k sorted runs are streamed with one cursor each and deduplicated on the fly — never loaded into a hash set.',
  },
  {
    id: 'compact-sorted-in-place',
    title: 'Compact a sorted array in place (keep at most 2 copies)',
    statement: 'Given a sorted array, rewrite it in place so each value appears at most twice, and return the new length. Use O(1) extra memory.',
    pattern: 'two-pointers',
    nearest: '3sum',
    signals: ['sorted input with duplicates', '"in place" / O(1) memory', 'return the new length'],
    approach:
      'A write pointer w and a read pointer r. Copy nums[r] to nums[w] only if w < 2 or nums[r] != nums[w − 2]; then w += 1. Same "compare with the last kept value" idea as 3Sum\'s duplicate skip.',
    backend:
      'Write-ahead-log or time-series compaction: rewrite a sorted segment in place, keeping only the latest N versions per key, without allocating a second buffer.',
  },
  {
    id: 'sorted-squares',
    title: 'Squares of a sorted array, still sorted',
    statement: 'An array sorted ascending may contain negatives. Return the squares of all values, sorted ascending, in O(n).',
    pattern: 'two-pointers',
    nearest: 'container-with-most-water',
    signals: ['sorted input but a transform breaks the order', 'largest results come from the two ENDS', 'O(n) required (no re-sort)'],
    approach:
      'l at the start, r at the end; the larger |value| owns the largest remaining square. Write it at the back of the output and move that pointer inward.',
    backend:
      'Merging latency deltas around a baseline (negative = faster, positive = slower) into a sorted "largest deviation" report without sorting again.',
  },
];
