import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the bit-manipulation problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'single-number': {
    java: `
public int singleNumber(int[] nums) {
    int res = 0;                 @init
    for (int n : nums) {         @loop
        res = n ^ res;           @xor
    }
    return res;                  @done
}
`,
    cpp: `
int singleNumber(vector<int>& nums) {
    int res = 0;                 @init
    for (int n : nums) {         @loop
        res = n ^ res;           @xor
    }
    return res;                  @done
}
`,
    distractors: [
      { java: '        res = n & res;', cpp: '        res = n & res;' },
      { java: '        res = n | res;', cpp: '        res = n | res;' },
      { java: '    int res = 1;', cpp: '    int res = 1;' },
    ],
    gotchas: {
      java: ['`^` is XOR in Java (not power) — `Math.pow` is exponentiation; a stream one-liner is `Arrays.stream(nums).reduce(0, (a, b) -> a ^ b)`.'],
      cpp: ['`accumulate(nums.begin(), nums.end(), 0, bit_xor<int>())` is the STL one-liner; `^` has LOWER precedence than `==`, so parenthesise `(a ^ b) == 0`.'],
    },
  },

  'number-of-1-bits': {
    java: `
public int hammingWeight(int n) {
    int res = 0;                 @init
    while (n != 0) {             @while
        n &= n - 1;              @drop
        res += 1;                @count
    }
    return res;                  @done
}
`,
    cpp: `
int hammingWeight(uint32_t n) {
    int res = 0;                 @init
    while (n) {                  @while
        n &= n - 1;              @drop
        res += 1;                @count
    }
    return res;                  @done
}
`,
    distractors: [
      { java: '        n &= n + 1;', cpp: '        n &= n + 1;' },
      { java: '        n ^= n - 1;', cpp: '        n ^= n - 1;' },
      { java: '    while (n > 1) {', cpp: '    while (n > 1) {' },
    ],
    gotchas: {
      java: [
        'Java has no unsigned `int`: an input with bit 31 set is NEGATIVE, so loop on `n != 0`, never `n > 0`; shift with `>>>` (unsigned), not `>>`.',
        '`Integer.bitCount(n)` is the built-in popcount.',
      ],
      cpp: ['Take the input as `uint32_t` so `>>` shifts in zeros and `n - 1` wraps cleanly; `__builtin_popcount(n)` / `bitset<32>(n).count()` are the built-ins.'],
    },
  },

  'counting-bits': {
    java: `
public int[] countBits(int n) {
    int[] dp = new int[n + 1];               @init
    int offset = 1;                          @offset
    for (int i = 1; i <= n; i++) {           @loop
        if (offset * 2 == i) {               @check
            offset = i;                      @bump
        }
        dp[i] = 1 + dp[i - offset];          @dp
    }
    return dp;                               @done
}
`,
    cpp: `
vector<int> countBits(int n) {
    vector<int> dp(n + 1, 0);                @init
    int offset = 1;                          @offset
    for (int i = 1; i <= n; i++) {           @loop
        if (offset * 2 == i) {               @check
            offset = i;                      @bump
        }
        dp[i] = 1 + dp[i - offset];          @dp
    }
    return dp;                               @done
}
`,
    distractors: [
      { java: '        dp[i] = dp[i - offset];', cpp: '        dp[i] = dp[i - offset];' },
      { java: '        if (i % offset == 0) {', cpp: '        if (i % offset == 0) {' },
      { java: '        dp[i] = 1 + dp[i - 1];', cpp: '        dp[i] = 1 + dp[i - 1];' },
    ],
    gotchas: {
      java: ['`new int[n + 1]` is already zero-filled; the offset-free recurrence is `dp[i] = dp[i >> 1] + (i & 1)`.'],
      cpp: ['`(i & (i - 1)) == 0` tests a power of two — the parentheses matter because `==` binds tighter than `&`.'],
    },
  },

  'reverse-bits': {
    java: `
public int reverseBits(int n) {
    int res = 0;                                 @init
    for (int i = 0; i < 32; i++) {               @loop
        int bit = (n >>> i) & 1;                 @bit
        res = res | (bit << (31 - i));           @place
    }
    return res;                                  @done
}
`,
    cpp: `
uint32_t reverseBits(uint32_t n) {
    uint32_t res = 0;                            @init
    for (int i = 0; i < 32; i++) {               @loop
        uint32_t bit = (n >> i) & 1;             @bit
        res = res | (bit << (31 - i));           @place
    }
    return res;                                  @done
}
`,
    distractors: [
      { java: '    while (n != 0) {', cpp: '    while (n) {' },
      { java: '        res = res | (bit << i);', cpp: '        res = res | (bit << i);' },
      { java: '        int bit = n & (1 << 31 - i);', cpp: '        uint32_t bit = n & (1u << 31 - i);' },
    ],
    gotchas: {
      java: [
        'Java treats the input as a signed `int`: use `>>>` (zero-fill) when shifting it; `bit << 31` yields a negative `int`, which is the correct bit pattern.',
        '`Integer.reverse(n)` is the built-in.',
      ],
      cpp: ['Work in `uint32_t`: `1 << 31` on a signed `int` overflows (undefined behaviour before C++20) and `>>` on a negative `int` drags in sign bits.'],
    },
  },

  'missing-number': {
    java: `
public int missingNumber(int[] nums) {
    int res = nums.length;                   @init
    for (int i = 0; i < nums.length; i++) {  @loop
        res ^= i ^ nums[i];                  @xor
    }
    return res;                              @done
}
`,
    cpp: `
int missingNumber(vector<int>& nums) {
    int res = (int)nums.size();              @init
    for (int i = 0; i < (int)nums.size(); i++) {   @loop
        res ^= i ^ nums[i];                  @xor
    }
    return res;                              @done
}
`,
    distractors: [
      { java: '    int res = 0;', cpp: '    int res = 0;' },
      { java: '        res ^= nums[i];', cpp: '        res ^= nums[i];' },
      { java: '        res += i - nums[i];', cpp: '        res += i - nums[i];' },
    ],
    gotchas: {
      java: ['The sum alternative `n * (n + 1) / 2 - sum` can overflow `int` for huge n; XOR never overflows.'],
      cpp: ['XOR avoids the signed-overflow undefined behaviour that the `n * (n + 1) / 2` sum formula risks for large n.'],
    },
  },

  'sum-of-two-integers': {
    java: `
public int getSum(int a, int b) {
    int MASK = 0xFFFFFFFF, MAX = 0x7FFFFFFF;        @init
    while (b != 0) {                                @while
        int carry = ((a & b) << 1) & MASK;          @carry
        a = (a ^ b) & MASK;                         @xor
        b = carry;                                  @shift
    }
    return a <= MAX ? a : ~(a ^ MASK);              @done
}
`,
    cpp: `
int getSum(int a, int b) {
    uint32_t MASK = 0xFFFFFFFF, MAX = 0x7FFFFFFF;   @init
    while (b != 0) {                                @while
        uint32_t carry = ((uint32_t)(a & b) << 1) & MASK;   @carry
        a = (a ^ b) & MASK;                         @xor
        b = carry;                                  @shift
    }
    return (uint32_t)a <= MAX ? a : ~(a ^ MASK);    @done
}
`,
    distractors: [
      { java: '        int carry = (a & b) >> 1;', cpp: '        uint32_t carry = (uint32_t)(a & b) >> 1;' },
      { java: '        a = (a | b) & MASK;', cpp: '        a = (a | b) & MASK;' },
      { java: '        b = carry;\n        a = (a ^ b) & MASK;', cpp: '        b = carry;\n        a = (a ^ b) & MASK;' },
    ],
    gotchas: {
      python: ['Python ints never overflow, so without `& MASK` a negative carry keeps growing forever — the mask simulates 32-bit wrap-around.'],
      java: ['Java `int` is already 32-bit two\'s complement, so `& MASK` (MASK = −1) and the final sign fix are no-ops kept only to mirror Python — the carry simply falls off bit 31 and the loop ends.'],
      cpp: ['Left-shifting a negative `int` is undefined behaviour before C++20 — do the `<< 1` on `uint32_t`, whose arithmetic wraps mod 2³² by definition.'],
    },
  },

  'reverse-integer': {
    java: `
public int reverse(int x) {
    int MAX = Integer.MAX_VALUE, MIN = Integer.MIN_VALUE;             @init
    int res = 0;                                                      @res
    while (x != 0) {                                                  @while
        int digit = x % 10;                                           @digit
        x /= 10;                                                      @shrink
        if (res > MAX / 10 || (res == MAX / 10 && digit > MAX % 10)) {   @ovHi
            return 0;                                                 @zeroHi
        }
        if (res < MIN / 10 || (res == MIN / 10 && digit < MIN % 10)) {   @ovLo
            return 0;                                                 @zeroLo
        }
        res = res * 10 + digit;                                       @push
    }
    return res;                                                       @done
}
`,
    cpp: `
int reverse(int x) {
    int MAX = INT_MAX, MIN = INT_MIN;                                 @init
    int res = 0;                                                      @res
    while (x != 0) {                                                  @while
        int digit = x % 10;                                           @digit
        x /= 10;                                                      @shrink
        if (res > MAX / 10 || (res == MAX / 10 && digit > MAX % 10)) {   @ovHi
            return 0;                                                 @zeroHi
        }
        if (res < MIN / 10 || (res == MIN / 10 && digit < MIN % 10)) {   @ovLo
            return 0;                                                 @zeroLo
        }
        res = res * 10 + digit;                                       @push
    }
    return res;                                                       @done
}
`,
    distractors: [
      { java: '        int digit = Math.floorMod(x, 10);', cpp: '        int digit = ((x % 10) + 10) % 10;' },
      { java: '        res = res * 10 + digit;\n        if (res > MAX) return 0;', cpp: '        res = res * 10 + digit;\n        if (res > MAX) return 0;' },
      { java: '        x = Math.floorDiv(x, 10);', cpp: '        x = (int)floor(x / 10.0);' },
    ],
    gotchas: {
      python: ['Python `%` and `//` floor toward −∞, so `math.fmod` / `int(x / 10)` are needed to get C-style truncation for negative x.'],
      java: [
        'Java `%` and `/` truncate toward zero (−123 % 10 = −3, −123 / 10 = −12) — exactly what the digit loop needs, no `fmod` tricks.',
        'Check the bounds BEFORE `res * 10 + digit`: an `int` silently wraps, so `res > MAX` afterwards can never be true.',
      ],
      cpp: ['Signed overflow is undefined behaviour in C++, so the pre-multiplication bound check is mandatory — the compiler may even delete a post-hoc `res > MAX` test.'],
    },
  },
};
