import type { Problem, Tone, Variant } from '../engine/types.ts';
import type { Tracer } from '../engine/tracer.ts';
import { V, rc, tones } from '../engine/tracer.ts';

/** Attach a prediction whose options are de-duplicated and ordered deterministically. */
function ask(t: Tracer, question: string, correct: string, wrong: string[], why: string) {
  const options = [...new Set([correct, ...wrong])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  t.predict(question, options, options.indexOf(correct), why);
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);

// ---------------------------------------------------------------------------
// Reference examples — Two Sum and Top K Frequent show the conventions every problem follows.
// ---------------------------------------------------------------------------

const twoSum: Problem<{ nums: number[]; target: number }> = {
  id: 'two-sum',
  num: 1,
  title: 'Two Sum',
  difficulty: 'Easy',
  category: 'arrays-hashing',
  pattern: 'hashing',
  statement:
    'Given an integer array and a target, return the indices of the two different elements that add up to the target. Exactly one answer exists.',
  signals: ['"pair that sums to target"', 'unsorted array (so no two pointers)', 'need indices back', 'O(n) expected'],
  insight:
    'For each number x you only need to know whether its complement (target − x) has already appeared. A hashmap answers "have I seen it, and where?" in O(1).',
  hints: [
    'Brute force checks every pair — O(n²). What question do you keep re-asking?',
    'For nums[i], the partner must be exactly target − nums[i].',
    'Store value → index as you go; before storing, look up the complement.',
  ],
  pitfall: 'Inserting the current number before checking lets an element pair with itself (e.g. target 6, nums[i] = 3).',
  backend: {
    title: 'Matching debits to credits in a ledger',
    detail:
      'A reconciliation job streams transactions and must find the counter-entry that nets a transfer to zero. Keeping amount → txn-id in a hash map turns an O(n²) cross-join into a single pass — the same trick as a hash join in a database.',
  },
  complexity: { time: 'O(n)', space: 'O(n)' },
  code: `
def twoSum(nums, target):
    seen = {}                          @init
    for i, n in enumerate(nums):       @loop
        diff = target - n              @diff
        if diff in seen:               @check
            return [seen[diff], i]     @found
        seen[n] = i                    @store
`,
  explain: {
    init: 'value → index of every number we have already passed.',
    loop: 'One pass: each element gets exactly one chance to find its partner among earlier elements.',
    diff: 'The only value that could complete the pair.',
    check: 'O(1) membership test — the whole point of the hashmap.',
    found: 'Earlier index first, current index second.',
    store: 'Store AFTER checking so an element never pairs with itself.',
  },
  distractors: [
    { text: '        for j in range(i + 1, len(nums)):', why: 'A nested loop brings back the O(n²) brute force — the hashmap already answers "is the partner earlier?".' },
    { text: '    nums.sort()', why: 'Sorting destroys the original indices we must return.' },
  ],
  input: { nums: [2, 7, 11, 15], target: 9 },
  presets: [
    { label: 'answer at the end', input: { nums: [3, 2, 4], target: 6 } },
    { label: 'duplicates', input: { nums: [3, 3], target: 6 } },
    { label: 'negatives', input: { nums: [-3, 4, 3, 90], target: 0 } },
  ],
  validate: ({ nums, target }) =>
    !Array.isArray(nums) || typeof target !== 'number' ? 'Expected { nums: number[], target: number }' : nums.length > 40 ? 'Keep nums ≤ 40 elements' : null,
  trace(t, { nums, target }) {
    const seen = new Map<number, number>();
    let i = -1;
    let hl: number[] = [];
    let found: number[] = [];
    t.draw(() => [
      V.array('nums', nums, { pointers: { i }, tones: { ...tones(found, 'good') } }),
      V.map('seen (value → index)', seen, { hl }),
    ]);
    t.step('init', 'Start with an empty hashmap: nothing has been seen yet.', { target });
    for (i = 0; i < nums.length; i++) {
      const n = nums[i];
      hl = [];
      t.step('loop', `Visit index ${i} (value ${n}).`, { i, n });
      const diff = target - n;
      t.step('diff', `Its partner would have to be ${target} − ${n} = ${diff}.`, { i, n, diff });
      if (i === 1) t.predict(`Is ${diff} already in seen?`, ['Yes', 'No'], seen.has(diff) ? 0 : 1, seen.has(diff) ? `${diff} was stored at index ${seen.get(diff)}.` : `seen only holds ${[...seen.keys()].join(', ') || 'nothing'}.`);
      hl = [diff];
      if (seen.has(diff)) {
        found = [seen.get(diff)!, i];
        t.step('check', `${diff} is in seen (index ${seen.get(diff)}) — pair found!`, { i, n, diff });
        t.step('found', `Return [${seen.get(diff)}, ${i}].`, { result: found });
        return found;
      }
      t.step('check', `${diff} has not been seen yet.`, { i, n, diff });
      seen.set(n, i);
      hl = [n];
      t.step('store', `Remember ${n} → ${i} so a later number can pair with it.`, { i, n, diff });
    }
    return null;
  },
};

const topKFrequent: Problem<{ nums: number[]; k: number }> = {
  id: 'top-k-frequent-elements',
  num: 347,
  title: 'Top K Frequent Elements',
  difficulty: 'Medium',
  category: 'arrays-hashing',
  pattern: 'hashing',
  statement: 'Return the k values that occur most often in an integer array. Any order is fine; the answer is unique.',
  signals: ['"k most frequent"', 'counting occurrences', 'better than O(n log n) asked', 'frequency is bounded by n'],
  insight:
    'Count with a hashmap, then bucket by frequency: bucket[f] = values seen f times. Frequencies are at most n, so walking buckets from high to low yields the top k in O(n) — no full sort needed.',
  hints: [
    'First answer "how many times does each value appear?"',
    'Sorting all counts is O(n log n). What is the largest possible count?',
    'Make an array of n+1 lists indexed by count and walk it backwards.',
  ],
  pitfall: 'Sizing buckets as len(count) instead of len(nums)+1 — a value can appear n times.',
  backend: {
    title: 'Top-k IPs hammering an API (rate limiting / abuse detection)',
    detail:
      'An API gateway counts requests per client IP over a window (hashmap: ip → hits), then needs the k heaviest callers to throttle or block. Bucketing by hit count (or a size-k heap when streaming) gives the offenders without sorting millions of IPs — the same idea powers "top endpoints" dashboards and heavy-hitter detection in log pipelines.',
  },
  complexity: { time: 'O(n)', space: 'O(n)' },
  code: `
def topKFrequent(nums, k):
    count = {}                                      @init
    for n in nums:                                  @countLoop
        count[n] = 1 + count.get(n, 0)              @inc
    freq = [[] for _ in range(len(nums) + 1)]       @buckets
    for n, c in count.items():                      @fillLoop
        freq[c].append(n)                           @fill
    res = []                                        @res
    for c in range(len(freq) - 1, 0, -1):           @scan
        for n in freq[c]:                           @each
            res.append(n)                           @take
            if len(res) == k:                       @check
                return res                          @done
`,
  explain: {
    init: 'Hashmap value → occurrences.',
    inc: 'O(1) update per element.',
    buckets: 'Index = frequency. Max possible frequency is len(nums).',
    fill: 'Every value lands in the bucket of its count.',
    scan: 'Walk from the highest frequency down: first k values seen are the answer.',
  },
  distractors: [
    { text: '    freq = sorted(count, key=count.get)', why: 'Sorting works but costs O(n log n); the bucket array exploits that counts are bounded by n.' },
    { text: '    for c in range(1, len(freq)):', why: 'Scanning from low to high frequency returns the LEAST frequent values first.' },
  ],
  input: { nums: [1, 1, 1, 2, 2, 3, 4, 4, 4, 4], k: 2 },
  presets: [
    { label: 'single element', input: { nums: [1], k: 1 } },
    { label: 'IP log (as ints)', input: { nums: [10, 20, 10, 30, 10, 20, 40, 20, 10], k: 2 } },
  ],
  validate: ({ nums, k }) =>
    !Array.isArray(nums) || typeof k !== 'number' ? 'Expected { nums: number[], k: number }' : nums.length > 30 ? 'Keep nums ≤ 30 elements' : k < 1 ? 'k must be ≥ 1' : null,
  trace(t, { nums, k }) {
    const count = new Map<number, number>();
    let freq: number[][] | null = null;
    const res: number[] = [];
    let i = -1;
    let hl: number[] = [];
    let bucket = -1;
    t.draw(() => [
      V.array('nums', nums, { pointers: { n: i } }),
      V.map('count (value → freq)', count, { hl }),
      freq && V.array('freq buckets (index = count)', freq.map((b) => (b.length ? b.join(',') : '·')), { pointers: { c: bucket }, tones: bucket > 0 ? { [bucket]: 'active' } : {} }),
      V.chips('res', res, { tones: tones(res.map((_, j) => j), 'good') }),
    ]);
    t.step('init', 'Empty frequency map.', { k });
    for (i = 0; i < nums.length; i++) {
      const n = nums[i];
      t.step('countLoop', `Read ${n}.`, { n });
      count.set(n, (count.get(n) ?? 0) + 1);
      hl = [n];
      t.step('inc', `count[${n}] is now ${count.get(n)}.`, { n, 'count[n]': count.get(n) });
    }
    i = -1;
    hl = [];
    freq = Array.from({ length: nums.length + 1 }, () => []);
    t.step('buckets', `Create ${nums.length + 1} buckets: a value can appear 0…${nums.length} times.`);
    for (const [n, c] of count) {
      hl = [n];
      bucket = c;
      freq[c].push(n);
      t.step('fill', `${n} appears ${c}× → bucket ${c}.`, { n, c });
    }
    hl = [];
    t.step('res', 'Now walk the buckets from the highest frequency down.');
    t.predict('Which bucket index does the scan start at?', ['0', '1', String(nums.length)], 2, `Highest possible frequency is len(nums) = ${nums.length}; we scan downwards.`);
    for (let c = freq.length - 1; c > 0; c--) {
      bucket = c;
      t.step('scan', freq[c].length ? `Bucket ${c} holds ${freq[c].join(', ')}.` : `Bucket ${c} is empty — skip.`, { c, 'len(res)': res.length });
      for (const n of freq[c]) {
        res.push(n);
        t.step('take', `Take ${n} (appears ${c}×).`, { c, n, res: [...res] });
        if (res.length === k) {
          t.step('done', `We have k = ${k} values — done.`, { res: [...res] });
          return res;
        }
      }
    }
    return res;
  },
};

const containsDuplicate: Problem<{ nums: number[] }> = {
  id: 'contains-duplicate',
  num: 217,
  title: 'Contains Duplicate',
  difficulty: 'Easy',
  category: 'arrays-hashing',
  pattern: 'hashing',
  statement: 'Given an integer array, report whether any value shows up more than once. Return True on the first repeat, False if every value is distinct.',
  signals: ['"appears at least twice" / "any repeats"', 'only need yes/no, not positions', 'unsorted input, O(n) wanted'],
  insight:
    'A value is a duplicate exactly when it is already in the set of values seen so far. A hash set answers that in O(1), so one pass is enough — no sorting, no pairs.',
  hints: [
    'Comparing every pair is O(n²). What do you need to remember about the elements you have passed?',
    'Only membership matters — not counts, not positions.',
    'Keep a set; before adding a value, check whether it is already there.',
  ],
  pitfall: 'Adding to the set before checking membership — then every value looks like a duplicate of itself.',
  backend: {
    title: 'Idempotent message consumers (dedup by message id)',
    detail:
      'Kafka/SQS deliver at-least-once, so a payment consumer keeps a set of processed message ids (Redis SET or a UNIQUE index). Each incoming id is checked before handling — "already in the set" means a redelivery to drop, exactly this loop.',
  },
  complexity: { time: 'O(n)', space: 'O(n)' },
  code: `
def containsDuplicate(nums):
    seen = set()              @init
    for n in nums:            @loop
        if n in seen:         @check
            return True       @found
        seen.add(n)           @add
    return False              @none
`,
  explain: {
    init: 'Every value we have already walked past.',
    check: 'O(1) membership test — the reason we use a set instead of a list.',
    found: 'Early exit: one repeat is enough to answer.',
    add: 'Remember n only after checking it, so it cannot match itself.',
    none: 'Finished the pass without a single repeat.',
  },
  distractors: [
    { text: '        if nums.count(n) > 1:', why: 'list.count scans the whole array each time — O(n²) overall, the brute force in disguise.' },
    { text: '    seen = []', why: 'Membership in a list is O(n); the set gives O(1) lookups.' },
    { text: '        seen.add(n)\n        if n in seen:', why: 'Adding before checking makes every element "seen" — always returns True.' },
  ],
  input: { nums: [1, 2, 3, 1] },
  presets: [
    { label: 'all distinct', input: { nums: [1, 2, 3, 4] } },
    { label: 'repeat at the end', input: { nums: [4, 7, 2, 9, 5, 7] } },
    { label: 'empty', input: { nums: [] } },
  ],
  validate: ({ nums }) => (!Array.isArray(nums) ? 'Expected { nums: number[] }' : nums.length > 30 ? 'Keep nums ≤ 30 elements' : null),
  trace(t, { nums }) {
    const seen = new Set<number>();
    let i = -1;
    let hl: number[] = [];
    let dup: number[] = [];
    let asked = 0;
    t.draw(() => [
      V.array('nums', nums, { pointers: { i }, tones: { ...tones(range(0, Math.min(i, nums.length)), 'muted'), ...tones(dup, 'bad') } }),
      V.set('seen', seen, { hl, tones: dup.length ? { [String(nums[dup[0]])]: 'bad' } : {} }),
    ]);
    t.step('init', 'Start with an empty set: nothing has been seen yet.');
    for (i = 0; i < nums.length; i++) {
      const n = nums[i];
      hl = [];
      t.step('loop', `Look at nums[${i}] = ${n}.`, { i, n });
      const has = seen.has(n);
      if (asked < 3 && (i === 1 || has)) {
        asked++;
        t.predict(`Is ${n} already in seen?`, ['Yes', 'No'], has ? 0 : 1, has ? `${n} was added when we passed index ${nums.indexOf(n)}.` : `seen only holds {${[...seen].join(', ')}}.`);
      }
      hl = [n];
      if (has) {
        dup = [nums.indexOf(n), i];
        t.step('check', `${n} is already in seen — it appeared at index ${dup[0]}.`, { i, n });
        t.step('found', 'One repeat is enough: return True without looking further.', { result: true });
        return true;
      }
      t.step('check', `${n} is not in seen — no repeat yet.`, { i, n });
      seen.add(n);
      t.step('add', `Add ${n} so a later copy will be caught.`, { i, n, 'len(seen)': seen.size });
    }
    hl = [];
    t.step('loop', 'No elements left to visit.', { i });
    t.step('none', 'Every value was new when we met it — no duplicates.', { result: false });
    return false;
  },
};

const validAnagram: Problem<{ s: string; t: string }> = {
  id: 'valid-anagram',
  num: 242,
  title: 'Valid Anagram',
  difficulty: 'Easy',
  category: 'arrays-hashing',
  pattern: 'hashing',
  statement: 'Decide whether string t uses exactly the same letters as string s, each the same number of times, just possibly rearranged.',
  signals: ['"rearrangement" / "same characters"', 'order does not matter, counts do', 'multiset equality'],
  insight:
    'Two strings are anagrams iff their character counts match. Add 1 for each char of s and subtract 1 for each char of t in one map — every count must end at 0.',
  hints: [
    'If the lengths differ, can they be anagrams?',
    'Sorting both works (O(n log n)). What do you actually need to compare?',
    'One counter map: +1 for s[i], −1 for t[i]; then check all zeros.',
  ],
  pitfall: 'Only checking that every char of t exists in s — "aab" vs "abb" passes that test but the counts differ.',
  backend: {
    title: 'Verifying a re-shard moved every record exactly once',
    detail:
      'After a migration job re-partitions orders across shards, a verifier streams record ids from the source (+1) and the destination (−1) into one hashmap. Any non-zero entry is a lost or duplicated record — order-insensitive multiset equality, no sort of millions of ids needed.',
  },
  complexity: { time: 'O(n)', space: 'O(1) — at most 26 keys' },
  code: `
def isAnagram(s, t):
    if len(s) != len(t):                           @len
        return False                               @lenFail
    count = {}                                     @init
    for i in range(len(s)):                        @loop
        count[s[i]] = count.get(s[i], 0) + 1       @inc
        count[t[i]] = count.get(t[i], 0) - 1       @dec
    for c in count.values():                       @scan
        if c != 0:                                 @check
            return False                           @fail
    return True                                    @ok
`,
  explain: {
    len: 'Different lengths can never be rearrangements of each other — O(1) early exit.',
    inc: 's contributes +1 per character…',
    dec: '…and t cancels it with −1. A perfect anagram cancels to 0 everywhere.',
    check: 'A positive count means s has extra copies; negative means t does.',
  },
  distractors: [
    { text: '        if t[i] not in s:', why: 'Membership ignores multiplicity: "aab" vs "abb" would pass.' },
    { text: '    return set(s) == set(t)', why: 'Sets drop counts — "aaab" and "ab" have the same set.' },
    { text: '        count[t[i]] = count.get(t[i], 0) + 1', why: 'Adding for t too means nothing ever cancels — counts are never 0.' },
  ],
  input: { s: 'anagram', t: 'nagaram' },
  presets: [
    { label: 'same letters, wrong counts', input: { s: 'aab', t: 'abb' } },
    { label: 'different length', input: { s: 'rat', t: 'rats' } },
    { label: 'not an anagram', input: { s: 'rat', t: 'car' } },
  ],
  validate: (inp) =>
    typeof inp.s !== 'string' || typeof inp.t !== 'string' ? 'Expected { s: string, t: string }' : inp.s.length > 16 || inp.t.length > 16 ? 'Keep strings ≤ 16 characters' : null,
  trace(t, { s, t: u }) {
    const count = new Map<string, number>();
    let i = -1;
    let hl: string[] = [];
    let bad: string[] = [];
    t.draw(() => [
      V.text('s', s, { tones: i >= 0 && i < s.length ? { [i]: 'active' } : {} }),
      V.text('t', u, { tones: i >= 0 && i < u.length ? { [i]: 'active' } : {} }),
      V.map('count (char → s minus t)', count, { hl, tones: tones(bad, 'bad') }),
    ]);
    t.step(null, `Compare s = '${s}' with t = '${u}'.`);
    t.step('len', `len(s) = ${s.length}, len(t) = ${u.length}.`, { 'len(s)': s.length, 'len(t)': u.length });
    if (s.length !== u.length) {
      t.step('lenFail', 'Lengths differ, so some character count must differ — not an anagram.', { result: false });
      return false;
    }
    t.step('init', 'Lengths match. One map will hold (count in s) − (count in t) for each character.');
    for (i = 0; i < s.length; i++) {
      hl = [];
      t.step('loop', `Position ${i}: s[${i}] = '${s[i]}', t[${i}] = '${u[i]}'.`, { i });
      count.set(s[i], (count.get(s[i]) ?? 0) + 1);
      hl = [s[i]];
      t.step('inc', `s adds one '${s[i]}' → count['${s[i]}'] = ${count.get(s[i])}.`, { i, 's[i]': s[i] });
      if (i === Math.min(3, s.length - 1)) {
        const before = count.get(u[i]) ?? 0;
        ask(t, `count['${u[i]}'] is ${before}. What will it be after t[${i}] = '${u[i]}' is subtracted?`, String(before - 1), [String(before), String(before + 1)], 't removes one copy, so the count drops by exactly 1.');
      }
      count.set(u[i], (count.get(u[i]) ?? 0) - 1);
      hl = [u[i]];
      t.step('dec', `t cancels one '${u[i]}' → count['${u[i]}'] = ${count.get(u[i])}.`, { i, 't[i]': u[i] });
    }
    i = -1;
    hl = [];
    const allZero = [...count.values()].every((c) => c === 0);
    t.step('scan', 'Both strings consumed. Now every count must be 0.');
    t.predict('Will every count in the map be 0?', ['Yes', 'No'], allZero ? 0 : 1, allZero ? 'Each +1 from s was cancelled by a −1 from t.' : `Some character appears a different number of times: ${[...count].filter(([, c]) => c !== 0).map(([k, c]) => `${k}:${c}`).join(', ')}.`);
    for (const [ch, c] of count) {
      hl = [ch];
      if (c !== 0) {
        bad = [ch];
        t.step('check', `count['${ch}'] = ${c} ≠ 0 — ${c > 0 ? 's' : 't'} has extra '${ch}'.`, { ch, c });
        t.step('fail', 'Counts differ, so t is not a rearrangement of s.', { result: false });
        return false;
      }
      t.step('check', `count['${ch}'] = 0 — balanced.`, { ch, c });
    }
    hl = [];
    t.step('ok', 'Every character balanced out: t is an anagram of s.', { result: true });
    return true;
  },
};

const groupAnagrams: Problem<{ strs: string[] }> = {
  id: 'group-anagrams',
  num: 49,
  title: 'Group Anagrams',
  difficulty: 'Medium',
  category: 'arrays-hashing',
  pattern: 'hashing',
  statement: 'Given a list of lowercase words, gather the words that are rearrangements of each other into the same group. Return the groups in any order.',
  signals: ['"group" items that are equivalent under some rule', 'anagrams → letter counts', 'need a canonical key per item'],
  insight:
    'Give every word a canonical key that all of its anagrams share — its 26 letter counts (or its sorted letters). Then grouping is just a hashmap key → list.',
  hints: [
    'What property is identical for "eat", "tea" and "ate"?',
    'Turn that property into something hashable you can use as a dict key.',
    'A tuple of 26 counts is O(k) per word, cheaper than sorting each word.',
  ],
  pitfall: 'Using the list `count` itself as a dict key — lists are unhashable in Python; convert to a tuple.',
  backend: {
    title: 'Grouping error events by fingerprint (Sentry-style)',
    detail:
      'An error tracker receives thousands of events whose stack traces differ only in volatile parts (ids, line offsets). It normalises each event to a fingerprint and appends it to map[fingerprint] — one hashmap pass turns a flood of events into a handful of issues. The 26-count tuple is the fingerprint here.',
  },
  complexity: { time: 'O(n·k)', space: 'O(n·k)' },
  code: `
def groupAnagrams(strs):
    res = defaultdict(list)                  @init
    for s in strs:                           @loop
        count = [0] * 26                     @zero
        for c in s:                          @charLoop
            count[ord(c) - ord("a")] += 1    @inc
        res[tuple(count)].append(s)          @group
    return list(res.values())                @done
`,
  explain: {
    init: 'canonical key → list of words that share it.',
    zero: 'Fresh letter histogram for each word.',
    inc: 'Map the letter to 0..25 and count it.',
    group: 'All anagrams produce the same tuple, so they land in the same list.',
  },
  distractors: [
    { text: '        res[count].append(s)', why: 'A list is mutable and unhashable — it cannot be a dict key; use tuple(count).' },
    { text: '    count = [0] * 26', why: 'Creating the histogram once outside the loop keeps adding counts from previous words.' },
    { text: '        res[len(s)].append(s)', why: 'Same length is necessary but not sufficient — "tan" and "bat" would be grouped.' },
  ],
  input: { strs: ['eat', 'tea', 'tan', 'ate', 'nat', 'bat'] },
  presets: [
    { label: 'single empty word', input: { strs: [''] } },
    { label: 'no anagrams', input: { strs: ['abc', 'abd', 'xyz'] } },
  ],
  validate: ({ strs }) =>
    !Array.isArray(strs) || strs.some((w) => typeof w !== 'string' || !/^[a-z]*$/.test(w))
      ? 'Expected { strs: string[] } of lowercase letters'
      : strs.length > 10 || strs.some((w) => w.length > 8)
        ? 'Keep ≤ 10 words of ≤ 8 letters'
        : null,
  trace(t, { strs }) {
    const res = new Map<string, string[]>();
    let i = -1;
    let j = -1;
    let count: number[] | null = null;
    let hl: string[] = [];
    const key = (cnt: number[]) => cnt.map((c, k) => (c ? String.fromCharCode(97 + k) + c : '')).join('') || '∅';
    t.draw(() => [
      V.array('strs', strs, { pointers: { s: i } }),
      i >= 0 && i < strs.length && V.text('s', strs[i], { tones: j >= 0 ? { [j]: 'active' } : {}, caption: strs[i] ? undefined : '(empty string)' }),
      count && V.map('count (non-zero letters only)', count.map((c, k) => [String.fromCharCode(97 + k), c] as const).filter(([, c]) => c > 0), { hl: j >= 0 ? [strs[i][j]] : [], caption: 'the other letters are 0' }),
      V.map('res (count key → words)', res, { hl }),
    ]);
    t.step('init', 'Empty map from canonical key → group of words.');
    for (i = 0; i < strs.length; i++) {
      const s = strs[i];
      j = -1;
      count = null;
      hl = [];
      t.step('loop', `Next word: '${s}'.`, { s });
      count = new Array<number>(26).fill(0);
      t.step('zero', 'Fresh 26-slot histogram for this word.', { s });
      for (j = 0; j < s.length; j++) {
        count[s.charCodeAt(j) - 97]++;
        t.step('inc', `'${s[j]}' → slot ${s.charCodeAt(j) - 97}, now ${count[s.charCodeAt(j) - 97]}.`, { s, c: s[j] });
      }
      j = -1;
      const k = key(count);
      if (i === 1 || i === 2 || i === 4) {
        const existing = [...res.keys()];
        ask(t, `'${s}' has key ${k}. Where does it go?`, res.has(k) ? `existing group ${k}` : 'new group', ['new group', ...existing.map((e) => `existing group ${e}`)], res.has(k) ? `${res.get(k)!.join(', ')} already produced key ${k}.` : `No earlier word has exactly these letter counts.`);
      }
      const isNew = !res.has(k);
      if (isNew) res.set(k, []);
      res.get(k)!.push(s);
      hl = [k];
      t.step('group', isNew ? `Key ${k} is new — start a group for '${s}'.` : `Key ${k} exists — '${s}' joins ${res.get(k)!.slice(0, -1).join(', ')}.`, { s, key: k });
    }
    i = -1;
    count = null;
    hl = [];
    const out = [...res.values()];
    t.step('done', `${out.length} group(s): the map values are the answer.`, { result: out });
    return out;
  },
};

const encodeDecode: Problem<{ strs: string[] }> = {
  id: 'encode-and-decode-strings',
  num: 271,
  title: 'Encode and Decode Strings',
  difficulty: 'Medium',
  category: 'arrays-hashing',
  pattern: 'design',
  statement: 'Design encode(list of strings) → one string and decode(that string) → the original list. The strings may contain any character, including whatever separator you would like to use.',
  signals: ['"strings may contain any character"', 'serialize a list into one string and back', 'delimiter could appear inside the data'],
  insight:
    'A delimiter alone is ambiguous when it can appear in the data. Prefix each string with its length and a marker: the decoder reads the length, then takes exactly that many characters — it never has to interpret the payload.',
  hints: [
    'Why does joining with "," fail? Try a string that contains ",".',
    'What if the decoder knew how many characters to read next?',
    'Write len(s) + "#" + s; decode by reading digits up to "#", then slice length chars.',
  ],
  pitfall: 'Searching for the next "#" after the payload start (or splitting on "#") — the payload itself may contain "#" or digits.',
  backend: {
    title: 'Length-prefixed framing in wire protocols (Redis RESP, Kafka, HTTP/2)',
    detail:
      'Redis sends bulk strings as "$5\\r\\nhello", Kafka and gRPC prefix every message with its byte length, and HTTP/2 frames start with a 24-bit length. The reader learns how many bytes to consume before touching the payload, so binary data containing the delimiter can never break framing — exactly this encoder.',
  },
  complexity: { time: 'O(total length)', space: 'O(total length)' },
  code: `
def encode(strs):
    res = ""                                    @eInit
    for s in strs:                              @eLoop
        res += str(len(s)) + "#" + s            @eAppend
    return res                                  @eDone

def decode(s):
    res, i = [], 0                              @dInit
    while i < len(s):                           @dLoop
        j = i                                   @dJ
        while s[j] != "#":                      @scanLen
            j += 1                              @adv
        length = int(s[i:j])                    @len
        res.append(s[j + 1 : j + 1 + length])   @take
        i = j + 1 + length                      @jump
    return res                                  @dDone
`,
  explain: {
    eAppend: 'Header = length + "#". The "#" only marks where the digits end.',
    scanLen: 'Only the header is scanned for "#": it is all digits, so the first "#" is ours.',
    len: 'Now we know exactly how many payload characters follow.',
    take: 'Slice blindly — "#" or digits inside the payload are irrelevant.',
    jump: 'Skip the whole payload; i lands on the next header.',
  },
  distractors: [
    { text: '    return s.split("#")', why: 'Splitting on the delimiter breaks as soon as a string contains "#".' },
    { text: '        res += s + "#"', why: 'Delimiter-only encoding is ambiguous when the data contains the delimiter.' },
    { text: '        i = j + length', why: 'Off by one: forgets to skip the "#" itself, so i lands one char early.' },
  ],
  input: { strs: ['lint', 'co#de', '4you'] },
  presets: [
    { label: 'empty strings', input: { strs: ['', 'a', ''] } },
    { label: 'empty list', input: { strs: [] } },
    { label: 'digits and #', input: { strs: ['12#', '#3'] } },
  ],
  validate: ({ strs }) =>
    !Array.isArray(strs) || strs.some((w) => typeof w !== 'string')
      ? 'Expected { strs: string[] }'
      : strs.reduce((a, w) => a + w.length + String(w.length).length + 1, 0) > 40
        ? 'Keep the encoded string ≤ 40 characters'
        : null,
  trace(t, { strs }) {
    let phase: 'encode' | 'decode' = 'encode';
    let enc = '';
    let k = -1;
    let i = 0;
    let j = -1;
    const res: string[] = [];
    const header: number[] = [];
    const payload: number[] = [];
    let askedTake = false;
    let askedJump = false;
    t.draw(() =>
      phase === 'encode'
        ? [V.array('strs', strs, { pointers: { s: k } }), V.text('encoded', enc, { caption: enc ? undefined : '(empty)' })]
        : [
            V.array('s (encoded)', enc.split(''), {
              pointers: { i: i < enc.length ? i : enc.length, j },
              tones: { ...tones(header, 'warn'), ...tones(payload, 'good') },
            }),
            V.chips('res (decoded)', res.map((x) => `'${x}'`)),
          ],
    );
    t.step('eInit', 'Encoding: start with an empty output string.');
    for (k = 0; k < strs.length; k++) {
      t.step('eLoop', `Next string: '${strs[k]}' (length ${strs[k].length}).`, { s: strs[k] });
      enc += `${strs[k].length}#${strs[k]}`;
      t.step('eAppend', `Append header "${strs[k].length}#" then the raw text. The decoder will trust the length, not the content.`, { res: enc });
    }
    k = -1;
    t.step('eDone', `Encoded: "${enc}".`, { res: enc });
    phase = 'decode';
    i = 0;
    t.step('dInit', 'Decoding: i always points at the start of a header.', { i });
    for (;;) {
      t.step('dLoop', i < enc.length ? `i = ${i} < ${enc.length}: another string follows.` : `i = ${i} reached the end — done.`, { i });
      if (i >= enc.length) break;
      j = i;
      t.step('dJ', 'j scans forward over the length digits.', { i, j });
      while (enc[j] !== '#') {
        t.step('scanLen', `s[${j}] = '${enc[j]}' is a digit, not "#".`, { i, j });
        header.push(j);
        j++;
        t.step('adv', `Move j to ${j}.`, { i, j });
      }
      header.push(j);
      t.step('scanLen', `s[${j}] = "#": the header ends here.`, { i, j });
      const length = Number(enc.slice(i, j));
      const piece = enc.slice(j + 1, j + 1 + length);
      t.step('len', `Header digits "${enc.slice(i, j)}" → the next string has ${length} characters.`, { i, j, length });
      if (!askedTake && (piece.includes('#') || res.length === strs.length - 1)) {
        askedTake = true;
        const untilHash = enc.slice(j + 1).split('#')[0];
        ask(t, 'Which string does the decoder take next?', `'${piece}'`, [`'${untilHash}'`, `'${enc.slice(i, j + 1 + length)}'`, `'${piece.slice(0, Math.max(0, length - 1))}'`], `It slices exactly ${length} characters after the "#", ignoring whatever they contain.`);
      }
      res.push(piece);
      payload.push(...range(j + 1, j + 1 + length));
      t.step('take', `Slice s[${j + 1}:${j + 1 + length}] = '${piece}'.`, { length, res: [...res] });
      const next = j + 1 + length;
      if (!askedJump && res.length === 1) {
        askedJump = true;
        ask(t, 'Where does i land next?', String(next), [String(j + 1), String(i + length), String(next + 1)].filter((x) => x !== String(next)), `i = j + 1 + length = ${j} + 1 + ${length}: skip the "#" and the whole payload.`);
      }
      i = next;
      j = -1;
      t.step('jump', `Jump i to ${i}, the start of the next header.`, { i });
    }
    t.step('dDone', `Decoded ${res.length} string(s) — identical to the input.`, { result: [...res] });
    return res;
  },
};

const productExceptSelf: Problem<{ nums: number[] }> = {
  id: 'product-of-array-except-self',
  num: 238,
  title: 'Product of Array Except Self',
  difficulty: 'Medium',
  category: 'arrays-hashing',
  pattern: 'prefix-sum',
  statement: 'For every position in an integer array, output the product of all the other elements. Do it in O(n) without using division.',
  signals: ['"all elements except self"', 'no division allowed', 'O(n) → prefix / suffix aggregates'],
  insight:
    'answer[i] = (product of everything left of i) × (product of everything right of i). One left-to-right pass writes the prefix products, a right-to-left pass multiplies in the suffix products.',
  hints: [
    'Why is division a bad idea? (Think zeros.)',
    'Split "everything except i" into "everything before i" and "everything after i".',
    'Running prefix product left→right into res, then a running suffix product right→left.',
  ],
  pitfall: 'Updating prefix before writing res[i] — that includes nums[i] in its own product.',
  backend: {
    title: '"What if this hop were perfect?" in a serial call chain',
    detail:
      'A checkout request passes through gateway → auth → cart → payments → ledger; end-to-end availability is the product of each hop\'s availability. To rank which service to harden, SREs compute, for every hop i, the availability of all OTHER hops — prefix × suffix products give all n answers in two passes instead of n² multiplications.',
  },
  complexity: { time: 'O(n)', space: 'O(1) extra (output excluded)' },
  code: `
def productExceptSelf(nums):
    res = [1] * len(nums)                     @init
    prefix = 1                                @pre0
    for i in range(len(nums)):                @preLoop
        res[i] = prefix                       @preSet
        prefix *= nums[i]                     @preMul
    suffix = 1                                @suf0
    for i in range(len(nums) - 1, -1, -1):    @sufLoop
        res[i] *= suffix                      @sufSet
        suffix *= nums[i]                     @sufMul
    return res                                @done
`,
  explain: {
    preSet: 'prefix = product of nums[0..i-1] — strictly left of i.',
    preMul: 'Only now fold nums[i] in, ready for i+1.',
    sufSet: 'suffix = product of nums[i+1..] — strictly right of i. Multiply it into the left product.',
    sufMul: 'Fold nums[i] in for the element to its left.',
  },
  distractors: [
    { text: '        res[i] = total // nums[i]', why: 'Division is forbidden and crashes (or is wrong) when nums contains 0.' },
    { text: '        prefix *= nums[i]\n        res[i] = prefix', why: 'Wrong order: res[i] would include nums[i] itself.' },
    { text: '    for i in range(len(nums)):\n        res[i] *= suffix', why: 'The suffix pass must run right→left so suffix holds the elements AFTER i.' },
  ],
  input: { nums: [1, 2, 3, 4] },
  presets: [
    { label: 'one zero', input: { nums: [-1, 1, 0, -3, 3] } },
    { label: 'two zeros', input: { nums: [0, 2, 0] } },
  ],
  validate: ({ nums }) =>
    !Array.isArray(nums) ? 'Expected { nums: number[] }' : nums.length < 2 ? 'Need at least 2 numbers' : nums.length > 10 ? 'Keep nums ≤ 10 elements' : null,
  trace(t, { nums }) {
    const n = nums.length;
    const res: number[] = [];
    let i = -1;
    let pass: 'pre' | 'suf' | null = null;
    let prefix = 1;
    let suffix = 1;
    const cover = (): Record<number, Tone> =>
      pass === 'pre' ? tones(range(0, i), 'info') : pass === 'suf' ? tones(range(i + 1, n), 'warn') : {};
    t.draw(() => [
      V.array('nums', nums, {
        pointers: { i },
        tones: { ...cover(), ...(i >= 0 && i < n ? { [i]: 'active' as Tone } : {}) },
        caption: pass === 'pre' ? 'blue = folded into prefix' : pass === 'suf' ? 'amber = folded into suffix' : undefined,
      }),
      V.array('res', res, { pointers: { i }, tones: i >= 0 && i < n ? { [i]: 'active' } : pass === null && res.length ? tones(range(0, n), 'good') : {} }),
    ]);
    for (let k = 0; k < n; k++) res.push(1);
    t.step('init', 'res starts as all 1s — the neutral element for multiplication.');
    t.step('pre0', 'prefix = 1: the product of "nothing to the left" of index 0.', { prefix });
    pass = 'pre';
    for (i = 0; i < n; i++) {
      t.step('preLoop', `Left→right, i = ${i}.`, { i, prefix });
      res[i] = prefix;
      t.step('preSet', `res[${i}] = prefix = ${prefix}: product of everything LEFT of index ${i}.`, { i, prefix });
      if (i === 1) ask(t, `prefix is ${prefix}. What is it after multiplying nums[${i}] = ${nums[i]}?`, String(prefix * nums[i]), [String(prefix), String(nums[i]), String(prefix + nums[i])], 'prefix now has to include nums[i] so that index i+1 sees everything to its left.');
      prefix *= nums[i];
      t.step('preMul', `prefix *= ${nums[i]} → ${prefix}, ready for index ${i + 1}.`, { i, prefix });
    }
    pass = null;
    i = -1;
    t.step('suf0', 'res now holds left products. suffix = 1: nothing is to the right of the last index.', { suffix });
    pass = 'suf';
    for (i = n - 1; i >= 0; i--) {
      t.step('sufLoop', `Right→left, i = ${i}.`, { i, suffix, 'res[i]': res[i] });
      if (i === n - 2) ask(t, `res[${i}] = ${res[i]} (left product), suffix = ${suffix}. What is res[${i}] after this step?`, String(res[i] * suffix), [String(res[i]), String(suffix), String(res[i] * suffix * nums[i])], `left product × right product = ${res[i]} × ${suffix}; nums[${i}] itself is excluded.`);
      res[i] *= suffix;
      t.step('sufSet', `res[${i}] *= suffix → ${res[i]} (left × right of ${i}).`, { i, suffix, 'res[i]': res[i] });
      suffix *= nums[i];
      t.step('sufMul', `suffix *= ${nums[i]} → ${suffix}, for index ${i - 1}.`, { i, suffix });
    }
    pass = null;
    t.step('done', 'Each res[i] = product of all other elements, no division used.', { result: [...res] });
    return res;
  },
};

type Board = string[][];

const SUDOKU_VALID: Board = [
  ['5', '3', '.', '.', '7', '.', '.', '.', '.'],
  ['6', '.', '.', '1', '9', '5', '.', '.', '.'],
  ['.', '9', '8', '.', '.', '.', '.', '6', '.'],
  ['8', '.', '.', '.', '6', '.', '.', '.', '3'],
  ['4', '.', '.', '8', '.', '3', '.', '.', '1'],
  ['7', '.', '.', '.', '2', '.', '.', '.', '6'],
  ['.', '6', '.', '.', '.', '.', '2', '8', '.'],
  ['.', '.', '.', '4', '1', '9', '.', '.', '5'],
  ['.', '.', '.', '.', '8', '.', '.', '7', '9'],
];

const validSudoku: Problem<{ board: Board }> = {
  id: 'valid-sudoku',
  num: 36,
  title: 'Valid Sudoku',
  difficulty: 'Medium',
  category: 'arrays-hashing',
  pattern: 'hashing',
  statement: 'Check whether a partially filled 9×9 Sudoku board breaks the rules so far: no digit may repeat within a row, a column, or one of the nine 3×3 boxes. Empty cells are ".". Solvability does not matter.',
  signals: ['"no repeats" in several overlapping groups', 'fixed-size grid', 'each cell belongs to a row, a column and a box'],
  insight:
    'Keep one hash set per row, per column and per box. A digit is illegal iff it is already in any of the three sets for its cell; the box id is (r // 3, c // 3).',
  hints: [
    'Checking each row, column and box separately works — can you do it in one sweep?',
    'Each cell belongs to exactly three groups. What do you need to remember per group?',
    'rows[r], cols[c], boxes[(r//3, c//3)] as sets; check, then add.',
  ],
  pitfall: 'Computing the box as r // 3 + c // 3 — boxes (0,1) and (1,0) collide. Use a tuple (or r//3*3 + c//3).',
  backend: {
    title: 'Composite uniqueness constraints in a booking service',
    detail:
      'A shift-scheduling API must reject a booking if the employee is already booked in that slot, the room is already used in that slot, or the team exceeds one on-call per day. Each rule is a hash set keyed by its dimension (like a composite UNIQUE index); an insert checks all of them and then adds to all — the same three-set check per cell.',
  },
  complexity: { time: 'O(81) = O(1)', space: 'O(81) = O(1)' },
  code: `
def isValidSudoku(board):
    rows, cols = defaultdict(set), defaultdict(set)       @init
    boxes = defaultdict(set)
    for r in range(9):                                    @rLoop
        for c in range(9):                                @cLoop
            v = board[r][c]
            if v == ".":                                  @skip
                continue
            box = (r // 3, c // 3)                        @box
            if v in rows[r] or v in cols[c] or v in boxes[box]:   @check
                return False                              @fail
            rows[r].add(v)                                @add
            cols[c].add(v)
            boxes[box].add(v)
    return True                                           @ok
`,
  explain: {
    init: 'One set per row, per column and per 3×3 box.',
    skip: 'Empty cells constrain nothing.',
    box: 'Integer division maps the 9×9 grid onto a 3×3 grid of boxes.',
    check: 'The digit may not already be in ANY of its three groups.',
    add: 'Record the digit in all three groups so later cells can be checked against it.',
  },
  distractors: [
    { text: '            box = r // 3 + c // 3', why: 'Sum collides: box (0,1) and (1,0) both give 1, mixing unrelated boxes.' },
    { text: '            if v in rows[r] and v in cols[c] and v in boxes[box]:', why: '"and" only rejects a digit repeated in all three groups at once — one repeat is already illegal.' },
    { text: '            box = (r % 3, c % 3)', why: 'Modulo gives the position INSIDE a box, not which box the cell is in.' },
  ],
  input: { board: SUDOKU_VALID },
  presets: [
    {
      label: 'box conflict',
      input: {
        board: [
          ['8', '3', '.', '.', '7', '.', '.', '.', '.'],
          ['6', '.', '.', '1', '9', '5', '.', '.', '.'],
          ['.', '9', '8', '.', '.', '.', '.', '6', '.'],
          ['8', '.', '.', '.', '6', '.', '.', '.', '3'],
          ['4', '.', '.', '8', '.', '3', '.', '.', '1'],
          ['7', '.', '.', '.', '2', '.', '.', '.', '6'],
          ['.', '6', '.', '.', '.', '.', '2', '8', '.'],
          ['.', '.', '.', '4', '1', '9', '.', '.', '5'],
          ['.', '.', '.', '.', '8', '.', '.', '7', '9'],
        ],
      },
    },
    {
      label: 'row conflict',
      input: {
        board: [
          ['1', '.', '.', '.', '.', '.', '.', '.', '1'],
          ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
          ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
          ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
          ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
          ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
          ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
          ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
          ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
        ],
      },
    },
  ],
  validate: ({ board }) =>
    !Array.isArray(board) || board.length !== 9 || board.some((row) => !Array.isArray(row) || row.length !== 9 || row.some((x) => typeof x !== 'string' || !/^[1-9.]$/.test(x)))
      ? 'Expected a 9×9 board of "1"–"9" or "."'
      : null,
  trace(t, { board }) {
    const rows = Array.from({ length: 9 }, () => new Set<string>());
    const cols = Array.from({ length: 9 }, () => new Set<string>());
    const boxes = Array.from({ length: 9 }, () => new Set<string>());
    let cur: [number, number] | null = null;
    let showUnits = false;
    let conflict: [number, number][] = [];
    let v = '';
    const boxIdx = (r: number, c: number) => Math.floor(r / 3) * 3 + Math.floor(c / 3);
    const boxName = (r: number, c: number) => `(${Math.floor(r / 3)}, ${Math.floor(c / 3)})`;
    const gridTones = (): Record<string, Tone> => {
      const out: Record<string, Tone> = {};
      if (cur) {
        const [r, c] = cur;
        if (showUnits) {
          for (let x = 0; x < 9; x++)
            for (let y = 0; y < 9; y++)
              if (board[x][y] !== '.' && (x < r || (x === r && y < c)) && (x === r || y === c || boxIdx(x, y) === boxIdx(r, c))) out[rc(x, y)] = 'info';
        }
        out[rc(r, c)] = 'active';
      }
      for (const [x, y] of conflict) out[rc(x, y)] = 'bad';
      return out;
    };
    t.draw(() => [
      V.grid('board', board, { tones: gridTones(), pointers: { cell: cur }, caption: showUnits ? 'blue = earlier digits in the same row / column / box' : undefined }),
      cur && V.set(`rows[${cur[0]}]`, rows[cur[0]], { hl: [v] }),
      cur && V.set(`cols[${cur[1]}]`, cols[cur[1]], { hl: [v] }),
      cur && V.set(`boxes[${boxName(cur[0], cur[1])}]`, boxes[boxIdx(cur[0], cur[1])], { hl: [v] }),
    ]);
    t.step('init', 'One empty set for each row, column and box.');
    let filled = 0;
    let askedRepeat = false;
    let askedBox = false;
    for (let r = 0; r < 9; r++) {
      cur = null;
      t.step('rLoop', `Row ${r}: scan its 9 cells (empty "." cells are skipped silently).`, { r });
      for (let c = 0; c < 9; c++) {
        v = board[r][c];
        if (v === '.') continue;
        filled++;
        cur = [r, c];
        showUnits = false;
        t.step('cLoop', `Cell (${r}, ${c}) holds ${v}.`, { r, c, v });
        if (!askedBox && r >= 3 && c >= 6) {
          askedBox = true;
          const br = Math.floor(r / 3);
          const bc = Math.floor(c / 3);
          ask(t, `Which box does cell (${r}, ${c}) belong to?`, `(${br}, ${bc})`, [`(${r % 3}, ${c % 3})`, `(${bc}, ${br})`, `(${br + bc}, 0)`], `box = (r // 3, c // 3) = (${r} // 3, ${c} // 3). r % 3 would be the position inside the box.`);
        }
        t.step('box', `It belongs to box ${boxName(r, c)}.`, { r, c, v, box: boxName(r, c) });
        const bad = rows[r].has(v) || cols[c].has(v) || boxes[boxIdx(r, c)].has(v);
        if (!askedRepeat) {
          let prev: [number, number] | null = null;
          for (let x = 0; x <= r && !prev; x++) for (let y = 0; y < 9 && !prev; y++) if ((x < r || y < c) && board[x][y] === v) prev = [x, y];
          if (prev) {
            askedRepeat = true;
            t.predict(`${v} already appears at (${prev[0]}, ${prev[1]}). Is (${r}, ${c}) a conflict?`, ['Yes', 'No'], bad ? 0 : 1, bad ? 'They share a row, column or box.' : `Different row, different column and different box (${boxName(prev[0], prev[1])} vs ${boxName(r, c)}) — repeats elsewhere on the board are fine.`);
          }
        }
        showUnits = true;
        if (bad) {
          for (let x = 0; x < 9; x++)
            for (let y = 0; y < 9; y++)
              if ((x < r || (x === r && y < c)) && board[x][y] === v && (x === r || y === c || boxIdx(x, y) === boxIdx(r, c))) conflict.push([x, y]);
          conflict.push([r, c]);
          const where = rows[r].has(v) ? `row ${r}` : cols[c].has(v) ? `column ${c}` : `box ${boxName(r, c)}`;
          t.step('check', `${v} is already in ${where} — rule broken.`, { r, c, v });
          t.step('fail', 'Return False: the board is invalid.', { result: false });
          return false;
        }
        t.step('check', `${v} is in none of rows[${r}], cols[${c}], boxes[${boxName(r, c)}] — legal.`, { r, c, v });
        rows[r].add(v);
        cols[c].add(v);
        boxes[boxIdx(r, c)].add(v);
        t.step('add', `Record ${v} in all three sets.`, { r, c, v });
      }
    }
    cur = null;
    conflict = [];
    t.step('ok', `All ${filled} digits checked — no repeats anywhere.`, { result: true });
    return true;
  },
};

const longestConsecutive: Problem<{ nums: number[] }> = {
  id: 'longest-consecutive-sequence',
  num: 128,
  title: 'Longest Consecutive Sequence',
  difficulty: 'Medium',
  category: 'arrays-hashing',
  pattern: 'hashing',
  statement: 'Given an unsorted integer array, find the length of the longest run of consecutive integers (like 1,2,3,4) that can be formed from its values. Must run in O(n).',
  signals: ['"consecutive" values, any order in the input', 'O(n) required (so no sorting)', 'duplicates may exist'],
  insight:
    'Put everything in a set. A number starts a run only if n − 1 is absent; from each start, count upward with O(1) lookups. Every number is visited by at most one run, so the total is O(n).',
  hints: [
    'Sorting gives O(n log n). What O(1) question would let you walk a run?',
    'If n − 1 exists, n is in the middle of someone else\'s run — skip it.',
    'Only from run starts: while n + length in set: length += 1.',
  ],
  pitfall: 'Extending from every number, not just run starts — that makes it O(n²) on input like 1..n.',
  backend: {
    title: 'Finding contiguous ranges in out-of-order sequence numbers',
    detail:
      'A replication follower or TCP receiver gets packets with sequence ids out of order and must report the contiguous blocks it holds (TCP SACK blocks, Kafka offset ranges ready to commit). Ids go into a set; a block starts where id − 1 is missing and is extended with set lookups — no sort of the receive buffer needed.',
  },
  complexity: { time: 'O(n)', space: 'O(n)' },
  code: `
def longestConsecutive(nums):
    numSet = set(nums)                      @init
    longest = 0                             @zero
    for n in numSet:                        @loop
        if (n - 1) not in numSet:           @isStart
            length = 1                      @start
            while (n + length) in numSet:   @extend
                length += 1                 @grow
            longest = max(longest, length)  @best
    return longest                          @done
`,
  explain: {
    init: 'O(1) membership for every value; duplicates collapse.',
    isStart: 'Skip n if its predecessor exists — the run will be counted from its real start.',
    extend: 'Walk upward while the next integer exists.',
    best: 'Keep the longest run seen.',
  },
  distractors: [
    { text: '    nums.sort()', why: 'Sorting costs O(n log n); the problem asks for O(n).' },
    { text: '        if (n + 1) not in numSet:', why: 'That detects run ENDS; extending upward from an end finds nothing.' },
    { text: '            while (n + length) in nums:', why: 'Searching the list is O(n) per lookup — use the set.' },
  ],
  input: { nums: [100, 4, 200, 1, 3, 2] },
  presets: [
    { label: 'two runs', input: { nums: [0, 3, 7, 2, 5, 8, 4, 6, 0, 1] } },
    { label: 'empty', input: { nums: [] } },
    { label: 'duplicates', input: { nums: [1, 2, 0, 1] } },
  ],
  validate: ({ nums }) => (!Array.isArray(nums) ? 'Expected { nums: number[] }' : nums.length > 14 ? 'Keep nums ≤ 14 elements' : null),
  trace(t, { nums }) {
    const numSet = new Set<number>();
    let cur: number | null = null;
    let run: number[] = [];
    let skipped: number[] = [];
    let best: number[] = [];
    let longest = 0;
    t.draw(() => [
      V.array('nums', nums),
      V.set('numSet', numSet, {
        tones: {
          ...tones(skipped.map(String), 'muted'),
          ...tones(best.map(String), 'info'),
          ...tones(run.map(String), 'good'),
          ...(cur !== null ? { [String(cur)]: 'active' as Tone } : {}),
        },
        caption: 'grey = not a run start · green = current run · blue = best run so far',
      }),
    ]);
    for (const n of nums) numSet.add(n);
    t.step('init', `Build the set: ${numSet.size} distinct values, O(1) lookups.`);
    t.step('zero', 'No run found yet.', { longest });
    let askedStart = 0;
    let askedLen = false;
    for (const n of numSet) {
      cur = n;
      run = [];
      t.step('loop', `Consider ${n}.`, { n, longest });
      const isStart = !numSet.has(n - 1);
      if (askedStart < 2 && (!isStart || askedStart === 0)) {
        askedStart++;
        t.predict(`Is ${n} the start of a run?`, ['Yes', 'No'], isStart ? 0 : 1, isStart ? `${n - 1} is not in the set, so nothing comes before ${n}.` : `${n - 1} is in the set — ${n} is inside a run that starts lower.`);
      }
      if (!isStart) {
        skipped.push(n);
        t.step('isStart', `${n - 1} exists, so ${n} is not a run start — skip it; its run is counted from the start.`, { n });
        continue;
      }
      t.step('isStart', `${n - 1} is absent: ${n} starts a run.`, { n });
      let length = 1;
      run = [n];
      t.step('start', `length = 1 (just ${n}).`, { n, length });
      let total = 1;
      while (numSet.has(n + total)) total++;
      if (!askedLen && total > 1) {
        askedLen = true;
        ask(t, `How long will the run starting at ${n} be?`, String(total), [String(total - 1), String(total + 1), '1'], `${range(n, n + total).join(', ')} are all in the set; ${n + total} is not.`);
      }
      for (;;) {
        const has = numSet.has(n + length);
        t.step('extend', has ? `${n + length} is in the set — the run continues.` : `${n + length} is missing — the run ends.`, { n, length });
        if (!has) break;
        length++;
        run.push(n + length - 1);
        t.step('grow', `length = ${length}.`, { n, length });
      }
      const improved = length > longest;
      longest = Math.max(longest, length);
      if (improved) best = [...run];
      t.step('best', improved ? `New longest run: ${length}.` : `${length} does not beat ${longest}.`, { length, longest });
    }
    cur = null;
    run = [];
    t.step('done', `Longest consecutive run has length ${longest}.`, { result: longest });
    return longest;
  },
};

export const problems: Problem[] = [
  containsDuplicate,
  validAnagram,
  twoSum,
  groupAnagrams,
  topKFrequent,
  encodeDecode,
  productExceptSelf,
  validSudoku,
  longestConsecutive,
];

export const variants: Variant[] = [
  {
    id: 'subarray-sum-equals-k',
    title: 'Count subarrays summing to k',
    statement: 'Given an integer array (values may be negative) and an integer k, count how many contiguous subarrays add up to exactly k.',
    pattern: 'prefix-sum',
    nearest: 'product-of-array-except-self',
    signals: ['"contiguous subarray" + "sum equals k"', 'negative numbers allowed (so a sliding window cannot shrink safely)', 'count, not find one'],
    approach:
      'Keep a running prefix sum and a hashmap prefix → how many times seen (seed {0: 1}). At each index, sum(i..j) = k ⇔ prefix[j] − prefix[i−1] = k, so add count[prefix − k] to the answer, then record prefix.',
    backend:
      'Billing audit: in a stream of per-minute balance deltas (credits and debits), count the time ranges whose net change equals a disputed amount — prefix sums + a hashmap answer it in one pass over the ledger.',
  },
  {
    id: 'identical-permission-sets',
    title: 'Group users with identical permission sets',
    statement: 'Each user has an unordered list of permission strings, possibly with duplicates. Return groups of user ids whose sets of distinct permissions are exactly equal.',
    pattern: 'hashing',
    nearest: 'group-anagrams',
    signals: ['"group" items that are equal ignoring order', 'need a canonical form per item', 'duplicates should not matter'],
    approach:
      'Canonical key = tuple(sorted(set(perms))) (or a frozenset). Append each user id to map[key]; the values with ≥2 users are the answer.',
    backend:
      'IAM clean-up: collapse thousands of hand-crafted per-user grants into a few roles by grouping users whose effective permissions are identical — the role-mining step of an RBAC migration.',
  },
  {
    id: 'word-pattern-bijection',
    title: 'Does a sequence follow a pattern?',
    statement: 'Given a pattern like "abba" and a list of words, decide whether there is a one-to-one mapping between pattern letters and words so that the words follow the pattern.',
    pattern: 'hashing',
    nearest: 'valid-anagram',
    signals: ['"one-to-one" / "bijection"', 'consistent mapping between two sequences', 'two directions must both be consistent'],
    approach:
      'Walk both sequences together with two hashmaps letter → word and word → letter. If either map already holds a different partner, return False; also check the lengths match.',
    backend:
      'Schema migration review: verify a column-rename map is a bijection (no two old columns renamed to the same new column and no column renamed twice) before generating ALTER statements.',
  },
];
