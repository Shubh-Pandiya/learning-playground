import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the 2-D dynamic programming problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'unique-paths': {
    java: `
public int uniquePaths(int m, int n) {
    int[][] dp = new int[m][n];
    for (int[] row : dp) Arrays.fill(row, 1);        @init
    for (int r = 1; r < m; r++) {                    @row
        for (int c = 1; c < n; c++) {                @col
            dp[r][c] = dp[r - 1][c] + dp[r][c - 1];  @calc
        }
    }
    return dp[m - 1][n - 1];                         @done
}
`,
    cpp: `
int uniquePaths(int m, int n) {
    vector<vector<int>> dp(m, vector<int>(n, 1));    @init
    for (int r = 1; r < m; r++) {                    @row
        for (int c = 1; c < n; c++) {                @col
            dp[r][c] = dp[r - 1][c] + dp[r][c - 1];  @calc
        }
    }
    return dp[m - 1][n - 1];                         @done
}
`,
    distractors: [
      { java: '    for (int[] row : dp) Arrays.fill(row, 0);', cpp: '    vector<vector<int>> dp(m, vector<int>(n, 0));' },
      { java: '            dp[r][c] = Math.max(dp[r - 1][c], dp[r][c - 1]);', cpp: '            dp[r][c] = max(dp[r - 1][c], dp[r][c - 1]);' },
      { java: '            dp[r][c] = dp[r - 1][c - 1] + 1;', cpp: '            dp[r][c] = dp[r - 1][c - 1] + 1;' },
    ],
    gotchas: {
      python: ['`[[1] * n] * m` repeats the SAME row object m times — writing `dp[1][2]` changes every row; build rows with a comprehension.'],
      java: ['`new int[m][n]` is all 0s — the 1s must be filled in explicitly (`Arrays.fill` works on one row at a time).'],
      cpp: ['Route counts grow like C(m+n−2, m−1); `int` is enough for LeetCode’s limits, but a bigger grid needs `long long` (signed overflow is undefined behaviour).'],
    },
  },

  'longest-common-subsequence': {
    java: `
public int longestCommonSubsequence(String text1, String text2) {
    int[][] dp = new int[text1.length() + 1][text2.length() + 1];   @init
    for (int i = 1; i <= text1.length(); i++) {                    @row
        for (int j = 1; j <= text2.length(); j++) {                @col
            if (text1.charAt(i - 1) == text2.charAt(j - 1)) {      @match
                dp[i][j] = 1 + dp[i - 1][j - 1];                   @diag
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);   @skip
            }
        }
    }
    return dp[text1.length()][text2.length()];                     @done
}
`,
    cpp: `
int longestCommonSubsequence(string text1, string text2) {
    vector<vector<int>> dp(text1.size() + 1, vector<int>(text2.size() + 1));   @init
    for (int i = 1; i <= (int)text1.size(); i++) {                 @row
        for (int j = 1; j <= (int)text2.size(); j++) {             @col
            if (text1[i - 1] == text2[j - 1]) {                    @match
                dp[i][j] = 1 + dp[i - 1][j - 1];                   @diag
            } else {
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1]);        @skip
            }
        }
    }
    return dp.back().back();                                       @done
}
`,
    distractors: [
      { java: '                dp[i][j] = 1 + Math.max(dp[i - 1][j], dp[i][j - 1]);', cpp: '                dp[i][j] = 1 + max(dp[i - 1][j], dp[i][j - 1]);' },
      { java: '            if (text1.charAt(i) == text2.charAt(j)) {', cpp: '            if (text1[i] == text2[j]) {' },
      { java: '                dp[i][j] = dp[i - 1][j - 1];', cpp: '                dp[i][j] = dp[i - 1][j - 1];' },
    ],
    gotchas: {
      python: ['`dp[-1][-1]` is the bottom-right cell; Java has no negative indexing (use `dp[m][n]`) and C++ has `dp.back().back()`.'],
      java: ['Strings are not arrays in Java: use `text1.charAt(i - 1)`, not `text1[i - 1]`; `charAt(text1.length())` throws `StringIndexOutOfBoundsException`.'],
      cpp: ['`text1[text1.size()]` does NOT throw — it returns `\'\\0\'`, so an off-by-one index silently compares a null char instead of crashing.'],
    },
  },

  'best-time-to-buy-and-sell-stock-with-cooldown': {
    java: `
public int maxProfit(int[] prices) {
    int hold = -prices[0], sold = 0, rest = 0;       @init
    for (int i = 1; i < prices.length; i++) {        @loop
        int p = prices[i];
        int prevHold = hold;
        hold = Math.max(hold, rest - p);             @hold
        rest = Math.max(rest, sold);                 @rest
        sold = prevHold + p;                         @sold
    }
    return Math.max(sold, rest);                     @done
}
`,
    cpp: `
int maxProfit(vector<int>& prices) {
    int hold = -prices[0], sold = 0, rest = 0;       @init
    for (int i = 1; i < (int)prices.size(); i++) {   @loop
        int p = prices[i];
        int prevHold = hold;
        hold = max(hold, rest - p);                  @hold
        rest = max(rest, sold);                      @rest
        sold = prevHold + p;                         @sold
    }
    return max(sold, rest);                          @done
}
`,
    distractors: [
      { java: '        hold = Math.max(hold, sold - p);', cpp: '        hold = max(hold, sold - p);' },
      { java: '        sold = hold + p;', cpp: '        sold = hold + p;' },
      { java: '    return Math.max(hold, Math.max(sold, rest));', cpp: '    return max({hold, sold, rest});' },
    ],
    gotchas: {
      python: ['`prices[1:]` copies the list (O(n) extra memory); `for i in range(1, len(prices))` avoids the copy.'],
      java: ['`Math.max` takes exactly two arguments — three states need `Math.max(a, Math.max(b, c))`.'],
      cpp: ['`max(a, b, c)` treats `c` as a comparator and fails to compile — use the initializer-list form `max({a, b, c})`.'],
    },
  },

  'coin-change-ii': {
    java: `
public int change(int amount, int[] coins) {
    int[][] dp = new int[coins.length + 1][amount + 1];   @init
    for (int[] row : dp) row[0] = 1;                       @seed
    for (int i = 1; i <= coins.length; i++) {              @row
        int c = coins[i - 1];
        for (int a = 1; a <= amount; a++) {                @col
            dp[i][a] = dp[i - 1][a];                       @skip
            if (a >= c) {                                  @fits
                dp[i][a] += dp[i][a - c];                  @use
            }
        }
    }
    return dp[coins.length][amount];                       @done
}
`,
    cpp: `
int change(int amount, vector<int>& coins) {
    vector<vector<unsigned long long>> dp(coins.size() + 1, vector<unsigned long long>(amount + 1));   @init
    for (auto& row : dp) row[0] = 1;                       @seed
    for (int i = 1; i <= (int)coins.size(); i++) {         @row
        int c = coins[i - 1];
        for (int a = 1; a <= amount; a++) {                @col
            dp[i][a] = dp[i - 1][a];                       @skip
            if (a >= c) {                                  @fits
                dp[i][a] += dp[i][a - c];                  @use
            }
        }
    }
    return (int)dp[coins.size()][amount];                  @done
}
`,
    distractors: [
      { java: '                dp[i][a] += dp[i - 1][a - c];', cpp: '                dp[i][a] += dp[i - 1][a - c];' },
      { java: '            dp[i][a] = dp[i][a - c];', cpp: '            dp[i][a] = dp[i][a - c];' },
      { java: '    for (int[] row : dp) row[0] = 0;', cpp: '    for (auto& row : dp) row[0] = 0;' },
    ],
    gotchas: {
      java: ['Intermediate cells can exceed `int` even though the final answer fits; Java `int` arithmetic wraps (no exception), so the last cell still comes out right.'],
      cpp: [
        'Some intermediate cells overflow 32 bits; signed overflow is undefined behaviour (LeetCode’s sanitizer aborts), so count in an unsigned type, which wraps safely.',
        '`for (auto row : dp)` copies each row — the seed needs `auto&` to write into the table.',
      ],
    },
  },

  'target-sum': {
    java: `
public int findTargetSumWays(int[] nums, int target) {
    List<Map<Integer, Integer>> dp = new ArrayList<>();               @init
    for (int i = 0; i <= nums.length; i++) dp.add(new HashMap<>());
    dp.get(0).put(0, 1);                                              @seed
    for (int i = 0; i < nums.length; i++) {                           @row
        int n = nums[i];
        for (Map.Entry<Integer, Integer> e : dp.get(i).entrySet()) {  @cell
            int s = e.getKey(), ways = e.getValue();
            dp.get(i + 1).merge(s + n, ways, Integer::sum);           @plus
            dp.get(i + 1).merge(s - n, ways, Integer::sum);           @minus
        }
    }
    return dp.get(nums.length).getOrDefault(target, 0);               @done
}
`,
    cpp: `
int findTargetSumWays(vector<int>& nums, int target) {
    vector<unordered_map<int, int>> dp(nums.size() + 1);              @init
    dp[0][0] = 1;                                                     @seed
    for (int i = 0; i < (int)nums.size(); i++) {                      @row
        int n = nums[i];
        for (auto& [s, ways] : dp[i]) {                               @cell
            dp[i + 1][s + n] += ways;                                 @plus
            dp[i + 1][s - n] += ways;                                 @minus
        }
    }
    return dp[nums.size()].count(target) ? dp[nums.size()][target] : 0;   @done
}
`,
    distractors: [
      { java: '            dp.get(i + 1).put(s + n, ways);', cpp: '            dp[i + 1][s + n] = ways;' },
      { java: '        for (Map.Entry<Integer, Integer> e : dp.get(i + 1).entrySet()) {', cpp: '        for (auto& [s, ways] : dp[i + 1]) {' },
      { java: '    return dp.get(nums.length - 1).getOrDefault(target, 0);', cpp: '    return dp[nums.size() - 1].count(target) ? dp[nums.size() - 1][target] : 0;' },
    ],
    gotchas: {
      java: ['`map.merge(key, ways, Integer::sum)` is get-or-0-then-add in one call; adding to the map you are iterating throws `ConcurrentModificationException`.'],
      cpp: ['`dp[i + 1][s + n] += ways` value-initialises a missing key to 0; inserting into the `unordered_map` you are iterating may rehash and invalidate the loop.'],
    },
  },

  'interleaving-string': {
    java: `
public boolean isInterleave(String s1, String s2, String s3) {
    if (s1.length() + s2.length() != s3.length()) {                  @len
        return false;                                                 @lenFail
    }
    boolean[][] dp = new boolean[s1.length() + 1][s2.length() + 1];   @init
    dp[0][0] = true;                                                  @seed
    for (int i = 0; i <= s1.length(); i++) {                          @row
        for (int j = 0; j <= s2.length(); j++) {                      @col
            if (i > 0 && s1.charAt(i - 1) == s3.charAt(i + j - 1) && dp[i - 1][j]) {   @fromS1
                dp[i][j] = true;                                      @setS1
            }
            if (j > 0 && s2.charAt(j - 1) == s3.charAt(i + j - 1) && dp[i][j - 1]) {   @fromS2
                dp[i][j] = true;                                      @setS2
            }
        }
    }
    return dp[s1.length()][s2.length()];                              @done
}
`,
    cpp: `
bool isInterleave(string s1, string s2, string s3) {
    if (s1.size() + s2.size() != s3.size()) {                         @len
        return false;                                                 @lenFail
    }
    vector<vector<bool>> dp(s1.size() + 1, vector<bool>(s2.size() + 1, false));   @init
    dp[0][0] = true;                                                  @seed
    for (int i = 0; i <= (int)s1.size(); i++) {                       @row
        for (int j = 0; j <= (int)s2.size(); j++) {                   @col
            if (i > 0 && s1[i - 1] == s3[i + j - 1] && dp[i - 1][j]) {   @fromS1
                dp[i][j] = true;                                      @setS1
            }
            if (j > 0 && s2[j - 1] == s3[i + j - 1] && dp[i][j - 1]) {   @fromS2
                dp[i][j] = true;                                      @setS2
            }
        }
    }
    return dp[s1.size()][s2.size()];                                  @done
}
`,
    distractors: [
      { java: '            if (i > 0 && s1.charAt(i - 1) == s3.charAt(i + j - 1)) {', cpp: '            if (i > 0 && s1[i - 1] == s3[i + j - 1]) {' },
      {
        java: '            } else if (j > 0 && s2.charAt(j - 1) == s3.charAt(i + j - 1) && dp[i][j - 1]) {',
        cpp: '            } else if (j > 0 && s2[j - 1] == s3[i + j - 1] && dp[i][j - 1]) {',
      },
      { java: '            if (i > 0 && s1.charAt(i - 1) == s3.charAt(i + j) && dp[i - 1][j]) {', cpp: '            if (i > 0 && s1[i - 1] == s3[i + j] && dp[i - 1][j]) {' },
    ],
    gotchas: {
      java: ['`i > 0 &&` must come first: `&&` short-circuits, so `charAt(i - 1)` is never evaluated with `i == 0` (which would throw).'],
      cpp: ['`vector<bool>` is a packed bit-set specialisation — `auto& x = dp[i][j]` does not compile; it is fine for plain reads and writes like here.'],
    },
  },

  'longest-increasing-path-in-a-matrix': {
    java: `
private int ROWS, COLS;
private int[][] matrix, dp;
private final int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
public int longestIncreasingPath(int[][] matrix) {
    this.matrix = matrix;
    ROWS = matrix.length; COLS = matrix[0].length;
    dp = new int[ROWS][COLS];                                       @init
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {                            @outer
            dfs(r, c, -1);                                          @call
        }
    }
    return Arrays.stream(dp).flatMapToInt(Arrays::stream).max().getAsInt();   @done
}
private int dfs(int r, int c, int prev) {
    if (r < 0 || r == ROWS || c < 0 || c == COLS || matrix[r][c] <= prev) {   @guard
        return 0;
    }
    if (dp[r][c] != 0) {                                            @memo
        return dp[r][c];                                            @hit
    }
    int res = 1;                                                    @start
    for (int[] d : dirs) {                                          @dir
        int dr = d[0], dc = d[1];
        res = Math.max(res, 1 + dfs(r + dr, c + dc, matrix[r][c])); @recur
    }
    dp[r][c] = res;                                                 @store
    return res;
}
`,
    cpp: `
int ROWS, COLS;
vector<vector<int>> dp;
vector<pair<int, int>> dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
int longestIncreasingPath(vector<vector<int>>& matrix) {
    ROWS = matrix.size(), COLS = matrix[0].size();
    dp.assign(ROWS, vector<int>(COLS, 0));                          @init
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {                            @outer
            dfs(matrix, r, c, -1);                                  @call
        }
    }
    int best = 0;
    for (auto& row : dp) best = max(best, *max_element(row.begin(), row.end()));
    return best;                                                    @done
}
int dfs(vector<vector<int>>& matrix, int r, int c, int prev) {
    if (r < 0 || r == ROWS || c < 0 || c == COLS || matrix[r][c] <= prev) {   @guard
        return 0;
    }
    if (dp[r][c] != 0) {                                            @memo
        return dp[r][c];                                            @hit
    }
    int res = 1;                                                    @start
    for (auto [dr, dc] : dirs) {                                    @dir
        res = max(res, 1 + dfs(matrix, r + dr, c + dc, matrix[r][c]));   @recur
    }
    dp[r][c] = res;                                                 @store
    return res;
}
`,
    distractors: [
      { java: '        if (matrix[r][c] < prev) {', cpp: '        if (matrix[r][c] < prev) {' },
      { java: '        visited.add(r * COLS + c);', cpp: '        visited.insert({r, c});' },
      { java: '    return dfs(0, 0, -1);', cpp: '    return dfs(matrix, 0, 0, -1);' },
    ],
    gotchas: {
      python: ['Deep DFS on a large grid can hit the default recursion limit (1000) — `sys.setrecursionlimit` or an iterative topological order avoids it.'],
      java: ['An `int[][]` memo starts at 0, which safely means "not computed" here because every path has length ≥ 1; an `Integer[][]` memo would start at `null` instead.'],
      cpp: ['The Python dict keyed by `(r, c)` becomes a grid — `unordered_map<pair<int, int>, int>` does not compile without a custom hash.'],
    },
  },

  'distinct-subsequences': {
    java: `
public int numDistinct(String s, String t) {
    int[][] dp = new int[s.length() + 1][t.length() + 1];   @init
    for (int i = 0; i <= s.length(); i++) dp[i][0] = 1;     @seed
    for (int i = 1; i <= s.length(); i++) {                 @row
        for (int j = 1; j <= t.length(); j++) {             @col
            dp[i][j] = dp[i - 1][j];                        @skip
            if (s.charAt(i - 1) == t.charAt(j - 1)) {       @match
                dp[i][j] += dp[i - 1][j - 1];               @use
            }
        }
    }
    return dp[s.length()][t.length()];                      @done
}
`,
    cpp: `
int numDistinct(string s, string t) {
    vector<vector<unsigned long long>> dp(s.size() + 1, vector<unsigned long long>(t.size() + 1));   @init
    for (int i = 0; i <= (int)s.size(); i++) dp[i][0] = 1;  @seed
    for (int i = 1; i <= (int)s.size(); i++) {              @row
        for (int j = 1; j <= (int)t.size(); j++) {          @col
            dp[i][j] = dp[i - 1][j];                        @skip
            if (s[i - 1] == t[j - 1]) {                     @match
                dp[i][j] += dp[i - 1][j - 1];               @use
            }
        }
    }
    return (int)dp[s.size()][t.size()];                     @done
}
`,
    distractors: [
      { java: '                dp[i][j] = dp[i - 1][j - 1];', cpp: '                dp[i][j] = dp[i - 1][j - 1];' },
      { java: '    for (int j = 0; j <= t.length(); j++) dp[0][j] = 1;', cpp: '    for (int j = 0; j <= (int)t.size(); j++) dp[0][j] = 1;' },
      { java: '                dp[i][j] += dp[i][j - 1];', cpp: '                dp[i][j] += dp[i][j - 1];' },
    ],
    gotchas: {
      java: ['Cells for short prefixes of `t` can exceed `int` even when the final answer fits; Java `int` arithmetic wraps, so the final cell is still correct.'],
      cpp: ['Intermediate cells can overflow on LeetCode’s tests even though the answer fits in `int`; signed overflow is undefined behaviour, so count in an unsigned type (wraps safely) and cast the answer.'],
    },
  },

  'edit-distance': {
    java: `
public int minDistance(String word1, String word2) {
    int[][] dp = new int[word1.length() + 1][word2.length() + 1];   @init
    for (int i = 0; i <= word1.length(); i++) dp[i][0] = i;         @seedCol
    for (int j = 0; j <= word2.length(); j++) dp[0][j] = j;         @seedRow
    for (int i = 1; i <= word1.length(); i++) {                     @row
        for (int j = 1; j <= word2.length(); j++) {                 @col
            if (word1.charAt(i - 1) == word2.charAt(j - 1)) {       @match
                dp[i][j] = dp[i - 1][j - 1];                        @same
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], Math.min(dp[i][j - 1], dp[i - 1][j - 1]));   @edit
            }
        }
    }
    return dp[word1.length()][word2.length()];                      @done
}
`,
    cpp: `
int minDistance(string word1, string word2) {
    vector<vector<int>> dp(word1.size() + 1, vector<int>(word2.size() + 1));   @init
    for (int i = 0; i <= (int)word1.size(); i++) dp[i][0] = i;      @seedCol
    for (int j = 0; j <= (int)word2.size(); j++) dp[0][j] = j;      @seedRow
    for (int i = 1; i <= (int)word1.size(); i++) {                  @row
        for (int j = 1; j <= (int)word2.size(); j++) {              @col
            if (word1[i - 1] == word2[j - 1]) {                     @match
                dp[i][j] = dp[i - 1][j - 1];                        @same
            } else {
                dp[i][j] = 1 + min({dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]});   @edit
            }
        }
    }
    return dp.back().back();                                        @done
}
`,
    distractors: [
      { java: '                dp[i][j] = 1 + dp[i - 1][j - 1];', cpp: '                dp[i][j] = 1 + dp[i - 1][j - 1];' },
      {
        java: '                dp[i][j] = Math.min(dp[i - 1][j], Math.min(dp[i][j - 1], dp[i - 1][j - 1]));',
        cpp: '                dp[i][j] = min({dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]});',
      },
      { java: '    for (int i = 0; i <= word1.length(); i++) dp[i][0] = 0;', cpp: '    for (int i = 0; i <= (int)word1.size(); i++) dp[i][0] = 0;' },
    ],
    gotchas: {
      java: ['`Math.min` takes two arguments — the three edits need a nested `Math.min(a, Math.min(b, c))`.'],
      cpp: ['Use `min({a, b, c})` (initializer list) for three values; `min(a, b, c)` treats `c` as a comparator.'],
    },
  },

  'burst-balloons': {
    java: `
public int maxCoins(int[] nums) {
    int[] padded = new int[nums.length + 2];
    padded[0] = padded[nums.length + 1] = 1;
    System.arraycopy(nums, 0, padded, 1, nums.length);
    nums = padded;                                              @pad
    int n = nums.length;
    int[][] dp = new int[n][n];                                 @init
    for (int length = 1; length < n - 1; length++) {            @len
        for (int l = 1; l < n - length; l++) {                  @left
            int r = l + length - 1;
            for (int i = l; i <= r; i++) {                      @last
                int coins = nums[l - 1] * nums[i] * nums[r + 1] + dp[l][i - 1] + dp[i + 1][r];   @coins
                dp[l][r] = Math.max(dp[l][r], coins);           @best
            }
        }
    }
    return dp[1][n - 2];                                        @done
}
`,
    cpp: `
int maxCoins(vector<int>& nums) {
    nums.insert(nums.begin(), 1);
    nums.push_back(1);                                          @pad
    int n = nums.size();
    vector<vector<int>> dp(n, vector<int>(n));                  @init
    for (int length = 1; length < n - 1; length++) {            @len
        for (int l = 1; l < n - length; l++) {                  @left
            int r = l + length - 1;
            for (int i = l; i <= r; i++) {                      @last
                int coins = nums[l - 1] * nums[i] * nums[r + 1] + dp[l][i - 1] + dp[i + 1][r];   @coins
                dp[l][r] = max(dp[l][r], coins);                @best
            }
        }
    }
    return dp[1][n - 2];                                        @done
}
`,
    distractors: [
      {
        java: '                int coins = nums[i - 1] * nums[i] * nums[i + 1] + dp[l][i - 1] + dp[i + 1][r];',
        cpp: '                int coins = nums[i - 1] * nums[i] * nums[i + 1] + dp[l][i - 1] + dp[i + 1][r];',
      },
      { java: '    for (int l = 1; l < n - 1; l++) {', cpp: '    for (int l = 1; l < n - 1; l++) {' },
      { java: '                dp[l][r] = coins;', cpp: '                dp[l][r] = coins;' },
    ],
    gotchas: {
      python: ['`nums = [1] + nums + [1]` builds a NEW list; the caller’s list is untouched.'],
      java: ['Arrays have a fixed length — padding means allocating `nums.length + 2` and copying with `System.arraycopy`.'],
      cpp: ['`nums.insert(nums.begin(), 1)` shifts every element (O(n)) and mutates the caller’s vector through the reference — copy first if the input must stay intact.'],
    },
  },

  'regular-expression-matching': {
    java: `
public boolean isMatch(String s, String p) {
    boolean[][] dp = new boolean[s.length() + 1][p.length() + 1];   @init
    dp[s.length()][p.length()] = true;                              @seed
    for (int i = s.length(); i >= 0; i--) {                         @row
        for (int j = p.length() - 1; j >= 0; j--) {                 @col
            boolean first = i < s.length() && (p.charAt(j) == s.charAt(i) || p.charAt(j) == '.');   @first
            if (j + 1 < p.length() && p.charAt(j + 1) == '*') {     @star
                dp[i][j] = dp[i][j + 2] || (first && dp[i + 1][j]); @starCalc
            } else {
                dp[i][j] = first && dp[i + 1][j + 1];               @plain
            }
        }
    }
    return dp[0][0];                                                @done
}
`,
    cpp: `
bool isMatch(string s, string p) {
    vector<vector<bool>> dp(s.size() + 1, vector<bool>(p.size() + 1, false));   @init
    dp[s.size()][p.size()] = true;                                  @seed
    for (int i = s.size(); i >= 0; i--) {                           @row
        for (int j = (int)p.size() - 1; j >= 0; j--) {              @col
            bool first = i < (int)s.size() && (p[j] == s[i] || p[j] == '.');   @first
            if (j + 1 < (int)p.size() && p[j + 1] == '*') {         @star
                dp[i][j] = dp[i][j + 2] || (first && dp[i + 1][j]); @starCalc
            } else {
                dp[i][j] = first && dp[i + 1][j + 1];               @plain
            }
        }
    }
    return dp[0][0];                                                @done
}
`,
    distractors: [
      { java: '                dp[i][j] = first && dp[i + 1][j + 2];', cpp: '                dp[i][j] = first && dp[i + 1][j + 2];' },
      { java: '                dp[i][j] = dp[i][j + 2];', cpp: '                dp[i][j] = dp[i][j + 2];' },
      { java: "            boolean first = p.charAt(j) == s.charAt(i) || p.charAt(j) == '.';", cpp: "            bool first = p[j] == s[i] || p[j] == '.';" },
    ],
    gotchas: {
      python: ['`p[j] in (s[i], ".")` is a tuple membership test; Java/C++ spell it out as two `==` comparisons joined by `||`.'],
      java: ['Compare characters with `\'.\'` (char literal); `p.charAt(j) == "."` does not compile — `"."` is a `String`.'],
      cpp: [
        '`s[s.size()]` returns `\'\\0\'` instead of throwing, so forgetting `i < s.size()` silently lets `.` match a phantom character.',
        '`p.size() - 1` is unsigned and wraps to a huge number for an empty pattern — cast to `int` before subtracting.',
      ],
    },
  },
};
