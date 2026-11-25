import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the intervals problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'insert-interval': {
    java: `
public int[][] insert(int[][] intervals, int[] newInterval) {
    List<int[]> res = new ArrayList<>();                          @init
    for (int i = 0; i < intervals.length; i++) {                  @loop
        if (newInterval[1] < intervals[i][0]) {                   @before
            res.add(newInterval);                                 @placeNew
            return Stream.concat(res.stream(), Arrays.stream(intervals, i, intervals.length)).toArray(int[][]::new);  @rest
        } else if (newInterval[0] > intervals[i][1]) {            @after
            res.add(intervals[i]);                                @keep
        } else {
            newInterval = new int[] { Math.min(newInterval[0], intervals[i][0]), Math.max(newInterval[1], intervals[i][1]) };  @merge
        }
    }
    res.add(newInterval);                                         @append
    return res.toArray(new int[0][]);                             @done
}
`,
    cpp: `
vector<vector<int>> insert(vector<vector<int>>& intervals, vector<int>& newInterval) {
    vector<vector<int>> res;                                      @init
    for (int i = 0; i < (int)intervals.size(); i++) {             @loop
        if (newInterval[1] < intervals[i][0]) {                   @before
            res.push_back(newInterval);                           @placeNew
            res.insert(res.end(), intervals.begin() + i, intervals.end()); return res;  @rest
        } else if (newInterval[0] > intervals[i][1]) {            @after
            res.push_back(intervals[i]);                          @keep
        } else {
            newInterval = {min(newInterval[0], intervals[i][0]), max(newInterval[1], intervals[i][1])};  @merge
        }
    }
    res.push_back(newInterval);                                   @append
    return res;                                                   @done
}
`,
    distractors: [
      { java: '        if (newInterval[1] <= intervals[i][0]) {', cpp: '        if (newInterval[1] <= intervals[i][0]) {' },
      { java: '            newInterval = new int[] { intervals[i][0], newInterval[1] };', cpp: '            newInterval = {intervals[i][0], newInterval[1]};' },
      { java: '            return res.toArray(new int[0][]);', cpp: '            return res;' },
    ],
    gotchas: {
      java: ['Collect into a `List<int[]>` and convert at the end with `res.toArray(new int[0][])` — Java arrays cannot grow.'],
      cpp: ['`res.insert(res.end(), first, last)` appends a whole range — the C++ spelling of `res + intervals[i:]`.'],
    },
  },

  'merge-intervals': {
    java: `
public int[][] merge(int[][] intervals) {
    Arrays.sort(intervals, (a, b) -> Integer.compare(a[0], b[0]));    @sort
    List<int[]> output = new ArrayList<>(List.of(intervals[0]));      @init
    for (int i = 1; i < intervals.length; i++) {                      @loop
        int start = intervals[i][0], end = intervals[i][1];
        int lastEnd = output.get(output.size() - 1)[1];               @last
        if (start <= lastEnd) {                                       @check
            output.get(output.size() - 1)[1] = Math.max(lastEnd, end);  @merge
        } else {
            output.add(new int[] { start, end });                     @push
        }
    }
    return output.toArray(new int[0][]);                              @done
}
`,
    cpp: `
vector<vector<int>> merge(vector<vector<int>>& intervals) {
    sort(intervals.begin(), intervals.end(), [](const auto& a, const auto& b) { return a[0] < b[0]; });  @sort
    vector<vector<int>> output = {intervals[0]};                      @init
    for (int i = 1; i < (int)intervals.size(); i++) {                 @loop
        int start = intervals[i][0], end = intervals[i][1];
        int lastEnd = output.back()[1];                               @last
        if (start <= lastEnd) {                                       @check
            output.back()[1] = max(lastEnd, end);                     @merge
        } else {
            output.push_back({start, end});                           @push
        }
    }
    return output;                                                    @done
}
`,
    distractors: [
      { java: '        if (start < lastEnd) {', cpp: '        if (start < lastEnd) {' },
      { java: '            output.get(output.size() - 1)[1] = end;', cpp: '            output.back()[1] = end;' },
      {
        java: '    Arrays.sort(intervals, (a, b) -> Integer.compare(a[1], b[1]));',
        cpp: '    sort(intervals.begin(), intervals.end(), [](const auto& a, const auto& b) { return a[1] < b[1]; });',
      },
    ],
    gotchas: {
      java: [
        'Sort with `Integer.compare(a[0], b[0])`, not `a[0] - b[0]` — the subtraction overflows for values near ±2³¹ and breaks the ordering.',
        '`output.get(output.size() - 1)` returns the stored `int[]` itself, so writing `[1]` updates it in place.',
      ],
      cpp: [
        'A `sort` comparator must be a strict weak ordering — use `<`, never `<=` (undefined behaviour, can crash on equal starts).',
        '`output.back()` returns a reference, so `output.back()[1] = …` mutates in place; `auto last = output.back();` would edit a copy.',
      ],
    },
  },

  'non-overlapping-intervals': {
    java: `
public int eraseOverlapIntervals(int[][] intervals) {
    Arrays.sort(intervals, (a, b) -> Integer.compare(a[0], b[0]));  @sort
    int res = 0;                                    @init
    int prevEnd = intervals[0][1];
    for (int i = 1; i < intervals.length; i++) {    @loop
        int start = intervals[i][0], end = intervals[i][1];
        if (start >= prevEnd) {                     @check
            prevEnd = end;                          @keep
        } else {
            res++;                                  @remove
            prevEnd = Math.min(end, prevEnd);       @shrink
        }
    }
    return res;                                     @done
}
`,
    cpp: `
int eraseOverlapIntervals(vector<vector<int>>& intervals) {
    sort(intervals.begin(), intervals.end());       @sort
    int res = 0;                                    @init
    int prevEnd = intervals[0][1];
    for (int i = 1; i < (int)intervals.size(); i++) {  @loop
        int start = intervals[i][0], end = intervals[i][1];
        if (start >= prevEnd) {                     @check
            prevEnd = end;                          @keep
        } else {
            res++;                                  @remove
            prevEnd = min(end, prevEnd);            @shrink
        }
    }
    return res;                                     @done
}
`,
    distractors: [
      { java: '            prevEnd = Math.max(end, prevEnd);', cpp: '            prevEnd = max(end, prevEnd);' },
      { java: '        if (start > prevEnd) {', cpp: '        if (start > prevEnd) {' },
      { java: '            prevEnd = end;', cpp: '            prevEnd = end;' },
    ],
    gotchas: {
      python: ['`intervals.sort()` on lists sorts lexicographically (start, then end) — no key needed.'],
      java: ['`Arrays.sort(int[][])` without a comparator throws `ClassCastException` (`int[]` is not `Comparable`); compare with `Integer.compare`, not subtraction, to avoid overflow.'],
      cpp: ['`sort` on `vector<vector<int>>` is already lexicographic like Python; a custom comparator must use `<`, never `<=`.'],
    },
  },

  'meeting-rooms': {
    java: `
public boolean canAttendMeetings(int[][] intervals) {
    Arrays.sort(intervals, (a, b) -> Integer.compare(a[0], b[0]));    @sort
    for (int i = 1; i < intervals.length; i++) {                      @loop
        if (intervals[i][0] < intervals[i - 1][1]) {                  @check
            return false;                                             @clash
        }
    }
    return true;                                                      @done
}
`,
    cpp: `
bool canAttendMeetings(vector<vector<int>>& intervals) {
    sort(intervals.begin(), intervals.end());                         @sort
    for (int i = 1; i < (int)intervals.size(); i++) {                 @loop
        if (intervals[i][0] < intervals[i - 1][1]) {                  @check
            return false;                                             @clash
        }
    }
    return true;                                                      @done
}
`,
    distractors: [
      { java: '        if (intervals[i][0] <= intervals[i - 1][1]) {', cpp: '        if (intervals[i][0] <= intervals[i - 1][1]) {' },
      { java: '        if (intervals[i][1] < intervals[i - 1][1]) {', cpp: '        if (intervals[i][1] < intervals[i - 1][1]) {' },
    ],
    gotchas: {
      java: ['`(a, b) -> a[0] - b[0]` can overflow for large timestamps — `Integer.compare(a[0], b[0])` (or `Comparator.comparingInt(a -> a[0])`) is safe.'],
      cpp: ['Default `sort` on `vector<vector<int>>` compares element by element, so it already orders by start time.'],
    },
  },

  'meeting-rooms-ii': {
    java: `
public int minMeetingRooms(int[][] intervals) {
    int[] start = Arrays.stream(intervals).mapToInt(i -> i[0]).sorted().toArray();   @starts
    int[] end = Arrays.stream(intervals).mapToInt(i -> i[1]).sorted().toArray();     @ends
    int res = 0, count = 0;                        @init
    int s = 0, e = 0;
    while (s < intervals.length) {                 @loop
        if (start[s] < end[e]) {                   @check
            s++; count++;                          @open
        } else {
            e++; count--;                          @close
        }
        res = Math.max(res, count);                @best
    }
    return res;                                    @done
}
`,
    cpp: `
int minMeetingRooms(vector<vector<int>>& intervals) {
    vector<int> start, end;
    for (auto& i : intervals) { start.push_back(i[0]); end.push_back(i[1]); }
    sort(start.begin(), start.end());              @starts
    sort(end.begin(), end.end());                  @ends
    int res = 0, count = 0;                        @init
    int s = 0, e = 0;
    while (s < (int)intervals.size()) {            @loop
        if (start[s] < end[e]) {                   @check
            s++; count++;                          @open
        } else {
            e++; count--;                          @close
        }
        res = max(res, count);                     @best
    }
    return res;                                    @done
}
`,
    distractors: [
      { java: '        if (start[s] <= end[e]) {', cpp: '        if (start[s] <= end[e]) {' },
      { java: '    while (s < intervals.length && e < intervals.length) {', cpp: '    while (s < (int)intervals.size() && e < (int)intervals.size()) {' },
      { java: '        res = count;', cpp: '        res = count;' },
    ],
    gotchas: {
      java: ['`Arrays.stream(intervals).mapToInt(i -> i[0]).sorted().toArray()` is the one-line equivalent of `sorted([i[0] for i in intervals])`.'],
      cpp: ['A local named `end` hides `std::end` inside this function — harmless here, but `using namespace std` makes such name clashes easy.'],
    },
  },

  'minimum-interval-to-include-each-query': {
    java: `
public int[] minInterval(int[][] intervals, int[] queries) {
    Arrays.sort(intervals, (a, b) -> Integer.compare(a[0], b[0]));       @sort
    PriorityQueue<int[]> minHeap = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));  @init
    Map<Integer, Integer> res = new HashMap<>(); int i = 0;
    for (int q : Arrays.stream(queries).sorted().toArray()) {             @loop
        while (i < intervals.length && intervals[i][0] <= q) {            @addLoop
            int l = intervals[i][0], r = intervals[i][1];                 @take
            minHeap.offer(new int[] { r - l + 1, r });                    @push
            i++;
        }
        while (!minHeap.isEmpty() && minHeap.peek()[1] < q) {             @popLoop
            minHeap.poll();                                               @pop
        }
        res.put(q, minHeap.isEmpty() ? -1 : minHeap.peek()[0]);           @answer
    }
    return Arrays.stream(queries).map(q -> res.get(q)).toArray();         @done
}
`,
    cpp: `
vector<int> minInterval(vector<vector<int>>& intervals, vector<int>& queries) {
    sort(intervals.begin(), intervals.end());                             @sort
    priority_queue<pair<int, int>, vector<pair<int, int>>, greater<>> minHeap;  @init
    unordered_map<int, int> res; int i = 0;
    vector<int> sortedQ = queries;
    sort(sortedQ.begin(), sortedQ.end());
    for (int q : sortedQ) {                                               @loop
        while (i < (int)intervals.size() && intervals[i][0] <= q) {       @addLoop
            int l = intervals[i][0], r = intervals[i][1];                 @take
            minHeap.push({r - l + 1, r});                                 @push
            i++;
        }
        while (!minHeap.empty() && minHeap.top().second < q) {            @popLoop
            minHeap.pop();                                                @pop
        }
        res[q] = minHeap.empty() ? -1 : minHeap.top().first;              @answer
    }
    vector<int> ans;
    for (int q : queries) ans.push_back(res[q]);                          @done
    return ans;
}
`,
    distractors: [
      { java: '            minHeap.offer(new int[] { r, r - l + 1 });', cpp: '            minHeap.push({r, r - l + 1});' },
      { java: '        while (!minHeap.isEmpty() && minHeap.peek()[1] <= q) {', cpp: '        while (!minHeap.empty() && minHeap.top().second <= q) {' },
      { java: '    return Arrays.stream(queries).sorted().map(q -> res.get(q)).toArray();', cpp: '    for (int q : sortedQ) ans.push_back(res[q]);' },
    ],
    gotchas: {
      python: ['`heapq` compares tuples element by element, so `(size, r)` pops the shortest interval first.'],
      java: ['`PriorityQueue<int[]>` needs a comparator — `int[]` is not `Comparable`, so the first `offer` of a second element throws `ClassCastException`.'],
      cpp: ['`priority_queue` is a MAX-heap; `greater<>` turns it into a min-heap that compares `pair`s lexicographically like Python tuples.'],
    },
  },
};
