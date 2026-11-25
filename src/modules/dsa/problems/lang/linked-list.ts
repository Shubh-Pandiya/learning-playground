import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the linked-list problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'reverse-linked-list': {
    java: `
public ListNode reverseList(ListNode head) {
    ListNode prev = null, curr = head;       @init
    while (curr != null) {                   @loop
        ListNode nxt = curr.next;            @save
        curr.next = prev;                    @flip
        prev = curr;                         @advPrev
        curr = nxt;                          @advCurr
    }
    return prev;                             @done
}
`,
    cpp: `
ListNode* reverseList(ListNode* head) {
    ListNode *prev = nullptr, *curr = head;  @init
    while (curr) {                           @loop
        ListNode* nxt = curr->next;          @save
        curr->next = prev;                   @flip
        prev = curr;                         @advPrev
        curr = nxt;                          @advCurr
    }
    return prev;                             @done
}
`,
    distractors: [
      { java: '        curr = curr.next;', cpp: '        curr = curr->next;' },
      { java: '    while (curr.next != null) {', cpp: '    while (curr->next) {' },
      { java: '    return curr;', cpp: '    return curr;' },
    ],
    gotchas: {
      java: ['Java has no truthiness for objects — write `while (curr != null)`, not `while (curr)`.'],
      cpp: ['In `ListNode *prev = nullptr, *curr = head;` each name needs its own `*` — `ListNode* prev, curr;` makes `curr` a plain `ListNode`, not a pointer.'],
    },
  },

  'merge-two-sorted-lists': {
    java: `
public ListNode mergeTwoLists(ListNode l1, ListNode l2) {
    ListNode dummy = new ListNode(), tail = dummy;    @init
    while (l1 != null && l2 != null) {                @loop
        if (l1.val <= l2.val) {                       @cmp
            tail.next = l1;                           @take1
            l1 = l1.next;                             @adv1
        } else {
            tail.next = l2;                           @take2
            l2 = l2.next;                             @adv2
        }
        tail = tail.next;                             @tail
    }
    tail.next = l1 != null ? l1 : l2;                 @rest
    return dummy.next;                                @done
}
`,
    cpp: `
ListNode* mergeTwoLists(ListNode* l1, ListNode* l2) {
    ListNode dummy; ListNode* tail = &dummy;          @init
    while (l1 && l2) {                                @loop
        if (l1->val <= l2->val) {                     @cmp
            tail->next = l1;                          @take1
            l1 = l1->next;                            @adv1
        } else {
            tail->next = l2;                          @take2
            l2 = l2->next;                            @adv2
        }
        tail = tail->next;                            @tail
    }
    tail->next = l1 ? l1 : l2;                        @rest
    return dummy.next;                                @done
}
`,
    distractors: [
      { java: '    while (l1 != null || l2 != null) {', cpp: '    while (l1 || l2) {' },
      { java: '    return dummy;', cpp: '    return &dummy;' },
      { java: '            l1.next = l2;', cpp: '            l1->next = l2;' },
    ],
    gotchas: {
      python: ['`tail.next = l1 or l2` works because `None` is falsy — it picks whichever list is non-empty.'],
      java: ['Java has no `or` on objects — the leftover is `l1 != null ? l1 : l2`.'],
      cpp: ['A stack `ListNode dummy;` needs no `delete`, but never return `&dummy` — it dies with the function; return `dummy.next`.'],
    },
  },

  'reorder-list': {
    java: `
public void reorderList(ListNode head) {
    ListNode slow = head, fast = head.next;               @init
    while (fast != null && fast.next != null) {           @findMid
        slow = slow.next; fast = fast.next.next;          @stepMid
    }
    ListNode second = slow.next;                          @split
    ListNode prev = slow.next = null;                     @cut
    while (second != null) {                              @revLoop
        ListNode tmp = second.next;                       @revSave
        second.next = prev;                               @revFlip
        prev = second; second = tmp;                      @revAdv
    }
    ListNode first = head; second = prev;                 @mergeInit
    while (second != null) {                              @mergeLoop
        ListNode tmp1 = first.next, tmp2 = second.next;   @mergeSave
        first.next = second;                              @link1
        second.next = tmp1;                               @link2
        first = tmp1; second = tmp2;                      @mergeAdv
    }
}
`,
    cpp: `
void reorderList(ListNode* head) {
    ListNode *slow = head, *fast = head->next;            @init
    while (fast && fast->next) {                          @findMid
        slow = slow->next; fast = fast->next->next;       @stepMid
    }
    ListNode* second = slow->next;                        @split
    ListNode* prev = slow->next = nullptr;                @cut
    while (second) {                                      @revLoop
        ListNode* tmp = second->next;                     @revSave
        second->next = prev;                              @revFlip
        prev = second; second = tmp;                      @revAdv
    }
    ListNode* first = head; second = prev;                @mergeInit
    while (second) {                                      @mergeLoop
        ListNode *tmp1 = first->next, *tmp2 = second->next;   @mergeSave
        first->next = second;                             @link1
        second->next = tmp1;                              @link2
        first = tmp1; second = tmp2;                      @mergeAdv
    }
}
`,
    distractors: [
      { java: '    ListNode slow = head, fast = head;', cpp: '    ListNode *slow = head, *fast = head;' },
      { java: '    ListNode second = slow;', cpp: '    ListNode* second = slow;' },
      { java: '    while (first != null) {', cpp: '    while (first) {' },
    ],
    gotchas: {
      python: ['Tuple assignment like `prev, second = second, tmp` evaluates the whole right side first — when translating to sequential statements, never overwrite a variable before it is read.'],
      java: ['`ListNode prev = slow.next = null;` assigns right-to-left — it cuts the list AND starts `prev` at `null` in one statement.'],
      cpp: ['Declare each pointer with its own `*` — `ListNode *tmp1 = …, *tmp2 = …;`.'],
    },
  },

  'remove-nth-node-from-end-of-list': {
    java: `
public ListNode removeNthFromEnd(ListNode head, int n) {
    ListNode dummy = new ListNode(0, head);           @init
    ListNode left = dummy, right = head;              @ptrs
    while (n > 0) {                                   @gapLoop
        right = right.next;                           @gap
        n--;                                          @dec
    }
    while (right != null) {                           @slide
        left = left.next; right = right.next;         @move
    }
    left.next = left.next.next;                       @unlink
    return dummy.next;                                @done
}
`,
    cpp: `
ListNode* removeNthFromEnd(ListNode* head, int n) {
    ListNode dummy(0, head);                          @init
    ListNode *left = &dummy, *right = head;           @ptrs
    while (n > 0) {                                   @gapLoop
        right = right->next;                          @gap
        n--;                                          @dec
    }
    while (right) {                                   @slide
        left = left->next; right = right->next;       @move
    }
    left->next = left->next->next;                    @unlink
    return dummy.next;                                @done
}
`,
    distractors: [
      { java: '    ListNode left = head, right = head;', cpp: '    ListNode *left = head, *right = head;' },
      { java: '    while (right.next != null) {', cpp: '    while (right->next) {' },
      { java: '    left.next = right;', cpp: '    left->next = right;' },
    ],
    gotchas: {
      java: ['The unlinked node is simply dropped — the garbage collector frees it once nothing points to it.'],
      cpp: ['Unlinking leaks the removed node; in real code save `ListNode* victim = left->next;` and `delete victim;` after relinking.'],
    },
  },

  'copy-list-with-random-pointer': {
    java: `
public Node copyRandomList(Node head) {
    Map<Node, Node> oldToCopy = new HashMap<>(); oldToCopy.put(null, null);   @init
    Node cur = head;                                    @start1
    while (cur != null) {                               @pass1
        oldToCopy.put(cur, new Node(cur.val));          @clone
        cur = cur.next;                                 @adv1
    }
    cur = head;                                         @start2
    while (cur != null) {                               @pass2
        Node copy = oldToCopy.get(cur);                 @get
        copy.next = oldToCopy.get(cur.next);            @wireNext
        copy.random = oldToCopy.get(cur.random);        @wireRandom
        cur = cur.next;                                 @adv2
    }
    return oldToCopy.get(head);                         @done
}
`,
    cpp: `
Node* copyRandomList(Node* head) {
    unordered_map<Node*, Node*> oldToCopy = {{nullptr, nullptr}};   @init
    Node* cur = head;                                   @start1
    while (cur) {                                       @pass1
        oldToCopy[cur] = new Node(cur->val);            @clone
        cur = cur->next;                                @adv1
    }
    cur = head;                                         @start2
    while (cur) {                                       @pass2
        Node* copy = oldToCopy.at(cur);                 @get
        copy->next = oldToCopy.at(cur->next);           @wireNext
        copy->random = oldToCopy.at(cur->random);       @wireRandom
        cur = cur->next;                                @adv2
    }
    return oldToCopy.at(head);                          @done
}
`,
    distractors: [
      { java: '        copy.random = cur.random;', cpp: '        copy->random = cur->random;' },
      { java: '        copy.random = new Node(cur.random.val);', cpp: '        copy->random = new Node(cur->random->val);' },
      { java: '    Map<Node, Node> oldToCopy = new HashMap<>();', cpp: '    unordered_map<Node*, Node*> oldToCopy;' },
    ],
    gotchas: {
      java: ['`HashMap` allows a `null` key and `get` returns `null` for a missing key, so the `null → null` entry only makes the intent explicit — `TreeMap` or `Map.of` would throw on `null`.'],
      cpp: ['`.at(key)` throws `out_of_range` on a missing key (like Python\'s `KeyError`), while `oldToCopy[key]` would silently insert `nullptr` and hide the bug.'],
    },
  },

  'add-two-numbers': {
    java: `
public ListNode addTwoNumbers(ListNode l1, ListNode l2) {
    ListNode dummy = new ListNode(), cur = dummy;         @init
    int carry = 0;                                        @carry0
    while (l1 != null || l2 != null || carry != 0) {      @loop
        int v1 = l1 != null ? l1.val : 0;                 @v1
        int v2 = l2 != null ? l2.val : 0;                 @v2
        int total = v1 + v2 + carry;                      @sum
        carry = total / 10;
        int digit = total % 10;
        cur.next = new ListNode(digit);                   @append
        cur = cur.next;                                   @advCur
        l1 = l1 != null ? l1.next : null;                 @adv1
        l2 = l2 != null ? l2.next : null;                 @adv2
    }
    return dummy.next;                                    @done
}
`,
    cpp: `
ListNode* addTwoNumbers(ListNode* l1, ListNode* l2) {
    ListNode dummy; ListNode* cur = &dummy;               @init
    int carry = 0;                                        @carry0
    while (l1 || l2 || carry) {                           @loop
        int v1 = l1 ? l1->val : 0;                        @v1
        int v2 = l2 ? l2->val : 0;                        @v2
        int total = v1 + v2 + carry;                      @sum
        carry = total / 10;
        int digit = total % 10;
        cur->next = new ListNode(digit);                  @append
        cur = cur->next;                                  @advCur
        l1 = l1 ? l1->next : nullptr;                     @adv1
        l2 = l2 ? l2->next : nullptr;                     @adv2
    }
    return dummy.next;                                    @done
}
`,
    distractors: [
      { java: '    while (l1 != null && l2 != null) {', cpp: '    while (l1 && l2) {' },
      { java: '        cur.next = new ListNode(total);', cpp: '        cur->next = new ListNode(total);' },
      { java: '        carry = (v1 + v2) / 10;', cpp: '        carry = (v1 + v2) / 10;' },
    ],
    gotchas: {
      python: ['`divmod(x, 10)` returns `(x // 10, x % 10)` in one call.'],
      java: ['`/` on two `int`s already truncates, so `total / 10` is the carry and `total % 10` the digit — no `Math.floor` needed for non-negative sums.'],
      cpp: ['`while (l1 || l2 || carry)` relies on pointers and ints converting to `bool`; the stack `dummy` is never returned, only `dummy.next`.'],
    },
  },

  'linked-list-cycle': {
    java: `
public boolean hasCycle(ListNode head) {
    ListNode slow = head, fast = head;            @init
    while (fast != null && fast.next != null) {   @loop
        slow = slow.next;                         @slow
        fast = fast.next.next;                    @fast
        if (slow == fast) {                       @meet
            return true;                          @yes
        }
    }
    return false;                                 @no
}
`,
    cpp: `
bool hasCycle(ListNode* head) {
    ListNode *slow = head, *fast = head;          @init
    while (fast && fast->next) {                  @loop
        slow = slow->next;                        @slow
        fast = fast->next->next;                  @fast
        if (slow == fast) {                       @meet
            return true;                          @yes
        }
    }
    return false;                                 @no
}
`,
    distractors: [
      { java: '        if (slow.val == fast.val) {', cpp: '        if (slow->val == fast->val) {' },
      { java: '    while (fast.next.next != null) {', cpp: '    while (fast->next->next) {' },
      { java: '        fast = fast.next;', cpp: '        fast = fast->next;' },
    ],
    gotchas: {
      java: ['`slow == fast` compares references (same node), which is exactly what cycle detection needs — `.equals` or `.val` would not.'],
      cpp: ['`slow == fast` compares addresses; the `&&` in `fast && fast->next` short-circuits so `fast->next` is never read through a null pointer.'],
    },
  },

  'find-the-duplicate-number': {
    java: `
public int findDuplicate(int[] nums) {
    int slow = 0, fast = 0;                  @init
    while (true) {                           @loop1
        slow = nums[slow];                   @s1
        fast = nums[nums[fast]];             @f1
        if (slow == fast) {                  @meet
            break;
        }
    }
    int slow2 = 0;                           @phase2
    while (true) {                           @loop2
        slow = nums[slow];                   @s2
        slow2 = nums[slow2];                 @s22
        if (slow == slow2) {                 @check
            return slow;                     @done
        }
    }
}
`,
    cpp: `
int findDuplicate(vector<int>& nums) {
    int slow = 0, fast = 0;                  @init
    while (true) {                           @loop1
        slow = nums[slow];                   @s1
        fast = nums[nums[fast]];             @f1
        if (slow == fast) {                  @meet
            break;
        }
    }
    int slow2 = 0;                           @phase2
    while (true) {                           @loop2
        slow = nums[slow];                   @s2
        slow2 = nums[slow2];                 @s22
        if (slow == slow2) {                 @check
            return slow;                     @done
        }
    }
}
`,
    distractors: [
      { java: '            return slow;', cpp: '            return slow;' },
      { java: '        fast = nums[fast];', cpp: '        fast = nums[fast];' },
      { java: '    int slow2 = nums[0];', cpp: '    int slow2 = nums[0];' },
    ],
    gotchas: {
      java: ['A method whose only exit is inside `while (true)` compiles without a trailing `return` — javac knows the loop never falls through.'],
      cpp: ['Without a trailing `return`, compilers may warn "control reaches end of non-void function"; it is safe here because the duplicate always exists.'],
    },
  },

  'lru-cache': {
    java: `
class LRUCache {
    private class DNode {
        int key, val;
        DNode prev, next;
        DNode(int key, int val) { this.key = key; this.val = val; }
    }
    private int cap;
    private Map<Integer, DNode> cache;
    private DNode left, right;
    public LRUCache(int capacity) {
        cap = capacity; cache = new HashMap<>();                 @init
        left = new DNode(0, 0); right = new DNode(0, 0);
        left.next = right; right.prev = left;
    }
    private void remove(DNode node) {
        node.prev.next = node.next; node.next.prev = node.prev;  @remove
    }
    private void insert(DNode node) {
        DNode prev = right.prev, nxt = right;
        prev.next = nxt.prev = node;                             @insert
        node.next = nxt; node.prev = prev;
    }
    public int get(int key) {
        if (cache.containsKey(key)) {                            @get
            remove(cache.get(key));                              @getRemove
            insert(cache.get(key));                              @getInsert
            return cache.get(key).val;                           @getHit
        }
        return -1;                                               @getMiss
    }
    public void put(int key, int value) {
        if (cache.containsKey(key)) {                            @put
            remove(cache.get(key));                              @putRemove
        }
        cache.put(key, new DNode(key, value));                   @putNew
        insert(cache.get(key));                                  @putInsert
        if (cache.size() > cap) {                                @overCap
            DNode lru = left.next;                               @lru
            remove(lru);                                         @evict
            cache.remove(lru.key);                               @evictDel
        }
    }
}
`,
    cpp: `
class LRUCache {
    struct DNode {
        int key, val;
        DNode *prev = nullptr, *next = nullptr;
        DNode(int k, int v) : key(k), val(v) {}
    };
    int cap;
    unordered_map<int, DNode*> cache;
    DNode *left, *right;
    void remove(DNode* node) {
        node->prev->next = node->next; node->next->prev = node->prev;   @remove
    }
    void insert(DNode* node) {
        DNode *prev = right->prev, *nxt = right;
        prev->next = nxt->prev = node;                           @insert
        node->next = nxt; node->prev = prev;
    }
public:
    LRUCache(int capacity) {
        cap = capacity;                                          @init
        left = new DNode(0, 0); right = new DNode(0, 0);
        left->next = right; right->prev = left;
    }
    int get(int key) {
        if (cache.count(key)) {                                  @get
            remove(cache[key]);                                  @getRemove
            insert(cache[key]);                                  @getInsert
            return cache[key]->val;                              @getHit
        }
        return -1;                                               @getMiss
    }
    void put(int key, int value) {
        if (cache.count(key)) {                                  @put
            remove(cache[key]);                                  @putRemove
            delete cache[key];
        }
        cache[key] = new DNode(key, value);                      @putNew
        insert(cache[key]);                                      @putInsert
        if ((int)cache.size() > cap) {                           @overCap
            DNode* lru = left->next;                             @lru
            remove(lru);                                         @evict
            cache.erase(lru->key);                               @evictDel
            delete lru;
        }
    }
};
`,
    distractors: [
      { java: '            DNode lru = right.prev;', cpp: '            DNode* lru = right->prev;' },
      { java: '            return cache.get(key).val;', cpp: '            return cache[key]->val;' },
      { java: '        if (cache.size() >= cap) {', cpp: '        if ((int)cache.size() >= cap) {' },
    ],
    gotchas: {
      python: ['`collections.OrderedDict` with `move_to_end(key)` and `popitem(last=False)` is the built-in shortcut.'],
      java: ['`new LinkedHashMap<>(cap, 0.75f, true)` (access order) plus an overridden `removeEldestEntry` is a ready-made LRU — interviews usually want the hand-rolled list.'],
      cpp: ['Raw `DNode*` nodes must be `delete`d when evicted or replaced; `list<pair<int, int>>` + `unordered_map<int, list<pair<int, int>>::iterator>` with `splice` is the STL alternative.'],
    },
  },

  'merge-k-sorted-lists': {
    java: `
public ListNode mergeKLists(ListNode[] lists) {
    if (lists.length == 0) return null;                          @empty
    while (lists.length > 1) {                                   @round
        List<ListNode> merged = new ArrayList<>();               @newRound
        for (int i = 0; i < lists.length; i += 2) {              @pair
            ListNode l1 = lists[i], l2 = i + 1 < lists.length ? lists[i + 1] : null;   @pick
            merged.add(mergeList(l1, l2));                       @merge
        }
        lists = merged.toArray(new ListNode[0]);                 @swap
    }
    return lists[0];                                             @done
}
private ListNode mergeList(ListNode l1, ListNode l2) {
    ListNode dummy = new ListNode(), tail = dummy;               @mInit
    while (l1 != null && l2 != null) {                           @mLoop
        if (l1.val < l2.val) {                                   @mCmp
            tail.next = l1; l1 = l1.next;                        @mTake1
        } else {
            tail.next = l2; l2 = l2.next;                        @mTake2
        }
        tail = tail.next;                                        @mTail
    }
    tail.next = l1 != null ? l1 : l2;                            @mRest
    return dummy.next;                                           @mDone
}
`,
    cpp: `
ListNode* mergeKLists(vector<ListNode*>& lists) {
    if (lists.empty()) return nullptr;                           @empty
    while ((int)lists.size() > 1) {                              @round
        vector<ListNode*> merged;                                @newRound
        for (int i = 0; i < (int)lists.size(); i += 2) {         @pair
            ListNode *l1 = lists[i], *l2 = i + 1 < (int)lists.size() ? lists[i + 1] : nullptr;   @pick
            merged.push_back(mergeList(l1, l2));                 @merge
        }
        lists = move(merged);                                    @swap
    }
    return lists[0];                                             @done
}
ListNode* mergeList(ListNode* l1, ListNode* l2) {
    ListNode dummy; ListNode* tail = &dummy;                     @mInit
    while (l1 && l2) {                                           @mLoop
        if (l1->val < l2->val) {                                 @mCmp
            tail->next = l1; l1 = l1->next;                      @mTake1
        } else {
            tail->next = l2; l2 = l2->next;                      @mTake2
        }
        tail = tail->next;                                       @mTail
    }
    tail->next = l1 ? l1 : l2;                                   @mRest
    return dummy.next;                                           @mDone
}
`,
    distractors: [
      { java: '        res = mergeList(res, lists[i]);', cpp: '        res = mergeList(res, lists[i]);' },
      { java: '    while (lists.length > 0) {', cpp: '    while (!lists.empty()) {' },
      { java: '        for (int i = 0; i < lists.length - 1; i++) {', cpp: '        for (int i = 0; i < (int)lists.size() - 1; i++) {' },
    ],
    gotchas: {
      python: ['The heap alternative must push `(node.val, i, node)` — the index breaks ties because `ListNode`s are not comparable.'],
      java: ['The heap alternative needs a comparator — `new PriorityQueue<ListNode>((a, b) -> Integer.compare(a.val, b.val))` — since `ListNode` is not `Comparable`.'],
      cpp: ['The heap alternative needs a comparator on `->val` that returns `a->val > b->val` (min-heap); the default `priority_queue` is a MAX-heap and would otherwise compare pointer addresses.'],
    },
  },

  'reverse-nodes-in-k-group': {
    java: `
public ListNode reverseKGroup(ListNode head, int k) {
    ListNode dummy = new ListNode(0, head), groupPrev = dummy;   @init
    while (true) {                                               @loop
        ListNode kth = getKth(groupPrev, k);                     @kth
        if (kth == null) break;                                  @stop
        ListNode groupNext = kth.next;                           @gnext
        ListNode prev = kth.next, curr = groupPrev.next;         @rinit
        while (curr != groupNext) {                              @rloop
            ListNode tmp = curr.next;                            @rsave
            curr.next = prev;                                    @rflip
            prev = curr; curr = tmp;                             @radv
        }
        ListNode tmp = groupPrev.next;                           @fix
        groupPrev.next = kth;                                    @attach
        groupPrev = tmp;                                         @move
    }
    return dummy.next;                                           @done
}
private ListNode getKth(ListNode curr, int k) {
    while (curr != null && k > 0) {
        curr = curr.next; k--;
    }
    return curr;
}
`,
    cpp: `
ListNode* reverseKGroup(ListNode* head, int k) {
    ListNode dummy(0, head); ListNode* groupPrev = &dummy;       @init
    while (true) {                                               @loop
        ListNode* kth = getKth(groupPrev, k);                    @kth
        if (!kth) break;                                         @stop
        ListNode* groupNext = kth->next;                         @gnext
        ListNode *prev = kth->next, *curr = groupPrev->next;     @rinit
        while (curr != groupNext) {                              @rloop
            ListNode* tmp = curr->next;                          @rsave
            curr->next = prev;                                   @rflip
            prev = curr; curr = tmp;                             @radv
        }
        ListNode* tmp = groupPrev->next;                         @fix
        groupPrev->next = kth;                                   @attach
        groupPrev = tmp;                                         @move
    }
    return dummy.next;                                           @done
}
ListNode* getKth(ListNode* curr, int k) {
    while (curr && k > 0) {
        curr = curr->next; k--;
    }
    return curr;
}
`,
    distractors: [
      { java: '        ListNode prev = null, curr = groupPrev.next;', cpp: '        ListNode *prev = nullptr, *curr = groupPrev->next;' },
      { java: '        groupPrev = kth;', cpp: '        groupPrev = kth;' },
      { java: '        while (curr != null) {', cpp: '        while (curr) {' },
    ],
    gotchas: {
      java: ['`curr != groupNext` compares node references — exactly the "stop at the next group" boundary, even when values repeat.'],
      cpp: ['`ListNode dummy(0, head);` lives on the stack, so return `dummy.next`, never `&dummy`.'],
    },
  },
};
