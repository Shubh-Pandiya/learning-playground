import type { LangPack, PatternId } from '../engine/types.ts';

/**
 * Java / C++ versions of every pattern template (see Pattern.template in patterns.ts), the pattern's
 * builder distractors (same order as Pattern.distractors) and per-language gotchas.
 */
export const patternLangs: Partial<Record<PatternId, LangPack>> = {
  hashing: {
    java: `
public Answer solve(Item[] items) {
    Map<Key, Value> seen = new HashMap<>();     // key -> what you need later
    for (int i = 0; i < items.length; i++) {
        Key key = signature(items[i]);          // value, complement, sorted chars…
        if (seen.containsKey(key)) {            // O(1) question
            use(seen.get(key), i);
        }
        seen.put(key, update(seen.get(key), i));
    }
    return answer;
}
`,
    cpp: `
Answer solve(vector<Item>& items) {
    unordered_map<Key, Value> seen;             // key -> what you need later
    for (int i = 0; i < (int)items.size(); i++) {
        Key key = signature(items[i]);          // value, complement, sorted chars…
        if (seen.count(key)) {                  // O(1) question
            use(seen[key], i);
        }
        seen[key] = update(seen[key], i);
    }
    return answer;
}
`,
    distractors: [
      { java: '        for (int j = 0; j < items.length; j++) {', cpp: '        for (int j = 0; j < (int)items.size(); j++) {' },
      { java: '    List<Key> seen = new ArrayList<>();', cpp: '    vector<Key> seen;' },
    ],
    gotchas: {
      python: ['Lists are unhashable — use a tuple key such as `tuple(sorted(s))` or a 26-count `tuple(counts)`; `defaultdict(list)` / `Counter` save the "missing key" branch.'],
      java: [
        'Boxed `Integer` values are cached only for −128…127, so `map.get(a) == map.get(b)` is wrong for larger values — use `.equals` or unbox to `int`.',
        'An `int[]` / `char[]` key hashes by identity, not contents — convert to `new String(chars)` or `Arrays.toString(counts)` first.',
      ],
      cpp: [
        '`seen[key]` on a missing key silently INSERTS a default value — test with `count` / `find` before reading.',
        '`unordered_map<pair<int, int>, …>` does not compile (no `std::hash` for `pair`) — use `map`, or encode the pair into one `long long`.',
      ],
    },
  },

  'prefix-sum': {
    java: `
public int[] solve(int[] nums) {
    int[] res = new int[nums.length];
    int prefix = 1;
    for (int i = 0; i < nums.length; i++) {
        res[i] = prefix;            // aggregate of nums[0..i-1]
        prefix *= nums[i];
    }
    int suffix = 1;
    for (int i = nums.length - 1; i >= 0; i--) {
        res[i] *= suffix;           // aggregate of nums[i+1..]
        suffix *= nums[i];
    }
    return res;
}
`,
    cpp: `
vector<int> solve(vector<int>& nums) {
    vector<int> res(nums.size(), 1);
    int prefix = 1;
    for (int i = 0; i < (int)nums.size(); i++) {
        res[i] = prefix;            // aggregate of nums[0..i-1]
        prefix *= nums[i];
    }
    int suffix = 1;
    for (int i = (int)nums.size() - 1; i >= 0; i--) {
        res[i] *= suffix;           // aggregate of nums[i+1..]
        suffix *= nums[i];
    }
    return res;
}
`,
    distractors: [{ java: '        res[i] = total / nums[i];', cpp: '        res[i] = total / nums[i];' }],
    gotchas: {
      python: ['`itertools.accumulate(nums)` yields running sums in one call; prepend a 0 (`[0, *accumulate(nums)]`) so `pre[r + 1] - pre[l]` covers `nums[l..r]`.'],
      java: ['Running sums of many `int`s overflow silently — declare the prefix as `long`; for "subarray sum = k" seed the map with `count.put(0, 1)`.'],
      cpp: ['`accumulate(v.begin(), v.end(), 0)` sums in `int` because the init is `0` — pass `0LL` for a `long long` total; `partial_sum` builds the prefix array in place.'],
    },
  },

  'two-pointers': {
    java: `
public int[] solve(int[] nums, int target) {
    int l = 0, r = nums.length - 1;
    while (l < r) {
        int cur = combine(nums[l], nums[r]);
        if (cur == target) {
            return new int[] { l, r };
        } else if (cur < target) {
            l++;                    // need bigger -> drop the smallest
        } else {
            r--;                    // need smaller -> drop the largest
        }
    }
    return new int[0];
}
`,
    cpp: `
vector<int> solve(vector<int>& nums, int target) {
    int l = 0, r = (int)nums.size() - 1;
    while (l < r) {
        int cur = combine(nums[l], nums[r]);
        if (cur == target) {
            return { l, r };
        } else if (cur < target) {
            l++;                    // need bigger -> drop the smallest
        } else {
            r--;                    // need smaller -> drop the largest
        }
    }
    return {};
}
`,
    distractors: [{ java: '    while (l <= r) {', cpp: '    while (l <= r) {' }],
    gotchas: {
      python: ['`nums.sort()` sorts in place and returns `None` — `nums = nums.sort()` throws the list away; use `sorted(nums)` for a copy.'],
      java: ['`nums[l] + nums[r]` can overflow `int` near `Integer.MAX_VALUE` — compare `(long) nums[l] + nums[r]` with the target.'],
      cpp: ['`nums.size() - 1` is unsigned: on an empty vector it wraps to a huge number — cast first, `int r = (int)nums.size() - 1`.'],
    },
  },

  'sliding-window': {
    java: `
public int solve(String s) {
    Map<Character, Integer> state = new HashMap<>();
    int l = 0;
    int best = 0;
    for (int r = 0; r < s.length(); r++) {
        add(state, s.charAt(r));        // expand
        while (invalid(state)) {        // shrink until valid again
            remove(state, s.charAt(l));
            l++;
        }
        best = Math.max(best, r - l + 1);
    }
    return best;
}
`,
    cpp: `
int solve(string s) {
    unordered_map<char, int> state;
    int l = 0;
    int best = 0;
    for (int r = 0; r < (int)s.size(); r++) {
        add(state, s[r]);               // expand
        while (invalid(state)) {        // shrink until valid again
            remove(state, s[l]);
            l++;
        }
        best = max(best, r - l + 1);
    }
    return best;
}
`,
    distractors: [
      { java: '        if (invalid(state)) {', cpp: '        if (invalid(state)) {' },
      { java: '        l = r;', cpp: '        l = r;' },
    ],
    gotchas: {
      python: ['Decrementing a `Counter` to 0 keeps the key, so `len(state)` still counts it as a distinct char — `del state[c]` when the count hits 0.'],
      java: ['`state.merge(c, -1, Integer::sum)` leaves 0-count entries, so `state.size()` over-counts distinct keys — `remove` the key at 0, or use an `int[26]` / `int[128]` array.'],
      cpp: ['`state[c]--` leaves the key with value 0 and `state.size()` still counts it — `erase(c)` when it reaches 0, or use a fixed `int count[128] = {}` array.'],
    },
  },

  stack: {
    java: `
public boolean solve(String[] tokens) {
    Deque<String> stack = new ArrayDeque<>();
    for (String tok : tokens) {
        if (opens(tok)) {
            stack.push(tok);
        } else {
            if (stack.isEmpty() || !matches(stack.peek(), tok)) {
                return false;
            }
            stack.pop();
        }
    }
    return stack.isEmpty();
}
`,
    cpp: `
bool solve(vector<string>& tokens) {
    vector<string> stack;
    for (string& tok : tokens) {
        if (opens(tok)) {
            stack.push_back(tok);
        } else {
            if (stack.empty() || !matches(stack.back(), tok)) {
                return false;
            }
            stack.pop_back();
        }
    }
    return stack.empty();
}
`,
    distractors: [{ java: '            stack.removeLast();', cpp: '            stack.erase(stack.begin());' }],
    gotchas: {
      python: ['`list.pop()` is O(1) but `pop(0)` shifts every element (O(n)) and takes the OLDEST item; `stack[-1]` on an empty list raises `IndexError`, so test `if stack` first.'],
      java: ['Use `ArrayDeque` (`push` / `pop` / `peek` work at the head), not the legacy synchronized `Stack`; `ArrayDeque` throws on `null` elements and `pop()` on empty throws `NoSuchElementException`.'],
      cpp: ['`stack::pop()` / `vector::pop_back()` return `void` — read `top()` / `back()` first; calling either on an empty container is undefined behaviour, not an exception.'],
    },
  },

  'monotonic-stack': {
    java: `
public int[] solve(int[] nums) {
    int[] res = new int[nums.length];
    Deque<Integer> stack = new ArrayDeque<>();   // indices, values decreasing
    for (int i = 0; i < nums.length; i++) {
        int x = nums[i];
        while (!stack.isEmpty() && nums[stack.peek()] < x) {
            int j = stack.pop();
            res[j] = i - j;              // x is j's next greater
        }
        stack.push(i);
    }
    return res;
}
`,
    cpp: `
vector<int> solve(vector<int>& nums) {
    vector<int> res(nums.size(), 0);
    vector<int> stack;                   // indices, values decreasing
    for (int i = 0; i < (int)nums.size(); i++) {
        int x = nums[i];
        while (!stack.empty() && nums[stack.back()] < x) {
            int j = stack.back(); stack.pop_back();
            res[j] = i - j;              // x is j's next greater
        }
        stack.push_back(i);
    }
    return res;
}
`,
    distractors: [
      { java: '        if (!stack.isEmpty() && nums[stack.peek()] < x) {', cpp: '        if (!stack.empty() && nums[stack.back()] < x) {' },
    ],
    gotchas: {
      python: ['`while stack and nums[stack[-1]] < x` relies on `and` short-circuiting — swapping the two tests raises `IndexError` on an empty stack.'],
      java: ['`ArrayDeque.push` adds at the HEAD, so `peek()` is the top; mixing in `add` / `peekLast` (tail operations) silently reads the bottom of the stack.'],
      cpp: ['Check `!stack.empty()` BEFORE `stack.back()` in the loop condition — `back()` on an empty vector is undefined behaviour, not an error.'],
    },
  },

  'binary-search': {
    java: `
public int solve(int lo, int hi) {
    int ans = -1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (feasible(mid)) {
            ans = mid;
            hi = mid - 1;           // look for a smaller feasible value
        } else {
            lo = mid + 1;
        }
    }
    return ans;
}
`,
    cpp: `
int solve(int lo, int hi) {
    int ans = -1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (feasible(mid)) {
            ans = mid;
            hi = mid - 1;           // look for a smaller feasible value
        } else {
            lo = mid + 1;
        }
    }
    return ans;
}
`,
    distractors: [{ java: '            hi = mid;', cpp: '            hi = mid;' }],
    gotchas: {
      python: ['`bisect_left(a, x)` returns the first index with `a[i] >= x` and `bisect_right` the first with `a[i] > x`; Python ints never overflow, so `(lo + hi) // 2` is safe.'],
      java: [
        '`(lo + hi) / 2` overflows once `lo + hi > Integer.MAX_VALUE` — write `lo + (hi - lo) / 2` (or `(lo + hi) >>> 1`).',
        '`Arrays.binarySearch` returns `-(insertionPoint) - 1` when the key is missing, not `-1`.',
      ],
      cpp: ['`lower_bound` / `upper_bound` return iterators (subtract `begin()` for an index); with `size_t` bounds `hi = mid - 1` wraps around at `mid == 0`, so keep `lo` / `hi` signed.'],
    },
  },

  'linked-list': {
    java: `
public ListNode reverse(ListNode head) {
    ListNode prev = null, curr = head;
    while (curr != null) {
        ListNode nxt = curr.next;   // save
        curr.next = prev;           // rewire
        prev = curr;                // advance
        curr = nxt;
    }
    return prev;
}
`,
    cpp: `
ListNode* reverse(ListNode* head) {
    ListNode *prev = nullptr, *curr = head;
    while (curr) {
        ListNode* nxt = curr->next; // save
        curr->next = prev;          // rewire
        prev = curr;                // advance
        curr = nxt;
    }
    return prev;
}
`,
    distractors: [{ java: '        curr = curr.next;', cpp: '        curr = curr->next;' }],
    gotchas: {
      python: ['`prev, curr = curr, nxt` evaluates the whole right side first; written as two separate lines the ORDER matters (`prev = curr` before `curr = nxt`).'],
      java: ['Java has no tuple assignment — `prev = curr; curr = nxt;` must run in that order, and a dummy `new ListNode(0, head)` avoids special-casing the head.'],
      cpp: ['`ListNode* prev, curr;` declares `curr` as a plain `ListNode`, not a pointer — write `ListNode *prev = nullptr, *curr = head;`; use `->` and remember nodes you unlink are not freed for you.'],
    },
  },

  'fast-slow': {
    java: `
public boolean hasCycle(ListNode head) {
    ListNode slow = head, fast = head;
    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;
        if (slow == fast) {
            return true;
        }
    }
    return false;
}
`,
    cpp: `
bool hasCycle(ListNode* head) {
    ListNode *slow = head, *fast = head;
    while (fast && fast->next) {
        slow = slow->next;
        fast = fast->next->next;
        if (slow == fast) {
            return true;
        }
    }
    return false;
}
`,
    distractors: [{ java: '    while (fast != null) {', cpp: '    while (fast) {' }],
    gotchas: {
      python: ['Compare nodes with `is` (identity); `==` would call a custom `__eq__` if the node class defines one and could match two different nodes with equal values.'],
      java: ['`fast.next.next` throws `NullPointerException` unless BOTH `fast != null && fast.next != null` hold — the `&&` order matters; `slow == fast` (reference equality) is exactly right for nodes.'],
      cpp: ['Dereferencing a null `fast->next->next` is undefined behaviour (often a segfault, sometimes silent garbage) — guard with `fast && fast->next`; `slow == fast` compares addresses.'],
    },
  },

  'tree-dfs': {
    java: `
private int dfs(TreeNode node) {
    if (node == null) {
        return baseValue;
    }
    int left = dfs(node.left);
    int right = dfs(node.right);
    updateGlobal(left, right, node);
    return combine(left, right, node);
}
`,
    cpp: `
int dfs(TreeNode* node) {
    if (!node) {
        return baseValue;
    }
    int left = dfs(node->left);
    int right = dfs(node->right);
    updateGlobal(left, right, node);
    return combine(left, right, node);
}
`,
    distractors: [{ java: '    return dfs(node.left) + dfs(node.right);', cpp: '    return dfs(node->left) + dfs(node->right);' }],
    gotchas: {
      python: ['A nested `dfs` that does `res += …` on an outer variable raises `UnboundLocalError` — declare `nonlocal res` (or use `self.res`); the default recursion limit (1000) breaks on deep skewed trees.'],
      java: ['Java has no nested functions: the global answer becomes a field (`private int res;`) updated by a private helper — reset it at the start of each public call.'],
      cpp: ['A recursive lambda cannot be `auto` — declare `function<int(TreeNode*)> dfs = [&](TreeNode* node) { … };` and capture by reference to update `res`.'],
    },
  },

  'tree-bfs': {
    java: `
public List<List<Integer>> levels(TreeNode root) {
    Deque<TreeNode> q = new ArrayDeque<>();
    List<List<Integer>> res = new ArrayList<>();
    if (root != null) q.offer(root);
    while (!q.isEmpty()) {
        List<Integer> level = new ArrayList<>();
        for (int size = q.size(); size > 0; size--) {
            TreeNode node = q.poll();
            level.add(node.val);
            if (node.left != null) q.offer(node.left);
            if (node.right != null) q.offer(node.right);
        }
        res.add(level);
    }
    return res;
}
`,
    cpp: `
vector<vector<int>> levels(TreeNode* root) {
    deque<TreeNode*> q;
    vector<vector<int>> res;
    if (root) q.push_back(root);
    while (!q.empty()) {
        vector<int> level;
        for (int size = q.size(); size > 0; size--) {
            TreeNode* node = q.front(); q.pop_front();
            level.push_back(node->val);
            if (node->left) q.push_back(node->left);
            if (node->right) q.push_back(node->right);
        }
        res.push_back(level);
    }
    return res;
}
`,
    distractors: [{ java: '            TreeNode node = q.pollLast();', cpp: '            TreeNode* node = q.back(); q.pop_back();' }],
    gotchas: {
      python: ['`range(len(q))` is evaluated once, so it snapshots the level size; `list.pop(0)` is O(n) — use `collections.deque` and `popleft()`.'],
      java: ['`ArrayDeque` rejects `null` (`offer(null)` throws `NullPointerException`), so check children before enqueueing; `for (int i = 0; i < q.size(); i++)` re-reads the growing size — snapshot it first.'],
      cpp: ['`pop_front()` / `queue::pop()` return `void` — read `front()` first; `std::queue<TreeNode*>` with `push` / `front` / `pop` is the other idiomatic choice.'],
    },
  },

  bst: {
    java: `
// call as valid(root, Long.MIN_VALUE, Long.MAX_VALUE)
public boolean valid(TreeNode node, long low, long high) {
    if (node == null) {
        return true;
    }
    if (!(low < node.val && node.val < high)) {
        return false;
    }
    return valid(node.left, low, node.val) && valid(node.right, node.val, high);
}
`,
    cpp: `
bool valid(TreeNode* node, long long low = LLONG_MIN, long long high = LLONG_MAX) {
    if (!node) {
        return true;
    }
    if (!(low < node->val && node->val < high)) {
        return false;
    }
    return valid(node->left, low, node->val) && valid(node->right, node->val, high);
}
`,
    distractors: [
      { java: '    return node.left.val < node.val && node.val < node.right.val;', cpp: '    return node->left->val < node->val && node->val < node->right->val;' },
    ],
    gotchas: {
      python: ['Chained comparisons `low < node.val < high` are Python-only; `float("-inf")` / `math.inf` make sentinel bounds that no int can equal.'],
      java: ['Java has no default arguments, so pass the bounds explicitly — and use `long` (`Long.MIN_VALUE`) because a node may hold `Integer.MIN_VALUE` itself; `a < b < c` does not even compile.'],
      cpp: ['`low < node->val < high` COMPILES but means `(low < node->val) < high` (a bool compared with `high`) — always split it with `&&`; default arguments with `LLONG_MIN` / `LLONG_MAX` avoid an `INT_MIN` collision.'],
    },
  },

  trie: {
    java: `
class TrieNode {
    Map<Character, TrieNode> children = new HashMap<>();
    boolean end = false;
}

void insert(TrieNode root, String word) {
    TrieNode node = root;
    for (char ch : word.toCharArray()) {
        node = node.children.computeIfAbsent(ch, k -> new TrieNode());
    }
    node.end = true;
}
`,
    cpp: `
struct TrieNode {
    unordered_map<char, TrieNode*> children;
    bool end = false;
};

void insert(TrieNode* root, const string& word) {
    TrieNode* node = root;
    for (char ch : word) {
        if (!node->children.count(ch)) {
            node->children[ch] = new TrieNode();
        }
        node = node->children[ch];
    }
    node->end = true;
}
`,
    distractors: [{ java: '        node.end = true;', cpp: '        node->end = true;' }],
    gotchas: {
      python: ['`children.setdefault(ch, TrieNode())` builds a throw-away `TrieNode` on EVERY call, even when the key exists — `defaultdict(TrieNode)` or an `if ch not in` check avoids it.'],
      java: ['`computeIfAbsent(ch, k -> new TrieNode())` creates and returns the child in one call; for lowercase words a `TrieNode[] children = new TrieNode[26]` indexed by `ch - \'a\'` is faster than a `HashMap`.'],
      cpp: ['`node->children[ch]` on a missing key inserts a `nullptr` and returns it — check `count` / `find` first; a raw `TrieNode* children[26]` member must be zero-initialised (`= {}`).'],
    },
  },

  heap: {
    java: `
public PriorityQueue<Integer> kLargest(int[] nums, int k) {
    PriorityQueue<Integer> heap = new PriorityQueue<>();
    for (int x : nums) {
        heap.offer(x);
        if (heap.size() > k) {
            heap.poll();            // drop the smallest
        }
    }
    return heap;                    // heap.peek() is the kth largest
}
`,
    cpp: `
priority_queue<int, vector<int>, greater<int>> kLargest(vector<int>& nums, int k) {
    priority_queue<int, vector<int>, greater<int>> heap;
    for (int x : nums) {
        heap.push(x);
        if ((int)heap.size() > k) {
            heap.pop();             // drop the smallest
        }
    }
    return heap;                    // heap.top() is the kth largest
}
`,
    distractors: [{ java: '    Arrays.sort(nums);', cpp: '    sort(nums.begin(), nums.end());' }],
    gotchas: {
      python: ['`heapq` is a MIN-heap — push `-x` (and negate on pop) for a max-heap; `heapq.heapify(list)` builds a heap in O(n).'],
      java: ['`PriorityQueue` is a MIN-heap — pass `Collections.reverseOrder()` or `(a, b) -> Integer.compare(b, a)` for a max-heap; iterating it does NOT give sorted order.'],
      cpp: ['`priority_queue` is a MAX-heap by default — use `priority_queue<int, vector<int>, greater<int>>` for a min-heap; `pop()` returns `void`, so read `top()` first.'],
    },
  },

  backtracking: {
    java: `
private void backtrack(List<Integer> path, List<Integer> choices) {
    if (isSolution(path)) {
        res.add(new ArrayList<>(path));  // copy!
        return;
    }
    for (int c : choices) {
        if (!valid(c, path)) {
            continue;                     // prune
        }
        path.add(c);                      // choose
        backtrack(path, nextChoices(c));
        path.remove(path.size() - 1);     // un-choose
    }
}
`,
    cpp: `
void backtrack(vector<int>& path, const vector<int>& choices) {
    if (isSolution(path)) {
        res.push_back(path);              // copies the vector
        return;
    }
    for (int c : choices) {
        if (!valid(c, path)) {
            continue;                     // prune
        }
        path.push_back(c);                // choose
        backtrack(path, nextChoices(c));
        path.pop_back();                  // un-choose
    }
}
`,
    distractors: [{ java: '        res.add(path);', cpp: '        res.push_back(move(path));' }],
    gotchas: {
      python: ['`res.append(path)` stores a reference to the list you keep mutating — append `path[:]` or `list(path)`.'],
      java: ['`res.add(path)` stores the same reference (wrap it in `new ArrayList<>(path)`), and `path.remove(i)` with an `int` removes by INDEX while `remove(Integer.valueOf(x))` removes by value.'],
      cpp: ['`res.push_back(path)` already copies, but `push_back(move(path))` steals the contents and leaves `path` empty for the rest of the search; pass `path` by reference so recursion does not copy it at every level.'],
    },
  },

  'graph-traversal': {
    java: `
public void bfs(List<Integer> sources) {
    Deque<Integer> q = new ArrayDeque<>(sources);
    Set<Integer> seen = new HashSet<>(sources);
    int steps = 0;
    while (!q.isEmpty()) {
        for (int size = q.size(); size > 0; size--) {
            int node = q.poll();
            for (int nei : neighbors(node)) {
                if (!seen.contains(nei)) {
                    seen.add(nei);
                    q.offer(nei);
                }
            }
        }
        steps++;
    }
}
`,
    cpp: `
void bfs(vector<int>& sources) {
    deque<int> q(sources.begin(), sources.end());
    unordered_set<int> seen(sources.begin(), sources.end());
    int steps = 0;
    while (!q.empty()) {
        for (int size = q.size(); size > 0; size--) {
            int node = q.front(); q.pop_front();
            for (int nei : neighbors(node)) {
                if (!seen.count(nei)) {
                    seen.insert(nei);
                    q.push_back(nei);
                }
            }
        }
        steps++;
    }
}
`,
    distractors: [{ java: '                    q.offerFirst(nei);', cpp: '                    q.push_front(nei);' }],
    gotchas: {
      python: ['Recursive DFS on a big grid hits the default recursion limit (1000) — use BFS with `deque` or an explicit stack; grid cells go into `seen` as tuples `(r, c)`.'],
      java: ['`if (seen.add(nei))` checks and inserts in one call (it returns false if present); for grids use `boolean[][] seen` — an `int[]{r, c}` in a `HashSet` hashes by identity and never matches.'],
      cpp: ['`seen.insert(nei).second` is false when `nei` was already there; for grids a `vector<vector<bool>> seen(R, vector<bool>(C))` beats a set because `pair` has no default hash.'],
    },
  },

  'topo-sort': {
    java: `
public List<Integer> topo(int n, int[][] edges) {
    List<List<Integer>> adj = new ArrayList<>();
    for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
    int[] indeg = new int[n];
    for (int[] e : edges) {
        int a = e[0], b = e[1];         // a before b
        adj.get(a).add(b); indeg[b]++;
    }
    Deque<Integer> q = new ArrayDeque<>();
    for (int i = 0; i < n; i++) if (indeg[i] == 0) q.offer(i);
    List<Integer> order = new ArrayList<>();
    while (!q.isEmpty()) {
        int x = q.poll(); order.add(x);
        for (int y : adj.get(x)) {
            indeg[y]--;
            if (indeg[y] == 0) q.offer(y);
        }
    }
    return order.size() == n ? order : new ArrayList<>();
}
`,
    cpp: `
vector<int> topo(int n, vector<vector<int>>& edges) {
    vector<vector<int>> adj(n);
    vector<int> indeg(n, 0);
    for (auto& e : edges) {
        int a = e[0], b = e[1];         // a before b
        adj[a].push_back(b); indeg[b]++;
    }
    queue<int> q;
    for (int i = 0; i < n; i++) if (indeg[i] == 0) q.push(i);
    vector<int> order;
    while (!q.empty()) {
        int x = q.front(); q.pop(); order.push_back(x);
        for (int y : adj[x]) {
            indeg[y]--;
            if (indeg[y] == 0) q.push(y);
        }
    }
    return (int)order.size() == n ? order : vector<int>();
}
`,
    distractors: [{ java: '        indeg[a]++;', cpp: '        indeg[a]++;' }],
    gotchas: {
      python: ['`[[]] * n` makes n references to ONE list — every node would share neighbours; build the adjacency list with `[[] for _ in range(n)]`.'],
      java: ['`new ArrayList<Integer>[n]` is a generic-array error/warning — use `List<List<Integer>>` filled in a loop; `Collections.nCopies(n, new ArrayList<>())` shares one list like Python\'s `[[]] * n`.'],
      cpp: ['`queue::pop()` returns `void` — take `front()` first; `vector<vector<int>> adj(n)` gives n independent empty lists (no aliasing trap).'],
    },
  },

  'union-find': {
    java: `
int[] parent = IntStream.range(0, n).toArray();
int[] rank = new int[n];                 // Arrays.fill(rank, 1)

int find(int x) {
    while (parent[x] != x) {
        parent[x] = parent[parent[x]];   // path compression
        x = parent[x];
    }
    return x;
}

boolean union(int a, int b) {
    int ra = find(a), rb = find(b);
    if (ra == rb) return false;          // already connected
    if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
    parent[rb] = ra; rank[ra] += rank[rb];
    return true;
}
`,
    cpp: `
vector<int> parent(n), rank(n, 1);       // iota(parent.begin(), parent.end(), 0)

int find(int x) {
    while (parent[x] != x) {
        parent[x] = parent[parent[x]];   // path compression
        x = parent[x];
    }
    return x;
}

bool unite(int a, int b) {               // "union" is a C++ keyword
    int ra = find(a), rb = find(b);
    if (ra == rb) return false;          // already connected
    if (rank[ra] < rank[rb]) swap(ra, rb);
    parent[rb] = ra; rank[ra] += rank[rb];
    return true;
}
`,
    distractors: [{ java: '    parent[a] = b;', cpp: '    parent[a] = b;' }],
    gotchas: {
      python: ['A recursive `find` (`parent[x] = find(parent[x])`) can exceed the recursion limit on a long chain before it is compressed — the iterative path-halving loop never recurses.'],
      java: ['`new int[n]` starts every `parent` at 0 (all nodes in one fake set) — initialise `parent[i] = i`, e.g. `IntStream.range(0, n).toArray()`.'],
      cpp: ['`union` is a reserved keyword in C++ — name the method `unite`; `iota(parent.begin(), parent.end(), 0)` sets each node as its own parent.'],
    },
  },

  'weighted-graph': {
    java: `
public Map<Integer, Integer> dijkstra(List<List<int[]>> adj, int src) {
    Map<Integer, Integer> dist = new HashMap<>();
    dist.put(src, 0);
    PriorityQueue<int[]> heap = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));
    heap.offer(new int[] { 0, src });
    while (!heap.isEmpty()) {
        int[] top = heap.poll();
        int d = top[0], u = top[1];
        if (d > dist.getOrDefault(u, Integer.MAX_VALUE)) continue;
        for (int[] edge : adj.get(u)) {
            int v = edge[0], w = edge[1];
            if (d + w < dist.getOrDefault(v, Integer.MAX_VALUE)) {
                dist.put(v, d + w);
                heap.offer(new int[] { d + w, v });
            }
        }
    }
    return dist;
}
`,
    cpp: `
unordered_map<int, int> dijkstra(vector<vector<pair<int, int>>>& adj, int src) {
    unordered_map<int, int> dist;
    dist[src] = 0;
    priority_queue<pair<int, int>, vector<pair<int, int>>, greater<pair<int, int>>> heap;
    heap.push({0, src});
    while (!heap.empty()) {
        auto [d, u] = heap.top(); heap.pop();
        if (d > dist[u]) continue;
        for (auto& [v, w] : adj[u]) {
            if (!dist.count(v) || d + w < dist[v]) {
                dist[v] = d + w;
                heap.push({d + w, v});
            }
        }
    }
    return dist;
}
`,
    distractors: [{ java: '        int[] top = q.pollFirst();', cpp: '        auto [d, u] = q.front(); q.pop_front();' }],
    gotchas: {
      python: ['`heapq` orders tuples element by element, so `(dist, node)` ties compare the nodes — fine for ints, a `TypeError` for unorderable payloads (add a counter as the 2nd field).'],
      java: ['A comparator written as `(a, b) -> a[0] - b[0]` overflows for large distances — use `Integer.compare(a[0], b[0])` (or `Comparator.comparingInt(a -> a[0])`).'],
      cpp: [
        '`priority_queue` is a MAX-heap — use `greater<pair<int, int>>` (or push `-d`) to pop the smallest distance first.',
        '`auto& [d, u] = heap.top(); heap.pop();` leaves `d`, `u` dangling — copy with `auto [d, u]` before popping.',
      ],
    },
  },

  'dp-1d': {
    java: `
public int solve(int[] nums) {
    int[] dp = new int[nums.length + 1];
    dp[0] = base;
    for (int i = 1; i <= nums.length; i++) {
        dp[i] = best(dp[i - 1] + ..., dp[i - 2] + ...);
    }
    return dp[nums.length];
}
`,
    cpp: `
int solve(vector<int>& nums) {
    vector<int> dp(nums.size() + 1, 0);
    dp[0] = base;
    for (int i = 1; i <= (int)nums.size(); i++) {
        dp[i] = best(dp[i - 1] + ..., dp[i - 2] + ...);
    }
    return dp[nums.size()];
}
`,
    distractors: [{ java: '    for (int i = nums.length; i > 0; i--) {', cpp: '    for (int i = (int)nums.size(); i > 0; i--) {' }],
    gotchas: {
      python: ['`functools.cache` on a recursive helper gives top-down DP in one line, but every argument must be hashable (pass tuples, not lists).'],
      java: ['For min-DP seeded with `Integer.MAX_VALUE`, `dp[j] + 1` wraps to a negative number and "wins" every `Math.min` — use `Integer.MAX_VALUE / 2` or check before adding.'],
      cpp: ['Counting DPs (ways, paths) overflow `int` quickly and signed overflow is undefined behaviour — use `vector<long long>` or apply the required `% MOD` on every addition.'],
    },
  },

  'dp-2d': {
    java: `
public int solve(String a, String b) {
    int[][] dp = new int[a.length() + 1][b.length() + 1];
    for (int i = 1; i <= a.length(); i++) {
        for (int j = 1; j <= b.length(); j++) {
            if (a.charAt(i - 1) == b.charAt(j - 1)) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    return dp[a.length()][b.length()];
}
`,
    cpp: `
int solve(string a, string b) {
    vector<vector<int>> dp(a.size() + 1, vector<int>(b.size() + 1, 0));
    for (int i = 1; i <= (int)a.size(); i++) {
        for (int j = 1; j <= (int)b.size(); j++) {
            if (a[i - 1] == b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    return dp[a.size()][b.size()];
}
`,
    distractors: [{ java: '                dp[i][j] = dp[i][j - 1] + 1;', cpp: '                dp[i][j] = dp[i][j - 1] + 1;' }],
    gotchas: {
      python: ['`[[0] * (m + 1)] * (n + 1)` repeats ONE row object, so writing `dp[1][j]` changes every row — build it with a comprehension.'],
      java: ['`new int[n + 1][m + 1]` gives independent zero-filled rows; compare `charAt` values with `==`, but whole `String`s with `.equals`.'],
      cpp: ['Build the table with `vector<vector<int>> dp(n + 1, vector<int>(m + 1))`; for the rolling-row optimisation `swap(prev, cur)` is O(1), whereas `prev = cur` copies the row.'],
    },
  },

  greedy: {
    java: `
public int solve(int[] nums) {
    int best = nums[0], cur = nums[0];
    for (int i = 1; i < nums.length; i++) {
        int x = nums[i];
        cur = Math.max(x, cur + x);     // drop a negative prefix
        best = Math.max(best, cur);
    }
    return best;
}
`,
    cpp: `
int solve(vector<int>& nums) {
    int best = nums[0], cur = nums[0];
    for (int i = 1; i < (int)nums.size(); i++) {
        int x = nums[i];
        cur = max(x, cur + x);          // drop a negative prefix
        best = max(best, cur);
    }
    return best;
}
`,
    distractors: [{ java: '        cur = cur + x;', cpp: '        cur = cur + x;' }],
    gotchas: {
      python: ['`for x in nums[1:]` copies the list (O(n) extra memory) — fine for clarity, but `itertools.islice(nums, 1, None)` or an index loop avoids it.'],
      java: ['Greedy sorts with `Arrays.sort(arr, (a, b) -> a[1] - b[1])` overflow for large values — use `Integer.compare(a[1], b[1])` or `Comparator.comparingInt`.'],
      cpp: ['`max(a, b)` needs both arguments of the SAME type (`max(0LL, x)` with an `int x` will not compile); `max({a, b, c})` takes an initializer list for three or more.'],
    },
  },

  intervals: {
    java: `
public int[][] merge(int[][] intervals) {
    Arrays.sort(intervals, (x, y) -> Integer.compare(x[0], y[0]));
    List<int[]> out = new ArrayList<>();
    out.add(intervals[0]);
    for (int k = 1; k < intervals.length; k++) {
        int s = intervals[k][0], e = intervals[k][1];
        int[] last = out.get(out.size() - 1);
        if (s <= last[1]) {
            last[1] = Math.max(last[1], e);
        } else {
            out.add(new int[] { s, e });
        }
    }
    return out.toArray(new int[0][]);
}
`,
    cpp: `
vector<vector<int>> merge(vector<vector<int>>& intervals) {
    sort(intervals.begin(), intervals.end());
    vector<vector<int>> out = { intervals[0] };
    for (int k = 1; k < (int)intervals.size(); k++) {
        int s = intervals[k][0], e = intervals[k][1];
        if (s <= out.back()[1]) {
            out.back()[1] = max(out.back()[1], e);
        } else {
            out.push_back({ s, e });
        }
    }
    return out;
}
`,
    distractors: [{ java: '            last[1] = e;', cpp: '            out.back()[1] = e;' }],
    gotchas: {
      python: ['`intervals.sort()` already sorts lists by start then end; `out[-1][1] = …` mutates the last interval in place because `out` holds the same list objects.'],
      java: ['`out.get(out.size() - 1)` returns a reference to the stored `int[]`, so `last[1] = …` updates it in place; convert back with `out.toArray(new int[0][])`.'],
      cpp: ['`auto last = out.back();` COPIES the interval and the merge is lost — use `auto& last = out.back()` (or write `out.back()[1]` directly); plain `sort` on `vector<vector<int>>` is lexicographic.'],
    },
  },

  matrix: {
    java: `
public List<Integer> spiral(int[][] m) {
    int top = 0, bottom = m.length, left = 0, right = m[0].length;
    List<Integer> res = new ArrayList<>();
    while (top < bottom && left < right) {
        for (int j = left; j < right; j++) res.add(m[top][j]);
        top++;
        for (int i = top; i < bottom; i++) res.add(m[i][right - 1]);
        right--;
        if (!(top < bottom && left < right)) break;
        for (int j = right - 1; j >= left; j--) res.add(m[bottom - 1][j]);
        bottom--;
        for (int i = bottom - 1; i >= top; i--) res.add(m[i][left]);
        left++;
    }
    return res;
}
`,
    cpp: `
vector<int> spiral(vector<vector<int>>& m) {
    int top = 0, bottom = m.size(), left = 0, right = m[0].size();
    vector<int> res;
    while (top < bottom && left < right) {
        for (int j = left; j < right; j++) res.push_back(m[top][j]);
        top++;
        for (int i = top; i < bottom; i++) res.push_back(m[i][right - 1]);
        right--;
        if (!(top < bottom && left < right)) break;
        for (int j = right - 1; j >= left; j--) res.push_back(m[bottom - 1][j]);
        bottom--;
        for (int i = bottom - 1; i >= top; i--) res.push_back(m[i][left]);
        left++;
    }
    return res;
}
`,
    distractors: [{ java: '        top--;', cpp: '        top--;' }],
    gotchas: {
      python: ['`list(zip(*m[::-1]))` rotates clockwise in one line but yields TUPLES and a new matrix — not in place; `range(right - 1, left - 1, -1)` is the inclusive backward walk.'],
      java: ['`int[][]` may be jagged and `m[0]` throws `ArrayIndexOutOfBoundsException` on an empty matrix — guard `m.length == 0` first.'],
      cpp: ['`m[0].size()` on an empty matrix is undefined behaviour, and with `size_t` bounds `right - 1` wraps at 0 — check `m.empty()` and keep the four walls as `int`.'],
    },
  },

  math: {
    java: `
public double power(double x, long n) {
    if (n < 0) { x = 1 / x; n = -n; }
    double res = 1;
    while (n != 0) {
        if ((n & 1) == 1) res *= x;
        x *= x;
        n >>= 1;
    }
    return res;
}
`,
    cpp: `
double power(double x, long long n) {
    if (n < 0) { x = 1 / x; n = -n; }
    double res = 1;
    while (n) {
        if (n & 1) res *= x;
        x *= x;
        n >>= 1;
    }
    return res;
}
`,
    distractors: [{ java: '        n -= 1;', cpp: '        n -= 1;' }],
    gotchas: {
      python: ['Python `%` takes the sign of the divisor (`-7 % 3 == 1`) and `//` floors toward −∞; `pow(x, n, mod)` does modular exponentiation natively and ints never overflow.'],
      java: [
        '`-7 % 3 == -1` in Java (the result takes the dividend\'s sign) — use `Math.floorMod(a, m)` for a non-negative remainder.',
        'Check `res > Integer.MAX_VALUE / 10` BEFORE `res * 10 + d` (reverse integer, atoi); `Math.pow` returns a `double`, and `-Integer.MIN_VALUE` overflows, so widen exponents to `long`.',
      ],
      cpp: [
        '`-7 % 3 == -1` in C++ too — normalise with `((a % m) + m) % m`.',
        '`a * b` of two `int`s overflows BEFORE it is stored in a `long long` — cast first: `(long long)a * b`; guard reversals with `res > INT_MAX / 10`.',
      ],
    },
  },

  bits: {
    java: `
public int countBits(int n) {
    int count = 0;
    while (n != 0) {
        n &= n - 1;         // drop the lowest set bit
        count++;
    }
    return count;
}
`,
    cpp: `
int countBits(uint32_t n) {
    int count = 0;
    while (n) {
        n &= n - 1;         // drop the lowest set bit
        count++;
    }
    return count;
}
`,
    distractors: [{ java: '        n = n - 1;', cpp: '        n = n - 1;' }],
    gotchas: {
      python: ['Python ints are unbounded, so a negative `n` has infinitely many 1-bits and `n &= n - 1` never ends — mask with `n & 0xFFFFFFFF` to emulate 32 bits.'],
      java: [
        'Java has no unsigned `int`: `>>` copies the sign bit (use `>>>` for a logical shift); `Integer.bitCount(n)` is the built-in popcount.',
        '`n & 1 == 1` does not compile — `==` binds tighter than `&`, so write `(n & 1) == 1`.',
      ],
      cpp: [
        'Use `uint32_t` — right-shifting a negative signed int is implementation-defined and `1 << 31` overflows `int` (write `1u << 31`); `__builtin_popcount(n)` / `bitset<32>(n).count()` count bits.',
        '`n & 1 == 0` compiles but parses as `n & (1 == 0)` — always parenthesise `(n & 1) == 0`.',
      ],
    },
  },

  design: {
    java: `
class Design {
    private Map<Key, Node> index = new HashMap<>();   // O(1) lookup
    private Order order = ...;                        // O(1) reorder / min / history

    public void op(Key key) {
        Node node = index.get(key);
        // update both structures together
    }
}
`,
    cpp: `
class Design {
public:
    unordered_map<Key, Node*> index;    // O(1) lookup
    Order order;                        // O(1) reorder / min / history

    void op(Key key) {
        Node* node = index[key];
        // update both structures together
    }
};
`,
    distractors: [{ java: '        items.remove(key);', cpp: '        items.erase(find(items.begin(), items.end(), key));' }],
    gotchas: {
      python: ['`OrderedDict` gives an O(1) LRU via `move_to_end(key)` and `popitem(last=False)`; `list.remove` / `list.index` are hidden O(n) scans.'],
      java: ['`new LinkedHashMap<>(cap, 0.75f, true)` with an overridden `removeEldestEntry` is a built-in LRU; `ArrayList.remove(Object)` is O(n). A private node class must not be called `Node` if LeetCode already defines one.'],
      cpp: ['`list<pair<K, V>>` + `unordered_map<K, list<pair<K, V>>::iterator>` is the O(1) LRU: `splice` moves a node without invalidating iterators, while `vector::erase` in the middle is O(n).'],
    },
  },
};
