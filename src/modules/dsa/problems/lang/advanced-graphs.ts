import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the advanced-graphs problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'reconstruct-itinerary': {
    java: `
private Map<String, List<String>> adj;
private List<String> res;

public List<String> findItinerary(List<List<String>> tickets) {
    adj = new HashMap<>();
    tickets.sort((a, b) -> b.get(1).compareTo(a.get(1)));
    for (List<String> t : tickets) {                  @build
        String src = t.get(0), dst = t.get(1);
        adj.computeIfAbsent(src, x -> new ArrayList<>()).add(dst);
    }
    res = new ArrayList<>();                          @init
    dfs("JFK");                                       @start
    Collections.reverse(res);                         @reverse
    return res;
}

private void dfs(String src) {
    List<String> dests = adj.getOrDefault(src, List.of());
    while (!dests.isEmpty()) {                        @while
        String dst = dests.remove(dests.size() - 1);  @take
        dfs(dst);                                     @fly
    }
    res.add(src);                                     @emit
}
`,
    cpp: `
unordered_map<string, vector<string>> adj;
vector<string> res;

vector<string> findItinerary(vector<vector<string>>& tickets) {
    adj.clear();
    sort(tickets.rbegin(), tickets.rend());
    for (auto& t : tickets) {          @build
        adj[t[0]].push_back(t[1]);
    }
    res.clear();                       @init
    dfs("JFK");                        @start
    reverse(res.begin(), res.end());   @reverse
    return res;
}

void dfs(const string& src) {
    while (!adj[src].empty()) {        @while
        string dst = adj[src].back();  @take
        adj[src].pop_back();
        dfs(dst);                      @fly
    }
    res.push_back(src);                @emit
}
`,
    distractors: [
      { java: '    res.add(src);\n    while (!dests.isEmpty()) {', cpp: '    res.push_back(src);\n    while (!adj[src].empty()) {' },
      { java: '        String dst = dests.remove(0);', cpp: '        string dst = adj[src].front();\n        adj[src].erase(adj[src].begin());' },
      { java: '    return res;', cpp: '    return res;' },
    ],
    gotchas: {
      python: ['`sorted(tickets, reverse=True)` + `list.pop()` gives the smallest destination in O(1); `pop(0)` on an ascending list would be O(n).'],
      java: ['`List.remove(int index)` removes by position but `remove(Object)` by value — `dests.remove(dests.size() - 1)` picks the index overload; a `PriorityQueue<String>` per airport with `poll()` is the common alternative.'],
      cpp: ['`sort(tickets.rbegin(), tickets.rend())` sorts descending so `back()` / `pop_back()` yields the lexically smallest destination; copy `dst` before `pop_back()` — a reference to `back()` dangles.'],
    },
  },

  'min-cost-to-connect-all-points': {
    java: `
public int minCostConnectPoints(int[][] points) {
    int N = points.length;
    List<List<int[]>> adj = new ArrayList<>();
    for (int i = 0; i < N; i++) adj.add(new ArrayList<>());
    for (int i = 0; i < N; i++) {
        for (int j = i + 1; j < N; j++) {
            int dist = Math.abs(points[i][0] - points[j][0]) + Math.abs(points[i][1] - points[j][1]);
            adj.get(i).add(new int[] { dist, j }); adj.get(j).add(new int[] { dist, i });  @build
        }
    }
    int res = 0;
    Set<Integer> visit = new HashSet<>();
    PriorityQueue<int[]> minH = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));
    minH.add(new int[] { 0, 0 });                      @init
    while (visit.size() < N) {                         @while
        int[] top = minH.poll();                       @pop
        int cost = top[0], i = top[1];
        if (visit.contains(i)) {                       @skip
            continue;
        }
        res += cost;                                   @add
        visit.add(i);
        for (int[] e : adj.get(i)) {
            int neiCost = e[0], nei = e[1];
            if (!visit.contains(nei)) {
                minH.add(new int[] { neiCost, nei });  @push
            }
        }
    }
    return res;                                        @done
}
`,
    cpp: `
int minCostConnectPoints(vector<vector<int>>& points) {
    int N = points.size();
    vector<vector<pair<int, int>>> adj(N);
    for (int i = 0; i < N; i++) {
        for (int j = i + 1; j < N; j++) {
            int dist = abs(points[i][0] - points[j][0]) + abs(points[i][1] - points[j][1]);
            adj[i].push_back({ dist, j }); adj[j].push_back({ dist, i });  @build
        }
    }
    int res = 0;
    unordered_set<int> visit;
    priority_queue<pair<int, int>, vector<pair<int, int>>, greater<>> minH;
    minH.push({ 0, 0 });                          @init
    while ((int)visit.size() < N) {               @while
        auto [cost, i] = minH.top(); minH.pop();  @pop
        if (visit.count(i)) {                     @skip
            continue;
        }
        res += cost;                              @add
        visit.insert(i);
        for (auto& [neiCost, nei] : adj[i]) {
            if (!visit.count(nei)) {
                minH.push({ neiCost, nei });      @push
            }
        }
    }
    return res;                                   @done
}
`,
    distractors: [
      { java: '        res += cost;\n        if (visit.contains(i)) {', cpp: '        res += cost;\n        if (visit.count(i)) {' },
      { java: '    for (int i = 0; i < N; i++) minH.add(new int[] { 0, i });', cpp: '    for (int i = 0; i < N; i++) minH.push({ 0, i });' },
      { java: '    while (!minH.isEmpty()) {', cpp: '    while (!minH.empty()) {' },
    ],
    gotchas: {
      python: ['`heapq` compares the lists element by element, so `[cost, node]` orders by cost and breaks ties by node — no comparator needed.'],
      java: ['`PriorityQueue<int[]>` has no natural order — pass `(a, b) -> Integer.compare(a[0], b[0])`; the `a[0] - b[0]` shortcut can overflow on large values.'],
      cpp: ['`priority_queue` is a MAX-heap by default — Prim needs `priority_queue<pair<int, int>, vector<pair<int, int>>, greater<>>` (or push negated costs).'],
    },
  },

  'network-delay-time': {
    java: `
public int networkDelayTime(int[][] times, int n, int k) {
    Map<Integer, List<int[]>> edges = new HashMap<>();
    for (int[] time : times) {
        int u = time[0], v = time[1], w = time[2];
        edges.computeIfAbsent(u, x -> new ArrayList<>()).add(new int[] { v, w });  @build
    }
    PriorityQueue<int[]> minHeap = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));
    Set<Integer> visit = new HashSet<>();
    int t = 0;
    minHeap.add(new int[] { 0, k });                         @init
    while (!minHeap.isEmpty()) {                             @while
        int[] top = minHeap.poll();                          @pop
        int w1 = top[0], n1 = top[1];
        if (visit.contains(n1)) {                            @skip
            continue;
        }
        visit.add(n1);                                       @final
        t = w1;
        for (int[] e : edges.getOrDefault(n1, List.of())) {  @loop
            int n2 = e[0], w2 = e[1];
            if (!visit.contains(n2)) {
                minHeap.add(new int[] { w1 + w2, n2 });      @push
            }
        }
    }
    return visit.size() == n ? t : -1;                       @done
}
`,
    cpp: `
int networkDelayTime(vector<vector<int>>& times, int n, int k) {
    unordered_map<int, vector<pair<int, int>>> edges;
    for (auto& time : times) {
        int u = time[0], v = time[1], w = time[2];
        edges[u].push_back({ v, w });                  @build
    }
    priority_queue<pair<int, int>, vector<pair<int, int>>, greater<>> minHeap;
    unordered_set<int> visit;
    int t = 0;
    minHeap.push({ 0, k });                            @init
    while (!minHeap.empty()) {                         @while
        auto [w1, n1] = minHeap.top(); minHeap.pop();  @pop
        if (visit.count(n1)) {                         @skip
            continue;
        }
        visit.insert(n1);                              @final
        t = w1;
        for (auto& [n2, w2] : edges[n1]) {             @loop
            if (!visit.count(n2)) {
                minHeap.push({ w1 + w2, n2 });         @push
            }
        }
    }
    return (int)visit.size() == n ? t : -1;            @done
}
`,
    distractors: [
      { java: '                visit.add(n2);', cpp: '                visit.insert(n2);' },
      { java: '        t += w1;', cpp: '        t += w1;' },
      { java: '        int[] top = minHeap.remove(minHeap.size() - 1);', cpp: '        auto [w1, n1] = minHeap.back(); minHeap.pop_back();' },
    ],
    gotchas: {
      python: ['`heapq` is a min-heap of tuples ordered by the first field, so push `(distance, node)` — distance first.'],
      java: [
        '`PriorityQueue<int[]>` needs a comparator: `(a, b) -> Integer.compare(a[0], b[0])`.',
        'With a `dist[]` array initialised to `Integer.MAX_VALUE`, `dist[u] + w` overflows to a negative number — skip unreached nodes first.',
      ],
      cpp: [
        '`priority_queue` is a MAX-heap: use `greater<>` (or push `-dist`) or Dijkstra pops the FARTHEST node.',
        'The heap keeps stale entries for already-finalised nodes — skip them with the `visit` check instead of trying to decrease-key.',
      ],
    },
  },

  'swim-in-rising-water': {
    java: `
public int swimInWater(int[][] grid) {
    int N = grid.length;
    boolean[][] visit = new boolean[N][N];
    visit[0][0] = true;
    PriorityQueue<int[]> minH = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));
    minH.add(new int[] { grid[0][0], 0, 0 });  @init
    int[][] dirs = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } };
    while (!minH.isEmpty()) {                  @while
        int[] top = minH.poll();               @pop
        int t = top[0], r = top[1], c = top[2];
        if (r == N - 1 && c == N - 1) {        @goal
            return t;                          @done
        }
        for (int[] d : dirs) {
            int nr = r + d[0], nc = c + d[1];
            if (nr >= 0 && nr < N && nc >= 0 && nc < N && !visit[nr][nc]) {  @check
                visit[nr][nc] = true;
                minH.add(new int[] { Math.max(t, grid[nr][nc]), nr, nc });  @push
            }
        }
    }
    return -1;
}
`,
    cpp: `
int swimInWater(vector<vector<int>>& grid) {
    int N = grid.size();
    vector<vector<bool>> visit(N, vector<bool>(N, false));
    visit[0][0] = true;
    priority_queue<tuple<int, int, int>, vector<tuple<int, int, int>>, greater<>> minH;
    minH.push({ grid[0][0], 0, 0 });                          @init
    vector<pair<int, int>> dirs = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } };
    while (!minH.empty()) {                                   @while
        auto [t, r, c] = minH.top(); minH.pop();              @pop
        if (r == N - 1 && c == N - 1) {                       @goal
            return t;                                         @done
        }
        for (auto& [dr, dc] : dirs) {
            int nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < N && nc >= 0 && nc < N && !visit[nr][nc]) {  @check
                visit[nr][nc] = true;
                minH.push({ max(t, grid[nr][nc]), nr, nc });  @push
            }
        }
    }
    return -1;
}
`,
    distractors: [
      { java: '                minH.add(new int[] { t + grid[nr][nc], nr, nc });', cpp: '                minH.push({ t + grid[nr][nc], nr, nc });' },
      { java: '        if (r == N - 1 && c == N - 1) {\n            return grid[r][c];', cpp: '        if (r == N - 1 && c == N - 1) {\n            return grid[r][c];' },
    ],
    gotchas: {
      python: ['Python chains comparisons (`0 <= nr < N`); Java and C++ need `nr >= 0 && nr < N`.'],
      java: ['A `Set<int[]>` compares arrays by identity, so `contains(new int[] {r, c})` is always false — use `boolean[][]` or encode `r * N + c`.'],
      cpp: ['`unordered_set<pair<int, int>>` does not compile (no `std::hash` for pair) — use `vector<vector<bool>>`; and `priority_queue` needs `greater<>` to be a min-heap.'],
    },
  },

  'alien-dictionary': {
    java: `
public String alienOrder(String[] words) {
    Map<Character, Set<Character>> adj = new HashMap<>();
    for (String w : words) for (char c : w.toCharArray()) adj.putIfAbsent(c, new HashSet<>());
    Map<Character, Integer> indeg = new HashMap<>();
    for (char c : adj.keySet()) indeg.put(c, 0);                @init
    for (int i = 0; i < words.length - 1; i++) {                @pair
        String w1 = words[i], w2 = words[i + 1];
        int minLen = Math.min(w1.length(), w2.length());
        if (w1.length() > w2.length() && w1.startsWith(w2)) {   @prefix
            return "";                                          @invalid
        }
        for (int j = 0; j < minLen; j++) {                      @cmp
            if (w1.charAt(j) != w2.charAt(j)) {                 @diff
                if (!adj.get(w1.charAt(j)).contains(w2.charAt(j))) {
                    adj.get(w1.charAt(j)).add(w2.charAt(j));    @edge
                    indeg.merge(w2.charAt(j), 1, Integer::sum);
                }
                break;                                          @stop
            }
        }
    }
    Deque<Character> q = new ArrayDeque<>();
    for (char c : indeg.keySet()) if (indeg.get(c) == 0) q.add(c);  @seed
    StringBuilder res = new StringBuilder();
    while (!q.isEmpty()) {                                      @while
        char c = q.poll();                                      @pop
        res.append(c);
        for (char nei : adj.get(c)) {                           @loop
            indeg.merge(nei, -1, Integer::sum);                 @dec
            if (indeg.get(nei) == 0) {
                q.add(nei);                                     @push
            }
        }
    }
    return res.length() == indeg.size() ? res.toString() : "";  @done
}
`,
    cpp: `
string alienOrder(vector<string>& words) {
    unordered_map<char, unordered_set<char>> adj;
    for (auto& w : words) for (char c : w) adj[c];
    unordered_map<char, int> indeg;
    for (auto& [c, nbrs] : adj) indeg[c] = 0;          @init
    for (int i = 0; i < (int)words.size() - 1; i++) {  @pair
        const string &w1 = words[i], &w2 = words[i + 1];
        int minLen = min(w1.size(), w2.size());
        if (w1.size() > w2.size() && w1.substr(0, minLen) == w2.substr(0, minLen)) {  @prefix
            return "";                                 @invalid
        }
        for (int j = 0; j < minLen; j++) {             @cmp
            if (w1[j] != w2[j]) {                      @diff
                if (!adj[w1[j]].count(w2[j])) {
                    adj[w1[j]].insert(w2[j]);          @edge
                    indeg[w2[j]]++;
                }
                break;                                 @stop
            }
        }
    }
    queue<char> q;
    for (auto& [c, d] : indeg) if (d == 0) q.push(c);  @seed
    string res;
    while (!q.empty()) {                               @while
        char c = q.front(); q.pop();                   @pop
        res += c;
        for (char nei : adj[c]) {                      @loop
            indeg[nei]--;                              @dec
            if (indeg[nei] == 0) {
                q.push(nei);                           @push
            }
        }
    }
    return res.size() == indeg.size() ? res : "";      @done
}
`,
    distractors: [
      {
        java: '                adj.get(w1.charAt(j)).add(w2.charAt(j));\n                indeg.merge(w2.charAt(j), 1, Integer::sum);',
        cpp: '                adj[w1[j]].insert(w2[j]);\n                indeg[w2[j]]++;',
      },
      {
        java: '            if (w1.charAt(j) != w2.charAt(j)) {\n                adj.get(w1.charAt(j)).add(w2.charAt(j));',
        cpp: '            if (w1[j] != w2[j]) {\n                adj[w1[j]].insert(w2[j]);',
      },
      {
        java: '    for (int i = 0; i < words.length; i++) {\n        for (int j = i + 1; j < words.length; j++) {',
        cpp: '    for (int i = 0; i < (int)words.size(); i++) {\n        for (int j = i + 1; j < (int)words.size(); j++) {',
      },
    ],
    gotchas: {
      java: [
        '`Set.add` returns false for an existing element, so `if (adj.get(a).add(b)) indeg.merge(b, 1, Integer::sum);` guards duplicate edges in one line.',
        '`HashMap` iteration order is not insertion order (unlike a Python dict), so the output may be a different — still valid — topological order.',
      ],
      cpp: ['`adj[c];` alone default-inserts an empty set — handy for registering every letter, but the same `operator[]` on a lookup silently adds keys.'],
    },
  },

  'cheapest-flights-within-k-stops': {
    java: `
public int findCheapestPrice(int n, int[][] flights, int src, int dst, int k) {
    int[] prices = new int[n];
    Arrays.fill(prices, Integer.MAX_VALUE);
    prices[src] = 0;                                             @init
    for (int i = 0; i < k + 1; i++) {                            @round
        int[] tmpPrices = prices.clone();                        @copy
        for (int[] f : flights) {                                @edge
            int s = f[0], d = f[1], p = f[2];
            if (prices[s] == Integer.MAX_VALUE) {                @unreached
                continue;
            }
            if (prices[s] + p < tmpPrices[d]) {                  @relax
                tmpPrices[d] = prices[s] + p;                    @update
            }
        }
        prices = tmpPrices;                                      @commit
    }
    return prices[dst] == Integer.MAX_VALUE ? -1 : prices[dst];  @done
}
`,
    cpp: `
int findCheapestPrice(int n, vector<vector<int>>& flights, int src, int dst, int k) {
    vector<int> prices(n, INT_MAX);
    prices[src] = 0;                                   @init
    for (int i = 0; i < k + 1; i++) {                  @round
        vector<int> tmpPrices = prices;                @copy
        for (auto& f : flights) {                      @edge
            int s = f[0], d = f[1], p = f[2];
            if (prices[s] == INT_MAX) {                @unreached
                continue;
            }
            if (prices[s] + p < tmpPrices[d]) {        @relax
                tmpPrices[d] = prices[s] + p;          @update
            }
        }
        prices = tmpPrices;                            @commit
    }
    return prices[dst] == INT_MAX ? -1 : prices[dst];  @done
}
`,
    distractors: [
      { java: '                prices[d] = prices[s] + p;', cpp: '                prices[d] = prices[s] + p;' },
      { java: '    for (int i = 0; i < k; i++) {', cpp: '    for (int i = 0; i < k; i++) {' },
      { java: '            if (prices[s] + p < prices[d]) {', cpp: '            if (prices[s] + p < prices[d]) {' },
    ],
    gotchas: {
      python: ['`tmpPrices = prices` would alias the same list — `.copy()` (or `prices[:]`) is what keeps each round independent.'],
      java: [
        '`int[] tmpPrices = prices;` copies only the reference — use `prices.clone()`.',
        '`Integer.MAX_VALUE + p` overflows to a negative price, which is why unreached sources are skipped before relaxing.',
      ],
      cpp: ['`vector<int> tmpPrices = prices;` is a real copy (but `auto& tmpPrices = prices;` aliases); `INT_MAX + p` is signed overflow (UB) — skip unreached sources first.'],
    },
  },
};
