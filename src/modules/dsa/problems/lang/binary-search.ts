import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the binary-search problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'binary-search': {
    java: `
public int search(int[] nums, int target) {
    int l = 0, r = nums.length - 1;         @init
    while (l <= r) {                        @while
        int m = l + (r - l) / 2;            @mid
        if (nums[m] > target) {             @gt
            r = m - 1;                      @left
        } else if (nums[m] < target) {      @lt
            l = m + 1;                      @right
        } else {
            return m;                       @found
        }
    }
    return -1;                              @miss
}
`,
    cpp: `
int search(vector<int>& nums, int target) {
    int l = 0, r = (int)nums.size() - 1;    @init
    while (l <= r) {                        @while
        int m = l + (r - l) / 2;            @mid
        if (nums[m] > target) {             @gt
            r = m - 1;                      @left
        } else if (nums[m] < target) {      @lt
            l = m + 1;                      @right
        } else {
            return m;                       @found
        }
    }
    return -1;                              @miss
}
`,
    distractors: [
      { java: '    while (l < r) {', cpp: '    while (l < r) {' },
      { java: '            r = m;', cpp: '            r = m;' },
      { java: '        double m = (l + r) / 2.0;', cpp: '        double m = (l + r) / 2.0;' },
    ],
    gotchas: {
      java: ['`(l + r) / 2` overflows once `l + r` exceeds `Integer.MAX_VALUE` — `l + (r - l) / 2` (or `(l + r) >>> 1`) is the safe midpoint.'],
      cpp: ['`(int)nums.size() - 1` — without the cast an empty vector gives `size_t` 0 − 1 = 18446744073709551615; `l + (r - l) / 2` avoids `int` overflow.'],
    },
  },

  'search-a-2d-matrix': {
    java: `
public boolean searchMatrix(int[][] matrix, int target) {
    int ROWS = matrix.length, COLS = matrix[0].length;       @init
    int top = 0, bot = ROWS - 1;                             @rowInit
    while (top <= bot) {                                     @rowWhile
        int row = (top + bot) / 2;                           @rowMid
        if (target > matrix[row][COLS - 1]) {                @below
            top = row + 1;                                   @down
        } else if (target < matrix[row][0]) {                @above
            bot = row - 1;                                   @up
        } else {
            break;                                           @rowFound
        }
    }
    if (!(top <= bot)) {                                     @noRow
        return false;                                        @noRowRet
    }
    int row = (top + bot) / 2;                               @row
    int l = 0, r = COLS - 1;                                 @colInit
    while (l <= r) {                                         @colWhile
        int m = (l + r) / 2;                                 @colMid
        if (target > matrix[row][m]) {                       @gt
            l = m + 1;                                       @right
        } else if (target < matrix[row][m]) {                @lt
            r = m - 1;                                       @left
        } else {
            return true;                                     @found
        }
    }
    return false;                                            @miss
}
`,
    cpp: `
bool searchMatrix(vector<vector<int>>& matrix, int target) {
    int ROWS = (int)matrix.size(), COLS = (int)matrix[0].size();   @init
    int top = 0, bot = ROWS - 1;                             @rowInit
    while (top <= bot) {                                     @rowWhile
        int row = (top + bot) / 2;                           @rowMid
        if (target > matrix[row].back()) {                   @below
            top = row + 1;                                   @down
        } else if (target < matrix[row][0]) {                @above
            bot = row - 1;                                   @up
        } else {
            break;                                           @rowFound
        }
    }
    if (!(top <= bot)) {                                     @noRow
        return false;                                        @noRowRet
    }
    int row = (top + bot) / 2;                               @row
    int l = 0, r = COLS - 1;                                 @colInit
    while (l <= r) {                                         @colWhile
        int m = (l + r) / 2;                                 @colMid
        if (target > matrix[row][m]) {                       @gt
            l = m + 1;                                       @right
        } else if (target < matrix[row][m]) {                @lt
            r = m - 1;                                       @left
        } else {
            return true;                                     @found
        }
    }
    return false;                                            @miss
}
`,
    distractors: [
      { java: '        if (target > matrix[row][0]) {', cpp: '        if (target > matrix[row][0]) {' },
      { java: '    for (int[] row : matrix) {', cpp: '    for (auto& row : matrix) {' },
      { java: '    int l = 0, r = ROWS - 1;', cpp: '    int l = 0, r = ROWS - 1;' },
    ],
    gotchas: {
      java: ['Java has no negative indexing — Python\'s `matrix[row][-1]` becomes `matrix[row][COLS - 1]`.'],
      cpp: ['`matrix[row][-1]` compiles in C++ but reads out of bounds (undefined behaviour) — use `matrix[row].back()` or `[COLS - 1]`.'],
    },
  },

  'koko-eating-bananas': {
    java: `
public int minEatingSpeed(int[] piles, int h) {
    int l = 1, r = Arrays.stream(piles).max().getAsInt();    @init
    int res = r;                                             @res
    while (l <= r) {                                         @while
        int k = l + (r - l) / 2;                             @mid
        long hours = 0;                                      @hours0
        for (int p : piles) {                                @each
            hours += (p + k - 1) / k;                        @hours
        }
        if (hours <= h) {                                    @fits
            res = Math.min(res, k);                          @record
            r = k - 1;                                       @left
        } else {
            l = k + 1;                                       @right
        }
    }
    return res;                                              @done
}
`,
    cpp: `
int minEatingSpeed(vector<int>& piles, int h) {
    int l = 1, r = *max_element(piles.begin(), piles.end()); @init
    int res = r;                                             @res
    while (l <= r) {                                         @while
        int k = l + (r - l) / 2;                             @mid
        long long hours = 0;                                 @hours0
        for (int p : piles) {                                @each
            hours += (p + k - 1) / k;                        @hours
        }
        if (hours <= h) {                                    @fits
            res = min(res, k);                               @record
            r = k - 1;                                       @left
        } else {
            l = k + 1;                                       @right
        }
    }
    return res;                                              @done
}
`,
    distractors: [
      { java: '            hours += p / k;', cpp: '            hours += p / k;' },
      { java: '    int l = 0, r = Arrays.stream(piles).max().getAsInt();', cpp: '    int l = 0, r = *max_element(piles.begin(), piles.end());' },
      { java: '            l = k + 1;', cpp: '            l = k + 1;' },
    ],
    gotchas: {
      java: [
        '`hours` must be a `long`: 10⁴ piles of 10⁹ bananas at speed 1 is 10¹³ hours, far past `Integer.MAX_VALUE`.',
        'Integer `/` truncates, so `Math.ceil(p / k)` is already floored before `ceil` runs — use `(p + k - 1) / k` or `Math.ceil((double) p / k)`.',
      ],
      cpp: ['Accumulate `hours` in `long long` — an `int` sum overflows (undefined behaviour) for large piles at small speeds; ceil with `(p + k - 1) / k`.'],
    },
  },

  'find-minimum-in-rotated-sorted-array': {
    java: `
public int findMin(int[] nums) {
    int l = 0, r = nums.length - 1;         @init
    int res = nums[0];                      @res
    while (l <= r) {                        @while
        if (nums[l] < nums[r]) {            @sorted
            res = Math.min(res, nums[l]);   @takeL
            break;                          @break
        }
        int m = (l + r) / 2;                @mid
        res = Math.min(res, nums[m]);       @takeM
        if (nums[m] >= nums[l]) {           @leftSorted
            l = m + 1;                      @goRight
        } else {
            r = m - 1;                      @goLeft
        }
    }
    return res;                             @done
}
`,
    cpp: `
int findMin(vector<int>& nums) {
    int l = 0, r = (int)nums.size() - 1;    @init
    int res = nums[0];                      @res
    while (l <= r) {                        @while
        if (nums[l] < nums[r]) {            @sorted
            res = min(res, nums[l]);        @takeL
            break;                          @break
        }
        int m = (l + r) / 2;                @mid
        res = min(res, nums[m]);            @takeM
        if (nums[m] >= nums[l]) {           @leftSorted
            l = m + 1;                      @goRight
        } else {
            r = m - 1;                      @goLeft
        }
    }
    return res;                             @done
}
`,
    distractors: [
      { java: '        if (nums[m] > nums[l]) {', cpp: '        if (nums[m] > nums[l]) {' },
      { java: '    return nums[l];', cpp: '    return nums[l];' },
      { java: '        if (nums[m] >= nums[r]) {', cpp: '        if (nums[m] >= nums[r]) {' },
    ],
    gotchas: {
      java: ['`Math.min` on two `int`s is fine; `Collections.min` / streams over `int[]` would box every element for no gain.'],
      cpp: ['`min(res, nums[m])` needs both arguments of the same type — `min(res, 0L)` or mixing `int`/`size_t` fails to deduce the template.'],
    },
  },

  'search-in-rotated-sorted-array': {
    java: `
public int search(int[] nums, int target) {
    int l = 0, r = nums.length - 1;                             @init
    while (l <= r) {                                            @while
        int m = (l + r) / 2;                                    @mid
        if (nums[m] == target) {                                @hit
            return m;                                           @found
        }
        if (nums[l] <= nums[m]) {                               @leftSorted
            if (target > nums[m] || target < nums[l]) {         @leftOut
                l = m + 1;                                      @goRightA
            } else {
                r = m - 1;                                      @goLeftA
            }
        } else {
            if (target < nums[m] || target > nums[r]) {         @rightOut
                r = m - 1;                                      @goLeftB
            } else {
                l = m + 1;                                      @goRightB
            }
        }
    }
    return -1;                                                  @miss
}
`,
    cpp: `
int search(vector<int>& nums, int target) {
    int l = 0, r = (int)nums.size() - 1;                        @init
    while (l <= r) {                                            @while
        int m = (l + r) / 2;                                    @mid
        if (nums[m] == target) {                                @hit
            return m;                                           @found
        }
        if (nums[l] <= nums[m]) {                               @leftSorted
            if (target > nums[m] || target < nums[l]) {         @leftOut
                l = m + 1;                                      @goRightA
            } else {
                r = m - 1;                                      @goLeftA
            }
        } else {
            if (target < nums[m] || target > nums[r]) {         @rightOut
                r = m - 1;                                      @goLeftB
            } else {
                l = m + 1;                                      @goRightB
            }
        }
    }
    return -1;                                                  @miss
}
`,
    distractors: [
      { java: '        if (nums[l] < nums[m]) {', cpp: '        if (nums[l] < nums[m]) {' },
      { java: '            if (target > nums[m] && target < nums[l]) {', cpp: '            if (target > nums[m] && target < nums[l]) {' },
      { java: '        if (nums[m] > target) {', cpp: '        if (nums[m] > target) {' },
    ],
    gotchas: {
      java: ['Python\'s `or` / `and` are `||` / `&&` — the single `|` / `&` also compile on booleans but do NOT short-circuit.'],
      cpp: ['`or` / `and` are valid alternative tokens in C++, but `||` / `&&` are the idiomatic spelling; `|` / `&` would evaluate both sides.'],
    },
  },

  'time-based-key-value-store': {
    java: `
class TimeMap {
    record Entry(String value, int timestamp) {}
    private final Map<String, List<Entry>> store = new HashMap<>();  // key -> [(value, timestamp), ...]   @init
    public void set(String key, String value, int timestamp) {
        store.computeIfAbsent(key, k -> new ArrayList<>()).add(new Entry(value, timestamp));   @set
    }
    public String get(String key, int timestamp) {
        String res = ""; List<Entry> values = store.getOrDefault(key, List.of());   @get
        int l = 0, r = values.size() - 1;                             @gInit
        while (l <= r) {                                              @while
            int m = (l + r) / 2;                                      @mid
            if (values.get(m).timestamp() <= timestamp) {             @le
                res = values.get(m).value();                          @record
                l = m + 1;                                            @right
            } else {
                r = m - 1;                                            @left
            }
        }
        return res;                                                   @ret
    }
}
`,
    cpp: `
class TimeMap {
    unordered_map<string, vector<pair<string, int>>> store;  // key -> [(value, timestamp), ...]   @init
public:
    void set(string key, string value, int timestamp) {
        store[key].emplace_back(value, timestamp);                    @set
    }
    string get(string key, int timestamp) {
        string res = ""; auto& values = store[key];                   @get
        int l = 0, r = (int)values.size() - 1;                        @gInit
        while (l <= r) {                                              @while
            int m = (l + r) / 2;                                      @mid
            if (values[m].second <= timestamp) {                      @le
                res = values[m].first;                                @record
                l = m + 1;                                            @right
            } else {
                r = m - 1;                                            @left
            }
        }
        return res;                                                   @ret
    }
};
`,
    distractors: [
      { java: '            if (values.get(m).timestamp() == timestamp) {', cpp: '            if (values[m].second == timestamp) {' },
      { java: '                r = m - 1;', cpp: '                r = m - 1;' },
      { java: '        store.put(key, new ArrayList<>(List.of(new Entry(value, timestamp))));', cpp: '        store[key] = {{value, timestamp}};' },
    ],
    gotchas: {
      java: [
        '`computeIfAbsent(key, k -> new ArrayList<>())` is Java\'s `setdefault`; `getOrDefault(key, List.of())` avoids a null check for unknown keys.',
        'A `record` gives a tiny immutable (value, timestamp) pair with accessors `value()` / `timestamp()`.',
      ],
      cpp: ['`store[key]` in `get` silently inserts an empty vector for unknown keys — harmless here, but use `find` when lookups must not grow the map.'],
    },
  },

  'median-of-two-sorted-arrays': {
    java: `
public double findMedianSortedArrays(int[] nums1, int[] nums2) {
    int[] A = nums1, B = nums2;                                     @init
    int total = A.length + B.length;                                @total
    int half = total / 2;                                           @half
    if (B.length < A.length) {                                      @swap
        int[] tmp = A; A = B; B = tmp;                              @doSwap
    }
    int l = 0, r = A.length - 1;                                    @lr
    while (true) {                                                  @loop
        int i = Math.floorDiv(l + r, 2);     // A[0..i] go left     @i
        int j = half - i - 2;                // B[0..j] go left     @j
        double Aleft = i >= 0 ? A[i] : Double.NEGATIVE_INFINITY;    @aL
        double Aright = i + 1 < A.length ? A[i + 1] : Double.POSITIVE_INFINITY;   @aR
        double Bleft = j >= 0 ? B[j] : Double.NEGATIVE_INFINITY;    @bL
        double Bright = j + 1 < B.length ? B[j + 1] : Double.POSITIVE_INFINITY;   @bR
        if (Aleft <= Bright && Bleft <= Aright) {                   @ok
            if (total % 2 == 1) {                                   @odd
                return Math.min(Aright, Bright);                    @oddRet
            }
            return (Math.max(Aleft, Bleft) + Math.min(Aright, Bright)) / 2;   @evenRet
        } else if (Aleft > Bright) {                                @tooMany
            r = i - 1;                                              @fewer
        } else {
            l = i + 1;                                              @more
        }
    }
}
`,
    cpp: `
double findMedianSortedArrays(vector<int>& nums1, vector<int>& nums2) {
    vector<int>& A = nums1; vector<int>& B = nums2;                 @init
    int total = (int)(A.size() + B.size());                         @total
    int half = total / 2;                                           @half
    if (B.size() < A.size()) {                                      @swap
        swap(A, B);                                                 @doSwap
    }
    int l = 0, r = (int)A.size() - 1;                               @lr
    const double INF = numeric_limits<double>::infinity();
    while (true) {                                                  @loop
        int i = (l + r) >> 1;                // floor; A[0..i] go left   @i
        int j = half - i - 2;                // B[0..j] go left     @j
        double Aleft = i >= 0 ? A[i] : -INF;                        @aL
        double Aright = i + 1 < (int)A.size() ? A[i + 1] : INF;     @aR
        double Bleft = j >= 0 ? B[j] : -INF;                        @bL
        double Bright = j + 1 < (int)B.size() ? B[j + 1] : INF;     @bR
        if (Aleft <= Bright && Bleft <= Aright) {                   @ok
            if (total % 2) {                                        @odd
                return min(Aright, Bright);                         @oddRet
            }
            return (max(Aleft, Bleft) + min(Aright, Bright)) / 2;   @evenRet
        } else if (Aleft > Bright) {                                @tooMany
            r = i - 1;                                              @fewer
        } else {
            l = i + 1;                                              @more
        }
    }
}
`,
    distractors: [
      { java: '        int j = half - i;', cpp: '        int j = half - i;' },
      { java: '            r = i + 1;', cpp: '            r = i + 1;' },
      {
        java: '    int[] merged = IntStream.concat(Arrays.stream(nums1), Arrays.stream(nums2)).sorted().toArray();',
        cpp: '    vector<int> merged(nums1); merged.insert(merged.end(), nums2.begin(), nums2.end()); sort(merged.begin(), merged.end());',
      },
    ],
    gotchas: {
      python: ['`(l + r) // 2` with `l = 0, r = -1` is −1 (floor) — the algorithm relies on that to mean "take nothing from A".'],
      java: [
        '`(l + r) / 2` truncates toward zero, so (0 + −1) / 2 is 0, not −1 — use `Math.floorDiv(l + r, 2)` (or `>> 1`) or the search breaks when A contributes nothing.',
        '`Integer.MIN_VALUE` / `MAX_VALUE` sentinels risk overflow when two are summed for the even-length average; `double` infinities cannot overflow.',
      ],
      cpp: [
        '`(l + r) / 2` truncates toward zero; `(l + r) >> 1` floors (arithmetic shift, guaranteed since C++20) so −1 stays −1.',
        '`swap(A, B)` on references swaps the caller\'s vectors in O(1) (just their buffers) — fine here, but note it mutates the inputs.',
      ],
    },
  },
};
