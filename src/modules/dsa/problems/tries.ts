import type { Problem, Tone, Variant } from '../engine/types.ts';
import { TrieNode, V, rc, tones } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Tries — prefix trees: one node per prefix, children keyed by the next character.
// Every visualization shows the trie (✓ = end of a word) with a `cur` / `node` pointer.
// ---------------------------------------------------------------------------

const isWord = (w: unknown, max: number) => typeof w === 'string' && /^[a-z]+$/.test(w) && w.length <= max;
const opLabel = (o: readonly unknown[]) => `${o[0]}(${o.slice(1).map((x) => (typeof x === 'string' ? `"${x}"` : x)).join(',')})`;
/** Highlight one index of the word being processed. */
const charTone = (i: number, tone: Tone = 'active'): Record<number, Tone> => (i >= 0 ? { [i]: tone } : {});

type TrieOp = ['insert' | 'search' | 'startsWith', string];

const implementTrie: Problem<{ ops: TrieOp[] }> = {
  id: 'implement-trie-prefix-tree',
  num: 208,
  title: 'Implement Trie (Prefix Tree)',
  difficulty: 'Medium',
  category: 'tries',
  pattern: 'trie',
  statement:
    'Implement a Trie with insert(word), search(word) → True if the exact word was inserted, and startsWith(prefix) → True if any inserted word begins with prefix. Words are lowercase letters.',
  signals: ['"prefix" / "starts with"', 'many words sharing beginnings', 'lookups by character, not by whole key', 'autocomplete-style queries'],
  insight:
    'Each node represents a prefix; its children map the next character to the longer prefix. Walking a word costs O(len) no matter how many words are stored. A flag on the node marks "a whole word ends here", which is the only difference between search and startsWith.',
  hints: [
    'A hash set answers search but not startsWith. What structure shares common prefixes?',
    'Give every node a dict of children (char → node) and an end-of-word flag.',
    'search and startsWith walk the same way; they only differ in what they return at the end.',
  ],
  pitfall: 'Returning True from search just because the walk succeeded — "app" is only a word if its last node has endOfWord set; otherwise it is just a prefix of "apple".',
  backend: {
    title: 'Autocomplete and prefix routing',
    detail:
      'Search-box suggestions, command palettes and IP routing tables (longest-prefix match on address bits) are tries: the lookup cost depends on the key length, not on how many keys exist, and all keys with a given prefix live in one subtree you can enumerate.',
  },
  complexity: { time: 'O(L) per operation (L = word length)', space: 'O(total characters inserted)' },
  code: `
class TrieNode:
    def __init__(self):
        self.children = {}
        self.endOfWord = False

class Trie:
    def __init__(self):
        self.root = TrieNode()                  @init
    def insert(self, word):
        cur = self.root                         @insStart
        for c in word:                          @insLoop
            if c not in cur.children:           @insCheck
                cur.children[c] = TrieNode()    @insNew
            cur = cur.children[c]               @insMove
        cur.endOfWord = True                    @insEnd
    def search(self, word):
        cur = self.root                         @sStart
        for c in word:                          @sLoop
            if c not in cur.children:           @sCheck
                return False                    @sFail
            cur = cur.children[c]               @sMove
        return cur.endOfWord                    @sEnd
    def startsWith(self, prefix):
        cur = self.root                         @pStart
        for c in prefix:                        @pLoop
            if c not in cur.children:           @pCheck
                return False                    @pFail
            cur = cur.children[c]               @pMove
        return True                             @pEnd
`,
  explain: {
    insNew: 'First word with this prefix: create the node.',
    insMove: 'Follow (or just created) the edge for c.',
    insEnd: 'Mark that a complete word ends at this node.',
    sFail: 'No stored word has this prefix.',
    sEnd: 'The path exists; it is a word only if the end flag is set.',
    pEnd: 'The path exists, so some word continues from here — the flag does not matter.',
  },
  distractors: [
    { text: '        return len(cur.children) == 0', why: 'Being a leaf is not the same as ending a word: after insert("apple") and insert("app"), the "app" node has a child but is still a word.' },
    { text: '            cur.children[c] = TrieNode()', why: 'Without the "if c not in" check, inserting a second word overwrites the subtree and erases words that shared the prefix.' },
    { text: '            cur = cur.children.get(c, self.root)', why: 'A missing character silently restarts the walk at the root instead of failing, so search("xapple") would find "apple".' },
  ],
  input: {
    ops: [
      ['insert', 'apple'],
      ['search', 'apple'],
      ['search', 'app'],
      ['startsWith', 'app'],
      ['insert', 'app'],
      ['search', 'app'],
      ['search', 'ape'],
    ],
  },
  presets: [
    { label: 'branching words', input: { ops: [['insert', 'car'], ['insert', 'cat'], ['insert', 'do'], ['startsWith', 'ca'], ['search', 'ca'], ['startsWith', 'dog']] } },
    { label: 'word inside a word', input: { ops: [['insert', 'to'], ['insert', 'tea'], ['search', 't'], ['search', 'to']] } },
  ],
  validate: ({ ops }) => {
    if (!Array.isArray(ops) || !ops.length || ops.length > 10) return '1–10 ops';
    for (const o of ops) {
      if (!Array.isArray(o) || o.length !== 2 || !['insert', 'search', 'startsWith'].includes(o[0] as string)) return 'Each op is ["insert" | "search" | "startsWith", word]';
      if (!isWord(o[1], 8)) return 'Words: 1–8 lowercase letters';
    }
    return null;
  },
  trace(t, { ops }) {
    const root = new TrieNode();
    let cur: TrieNode | null = null;
    let word = '';
    let i = -1;
    let opIdx = -1;
    const outs: string[] = [];
    t.draw(() => [
      V.array('ops', ops.map(opLabel), { pointers: { op: opIdx }, tones: opIdx >= 0 && opIdx < ops.length ? { [opIdx]: 'active' } : {}, showIndex: false }),
      V.trie('trie', root, { pointers: { cur }, tones: cur ? { [cur.id]: 'active' } : {}, caption: '✓ = a word ends here' }),
      word !== '' && V.text('word', word, { tones: { ...tones([...Array(Math.max(0, i)).keys()], 'good'), ...charTone(i < word.length ? i : -1) } }),
      V.chips('returned', outs),
    ]);
    t.step('init', 'The root is an empty TrieNode: it represents the empty prefix.', {});
    let askedApp = false;
    let askedReuse = false;
    let askedFail = false;
    const inserted = new Set<string>();
    for (opIdx = 0; opIdx < ops.length; opIdx++) {
      const [kind, w] = ops[opIdx];
      word = w;
      i = -1;
      cur = root;
      if (kind === 'insert') {
        t.step('insStart', `insert("${w}"): start at the root.`, { word: w });
        if (!askedReuse && inserted.size && [...inserted].some((x) => x.startsWith(w[0]))) {
          askedReuse = true;
          let n = 0;
          let p: TrieNode | undefined = root;
          for (const c of w) {
            p = p?.children.get(c);
            if (!p) n++;
          }
          const opts = [...new Set([0, 1, n, w.length].map(String))].sort((a, b) => Number(a) - Number(b));
          t.predict(`How many NEW nodes will insert("${w}") create?`, opts, opts.indexOf(String(n)), n ? `Only the characters beyond the shared prefix need new nodes (${n}).` : `Every prefix of "${w}" already exists; insert only sets the end flag.`);
        }
        for (i = 0; i < w.length; i++) {
          const c = w[i];
          t.step('insLoop', `c = '${c}'.`, { c });
          const has = cur.children.has(c);
          t.step('insCheck', has ? `'${c}' already a child — reuse it.` : `'${c}' is not a child of the current node.`, { c });
          if (!has) {
            cur.children.set(c, new TrieNode());
            t.step('insNew', `Create a node for "${w.slice(0, i + 1)}".`, { prefix: w.slice(0, i + 1) });
          }
          cur = cur.children.get(c)!;
          t.step('insMove', `Move to "${w.slice(0, i + 1)}".`, { prefix: w.slice(0, i + 1) });
        }
        cur.end = true;
        cur.word = w;
        inserted.add(w);
        outs.push('null');
        t.step('insEnd', `Mark "${w}" as a complete word (✓).`, { word: w });
      } else {
        const pre = kind === 'startsWith';
        t.step(pre ? 'pStart' : 'sStart', `${kind}("${w}"): start at the root.`, { word: w });
        let path = true;
        for (i = 0; i < w.length; i++) {
          const c = w[i];
          t.step(pre ? 'pLoop' : 'sLoop', `c = '${c}'.`, { c });
          const has = cur.children.has(c);
          if (!has && !askedFail && !pre) {
            askedFail = true;
            t.predict(`Searching "${w}": the walk reached "${w.slice(0, i)}". What happens at '${c}'?`, ['Create a node and continue', 'Return False', 'Skip the character'], 1, `No stored word starts with "${w.slice(0, i + 1)}"; search never modifies the trie.`);
          }
          t.step(pre ? 'pCheck' : 'sCheck', has ? `'${c}' found.` : `'${c}' is not a child — no word has the prefix "${w.slice(0, i + 1)}".`, { c });
          if (!has) {
            path = false;
            break;
          }
          cur = cur.children.get(c)!;
          t.step(pre ? 'pMove' : 'sMove', `Move to "${w.slice(0, i + 1)}".`, { prefix: w.slice(0, i + 1) });
        }
        if (!path) {
          outs.push('False');
          t.step(pre ? 'pFail' : 'sFail', 'Return False.', { result: false });
          continue;
        }
        if (!pre && !askedApp && !cur.end && cur.children.size) {
          askedApp = true;
          t.predict(`The whole path "${w}" exists. What does search return?`, ['True', 'False'], 1, `"${w}" is only a prefix of a longer word — its node has no ✓ (endOfWord is False).`);
        }
        const r = pre ? true : cur.end;
        outs.push(r ? 'True' : 'False');
        t.step(pre ? 'pEnd' : 'sEnd', pre ? 'Path exists → True.' : `endOfWord is ${cur.end ? 'True' : 'False'} → return ${cur.end ? 'True' : 'False'}.`, { result: r });
      }
    }
    opIdx = ops.length;
    cur = null;
    word = '';
    return outs;
  },
};

type DictOp = ['addWord' | 'search', string];

const wordDictionary: Problem<{ ops: DictOp[] }> = {
  id: 'design-add-and-search-words-data-structure',
  num: 211,
  title: 'Design Add and Search Words Data Structure',
  difficulty: 'Medium',
  category: 'tries',
  pattern: 'trie',
  statement:
    'Design a WordDictionary with addWord(word) and search(word). The search pattern may contain "." which matches any single letter; return True if any added word matches the whole pattern.',
  signals: ['wildcard character that matches any letter', 'many stored words, many pattern queries', 'prefix structure + "try every branch"'],
  insight:
    'Store the words in a trie. A normal letter follows one edge. A "." must try every child — that is a DFS that branches only at wildcards, and it can stop at the first branch that matches the rest of the pattern.',
  hints: [
    'Without wildcards this is exactly Implement Trie.',
    'At a ".", which children could match? All of them.',
    'Write dfs(i, node): match word[i:] starting at node. Recurse on every child at a ".", return True as soon as one succeeds.',
  ],
  pitfall: 'Returning the result of the FIRST child\'s DFS at a "." (return dfs(...)) instead of only returning when it is True — the other children never get tried.',
  backend: {
    title: 'Wildcard topic / route matching',
    detail:
      'Message brokers (MQTT/AMQP topic filters like "sensors.+.temp"), HTTP routers with ":param" segments and DNS wildcard records store patterns or keys in a trie keyed by segment. Literal segments follow one edge; a wildcard fans out to every child — the same DFS.',
  },
  complexity: { time: 'O(L) without dots, up to O(26^d · L) with d dots', space: 'O(total characters) + O(L) recursion' },
  code: `
class WordDictionary:
    def __init__(self):
        self.root = TrieNode()                          @init
    def addWord(self, word):
        cur = self.root                                 @addStart
        for c in word:                                  @addLoop
            if c not in cur.children:                   @addCheck
                cur.children[c] = TrieNode()            @addNew
            cur = cur.children[c]                       @addMove
        cur.endOfWord = True                            @addEnd
    def search(self, word):
        def dfs(j, root):
            cur = root                                  @dfs
            for i in range(j, len(word)):               @loop
                c = word[i]
                if c == ".":                            @dot
                    for child in cur.children.values(): @branch
                        if dfs(i + 1, child):           @recurse
                            return True                 @found
                    return False                        @deadDot
                else:
                    if c not in cur.children:           @check
                        return False                    @miss
                    cur = cur.children[c]               @move
            return cur.endOfWord                        @end
        return dfs(0, self.root)                        @search
`,
  explain: {
    branch: 'A wildcard can be any letter: try each child in turn.',
    recurse: 'Match the REST of the pattern (from i + 1) below that child.',
    found: 'One successful branch is enough.',
    deadDot: 'Every child failed (or there were none) — this path cannot match.',
    end: 'Pattern consumed: it matches only if a word ends here.',
  },
  distractors: [
    { text: '                        return dfs(i + 1, child)', why: 'Returns after the first child even when it fails, so "." never tries the other letters.' },
    { text: '                        if dfs(i, child):', why: 'Recursing with the same index re-reads the "." at the child, matching one extra letter per call.' },
    { text: '            return bool(cur)', why: 'Every node is truthy, so this is True whenever the walk survived — a prefix like "ba" would match the stored "bad".' },
  ],
  input: {
    ops: [
      ['addWord', 'bad'],
      ['addWord', 'dad'],
      ['addWord', 'mad'],
      ['search', 'pad'],
      ['search', 'bad'],
      ['search', '.ad'],
      ['search', 'b..'],
    ],
  },
  presets: [
    { label: 'dot must backtrack', input: { ops: [['addWord', 'cat'], ['addWord', 'cow'], ['search', 'c.w'], ['search', '.a.'], ['search', 'c..t']] } },
    { label: 'all dots', input: { ops: [['addWord', 'ab'], ['addWord', 'xyz'], ['search', '..'], ['search', '.']] } },
  ],
  validate: ({ ops }) => {
    if (!Array.isArray(ops) || !ops.length || ops.length > 9) return '1–9 ops';
    for (const o of ops) {
      if (!Array.isArray(o) || o.length !== 2 || (o[0] !== 'addWord' && o[0] !== 'search')) return 'Each op is ["addWord" | "search", word]';
      if (o[0] === 'addWord' && !isWord(o[1], 6)) return 'addWord: 1–6 lowercase letters';
      if (o[0] === 'search' && (typeof o[1] !== 'string' || !/^[a-z.]{1,6}$/.test(o[1]))) return 'search: 1–6 lowercase letters or "."';
    }
    return null;
  },
  trace(t, { ops }) {
    const root = new TrieNode();
    const prefixOf = new Map<TrieNode, string>([[root, '']]);
    let cur: TrieNode | null = null;
    let word = '';
    let i = -1;
    let opIdx = -1;
    const calls: { j: number; node: TrieNode }[] = [];
    const outs: string[] = [];
    t.draw(() => [
      V.array('ops', ops.map(opLabel), { pointers: { op: opIdx }, tones: opIdx >= 0 && opIdx < ops.length ? { [opIdx]: 'active' } : {}, showIndex: false }),
      V.trie('trie', root, {
        pointers: { cur },
        tones: { ...Object.fromEntries(calls.map((f) => [f.node.id, 'info' as Tone])), ...(cur ? { [cur.id]: 'active' as Tone } : {}) },
        caption: '✓ = a word ends here',
      }),
      word !== '' && V.text(opIdx >= 0 && ops[opIdx]?.[0] === 'search' ? 'pattern' : 'word', word, { tones: charTone(i >= 0 && i < word.length ? i : -1, word[i] === '.' ? 'warn' : 'active') }),
      calls.length > 0 && V.stack('call stack', calls.map((f) => `dfs(${f.j}, "${prefixOf.get(f.node)}")`), { tones: { [calls.length - 1]: 'active' } }),
      V.chips('returned', outs),
    ]);
    t.step('init', 'Empty root.', {});

    let askedMiss = false;
    let askedBranch = false;
    let askedBacktrack = false;
    const dfs = (j: number, node: TrieNode): boolean => {
      calls.push({ j, node });
      let c0: TrieNode = node;
      cur = c0;
      i = j;
      t.step('dfs', `dfs(${j}): match "${word.slice(j)}" starting at "${prefixOf.get(node)}".`, { j });
      for (let k = j; k < word.length; k++) {
        i = k;
        const c = word[k];
        cur = c0;
        t.step('loop', `i = ${k}, c = '${c}'.`, { i: k, c });
        t.step('dot', c === '.' ? `Wildcard! It may be any of the ${c0.children.size} ${c0.children.size === 1 ? 'child' : 'children'}.` : `'${c}' is a normal letter.`, { c });
        if (c === '.') {
          const kids = [...c0.children.entries()];
          if (!askedBranch && kids.length > 1) {
            askedBranch = true;
            const opts = [...new Set(['1', String(kids.length), '26'])].sort((x, y) => Number(x) - Number(y));
            t.predict(`At most how many recursive dfs calls can this '.' make?`, opts, opts.indexOf(String(kids.length)), `One per EXISTING child (${kids.map(([ch]) => `'${ch}'`).join(', ')}), not one per letter of the alphabet — and it stops early at the first True.`);
          }
          for (const [key, child] of kids) {
            cur = c0;
            t.step('branch', `Try child '${key}'.`, { child: key });
            const ok = dfs(k + 1, child);
            cur = c0;
            i = k;
            t.step('recurse', `dfs(${k + 1}, "${prefixOf.get(child)}") returned ${ok ? 'True' : 'False'}.`, { result: ok });
            if (ok) {
              calls.pop();
              t.step('found', 'A branch matched → return True.', { result: true });
              return true;
            }
          }
          calls.pop();
          t.step('deadDot', `No child of "${prefixOf.get(c0)}" matches the rest → return False.`, { result: false });
          return false;
        }
        const has = c0.children.has(c);
        if (!has && !askedMiss) {
          askedMiss = true;
          t.predict(`Is '${c}' a child of "${prefixOf.get(c0)}"?`, ['Yes — move to it', 'No — return False'], 1, `No added word has the prefix "${prefixOf.get(c0)}${c}".`);
        }
        t.step('check', has ? `'${c}' found.` : `No child '${c}'.`, { c });
        if (!has) {
          calls.pop();
          t.step('miss', 'return False.', { result: false });
          return false;
        }
        c0 = c0.children.get(c)!;
        cur = c0;
        t.step('move', `Move to "${prefixOf.get(c0)}".`, {});
      }
      cur = c0;
      if (!askedBacktrack && calls.length > 1 && !c0.end) {
        askedBacktrack = true;
        t.predict(`The pattern is consumed at "${prefixOf.get(c0)}". What does this dfs return?`, ['True', 'False'], 1, 'No ✓ here: a stored word only passes through this node.');
      }
      calls.pop();
      t.step('end', `Pattern consumed at "${prefixOf.get(c0)}": endOfWord = ${c0.end ? 'True' : 'False'}.`, { result: c0.end });
      return c0.end;
    };

    for (opIdx = 0; opIdx < ops.length; opIdx++) {
      const [kind, w] = ops[opIdx];
      word = w;
      i = -1;
      cur = root;
      if (kind === 'addWord') {
        t.step('addStart', `addWord("${w}"): start at the root.`, { word: w });
        for (i = 0; i < w.length; i++) {
          const c = w[i];
          t.step('addLoop', `c = '${c}'.`, { c });
          const has = cur.children.has(c);
          t.step('addCheck', has ? `'${c}' exists — share it.` : `No child '${c}' yet.`, { c });
          if (!has) {
            const n = new TrieNode();
            prefixOf.set(n, w.slice(0, i + 1));
            cur.children.set(c, n);
            t.step('addNew', `Create node "${w.slice(0, i + 1)}".`, {});
          }
          cur = cur.children.get(c)!;
          t.step('addMove', `Move to "${w.slice(0, i + 1)}".`, {});
        }
        cur.end = true;
        cur.word = w;
        outs.push('null');
        t.step('addEnd', `"${w}" ends here (✓).`, { word: w });
      } else {
        t.step('search', `search("${w}") = dfs(0, root).`, { word: w });
        const r = dfs(0, root);
        cur = null;
        i = -1;
        outs.push(r ? 'True' : 'False');
        t.step('search', `search("${w}") → ${r ? 'True' : 'False'}.`, { result: r });
      }
    }
    opIdx = ops.length;
    cur = null;
    word = '';
    return outs;
  },
};

const wordSearchII: Problem<{ board: string[][]; words: string[] }> = {
  id: 'word-search-ii',
  num: 212,
  title: 'Word Search II',
  difficulty: 'Hard',
  category: 'tries',
  pattern: 'trie',
  statement:
    'Given a grid of letters and a list of words, return every word that can be traced through horizontally or vertically adjacent cells, using each cell at most once per word.',
  signals: ['MANY words searched in the same grid', 'paths through a grid (DFS + backtracking)', 'words share prefixes', 'prune paths that cannot become any word'],
  insight:
    'Running Word Search once per word repeats the same grid walks. Put all words in a trie and run ONE backtracking DFS from every cell, walking the trie in lockstep: the moment the path\'s letters are not a prefix of any word (no trie child), that whole branch is cut.',
  hints: [
    'How would you solve it for one word? Why is repeating that for every word slow?',
    'Which data structure answers "is this path a prefix of any word?" in O(1) per step?',
    'DFS(r, c, trieNode): continue only if board[r][c] is a child of trieNode; mark visited, recurse 4 ways, unmark.',
  ],
  pitfall: 'Forgetting to un-mark the cell after exploring it (backtracking): later paths through that cell are then wrongly blocked and words are missed.',
  backend: {
    title: 'Scanning text for a big dictionary of terms',
    detail:
      'Content moderation, PII detectors and log scanners match thousands of keywords against every position of the input. Putting the keywords in a trie (the core of the Aho–Corasick algorithm) lets one pass walk all keywords together and abandon a position as soon as no keyword continues — the same pruning as here.',
  },
  complexity: { time: 'O(R·C · 4·3^(L−1)) worst case, L = longest word', space: 'O(total word chars)' },
  code: `
def findWords(board, words):
    root = TrieNode()                                   @init
    for w in words:                                     @build
        root.addWord(w)                                 @add
    ROWS, COLS = len(board), len(board[0])              @setup
    res, visit = set(), set()
    def dfs(r, c, node, word):
        if (r < 0 or c < 0 or r == ROWS or c == COLS or (r, c) in visit): @bounds
            return
        if board[r][c] not in node.children:            @prune
            return
        visit.add((r, c))                               @visit
        node = node.children[board[r][c]]               @descend
        word += board[r][c]
        if node.isWord:                                 @isWord
            res.add(word)                               @found
        dfs(r + 1, c, node, word)                       @dirs
        dfs(r - 1, c, node, word)
        dfs(r, c + 1, node, word)
        dfs(r, c - 1, node, word)
        visit.remove((r, c))                            @unvisit
    for r in range(ROWS):                               @rows
        for c in range(COLS):                           @cell
            dfs(r, c, root, "")                         @start
    return list(res)                                    @done
`,
  explain: {
    build: 'One trie for ALL words — the DFS checks every word at once.',
    bounds: 'Off the grid or already on the current path.',
    prune: 'No word continues with this letter: abandon the whole branch.',
    descend: 'Advance in the trie together with the grid.',
    isWord: 'The path so far spells a complete word.',
    found: 'A set, because the same word can be traced in several ways.',
    unvisit: 'Backtrack: this cell is free again for other paths.',
  },
  distractors: [
    { text: '        word = board[r][c]', why: 'Overwrites the path instead of extending it, so only one-letter words could ever be found.' },
    { text: '        if board[r][c] not in words:', why: 'Checks whole words, not prefixes — single letters are almost never in words, so nothing is explored.' },
    { text: '    res = []', why: 'A list collects duplicates when a word can be traced along two different paths.' },
  ],
  input: {
    board: [
      ['o', 'a', 'a', 'n'],
      ['e', 't', 'a', 'e'],
      ['i', 'h', 'k', 'r'],
      ['i', 'f', 'l', 'v'],
    ],
    words: ['oath', 'pea', 'eat', 'rain'],
  },
  presets: [
    { label: 'shared prefix', input: { board: [['c', 'a', 't'], ['x', 'r', 's']], words: ['cat', 'cats', 'car', 'cart'] } },
    { label: 'cell reuse not allowed', input: { board: [['a', 'b'], ['c', 'd']], words: ['aba', 'abdc', 'acdb'] } },
  ],
  validate: ({ board, words }) => {
    if (!Array.isArray(board) || !board.length || board.length > 4) return 'board: 1–4 rows';
    const cols = Array.isArray(board[0]) ? board[0].length : 0;
    if (!cols || cols > 4) return 'board: 1–4 columns';
    if (board.some((row) => !Array.isArray(row) || row.length !== cols || row.some((x) => typeof x !== 'string' || !/^[a-z]$/.test(x)))) return 'Every row needs the same number of single lowercase letters';
    if (!Array.isArray(words) || !words.length || words.length > 4) return 'words: 1–4 words';
    if (!words.every((w) => isWord(w, 6))) return 'Each word: 1–6 lowercase letters';
    return null;
  },
  trace(t, { board, words }) {
    const ROWS = board.length;
    const COLS = board[0].length;
    const root = new TrieNode();
    let node: TrieNode | null = null;
    let pos: [number, number] | null = null;
    let word = '';
    const visit = new Set<string>();
    const res = new Set<string>();
    let wi = -1;
    t.draw(() => [
      V.grid('board', board, {
        tones: { ...tones([...visit], 'info'), ...(pos ? { [rc(pos[0], pos[1])]: (visit.has(rc(pos[0], pos[1])) ? 'active' : 'warn') as Tone } : {}) },
        pointers: { cur: pos },
        caption: 'blue = on the current path',
      }),
      V.trie('trie of words', root, { pointers: { node }, tones: node ? { [node.id]: 'active' } : {}, caption: '✓ = a word ends here' }),
      wi >= 0 && wi < words.length ? V.chips('words', words, { tones: { [wi]: 'active' } }) : V.text('path word', word || '""'),
      V.set('res', res),
    ]);
    t.step('init', 'Empty trie root.', {});
    for (wi = 0; wi < words.length; wi++) {
      t.step('build', `Word "${words[wi]}".`, { w: words[wi] });
      let n = root;
      for (const ch of words[wi]) {
        if (!n.children.has(ch)) n.children.set(ch, new TrieNode());
        n = n.children.get(ch)!;
      }
      n.end = true;
      n.word = words[wi];
      t.step('add', `Insert "${words[wi]}" (shared prefixes reuse nodes).`, { w: words[wi] });
    }
    wi = -1;
    t.step('setup', `${ROWS}×${COLS} board; res and visit start empty.`, { ROWS, COLS });

    let askedPrune = false;
    let askedWord = false;
    let askedUnvisit = false;
    const dfs = (r: number, c: number, nd: TrieNode, w: string, isStart: boolean) => {
      if (r < 0 || c < 0 || r === ROWS || c === COLS) return; // off-grid calls are skipped silently to save frames
      const k = rc(r, c);
      pos = [r, c];
      node = nd;
      word = w;
      if (visit.has(k)) {
        t.step('bounds', `(${r},${c}) is already on the path — return.`, { r, c });
        return;
      }
      const ch = board[r][c];
      if (!nd.children.has(ch)) {
        if (!askedPrune && !isStart) {
          askedPrune = true;
          t.predict(`The path spells "${w}". Next cell (${r},${c}) holds '${ch}'. Does the DFS step into it?`, ['Yes', 'No'], 1, `No word in the list starts with "${w}${ch}" — the trie node has no '${ch}' child.`);
        }
        t.step(isStart ? 'start' : 'prune', isStart ? `dfs(${r},${c}): no word starts with '${ch}' — pruned immediately.` : `"${w}${ch}" is not a prefix of any word — prune.`, { r, c, ch });
        return;
      }
      if (isStart) t.step('start', `dfs(${r},${c}): '${ch}' starts a word in the trie.`, { r, c, ch });
      visit.add(k);
      t.step('visit', `Mark (${r},${c}) as on the path.`, { r, c });
      nd = nd.children.get(ch)!;
      w += ch;
      node = nd;
      word = w;
      t.step('descend', `Path is now "${w}".`, { word: w });
      if (!askedWord && w.length >= 2) {
        askedWord = true;
        t.predict(`Is "${w}" a complete word in the list?`, ['Yes', 'No'], nd.end ? 0 : 1, nd.end ? 'Its trie node is marked ✓.' : `"${w}" is only a prefix — no ✓ on its node.`);
      }
      t.step('isWord', nd.end ? `"${w}" is a word!` : `"${w}" is not a word (yet).`, { word: w });
      if (nd.end) {
        res.add(w);
        t.step('found', `Add "${w}" to res.`, { word: w });
      }
      t.step('dirs', `Explore the neighbours of (${r},${c}): down, up, right, left.`, { r, c });
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        dfs(r + dr, c + dc, nd, w, false);
      }
      visit.delete(k);
      pos = [r, c];
      node = nd;
      word = w;
      if (!askedUnvisit) {
        askedUnvisit = true;
        t.predict(`All neighbours of (${r},${c}) are done. Why remove it from visit?`, ['So other paths can use this cell again', 'To mark that a word was found', 'To stop the search'], 0, 'visit only tracks the CURRENT path; a different path may legitimately pass through this cell.');
      }
      t.step('unvisit', `Backtrack: un-mark (${r},${c}).`, { r, c });
    };

    for (let r = 0; r < ROWS; r++) {
      pos = null;
      node = null;
      word = '';
      t.step('rows', `Row ${r}.`, { r });
      for (let c = 0; c < COLS; c++) {
        if (root.children.has(board[r][c])) {
          pos = [r, c];
          node = root;
          word = '';
          t.step('cell', `Start a DFS from (${r},${c}) = '${board[r][c]}'.`, { r, c });
        }
        dfs(r, c, root, '', true);
      }
    }
    pos = null;
    node = null;
    word = '';
    const out = [...res];
    t.step('done', `Found ${out.length} word(s): ${out.map((x) => `"${x}"`).join(', ') || 'none'}.`, { result: `[${out.join(', ')}]` });
    return out;
  },
};

export const problems: Problem[] = [implementTrie, wordDictionary, wordSearchII];

export const variants: Variant[] = [
  {
    id: 'search-autocomplete-top-suggestions',
    title: 'Autocomplete: Top 3 Suggestions per Keystroke',
    statement:
      'Given a product catalogue and a search word typed one letter at a time, return after each keystroke up to three catalogue entries that start with the typed prefix, in lexicographic order.',
    pattern: 'trie',
    nearest: 'implement-trie-prefix-tree',
    signals: ['"starts with the typed prefix"', 'answer after every character', 'many strings sharing prefixes'],
    approach:
      'Insert all products into a trie; at each node store (or lazily compute by a sorted DFS) the 3 smallest words in its subtree. Each keystroke moves one edge down, so the whole query costs O(L) after preprocessing.',
    backend: 'Search-box suggestions and CLI/IDE command completion; precomputing top-k per trie node is how typeahead services keep p99 latency flat.',
  },
  {
    id: 'url-router-wildcard-segments',
    title: 'HTTP Router with Wildcard Segments',
    statement:
      'Register routes like "/users/:id/posts" and "/users/me/settings". Given a request path, return the matching route, where ":param" matches any single segment and literal segments must match exactly.',
    pattern: 'trie',
    nearest: 'design-add-and-search-words-data-structure',
    signals: ['wildcard that matches any single unit', 'many patterns, many lookups', 'shared leading segments'],
    approach:
      'Build a trie keyed by path segment, with a special child for ":param". Look up with a DFS: follow the literal child first, fall back to the wildcard child, and backtrack if the rest of the path does not match.',
    backend: 'This is the radix-tree router inside frameworks like Gin, httprouter and Fastify — and MQTT topic matching with "+" wildcards.',
  },
  {
    id: 'chat-banned-word-filter',
    title: 'Find Every Banned Word in a Chat Message',
    statement:
      'Given a list of banned words and a chat message, return the start index and word for every occurrence of any banned word in the message (occurrences may overlap).',
    pattern: 'trie',
    nearest: 'word-search-ii',
    signals: ['many patterns searched in one text', 'patterns share prefixes', 'stop early when no pattern can continue'],
    approach:
      'Put all banned words in a trie. From each start index walk the trie along the message, recording a hit whenever a ✓ node is reached and stopping as soon as there is no child. O(n · L) for message length n; Aho–Corasick failure links make it O(n + hits).',
    backend: 'Profanity filters, secret/PII scanners in CI logs and WAF signature matching all walk a keyword trie over incoming text.',
  },
];
