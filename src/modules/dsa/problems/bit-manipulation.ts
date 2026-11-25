import type { Problem, Tone, Variant } from '../engine/types.ts';
import { V } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Bit manipulation — XOR cancellation, n & (n − 1), shifts and masks.
// ---------------------------------------------------------------------------

/** Build predict options from a correct value + distractors, de-duplicated, keeping the answer index. */
function opts(correct: string, ...others: string[]): { options: string[]; answer: number } {
  const options = [correct];
  for (const o of others) if (!options.includes(o)) options.push(o);
  options.sort();
  return { options, answer: options.indexOf(correct) };
}

/** Unsigned 32-bit view of a JS number (so negatives show their two's-complement bits). */
const u32 = (x: number) => x >>> 0;

/** Smallest display width (8 / 16 / 32) that shows all values without losing bits. */
function widthFor(...vals: number[]): number {
  const m = Math.max(0, ...vals.map(u32));
  return m <= 0xff ? 8 : m <= 0xffff ? 16 : 32;
}

/** Tone every set bit of x. */
function setBits(x: number, tone: Tone, width = 32): Record<number, Tone> {
  const out: Record<number, Tone> = {};
  for (let b = 0; b < width; b++) if ((u32(x) >>> b) & 1) out[b] = tone;
  return out;
}

const lowBit = (x: number) => 31 - Math.clz32(u32(x) & -u32(x));
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

// ---------------------------------------------------------------------------

const singleNumber: Problem<{ nums: number[] }> = {
  id: 'single-number',
  num: 136,
  title: 'Single Number',
  difficulty: 'Easy',
  category: 'bit-manipulation',
  pattern: 'bits',
  statement: 'Every value in a non-empty array appears exactly twice except one, which appears once. Find that one using O(1) extra memory.',
  signals: ['"every element appears twice except one"', 'O(1) extra space', 'pairs cancel', 'order doesn\'t matter'],
  insight: 'x ^ x = 0 and x ^ 0 = x, and XOR is order-independent. XOR everything: each pair cancels itself out bit by bit, leaving only the lonely value.',
  hints: [
    'A hash set works but uses O(n) memory. Which operation makes a value cancel itself?',
    'What is a ^ a? What is a ^ 0?',
    'res = 0; for n in nums: res ^= n.',
  ],
  pitfall: 'Starting res at something other than 0 (0 is XOR\'s identity), or trying sum-based tricks that overflow / break with negatives.',
  backend: {
    title: 'Finding the unacknowledged message in a send/ack log',
    detail:
      'A delivery service logs a message ID once when sent and once when acked. To find the single message still unacknowledged without holding a set of millions of IDs in memory, XOR all logged IDs: matched send/ack pairs cancel, leaving the stuck ID. The same cancellation powers RAID-5 parity and XOR checksums for detecting a single missing block.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def singleNumber(nums):
    res = 0                     @init
    for n in nums:              @loop
        res = n ^ res           @xor
    return res                  @done
`,
  explain: {
    init: '0 is the identity for XOR: 0 ^ x = x.',
    xor: 'Each bit of res flips wherever n has a 1. A value seen twice flips the same bits twice → no net change.',
    done: 'All pairs have cancelled; only the single value\'s bits remain.',
  },
  distractors: [
    { text: '        res = n & res', why: 'AND with 0 stays 0 forever; you need XOR so pairs cancel.' },
    { text: '        res = n | res', why: 'OR only ever turns bits on — duplicates never cancel.' },
    { text: '    res = 1', why: 'Starting at 1 flips bit 0 of the answer; XOR\'s identity is 0.' },
  ],
  input: { nums: [4, 1, 2, 1, 2] },
  presets: [
    { label: 'single element', input: { nums: [7] } },
    { label: 'answer first', input: { nums: [9, 5, 3, 5, 3] } },
    { label: 'negative', input: { nums: [-1, 6, 6] } },
  ],
  validate: ({ nums }) => {
    if (!Array.isArray(nums) || !nums.every(isInt)) return 'Expected { nums: integer[] }';
    if (!nums.length || nums.length > 15 || nums.length % 2 === 0) return 'Use an odd length between 1 and 15';
    return null;
  },
  trace(t, { nums }) {
    const width = widthFor(...nums);
    let res = 0;
    let prev: number | null = null;
    let n: number | null = null;
    let i = -1;
    let predicts = 0;
    const seenOnce = new Set<number>();
    t.draw(() => {
      const rows: { label: string; value: number; tones?: Record<number, Tone> }[] = [];
      if (prev !== null && n !== null) {
        rows.push({ label: `res (before) = ${prev}`, value: u32(prev) });
        rows.push({ label: `n = ${n}`, value: u32(n), tones: setBits(n, 'active', width) });
        rows.push({ label: `res ^ n = ${res}`, value: u32(res), tones: { ...setBits(res, 'good', width), ...setBits(n, 'warn', width) } });
      } else {
        rows.push({ label: `res = ${res}`, value: u32(res), tones: setBits(res, 'good', width) });
        if (n !== null) rows.push({ label: `n = ${n}`, value: u32(n), tones: setBits(n, 'active', width) });
      }
      return [
        V.array('nums', nums, { pointers: { n: i } }),
        V.bits('bits', rows, { width, caption: 'orange = bits flipped by this XOR' }),
        V.set('seen an odd number of times so far', seenOnce),
      ];
    });
    t.step('init', 'res = 0, the XOR identity.', { res });
    for (i = 0; i < nums.length; i++) {
      n = nums[i];
      prev = null;
      t.step('loop', `n = ${n}.`, { n, res });
      const next = n ^ res;
      const repeat = seenOnce.has(n);
      if (predicts < 3 && (i === 0 || repeat)) {
        predicts++;
        const o = opts(String(next), String(n | res), String(n & res));
        t.predict(`What is res after res = ${n} ^ ${res}?`, o.options, o.answer, repeat ? `${n} was already XORed in once — XORing it again flips the same bits back, cancelling it.` : `XOR keeps bits that differ: ${n} ^ ${res} = ${next}.`);
      }
      prev = res;
      res = next;
      if (repeat) seenOnce.delete(n);
      else seenOnce.add(n);
      t.step('xor', repeat ? `${n} ^ ${prev} = ${res}: ${n} appeared before, so its bits flip back — the pair cancels.` : `${n} ^ ${prev} = ${res}: ${n}'s 1-bits are toggled into res.`, { n, res });
    }
    i = -1;
    n = null;
    prev = null;
    t.step('done', `Every pair cancelled; res = ${res} is the single number.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const hammingWeight: Problem<{ n: number }> = {
  id: 'number-of-1-bits',
  num: 191,
  title: 'Number of 1 Bits',
  difficulty: 'Easy',
  category: 'bit-manipulation',
  pattern: 'bits',
  statement: 'Count how many bits are set to 1 in the binary form of a non-negative 32-bit integer (its "population count").',
  signals: ['"number of set bits" / Hamming weight', 'unsigned 32-bit input', 'bit-level counting', 'O(number of set bits) possible'],
  insight:
    'n − 1 flips the lowest set bit to 0 and every 0 below it to 1, so n & (n − 1) clears exactly the lowest set bit. Repeat until n is 0 — one iteration per 1-bit.',
  hints: [
    'You could test n % 2 and shift right 32 times. Can you skip the zeros?',
    'Write n and n − 1 in binary one above the other. What changed?',
    'while n: n &= n − 1; count += 1.',
  ],
  pitfall: 'In languages with signed shifts, n >> 1 on a value with the top bit set never reaches 0 (sign fill) — use unsigned shifts or the n & (n − 1) trick.',
  backend: {
    title: 'Counting granted permissions / feature flags in a bitmask',
    detail:
      'Auth services pack a user\'s permissions (read, write, admin…) or a tenant\'s enabled feature flags into an integer bitmask. Counting how many are set (for quotas, audits, or "how many replicas hold this block" in a bitmap index) is popcount — databases like Redis BITCOUNT and Roaring bitmaps do exactly this.',
  },
  complexity: { time: 'O(number of 1 bits) ≤ O(32)', space: 'O(1)' },
  code: `
def hammingWeight(n):
    res = 0                     @init
    while n:                    @while
        n &= n - 1              @drop
        res += 1                @count
    return res                  @done
`,
  explain: {
    while: 'Each iteration removes one 1-bit, so the loop runs once per set bit.',
    drop: 'n − 1 turns the lowest 1 into 0 and the zeros below it into 1s; AND with n keeps everything above and clears that lowest 1.',
    count: 'We just removed one set bit — count it.',
  },
  distractors: [
    { text: '        n &= n + 1', why: 'n + 1 changes the lowest ZERO bit; n & (n + 1) clears trailing ones instead of one set bit.' },
    { text: '        n ^= n - 1', why: 'XOR keeps the flipped region (lowest 1 and the zeros below), not the rest of n — the loop never shrinks n properly.' },
    { text: '    while n > 1:', why: 'Stops one bit early: n = 1 still has a set bit to count.' },
  ],
  input: { n: 44 },
  presets: [
    { label: 'zero', input: { n: 0 } },
    { label: 'power of two', input: { n: 128 } },
    { label: '32-bit, many ones', input: { n: 4294967293 } },
  ],
  validate: ({ n }) => (!isInt(n) ? 'Expected { n: integer }' : n < 0 || n > 4294967295 ? 'n must be an unsigned 32-bit integer (0 … 4294967295)' : null),
  trace(t, { n: input }) {
    const width = widthFor(input);
    let n = input;
    let res = 0;
    let phase: 'idle' | 'look' | 'drop' = 'idle';
    let before = n;
    let predicts = 0;
    t.draw(() => {
      const rows: { label: string; value: number; tones?: Record<number, Tone> }[] = [];
      if (phase === 'look' && n) {
        const lb = lowBit(n);
        const flip: Record<number, Tone> = {};
        for (let b = 0; b <= lb; b++) flip[b] = 'warn';
        rows.push({ label: `n = ${n}`, value: u32(n), tones: { [lb]: 'active' } });
        rows.push({ label: `n − 1 = ${n - 1}`, value: u32(n - 1), tones: flip });
      } else if (phase === 'drop') {
        const lb = lowBit(before);
        rows.push({ label: `n (before) = ${before}`, value: u32(before), tones: { [lb]: 'active' } });
        rows.push({ label: `n − 1 = ${before - 1}`, value: u32(before - 1), tones: { [lb]: 'warn' } });
        rows.push({ label: `n & (n − 1) = ${n}`, value: u32(n), tones: { [lb]: 'bad' } });
      } else rows.push({ label: `n = ${n}`, value: u32(n), tones: setBits(n, 'info', width) });
      return [V.bits('bits', rows, { width, caption: 'active = lowest set bit; orange = bits flipped by −1' }), V.chips('res', [res])];
    });
    t.step('init', `res = 0. n = ${n} has ${width <= 8 ? 'an 8' : width <= 16 ? 'a 16' : 'a 32'}-bit view.`, { n, res });
    for (let guard = 0; guard < 33; guard++) {
      phase = n ? 'look' : 'idle';
      t.step('while', n ? `n = ${n} ≠ 0: there is at least one set bit left. Lowest is bit ${lowBit(n)}.` : 'n = 0: no set bits remain.', { n, res });
      if (!n) break;
      if (predicts < 2) {
        predicts++;
        const lb = lowBit(n);
        const hb = 31 - Math.clz32(n);
        const o = opts(`bit ${lb}`, `bit ${hb}`, 'bit 0', `bit ${lb + 1}`);
        t.predict('Which bit will n & (n − 1) clear?', o.options, o.answer, `n − 1 borrows from the lowest 1 (bit ${lb}); every bit above it is unchanged, so AND clears only bit ${lb}.`);
      }
      before = n;
      n = u32(n & (n - 1));
      phase = 'drop';
      t.step('drop', `${before} & ${before - 1} = ${n}: bit ${lowBit(before)} is cleared, everything above it survives.`, { n });
      res++;
      t.step('count', `One set bit removed → res = ${res}.`, { res });
    }
    phase = 'idle';
    t.step('done', `${input} has ${res} set bit(s).`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const countingBits: Problem<{ n: number }> = {
  id: 'counting-bits',
  num: 338,
  title: 'Counting Bits',
  difficulty: 'Easy',
  category: 'bit-manipulation',
  pattern: 'bits',
  statement: 'For every integer i from 0 to n, report how many 1-bits i has, in a single O(n) pass.',
  signals: ['answer for EVERY number 0…n', 'O(n) — so no per-number popcount loop', 'result for i reuses a smaller number', 'powers of two'],
  insight:
    'Strip i\'s highest set bit (the largest power of two ≤ i, called offset): the remainder i − offset is smaller and already solved. So dp[i] = 1 + dp[i − offset].',
  hints: [
    'Look at 4…7 in binary next to 0…3. What do you notice?',
    'Numbers in [2ᵏ, 2ᵏ⁺¹) are 2ᵏ plus a number you have already solved.',
    'Track offset = largest power of two ≤ i (double it when i reaches 2·offset); dp[i] = 1 + dp[i − offset].',
  ],
  pitfall: 'Updating offset with a check like i % offset == 0 (true for many non-powers) instead of offset * 2 == i.',
  backend: {
    title: 'Precomputed popcount lookup tables',
    detail:
      'Bitmap indexes and network ACL engines precompute a popcount table for every byte (0…255) once at startup and then count set bits of large bitmaps a byte at a time. Building that table with dp[i] = 1 + dp[i − offset] is exactly this problem.',
  },
  complexity: { time: 'O(n)', space: 'O(n) output' },
  code: `
def countBits(n):
    dp = [0] * (n + 1)                  @init
    offset = 1                          @offset
    for i in range(1, n + 1):           @loop
        if offset * 2 == i:             @check
            offset = i                  @bump
        dp[i] = 1 + dp[i - offset]      @dp
    return dp                           @done
`,
  explain: {
    offset: 'The highest power of two ≤ i — i.e. i\'s leading 1-bit.',
    check: 'Reaching the next power of two means i has a new, higher leading bit.',
    dp: 'i = offset + (i − offset): one bit for offset, plus the bits of the smaller remainder (already computed).',
  },
  distractors: [
    { text: '        dp[i] = dp[i - offset]', why: 'Forgets to count the leading bit (offset itself) — every answer comes out one too small.' },
    { text: '        if i % offset == 0:', why: 'True for many non-powers (e.g. 6 % 2), so offset jumps to the wrong value.' },
    { text: '        dp[i] = 1 + dp[i - 1]', why: 'i − 1 is not i with a bit removed (e.g. 4 = 100 vs 3 = 011).' },
  ],
  input: { n: 8 },
  presets: [
    { label: 'n = 0', input: { n: 0 } },
    { label: 'n = 15', input: { n: 15 } },
  ],
  validate: ({ n }) => (!isInt(n) ? 'Expected { n: integer }' : n < 0 || n > 20 ? 'Use 0 ≤ n ≤ 20' : null),
  trace(t, { n }) {
    const dp = Array.from({ length: n + 1 }, () => 0);
    let offset = 1;
    let i = -1;
    let filled = 0;
    let predicts = 0;
    t.draw(() => {
      const ob = 31 - Math.clz32(offset);
      const rows: { label: string; value: number; tones?: Record<number, Tone> }[] = [];
      if (i >= 1) {
        rows.push({ label: `i = ${i}`, value: i, tones: { ...setBits(i - offset, 'info', 8), [ob]: 'active' } });
        rows.push({ label: `offset = ${offset}`, value: offset, tones: { [ob]: 'active' } });
        if (i - offset >= 0) rows.push({ label: `i − offset = ${i - offset}`, value: i - offset, tones: setBits(i - offset, 'info', 8) });
      }
      const tn: Record<number, Tone> = {};
      for (let k = 0; k <= filled; k++) tn[k] = 'good';
      if (i >= 1 && i - offset >= 0) tn[i - offset] = 'info';
      if (i >= 1) tn[i] = 'active';
      return [
        i >= 1 && V.bits('i = offset + (i − offset)', rows, { width: 8, caption: 'active = leading bit (offset), blue = bits already counted in dp[i − offset]' }),
        V.array('dp (set bits of i)', dp, { pointers: i >= 1 ? { i, 'i-offset': i - offset } : {}, tones: tn }),
      ];
    });
    t.step('init', `dp has n + 1 = ${n + 1} slots; dp[0] = 0 (no bits).`, { n });
    t.step('offset', 'offset = 1: the largest power of two ≤ 1.', { offset });
    for (i = 1; i <= n; i++) {
      t.step('loop', `i = ${i} (binary ${i.toString(2)}).`, { i, offset });
      const bump = offset * 2 === i;
      if (predicts < 1 && i >= 3 && (i & (i - 1)) === 0) {
        predicts++;
        t.predict(`i = ${i}, offset = ${offset}. Does offset change?`, ['Yes — offset becomes i', 'No'], bump ? 0 : 1, bump ? `${i} = 2 × ${offset} is a new power of two: its leading bit moved up.` : `${i} < ${offset * 2}, so its leading bit is still ${offset}.`);
      }
      t.step('check', bump ? `${offset} × 2 == ${i}: i is a power of two — new leading bit.` : `${offset} × 2 ≠ ${i}: same leading bit (${offset}) as before.`, { i, offset });
      if (bump) {
        offset = i;
        t.step('bump', `offset = ${offset}.`, { offset });
      }
      const v = 1 + dp[i - offset];
      if (predicts < 3 && i >= 5 && (i & (i - 1)) !== 0) {
        predicts++;
        const o = opts(String(v), String(dp[i - 1] + 1), String(dp[i - offset]));
        t.predict(`dp[${i}] = 1 + dp[${i} − ${offset}] = ?`, o.options, o.answer, `${i} = ${offset} + ${i - offset}; dp[${i - offset}] = ${dp[i - offset]}, plus the leading bit → ${v}.`);
      }
      dp[i] = v;
      filled = i;
      t.step('dp', `dp[${i}] = 1 + dp[${i - offset}] = 1 + ${dp[i - offset]} = ${v}.`, { i, offset, 'dp[i]': v });
    }
    i = -1;
    t.step('done', `dp = [${dp.join(', ')}].`, { result: dp });
    return dp;
  },
};

// ---------------------------------------------------------------------------

const reverseBits: Problem<{ n: number }> = {
  id: 'reverse-bits',
  num: 190,
  title: 'Reverse Bits',
  difficulty: 'Easy',
  category: 'bit-manipulation',
  pattern: 'bits',
  statement: 'Treat the input as an unsigned 32-bit integer and return the unsigned integer whose bits are in the opposite order (bit 0 ↔ bit 31, bit 1 ↔ bit 30, …).',
  signals: ['fixed width "32 bits"', 'mirror positions i ↔ 31 − i', 'unsigned integer', 'extract and place individual bits'],
  insight: 'Read bit i with (n >> i) & 1 and write it at position 31 − i with OR. Doing it for all 32 positions mirrors the number.',
  hints: [
    'How do you read bit i of n?',
    'Where should bit i end up in the result?',
    'for i in 0..31: bit = (n >> i) & 1; res |= bit << (31 − i).',
  ],
  pitfall: 'Looping only while n > 0 — leading zeros must still be mirrored into the low end, so always do all 32 positions. In JS/Java, finish with >>> 0 (or mask) so bit 31 does not make the result negative.',
  backend: {
    title: 'Bit-reversed keys for even sharding and FFT-style indexing',
    detail:
      'Some systems (e.g. Bigtable/HBase key design, and Snowflake-style IDs) reverse the bits of a sequential ID so that consecutive writes spread across shards instead of hammering the same tablet. Bit-reversal is also how FFT and some network checksum (CRC "reflected") implementations order their data.',
  },
  complexity: { time: 'O(32)', space: 'O(1)' },
  code: `
def reverseBits(n):
    res = 0                                 @init
    for i in range(32):                     @loop
        bit = (n >> i) & 1                  @bit
        res = res | (bit << (31 - i))       @place
    return res                              @done
`,
  explain: {
    bit: 'Shift bit i down to position 0 and mask everything else off.',
    place: 'Mirror position: bit i of n becomes bit 31 − i of res. OR keeps the bits placed earlier.',
    done: 'In Python ints are unbounded so res is already unsigned; in JS use res >>> 0.',
  },
  distractors: [
    { text: '    while n:', why: 'Stops at the highest set bit, so leading zeros are never mirrored and the result is shifted wrong.' },
    { text: '        res = res | (bit << i)', why: 'Puts every bit back where it came from — that copies n instead of reversing it.' },
    { text: '        bit = n & (1 << 31 - i)', why: 'Leaves the bit at its original position (not 0/1), so shifting it again lands in the wrong place.' },
  ],
  input: { n: 43261596 },
  presets: [
    { label: 'one', input: { n: 1 } },
    { label: 'top bit set', input: { n: 4294967293 } },
  ],
  validate: ({ n }) => (!isInt(n) ? 'Expected { n: integer }' : n < 0 || n > 4294967295 ? 'n must be an unsigned 32-bit integer (0 … 4294967295)' : null),
  trace(t, { n }) {
    let res = 0;
    let i = -1;
    let bit = 0;
    let predicts = 0;
    t.draw(() => [
      V.bits('mirror', [
        { label: `n = ${n}`, value: u32(n), tones: i >= 0 && i < 32 ? { [i]: 'active' } : {} },
        { label: `res = ${u32(res)}`, value: u32(res), tones: i >= 0 && i < 32 ? { [31 - i]: bit ? 'good' : 'muted' } : {} },
      ], { width: 32, caption: 'bit i of n (active) is copied to bit 31 − i of res' }),
    ]);
    t.step('init', `res = 0. n = ${n} = ${u32(n).toString(2).padStart(32, '0')}.`, { n, res });
    for (i = 0; i < 32; i++) {
      bit = 0;
      t.step('loop', `i = ${i}: read bit ${i}, write bit ${31 - i}.`, { i });
      if (predicts < 1) {
        predicts++;
        const o = opts(String(31 - i), String(i), String(32 - i), String(30 - i));
        t.predict(`Bit ${i} of n will be written to which position of res?`, o.options, o.answer, `Positions mirror around the middle: i ↔ 31 − i, so ${i} ↔ ${31 - i}.`);
      }
      bit = (n >>> i) & 1;
      t.step('bit', `(n >> ${i}) & 1 = ${bit}.`, { i, bit });
      if (predicts < 3 && i >= 2 && bit === 1) {
        predicts++;
        const nv = u32(res | (bit << (31 - i)));
        const o = opts(String(nv), String(u32(res)), String(u32(res | (1 << i))));
        t.predict(`bit = 1. What is res after placing it at ${31 - i}?`, o.options, o.answer, `OR with 1 << ${31 - i} = ${u32(1 << (31 - i))} → ${nv}.`);
      }
      res = u32(res | (bit << (31 - i)));
      t.step('place', bit ? `Set bit ${31 - i} of res → res = ${res}.` : `bit is 0 — res stays ${res} (bit ${31 - i} remains 0).`, { i, bit, res });
    }
    i = -1;
    t.step('done', `Reversed: ${res} (${res.toString(2).padStart(32, '0')}).`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const missingNumber: Problem<{ nums: number[] }> = {
  id: 'missing-number',
  num: 268,
  title: 'Missing Number',
  difficulty: 'Easy',
  category: 'bit-manipulation',
  pattern: 'bits',
  statement: 'An array holds n distinct numbers taken from 0…n, so exactly one value in that range is absent. Find it in O(n) time and O(1) extra space.',
  signals: ['values are exactly the range 0…n minus one', 'distinct', 'O(1) extra space', 'indices 0…n−1 line up with values'],
  insight: 'XOR every index 0…n and every value together. Each present value meets its equal index and cancels; the missing one has no partner and survives.',
  hints: [
    'If nothing were missing, the values would be exactly the indices 0…n−1 plus n.',
    'Which operation cancels equal numbers regardless of order?',
    'res = n; for i: res ^= i ^ nums[i].',
  ],
  pitfall: 'Starting res at 0 instead of n: the index range 0…n−1 never includes n, so n itself would be reported "missing" (or cancel wrongly).',
  backend: {
    title: 'Detecting a lost sequence number in a replication stream',
    detail:
      'A replica receives a batch that should contain sequence numbers base…base+n with exactly one gap (e.g. a dropped WAL record or TCP segment). XORing expected and received numbers finds the gap in one pass with constant memory — no need to sort or keep a bitmap of the batch.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def missingNumber(nums):
    res = len(nums)                     @init
    for i in range(len(nums)):          @loop
        res ^= i ^ nums[i]              @xor
    return res                          @done
`,
  explain: {
    init: 'Seed with n: indices only go up to n − 1, so n needs to be included explicitly.',
    xor: 'Mix in both the index (expected) and the value (actual). Matching pairs cancel.',
    done: 'Only the number with no partner remains.',
  },
  distractors: [
    { text: '    res = 0', why: 'Indices cover 0…n−1 only; without seeding n the full range 0…n is never XORed.' },
    { text: '        res ^= nums[i]', why: 'Only XORs the values — nothing to cancel against, so you get the XOR of all values, not the missing one.' },
    { text: '        res += i - nums[i]', why: 'This is the sum-difference approach (also valid) — but mixing it with res ^= elsewhere breaks both.' },
  ],
  input: { nums: [3, 0, 1, 5, 2] },
  presets: [
    { label: 'missing 0', input: { nums: [1, 2, 3] } },
    { label: 'missing n', input: { nums: [0, 1] } },
    { label: 'longer', input: { nums: [9, 6, 4, 2, 3, 5, 7, 0, 1] } },
  ],
  validate: ({ nums }) => {
    if (!Array.isArray(nums) || !nums.every(isInt)) return 'Expected { nums: integer[] }';
    if (!nums.length || nums.length > 15) return 'Use 1–15 numbers';
    if (new Set(nums).size !== nums.length || nums.some((x) => x < 0 || x > nums.length)) return `Values must be distinct and in 0…${nums.length}`;
    return null;
  },
  trace(t, { nums }) {
    const n = nums.length;
    const width = widthFor(n);
    let res = n;
    let i = -1;
    let prev: number | null = null;
    let predicts = 0;
    t.draw(() => {
      const rows: { label: string; value: number; tones?: Record<number, Tone> }[] = [];
      if (prev !== null && i >= 0) {
        rows.push({ label: `res (before) = ${prev}`, value: prev });
        rows.push({ label: `i = ${i}`, value: i, tones: setBits(i, 'info', width) });
        rows.push({ label: `nums[i] = ${nums[i]}`, value: nums[i], tones: setBits(nums[i], 'active', width) });
        rows.push({ label: `res = ${res}`, value: res, tones: setBits(res, 'good', width) });
      } else {
        rows.push({ label: `res = ${res}`, value: res, tones: setBits(res, 'good', width) });
        if (i >= 0) {
          rows.push({ label: `i = ${i}`, value: i, tones: setBits(i, 'info', width) });
          rows.push({ label: `nums[i] = ${nums[i]}`, value: nums[i], tones: setBits(nums[i], 'active', width) });
        }
      }
      return [V.array('nums', nums, { pointers: { i } }), V.bits('bits', rows, { width })];
    });
    t.step('init', `res = len(nums) = ${n}: the one index-range value (n) the loop will never produce.`, { res });
    for (i = 0; i < n; i++) {
      prev = null;
      t.step('loop', `i = ${i}, nums[i] = ${nums[i]}.`, { i, 'nums[i]': nums[i], res });
      const next = res ^ i ^ nums[i];
      if (predicts < 1 || (predicts < 2 && i === n - 1)) {
        predicts++;
        const o = opts(String(next), String(res ^ nums[i]), String(res ^ i), String(res + i - nums[i]));
        t.predict(i === n - 1 ? `Last step: res ^ ${i} ^ ${nums[i]} = ? (this is the missing number)` : `What is res after res ^= ${i} ^ ${nums[i]}?`, o.options, o.answer, `${res} ^ ${i} ^ ${nums[i]} = ${next}.`);
      }
      prev = res;
      res = next;
      t.step('xor', `res = ${prev} ^ ${i} ^ ${nums[i]} = ${res}. Index ${i} and value ${nums[i]} are now both mixed in; any value that also appears as an index cancels.`, { i, res });
    }
    i = -1;
    prev = null;
    t.step('done', `Every present value cancelled with its matching index; ${res} had no partner → missing.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const sumTwoIntegers: Problem<{ a: number; b: number }> = {
  id: 'sum-of-two-integers',
  num: 371,
  title: 'Sum of Two Integers',
  difficulty: 'Medium',
  category: 'bit-manipulation',
  pattern: 'bits',
  statement: 'Add two 32-bit signed integers without using the + or − operators.',
  signals: ['"without + or −"', 'must think like a hardware adder', '32-bit signed result', 'carry propagation'],
  insight:
    'XOR adds bits without carrying; AND finds where both bits are 1, i.e. where a carry is produced, and << 1 moves each carry into the next column. Repeat (sum = a ^ b, carry = (a & b) << 1) until no carry is left.',
  hints: [
    'Add two single bits: which operation gives the sum bit? Which gives the carry?',
    'a ^ b is the sum ignoring carries; (a & b) << 1 is the carries, shifted into place.',
    'Loop while b != 0: carry = (a & b) << 1; a = a ^ b; b = carry. Mask to 32 bits in Python.',
  ],
  pitfall: 'In Python, ints are unbounded, so a negative operand makes the carry loop run forever — mask with 0xFFFFFFFF each step and convert back to signed at the end.',
  backend: {
    title: 'Understanding overflow in counters and checksums',
    detail:
      'Ones\'-complement Internet checksums (IP/TCP/UDP headers) and wrapping 32-bit counters in metrics systems (SNMP counters, Prometheus rate() over resets) are built on fixed-width carry arithmetic. Knowing how carries propagate and wrap at 32 bits is what lets you compute deltas correctly when a counter rolls over.',
  },
  complexity: { time: 'O(32)', space: 'O(1)' },
  code: `
def getSum(a, b):
    MASK, MAX = 0xFFFFFFFF, 0x7FFFFFFF          @init
    while b != 0:                               @while
        carry = ((a & b) << 1) & MASK           @carry
        a = (a ^ b) & MASK                      @xor
        b = carry                               @shift
    return a if a <= MAX else ~(a ^ MASK)       @done
`,
  explain: {
    init: 'Python ints are unbounded; MASK keeps everything to 32 bits like hardware registers.',
    carry: 'Columns where both bits are 1 produce a carry into the next column (hence << 1).',
    xor: 'Column-wise sum with no carries.',
    shift: 'The carries still need to be added — that is the next round\'s b.',
    done: 'If bit 31 is set the 32-bit pattern is negative; ~(a ^ MASK) turns it back into a Python negative int.',
  },
  distractors: [
    { text: '        carry = (a & b) >> 1', why: 'Carries move to the NEXT HIGHER column: shift left, not right.' },
    { text: '        a = (a | b) & MASK', why: 'OR treats 1 + 1 as 1; the column sum without carry is XOR (1 ^ 1 = 0).' },
    { text: '        b = carry\n        a = (a ^ b) & MASK', why: 'Updating b before computing a ^ b uses the new carry instead of the old b — the order matters.' },
  ],
  input: { a: 9, b: 11 },
  presets: [
    { label: 'no carries', input: { a: 5, b: 2 } },
    { label: 'negative + positive', input: { a: -2, b: 3 } },
  ],
  validate: ({ a, b }) => (!isInt(a) || !isInt(b) ? 'Expected { a: integer, b: integer }' : Math.abs(a) > 1000 || Math.abs(b) > 1000 ? 'Use −1000 ≤ a, b ≤ 1000' : null),
  trace(t, { a: a0, b: b0 }) {
    const width = a0 >= 0 && b0 >= 0 && a0 + b0 <= 255 ? 8 : 32;
    let a = u32(a0);
    let b = u32(b0);
    let carry: number | null = null;
    let sum: number | null = null;
    let prevA = a;
    let prevB = b;
    let predicts = 0;
    t.draw(() => {
      const both = u32(prevA & prevB);
      const rows: { label: string; value: number; tones?: Record<number, Tone> }[] = [
        { label: `a = ${prevA | 0}`, value: prevA, tones: { ...setBits(prevA, 'info', width), ...setBits(both, 'warn', width) } },
        { label: `b = ${prevB | 0}`, value: prevB, tones: { ...setBits(prevB, 'info', width), ...setBits(both, 'warn', width) } },
      ];
      if (carry !== null) rows.push({ label: `carry = (a & b) << 1 = ${carry | 0}`, value: carry, tones: setBits(carry, 'active', width) });
      if (sum !== null) rows.push({ label: `a ^ b = ${sum | 0}`, value: sum, tones: setBits(sum, 'good', width) });
      return [V.bits('adder', rows, { width, caption: 'orange = columns where both bits are 1 → produce a carry' })];
    });
    t.step('init', `a = ${a0}, b = ${b0}. All values are kept to 32 bits${width === 8 ? ' (shown as 8 since they are small)' : ''}.`, { a: a0, b: b0 });
    for (let guard = 0; guard < 34; guard++) {
      prevA = a;
      prevB = b;
      carry = sum = null;
      t.step('while', b ? `b = ${b | 0} ≠ 0: there are still carries to add.` : 'b = 0: nothing left to add.', { a: a | 0, b: b | 0 });
      if (!b) break;
      const c = u32((a & b) << 1);
      carry = c;
      t.step('carry', `a & b marks columns where both bits are 1 (${u32(a & b) | 0}); shifted left they carry into the next column: ${c | 0}.`, { carry: c | 0 });
      const s = u32(a ^ b);
      if (predicts < 1) {
        predicts++;
        const o = opts(String(s | 0), String(u32(a | b) | 0), String(u32(a & b) | 0));
        t.predict(`What is a ^ b (the sum ignoring carries)?`, o.options, o.answer, `XOR keeps columns where exactly one bit is 1: ${a | 0} ^ ${b | 0} = ${s | 0}.`);
      }
      sum = s;
      a = s;
      t.step('xor', `a = a ^ b = ${a | 0}: the column sums with no carries.`, { a: a | 0, carry: c | 0 });
      b = c;
      if (predicts < 3) {
        predicts++;
        t.predict('After b = carry, will the loop run again?', ['Yes', 'No'], b ? 0 : 1, b ? `carry = ${b | 0} is not zero — those carries still have to be added to a.` : 'No column produced a carry, so a already holds the full sum.');
      }
      t.step('shift', `b = carry = ${b | 0}: next round adds the carries into a.`, { a: a | 0, b: b | 0 });
    }
    const res = a | 0;
    t.step('done', a > 0x7fffffff ? `Bit 31 is set → negative in 32-bit: result ${res}.` : `Result: ${res}.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

const reverseInteger: Problem<{ x: number }> = {
  id: 'reverse-integer',
  num: 7,
  title: 'Reverse Integer',
  difficulty: 'Medium',
  category: 'bit-manipulation',
  pattern: 'bits',
  statement: 'Reverse the decimal digits of a 32-bit signed integer (keeping its sign). If the reversed value falls outside the 32-bit signed range, return 0 — and assume you cannot store 64-bit numbers.',
  signals: ['"32-bit signed integer"', '"return 0 on overflow"', 'cannot use 64-bit storage', 'pop/push digits with % 10 and / 10'],
  insight:
    'Pop the last digit with x % 10 and push it onto res with res * 10 + digit. The only hard part is checking BEFORE the multiply whether res * 10 + digit would leave [−2³¹, 2³¹ − 1], by comparing res with MAX // 10.',
  hints: [
    'How do you take the last digit off a number, and how do you append a digit to another?',
    'res * 10 + digit can overflow. What must res be for that not to happen?',
    'Before pushing: overflow if res > MAX // 10, or res == MAX // 10 and digit > 7 (mirror for negatives with −8).',
  ],
  pitfall: 'Checking for overflow AFTER computing res * 10 + digit — in a real 32-bit register the value has already wrapped. Also Python\'s % and // floor negatives; use fmod / int(x / 10) to truncate toward zero.',
  backend: {
    title: 'Safe parsing of numeric IDs and headers',
    detail:
      'Parsers for Content-Length headers, protobuf varints or numeric IDs in an API must detect overflow before it happens (a wrapped length is a classic request-smuggling bug). The "compare with MAX // 10 before multiplying" guard is exactly how Go\'s strconv and Java\'s Integer.parseInt reject out-of-range input.',
  },
  complexity: { time: 'O(log₁₀ x)', space: 'O(1)' },
  code: `
def reverse(x):
    MAX, MIN = 2**31 - 1, -2**31                    @init
    res = 0                                         @res
    while x:                                        @while
        digit = int(math.fmod(x, 10))               @digit
        x = int(x / 10)                             @shrink
        if res > MAX // 10 or (res == MAX // 10 and digit > MAX % 10):              @ovHi
            return 0                                @zeroHi
        if res < int(MIN / 10) or (res == int(MIN / 10) and digit < math.fmod(MIN, 10)):  @ovLo
            return 0                                @zeroLo
        res = res * 10 + digit                      @push
    return res                                      @done
`,
  explain: {
    digit: 'fmod keeps the sign of x, so −123 yields −3 (Python % would give 7).',
    shrink: 'int(x / 10) truncates toward zero for negatives too.',
    ovHi: 'res * 10 + digit > MAX exactly when res > 214748364, or res == 214748364 and digit > 7.',
    ovLo: 'Mirror check against MIN: −214748364 and last digit −8.',
    push: 'Safe now — append the digit.',
  },
  distractors: [
    { text: '        digit = x % 10', why: 'Python % floors: −123 % 10 = 7, so negative numbers produce wrong digits.' },
    { text: '        res = res * 10 + digit\n        if res > MAX: return 0', why: 'Checks after the multiply — with true 32-bit ints the value has already overflowed and wrapped.' },
    { text: '        x = x // 10', why: '// floors negatives (−123 // 10 = −13), so the loop never reaches 0 for negative x.' },
  ],
  input: { x: 123 },
  presets: [
    { label: 'negative with trailing zero', input: { x: -120 } },
    { label: 'overflows', input: { x: 1534236469 } },
  ],
  validate: ({ x }) => (!isInt(x) ? 'Expected { x: integer }' : x < INT_MIN || x > INT_MAX ? 'x must be a 32-bit signed integer' : null),
  trace(t, { x: x0 }) {
    let x = x0;
    let res = 0;
    let digit: number | null = null;
    let state: Tone | null = null;
    let predicts = 0;
    const HI = Math.trunc(INT_MAX / 10);
    const LO = Math.trunc(INT_MIN / 10);
    t.draw(() => {
      const xs = String(x);
      const rs = String(res);
      return [
        V.text('x', xs, { tones: x !== 0 && digit === null ? { [xs.length - 1]: 'active' } : {} }),
        V.chips('digit', digit === null ? [] : [digit], { tones: { 0: state ?? 'active' } }),
        V.text('res', rs, { tones: res !== 0 ? { [rs.length - 1]: 'good' } : {} }),
        V.bits('res as a 32-bit signed int', [
          { label: `res = ${res}`, value: u32(res), tones: { 31: res < 0 ? 'warn' : 'muted', ...setBits(res >= 0 ? res : 0, 'info', 31) } },
          { label: `MAX // 10 = ${HI}`, value: HI },
        ], { width: 32, caption: 'bit 31 is the sign bit; the guard stops res × 10 + digit from spilling past 31 bits' }),
      ];
    });
    t.step('init', `32-bit range: [${INT_MIN}, ${INT_MAX}].`, { x });
    t.step('res', 'res = 0; digits will be appended to it one at a time.', { res });
    for (let guard = 0; guard < 12; guard++) {
      digit = null;
      state = null;
      t.step('while', x ? `x = ${x} ≠ 0: more digits to move.` : 'x = 0: every digit has been moved.', { x, res });
      if (!x) break;
      const d = x % 10;
      if (predicts < 1) {
        predicts++;
        const o = opts(String(d), String(Number(String(Math.abs(x))[0]) * Math.sign(x)), String(Math.abs(d)=== d ? d + 1 : d - 1));
        t.predict(`Which digit does math.fmod(${x}, 10) pop?`, o.options, o.answer, `The LAST digit, carrying x's sign: ${d}.`);
      }
      digit = d;
      t.step('digit', `digit = fmod(${x}, 10) = ${d} (the last digit, same sign as x).`, { digit: d });
      x = Math.trunc(x / 10);
      t.step('shrink', `x = int(x / 10) = ${x}: that digit is removed.`, { x });
      const hi = res > HI || (res === HI && d > 7);
      if (predicts < 3 && (hi || (res !== 0 && predicts === 1))) {
        predicts++;
        t.predict(`res = ${res}, digit = ${d}. Would res × 10 + digit leave the 32-bit range?`, ['Yes → return 0', 'No → safe to push'], hi ? 0 : 1, hi ? `${res} ${res > HI ? '>' : '=='} ${HI}${res === HI ? ` and ${d} > 7` : ''}: the next value would exceed ${INT_MAX}.` : `${res} < ${HI}, so res × 10 + digit stays below ${INT_MAX}.`);
      }
      if (hi) {
        state = 'bad';
        t.step('ovHi', `${res} ${res > HI ? `> ${HI}` : `== ${HI} and ${d} > 7`}: res × 10 + ${d} would exceed ${INT_MAX}.`, { res, digit: d });
        t.step('zeroHi', 'Overflow → return 0.', { result: 0 });
        return 0;
      }
      t.step('ovHi', `${res} ≤ ${HI}${res === HI ? ' and digit ≤ 7' : ''}: no overflow above.`, { res, digit: d });
      const lo = res < LO || (res === LO && d < -8);
      if (lo) {
        state = 'bad';
        t.step('ovLo', `res × 10 + ${d} would go below ${INT_MIN}.`, { res, digit: d });
        t.step('zeroLo', 'Underflow → return 0.', { result: 0 });
        return 0;
      }
      t.step('ovLo', `${res} ≥ ${LO}: no overflow below.`, { res, digit: d });
      res = res * 10 + d;
      state = 'good';
      t.step('push', `res = res × 10 + ${d} = ${res}.`, { res });
    }
    digit = null;
    t.step('done', `Reversed value: ${res}.`, { result: res });
    return res;
  },
};

export const problems: Problem[] = [singleNumber, hammingWeight, countingBits, reverseBits, missingNumber, sumTwoIntegers, reverseInteger];

export const variants: Variant[] = [
  {
    id: 'two-unpaired-ids',
    title: 'Two unpaired request IDs',
    statement:
      'Every request ID in a log appears exactly twice (start and end) except two IDs whose end entries are missing. Find both IDs using O(1) extra space.',
    pattern: 'bits',
    nearest: 'single-number',
    signals: ['"appears twice except…"', 'O(1) space', 'two survivors instead of one'],
    approach: 'XOR everything → x = a ^ b (non-zero). Pick any set bit of x (x & −x); it differs between a and b. Split all IDs by that bit and XOR each group separately to get a and b.',
    backend: 'Finding the two requests that never completed in a start/end trace log, without building a hash set of millions of span IDs.',
  },
  {
    id: 'permission-distance',
    title: 'How different are two permission masks?',
    statement:
      'Roles are stored as 32-bit permission bitmasks. Given two roles, return how many individual permissions differ between them.',
    pattern: 'bits',
    nearest: 'number-of-1-bits',
    signals: ['bitmask flags', '"how many bits differ"', 'fixed width integers'],
    approach: 'x = a ^ b marks exactly the differing bits; count them with the n & (n − 1) loop (Hamming distance).',
    backend: 'Access-review tooling that flags role changes touching more than k permissions, or comparing feature-flag masks between environments.',
  },
  {
    id: 'power-of-two-buffer',
    title: 'Round a buffer size up to a power of two',
    statement:
      'Given a requested buffer size n (1 ≤ n ≤ 2³⁰), return the smallest power of two ≥ n using only bit operations.',
    pattern: 'bits',
    nearest: 'counting-bits',
    signals: ['"power of two"', 'leading set bit', 'no loops over values / no floating log'],
    approach: 'n −= 1, then smear the highest set bit right: n |= n >> 1, >> 2, >> 4, >> 8, >> 16; return n + 1. (Or check n & (n − 1) == 0 first.)',
    backend: 'Sizing ring buffers and hash-table capacities (Netty, Java HashMap) so index = hash & (cap − 1) replaces an expensive modulo.',
  },
];
