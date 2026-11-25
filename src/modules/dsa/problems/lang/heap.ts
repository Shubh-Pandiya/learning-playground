import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the heap problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'kth-largest-element-in-a-stream': {
    java: `
class KthLargest {
    private PriorityQueue<Integer> minHeap;
    private int k;
    public KthLargest(int k, int[] nums) {
        this.minHeap = new PriorityQueue<>(); this.k = k;    @init
        for (int n : nums) minHeap.offer(n);                 @heapify
        while (minHeap.size() > k) {                         @trimLoop
            minHeap.poll();                                  @trim
        }
    }
    public int add(int val) {
        minHeap.offer(val);                                  @push
        if (minHeap.size() > k) {                            @check
            minHeap.poll();                                  @pop
        }
        return minHeap.peek();                               @top
    }
}
`,
    cpp: `
class KthLargest {
    priority_queue<int, vector<int>, greater<int>> minHeap;
    int k;
public:
    KthLargest(int k, vector<int>& nums) {
        this->k = k;                                         @init
        minHeap = priority_queue<int, vector<int>, greater<int>>(nums.begin(), nums.end());   @heapify
        while ((int)minHeap.size() > k) {                    @trimLoop
            minHeap.pop();                                   @trim
        }
    }
    int add(int val) {
        minHeap.push(val);                                   @push
        if ((int)minHeap.size() > k) {                       @check
            minHeap.pop();                                   @pop
        }
        return minHeap.top();                                @top
    }
};
`,
    distractors: [
      { java: '        minHeap.offer(-val);', cpp: '        minHeap.push(-val);' },
      { java: '        if (minHeap.size() >= k) {', cpp: '        if ((int)minHeap.size() >= k) {' },
      { java: '        return Collections.max(minHeap);', cpp: '        return *max_element(minHeap.begin(), minHeap.end());' },
    ],
    gotchas: {
      python: ['`heapq.heapify(nums)` reorders the caller\'s list in place — copy it first if the input must stay untouched.'],
      java: ['`new PriorityQueue<>()` is a MIN-heap — exactly what keeps the k largest, with the k-th largest at `peek()`.'],
      cpp: ['`priority_queue<int>` is a MAX-heap; the min-heap is `priority_queue<int, vector<int>, greater<int>>`, and it has no iterators — only `top()`.'],
    },
  },

  'last-stone-weight': {
    java: `
public int lastStoneWeight(int[] weights) {
    PriorityQueue<Integer> stones = new PriorityQueue<>(Collections.reverseOrder());   @negate
    for (int w : weights) stones.offer(w);                 @heapify
    while (stones.size() > 1) {                            @loop
        int first = stones.poll();                         @pop1
        int second = stones.poll();                        @pop2
        if (second < first) {                              @cmp
            stones.offer(first - second);                  @push
        }
    }
    stones.offer(0);                                       @pad
    return stones.peek();                                  @done
}
`,
    cpp: `
int lastStoneWeight(vector<int>& weights) {
    priority_queue<int> stones;                            @negate
    for (int w : weights) stones.push(w);                  @heapify
    while ((int)stones.size() > 1) {                       @loop
        int first = stones.top(); stones.pop();            @pop1
        int second = stones.top(); stones.pop();           @pop2
        if (second < first) {                              @cmp
            stones.push(first - second);                   @push
        }
    }
    stones.push(0);                                        @pad
    return stones.top();                                   @done
}
`,
    distractors: [
      { java: '    Arrays.sort(weights);', cpp: '    sort(weights.rbegin(), weights.rend());' },
      { java: '            stones.offer(second - first);', cpp: '            stones.push(second - first);' },
      { java: '    while (!stones.isEmpty()) {', cpp: '    while (!stones.empty()) {' },
    ],
    gotchas: {
      python: ['`heapq` is a MIN-heap only — store `-weight` to get a max-heap and take `abs` (or negate) on the way out.'],
      java: ['`new PriorityQueue<>(Collections.reverseOrder())` is a max-heap, so weights stay positive — no negation trick needed.'],
      cpp: ['`priority_queue<int>` is already a max-heap, and `pop()` returns `void` — read `top()` before popping.'],
    },
  },

  'k-closest-points-to-origin': {
    java: `
public int[][] kClosest(int[][] points, int k) {
    PriorityQueue<int[]> maxHeap = new PriorityQueue<>((a, b) -> Integer.compare(b[0], a[0]));   @init
    for (int[] p : points) {                               @loop
        int x = p[0], y = p[1];
        int dist = x * x + y * y;                          @dist
        maxHeap.offer(new int[] { dist, x, y });           @push
        if (maxHeap.size() > k) {                          @check
            maxHeap.poll();                                @evict
        }
    }
    return maxHeap.stream().map(e -> new int[] { e[1], e[2] }).toArray(int[][]::new);   @done
}
`,
    cpp: `
vector<vector<int>> kClosest(vector<vector<int>>& points, int k) {
    priority_queue<array<int, 3>> maxHeap;                 @init
    for (auto& p : points) {                               @loop
        int x = p[0], y = p[1];
        int dist = x * x + y * y;                          @dist
        maxHeap.push({dist, x, y});                        @push
        if ((int)maxHeap.size() > k) {                     @check
            maxHeap.pop();                                 @evict
        }
    }
    vector<vector<int>> res;
    while (!maxHeap.empty()) {
        auto [d, x, y] = maxHeap.top(); maxHeap.pop();
        res.push_back({x, y});
    }
    return res;                                            @done
}
`,
    distractors: [
      {
        java: '    PriorityQueue<int[]> maxHeap = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));',
        cpp: '    priority_queue<array<int, 3>, vector<array<int, 3>>, greater<>> maxHeap;',
      },
      { java: '        int dist = Math.abs(x) + Math.abs(y);', cpp: '        int dist = abs(x) + abs(y);' },
      { java: '        if (maxHeap.size() >= k) {', cpp: '        if ((int)maxHeap.size() >= k) {' },
    ],
    gotchas: {
      python: ['`heapq` compares tuples element by element, so `(-dist, x, y)` orders by distance first — negated to fake a max-heap.'],
      java: ['Write the comparator as `Integer.compare(b[0], a[0])`; the shortcut `b[0] - a[0]` can overflow for large values.'],
      cpp: ['`priority_queue<array<int, 3>>` is a MAX-heap ordered by `dist` first (arrays compare lexicographically) — no negation needed.'],
    },
  },

  'kth-largest-element-in-an-array': {
    java: `
public int findKthLargest(int[] nums, int k) {
    PriorityQueue<Integer> heap = new PriorityQueue<>();   @init
    for (int n : nums) {                                   @loop
        heap.offer(n);                                     @push
        if (heap.size() > k) {                             @check
            heap.poll();                                   @pop
        }
    }
    return heap.peek();                                    @done
}
`,
    cpp: `
int findKthLargest(vector<int>& nums, int k) {
    priority_queue<int, vector<int>, greater<int>> heap;   @init
    for (int n : nums) {                                   @loop
        heap.push(n);                                      @push
        if ((int)heap.size() > k) {                        @check
            heap.pop();                                    @pop
        }
    }
    return heap.top();                                     @done
}
`,
    distractors: [
      { java: '    return (Integer) heap.toArray()[heap.size() - 1];', cpp: '    return heap.back();' },
      { java: '        heap.offer(-n);', cpp: '        heap.push(-n);' },
      {
        java: '    Arrays.sort(nums); return nums[k];',
        cpp: '    sort(nums.begin(), nums.end()); return nums[k];',
      },
    ],
    gotchas: {
      java: ['`PriorityQueue` is a min-heap by default and its `toArray()` / iteration order is NOT sorted — only `peek()` is meaningful.'],
      cpp: ['`priority_queue<int>` is a MAX-heap, so a size-k min-heap needs `greater<int>`; `nth_element` gives O(n) average without a heap.'],
    },
  },

  'task-scheduler': {
    java: `
public int leastInterval(char[] tasks, int n) {
    int[] count = new int[26];
    for (char t : tasks) count[t - 'A']++;                         @count
    PriorityQueue<Integer> maxHeap = new PriorityQueue<>(Collections.reverseOrder());   @build
    for (int cnt : count) if (cnt > 0) maxHeap.offer(cnt);         @heapify
    int time = 0; Deque<int[]> q = new ArrayDeque<>();   // [cnt, readyTime]   @init
    while (!maxHeap.isEmpty() || !q.isEmpty()) {                   @loop
        time++;                                                    @tick
        if (!maxHeap.isEmpty()) {                                  @has
            int cnt = maxHeap.poll() - 1;                          @run
            if (cnt > 0) {                                         @left
                q.offer(new int[] { cnt, time + n });              @cool
            }
        }
        if (!q.isEmpty() && q.peek()[1] == time) {                 @ready
            maxHeap.offer(q.poll()[0]);                            @back
        }
    }
    return time;                                                   @done
}
`,
    cpp: `
int leastInterval(vector<char>& tasks, int n) {
    unordered_map<char, int> count;
    for (char t : tasks) count[t]++;                               @count
    priority_queue<int> maxHeap;                                   @build
    for (auto& [task, cnt] : count) maxHeap.push(cnt);             @heapify
    int time = 0; deque<pair<int, int>> q;   // {cnt, readyTime}   @init
    while (!maxHeap.empty() || !q.empty()) {                       @loop
        time++;                                                    @tick
        if (!maxHeap.empty()) {                                    @has
            int cnt = maxHeap.top() - 1; maxHeap.pop();            @run
            if (cnt) {                                             @left
                q.push_back({cnt, time + n});                      @cool
            }
        }
        if (!q.empty() && q.front().second == time) {              @ready
            maxHeap.push(q.front().first); q.pop_front();          @back
        }
    }
    return time;                                                   @done
}
`,
    distractors: [
      { java: '                maxHeap.offer(cnt);', cpp: '                maxHeap.push(cnt);' },
      { java: '                q.offer(new int[] { cnt, time + n + 1 });', cpp: '                q.push_back({cnt, time + n + 1});' },
      { java: '    while (!maxHeap.isEmpty()) {', cpp: '    while (!maxHeap.empty()) {' },
    ],
    gotchas: {
      python: ['The heap stores `-cnt` because `heapq` is a min-heap, so "one run done" is `1 + heappop(...)` (moving toward 0).'],
      java: ['With `Collections.reverseOrder()` the counts stay positive, so one run is `poll() - 1`; use `ArrayDeque` (not `Stack`/`LinkedList`) for the cooldown queue.'],
      cpp: ['`priority_queue<int>` is a max-heap by default; `pop()` returns `void`, so read `top()` first.'],
    },
  },

  'design-twitter': {
    java: `
class Twitter {
    private int count;
    private Map<Integer, List<int[]>> tweetMap;      // uid -> [[count, tweetId]]
    private Map<Integer, Set<Integer>> followMap;    // uid -> followees
    public Twitter() {
        count = 0;                                                 @init
        tweetMap = new HashMap<>(); followMap = new HashMap<>();
    }
    public void postTweet(int userId, int tweetId) {
        tweetMap.computeIfAbsent(userId, u -> new ArrayList<>()).add(new int[] { count, tweetId });   @post
        count--;                                                   @tick
    }
    public List<Integer> getNewsFeed(int userId) {
        List<Integer> res = new ArrayList<>();                     @feed
        PriorityQueue<int[]> minHeap = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));
        followMap.computeIfAbsent(userId, u -> new HashSet<>()).add(userId);   @self
        for (int f : followMap.get(userId)) {                      @seed
            if (tweetMap.containsKey(f)) {                         @hasTweets
                int index = tweetMap.get(f).size() - 1;            @latest
                int[] tweet = tweetMap.get(f).get(index);
                minHeap.offer(new int[] { tweet[0], tweet[1], f, index - 1 });   @seedPush
            }
        }
        while (!minHeap.isEmpty() && res.size() < 10) {            @loop
            int[] top = minHeap.poll();                            @pop
            int tweetId = top[1], f = top[2], index = top[3];
            res.add(tweetId);                                      @take
            if (index >= 0) {                                      @more
                int[] tweet = tweetMap.get(f).get(index);          @older
                minHeap.offer(new int[] { tweet[0], tweet[1], f, index - 1 });   @next
            }
        }
        return res;                                                @ret
    }
    public void follow(int followerId, int followeeId) {
        followMap.computeIfAbsent(followerId, u -> new HashSet<>()).add(followeeId);   @follow
    }
    public void unfollow(int followerId, int followeeId) {
        if (followMap.containsKey(followerId)) followMap.get(followerId).remove(followeeId);   @unfollow
    }
}
`,
    cpp: `
class Twitter {
    int count;
    unordered_map<int, vector<pair<int, int>>> tweetMap;   // uid -> [{count, tweetId}]
    unordered_map<int, unordered_set<int>> followMap;      // uid -> followees
public:
    Twitter() {
        count = 0;                                                 @init
    }
    void postTweet(int userId, int tweetId) {
        tweetMap[userId].push_back({count, tweetId});              @post
        count--;                                                   @tick
    }
    vector<int> getNewsFeed(int userId) {
        vector<int> res;                                           @feed
        priority_queue<array<int, 4>, vector<array<int, 4>>, greater<>> minHeap;
        followMap[userId].insert(userId);                          @self
        for (int f : followMap[userId]) {                          @seed
            if (tweetMap.count(f)) {                               @hasTweets
                int index = (int)tweetMap[f].size() - 1;           @latest
                auto [count, tweetId] = tweetMap[f][index];
                minHeap.push({count, tweetId, f, index - 1});      @seedPush
            }
        }
        while (!minHeap.empty() && (int)res.size() < 10) {         @loop
            auto [count, tweetId, f, index] = minHeap.top(); minHeap.pop();   @pop
            res.push_back(tweetId);                                @take
            if (index >= 0) {                                      @more
                auto [count, tweetId] = tweetMap[f][index];        @older
                minHeap.push({count, tweetId, f, index - 1});      @next
            }
        }
        return res;                                                @ret
    }
    void follow(int followerId, int followeeId) {
        followMap[followerId].insert(followeeId);                  @follow
    }
    void unfollow(int followerId, int followeeId) {
        followMap[followerId].erase(followeeId);                   @unfollow
    }
};
`,
    distractors: [
      { java: '        count++;', cpp: '        count++;' },
      {
        java: '                minHeap.offer(new int[] { tweet[0], tweet[1], f, index + 1 });',
        cpp: '                minHeap.push({count, tweetId, f, index + 1});',
      },
      { java: '        while (!minHeap.isEmpty()) {', cpp: '        while (!minHeap.empty()) {' },
    ],
    gotchas: {
      python: ['`count` goes DOWN (0, -1, -2 …) so the newest tweet has the smallest key and pops first from the min-heap.'],
      java: ['`computeIfAbsent(uid, u -> new ArrayList<>())` replaces Python\'s `defaultdict`; compare heap entries with `Integer.compare`, not subtraction.'],
      cpp: ['`priority_queue` is a MAX-heap — `greater<>` makes the min-heap; `tweetMap[f]` / `followMap[x]` auto-create empty entries just like `defaultdict`.'],
    },
  },

  'find-median-from-data-stream': {
    java: `
class MedianFinder {
    private PriorityQueue<Integer> small = new PriorityQueue<>(Collections.reverseOrder());   @init
    private PriorityQueue<Integer> large = new PriorityQueue<>();
    public void addNum(int num) {
        small.offer(num);                                              @pushSmall
        if (!small.isEmpty() && !large.isEmpty() && small.peek() > large.peek()) {   @order
            large.offer(small.poll());                                 @fixOrder
        }
        if (small.size() > large.size() + 1) {                         @tooSmall
            large.offer(small.poll());                                 @moveUp
        }
        if (large.size() > small.size() + 1) {                         @tooLarge
            small.offer(large.poll());                                 @moveDown
        }
    }
    public double findMedian() {
        if (small.size() > large.size()) {                             @oddS
            return small.peek();                                       @retS
        }
        if (large.size() > small.size()) {                             @oddL
            return large.peek();                                       @retL
        }
        return (small.peek() + large.peek()) / 2.0;                    @even
    }
}
`,
    cpp: `
class MedianFinder {
    priority_queue<int> small;                                         @init
    priority_queue<int, vector<int>, greater<int>> large;
public:
    void addNum(int num) {
        small.push(num);                                               @pushSmall
        if (!small.empty() && !large.empty() && small.top() > large.top()) {   @order
            large.push(small.top()); small.pop();                      @fixOrder
        }
        if (small.size() > large.size() + 1) {                         @tooSmall
            large.push(small.top()); small.pop();                      @moveUp
        }
        if (large.size() > small.size() + 1) {                         @tooLarge
            small.push(large.top()); large.pop();                      @moveDown
        }
    }
    double findMedian() {
        if (small.size() > large.size()) {                             @oddS
            return small.top();                                        @retS
        }
        if (large.size() > small.size()) {                             @oddL
            return large.top();                                        @retL
        }
        return (small.top() + large.top()) / 2.0;                      @even
    }
};
`,
    distractors: [
      {
        java: '    private PriorityQueue<Integer> small = new PriorityQueue<>();',
        cpp: '    priority_queue<int, vector<int>, greater<int>> small;',
      },
      { java: '        return (small.peek() + large.peek()) / 2;', cpp: '        return (small.top() + large.top()) / 2;' },
      { java: '        if (small.size() > large.size()) {', cpp: '        if (small.size() > large.size()) {' },
    ],
    gotchas: {
      python: ['`heapq` has no max-heap, so `small` stores negatives — read its top as `-self.small[0]`.'],
      java: ['`small` needs `Collections.reverseOrder()` to be a max-heap; `(a + b) / 2` on ints truncates — divide by `2.0`.'],
      cpp: ['`priority_queue<int>` is already the max-heap `small`; `large` needs `greater<int>`. `(a + b) / 2` truncates — use `/ 2.0`.'],
    },
  },
};
