import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the sliding-window problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'best-time-to-buy-and-sell-stock': {
    java: `
public int maxProfit(int[] prices) {
    int l = 0, r = 1;                                       @init
    int maxP = 0;                                           @zero
    while (r < prices.length) {                             @loop
        if (prices[l] < prices[r]) {                        @cmp
            maxP = Math.max(maxP, prices[r] - prices[l]);   @profit
        } else {
            l = r;                                          @jump
        }
        r++;                                                @next
    }
    return maxP;                                            @done
}
`,
    cpp: `
int maxProfit(vector<int>& prices) {
    int l = 0, r = 1;                                       @init
    int maxP = 0;                                           @zero
    while (r < (int)prices.size()) {                        @loop
        if (prices[l] < prices[r]) {                        @cmp
            maxP = max(maxP, prices[r] - prices[l]);        @profit
        } else {
            l = r;                                          @jump
        }
        r++;                                                @next
    }
    return maxP;                                            @done
}
`,
    distractors: [
      {
        java: '    return Arrays.stream(prices).max().getAsInt() - Arrays.stream(prices).min().getAsInt();',
        cpp: '    return *max_element(prices.begin(), prices.end()) - *min_element(prices.begin(), prices.end());',
      },
      { java: '            l++;', cpp: '            l++;' },
      { java: '    int l = 0, r = 0;', cpp: '    int l = 0, r = 0;' },
    ],
    gotchas: {
      java: ['`Arrays.stream(prices).max()` returns an `OptionalInt`; `getAsInt()` throws on an empty array — the two-pointer loop simply returns 0.'],
      cpp: ['`r < prices.size()` compares a signed `int` with an unsigned `size_t`; cast with `(int)prices.size()` to avoid sign-compare surprises.'],
    },
  },

  'longest-substring-without-repeating-characters': {
    java: `
public int lengthOfLongestSubstring(String s) {
    Set<Character> charSet = new HashSet<>();       @init
    int l = 0;                                      @l0
    int res = 0;                                    @res0
    for (int r = 0; r < s.length(); r++) {          @loop
        while (charSet.contains(s.charAt(r))) {     @dup
            charSet.remove(s.charAt(l));            @remove
            l++;                                    @shrink
        }
        charSet.add(s.charAt(r));                   @add
        res = Math.max(res, r - l + 1);             @best
    }
    return res;                                     @done
}
`,
    cpp: `
int lengthOfLongestSubstring(string s) {
    unordered_set<char> charSet;                    @init
    int l = 0;                                      @l0
    int res = 0;                                    @res0
    for (int r = 0; r < (int)s.size(); r++) {       @loop
        while (charSet.count(s[r])) {               @dup
            charSet.erase(s[l]);                    @remove
            l++;                                    @shrink
        }
        charSet.insert(s[r]);                       @add
        res = max(res, r - l + 1);                  @best
    }
    return res;                                     @done
}
`,
    distractors: [
      { java: '        if (charSet.contains(s.charAt(r))) {', cpp: '        if (charSet.count(s[r])) {' },
      { java: '            l = r;', cpp: '            l = r;' },
      { java: '        res = Math.max(res, r - l);', cpp: '        res = max(res, r - l);' },
    ],
    gotchas: {
      java: ['`charSet.remove(s.charAt(l))` autoboxes to `Character` and removes by value — but on a `List<Integer>`, `remove(int)` removes by INDEX.'],
      cpp: ['`charSet.erase(s[l])` erases by key and returns how many were removed; `erase(iterator)` is the other overload — don\'t pass `find()` without checking `!= end()`.'],
    },
  },

  'longest-repeating-character-replacement': {
    java: `
public int characterReplacement(String s, int k) {
    Map<Character, Integer> count = new HashMap<>();        @init
    int res = 0;                                            @res0
    int l = 0;                                              @l0
    int maxf = 0;                                           @maxf0
    for (int r = 0; r < s.length(); r++) {                  @loop
        count.merge(s.charAt(r), 1, Integer::sum);          @inc
        maxf = Math.max(maxf, count.get(s.charAt(r)));      @maxf
        while ((r - l + 1) - maxf > k) {                    @check
            count.merge(s.charAt(l), -1, Integer::sum);     @dec
            l++;                                            @shrink
        }
        res = Math.max(res, r - l + 1);                     @best
    }
    return res;                                             @done
}
`,
    cpp: `
int characterReplacement(string s, int k) {
    unordered_map<char, int> count;                         @init
    int res = 0;                                            @res0
    int l = 0;                                              @l0
    int maxf = 0;                                           @maxf0
    for (int r = 0; r < (int)s.size(); r++) {               @loop
        count[s[r]]++;                                      @inc
        maxf = max(maxf, count[s[r]]);                      @maxf
        while ((r - l + 1) - maxf > k) {                    @check
            count[s[l]]--;                                  @dec
            l++;                                            @shrink
        }
        res = max(res, r - l + 1);                          @best
    }
    return res;                                             @done
}
`,
    distractors: [
      { java: '        while ((r - l + 1) - maxf >= k) {', cpp: '        while ((r - l + 1) - maxf >= k) {' },
      { java: '        if (count.get(s.charAt(r)) > k) {', cpp: '        if (count[s[r]] > k) {' },
      { java: '            l = r;', cpp: '            l = r;' },
    ],
    gotchas: {
      java: ['Input is uppercase only, so `int[] count = new int[26]` indexed by `s.charAt(r) - \'A\'` avoids boxing on every step.'],
      cpp: ['`count[s[r]]++` value-initialises a missing key to 0, so there is no need for Python\'s `count.get(c, 0)`.'],
    },
  },

  'permutation-in-string': {
    java: `
public boolean checkInclusion(String s1, String s2) {
    if (s1.length() > s2.length()) {                                                     @short
        return false;                                                                    @noRoom
    }
    Map<Character, Integer> need = new HashMap<>(), window = new HashMap<>();
    for (char c : s1.toCharArray()) need.merge(c, 1, Integer::sum);                      @need
    for (int i = 0; i < s1.length(); i++) window.merge(s2.charAt(i), 1, Integer::sum);   @first
    if (window.equals(need)) {                                                           @eq0
        return true;                                                                     @hit0
    }
    for (int r = s1.length(); r < s2.length(); r++) {                                    @loop
        window.merge(s2.charAt(r), 1, Integer::sum);                                     @add
        int l = r - s1.length();                                                         @l
        window.merge(s2.charAt(l), -1, Integer::sum);                                    @drop
        if (window.get(s2.charAt(l)) == 0) {                                             @zero
            window.remove(s2.charAt(l));                                                 @del
        }
        if (window.equals(need)) {                                                       @eq
            return true;                                                                 @hit
        }
    }
    return false;                                                                        @none
}
`,
    cpp: `
bool checkInclusion(string s1, string s2) {
    if (s1.size() > s2.size()) {                                                         @short
        return false;                                                                    @noRoom
    }
    unordered_map<char, int> need, window;
    for (char c : s1) need[c]++;                                                         @need
    for (int i = 0; i < (int)s1.size(); i++) window[s2[i]]++;                            @first
    if (window == need) {                                                                @eq0
        return true;                                                                     @hit0
    }
    for (int r = (int)s1.size(); r < (int)s2.size(); r++) {                              @loop
        window[s2[r]]++;                                                                 @add
        int l = r - (int)s1.size();                                                      @l
        window[s2[l]]--;                                                                 @drop
        if (window[s2[l]] == 0) {                                                        @zero
            window.erase(s2[l]);                                                         @del
        }
        if (window == need) {                                                            @eq
            return true;                                                                 @hit
        }
    }
    return false;                                                                        @none
}
`,
    distractors: [
      {
        java: '        window = new HashMap<>(); for (char c : s2.substring(r - s1.length() + 1, r + 1).toCharArray()) window.merge(c, 1, Integer::sum);',
        cpp: '        window.clear(); for (char c : s2.substr(r - s1.size() + 1, s1.size())) window[c]++;',
      },
      { java: '        int l = r - s1.length() + 1;', cpp: '        int l = r - (int)s1.size() + 1;' },
      {
        java: '        if (Arrays.equals(s2.substring(l, r).chars().sorted().toArray(), s1.chars().sorted().toArray())) {',
        cpp: '        string a = s2.substr(l, r - l), b = s1; sort(a.begin(), a.end()); sort(b.begin(), b.end()); if (a == b) {',
      },
    ],
    gotchas: {
      python: ['Since Python 3.10 `Counter` equality treats missing keys as 0, but deleting zero counts keeps it correct on every version.'],
      java: ['`Map.equals` compares values with `.equals`, but a leftover key with count 0 still makes the maps unequal — remove it.'],
      cpp: ['`unordered_map ==` compares every key/value pair, so a zero-count key left behind breaks equality — `erase` it.'],
    },
  },

  'minimum-window-substring': {
    java: `
public String minWindow(String s, String t) {
    if (t.isEmpty()) {                                                  @empty
        return "";
    }
    Map<Character, Integer> countT = new HashMap<>(), window = new HashMap<>();   @init
    for (char c : t.toCharArray()) countT.merge(c, 1, Integer::sum);
    int have = 0, need = countT.size();                                 @hn
    int[] res = { -1, -1 }; int resLen = Integer.MAX_VALUE;             @res0
    int l = 0;                                                          @l0
    for (int r = 0; r < s.length(); r++) {                              @loop
        char c = s.charAt(r);
        window.merge(c, 1, Integer::sum);                               @add
        if (countT.containsKey(c) && window.get(c).equals(countT.get(c))) {   @gain
            have++;                                                     @have
        }
        while (have == need) {                                          @valid
            if ((r - l + 1) < resLen) {                                 @better
                res = new int[] { l, r }; resLen = r - l + 1;           @save
            }
            window.merge(s.charAt(l), -1, Integer::sum);                @drop
            if (countT.containsKey(s.charAt(l)) && window.get(s.charAt(l)) < countT.get(s.charAt(l))) {   @lose
                have--;                                                 @haveDec
            }
            l++;                                                        @shrink
        }
    }
    l = res[0]; int r = res[1];                                         @unpack
    return resLen != Integer.MAX_VALUE ? s.substring(l, r + 1) : "";    @ret
}
`,
    cpp: `
string minWindow(string s, string t) {
    if (t.empty()) {                                                    @empty
        return "";
    }
    unordered_map<char, int> countT, window;                            @init
    for (char c : t) countT[c]++;
    int have = 0, need = (int)countT.size();                            @hn
    pair<int, int> res = {-1, -1}; int resLen = INT_MAX;                @res0
    int l = 0;                                                          @l0
    for (int r = 0; r < (int)s.size(); r++) {                           @loop
        char c = s[r];
        window[c]++;                                                    @add
        if (countT.count(c) && window[c] == countT[c]) {                @gain
            have++;                                                     @have
        }
        while (have == need) {                                          @valid
            if ((r - l + 1) < resLen) {                                 @better
                res = {l, r}; resLen = r - l + 1;                       @save
            }
            window[s[l]]--;                                             @drop
            if (countT.count(s[l]) && window[s[l]] < countT[s[l]]) {    @lose
                have--;                                                 @haveDec
            }
            l++;                                                        @shrink
        }
    }
    l = res.first; int r = res.second;                                  @unpack
    return resLen != INT_MAX ? s.substr(l, r - l + 1) : "";             @ret
}
`,
    distractors: [
      {
        java: '        if (countT.containsKey(c) && window.get(c) >= countT.get(c)) {',
        cpp: '        if (countT.count(c) && window[c] >= countT[c]) {',
      },
      { java: '        if (have == need) {', cpp: '        if (have == need) {' },
      {
        java: '            l++;\n            window.merge(s.charAt(l), -1, Integer::sum);',
        cpp: '            l++;\n            window[s[l]]--;',
      },
    ],
    gotchas: {
      java: ['`window.get(c) == countT.get(c)` compares two `Integer` objects by reference and fails for counts above 127 — use `.equals` (or unbox one side).'],
      cpp: [
        '`countT[c]` on a missing key inserts it — check `countT.count(c)` first so the map (and `need`) stays unchanged.',
        '`s.substr(l, len)` takes a length, so the window `[l, r]` is `s.substr(l, r - l + 1)`.',
      ],
    },
  },

  'sliding-window-maximum': {
    java: `
public int[] maxSlidingWindow(int[] nums, int k) {
    int[] output = new int[nums.length - k + 1];                        @init
    Deque<Integer> q = new ArrayDeque<>();                              @dq
    int l = 0, r = 0;                                                   @lr
    while (r < nums.length) {                                           @loop
        while (!q.isEmpty() && nums[q.peekLast()] < nums[r]) {          @popBack
            q.pollLast();                                               @pop
        }
        q.offerLast(r);                                                 @push
        if (l > q.peekFirst()) {                                        @stale
            q.pollFirst();                                              @popFront
        }
        if ((r + 1) >= k) {                                             @full
            output[l] = nums[q.peekFirst()];                            @emit
            l++;                                                        @slide
        }
        r++;                                                            @next
    }
    return output;                                                      @done
}
`,
    cpp: `
vector<int> maxSlidingWindow(vector<int>& nums, int k) {
    vector<int> output;                                                 @init
    deque<int> q;                                                       @dq
    int l = 0, r = 0;                                                   @lr
    while (r < (int)nums.size()) {                                      @loop
        while (!q.empty() && nums[q.back()] < nums[r]) {                @popBack
            q.pop_back();                                               @pop
        }
        q.push_back(r);                                                 @push
        if (l > q.front()) {                                            @stale
            q.pop_front();                                              @popFront
        }
        if ((r + 1) >= k) {                                             @full
            output.push_back(nums[q.front()]);                          @emit
            l++;                                                        @slide
        }
        r++;                                                            @next
    }
    return output;                                                      @done
}
`,
    distractors: [
      {
        java: '        output[l] = Arrays.stream(nums, l, r + 1).max().getAsInt();',
        cpp: '        output.push_back(*max_element(nums.begin() + l, nums.begin() + r + 1));',
      },
      {
        java: '        while (!q.isEmpty() && nums[q.peekLast()] > nums[r]) {',
        cpp: '        while (!q.empty() && nums[q.back()] > nums[r]) {',
      },
      { java: '        q.offerLast(nums[r]);', cpp: '        q.push_back(nums[r]);' },
    ],
    gotchas: {
      java: ['Use `ArrayDeque` (`peekLast`/`pollLast`/`peekFirst`/`pollFirst`), not `Stack`; `peekFirst()` returns `null` on an empty deque and unboxing it throws `NullPointerException`.'],
      cpp: ['`q.front()` / `q.back()` on an empty `deque` is undefined behaviour — always test `!q.empty()` first.'],
    },
  },
};
