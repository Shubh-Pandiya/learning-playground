import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the tries problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'implement-trie-prefix-tree': {
    java: `
class Trie {
    private class TrieNode {
        Map<Character, TrieNode> children = new HashMap<>();
        boolean endOfWord = false;
    }
    private TrieNode root;
    public Trie() {
        root = new TrieNode();                          @init
    }
    public void insert(String word) {
        TrieNode cur = root;                            @insStart
        for (char c : word.toCharArray()) {             @insLoop
            if (!cur.children.containsKey(c)) {         @insCheck
                cur.children.put(c, new TrieNode());    @insNew
            }
            cur = cur.children.get(c);                  @insMove
        }
        cur.endOfWord = true;                           @insEnd
    }
    public boolean search(String word) {
        TrieNode cur = root;                            @sStart
        for (char c : word.toCharArray()) {             @sLoop
            if (!cur.children.containsKey(c)) {         @sCheck
                return false;                           @sFail
            }
            cur = cur.children.get(c);                  @sMove
        }
        return cur.endOfWord;                           @sEnd
    }
    public boolean startsWith(String prefix) {
        TrieNode cur = root;                            @pStart
        for (char c : prefix.toCharArray()) {           @pLoop
            if (!cur.children.containsKey(c)) {         @pCheck
                return false;                           @pFail
            }
            cur = cur.children.get(c);                  @pMove
        }
        return true;                                    @pEnd
    }
}
`,
    cpp: `
class Trie {
    struct TrieNode {
        unordered_map<char, TrieNode*> children;
        bool endOfWord = false;
    };
    TrieNode* root;
public:
    Trie() {
        root = new TrieNode();                          @init
    }
    void insert(string word) {
        TrieNode* cur = root;                           @insStart
        for (char c : word) {                           @insLoop
            if (!cur->children.count(c)) {              @insCheck
                cur->children[c] = new TrieNode();      @insNew
            }
            cur = cur->children[c];                     @insMove
        }
        cur->endOfWord = true;                          @insEnd
    }
    bool search(string word) {
        TrieNode* cur = root;                           @sStart
        for (char c : word) {                           @sLoop
            if (!cur->children.count(c)) {              @sCheck
                return false;                           @sFail
            }
            cur = cur->children[c];                     @sMove
        }
        return cur->endOfWord;                          @sEnd
    }
    bool startsWith(string prefix) {
        TrieNode* cur = root;                           @pStart
        for (char c : prefix) {                         @pLoop
            if (!cur->children.count(c)) {              @pCheck
                return false;                           @pFail
            }
            cur = cur->children[c];                     @pMove
        }
        return true;                                    @pEnd
    }
};
`,
    distractors: [
      { java: '        return cur.children.isEmpty();', cpp: '        return cur->children.empty();' },
      { java: '            cur.children.put(c, new TrieNode());', cpp: '            cur->children[c] = new TrieNode();' },
      { java: '            cur = cur.children.getOrDefault(c, root);', cpp: '            cur = cur->children.count(c) ? cur->children[c] : root;' },
    ],
    gotchas: {
      java: ['For lowercase-only input, `TrieNode[] children = new TrieNode[26]` indexed by `c - \'a\'` is faster than a `HashMap<Character, TrieNode>` (no boxing).'],
      cpp: ['`cur->children[c]` on a missing key inserts a `nullptr` entry — test with `count` / `find` before indexing; nodes made with `new` are never freed here.'],
    },
  },

  'design-add-and-search-words-data-structure': {
    java: `
class WordDictionary {
    private class TrieNode {
        Map<Character, TrieNode> children = new HashMap<>();
        boolean endOfWord = false;
    }
    private TrieNode root;
    public WordDictionary() {
        root = new TrieNode();                                  @init
    }
    public void addWord(String word) {
        TrieNode cur = root;                                    @addStart
        for (char c : word.toCharArray()) {                     @addLoop
            if (!cur.children.containsKey(c)) {                 @addCheck
                cur.children.put(c, new TrieNode());            @addNew
            }
            cur = cur.children.get(c);                          @addMove
        }
        cur.endOfWord = true;                                   @addEnd
    }
    public boolean search(String word) {
        return dfs(word, 0, root);                              @search
    }
    private boolean dfs(String word, int j, TrieNode root) {
        TrieNode cur = root;                                    @dfs
        for (int i = j; i < word.length(); i++) {               @loop
            char c = word.charAt(i);
            if (c == '.') {                                     @dot
                for (TrieNode child : cur.children.values()) {  @branch
                    if (dfs(word, i + 1, child)) {              @recurse
                        return true;                            @found
                    }
                }
                return false;                                   @deadDot
            } else {
                if (!cur.children.containsKey(c)) {             @check
                    return false;                               @miss
                }
                cur = cur.children.get(c);                      @move
            }
        }
        return cur.endOfWord;                                   @end
    }
}
`,
    cpp: `
class WordDictionary {
    struct TrieNode {
        unordered_map<char, TrieNode*> children;
        bool endOfWord = false;
    };
    TrieNode* root;
    bool dfs(const string& word, int j, TrieNode* root) {
        TrieNode* cur = root;                                   @dfs
        for (int i = j; i < (int)word.size(); i++) {            @loop
            char c = word[i];
            if (c == '.') {                                     @dot
                for (auto& [ch, child] : cur->children) {       @branch
                    if (dfs(word, i + 1, child)) {              @recurse
                        return true;                            @found
                    }
                }
                return false;                                   @deadDot
            } else {
                if (!cur->children.count(c)) {                  @check
                    return false;                               @miss
                }
                cur = cur->children[c];                         @move
            }
        }
        return cur->endOfWord;                                  @end
    }
public:
    WordDictionary() {
        root = new TrieNode();                                  @init
    }
    void addWord(string word) {
        TrieNode* cur = root;                                   @addStart
        for (char c : word) {                                   @addLoop
            if (!cur->children.count(c)) {                      @addCheck
                cur->children[c] = new TrieNode();              @addNew
            }
            cur = cur->children[c];                             @addMove
        }
        cur->endOfWord = true;                                  @addEnd
    }
    bool search(string word) {
        return dfs(word, 0, root);                              @search
    }
};
`,
    distractors: [
      { java: '                    return dfs(word, i + 1, child);', cpp: '                    return dfs(word, i + 1, child);' },
      { java: '                    if (dfs(word, i, child)) {', cpp: '                    if (dfs(word, i, child)) {' },
      { java: '        return cur != null;', cpp: '        return cur != nullptr;' },
    ],
    gotchas: {
      python: ['The nested `dfs` closes over `word`; in Java / C++ it becomes a private method that takes `word` as a parameter.'],
      java: ['Compare characters with `c == \'.\'` (a `char` literal) — `"."` is a `String` and `==` on strings compares references.'],
      cpp: ['Pass `word` as `const string&` to the recursive helper — by value would copy the whole string on every call.'],
    },
  },

  'word-search-ii': {
    java: `
private class TrieNode {
    Map<Character, TrieNode> children = new HashMap<>();
    boolean isWord = false;
    void addWord(String word) {
        TrieNode cur = this;
        for (char c : word.toCharArray()) {
            cur = cur.children.computeIfAbsent(c, k -> new TrieNode());
        }
        cur.isWord = true;
    }
}
private int ROWS, COLS;
private Set<String> res = new HashSet<>();
private boolean[][] visit;
public List<String> findWords(char[][] board, String[] words) {
    TrieNode root = new TrieNode();                                     @init
    for (String w : words) {                                            @build
        root.addWord(w);                                                @add
    }
    ROWS = board.length; COLS = board[0].length;                        @setup
    visit = new boolean[ROWS][COLS];
    for (int r = 0; r < ROWS; r++) {                                    @rows
        for (int c = 0; c < COLS; c++) {                                @cell
            dfs(board, r, c, root, "");                                 @start
        }
    }
    return new ArrayList<>(res);                                        @done
}
private void dfs(char[][] board, int r, int c, TrieNode node, String word) {
    if (r < 0 || c < 0 || r == ROWS || c == COLS || visit[r][c]) return;   @bounds
    if (!node.children.containsKey(board[r][c])) return;                @prune
    visit[r][c] = true;                                                 @visit
    node = node.children.get(board[r][c]);                              @descend
    word += board[r][c];
    if (node.isWord) {                                                  @isWord
        res.add(word);                                                  @found
    }
    dfs(board, r + 1, c, node, word);                                   @dirs
    dfs(board, r - 1, c, node, word);
    dfs(board, r, c + 1, node, word);
    dfs(board, r, c - 1, node, word);
    visit[r][c] = false;                                                @unvisit
}
`,
    cpp: `
struct TrieNode {
    unordered_map<char, TrieNode*> children;
    bool isWord = false;
    void addWord(const string& word) {
        TrieNode* cur = this;
        for (char c : word) {
            if (!cur->children.count(c)) cur->children[c] = new TrieNode();
            cur = cur->children[c];
        }
        cur->isWord = true;
    }
};
int ROWS, COLS;
unordered_set<string> res;
vector<vector<bool>> visit;
vector<string> findWords(vector<vector<char>>& board, vector<string>& words) {
    TrieNode* root = new TrieNode();                                    @init
    for (const string& w : words) {                                     @build
        root->addWord(w);                                               @add
    }
    ROWS = board.size(); COLS = board[0].size();                        @setup
    visit.assign(ROWS, vector<bool>(COLS, false));
    for (int r = 0; r < ROWS; r++) {                                    @rows
        for (int c = 0; c < COLS; c++) {                                @cell
            dfs(board, r, c, root, "");                                 @start
        }
    }
    return vector<string>(res.begin(), res.end());                      @done
}
void dfs(vector<vector<char>>& board, int r, int c, TrieNode* node, string word) {
    if (r < 0 || c < 0 || r == ROWS || c == COLS || visit[r][c]) return;   @bounds
    if (!node->children.count(board[r][c])) return;                     @prune
    visit[r][c] = true;                                                 @visit
    node = node->children[board[r][c]];                                 @descend
    word += board[r][c];
    if (node->isWord) {                                                 @isWord
        res.insert(word);                                               @found
    }
    dfs(board, r + 1, c, node, word);                                   @dirs
    dfs(board, r - 1, c, node, word);
    dfs(board, r, c + 1, node, word);
    dfs(board, r, c - 1, node, word);
    visit[r][c] = false;                                                @unvisit
}
`,
    distractors: [
      { java: '    word = String.valueOf(board[r][c]);', cpp: '    word = board[r][c];' },
      {
        java: '    if (!Arrays.asList(words).contains(String.valueOf(board[r][c]))) return;',
        cpp: '    if (find(words.begin(), words.end(), string(1, board[r][c])) == words.end()) return;',
      },
      { java: 'private List<String> res = new ArrayList<>();', cpp: 'vector<string> res;' },
    ],
    gotchas: {
      python: ['Setting `node.isWord = False` after recording a word stops it being found twice and lets you prune exhausted branches.'],
      java: ['`word += board[r][c]` builds a new `String` each step (fine for ≤ 10-letter words); a shared `StringBuilder` must `deleteCharAt` on backtrack.'],
      cpp: ['`word` is passed BY VALUE so each call extends its own copy; a `string&` would need `pop_back()` after the four recursive calls.'],
    },
  },
};
