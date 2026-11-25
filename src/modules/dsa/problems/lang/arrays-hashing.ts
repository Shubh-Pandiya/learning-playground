import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the arrays-hashing problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'two-sum': {
    java: `
public int[] twoSum(int[] nums, int target) {
    Map<Integer, Integer> seen = new HashMap<>();        @init
    for (int i = 0; i < nums.length; i++) {               @loop
        int n = nums[i];
        int diff = target - n;                            @diff
        if (seen.containsKey(diff)) {                     @check
            return new int[] { seen.get(diff), i };       @found
        }
        seen.put(n, i);                                   @store
    }
    return new int[0];
}
`,
    cpp: `
vector<int> twoSum(vector<int>& nums, int target) {
    unordered_map<int, int> seen;                         @init
    for (int i = 0; i < (int)nums.size(); i++) {          @loop
        int n = nums[i];
        int diff = target - n;                            @diff
        if (seen.count(diff)) {                           @check
            return { seen[diff], i };                     @found
        }
        seen[n] = i;                                      @store
    }
    return {};
}
`,
    distractors: [
      { java: '        for (int j = i + 1; j < nums.length; j++) {', cpp: '        for (int j = i + 1; j < (int)nums.size(); j++) {' },
      { java: '    Arrays.sort(nums);', cpp: '    sort(nums.begin(), nums.end());' },
    ],
    gotchas: {
      java: ['`seen.get(diff)` returns an `Integer`; comparing two boxed Integers with `==` only works for −128…127 (Integer cache) — use `.equals` or unbox to `int`.'],
      cpp: ['`seen[diff]` on a missing key silently INSERTS 0 — test membership with `count` / `find` before indexing.'],
    },
  },

  'top-k-frequent-elements': {
    java: `
public int[] topKFrequent(int[] nums, int k) {
    Map<Integer, Integer> count = new HashMap<>();                   @init
    for (int n : nums) {                                              @countLoop
        count.merge(n, 1, Integer::sum);                              @inc
    }
    List<List<Integer>> freq = new ArrayList<>();                     @buckets
    for (int i = 0; i <= nums.length; i++) freq.add(new ArrayList<>());
    for (Map.Entry<Integer, Integer> e : count.entrySet()) {          @fillLoop
        freq.get(e.getValue()).add(e.getKey());                       @fill
    }
    List<Integer> res = new ArrayList<>();                            @res
    for (int c = freq.size() - 1; c > 0; c--) {                       @scan
        for (int n : freq.get(c)) {                                   @each
            res.add(n);                                               @take
            if (res.size() == k) {                                    @check
                return res.stream().mapToInt(Integer::intValue).toArray();  @done
            }
        }
    }
    return new int[0];
}
`,
    cpp: `
vector<int> topKFrequent(vector<int>& nums, int k) {
    unordered_map<int, int> count;                                    @init
    for (int n : nums) {                                              @countLoop
        count[n]++;                                                   @inc
    }
    vector<vector<int>> freq(nums.size() + 1);                        @buckets
    for (auto& [n, c] : count) {                                      @fillLoop
        freq[c].push_back(n);                                         @fill
    }
    vector<int> res;                                                  @res
    for (int c = (int)freq.size() - 1; c > 0; c--) {                  @scan
        for (int n : freq[c]) {                                       @each
            res.push_back(n);                                         @take
            if ((int)res.size() == k) {                               @check
                return res;                                           @done
            }
        }
    }
    return res;
}
`,
    distractors: [
      {
        java: '    List<Integer> freq = new ArrayList<>(count.keySet()); freq.sort((a, b) -> count.get(a) - count.get(b));',
        cpp: '    sort(nums.begin(), nums.end(), [&](int a, int b) { return count[a] < count[b]; });',
      },
      { java: '    for (int c = 1; c < freq.size(); c++) {', cpp: '    for (int c = 1; c < (int)freq.size(); c++) {' },
    ],
    gotchas: {
      python: ['The heap alternative needs `heapq.nlargest(k, count, key=count.get)` — plain `heapq` is a MIN-heap.'],
      java: ['`count.merge(n, 1, Integer::sum)` is the idiomatic counter; `PriorityQueue` is a MIN-heap unless you pass a comparator.'],
      cpp: ['`count[n]++` value-initialises missing keys to 0, so counting needs no existence check. `priority_queue` is a MAX-heap by default.'],
    },
  },

  'contains-duplicate': {
    java: `
public boolean containsDuplicate(int[] nums) {
    Set<Integer> seen = new HashSet<>();     @init
    for (int n : nums) {                     @loop
        if (seen.contains(n)) {              @check
            return true;                     @found
        }
        seen.add(n);                         @add
    }
    return false;                            @none
}
`,
    cpp: `
bool containsDuplicate(vector<int>& nums) {
    unordered_set<int> seen;                 @init
    for (int n : nums) {                     @loop
        if (seen.count(n)) {                 @check
            return true;                     @found
        }
        seen.insert(n);                      @add
    }
    return false;                            @none
}
`,
    distractors: [
      { java: '        if (Collections.frequency(Arrays.asList(nums), n) > 1) {', cpp: '        if (count(nums.begin(), nums.end(), n) > 1) {' },
      { java: '    List<Integer> seen = new ArrayList<>();', cpp: '    vector<int> seen;' },
      { java: '        seen.add(n);\n        if (seen.contains(n)) {', cpp: '        seen.insert(n);\n        if (seen.count(n)) {' },
    ],
    gotchas: {
      java: ['`Set.add` returns false when the element was already present — `if (!seen.add(n)) return true;` is a common one-liner.'],
      cpp: ['`unordered_set::insert` returns `{iterator, bool}` — `.second` is false for a duplicate.'],
    },
  },

  'valid-anagram': {
    java: `
public boolean isAnagram(String s, String t) {
    if (s.length() != t.length()) {                     @len
        return false;                                   @lenFail
    }
    Map<Character, Integer> count = new HashMap<>();    @init
    for (int i = 0; i < s.length(); i++) {              @loop
        count.merge(s.charAt(i), 1, Integer::sum);      @inc
        count.merge(t.charAt(i), -1, Integer::sum);     @dec
    }
    for (int c : count.values()) {                      @scan
        if (c != 0) {                                   @check
            return false;                               @fail
        }
    }
    return true;                                        @ok
}
`,
    cpp: `
bool isAnagram(string s, string t) {
    if (s.size() != t.size()) {                         @len
        return false;                                   @lenFail
    }
    unordered_map<char, int> count;                     @init
    for (int i = 0; i < (int)s.size(); i++) {           @loop
        count[s[i]]++;                                  @inc
        count[t[i]]--;                                  @dec
    }
    for (auto& [ch, c] : count) {                       @scan
        if (c != 0) {                                   @check
            return false;                               @fail
        }
    }
    return true;                                        @ok
}
`,
    distractors: [
      { java: '        if (s.indexOf(t.charAt(i)) == -1) {', cpp: '        if (s.find(t[i]) == string::npos) {' },
      {
        java: '    return s.chars().boxed().collect(Collectors.toSet()).equals(t.chars().boxed().collect(Collectors.toSet()));',
        cpp: '    return set<char>(s.begin(), s.end()) == set<char>(t.begin(), t.end());',
      },
      { java: '        count.merge(t.charAt(i), 1, Integer::sum);', cpp: '        count[t[i]]++;' },
    ],
    gotchas: {
      python: ['`Counter(s) == Counter(t)` is the idiomatic one-liner; it does the same O(n) counting.'],
      java: ['For lowercase-only input an `int[26]` indexed by `c - \'a\'` avoids boxing every `char` into a `Character` key.'],
      cpp: ['`count[t[i]]--` on a missing key first inserts 0 and then makes it −1 — exactly what we want here, no existence check needed.'],
    },
  },

  'group-anagrams': {
    java: `
public List<List<String>> groupAnagrams(String[] strs) {
    Map<String, List<String>> res = new HashMap<>();                          @init
    for (String s : strs) {                                                   @loop
        int[] count = new int[26];                                            @zero
        for (char c : s.toCharArray()) {                                      @charLoop
            count[c - 'a']++;                                                 @inc
        }
        res.computeIfAbsent(Arrays.toString(count), k -> new ArrayList<>()).add(s);   @group
    }
    return new ArrayList<>(res.values());                                     @done
}
`,
    cpp: `
vector<vector<string>> groupAnagrams(vector<string>& strs) {
    unordered_map<string, vector<string>> res;                                @init
    for (string& s : strs) {                                                  @loop
        vector<int> count(26, 0);                                             @zero
        for (char c : s) {                                                    @charLoop
            count[c - 'a']++;                                                 @inc
        }
        string key;
        for (int x : count) key += to_string(x) + ",";
        res[key].push_back(s);                                                @group
    }
    vector<vector<string>> out;
    for (auto& [key, group] : res) out.push_back(group);
    return out;                                                               @done
}
`,
    distractors: [
      { java: '        res.computeIfAbsent(count, k -> new ArrayList<>()).add(s);', cpp: '        res[count].push_back(s);' },
      { java: '    int[] count = new int[26];', cpp: '    vector<int> count(26, 0);' },
      {
        java: '        res.computeIfAbsent(String.valueOf(s.length()), k -> new ArrayList<>()).add(s);',
        cpp: '        res[to_string(s.size())].push_back(s);',
      },
    ],
    gotchas: {
      python: ['Lists are unhashable, so the histogram must become a `tuple(count)` before it can be a dict key.'],
      java: ['Arrays use identity `hashCode`/`equals`, so an `int[]` key never matches another word\'s histogram — key on `Arrays.toString(count)` instead.'],
      cpp: ['`unordered_map` has no `std::hash` for `vector<int>`, so serialise the counts into a string key (or use an ordered `map<vector<int>, …>`).'],
    },
  },

  'encode-and-decode-strings': {
    java: `
public String encode(List<String> strs) {
    StringBuilder res = new StringBuilder();                    @eInit
    for (String s : strs) {                                     @eLoop
        res.append(s.length()).append('#').append(s);           @eAppend
    }
    return res.toString();                                      @eDone
}

public List<String> decode(String s) {
    List<String> res = new ArrayList<>(); int i = 0;            @dInit
    while (i < s.length()) {                                    @dLoop
        int j = i;                                              @dJ
        while (s.charAt(j) != '#') {                            @scanLen
            j++;                                                @adv
        }
        int length = Integer.parseInt(s.substring(i, j));       @len
        res.add(s.substring(j + 1, j + 1 + length));            @take
        i = j + 1 + length;                                     @jump
    }
    return res;                                                 @dDone
}
`,
    cpp: `
string encode(vector<string>& strs) {
    string res;                                                 @eInit
    for (string& s : strs) {                                    @eLoop
        res += to_string(s.size()) + "#" + s;                   @eAppend
    }
    return res;                                                 @eDone
}

vector<string> decode(string s) {
    vector<string> res; int i = 0;                              @dInit
    while (i < (int)s.size()) {                                 @dLoop
        int j = i;                                              @dJ
        while (s[j] != '#') {                                   @scanLen
            j++;                                                @adv
        }
        int length = stoi(s.substr(i, j - i));                  @len
        res.push_back(s.substr(j + 1, length));                 @take
        i = j + 1 + length;                                     @jump
    }
    return res;                                                 @dDone
}
`,
    distractors: [
      {
        java: '    return Arrays.asList(s.split("#"));',
        cpp: '    stringstream ss(s); string part; while (getline(ss, part, \'#\')) res.push_back(part);',
      },
      { java: '        res.append(s).append(\'#\');', cpp: '        res += s + "#";' },
      { java: '        i = j + length;', cpp: '        i = j + length;' },
    ],
    gotchas: {
      python: ['`res += ...` in a loop can copy the whole string each time; `"".join(parts)` guarantees linear time.'],
      java: ['`String +=` in a loop is O(n²) — build with a `StringBuilder`. `substring(begin, end)` takes an END index.'],
      cpp: ['`substr(pos, count)` takes a LENGTH, not an end index — `s.substr(i, j - i)`, not `s.substr(i, j)`.'],
    },
  },

  'product-of-array-except-self': {
    java: `
public int[] productExceptSelf(int[] nums) {
    int[] res = new int[nums.length];                   @init
    int prefix = 1;                                     @pre0
    for (int i = 0; i < nums.length; i++) {             @preLoop
        res[i] = prefix;                                @preSet
        prefix *= nums[i];                              @preMul
    }
    int suffix = 1;                                     @suf0
    for (int i = nums.length - 1; i >= 0; i--) {        @sufLoop
        res[i] *= suffix;                               @sufSet
        suffix *= nums[i];                              @sufMul
    }
    return res;                                         @done
}
`,
    cpp: `
vector<int> productExceptSelf(vector<int>& nums) {
    vector<int> res(nums.size(), 1);                    @init
    int prefix = 1;                                     @pre0
    for (int i = 0; i < (int)nums.size(); i++) {        @preLoop
        res[i] = prefix;                                @preSet
        prefix *= nums[i];                              @preMul
    }
    int suffix = 1;                                     @suf0
    for (int i = (int)nums.size() - 1; i >= 0; i--) {   @sufLoop
        res[i] *= suffix;                               @sufSet
        suffix *= nums[i];                              @sufMul
    }
    return res;                                         @done
}
`,
    distractors: [
      { java: '        res[i] = total / nums[i];', cpp: '        res[i] = total / nums[i];' },
      { java: '        prefix *= nums[i];\n        res[i] = prefix;', cpp: '        prefix *= nums[i];\n        res[i] = prefix;' },
      {
        java: '    for (int i = 0; i < nums.length; i++) {\n        res[i] *= suffix;',
        cpp: '    for (int i = 0; i < (int)nums.size(); i++) {\n        res[i] *= suffix;',
      },
    ],
    gotchas: {
      java: ['`new int[n]` is zero-filled, which is fine here only because the prefix pass assigns every `res[i]` before the suffix pass multiplies into it.'],
      cpp: ['A reverse loop with `size_t i = nums.size() - 1; i >= 0; i--` never ends (unsigned is always ≥ 0) — use a signed `int`.'],
    },
  },

  'valid-sudoku': {
    java: `
public boolean isValidSudoku(char[][] board) {
    Map<Integer, Set<Character>> rows = new HashMap<>(), cols = new HashMap<>();   @init
    Map<Integer, Set<Character>> boxes = new HashMap<>();
    for (int r = 0; r < 9; r++) {                                                  @rLoop
        for (int c = 0; c < 9; c++) {                                              @cLoop
            char v = board[r][c];
            if (v == '.') {                                                        @skip
                continue;
            }
            int box = (r / 3) * 3 + c / 3;                                         @box
            rows.computeIfAbsent(r, k -> new HashSet<>());
            cols.computeIfAbsent(c, k -> new HashSet<>());
            boxes.computeIfAbsent(box, k -> new HashSet<>());
            if (rows.get(r).contains(v) || cols.get(c).contains(v) || boxes.get(box).contains(v)) {   @check
                return false;                                                      @fail
            }
            rows.get(r).add(v);                                                    @add
            cols.get(c).add(v);
            boxes.get(box).add(v);
        }
    }
    return true;                                                                   @ok
}
`,
    cpp: `
bool isValidSudoku(vector<vector<char>>& board) {
    unordered_map<int, unordered_set<char>> rows, cols;                            @init
    unordered_map<int, unordered_set<char>> boxes;
    for (int r = 0; r < 9; r++) {                                                  @rLoop
        for (int c = 0; c < 9; c++) {                                              @cLoop
            char v = board[r][c];
            if (v == '.') {                                                        @skip
                continue;
            }
            int box = (r / 3) * 3 + c / 3;                                         @box
            if (rows[r].count(v) || cols[c].count(v) || boxes[box].count(v)) {     @check
                return false;                                                      @fail
            }
            rows[r].insert(v);                                                     @add
            cols[c].insert(v);
            boxes[box].insert(v);
        }
    }
    return true;                                                                   @ok
}
`,
    distractors: [
      { java: '            int box = r / 3 + c / 3;', cpp: '            int box = r / 3 + c / 3;' },
      {
        java: '            if (rows.get(r).contains(v) && cols.get(c).contains(v) && boxes.get(box).contains(v)) {',
        cpp: '            if (rows[r].count(v) && cols[c].count(v) && boxes[box].count(v)) {',
      },
      { java: '            int box = (r % 3) * 3 + c % 3;', cpp: '            int box = (r % 3) * 3 + c % 3;' },
    ],
    gotchas: {
      python: ['`(r // 3, c // 3)` uses floor division; `r / 3` would give a float and spread one box over many keys.'],
      java: ['Java has no `defaultdict` — `computeIfAbsent(key, k -> new HashSet<>())` creates the set on first use (`putIfAbsent(key, new HashSet<>())` allocates a set every call).'],
      cpp: ['`rows[r]` default-constructs an empty set on first access — the same behaviour as Python\'s `defaultdict(set)`.'],
    },
  },

  'longest-consecutive-sequence': {
    java: `
public int longestConsecutive(int[] nums) {
    Set<Integer> numSet = Arrays.stream(nums).boxed().collect(Collectors.toSet());   @init
    int longest = 0;                                    @zero
    for (int n : numSet) {                              @loop
        if (!numSet.contains(n - 1)) {                  @isStart
            int length = 1;                             @start
            while (numSet.contains(n + length)) {       @extend
                length++;                               @grow
            }
            longest = Math.max(longest, length);        @best
        }
    }
    return longest;                                     @done
}
`,
    cpp: `
int longestConsecutive(vector<int>& nums) {
    unordered_set<int> numSet(nums.begin(), nums.end());   @init
    int longest = 0;                                    @zero
    for (int n : numSet) {                              @loop
        if (!numSet.count(n - 1)) {                     @isStart
            int length = 1;                             @start
            while (numSet.count(n + length)) {          @extend
                length++;                               @grow
            }
            longest = max(longest, length);             @best
        }
    }
    return longest;                                     @done
}
`,
    distractors: [
      { java: '    Arrays.sort(nums);', cpp: '    sort(nums.begin(), nums.end());' },
      { java: '        if (!numSet.contains(n + 1)) {', cpp: '        if (!numSet.count(n + 1)) {' },
      {
        java: '            while (Arrays.stream(nums).anyMatch(x -> x == n + length)) {',
        cpp: '            while (find(nums.begin(), nums.end(), n + length) != nums.end()) {',
      },
    ],
    gotchas: {
      python: ['Loop over `numSet`, not `nums`: with many duplicate run starts, looping over `nums` re-walks the same run and can time out.'],
      java: ['`Set<Integer>` boxes every value; `contains(n - 1)` autoboxes the argument, so it works, but it is several times slower than a primitive array.'],
      cpp: ['`numSet.count(x)` returns 0 or 1 for an `unordered_set` — use it (or C++20 `contains`) instead of `find(...) != end()` for readability.'],
    },
  },
};
