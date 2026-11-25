import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the trees problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'invert-binary-tree': {
    java: `
public TreeNode invertTree(TreeNode root) {
    if (root == null) {                       @base
        return null;                          @null
    }
    TreeNode tmp = root.left;                 @swap
    root.left = root.right;
    root.right = tmp;
    invertTree(root.left);                    @goLeft
    invertTree(root.right);                   @goRight
    return root;                              @ret
}
`,
    cpp: `
TreeNode* invertTree(TreeNode* root) {
    if (!root) {                              @base
        return nullptr;                       @null
    }
    swap(root->left, root->right);            @swap
    invertTree(root->left);                   @goLeft
    invertTree(root->right);                  @goRight
    return root;                              @ret
}
`,
    distractors: [
      { java: '    root.left = root.right;\n    root.right = root.left;', cpp: '    root->left = root->right;' },
      { java: '    return invertTree(root.left);', cpp: '    return invertTree(root->left);' },
      { java: '    if (root.left == null && root.right == null) {', cpp: '    if (!root->left && !root->right) {' },
    ],
    gotchas: {
      java: ['Java has no tuple assignment — save `root.left` in a temp before overwriting it, or the left subtree is lost.'],
      cpp: ['`swap(root->left, root->right)` swaps the two pointers in O(1); it does not copy the subtrees.'],
    },
  },

  'maximum-depth-of-binary-tree': {
    java: `
public int maxDepth(TreeNode root) {
    if (root == null) {                       @base
        return 0;                             @zero
    }
    int left = maxDepth(root.left);           @left
    int right = maxDepth(root.right);         @right
    return 1 + Math.max(left, right);         @ret
}
`,
    cpp: `
int maxDepth(TreeNode* root) {
    if (!root) {                              @base
        return 0;                             @zero
    }
    int left = maxDepth(root->left);          @left
    int right = maxDepth(root->right);        @right
    return 1 + max(left, right);              @ret
}
`,
    distractors: [
      { java: '        return 1;', cpp: '        return 1;' },
      { java: '    return 1 + left + right;', cpp: '    return 1 + left + right;' },
      { java: '    return Math.max(left, right);', cpp: '    return max(left, right);' },
    ],
    gotchas: {
      python: ['Recursion depth equals tree height; a skewed tree deeper than the default limit (1000) raises `RecursionError` — use an iterative BFS or `sys.setrecursionlimit`.'],
      java: ['Recursion depth equals tree height — a very deep skewed tree can throw `StackOverflowError`; a level-order BFS with `ArrayDeque` avoids it.'],
      cpp: ['Test `!root` before touching `root->left` — dereferencing `nullptr` is undefined behaviour, not a clean exception.'],
    },
  },

  'diameter-of-binary-tree': {
    java: `
private int res;

public int diameterOfBinaryTree(TreeNode root) {
    res = 0;                                  @init
    dfs(root);                                @call
    return res;                               @done
}

private int dfs(TreeNode node) {
    if (node == null) {                       @base
        return 0;                             @zero
    }
    int left = dfs(node.left);                @left
    int right = dfs(node.right);              @right
    res = Math.max(res, left + right);        @update
    return 1 + Math.max(left, right);         @ret
}
`,
    cpp: `
int res;

int diameterOfBinaryTree(TreeNode* root) {
    res = 0;                                  @init
    dfs(root);                                @call
    return res;                               @done
}

int dfs(TreeNode* node) {
    if (!node) {                              @base
        return 0;                             @zero
    }
    int left = dfs(node->left);               @left
    int right = dfs(node->right);             @right
    res = max(res, left + right);             @update
    return 1 + max(left, right);              @ret
}
`,
    distractors: [
      { java: '    return left + right;', cpp: '    return left + right;' },
      { java: '    res = Math.max(res, 1 + left + right);', cpp: '    res = max(res, 1 + left + right);' },
      { java: '    return dfs(root);', cpp: '    return dfs(root);' },
    ],
    gotchas: {
      python: ['`nonlocal res` is required — without it `res = max(...)` creates a new local and raises `UnboundLocalError`.'],
      java: ['Java lambdas cannot reassign captured locals, so the running best lives in a field `res` — reset it at the start of every call.'],
      cpp: ['`res` is a member, so reset it in `diameterOfBinaryTree`; a `function<int(TreeNode*)>` lambda capturing `[&]` is the closure-style alternative.'],
    },
  },

  'balanced-binary-tree': {
    java: `
public boolean isBalanced(TreeNode root) {
    return dfs(root)[0] == 1;                              @done
}

private int[] dfs(TreeNode node) {                         // {balanced ? 1 : 0, height}
    if (node == null) {                                    @base
        return new int[] { 1, 0 };                         @zero
    }
    int[] left = dfs(node.left);                           @left
    int[] right = dfs(node.right);                         @right
    boolean balanced = left[0] == 1 && right[0] == 1       @check
            && Math.abs(left[1] - right[1]) <= 1;
    return new int[] { balanced ? 1 : 0, 1 + Math.max(left[1], right[1]) };  @ret
}
`,
    cpp: `
bool isBalanced(TreeNode* root) {
    return dfs(root).first;                                @done
}

pair<bool, int> dfs(TreeNode* node) {                      // {balanced, height}
    if (!node) {                                           @base
        return {true, 0};                                  @zero
    }
    auto left = dfs(node->left);                           @left
    auto right = dfs(node->right);                         @right
    bool balanced = left.first && right.first &&           @check
            abs(left.second - right.second) <= 1;
    return {balanced, 1 + max(left.second, right.second)}; @ret
}
`,
    distractors: [
      { java: '    boolean balanced = Math.abs(left[1] - right[1]) <= 1;', cpp: '    bool balanced = abs(left.second - right.second) <= 1;' },
      { java: '    return new int[] { balanced ? 1 : 0, 1 + left[1] + right[1] };', cpp: '    return {balanced, 1 + left.second + right.second};' },
      { java: '    boolean balanced = Math.abs(left[1] - right[1]) < 1;', cpp: '    bool balanced = abs(left.second - right.second) < 1;' },
    ],
    gotchas: {
      java: ['Java has no tuples, so `dfs` returns `int[] { balanced ? 1 : 0, height }`; a common alternative returns height `-1` to mean "unbalanced".'],
      cpp: ['`pair<bool, int>` replaces the two-item list — read it with `.first` / `.second` or `auto [ok, h] = dfs(node->left);`.'],
    },
  },

  'same-tree': {
    java: `
public boolean isSameTree(TreeNode p, TreeNode q) {
    if (p == null && q == null) {                       @bothNull
        return true;                                    @true
    }
    if (p == null || q == null || p.val != q.val) {     @mismatch
        return false;                                   @false
    }
    return isSameTree(p.left, q.left) &&                @left
            isSameTree(p.right, q.right);               @right
}
`,
    cpp: `
bool isSameTree(TreeNode* p, TreeNode* q) {
    if (!p && !q) {                                     @bothNull
        return true;                                    @true
    }
    if (!p || !q || p->val != q->val) {                 @mismatch
        return false;                                   @false
    }
    return isSameTree(p->left, q->left) &&              @left
            isSameTree(p->right, q->right);             @right
}
`,
    distractors: [
      { java: '    if (p.val != q.val) {', cpp: '    if (p->val != q->val) {' },
      { java: '    return inorder(p).equals(inorder(q));', cpp: '    return inorder(p) == inorder(q);' },
      {
        java: '    return isSameTree(p.left, q.right) && isSameTree(p.right, q.left);',
        cpp: '    return isSameTree(p->left, q->right) && isSameTree(p->right, q->left);',
      },
    ],
    gotchas: {
      java: ['Compare `p.val != q.val`, not `p != q` — `!=` on two `TreeNode`s compares references, which differ for any two separate trees.'],
      cpp: ['The null checks must come first: `p->val` on a `nullptr` is undefined behaviour (often a segfault), not an exception.'],
    },
  },

  'subtree-of-another-tree': {
    java: `
public boolean isSubtree(TreeNode root, TreeNode subRoot) {
    if (root == null) {                                 @emptyRoot
        return false;
    }
    if (sameTree(root, subRoot)) {                      @try
        return true;                                    @found
    }
    return isSubtree(root.left, subRoot) ||             @left
            isSubtree(root.right, subRoot);             @right
}

private boolean sameTree(TreeNode p, TreeNode q) {
    if (p == null && q == null) {                       @sBoth
        return true;
    }
    if (p == null || q == null || p.val != q.val) {     @sDiff
        return false;
    }
    return sameTree(p.left, q.left) &&                  @sRec
            sameTree(p.right, q.right);
}
`,
    cpp: `
bool isSubtree(TreeNode* root, TreeNode* subRoot) {
    if (!root) {                                        @emptyRoot
        return false;
    }
    if (sameTree(root, subRoot)) {                      @try
        return true;                                    @found
    }
    return isSubtree(root->left, subRoot) ||            @left
            isSubtree(root->right, subRoot);            @right
}

bool sameTree(TreeNode* p, TreeNode* q) {
    if (!p && !q) {                                     @sBoth
        return true;
    }
    if (!p || !q || p->val != q->val) {                 @sDiff
        return false;
    }
    return sameTree(p->left, q->left) &&                @sRec
            sameTree(p->right, q->right);
}
`,
    distractors: [
      { java: '    if (root.val == subRoot.val) {', cpp: '    if (root->val == subRoot->val) {' },
      { java: '    return isSubtree(root.left, subRoot) && isSubtree(root.right, subRoot);', cpp: '    return isSubtree(root->left, subRoot) && isSubtree(root->right, subRoot);' },
      {
        java: '    return sameTree(root.left, subRoot.left) || sameTree(root.right, subRoot.right);',
        cpp: '    return sameTree(root->left, subRoot->left) || sameTree(root->right, subRoot->right);',
      },
    ],
    gotchas: {
      java: ['`root == subRoot` only checks that both variables point at the SAME object — structure and values need the recursive `sameTree`.'],
      cpp: ['Comparing `TreeNode*` with `==` compares addresses, not trees — use the recursive `sameTree` for structural equality.'],
    },
  },

  'lowest-common-ancestor-of-a-binary-search-tree': {
    java: `
public TreeNode lowestCommonAncestor(TreeNode root, TreeNode p, TreeNode q) {
    TreeNode cur = root;                                @init
    while (cur != null) {                               @loop
        if (p.val > cur.val && q.val > cur.val) {       @right
            cur = cur.right;                            @goRight
        } else if (p.val < cur.val && q.val < cur.val) { @left
            cur = cur.left;                             @goLeft
        } else {
            return cur;                                 @split
        }
    }
    return null;
}
`,
    cpp: `
TreeNode* lowestCommonAncestor(TreeNode* root, TreeNode* p, TreeNode* q) {
    TreeNode* cur = root;                               @init
    while (cur) {                                       @loop
        if (p->val > cur->val && q->val > cur->val) {   @right
            cur = cur->right;                           @goRight
        } else if (p->val < cur->val && q->val < cur->val) {  @left
            cur = cur->left;                            @goLeft
        } else {
            return cur;                                 @split
        }
    }
    return nullptr;
}
`,
    distractors: [
      { java: '        if (p.val > cur.val || q.val > cur.val) {', cpp: '        if (p->val > cur->val || q->val > cur->val) {' },
      { java: '        if (p.val >= cur.val && q.val >= cur.val) {', cpp: '        if (p->val >= cur->val && q->val >= cur->val) {' },
    ],
    gotchas: {
      java: ['javac demands a `return` after the `while` even though a split node is always found — the trailing `return null;` is unreachable in practice.'],
      cpp: ['Without the trailing `return nullptr;` flowing off the end of a non-void function is undefined behaviour (clang only warns).'],
    },
  },

  'binary-tree-level-order-traversal': {
    java: `
public List<List<Integer>> levelOrder(TreeNode root) {
    List<List<Integer>> res = new ArrayList<>();            @init
    Deque<TreeNode> q = new ArrayDeque<>();
    if (root != null) q.offer(root);                        @seed
    while (!q.isEmpty()) {                                  @loop
        List<Integer> level = new ArrayList<>();            @level
        for (int i = q.size(); i > 0; i--) {                @each
            TreeNode node = q.poll();                       @pop
            level.add(node.val);                            @take
            if (node.left != null) q.offer(node.left);      @pushL
            if (node.right != null) q.offer(node.right);    @pushR
        }
        res.add(level);                                     @save
    }
    return res;                                             @done
}
`,
    cpp: `
vector<vector<int>> levelOrder(TreeNode* root) {
    vector<vector<int>> res;                                @init
    queue<TreeNode*> q;
    if (root) q.push(root);                                 @seed
    while (!q.empty()) {                                    @loop
        vector<int> level;                                  @level
        for (int i = q.size(); i > 0; i--) {                @each
            TreeNode* node = q.front();                     @pop
            q.pop();
            level.push_back(node->val);                     @take
            if (node->left) q.push(node->left);             @pushL
            if (node->right) q.push(node->right);           @pushR
        }
        res.push_back(level);                               @save
    }
    return res;                                             @done
}
`,
    distractors: [
      { java: '            TreeNode node = q.pollLast();', cpp: '            TreeNode* node = q.back();' },
      { java: '        while (!q.isEmpty()) {', cpp: '        while (!q.empty()) {' },
      { java: '    q.offer(root);', cpp: '    q.push(root);' },
    ],
    gotchas: {
      java: [
        '`ArrayDeque` rejects `null` (`NullPointerException`) — check `node.left != null` before `offer`, and only seed a non-null root.',
        'Read `q.size()` once before the inner loop; `i < q.size()` re-reads it while children are being added.',
      ],
      cpp: [
        '`q.front()` reads the node and `q.pop()` removes it (returning `void`) — you need both calls.',
        'Read `q.size()` once before the inner loop; `i < q.size()` grows as children are pushed.',
      ],
    },
  },

  'binary-tree-right-side-view': {
    java: `
public List<Integer> rightSideView(TreeNode root) {
    List<Integer> res = new ArrayList<>();                  @init
    Deque<TreeNode> q = new ArrayDeque<>();
    if (root != null) q.offer(root);                        @seed
    while (!q.isEmpty()) {                                  @loop
        int size = q.size();                                @size
        for (int i = 0; i < size; i++) {                    @each
            TreeNode node = q.poll();                       @pop
            if (i == size - 1) {                            @last
                res.add(node.val);                          @take
            }
            if (node.left != null) q.offer(node.left);      @pushL
            if (node.right != null) q.offer(node.right);    @pushR
        }
    }
    return res;                                             @done
}
`,
    cpp: `
vector<int> rightSideView(TreeNode* root) {
    vector<int> res;                                        @init
    queue<TreeNode*> q;
    if (root) q.push(root);                                 @seed
    while (!q.empty()) {                                    @loop
        int size = q.size();                                @size
        for (int i = 0; i < size; i++) {                    @each
            TreeNode* node = q.front();                     @pop
            q.pop();
            if (i == size - 1) {                            @last
                res.push_back(node->val);                   @take
            }
            if (node->left) q.push(node->left);             @pushL
            if (node->right) q.push(node->right);           @pushR
        }
    }
    return res;                                             @done
}
`,
    distractors: [
      { java: '            if (i == 0) {', cpp: '            if (i == 0) {' },
      { java: '        node = node.right;', cpp: '        node = node->right;' },
    ],
    gotchas: {
      java: ['`ArrayDeque.offer(null)` throws — test `node.left != null` / `node.right != null` before enqueueing.'],
      cpp: ['Store `q.size()` in `size` before the loop — the queue grows as children are pushed, so `i < q.size()` would run into the next level.'],
    },
  },

  'count-good-nodes-in-binary-tree': {
    java: `
public int goodNodes(TreeNode root) {
    return dfs(root, root.val);                   @call
}

private int dfs(TreeNode node, int maxVal) {
    if (node == null) {                           @base
        return 0;                                 @zero
    }
    int res = node.val >= maxVal ? 1 : 0;         @check
    maxVal = Math.max(maxVal, node.val);          @max
    res += dfs(node.left, maxVal);                @left
    res += dfs(node.right, maxVal);               @right
    return res;                                   @ret
}
`,
    cpp: `
int goodNodes(TreeNode* root) {
    return dfs(root, root->val);                  @call
}

int dfs(TreeNode* node, int maxVal) {
    if (!node) {                                  @base
        return 0;                                 @zero
    }
    int res = node->val >= maxVal ? 1 : 0;        @check
    maxVal = max(maxVal, node->val);              @max
    res += dfs(node->left, maxVal);               @left
    res += dfs(node->right, maxVal);              @right
    return res;                                   @ret
}
`,
    distractors: [
      { java: '    int res = node.val > maxVal ? 1 : 0;', cpp: '    int res = node->val > maxVal ? 1 : 0;' },
      { java: '    maxVal = node.val;', cpp: '    maxVal = node->val;' },
    ],
    gotchas: {
      java: ['`maxVal` is an `int` parameter (passed by value), so raising it here only affects this subtree — siblings still see the parent\'s max.'],
      cpp: ['Take `maxVal` by value, not `int&` — a reference would leak the left subtree\'s max into the right subtree.'],
    },
  },

  'validate-binary-search-tree': {
    java: `
public boolean isValidBST(TreeNode root) {
    return valid(root, Long.MIN_VALUE, Long.MAX_VALUE);     @call
}

private boolean valid(TreeNode node, long low, long high) {
    if (node == null) {                                     @base
        return true;                                        @true
    }
    if (!(low < node.val && node.val < high)) {             @check
        return false;                                       @false
    }
    return valid(node.left, low, node.val) &&               @left
            valid(node.right, node.val, high);              @right
}
`,
    cpp: `
bool isValidBST(TreeNode* root) {
    return valid(root, LLONG_MIN, LLONG_MAX);               @call
}

bool valid(TreeNode* node, long long low, long long high) {
    if (!node) {                                            @base
        return true;                                        @true
    }
    if (!(low < node->val && node->val < high)) {           @check
        return false;                                       @false
    }
    return valid(node->left, low, node->val) &&             @left
            valid(node->right, node->val, high);            @right
}
`,
    distractors: [
      { java: '    if (node.left != null && node.left.val >= node.val) {', cpp: '    if (node->left && node->left->val >= node->val) {' },
      { java: '    return valid(node.left, low, high) &&', cpp: '    return valid(node->left, low, high) &&' },
      { java: '    if (!(low <= node.val && node.val <= high)) {', cpp: '    if (!(low <= node->val && node->val <= high)) {' },
    ],
    gotchas: {
      python: ['`low < node.val < high` is a chained comparison — Java and C++ need `low < node.val && node.val < high`.'],
      java: ['Node values can be `Integer.MIN_VALUE` / `MAX_VALUE`, so `int` sentinels would wrongly reject them — use `long` bounds (`Long.MIN_VALUE`) or nullable `Integer`.'],
      cpp: ['Node values can equal `INT_MIN` / `INT_MAX`, so use `long long` bounds with `LLONG_MIN` / `LLONG_MAX` (`long` is only 32-bit on Windows).'],
    },
  },

  'kth-smallest-element-in-a-bst': {
    java: `
public int kthSmallest(TreeNode root, int k) {
    Deque<TreeNode> stack = new ArrayDeque<>(); TreeNode cur = root; int n = 0;  @init
    while (cur != null || !stack.isEmpty()) {       @loop
        while (cur != null) {                       @dive
            stack.push(cur);                        @push
            cur = cur.left;                         @goLeft
        }
        cur = stack.pop();                          @pop
        n++;                                        @count
        if (n == k) {                               @check
            return cur.val;                         @found
        }
        cur = cur.right;                            @goRight
    }
    return -1;
}
`,
    cpp: `
int kthSmallest(TreeNode* root, int k) {
    vector<TreeNode*> stack; TreeNode* cur = root; int n = 0;  @init
    while (cur || !stack.empty()) {                 @loop
        while (cur) {                               @dive
            stack.push_back(cur);                   @push
            cur = cur->left;                        @goLeft
        }
        cur = stack.back();                         @pop
        stack.pop_back();
        n++;                                        @count
        if (n == k) {                               @check
            return cur->val;                        @found
        }
        cur = cur->right;                           @goRight
    }
    return -1;
}
`,
    distractors: [
      { java: '            cur = cur.right;', cpp: '            cur = cur->right;' },
      { java: '        cur = stack.pollLast();', cpp: '        cur = stack.front();' },
    ],
    gotchas: {
      java: ['Use `ArrayDeque` as the stack — `push`/`pop` work at the head; the legacy `Stack` class is synchronized and slower.'],
      cpp: ['`stack.back()` reads the top and `pop_back()` removes it (returning `void`) — a `vector` makes a perfectly good stack.'],
    },
  },

  'construct-binary-tree-from-preorder-and-inorder-traversal': {
    java: `
public TreeNode buildTree(int[] preorder, int[] inorder) {
    if (preorder.length == 0 || inorder.length == 0) {           @base
        return null;                                             @none
    }
    TreeNode root = new TreeNode(preorder[0]);                   @root
    int mid = 0;
    while (inorder[mid] != preorder[0]) mid++;                   @mid
    root.left = buildTree(Arrays.copyOfRange(preorder, 1, mid + 1),          @left
            Arrays.copyOfRange(inorder, 0, mid));
    root.right = buildTree(Arrays.copyOfRange(preorder, mid + 1, preorder.length),  @right
            Arrays.copyOfRange(inorder, mid + 1, inorder.length));
    return root;                                                 @ret
}
`,
    cpp: `
TreeNode* buildTree(vector<int> preorder, vector<int> inorder) {
    if (preorder.empty() || inorder.empty()) {                   @base
        return nullptr;                                          @none
    }
    TreeNode* root = new TreeNode(preorder[0]);                  @root
    int mid = find(inorder.begin(), inorder.end(), preorder[0]) - inorder.begin();  @mid
    root->left = buildTree({preorder.begin() + 1, preorder.begin() + mid + 1},     @left
            {inorder.begin(), inorder.begin() + mid});
    root->right = buildTree({preorder.begin() + mid + 1, preorder.end()},          @right
            {inorder.begin() + mid + 1, inorder.end()});
    return root;                                                 @ret
}
`,
    distractors: [
      {
        java: '    root.left = buildTree(Arrays.copyOfRange(preorder, 1, mid),',
        cpp: '    root->left = buildTree({preorder.begin() + 1, preorder.begin() + mid},',
      },
      { java: '    TreeNode root = new TreeNode(inorder[0]);', cpp: '    TreeNode* root = new TreeNode(inorder[0]);' },
      { java: '    while (preorder[mid] != inorder[0]) mid++;', cpp: '    int mid = find(preorder.begin(), preorder.end(), inorder[0]) - preorder.begin();' },
    ],
    gotchas: {
      python: ['Slices and `inorder.index` copy/scan, making this O(n²); the O(n) version stores value → inorder index in a dict and recurses on index bounds.'],
      java: ['`Arrays.copyOfRange(a, from, to)` excludes `to`, exactly like Python slices — and like them it copies, so this is O(n²).'],
      cpp: ['The vectors are taken by value so `{begin, end}` slices can be passed as temporaries — a `vector<int>&` parameter cannot bind to a temporary.'],
    },
  },

  'binary-tree-maximum-path-sum': {
    java: `
private int res;

public int maxPathSum(TreeNode root) {
    res = root.val;                                   @init
    dfs(root);                                        @call
    return res;                                       @done
}

private int dfs(TreeNode node) {
    if (node == null) {                               @base
        return 0;                                     @zero
    }
    int left = Math.max(dfs(node.left), 0);           @left
    int right = Math.max(dfs(node.right), 0);         @right
    res = Math.max(res, node.val + left + right);     @update
    return node.val + Math.max(left, right);          @ret
}
`,
    cpp: `
int res;

int maxPathSum(TreeNode* root) {
    res = root->val;                                  @init
    dfs(root);                                        @call
    return res;                                       @done
}

int dfs(TreeNode* node) {
    if (!node) {                                      @base
        return 0;                                     @zero
    }
    int left = max(dfs(node->left), 0);               @left
    int right = max(dfs(node->right), 0);             @right
    res = max(res, node->val + left + right);         @update
    return node->val + max(left, right);              @ret
}
`,
    distractors: [
      { java: '    return node.val + left + right;', cpp: '    return node->val + left + right;' },
      { java: '    int left = dfs(node.left);', cpp: '    int left = dfs(node->left);' },
      { java: '    res = 0;', cpp: '    res = 0;' },
    ],
    gotchas: {
      python: ['`nonlocal res` is needed to reassign the outer `res` from inside `dfs`.'],
      java: ['A Java lambda cannot reassign a captured local, so `res` is a field — set it in `maxPathSum` so repeated calls start fresh.'],
      cpp: ['`max(dfs(node->left), 0)` needs both arguments to be the same type — `max(x, 0L)` with an `int` fails to compile.'],
    },
  },

  'serialize-and-deserialize-binary-tree': {
    java: `
public class Codec {
    public String serialize(TreeNode root) {
        List<String> res = new ArrayList<>();                 @sInit
        dfs(root, res);
        return String.join(",", res);                         @sJoin
    }

    private void dfs(TreeNode node, List<String> res) {
        if (node == null) {
            res.add("N");                                     @sN
            return;
        }
        res.add(String.valueOf(node.val));                    @sVal
        dfs(node.left, res);                                  @sLeft
        dfs(node.right, res);                                 @sRight
    }

    private String[] vals;
    private int i;

    public TreeNode deserialize(String data) {
        vals = data.split(","); i = 0;                        @dInit
        return dfs();
    }

    private TreeNode dfs() {
        if (vals[i].equals("N")) {
            i++;                                              @dN
            return null;
        }
        TreeNode node = new TreeNode(Integer.parseInt(vals[i]));  @dVal
        i++;                                                  @dInc
        node.left = dfs();                                    @dLeft
        node.right = dfs();                                   @dRight
        return node;                                          @dRet
    }
}
`,
    cpp: `
class Codec {
public:
    string serialize(TreeNode* root) {
        vector<string> res;                                   @sInit
        dfs(root, res);
        string data;
        for (auto& s : res) data += (data.empty() ? "" : ",") + s;  @sJoin
        return data;
    }

    TreeNode* deserialize(string data) {
        vals.clear(); i = 0;
        stringstream ss(data);
        string tok;
        while (getline(ss, tok, ',')) vals.push_back(tok);    @dInit
        return dfs();
    }

private:
    vector<string> vals;
    int i = 0;

    void dfs(TreeNode* node, vector<string>& res) {
        if (!node) {
            res.push_back("N");                               @sN
            return;
        }
        res.push_back(to_string(node->val));                  @sVal
        dfs(node->left, res);                                 @sLeft
        dfs(node->right, res);                                @sRight
    }

    TreeNode* dfs() {
        if (vals[i] == "N") {
            i++;                                              @dN
            return nullptr;
        }
        TreeNode* node = new TreeNode(stoi(vals[i]));         @dVal
        i++;                                                  @dInc
        node->left = dfs();                                   @dLeft
        node->right = dfs();                                  @dRight
        return node;                                          @dRet
    }
};
`,
    distractors: [
      { java: '        if (node == null) return;', cpp: '        if (!node) return;' },
      { java: '        node.left = dfs(); i++;', cpp: '        node->left = dfs(); i++;' },
      { java: '        String[] vals = data.split(","); return dfs(vals);', cpp: '        vector<string> vals = split(data); return dfs(vals);' },
    ],
    gotchas: {
      python: ['`nonlocal i` lets every recursive `dfs()` advance the same position; without it `i += 1` raises `UnboundLocalError`.'],
      java: [
        'Compare tokens with `vals[i].equals("N")` — `==` compares String references.',
        'The shared position `i` is a field; a local `int` passed as a parameter would be copied and each call would restart.',
      ],
      cpp: ['C++ has no `split` — `getline(ss, tok, \',\')` on a `stringstream` tokenises, and `stoi` handles negative values.'],
    },
  },
};
