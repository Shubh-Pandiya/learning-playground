import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the backtracking problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  subsets: {
    java: `
private List<List<Integer>> res;
private List<Integer> subset;
public List<List<Integer>> subsets(int[] nums) {
    res = new ArrayList<>(); subset = new ArrayList<>();     @init
    dfs(nums, 0);                                            @call
    return res;                                              @done
}
private void dfs(int[] nums, int i) {
    if (i >= nums.length) {                                  @base
        res.add(new ArrayList<>(subset));                    @record
        return;
    }
    subset.add(nums[i]);                                     @choose
    dfs(nums, i + 1);                                        @include
    subset.remove(subset.size() - 1);                        @unchoose
    dfs(nums, i + 1);                                        @exclude
}
`,
    cpp: `
vector<vector<int>> res;
vector<int> subset;
vector<vector<int>> subsets(vector<int>& nums) {
    res.clear(); subset.clear();                             @init
    dfs(nums, 0);                                            @call
    return res;                                              @done
}
void dfs(vector<int>& nums, int i) {
    if (i >= (int)nums.size()) {                             @base
        res.push_back(subset);                               @record
        return;
    }
    subset.push_back(nums[i]);                               @choose
    dfs(nums, i + 1);                                        @include
    subset.pop_back();                                       @unchoose
    dfs(nums, i + 1);                                        @exclude
}
`,
    distractors: [
      { java: '        res.add(subset);', cpp: '        res.push_back(move(subset));' },
      { java: '    dfs(nums, i);', cpp: '    dfs(nums, i);' },
      {
        java: '    for (int j = i; j < nums.length; j++) subset.add(nums[j]);',
        cpp: '    for (int j = i; j < (int)nums.size(); j++) subset.push_back(nums[j]);',
      },
    ],
    gotchas: {
      python: ['`res.append(subset)` stores the one shared list — record `subset.copy()` (or `subset[:]`).'],
      java: [
        '`res.add(subset)` adds a REFERENCE to the shared list — record `new ArrayList<>(subset)`.',
        '`subset.remove(subset.size() - 1)` removes by index; `remove(Integer.valueOf(x))` would remove by value.',
      ],
      cpp: ['`res.push_back(subset)` already copies by value; pass `nums` as `vector<int>&` or every call copies the whole array.'],
    },
  },

  'combination-sum': {
    java: `
private List<List<Integer>> res;
private List<Integer> cur;
public List<List<Integer>> combinationSum(int[] candidates, int target) {
    Arrays.sort(candidates);                                         @sort
    res = new ArrayList<>(); cur = new ArrayList<>();                @init
    dfs(candidates, target, 0, 0);                                   @call
    return res;                                                      @done
}
private void dfs(int[] candidates, int target, int start, int total) {
    if (total == target) {                                           @hit
        res.add(new ArrayList<>(cur));                               @record
        return;
    }
    for (int j = start; j < candidates.length; j++) {                @loop
        if (total + candidates[j] > target) {                        @prune
            break;                                                   @cut
        }
        cur.add(candidates[j]);                                      @choose
        dfs(candidates, target, j, total + candidates[j]);           @explore
        cur.remove(cur.size() - 1);                                  @unchoose
    }
}
`,
    cpp: `
vector<vector<int>> res;
vector<int> cur;
vector<vector<int>> combinationSum(vector<int>& candidates, int target) {
    sort(candidates.begin(), candidates.end());                      @sort
    res.clear(); cur.clear();                                        @init
    dfs(candidates, target, 0, 0);                                   @call
    return res;                                                      @done
}
void dfs(vector<int>& candidates, int target, int start, int total) {
    if (total == target) {                                           @hit
        res.push_back(cur);                                          @record
        return;
    }
    for (int j = start; j < (int)candidates.size(); j++) {           @loop
        if (total + candidates[j] > target) {                        @prune
            break;                                                   @cut
        }
        cur.push_back(candidates[j]);                                @choose
        dfs(candidates, target, j, total + candidates[j]);           @explore
        cur.pop_back();                                              @unchoose
    }
}
`,
    distractors: [
      { java: '        dfs(candidates, target, j + 1, total + candidates[j]);', cpp: '        dfs(candidates, target, j + 1, total + candidates[j]);' },
      { java: '    for (int j = 0; j < candidates.length; j++) {', cpp: '    for (int j = 0; j < (int)candidates.size(); j++) {' },
      { java: '            continue;', cpp: '            continue;' },
    ],
    gotchas: {
      java: ['`res.add(cur)` stores a reference that later `remove` calls empty — copy with `new ArrayList<>(cur)`.'],
      cpp: ['Take `candidates` by `vector<int>&` in the helper; by value, every recursive call copies the array.'],
    },
  },

  permutations: {
    java: `
private List<List<Integer>> res;
private List<Integer> perm;
private boolean[] used;
public List<List<Integer>> permute(int[] nums) {
    res = new ArrayList<>(); perm = new ArrayList<>();          @init
    used = new boolean[nums.length];                            @used
    dfs(nums);                                                  @call
    return res;                                                 @done
}
private void dfs(int[] nums) {
    if (perm.size() == nums.length) {                           @base
        res.add(new ArrayList<>(perm));                         @record
        return;
    }
    for (int i = 0; i < nums.length; i++) {                     @loop
        if (used[i]) {                                          @skipUsed
            continue;
        }
        used[i] = true; perm.add(nums[i]);                      @choose
        dfs(nums);                                              @explore
        used[i] = false; perm.remove(perm.size() - 1);          @unchoose
    }
}
`,
    cpp: `
vector<vector<int>> res;
vector<int> perm;
vector<bool> used;
vector<vector<int>> permute(vector<int>& nums) {
    res.clear(); perm.clear();                                  @init
    used.assign(nums.size(), false);                            @used
    dfs(nums);                                                  @call
    return res;                                                 @done
}
void dfs(vector<int>& nums) {
    if (perm.size() == nums.size()) {                           @base
        res.push_back(perm);                                    @record
        return;
    }
    for (int i = 0; i < (int)nums.size(); i++) {                @loop
        if (used[i]) {                                          @skipUsed
            continue;
        }
        used[i] = true; perm.push_back(nums[i]);                @choose
        dfs(nums);                                              @explore
        used[i] = false; perm.pop_back();                       @unchoose
    }
}
`,
    distractors: [
      { java: '    for (int i = start; i < nums.length; i++) {', cpp: '    for (int i = start; i < (int)nums.size(); i++) {' },
      { java: '        used[i] = true; perm.add(nums[i]); dfs(nums);', cpp: '        used[i] = true; perm.push_back(nums[i]); dfs(nums);' },
    ],
    gotchas: {
      java: [
        '`perm.remove(perm.size() - 1)` uses the index overload; `perm.remove(nums[i])` would ALSO pick the index overload (an `int`) and remove the wrong element.',
        'Record `new ArrayList<>(perm)` — `res.add(perm)` adds a reference to the list being mutated.',
      ],
      cpp: ['`vector<bool>` is a packed bitset specialisation — fine here, but `auto& b = used[i]` is a proxy, not a `bool&`.'],
    },
  },

  'subsets-ii': {
    java: `
private List<List<Integer>> res;
private List<Integer> subset;
public List<List<Integer>> subsetsWithDup(int[] nums) {
    Arrays.sort(nums);                                          @sort
    res = new ArrayList<>(); subset = new ArrayList<>();        @init
    dfs(nums, 0);                                               @call
    return res;                                                 @done
}
private void dfs(int[] nums, int i) {
    if (i == nums.length) {                                     @base
        res.add(new ArrayList<>(subset));                       @record
        return;
    }
    subset.add(nums[i]);                                        @choose
    dfs(nums, i + 1);                                           @include
    subset.remove(subset.size() - 1);                           @unchoose
    while (i + 1 < nums.length && nums[i] == nums[i + 1]) {     @skipDup
        i++;                                                    @advance
    }
    dfs(nums, i + 1);                                           @exclude
}
`,
    cpp: `
vector<vector<int>> res;
vector<int> subset;
vector<vector<int>> subsetsWithDup(vector<int>& nums) {
    sort(nums.begin(), nums.end());                             @sort
    res.clear(); subset.clear();                                @init
    dfs(nums, 0);                                               @call
    return res;                                                 @done
}
void dfs(vector<int>& nums, int i) {
    if (i == (int)nums.size()) {                                @base
        res.push_back(subset);                                  @record
        return;
    }
    subset.push_back(nums[i]);                                  @choose
    dfs(nums, i + 1);                                           @include
    subset.pop_back();                                          @unchoose
    while (i + 1 < (int)nums.size() && nums[i] == nums[i + 1]) {    @skipDup
        i++;                                                    @advance
    }
    dfs(nums, i + 1);                                           @exclude
}
`,
    distractors: [
      { java: '    if (nums[i] == nums[i - 1]) return;', cpp: '    if (nums[i] == nums[i - 1]) return;' },
      { java: '    while (i < nums.length && nums[i] == nums[i + 1]) {', cpp: '    while (i < (int)nums.size() && nums[i] == nums[i + 1]) {' },
    ],
    gotchas: {
      python: ['`nums[i - 1]` at `i = 0` silently reads the LAST element (negative index) instead of failing.'],
      java: ['`nums[i + 1]` past the end throws `ArrayIndexOutOfBoundsException` — keep the `i + 1 < nums.length` test first so `&&` short-circuits.'],
      cpp: ['`nums[i + 1]` past the end is undefined behaviour, not an exception — the `i + 1 < (int)nums.size()` guard must come first.'],
    },
  },

  'combination-sum-ii': {
    java: `
private List<List<Integer>> res;
private List<Integer> cur;
public List<List<Integer>> combinationSum2(int[] candidates, int target) {
    Arrays.sort(candidates);                                           @sort
    res = new ArrayList<>(); cur = new ArrayList<>();                  @init
    dfs(candidates, target, 0, 0);                                     @call
    return res;                                                        @done
}
private void dfs(int[] candidates, int target, int start, int total) {
    if (total == target) {                                             @hit
        res.add(new ArrayList<>(cur));                                 @record
        return;
    }
    for (int j = start; j < candidates.length; j++) {                  @loop
        if (j > start && candidates[j] == candidates[j - 1]) {         @dup
            continue;                                                  @skip
        }
        if (total + candidates[j] > target) {                          @prune
            break;                                                     @cut
        }
        cur.add(candidates[j]);                                        @choose
        dfs(candidates, target, j + 1, total + candidates[j]);         @explore
        cur.remove(cur.size() - 1);                                    @unchoose
    }
}
`,
    cpp: `
vector<vector<int>> res;
vector<int> cur;
vector<vector<int>> combinationSum2(vector<int>& candidates, int target) {
    sort(candidates.begin(), candidates.end());                        @sort
    res.clear(); cur.clear();                                          @init
    dfs(candidates, target, 0, 0);                                     @call
    return res;                                                        @done
}
void dfs(vector<int>& candidates, int target, int start, int total) {
    if (total == target) {                                             @hit
        res.push_back(cur);                                            @record
        return;
    }
    for (int j = start; j < (int)candidates.size(); j++) {             @loop
        if (j > start && candidates[j] == candidates[j - 1]) {         @dup
            continue;                                                  @skip
        }
        if (total + candidates[j] > target) {                          @prune
            break;                                                     @cut
        }
        cur.push_back(candidates[j]);                                  @choose
        dfs(candidates, target, j + 1, total + candidates[j]);         @explore
        cur.pop_back();                                                @unchoose
    }
}
`,
    distractors: [
      { java: '        if (j > 0 && candidates[j] == candidates[j - 1]) {', cpp: '        if (j > 0 && candidates[j] == candidates[j - 1]) {' },
      { java: '        dfs(candidates, target, j, total + candidates[j]);', cpp: '        dfs(candidates, target, j, total + candidates[j]);' },
    ],
    gotchas: {
      java: ['Record `new ArrayList<>(cur)`; `res.add(cur)` stores a reference that ends up empty.'],
      cpp: ['`res.push_back(cur)` copies, so no explicit copy is needed — but pass `candidates` by `&` to avoid copying it per call.'],
    },
  },

  'word-search': {
    java: `
private char[][] board;
private String word;
private int ROWS, COLS;
private boolean[][] path;
public boolean exist(char[][] board, String word) {
    this.board = board; this.word = word;
    ROWS = board.length; COLS = board[0].length;
    path = new boolean[ROWS][COLS];                                  @init
    for (int r = 0; r < ROWS; r++) {                                 @rows
        for (int c = 0; c < COLS; c++) {
            if (dfs(r, c, 0)) {                                      @start
                return true;                                         @yes
            }
        }
    }
    return false;                                                    @no
}
private boolean dfs(int r, int c, int i) {
    if (i == word.length()) {                                        @done
        return true;
    }
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS ||
            board[r][c] != word.charAt(i) || path[r][c]) {           @reject
        return false;                                                @fail
    }
    path[r][c] = true;                                               @choose
    boolean res = dfs(r + 1, c, i + 1) || dfs(r - 1, c, i + 1) ||    @explore
            dfs(r, c + 1, i + 1) || dfs(r, c - 1, i + 1);
    path[r][c] = false;                                              @unchoose
    return res;                                                      @ret
}
`,
    cpp: `
int ROWS, COLS;
vector<vector<bool>> path;
bool exist(vector<vector<char>>& board, string word) {
    ROWS = board.size(); COLS = board[0].size();
    path.assign(ROWS, vector<bool>(COLS, false));                    @init
    for (int r = 0; r < ROWS; r++) {                                 @rows
        for (int c = 0; c < COLS; c++) {
            if (dfs(board, word, r, c, 0)) {                         @start
                return true;                                         @yes
            }
        }
    }
    return false;                                                    @no
}
bool dfs(vector<vector<char>>& board, const string& word, int r, int c, int i) {
    if (i == (int)word.size()) {                                     @done
        return true;
    }
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS ||
            board[r][c] != word[i] || path[r][c]) {                  @reject
        return false;                                                @fail
    }
    path[r][c] = true;                                               @choose
    bool res = dfs(board, word, r + 1, c, i + 1) || dfs(board, word, r - 1, c, i + 1) ||   @explore
            dfs(board, word, r, c + 1, i + 1) || dfs(board, word, r, c - 1, i + 1);
    path[r][c] = false;                                              @unchoose
    return res;                                                      @ret
}
`,
    distractors: [
      { java: '    visited[r][c] = true;  // never cleared', cpp: '    visited[r][c] = true;  // never cleared' },
      { java: '    if (i == word.length() - 1) {', cpp: '    if (i == (int)word.size() - 1) {' },
      { java: '    boolean res = dfs(r + 1, c + 1, i + 1);', cpp: '    bool res = dfs(board, word, r + 1, c + 1, i + 1);' },
    ],
    gotchas: {
      java: ['The bounds checks must come BEFORE `board[r][c]` in the `||` chain, or a negative index throws before short-circuiting can help.'],
      cpp: ['`board[r][c] != word[i]` compares `char`s — fine; but pass `board` by `&`, or each of the 4ⁿ calls copies the grid.'],
    },
  },

  'palindrome-partitioning': {
    java: `
private List<List<String>> res;
private List<String> part;
public List<List<String>> partition(String s) {
    res = new ArrayList<>(); part = new ArrayList<>();         @init
    dfs(s, 0);                                                 @call
    return res;                                                @done
}
private void dfs(String s, int i) {
    if (i >= s.length()) {                                     @base
        res.add(new ArrayList<>(part));                        @record
        return;
    }
    for (int j = i; j < s.length(); j++) {                     @loop
        String sub = s.substring(i, j + 1);
        if (sub.equals(new StringBuilder(sub).reverse().toString())) {   @check
            part.add(sub);                                     @choose
            dfs(s, j + 1);                                     @explore
            part.remove(part.size() - 1);                      @unchoose
        }
    }
}
`,
    cpp: `
vector<vector<string>> res;
vector<string> part;
vector<vector<string>> partition(string s) {
    res.clear(); part.clear();                                 @init
    dfs(s, 0);                                                 @call
    return res;                                                @done
}
void dfs(const string& s, int i) {
    if (i >= (int)s.size()) {                                  @base
        res.push_back(part);                                   @record
        return;
    }
    for (int j = i; j < (int)s.size(); j++) {                  @loop
        string sub = s.substr(i, j - i + 1);
        if (sub == string(sub.rbegin(), sub.rend())) {         @check
            part.push_back(sub);                               @choose
            dfs(s, j + 1);                                     @explore
            part.pop_back();                                   @unchoose
        }
    }
}
`,
    distractors: [
      { java: '            dfs(s, i + 1);', cpp: '            dfs(s, i + 1);' },
      { java: '    for (int j = i + 1; j < s.length(); j++) {', cpp: '    for (int j = i + 1; j < (int)s.size(); j++) {' },
    ],
    gotchas: {
      java: [
        '`s.substring(i, j + 1)` takes an END index (exclusive), like Python slicing.',
        'Compare strings with `.equals`, never `==` (that compares references).',
      ],
      cpp: ['`s.substr(i, len)` takes a LENGTH, not an end index — the piece `s[i..j]` is `s.substr(i, j - i + 1)`.'],
    },
  },

  'letter-combinations-of-a-phone-number': {
    java: `
private List<String> res;
private Map<Character, String> phone;
public List<String> letterCombinations(String digits) {
    res = new ArrayList<>();                                         @init
    phone = Map.of('2', "abc", '3', "def", '4', "ghi", '5', "jkl",   @map
            '6', "mno", '7', "pqrs", '8', "tuv", '9', "wxyz");
    if (!digits.isEmpty()) {                                         @guard
        dfs(digits, 0, "");                                          @call
    }
    return res;                                                      @done
}
private void dfs(String digits, int i, String cur) {
    if (cur.length() == digits.length()) {                           @base
        res.add(cur);                                                @record
        return;
    }
    for (char ch : phone.get(digits.charAt(i)).toCharArray()) {      @loop
        dfs(digits, i + 1, cur + ch);                                @explore
    }
}
`,
    cpp: `
vector<string> res;
unordered_map<char, string> phone;
vector<string> letterCombinations(string digits) {
    res.clear();                                                     @init
    phone = {{'2', "abc"}, {'3', "def"}, {'4', "ghi"}, {'5', "jkl"},   @map
            {'6', "mno"}, {'7', "pqrs"}, {'8', "tuv"}, {'9', "wxyz"}};
    if (!digits.empty()) {                                           @guard
        dfs(digits, 0, "");                                          @call
    }
    return res;                                                      @done
}
void dfs(const string& digits, int i, string cur) {
    if (cur.size() == digits.size()) {                               @base
        res.push_back(cur);                                          @record
        return;
    }
    for (char ch : phone[digits[i]]) {                               @loop
        dfs(digits, i + 1, cur + ch);                                @explore
    }
}
`,
    distractors: [
      { java: '        dfs(digits, i, cur + ch);', cpp: '        dfs(digits, i, cur + ch);' },
      { java: '    dfs(digits, 0, "");', cpp: '    dfs(digits, 0, "");' },
    ],
    gotchas: {
      java: ['`phone.get(digits.charAt(i))` needs a `Character` key — a `Map<String, String>` keyed by `"2"` would return null for a `char`.'],
      cpp: ['`cur` is taken BY VALUE on purpose: each branch gets its own string, so nothing needs undoing (`string&` would need a `pop_back`).'],
    },
  },

  'n-queens': {
    java: `
private Set<Integer> cols, pos, neg;
private List<List<String>> res;
private char[][] board;
public List<List<String>> solveNQueens(int n) {
    cols = new HashSet<>(); pos = new HashSet<>(); neg = new HashSet<>();    @init
    res = new ArrayList<>(); board = new char[n][n];                         @board
    for (char[] row : board) Arrays.fill(row, '.');
    dfs(n, 0);                                                               @call
    return res;                                                              @done
}
private void dfs(int n, int r) {
    if (r == n) {                                                            @base
        res.add(Arrays.stream(board).map(String::new).collect(Collectors.toList()));   @record
        return;
    }
    for (int c = 0; c < n; c++) {                                            @loop
        if (cols.contains(c) || pos.contains(r + c) || neg.contains(r - c)) {    @attacked
            continue;                                                        @skip
        }
        cols.add(c); pos.add(r + c); neg.add(r - c);                         @place
        board[r][c] = 'Q';
        dfs(n, r + 1);                                                       @explore
        cols.remove(c); pos.remove(r + c); neg.remove(r - c);                @remove
        board[r][c] = '.';
    }
}
`,
    cpp: `
unordered_set<int> cols, pos, neg;
vector<vector<string>> res;
vector<string> board;
vector<vector<string>> solveNQueens(int n) {
    cols.clear(); pos.clear(); neg.clear();                                  @init
    res.clear(); board.assign(n, string(n, '.'));                            @board
    dfs(n, 0);                                                               @call
    return res;                                                              @done
}
void dfs(int n, int r) {
    if (r == n) {                                                            @base
        res.push_back(board);                                                @record
        return;
    }
    for (int c = 0; c < n; c++) {                                            @loop
        if (cols.count(c) || pos.count(r + c) || neg.count(r - c)) {         @attacked
            continue;                                                        @skip
        }
        cols.insert(c); pos.insert(r + c); neg.insert(r - c);                @place
        board[r][c] = 'Q';
        dfs(n, r + 1);                                                       @explore
        cols.erase(c); pos.erase(r + c); neg.erase(r - c);                   @remove
        board[r][c] = '.';
    }
}
`,
    distractors: [
      {
        java: '        if (cols.contains(c) || pos.contains(r + c) || neg.contains(r + c)) {',
        cpp: '        if (cols.count(c) || pos.count(r + c) || neg.count(r + c)) {',
      },
      { java: '        cols.remove(c);', cpp: '        cols.erase(c);' },
      { java: '    for (int r = 0; r < n; r++) {', cpp: '    for (int r = 0; r < n; r++) {' },
    ],
    gotchas: {
      java: [
        'A `char[]` row must become `new String(row)` when recording — `row.toString()` gives `[C@1b6d3586`, not `"..Q."`.',
        'If you swap the sets for `boolean[]` arrays, `r - c` can be negative — index `neg` with `r - c + n - 1`.',
      ],
      cpp: ['With `vector<string> board`, `res.push_back(board)` snapshots the whole board by value — no join step needed.'],
    },
  },
};
