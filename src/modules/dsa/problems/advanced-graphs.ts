import type { Problem, Tone, Variant } from '../engine/types.ts';
import { Heap, V, fmt, rc } from '../engine/tracer.ts';

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
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function circle(ids: readonly (string | number)[], rad = 38): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  ids.forEach((id, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ids.length);
    out[fmt(id)] = [Math.round(50 + rad * Math.cos(a)), Math.round(50 + rad * Math.sin(a))];
  });
  return out;
}

/** Columns by BFS hop distance from `src` (unreachable nodes in a final column). */
function bfsLayers(ids: readonly number[], edges: readonly (readonly [number, number])[], src: number): Record<string, [number, number]> {
  const depth = new Map<number, number>([[src, 0]]);
  const q = [src];
  while (q.length) {
    const u = q.shift()!;
    for (const [a, b] of edges)
      if (a === u && !depth.has(b)) {
        depth.set(b, depth.get(u)! + 1);
        q.push(b);
      }
  }
  const maxD = Math.max(1, ...depth.values()) + (ids.some((i) => !depth.has(i)) ? 1 : 0);
  const cols = new Map<number, number[]>();
  for (const id of ids) {
    const d = depth.get(id) ?? maxD;
    cols.set(d, [...(cols.get(d) ?? []), id]);
  }
  const out: Record<string, [number, number]> = {};
  for (const [d, col] of cols) col.forEach((id, i) => (out[String(id)] = [Math.round(10 + (80 * d) / maxD), Math.round((100 * (i + 1)) / (col.length + 1))]));
  return out;
}

/** Deterministically rotate options so the right answer is not always first; returns [options, answerIndex]. */
function rotate(opts: string[], answer: number, by: number): [string[], number] {
  const k = by % opts.length;
  const out = [...opts.slice(k), ...opts.slice(0, k)];
  return [out, (answer - k + opts.length) % opts.length];
}

// ---------------------------------------------------------------------------
// 332. Reconstruct Itinerary
// ---------------------------------------------------------------------------

const reconstructItinerary: Problem<{ tickets: string[][] }> = {
  id: 'reconstruct-itinerary',
  num: 332,
  title: 'Reconstruct Itinerary',
  difficulty: 'Hard',
  category: 'advanced-graphs',
  pattern: 'graph-traversal',
  statement:
    'Given airline tickets [from, to], build the trip that starts at "JFK" and uses every ticket exactly once. If several trips are possible, return the one that is alphabetically smallest when read as a list of airports.',
  signals: ['use every edge exactly once (Eulerian path)', 'fixed start node', 'lexicographically smallest order', 'greedy choice can dead-end'],
  insight:
    'Hierholzer: always fly to the smallest remaining destination, and append an airport to the answer only when it has no tickets left (post-order). A dead end gets appended first, so it naturally ends up LAST after reversing — no backtracking needed.',
  hints: [
    'Think of airports as nodes and tickets as directed edges that must each be used once.',
    'Greedily taking the smallest destination can strand you. What if you record airports when you get stuck instead of when you arrive?',
    'Sort destinations, DFS popping the smallest; after the while loop append src; reverse at the end.',
  ],
  pitfall: 'Appending the airport when you ARRIVE (pre-order) — a greedy dead end then lands in the middle of the itinerary instead of at its end.',
  backend: {
    title: 'Replaying a log of one-shot transitions into a single run',
    detail:
      'A workflow engine has a bag of recorded state transitions (from_state → to_state), each consumed exactly once, and must reconstruct the single execution path that used them all — or a delivery-route planner must traverse every street segment once. Both are Eulerian paths; Hierholzer\'s post-order DFS rebuilds them in O(E log E).',
  },
  complexity: { time: 'O(E log E)', space: 'O(E)' },
  code: `
def findItinerary(tickets):
    adj = defaultdict(list)
    for src, dst in sorted(tickets, reverse=True):     @build
        adj[src].append(dst)
    res = []                                           @init
    def dfs(src):
        while adj[src]:                                @while
            dst = adj[src].pop()                       @take
            dfs(dst)                                   @fly
        res.append(src)                                @emit
    dfs("JFK")                                         @start
    return res[::-1]                                   @reverse
`,
  explain: {
    build: 'Reverse-sorted lists so pop() from the end yields the alphabetically smallest destination in O(1).',
    take: 'Consume the ticket — it can never be used again.',
    emit: 'Post-order: src is appended only once it has no tickets left, i.e. it is the end of what remains.',
    reverse: 'res was built from the end of the trip backwards.',
  },
  distractors: [
    { text: '        res.append(src)\n        while adj[src]:', why: 'Pre-order: airports are recorded on arrival, so a dead-end branch taken early sits in the middle of the trip.' },
    { text: '            dst = adj[src].pop(0)', why: 'With a reverse-sorted list pop(0) returns the LARGEST destination (and is O(n)).' },
    { text: '    return res', why: 'res lists the trip backwards; it must be reversed.' },
  ],
  input: { tickets: [['JFK', 'KUL'], ['JFK', 'NRT'], ['NRT', 'JFK'], ['KUL', 'ICN']] },
  presets: [
    { label: 'classic 5 tickets', input: { tickets: [['JFK', 'SFO'], ['JFK', 'ATL'], ['SFO', 'ATL'], ['ATL', 'JFK'], ['ATL', 'SFO']] } },
    { label: 'simple chain', input: { tickets: [['MUC', 'LHR'], ['JFK', 'MUC'], ['SFO', 'SJC'], ['LHR', 'SFO']] } },
  ],
  validate: ({ tickets }) => {
    if (!Array.isArray(tickets) || !tickets.length) return 'Expected { tickets: [from, to][] }';
    if (tickets.length > 8) return 'Keep ≤ 8 tickets';
    if (!tickets.every((tk) => Array.isArray(tk) && tk.length === 2 && tk.every((a) => typeof a === 'string' && a.length > 0 && a.length <= 4))) return 'Each ticket must be [from, to] with short airport codes';
    if (!tickets.some((tk) => tk[0] === 'JFK')) return 'At least one ticket must leave JFK';
    return null;
  },
  trace(t, { tickets }) {
    const idx = tickets.map((_, i) => i);
    const key = (i: number) => `${tickets[i][0]}\u0000${tickets[i][1]}`;
    const sortedDesc = [...idx].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : b - a));
    const adj = new Map<string, number[]>();
    const airports = [...new Set(tickets.flat())].sort();
    const pos = circle(airports);
    const usedOrder = tickets.map(() => 0);
    let flown = 0;
    const stack: string[] = [];
    const res: string[] = [];
    let curT = -1;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const a of stack) tn[a] = 'info';
      if (stack.length) tn[stack[stack.length - 1]] = 'active';
      const et: Record<string, Tone> = {};
      tickets.forEach(([a, b], i) => usedOrder[i] && (et[`${a}->${b}`] = 'good'));
      if (curT >= 0) et[`${tickets[curT][0]}->${tickets[curT][1]}`] = 'active';
      return [
        V.graph('tickets (label = order flown)', airports, tickets.map(([a, b], i) => [a, b, usedOrder[i] ? `#${usedOrder[i]}` : undefined] as [string, string, string | undefined]), { directed: true, positions: pos, tones: tn, edgeTones: et, caption: 'active = current airport · info = on the dfs stack · good = used ticket' }),
        V.map('adj (pop() takes from the right = smallest)', [...adj].map(([a, l]) => [a, l.map((i) => tickets[i][1])] as [string, string[]])),
        V.stack('dfs call stack', stack.map((a) => `dfs(${a})`)),
        V.chips('res (built backwards)', res),
      ];
    });
    for (const i of sortedDesc) adj.set(tickets[i][0], [...(adj.get(tickets[i][0]) ?? []), i]);
    for (const a of airports) if (!adj.has(a)) adj.set(a, []);
    t.step('build', 'Sort tickets in reverse and group by source: each list ends with its alphabetically smallest destination, so pop() always takes the smallest.');
    t.step('init', 'res will collect airports in post-order (end of the trip first).');
    t.step('start', 'Start the DFS at JFK.');
    let askFirst = true;
    let askStuck = true;
    let depth = 0;
    const dfs = (src: string) => {
      if (++depth > 20) throw new Error('Recursion too deep');
      stack.push(src);
      for (;;) {
        const list = adj.get(src)!;
        curT = -1;
        if (!list.length) {
          t.step('while', `adj[${src}] is empty — ${src} has no unused tickets left.`, { src });
          if (askStuck && tickets.some((_, i) => !usedOrder[i])) {
            askStuck = false;
            t.predict(`We are stuck at ${src} but tickets remain elsewhere. What happens?`, [`Append ${src} to res — it is the END of the trip`, 'Undo the last ticket and backtrack', 'Return an error'], 0, `Hierholzer never undoes: ${src} must be the final stop, so it is recorded first; the other tickets get spliced in earlier in the trip.`);
          }
          break;
        }
        t.step('while', `${src} still has ${list.length} unused ticket${list.length === 1 ? '' : 's'}: [${list.map((i) => tickets[i][1]).join(', ')}].`, { src });
        if (askFirst && list.length >= 2) {
          askFirst = false;
          const opts = [...new Set(list.map((i) => tickets[i][1]))].sort();
          t.predict(`Which airport does ${src} fly to next?`, opts, 0, `pop() takes the last element of the reverse-sorted list — the alphabetically smallest, ${opts[0]}.`);
        }
        const i = list.pop()!;
        usedOrder[i] = ++flown;
        curT = i;
        t.step('take', `Use ticket ${src} → ${tickets[i][1]} (#${flown}), the smallest remaining destination.`, { src, dst: tickets[i][1] });
        t.step('fly', `dfs(${tickets[i][1]}).`, { dst: tickets[i][1] });
        dfs(tickets[i][1]);
      }
      res.push(src);
      t.step('emit', `Append ${src}: res = [${res.join(', ')}]. Everything after ${src} in the trip is already in res.`, { res: [...res] });
      stack.pop();
      depth--;
    };
    dfs('JFK');
    curT = -1;
    const trip = [...res].reverse();
    t.predict('res is built backwards. What is the itinerary?', [`[${trip.join(', ')}]`, `[${res.join(', ')}]`], 0, 'Reverse res: the first airport appended is the last stop.');
    t.step('reverse', `Reverse res → [${trip.join(', ')}].`, { result: trip });
    return trip;
  },
};

// ---------------------------------------------------------------------------
// 1584. Min Cost to Connect All Points (Prim)
// ---------------------------------------------------------------------------

const minCostConnectPoints: Problem<{ points: number[][] }> = {
  id: 'min-cost-to-connect-all-points',
  num: 1584,
  title: 'Min Cost to Connect All Points',
  difficulty: 'Medium',
  category: 'advanced-graphs',
  pattern: 'weighted-graph',
  statement:
    'Given points on a 2-D plane, connecting two points costs their Manhattan distance |x1 − x2| + |y1 − y2|. Return the minimum total cost so every point is connected (directly or indirectly).',
  signals: ['connect ALL nodes at minimum total cost', 'every pair can be connected (complete graph)', 'no cycles needed → a tree', '"minimum spanning tree"'],
  insight:
    'This is a minimum spanning tree. Prim grows one tree from any start point, always adding the cheapest edge that reaches a NEW point; a min-heap of (cost, point) gives that edge fast. Stale heap entries for points already in the tree are skipped.',
  hints: [
    'You never need a cycle — what structure connects n points with n − 1 edges?',
    'Grow a connected set from point 0. Which edge is always safe to add next?',
    'Min-heap of (cost, point): pop, skip if visited, else add cost and push edges from the new point to all unvisited points.',
  ],
  pitfall: 'Not skipping heap entries for points already in the tree — their cost gets added again and the total is too high.',
  backend: {
    title: 'Cheapest cabling / peering plan between datacenters',
    detail:
      'A network team must link every datacenter (point) with leased lines whose price grows with distance. The cheapest set of links that connects them all is an MST; Prim with a heap of candidate links computes it, and the same idea builds low-cost multicast trees or clusters log lines by similarity.',
  },
  complexity: { time: 'O(n² log n)', space: 'O(n²)' },
  code: `
def minCostConnectPoints(points):
    N = len(points)
    adj = {i: [] for i in range(N)}
    for i in range(N):
        for j in range(i + 1, N):
            dist = abs(points[i][0] - points[j][0]) + abs(points[i][1] - points[j][1])
            adj[i].append([dist, j]); adj[j].append([dist, i])   @build
    res, visit = 0, set()
    minH = [[0, 0]]                                  @init
    while len(visit) < N:                            @while
        cost, i = heapq.heappop(minH)                @pop
        if i in visit:                               @skip
            continue
        res += cost                                  @add
        visit.add(i)
        for neiCost, nei in adj[i]:
            if nei not in visit:
                heapq.heappush(minH, [neiCost, nei]) @push
    return res                                       @done
`,
  explain: {
    build: 'Complete graph: every pair of points is a candidate edge weighted by Manhattan distance.',
    init: 'Start the tree at point 0 with cost 0.',
    pop: 'The cheapest edge that leaves the current tree (cut property ⇒ it belongs to some MST).',
    skip: 'Stale entry: that point already joined via a cheaper edge.',
    push: 'New candidate edges from the point that just joined.',
  },
  distractors: [
    { text: '        res += cost\n        if i in visit:', why: 'Adds the cost of stale entries before skipping them — the total is too large.' },
    { text: '    minH = [[0, i] for i in range(N)]', why: 'Seeding every point at cost 0 joins them all for free — the answer becomes 0.' },
    { text: '    while minH:', why: 'Works but keeps popping stale entries after the tree is complete; len(visit) < N stops exactly when all points are in.' },
  ],
  input: { points: [[0, 0], [2, 2], [3, 10], [5, 2], [7, 0]] },
  presets: [
    { label: 'two points', input: { points: [[3, 12], [-2, 5]] } },
    { label: 'square', input: { points: [[0, 0], [0, 4], [4, 0], [4, 4], [2, 2]] } },
  ],
  validate: ({ points }) => {
    if (!Array.isArray(points) || points.length < 2) return 'Expected { points: [x, y][] } with at least 2 points';
    if (points.length > 6) return 'Keep ≤ 6 points';
    if (!points.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => isInt(v) && Math.abs(v) <= 1000))) return 'Points must be integer [x, y] pairs';
    return null;
  },
  trace(t, { points }) {
    const N = points.length;
    const ids = points.map((_, i) => i);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const sx = (x: number) => (Math.max(...xs) === Math.min(...xs) ? 50 : Math.round(10 + (80 * (x - Math.min(...xs))) / (Math.max(...xs) - Math.min(...xs))));
    const sy = (y: number) => (Math.max(...ys) === Math.min(...ys) ? 50 : Math.round(90 - (80 * (y - Math.min(...ys))) / (Math.max(...ys) - Math.min(...ys))));
    const pos: Record<string, [number, number]> = {};
    ids.forEach((i) => (pos[String(i)] = [sx(xs[i]), sy(ys[i])]));
    const labels: Record<string, string> = {};
    ids.forEach((i) => (labels[String(i)] = `${i} (${xs[i]},${ys[i]})`));
    const dist = (i: number, j: number) => Math.abs(xs[i] - xs[j]) + Math.abs(ys[i] - ys[j]);
    const edges: [number, number, number][] = [];
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) edges.push([i, j, dist(i, j)]);
    const heap = new Heap<[number, number, number]>((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]));
    const visit = new Set<number>();
    const mst = new Set<string>();
    let res = 0;
    let cur = -1;
    let popped: [number, number, number] | null = null;
    let stale = false;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const i of visit) tn[String(i)] = 'good';
      if (cur >= 0) tn[String(cur)] = 'active';
      const et: Record<string, Tone> = {};
      for (const [, n, f] of heap.data) if (f >= 0 && !visit.has(n)) et[`${f}->${n}`] = 'info';
      for (const k of mst) et[k] = 'good';
      if (popped && popped[2] >= 0) et[`${popped[2]}->${popped[1]}`] = stale ? 'muted' : 'active';
      return [
        V.graph('points (edge label = Manhattan cost)', ids, edges, { positions: pos, labels, tones: tn, edgeTones: et, caption: 'good = MST edge / in tree · info = candidate edge in heap · active = just popped' }),
        V.heap('minH (cost, point)', heap.data.map(([c, n]) => `(${c}, ${n})`), { tones: heap.size ? { 0: 'active' } : {} }),
      ];
    });
    t.step('build', `Build all ${edges.length} edges of the complete graph, each weighted by Manhattan distance.`, { N });
    heap.push([0, 0, -1]);
    t.step('init', 'Seed the heap with (0, point 0): the tree starts at point 0 for free.', { res });
    let iter = 0;
    let askStale = true;
    let askWhy = true;
    while (visit.size < N) {
      cur = -1;
      popped = null;
      t.step('while', `${visit.size}/${N} points are in the tree. The heap top is the cheapest known edge reaching a point.`, { 'len(visit)': visit.size, res });
      if (iter === 1) {
        const opts = [...new Set([...heap.data].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([c, n]) => `point ${n} (cost ${c})`))].slice(0, 3);
        const [o, a] = rotate(opts, 0, 1);
        t.predict('Which point joins the tree next?', o, a, 'The heap pops the smallest cost — the cheapest edge from the tree to any outside point.');
      }
      iter++;
      const top = heap.pop()!;
      popped = top;
      const [c, i, f] = top;
      stale = visit.has(i);
      cur = i;
      t.step('pop', `Pop (${c}, ${i})${f >= 0 ? ` — edge ${f}–${i}` : ''}.`, { cost: c, i });
      if (stale && askStale) {
        askStale = false;
        t.predict(`Does popping (${c}, ${i}) add a new point?`, ['Yes', `No — ${i} is already in the tree`], 1, `${i} is green: it joined earlier through a cheaper edge, so this entry is stale.`);
      } else if (!stale && f >= 0 && visit.size >= 2 && askWhy) {
        askWhy = false;
        t.predict(`Why is edge ${f}–${i} (cost ${c}) safe to add?`, ['It is the cheapest edge leaving the current tree', 'It is the cheapest edge in the whole graph', 'It touches the newest point'], 0, 'Cut property: the lightest edge crossing from the tree to the rest belongs to some minimum spanning tree.');
      }
      if (stale) {
        t.step('skip', `${i} is already in the tree — stale entry, skip.`, { i });
        continue;
      }
      res += c;
      visit.add(i);
      if (f >= 0) mst.add(`${f}->${i}`);
      t.step('add', f >= 0 ? `Add edge ${f}–${i}: res += ${c} → ${res}.` : `Point ${i} starts the tree (cost 0).`, { res, i });
      for (const j of ids) {
        if (visit.has(j)) continue;
        heap.push([dist(i, j), j, i]);
        t.step('push', `Candidate edge ${i}–${j} with cost ${dist(i, j)} → heap.`, { nei: j, neiCost: dist(i, j) });
      }
    }
    cur = -1;
    popped = null;
    t.step('done', `All ${N} points connected with total cost ${res}.`, { result: res });
    return res;
  },
};

// ---------------------------------------------------------------------------
// 743. Network Delay Time (Dijkstra)
// ---------------------------------------------------------------------------

const networkDelayTime: Problem<{ times: number[][]; n: number; k: number }> = {
  id: 'network-delay-time',
  num: 743,
  title: 'Network Delay Time',
  difficulty: 'Medium',
  category: 'advanced-graphs',
  pattern: 'weighted-graph',
  statement:
    'Nodes 1..n are linked by directed edges [u, v, w] that take w time units. A signal starts at node k. Return how long until every node has received it, or -1 if some node never does.',
  signals: ['weighted directed edges (non-negative)', 'single source', '"time until ALL nodes" = max shortest distance', '-1 when unreachable'],
  insight:
    'Dijkstra: a min-heap always pops the node with the smallest known arrival time; with non-negative weights that time is final. The answer is the largest final time (the last node to hear the signal).',
  hints: [
    'Plain BFS fails because edges have different weights.',
    'Which node\'s arrival time can you be sure of first?',
    'Min-heap of (time, node); skip nodes already finalised; answer = time of the last finalised node if all n were reached.',
  ],
  pitfall: 'Finalising a node when it is PUSHED instead of when it is POPPED — a later, cheaper path to it would be ignored.',
  backend: {
    title: 'Latency of a broadcast across a service mesh',
    detail:
      'A control plane pushes a config change from one region; links between regions have different latencies. Dijkstra over the latency graph gives each region\'s earliest receive time, the max is the full-propagation latency, and -1 flags partitioned regions. Routing protocols like OSPF run exactly this on link costs.',
  },
  complexity: { time: 'O(E log V)', space: 'O(V + E)' },
  code: `
def networkDelayTime(times, n, k):
    edges = defaultdict(list)
    for u, v, w in times:
        edges[u].append((v, w))                         @build
    minHeap, visit, t = [(0, k)], set(), 0              @init
    while minHeap:                                      @while
        w1, n1 = heapq.heappop(minHeap)                 @pop
        if n1 in visit:                                 @skip
            continue
        visit.add(n1)                                   @final
        t = w1
        for n2, w2 in edges[n1]:                        @loop
            if n2 not in visit:
                heapq.heappush(minHeap, (w1 + w2, n2))  @push
    return t if len(visit) == n else -1                 @done
`,
  explain: {
    pop: 'The smallest tentative time in the heap — nothing can reach this node sooner.',
    skip: 'Stale entry: the node was already finalised with a smaller time.',
    final: 'Times are popped in non-decreasing order, so the last one finalised is the answer.',
    push: 'Candidate arrival time via n1 — may be beaten later by a cheaper entry.',
  },
  distractors: [
    { text: '                visit.add(n2)', why: 'Marking on push freezes the FIRST path found, which may not be the cheapest.' },
    { text: '        t += w1', why: 'w1 is already the total time from k; summing pops counts paths multiple times.' },
    { text: '        w1, n1 = minHeap.pop()', why: 'list.pop() takes the last element, not the minimum — that is no longer Dijkstra.' },
  ],
  input: { times: [[1, 2, 4], [1, 3, 1], [3, 2, 2], [2, 4, 1], [3, 4, 5], [4, 5, 3]], n: 5, k: 1 },
  presets: [
    { label: 'classic', input: { times: [[2, 1, 1], [2, 3, 1], [3, 4, 1]], n: 4, k: 2 } },
    { label: 'unreachable node', input: { times: [[1, 2, 1], [2, 3, 2]], n: 4, k: 1 } },
  ],
  validate: ({ times, n, k }) => {
    if (!Array.isArray(times) || !isInt(n) || !isInt(k)) return 'Expected { times: [u, v, w][], n: number, k: number }';
    if (n < 1 || n > 8) return 'Keep n between 1 and 8';
    if (k < 1 || k > n) return 'k must be a node in 1..n';
    if (times.length > 14) return 'Keep ≤ 14 edges';
    if (!times.every((e) => Array.isArray(e) && e.length === 3 && e.every(isInt) && e[0] >= 1 && e[0] <= n && e[1] >= 1 && e[1] <= n && e[2] >= 0 && e[2] <= 100)) return 'Edges must be [u, v, w] with u, v in 1..n and 0 ≤ w ≤ 100';
    return null;
  },
  trace(t, { times, n, k }) {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const adj = new Map<number, [number, number][]>(ids.map((i) => [i, []]));
    for (const [u, v, w] of times) adj.get(u)!.push([v, w]);
    const pos = bfsLayers(ids, times.map(([u, v]) => [u, v] as [number, number]), k);
    const heap = new Heap<[number, number, number]>((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]));
    const visit = new Set<number>();
    const final = new Map<number, number>();
    const best = new Map<number, number>();
    const tree = new Set<string>();
    let cur = -1;
    let edge = '';
    let time = 0;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const [, nd] of heap.data) tn[String(nd)] = 'info';
      for (const i of visit) tn[String(i)] = 'good';
      if (cur > 0) tn[String(cur)] = 'active';
      const badges: Record<string, string> = {};
      for (const i of ids) badges[String(i)] = final.has(i) ? `${final.get(i)}` : best.has(i) ? `≤${best.get(i)}` : '∞';
      const et: Record<string, Tone> = {};
      for (const e of tree) et[e] = 'good';
      if (edge) et[edge] = 'active';
      return [
        V.graph('network (edge label = delay)', ids, times.map(([u, v, w]) => [u, v, w] as [number, number, number]), { directed: true, positions: pos, tones: tn, badges, edgeTones: et, caption: 'badge = arrival time (≤ tentative) · good = finalised · info = in heap' }),
        V.heap('minHeap (time, node)', heap.data.map(([d, nd]) => `(${d}, ${nd})`), { tones: heap.size ? { 0: 'active' } : {} }),
      ];
    });
    t.step('build', `Adjacency lists for ${times.length} directed edges.`, { n, k });
    heap.push([0, k, -1]);
    best.set(k, 0);
    t.step('init', `The signal starts at node ${k} at time 0.`, { t: 0 });
    let askOrder = true;
    let askStale = true;
    while (heap.size) {
      cur = -1;
      edge = '';
      t.step('while', `Heap holds ${heap.size} candidate arrival${heap.size === 1 ? '' : 's'}.`, { t: time, 'len(visit)': visit.size });
      const nodesInHeap = heap.data.map(([, nd]) => nd);
      if (askOrder && heap.size >= 2 && new Set(nodesInHeap).size < nodesInHeap.length) {
        askOrder = false;
        const sorted = [...heap.data].sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 3).map(([d, nd]) => `(${d}, ${nd})`);
        const [o, a] = rotate(sorted, 0, 2);
        t.predict('Which entry is popped next?', o, a, 'A min-heap always pops the smallest time first, even if another entry for the same node was pushed earlier.');
      }
      const [w1, n1, from] = heap.pop()!;
      cur = n1;
      edge = from > 0 ? `${from}->${n1}` : '';
      t.step('pop', `Pop (${w1}, ${n1}).`, { w1, n1 });
      if (visit.has(n1)) {
        if (askStale) {
          askStale = false;
          t.predict(`Is ${w1} a new shortest time for node ${n1}?`, ['Yes', `No — ${n1} is already final`], 1, `Node ${n1} was finalised at ${final.get(n1)} ≤ ${w1}; this is a stale entry left in the heap.`);
        }
        t.step('skip', `Node ${n1} is already final (${final.get(n1)}) — stale entry, skip.`, { n1 });
        continue;
      }
      visit.add(n1);
      final.set(n1, w1);
      if (from > 0) tree.add(`${from}->${n1}`);
      time = w1;
      t.step('final', `Node ${n1} receives the signal at time ${w1} — final, nothing cheaper can still arrive. t = ${w1}.`, { t: time, n1 });
      for (const [n2, w2] of adj.get(n1)!) {
        edge = `${n1}->${n2}`;
        if (visit.has(n2)) {
          t.step('loop', `Edge ${n1} → ${n2}: ${n2} is already final, skip.`, { n2 });
          continue;
        }
        heap.push([w1 + w2, n2, n1]);
        const prev = best.get(n2);
        if (prev === undefined || w1 + w2 < prev) best.set(n2, w1 + w2);
        t.step('push', `Edge ${n1} → ${n2} (delay ${w2}): candidate time ${w1} + ${w2} = ${w1 + w2}${prev !== undefined ? ` (best so far ${Math.min(prev, w1 + w2)})` : ''}.`, { n2, 'w1 + w2': w1 + w2 });
      }
      edge = '';
    }
    cur = -1;
    edge = '';
    const ans = visit.size === n ? time : -1;
    t.step('while', `Heap empty: ${visit.size} of ${n} nodes received the signal.`, { t: time, 'len(visit)': visit.size });
    t.predict('What does the function return?', [...new Set([String(time), '-1', String([...final.values()].reduce((a, b) => a + b, 0))])], ans === -1 ? 1 : 0, ans === -1 ? 'Some node was never reached.' : `All nodes reached; the last one heard it at t = ${time}.`);
    t.step('done', ans === -1 ? 'Not every node was reached → -1.' : `Every node reached; the slowest at t = ${time}.`, { result: ans });
    return ans;
  },
};

// ---------------------------------------------------------------------------
// 778. Swim in Rising Water
// ---------------------------------------------------------------------------

const swimInRisingWater: Problem<{ grid: number[][] }> = {
  id: 'swim-in-rising-water',
  num: 778,
  title: 'Swim in Rising Water',
  difficulty: 'Hard',
  category: 'advanced-graphs',
  pattern: 'weighted-graph',
  statement:
    'An n × n grid holds distinct elevations. At time t the water level is t and you can swim between adjacent cells whose elevations are both ≤ t. Return the earliest time you can get from the top-left to the bottom-right cell.',
  signals: ['minimise the MAXIMUM value along a path', 'grid path with costs on cells', 'earliest time / smallest threshold', 'Dijkstra-like with max instead of +'],
  insight:
    'The cost of a path is its highest cell. Run Dijkstra where a path\'s priority is max(time so far, next cell): the heap always extends the path with the lowest peak, so the first time the target is popped its priority is the answer.',
  hints: [
    'For a fixed t, can you reach the end? The answer is the smallest t that works.',
    'Instead of guessing t, always expand the reachable cell with the lowest elevation.',
    'Min-heap of (max-height-so-far, r, c); push neighbours with max(t, grid[nr][nc]); stop when popping the target.',
  ],
  pitfall: 'Adding elevations (t + grid[nr][nc]) like ordinary Dijkstra — the cost here is the maximum on the path, not the sum.',
  backend: {
    title: 'Widest / bottleneck path in a network',
    detail:
      'Choosing a route whose worst link is as good as possible (e.g. the path whose maximum latency hop or minimum bandwidth hop is best) is a bottleneck-path problem. Dijkstra with max() instead of + finds it — used for picking video-streaming routes or evacuation paths where the single worst segment dominates.',
  },
  complexity: { time: 'O(n² log n)', space: 'O(n²)' },
  code: `
def swimInWater(grid):
    N = len(grid)
    visit = set([(0, 0)])
    minH = [[grid[0][0], 0, 0]]                          @init
    while minH:                                          @while
        t, r, c = heapq.heappop(minH)                    @pop
        if r == N - 1 and c == N - 1:                    @goal
            return t                                     @done
        for dr, dc in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            nr, nc = r + dr, c + dc
            if 0 <= nr < N and 0 <= nc < N and (nr, nc) not in visit:   @check
                visit.add((nr, nc))
                heapq.heappush(minH, [max(t, grid[nr][nc]), nr, nc])  @push
`,
  explain: {
    init: 'Even standing on the start cell requires the water to reach its elevation.',
    pop: 'The reachable frontier cell with the lowest required water level.',
    goal: 'Popped means no cheaper route to the target exists.',
    push: 'Path cost = the highest cell on it: max, not sum.',
  },
  distractors: [
    { text: '                heapq.heappush(minH, [t + grid[nr][nc], nr, nc])', why: 'Summing elevations solves a different problem; the swim time depends only on the highest cell on the path.' },
    { text: '        if r == N - 1 and c == N - 1:\n            return grid[r][c]', why: 'Returns the target\'s own elevation, ignoring a higher cell earlier on the path.' },
  ],
  input: {
    grid: [
      [0, 1, 2, 3],
      [9, 12, 11, 4],
      [10, 13, 6, 5],
      [15, 14, 7, 8],
    ],
  },
  presets: [
    { label: '2×2', input: { grid: [[0, 2], [1, 3]] } },
    { label: 'detour vs wall', input: { grid: [[0, 6, 5], [1, 8, 4], [2, 3, 7]] } },
  ],
  validate: ({ grid }) => {
    if (!Array.isArray(grid) || !grid.length || !grid.every((row) => Array.isArray(row) && row.length === grid.length)) return 'Expected a square n × n grid';
    if (grid.length > 5) return 'Keep the grid ≤ 5×5';
    if (!grid.every((row) => row.every((v) => isInt(v) && v >= 0 && v < 100))) return 'Elevations must be integers 0..99';
    return null;
  },
  trace(t, { grid }) {
    const N = grid.length;
    const heap = new Heap<[number, number, number]>((a, b) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2]))));
    const visit = new Set<string>([rc(0, 0)]);
    const done = new Set<string>();
    const level = new Map<string, number>([[rc(0, 0), grid[0][0]]]);
    let cur: Cell | null = null;
    let nxt: Cell | null = null;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const k of visit) tn[k] = 'info';
      for (const k of done) tn[k] = 'good';
      if (cur) tn[rc(cur[0], cur[1])] = 'active';
      return [
        V.grid('grid (elevations)', grid, { tones: tn, pointers: { cur, next: nxt }, caption: 'good = popped (best water level known) · info = in heap' }),
        V.heap('minH (t, r, c)', heap.data.map(([lv, r, c]) => `(${lv}, ${r}, ${c})`), { tones: heap.size ? { 0: 'active' } : {} }),
        V.grid('water level needed to reach cell', grid.map((row, r) => row.map((_, c) => (level.has(rc(r, c)) ? level.get(rc(r, c)) : '·'))), { tones: Object.fromEntries([...done].map((k) => [k, 'good' as Tone])) }),
      ];
    });
    heap.push([grid[0][0], 0, 0]);
    t.step('init', `Start at (0,0): the water must be at least ${grid[0][0]} just to stand there.`, { t: grid[0][0] });
    let whiles = 0;
    let askGoal = true;
    while (heap.size) {
      cur = null;
      nxt = null;
      t.step('while', `Heap holds ${heap.size} frontier cell${heap.size === 1 ? '' : 's'}.`, { 'len(minH)': heap.size });
      if (heap.size >= 2 && (whiles === 0 || whiles === 3)) {
        const sorted = [...heap.data].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).slice(0, 3).map(([lv, r, c]) => `${cs(r, c)} at t=${lv}`);
        const [o, a] = rotate(sorted, 0, whiles + 1);
        t.predict('Which cell is popped next?', o, a, 'The one needing the lowest water level — expanding it can never make a cheaper path worse.');
      }
      if (heap.size >= 2) whiles++;
      const [lv, r, c] = heap.pop()!;
      cur = [r, c];
      done.add(rc(r, c));
      t.step('pop', `Pop ${cs(r, c)} needing water level ${lv}.`, { t: lv, r, c });
      if (r === N - 1 && c === N - 1) {
        if (askGoal) {
          askGoal = false;
          t.predict('We just popped the bottom-right cell. What is the answer?', [...new Set([String(lv), String(grid[r][c]), String(N * N - 1)])], 0, `Its priority ${lv} is the highest elevation on the cheapest route, and the heap guarantees no route with a lower peak exists.`);
        }
        t.step('goal', 'Reached the bottom-right cell.', { t: lv });
        t.step('done', `Earliest time = ${lv}.`, { result: lv });
        return lv;
      }
      t.step('goal', 'Not the target — expand its neighbours.', { r, c });
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= N || nc >= N || visit.has(rc(nr, nc))) continue;
        visit.add(rc(nr, nc));
        const nl = Math.max(lv, grid[nr][nc]);
        level.set(rc(nr, nc), nl);
        heap.push([nl, nr, nc]);
        nxt = [nr, nc];
        t.step('push', `${cs(nr, nc)} has elevation ${grid[nr][nc]}: reaching it needs max(${lv}, ${grid[nr][nc]}) = ${nl}.`, { nr, nc, priority: nl });
      }
      nxt = null;
    }
    return -1;
  },
};

// ---------------------------------------------------------------------------
// 269. Alien Dictionary
// ---------------------------------------------------------------------------

const alienDictionary: Problem<{ words: string[] }> = {
  id: 'alien-dictionary',
  num: 269,
  title: 'Alien Dictionary',
  difficulty: 'Hard',
  category: 'advanced-graphs',
  pattern: 'topo-sort',
  statement:
    'An alien language uses lowercase English letters in an unknown order. Given a word list already sorted by that order, return a string of its letters in a consistent order, or "" if the list is contradictory.',
  signals: ['"sorted by an unknown order"', 'derive ordering constraints from pairs', 'return any valid order', 'contradiction ⇒ cycle ⇒ ""'],
  insight:
    'Only adjacent words give information, and only at their FIRST differing letter: w1[j] comes before w2[j]. Those facts are edges of a graph on letters; a topological sort of it is the alphabet, and a cycle means no valid order.',
  hints: [
    'Compare "wrt" and "wrf". What exactly do you learn — and what do you NOT learn?',
    'Build edges from each adjacent pair\'s first difference. Watch for a longer word placed before its own prefix.',
    'Topologically sort the letters (Kahn or DFS). If not every letter is output, there is a cycle → "".',
  ],
  pitfall: 'Adding edges for every differing position instead of breaking after the first one — later letters carry no ordering information.',
  backend: {
    title: 'Inferring an ordering from observed sorted output',
    detail:
      'Given event logs from a system that emits records sorted by a hidden priority (or a DB index sorted by an unknown collation), adjacent records reveal pairwise "a before b" facts. Turning them into a graph and topo-sorting recovers the priority order — and a cycle exposes inconsistent data, e.g. clock skew between producers.',
  },
  complexity: { time: 'O(total characters)', space: 'O(unique letters²)' },
  code: `
def alienOrder(words):
    adj = {c: set() for w in words for c in w}
    indeg = {c: 0 for c in adj}                          @init
    for i in range(len(words) - 1):                      @pair
        w1, w2 = words[i], words[i + 1]
        minLen = min(len(w1), len(w2))
        if len(w1) > len(w2) and w1[:minLen] == w2[:minLen]:   @prefix
            return ""                                    @invalid
        for j in range(minLen):                          @cmp
            if w1[j] != w2[j]:                           @diff
                if w2[j] not in adj[w1[j]]:
                    adj[w1[j]].add(w2[j])                @edge
                    indeg[w2[j]] += 1
                break                                    @stop
    q = deque(c for c in indeg if indeg[c] == 0)         @seed
    res = []
    while q:                                             @while
        c = q.popleft()                                  @pop
        res.append(c)
        for nei in adj[c]:                               @loop
            indeg[nei] -= 1                              @dec
            if indeg[nei] == 0:
                q.append(nei)                            @push
    return "".join(res) if len(res) == len(indeg) else ""   @done
`,
  explain: {
    pair: 'Only neighbouring words are compared — the list is sorted, so that is enough.',
    prefix: '"abc" before "ab" is impossible in any alphabet.',
    diff: 'The first difference decides the order of the two words.',
    stop: 'After the first difference, later letters say nothing.',
    seed: 'Letters nothing must precede can come first.',
    done: 'Letters stuck on a cycle never reach in-degree 0 → contradiction.',
  },
  distractors: [
    { text: '                adj[w1[j]].add(w2[j])\n                indeg[w2[j]] += 1', why: 'Missing the "not already in adj" guard: a duplicate edge counts the same in-degree twice and that letter is never freed.' },
    { text: '            if w1[j] != w2[j]:\n                adj[w1[j]].add(w2[j])', why: 'Without break, every later differing position adds a bogus constraint.' },
    { text: '    for i in range(len(words)):\n        for j in range(i + 1, len(words)):', why: 'Comparing all pairs is redundant work (sorted order is transitive); adjacent pairs give every needed constraint.' },
  ],
  input: { words: ['wrt', 'wrf', 'er', 'ett', 'rftt'] },
  presets: [
    { label: 'prefix conflict', input: { words: ['abc', 'ab'] } },
    { label: 'cycle', input: { words: ['z', 'x', 'z'] } },
    { label: 'two letters', input: { words: ['z', 'x'] } },
  ],
  validate: ({ words }) => {
    if (!Array.isArray(words) || words.length < 2) return 'Expected { words: string[] } with at least 2 words';
    if (words.length > 7) return 'Keep ≤ 7 words';
    if (!words.every((w) => typeof w === 'string' && /^[a-z]{1,5}$/.test(w))) return 'Words must be 1–5 lowercase letters';
    if (new Set(words.join('')).size > 8) return 'Use at most 8 distinct letters';
    return null;
  },
  trace(t, { words }) {
    const adj = new Map<string, Set<string>>();
    for (const w of words) for (const ch of w) if (!adj.has(ch)) adj.set(ch, new Set());
    const letters = [...adj.keys()];
    const pos = circle(letters);
    const indeg = new Map<string, number>(letters.map((ch) => [ch, 0]));
    const edges: [string, string][] = [];
    let pi = -1;
    let j = -1;
    let edge = '';
    let q: string[] = [];
    const res: string[] = [];
    let cur = '';
    let phase: 'build' | 'sort' | 'end' = 'build';
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const ch of res) tn[ch] = 'good';
      for (const ch of q) tn[ch] = 'info';
      if (cur) tn[cur] = 'active';
      if (phase === 'end') for (const ch of letters) if (!res.includes(ch)) tn[ch] = 'bad';
      if (phase === 'build' && pi >= 0 && j >= 0) {
        if (words[pi][j]) tn[words[pi][j]] = 'active';
        if (words[pi + 1][j]) tn[words[pi + 1][j]] = 'active';
      }
      const badges: Record<string, string> = {};
      for (const ch of letters) badges[ch] = `in ${indeg.get(ch)}`;
      const jt = (w: string): Record<number, Tone> => (j >= 0 && j < w.length ? { [j]: 'active' } : {});
      return [
        V.array('words', words, { pointers: pi >= 0 && phase === 'build' ? { w1: pi, w2: pi + 1 } : {} }),
        phase === 'build' && pi >= 0 && V.text('w1', words[pi], { tones: jt(words[pi]) }),
        phase === 'build' && pi >= 0 && V.text('w2', words[pi + 1], { tones: jt(words[pi + 1]) }),
        V.graph('letters (arrow = comes before)', letters, edges, { directed: true, positions: pos, tones: tn, badges, edgeTones: edge ? { [edge]: 'active' } : {}, caption: 'badge = in-degree · info = queued · good = placed' }),
        phase !== 'build' && V.queue('q', q),
        V.chips('res', res, { tones: Object.fromEntries(res.map((_, i) => [i, 'good' as Tone])) }),
      ];
    });
    t.step('init', `Letters seen: ${letters.join(', ')}. No ordering facts yet, every in-degree 0.`);
    let askDiff = true;
    let askBreak = true;
    for (pi = 0; pi < words.length - 1; pi++) {
      const w1 = words[pi];
      const w2 = words[pi + 1];
      j = -1;
      edge = '';
      t.step('pair', `Compare neighbours "${w1}" and "${w2}".`, { w1, w2 });
      const minLen = Math.min(w1.length, w2.length);
      if (w1.length > w2.length && w1.slice(0, minLen) === w2.slice(0, minLen)) {
        t.step('prefix', `"${w2}" is a prefix of "${w1}" but comes AFTER it — impossible in any alphabet.`, { w1, w2 });
        t.step('invalid', 'Return "".', { result: '' });
        return '';
      }
      for (j = 0; j < minLen; j++) {
        const a = w1[j];
        const b = w2[j];
        if (a === b) {
          t.step('cmp', `Position ${j}: both "${a}" — no information, keep going.`, { j });
          continue;
        }
        t.step('cmp', `Position ${j}: "${a}" vs "${b}".`, { j });
        if (askDiff) {
          askDiff = false;
          t.predict('What does this first difference tell us?', [`${a} comes before ${b}`, `${b} comes before ${a}`, 'Nothing — only first letters matter'], 0, `"${w1}" is listed before "${w2}" and they agree up to position ${j}, so ${a} < ${b} in the alien alphabet.`);
        }
        t.step('diff', `First difference: "${a}" must come before "${b}".`, { j, from: a, to: b });
        if (!adj.get(a)!.has(b)) {
          adj.get(a)!.add(b);
          indeg.set(b, indeg.get(b)! + 1);
          edges.push([a, b]);
          edge = `${a}->${b}`;
          t.step('edge', `Add edge ${a} → ${b}; indeg[${b}] = ${indeg.get(b)}.`, { from: a, to: b });
        }
        if (askBreak && j + 1 < minLen && w1[j + 1] !== w2[j + 1]) {
          askBreak = false;
          t.predict(`Should we also learn something from position ${j + 1} ("${w1[j + 1]}" vs "${w2[j + 1]}")?`, ['No — break after the first difference', 'Yes — add that edge too'], 0, 'The words are already ordered by position ' + j + '; whatever follows is irrelevant to their order.');
        }
        t.step('stop', 'break — later positions carry no ordering information for this pair.', { j });
        break;
      }
    }
    pi = -1;
    j = -1;
    edge = '';
    phase = 'sort';
    q = letters.filter((ch) => indeg.get(ch) === 0);
    t.step('seed', `Letters with in-degree 0 (nothing must precede them): [${q.join(', ')}].`, { q: [...q] });
    let askSeedDone = false;
    while (q.length) {
      cur = '';
      t.step('while', `Queue: [${q.join(', ')}].`, { q: [...q] });
      if (!askSeedDone && res.length === 0) {
        askSeedDone = true;
        t.predict('Which letter is placed first in the answer?', [...new Set([q[0], ...letters])].slice(0, 3), 0, `${q[0]} is at the front of the queue: no letter has to come before it.`);
      }
      const c = q.shift()!;
      cur = c;
      res.push(c);
      t.step('pop', `Place "${c}": res = "${res.join('')}".`, { c });
      for (const nei of adj.get(c)!) {
        edge = `${c}->${nei}`;
        indeg.set(nei, indeg.get(nei)! - 1);
        if (indeg.get(nei) === 0) {
          q.push(nei);
          t.step('push', `indeg[${nei}] = 0 — everything before "${nei}" is placed, enqueue it.`, { nei });
        } else {
          t.step('dec', `indeg[${nei}] = ${indeg.get(nei)} — "${nei}" still waits on another letter.`, { nei });
        }
      }
      edge = '';
    }
    cur = '';
    phase = 'end';
    const ok = res.length === letters.length;
    t.step('done', ok ? `All ${letters.length} letters placed → "${res.join('')}".` : `Only ${res.length} of ${letters.length} letters placed — the red letters form a cycle → "".`, { result: ok ? res.join('') : '' });
    return ok ? res.join('') : '';
  },
};

// ---------------------------------------------------------------------------
// 787. Cheapest Flights Within K Stops (Bellman-Ford)
// ---------------------------------------------------------------------------

const cheapestFlights: Problem<{ n: number; flights: number[][]; src: number; dst: number; k: number }> = {
  id: 'cheapest-flights-within-k-stops',
  num: 787,
  title: 'Cheapest Flights Within K Stops',
  difficulty: 'Medium',
  category: 'advanced-graphs',
  pattern: 'weighted-graph',
  statement:
    'There are n cities and directed flights [from, to, price]. Return the cheapest price from src to dst using at most k intermediate stops, or -1 if no such route exists.',
  signals: ['shortest path WITH a limit on edges/hops', '"at most k stops"', 'weighted directed graph', 'plain Dijkstra may pick a cheaper route that uses too many stops'],
  insight:
    'Bellman-Ford relaxes every edge once per round, and after round i the prices are optimal for paths of at most i edges. Run k + 1 rounds — but relax from a COPY of the previous round so a single round can\'t chain several flights.',
  hints: [
    'At most k stops means at most k + 1 flights (edges).',
    'Which shortest-path algorithm naturally grows path length by one edge per iteration?',
    'Bellman-Ford for k + 1 rounds; read from prices, write into tmpPrices, then swap.',
  ],
  pitfall: 'Updating prices in place inside a round — one round can then chain several flights and exceed the stop limit.',
  backend: {
    title: 'Cheapest route with a hop limit (API gateways, payment routing)',
    detail:
      'A payment router picks the cheapest chain of intermediary banks/processors but compliance caps the number of hops; an API gateway limits proxy chains to k hops. Bellman-Ford over k + 1 rounds gives the cheapest route that respects the hop budget — something Dijkstra alone cannot guarantee.',
  },
  complexity: { time: 'O(k · E)', space: 'O(n)' },
  code: `
def findCheapestPrice(n, flights, src, dst, k):
    prices = [float("inf")] * n
    prices[src] = 0                                    @init
    for i in range(k + 1):                             @round
        tmpPrices = prices.copy()                      @copy
        for s, d, p in flights:                        @edge
            if prices[s] == float("inf"):              @unreached
                continue
            if prices[s] + p < tmpPrices[d]:           @relax
                tmpPrices[d] = prices[s] + p           @update
        prices = tmpPrices                             @commit
    return -1 if prices[dst] == float("inf") else prices[dst]   @done
`,
  explain: {
    round: 'Round i allows paths with at most i + 1 flights.',
    copy: 'Read from last round, write into the copy — so each round adds at most ONE flight to any path.',
    unreached: 'Can\'t fly out of a city we could not reach with fewer flights.',
    relax: 'Compare against tmpPrices: another flight this round may already have improved d.',
    commit: 'This round\'s results become the baseline for the next round.',
  },
  distractors: [
    { text: '                prices[d] = prices[s] + p', why: 'Writing into prices mid-round lets later edges in the same round build on it, chaining several flights in one round and breaking the stop limit.' },
    { text: '    for i in range(k):', why: 'k stops = k + 1 flights; k rounds only allows k flights.' },
    { text: '            if prices[s] + p < prices[d]:', why: 'Comparing with prices[d] instead of tmpPrices[d] can overwrite a cheaper value another flight wrote earlier in this round.' },
  ],
  input: { n: 4, flights: [[0, 1, 100], [1, 2, 100], [2, 0, 100], [1, 3, 600], [2, 3, 200]], src: 0, dst: 3, k: 1 },
  presets: [
    { label: 'k = 0 (direct only)', input: { n: 3, flights: [[0, 1, 100], [1, 2, 100], [0, 2, 500]], src: 0, dst: 2, k: 0 } },
    { label: 'cheaper with more stops', input: { n: 3, flights: [[0, 1, 100], [1, 2, 100], [0, 2, 500]], src: 0, dst: 2, k: 1 } },
    { label: 'unreachable', input: { n: 3, flights: [[0, 1, 100]], src: 0, dst: 2, k: 1 } },
  ],
  validate: ({ n, flights, src, dst, k }) => {
    if (![n, src, dst, k].every(isInt) || !Array.isArray(flights)) return 'Expected { n, flights: [from, to, price][], src, dst, k }';
    if (n < 2 || n > 7) return 'Keep n between 2 and 7';
    if (src < 0 || src >= n || dst < 0 || dst >= n) return 'src and dst must be cities 0..n-1';
    if (k < 0 || k > 4) return 'Keep k between 0 and 4';
    if (flights.length > 10) return 'Keep ≤ 10 flights';
    if (!flights.every((f) => Array.isArray(f) && f.length === 3 && f.every(isInt) && f[0] >= 0 && f[0] < n && f[1] >= 0 && f[1] < n && f[2] >= 0 && f[2] <= 10000)) return 'Flights must be [from, to, price] with cities 0..n-1';
    return null;
  },
  trace(t, { n, flights, src, dst, k }) {
    const ids = Array.from({ length: n }, (_, i) => i);
    const pos = bfsLayers(ids, flights.map(([a, b]) => [a, b] as [number, number]), src);
    let prices: number[] = ids.map(() => Infinity);
    prices[src] = 0;
    let tmp: number[] | null = null;
    const history: number[][] = [];
    const rowLabels: string[] = [];
    let fi = -1;
    let upd = -1;
    t.draw(() => {
      const tn: Record<string, Tone> = { [String(dst)]: 'warn', [String(src)]: 'good' };
      const et: Record<string, Tone> = {};
      if (fi >= 0) {
        const [s, d] = flights[fi];
        et[`${s}->${d}`] = 'active';
        tn[String(s)] = 'active';
      }
      const badges: Record<string, string> = {};
      for (const i of ids) badges[String(i)] = fmt((tmp ?? prices)[i]);
      return [
        V.graph('flights (label = price)', ids, flights.map(([s, d, p]) => [s, d, p] as [number, number, number]), { directed: true, positions: pos, tones: tn, edgeTones: et, badges, caption: `badge = cheapest known price · good = src · warn = dst` }),
        V.array('prices (last round — read only)', prices, { pointers: fi >= 0 ? { s: flights[fi][0] } : {} }),
        tmp && V.array('tmpPrices (this round — written)', tmp, { pointers: fi >= 0 ? { d: flights[fi][1] } : {}, tones: upd >= 0 ? { [upd]: 'good' } : {} }),
        history.length > 0 && V.grid('prices after each round', history, { rowLabels, colLabels: ids }),
      ];
    });
    history.push([...prices]);
    rowLabels.push('start');
    t.step('init', `prices[${src}] = 0, everything else ∞: with 0 flights we can only be at the source.`, { src, dst, k });
    let askChain = true;
    let askRelax = true;
    for (let i = 0; i <= k; i++) {
      fi = -1;
      upd = -1;
      tmp = null;
      t.step('round', `Round ${i + 1} of ${k + 1}: allow routes with up to ${i + 1} flight${i ? 's' : ''} (${i} stop${i === 1 ? '' : 's'}).`, { i });
      tmp = [...prices];
      t.step('copy', 'Copy prices into tmpPrices. Reads come from prices, writes go to tmpPrices.', { i });
      for (fi = 0; fi < flights.length; fi++) {
        const [s, d, p] = flights[fi];
        upd = -1;
        t.step('edge', `Flight ${s} → ${d} costs ${p}.`, { s, d, p, [`prices[${s}]`]: prices[s] });
        if (askChain && prices[s] === Infinity && tmp[s] !== Infinity) {
          askChain = false;
          t.predict(`tmpPrices[${s}] was just set to ${tmp[s]} this round. Can flight ${s} → ${d} be used now?`, ['Yes', 'No'], 1, `We read prices[${s}], which is still ∞ from the last round. Using tmpPrices would chain two flights in one round and break the stop limit.`);
        }
        if (prices[s] === Infinity) {
          t.step('unreached', `prices[${s}] = ∞ — ${s} was not reachable with ${i} flight${i === 1 ? '' : 's'}, skip.`, { s });
          continue;
        }
        const cand = prices[s] + p;
        if (askRelax && i > 0 && cand < tmp[d]) {
          askRelax = false;
          t.predict(`Will tmpPrices[${d}] improve via ${s}?`, ['Yes', 'No'], 0, `${prices[s]} + ${p} = ${cand} < ${fmt(tmp[d])}.`);
        }
        if (cand < tmp[d]) {
          t.step('relax', `${prices[s]} + ${p} = ${cand} < tmpPrices[${d}] = ${fmt(tmp[d])}.`, { s, d, cand });
          tmp[d] = cand;
          upd = d;
          t.step('update', `tmpPrices[${d}] = ${cand}.`, { d, [`tmpPrices[${d}]`]: cand });
        } else {
          t.step('relax', `${prices[s]} + ${p} = ${cand} is not cheaper than tmpPrices[${d}] = ${fmt(tmp[d])} — keep it.`, { s, d, cand });
        }
      }
      fi = -1;
      upd = -1;
      prices = tmp;
      tmp = null;
      history.push([...prices]);
      rowLabels.push(`round ${i + 1}`);
      t.step('commit', `Round ${i + 1} done: prices = [${prices.map((x) => fmt(x)).join(', ')}].`, { prices: prices.map((x) => fmt(x)) });
    }
    const ans = prices[dst] === Infinity ? -1 : prices[dst];
    // Unconstrained cheapest price (n - 1 rounds) as a tempting wrong option.
    let free = ids.map(() => Infinity);
    free[src] = 0;
    for (let r = 0; r < n - 1; r++) {
      const nx = [...free];
      for (const [s, d, p] of flights) if (free[s] + p < nx[d]) nx[d] = free[s] + p;
      free = nx;
    }
    const opts = [...new Set([String(ans), free[dst] === Infinity ? '-1' : String(free[dst]), '-1'])];
    t.predict(`What is returned for dst = ${dst}?`, opts, 0, ans === -1 ? `No route reaches ${dst} within ${k + 1} flights.` : `prices[${dst}] = ${ans} after ${k + 1} rounds${free[dst] < ans ? ` — the cheaper ${free[dst]} needs more than ${k} stops` : ''}.`);
    t.step('done', ans === -1 ? `prices[${dst}] is ∞ → -1.` : `Cheapest with ≤ ${k} stop${k === 1 ? '' : 's'}: ${ans}.`, { result: ans });
    return ans;
  },
};

export const problems: Problem[] = [
  reconstructItinerary,
  minCostConnectPoints,
  networkDelayTime,
  swimInRisingWater,
  alienDictionary,
  cheapestFlights,
];

export const variants: Variant[] = [
  {
    id: 'minimum-effort-hiking-path',
    title: 'Minimum-Effort Hiking Route',
    statement:
      'A hiker crosses a height grid from the top-left to the bottom-right cell. The effort of a route is the largest absolute height difference between two consecutive cells on it. Return the minimum possible effort.',
    pattern: 'weighted-graph',
    nearest: 'swim-in-rising-water',
    signals: ['minimise the MAXIMUM step on a path', 'grid path', 'bottleneck cost, not sum'],
    approach: 'Dijkstra with priority = max(effort so far, |h[next] − h[cur]|); the first time the target is popped its priority is the answer. (Alternatively binary-search the effort and BFS.)',
    backend: 'Picking a network path whose worst single hop (latency spike, lowest bandwidth link) is as good as possible.',
  },
  {
    id: 'most-reliable-message-path',
    title: 'Most Reliable Delivery Path',
    statement:
      'Each link between two services delivers a message with probability p. Find the probability of the most reliable path from service A to service B (0 if none).',
    pattern: 'weighted-graph',
    nearest: 'network-delay-time',
    signals: ['best path from one source', 'multiplicative weights in [0, 1]', '"maximum probability"'],
    approach: 'Dijkstra with a MAX-heap on probability: pop the most reliable frontier node, finalise it, push neighbours with prob × p. Works because multiplying by p ≤ 1 never increases reliability (or run Dijkstra on −log p).',
    backend: 'Choosing the retry/forwarding path through a mesh of unreliable links or message brokers to maximise delivery success.',
  },
  {
    id: 'cheapest-network-of-cables',
    title: 'Cheapest Set of Cables to Link All Offices',
    statement:
      'You have n offices and a list of possible cables [a, b, cost]. Return the minimum total cost to connect all offices, or -1 if impossible.',
    pattern: 'weighted-graph',
    nearest: 'min-cost-to-connect-all-points',
    signals: ['connect ALL nodes', 'minimum total cost', 'explicit sparse edge list'],
    approach: 'Kruskal: sort cables by cost, union-find to accept a cable only if it joins two different components; stop at n − 1 cables, otherwise -1. (Prim with a heap also works.)',
    backend: 'Designing the cheapest backbone between offices/datacenters or building a minimum-cost replication topology.',
  },
  {
    id: 'package-install-order-smallest',
    title: 'Lexicographically Smallest Package Install Order',
    statement:
      'Packages declare dependencies on other packages. Return the install order that respects all dependencies and is alphabetically smallest among valid orders, or "" if dependencies are circular.',
    pattern: 'topo-sort',
    nearest: 'alien-dictionary',
    signals: ['dependencies → order', 'among many valid orders pick a specific one', 'cycle → impossible'],
    approach: 'Kahn\'s algorithm but with a min-heap instead of a FIFO queue, so the smallest available package is always installed next. Fewer than n output → cycle.',
    backend: 'Deterministic, reproducible install / migration ordering in package managers and build systems (stable lockfiles).',
  },
];
