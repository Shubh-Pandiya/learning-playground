import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the greedy problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'maximum-subarray': {
    java: `
public int maxSubArray(int[] nums) {
    int res = nums[0], cur = 0;        @init
    for (int n : nums) {               @loop
        if (cur < 0) {                 @check
            cur = 0;                   @reset
        }
        cur += n;                      @add
        res = Math.max(res, cur);      @best
    }
    return res;                        @done
}
`,
    cpp: `
int maxSubArray(vector<int>& nums) {
    int res = nums[0], cur = 0;        @init
    for (int n : nums) {               @loop
        if (cur < 0) {                 @check
            cur = 0;                   @reset
        }
        cur += n;                      @add
        res = max(res, cur);           @best
    }
    return res;                        @done
}
`,
    distractors: [
      { java: '    int res = 0, cur = 0;', cpp: '    int res = 0, cur = 0;' },
      { java: '        if (n < 0) {', cpp: '        if (n < 0) {' },
      { java: '        cur = Math.max(cur, n);', cpp: '        cur = max(cur, n);' },
    ],
    gotchas: {
      python: ['Python ints never overflow, so seeding with `float("-inf")` is harmless; seeding with `nums[0]` avoids mixing floats and ints.'],
      java: ['Seeding `res` with `Integer.MIN_VALUE` is fine, but never ADD to it — `Integer.MIN_VALUE + (-1)` wraps to `Integer.MAX_VALUE`.'],
      cpp: ['Seeding with `INT_MIN` and then adding a negative is signed overflow (undefined behaviour); `nums[0]` is the safe seed.'],
    },
  },

  'jump-game': {
    java: `
public boolean canJump(int[] nums) {
    int goal = nums.length - 1;                      @init
    for (int i = nums.length - 1; i >= 0; i--) {     @loop
        if (i + nums[i] >= goal) {                   @check
            goal = i;                                @move
        }
    }
    return goal == 0;                                @done
}
`,
    cpp: `
bool canJump(vector<int>& nums) {
    int goal = (int)nums.size() - 1;                 @init
    for (int i = (int)nums.size() - 1; i >= 0; i--) {   @loop
        if (i + nums[i] >= goal) {                   @check
            goal = i;                                @move
        }
    }
    return goal == 0;                                @done
}
`,
    distractors: [
      { java: '        if (i + nums[i] == goal) {', cpp: '        if (i + nums[i] == goal) {' },
      { java: '    for (int i = 0; i < nums.length; i++) {', cpp: '    for (int i = 0; i < (int)nums.size(); i++) {' },
      { java: '    return goal == nums.length - 1;', cpp: '    return goal == (int)nums.size() - 1;' },
    ],
    gotchas: {
      python: ['`range(len(nums) - 1, -1, -1)` stops BEFORE −1, so index 0 is included; `reversed(range(len(nums)))` says the same thing more readably.'],
      cpp: ['`for (size_t i = nums.size() - 1; i >= 0; i--)` never ends — an unsigned `i` is always ≥ 0 and wraps around; count down with an `int`.'],
    },
  },

  'jump-game-ii': {
    java: `
public int jump(int[] nums) {
    int res = 0;                                     @init
    int l = 0, r = 0;
    while (r < nums.length - 1) {                    @loop
        int farthest = 0;                            @far0
        for (int i = l; i <= r; i++) {               @scan
            farthest = Math.max(farthest, i + nums[i]);   @far
        }
        l = r + 1;                                   @nextL
        r = farthest;                                @nextR
        res++;                                       @count
    }
    return res;                                      @done
}
`,
    cpp: `
int jump(vector<int>& nums) {
    int res = 0;                                     @init
    int l = 0, r = 0;
    while (r < (int)nums.size() - 1) {               @loop
        int farthest = 0;                            @far0
        for (int i = l; i <= r; i++) {               @scan
            farthest = max(farthest, i + nums[i]);   @far
        }
        l = r + 1;                                   @nextL
        r = farthest;                                @nextR
        res++;                                       @count
    }
    return res;                                      @done
}
`,
    distractors: [
      { java: '    while (r < nums.length) {', cpp: '    while (r < (int)nums.size()) {' },
      { java: '        l = farthest;', cpp: '        l = farthest;' },
      { java: '            farthest = i + nums[i];', cpp: '            farthest = i + nums[i];' },
    ],
    gotchas: {
      python: ['`l = r = 0` is safe for ints, but `a = b = []` makes both names point at the SAME list.'],
      cpp: ['Without the `(int)` cast, `r < nums.size() - 1` compares a signed `int` with an unsigned `size_t` — a negative `r` would convert to a huge number.'],
    },
  },

  'gas-station': {
    java: `
public int canCompleteCircuit(int[] gas, int[] cost) {
    if (Arrays.stream(gas).sum() < Arrays.stream(cost).sum()) {   @feasible
        return -1;                                   @none
    }
    int total = 0, res = 0;                          @init
    for (int i = 0; i < gas.length; i++) {           @loop
        total += gas[i] - cost[i];                   @add
        if (total < 0) {                             @check
            total = 0; res = i + 1;                  @reset
        }
    }
    return res;                                      @done
}
`,
    cpp: `
int canCompleteCircuit(vector<int>& gas, vector<int>& cost) {
    if (accumulate(gas.begin(), gas.end(), 0) < accumulate(cost.begin(), cost.end(), 0)) {   @feasible
        return -1;                                   @none
    }
    int total = 0, res = 0;                          @init
    for (int i = 0; i < (int)gas.size(); i++) {      @loop
        total += gas[i] - cost[i];                   @add
        if (total < 0) {                             @check
            total = 0; res = i + 1;                  @reset
        }
    }
    return res;                                      @done
}
`,
    distractors: [
      { java: '            total = 0; res = res + 1;', cpp: '            total = 0; res = res + 1;' },
      { java: '        if (total <= 0) {', cpp: '        if (total <= 0) {' },
      { java: '    for (int i = 0; i < 2 * gas.length; i++) {', cpp: '    for (int i = 0; i < 2 * (int)gas.size(); i++) {' },
    ],
    gotchas: {
      java: ['`Arrays.stream(gas).sum()` returns an `int` and can overflow for huge inputs — `.asLongStream().sum()` if the totals might exceed 2³¹.'],
      cpp: ['`accumulate`’s result type is the type of its initial value: pass `0LL`, not `0`, when the sum might not fit in an `int`.'],
    },
  },

  'hand-of-straights': {
    java: `
public boolean isNStraightHand(int[] hand, int groupSize) {
    if (hand.length % groupSize != 0) {                  @size
        return false;                                    @badSize
    }
    Map<Integer, Integer> count = new HashMap<>();       @count
    for (int h : hand) count.merge(h, 1, Integer::sum);
    List<Integer> keys = new ArrayList<>(count.keySet());   @keys
    PriorityQueue<Integer> minH = new PriorityQueue<>(keys);   @heapify
    while (!minH.isEmpty()) {                            @loop
        int first = minH.peek();                         @first
        for (int i = first; i < first + groupSize; i++) {   @group
            if (!count.containsKey(i)) {                 @missing
                return false;                            @fail
            }
            count.put(i, count.get(i) - 1);              @use
            if (count.get(i) == 0) {                     @zero
                if (i != minH.peek()) {                  @order
                    return false;                        @gap
                }
                minH.poll();                             @pop
            }
        }
    }
    return true;                                         @done
}
`,
    cpp: `
bool isNStraightHand(vector<int>& hand, int groupSize) {
    if (hand.size() % groupSize) {                       @size
        return false;                                    @badSize
    }
    unordered_map<int, int> count;                       @count
    for (int h : hand) count[h]++;
    vector<int> keys;
    for (auto& [k, c] : count) keys.push_back(k);        @keys
    priority_queue<int, vector<int>, greater<int>> minH(greater<int>(), keys);   @heapify
    while (!minH.empty()) {                              @loop
        int first = minH.top();                          @first
        for (int i = first; i < first + groupSize; i++) {   @group
            if (!count.count(i)) {                       @missing
                return false;                            @fail
            }
            count[i]--;                                  @use
            if (count[i] == 0) {                         @zero
                if (i != minH.top()) {                   @order
                    return false;                        @gap
                }
                minH.pop();                              @pop
            }
        }
    }
    return true;                                         @done
}
`,
    distractors: [
      { java: '        int first = Collections.max(count.keySet());', cpp: '        int first = max_element(count.begin(), count.end())->first;' },
      { java: '                if (i == minH.peek()) {', cpp: '                if (i == minH.top()) {' },
      { java: '    Arrays.sort(hand);', cpp: '    sort(hand.begin(), hand.end());' },
    ],
    gotchas: {
      python: ['`heapq` only offers a MIN-heap over a plain list — `minH[0]` peeks, `heapq.heappop` removes.'],
      java: ['`i != minH.peek()` unboxes because `i` is an `int`; comparing two `Integer`s (e.g. `minH.peek() != count.get(x)`) compares references and breaks above 127.'],
      cpp: ['`priority_queue` is a MAX-heap by default — the min-heap needs `greater<int>`; the `(comparator, container)` constructor heapifies in O(n).'],
    },
  },

  'merge-triplets-to-form-target-triplet': {
    java: `
public boolean mergeTriplets(int[][] triplets, int[] target) {
    Set<Integer> good = new HashSet<>();                 @init
    for (int[] t : triplets) {                           @loop
        if (t[0] > target[0] || t[1] > target[1] || t[2] > target[2]) {   @skip
            continue;                                    @cont
        }
        for (int i = 0; i < 3; i++) {                    @each
            int v = t[i];
            if (v == target[i]) {                        @match
                good.add(i);                             @add
            }
        }
    }
    return good.size() == 3;                             @done
}
`,
    cpp: `
bool mergeTriplets(vector<vector<int>>& triplets, vector<int>& target) {
    unordered_set<int> good;                             @init
    for (auto& t : triplets) {                           @loop
        if (t[0] > target[0] || t[1] > target[1] || t[2] > target[2]) {   @skip
            continue;                                    @cont
        }
        for (int i = 0; i < 3; i++) {                    @each
            int v = t[i];
            if (v == target[i]) {                        @match
                good.insert(i);                          @add
            }
        }
    }
    return good.size() == 3;                             @done
}
`,
    distractors: [
      { java: '        if (Arrays.equals(t, target)) {', cpp: '        if (t == target) {' },
      { java: '        if (t[0] < target[0] || t[1] < target[1] || t[2] < target[2]) {', cpp: '        if (t[0] < target[0] || t[1] < target[1] || t[2] < target[2]) {' },
      { java: '            if (v >= target[i]) {', cpp: '            if (v >= target[i]) {' },
    ],
    gotchas: {
      java: ['`t == target` on arrays compares references (always false here) — element-wise equality is `Arrays.equals(t, target)`.'],
      cpp: ['`vector == vector` compares element by element (like Python lists); iterate with `auto&` so each triplet is not copied.'],
    },
  },

  'partition-labels': {
    java: `
public List<Integer> partitionLabels(String s) {
    int[] last = new int[26];
    for (int i = 0; i < s.length(); i++) last[s.charAt(i) - 'a'] = i;   @last
    List<Integer> res = new ArrayList<>();          @init
    int start = 0, end = 0;
    for (int i = 0; i < s.length(); i++) {          @loop
        char c = s.charAt(i);
        end = Math.max(end, last[c - 'a']);         @extend
        if (i == end) {                             @check
            res.add(end - start + 1);               @cut
            start = i + 1;                          @reset
        }
    }
    return res;                                     @done
}
`,
    cpp: `
vector<int> partitionLabels(string s) {
    vector<int> last(26);
    for (int i = 0; i < (int)s.size(); i++) last[s[i] - 'a'] = i;   @last
    vector<int> res;                                @init
    int start = 0, end = 0;
    for (int i = 0; i < (int)s.size(); i++) {       @loop
        char c = s[i];
        end = max(end, last[c - 'a']);              @extend
        if (i == end) {                             @check
            res.push_back(end - start + 1);         @cut
            start = i + 1;                          @reset
        }
    }
    return res;                                     @done
}
`,
    distractors: [
      { java: "        end = last[c - 'a'];", cpp: "        end = last[c - 'a'];" },
      { java: "        if (last[c - 'a'] == i) {", cpp: "        if (last[c - 'a'] == i) {" },
      { java: '            res.add(end - start);', cpp: '            res.push_back(end - start);' },
    ],
    gotchas: {
      python: ['`{c: i for i, c in enumerate(s)}` keeps the LAST index because later pairs overwrite earlier ones.'],
      java: ['`int[26]` indexed by `c - \'a\'` only works for lowercase letters; use a `HashMap<Character, Integer>` for arbitrary characters.'],
      cpp: ['`s[i] - \'a\'` is an `int` offset; a non-lowercase char gives a negative or ≥ 26 index, which `vector::operator[]` does not bounds-check.'],
    },
  },

  'valid-parenthesis-string': {
    java: `
public boolean checkValidString(String s) {
    int leftMin = 0, leftMax = 0;                        @init
    for (char c : s.toCharArray()) {                     @loop
        if (c == '(') {                                  @isOpen
            leftMin++; leftMax++;                        @open
        } else if (c == ')') {                           @isClose
            leftMin--; leftMax--;                        @close
        } else {
            leftMin--; leftMax++;                        @star
        }
        if (leftMax < 0) {                               @tooMany
            return false;                                @fail
        }
        leftMin = Math.max(leftMin, 0);                  @clamp
    }
    return leftMin == 0;                                 @done
}
`,
    cpp: `
bool checkValidString(string s) {
    int leftMin = 0, leftMax = 0;                        @init
    for (char c : s) {                                   @loop
        if (c == '(') {                                  @isOpen
            leftMin++; leftMax++;                        @open
        } else if (c == ')') {                           @isClose
            leftMin--; leftMax--;                        @close
        } else {
            leftMin--; leftMax++;                        @star
        }
        if (leftMax < 0) {                               @tooMany
            return false;                                @fail
        }
        leftMin = max(leftMin, 0);                       @clamp
    }
    return leftMin == 0;                                 @done
}
`,
    distractors: [
      { java: '        if (leftMin < 0) return false;', cpp: '        if (leftMin < 0) return false;' },
      { java: '    return leftMax == 0;', cpp: '    return leftMax == 0;' },
      { java: '            leftMin++; leftMax--;', cpp: '            leftMin++; leftMax--;' },
    ],
    gotchas: {
      python: ['The tuple assignment `leftMin, leftMax = leftMin + 1, leftMax + 1` evaluates the right side first — harmless here, but it is what makes swaps like `a, b = b, a` work.'],
      java: ['Compare chars with single quotes: `c == \'(\'`; `c == "("` does not compile because `"("` is a `String`.'],
      cpp: ['`c == "("` compares a `char` with a `const char*` and fails to compile — use the char literal `\'(\'`.'],
    },
  },
};
