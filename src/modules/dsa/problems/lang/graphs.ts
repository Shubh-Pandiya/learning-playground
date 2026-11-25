import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the graphs problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'number-of-islands': {
    java: `
private static final int[][] DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
private char[][] grid;
private int ROWS, COLS;
private boolean[][] visit;
public int numIslands(char[][] grid) {
    this.grid = grid; ROWS = grid.length; COLS = grid[0].length;
    visit = new boolean[ROWS][COLS]; int islands = 0;                @init
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {                             @scan
            if (grid[r][c] == '1' && !visit[r][c]) {                 @newIsland
                bfs(r, c);                                           @callBfs
                islands++;                                           @count
            }
        }
    }
    return islands;                                                  @done
}
private void bfs(int r, int c) {
    Deque<int[]> q = new ArrayDeque<>();                             @bfsStart
    q.add(new int[] {r, c});
    visit[r][c] = true;
    while (!q.isEmpty()) {                                           @while
        int[] cell = q.poll(); int row = cell[0], col = cell[1];     @pop
        for (int[] d : DIRS) {
            int nr = row + d[0], nc = col + d[1];
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] == '1' && !visit[nr][nc]) {   @check
                q.add(new int[] {nr, nc});                           @push
                visit[nr][nc] = true;
            }
        }
    }
}
`,
    cpp: `
vector<pair<int, int>> DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
int ROWS, COLS;
vector<vector<bool>> visit;
int numIslands(vector<vector<char>>& grid) {
    ROWS = grid.size(); COLS = grid[0].size();
    visit.assign(ROWS, vector<bool>(COLS, false)); int islands = 0;  @init
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {                             @scan
            if (grid[r][c] == '1' && !visit[r][c]) {                 @newIsland
                bfs(grid, r, c);                                     @callBfs
                islands++;                                           @count
            }
        }
    }
    return islands;                                                  @done
}
void bfs(vector<vector<char>>& grid, int r, int c) {
    queue<pair<int, int>> q;                                         @bfsStart
    q.push({r, c});
    visit[r][c] = true;
    while (!q.empty()) {                                             @while
        auto [row, col] = q.front(); q.pop();                        @pop
        for (auto [dr, dc] : DIRS) {
            int nr = row + dr, nc = col + dc;
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] == '1' && !visit[nr][nc]) {   @check
                q.push({nr, nc});                                    @push
                visit[nr][nc] = true;
            }
        }
    }
}
`,
    distractors: [
      { java: "            if (grid[r][c] == '1') {", cpp: "            if (grid[r][c] == '1') {" },
      { java: '                islands++;', cpp: '                islands++;' },
      {
        java: "            if (nr >= 0 && nr <= ROWS && nc >= 0 && nc <= COLS && grid[nr][nc] == '1') {",
        cpp: "            if (nr >= 0 && nr <= ROWS && nc >= 0 && nc <= COLS && grid[nr][nc] == '1') {",
      },
    ],
    gotchas: {
      python: ['The grid holds STRINGS — `grid[r][c] == 1` is always False; compare with `"1"`.'],
      java: ["The grid is `char[][]`: `grid[r][c] == 1` compiles (char widens to int) but is never true — compare with `'1'`."],
      cpp: ["`grid[r][c] == 1` compiles but tests for the control character `\\x01`, not the digit — use `'1'`."],
    },
  },

  'clone-graph': {
    java: `
private Map<Node, Node> oldToNew = new HashMap<>();             @init
public Node cloneGraph(Node node) {
    return node != null ? dfs(node) : null;                     @start
}
private Node dfs(Node node) {
    if (oldToNew.containsKey(node)) {                           @seen
        return oldToNew.get(node);                              @reuse
    }
    Node copy = new Node(node.val);                             @copy
    oldToNew.put(node, copy);                                   @store
    for (Node nei : node.neighbors) {                           @loop
        copy.neighbors.add(dfs(nei));                           @link
    }
    return copy;                                                @ret
}
`,
    cpp: `
unordered_map<Node*, Node*> oldToNew;                           @init
Node* cloneGraph(Node* node) {
    return node ? dfs(node) : nullptr;                          @start
}
Node* dfs(Node* node) {
    if (oldToNew.count(node)) {                                 @seen
        return oldToNew[node];                                  @reuse
    }
    Node* copy = new Node(node->val);                           @copy
    oldToNew[node] = copy;                                      @store
    for (Node* nei : node->neighbors) {                         @loop
        copy->neighbors.push_back(dfs(nei));                    @link
    }
    return copy;                                                @ret
}
`,
    distractors: [
      { java: '    copy.neighbors = node.neighbors;', cpp: '    copy->neighbors = node->neighbors;' },
      { java: '        copy.neighbors.add(new Node(nei.val));', cpp: '        copy->neighbors.push_back(new Node(nei->val));' },
      { java: '    oldToNew.put(node, new Node(node.val));', cpp: '    oldToNew[node] = new Node(node->val);' },
    ],
    gotchas: {
      java: ['`Node` does not override `equals`/`hashCode`, so the `HashMap` keys by identity — exactly what cloning needs.'],
      cpp: [
        '`oldToNew[node]` on a missing key inserts `nullptr` — test with `count`/`find` first.',
        'Store the copy in the map BEFORE recursing into neighbours, or a cycle recurses forever.',
      ],
    },
  },

  'max-area-of-island': {
    java: `
private int[][] grid;
private int ROWS, COLS;
private boolean[][] visit;
public int maxAreaOfIsland(int[][] grid) {
    this.grid = grid; ROWS = grid.length; COLS = grid[0].length;
    visit = new boolean[ROWS][COLS];                                 @init
    int area = 0;
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {                             @scan
            area = Math.max(area, dfs(r, c));                        @best
        }
    }
    return area;                                                     @done
}
private int dfs(int r, int c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || grid[r][c] == 0 || visit[r][c]) {   @base
        return 0;                                                    @zero
    }
    visit[r][c] = true;                                              @mark
    return 1 + dfs(r + 1, c) + dfs(r - 1, c) + dfs(r, c + 1) + dfs(r, c - 1);   @sum
}
`,
    cpp: `
int ROWS, COLS;
vector<vector<bool>> visit;
int maxAreaOfIsland(vector<vector<int>>& grid) {
    ROWS = grid.size(); COLS = grid[0].size();
    visit.assign(ROWS, vector<bool>(COLS, false));                   @init
    int area = 0;
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {                             @scan
            area = max(area, dfs(grid, r, c));                       @best
        }
    }
    return area;                                                     @done
}
int dfs(vector<vector<int>>& grid, int r, int c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || grid[r][c] == 0 || visit[r][c]) {   @base
        return 0;                                                    @zero
    }
    visit[r][c] = true;                                              @mark
    return 1 + dfs(grid, r + 1, c) + dfs(grid, r - 1, c) + dfs(grid, r, c + 1) + dfs(grid, r, c - 1);   @sum
}
`,
    distractors: [
      {
        java: '    return dfs(r + 1, c) + dfs(r - 1, c) + dfs(r, c + 1) + dfs(r, c - 1);',
        cpp: '    return dfs(grid, r + 1, c) + dfs(grid, r - 1, c) + dfs(grid, r, c + 1) + dfs(grid, r, c - 1);',
      },
      { java: '            area += dfs(r, c);', cpp: '            area += dfs(grid, r, c);' },
      { java: '    if (grid[r][c] == 0 || visit[r][c]) {', cpp: '    if (grid[r][c] == 0 || visit[r][c]) {' },
    ],
    gotchas: {
      python: ['Negative indices wrap around (`grid[-1]` is the last row), so a missing bounds check silently reads the wrong cell.'],
      java: ['Recursion depth can reach R·C on one big island — a 300×300 all-land grid can hit `StackOverflowError`; switch to an explicit stack if needed.'],
      cpp: ['Take `grid` as `vector<vector<int>>&` — by value, every one of the R·C calls copies the whole grid.'],
    },
  },

  'pacific-atlantic-water-flow': {
    java: `
private static final int[][] DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
private int[][] heights;
private int ROWS, COLS;
public List<List<Integer>> pacificAtlantic(int[][] heights) {
    this.heights = heights; ROWS = heights.length; COLS = heights[0].length;
    boolean[][] pac = new boolean[ROWS][COLS], atl = new boolean[ROWS][COLS];   @init
    for (int c = 0; c < COLS; c++) {
        dfs(0, c, pac, heights[0][c]);                               @pacTop
        dfs(ROWS - 1, c, atl, heights[ROWS - 1][c]);                 @atlBottom
    }
    for (int r = 0; r < ROWS; r++) {
        dfs(r, 0, pac, heights[r][0]);                               @pacLeft
        dfs(r, COLS - 1, atl, heights[r][COLS - 1]);                 @atlRight
    }
    List<List<Integer>> res = new ArrayList<>();
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {
            if (pac[r][c] && atl[r][c]) res.add(List.of(r, c));      @result
        }
    }
    return res;
}
private void dfs(int r, int c, boolean[][] visit, int prevHeight) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || visit[r][c] || heights[r][c] < prevHeight) {   @base
        return;                                                      @stop
    }
    visit[r][c] = true;                                              @mark
    for (int[] d : DIRS) {
        dfs(r + d[0], c + d[1], visit, heights[r][c]);               @recurse
    }
}
`,
    cpp: `
vector<pair<int, int>> DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
int ROWS, COLS;
vector<vector<int>> pacificAtlantic(vector<vector<int>>& heights) {
    ROWS = heights.size(); COLS = heights[0].size();
    vector<vector<bool>> pac(ROWS, vector<bool>(COLS)), atl(ROWS, vector<bool>(COLS));   @init
    for (int c = 0; c < COLS; c++) {
        dfs(heights, 0, c, pac, heights[0][c]);                      @pacTop
        dfs(heights, ROWS - 1, c, atl, heights[ROWS - 1][c]);        @atlBottom
    }
    for (int r = 0; r < ROWS; r++) {
        dfs(heights, r, 0, pac, heights[r][0]);                      @pacLeft
        dfs(heights, r, COLS - 1, atl, heights[r][COLS - 1]);        @atlRight
    }
    vector<vector<int>> res;
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {
            if (pac[r][c] && atl[r][c]) res.push_back({r, c});       @result
        }
    }
    return res;
}
void dfs(vector<vector<int>>& heights, int r, int c, vector<vector<bool>>& visit, int prevHeight) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || visit[r][c] || heights[r][c] < prevHeight) {   @base
        return;                                                      @stop
    }
    visit[r][c] = true;                                              @mark
    for (auto [dr, dc] : DIRS) {
        dfs(heights, r + dr, c + dc, visit, heights[r][c]);          @recurse
    }
}
`,
    distractors: [
      {
        java: '    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || visit[r][c] || heights[r][c] > prevHeight) {',
        cpp: '    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || visit[r][c] || heights[r][c] > prevHeight) {',
      },
      {
        java: '    for (int r = 0; r < ROWS; r++) {\n        for (int c = 0; c < COLS; c++) {\n            dfs(r, c, new boolean[ROWS][COLS], heights[r][c]);',
        cpp: '    for (int r = 0; r < ROWS; r++) {\n        for (int c = 0; c < COLS; c++) {\n            vector<vector<bool>> seen(ROWS, vector<bool>(COLS)); dfs(heights, r, c, seen, heights[r][c]);',
      },
      { java: '        dfs(0, c, atl, heights[0][c]);', cpp: '        dfs(heights, 0, c, atl, heights[0][c]);' },
    ],
    gotchas: {
      java: ['Unlike the Python set test, `visit[r][c]` indexes an array — the bounds checks must come first in the `||` chain.'],
      cpp: ['`visit` must be `vector<vector<bool>>&`: by value, each call marks a private copy, so equal-height plateaus recurse forever.'],
    },
  },

  'surrounded-regions': {
    java: `
private static final int[][] DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
private char[][] board;
private int ROWS, COLS;
public void solve(char[][] board) {
    this.board = board; ROWS = board.length; COLS = board[0].length;
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {
            if (board[r][c] == 'O' && (r == 0 || r == ROWS - 1 || c == 0 || c == COLS - 1)) {   @border
                capture(r, c);                                       @capture
            }
        }
    }
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {                             @sweep
            if (board[r][c] == 'O') {
                board[r][c] = 'X';                                   @toX
            } else if (board[r][c] == 'T') {
                board[r][c] = 'O';                                   @toO
            }
        }
    }
}
private void capture(int r, int c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] != 'O') {   @base
        return;
    }
    board[r][c] = 'T';                                               @mark
    for (int[] d : DIRS) {
        capture(r + d[0], c + d[1]);                                 @recurse
    }
}
`,
    cpp: `
vector<pair<int, int>> DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
int ROWS, COLS;
void solve(vector<vector<char>>& board) {
    ROWS = board.size(); COLS = board[0].size();
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {
            if (board[r][c] == 'O' && (r == 0 || r == ROWS - 1 || c == 0 || c == COLS - 1)) {   @border
                capture(board, r, c);                                @capture
            }
        }
    }
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {                             @sweep
            if (board[r][c] == 'O') {
                board[r][c] = 'X';                                   @toX
            } else if (board[r][c] == 'T') {
                board[r][c] = 'O';                                   @toO
            }
        }
    }
}
void capture(vector<vector<char>>& board, int r, int c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] != 'O') {   @base
        return;
    }
    board[r][c] = 'T';                                               @mark
    for (auto [dr, dc] : DIRS) {
        capture(board, r + dr, c + dc);                              @recurse
    }
}
`,
    distractors: [
      {
        java: "            if (board[r][c] == 'T') board[r][c] = 'O';\n            if (board[r][c] == 'O') board[r][c] = 'X';",
        cpp: "            if (board[r][c] == 'T') board[r][c] = 'O';\n            if (board[r][c] == 'O') board[r][c] = 'X';",
      },
      { java: "            if (board[r][c] == 'O') {\n                capture(r, c);", cpp: "            if (board[r][c] == 'O') {\n                capture(board, r, c);" },
      { java: "    board[r][c] = 'X';", cpp: "    board[r][c] = 'X';" },
    ],
    gotchas: {
      java: ["Cells are `char`s: compare with `'O'` (letter O, single quotes) — `\"O\"` is a `String` and will not compile against a `char`."],
      cpp: ["`board[r][c] == \"O\"` compares a `char` with a `const char*` and fails to compile — use `'O'`; also watch letter `'O'` vs digit `'0'`."],
    },
  },

  'rotting-oranges': {
    java: `
private static final int[][] DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
public int orangesRotting(int[][] grid) {
    int ROWS = grid.length, COLS = grid[0].length;
    Deque<int[]> q = new ArrayDeque<>(); int fresh = 0, time = 0;    @init
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {
            if (grid[r][c] == 1) fresh++;
            if (grid[r][c] == 2) q.add(new int[] {r, c});           @seed
        }
    }
    while (!q.isEmpty() && fresh > 0) {                              @while
        for (int k = q.size(); k > 0; k--) {                         @level
            int[] cell = q.poll(); int r = cell[0], c = cell[1];     @pop
            for (int[] d : DIRS) {
                int nr = r + d[0], nc = c + d[1];
                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] == 1) {   @check
                    grid[nr][nc] = 2;                                @rot
                    q.add(new int[] {nr, nc});
                    fresh--;
                }
            }
        }
        time++;                                                      @tick
    }
    return fresh == 0 ? time : -1;                                   @done
}
`,
    cpp: `
vector<pair<int, int>> DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
int orangesRotting(vector<vector<int>>& grid) {
    int ROWS = grid.size(), COLS = grid[0].size();
    queue<pair<int, int>> q; int fresh = 0, time = 0;                @init
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {
            if (grid[r][c] == 1) fresh++;
            if (grid[r][c] == 2) q.push({r, c});                     @seed
        }
    }
    while (!q.empty() && fresh > 0) {                                @while
        for (int k = q.size(); k > 0; k--) {                         @level
            auto [r, c] = q.front(); q.pop();                        @pop
            for (auto [dr, dc] : DIRS) {
                int nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] == 1) {   @check
                    grid[nr][nc] = 2;                                @rot
                    q.push({nr, nc});
                    fresh--;
                }
            }
        }
        time++;                                                      @tick
    }
    return fresh == 0 ? time : -1;                                   @done
}
`,
    distractors: [
      { java: '    while (!q.isEmpty()) {', cpp: '    while (!q.empty()) {' },
      {
        java: '        int[] cell = q.poll(); int r = cell[0], c = cell[1];\n        time++;',
        cpp: '        auto [r, c] = q.front(); q.pop();\n        time++;',
      },
      {
        java: '                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] != 0) {',
        cpp: '                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] != 0) {',
      },
    ],
    gotchas: {
      python: ['`for _ in range(len(q))` evaluates `len(q)` ONCE, so oranges appended during the level wait for the next minute.'],
      java: ['Snapshot the level size first (`for (int k = q.size(); k > 0; k--)`); `i < q.size()` re-reads the growing queue and merges minutes.'],
      cpp: ['Same trap: `for (int i = 0; i < q.size(); i++)` re-evaluates `q.size()` each pass — capture the size before the level loop.'],
    },
  },

  'walls-and-gates': {
    java: `
private static final int[][] DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
private int[][] rooms;
private int ROWS, COLS;
private boolean[][] visit;
private Deque<int[]> q;
public void wallsAndGates(int[][] rooms) {
    this.rooms = rooms; ROWS = rooms.length; COLS = rooms[0].length;
    visit = new boolean[ROWS][COLS]; q = new ArrayDeque<>();         @init
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {
            if (rooms[r][c] == 0) {
                q.add(new int[] {r, c});                             @seed
                visit[r][c] = true;
            }
        }
    }
    int dist = 0;
    while (!q.isEmpty()) {                                           @while
        for (int k = q.size(); k > 0; k--) {                         @level
            int[] cell = q.poll(); int r = cell[0], c = cell[1];     @pop
            rooms[r][c] = dist;                                      @set
            for (int[] d : DIRS) {
                addRoom(r + d[0], c + d[1]);                         @expand
            }
        }
        dist++;                                                      @inc
    }
}
private void addRoom(int r, int c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || visit[r][c] || rooms[r][c] == -1) {   @guard
        return;
    }
    visit[r][c] = true;
    q.add(new int[] {r, c});                                         @add
}
`,
    cpp: `
vector<pair<int, int>> DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
int ROWS, COLS;
vector<vector<bool>> visit;
queue<pair<int, int>> q;
void wallsAndGates(vector<vector<int>>& rooms) {
    ROWS = rooms.size(); COLS = rooms[0].size();
    visit.assign(ROWS, vector<bool>(COLS, false)); q = {};           @init
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {
            if (rooms[r][c] == 0) {
                q.push({r, c});                                      @seed
                visit[r][c] = true;
            }
        }
    }
    int dist = 0;
    while (!q.empty()) {                                             @while
        for (int k = q.size(); k > 0; k--) {                         @level
            auto [r, c] = q.front(); q.pop();                        @pop
            rooms[r][c] = dist;                                      @set
            for (auto [dr, dc] : DIRS) {
                addRoom(rooms, r + dr, c + dc);                      @expand
            }
        }
        dist++;                                                      @inc
    }
}
void addRoom(vector<vector<int>>& rooms, int r, int c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || visit[r][c] || rooms[r][c] == -1) {   @guard
        return;
    }
    visit[r][c] = true;
    q.push({r, c});                                                  @add
}
`,
    distractors: [
      { java: '            rooms[r][c] = Math.min(rooms[r][c], dist);', cpp: '            rooms[r][c] = min(rooms[r][c], dist);' },
      { java: '    for (int[] gate : gates) {\n        bfs(gate);', cpp: '    for (auto& gate : gates) {\n        bfs(gate);' },
      {
        java: '    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || rooms[r][c] == -1) {',
        cpp: '    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || rooms[r][c] == -1) {',
      },
    ],
    gotchas: {
      java: ['Mark `visit` when ENQUEUEING (in `addRoom`), not when polling — otherwise one room is queued once per neighbour in the same wave.'],
      cpp: ['`auto [r, c] = q.front()` must COPY before `q.pop()`; `auto& [r, c] = q.front()` would dangle once the element is popped.'],
    },
  },

  'course-schedule': {
    java: `
public boolean canFinish(int numCourses, int[][] prerequisites) {
    List<List<Integer>> adj = new ArrayList<>();
    for (int i = 0; i < numCourses; i++) adj.add(new ArrayList<>());
    int[] indeg = new int[numCourses];                                @init
    for (int[] p : prerequisites) {
        int crs = p[0], pre = p[1];
        adj.get(pre).add(crs);                                        @edge
        indeg[crs]++;
    }
    Deque<Integer> q = new ArrayDeque<>();
    for (int c = 0; c < numCourses; c++) {
        if (indeg[c] == 0) q.add(c);                                  @seed
    }
    int taken = 0;
    while (!q.isEmpty()) {                                            @while
        int node = q.poll();                                          @pop
        taken++;
        for (int nei : adj.get(node)) {                               @loop
            indeg[nei]--;                                             @dec
            if (indeg[nei] == 0) {
                q.add(nei);                                           @push
            }
        }
    }
    return taken == numCourses;                                       @done
}
`,
    cpp: `
bool canFinish(int numCourses, vector<vector<int>>& prerequisites) {
    vector<vector<int>> adj(numCourses);
    vector<int> indeg(numCourses, 0);                                 @init
    for (auto& p : prerequisites) {
        int crs = p[0], pre = p[1];
        adj[pre].push_back(crs);                                      @edge
        indeg[crs]++;
    }
    queue<int> q;
    for (int c = 0; c < numCourses; c++) {
        if (indeg[c] == 0) q.push(c);                                 @seed
    }
    int taken = 0;
    while (!q.empty()) {                                              @while
        int node = q.front(); q.pop();                                @pop
        taken++;
        for (int nei : adj[node]) {                                   @loop
            indeg[nei]--;                                             @dec
            if (indeg[nei] == 0) {
                q.push(nei);                                          @push
            }
        }
    }
    return taken == numCourses;                                       @done
}
`,
    distractors: [
      { java: '        adj.get(crs).add(pre);', cpp: '        adj[crs].push_back(pre);' },
      { java: '            if (indeg[nei] <= 1) {', cpp: '            if (indeg[nei] <= 1) {' },
      { java: '    return q.isEmpty();', cpp: '    return q.empty();' },
    ],
    gotchas: {
      java: ['`new ArrayList[numCourses]` (generic array) gives unchecked warnings — a `List<List<Integer>>` filled in a loop is the clean adjacency list.'],
      cpp: ['`q.pop()` returns `void` — read `q.front()` first, then pop.'],
    },
  },

  'course-schedule-ii': {
    java: `
private List<List<Integer>> prereq;
private List<Integer> output;
private Set<Integer> visit, cycle;
public int[] findOrder(int numCourses, int[][] prerequisites) {
    prereq = new ArrayList<>();
    for (int c = 0; c < numCourses; c++) prereq.add(new ArrayList<>());
    for (int[] p : prerequisites) {
        int crs = p[0], pre = p[1];
        prereq.get(crs).add(pre);                                     @build
    }
    output = new ArrayList<>(); visit = new HashSet<>(); cycle = new HashSet<>();   @init
    for (int c = 0; c < numCourses; c++) {                            @outer
        if (!dfs(c)) {
            return new int[0];                                        @noOrder
        }
    }
    return output.stream().mapToInt(Integer::intValue).toArray();     @ret
}
private boolean dfs(int crs) {
    if (cycle.contains(crs)) {                                        @inCycle
        return false;                                                 @fail
    }
    if (visit.contains(crs)) {                                        @isDone
        return true;                                                  @skip
    }
    cycle.add(crs);                                                   @enter
    for (int pre : prereq.get(crs)) {                                 @loop
        if (!dfs(pre)) {                                              @recurse
            return false;
        }
    }
    cycle.remove(crs);                                                @leave
    visit.add(crs);
    output.add(crs);                                                  @emit
    return true;
}
`,
    cpp: `
vector<vector<int>> prereq;
vector<int> output;
unordered_set<int> visit, cycle;
vector<int> findOrder(int numCourses, vector<vector<int>>& prerequisites) {
    prereq.assign(numCourses, {});
    for (auto& p : prerequisites) {
        int crs = p[0], pre = p[1];
        prereq[crs].push_back(pre);                                   @build
    }
    output.clear(); visit.clear(); cycle.clear();                     @init
    for (int c = 0; c < numCourses; c++) {                            @outer
        if (!dfs(c)) {
            return {};                                                @noOrder
        }
    }
    return output;                                                    @ret
}
bool dfs(int crs) {
    if (cycle.count(crs)) {                                           @inCycle
        return false;                                                 @fail
    }
    if (visit.count(crs)) {                                           @isDone
        return true;                                                  @skip
    }
    cycle.insert(crs);                                                @enter
    for (int pre : prereq[crs]) {                                     @loop
        if (!dfs(pre)) {                                              @recurse
            return false;
        }
    }
    cycle.erase(crs);                                                 @leave
    visit.insert(crs);
    output.push_back(crs);                                            @emit
    return true;
}
`,
    distractors: [
      { java: '    output.add(crs);\n    for (int pre : prereq.get(crs)) {', cpp: '    output.push_back(crs);\n    for (int pre : prereq[crs]) {' },
      { java: '    if (visit.contains(crs)) {\n        return false;', cpp: '    if (visit.count(crs)) {\n        return false;' },
      { java: '    visit.add(crs);\n    cycle.add(crs);', cpp: '    visit.insert(crs);\n    cycle.insert(crs);' },
    ],
    gotchas: {
      java: ['If `cycle` were a `List<Integer>`, `cycle.remove(crs)` with an `int` would remove by INDEX — a `Set` has only `remove(Object)`.'],
      cpp: ['Deep prerequisite chains mean deep recursion; for ~10⁵ courses prefer Kahn\'s BFS to avoid a stack overflow.'],
    },
  },

  'redundant-connection': {
    java: `
private int[] par, rank;
public int[] findRedundantConnection(int[][] edges) {
    par = new int[edges.length + 1];
    for (int i = 0; i < par.length; i++) par[i] = i;
    rank = new int[edges.length + 1]; Arrays.fill(rank, 1);         @init
    for (int[] e : edges) {                                           @loop
        int a = e[0], b = e[1];
        int ra = find(a), rb = find(b);                               @find
        if (ra == rb) {                                               @same
            return new int[] {a, b};                                  @found
        }
        if (rank[ra] < rank[rb]) {                                    @rank
            int tmp = ra; ra = rb; rb = tmp;
        }
        par[rb] = ra;                                                 @link
        rank[ra] += rank[rb];
    }
    return new int[0];
}
private int find(int x) {
    while (x != par[x]) {                                             @climb
        par[x] = par[par[x]];                                         @compress
        x = par[x];
    }
    return x;
}
`,
    cpp: `
vector<int> par, rank;
vector<int> findRedundantConnection(vector<vector<int>>& edges) {
    par.resize(edges.size() + 1);
    iota(par.begin(), par.end(), 0);
    rank.assign(edges.size() + 1, 1);                                 @init
    for (auto& e : edges) {                                           @loop
        int a = e[0], b = e[1];
        int ra = find(a), rb = find(b);                               @find
        if (ra == rb) {                                               @same
            return {a, b};                                            @found
        }
        if (rank[ra] < rank[rb]) {                                    @rank
            swap(ra, rb);
        }
        par[rb] = ra;                                                 @link
        rank[ra] += rank[rb];
    }
    return {};
}
int find(int x) {
    while (x != par[x]) {                                             @climb
        par[x] = par[par[x]];                                         @compress
        x = par[x];
    }
    return x;
}
`,
    distractors: [
      { java: '        if (par[a] == par[b]) {', cpp: '        if (par[a] == par[b]) {' },
      { java: '        par[a] = b;', cpp: '        par[a] = b;' },
      { java: '    for (int i = edges.length - 1; i >= 0; i--) {', cpp: '    for (int i = (int)edges.size() - 1; i >= 0; i--) {' },
    ],
    gotchas: {
      java: ['Java has no tuple swap — `ra, rb = rb, ra` needs a temp variable.'],
      cpp: ['`iota(par.begin(), par.end(), 0)` is the idiomatic `list(range(n))`; `swap(ra, rb)` replaces the tuple swap.'],
    },
  },

  'number-of-connected-components-in-an-undirected-graph': {
    java: `
private int[] par, rank;
public int countComponents(int n, int[][] edges) {
    par = new int[n];
    for (int i = 0; i < n; i++) par[i] = i;
    rank = new int[n]; Arrays.fill(rank, 1);                          @init
    int res = n;                                                      @res
    for (int[] e : edges) {                                           @loop
        res -= union(e[0], e[1]);                                     @merge
    }
    return res;                                                       @done
}
private int find(int x) {
    while (x != par[x]) {                                             @climb
        par[x] = par[par[x]];                                         @compress
        x = par[x];
    }
    return x;
}
private int union(int a, int b) {
    int ra = find(a), rb = find(b);                                   @find
    if (ra == rb) {                                                   @same
        return 0;                                                     @noMerge
    }
    if (rank[ra] < rank[rb]) {                                        @rank
        int tmp = ra; ra = rb; rb = tmp;
    }
    par[rb] = ra;                                                     @link
    rank[ra] += rank[rb];
    return 1;
}
`,
    cpp: `
vector<int> par, rank;
int countComponents(int n, vector<vector<int>>& edges) {
    par.resize(n);
    iota(par.begin(), par.end(), 0);
    rank.assign(n, 1);                                                @init
    int res = n;                                                      @res
    for (auto& e : edges) {                                           @loop
        res -= unite(e[0], e[1]);                                     @merge
    }
    return res;                                                       @done
}
int find(int x) {
    while (x != par[x]) {                                             @climb
        par[x] = par[par[x]];                                         @compress
        x = par[x];
    }
    return x;
}
int unite(int a, int b) {
    int ra = find(a), rb = find(b);                                   @find
    if (ra == rb) {                                                   @same
        return 0;                                                     @noMerge
    }
    if (rank[ra] < rank[rb]) {                                        @rank
        swap(ra, rb);
    }
    par[rb] = ra;                                                     @link
    rank[ra] += rank[rb];
    return 1;
}
`,
    distractors: [
      { java: '        res -= 1;', cpp: '        res -= 1;' },
      { java: '    return (int) Arrays.stream(par).distinct().count();', cpp: '    return (int)unordered_set<int>(par.begin(), par.end()).size();' },
    ],
    gotchas: {
      cpp: ['`union` is a C++ keyword, so the merge helper is named `unite`.'],
      java: ['Counting distinct values of `par` over-counts — only `find(x)` gives the true root of each node.'],
    },
  },

  'graph-valid-tree': {
    java: `
private int[] par;
public boolean validTree(int n, int[][] edges) {
    if (edges.length != n - 1) {                                      @count
        return false;                                                 @countFail
    }
    par = new int[n];                                                 @init
    for (int i = 0; i < n; i++) par[i] = i;
    for (int[] e : edges) {                                           @loop
        int ra = find(e[0]), rb = find(e[1]);                         @find
        if (ra == rb) {                                               @same
            return false;                                             @cycle
        }
        par[ra] = rb;                                                 @union
    }
    return true;                                                      @ok
}
private int find(int x) {
    while (x != par[x]) {                                             @climb
        par[x] = par[par[x]];                                         @compress
        x = par[x];
    }
    return x;
}
`,
    cpp: `
vector<int> par;
bool validTree(int n, vector<vector<int>>& edges) {
    if ((int)edges.size() != n - 1) {                                 @count
        return false;                                                 @countFail
    }
    par.resize(n);                                                    @init
    iota(par.begin(), par.end(), 0);
    for (auto& e : edges) {                                           @loop
        int ra = find(e[0]), rb = find(e[1]);                         @find
        if (ra == rb) {                                               @same
            return false;                                             @cycle
        }
        par[ra] = rb;                                                 @union
    }
    return true;                                                      @ok
}
int find(int x) {
    while (x != par[x]) {                                             @climb
        par[x] = par[par[x]];                                         @compress
        x = par[x];
    }
    return x;
}
`,
    distractors: [
      { java: '    if (edges.length > n - 1) {', cpp: '    if ((int)edges.size() > n - 1) {' },
      { java: '        par[e[0]] = e[1];', cpp: '        par[e[0]] = e[1];' },
    ],
    gotchas: {
      java: ['`n - 1` edges alone is not enough (a cycle plus an isolated node also has n − 1 edges) — the union-find cycle check is still required.'],
      cpp: ['`edges.size()` is an unsigned `size_t` — cast it, `(int)edges.size() != n - 1`, so the comparison is done in signed `int`.'],
    },
  },

  'word-ladder': {
    java: `
public int ladderLength(String beginWord, String endWord, List<String> wordList) {
    if (!wordList.contains(endWord)) {                                @noEnd
        return 0;
    }
    Map<String, List<String>> nei = new HashMap<>();
    wordList.add(beginWord);
    for (String word : wordList) {
        for (int j = 0; j < word.length(); j++) {
            String pattern = word.substring(0, j) + "*" + word.substring(j + 1);
            nei.computeIfAbsent(pattern, k -> new ArrayList<>()).add(word);   @bucket
        }
    }
    Set<String> visit = new HashSet<>(); Deque<String> q = new ArrayDeque<>();   @init
    visit.add(beginWord); q.add(beginWord);
    int res = 1;
    while (!q.isEmpty()) {                                            @while
        for (int k = q.size(); k > 0; k--) {                          @level
            String word = q.poll();                                   @pop
            if (word.equals(endWord)) {                               @check
                return res;                                           @found
            }
            for (int j = 0; j < word.length(); j++) {
                String pattern = word.substring(0, j) + "*" + word.substring(j + 1);   @pattern
                for (String neiWord : nei.get(pattern)) {
                    if (!visit.contains(neiWord)) {                   @unseen
                        visit.add(neiWord);
                        q.add(neiWord);                               @push
                    }
                }
            }
        }
        res++;                                                        @next
    }
    return 0;                                                         @none
}
`,
    cpp: `
int ladderLength(string beginWord, string endWord, vector<string>& wordList) {
    if (find(wordList.begin(), wordList.end(), endWord) == wordList.end()) {   @noEnd
        return 0;
    }
    unordered_map<string, vector<string>> nei;
    wordList.push_back(beginWord);
    for (const string& word : wordList) {
        for (int j = 0; j < (int)word.size(); j++) {
            string pattern = word.substr(0, j) + "*" + word.substr(j + 1);
            nei[pattern].push_back(word);                             @bucket
        }
    }
    unordered_set<string> visit = {beginWord}; queue<string> q;       @init
    q.push(beginWord);
    int res = 1;
    while (!q.empty()) {                                              @while
        for (int k = q.size(); k > 0; k--) {                          @level
            string word = q.front(); q.pop();                         @pop
            if (word == endWord) {                                    @check
                return res;                                           @found
            }
            for (int j = 0; j < (int)word.size(); j++) {
                string pattern = word.substr(0, j) + "*" + word.substr(j + 1);   @pattern
                for (const string& neiWord : nei[pattern]) {
                    if (!visit.count(neiWord)) {                      @unseen
                        visit.insert(neiWord);
                        q.push(neiWord);                              @push
                    }
                }
            }
        }
        res++;                                                        @next
    }
    return 0;                                                         @none
}
`,
    distractors: [
      { java: '            for (String neiWord : wordList) {', cpp: '            for (const string& neiWord : wordList) {' },
      { java: '            res++;', cpp: '            res++;' },
      { java: '        String word = q.pollLast();', cpp: '        string word = q.back(); q.pop();' },
    ],
    gotchas: {
      java: [
        'Compare words with `word.equals(endWord)` — `==` compares String references.',
        'On an `ArrayDeque`, `push` adds at the HEAD (stack); for BFS use `add`/`offer` with `poll`.',
      ],
      cpp: ['`wordList.push_back(beginWord)` while range-iterating `wordList` would invalidate iterators — push it BEFORE the bucketing loop, as here.'],
    },
  },
};
