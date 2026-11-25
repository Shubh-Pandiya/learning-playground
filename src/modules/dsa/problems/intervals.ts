import type { Problem, Tone, Variant } from '../engine/types.ts';
import { Heap, V, tones } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Intervals — sort by start, then sweep left → right comparing with the last kept interval.
// ---------------------------------------------------------------------------

type Iv = { start: number; end: number; label?: string; tone?: Tone };
const iv = (a: readonly number[], tone?: Tone, label?: string): Iv => ({ start: a[0], end: a[1], label: label ?? `[${a[0]},${a[1]}]`, tone });
const isPairs = (x: unknown): x is number[][] =>
  Array.isArray(x) && x.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)) && p[0] <= p[1]);
const byStart = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1];
const fmtIv = (a: readonly number[]) => `[${a[0]},${a[1]}]`;

const insertInterval: Problem<{ intervals: number[][]; newInterval: number[] }> = {
  id: 'insert-interval',
  num: 57,
  title: 'Insert Interval',
  difficulty: 'Medium',
  category: 'intervals',
  pattern: 'intervals',
  statement:
    'You get a list of non-overlapping intervals sorted by start, plus one new interval. Insert it so the list stays sorted and non-overlapping, merging wherever needed.',
  signals: ['input already sorted & non-overlapping', '"insert and merge if necessary"', 'one new interval', 'O(n) expected'],
  insight:
    'Every existing interval is in exactly one of three places relative to the new one: completely before it (copy), completely after it (we are done — place new and copy the rest), or overlapping (absorb it into the new interval).',
  hints: [
    'Compare one existing interval with the new one. How many relative positions are possible?',
    'Ends before new starts → keep it. Starts after new ends → new goes here, then everything else.',
    'Otherwise they overlap: new = [min of starts, max of ends] and keep scanning.',
  ],
  pitfall: 'Forgetting to append the (possibly grown) new interval when the loop finishes without finding an interval that starts after it.',
  backend: {
    title: 'Booking a maintenance window into an on-call calendar',
    detail:
      'A scheduler keeps a sorted list of blocked time ranges for a database cluster. Adding a new maintenance window must keep the list sorted and coalesce overlapping blocks so availability queries stay a simple scan — exactly this insert-and-merge pass over the existing ranges.',
  },
  complexity: { time: 'O(n)', space: 'O(n)' },
  code: `
def insert(intervals, newInterval):
    res = []                                              @init
    for i in range(len(intervals)):                       @loop
        if newInterval[1] < intervals[i][0]:              @before
            res.append(newInterval)                       @placeNew
            return res + intervals[i:]                    @rest
        elif newInterval[0] > intervals[i][1]:            @after
            res.append(intervals[i])                      @keep
        else:
            newInterval = [min(newInterval[0], intervals[i][0]), max(newInterval[1], intervals[i][1])]   @merge
    res.append(newInterval)                               @append
    return res                                            @done
`,
  explain: {
    before: 'New ends before this one starts: new belongs right here, and nothing later can overlap it.',
    rest: 'The remaining intervals are already sorted and disjoint — copy them as-is.',
    after: 'This interval ends before new starts — it is untouched.',
    merge: 'Overlap: grow new to cover both and keep looking; more intervals may overlap the grown one.',
    append: 'Reached the end without placing new (it was last or absorbed the tail).',
  },
  distractors: [
    { text: '        if newInterval[1] <= intervals[i][0]:', why: 'Touching intervals ([1,4] and [4,5]) count as overlapping and must merge; use strict <.' },
    { text: '            newInterval = [intervals[i][0], newInterval[1]]', why: 'Merging must take the min of starts AND the max of ends — either interval can stick out on either side.' },
    { text: '            return res', why: 'Drops every interval after the insertion point; append intervals[i:] too.' },
  ],
  input: { intervals: [[1, 2], [3, 5], [6, 7], [8, 10], [12, 16]], newInterval: [4, 8] },
  presets: [
    { label: 'goes last', input: { intervals: [[1, 3], [6, 9]], newInterval: [10, 11] } },
    { label: 'swallows all', input: { intervals: [[2, 3], [4, 5], [6, 7]], newInterval: [1, 9] } },
    { label: 'empty list', input: { intervals: [], newInterval: [5, 7] } },
  ],
  validate: ({ intervals, newInterval }) =>
    !isPairs(intervals) || !isPairs([newInterval])
      ? 'Expected { intervals: [start, end][], newInterval: [start, end] }'
      : intervals.length > 10
        ? 'Keep ≤ 10 intervals'
        : intervals.some((x, k) => k > 0 && x[0] <= intervals[k - 1][1])
          ? 'intervals must be sorted and non-overlapping'
          : null,
  trace(t, { intervals, newInterval }) {
    let ni = [...newInterval];
    const res: number[][] = [];
    const status: (Tone | undefined)[] = intervals.map(() => undefined);
    let i = -1;
    let asked = 0;
    t.draw(() => [
      V.intervals(
        'intervals + new',
        [...intervals.map((x, k) => iv(x, k === i ? 'active' : status[k])), iv(ni, 'warn', `new ${fmtIv(ni)}`)],
        { marker: i >= 0 && i < intervals.length ? intervals[i][0] : null, caption: 'orange = new interval · grey = absorbed into new · green = copied to res' },
      ),
      V.intervals('res', res.map((x) => iv(x, 'good'))),
    ]);
    t.step('init', `Insert ${fmtIv(ni)}. res starts empty.`, { newInterval: ni });
    for (i = 0; i < intervals.length; i++) {
      const cur = intervals[i];
      t.step('loop', `Compare ${fmtIv(cur)} with new ${fmtIv(ni)}.`, { i, 'intervals[i]': cur, newInterval: ni });
      const where = ni[1] < cur[0] ? 0 : ni[0] > cur[1] ? 1 : 2;
      if (asked < 3) {
        asked++;
        t.predict(
          `Where is ${fmtIv(cur)} relative to new ${fmtIv(ni)}?`,
          ['After new → place new, copy the rest', 'Before new → copy it', 'Overlapping → merge'],
          where,
          where === 0 ? `new ends at ${ni[1]} < ${cur[0]}.` : where === 1 ? `It ends at ${cur[1]} < new start ${ni[0]}.` : `Neither ends before the other starts, so they share time.`,
        );
      }
      if (where === 0) {
        t.step('before', `new ends at ${ni[1]}, before ${fmtIv(cur)} starts at ${cur[0]}.`, { newInterval: ni });
        res.push(ni);
        t.step('placeNew', `Place ${fmtIv(ni)} in res — nothing later can overlap it.`, { res: res.map(fmtIv) });
        for (let k = i; k < intervals.length; k++) {
          res.push(intervals[k]);
          status[k] = 'good';
        }
        i = intervals.length;
        t.step('rest', 'Copy the remaining intervals unchanged and return.', { res: res.map(fmtIv) });
        return res;
      }
      t.step('before', `new ends at ${ni[1]} ≥ ${cur[0]} — not entirely before it.`, {});
      if (where === 1) {
        t.step('after', `${fmtIv(cur)} ends at ${cur[1]} < new start ${ni[0]} — it is entirely before new.`, {});
        res.push(cur);
        status[i] = 'good';
        t.step('keep', `Copy ${fmtIv(cur)} to res.`, { res: res.map(fmtIv) });
      } else {
        t.step('after', `${fmtIv(cur)} ends at ${cur[1]} ≥ new start ${ni[0]} — so they overlap.`, {});
        ni = [Math.min(ni[0], cur[0]), Math.max(ni[1], cur[1])];
        status[i] = 'muted';
        t.step('merge', `Absorb it: new becomes ${fmtIv(ni)}.`, { newInterval: ni });
      }
    }
    i = -1;
    res.push(ni);
    t.step('append', `No interval starts after new — append ${fmtIv(ni)} at the end.`, { res: res.map(fmtIv) });
    t.step('done', `Return ${res.map(fmtIv).join(' ')}.`, { res: res.map(fmtIv) });
    return res;
  },
};

const mergeIntervals: Problem<{ intervals: number[][] }> = {
  id: 'merge-intervals',
  num: 56,
  title: 'Merge Intervals',
  difficulty: 'Medium',
  category: 'intervals',
  pattern: 'intervals',
  statement: 'Given intervals in any order, combine every group that overlaps (touching counts) and return the resulting disjoint intervals.',
  signals: ['"merge all overlapping intervals"', 'input unsorted', 'output must be disjoint', 'touching endpoints count as overlap'],
  insight:
    'After sorting by start, an interval can only overlap the LAST merged interval — everything earlier ends even sooner. So one pass comparing with output[-1] suffices.',
  hints: [
    'Unsorted input makes overlaps hard to find. What order helps?',
    'Sorted by start, which previous interval could the current one overlap?',
    'If start ≤ last end, extend last end to max(last end, end); otherwise start a new output interval.',
  ],
  pitfall: 'Setting output[-1][1] = end instead of max(lastEnd, end) — a short interval inside a long one would shrink it.',
  backend: {
    title: 'Coalescing downtime incidents for an SLA report',
    detail:
      'An SRE report pulls outage spans from several monitors (Pingdom, synthetic checks, alert history), often overlapping. Sorting by start and merging gives the true total downtime per service without double counting — the same pass databases use to compact overlapping range locks or TTL ranges.',
  },
  complexity: { time: 'O(n log n)', space: 'O(n)' },
  code: `
def merge(intervals):
    intervals.sort(key=lambda i: i[0])              @sort
    output = [intervals[0]]                         @init
    for start, end in intervals[1:]:                @loop
        lastEnd = output[-1][1]                     @last
        if start <= lastEnd:                        @check
            output[-1][1] = max(lastEnd, end)       @merge
        else:
            output.append([start, end])             @push
    return output                                   @done
`,
  explain: {
    sort: 'After sorting, overlaps are always with the most recent merged interval.',
    init: 'The first interval opens the first merged group.',
    check: '≤ (not <): intervals that touch are merged too.',
    merge: 'max — the current interval might be completely inside the last one.',
    push: 'A gap: the previous group is final, start a new one.',
  },
  distractors: [
    { text: '        if start < lastEnd:', why: 'Touching intervals like [1,4] and [4,5] must merge; strict < keeps them apart.' },
    { text: '            output[-1][1] = end', why: 'If the current interval lies inside the last one ([1,10] then [2,3]) this shrinks the merged end to 3.' },
    { text: '    intervals.sort(key=lambda i: i[1])', why: 'Sorting by end lets an earlier-starting interval appear later, so overlaps with older groups are missed.' },
  ],
  input: { intervals: [[1, 3], [8, 10], [2, 6], [15, 18], [9, 11]] },
  presets: [
    { label: 'touching', input: { intervals: [[1, 4], [4, 5]] } },
    { label: 'nested', input: { intervals: [[1, 10], [2, 3], [4, 5]] } },
  ],
  validate: ({ intervals }) =>
    !isPairs(intervals) || !intervals.length ? 'Expected { intervals: [start, end][] } (non-empty)' : intervals.length > 10 ? 'Keep ≤ 10 intervals' : null,
  trace(t, { intervals }) {
    let arr = intervals.map((x) => [...x]);
    const output: number[][] = [];
    const group: number[] = [];
    let i = -1;
    let sorted = false;
    let asked = 0;
    t.draw(() => [
      V.intervals(
        sorted ? 'intervals (sorted by start)' : 'intervals (unsorted)',
        arr.map((x, k) => iv(x, k === i ? 'active' : group[k] !== undefined ? (group[k] % 2 ? 'info' : 'good') : undefined)),
        { marker: i >= 0 ? arr[i][0] : null, caption: 'marker = current start · colours = merged group membership' },
      ),
      V.intervals('output', output.map((x, k) => iv(x, k === output.length - 1 ? 'active' : 'good'))),
    ]);
    t.step('sort', 'Input as given. Overlapping intervals can be far apart in this order.', {});
    arr = arr.sort(byStart);
    sorted = true;
    t.step('sort', 'Sorted by start: now an interval can only overlap the most recent merged one.', { intervals: arr.map(fmtIv) });
    output.push([...arr[0]]);
    group[0] = 0;
    i = 0;
    t.step('init', `output = [${fmtIv(arr[0])}].`, { output: output.map(fmtIv) });
    for (i = 1; i < arr.length; i++) {
      const [s, e] = arr[i];
      t.step('loop', `Next interval ${fmtIv(arr[i])}.`, { start: s, end: e });
      const lastEnd = output[output.length - 1][1];
      t.step('last', `The last merged interval ends at ${lastEnd}.`, { lastEnd });
      if (asked < 3) {
        asked++;
        t.predict(`Does ${fmtIv(arr[i])} overlap the last merged interval (ends at ${lastEnd})?`, ['Yes — merge', 'No — new group'], s <= lastEnd ? 0 : 1, s <= lastEnd ? `start ${s} ≤ ${lastEnd}.` : `start ${s} > ${lastEnd}: there is a gap.`);
      }
      if (s <= lastEnd) {
        t.step('check', `${s} ≤ ${lastEnd}: overlap (or touch).`, { start: s, lastEnd });
        output[output.length - 1][1] = Math.max(lastEnd, e);
        group[i] = output.length - 1;
        t.step('merge', `Extend the last interval to end at max(${lastEnd}, ${e}) = ${output[output.length - 1][1]}.`, { output: output.map(fmtIv) });
      } else {
        t.step('check', `${s} > ${lastEnd}: a gap — the previous group is final.`, { start: s, lastEnd });
        output.push([s, e]);
        group[i] = output.length - 1;
        t.step('push', `Start a new group with ${fmtIv([s, e])}.`, { output: output.map(fmtIv) });
      }
    }
    i = -1;
    t.step('done', `Return ${output.map(fmtIv).join(' ')}.`, { output: output.map(fmtIv) });
    return output;
  },
};

const nonOverlapping: Problem<{ intervals: number[][] }> = {
  id: 'non-overlapping-intervals',
  num: 435,
  title: 'Non-overlapping Intervals',
  difficulty: 'Medium',
  category: 'intervals',
  pattern: 'intervals',
  statement: 'Return the minimum number of intervals you must delete so that the remaining ones do not overlap (touching at an endpoint is fine).',
  signals: ['"minimum number to remove"', 'remaining must be non-overlapping', 'equivalently: keep as many as possible', 'touching is allowed'],
  insight:
    'Sort by start and sweep. When two intervals clash you must drop one — drop the one that ends LATER, because the earlier-ending one leaves more room for everything after it.',
  hints: [
    'Removing the minimum = keeping the maximum number of non-overlapping intervals.',
    'Sorted by start, keep track of the end of the last kept interval.',
    'On a clash, count a removal and keep prevEnd = min(prevEnd, end).',
  ],
  pitfall: 'Keeping the interval that started first on a clash — a long early interval can block many short ones; keep the smaller end.',
  backend: {
    title: 'Admitting the most non-conflicting jobs on a single GPU',
    detail:
      'A training cluster receives reservation requests [start, end] for one exclusive GPU node. To reject as few as possible, sweep requests in start order and, on a conflict, drop whichever reservation runs later — the classic interval-scheduling greedy behind admission control.',
  },
  complexity: { time: 'O(n log n)', space: 'O(1)' },
  code: `
def eraseOverlapIntervals(intervals):
    intervals.sort()                                @sort
    res = 0                                         @init
    prevEnd = intervals[0][1]
    for start, end in intervals[1:]:                @loop
        if start >= prevEnd:                        @check
            prevEnd = end                           @keep
        else:
            res += 1                                @remove
            prevEnd = min(end, prevEnd)             @shrink
    return res                                      @done
`,
  explain: {
    sort: 'Process intervals in start order so a clash is always with the last kept one.',
    check: '≥: touching at an endpoint is not an overlap.',
    remove: 'Two intervals clash — one of them must go.',
    shrink: 'Keep whichever ends first: it leaves the most room for the rest.',
  },
  distractors: [
    { text: '            prevEnd = max(end, prevEnd)', why: 'Keeps the interval that ends later — it can block more future intervals, giving too many removals.' },
    { text: '        if start > prevEnd:', why: 'Touching intervals ([1,2] and [2,3]) do not overlap; strict > counts them as a clash.' },
    { text: '            prevEnd = end', why: 'On a clash this always keeps the newer interval, even if it ends later than the one already kept.' },
  ],
  input: { intervals: [[1, 5], [2, 3], [3, 4], [4, 8], [6, 7]] },
  presets: [
    { label: 'chain with one clash', input: { intervals: [[1, 2], [2, 3], [3, 4], [1, 3]] } },
    { label: 'all same', input: { intervals: [[1, 2], [1, 2], [1, 2]] } },
  ],
  validate: ({ intervals }) =>
    !isPairs(intervals) || !intervals.length ? 'Expected { intervals: [start, end][] } (non-empty)' : intervals.length > 10 ? 'Keep ≤ 10 intervals' : null,
  trace(t, { intervals }) {
    let arr = intervals.map((x) => [...x]);
    const status: (Tone | undefined)[] = arr.map(() => undefined);
    let res = 0;
    let prev = 0;
    let i = -1;
    let sorted = false;
    let asked = 0;
    let touchAsked = false;
    t.draw(() => [
      V.intervals(
        sorted ? 'intervals (sorted)' : 'intervals (unsorted)',
        arr.map((x, k) => iv(x, k === i ? 'active' : k === prev && sorted ? 'info' : status[k])),
        { marker: sorted ? arr[prev][1] : null, caption: 'marker = prevEnd · blue = last kept · red = removed · green = kept' },
      ),
      V.map('state', [
        ['res (removed)', res],
        ['prevEnd', sorted ? arr[prev][1] : '–'],
      ]),
    ]);
    t.step('sort', 'Input as given.', {});
    arr = arr.sort(byStart);
    sorted = true;
    t.step('sort', 'Sorted by start (then end).', { intervals: arr.map(fmtIv) });
    t.step('init', `Keep ${fmtIv(arr[0])} for now; prevEnd = ${arr[0][1]}, res = 0.`, { res, prevEnd: arr[0][1] });
    for (i = 1; i < arr.length; i++) {
      const [s, e] = arr[i];
      const prevEnd = arr[prev][1];
      t.step('loop', `Next ${fmtIv(arr[i])}; the last kept interval ends at ${prevEnd}.`, { start: s, end: e, prevEnd });
      if (s === prevEnd && !touchAsked) {
        touchAsked = true;
        t.predict(`${fmtIv(arr[i])} starts exactly where the last kept interval ends (${prevEnd}). Is that a clash?`, ['Yes', 'No — touching is fine'], 1, 'The check is start >= prevEnd: sharing an endpoint is not an overlap.');
      }
      if (s >= prevEnd) {
        t.step('check', `${s} ≥ ${prevEnd}: no clash.`, { start: s, prevEnd });
        status[prev] = 'good';
        prev = i;
        t.step('keep', `Keep it; prevEnd = ${e}.`, { prevEnd: e });
      } else {
        t.step('check', `${s} < ${prevEnd}: ${fmtIv(arr[prev])} and ${fmtIv(arr[i])} overlap — one must go.`, { start: s, prevEnd });
        if (asked < 3) {
          asked++;
          t.predict(
            `Which one do we delete: ${fmtIv(arr[prev])} or ${fmtIv(arr[i])}?`,
            [`The one ending later`, `The one that started first`, `Always the new one`],
            0,
            `Keeping the smaller end (${Math.min(e, prevEnd)}) leaves the most room for the intervals still to come.`,
          );
        }
        res++;
        const dropCur = e >= prevEnd;
        status[dropCur ? i : prev] = 'bad';
        t.step('remove', `Delete ${fmtIv(dropCur ? arr[i] : arr[prev])} ${e === prevEnd ? '(same end — either one works)' : '(it ends later)'}. res = ${res}.`, { res });
        if (!dropCur) prev = i;
        t.step('shrink', `prevEnd = min(${e}, ${prevEnd}) = ${Math.min(e, prevEnd)}.`, { prevEnd: Math.min(e, prevEnd) });
      }
    }
    status[prev] = 'good';
    i = -1;
    t.step('done', `Delete ${res} interval${res === 1 ? '' : 's'}.`, { res });
    return res;
  },
};

const meetingRooms: Problem<{ intervals: number[][] }> = {
  id: 'meeting-rooms',
  num: 252,
  title: 'Meeting Rooms',
  difficulty: 'Easy',
  category: 'intervals',
  pattern: 'intervals',
  statement: 'Given meeting time ranges, decide whether one person could attend every meeting, i.e. no two meetings overlap (back-to-back is fine).',
  signals: ['"can attend all"', 'any overlap means failure', 'unsorted time ranges', 'back-to-back allowed'],
  insight: 'Sort by start; then only neighbours can overlap. Any meeting that starts before the previous one ends is a conflict.',
  hints: ['Comparing every pair is O(n²). What order would put conflicts next to each other?', 'After sorting by start, compare each meeting with the one just before it.'],
  pitfall: 'Using ≤ when comparing start with the previous end — a meeting starting exactly when another ends is not a conflict.',
  backend: {
    title: 'Detecting double-booked deploy slots',
    detail:
      'A release-train service lets teams reserve production deploy windows for a single pipeline. Before accepting a schedule it sorts reservations by start and checks each against its predecessor — any start < previous end means two deploys would run concurrently.',
  },
  complexity: { time: 'O(n log n)', space: 'O(1)' },
  code: `
def canAttendMeetings(intervals):
    intervals.sort(key=lambda i: i[0])                  @sort
    for i in range(1, len(intervals)):                  @loop
        if intervals[i][0] < intervals[i - 1][1]:       @check
            return False                                @clash
    return True                                         @done
`,
  explain: {
    sort: 'After sorting, a conflict (if any) always shows up between neighbours.',
    check: 'Starts before the previous one ends → overlap. Equal is fine (back-to-back).',
  },
  distractors: [
    { text: '        if intervals[i][0] <= intervals[i - 1][1]:', why: 'Back-to-back meetings ([1,2], [2,3]) are allowed; ≤ wrongly reports a clash.' },
    { text: '        if intervals[i][1] < intervals[i - 1][1]:', why: 'Compares two ends; the overlap test is "my start < previous end".' },
  ],
  input: { intervals: [[9, 10], [0, 4], [5, 9], [4, 6]] },
  presets: [
    { label: 'no clash', input: { intervals: [[7, 10], [2, 4]] } },
    { label: 'long meeting', input: { intervals: [[0, 30], [5, 10], [15, 20]] } },
  ],
  validate: ({ intervals }) => (!isPairs(intervals) ? 'Expected { intervals: [start, end][] }' : intervals.length > 10 ? 'Keep ≤ 10 meetings' : null),
  trace(t, { intervals }) {
    let arr = intervals.map((x) => [...x]);
    let i = -1;
    let sorted = false;
    const ok = new Set<number>();
    let clash = -1;
    let asked = 0;
    t.draw(() => [
      V.intervals(
        sorted ? 'meetings (sorted by start)' : 'meetings (unsorted)',
        arr.map((x, k) => iv(x, clash >= 0 && (k === clash || k === clash - 1) ? 'bad' : k === i || k === i - 1 ? 'active' : ok.has(k) ? 'good' : undefined)),
        { marker: i >= 1 && i < arr.length ? arr[i][0] : null, caption: 'marker = start of the meeting being checked' },
      ),
    ]);
    t.step('sort', 'Meetings as given.', {});
    arr = arr.sort(byStart);
    sorted = true;
    t.step('sort', 'Sorted by start — conflicts can now only be between neighbours.', { intervals: arr.map(fmtIv) });
    if (arr.length) ok.add(0);
    for (i = 1; i < arr.length; i++) {
      t.step('loop', `Compare ${fmtIv(arr[i])} with the previous meeting ${fmtIv(arr[i - 1])}.`, { i });
      const bad = arr[i][0] < arr[i - 1][1];
      if (asked < 3) {
        asked++;
        t.predict(`Does ${fmtIv(arr[i])} start before ${fmtIv(arr[i - 1])} ends?`, ['Yes — clash', 'No — fine'], bad ? 0 : 1, `${arr[i][0]} ${bad ? '<' : '≥'} ${arr[i - 1][1]}.`);
      }
      if (bad) {
        clash = i;
        t.step('check', `${arr[i][0]} < ${arr[i - 1][1]}: both meetings need the person at the same time.`, { start: arr[i][0], prevEnd: arr[i - 1][1] });
        t.step('clash', 'False.', { result: false });
        return false;
      }
      ok.add(i);
      t.step('check', `${arr[i][0]} ≥ ${arr[i - 1][1]}: no overlap${arr[i][0] === arr[i - 1][1] ? ' (back-to-back is fine)' : ''}.`, { start: arr[i][0], prevEnd: arr[i - 1][1] });
    }
    i = -1;
    t.step('done', 'No neighbours overlap — True.', { result: true });
    return true;
  },
};

const meetingRoomsII: Problem<{ intervals: number[][] }> = {
  id: 'meeting-rooms-ii',
  num: 253,
  title: 'Meeting Rooms II',
  difficulty: 'Medium',
  category: 'intervals',
  pattern: 'intervals',
  statement: 'Given meeting time ranges, return the smallest number of rooms that lets every meeting happen (a room freed at time t can be reused by a meeting starting at t).',
  signals: ['"minimum number of rooms / servers / platforms"', 'maximum number of simultaneous intervals', 'start and end events', 'reuse at the exact end time is allowed'],
  insight:
    'Only the number of meetings running at the same moment matters. Sweep time over sorted starts and sorted ends separately: a start opens a room, an end frees one; the peak count is the answer.',
  hints: [
    'Which moment determines the number of rooms needed?',
    'Split the intervals into a sorted list of starts and a sorted list of ends.',
    'Two pointers: if the next start comes before the next end, count + 1; else count − 1 (ties: process the end first). Track the max.',
  ],
  pitfall: 'Processing a start before an end at the same time — a meeting ending at 10 frees its room for one starting at 10, so use start < end (strict).',
  backend: {
    title: 'Sizing a database connection pool from session logs',
    detail:
      'Each request log has (checkout, release) timestamps for a DB connection. The pool must be at least the peak number of overlapping checkouts. Sorting checkout and release times and sweeping with two pointers gives the peak concurrency — the same sweep-line used for load-balancer capacity planning or counting concurrent WebSocket sessions.',
  },
  complexity: { time: 'O(n log n)', space: 'O(n)' },
  code: `
def minMeetingRooms(intervals):
    start = sorted([i[0] for i in intervals])      @starts
    end = sorted([i[1] for i in intervals])        @ends
    res = count = 0                                @init
    s = e = 0
    while s < len(intervals):                      @loop
        if start[s] < end[e]:                      @check
            s, count = s + 1, count + 1            @open
        else:
            e, count = e + 1, count - 1            @close
        res = max(res, count)                      @best
    return res                                     @done
`,
  explain: {
    starts: 'Which meeting a start belongs to does not matter — only WHEN rooms are needed.',
    check: 'Strict <: on a tie the end is processed first, so the room is reused.',
    open: 'A meeting begins before the earliest still-running one ends → one more room in use.',
    close: 'The earliest running meeting ends first → a room is freed.',
    best: 'The answer is the peak number of rooms in use at any moment.',
  },
  distractors: [
    { text: '        if start[s] <= end[e]:', why: 'On a tie this opens a new room before freeing the one that ends at the same moment — over-counts.' },
    { text: '    while s < len(intervals) and e < len(intervals):', why: 'Harmless but misleading: e can never pass s; the loop is driven by remaining starts.' },
    { text: '        res = count', why: 'Overwrites the peak with the current count; once rooms free up you report too few. Track max(res, count).' },
  ],
  input: { intervals: [[0, 30], [5, 10], [10, 20], [15, 25]] },
  presets: [
    { label: 'no overlap', input: { intervals: [[7, 10], [2, 4]] } },
    { label: 'all at once', input: { intervals: [[1, 5], [2, 6], [3, 7]] } },
  ],
  validate: ({ intervals }) =>
    !isPairs(intervals) || !intervals.length ? 'Expected { intervals: [start, end][] } (non-empty)' : intervals.length > 10 ? 'Keep ≤ 10 meetings' : null,
  trace(t, { intervals }) {
    const n = intervals.length;
    let start: number[] = [];
    let end: number[] = [];
    let res = 0;
    let count = 0;
    let s = -1;
    let e = -1;
    let time: number | null = null;
    let asked = 0;
    t.draw(() => [
      V.intervals(
        'meetings',
        intervals.map((x) => iv(x, time === null ? undefined : x[0] <= time && time < x[1] ? 'active' : x[1] <= time ? 'muted' : undefined)),
        { marker: time, caption: 'marker = sweep line (current event time) · active = meeting running now' },
      ),
      start.length > 0 && V.array('start (sorted)', start, { pointers: { s: s >= 0 ? s : null }, tones: tones(Array.from({ length: Math.max(0, s) }, (_, k) => k), 'muted') }),
      end.length > 0 && V.array('end (sorted)', end, { pointers: { e: e >= 0 ? e : null }, tones: tones(Array.from({ length: Math.max(0, e) }, (_, k) => k), 'muted') }),
      V.map('rooms', [
        ['count (in use)', count],
        ['res (peak)', res],
      ]),
    ]);
    start = intervals.map((x) => x[0]).sort((a, b) => a - b);
    t.step('starts', `Start times, sorted: ${start.join(', ')}.`, {});
    end = intervals.map((x) => x[1]).sort((a, b) => a - b);
    t.step('ends', `End times, sorted: ${end.join(', ')}. We no longer care which start belongs to which end.`, {});
    s = 0;
    e = 0;
    t.step('init', 'No rooms in use yet. s and e point at the next start / end event.', { res, count, s, e });
    while (s < n) {
      t.step('loop', `Next start = ${start[s]}, next end = ${end[e]}.`, { s, e, 'start[s]': start[s], 'end[e]': end[e] });
      const opens = start[s] < end[e];
      if (asked < 3 && (asked < 2 || start[s] === end[e])) {
        asked++;
        t.predict(
          `Which event does the sweep line hit first: start ${start[s]} or end ${end[e]}?`,
          ['A meeting starts → open a room', 'A meeting ends → free a room'],
          opens ? 0 : 1,
          opens ? `${start[s]} < ${end[e]}: the new meeting begins while all current ones still run.` : start[s] === end[e] ? `A tie: the meeting ending at ${end[e]} frees its room just in time for the one starting at ${start[s]}.` : `${end[e]} ≤ ${start[s]}: a room frees up before the next meeting starts.`,
        );
      }
      if (opens) {
        time = start[s];
        t.step('check', `${start[s]} < ${end[e]}: a meeting starts before any running one ends.`, { 'start[s]': start[s], 'end[e]': end[e] });
        s++;
        count++;
        t.step('open', `Open a room → ${count} in use.`, { s, count });
      } else {
        time = end[e];
        t.step('check', `${start[s]} ≥ ${end[e]}: the meeting ending at ${end[e]} finishes first.`, { 'start[s]': start[s], 'end[e]': end[e] });
        e++;
        count--;
        t.step('close', `Free a room → ${count} in use.`, { e, count });
      }
      const prevRes = res;
      res = Math.max(res, count);
      t.step('best', res > prevRes ? `New peak: ${res} rooms at the same time.` : `Peak stays ${res}.`, { res, count });
    }
    t.step('done', `All meetings have started; the peak was ${res} room${res === 1 ? '' : 's'}.`, { res });
    return res;
  },
};

const minIntervalQuery: Problem<{ intervals: number[][]; queries: number[] }> = {
  id: 'minimum-interval-to-include-each-query',
  num: 1851,
  title: 'Minimum Interval to Include Each Query',
  difficulty: 'Hard',
  category: 'intervals',
  pattern: 'intervals',
  statement:
    'For each query point q, report the length (right − left + 1) of the shortest interval that contains q, or -1 if none does. Answers go back in the original query order.',
  signals: ['many point queries against many intervals', '"smallest interval containing"', 'offline answering allowed (sort the queries)', 'n, q up to 10⁵ (no O(n·q))'],
  insight:
    'Answer queries in increasing order (offline). Sweep a line: push every interval that has started (left ≤ q) onto a min-heap keyed by length, and lazily pop heap tops that already ended (right < q). The top is the answer.',
  hints: [
    'Checking every interval for every query is O(n·q). Can you reuse work between queries?',
    'Sort intervals by left and queries ascending: an interval that has started stays "started" for every later query.',
    'Min-heap of (length, right). Before reading the top, pop entries whose right < q.',
  ],
  pitfall: 'Returning results in sorted-query order — store answers in a map keyed by query and rebuild the original order.',
  backend: {
    title: 'Finding the most specific CIDR / price rule covering a request',
    detail:
      'A billing or routing service has many range rules (IP ranges, price tiers, time-of-day windows) and must find, for each event, the narrowest range that covers it. Processing a sorted batch of events with a sweep line and a min-heap of active rules (by width) answers them all in O((n + q) log n) — the same idea as longest-prefix-match done offline.',
  },
  complexity: { time: 'O(n log n + q log q)', space: 'O(n + q)' },
  code: `
def minInterval(intervals, queries):
    intervals.sort()                                        @sort
    minHeap = []                                            @init
    res, i = {}, 0
    for q in sorted(queries):                               @loop
        while i < len(intervals) and intervals[i][0] <= q:  @addLoop
            l, r = intervals[i]                             @take
            heapq.heappush(minHeap, (r - l + 1, r))         @push
            i += 1
        while minHeap and minHeap[0][1] < q:                @popLoop
            heapq.heappop(minHeap)                          @pop
        res[q] = minHeap[0][0] if minHeap else -1           @answer
    return [res[q] for q in queries]                        @done
`,
  explain: {
    sort: 'By left end, so intervals become "active" in sweep order.',
    loop: 'Offline: answering queries in increasing order lets each interval be pushed exactly once.',
    addLoop: 'Every interval that starts at or before q might contain q.',
    push: 'Heap ordered by length; keep r so we can tell later if it has expired.',
    popLoop: 'Lazy deletion: only the top matters, so only expired tops get removed.',
    answer: 'The top is the shortest started-and-not-ended interval, i.e. it contains q.',
  },
  distractors: [
    { text: '            heapq.heappush(minHeap, (r, r - l + 1))', why: 'Keyed by right end, so the top is the interval ending first, not the shortest one.' },
    { text: '        while minHeap and minHeap[0][1] <= q:', why: 'An interval ending exactly at q still contains q; only right < q has expired.' },
    { text: '    return [res[q] for q in sorted(queries)]', why: 'Answers must follow the ORIGINAL query order.' },
  ],
  input: { intervals: [[1, 4], [2, 4], [3, 6], [4, 4]], queries: [2, 3, 4, 5] },
  presets: [
    { label: 'unsorted queries & a miss', input: { intervals: [[2, 3], [2, 5], [1, 8], [20, 25]], queries: [2, 19, 5, 22] } },
    { label: 'nothing covers', input: { intervals: [[5, 6]], queries: [1, 9] } },
  ],
  validate: ({ intervals, queries }) =>
    !isPairs(intervals) || !Array.isArray(queries) || !queries.every((q) => typeof q === 'number')
      ? 'Expected { intervals: [l, r][], queries: number[] }'
      : intervals.length > 8 || queries.length > 8
        ? 'Keep ≤ 8 intervals and ≤ 8 queries'
        : null,
  trace(t, { intervals, queries }) {
    let arr = intervals.map((x) => [...x]);
    const heap = new Heap<[number, number, number]>((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]));
    const res = new Map<number, number>();
    const popped = new Set<number>();
    const sq = [...queries].sort((a, b) => a - b);
    let qi = -1;
    let i = 0;
    let cur = -1;
    let ans = -1;
    let sorted = false;
    let popAsked = 0;
    let ansAsked = false;
    t.draw(() => {
      const inHeap = new Set(heap.data.map((h) => h[2]));
      const q = qi >= 0 && qi < sq.length ? sq[qi] : null;
      return [
        V.intervals(
          sorted ? 'intervals (sorted by left)' : 'intervals',
          arr.map((x, k) => iv(x, k === ans ? 'good' : k === cur ? 'warn' : inHeap.has(k) ? 'active' : popped.has(k) ? 'muted' : undefined)),
          { marker: q, caption: 'marker = current query · blue = in heap · grey = expired · green = answer' },
        ),
        V.array('queries (sorted)', sq, { pointers: { q: q === null ? null : qi }, tones: tones(Array.from({ length: Math.max(0, qi) }, (_, k) => k), 'muted') }),
        V.heap('minHeap (length, right)', heap.data.map((h) => `(${h[0]},${h[1]})`), { tones: heap.size ? { 0: 'good' } : {} }),
        V.map('res (query → answer)', res),
      ];
    });
    t.step('sort', 'Intervals as given.', {});
    arr = arr.sort(byStart);
    sorted = true;
    t.step('sort', 'Sort intervals by left end so they "open" in sweep order.', { intervals: arr.map(fmtIv) });
    t.step('init', `Empty heap; queries will be answered in sorted order: ${sq.join(', ')}.`, { i });
    for (qi = 0; qi < sq.length; qi++) {
      const q = sq[qi];
      ans = -1;
      t.step('loop', `Sweep line moves to q = ${q}.`, { q, i });
      while (i < arr.length && arr[i][0] <= q) {
        t.step('addLoop', `${fmtIv(arr[i])} starts at ${arr[i][0]} ≤ ${q}: it has opened.`, { q, i });
        cur = i;
        const [l, r] = arr[i];
        t.step('take', `l = ${l}, r = ${r}, length ${r - l + 1}.`, { l, r });
        heap.push([r - l + 1, r, i]);
        cur = -1;
        t.step('push', `Push (${r - l + 1}, ${r}) — the heap orders by length.`, { minHeap: heap.data.map((h) => `(${h[0]},${h[1]})`) });
        i++;
      }
      t.step('addLoop', i < arr.length ? `Next interval starts at ${arr[i][0]} > ${q} — not open yet.` : 'Every interval has been pushed.', { q, i });
      for (;;) {
        const top = heap.peek();
        if (top && popAsked < 2 && (popAsked === 0 || top[1] < q)) {
          popAsked++;
          t.step('popLoop', `Heap top is (${top[0]}, ${top[1]}).`, { q, 'minHeap[0]': `(${top[0]},${top[1]})` });
          t.predict(`Top (${top[0]}, ${top[1]}) ends at ${top[1]}. Has it expired for q = ${q}?`, ['Yes — pop it', 'No — it contains q'], top[1] < q ? 0 : 1, top[1] < q ? `${top[1]} < ${q}: it ended before the sweep line.` : `${top[1]} ≥ ${q} and it started ≤ ${q}, so it covers q.`);
        }
        if (top && top[1] < q) {
          t.step('popLoop', `Top ends at ${top[1]} < ${q}: it can never cover this or any later query.`, { q });
          heap.pop();
          popped.add(top[2]);
          t.step('pop', `Pop (${top[0]}, ${top[1]}).`, { minHeap: heap.data.map((h) => `(${h[0]},${h[1]})`) });
        } else {
          t.step('popLoop', top ? `Top ends at ${top[1]} ≥ ${q} — it is valid.` : 'Heap is empty.', { q });
          break;
        }
      }
      const top = heap.peek();
      if (!ansAsked && top) {
        ansAsked = true;
        const opts = [...new Set([top[0], top[1], -1].map(String))].sort((x, y) => Number(x) - Number(y));
        t.predict(`What is the answer for q = ${q}?`, opts, opts.indexOf(String(top[0])), `The heap top (${top[0]}, ${top[1]}) is the shortest interval covering ${q}; its length is ${top[0]}.`);
      }
      res.set(q, top ? top[0] : -1);
      ans = top ? top[2] : -1;
      t.step('answer', top ? `res[${q}] = ${top[0]} (interval ${fmtIv(arr[top[2]])}).` : `No interval covers ${q}: res[${q}] = -1.`, { q, 'res[q]': res.get(q) });
    }
    ans = -1;
    const out = queries.map((q) => res.get(q)!);
    t.step('done', `Rebuild in the original query order: [${out.join(', ')}].`, { result: out });
    return out;
  },
};

export const problems: Problem[] = [insertInterval, mergeIntervals, nonOverlapping, meetingRooms, meetingRoomsII, minIntervalQuery];

export const variants: Variant[] = [
  {
    id: 'intervals-common-free-time',
    title: 'Common Free Time Across a Team',
    statement:
      'Each engineer has a list of busy time ranges. Return every finite time range in which nobody is busy (between the first and last busy moment).',
    pattern: 'intervals',
    nearest: 'merge-intervals',
    signals: ['many lists of ranges combined', '"when is everyone free"', 'gaps between merged ranges'],
    approach: 'Flatten all busy ranges, sort by start, merge overlapping ones; the gaps between consecutive merged ranges are the free slots.',
    backend: 'Finding a maintenance window when no service in a dependency chain has a deploy or batch job running.',
  },
  {
    id: 'intervals-min-flush-points',
    title: 'Fewest Cache Flushes to Cover All Dirty Ranges',
    statement:
      'Each dirty range [a, b] can be cleaned by a single flush at any time t with a ≤ t ≤ b. Return the minimum number of flush times so every range is cleaned.',
    pattern: 'intervals',
    nearest: 'non-overlapping-intervals',
    signals: ['"minimum number of points" stabbing intervals', 'a point covers every interval containing it', 'greedy on end times'],
    approach: 'Sort by end. Place a flush at the end of the first range; skip every range that contains it; place the next flush at the end of the first range that starts after it.',
    backend: 'Scheduling the fewest compaction or checkpoint runs so every write window is persisted before its deadline.',
  },
  {
    id: 'intervals-peak-concurrent-sessions',
    title: 'Peak Concurrent Sessions',
    statement:
      'Given login/logout timestamps for every session, return the maximum number of sessions active at the same time and the first moment it happens (a logout at t frees the slot for a login at t).',
    pattern: 'intervals',
    nearest: 'meeting-rooms-ii',
    signals: ['"maximum simultaneous"', 'start and end events', 'tie-breaking at equal timestamps'],
    approach: 'Sort starts and ends separately and sweep with two pointers (ends first on ties), tracking the running count, its max and the time it was reached.',
    backend: 'Capacity planning for license seats, WebSocket servers or a DB connection pool from access logs.',
  },
];
