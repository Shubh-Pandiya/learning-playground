import type { Problem, Tone, Variant } from '../engine/types.ts';
import type { Tracer } from '../engine/tracer.ts';
import { V, tones } from '../engine/tracer.ts';

/** Attach a prediction whose options are de-duplicated and ordered deterministically. */
function ask(t: Tracer, question: string, correct: string, wrong: string[], why: string) {
  const options = [...new Set([correct, ...wrong])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  t.predict(question, options, options.indexOf(correct), why);
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);

/** Tones that grey out everything left of the window (already slid past). */
const passed = (l: number): Record<number, Tone> => tones(range(0, Math.max(0, l)), 'muted');

const bestTime: Problem<{ prices: number[] }> = {
  id: 'best-time-to-buy-and-sell-stock',
  num: 121,
  title: 'Best Time to Buy and Sell Stock',
  difficulty: 'Easy',
  category: 'sliding-window',
  pattern: 'sliding-window',
  statement: 'Given daily prices, choose one day to buy and a LATER day to sell to maximise profit. Return the best profit, or 0 if no profitable trade exists.',
  signals: ['"buy before sell" → ordered pair (i < j)', 'maximise a later value minus an earlier one', 'one pass, O(1) space'],
  insight:
    'The best sell for day r always pairs with the cheapest day before it. Keep l on the lowest price seen; when a new low appears at r, jump l there — no earlier day can ever beat it.',
  hints: [
    'Checking every buy/sell pair is O(n²). For a fixed sell day, which buy day is best?',
    'Track the minimum price so far.',
    'Window [l, r]: if prices[r] < prices[l], move l to r; otherwise compute the profit.',
  ],
  pitfall: 'Using the global minimum even when it comes AFTER the maximum (selling before buying).',
  backend: {
    title: 'Worst latency regression in a metrics stream',
    detail:
      'A Prometheus-style alert wants the largest increase of p99 latency from any earlier point to a later one in the last day. Keeping the lowest value seen so far (l) and comparing each new sample (r) finds the biggest rise in one streaming pass with O(1) state — no need to store or sort the series.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def maxProfit(prices):
    l, r = 0, 1                                        @init
    maxP = 0                                           @zero
    while r < len(prices):                             @loop
        if prices[l] < prices[r]:                      @cmp
            maxP = max(maxP, prices[r] - prices[l])    @profit
        else:
            l = r                                      @jump
        r += 1                                         @next
    return maxP                                        @done
`,
  explain: {
    init: 'l = buy day, r = sell day; selling must come after buying.',
    cmp: 'Is today a profitable sell given the cheapest buy so far?',
    jump: 'A new lowest price: every future sell is better off buying here, so the window restarts at r.',
    next: 'The sell day always advances.',
  },
  distractors: [
    { text: '    return max(prices) - min(prices)', why: 'The minimum may come after the maximum — you cannot sell before you buy.' },
    { text: '            l += 1', why: 'Moving l one step may leave it on a higher price; jump straight to the new low at r.' },
    { text: '    l, r = 0, 0', why: 'Buying and selling on the same day; r must start after l (harmless here but the window invariant is l < r).' },
  ],
  input: { prices: [7, 1, 5, 3, 6, 4] },
  presets: [
    { label: 'falling prices', input: { prices: [7, 6, 4, 3, 1] } },
    { label: 'new low later', input: { prices: [3, 8, 1, 4, 2, 9] } },
    { label: 'single day', input: { prices: [5] } },
  ],
  validate: ({ prices }) => (!Array.isArray(prices) || !prices.length ? 'Expected { prices: number[] } (non-empty)' : prices.length > 14 ? 'Keep prices ≤ 14 days' : null),
  trace(t, { prices }) {
    let l = 0;
    let r = 1;
    let maxP = 0;
    let best: number[] = [];
    t.draw(() => [
      V.array('prices', prices, {
        pointers: { buy: l, sell: r < prices.length ? r : null },
        window: r < prices.length ? [l, r] : null,
        tones: { ...passed(l), ...tones(best, 'good') },
        caption: best.length ? `best trade: buy day ${best[0]}, sell day ${best[1]}` : undefined,
      }),
    ]);
    t.step('init', 'Buy on day 0, first candidate sell day is day 1.', { l, r });
    t.step('zero', 'No profit yet.', { maxP });
    let askedJump = false;
    let askedProfit = false;
    for (;;) {
      t.step('loop', r < prices.length ? `Sell day r = ${r} (price ${prices[r]}).` : 'No more days.', { l, r, maxP });
      if (r >= prices.length) break;
      const up = prices[l] < prices[r];
      if ((up && !askedProfit) || (!up && !askedJump)) {
        if (up) askedProfit = true;
        else askedJump = true;
        t.predict(`Buy at ${prices[l]}, today is ${prices[r]}. What happens?`, ['record a profit', 'move buy day l to r'], up ? 0 : 1, up ? `${prices[r]} > ${prices[l]}: selling today is profitable, so check it against maxP.` : `${prices[r]} ≤ ${prices[l]}: today is a cheaper (or equal) buy — every later sell prefers it.`);
      }
      t.step('cmp', up ? `${prices[l]} < ${prices[r]}: selling today makes money.` : `${prices[r]} ≤ ${prices[l]}: no profit, but this is the cheapest day so far.`, { 'prices[l]': prices[l], 'prices[r]': prices[r] });
      if (up) {
        const p = prices[r] - prices[l];
        if (p > maxP) best = [l, r];
        maxP = Math.max(maxP, p);
        t.step('profit', `Profit ${prices[r]} − ${prices[l]} = ${p}; maxP = ${maxP}.`, { profit: p, maxP });
      } else {
        l = r;
        t.step('jump', `Move the buy day to ${l}: the window restarts at the new low ${prices[l]}.`, { l });
      }
      r++;
      t.step('next', `Advance the sell day to ${r}.`, { l, r });
    }
    t.step('done', `Best profit = ${maxP}.`, { result: maxP });
    return maxP;
  },
};

const longestSubstring: Problem<{ s: string }> = {
  id: 'longest-substring-without-repeating-characters',
  num: 3,
  title: 'Longest Substring Without Repeating Characters',
  difficulty: 'Medium',
  category: 'sliding-window',
  pattern: 'sliding-window',
  statement: 'Find the length of the longest contiguous piece of a string in which no character occurs twice.',
  signals: ['"longest substring" (contiguous)', '"without repeating" → a constraint you can restore by shrinking', 'O(n) expected'],
  insight:
    'Grow the window to the right; when the new character is already inside, shrink from the left until it is gone. A set holds exactly the window\'s characters, so each check is O(1) and each index enters and leaves once.',
  hints: [
    'Checking every substring is O(n²) or worse. What do you know about a window once it becomes invalid?',
    'If s[l..r] has a repeat, so does every longer window starting at l — move l instead of restarting.',
    'Set of chars in the window; while s[r] in set: remove s[l], l += 1.',
  ],
  pitfall: 'Using "if" instead of "while" to shrink — the duplicate may be several positions inside the window.',
  backend: {
    title: 'Longest no-repeat streak in a clickstream',
    detail:
      'A product-analytics job (Kafka Streams/Flink) wants each user\'s longest browsing streak without revisiting a page. The window is the current streak, the set holds the pages in it; when a page repeats, events are evicted from the left until the earlier visit is gone — the same expand/evict loop used by stream processors for sliding windows with a uniqueness constraint.',
  },
  complexity: { time: 'O(n)', space: 'O(min(n, alphabet))' },
  code: `
def lengthOfLongestSubstring(s):
    charSet = set()                       @init
    l = 0                                 @l0
    res = 0                               @res0
    for r in range(len(s)):               @loop
        while s[r] in charSet:            @dup
            charSet.remove(s[l])          @remove
            l += 1                        @shrink
        charSet.add(s[r])                 @add
        res = max(res, r - l + 1)         @best
    return res                            @done
`,
  explain: {
    init: 'Exactly the characters in s[l..r].',
    dup: 'Adding s[r] would create a repeat — shrink until it would not.',
    remove: 'The leftmost character leaves the window…',
    shrink: '…and l moves past it.',
    best: 'The window is valid here; record its length.',
  },
  distractors: [
    { text: '        if s[r] in charSet:', why: '"if" shrinks only one step; the earlier copy of s[r] may be further right than l.' },
    { text: '            l = r', why: 'Restarting at r throws away valid characters between the duplicate and r ("abba"-type inputs break).' },
    { text: '        res = max(res, r - l)', why: 'Window length is r − l + 1 (inclusive).' },
  ],
  input: { s: 'abcabcbb' },
  presets: [
    { label: 'all same', input: { s: 'bbbbb' } },
    { label: 'pwwkew', input: { s: 'pwwkew' } },
    { label: 'empty', input: { s: '' } },
  ],
  validate: ({ s }) => (typeof s !== 'string' ? 'Expected { s: string }' : s.length > 16 ? 'Keep s ≤ 16 characters' : null),
  trace(t, { s }) {
    const charSet = new Set<string>();
    let l = 0;
    let r = -1;
    let res = 0;
    let hl: string[] = [];
    let conflict: number | null = null;
    t.draw(() => [
      V.array('s', s.split(''), {
        pointers: { l, r },
        window: r >= l ? [l, r] : null,
        tones: { ...passed(l), ...(conflict !== null ? { [conflict]: 'bad' as Tone } : {}) },
      }),
      V.set('charSet (window contents)', charSet, { hl }),
    ]);
    t.step('init', 'Empty window, empty set.');
    t.step('l0', 'The window starts at l = 0.', { l });
    t.step('res0', 'Longest valid window so far: 0.', { res });
    let askedDup = 0;
    let askedStop = false;
    for (r = 0; r < s.length; r++) {
      const c = s[r];
      hl = [];
      conflict = null;
      t.step('loop', `r = ${r}: try to add '${c}'.`, { l, r, c });
      if (askedDup < 2 && (charSet.has(c) || r === 2)) {
        askedDup++;
        t.predict(`Is '${c}' already in the window?`, ['Yes — shrink', 'No — just add it'], charSet.has(c) ? 0 : 1, charSet.has(c) ? `'${c}' sits at index ${s.lastIndexOf(c, r - 1)}, inside [${l}, ${r - 1}].` : `The window only holds {${[...charSet].join(', ')}}.`);
      }
      while (charSet.has(c)) {
        hl = [c];
        conflict = s.lastIndexOf(c, r - 1);
        t.step('dup', `'${c}' is already in the window (index ${conflict}) — adding it would repeat.`, { l, r, c });
        hl = [s[l]];
        t.step('remove', `Evict s[${l}] = '${s[l]}' from the set.`, { l, r });
        charSet.delete(s[l]);
        l++;
        t.step('shrink', `l → ${l}.`, { l, r });
        if (!askedStop && !charSet.has(c) && l < r) {
          askedStop = true;
          t.predict(`Must we keep shrinking before adding '${c}'?`, ['Yes', 'No'], 1, `The old '${c}' just left, so the window [${l}, ${r - 1}] no longer contains it.`);
        }
      }
      conflict = null;
      t.step('dup', `'${c}' is not in the window — safe to add.`, { l, r, c });
      charSet.add(c);
      hl = [c];
      t.step('add', `Add '${c}'. Window = '${s.slice(l, r + 1)}'.`, { l, r });
      res = Math.max(res, r - l + 1);
      t.step('best', `Length ${r - l + 1}; best = ${res}.`, { 'r - l + 1': r - l + 1, res });
    }
    hl = [];
    t.step('done', `Longest substring without repeats has length ${res}.`, { result: res });
    return res;
  },
};

const charReplacement: Problem<{ s: string; k: number }> = {
  id: 'longest-repeating-character-replacement',
  num: 424,
  title: 'Longest Repeating Character Replacement',
  difficulty: 'Medium',
  category: 'sliding-window',
  pattern: 'sliding-window',
  statement: 'You may overwrite at most k characters of an uppercase string with any letter. Return the length of the longest stretch that can be made of one repeated letter.',
  signals: ['"longest substring" with "at most k changes"', 'contiguous run', 'validity depends on counts inside the window'],
  insight:
    'A window is fixable iff (window length − count of its most common letter) ≤ k — those are the letters you would replace. Grow right; shrink left whenever that breaks. maxf never needs to decrease: only a larger maxf can produce a longer answer.',
  hints: [
    'For a fixed window, which letter should you keep, and how many replacements does that cost?',
    'cost = length − (most frequent count). When is the window valid?',
    'Counts map + maxf; while (r − l + 1) − maxf > k: count[s[l]] -= 1; l += 1.',
  ],
  pitfall: 'Recomputing the true max on every shrink (O(26) each) is fine but unnecessary; the real bug is checking cost against k with ≥ instead of >.',
  backend: {
    title: 'Longest stable period with at most k flapping probes',
    detail:
      'An uptime service records one status per health-check probe. "Longest stable period tolerating k anomalies" = longest window where all but at most k probes agree with the majority status. The window holds a status → count map; when minority probes exceed k the window slides — exactly this algorithm on SLO dashboards.',
  },
  complexity: { time: 'O(n)', space: 'O(26)' },
  code: `
def characterReplacement(s, k):
    count = {}                                 @init
    res = 0                                    @res0
    l = 0                                      @l0
    maxf = 0                                   @maxf0
    for r in range(len(s)):                    @loop
        count[s[r]] = 1 + count.get(s[r], 0)   @inc
        maxf = max(maxf, count[s[r]])          @maxf
        while (r - l + 1) - maxf > k:          @check
            count[s[l]] -= 1                   @dec
            l += 1                             @shrink
        res = max(res, r - l + 1)              @best
    return res                                 @done
`,
  explain: {
    inc: 'Count the new character in the window.',
    maxf: 'Most frequent letter in the window — the one worth keeping.',
    check: 'Replacements needed = length − maxf. More than k means the window is invalid.',
    dec: 'Drop the leftmost character from the counts.',
    best: 'Window is now fixable with ≤ k replacements.',
  },
  distractors: [
    { text: '        while (r - l + 1) - maxf >= k:', why: 'Off by one: exactly k replacements is allowed.' },
    { text: '        if count[s[r]] > k:', why: 'Compares the wrong quantity — validity depends on the OTHER letters (length − maxf), not on the current letter\'s count.' },
    { text: '            l = r', why: 'Jumping l to r discards a window that one step of shrinking would have fixed.' },
  ],
  input: { s: 'AABABBA', k: 1 },
  presets: [
    { label: 'k = 2', input: { s: 'ABAB', k: 2 } },
    { label: 'k = 0', input: { s: 'AABBBC', k: 0 } },
  ],
  validate: ({ s, k }) =>
    typeof s !== 'string' || typeof k !== 'number' || !/^[A-Z]*$/.test(s) ? 'Expected { s: uppercase string, k: number }' : s.length > 14 ? 'Keep s ≤ 14 characters' : k < 0 ? 'k must be ≥ 0' : null,
  trace(t, { s, k }) {
    const count = new Map<string, number>();
    let l = 0;
    let r = -1;
    let res = 0;
    let maxf = 0;
    let hl: string[] = [];
    let invalid = false;
    t.draw(() => [
      V.array('s', s.split(''), { pointers: { l, r }, window: r >= l ? [l, r] : null, tones: { ...passed(l), ...(invalid && r >= 0 ? { [r]: 'bad' as Tone } : {}) } }),
      V.map('count (in window)', count, { hl }),
    ]);
    t.step('init', 'Empty counts.', { k });
    t.step('res0', 'Best length so far: 0.', { res });
    t.step('l0', 'Window starts at 0.', { l });
    t.step('maxf0', 'maxf = 0: no letters yet.', { maxf });
    let askedCheck = 0;
    for (r = 0; r < s.length; r++) {
      hl = [];
      invalid = false;
      t.step('loop', `Extend to r = ${r} ('${s[r]}').`, { l, r });
      count.set(s[r], (count.get(s[r]) ?? 0) + 1);
      hl = [s[r]];
      t.step('inc', `count['${s[r]}'] = ${count.get(s[r])}.`, { l, r });
      maxf = Math.max(maxf, count.get(s[r])!);
      t.step('maxf', `maxf = ${maxf}: keep the most common letter, replace the rest.`, { maxf });
      for (;;) {
        const len = r - l + 1;
        const cost = len - maxf;
        if (askedCheck < 3 && r >= 2) {
          askedCheck++;
          ask(t, `Window length ${len}, maxf ${maxf}, k = ${k}. Is the window valid?`, cost <= k ? 'valid — keep it' : 'too many replacements — shrink', ['valid — keep it', 'too many replacements — shrink'], `Replacements needed = ${len} − ${maxf} = ${cost}, ${cost <= k ? '≤' : '>'} k = ${k}.`);
        }
        invalid = cost > k;
        t.step('check', invalid ? `${len} − ${maxf} = ${cost} replacements > k = ${k}: invalid, shrink.` : `${len} − ${maxf} = ${cost} ≤ ${k}: fixable.`, { 'r - l + 1': len, maxf, cost });
        if (!invalid) break;
        hl = [s[l]];
        count.set(s[l], count.get(s[l])! - 1);
        t.step('dec', `Remove '${s[l]}' from the counts.`, { l });
        l++;
        t.step('shrink', `l → ${l}. (maxf stays ${maxf}: a smaller maxf could never beat res.)`, { l, r });
      }
      invalid = false;
      res = Math.max(res, r - l + 1);
      t.step('best', `Window '${s.slice(l, r + 1)}' is fixable; best = ${res}.`, { res });
    }
    hl = [];
    t.step('done', `Longest fixable window = ${res}.`, { result: res });
    return res;
  },
};

const permutationInString: Problem<{ s1: string; s2: string }> = {
  id: 'permutation-in-string',
  num: 567,
  title: 'Permutation in String',
  difficulty: 'Medium',
  category: 'sliding-window',
  pattern: 'sliding-window',
  statement: 'Decide whether some rearrangement of s1 appears as a contiguous block inside s2.',
  signals: ['"permutation of s1" → same letter counts', '"substring of s2" → contiguous, fixed length len(s1)', 'fixed-size window'],
  insight:
    'Any match has length len(s1), so slide a FIXED-size window over s2 and keep its letter counts up to date: add the char entering on the right, remove the one leaving on the left. Match iff the counts equal s1\'s counts.',
  hints: [
    'How long is any permutation of s1?',
    'Two strings are permutations iff their letter counts match (Valid Anagram).',
    'Window of size len(s1): +1 for s2[r], −1 for s2[r − len(s1)]; compare counts.',
  ],
  pitfall: 'Re-counting the whole window at every position (O(n·m)) — or forgetting to delete zero counts so the dict comparison fails.',
  backend: {
    title: 'Complex-event detection in a fixed event window',
    detail:
      'A fraud rule in a CEP engine (Flink, Esper): "login-from-new-device, password-change and withdrawal all occur, in any order, within N consecutive events". need = multiset of required types; the window keeps counts for the last N events, updated by +1/−1 as events stream through — this exact fixed-window anagram check.',
  },
  complexity: { time: 'O(n · 26)', space: 'O(26)' },
  code: `
def checkInclusion(s1, s2):
    if len(s1) > len(s2):                @short
        return False                     @noRoom
    need = Counter(s1)                   @need
    window = Counter(s2[:len(s1)])       @first
    if window == need:                   @eq0
        return True                      @hit0
    for r in range(len(s1), len(s2)):    @loop
        window[s2[r]] += 1               @add
        l = r - len(s1)                  @l
        window[s2[l]] -= 1               @drop
        if window[s2[l]] == 0:           @zero
            del window[s2[l]]            @del
        if window == need:               @eq
            return True                  @hit
    return False                         @none
`,
  explain: {
    need: 'Target letter counts.',
    first: 'Counts of the first window of length len(s1).',
    add: 'Character entering on the right.',
    l: 'Index of the character falling out on the left.',
    del: 'Delete zero counts so dict equality is exact.',
    eq: 'Same counts ⇒ the window is a permutation of s1.',
  },
  distractors: [
    { text: '        window = Counter(s2[r - len(s1) + 1 : r + 1])', why: 'Rebuilding the window counter every step costs O(len(s1)) — the whole point is the O(1) +1/−1 update.' },
    { text: '        l = r - len(s1) + 1', why: 'Off by one: that is the first index still INSIDE the new window, not the one leaving.' },
    { text: '        if sorted(s2[l:r]) == sorted(s1):', why: 'Sorting every window is O(m log m) per step.' },
  ],
  input: { s1: 'ab', s2: 'eidbaooo' },
  presets: [
    { label: 'no permutation', input: { s1: 'ab', s2: 'eidboaoo' } },
    { label: 'repeated letters', input: { s1: 'aab', s2: 'cbaaba' } },
    { label: 's1 longer', input: { s1: 'abcd', s2: 'abc' } },
  ],
  validate: ({ s1, s2 }) =>
    typeof s1 !== 'string' || typeof s2 !== 'string' || !s1 ? 'Expected { s1: non-empty string, s2: string }' : s2.length > 16 || s1.length > 8 ? 'Keep s1 ≤ 8 and s2 ≤ 16 characters' : null,
  trace(t, { s1, s2 }) {
    const m = s1.length;
    const need = new Map<string, number>();
    const window = new Map<string, number>();
    let l = -1;
    let r = -1;
    let hit = false;
    let hl: string[] = [];
    const eq = () => need.size === window.size && [...need].every(([c, x]) => window.get(c) === x);
    const winTones = (): Record<string, Tone> => {
      const out: Record<string, Tone> = {};
      for (const [c, x] of window) out[c] = need.get(c) === x ? 'good' : 'warn';
      return out;
    };
    t.draw(() => [
      V.array('s2', s2.split(''), {
        pointers: { l: l >= 0 ? l : null, r: r >= 0 ? r : null },
        window: r >= 0 ? [r - m + 1, r] : null,
        tones: { ...(l >= 0 ? { [l]: 'muted' as Tone } : {}), ...(hit ? tones(range(r - m + 1, r + 1), 'good') : {}) },
      }),
      V.map('need = Counter(s1)', need),
      V.map('window counts', window, { tones: winTones(), hl, caption: 'green = matches need · amber = differs' }),
    ]);
    t.step(null, `Look for a rearrangement of '${s1}' inside '${s2}'.`);
    t.step('short', `len(s1) = ${m}, len(s2) = ${s2.length}.`);
    if (m > s2.length) {
      t.step('noRoom', 's1 is longer than s2 — no window can hold it.', { result: false });
      return false;
    }
    for (const c of s1) need.set(c, (need.get(c) ?? 0) + 1);
    t.step('need', `Counts of s1: every match must have exactly these.`);
    for (let i = 0; i < m; i++) window.set(s2[i], (window.get(s2[i]) ?? 0) + 1);
    r = m - 1;
    t.step('first', `First window s2[0:${m}] = '${s2.slice(0, m)}'.`, { r });
    t.step('eq0', eq() ? 'Counts match!' : 'Counts differ.', {});
    if (eq()) {
      hit = true;
      t.step('hit0', 'The very first window is a permutation of s1.', { result: true });
      return true;
    }
    let askedL = false;
    let askedEq = 0;
    for (r = m; r < s2.length; r++) {
      l = -1;
      hl = [];
      t.step('loop', `Slide: '${s2[r]}' enters at r = ${r}.`, { r });
      window.set(s2[r], (window.get(s2[r]) ?? 0) + 1);
      hl = [s2[r]];
      t.step('add', `window['${s2[r]}'] = ${window.get(s2[r])}.`, { r });
      if (!askedL) {
        askedL = true;
        ask(t, `The window must stay ${m} long. Which index leaves?`, String(r - m), [String(r - m + 1), String(r), ...(r - m - 1 >= 0 ? [String(r - m - 1)] : [])], `l = r − len(s1) = ${r} − ${m}: the character just behind the new window.`);
      }
      l = r - m;
      t.step('l', `l = ${r} − ${m} = ${l}: '${s2[l]}' falls out.`, { r, l });
      window.set(s2[l], window.get(s2[l])! - 1);
      hl = [s2[l]];
      t.step('drop', `window['${s2[l]}'] = ${window.get(s2[l])}.`, { l });
      if (window.get(s2[l]) === 0) {
        t.step('zero', `Count of '${s2[l]}' hit 0.`, { l });
        window.delete(s2[l]);
        t.step('del', `Delete it so the dicts compare exactly.`, { l });
      } else t.step('zero', `'${s2[l]}' still occurs in the window.`, { l });
      const match = eq();
      if (askedEq < 2 && (match || r === m + 1)) {
        askedEq++;
        t.predict(`Window '${s2.slice(l + 1, r + 1)}' — do its counts equal need?`, ['Yes', 'No'], match ? 0 : 1, match ? `It has exactly the letters of '${s1}'.` : `It differs from '${s1}' in at least one letter count (amber entries).`);
      }
      hit = match;
      t.step('eq', match ? `'${s2.slice(l + 1, r + 1)}' has the same counts as '${s1}'.` : `'${s2.slice(l + 1, r + 1)}' is not a permutation of '${s1}'.`, { window: s2.slice(l + 1, r + 1) });
      if (match) {
        t.step('hit', 'Found a permutation of s1 inside s2.', { result: true });
        return true;
      }
    }
    l = -1;
    t.step('none', 'Every window checked — no permutation of s1.', { result: false });
    return false;
  },
};

const minWindow: Problem<{ s: string; t: string }> = {
  id: 'minimum-window-substring',
  num: 76,
  title: 'Minimum Window Substring',
  difficulty: 'Hard',
  category: 'sliding-window',
  pattern: 'sliding-window',
  statement: 'Return the shortest contiguous piece of s that contains every character of t (with multiplicity). Return "" if there is none.',
  signals: ['"smallest substring containing all of…"', 'coverage with counts', 'variable-size window: expand until valid, shrink while valid'],
  insight:
    'Expand r until the window covers t, then shrink l as long as it still covers t, recording each valid size. Track coverage with have/need (number of distinct chars whose count is satisfied) so validity is an O(1) check.',
  hints: [
    'When is a window "good"? Express it with counts.',
    'Once a window is good, moving l right can only keep it good or break it — try to shrink.',
    'have = number of chars in t whose required count is met; valid iff have == need.',
  ],
  pitfall: 'Incrementing have on every occurrence instead of only when window[c] reaches EXACTLY countT[c] — extra copies would be double-counted.',
  backend: {
    title: 'Shortest log slice that covers every service in a trace',
    detail:
      'To reproduce an incident, an engineer wants the shortest contiguous span of the aggregated log stream that contains at least one entry from each of {auth, cart, payments, ledger}. Window = log range, countT = required services, have/need = how many are covered. Expand to cover, shrink to minimise — the minimal repro slice in O(n).',
  },
  complexity: { time: 'O(|s| + |t|)', space: 'O(alphabet)' },
  code: `
def minWindow(s, t):
    if t == "":                                         @empty
        return ""
    countT, window = Counter(t), {}                     @init
    have, need = 0, len(countT)                         @hn
    res, resLen = [-1, -1], float("inf")                @res0
    l = 0                                               @l0
    for r in range(len(s)):                             @loop
        c = s[r]
        window[c] = 1 + window.get(c, 0)                @add
        if c in countT and window[c] == countT[c]:      @gain
            have += 1                                   @have
        while have == need:                             @valid
            if (r - l + 1) < resLen:                    @better
                res, resLen = [l, r], r - l + 1         @save
            window[s[l]] -= 1                           @drop
            if s[l] in countT and window[s[l]] < countT[s[l]]:   @lose
                have -= 1                               @haveDec
            l += 1                                      @shrink
    l, r = res                                          @unpack
    return s[l : r + 1] if resLen != float("inf") else ""   @ret
`,
  explain: {
    hn: 'need = distinct characters of t; have = how many of them are fully satisfied.',
    gain: 'Count a character as satisfied exactly once — when it first reaches its required count.',
    valid: 'Window covers t: try to make it smaller.',
    save: 'Record the smallest valid window so far.',
    lose: 'Removing s[l] may drop a requirement below its count; then the window is no longer valid.',
  },
  distractors: [
    { text: '        if c in countT and window[c] >= countT[c]:', why: 'Counts extra copies again: have can exceed need, and validity breaks.' },
    { text: '        if have == need:', why: '"if" shrinks only one step; the window may stay valid for several shrinks.' },
    { text: '            l += 1\n            window[s[l]] -= 1', why: 'Wrong order: decrements the character that is still INSIDE the window instead of the one leaving.' },
  ],
  input: { s: 'ADOBECODEBANC', t: 'ABC' },
  presets: [
    { label: 'whole string', input: { s: 'a', t: 'a' } },
    { label: 'impossible', input: { s: 'a', t: 'aa' } },
    { label: 'duplicates in t', input: { s: 'aabdcab', t: 'aab' } },
  ],
  validate: (inp) =>
    typeof inp.s !== 'string' || typeof inp.t !== 'string' ? 'Expected { s: string, t: string }' : inp.s.length > 16 || inp.t.length > 6 ? 'Keep s ≤ 16 and t ≤ 6 characters' : null,
  trace(t, { s, t: tt }) {
    const countT = new Map<string, number>();
    const window = new Map<string, number>();
    let l = 0;
    let r = -1;
    let have = 0;
    let need = 0;
    let best: [number, number] | null = null;
    let hl: string[] = [];
    const winTones = (): Record<string, Tone> => {
      const out: Record<string, Tone> = {};
      for (const [c, x] of countT) out[c] = (window.get(c) ?? 0) >= x ? 'good' : 'warn';
      return out;
    };
    t.draw(() => [
      V.array('s', s.split(''), {
        pointers: { l, r: r >= 0 && r < s.length ? r : null },
        window: r >= l ? [l, r] : null,
        tones: { ...passed(l), ...(best ? tones(range(best[0], best[1] + 1).filter((x) => x < l), 'info') : {}) },
        caption: best ? `best so far: '${s.slice(best[0], best[1] + 1)}' (blue where already passed)` : undefined,
      }),
      V.map('countT (required)', countT),
      V.map('window (chars of t only)', [...countT.keys()].map((c) => [c, window.get(c) ?? 0] as const), { tones: winTones(), hl, caption: `have ${have} / need ${need}` }),
    ]);
    t.step('empty', tt === '' ? 't is empty.' : `t = '${tt}' is not empty.`);
    if (tt === '') {
      t.step(null, 'An empty t is trivially covered by the empty string.');
      return '';
    }
    for (const c of tt) countT.set(c, (countT.get(c) ?? 0) + 1);
    t.step('init', 'countT holds the required count of each character.');
    need = countT.size;
    t.step('hn', `need = ${need} distinct characters; have = 0 satisfied so far.`, { have, need });
    t.step('res0', 'No valid window yet (length ∞).', { resLen: Infinity });
    t.step('l0', 'l = 0.', { l });
    let askedGain = false;
    let askedLose = 0;
    for (r = 0; r < s.length; r++) {
      const c = s[r];
      hl = [];
      t.step('loop', `Expand: r = ${r} ('${c}').`, { l, r, have, need });
      window.set(c, (window.get(c) ?? 0) + 1);
      hl = [c];
      t.step('add', `window['${c}'] = ${window.get(c)}.`, { r });
      const gained = countT.has(c) && window.get(c) === countT.get(c);
      if (!askedGain && countT.has(c) && r > 0) {
        askedGain = true;
        t.predict(`Does adding '${c}' increase have?`, ['Yes', 'No'], gained ? 0 : 1, gained ? `'${c}' just reached its required count ${countT.get(c)}.` : `'${c}' ${(window.get(c) ?? 0) > countT.get(c)! ? 'was already satisfied — extra copies do not count twice' : 'is still below its required count'}.`);
      }
      t.step('gain', gained ? `'${c}' now meets its requirement (${countT.get(c)}).` : countT.has(c) ? `'${c}' count ${window.get(c)} vs required ${countT.get(c)} — no change to have.` : `'${c}' is not in t — irrelevant.`, { c });
      if (gained) {
        have++;
        t.step('have', `have = ${have} / ${need}.`, { have, need });
      }
      while (have === need) {
        t.step('valid', `have == need: '${s.slice(l, r + 1)}' covers t. Try shrinking.`, { l, r, have, need });
        const len = r - l + 1;
        const better = best === null || len < best[1] - best[0] + 1;
        t.step('better', better ? `Length ${len} beats the best so far.` : `Length ${len} is not shorter than the best (${best![1] - best![0] + 1}).`, { 'r - l + 1': len });
        if (better) {
          best = [l, r];
          t.step('save', `Save [${l}, ${r}] = '${s.slice(l, r + 1)}'.`, { res: [l, r], resLen: len });
        }
        const out = s[l];
        const willLose = countT.has(out) && (window.get(out) ?? 0) - 1 < countT.get(out)!;
        if (askedLose < 2 && countT.has(out)) {
          askedLose++;
          t.predict(`Removing '${out}' from the left: will the window still cover t?`, ['Yes, keep shrinking', 'No, it becomes invalid'], willLose ? 1 : 0, willLose ? `Only ${window.get(out)} '${out}' in the window and ${countT.get(out)} are required.` : `There are ${window.get(out)} copies of '${out}'; ${countT.get(out)} needed, so one spare can go.`);
        }
        window.set(out, window.get(out)! - 1);
        hl = [out];
        t.step('drop', `Remove '${out}' (index ${l}) from the window counts.`, { l });
        t.step('lose', willLose ? `'${out}' dropped below ${countT.get(out)} — coverage lost.` : `Coverage unaffected.`, { l });
        if (willLose) {
          have--;
          t.step('haveDec', `have = ${have} / ${need}: window no longer valid.`, { have, need });
        }
        l++;
        t.step('shrink', `l → ${l}.`, { l, r });
      }
    }
    r = s.length;
    hl = [];
    t.step('unpack', best ? `Best window: [${best[0]}, ${best[1]}].` : 'No window ever covered t.', { res: best ?? [-1, -1] });
    const ans = best ? s.slice(best[0], best[1] + 1) : '';
    t.step('ret', best ? `Return '${ans}'.` : 'Return "".', { result: ans });
    return ans;
  },
};

const slidingMax: Problem<{ nums: number[]; k: number }> = {
  id: 'sliding-window-maximum',
  num: 239,
  title: 'Sliding Window Maximum',
  difficulty: 'Hard',
  category: 'sliding-window',
  pattern: 'sliding-window',
  statement: 'A window of size k slides one step at a time across an integer array. Output the maximum inside each window position.',
  signals: ['fixed window size k', '"maximum of every window"', 'O(n) needed (O(n·k) rescans too slow)', 'old elements smaller than a newcomer are useless'],
  insight:
    'Keep a deque of indices whose values never increase front → back. A new value evicts every smaller value from the back (they can never be a max again while it is in the window); the front is always the current maximum, and it is dropped once it slides out.',
  hints: [
    'Rescanning each window is O(n·k). Which elements can never be a maximum again?',
    'If nums[j] ≥ nums[i] and j > i, then i is useless from now on.',
    'Monotonic decreasing deque of indices: pop smaller from the back, pop expired from the front, front = max.',
  ],
  pitfall: 'Storing values instead of indices — then you cannot tell when the front has left the window.',
  backend: {
    title: 'Rolling max latency for dashboards and alerts',
    detail:
      'A metrics aggregator must emit max(p99 latency) over the last k samples for every new sample (e.g. "max over 5 minutes" in Grafana/Datadog). A monotonic deque keeps amortised O(1) work per sample: newer, larger readings evict older smaller ones, and the front expires by timestamp — no rescanning the window.',
  },
  complexity: { time: 'O(n)', space: 'O(k)' },
  code: `
def maxSlidingWindow(nums, k):
    output = []                                  @init
    q = deque()                                  @dq
    l = r = 0                                    @lr
    while r < len(nums):                         @loop
        while q and nums[q[-1]] < nums[r]:       @popBack
            q.pop()                              @pop
        q.append(r)                              @push
        if l > q[0]:                             @stale
            q.popleft()                          @popFront
        if (r + 1) >= k:                         @full
            output.append(nums[q[0]])            @emit
            l += 1                               @slide
        r += 1                                   @next
    return output                                @done
`,
  explain: {
    dq: 'Indices, with their values non-increasing front → back.',
    popBack: 'A newcomer bigger than the back makes the back useless forever.',
    push: 'The newcomer may become the max once the bigger ones expire.',
    stale: 'The front index slid out of the window — discard it.',
    emit: 'Front of the deque is the window maximum.',
  },
  distractors: [
    { text: '        output.append(max(nums[l:r + 1]))', why: 'Rescanning the window is O(k) per step — O(n·k) overall.' },
    { text: '        while q and nums[q[-1]] > nums[r]:', why: 'Pops LARGER values — the deque becomes increasing and the front is the minimum.' },
    { text: '        q.append(nums[r])', why: 'Storing values loses the index, so you cannot tell when the front expires.' },
  ],
  input: { nums: [1, 3, -1, -3, 5, 3, 6, 7], k: 3 },
  presets: [
    { label: 'k = 1', input: { nums: [4, 2, 7], k: 1 } },
    { label: 'decreasing (front expires)', input: { nums: [9, 8, 7, 6, 5], k: 2 } },
  ],
  validate: ({ nums, k }) =>
    !Array.isArray(nums) || typeof k !== 'number'
      ? 'Expected { nums: number[], k: number }'
      : nums.length > 14
        ? 'Keep nums ≤ 14 elements'
        : k < 1 || k > nums.length
          ? 'Need 1 ≤ k ≤ len(nums)'
          : null,
  trace(t, { nums, k }) {
    const output: number[] = [];
    const q: number[] = [];
    let l = 0;
    let r = -1;
    let qTone: Record<number, Tone> = {};
    t.draw(() => [
      V.array('nums', nums, {
        pointers: { l, r: r >= 0 && r < nums.length ? r : null },
        window: r >= 0 && r < nums.length ? [l, r] : null,
        tones: { ...passed(l), ...(q.length && q[0] >= l ? { [q[0]]: 'good' as Tone } : {}) },
      }),
      V.queue('q (index:value, decreasing)', q.map((i) => `${i}:${nums[i]}`), { tones: { ...(q.length ? tones([0], 'good') : {}), ...qTone }, caption: 'front = window max' }),
      V.chips('output', output, { tones: tones(range(0, output.length), 'good') }),
    ]);
    t.step('init', 'Empty output.');
    t.step('dq', 'Empty deque: it will hold indices with decreasing values.');
    l = 0;
    r = 0;
    t.step('lr', `Window [l, r] starts at 0; it is "full" once it has ${k} elements.`, { l, r, k });
    let askedPop = false;
    let askedKeep = false;
    let askedStale = false;
    let askedEmit = false;
    while (r < nums.length) {
      qTone = {};
      t.step('loop', `r = ${r}: nums[r] = ${nums[r]} enters.`, { l, r });
      if (q.length) {
        const backSmaller = nums[q[q.length - 1]] < nums[r];
        if ((backSmaller && !askedPop) || (!backSmaller && !askedKeep)) {
          if (backSmaller) askedPop = true;
          else askedKeep = true;
          t.predict(`Back of the deque holds ${nums[q[q.length - 1]]}; ${nums[r]} arrives. Is the back popped?`, ['Yes', 'No'], backSmaller ? 0 : 1, backSmaller ? `${nums[q[q.length - 1]]} < ${nums[r]} and is older: it can never be a window max while ${nums[r]} is around.` : `${nums[q[q.length - 1]]} ≥ ${nums[r]}, so it may still be the max; ${nums[r]} queues behind it in case the bigger values expire.`);
        }
      }
      while (q.length && nums[q[q.length - 1]] < nums[r]) {
        qTone = { [q.length - 1]: 'bad' };
        t.step('popBack', `${nums[q[q.length - 1]]} (index ${q[q.length - 1]}) < ${nums[r]} — it is dominated.`, { r, 'q[-1]': q[q.length - 1] });
        q.pop();
        qTone = {};
        t.step('pop', 'Pop it from the back.', { q: [...q] });
      }
      t.step('popBack', q.length ? `Back value ${nums[q[q.length - 1]]} ≥ ${nums[r]}: stop popping.` : 'Deque is empty: stop popping.', { r });
      q.push(r);
      qTone = { [q.length - 1]: 'active' };
      t.step('push', `Append index ${r}. Deque values stay decreasing.`, { q: [...q] });
      const stale = l > q[0];
      if (!askedStale && stale) {
        askedStale = true;
        t.predict(`Window starts at l = ${l} but the front index is ${q[0]}. What happens?`, ['Front is popped', 'Front stays'], 0, `Index ${q[0]} < l: it already slid out of the window.`);
      }
      t.step('stale', stale ? `Front index ${q[0]} < l = ${l}: it left the window.` : `Front index ${q[0]} is still inside [${l}, ${r}].`, { l, 'q[0]': q[0] });
      if (stale) {
        q.shift();
        qTone = {};
        t.step('popFront', `Drop it; new front is index ${q[0]} (${nums[q[0]]}).`, { q: [...q] });
      }
      const full = r + 1 >= k;
      if (!askedEmit && full && q[0] !== r) {
        askedEmit = true;
        ask(t, `Window [${nums.slice(l, r + 1).join(', ')}]: what is emitted?`, String(nums[q[0]]), nums.slice(l, r + 1).map(String), `The deque front (index ${q[0]}) holds the window max; nothing larger came after it.`);
      }
      t.step('full', full ? `Window [${l}, ${r}] has ${k} elements — emit its max.` : `Only ${r + 1} element(s) so far; window not full yet.`, { 'r + 1': r + 1, k });
      if (full) {
        output.push(nums[q[0]]);
        t.step('emit', `Max of [${nums.slice(l, r + 1).join(', ')}] is the front: ${nums[q[0]]}.`, { output: [...output] });
        l++;
        t.step('slide', `l → ${l}: the window will slide.`, { l });
      }
      r++;
      qTone = {};
      t.step('next', `r → ${r}.`, { l, r });
    }
    t.step('loop', 'r reached the end.', { r });
    t.step('done', `Window maxima: [${output.join(', ')}].`, { result: output });
    return output;
  },
};

export const problems: Problem[] = [bestTime, longestSubstring, charReplacement, permutationInString, minWindow, slidingMax];

export const variants: Variant[] = [
  {
    id: 'max-requests-in-window',
    title: 'Busiest 60-second window in an access log',
    statement: 'Given request counts per second for a day, find the maximum total number of requests in any 60 consecutive seconds.',
    pattern: 'sliding-window',
    nearest: 'permutation-in-string',
    signals: ['fixed window length', '"maximum sum of k consecutive"', 'one pass over a time series'],
    approach:
      'Sum the first 60 seconds, then slide: add the second entering on the right, subtract the one leaving on the left, track the max. O(n), O(1) memory.',
    backend:
      'Sliding-window rate limiters and capacity planning: the busiest minute decides how many API-gateway replicas you need; Redis-based limiters maintain exactly this running sum per client.',
  },
  {
    id: 'longest-session-k-distinct-shards',
    title: 'Longest stretch touching at most k distinct shards',
    statement: 'A request log lists which shard each query hit. Find the longest contiguous run of queries that touches at most k different shards.',
    pattern: 'sliding-window',
    nearest: 'longest-substring-without-repeating-characters',
    signals: ['"longest contiguous" + "at most k distinct"', 'validity restored by shrinking from the left', 'counts inside the window'],
    approach:
      'Map shard → count in window. Extend r; while the map has more than k keys, decrement s[l] (delete at 0) and move l. Record r − l + 1.',
    backend:
      'Connection pooling / cache warming: the longest burst served by ≤ k shards tells you how many shard connections a worker must keep warm to avoid reconnect latency.',
  },
  {
    id: 'shortest-burst-over-quota',
    title: 'Shortest burst exceeding a byte quota',
    statement: 'Given positive byte counts of consecutive uploads from one tenant, find the length of the shortest contiguous run whose total is at least Q bytes (0 if none).',
    pattern: 'sliding-window',
    nearest: 'minimum-window-substring',
    signals: ['"minimum length subarray" with sum ≥ target', 'all values positive (so shrinking only lowers the sum)', 'expand until valid, shrink while valid'],
    approach:
      'Extend r adding bytes; while total ≥ Q, record r − l + 1, subtract nums[l] and move l. Positivity guarantees the window sum is monotonic in both directions.',
    backend:
      'Abuse detection on object storage (S3-style): flag tenants that can exceed a bandwidth quota within a very short burst — the shortest such burst is the alert severity.',
  },
];
