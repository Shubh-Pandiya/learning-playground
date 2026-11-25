import type { Problem, Tone, Variant } from '../engine/types.ts';
import { V, fmt, rc } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type Cell = [number, number];
const DIRS: Cell[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const cs = (r: number, c: number) => `(${r},${c})`;
const inGrid = (r: number, c: number, R: number, C: number) => r >= 0 && r < R && c >= 0 && c < C;

function checkGrid(grid: unknown, max: number, ok: (v: unknown) => boolean, what: string): string | null {
  if (!Array.isArray(grid) || !grid.length || !Array.isArray(grid[0]) || !grid[0].length) return `Expected a non-empty 2-D grid of ${what}`;
  const w = (grid[0] as unknown[]).length;
  if (!grid.every((row) => Array.isArray(row) && row.length === w)) return 'All rows must have the same length';
  if (grid.length > max || w > max) return `Keep the grid ≤ ${max}×${max} so the animation stays readable`;
  if (!grid.every((row: unknown[]) => row.every(ok))) return `Cells must be ${what}`;
  return null;
}

/** Nodes evenly spaced on a circle in the 0..100 layout space. */
function circle(ids: readonly (string | number)[], rad = 38): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  ids.forEach((id, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ids.length);
    out[fmt(id)] = [Math.round(50 + rad * Math.cos(a)), Math.round(50 + rad * Math.sin(a))];
  });
  return out;
}

/** Left-to-right layering by longest path (cycles are capped), for DAG-ish dependency graphs. */
function layered(ids: readonly (string | number)[], edges: readonly (readonly [string | number, string | number])[]): Record<string, [number, number]> {
  const lvl = new Map<string, number>(ids.map((id) => [fmt(id), 0]));
  for (let k = 0; k < ids.length; k++)
    for (const [a, b] of edges) {
      const la = lvl.get(fmt(a)) ?? 0;
      if ((lvl.get(fmt(b)) ?? 0) < la + 1 && la + 1 < ids.length) lvl.set(fmt(b), la + 1);
    }
  const max = Math.max(0, ...lvl.values());
  const cols = new Map<number, string[]>();
  for (const id of ids) {
    const l = lvl.get(fmt(id)) ?? 0;
    cols.set(l, [...(cols.get(l) ?? []), fmt(id)]);
  }
  const out: Record<string, [number, number]> = {};
  for (const [l, col] of cols)
    col.forEach((id, i) => {
      out[id] = [max ? Math.round(10 + (80 * l) / max) : 50, Math.round((100 * (i + 1)) / (col.length + 1))];
    });
  return out;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

// ---------------------------------------------------------------------------
// 200. Number of Islands
// ---------------------------------------------------------------------------

const numIslands: Problem<{ grid: string[][] }> = {
  id: 'number-of-islands',
  num: 200,
  title: 'Number of Islands',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'graph-traversal',
  statement:
    'A grid holds "1" for land and "0" for water. Land cells that touch up, down, left or right form one island. Count the islands.',
  signals: ['grid of land / water', '"connected horizontally or vertically"', 'count the groups / regions', 'each cell belongs to exactly one group'],
  insight:
    'Every unvisited land cell you meet during a plain row-by-row scan is the first cell of a new island. Flood-fill (BFS/DFS) from it marks the whole island, so the scan never counts it again.',
  hints: [
    'Think of each cell as a graph node with edges to its 4 neighbours.',
    'When you find land you have not seen, how can you make sure you never count that same island again?',
    'Scan all cells; on unvisited land do islands += 1 and BFS/DFS to mark every connected land cell as visited.',
  ],
  pitfall: 'Marking a cell visited when it is popped instead of when it is pushed — the same cell gets enqueued several times (slow, and with DFS it can loop forever).',
  backend: {
    title: 'Finding isolated network segments after a switch failure',
    detail:
      'A datacenter topology service models racks as a grid/graph where an edge means "has a working link". After failures, counting connected components (flood fill from each unvisited healthy rack) tells on-call how many partitions the network split into and which racks are stranded together.',
  },
  complexity: { time: 'O(rows · cols)', space: 'O(rows · cols)' },
  code: `
def numIslands(grid):
    ROWS, COLS = len(grid), len(grid[0])
    visit, islands = set(), 0                                  @init
    def bfs(r, c):
        q = deque([(r, c)])                                    @bfsStart
        visit.add((r, c))
        while q:                                               @while
            row, col = q.popleft()                             @pop
            for dr, dc in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                nr, nc = row + dr, col + dc
                if 0 <= nr < ROWS and 0 <= nc < COLS and grid[nr][nc] == "1" and (nr, nc) not in visit:   @check
                    q.append((nr, nc))                         @push
                    visit.add((nr, nc))
    for r in range(ROWS):
        for c in range(COLS):                                  @scan
            if grid[r][c] == "1" and (r, c) not in visit:      @newIsland
                bfs(r, c)                                      @callBfs
                islands += 1                                   @count
    return islands                                             @done
`,
  explain: {
    init: 'visit remembers every land cell already assigned to an island.',
    bfsStart: 'Mark the seed visited immediately so no neighbour re-enqueues it.',
    pop: 'BFS: take the oldest frontier cell and expand it.',
    check: 'Four filters: inside the grid, is land, not yet visited.',
    push: 'Mark visited at push time — each cell enters the queue at most once.',
    newIsland: 'Unvisited land can only mean a new, uncounted island.',
    count: 'Count once per flood fill, not once per cell.',
  },
  distractors: [
    { text: '            if grid[r][c] == "1":', why: 'Without the visited check every land cell starts its own "island" — you count cells, not islands.' },
    { text: '                    islands += 1', why: 'Incrementing inside the BFS counts land cells. The island is counted once, after its flood fill.' },
    { text: '                if 0 <= nr <= ROWS and 0 <= nc <= COLS and grid[nr][nc] == "1":', why: '<= ROWS reads one row past the end, and dropping the visit check re-enqueues cells forever.' },
  ],
  input: {
    grid: [
      ['1', '1', '0', '0', '0'],
      ['1', '1', '0', '0', '1'],
      ['0', '0', '1', '0', '1'],
      ['0', '0', '0', '1', '1'],
    ],
  },
  presets: [
    { label: 'all water', input: { grid: [['0', '0'], ['0', '0']] } },
    { label: 'one big island', input: { grid: [['1', '1', '1'], ['1', '0', '1'], ['1', '1', '1']] } },
    { label: 'checkerboard', input: { grid: [['1', '0', '1'], ['0', '1', '0'], ['1', '0', '1']] } },
  ],
  validate: ({ grid }) => checkGrid(grid, 6, (v) => v === '0' || v === '1', '"0" or "1"'),
  trace(t, { grid }) {
    const R = grid.length;
    const C = grid[0].length;
    const visit = new Set<string>();
    const owner = new Map<string, number>();
    let islands = 0;
    let q: Cell[] = [];
    let scan: Cell | null = null;
    let cur: Cell | null = null;
    let nbr: Cell | null = null;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const [k, id] of owner) tn[k] = id > islands ? 'warn' : 'good';
      for (const [r, c] of q) tn[rc(r, c)] = 'info';
      if (cur) tn[rc(cur[0], cur[1])] = 'active';
      return [
        V.grid('grid', grid, { tones: tn, pointers: { scan, cur, nbr }, caption: 'good = counted islands · warn = island being flooded · info = in queue' }),
        V.queue('q (BFS frontier)', q.map(([r, c]) => cs(r, c))),
      ];
    });
    t.step('init', 'Nothing visited, no islands yet. We scan every cell; any unvisited "1" must be the first cell of a new island.', { islands });
    let askedSkip = false;
    let askedNew = false;
    let askedNbr = false;
    const bfs = (sr: number, sc: number) => {
      const id = islands + 1;
      q = [[sr, sc]];
      visit.add(rc(sr, sc));
      owner.set(rc(sr, sc), id);
      t.step('bfsStart', `Seed the queue with ${cs(sr, sc)} and mark it visited right away, so nothing can enqueue it a second time.`, { q: q.map(([a, b]) => cs(a, b)) });
      let size = 0;
      while (q.length) {
        const [r, c] = q.shift()!;
        size++;
        cur = [r, c];
        nbr = null;
        t.step('pop', `Pop ${cs(r, c)} (oldest in the queue). Look at its 4 neighbours — anything that is unvisited land belongs to the same island.`, { row: r, col: c, 'len(q)': q.length });
        for (const [dr, dc] of DIRS) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inGrid(nr, nc, R, C)) continue;
          nbr = [nr, nc];
          const land = grid[nr][nc] === '1';
          const seen = visit.has(rc(nr, nc));
          if (land && !seen) {
            q.push([nr, nc]);
            visit.add(rc(nr, nc));
            owner.set(rc(nr, nc), id);
            t.step('push', `${cs(nr, nc)} is unvisited land → same island. Enqueue it and mark it visited now.`, { nr, nc, 'len(q)': q.length });
          } else {
            if (land && !askedNbr) {
              askedNbr = true;
              t.step('check', `Neighbour ${cs(nr, nc)} is land.`, { nr, nc });
              t.predict(`Will ${cs(nr, nc)} be enqueued again?`, ['Yes — it is land', 'No'], 1, 'It is already in visit: it was marked the moment it was first pushed, so the filter rejects it.');
            }
            t.step('check', land ? `${cs(nr, nc)} is land but already visited — skip (no double counting, no infinite loop).` : `${cs(nr, nc)} is water — the island does not extend this way.`, { nr, nc });
          }
        }
      }
      cur = null;
      nbr = null;
      t.step('while', `Queue empty — island #${id} is fully flooded (${size} cell${size === 1 ? '' : 's'}).`, { size });
    };
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        scan = [r, c];
        const land = grid[r][c] === '1';
        const seen = visit.has(rc(r, c));
        if (land && seen && !askedSkip) {
          askedSkip = true;
          t.step('scan', `The outer scan reaches ${cs(r, c)}, which holds "1".`, { r, c, islands });
          t.predict(`Does ${cs(r, c)} start a new island?`, ['Yes — it is land', 'No — skip it'], 1, `It was visited while flooding island #${owner.get(rc(r, c))}, so it is already counted.`);
        } else if (land && !seen && islands >= 1 && !askedNew) {
          askedNew = true;
          t.step('scan', `The outer scan reaches ${cs(r, c)}, which holds "1".`, { r, c, islands });
          t.predict(`Does ${cs(r, c)} start a new island?`, ['Yes', 'No — it is land we already flooded'], 0, 'No earlier flood fill reached it (it is not toned), so it belongs to an island we have not counted.');
        }
        if (land && !seen) {
          t.step('newIsland', `${cs(r, c)} is land and not visited → it belongs to an island nobody has counted yet.`, { r, c, islands });
          t.step('callBfs', 'Flood-fill from here so every connected "1" is marked before the scan reaches it.', { r, c });
          bfs(r, c);
          islands++;
          t.step('count', `islands = ${islands}.`, { islands });
        } else {
          t.step('scan', land ? `${cs(r, c)} is land but already part of island #${owner.get(rc(r, c))} — skip.` : `${cs(r, c)} is water — skip.`, { r, c, islands });
        }
      }
    scan = null;
    t.step('done', `Scan finished: ${islands} island${islands === 1 ? '' : 's'}.`, { islands });
    return islands;
  },
};

// ---------------------------------------------------------------------------
// 133. Clone Graph
// ---------------------------------------------------------------------------

const cloneGraph: Problem<{ adj: number[][] }> = {
  id: 'clone-graph',
  num: 133,
  title: 'Clone Graph',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'graph-traversal',
  statement:
    'You get one node of a connected undirected graph; each node has a value 1..n and a list of neighbours. Build a deep copy: brand-new nodes wired exactly like the original.',
  signals: ['"deep copy" of a graph', 'graph may contain cycles', 'nodes reference each other', 'need old → new correspondence'],
  insight:
    'Keep a map old node → its copy. Register a copy BEFORE visiting its neighbours; then when a cycle leads back to it, the map returns the existing copy instead of recursing forever.',
  hints: [
    'Traverse the graph (DFS or BFS) and create one copy per original node.',
    'What happens on a cycle 1 → 2 → 1 if you simply recurse?',
    'Use a hashmap oldToNew; if the node is already in it, return the stored copy.',
  ],
  pitfall: 'Putting the node in oldToNew only after its neighbours are processed — the cycle back to it recurses forever (or creates duplicate copies).',
  backend: {
    title: 'Copying a workflow DAG / microservice dependency graph between environments',
    detail:
      'A deployment tool clones a project\'s service graph from staging to production: every service record must be recreated with new IDs while preserving who-calls-whom, including cyclic dependencies. The old-ID → new-ID map is exactly oldToNew; it is also how ORMs deep-copy object graphs without infinite recursion.',
  },
  complexity: { time: 'O(V + E)', space: 'O(V)' },
  code: `
def cloneGraph(node):
    oldToNew = {}                                     @init
    def dfs(node):
        if node in oldToNew:                          @seen
            return oldToNew[node]                     @reuse
        copy = Node(node.val)                         @copy
        oldToNew[node] = copy                         @store
        for nei in node.neighbors:                    @loop
            copy.neighbors.append(dfs(nei))           @link
        return copy                                   @ret
    return dfs(node) if node else None                @start
`,
  explain: {
    seen: 'The cycle breaker: a node we have copied before is never copied again.',
    store: 'Register before recursing so neighbours that point back find this copy.',
    link: 'dfs(nei) returns the COPY of nei — we wire copy → copy, never copy → original.',
  },
  distractors: [
    { text: '        copy.neighbors = node.neighbors', why: 'That is a shallow copy: the clone would point at ORIGINAL nodes instead of their copies.' },
    { text: '            copy.neighbors.append(Node(nei.val))', why: 'Creates a fresh node per edge, so one original node gets many copies and cycles are not shared.' },
    { text: '        oldToNew[node] = Node(node.val)', why: 'Stores a different object than `copy`; neighbours get linked to a node that is never returned.' },
  ],
  input: { adj: [[2, 4], [1, 3], [2, 4], [1, 3]] },
  presets: [
    { label: 'single node', input: { adj: [[]] } },
    { label: 'two nodes', input: { adj: [[2], [1]] } },
    { label: 'triangle + tail', input: { adj: [[2, 3], [1, 3], [1, 2, 4], [3]] } },
  ],
  validate: ({ adj }) => {
    if (!Array.isArray(adj) || !adj.length || !adj.every((l) => Array.isArray(l))) return 'Expected { adj: number[][] } with at least one node (adj[i] = neighbours of node i+1)';
    if (adj.length > 8) return 'Keep the graph ≤ 8 nodes';
    if (!adj.every((l) => l.every((v) => isInt(v) && v >= 1 && v <= adj.length))) return 'Neighbours must be node values 1..n';
    return null;
  },
  trace(t, { adj }) {
    const n = adj.length;
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const pos = circle(ids);
    const origEdges: [number, number][] = [];
    adj.forEach((l, i) => l.forEach((v) => (i + 1 < v || !adj[v - 1].includes(i + 1)) && origEdges.push([i + 1, v])));
    const oldToNew = new Map<number, number[]>();
    const stack: number[] = [];
    let edge: [number, number] | null = null;
    let hl: number[] = [];
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const v of oldToNew.keys()) tn[String(v)] = 'good';
      for (const v of stack) tn[String(v)] = 'info';
      if (stack.length) tn[String(stack[stack.length - 1])] = 'active';
      const labels: Record<string, string> = {};
      for (const v of oldToNew.keys()) labels[String(v)] = `${v}'`;
      const cloneEdges: [number, number][] = [];
      for (const [v, l] of oldToNew) for (const u of l) cloneEdges.push([v, u]);
      return [
        V.graph('original graph', ids, origEdges, { positions: pos, tones: tn, edgeTones: edge ? { [`${edge[0]}->${edge[1]}`]: 'active' } : {}, caption: 'active = current dfs node · info = on the call stack · good = already copied' }),
        V.graph("clone (arrow = neighbour link appended)", [...oldToNew.keys()], cloneEdges, { directed: true, positions: pos, labels, tones: stack.length && oldToNew.has(stack[stack.length - 1]) ? { [String(stack[stack.length - 1])]: 'active' } : {} }),
        V.map('oldToNew', [...oldToNew.keys()].map((v) => [`node ${v}`, `copy ${v}'`] as [string, string]), { hl: hl.map((v) => `node ${v}`) }),
        V.stack('dfs call stack', stack.map((v) => `dfs(${v})`)),
      ];
    });
    t.step('init', 'oldToNew is empty: no node has a copy yet.');
    t.step('start', 'Start the DFS from node 1.');
    let askNew = true;
    let askOld = true;
    const dfs = (v: number): void => {
      stack.push(v);
      hl = [];
      if (oldToNew.has(v)) {
        hl = [v];
        t.step('seen', `dfs(${v}): node ${v} is already in oldToNew.`, { node: v });
        t.step('reuse', `Return the existing copy ${v}' — no new node, no further recursion. This is what stops the walk from looping around the cycle.`, { node: v });
        stack.pop();
        return;
      }
      t.step('seen', `dfs(${v}): node ${v} is not in oldToNew yet.`, { node: v });
      oldToNew.set(v, []);
      hl = [v];
      t.step('copy', `Create copy ${v}' with value ${v} (no neighbours yet).`, { node: v });
      t.step('store', `Register ${v} → ${v}' BEFORE touching neighbours, so any path that cycles back to ${v} finds this copy.`, { node: v });
      for (const u of adj[v - 1]) {
        edge = [v, u];
        hl = [];
        t.step('loop', `Neighbour ${u} of node ${v}: get its copy with dfs(${u}).`, { node: v, nei: u });
        if (askNew && !oldToNew.has(u)) {
          askNew = false;
          t.predict(`Will dfs(${u}) build a brand-new copy?`, ['Yes', 'No — it returns an existing copy'], 0, `${u} is not in oldToNew yet, so this is its first visit.`);
        } else if (askOld && oldToNew.has(u)) {
          askOld = false;
          t.predict(`Will dfs(${u}) build a brand-new copy?`, ['Yes', 'No — it returns an existing copy'], 1, `${u} is already in oldToNew (toned green): the map hands back ${u}' immediately.`);
        }
        dfs(u);
        edge = [v, u];
        oldToNew.get(v)!.push(u);
        hl = [v, u];
        t.step('link', `Append ${u}' to ${v}'.neighbors — copies link to copies.`, { node: v, nei: u });
      }
      edge = null;
      hl = [v];
      t.step('ret', `All neighbours of ${v} are wired. Return ${v}' to the caller.`, { node: v });
      stack.pop();
    };
    dfs(1);
    hl = [];
    t.step('start', `Done: ${oldToNew.size} copies created — one per original node, never more.`, { copies: oldToNew.size });
    return ids.filter((v) => oldToNew.has(v)).map((v) => oldToNew.get(v)!);
  },
};

// ---------------------------------------------------------------------------
// 695. Max Area of Island
// ---------------------------------------------------------------------------

const maxAreaOfIsland: Problem<{ grid: number[][] }> = {
  id: 'max-area-of-island',
  num: 695,
  title: 'Max Area of Island',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'graph-traversal',
  statement: 'In a 0/1 grid, an island is a group of 1-cells joined up/down/left/right. Return the number of cells in the largest island (0 if there is none).',
  signals: ['0/1 grid', '4-directional connectivity', '"largest" / "size of" a region', 'each region measured once'],
  insight:
    'A DFS from a land cell returns the size of everything it can reach: 1 for itself plus whatever its 4 neighbours return. Marking cells visited makes every cell count exactly once.',
  hints: [
    'This is Number of Islands, but each flood fill must also report how many cells it covered.',
    'Let dfs(r, c) return an integer instead of nothing.',
    'Base case returns 0 (outside, water, visited); otherwise mark and return 1 + the four recursive calls.',
  ],
  pitfall: 'Forgetting to mark the cell before recursing — neighbours call back into it and the area is counted twice (or recursion never ends).',
  backend: {
    title: 'Largest blast radius of a failing cluster',
    detail:
      'A monitoring job lays hosts out on a rack × slot grid and marks unhealthy ones. Each connected patch of unhealthy hosts is one incident; DFS returning sizes finds the biggest outage to page on first. The same flood-fill-with-count sizes connected components in image segmentation or geo heat-maps.',
  },
  complexity: { time: 'O(rows · cols)', space: 'O(rows · cols)' },
  code: `
def maxAreaOfIsland(grid):
    ROWS, COLS = len(grid), len(grid[0])
    visit = set()                                         @init
    def dfs(r, c):
        if not (0 <= r < ROWS and 0 <= c < COLS) or grid[r][c] == 0 or (r, c) in visit:   @base
            return 0                                      @zero
        visit.add((r, c))                                 @mark
        return 1 + dfs(r + 1, c) + dfs(r - 1, c) + dfs(r, c + 1) + dfs(r, c - 1)   @sum
    area = 0
    for r in range(ROWS):
        for c in range(COLS):                             @scan
            area = max(area, dfs(r, c))                   @best
    return area                                           @done
`,
  explain: {
    base: 'Outside the grid, water, or already counted → contributes nothing.',
    mark: 'Mark first so the recursive calls cannot come back and count this cell again.',
    sum: '1 for this cell plus the areas found in each direction.',
    best: 'Every cell is tried; dfs returns 0 for water/visited cells, the island size otherwise.',
  },
  distractors: [
    { text: '        return dfs(r + 1, c) + dfs(r - 1, c) + dfs(r, c + 1) + dfs(r, c - 1)', why: 'Missing the "1 +" — every island would report area 0.' },
    { text: '            area += dfs(r, c)', why: 'Summing gives the total land area of ALL islands, not the largest one.' },
    { text: '        if grid[r][c] == 0 or (r, c) in visit:', why: 'Dropping the bounds check indexes outside the grid (or wraps around with negative indices in Python).' },
  ],
  input: {
    grid: [
      [0, 0, 1, 0, 0],
      [1, 1, 1, 0, 0],
      [0, 0, 0, 1, 1],
      [0, 1, 0, 1, 0],
    ],
  },
  presets: [
    { label: 'no land', input: { grid: [[0, 0], [0, 0]] } },
    { label: 'ring with a hole', input: { grid: [[1, 1, 1], [1, 0, 1], [1, 1, 1]] } },
  ],
  validate: ({ grid }) => checkGrid(grid, 5, (v) => v === 0 || v === 1, '0 or 1'),
  trace(t, { grid }) {
    const R = grid.length;
    const C = grid[0].length;
    const visit = new Set<string>();
    const owner = new Map<string, number>();
    const sizes = new Map<number, number>();
    let isl = 0;
    let running = false;
    let area = 0;
    const stack: string[] = [];
    let scan: Cell | null = null;
    let cur: Cell | null = null;
    t.draw(() => {
      let bestId = -1;
      for (const [id, s] of sizes) if (s === area && bestId < 0) bestId = id;
      const tn: Record<string, Tone> = {};
      for (const [k, id] of owner) tn[k] = running && id === isl ? 'warn' : id === bestId ? 'good' : 'info';
      if (cur && inGrid(cur[0], cur[1], R, C)) tn[rc(cur[0], cur[1])] = 'active';
      return [
        V.grid('grid', grid, { tones: tn, pointers: { scan, cur }, caption: 'warn = island being measured · good = largest so far · info = smaller islands' }),
        V.stack('dfs call stack', stack),
      ];
    });
    t.step('init', 'visit is empty. We will call dfs on every cell; dfs returns the size of the island it starts on (0 for water or already-counted land).', { area });
    let askedZero = false;
    const dfs = (r: number, c: number, root: boolean): number => {
      if (!inGrid(r, c, R, C)) return 0;
      stack.push(`dfs(${r},${c})`);
      cur = [r, c];
      if (grid[r][c] === 0 || visit.has(rc(r, c))) {
        t.step('zero', grid[r][c] === 0 ? `${cs(r, c)} is water → return 0.` : `${cs(r, c)} is already in visit → return 0 (it was counted earlier).`, { r, c });
        stack.pop();
        return 0;
      }
      visit.add(rc(r, c));
      owner.set(rc(r, c), isl);
      t.step('mark', `${cs(r, c)} is new land: mark it, count 1 for itself, then ask the 4 neighbours for their areas.`, { r, c });
      let total = 1;
      for (const [dr, dc] of DIRS) {
        total += dfs(r + dr, c + dc, false);
        cur = [r, c];
      }
      if (root) {
        t.step('sum', `All 4 neighbour calls of the starting cell ${cs(r, c)} have returned.`, { r, c });
        const opts = [total - 1, total, total + 1].map(String);
        t.predict('What area does dfs return for this island?', opts, 1, `1 for ${cs(r, c)} plus the cells its neighbours reported — ${total} cells marked (toned amber).`);
      }
      t.step('sum', `dfs${cs(r, c)} returns 1 + neighbours = ${total}.`, { r, c, returns: total });
      stack.pop();
      return total;
    };
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        scan = [r, c];
        cur = null;
        if (grid[r][c] === 0) {
          t.step('scan', `${cs(r, c)} is water: dfs returns 0, area stays ${area}.`, { r, c, area });
          continue;
        }
        if (visit.has(rc(r, c))) {
          if (!askedZero) {
            askedZero = true;
            t.step('scan', `The outer loop calls dfs${cs(r, c)} — a land cell.`, { r, c, area });
            t.predict(`What does dfs${cs(r, c)} return?`, ['0', '1', String(sizes.get(owner.get(rc(r, c))!) ?? 1)], 0, 'It is already in visit (counted with an earlier island), so the base case returns 0.');
          }
          t.step('scan', `${cs(r, c)} is land already counted: dfs returns 0, area stays ${area}.`, { r, c, area });
          continue;
        }
        isl++;
        running = true;
        t.step('best', `${cs(r, c)} is unvisited land → measure its island with dfs.`, { r, c, area });
        const got = dfs(r, c, true);
        sizes.set(isl, got);
        running = false;
        cur = null;
        const prev = area;
        area = Math.max(area, got);
        t.step('best', `area = max(${prev}, ${got}) = ${area}.`, { r, c, area });
      }
    scan = null;
    t.step('done', `Largest island has ${area} cell${area === 1 ? '' : 's'}.`, { area });
    return area;
  },
};

// ---------------------------------------------------------------------------
// 417. Pacific Atlantic Water Flow
// ---------------------------------------------------------------------------

const pacificAtlantic: Problem<{ heights: number[][] }> = {
  id: 'pacific-atlantic-water-flow',
  num: 417,
  title: 'Pacific Atlantic Water Flow',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'graph-traversal',
  statement:
    'A height map has the Pacific along its top and left edges and the Atlantic along its bottom and right edges. Rain flows to a neighbour of equal or lower height. List the cells whose water can reach both oceans.',
  signals: ['two "targets" on the borders', 'flow to equal-or-lower neighbour', '"can reach both"', 'searching from every cell would repeat work'],
  insight:
    'Reverse the flow: start at each ocean\'s border and climb to neighbours of EQUAL OR HIGHER height. Two floods (one per ocean) mark everything that drains there; the answer is their intersection.',
  hints: [
    'Running a search from every cell is O((rows·cols)²). Which cells definitely reach the Pacific?',
    'Think backwards from the ocean: water could have come from a neighbour that is at least as high.',
    'DFS from all Pacific border cells into a set pac, same for Atlantic into atl; return cells in both.',
  ],
  pitfall: 'Using the forward rule (move to LOWER neighbours) during the reversed search — the comparison must be heights[next] >= heights[current].',
  backend: {
    title: 'Which services can reach both primary and DR databases?',
    detail:
      'In a network policy graph, traffic may only move along allowed hops. Instead of testing reachability from every service, run one reverse BFS/DFS from the primary DB and one from the disaster-recovery DB; services in both sets survive a failover. Multi-target reverse search is the same trick used for "which nodes can reach the egress gateway".',
  },
  complexity: { time: 'O(rows · cols)', space: 'O(rows · cols)' },
  code: `
def pacificAtlantic(heights):
    ROWS, COLS = len(heights), len(heights[0])
    pac, atl = set(), set()                                  @init
    def dfs(r, c, visit, prevHeight):
        if (r, c) in visit or not (0 <= r < ROWS and 0 <= c < COLS) or heights[r][c] < prevHeight:   @base
            return                                           @stop
        visit.add((r, c))                                    @mark
        for dr, dc in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            dfs(r + dr, c + dc, visit, heights[r][c])        @recurse
    for c in range(COLS):
        dfs(0, c, pac, heights[0][c])                        @pacTop
        dfs(ROWS - 1, c, atl, heights[ROWS - 1][c])          @atlBottom
    for r in range(ROWS):
        dfs(r, 0, pac, heights[r][0])                        @pacLeft
        dfs(r, COLS - 1, atl, heights[r][COLS - 1])          @atlRight
    return [[r, c] for r in range(ROWS) for c in range(COLS) if (r, c) in pac and (r, c) in atl]   @result
`,
  explain: {
    base: 'Reverse flow: we may only climb to a cell at least as high as where we came from.',
    mark: 'This cell drains into the ocean whose set we are filling.',
    recurse: 'Pass the current height as the bar the neighbour must meet.',
    result: 'Cells reached by both floods drain to both oceans.',
  },
  distractors: [
    { text: '        if (r, c) in visit or not (0 <= r < ROWS and 0 <= c < COLS) or heights[r][c] > prevHeight:', why: 'That is the forward rule. Searching from the ocean we go UPHILL, so we reject cells LOWER than the previous one.' },
    { text: '    for r in range(ROWS):\n        for c in range(COLS):\n            dfs(r, c, set(), heights[r][c])', why: 'A search from every cell repeats work — O((R·C)²). Two border floods do it in O(R·C).' },
    { text: '        dfs(0, c, atl, heights[0][c])', why: 'The top row borders the Pacific, not the Atlantic.' },
  ],
  input: {
    heights: [
      [1, 2, 2, 3],
      [3, 2, 3, 4],
      [2, 4, 5, 3],
      [6, 7, 1, 4],
    ],
  },
  presets: [
    { label: 'single cell', input: { heights: [[7]] } },
    { label: 'flat', input: { heights: [[1, 1], [1, 1]] } },
    { label: 'central peak', input: { heights: [[1, 2, 1], [2, 5, 2], [1, 2, 1]] } },
  ],
  validate: ({ heights }) => checkGrid(heights, 5, (v) => isInt(v) && v >= 0 && v < 1000, 'non-negative integers'),
  trace(t, { heights }) {
    const R = heights.length;
    const C = heights[0].length;
    const pac = new Set<string>();
    const atl = new Set<string>();
    let cur: Cell | null = null;
    let nxt: Cell | null = null;
    let res: string[] = [];
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (let r = 0; r < R; r++)
        for (let c = 0; c < C; c++) {
          const k = rc(r, c);
          if (pac.has(k) && atl.has(k)) tn[k] = 'good';
          else if (pac.has(k)) tn[k] = 'info';
          else if (atl.has(k)) tn[k] = 'warn';
        }
      if (cur) tn[rc(cur[0], cur[1])] = 'active';
      return [
        V.grid('heights', heights, { tones: tn, pointers: { cur, next: nxt }, caption: 'info = reaches Pacific (top/left) · warn = reaches Atlantic (bottom/right) · good = both' }),
        res.length > 0 && V.chips('result', res),
      ];
    });
    t.step('init', 'Two empty sets. Instead of following rain downhill from every cell, flood UPHILL from each ocean\'s border: anything we can climb to drains into that ocean.');
    let askNo = true;
    let askYes = true;
    const dfs = (r: number, c: number, visit: Set<string>, prev: number, ocean: string) => {
      if (visit.has(rc(r, c)) || !inGrid(r, c, R, C)) return;
      if (heights[r][c] < prev) {
        t.step('stop', `${cs(r, c)} has height ${heights[r][c]} < ${prev}: water there could not flow UP into the cell we came from — stop.`, { r, c, h: heights[r][c], prevHeight: prev });
        return;
      }
      visit.add(rc(r, c));
      cur = [r, c];
      nxt = null;
      t.step('mark', `${cs(r, c)} (height ${heights[r][c]}) drains into the ${ocean}: add it to ${ocean === 'Pacific' ? 'pac' : 'atl'}.`, { r, c, h: heights[r][c], 'len(pac)': pac.size, 'len(atl)': atl.size });
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inGrid(nr, nc, R, C) || visit.has(rc(nr, nc))) continue;
        cur = [r, c];
        nxt = [nr, nc];
        t.step('recurse', `Try neighbour ${cs(nr, nc)} (height ${heights[nr][nc]}) with prevHeight = ${heights[r][c]}.`, { r, c, nr, nc });
        const ok = heights[nr][nc] >= heights[r][c];
        if ((!ok && askNo) || (ok && heights[nr][nc] > heights[r][c] && askYes && !askNo)) {
          if (ok) askYes = false;
          else askNo = false;
          t.predict(`Can the ${ocean} flood climb from ${cs(r, c)} (h=${heights[r][c]}) into ${cs(nr, nc)} (h=${heights[nr][nc]})?`, ['Yes', 'No'], ok ? 0 : 1, ok ? `${heights[nr][nc]} ≥ ${heights[r][c]}: rain on ${cs(nr, nc)} can run down into ${cs(r, c)} and on to the ocean.` : `${heights[nr][nc]} < ${heights[r][c]}: rain on ${cs(nr, nc)} cannot flow uphill into ${cs(r, c)}.`);
        }
        dfs(nr, nc, visit, heights[r][c], ocean);
        cur = [r, c];
        nxt = null;
      }
    };
    for (let c = 0; c < C; c++) {
      cur = [0, c];
      nxt = null;
      t.step('pacTop', `Top-row cell ${cs(0, c)} touches the Pacific${pac.has(rc(0, c)) ? ' (already in pac)' : ''}.`, { c });
      dfs(0, c, pac, heights[0][c], 'Pacific');
      cur = [R - 1, c];
      nxt = null;
      t.step('atlBottom', `Bottom-row cell ${cs(R - 1, c)} touches the Atlantic${atl.has(rc(R - 1, c)) ? ' (already in atl)' : ''}.`, { c });
      dfs(R - 1, c, atl, heights[R - 1][c], 'Atlantic');
    }
    for (let r = 0; r < R; r++) {
      cur = [r, 0];
      nxt = null;
      t.step('pacLeft', `Left-column cell ${cs(r, 0)} touches the Pacific${pac.has(rc(r, 0)) ? ' (already in pac)' : ''}.`, { r });
      dfs(r, 0, pac, heights[r][0], 'Pacific');
      cur = [r, C - 1];
      nxt = null;
      t.step('atlRight', `Right-column cell ${cs(r, C - 1)} touches the Atlantic${atl.has(rc(r, C - 1)) ? ' (already in atl)' : ''}.`, { r });
      dfs(r, C - 1, atl, heights[r][C - 1], 'Atlantic');
    }
    const both: number[][] = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (pac.has(rc(r, c)) && atl.has(rc(r, c))) both.push([r, c]);
    cur = null;
    nxt = null;
    t.predict('How many cells reach BOTH oceans?', [...new Set([both.length, both.length + 1, Math.max(0, both.length - 1)])].map(String), 0, 'Count the green cells — they are in both pac and atl.');
    res = both.map(([r, c]) => cs(r, c));
    t.step('result', `Intersection of pac and atl: ${both.length} cell${both.length === 1 ? '' : 's'}.`, { result: both });
    return both;
  },
};

// ---------------------------------------------------------------------------
// 130. Surrounded Regions
// ---------------------------------------------------------------------------

const surroundedRegions: Problem<{ board: string[][] }> = {
  id: 'surrounded-regions',
  num: 130,
  title: 'Surrounded Regions',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'graph-traversal',
  statement:
    'A board holds "X" and "O". Every group of O cells that is fully enclosed by X (no path of O cells to the border) gets flipped to X in place. O groups touching the border survive.',
  signals: ['"surrounded" / "enclosed" regions', 'border cells behave differently', 'modify the grid in place', 'connectivity through same-valued cells'],
  insight:
    'It is hard to prove a region is surrounded, but easy to find the ones that are NOT: anything connected to a border O. Flood those to a temporary "T", flip every remaining O to X, then turn T back into O.',
  hints: [
    'Which O cells can never be captured?',
    'Start a DFS from every border O and tag everything it reaches.',
    'Three phases: tag border-connected O as T, flip O → X, restore T → O.',
  ],
  pitfall: 'Restoring T → O before flipping O → X (or with two separate ifs) turns the safe cells into X as well.',
  backend: {
    title: 'Garbage-collecting objects unreachable from roots',
    detail:
      'A mark-and-sweep garbage collector does exactly this: mark everything reachable from the roots (the "border"), then sweep the unmarked objects (the surrounded O\'s). The same reverse thinking finds orphaned rows in a DB — mark everything reachable from live tenants, delete the rest.',
  },
  complexity: { time: 'O(rows · cols)', space: 'O(rows · cols)' },
  code: `
def solve(board):
    ROWS, COLS = len(board), len(board[0])
    def capture(r, c):
        if not (0 <= r < ROWS and 0 <= c < COLS) or board[r][c] != "O":   @base
            return
        board[r][c] = "T"                                   @mark
        for dr, dc in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            capture(r + dr, c + dc)                         @recurse
    for r in range(ROWS):
        for c in range(COLS):
            if board[r][c] == "O" and (r in [0, ROWS - 1] or c in [0, COLS - 1]):   @border
                capture(r, c)                               @capture
    for r in range(ROWS):
        for c in range(COLS):                               @sweep
            if board[r][c] == "O":
                board[r][c] = "X"                           @toX
            elif board[r][c] == "T":
                board[r][c] = "O"                           @toO
`,
  explain: {
    base: 'Stop at the edge of the board or at anything that is not an untagged O.',
    mark: '"T" = temporarily safe: connected to the border.',
    border: 'Only border O cells can start a rescue flood.',
    toX: 'Any O still untagged had no route to the border → captured.',
    toO: 'Undo the temporary tag.',
  },
  distractors: [
    { text: '            if board[r][c] == "T":\n                board[r][c] = "O"\n            if board[r][c] == "O":\n                board[r][c] = "X"', why: 'Two independent ifs: the T just restored to O is immediately flipped to X. Use elif (or flip O first).' },
    { text: '            if board[r][c] == "O":\n                capture(r, c)', why: 'Starting captures from interior O cells tags surrounded regions as safe too — only border cells may start the flood.' },
    { text: '        board[r][c] = "X"', why: 'Marking safe cells as X while flooding destroys the information about which cells were O.' },
  ],
  input: {
    board: [
      ['X', 'X', 'X', 'X', 'X'],
      ['X', 'O', 'O', 'X', 'X'],
      ['X', 'X', 'O', 'X', 'O'],
      ['X', 'O', 'X', 'O', 'O'],
      ['X', 'O', 'X', 'X', 'X'],
    ],
  },
  presets: [
    { label: 'classic', input: { board: [['X', 'X', 'X', 'X'], ['X', 'O', 'O', 'X'], ['X', 'X', 'O', 'X'], ['X', 'O', 'X', 'X']] } },
    { label: 'all O', input: { board: [['O', 'O', 'O'], ['O', 'O', 'O'], ['O', 'O', 'O']] } },
  ],
  validate: ({ board }) => checkGrid(board, 6, (v) => v === 'X' || v === 'O', '"X" or "O"'),
  trace(t, { board }) {
    const R = board.length;
    const C = board[0].length;
    const flipped = new Set<string>();
    let cur: Cell | null = null;
    let phase = 'tag';
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (let r = 0; r < R; r++)
        for (let c = 0; c < C; c++) {
          if (board[r][c] === 'T') tn[rc(r, c)] = 'good';
          else if (flipped.has(rc(r, c))) tn[rc(r, c)] = 'bad';
          else if (board[r][c] === 'O' && phase === 'tag') tn[rc(r, c)] = 'info';
        }
      if (cur) tn[rc(cur[0], cur[1])] = 'active';
      return [V.grid('board', board, { tones: tn, pointers: { cur }, caption: 'good = T (border-connected, safe) · bad = captured → X · info = untagged O' })];
    });
    const isBorder = (r: number, c: number) => r === 0 || r === R - 1 || c === 0 || c === C - 1;
    const capture = (r: number, c: number, from: Cell | null) => {
      if (!inGrid(r, c, R, C)) return;
      if (board[r][c] !== 'O') {
        if (from) {
          cur = [r, c];
          t.step('base', `${cs(r, c)} is "${board[r][c]}" — ${board[r][c] === 'T' ? 'already tagged' : 'a wall'}, stop.`, { r, c });
        }
        return;
      }
      board[r][c] = 'T';
      cur = [r, c];
      t.step('mark', from ? `${cs(r, c)} is an O reached from ${cs(from[0], from[1])} → also connected to the border. Tag it "T".` : `Border O ${cs(r, c)} can never be enclosed. Tag it "T" and spread.`, { r, c });
      for (const [dr, dc] of DIRS) {
        capture(r + dr, c + dc, [r, c]);
        cur = [r, c];
      }
    };
    t.step('border', 'Phase 1: walk the border. Every O on the border — and every O connected to it — is safe.');
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        if (!isBorder(r, c)) continue;
        cur = [r, c];
        if (board[r][c] === 'O') {
          t.step('capture', `Border cell ${cs(r, c)} is O → capture(${r}, ${c}) floods everything connected to it.`, { r, c });
          capture(r, c, null);
        } else {
          t.step('border', `Border cell ${cs(r, c)} is "${board[r][c]}" — nothing to start here.`, { r, c });
        }
      }
    phase = 'sweep';
    cur = null;
    let askX = true;
    let askT = true;
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        const v = board[r][c];
        if (v === 'X') continue;
        cur = [r, c];
        if ((v === 'O' && askX) || (v === 'T' && askT)) {
          t.step('sweep', `Phase 2 sweep reaches ${cs(r, c)}, which holds "${v}".`, { r, c });
          if (v === 'O') {
            askX = false;
            t.predict(`What does ${cs(r, c)} become?`, ['X', 'O', 'T'], 0, 'It is still an untagged O, so no border flood reached it — it is surrounded and gets captured.');
          } else {
            askT = false;
            t.predict(`What does ${cs(r, c)} become?`, ['X', 'O', 'T'], 1, 'T marks border-connected cells — they survive, so the tag is undone back to O.');
          }
        }
        if (v === 'O') {
          board[r][c] = 'X';
          flipped.add(rc(r, c));
          t.step('toX', `${cs(r, c)} was never tagged → surrounded → flip to X.`, { r, c });
        } else {
          board[r][c] = 'O';
          t.step('toO', `${cs(r, c)} was tagged T (safe) → restore it to O.`, { r, c });
        }
      }
    cur = null;
    t.step('sweep', `Done: ${flipped.size} cell${flipped.size === 1 ? '' : 's'} captured.`, { captured: flipped.size });
    return board;
  },
};

// ---------------------------------------------------------------------------
// 994. Rotting Oranges
// ---------------------------------------------------------------------------

const rottingOranges: Problem<{ grid: number[][] }> = {
  id: 'rotting-oranges',
  num: 994,
  title: 'Rotting Oranges',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'graph-traversal',
  statement:
    'Grid cells are empty (0), fresh oranges (1) or rotten oranges (2). Each minute every rotten orange rots its fresh 4-neighbours. Return the minutes until no fresh orange remains, or -1 if some never rot.',
  signals: ['spreads "each minute" / in rounds', 'MANY starting points at once', 'minimum time until everything is reached', 'return -1 if unreachable'],
  insight:
    'All rotten oranges spread simultaneously, so put every one of them in the queue at time 0 (multi-source BFS). Processing the queue one level at a time = one minute per level.',
  hints: [
    'Running a BFS per rotten orange and combining is messy. What if they all start together?',
    'Seed the queue with every rotten orange and count the fresh ones.',
    'Process exactly len(q) items per minute; stop when the queue is empty or fresh == 0.',
  ],
  pitfall: 'Incrementing time even after the last round where nothing rotted (returning one minute too many), or forgetting to return -1 when fresh > 0.',
  backend: {
    title: 'Propagation time of a config push / gossip protocol',
    detail:
      'A config change starts on several seed nodes and each round every updated node gossips to its direct peers. Multi-source BFS over the cluster graph gives how many gossip rounds until every node is updated — and flags isolated nodes that never will (-1). Same model for cache invalidation fan-out or infection spread in a dependency graph.',
  },
  complexity: { time: 'O(rows · cols)', space: 'O(rows · cols)' },
  code: `
def orangesRotting(grid):
    q, fresh, time = deque(), 0, 0                         @init
    for r in range(ROWS):
        for c in range(COLS):
            if grid[r][c] == 1: fresh += 1
            if grid[r][c] == 2: q.append((r, c))           @seed
    while q and fresh > 0:                                 @while
        for _ in range(len(q)):                            @level
            r, c = q.popleft()                             @pop
            for dr, dc in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                nr, nc = r + dr, c + dc
                if 0 <= nr < ROWS and 0 <= nc < COLS and grid[nr][nc] == 1:   @check
                    grid[nr][nc] = 2                       @rot
                    q.append((nr, nc))
                    fresh -= 1
        time += 1                                          @tick
    return time if fresh == 0 else -1                      @done
`,
  explain: {
    seed: 'Every rotten orange is a BFS source at minute 0.',
    while: 'Stop when nothing is spreading or nothing is left to rot.',
    level: 'Freeze the current queue length: exactly these oranges spread during this minute.',
    rot: 'Rot immediately so another neighbour cannot enqueue it again.',
    done: 'Leftover fresh oranges were unreachable.',
  },
  distractors: [
    { text: '        while q:', why: 'Without "and fresh > 0" the last batch of newly rotten oranges triggers one extra minute that rots nothing.' },
    { text: '        r, c = q.popleft()\n        time += 1', why: 'Counting per orange instead of per level gives the number of oranges processed, not minutes.' },
    { text: '                if 0 <= nr < ROWS and 0 <= nc < COLS and grid[nr][nc] != 0:', why: 'Rotten neighbours (2) pass this test and get re-enqueued, and fresh is decremented twice.' },
  ],
  input: { grid: [[2, 1, 1], [1, 1, 0], [0, 1, 1]] },
  presets: [
    { label: 'unreachable orange', input: { grid: [[2, 1, 1], [0, 1, 1], [1, 0, 1]] } },
    { label: 'two sources', input: { grid: [[2, 1, 1, 1], [1, 1, 0, 1], [1, 0, 1, 2]] } },
    { label: 'nothing fresh', input: { grid: [[0, 2]] } },
  ],
  validate: ({ grid }) => checkGrid(grid, 5, (v) => v === 0 || v === 1 || v === 2, '0, 1 or 2'),
  trace(t, { grid }) {
    const R = grid.length;
    const C = grid[0].length;
    let q: Cell[] = [];
    let fresh = 0;
    let time = 0;
    let cur: Cell | null = null;
    const newly = new Set<string>();
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (let r = 0; r < R; r++)
        for (let c = 0; c < C; c++) {
          const v = grid[r][c];
          tn[rc(r, c)] = v === 1 ? 'good' : v === 2 ? 'bad' : 'muted';
        }
      for (const [r, c] of q) tn[rc(r, c)] = 'info';
      for (const k of newly) tn[k] = 'warn';
      if (cur) tn[rc(cur[0], cur[1])] = 'active';
      return [
        V.grid(`grid — minute ${time}`, grid, { tones: tn, pointers: { cur }, caption: 'good = fresh · bad = rotten · info = rotten & queued to spread · warn = rotted this minute' }),
        V.queue('q (rotten oranges that spread next)', q.map(([r, c]) => cs(r, c))),
      ];
    });
    t.step('init', 'Empty queue, fresh = 0, time = 0.', { fresh, time });
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        if (grid[r][c] === 1) fresh++;
        if (grid[r][c] === 2) q.push([r, c]);
      }
    t.step('seed', `One pass: ${fresh} fresh orange${fresh === 1 ? '' : 's'} counted, and all ${q.length} rotten orange${q.length === 1 ? '' : 's'} go into the queue together — they all start spreading at minute 0.`, { fresh, 'len(q)': q.length });
    let asked = false;
    while (q.length && fresh > 0) {
      newly.clear();
      t.step('while', `Queue has ${q.length} rotten orange${q.length === 1 ? '' : 's'} and ${fresh} fresh remain → another minute passes.`, { time, fresh, 'len(q)': q.length });
      const n = q.length;
      t.step('level', `Freeze the batch size: len(q) = ${n}. Oranges added during this minute must wait for the next one.`, { time, batch: n });
      if (!asked && time > 0) {
        asked = true;
        t.predict('How many oranges will be popped during this minute?', [String(Math.max(1, n - 1)), String(n), String(n + 1)].filter((v, i, a) => a.indexOf(v) === i), 1, `Exactly the ${n} already in the queue — that is why we snapshot len(q) before the inner loop.`);
      }
      for (let i = 0; i < n; i++) {
        const [r, c] = q.shift()!;
        cur = [r, c];
        t.step('pop', `Pop ${cs(r, c)}: it rots any fresh neighbour.`, { r, c, fresh });
        for (const [dr, dc] of DIRS) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inGrid(nr, nc, R, C) || grid[nr][nc] !== 1) continue;
          grid[nr][nc] = 2;
          q.push([nr, nc]);
          newly.add(rc(nr, nc));
          fresh--;
          t.step('rot', `${cs(nr, nc)} was fresh → rotten now; enqueue it for the next minute. fresh = ${fresh}.`, { nr, nc, fresh });
        }
      }
      cur = null;
      time++;
      t.step('tick', `Minute ${time} is over.`, { time, fresh });
    }
    newly.clear();
    t.step('while', q.length ? `fresh = 0 — nothing left to rot, stop.` : `Queue is empty — nothing can spread any more (fresh = ${fresh}).`, { time, fresh });
    const ans = fresh === 0 ? time : -1;
    t.predict('What does the function return?', [String(time), '-1', String(time + 1)].filter((v, i, a) => a.indexOf(v) === i), ans === -1 ? 1 : 0, fresh === 0 ? `Every orange rotted after ${time} minute(s).` : `${fresh} fresh orange(s) can never be reached → -1.`);
    t.step('done', fresh === 0 ? `All oranges rotten after ${time} minute${time === 1 ? '' : 's'}.` : `${fresh} fresh orange${fresh === 1 ? '' : 's'} can never rot → -1.`, { result: ans });
    return ans;
  },
};

// ---------------------------------------------------------------------------
// 286. Walls and Gates
// ---------------------------------------------------------------------------

const INF = 2147483647;

const wallsAndGates: Problem<{ rooms: number[][] }> = {
  id: 'walls-and-gates',
  num: 286,
  title: 'Walls and Gates',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'graph-traversal',
  statement:
    'A grid has walls (-1), gates (0) and empty rooms (2147483647, shown as INF). Fill every empty room, in place, with the number of steps to its nearest gate; rooms that cannot reach a gate stay INF.',
  signals: ['distance to the NEAREST of many targets', 'unweighted grid steps', 'fill in place for every cell', 'unreachable stays infinite'],
  insight:
    'Run BFS backwards from all gates at once. BFS reaches cells in order of distance, so the first time any gate\'s wave touches a room is its shortest distance — no room ever needs updating twice.',
  hints: [
    'BFS from each room to a gate is O((R·C)²). Flip the direction.',
    'Put every gate in the queue at distance 0.',
    'Expand level by level; a room is written the first time it is reached, and a visited set stops re-visits.',
  ],
  pitfall: 'Running a separate BFS per gate and taking the minimum — correct but O(gates · R · C); the multi-source BFS gets every room right on first touch.',
  backend: {
    title: 'Nearest edge PoP / replica for every client region',
    detail:
      'A CDN maps each client region (cell) to its nearest point of presence (gate) over a hop-count network, skipping blocked links (walls). Seeding a BFS with every PoP labels all regions with hop distance in one pass — the same technique computes "distance to nearest warehouse" for delivery zones.',
  },
  complexity: { time: 'O(rows · cols)', space: 'O(rows · cols)' },
  code: `
def wallsAndGates(rooms):
    ROWS, COLS = len(rooms), len(rooms[0])
    visit, q = set(), deque()                                @init
    def addRoom(r, c):
        if not (0 <= r < ROWS and 0 <= c < COLS) or (r, c) in visit or rooms[r][c] == -1:   @guard
            return
        visit.add((r, c))
        q.append((r, c))                                     @add
    for r in range(ROWS):
        for c in range(COLS):
            if rooms[r][c] == 0:
                q.append((r, c))                             @seed
                visit.add((r, c))
    dist = 0
    while q:                                                 @while
        for _ in range(len(q)):                              @level
            r, c = q.popleft()                               @pop
            rooms[r][c] = dist                               @set
            for dr, dc in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                addRoom(r + dr, c + dc)                      @expand
        dist += 1                                            @inc
`,
  explain: {
    guard: 'Skip out-of-bounds, walls, and rooms some gate already claimed (it was closer or tied).',
    seed: 'Every gate starts in the queue — multi-source BFS.',
    level: 'One level = one more step away from the nearest gate.',
    set: 'The first wave to reach a room is the shortest distance.',
  },
  distractors: [
    { text: '            rooms[r][c] = min(rooms[r][c], dist)', why: 'Harmless but pointless: with BFS order the first assignment is already the minimum — needing min() hints you are re-visiting rooms.' },
    { text: '    for gate in gates:\n        bfs(gate)', why: 'A BFS per gate costs O(gates · R · C); seeding all gates in ONE queue does it in O(R · C).' },
    { text: '        if not (0 <= r < ROWS and 0 <= c < COLS) or rooms[r][c] == -1:', why: 'Without the visited check rooms are enqueued repeatedly and later waves overwrite shorter distances.' },
  ],
  input: {
    rooms: [
      [INF, -1, 0, INF],
      [INF, INF, INF, -1],
      [INF, -1, INF, -1],
      [0, -1, INF, INF],
    ],
  },
  presets: [
    { label: 'walled-off room', input: { rooms: [[0, -1, INF], [INF, -1, INF], [INF, -1, INF]] } },
    { label: 'single gate', input: { rooms: [[INF, INF, INF], [INF, 0, INF], [INF, INF, INF]] } },
  ],
  validate: ({ rooms }) => checkGrid(rooms, 5, (v) => v === -1 || v === 0 || v === INF, '-1, 0 or 2147483647'),
  trace(t, { rooms }) {
    const R = rooms.length;
    const C = rooms[0].length;
    const visit = new Set<string>();
    let q: Cell[] = [];
    let cur: Cell | null = null;
    let nxt: Cell | null = null;
    let dist = 0;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (let r = 0; r < R; r++)
        for (let c = 0; c < C; c++) {
          const v = rooms[r][c];
          if (v === -1) tn[rc(r, c)] = 'muted';
          else if (v === 0) tn[rc(r, c)] = 'warn';
          else if (v !== INF) tn[rc(r, c)] = 'good';
        }
      for (const [r, c] of q) tn[rc(r, c)] = 'info';
      if (cur) tn[rc(cur[0], cur[1])] = 'active';
      return [
        V.grid('rooms', rooms.map((row) => row.map((v) => (v === INF ? 'INF' : v))), { tones: tn, pointers: { cur, next: nxt }, caption: 'muted = wall · warn = gate · good = distance set · info = queued' }),
        V.queue('q', q.map(([r, c]) => cs(r, c))),
      ];
    });
    t.step('init', 'Instead of searching from every room for a gate, search from all gates at once.');
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++)
        if (rooms[r][c] === 0) {
          q.push([r, c]);
          visit.add(rc(r, c));
          t.step('seed', `Gate at ${cs(r, c)} → enqueue at distance 0.`, { r, c });
        }
    let askLevel = true;
    let askDup = true;
    while (q.length) {
      cur = null;
      nxt = null;
      t.step('while', `Queue holds ${q.length} cell${q.length === 1 ? '' : 's'}, all exactly ${dist} step${dist === 1 ? '' : 's'} from their nearest gate.`, { dist, 'len(q)': q.length });
      const n = q.length;
      t.step('level', `Process this whole level (${n} cell${n === 1 ? '' : 's'}).`, { dist, batch: n });
      if (askLevel && dist === 1) {
        askLevel = false;
        t.predict('What value will the rooms popped in this level receive?', ['0', '1', '2'], 1, 'Everything in this level was discovered one step from a gate, so it gets dist = 1.');
      }
      for (let i = 0; i < n; i++) {
        const [r, c] = q.shift()!;
        cur = [r, c];
        nxt = null;
        t.step('pop', `Pop ${cs(r, c)}.`, { r, c, dist });
        rooms[r][c] = dist;
        t.step('set', `rooms${cs(r, c)} = ${dist} — the first wave to arrive is the shortest distance.`, { r, c, dist });
        for (const [dr, dc] of DIRS) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inGrid(nr, nc, R, C) || rooms[nr][nc] === -1) continue;
          nxt = [nr, nc];
          if (visit.has(rc(nr, nc))) {
            if (askDup && rooms[nr][nc] === INF) {
              askDup = false;
              t.step('expand', `addRoom${cs(nr, nc)} — an empty room that is already queued.`, { nr, nc });
              t.predict(`Will ${cs(nr, nc)} be enqueued again from ${cs(r, c)}?`, ['Yes', 'No'], 1, 'It is already in visit: another cell at the same or smaller distance claimed it first, so this path cannot be shorter.');
              t.step('guard', `${cs(nr, nc)} is in visit — rejected.`, { nr, nc });
            }
            continue;
          }
          visit.add(rc(nr, nc));
          q.push([nr, nc]);
          t.step('add', `${cs(nr, nc)} is an unclaimed room → enqueue (it will get distance ${dist + 1}).`, { nr, nc });
        }
      }
      cur = null;
      nxt = null;
      dist++;
      t.step('inc', `Level finished; dist = ${dist}.`, { dist });
    }
    t.step('while', 'Queue empty: every reachable room has its distance; unreachable rooms stay INF.');
    return rooms;
  },
};

// ---------------------------------------------------------------------------
// 207. Course Schedule (Kahn's algorithm)
// ---------------------------------------------------------------------------

const courseSchedule: Problem<{ numCourses: number; prerequisites: number[][] }> = {
  id: 'course-schedule',
  num: 207,
  title: 'Course Schedule',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'topo-sort',
  statement:
    'There are numCourses courses and pairs [a, b] meaning "take b before a". Decide whether it is possible to finish every course.',
  signals: ['"prerequisites" / "depends on"', 'pairs that define an order', 'can everything be completed?', 'impossible exactly when there is a cycle'],
  insight:
    'Model b → a edges. Repeatedly take a course with no remaining prerequisites (in-degree 0) and remove its outgoing edges. If a cycle exists, its courses never reach in-degree 0, so fewer than numCourses get taken.',
  hints: [
    'Draw it as a directed graph. When is the schedule impossible?',
    'Which courses can you take on day one?',
    'Kahn: queue all in-degree-0 courses; when one is taken, decrement its dependants and enqueue any that hit 0. Compare the count taken to numCourses.',
  ],
  pitfall: 'Building edges in the wrong direction (a → b) — in-degrees then count dependants instead of prerequisites and the algorithm starts from the wrong courses.',
  backend: {
    title: 'Build / deploy order and cycle detection for services',
    detail:
      'A CI system (Bazel, npm workspaces, Terraform) must build targets after their dependencies. Kahn\'s algorithm over the dependency DAG yields a valid order and, when some targets never reach in-degree 0, pinpoints a circular dependency to report instead of hanging.',
  },
  complexity: { time: 'O(V + E)', space: 'O(V + E)' },
  code: `
def canFinish(numCourses, prerequisites):
    adj = [[] for _ in range(numCourses)]
    indeg = [0] * numCourses                                  @init
    for crs, pre in prerequisites:
        adj[pre].append(crs)                                  @edge
        indeg[crs] += 1
    q = deque(c for c in range(numCourses) if indeg[c] == 0)  @seed
    taken = 0
    while q:                                                  @while
        node = q.popleft()                                    @pop
        taken += 1
        for nei in adj[node]:                                 @loop
            indeg[nei] -= 1                                   @dec
            if indeg[nei] == 0:
                q.append(nei)                                 @push
    return taken == numCourses                                @done
`,
  explain: {
    edge: 'Edge pre → crs: finishing pre unlocks crs.',
    seed: 'Courses with no prerequisites can be taken immediately.',
    dec: 'One prerequisite of nei is now satisfied.',
    push: 'All prerequisites satisfied → nei becomes takeable.',
    done: 'Courses on a cycle never reach in-degree 0, so they are never taken.',
  },
  distractors: [
    { text: '        adj[crs].append(pre)', why: 'Reversed edges: "taking" a course would then unlock its prerequisites. The edge must go pre → crs.' },
    { text: '            if indeg[nei] <= 1:', why: 'Enqueues a course while it still waits on another prerequisite (and may enqueue it twice).' },
    { text: '    return len(q) == 0', why: 'The queue is always empty when the loop ends — that says nothing about whether every course was taken.' },
  ],
  input: { numCourses: 5, prerequisites: [[1, 0], [2, 0], [3, 1], [3, 2], [4, 3]] },
  presets: [
    { label: 'cycle', input: { numCourses: 4, prerequisites: [[1, 0], [2, 1], [3, 2], [1, 3]] } },
    { label: 'no prerequisites', input: { numCourses: 3, prerequisites: [] } },
  ],
  validate: ({ numCourses, prerequisites }) => {
    if (!isInt(numCourses) || !Array.isArray(prerequisites)) return 'Expected { numCourses: number, prerequisites: [course, prereq][] }';
    if (numCourses < 1 || numCourses > 8) return 'Keep numCourses between 1 and 8';
    if (prerequisites.length > 12) return 'Keep ≤ 12 prerequisite pairs';
    if (!prerequisites.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => isInt(v) && v >= 0 && v < numCourses))) return 'Each pair must be [course, prereq] with values in 0..numCourses-1';
    return null;
  },
  trace(t, { numCourses: n, prerequisites }) {
    const ids = Array.from({ length: n }, (_, i) => i);
    const adj: number[][] = ids.map(() => []);
    const indeg = ids.map(() => 0);
    const edges: [number, number][] = prerequisites.map(([crs, pre]) => [pre, crs]);
    const pos = layered(ids, edges);
    const shown: [number, number][] = [];
    const used = new Set<string>();
    let q: number[] = [];
    const takenSet = new Set<number>();
    let node = -1;
    let edge = '';
    let finished = false;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const c of takenSet) tn[String(c)] = 'good';
      for (const c of q) tn[String(c)] = 'info';
      if (node >= 0) tn[String(node)] = 'active';
      if (finished) for (const c of ids) if (!takenSet.has(c)) tn[String(c)] = 'bad';
      const et: Record<string, Tone> = {};
      for (const k of used) et[k] = 'muted';
      if (edge) et[edge] = 'active';
      const badges: Record<string, string> = {};
      for (const c of ids) badges[String(c)] = `in ${indeg[c]}`;
      return [
        V.graph('courses (arrow pre → course)', ids, shown, { directed: true, positions: pos, tones: tn, edgeTones: et, badges, caption: 'badge = remaining prerequisites · info = in queue · good = taken · muted edge = satisfied' }),
        V.array('indeg', indeg, { tones: node >= 0 ? { [node]: 'active' } : {} }),
        V.queue('q (takeable now)', q),
      ];
    });
    t.step('init', `${n} courses, empty adjacency lists, every in-degree 0.`);
    for (const [crs, pre] of prerequisites) {
      adj[pre].push(crs);
      indeg[crs]++;
      shown.push([pre, crs]);
      edge = `${pre}->${crs}`;
      t.step('edge', `[${crs}, ${pre}]: ${pre} must come before ${crs}. Edge ${pre} → ${crs}; indeg[${crs}] = ${indeg[crs]}.`, { crs, pre });
    }
    edge = '';
    q = ids.filter((c) => indeg[c] === 0);
    t.step('seed', `Courses with in-degree 0 need nothing first: q = [${q.join(', ')}].`, { q: [...q] });
    let taken = 0;
    let askNo = true;
    let askYes = true;
    while (q.length) {
      node = -1;
      t.step('while', `${q.length} course${q.length === 1 ? '' : 's'} ready to take.`, { 'len(q)': q.length, taken });
      node = q.shift()!;
      taken++;
      takenSet.add(node);
      t.step('pop', `Take course ${node}. taken = ${taken}.`, { node, taken });
      for (const nei of adj[node]) {
        edge = `${node}->${nei}`;
        t.step('loop', `Course ${nei} was waiting on ${node}.`, { node, nei, [`indeg[${nei}]`]: indeg[nei] });
        const zero = indeg[nei] - 1 === 0;
        if ((zero && askYes && !askNo) || (!zero && askNo)) {
          if (zero) askYes = false;
          else askNo = false;
          t.predict(`After the decrement, does course ${nei} join the queue?`, ['Yes', 'No'], zero ? 0 : 1, zero ? `indeg[${nei}] drops to 0 — ${node} was its last missing prerequisite.` : `indeg[${nei}] only drops to ${indeg[nei] - 1}; it still waits on another course.`);
        }
        indeg[nei]--;
        used.add(edge);
        if (indeg[nei] === 0) {
          q.push(nei);
          t.step('push', `indeg[${nei}] = 0 → every prerequisite is done, enqueue ${nei}.`, { nei, q: [...q] });
        } else {
          t.step('dec', `indeg[${nei}] = ${indeg[nei]} — still waiting on ${indeg[nei]} more.`, { nei, [`indeg[${nei}]`]: indeg[nei] });
        }
        edge = '';
      }
    }
    node = -1;
    t.step('while', 'Queue empty — no more takeable courses.', { taken, numCourses: n });
    t.predict('Can every course be finished?', ['True', 'False'], taken === n ? 0 : 1, taken === n ? `taken = ${taken} = numCourses.` : `Only ${taken} of ${n} taken: the rest sit on a cycle and never reach in-degree 0.`);
    finished = true;
    t.step('done', taken === n ? `taken = ${taken} = numCourses → True.` : `taken = ${taken} < ${n}: the red courses form/depend on a cycle → False.`, { taken, result: taken === n });
    return taken === n;
  },
};

// ---------------------------------------------------------------------------
// 210. Course Schedule II (DFS with path set)
// ---------------------------------------------------------------------------

const courseSchedule2: Problem<{ numCourses: number; prerequisites: number[][] }> = {
  id: 'course-schedule-ii',
  num: 210,
  title: 'Course Schedule II',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'topo-sort',
  statement:
    'Same setup as Course Schedule — pairs [a, b] mean b must come before a — but now return one valid order to take all courses, or an empty list if none exists.',
  signals: ['need the actual ORDER, not just yes/no', 'dependencies between tasks', 'return empty when impossible (cycle)', 'any valid order accepted'],
  insight:
    'DFS into a course\'s prerequisites first and append the course only after all of them are appended (post-order). A "currently on the path" set detects cycles: reaching a course that is still on the path means it depends on itself.',
  hints: [
    'If you finish all prerequisites of a course, where can that course go in the answer?',
    'Post-order DFS over prerequisite edges produces a valid order directly.',
    'Keep two sets: visit (done, already in output) and cycle (on the current DFS path). Hitting cycle → return [].',
  ],
  pitfall: 'Using a single visited set for both "finished" and "on the current path" — you either miss cycles or falsely report them on diamond-shaped dependencies.',
  backend: {
    title: 'Ordering database migrations / Terraform resources',
    detail:
      'A migration runner (Flyway, Alembic with branches) or Terraform must apply resources after everything they reference. Post-order DFS over the "depends on" graph emits a safe apply order, and the on-path set reports the exact circular reference when someone writes A → B → A.',
  },
  complexity: { time: 'O(V + E)', space: 'O(V + E)' },
  code: `
def findOrder(numCourses, prerequisites):
    prereq = {c: [] for c in range(numCourses)}
    for crs, pre in prerequisites:
        prereq[crs].append(pre)                      @build
    output, visit, cycle = [], set(), set()          @init
    def dfs(crs):
        if crs in cycle:                             @inCycle
            return False                             @fail
        if crs in visit:                             @isDone
            return True                              @skip
        cycle.add(crs)                               @enter
        for pre in prereq[crs]:                      @loop
            if not dfs(pre):                         @recurse
                return False
        cycle.remove(crs)                            @leave
        visit.add(crs)
        output.append(crs)                           @emit
        return True
    for c in range(numCourses):                      @outer
        if not dfs(c):
            return []                                @noOrder
    return output                                    @ret
`,
  explain: {
    inCycle: 'crs is still on the current path: following prerequisites led back to it → cycle.',
    isDone: 'Already emitted earlier — its whole prerequisite chain is in output.',
    enter: 'Put crs on the current path before exploring its prerequisites.',
    leave: 'All prerequisites emitted: crs leaves the path and becomes "done".',
    emit: 'Post-order: a course is appended only after everything it depends on.',
  },
  distractors: [
    { text: '        output.append(crs)\n        for pre in prereq[crs]:', why: 'Pre-order: the course is emitted BEFORE its prerequisites, giving an invalid order.' },
    { text: '        if crs in visit:\n            return False', why: 'Treats a finished course as a cycle — a diamond (two courses sharing a prerequisite) is falsely rejected.' },
    { text: '        visit.add(crs)\n        cycle.add(crs)', why: 'Marking visit on entry means a cycle back to crs looks "done" and is never detected.' },
  ],
  input: { numCourses: 4, prerequisites: [[0, 1], [0, 2], [1, 3], [2, 3]] },
  presets: [
    { label: 'cycle', input: { numCourses: 3, prerequisites: [[0, 1], [1, 2], [2, 0]] } },
    { label: 'chain + loner', input: { numCourses: 4, prerequisites: [[2, 1], [1, 0]] } },
  ],
  validate: courseSchedule.validate,
  trace(t, { numCourses: n, prerequisites }) {
    const ids = Array.from({ length: n }, (_, i) => i);
    const prereq: number[][] = ids.map(() => []);
    const shown: [number, number][] = [];
    const pos = layered(ids, prerequisites.map(([crs, pre]) => [pre, crs] as [number, number]));
    const output: number[] = [];
    const visit = new Set<number>();
    const cycle = new Set<number>();
    const stack: number[] = [];
    let edge = '';
    let bad = -1;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const c of visit) tn[String(c)] = 'good';
      for (const c of cycle) tn[String(c)] = 'warn';
      if (stack.length) tn[String(stack[stack.length - 1])] = 'active';
      if (bad >= 0) tn[String(bad)] = 'bad';
      return [
        V.graph('courses (arrow pre → course)', ids, shown, { directed: true, positions: pos, tones: tn, edgeTones: edge ? { [edge]: bad >= 0 ? 'bad' : 'active' } : {}, caption: 'warn = on current DFS path (cycle set) · good = done (in output)' }),
        V.stack('dfs call stack', stack.map((c) => `dfs(${c})`)),
        V.chips('output', output),
      ];
    });
    for (const [crs, pre] of prerequisites) {
      prereq[crs].push(pre);
      shown.push([pre, crs]);
      edge = `${pre}->${crs}`;
      t.step('build', `${crs} needs ${pre}: prereq[${crs}] = [${prereq[crs].join(', ')}].`, { crs, pre });
    }
    edge = '';
    t.step('init', 'output, visit (finished) and cycle (on the current path) all start empty.');
    let askDone = true;
    let askEmit = true;
    const dfs = (c: number): boolean => {
      stack.push(c);
      if (cycle.has(c)) {
        bad = c;
        t.step('inCycle', `${c} is already on the current path — following prerequisites came back to it.`, { crs: c });
        t.step('fail', `Cycle detected → return False all the way up.`, { crs: c });
        stack.pop();
        return false;
      }
      if (visit.has(c)) {
        t.step('isDone', `${c} is already done (in output).`, { crs: c });
        t.step('skip', 'Return True immediately — no need to explore it again.', { crs: c });
        stack.pop();
        return true;
      }
      cycle.add(c);
      t.step('enter', `Put ${c} on the current path, then make sure each of its prerequisites [${prereq[c].join(', ')}] is placed first.`, { crs: c });
      for (const p of prereq[c]) {
        edge = `${p}->${c}`;
        t.step('loop', `${c} needs ${p}: call dfs(${p}).`, { crs: c, pre: p });
        if (askDone && visit.has(p)) {
          askDone = false;
          t.predict(`What will dfs(${p}) do?`, ['Return True immediately', 'Explore it again', 'Report a cycle'], 0, `${p} is green: already in output (visit), not on the current path.`);
        }
        const ok = dfs(p);
        edge = `${p}->${c}`;
        if (!ok) {
          t.step('recurse', `dfs(${p}) failed → ${c} cannot be scheduled either.`, { crs: c });
          stack.pop();
          return false;
        }
        edge = '';
      }
      if (askEmit) {
        askEmit = false;
        t.step('leave', `Every prerequisite of ${c} is in output.`, { crs: c });
        t.predict(`Is it safe to append ${c} to output now?`, ['Yes', 'No — wait until all courses are visited'], 0, 'Post-order: everything it depends on is already in output, so placing it next keeps the order valid.');
      }
      cycle.delete(c);
      visit.add(c);
      t.step('leave', `${c} leaves the path and becomes done.`, { crs: c });
      output.push(c);
      t.step('emit', `Append ${c}: output = [${output.join(', ')}].`, { output: [...output] });
      stack.pop();
      return true;
    };
    for (const c of ids) {
      t.step('outer', `Outer loop: dfs(${c})${visit.has(c) ? ' — already done' : ''}.`, { c });
      if (!dfs(c)) {
        t.step('noOrder', 'A cycle exists → no valid order, return [].', { result: [] });
        return [];
      }
    }
    t.step('ret', `Valid order: [${output.join(', ')}].`, { result: output });
    return output;
  },
};

// ---------------------------------------------------------------------------
// Union-find drawing helper
// ---------------------------------------------------------------------------

function forestEdges(nodes: readonly number[], par: readonly number[]): [number, number][] {
  return nodes.filter((i) => par[i] !== i).map((i) => [i, par[i]]);
}

// ---------------------------------------------------------------------------
// 684. Redundant Connection
// ---------------------------------------------------------------------------

const redundantConnection: Problem<{ edges: number[][] }> = {
  id: 'redundant-connection',
  num: 684,
  title: 'Redundant Connection',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'union-find',
  statement:
    'A tree on nodes 1..n had one extra edge added, creating exactly one cycle. Given the n edges, return the edge that can be removed to get a tree again (the last such edge in the input if several work).',
  signals: ['tree + one extra edge', '"which edge creates a cycle"', 'edges arrive one by one', 'undirected connectivity'],
  insight:
    'Add edges one at a time while tracking connected components with union-find. The first edge whose two endpoints are already in the same component closes the cycle — that is the redundant one.',
  hints: [
    'An edge creates a cycle exactly when its endpoints are already connected.',
    'How can you answer "are a and b connected?" quickly while edges keep being added?',
    'Union-find: find(a) == find(b) → return [a, b]; otherwise union their roots.',
  ],
  pitfall: 'Comparing a and b (or par[a] and par[b]) instead of their ROOTS — nodes in the same component usually have different direct parents.',
  backend: {
    title: 'Detecting redundant links / loops in a network topology',
    detail:
      'When an SDN controller adds links between switches it must keep a loop-free spanning tree (like STP). Union-find over switch IDs answers "are these switches already connected?" in near-O(1), so the controller can flag the link that would create a broadcast loop the moment it is configured.',
  },
  complexity: { time: 'O(n · α(n))', space: 'O(n)' },
  code: `
def findRedundantConnection(edges):
    par = list(range(len(edges) + 1))
    rank = [1] * (len(edges) + 1)                   @init
    def find(x):
        while x != par[x]:                          @climb
            par[x] = par[par[x]]                    @compress
            x = par[x]
        return x
    for a, b in edges:                              @loop
        ra, rb = find(a), find(b)                   @find
        if ra == rb:                                @same
            return [a, b]                           @found
        if rank[ra] < rank[rb]:                     @rank
            ra, rb = rb, ra
        par[rb] = ra                                @link
        rank[ra] += rank[rb]
`,
  explain: {
    init: 'Every node starts as its own component (its own root).',
    compress: 'Path halving: point x at its grandparent so future finds are shorter.',
    same: 'Same root → a and b were already connected → this edge closes a cycle.',
    rank: 'Hang the smaller tree under the bigger one to keep trees shallow.',
    link: 'Merge the two components.',
  },
  distractors: [
    { text: '        if par[a] == par[b]:', why: 'Direct parents can differ even inside one component — compare the roots from find().' },
    { text: '        par[a] = b', why: 'Linking the endpoints instead of the roots can detach a from the rest of its component.' },
    { text: '    for a, b in reversed(edges):', why: 'Union-find must replay edges in input order; the first edge that closes a cycle in that order is the answer.' },
  ],
  input: { edges: [[1, 2], [2, 3], [3, 4], [1, 4], [1, 5]] },
  presets: [
    { label: 'triangle', input: { edges: [[1, 2], [1, 3], [2, 3]] } },
    { label: 'cycle not at the start', input: { edges: [[1, 2], [3, 4], [2, 5], [4, 5], [3, 5]] } },
  ],
  validate: ({ edges }) => {
    if (!Array.isArray(edges) || edges.length < 3) return 'Expected { edges: [a, b][] } with at least 3 edges';
    if (edges.length > 8) return 'Keep ≤ 8 edges';
    if (!edges.every((e) => Array.isArray(e) && e.length === 2 && e.every((v) => isInt(v) && v >= 1 && v <= edges.length))) return 'Edges must be [a, b] with nodes 1..n (n = number of edges)';
    return null;
  },
  trace(t, { edges }) {
    const n = edges.length;
    const nodes = Array.from({ length: n }, (_, i) => i + 1);
    const pos = circle(nodes);
    const par = Array.from({ length: n + 1 }, (_, i) => i);
    const rank = par.map(() => 1);
    const et: Record<string, Tone> = {};
    let k = -1;
    let hl: number[] = [];
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const i of nodes) if (par[i] === i) tn[String(i)] = 'info';
      for (const i of hl) tn[String(i)] = 'active';
      return [
        V.graph('edges added so far', nodes, edges.slice(0, k + 1).map(([a, b]) => [a, b] as [number, number]), { positions: pos, edgeTones: et, tones: hl.length ? tones2(hl) : {} }),
        V.graph('union-find forest (child → parent)', nodes, forestEdges(nodes, par), { directed: true, positions: pos, tones: tn, caption: 'info = root of a component' }),
        V.array('par (index 0 unused)', par, { tones: tones2(hl) }),
        V.array('rank', rank),
      ];
    });
    function tones2(ks: number[]): Record<number, Tone> {
      const o: Record<number, Tone> = {};
      for (const x of ks) o[x] = 'active';
      return o;
    }
    const find = (x: number) => {
      while (x !== par[x]) {
        if (par[par[x]] !== par[x]) {
          const old = par[x];
          par[x] = par[par[x]];
          hl = [x];
          t.step('compress', `Path halving: par[${x}] jumps from ${old} to its grandparent ${par[x]}.`, { x });
        }
        x = par[x];
      }
      return x;
    };
    t.step('init', `par[i] = i: each of the ${n} nodes is its own component.`, { n });
    let askNo = true;
    for (k = 0; k < n; k++) {
      const [a, b] = edges[k];
      hl = [a, b];
      et[`${a}->${b}`] = 'active';
      t.step('loop', `Edge ${a}–${b}.`, { a, b });
      const cyc = find(a) === find(b);
      if (cyc || askNo) {
        if (!cyc) askNo = false;
        t.predict(`Does edge ${a}–${b} close a cycle?`, ['Yes', 'No'], cyc ? 0 : 1, cyc ? `${a} and ${b} are already in the same tree of the forest.` : `${a} and ${b} lie in different trees of the forest.`);
      }
      const ra = find(a);
      const rb = find(b);
      hl = [a, b];
      t.step('find', `find(${a}) = ${ra}, find(${b}) = ${rb}.`, { a, b, ra, rb });
      if (ra === rb) {
        et[`${a}->${b}`] = 'bad';
        t.step('same', `Same root ${ra}: ${a} and ${b} were already connected, so this edge forms the cycle.`, { ra, rb });
        t.step('found', `Return [${a}, ${b}].`, { result: [a, b] });
        return [a, b];
      }
      let x = ra;
      let y = rb;
      if (rank[x] < rank[y]) [x, y] = [y, x];
      t.step('rank', `rank[${ra}] = ${rank[ra]}, rank[${rb}] = ${rank[rb]} → the bigger tree's root ${x} becomes the parent.`, { ra: x, rb: y });
      par[y] = x;
      rank[x] += rank[y];
      et[`${a}->${b}`] = 'good';
      hl = [y];
      t.step('link', `par[${y}] = ${x}; rank[${x}] = ${rank[x]}. Components merged.`, { ra: x, rb: y });
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// 323. Number of Connected Components in an Undirected Graph
// ---------------------------------------------------------------------------

const countComponents: Problem<{ n: number; edges: number[][] }> = {
  id: 'number-of-connected-components-in-an-undirected-graph',
  num: 323,
  title: 'Number of Connected Components in an Undirected Graph',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'union-find',
  statement: 'Given n nodes labelled 0..n-1 and a list of undirected edges, return how many separate connected groups the graph has.',
  signals: ['"connected components"', 'undirected edge list', 'grouping / merging', 'only the count matters'],
  insight:
    'Start with n components. Every edge that joins two DIFFERENT components merges them and reduces the count by one; an edge inside a component changes nothing.',
  hints: [
    'How many components are there before any edge is added?',
    'When does adding an edge NOT reduce the count?',
    'Union-find: union returns 1 if two roots merged, 0 if already joined; res -= union(a, b).',
  ],
  pitfall: 'Decrementing the count for every edge — edges inside an existing component (cycles) must not reduce it.',
  backend: {
    title: 'Grouping duplicate user accounts (identity resolution)',
    detail:
      'An identity service links accounts that share an email, phone or device fingerprint. Each shared attribute is an edge; union-find merges accounts into clusters and the component count is the number of real users — used for fraud detection and GDPR "export all my data" requests.',
  },
  complexity: { time: 'O(E · α(n))', space: 'O(n)' },
  code: `
def countComponents(n, edges):
    par = list(range(n))
    rank = [1] * n                                  @init
    def find(x):
        while x != par[x]:                          @climb
            par[x] = par[par[x]]                    @compress
            x = par[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)                   @find
        if ra == rb:                                @same
            return 0                                @noMerge
        if rank[ra] < rank[rb]:                     @rank
            ra, rb = rb, ra
        par[rb] = ra                                @link
        rank[ra] += rank[rb]
        return 1
    res = n                                         @res
    for a, b in edges:                              @loop
        res -= union(a, b)                          @merge
    return res                                      @done
`,
  explain: {
    res: 'n isolated nodes = n components.',
    noMerge: 'Already in one component: the edge adds a cycle, not a merge.',
    link: 'Two components become one.',
    merge: 'Count drops only when union actually merged something.',
  },
  distractors: [
    { text: '        res -= 1', why: 'Decrements for edges inside a component too — cycles would undercount.' },
    { text: '    return len(set(par))', why: 'par holds direct parents, not roots; without a final find() on each node this over-counts.' },
  ],
  input: { n: 6, edges: [[0, 1], [1, 2], [3, 4], [0, 2]] },
  presets: [
    { label: 'no edges', input: { n: 3, edges: [] } },
    { label: 'one chain', input: { n: 5, edges: [[0, 1], [1, 2], [2, 3], [3, 4]] } },
  ],
  validate: ({ n, edges }) => {
    if (!isInt(n) || !Array.isArray(edges)) return 'Expected { n: number, edges: [a, b][] }';
    if (n < 1 || n > 8) return 'Keep n between 1 and 8';
    if (edges.length > 12) return 'Keep ≤ 12 edges';
    if (!edges.every((e) => Array.isArray(e) && e.length === 2 && e.every((v) => isInt(v) && v >= 0 && v < n))) return 'Edges must be [a, b] with nodes 0..n-1';
    return null;
  },
  trace(t, { n, edges }) {
    const nodes = Array.from({ length: n }, (_, i) => i);
    const pos = circle(nodes);
    const par = [...nodes];
    const rank = nodes.map(() => 1);
    const et: Record<string, Tone> = {};
    let k = -1;
    let hl: number[] = [];
    let res = n;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const i of nodes) if (par[i] === i) tn[String(i)] = 'good';
      for (const i of hl) tn[String(i)] = 'active';
      const at: Record<number, Tone> = {};
      for (const i of hl) at[i] = 'active';
      return [
        V.graph('edges added so far', nodes, edges.slice(0, k + 1).map(([a, b]) => [a, b] as [number, number]), { positions: pos, edgeTones: et }),
        V.graph(`union-find forest — ${res} component${res === 1 ? '' : 's'}`, nodes, forestEdges(nodes, par), { directed: true, positions: pos, tones: tn, caption: 'good = root (one per component)' }),
        V.array('par', par, { tones: at }),
      ];
    });
    const find = (x: number) => {
      while (x !== par[x]) {
        if (par[par[x]] !== par[x]) {
          const old = par[x];
          par[x] = par[par[x]];
          hl = [x];
          t.step('compress', `Path halving: par[${x}] jumps from ${old} to ${par[x]}.`, { x });
        }
        x = par[x];
      }
      return x;
    };
    t.step('init', 'Every node is its own parent.');
    t.step('res', `res = ${n}: before any edge, each node is its own component.`, { res });
    let askNo = true;
    let askYes = true;
    for (k = 0; k < edges.length; k++) {
      const [a, b] = edges[k];
      hl = [a, b];
      et[`${a}->${b}`] = 'active';
      t.step('loop', `Edge ${a}–${b}.`, { a, b, res });
      const same = find(a) === find(b);
      if ((same && askYes) || (!same && askNo)) {
        if (same) askYes = false;
        else askNo = false;
        t.predict(`Does edge ${a}–${b} reduce the component count?`, ['Yes', 'No'], same ? 1 : 0, same ? `${a} and ${b} already share a root — the edge only adds a cycle.` : `${a} and ${b} have different roots, so two components merge into one.`);
      }
      const ra = find(a);
      const rb = find(b);
      hl = [a, b];
      t.step('find', `find(${a}) = ${ra}, find(${b}) = ${rb}.`, { ra, rb });
      if (ra === rb) {
        et[`${a}->${b}`] = 'warn';
        t.step('noMerge', `Same root — already connected. union returns 0; res stays ${res}.`, { res });
        continue;
      }
      let x = ra;
      let y = rb;
      if (rank[x] < rank[y]) [x, y] = [y, x];
      par[y] = x;
      rank[x] += rank[y];
      hl = [y];
      t.step('link', `Hang root ${y} under root ${x} (bigger rank). Components merged.`, { ra: x, rb: y });
      res--;
      et[`${a}->${b}`] = 'good';
      t.step('merge', `union returned 1 → res = ${res}.`, { res });
    }
    hl = [];
    t.step('done', `${res} connected component${res === 1 ? '' : 's'} (one root per component).`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 261. Graph Valid Tree
// ---------------------------------------------------------------------------

const graphValidTree: Problem<{ n: number; edges: number[][] }> = {
  id: 'graph-valid-tree',
  num: 261,
  title: 'Graph Valid Tree',
  difficulty: 'Medium',
  category: 'graphs',
  pattern: 'union-find',
  statement: 'Given n nodes 0..n-1 and a list of undirected edges, decide whether the edges form one valid tree: everything connected and no cycles.',
  signals: ['"valid tree"', 'undirected edges', 'connected AND acyclic', 'n nodes, edge list'],
  insight:
    'A tree on n nodes has exactly n − 1 edges. With that many edges, "no cycle" already implies "connected" — so check the count, then use union-find to make sure no edge joins two nodes that are already connected.',
  hints: [
    'How many edges does any tree with n nodes have?',
    'If the count is right, what is the only remaining way to fail?',
    'Union-find over the edges: any edge with both ends under the same root means a cycle → False.',
  ],
  pitfall: 'Only checking for cycles: a forest of several trees has no cycle but is not one tree. The n − 1 edge count check (or a connectivity check) is required.',
  backend: {
    title: 'Validating an org chart / category hierarchy import',
    detail:
      'When importing a manager → report hierarchy (or a product category tree) the system must reject data with loops (A reports to B reports to A) or disconnected islands. Edge count n − 1 plus a union-find cycle check validates millions of rows in one pass before they reach the database.',
  },
  complexity: { time: 'O(n · α(n))', space: 'O(n)' },
  code: `
def validTree(n, edges):
    if len(edges) != n - 1:                          @count
        return False                                 @countFail
    par = list(range(n))                             @init
    def find(x):
        while x != par[x]:                           @climb
            par[x] = par[par[x]]                     @compress
            x = par[x]
        return x
    for a, b in edges:                               @loop
        ra, rb = find(a), find(b)                    @find
        if ra == rb:                                 @same
            return False                             @cycle
        par[ra] = rb                                 @union
    return True                                      @ok
`,
  explain: {
    count: 'Fewer edges → disconnected; more → a cycle must exist.',
    same: 'Both ends already connected: this edge would close a loop.',
    union: 'Merge the two trees by pointing one root at the other.',
    ok: 'n − 1 edges and no cycle ⇒ connected, i.e. a tree.',
  },
  distractors: [
    { text: '    if len(edges) > n - 1:', why: 'Too FEW edges also fails (the graph is disconnected); the count must be exactly n − 1.' },
    { text: '        par[a] = b', why: 'Linking raw nodes instead of roots can cut a away from the rest of its tree, hiding later cycles.' },
  ],
  input: { n: 5, edges: [[0, 1], [0, 2], [0, 3], [1, 4]] },
  presets: [
    { label: 'cycle + isolated node', input: { n: 4, edges: [[0, 1], [1, 2], [2, 0]] } },
    { label: 'too many edges', input: { n: 4, edges: [[0, 1], [1, 2], [2, 3], [1, 3]] } },
  ],
  validate: countComponents.validate,
  trace(t, { n, edges }) {
    const nodes = Array.from({ length: n }, (_, i) => i);
    const pos = circle(nodes);
    const par = [...nodes];
    const et: Record<string, Tone> = {};
    let k = -1;
    let hl: number[] = [];
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const i of nodes) if (par[i] === i) tn[String(i)] = 'info';
      for (const i of hl) tn[String(i)] = 'active';
      const at: Record<number, Tone> = {};
      for (const i of hl) at[i] = 'active';
      return [
        V.graph('edges', nodes, edges.map(([a, b]) => [a, b] as [number, number]), { positions: pos, edgeTones: et, caption: k < 0 ? 'all edges (not processed yet)' : 'good = merged two trees · bad = closes a cycle' }),
        V.graph('union-find forest (child → parent)', nodes, forestEdges(nodes, par), { directed: true, positions: pos, tones: tn, caption: 'info = root' }),
        V.array('par', par, { tones: at }),
      ];
    });
    t.step('count', `${n} nodes, ${edges.length} edges. A tree on ${n} nodes has exactly ${n - 1} edges.`, { n, 'len(edges)': edges.length });
    if (edges.length !== n - 1) {
      t.predict(`Can ${edges.length} edges on ${n} nodes form a tree?`, ['Yes', 'No'], 1, `Any tree on ${n} nodes has exactly ${n - 1} edges.`);
      t.step('count', `${edges.length} ≠ ${n - 1}.`, { n, 'len(edges)': edges.length });
      t.step('countFail', edges.length < n - 1 ? 'Too few edges — the graph cannot be connected → False.' : 'Too many edges — some edge must close a cycle → False.', { result: false });
      return false;
    }
    t.predict('The edge count is right. Can the answer still be False?', ['Yes — there may be a cycle', 'No — it must be a tree'], 0, 'n − 1 edges with a cycle leaves some node disconnected; we still have to check for cycles.');
    t.step('init', 'Count is right. Now union-find: each node starts as its own root.');
    const find = (x: number) => {
      while (x !== par[x]) {
        if (par[par[x]] !== par[x]) {
          const old = par[x];
          par[x] = par[par[x]];
          hl = [x];
          t.step('compress', `Path halving: par[${x}] jumps from ${old} to its grandparent ${par[x]} — the next find on ${x} is shorter.`, { x });
        }
        x = par[x];
      }
      return x;
    };
    let askedCompress = false;
    for (k = 0; k < edges.length; k++) {
      const [a, b] = edges[k];
      hl = [a, b];
      et[`${a}->${b}`] = 'active';
      t.step('loop', `Edge ${a}–${b}.`, { a, b });
      if (!askedCompress && par[a] !== a && par[par[a]] !== par[a]) {
        askedCompress = true;
        t.predict(`find(${a}) climbs ${a} → ${par[a]} → ${par[par[a]]}… What will par[${a}] be afterwards?`, [String(par[a]), String(par[par[a]]), String(a)], 1, 'Path halving points each visited node at its grandparent while climbing.');
      }
      const ra = find(a);
      const rb = find(b);
      hl = [a, b];
      t.step('find', `find(${a}) = ${ra}, find(${b}) = ${rb}.`, { ra, rb });
      if (ra === rb) {
        et[`${a}->${b}`] = 'bad';
        t.step('same', `Same root ${ra}: ${a} and ${b} are already connected.`, { ra, rb });
        t.step('cycle', 'This edge closes a cycle → not a tree → False.', { result: false });
        return false;
      }
      par[ra] = rb;
      hl = [ra];
      et[`${a}->${b}`] = 'good';
      t.step('union', `par[${ra}] = ${rb}: the two trees are merged.`, { ra, rb });
    }
    hl = [];
    t.step('loop', 'All edges processed without finding a cycle.');
    t.predict(`No cycle among ${n - 1} edges. Is the graph guaranteed to be connected?`, ['Yes', 'No — we never checked connectivity'], 0, `Each of the ${n - 1} edges merged two components: ${n} − ${n - 1} = 1 component left.`);
    t.step('ok', 'n − 1 successful merges leave exactly one component → it is a tree → True.', { result: true });
    return true;
  },
};

// ---------------------------------------------------------------------------
// 127. Word Ladder
// ---------------------------------------------------------------------------

const wordLadder: Problem<{ beginWord: string; endWord: string; wordList: string[] }> = {
  id: 'word-ladder',
  num: 127,
  title: 'Word Ladder',
  difficulty: 'Hard',
  category: 'graphs',
  pattern: 'graph-traversal',
  statement:
    'Transform beginWord into endWord by changing one letter at a time, where every intermediate word must be in wordList. Return the number of words in the shortest such sequence (counting both ends), or 0 if impossible.',
  signals: ['"shortest sequence" of transformations', 'each step changes one small thing', 'implicit graph (words are nodes)', 'unweighted steps → BFS'],
  insight:
    'Words are nodes; one-letter differences are edges. Shortest path in an unweighted graph = BFS. To find neighbours fast, bucket words by wildcard pattern: "hot" lives in "*ot", "h*t", "ho*", and words sharing a bucket are neighbours.',
  hints: [
    'What graph is hiding here, and why is BFS the right search?',
    'Comparing every pair of words to build edges is O(n² · L). Can a key group neighbours together?',
    'Map pattern (one letter replaced by *) → words. BFS level by level, counting levels.',
  ],
  pitfall: 'Marking words visited when they are popped (not when pushed) — the same word is enqueued many times from one level, and BFS blows up.',
  backend: {
    title: 'Fuzzy "did you mean" lookups and minimal config migrations',
    detail:
      'A search service suggests corrections by indexing terms under wildcard keys (h*t → hat, hit, hot) — the same bucketing as a deletion/wildcard index in spell checkers. BFS over that implicit graph finds the fewest single-step edits, e.g. the shortest chain of schema versions to migrate through when only adjacent upgrades are supported.',
  },
  complexity: { time: 'O(n · L²)', space: 'O(n · L²)' },
  code: `
def ladderLength(beginWord, endWord, wordList):
    if endWord not in wordList:                           @noEnd
        return 0
    nei = defaultdict(list)
    wordList.append(beginWord)
    for word in wordList:
        for j in range(len(word)):
            pattern = word[:j] + "*" + word[j + 1:]
            nei[pattern].append(word)                     @bucket
    visit, q = set([beginWord]), deque([beginWord])       @init
    res = 1
    while q:                                              @while
        for _ in range(len(q)):                           @level
            word = q.popleft()                            @pop
            if word == endWord:                           @check
                return res                                @found
            for j in range(len(word)):
                pattern = word[:j] + "*" + word[j + 1:]   @pattern
                for neiWord in nei[pattern]:
                    if neiWord not in visit:              @unseen
                        visit.add(neiWord)
                        q.append(neiWord)                 @push
        res += 1                                          @next
    return 0                                              @none
`,
  explain: {
    bucket: 'Every word is filed under each of its wildcard patterns; one bucket = a set of mutual neighbours.',
    level: 'One BFS level = one more word in the ladder.',
    pattern: 'Neighbours of word = all words in its L buckets — no pairwise comparison needed.',
    unseen: 'Mark on push: a word first reached at this level can never be reached sooner.',
    next: 'Finished a level; the ladder grows by one word.',
  },
  distractors: [
    { text: '            for neiWord in wordList:', why: 'Scanning the whole list per word (and checking one-letter difference) is O(n² · L); the pattern buckets give neighbours directly.' },
    { text: '            res += 1', why: 'Incrementing per popped word counts words explored, not ladder length — it must happen once per BFS level.' },
    { text: '        word = q.pop()', why: 'pop() takes from the back, turning BFS into DFS: the first time you reach endWord is not the shortest ladder.' },
  ],
  input: { beginWord: 'hit', endWord: 'cog', wordList: ['hot', 'dot', 'dog', 'lot', 'log', 'cog'] },
  presets: [
    { label: 'unreachable end', input: { beginWord: 'hit', endWord: 'cog', wordList: ['hot', 'dot', 'lot', 'cog'] } },
    { label: 'one step', input: { beginWord: 'cat', endWord: 'cot', wordList: ['cot', 'cut'] } },
  ],
  validate: ({ beginWord, endWord, wordList }) => {
    if (typeof beginWord !== 'string' || typeof endWord !== 'string' || !Array.isArray(wordList)) return 'Expected { beginWord, endWord, wordList: string[] }';
    if (wordList.length > 9) return 'Keep wordList ≤ 9 words';
    if (beginWord.length < 1 || beginWord.length > 5) return 'Use words of 1–5 letters';
    if (![endWord, ...wordList].every((w) => typeof w === 'string' && w.length === beginWord.length)) return 'All words must have the same length as beginWord';
    return null;
  },
  trace(t, { beginWord, endWord, wordList }) {
    const all = [...new Set([beginWord, ...wordList])];
    const L = beginWord.length;
    const pats = (w: string) => Array.from({ length: L }, (_, j) => w.slice(0, j) + '*' + w.slice(j + 1));
    const edges: [string, string, string][] = [];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const shared = pats(all[i]).find((p) => pats(all[j]).includes(p));
        if (shared && all[i] !== all[j]) edges.push([all[i], all[j], shared]);
      }
    const depth = new Map<string, number>([[beginWord, 0]]);
    const bq = [beginWord];
    while (bq.length) {
      const w = bq.shift()!;
      for (const [a, b] of edges) {
        const o = a === w ? b : b === w ? a : null;
        if (o && !depth.has(o)) {
          depth.set(o, depth.get(w)! + 1);
          bq.push(o);
        }
      }
    }
    const maxD = Math.max(1, ...depth.values()) + (all.some((w) => !depth.has(w)) ? 1 : 0);
    const cols = new Map<number, string[]>();
    for (const w of all) {
      const d = depth.get(w) ?? maxD;
      cols.set(d, [...(cols.get(d) ?? []), w]);
    }
    const pos: Record<string, [number, number]> = {};
    for (const [d, col] of cols) col.forEach((w, i) => (pos[w] = [Math.round(8 + (84 * d) / maxD), Math.round((100 * (i + 1)) / (col.length + 1))]));

    const nei = new Map<string, string[]>();
    const visit = new Set<string>();
    let q: string[] = [];
    let cur = '';
    let hlPat: string[] = [];
    const badges: Record<string, string> = {};
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const w of visit) tn[w] = 'good';
      for (const w of q) tn[w] = 'info';
      if (cur) tn[cur] = 'active';
      if (!tn[endWord]) tn[endWord] = 'warn';
      return [
        V.graph('words (edge = one letter apart)', all, edges, { positions: pos, tones: tn, badges, caption: 'warn = endWord · info = queued · good = visited · badge = ladder length when reached' }),
        V.queue('q', q),
        nei.size > 0 && V.map('nei (pattern → words)', nei, { hl: hlPat }),
      ];
    });
    if (!wordList.includes(endWord)) {
      t.step('noEnd', `"${endWord}" is not in wordList, so no ladder can end there.`);
      t.step('noEnd', 'Return 0 without searching.', { result: 0 });
      t.step('none', 'Answer: 0.', { result: 0 });
      return 0;
    }
    t.step('noEnd', `"${endWord}" is in wordList — a ladder may exist.`);
    for (const w of [...wordList, beginWord]) {
      for (const p of pats(w)) nei.set(p, [...(nei.get(p) ?? []), w]);
      hlPat = pats(w);
      t.step('bucket', `File "${w}" under ${pats(w).join(', ')}.`, { word: w });
    }
    hlPat = [];
    visit.add(beginWord);
    q = [beginWord];
    badges[beginWord] = '1';
    t.step('init', `BFS from "${beginWord}". It is word #1 of the ladder.`, { res: 1 });
    let res = 1;
    let askBucket = true;
    let askEnd = true;
    while (q.length) {
      cur = '';
      t.step('while', `Level ${res}: ${q.length} word${q.length === 1 ? '' : 's'} at ladder length ${res}.`, { res, q: [...q] });
      const n = q.length;
      t.step('level', `Process exactly these ${n} word${n === 1 ? '' : 's'}; words found now belong to length ${res + 1}.`, { res });
      for (let i = 0; i < n; i++) {
        const w = q.shift()!;
        cur = w;
        hlPat = [];
        t.step('pop', `Pop "${w}".`, { word: w, res });
        if (w === endWord) {
          if (askEnd) {
            askEnd = false;
            t.predict('This is endWord. What does the function return?', [String(res - 1), String(res), String(res + 1)], 1, `res counts words in the ladder, and "${w}" was reached on level ${res}.`);
          }
          t.step('check', `"${w}" is the target.`, { res });
          t.step('found', `Shortest ladder has ${res} words.`, { result: res });
          return res;
        }
        t.step('check', `"${w}" is not the target — expand its buckets.`, { word: w });
        for (const p of pats(w)) {
          const bucket = nei.get(p) ?? [];
          const fresh = bucket.filter((x) => !visit.has(x));
          hlPat = [p];
          if (askBucket && bucket.length >= 3) {
            askBucket = false;
            t.step('pattern', `Bucket "${p}" = [${bucket.join(', ')}].`, { pattern: p });
            t.predict(`How many words from "${p}" get enqueued?`, ['0', '1', '2', '3'].slice(0, Math.max(4, fresh.length + 1)), Math.min(fresh.length, 3), fresh.length ? `Only the unvisited ones: ${fresh.join(', ')}.` : 'All of them are already visited (green/blue).');
          }
          t.step('pattern', `Bucket "${p}" = [${bucket.join(', ')}]${fresh.length ? ` — new: ${fresh.join(', ')}` : ' — nothing new'}.`, { pattern: p });
          for (const x of fresh) {
            visit.add(x);
            q.push(x);
            badges[x] = String(res + 1);
            t.step('push', `"${x}" is one letter from "${w}" and unseen → mark + enqueue (ladder length ${res + 1}).`, { neiWord: x });
          }
        }
      }
      cur = '';
      hlPat = [];
      res++;
      t.step('next', `Level done → res = ${res}.`, { res });
    }
    t.step('none', `Queue empty and "${endWord}" never reached → 0.`, { result: 0 });
    return 0;
  },
};

export const problems: Problem[] = [
  numIslands,
  cloneGraph,
  maxAreaOfIsland,
  pacificAtlantic,
  surroundedRegions,
  rottingOranges,
  wallsAndGates,
  courseSchedule,
  courseSchedule2,
  redundantConnection,
  countComponents,
  graphValidTree,
  wordLadder,
];

export const variants: Variant[] = [
  {
    id: 'shortest-bridge-between-islands',
    title: 'Shortest Bridge Between Two Islands',
    statement:
      'A 0/1 grid contains exactly two islands. Return the minimum number of water cells you must convert to land to connect them.',
    pattern: 'graph-traversal',
    nearest: 'number-of-islands',
    signals: ['grid of islands', '"minimum" number of cells to connect', 'distance between two groups'],
    approach: 'DFS/flood-fill the first island to collect all its cells, seed a multi-source BFS with them, expand over water level by level, and return the level at which you first touch a cell of the other island.',
    backend: 'Minimum number of new links needed to join two isolated network partitions (or two disconnected VPCs) when each hop costs the same.',
  },
  {
    id: 'nearest-exit-in-warehouse',
    title: 'Nearest Exit for Every Shelf Aisle',
    statement:
      'A warehouse map has walls, open floor and several exit doors. For every floor cell, compute how many steps it is from the closest exit, or -1 if it is sealed off.',
    pattern: 'graph-traversal',
    nearest: 'walls-and-gates',
    signals: ['distance to the nearest of MANY targets', 'grid with obstacles', 'answer for every cell'],
    approach: 'Multi-source BFS: enqueue every exit at distance 0, expand level by level through open floor, write each cell\'s distance the first time it is reached; untouched cells stay -1.',
    backend: 'Evacuation-route planning, or mapping every client region to its nearest edge server / warehouse by hop count.',
  },
  {
    id: 'minimum-semesters-parallel-courses',
    title: 'Minimum Semesters With Parallel Courses',
    statement:
      'Courses have prerequisites; you may take any number of courses in one semester as long as their prerequisites were finished in earlier semesters. Return the minimum number of semesters, or -1 if impossible.',
    pattern: 'topo-sort',
    nearest: 'course-schedule',
    signals: ['dependencies', '"minimum number of rounds/stages"', 'unlimited parallelism within a round', '-1 on a cycle'],
    approach: 'Kahn\'s algorithm processed level by level: each BFS level of in-degree-0 nodes is one semester. If fewer than n nodes are processed there is a cycle → -1.',
    backend: 'Computing the number of parallel stages in a CI pipeline or the critical-path depth of a job DAG in Airflow/Argo.',
  },
  {
    id: 'merge-accounts-sharing-emails',
    title: 'Merge Accounts That Share an Email',
    statement:
      'Each account is a name and a list of emails. Two accounts belong to the same person if they share any email. Merge them and return each person\'s sorted set of emails.',
    pattern: 'union-find',
    nearest: 'number-of-connected-components-in-an-undirected-graph',
    signals: ['"belong to the same" if they share something', 'transitive grouping', 'merge groups'],
    approach: 'Union-find over account indices: map email → first account that had it and union every later account with it. Then group emails by find(account) and sort each group.',
    backend: 'Identity resolution / customer de-duplication in a CRM or fraud system where shared phone, email or device ties accounts together.',
  },
];
