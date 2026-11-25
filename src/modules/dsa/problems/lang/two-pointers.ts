import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the two-pointers problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'valid-palindrome': {
    java: `
public boolean isPalindrome(String s) {
    int l = 0, r = s.length() - 1;                                        @init
    while (l < r) {                                                       @loop
        while (l < r && !Character.isLetterOrDigit(s.charAt(l))) {        @skipL
            l++;                                                          @incL
        }
        while (l < r && !Character.isLetterOrDigit(s.charAt(r))) {        @skipR
            r--;                                                          @decR
        }
        if (Character.toLowerCase(s.charAt(l)) != Character.toLowerCase(s.charAt(r))) {   @cmp
            return false;                                                 @fail
        }
        l++; r--;                                                         @move
    }
    return true;                                                          @ok
}
`,
    cpp: `
bool isPalindrome(string s) {
    int l = 0, r = (int)s.size() - 1;                                     @init
    while (l < r) {                                                       @loop
        while (l < r && !isalnum((unsigned char)s[l])) {                  @skipL
            l++;                                                          @incL
        }
        while (l < r && !isalnum((unsigned char)s[r])) {                  @skipR
            r--;                                                          @decR
        }
        if (tolower((unsigned char)s[l]) != tolower((unsigned char)s[r])) {   @cmp
            return false;                                                 @fail
        }
        l++; r--;                                                         @move
    }
    return true;                                                          @ok
}
`,
    distractors: [
      {
        java: '        if (!Character.isLetterOrDigit(s.charAt(l))) {\n            l++;',
        cpp: '        if (!isalnum((unsigned char)s[l])) {\n            l++;',
      },
      { java: '        if (s.charAt(l) != s.charAt(r)) {', cpp: '        if (s[l] != s[r]) {' },
      { java: '    while (l <= r) {', cpp: '    while (l <= r) {' },
    ],
    gotchas: {
      java: ['`Character.isLetterOrDigit` also accepts non-ASCII letters (é, 字); fine for LeetCode\'s ASCII input, but not the same as a strict `[a-zA-Z0-9]` check.'],
      cpp: [
        '`s.size() - 1` is unsigned: on an empty string it wraps to a huge number, so cast with `(int)s.size() - 1`.',
        'Pass `(unsigned char)` to `isalnum`/`tolower` — a negative `char` (non-ASCII byte) is undefined behaviour.',
      ],
    },
  },

  'two-sum-ii-input-array-is-sorted': {
    java: `
public int[] twoSum(int[] numbers, int target) {
    int l = 0, r = numbers.length - 1;              @init
    while (l < r) {                                 @loop
        int cur = numbers[l] + numbers[r];          @sum
        if (cur > target) {                         @gt
            r--;                                    @decR
        } else if (cur < target) {                  @lt
            l++;                                    @incL
        } else {
            return new int[] { l + 1, r + 1 };      @found
        }
    }
    return new int[0];
}
`,
    cpp: `
vector<int> twoSum(vector<int>& numbers, int target) {
    int l = 0, r = (int)numbers.size() - 1;         @init
    while (l < r) {                                 @loop
        int cur = numbers[l] + numbers[r];          @sum
        if (cur > target) {                         @gt
            r--;                                    @decR
        } else if (cur < target) {                  @lt
            l++;                                    @incL
        } else {
            return { l + 1, r + 1 };                @found
        }
    }
    return {};
}
`,
    distractors: [
      { java: '        if (cur > target) {\n            l++;', cpp: '        if (cur > target) {\n            l++;' },
      { java: '            return new int[] { l, r };', cpp: '            return { l, r };' },
      { java: '    while (l <= r) {', cpp: '    while (l <= r) {' },
    ],
    gotchas: {
      java: ['`numbers[l] + numbers[r]` can overflow `int` for values near ±2³¹ — LeetCode\'s bounds are small, but use `long cur` if they are not.'],
      cpp: ['Signed `int` overflow in `numbers[l] + numbers[r]` is undefined behaviour in C++ — widen to `long long` when values can be large.'],
    },
  },

  '3sum': {
    java: `
public List<List<Integer>> threeSum(int[] nums) {
    List<List<Integer>> res = new ArrayList<>();                @init
    Arrays.sort(nums);                                          @sort
    for (int i = 0; i < nums.length; i++) {                     @loop
        int a = nums[i];
        if (a > 0) {                                            @pos
            break;
        }
        if (i > 0 && a == nums[i - 1]) {                        @dupA
            continue;
        }
        int l = i + 1, r = nums.length - 1;                     @lr
        while (l < r) {                                         @while
            int s = a + nums[l] + nums[r];                      @sum
            if (s > 0) {                                        @gt
                r--;                                            @decR
            } else if (s < 0) {                                 @lt
                l++;                                            @incL
            } else {
                res.add(Arrays.asList(a, nums[l], nums[r]));    @found
                l++;                                            @next
                while (l < r && nums[l] == nums[l - 1]) {       @dupL
                    l++;                                        @skipL
                }
            }
        }
    }
    return res;                                                 @done
}
`,
    cpp: `
vector<vector<int>> threeSum(vector<int>& nums) {
    vector<vector<int>> res;                                    @init
    sort(nums.begin(), nums.end());                             @sort
    for (int i = 0; i < (int)nums.size(); i++) {                @loop
        int a = nums[i];
        if (a > 0) {                                            @pos
            break;
        }
        if (i > 0 && a == nums[i - 1]) {                        @dupA
            continue;
        }
        int l = i + 1, r = (int)nums.size() - 1;                @lr
        while (l < r) {                                         @while
            int s = a + nums[l] + nums[r];                      @sum
            if (s > 0) {                                        @gt
                r--;                                            @decR
            } else if (s < 0) {                                 @lt
                l++;                                            @incL
            } else {
                res.push_back({a, nums[l], nums[r]});           @found
                l++;                                            @next
                while (l < r && nums[l] == nums[l - 1]) {       @dupL
                    l++;                                        @skipL
                }
            }
        }
    }
    return res;                                                 @done
}
`,
    distractors: [
      { java: '        if (a == nums[i + 1]) {\n            continue;', cpp: '        if (a == nums[i + 1]) {\n            continue;' },
      {
        java: '                res.add(Arrays.asList(a, nums[l], nums[r]));\n                break;',
        cpp: '                res.push_back({a, nums[l], nums[r]});\n                break;',
      },
      { java: '        int l = 0, r = nums.length - 1;', cpp: '        int l = 0, r = (int)nums.size() - 1;' },
    ],
    gotchas: {
      java: ['`Arrays.asList(a, nums[l], nums[r])` returns a fixed-size list backed by an array — fine for the answer, but `add` on it throws `UnsupportedOperationException`.'],
      cpp: ['Reading past the end (`nums[i + 1]`, `nums[l]` with `l == n`) is silent undefined behaviour, not an exception — keep the `l < r` guard first in the skip loop.'],
    },
  },

  'container-with-most-water': {
    java: `
public int maxArea(int[] height) {
    int l = 0, r = height.length - 1;                           @init
    int res = 0;                                                @res0
    while (l < r) {                                             @loop
        int area = (r - l) * Math.min(height[l], height[r]);    @area
        res = Math.max(res, area);                              @best
        if (height[l] < height[r]) {                            @cmp
            l++;                                                @incL
        } else {
            r--;                                                @decR
        }
    }
    return res;                                                 @done
}
`,
    cpp: `
int maxArea(vector<int>& height) {
    int l = 0, r = (int)height.size() - 1;                      @init
    int res = 0;                                                @res0
    while (l < r) {                                             @loop
        int area = (r - l) * min(height[l], height[r]);         @area
        res = max(res, area);                                   @best
        if (height[l] < height[r]) {                            @cmp
            l++;                                                @incL
        } else {
            r--;                                                @decR
        }
    }
    return res;                                                 @done
}
`,
    distractors: [
      { java: '        if (height[l] > height[r]) {\n            l++;', cpp: '        if (height[l] > height[r]) {\n            l++;' },
      { java: '        int area = (r - l) * Math.max(height[l], height[r]);', cpp: '        int area = (r - l) * max(height[l], height[r]);' },
      { java: '        int area = (r - l + 1) * Math.min(height[l], height[r]);', cpp: '        int area = (r - l + 1) * min(height[l], height[r]);' },
    ],
    gotchas: {
      java: ['Width × height stays below 10⁵ × 10⁴ = 10⁹, so `int` is safe here; with larger bounds compute the area as `long`.'],
      cpp: ['`std::min`/`std::max` need both arguments of the same type — `min(height[l], 5L)` does not compile; cast first.'],
    },
  },

  'trapping-rain-water': {
    java: `
public int trap(int[] height) {
    if (height.length == 0) {                               @empty
        return 0;
    }
    int l = 0, r = height.length - 1;                       @init
    int leftMax = height[l], rightMax = height[r];          @max0
    int res = 0;                                            @res0
    while (l < r) {                                         @loop
        if (leftMax < rightMax) {                           @cmp
            l++;                                            @incL
            leftMax = Math.max(leftMax, height[l]);         @lmax
            res += leftMax - height[l];                     @addL
        } else {
            r--;                                            @decR
            rightMax = Math.max(rightMax, height[r]);       @rmax
            res += rightMax - height[r];                    @addR
        }
    }
    return res;                                             @done
}
`,
    cpp: `
int trap(vector<int>& height) {
    if (height.empty()) {                                   @empty
        return 0;
    }
    int l = 0, r = (int)height.size() - 1;                  @init
    int leftMax = height[l], rightMax = height[r];          @max0
    int res = 0;                                            @res0
    while (l < r) {                                         @loop
        if (leftMax < rightMax) {                           @cmp
            l++;                                            @incL
            leftMax = max(leftMax, height[l]);              @lmax
            res += leftMax - height[l];                     @addL
        } else {
            r--;                                            @decR
            rightMax = max(rightMax, height[r]);            @rmax
            res += rightMax - height[r];                    @addR
        }
    }
    return res;                                             @done
}
`,
    distractors: [
      {
        java: '            res += leftMax - height[l];\n            leftMax = Math.max(leftMax, height[l]);',
        cpp: '            res += leftMax - height[l];\n            leftMax = max(leftMax, height[l]);',
      },
      { java: '        if (leftMax > rightMax) {\n            l++;', cpp: '        if (leftMax > rightMax) {\n            l++;' },
      { java: '            res += Math.min(leftMax, rightMax);', cpp: '            res += min(leftMax, rightMax);' },
    ],
    gotchas: {
      java: ['Without the empty check `height[0]` throws `ArrayIndexOutOfBoundsException` on `[]`.'],
      cpp: ['Without the empty check `height[0]` on an empty vector is undefined behaviour (no exception) — and `size() - 1` would wrap around.'],
    },
  },
};
