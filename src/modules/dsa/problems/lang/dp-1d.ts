import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the 1-D dynamic-programming problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'climbing-stairs': {
    java: `
public int climbStairs(int n) {
    int[] dp = new int[n + 1];          @init
    dp[0] = dp[1] = 1;                  @seed
    for (int i = 2; i <= n; i++) {      @loop
        dp[i] = dp[i - 1] + dp[i - 2];  @calc
    }
    return dp[n];                       @done
}
`,
    cpp: `
int climbStairs(int n) {
    vector<int> dp(n + 1, 0);           @init
    dp[0] = dp[1] = 1;                  @seed
    for (int i = 2; i <= n; i++) {      @loop
        dp[i] = dp[i - 1] + dp[i - 2];  @calc
    }
    return dp[n];                       @done
}
`,
    distractors: [
      { java: '        dp[i] = dp[i - 1] * dp[i - 2];', cpp: '        dp[i] = dp[i - 1] * dp[i - 2];' },
      { java: '    for (int i = 2; i < n; i++) {', cpp: '    for (int i = 2; i < n; i++) {' },
      { java: '        dp[i] = dp[i - 1] + 1;', cpp: '        dp[i] = dp[i - 1] + 1;' },
    ],
    gotchas: {
      python: ['The memoised version is `@cache` (or `@lru_cache(None)`) on `def dfs(i)` — without it the recursion is O(2ⁿ).'],
      java: ['`new int[n + 1]` is already zero-filled; the counts are Fibonacci numbers, so beyond n = 45 they overflow `int` — switch to `long`.'],
      cpp: ['Use `vector<int> dp(n + 1, 0)`; `int dp[n + 1]` is a non-standard variable-length array. Past n = 45 use `long long`.'],
    },
  },

  'min-cost-climbing-stairs': {
    java: `
public int minCostClimbingStairs(int[] cost) {
    int n = cost.length;
    int[] dp = new int[n + 1];              @init
    for (int i = 2; i <= n; i++) {          @loop
        int one = dp[i - 1] + cost[i - 1];  @one
        int two = dp[i - 2] + cost[i - 2];  @two
        dp[i] = Math.min(one, two);         @calc
    }
    return dp[n];                           @done
}
`,
    cpp: `
int minCostClimbingStairs(vector<int>& cost) {
    int n = cost.size();
    vector<int> dp(n + 1, 0);               @init
    for (int i = 2; i <= n; i++) {          @loop
        int one = dp[i - 1] + cost[i - 1];  @one
        int two = dp[i - 2] + cost[i - 2];  @two
        dp[i] = min(one, two);              @calc
    }
    return dp[n];                           @done
}
`,
    distractors: [
      { java: '    return dp[n - 1];', cpp: '    return dp[n - 1];' },
      { java: '        dp[i] = Math.min(dp[i - 1], dp[i - 2]) + cost[i];', cpp: '        dp[i] = min(dp[i - 1], dp[i - 2]) + cost[i];' },
      { java: '        dp[i] = Math.max(one, two);', cpp: '        dp[i] = max(one, two);' },
    ],
    gotchas: {
      java: ['Reading `cost[n]` throws `ArrayIndexOutOfBoundsException` — the top (index n) exists only in `dp`, which is why it has n + 1 slots.'],
      cpp: ['`cost[n]` is undefined behaviour, not an exception — it silently reads garbage; use `cost.at(i)` while debugging.'],
    },
  },

  'house-robber': {
    java: `
public int rob(int[] nums) {
    if (nums.length == 1) {                                @single
        return nums[0];                                    @ret1
    }
    int[] dp = new int[nums.length];                       @init
    dp[0] = nums[0];                                       @seed0
    dp[1] = Math.max(nums[0], nums[1]);                    @seed1
    for (int i = 2; i < nums.length; i++) {                @loop
        dp[i] = Math.max(dp[i - 1], dp[i - 2] + nums[i]);  @calc
    }
    return dp[nums.length - 1];                            @done
}
`,
    cpp: `
int rob(vector<int>& nums) {
    if (nums.size() == 1) {                           @single
        return nums[0];                               @ret1
    }
    vector<int> dp(nums.size(), 0);                   @init
    dp[0] = nums[0];                                  @seed0
    dp[1] = max(nums[0], nums[1]);                    @seed1
    for (int i = 2; i < (int)nums.size(); i++) {      @loop
        dp[i] = max(dp[i - 1], dp[i - 2] + nums[i]);  @calc
    }
    return dp.back();                                 @done
}
`,
    distractors: [
      { java: '        dp[i] = dp[i - 2] + nums[i];', cpp: '        dp[i] = dp[i - 2] + nums[i];' },
      { java: '    dp[1] = nums[1];', cpp: '    dp[1] = nums[1];' },
      { java: '        dp[i] = Math.max(dp[i - 1], dp[i - 1] + nums[i]);', cpp: '        dp[i] = max(dp[i - 1], dp[i - 1] + nums[i]);' },
    ],
    gotchas: {
      python: ['`dp[-1]` means "last element" in Python only.'],
      java: ['There is no negative indexing — `dp[-1]` throws; write `dp[nums.length - 1]`.'],
      cpp: ['`dp[-1]` compiles and is undefined behaviour — use `dp.back()`.'],
    },
  },

  'house-robber-ii': {
    java: `
public int rob(int[] nums) {
    if (nums.length == 1) {                                     @single
        return nums[0];                                         @ret1
    }
    int a = robLine(Arrays.copyOfRange(nums, 0, nums.length - 1));  @skipLast
    int b = robLine(Arrays.copyOfRange(nums, 1, nums.length));  @skipFirst
    return Math.max(a, b);                                      @done
}

private int robLine(int[] h) {
    int[] dp = new int[h.length + 1];                           @init
    dp[1] = h[0];                                               @seed
    for (int i = 2; i <= h.length; i++) {                       @loop
        dp[i] = Math.max(dp[i - 1], dp[i - 2] + h[i - 1]);      @calc
    }
    return dp[h.length];                                        @ret
}
`,
    cpp: `
int rob(vector<int>& nums) {
    if (nums.size() == 1) {                                      @single
        return nums[0];                                          @ret1
    }
    int a = robLine(vector<int>(nums.begin(), nums.end() - 1));  @skipLast
    int b = robLine(vector<int>(nums.begin() + 1, nums.end()));  @skipFirst
    return max(a, b);                                            @done
}

int robLine(const vector<int>& h) {
    vector<int> dp(h.size() + 1, 0);                             @init
    dp[1] = h[0];                                                @seed
    for (int i = 2; i <= (int)h.size(); i++) {                   @loop
        dp[i] = max(dp[i - 1], dp[i - 2] + h[i - 1]);            @calc
    }
    return dp.back();                                            @ret
}
`,
    distractors: [
      { java: '    return robLine(nums);', cpp: '    return robLine(nums);' },
      { java: '    int b = robLine(Arrays.copyOfRange(nums, 1, nums.length - 1));', cpp: '    int b = robLine(vector<int>(nums.begin() + 1, nums.end() - 1));' },
      { java: '    return a + b;', cpp: '    return a + b;' },
    ],
    gotchas: {
      java: ['`Arrays.copyOfRange(nums, from, to)` excludes `to`, just like a Python slice; passing `(lo, hi)` indices to `robLine` instead avoids the O(n) copies.'],
      cpp: ['`robLine` takes `const vector<int>&` so it can bind the temporary `vector<int>(nums.begin() + 1, nums.end())`; a plain `vector<int>&` would not compile.'],
    },
  },

  'longest-palindromic-substring': {
    java: `
public String longestPalindrome(String s) {
    String res = ""; int resLen = 0;        @init
    for (int i = 0; i < s.length(); i++) {  @loop
        for (int k = 0; k <= 1; k++) {      @center
            int l = i, r = i + k;
            while (l >= 0 && r < s.length() && s.charAt(l) == s.charAt(r)) {  @expand
                if (r - l + 1 > resLen) {   @better
                    res = s.substring(l, r + 1); resLen = r - l + 1;  @record
                }
                l--; r++;                   @grow
            }
        }
    }
    return res;                             @done
}
`,
    cpp: `
string longestPalindrome(string s) {
    string res = ""; int resLen = 0;           @init
    for (int i = 0; i < (int)s.size(); i++) {  @loop
        for (int k = 0; k <= 1; k++) {         @center
            int l = i, r = i + k;
            while (l >= 0 && r < (int)s.size() && s[l] == s[r]) {  @expand
                if (r - l + 1 > resLen) {      @better
                    res = s.substr(l, r - l + 1); resLen = r - l + 1;  @record
                }
                l--; r++;                      @grow
            }
        }
    }
    return res;                                @done
}
`,
    distractors: [
      { java: '        for (int k = 0; k < 1; k++) {', cpp: '        for (int k = 0; k < 1; k++) {' },
      { java: '            if (s.charAt(l) == s.charAt(r)) {', cpp: '            if (s[l] == s[r]) {' },
      { java: '                l++; r--;', cpp: '                l++; r--;' },
    ],
    gotchas: {
      java: ['`substring(begin, end)` excludes `end` (like a Python slice) and copies — storing the start index and length and slicing once at the end avoids O(n) work per improvement.'],
      cpp: ['`s.substr(pos, len)` takes a LENGTH, not an end index — `s.substr(l, r - l + 1)`, not `s.substr(l, r + 1)`.'],
    },
  },

  'palindromic-substrings': {
    java: `
public int countSubstrings(String s) {
    int res = 0;                            @init
    for (int i = 0; i < s.length(); i++) {  @loop
        for (int k = 0; k <= 1; k++) {      @center
            int l = i, r = i + k;
            while (l >= 0 && r < s.length() && s.charAt(l) == s.charAt(r)) {  @expand
                res++;                      @count
                l--; r++;                   @grow
            }
        }
    }
    return res;                             @done
}
`,
    cpp: `
int countSubstrings(string s) {
    int res = 0;                               @init
    for (int i = 0; i < (int)s.size(); i++) {  @loop
        for (int k = 0; k <= 1; k++) {         @center
            int l = i, r = i + k;
            while (l >= 0 && r < (int)s.size() && s[l] == s[r]) {  @expand
                res++;                         @count
                l--; r++;                      @grow
            }
        }
    }
    return res;                                @done
}
`,
    distractors: [
      { java: '                res = Math.max(res, r - l + 1);', cpp: '                res = max(res, r - l + 1);' },
      { java: '        for (int k = 0; k < 1; k++) {', cpp: '        for (int k = 0; k < 1; k++) {' },
    ],
    gotchas: {
      python: ['`s[-1]` does not raise — it silently reads the LAST character, so the `l >= 0` bound check is what stops the expansion.'],
      java: ['Check bounds before `charAt`: `&&` short-circuits left to right, so `l >= 0 && r < s.length()` must come first.'],
      cpp: ['Compare against `(int)s.size()` — `r < s.size()` mixes signed and unsigned, and `s[-1]` is undefined behaviour rather than an error.'],
    },
  },

  'decode-ways': {
    java: `
public int numDecodings(String s) {
    int[] dp = new int[s.length() + 1];          @init
    dp[s.length()] = 1;                          @seed
    for (int i = s.length() - 1; i >= 0; i--) {  @loop
        if (s.charAt(i) == '0') {                @zero
            dp[i] = 0;                           @dead
            continue;
        }
        dp[i] = dp[i + 1];                       @one
        if (i + 1 < s.length() && (s.charAt(i) == '1' || (s.charAt(i) == '2' && s.charAt(i + 1) <= '6'))) {  @twoCheck
            dp[i] += dp[i + 2];                  @two
        }
    }
    return dp[0];                                @done
}
`,
    cpp: `
int numDecodings(string s) {
    vector<int> dp(s.size() + 1, 0);                @init
    dp[s.size()] = 1;                               @seed
    for (int i = (int)s.size() - 1; i >= 0; i--) {  @loop
        if (s[i] == '0') {                          @zero
            dp[i] = 0;                              @dead
            continue;
        }
        dp[i] = dp[i + 1];                          @one
        if (i + 1 < (int)s.size() && (s[i] == '1' || (s[i] == '2' && s[i + 1] <= '6'))) {  @twoCheck
            dp[i] += dp[i + 2];                     @two
        }
    }
    return dp[0];                                   @done
}
`,
    distractors: [
      {
        java: "        if (i + 1 < s.length() && (s.charAt(i) <= '1' || (s.charAt(i) == '2' && s.charAt(i + 1) <= '6'))) {",
        cpp: "        if (i + 1 < (int)s.size() && (s[i] <= '1' || (s[i] == '2' && s[i + 1] <= '6'))) {",
      },
      { java: '    for (int i = 0; i < s.length(); i++) {', cpp: '    for (int i = 0; i < (int)s.size(); i++) {' },
      { java: '            dp[i] = dp[i + 1];', cpp: '            dp[i] = dp[i + 1];' },
    ],
    gotchas: {
      python: ['`int("06")` is 6 — the leading zero is silently accepted, which is why the two-digit check needs the lower bound 10.'],
      java: ['Compare chars, not parsed substrings: `s.charAt(i) == \'1\'` avoids allocating with `Integer.parseInt(s.substring(i, i + 2))`; `\'0\'` (char) is not `0` (int).'],
      cpp: ['`s[i] - \'0\'` turns a digit char into its value; `stoi(s.substr(i, 2))` works but allocates a string every iteration.'],
    },
  },

  'coin-change': {
    java: `
public int coinChange(int[] coins, int amount) {
    int[] dp = new int[amount + 1];
    Arrays.fill(dp, amount + 1);                         @init
    dp[0] = 0;                                           @seed
    for (int a = 1; a <= amount; a++) {                  @loop
        for (int c : coins) {                            @coin
            if (a - c >= 0) {                            @fits
                dp[a] = Math.min(dp[a], 1 + dp[a - c]);  @relax
            }
        }
    }
    return dp[amount] != amount + 1 ? dp[amount] : -1;   @done
}
`,
    cpp: `
int coinChange(vector<int>& coins, int amount) {
    vector<int> dp(amount + 1, amount + 1);             @init
    dp[0] = 0;                                          @seed
    for (int a = 1; a <= amount; a++) {                 @loop
        for (int c : coins) {                           @coin
            if (a - c >= 0) {                           @fits
                dp[a] = min(dp[a], 1 + dp[a - c]);      @relax
            }
        }
    }
    return dp[amount] != amount + 1 ? dp[amount] : -1;  @done
}
`,
    distractors: [
      { java: '    int[] dp = new int[amount + 1];', cpp: '    vector<int> dp(amount + 1, 0);' },
      { java: '                dp[a] = Math.min(dp[a], dp[a - c]);', cpp: '                dp[a] = min(dp[a], dp[a - c]);' },
      {
        java: '    coins = Arrays.stream(coins).boxed().sorted(Collections.reverseOrder()).mapToInt(Integer::intValue).toArray();',
        cpp: '    sort(coins.rbegin(), coins.rend());',
      },
    ],
    gotchas: {
      python: ['`float("inf")` is a safe ∞ in Python; the `amount + 1` sentinel ports directly to typed languages.'],
      java: ['Using `Integer.MAX_VALUE` as ∞ makes `1 + dp[a - c]` overflow to a negative number — the `amount + 1` sentinel avoids it; `Arrays.fill` only fills a 1-D array.'],
      cpp: ['`vector<int> dp(amount + 1, amount + 1)` sizes and fills in one go; `INT_MAX` as ∞ would make `1 + dp[a - c]` signed-overflow (UB).'],
    },
  },

  'maximum-product-subarray': {
    java: `
public int maxProduct(int[] nums) {
    int res = nums[0];                                           @init
    int curMin = 1, curMax = 1;                                  @seed
    for (int n : nums) {                                         @loop
        int[] cand = { n, n * curMax, n * curMin };              @cand
        curMax = Math.max(cand[0], Math.max(cand[1], cand[2]));  @update
        curMin = Math.min(cand[0], Math.min(cand[1], cand[2]));
        res = Math.max(res, curMax);                             @best
    }
    return res;                                                  @done
}
`,
    cpp: `
int maxProduct(vector<int>& nums) {
    int res = nums[0];                           @init
    int curMin = 1, curMax = 1;                  @seed
    for (int n : nums) {                         @loop
        initializer_list<int> cand = { n, n * curMax, n * curMin };  @cand
        curMax = max(cand); curMin = min(cand);  @update
        res = max(res, curMax);                  @best
    }
    return res;                                  @done
}
`,
    distractors: [
      { java: '        curMax = Math.max(n, n * curMax);', cpp: '        curMax = max(n, n * curMax);' },
      { java: '    int res = 0;', cpp: '    int res = 0;' },
      { java: '        curMin = Math.min(n, Math.min(n * curMax, n * curMin));', cpp: '        curMin = min({ n, n * curMax, n * curMin });' },
    ],
    gotchas: {
      python: ['`curMax, curMin = max(cand), min(cand)` evaluates the right side before assigning — Java and C++ have no tuple assignment, so snapshot the candidates first.'],
      java: ['`Math.max` takes exactly two arguments — nest the calls for three candidates.'],
      cpp: ['`max({a, b, c})` / `min(list)` use the `initializer_list` overloads; plain `max(a, b, c)` treats `c` as a comparator and fails to compile.'],
    },
  },

  'word-break': {
    java: `
public boolean wordBreak(String s, List<String> wordDict) {
    boolean[] dp = new boolean[s.length() + 1];  @init
    dp[s.length()] = true;                       @seed
    for (int i = s.length() - 1; i >= 0; i--) {  @loop
        for (String w : wordDict) {              @word
            if (s.startsWith(w, i)) {            @match
                dp[i] = dp[i + w.length()];      @take
            }
            if (dp[i]) {                         @check
                break;                           @stop
            }
        }
    }
    return dp[0];                                @done
}
`,
    cpp: `
bool wordBreak(string s, vector<string>& wordDict) {
    vector<bool> dp(s.size() + 1, false);           @init
    dp[s.size()] = true;                            @seed
    for (int i = (int)s.size() - 1; i >= 0; i--) {  @loop
        for (auto& w : wordDict) {                  @word
            if (s.compare(i, w.size(), w) == 0) {   @match
                dp[i] = dp[i + w.size()];           @take
            }
            if (dp[i]) {                            @check
                break;                              @stop
            }
        }
    }
    return dp[0];                                   @done
}
`,
    distractors: [
      { java: '                dp[i] = true;', cpp: '                dp[i] = true;' },
      { java: '    for (int i = 0; i < s.length(); i++) {', cpp: '    for (int i = 0; i < (int)s.size(); i++) {' },
      { java: '                break;', cpp: '                break;' },
    ],
    gotchas: {
      python: ['Slices clamp: `s[i:i + len(w)]` near the end is just shorter, so the comparison is safely False.'],
      java: ['`s.startsWith(w, i)` compares in place — `s.substring(i, i + w.length())` would throw when the word runs past the end.'],
      cpp: ['`s.compare(i, w.size(), w) == 0` checks the match without allocating a substring; `vector<bool>` is bit-packed, so `auto& x = dp[i]` does not compile.'],
    },
  },

  'longest-increasing-subsequence': {
    java: `
public int lengthOfLIS(int[] nums) {
    int[] dp = new int[nums.length];
    Arrays.fill(dp, 1);                              @init
    for (int i = 0; i < nums.length; i++) {          @loop
        for (int j = 0; j < i; j++) {                @inner
            if (nums[j] < nums[i]) {                 @less
                dp[i] = Math.max(dp[i], dp[j] + 1);  @extend
            }
        }
    }
    return Arrays.stream(dp).max().getAsInt();       @done
}
`,
    cpp: `
int lengthOfLIS(vector<int>& nums) {
    vector<int> dp(nums.size(), 1);               @init
    for (int i = 0; i < (int)nums.size(); i++) {  @loop
        for (int j = 0; j < i; j++) {             @inner
            if (nums[j] < nums[i]) {              @less
                dp[i] = max(dp[i], dp[j] + 1);    @extend
            }
        }
    }
    return *max_element(dp.begin(), dp.end());    @done
}
`,
    distractors: [
      { java: '    return dp[nums.length - 1];', cpp: '    return dp.back();' },
      { java: '            if (nums[j] <= nums[i]) {', cpp: '            if (nums[j] <= nums[i]) {' },
      { java: '                dp[i] = dp[j] + 1;', cpp: '                dp[i] = dp[j] + 1;' },
    ],
    gotchas: {
      python: ['The O(n log n) variant keeps a `tails` list and uses `bisect_left(tails, x)`.'],
      java: ['`new int[n]` starts at 0, so fill with 1 first; `Arrays.stream(dp).max()` returns an `OptionalInt` — unwrap with `getAsInt()`. For the O(n log n) variant, `Arrays.binarySearch` returns `-(insertionPoint) - 1` when the key is missing.'],
      cpp: ['`max_element` returns an iterator — dereference it with `*`; the O(n log n) variant uses `lower_bound(tails.begin(), tails.end(), x)`.'],
    },
  },

  'partition-equal-subset-sum': {
    java: `
public boolean canPartition(int[] nums) {
    int total = Arrays.stream(nums).sum();   @total
    if (total % 2 != 0) {                    @odd
        return false;                        @oddRet
    }
    int target = total / 2;                  @target
    boolean[] dp = new boolean[target + 1];  @init
    dp[0] = true;                            @seed
    for (int n : nums) {                     @loop
        for (int s = target; s >= n; s--) {  @sum
            dp[s] = dp[s] || dp[s - n];      @update
        }
    }
    return dp[target];                       @done
}
`,
    cpp: `
bool canPartition(vector<int>& nums) {
    int total = accumulate(nums.begin(), nums.end(), 0);  @total
    if (total % 2) {                                      @odd
        return false;                                     @oddRet
    }
    int target = total / 2;                               @target
    vector<bool> dp(target + 1, false);                   @init
    dp[0] = true;                                         @seed
    for (int n : nums) {                                  @loop
        for (int s = target; s >= n; s--) {               @sum
            dp[s] = dp[s] || dp[s - n];                   @update
        }
    }
    return dp[target];                                    @done
}
`,
    distractors: [
      { java: '        for (int s = n; s <= target; s++) {', cpp: '        for (int s = n; s <= target; s++) {' },
      { java: '            dp[s] = dp[s - n];', cpp: '            dp[s] = dp[s - n];' },
      { java: '    double target = total / 2.0;', cpp: '    double target = total / 2.0;' },
    ],
    gotchas: {
      python: ['`/` always returns a float in Python 3 — use `//` for the table size.'],
      java: ['`total / 2` is already integer division (it truncates), so the odd check must come first; `if (total % 2)` does not compile — Java needs `!= 0`.'],
      cpp: ['The initial value fixes the sum type: `accumulate(..., 0)` sums in `int`, use `0LL` for large inputs; `bitset<10001>` with `bits |= bits << n` is a fast alternative.'],
    },
  },
};
