import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the math-geometry problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'rotate-image': {
    java: `
public void rotate(int[][] matrix) {
    int l = 0, r = matrix.length - 1;                          @init
    while (l < r) {                                            @layer
        int top = l, bottom = r;                               @bounds
        for (int i = 0; i < r - l; i++) {                      @loop
            int topLeft = matrix[top][l + i];                  @save
            matrix[top][l + i] = matrix[bottom - i][l];        @leftToTop
            matrix[bottom - i][l] = matrix[bottom][r - i];     @bottomToLeft
            matrix[bottom][r - i] = matrix[top + i][r];        @rightToBottom
            matrix[top + i][r] = topLeft;                      @topLeftToRight
        }
        l++; r--;                                              @shrink
    }
}
`,
    cpp: `
void rotate(vector<vector<int>>& matrix) {
    int l = 0, r = (int)matrix.size() - 1;                     @init
    while (l < r) {                                            @layer
        int top = l, bottom = r;                               @bounds
        for (int i = 0; i < r - l; i++) {                      @loop
            int topLeft = matrix[top][l + i];                  @save
            matrix[top][l + i] = matrix[bottom - i][l];        @leftToTop
            matrix[bottom - i][l] = matrix[bottom][r - i];     @bottomToLeft
            matrix[bottom][r - i] = matrix[top + i][r];        @rightToBottom
            matrix[top + i][r] = topLeft;                      @topLeftToRight
        }
        l++; r--;                                              @shrink
    }
}
`,
    distractors: [
      { java: '        for (int i = 0; i <= r - l; i++) {', cpp: '        for (int i = 0; i <= r - l; i++) {' },
      { java: '            matrix[top][l + i] = matrix[top + i][r];', cpp: '            matrix[top][l + i] = matrix[top + i][r];' },
      { java: '            matrix[top + i][r] = matrix[top][l + i];', cpp: '            matrix[top + i][r] = matrix[top][l + i];' },
    ],
    gotchas: {
      python: ['`matrix[:] = [list(row) for row in zip(*matrix[::-1])]` is a neat one-liner but allocates a second matrix — not O(1) space.'],
      java: ['`int[][]` is an array of row references: `matrix[i] = matrix[j]` aliases rows instead of copying values, so rotate cell by cell.'],
      cpp: ['Take the matrix by reference (`vector<vector<int>>&`); by value you rotate a copy and the caller sees nothing. `std::reverse` + transpose with `swap(matrix[i][j], matrix[j][i])` is the other in-place approach.'],
    },
  },

  'spiral-matrix': {
    java: `
public List<Integer> spiralOrder(int[][] matrix) {
    List<Integer> res = new ArrayList<>();            @init
    int left = 0, right = matrix[0].length;
    int top = 0, bottom = matrix.length;
    while (left < right && top < bottom) {            @loop
        for (int i = left; i < right; i++) {          @top
            res.add(matrix[top][i]);                  @takeTop
        }
        top++;                                        @shrinkTop
        for (int i = top; i < bottom; i++) {          @right
            res.add(matrix[i][right - 1]);            @takeRight
        }
        right--;                                      @shrinkRight
        if (!(left < right && top < bottom)) {        @guard
            break;                                    @stop
        }
        for (int i = right - 1; i >= left; i--) {     @bottom
            res.add(matrix[bottom - 1][i]);           @takeBottom
        }
        bottom--;                                     @shrinkBottom
        for (int i = bottom - 1; i >= top; i--) {     @left
            res.add(matrix[i][left]);                 @takeLeft
        }
        left++;                                       @shrinkLeft
    }
    return res;                                       @done
}
`,
    cpp: `
vector<int> spiralOrder(vector<vector<int>>& matrix) {
    vector<int> res;                                  @init
    int left = 0, right = (int)matrix[0].size();
    int top = 0, bottom = (int)matrix.size();
    while (left < right && top < bottom) {            @loop
        for (int i = left; i < right; i++) {          @top
            res.push_back(matrix[top][i]);            @takeTop
        }
        top++;                                        @shrinkTop
        for (int i = top; i < bottom; i++) {          @right
            res.push_back(matrix[i][right - 1]);      @takeRight
        }
        right--;                                      @shrinkRight
        if (!(left < right && top < bottom)) {        @guard
            break;                                    @stop
        }
        for (int i = right - 1; i >= left; i--) {     @bottom
            res.push_back(matrix[bottom - 1][i]);     @takeBottom
        }
        bottom--;                                     @shrinkBottom
        for (int i = bottom - 1; i >= top; i--) {     @left
            res.push_back(matrix[i][left]);           @takeLeft
        }
        left++;                                       @shrinkLeft
    }
    return res;                                       @done
}
`,
    distractors: [
      { java: '        for (int i = left; i <= right; i++) {', cpp: '        for (int i = left; i <= right; i++) {' },
      { java: '            res.add(matrix[i][right]);', cpp: '            res.push_back(matrix[i][right]);' },
      { java: '        top--;', cpp: '        top--;' },
    ],
    gotchas: {
      python: ['`range(right - 1, left - 1, -1)` stops BEFORE `left - 1`, i.e. it includes `left` — the backward walks need that `- 1` on the stop value.'],
      java: ['The return type is `List<Integer>`, so every `int` is autoboxed on `res.add` — fine here, but never compare two elements with `==`.'],
      cpp: ['Use `int` bounds, not `size_t`: `for (size_t i = right - 1; i >= left; i--)` never ends when `left == 0` because an unsigned index wraps around instead of going negative.'],
    },
  },

  'set-matrix-zeroes': {
    java: `
public void setZeroes(int[][] matrix) {
    int ROWS = matrix.length, COLS = matrix[0].length;   @init
    boolean rowZero = false;
    for (int r = 0; r < ROWS; r++) {                     @scanR
        for (int c = 0; c < COLS; c++) {                 @scanC
            if (matrix[r][c] == 0) {                     @isZero
                matrix[0][c] = 0;                        @markCol
                if (r > 0) {                             @notFirst
                    matrix[r][0] = 0;                    @markRow
                } else {
                    rowZero = true;                      @flagRow
                }
            }
        }
    }
    for (int r = 1; r < ROWS; r++) {                     @fillR
        for (int c = 1; c < COLS; c++) {                 @fillC
            if (matrix[0][c] == 0 || matrix[r][0] == 0) {   @readMarks
                matrix[r][c] = 0;                        @zero
            }
        }
    }
    if (matrix[0][0] == 0) {                             @col0
        for (int r = 0; r < ROWS; r++) {                 @col0Loop
            matrix[r][0] = 0;                            @col0Set
        }
    }
    if (rowZero) {                                       @row0
        for (int c = 0; c < COLS; c++) {                 @row0Loop
            matrix[0][c] = 0;                            @row0Set
        }
    }
}
`,
    cpp: `
void setZeroes(vector<vector<int>>& matrix) {
    int ROWS = matrix.size(), COLS = matrix[0].size();   @init
    bool rowZero = false;
    for (int r = 0; r < ROWS; r++) {                     @scanR
        for (int c = 0; c < COLS; c++) {                 @scanC
            if (matrix[r][c] == 0) {                     @isZero
                matrix[0][c] = 0;                        @markCol
                if (r > 0) {                             @notFirst
                    matrix[r][0] = 0;                    @markRow
                } else {
                    rowZero = true;                      @flagRow
                }
            }
        }
    }
    for (int r = 1; r < ROWS; r++) {                     @fillR
        for (int c = 1; c < COLS; c++) {                 @fillC
            if (matrix[0][c] == 0 || matrix[r][0] == 0) {   @readMarks
                matrix[r][c] = 0;                        @zero
            }
        }
    }
    if (matrix[0][0] == 0) {                             @col0
        for (int r = 0; r < ROWS; r++) {                 @col0Loop
            matrix[r][0] = 0;                            @col0Set
        }
    }
    if (rowZero) {                                       @row0
        for (int c = 0; c < COLS; c++) {                 @row0Loop
            matrix[0][c] = 0;                            @row0Set
        }
    }
}
`,
    distractors: [
      { java: '    for (int r = 0; r < ROWS; r++) {', cpp: '    for (int r = 0; r < ROWS; r++) {' },
      { java: '            if (matrix[0][c] == 0 && matrix[r][0] == 0) {', cpp: '            if (matrix[0][c] == 0 && matrix[r][0] == 0) {' },
      { java: '                matrix[0][0] = 0;', cpp: '                matrix[0][0] = 0;' },
    ],
    gotchas: {
      python: ['`[[0] * COLS] * ROWS` (if you ever build a marker grid) repeats ONE row object — zeroing one row zeroes them all.'],
      java: ['`Arrays.fill(matrix[r], 0)` clears a whole row in one call, but there is no column equivalent — columns still need a loop.'],
      cpp: ['`int ROWS = matrix.size()` narrows a `size_t`; that is fine for LeetCode sizes, but keep loop indices `int` so `r - 1` style arithmetic never wraps.'],
    },
  },

  'happy-number': {
    java: `
public boolean isHappy(int n) {
    int slow = n, fast = sumSquareDigits(n);    @init
    while (slow != fast) {                      @loop
        fast = sumSquareDigits(fast);           @fast1
        fast = sumSquareDigits(fast);           @fast2
        slow = sumSquareDigits(slow);           @slow
    }
    return fast == 1;                           @done
}

private int sumSquareDigits(int n) {
    int output = 0;
    while (n != 0) {
        output += (n % 10) * (n % 10);
        n = n / 10;
    }
    return output;
}
`,
    cpp: `
bool isHappy(int n) {
    int slow = n, fast = sumSquareDigits(n);    @init
    while (slow != fast) {                      @loop
        fast = sumSquareDigits(fast);           @fast1
        fast = sumSquareDigits(fast);           @fast2
        slow = sumSquareDigits(slow);           @slow
    }
    return fast == 1;                           @done
}

int sumSquareDigits(int n) {
    int output = 0;
    while (n != 0) {
        output += (n % 10) * (n % 10);
        n = n / 10;
    }
    return output;
}
`,
    distractors: [
      { java: '    while (fast != 1) {', cpp: '    while (fast != 1) {' },
      { java: '    int slow = n, fast = n;', cpp: '    int slow = n, fast = n;' },
      { java: '    return slow == n;', cpp: '    return slow == n;' },
    ],
    gotchas: {
      python: ['`n // 10` is floor division; plain `n / 10` gives a float in Python 3 and the loop never reaches 0 cleanly.'],
      java: ['`Math.pow(n % 10, 2)` returns a `double` — square with `d * d` to stay in `int`. And `^` is XOR, not power.'],
      cpp: ['`while (n)` works in C++ (non-zero is true) but Java needs the explicit `n != 0`; `pow()` returns `double`, so square digits with `*`.'],
    },
  },

  'plus-one': {
    java: `
public int[] plusOne(int[] digits) {
    for (int i = digits.length - 1; i >= 0; i--) {   @loop
        if (digits[i] < 9) {                         @check
            digits[i]++;                             @inc
            return digits;                           @ret
        }
        digits[i] = 0;                               @carry
    }
    int[] res = new int[digits.length + 1];          @grow
    res[0] = 1;
    return res;
}
`,
    cpp: `
vector<int> plusOne(vector<int>& digits) {
    for (int i = (int)digits.size() - 1; i >= 0; i--) {   @loop
        if (digits[i] < 9) {                               @check
            digits[i]++;                                   @inc
            return digits;                                 @ret
        }
        digits[i] = 0;                                     @carry
    }
    digits.insert(digits.begin(), 1);                      @grow
    return digits;
}
`,
    distractors: [
      { java: '    for (int i = 0; i < digits.length; i++) {', cpp: '    for (int i = 0; i < (int)digits.size(); i++) {' },
      { java: '        digits[i]++;', cpp: '        digits[i]++;' },
      { java: '    res[res.length - 1] = 1;', cpp: '    digits.push_back(1);' },
    ],
    gotchas: {
      python: ['`[1] + digits` builds a new list; `digits.insert(0, 1)` mutates in place — both are O(n), but only happen when every digit was 9.'],
      java: ['Arrays have a fixed length: on all-9s you must allocate `new int[digits.length + 1]` — every slot is already 0, so only `res[0] = 1` is needed.'],
      cpp: ['`for (size_t i = digits.size() - 1; i >= 0; i--)` is an infinite loop — an unsigned index is never negative. Use `int` (cast the size).'],
    },
  },

  'powx-n': {
    java: `
public double myPow(double x, int exponent) {
    long n = exponent;              // -(-2^31) does not fit in an int
    if (n < 0) {                    @neg
        x = 1 / x; n = -n;          @flip
    }
    double res = 1, base = x;       @init
    while (n != 0) {                @loop
        if ((n & 1) == 1) {         @bit
            res *= base;            @take
        }
        base *= base;               @square
        n >>= 1;                    @shift
    }
    return res;                     @done
}
`,
    cpp: `
double myPow(double x, int exponent) {
    long long n = exponent;         // -(-2^31) does not fit in an int
    if (n < 0) {                    @neg
        x = 1 / x; n = -n;          @flip
    }
    double res = 1, base = x;       @init
    while (n) {                     @loop
        if (n & 1) {                @bit
            res *= base;            @take
        }
        base *= base;               @square
        n >>= 1;                    @shift
    }
    return res;                     @done
}
`,
    distractors: [
      { java: '        base *= x;', cpp: '        base *= x;' },
      { java: '            res *= x;', cpp: '            res *= x;' },
      { java: '        n -= 1;', cpp: '        n -= 1;' },
    ],
    gotchas: {
      python: ['Python ints never overflow, so `-n` for `n = -2**31` is safe here — not in Java/C++.'],
      java: [
        '`n = -n` on `int n = Integer.MIN_VALUE` overflows back to `Integer.MIN_VALUE`; widen to `long` first. `Math.pow` exists but returns `double` and is what the interviewer asks you NOT to call.',
        '`if (n & 1)` does not compile — Java needs a boolean, and `(n & 1) == 1` needs the parentheses because `==` binds tighter than `&`.',
      ],
      cpp: ['Negating `INT_MIN` is undefined behaviour — copy the exponent into a `long long` before `n = -n`. `n >>= 1` on a negative signed value is implementation-defined, another reason to make `n` non-negative first.'],
    },
  },

  'multiply-strings': {
    java: `
public String multiply(String num1, String num2) {
    if (num1.equals("0") || num2.equals("0")) {                          @zero
        return "0";                                                      @zeroRes
    }
    int[] res = new int[num1.length() + num2.length()];                  @init
    num1 = new StringBuilder(num1).reverse().toString();                 @reverse
    num2 = new StringBuilder(num2).reverse().toString();
    for (int i1 = 0; i1 < num1.length(); i1++) {                         @outer
        for (int i2 = 0; i2 < num2.length(); i2++) {                     @inner
            int digit = (num1.charAt(i1) - '0') * (num2.charAt(i2) - '0');   @mul
            res[i1 + i2] += digit;                                       @add
            res[i1 + i2 + 1] += res[i1 + i2] / 10;                       @carry
            res[i1 + i2] = res[i1 + i2] % 10;                            @keep
        }
    }
    int beg = 0;
    for (int i = 0, j = res.length - 1; i < j; i++, j--) {               @flip
        int tmp = res[i]; res[i] = res[j]; res[j] = tmp;
    }
    while (beg < res.length && res[beg] == 0) {                          @skip
        beg++;                                                           @advance
    }
    StringBuilder sb = new StringBuilder();
    for (int i = beg; i < res.length; i++) sb.append(res[i]);
    return sb.toString();                                                @done
}
`,
    cpp: `
string multiply(string num1, string num2) {
    if (num1 == "0" || num2 == "0") {                                    @zero
        return "0";                                                      @zeroRes
    }
    vector<int> res(num1.size() + num2.size(), 0);                       @init
    reverse(num1.begin(), num1.end());                                   @reverse
    reverse(num2.begin(), num2.end());
    for (int i1 = 0; i1 < (int)num1.size(); i1++) {                      @outer
        for (int i2 = 0; i2 < (int)num2.size(); i2++) {                  @inner
            int digit = (num1[i1] - '0') * (num2[i2] - '0');             @mul
            res[i1 + i2] += digit;                                       @add
            res[i1 + i2 + 1] += res[i1 + i2] / 10;                       @carry
            res[i1 + i2] = res[i1 + i2] % 10;                            @keep
        }
    }
    reverse(res.begin(), res.end());                                     @flip
    int beg = 0;
    while (beg < (int)res.size() && res[beg] == 0) {                     @skip
        beg++;                                                           @advance
    }
    string out;
    for (int i = beg; i < (int)res.size(); i++) out += char('0' + res[i]);
    return out;                                                          @done
}
`,
    distractors: [
      { java: '            res[i1 + i2 + 1] = res[i1 + i2] / 10;', cpp: '            res[i1 + i2 + 1] = res[i1 + i2] / 10;' },
      { java: '    int[] res = new int[num1.length() * num2.length()];', cpp: '    vector<int> res(num1.size() * num2.size(), 0);' },
      { java: '            res[i1 * i2] += digit;', cpp: '            res[i1 * i2] += digit;' },
    ],
    gotchas: {
      python: ['`int(num1) * int(num2)` would just work (Python ints are arbitrary precision) — which is exactly why the problem forbids converting the whole string.'],
      java: ['`num1 == "0"` compares references — use `.equals`. `charAt(i) - \'0\'` turns a digit char into its `int` value (`charAt` alone gives the char code, 48 for `\'0\'`).'],
      cpp: ['`stoll` overflows past 19 digits, so digit-by-digit is required; `num1[i] - \'0\'` converts a digit char, and `char(\'0\' + d)` converts back.'],
    },
  },

  'detect-squares': {
    java: `
class DetectSquares {
    private Map<List<Integer>, Integer> ptsCount;
    private List<int[]> pts;

    public DetectSquares() {
        ptsCount = new HashMap<>();                                      @init
        pts = new ArrayList<>();
    }

    public void add(int[] point) {
        ptsCount.merge(List.of(point[0], point[1]), 1, Integer::sum);    @add
        pts.add(point);                                                  @store
    }

    public int count(int[] point) {
        int res = 0;                                                     @count
        int px = point[0], py = point[1];
        for (int[] p : pts) {                                            @loop
            int x = p[0], y = p[1];
            if (Math.abs(py - y) != Math.abs(px - x) || x == px || y == py) {   @diag
                continue;                                                @skip
            }
            res += ptsCount.getOrDefault(List.of(x, py), 0) * ptsCount.getOrDefault(List.of(px, y), 0);   @combine
        }
        return res;                                                      @ret
    }
}
`,
    cpp: `
class DetectSquares {
public:
    map<pair<int, int>, int> ptsCount;                                   @init
    vector<pair<int, int>> pts;

    void add(vector<int> point) {
        ptsCount[{point[0], point[1]}]++;                                @add
        pts.push_back({point[0], point[1]});                             @store
    }

    int count(vector<int> point) {
        int res = 0;                                                     @count
        int px = point[0], py = point[1];
        for (auto& [x, y] : pts) {                                       @loop
            if (abs(py - y) != abs(px - x) || x == px || y == py) {      @diag
                continue;                                                @skip
            }
            res += ptsCount[{x, py}] * ptsCount[{px, y}];                @combine
        }
        return res;                                                      @ret
    }
};
`,
    distractors: [
      { java: '            if (Math.abs(py - y) != Math.abs(px - x)) {', cpp: '            if (abs(py - y) != abs(px - x)) {' },
      {
        java: '            res += ptsCount.getOrDefault(List.of(x, py), 0) + ptsCount.getOrDefault(List.of(px, y), 0);',
        cpp: '            res += ptsCount[{x, py}] + ptsCount[{px, y}];',
      },
      { java: '        for (List<Integer> p : ptsCount.keySet()) {', cpp: '        for (auto& [pt, cnt] : ptsCount) {' },
    ],
    gotchas: {
      python: ['Lists are unhashable — `tuple(point)` is what makes the point usable as a dict key; `defaultdict(int)` returns 0 for missing corners.'],
      java: ['An `int[]` key hashes by identity, so two equal points would be different keys — use `List.of(x, y)` (value equality) or encode `x * 1001 + y` as one `int`.'],
      cpp: ['`unordered_map<pair<int, int>, int>` does not compile (no `std::hash` for `pair`) — use `map` or encode the point as `x * 1001 + y`. `ptsCount[{x, py}]` inserts a 0 entry on a miss, just like `defaultdict`.'],
    },
  },
};
