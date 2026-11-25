import type { Problem, Tone, Variant } from '../engine/types.ts';
import { ListNode, V, buildList, listValues, tones } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Linked List — pointer rewiring, dummy heads, fast/slow runners, design (LRU).
// ---------------------------------------------------------------------------

type LN = ListNode<number>;

/** Nodes reachable from each head in turn (deduplicated, stops on cycles) — a stable draw order. */
function chain<T>(...heads: (ListNode<T> | null | undefined)[]): ListNode<T>[] {
  const out: ListNode<T>[] = [];
  const seen = new Set<ListNode<T>>();
  for (const h of heads) {
    for (let n = h ?? null; n && !seen.has(n); n = n.next) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

const ids = (ns: readonly (ListNode<any> | null | undefined)[]) => ns.filter((n): n is ListNode<any> => !!n).map((n) => n.id);
const one = (n: ListNode<any> | null | undefined, tone: Tone): Record<string, Tone> => (n ? { [n.id]: tone } : {});
const isNumList = (a: unknown, max: number) => Array.isArray(a) && a.length <= max && a.every((x) => typeof x === 'number');
const valOf = (n: ListNode<any> | null | undefined) => (n ? String(n.val) : 'None');

const reverseList: Problem<{ values: number[] }> = {
  id: 'reverse-linked-list',
  num: 206,
  title: 'Reverse Linked List',
  difficulty: 'Easy',
  category: 'linked-list',
  pattern: 'linked-list',
  statement: 'Given the head of a singly linked list, flip the direction of every link and return the new head (the old tail).',
  signals: ['"reverse the list"', 'singly linked — no way to walk backwards', 'O(1) extra space expected', 'every .next must change'],
  insight:
    'Walk the list once with three pointers: prev (already reversed part), curr (node being flipped) and nxt (the saved rest). Point curr back at prev, then slide all three one step forward.',
  hints: [
    'If you set curr.next = prev immediately, how do you reach the rest of the list?',
    'Save curr.next in a temp variable before you overwrite it.',
    'When curr falls off the end, prev is sitting on the old tail — the new head.',
  ],
  pitfall: 'Overwriting curr.next before saving it — the remainder of the list is lost and the loop stops after one node.',
  backend: {
    title: 'Undo log replay in a database / editor',
    detail:
      'A write-ahead log is appended as a singly linked chain of records (each record points at the next). To roll back a transaction you need to replay the records newest-first; reversing the chain in place gives that order with O(1) extra memory instead of copying the log into a stack.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def reverseList(head):
    prev, curr = None, head          @init
    while curr:                      @loop
        nxt = curr.next              @save
        curr.next = prev             @flip
        prev = curr                  @advPrev
        curr = nxt                   @advCurr
    return prev                      @done
`,
  explain: {
    init: 'prev is the head of the reversed part (empty, so None); curr is the next node to flip.',
    save: 'Remember the rest of the list BEFORE breaking the link to it.',
    flip: 'The actual reversal: this node now points backwards.',
    advPrev: 'The flipped node becomes the head of the reversed part.',
    advCurr: 'Continue with the saved remainder.',
    done: 'curr is None, so prev is the old tail = new head.',
  },
  distractors: [
    { text: '        curr = curr.next', why: 'After the flip, curr.next is prev — this walks backwards (or stops). Advance to the saved nxt instead.' },
    { text: '    while curr.next:', why: 'Stops before flipping the last node, so the old tail never points back and the list is cut off.' },
    { text: '    return curr', why: 'When the loop ends curr is None; the new head is prev.' },
  ],
  input: { values: [1, 2, 3, 4, 5] },
  presets: [
    { label: 'two nodes', input: { values: [1, 2] } },
    { label: 'empty list', input: { values: [] } },
  ],
  validate: ({ values }) => (!isNumList(values, 10) ? 'Expected { values: number[] } with ≤ 10 numbers' : null),
  trace(t, { values }) {
    const { head, nodes } = buildList(values);
    let prev: LN | null = null;
    let curr: LN | null = head;
    let nxt: LN | null = null;
    const flipped = new Set<string>();
    t.draw(() => [
      V.list('list', nodes, {
        pointers: { prev, curr, nxt },
        tones: { ...tones([...flipped], 'good'), ...one(curr, 'active') },
        caption: 'green = already reversed',
      }),
    ]);
    t.step('init', 'prev = None (the reversed part is empty) and curr = head. Nodes stay in place; only arrows change.', { prev: valOf(prev), curr: valOf(curr) });
    let it = 0;
    while (curr) {
      t.step('loop', `curr is node ${curr.val}, so there is still a link to flip.`, { prev: valOf(prev), curr: valOf(curr) });
      nxt = curr.next;
      t.step('save', `Save nxt = ${valOf(nxt)} — once we flip ${curr.val}'s arrow, this is our only way to reach the rest.`, { prev: valOf(prev), curr: valOf(curr), nxt: valOf(nxt) });
      if (it === 0) t.predict(`After curr.next = prev, where does node ${curr.val} point?`, ['None', String(valOf(nxt))], 0, 'prev is None on the first iteration, so the old head becomes the new tail.');
      curr.next = prev;
      flipped.add(curr.id);
      t.step('flip', `Flip: ${curr.val} now points back to ${valOf(prev)}.`, { prev: valOf(prev), curr: valOf(curr), nxt: valOf(nxt) });
      prev = curr;
      t.step('advPrev', `prev moves to ${prev.val}: it is now the head of the reversed part.`, { prev: valOf(prev), curr: valOf(curr), nxt: valOf(nxt) });
      curr = nxt;
      t.step('advCurr', `curr jumps to the saved node ${valOf(curr)}.`, { prev: valOf(prev), curr: valOf(curr), nxt: valOf(nxt) });
      it++;
    }
    nxt = null;
    t.step('loop', 'curr is None — every arrow has been flipped.', { prev: valOf(prev), curr: 'None' });
    t.predict('Which pointer now holds the new head?', ['prev', 'curr', 'nxt'], 0, 'curr ran off the end; prev stopped on the old tail, which is the new head.');
    t.step('done', `Return prev = ${valOf(prev)}.`, { result: listValues(prev) });
    return listValues(prev);
  },
};

const mergeTwoLists: Problem<{ list1: number[]; list2: number[] }> = {
  id: 'merge-two-sorted-lists',
  num: 21,
  title: 'Merge Two Sorted Lists',
  difficulty: 'Easy',
  category: 'linked-list',
  pattern: 'linked-list',
  statement: 'Two linked lists are each sorted ascending. Splice their nodes together into one sorted list (reuse the nodes, do not copy) and return its head.',
  signals: ['two already-sorted sequences', '"merge" into one sorted list', 'reuse nodes / O(1) extra space', 'head of the result is not known up front'],
  insight:
    'A dummy node gives the result a fixed starting point, so there is no special case for the first node. Repeatedly hang the smaller front node on tail; when one list runs out, attach the other in one move.',
  hints: [
    'Which of the two front nodes must come first in the result?',
    'Avoid "is the result empty?" special cases with a placeholder node before the real head.',
    'When one list is exhausted, the remainder of the other is already sorted — link it in one step.',
  ],
  pitfall: 'Forgetting to attach the leftover list after the loop (tail.next = l1 or l2), which drops the largest values.',
  backend: {
    title: 'Merging two sorted log shards by timestamp',
    detail:
      'Two log shippers each emit events sorted by timestamp. A collector merges them into one ordered stream by always forwarding the earlier head event — the same "compare fronts, advance the winner" step as the merge phase of merge sort or a sort-merge join in a database.',
  },
  complexity: { time: 'O(n + m)', space: 'O(1)' },
  code: `
def mergeTwoLists(l1, l2):
    dummy = tail = ListNode()        @init
    while l1 and l2:                 @loop
        if l1.val <= l2.val:         @cmp
            tail.next = l1           @take1
            l1 = l1.next             @adv1
        else:
            tail.next = l2           @take2
            l2 = l2.next             @adv2
        tail = tail.next             @tail
    tail.next = l1 or l2             @rest
    return dummy.next                @done
`,
  explain: {
    init: 'dummy is a placeholder before the real head; tail is the last node of the merged list so far.',
    cmp: 'The smaller front node is the smallest remaining value overall — both lists are sorted.',
    tail: 'tail always sits on the last merged node so the next attachment is O(1).',
    rest: 'One list is empty; the other is already sorted, so hang all of it on at once.',
    done: 'Skip the placeholder.',
  },
  distractors: [
    { text: '    while l1 or l2:', why: 'With "or", one side can be None and l1.val / l2.val crashes; the leftover is handled after the loop instead.' },
    { text: '    return dummy', why: 'dummy is the placeholder with a junk value; the merged list starts at dummy.next.' },
    { text: '            l1.next = l2', why: 'Links the two input lists to each other instead of growing the merged list from tail.' },
  ],
  input: { list1: [1, 2, 4], list2: [1, 3, 4] },
  presets: [
    { label: 'one empty', input: { list1: [], list2: [0] } },
    { label: 'no interleave', input: { list1: [1, 2], list2: [5, 6, 7] } },
  ],
  validate: ({ list1, list2 }) => {
    if (!isNumList(list1, 8) || !isNumList(list2, 8)) return 'Expected { list1, list2 } as number arrays of ≤ 8 values';
    const sorted = (a: number[]) => a.every((x, i) => i === 0 || a[i - 1] <= x);
    return sorted(list1) && sorted(list2) ? null : 'Both lists must be sorted ascending';
  },
  trace(t, { list1, list2 }) {
    let l1 = buildList<number | string>(list1).head;
    let l2 = buildList<number | string>(list2).head;
    const dummy = new ListNode<number | string>('dummy');
    let tail = dummy;
    const merged = new Set<string>();
    t.draw(() => [
      V.list('nodes (merged part first)', chain(dummy, l1, l2), {
        pointers: { l1, l2, tail },
        tones: { [dummy.id]: 'muted', ...tones([...merged], 'good'), ...one(tail === dummy ? null : tail, 'active') },
        caption: 'green = merged so far',
      }),
      V.chips('merged values', listValues(dummy.next).slice(0, merged.size)),
    ]);
    t.step('init', 'Create a dummy node so the merged list always has a node to hang things on; tail starts there.', { l1: valOf(l1), l2: valOf(l2) });
    let it = 0;
    while (l1 && l2) {
      t.step('loop', `Both lists still have nodes (${l1.val} and ${l2.val}).`, { l1: valOf(l1), l2: valOf(l2) });
      const takeOne = (l1.val as number) <= (l2.val as number);
      t.step('cmp', `Compare the fronts: ${l1.val} ${takeOne ? '≤' : '>'} ${l2.val}.`, { l1: valOf(l1), l2: valOf(l2) });
      if (it === 0) t.predict('Which node gets attached to tail?', [`l1's ${l1.val}`, `l2's ${l2.val}`], takeOne ? 0 : 1, takeOne ? 'Ties go to l1 (<=); any order of equal values is fine.' : `${l2.val} is smaller.`);
      if (takeOne) {
        tail.next = l1;
        merged.add(l1.id);
        t.step('take1', `Hang ${l1.val} from list1 on tail.`, { l1: valOf(l1), l2: valOf(l2) });
        l1 = l1.next;
        t.step('adv1', `list1's front moves to ${valOf(l1)}.`, { l1: valOf(l1), l2: valOf(l2) });
      } else {
        tail.next = l2;
        merged.add(l2.id);
        t.step('take2', `Hang ${l2.val} from list2 on tail.`, { l1: valOf(l1), l2: valOf(l2) });
        l2 = l2.next;
        t.step('adv2', `list2's front moves to ${valOf(l2)}.`, { l1: valOf(l1), l2: valOf(l2) });
      }
      tail = tail.next!;
      t.step('tail', `tail advances to the node just attached (${tail.val}).`, { tail: valOf(tail), l1: valOf(l1), l2: valOf(l2) });
      it++;
    }
    t.step('loop', `${l1 ? 'list2' : 'list1'} is exhausted — stop comparing.`, { l1: valOf(l1), l2: valOf(l2) });
    const restLen = listValues(l1 ?? l2).length;
    t.predict('What does tail.next = l1 or l2 attach?', ['the rest of list1', 'the rest of list2', 'nothing (both empty)'], l1 ? 0 : l2 ? 1 : 2, restLen ? `The non-empty side is already sorted, so its ${restLen} node(s) go on in one link.` : 'Both lists ran out together.');
    tail.next = l1 ?? l2;
    for (const n of chain(l1 ?? l2)) merged.add(n.id);
    t.step('rest', restLen ? `Attach the remaining ${restLen} node(s) in a single link — no loop needed.` : 'Nothing left to attach.', { l1: valOf(l1), l2: valOf(l2) });
    const res = listValues(dummy.next);
    t.step('done', `Return dummy.next: ${res.join(' → ') || 'empty'}.`, { result: res });
    return res;
  },
};

const reorderList: Problem<{ values: number[] }> = {
  id: 'reorder-list',
  num: 143,
  title: 'Reorder List',
  difficulty: 'Medium',
  category: 'linked-list',
  pattern: 'linked-list',
  statement:
    'Rearrange a linked list L0 → L1 → … → Ln in place so it alternates from both ends: L0 → Ln → L1 → Ln-1 → … . Only change links, not values.',
  signals: ['alternate between the front and the back', 'singly linked, so the back is unreachable', 'in place, O(1) extra space', 'combo of find-middle + reverse + merge'],
  insight:
    'The back half is needed in reverse order, so: find the middle with slow/fast pointers, cut there, reverse the second half, then zip the two halves together one node from each.',
  hints: [
    'Storing all nodes in an array works but costs O(n) space — can you get the back half in reverse without it?',
    'Three classic sub-routines in a row: middle (fast/slow), reverse, merge.',
    'Cut the list at the middle (slow.next = None) before reversing, or you will create a cycle.',
  ],
  pitfall: 'Not cutting the first half (slow.next = None) — the last node of the first half still points into the second half and the merge creates a cycle.',
  backend: {
    title: 'Fair interleaving of oldest and newest jobs in a queue',
    detail:
      'A job scheduler keeps pending jobs in a linked queue ordered by age. To avoid starving old jobs while still serving fresh ones, it re-links the queue into "oldest, newest, 2nd-oldest, 2nd-newest…" in place — split at the middle, reverse the newer half, interleave — without allocating a copy of a queue that may hold millions of entries.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def reorderList(head):
    slow, fast = head, head.next                 @init
    while fast and fast.next:                    @findMid
        slow, fast = slow.next, fast.next.next   @stepMid
    second = slow.next                           @split
    prev = slow.next = None                      @cut
    while second:                                @revLoop
        tmp = second.next                        @revSave
        second.next = prev                       @revFlip
        prev, second = second, tmp               @revAdv
    first, second = head, prev                   @mergeInit
    while second:                                @mergeLoop
        tmp1, tmp2 = first.next, second.next     @mergeSave
        first.next = second                      @link1
        second.next = tmp1                       @link2
        first, second = tmp1, tmp2               @mergeAdv
`,
  explain: {
    init: 'fast starts one ahead so that for even lengths slow stops at the END of the first half.',
    stepMid: 'fast moves twice as fast; when it hits the end, slow is in the middle.',
    cut: 'Terminate the first half so the halves are independent lists.',
    revFlip: 'Standard in-place reversal of the second half.',
    link1: 'A node from the front half points to the next node from the (reversed) back half…',
    link2: '…which points back to the following front-half node.',
  },
  distractors: [
    { text: '    slow, fast = head, head', why: 'With both starting at head, slow stops one node too far for even lengths, so the first half ends up longer than allowed.' },
    { text: '    second = slow', why: 'The middle node belongs to the first half; the second half starts at slow.next.' },
    { text: '    while first:', why: 'The first half can be one node longer; looping on first dereferences a None second. Loop while second has nodes.' },
  ],
  input: { values: [1, 2, 3, 4, 5] },
  presets: [
    { label: 'even length', input: { values: [1, 2, 3, 4] } },
    { label: 'single node', input: { values: [7] } },
  ],
  validate: ({ values }) => (!isNumList(values, 10) || values.length < 1 ? 'Expected { values: number[] } with 1–10 numbers' : null),
  trace(t, { values }) {
    const { head, nodes } = buildList(values);
    const h = head!;
    let phase: 'mid' | 'rev' | 'merge' | 'done' = 'mid';
    let slow: LN | null = h;
    let fast: LN | null = h.next;
    let second: LN | null = null;
    let prev: LN | null = null;
    let first: LN | null = null;
    let tmp1: LN | null = null;
    let tmp2: LN | null = null;
    const back = new Set<string>();
    t.draw(() => {
      const pointers =
        phase === 'mid' ? { slow, fast, second } : phase === 'rev' ? { slow, prev, second } : phase === 'merge' ? { first, second, tmp1, tmp2 } : { head: h };
      return [
        V.list('list (original positions — arrows show the links)', nodes, {
          pointers,
          tones: { ...tones([...back], 'info'), ...(phase === 'mid' ? one(slow, 'active') : {}) },
          caption: 'blue = second half',
        }),
        phase === 'done' && V.chips('result', listValues(h)),
      ];
    });
    t.step('init', 'Phase 1 — find the middle. slow starts at head, fast one node ahead.', { slow: valOf(slow), fast: valOf(fast) });
    while (fast && fast.next) {
      t.step('findMid', `fast (${fast.val}) can still jump two nodes.`, { slow: valOf(slow), fast: valOf(fast) });
      slow = slow!.next;
      fast = fast.next.next;
      t.step('stepMid', `slow → ${valOf(slow)}, fast → ${valOf(fast)}.`, { slow: valOf(slow), fast: valOf(fast) });
    }
    t.step('findMid', 'fast cannot jump two more nodes — slow is at the end of the first half.', { slow: valOf(slow), fast: valOf(fast) });
    if (slow!.next && slow !== h) t.predict('second = slow.next. Which value starts the second half?', [valOf(slow), valOf(slow!.next), valOf(h)], 1, `slow (${valOf(slow)}) is the last node of the first half, so the second half starts right after it.`);
    second = slow!.next;
    for (const n of chain(second)) back.add(n.id);
    t.step('split', `second = ${valOf(second)}: the back half to be reversed.`, { slow: valOf(slow), second: valOf(second) });
    phase = 'rev';
    slow!.next = null;
    prev = null;
    t.step('cut', `Cut after ${valOf(slow)} so the halves are separate lists. Phase 2 — reverse the second half.`, { prev: 'None', second: valOf(second) });
    while (second) {
      t.step('revLoop', `Reverse step for node ${second.val}.`, { prev: valOf(prev), second: valOf(second) });
      const tmp: LN | null = second.next;
      t.step('revSave', `Save tmp = ${valOf(tmp)} before flipping.`, { prev: valOf(prev), second: valOf(second), tmp: valOf(tmp) });
      second.next = prev;
      t.step('revFlip', `${second.val} now points back to ${valOf(prev)}.`, { prev: valOf(prev), second: valOf(second), tmp: valOf(tmp) });
      prev = second;
      second = tmp;
      t.step('revAdv', `prev = ${valOf(prev)}, second = ${valOf(second)}.`, { prev: valOf(prev), second: valOf(second) });
    }
    t.step('revLoop', `Second half reversed; it now starts at ${valOf(prev)}.`, { prev: valOf(prev) });
    phase = 'merge';
    first = h;
    second = prev;
    t.step('mergeInit', `Phase 3 — zip. first = ${valOf(first)} (front half), second = ${valOf(second)} (reversed back half).`, { first: valOf(first), second: valOf(second) });
    let it = 0;
    while (second) {
      t.step('mergeLoop', `Back half still has ${second.val}.`, { first: valOf(first), second: valOf(second) });
      tmp1 = first!.next;
      tmp2 = second.next;
      t.step('mergeSave', `Save both successors: tmp1 = ${valOf(tmp1)}, tmp2 = ${valOf(tmp2)}.`, { first: valOf(first), second: valOf(second), tmp1: valOf(tmp1), tmp2: valOf(tmp2) });
      if (it === 0) t.predict(`first.next = second: what will node ${first!.val} point to?`, [valOf(tmp1), valOf(second)], 1, `It skips to ${second.val}, the last node of the original list.`);
      first!.next = second;
      t.step('link1', `${first!.val} → ${second.val} (take one from the back).`, { first: valOf(first), second: valOf(second) });
      second.next = tmp1;
      t.step('link2', `${second.val} → ${valOf(tmp1)} (back to the front half).`, { first: valOf(first), second: valOf(second) });
      first = tmp1;
      second = tmp2;
      t.step('mergeAdv', `Advance: first = ${valOf(first)}, second = ${valOf(second)}.`, { first: valOf(first), second: valOf(second) });
      it++;
    }
    phase = 'done';
    const res = listValues(h);
    t.step('mergeLoop', `Back half used up — the list reads ${res.join(' → ')}.`, { result: res });
    return res;
  },
};

const removeNth: Problem<{ values: number[]; n: number }> = {
  id: 'remove-nth-node-from-end-of-list',
  num: 19,
  title: 'Remove Nth Node From End of List',
  difficulty: 'Medium',
  category: 'linked-list',
  pattern: 'linked-list',
  statement: 'Delete the node that is n positions from the end of a singly linked list and return the head. Try to do it in one pass.',
  signals: ['"n-th from the end"', 'singly linked — length unknown', 'one pass requested', 'the head itself might be removed'],
  insight:
    'Put two pointers n nodes apart, then move them together. When the leading one falls off the end, the trailing one is right before the node to delete. A dummy node in front handles deleting the head.',
  hints: [
    'Two passes (count, then walk len − n) works. How can one pointer "know" where the end is?',
    'Keep a fixed gap of n nodes between two pointers.',
    'Start the trailing pointer on a dummy node so it stops BEFORE the victim (you need its predecessor to unlink it).',
  ],
  pitfall: 'Starting left at head instead of a dummy — left then lands ON the node to delete (not before it) and removing the head needs a special case.',
  backend: {
    title: 'Dropping the n-th most recent entry from a streamed change log',
    detail:
      'A replication follower receives an append-only linked chain of change records of unknown length and must discard the record n steps before the end (e.g. a known-bad write). Two cursors a fixed distance apart find it in one streaming pass, the same trick used to keep "the last n records" without buffering the whole stream.',
  },
  complexity: { time: 'O(L)', space: 'O(1)' },
  code: `
def removeNthFromEnd(head, n):
    dummy = ListNode(0, head)                 @init
    left, right = dummy, head                 @ptrs
    while n > 0:                              @gapLoop
        right = right.next                    @gap
        n -= 1                                @dec
    while right:                              @slide
        left, right = left.next, right.next   @move
    left.next = left.next.next                @unlink
    return dummy.next                         @done
`,
  explain: {
    init: 'A node before head so left can stop before ANY node, including the head.',
    gap: 'Open a gap of n nodes between left and right.',
    move: 'The gap stays the same size while both slide.',
    unlink: 'right is past the end, so left.next is n-th from the end — skip over it.',
    done: 'dummy.next is the (possibly new) head.',
  },
  distractors: [
    { text: '    left, right = head, head', why: 'Without the dummy, left ends ON the victim instead of before it, and removing the head breaks.' },
    { text: '    while right.next:', why: 'Stops one step early, so left is two nodes before the victim and the wrong node is removed.' },
    { text: '    left.next = right', why: 'right is None at this point — this drops everything after left, not just one node.' },
  ],
  input: { values: [1, 2, 3, 4, 5], n: 2 },
  presets: [
    { label: 'remove the head', input: { values: [1, 2, 3], n: 3 } },
    { label: 'single node', input: { values: [1], n: 1 } },
  ],
  validate: ({ values, n }) =>
    !isNumList(values, 10) || values.length < 1 || typeof n !== 'number'
      ? 'Expected { values: number[] (1–10), n: number }'
      : n < 1 || n > values.length
        ? 'n must be between 1 and the list length'
        : null,
  trace(t, { values, n }) {
    const { head, nodes } = buildList<number | string>(values);
    const dummy = new ListNode<number | string>('dummy', head);
    let left: ListNode<number | string> | null = dummy;
    let right: ListNode<number | string> | null = null;
    let removed: ListNode<number | string> | null = null;
    let k = n;
    let showGap = false;
    const gapIds = () => {
      const out: string[] = [];
      for (let p = left?.next ?? null; p && p !== right; p = p.next) out.push(p.id);
      return out;
    };
    t.draw(() => [
      V.list('list', [dummy, ...nodes].filter((x) => x === dummy || x === removed || chain(dummy).includes(x)), {
        pointers: { left, right },
        tones: { [dummy.id]: 'muted', ...(showGap ? tones(gapIds(), 'info') : {}), ...one(removed, 'bad') },
        caption: `blue = gap between left and right`,
      }),
    ]);
    t.step('init', 'Put a dummy node before head so we can delete the head with the same code.', { n });
    right = head;
    showGap = true;
    t.step('ptrs', `left = dummy, right = head (${valOf(right)}).`, { left: valOf(left), right: valOf(right), n: k });
    while (k > 0) {
      t.step('gapLoop', `${k} more step(s) to open the gap.`, { n: k });
      right = right!.next;
      t.step('gap', `right moves to ${valOf(right)}.`, { left: valOf(left), right: valOf(right), n: k });
      k--;
      t.step('dec', `n = ${k}.`, { n: k });
    }
    t.step('gapLoop', `Gap is open: right is ${n} nodes past left's successor.`, { left: valOf(left), right: valOf(right) });
    t.predict('Now both pointers move together. How many nodes sit between left and right (exclusive) the whole time?', [String(n - 1), String(n), String(n + 1)], 1, `We opened a gap of exactly n = ${n} and moving both keeps it fixed.`);
    while (right) {
      t.step('slide', `right (${right.val}) is not past the end yet.`, { left: valOf(left), right: valOf(right) });
      left = left!.next;
      right = right.next;
      t.step('move', `Slide both: left = ${valOf(left)}, right = ${valOf(right)}.`, { left: valOf(left), right: valOf(right) });
    }
    t.step('slide', 'right fell off the end — left is now just before the node to remove.', { left: valOf(left), right: 'None' });
    const victim = left!.next!;
    t.predict('Which node gets removed?', [valOf(left), valOf(victim), valOf(victim.next)], 1, `left.next (${victim.val}) is exactly n = ${n} from the end.`);
    left!.next = victim.next;
    removed = victim;
    showGap = false;
    t.step('unlink', `left.next skips ${victim.val}; it is no longer reachable.`, { left: valOf(left), removed: valOf(victim) });
    const res = listValues(dummy.next);
    t.step('done', `Return dummy.next: ${res.join(' → ') || 'empty list'}.`, { result: res });
    return res;
  },
};

const copyRandomList: Problem<{ nodes: [number, number | null][] }> = {
  id: 'copy-list-with-random-pointer',
  num: 138,
  title: 'Copy List with Random Pointer',
  difficulty: 'Medium',
  category: 'linked-list',
  pattern: 'linked-list',
  statement:
    'Each node of a linked list has a next pointer and a random pointer (to any node or None). Build a deep copy: brand-new nodes whose next and random pointers mirror the original but only point to other new nodes.',
  signals: ['"deep copy"', 'pointers that can jump anywhere (forward, backward, self)', 'a target may not have been created yet', 'identity of nodes matters, not values'],
  insight:
    'A random pointer can target a node you have not copied yet. Split the work: pass 1 creates every copy and records old → new in a hashmap; pass 2 wires next and random by looking the targets up in that map.',
  hints: [
    'Copying next pointers alone is easy. What goes wrong with random on a single pass?',
    'You need a way to go from an original node to "its copy" in O(1).',
    'Map old node → new node; map None → None so missing pointers need no special case.',
  ],
  pitfall: 'Pointing copy.random at the ORIGINAL node (cur.random) instead of its copy — the result shares nodes with the input and is not a deep copy.',
  backend: {
    title: 'Cloning an object graph between services (ORM / cache snapshot)',
    detail:
      'Serialising an in-memory object graph — e.g. ORM entities where an order references a customer that other rows also reference — needs each object copied exactly once and every reference re-pointed to the copy. Serializers (Jackson object-ids, Python deepcopy\'s memo dict) keep exactly this old-identity → new-object map.',
  },
  complexity: { time: 'O(n)', space: 'O(n)' },
  code: `
def copyRandomList(head):
    oldToCopy = {None: None}                  @init
    cur = head                                @start1
    while cur:                                @pass1
        oldToCopy[cur] = Node(cur.val)        @clone
        cur = cur.next                        @adv1
    cur = head                                @start2
    while cur:                                @pass2
        copy = oldToCopy[cur]                 @get
        copy.next = oldToCopy[cur.next]       @wireNext
        copy.random = oldToCopy[cur.random]   @wireRandom
        cur = cur.next                        @adv2
    return oldToCopy[head]                    @done
`,
  explain: {
    init: 'Seeding None → None means a None next/random maps to None with no if-statement.',
    clone: 'Create the copy now, wire it later — its targets may not exist yet.',
    start2: 'Every copy now exists, so every lookup in pass 2 succeeds.',
    wireRandom: 'Look up the COPY of the random target, never the original.',
  },
  distractors: [
    { text: '        copy.random = cur.random', why: 'Points into the original list — the copy is no longer independent (shallow copy).' },
    { text: '        copy.random = Node(cur.random.val)', why: 'Creates a fresh node per pointer, so two pointers to the same original end up at different copies (and crashes on None).' },
    { text: '    oldToCopy = {}', why: 'Without the None → None entry, oldToCopy[cur.next] raises KeyError on the tail and on missing randoms.' },
  ],
  input: {
    nodes: [
      [7, null],
      [13, 0],
      [11, 4],
      [10, 2],
      [1, 0],
    ],
  },
  presets: [
    {
      label: 'random to self/next',
      input: {
        nodes: [
          [1, 1],
          [2, 1],
        ],
      },
    },
    { label: 'empty', input: { nodes: [] } },
  ],
  validate: ({ nodes }) => {
    if (!Array.isArray(nodes) || nodes.length > 8) return 'Expected { nodes: [[val, randomIndex|null], …] } with ≤ 8 nodes';
    for (const x of nodes) {
      if (!Array.isArray(x) || typeof x[0] !== 'number') return 'Each node is [val, randomIndex|null]';
      if (x[1] !== null && (typeof x[1] !== 'number' || x[1] < 0 || x[1] >= nodes.length)) return 'randomIndex must be null or a valid index';
    }
    return null;
  },
  trace(t, { nodes: spec }) {
    const { head, nodes: orig } = buildList(spec.map((x) => x[0]));
    orig.forEach((n, i) => (n.random = spec[i][1] === null ? null : orig[spec[i][1]!]));
    const idx = new Map<LN, number>(orig.map((n, i) => [n, i]));
    const oldToCopy = new Map<LN, LN>();
    const copies: LN[] = [];
    let cur: LN | null = null;
    let copy: LN | null = null;
    let hl: string[] = [];
    const nm = (n: LN | null) => (n ? `#${idx.get(n)} (${n.val})` : 'None');
    t.draw(() => [
      V.list('original', orig, { showRandom: true, pointers: { cur }, tones: one(cur, 'active') }),
      V.list('copy', copies, { showRandom: true, pointers: { copy }, tones: { ...tones(ids(copies), 'good'), ...one(copy, 'active') } }),
      V.map('oldToCopy', [['None', 'None'], ...[...oldToCopy.entries()].map(([o, c]) => [nm(o), `copy #${copies.indexOf(c)}`] as [string, string])], { hl }),
    ]);
    t.step('init', 'Map old node → copy, seeded with None → None.', {});
    cur = head;
    t.step('start1', 'Pass 1: walk the list and create a bare copy of every node.', { cur: nm(cur) });
    while (cur) {
      t.step('pass1', `Visit ${nm(cur)}.`, { cur: nm(cur) });
      const c = new ListNode<number>(cur.val);
      oldToCopy.set(cur, c);
      copies.push(c);
      hl = [nm(cur)];
      t.step('clone', `Create copy #${copies.length - 1} with value ${cur.val}. No pointers yet — its random target might not exist.`, { cur: nm(cur) });
      cur = cur.next;
      t.step('adv1', `Next original: ${nm(cur)}.`, { cur: nm(cur) });
    }
    cur = head;
    hl = [];
    t.step('start2', 'Pass 2: every copy exists now; wire next and random through the map.', { cur: nm(cur) });
    if (orig.length) t.predict(`When we wire copy #0's pointers, are all the copies they could target already created?`, ['Yes', 'No — some are created later'], 0, 'Pass 1 created a copy for every node, which is exactly why we split into two passes.');
    let askedRandom = false;
    while (cur) {
      t.step('pass2', `Wire the copy of ${nm(cur)}.`, { cur: nm(cur) });
      copy = oldToCopy.get(cur)!;
      hl = [nm(cur)];
      t.step('get', `copy = oldToCopy[${nm(cur)}] = copy #${copies.indexOf(copy)}.`, { cur: nm(cur) });
      copy.next = cur.next ? oldToCopy.get(cur.next)! : null;
      hl = [cur.next ? nm(cur.next) : 'None'];
      t.step('wireNext', `copy.next = copy of ${nm(cur.next)}.`, { cur: nm(cur), 'cur.next': nm(cur.next) });
      const r = cur.random;
      if (!askedRandom && r) {
        askedRandom = true;
        const ans = copies.indexOf(oldToCopy.get(r)!);
        const opts = [`copy #${ans}`, `original ${nm(r)}`, 'None'];
        t.predict(`cur.random is original ${nm(r)}. What does copy.random point to?`, opts, 0, `Always the copy of the target: oldToCopy[${nm(r)}] = copy #${ans}.`);
      }
      copy.random = r ? oldToCopy.get(r)! : null;
      hl = [r ? nm(r) : 'None'];
      t.step('wireRandom', r ? `copy.random = oldToCopy[${nm(r)}] = copy #${copies.indexOf(copy.random!)}.` : 'cur.random is None → copy.random = None (thanks to the seed entry).', { cur: nm(cur), 'cur.random': nm(r) });
      cur = cur.next;
      t.step('adv2', `Next original: ${nm(cur)}.`, { cur: nm(cur) });
    }
    copy = copies[0] ?? null;
    hl = [];
    const res = copies.map((c) => [c.val, c.random ? copies.indexOf(c.random) : null]);
    t.step('done', 'Return the copy of head. The copy has the same shape but shares no nodes with the original.', { result: res });
    return res;
  },
};

const addTwoNumbers: Problem<{ l1: number[]; l2: number[] }> = {
  id: 'add-two-numbers',
  num: 2,
  title: 'Add Two Numbers',
  difficulty: 'Medium',
  category: 'linked-list',
  pattern: 'linked-list',
  statement:
    'Two non-negative integers are stored as linked lists of digits, least-significant digit first. Return their sum in the same format.',
  signals: ['digits stored in reverse order', 'numbers may be too long for an int', 'lists of different lengths', 'carry between positions'],
  insight:
    'Reverse order means the heads are the ones digits — exactly where grade-school addition starts. Walk both lists together, add digit + digit + carry, emit sum % 10 and carry sum // 10; keep going while either list or the carry remains.',
  hints: [
    'Converting to an int overflows in most languages. Do the addition digit by digit.',
    'Treat a missing digit (shorter list) as 0.',
    'Do not stop when both lists are empty — a final carry still produces a digit.',
  ],
  pitfall: 'Looping only "while l1 and l2" (drops the longer tail) or forgetting the final carry (999 + 1 loses its leading 1).',
  backend: {
    title: 'Arbitrary-precision money / counters (BigInteger, NUMERIC)',
    detail:
      'Ledger services store balances too large or too exact for 64-bit floats using decimal digit chunks (Java BigInteger, Postgres NUMERIC, Redis counters with big values). Adding two such numbers is this exact loop: walk the chunk lists from least significant, add with carry, and allocate one extra chunk when the carry survives.',
  },
  complexity: { time: 'O(max(m, n))', space: 'O(max(m, n))' },
  code: `
def addTwoNumbers(l1, l2):
    dummy = cur = ListNode()                @init
    carry = 0                               @carry0
    while l1 or l2 or carry:                @loop
        v1 = l1.val if l1 else 0            @v1
        v2 = l2.val if l2 else 0            @v2
        carry, digit = divmod(v1 + v2 + carry, 10)   @sum
        cur.next = ListNode(digit)          @append
        cur = cur.next                      @advCur
        l1 = l1.next if l1 else None        @adv1
        l2 = l2.next if l2 else None        @adv2
    return dummy.next                       @done
`,
  explain: {
    loop: '"or carry" keeps the loop alive for a final carry digit.',
    v1: 'A finished list contributes 0 — the shorter number is padded with zeros.',
    sum: 'digit stays in this column; carry moves to the next.',
    append: 'Build the result in the same least-significant-first order.',
  },
  distractors: [
    { text: '    while l1 and l2:', why: 'Stops at the shorter list and ignores the longer list\'s digits and the final carry.' },
    { text: '        cur.next = ListNode(v1 + v2 + carry)', why: 'Stores a two-digit value in one node; you must keep only the ones digit and carry the rest.' },
    { text: '        carry = (v1 + v2) // 10', why: 'Ignores the incoming carry when computing the outgoing carry (9 + 0 + 1 should carry 1).' },
  ],
  input: { l1: [2, 4, 3], l2: [5, 6, 4] },
  presets: [
    { label: 'final carry', input: { l1: [9, 9, 9], l2: [1] } },
    { label: 'zeros', input: { l1: [0], l2: [0] } },
  ],
  validate: ({ l1, l2 }) =>
    !isNumList(l1, 8) || !isNumList(l2, 8) || !l1.length || !l2.length
      ? 'Expected { l1, l2 } as digit arrays with 1–8 digits'
      : [...l1, ...l2].some((d) => !Number.isInteger(d) || d < 0 || d > 9)
        ? 'Digits must be 0–9'
        : null,
  trace(t, { l1: a, l2: b }) {
    const A = buildList(a);
    const B = buildList(b);
    let l1: LN | null = A.head;
    let l2: LN | null = B.head;
    const dummy = new ListNode<number | string>('dummy');
    let cur: ListNode<number | string> = dummy;
    let carry = 0;
    t.draw(() => [
      V.list('l1 (ones digit first)', A.nodes, { pointers: { l1 }, tones: one(l1, 'active') }),
      V.list('l2 (ones digit first)', B.nodes, { pointers: { l2 }, tones: one(l2, 'active') }),
      V.list('result', chain(dummy), { pointers: { cur }, tones: { [dummy.id]: 'muted', ...tones(ids(chain(dummy.next)), 'good') } }),
    ]);
    t.step('init', 'dummy gives the result a fixed start; cur is where the next digit gets attached.', {});
    t.step('carry0', 'No carry before the ones column.', { carry });
    let askedCarry = false;
    let askedIn = false;
    let col = 0;
    while (l1 || l2 || carry) {
      t.step('loop', l1 || l2 ? `Column ${col}: at least one list still has a digit.` : `Both lists are done but carry = ${carry} must still be written.`, { carry });
      const v1 = l1 ? l1.val : 0;
      t.step('v1', l1 ? `v1 = ${v1}.` : 'l1 is finished → v1 = 0.', { v1, carry });
      const v2 = l2 ? l2.val : 0;
      t.step('v2', l2 ? `v2 = ${v2}.` : 'l2 is finished → v2 = 0.', { v1, v2, carry });
      if (!askedIn && carry) {
        askedIn = true;
        t.predict('What is v1 + v2 + carry for this column?', [String(v1 + v2), String(v1 + v2 + carry), String(v1 + v2 + 10)], 1, `The carry of ${carry} from the previous column is added in.`);
      }
      const total = v1 + v2 + carry;
      if (!askedCarry && total >= 10) {
        askedCarry = true;
        t.predict(`${v1} + ${v2} + ${carry} = ${total}. What digit is written and what is the new carry?`, [`digit ${total}, carry 0`, `digit ${total % 10}, carry 1`, `digit 1, carry ${total % 10}`], 1, 'Only the ones digit stays in this column; the ten moves to the next column as carry.');
      }
      carry = Math.floor(total / 10);
      const digit = total % 10;
      t.step('sum', `${v1} + ${v2} + carry = ${total} → digit ${digit}, carry ${carry}.`, { v1, v2, digit, carry });
      cur.next = new ListNode<number | string>(digit);
      t.step('append', `Append a node with ${digit}.`, { digit, carry });
      cur = cur.next;
      t.step('advCur', 'cur moves onto the new digit.', { carry });
      l1 = l1 ? l1.next : null;
      t.step('adv1', `l1 → ${valOf(l1)}.`, { carry });
      l2 = l2 ? l2.next : null;
      t.step('adv2', `l2 → ${valOf(l2)}.`, { carry });
      if (!l1 && !l2 && carry && col < 20) t.predict('Both lists are exhausted. Does the loop run again?', ['Yes — carry is 1', 'No — both lists are None'], 0, 'The condition is "l1 or l2 or carry"; the leftover carry becomes a new leading digit.');
      col++;
    }
    t.step('loop', 'No digits and no carry left.', { carry });
    const res = listValues(dummy.next);
    t.step('done', `Result (ones first): ${res.join(' → ')}.`, { result: res });
    return res;
  },
};

const hasCycle: Problem<{ values: number[]; pos: number }> = {
  id: 'linked-list-cycle',
  num: 141,
  title: 'Linked List Cycle',
  difficulty: 'Easy',
  category: 'linked-list',
  pattern: 'fast-slow',
  statement:
    'Decide whether a linked list loops back on itself (some node\'s next points to an earlier node). pos is the index the tail connects to, or −1 for no loop — it only builds the input.',
  signals: ['"cycle" / "loops forever"', 'O(1) memory requested', 'cannot mark nodes', 'following next pointers'],
  insight:
    'Run two pointers: slow moves 1, fast moves 2. Without a cycle fast reaches the end; with a cycle fast enters the loop and gains one node per step on slow, so it must land on it.',
  hints: [
    'A set of visited nodes works in O(n) space. Can you avoid remembering nodes?',
    'Think of two runners on a circular track at different speeds.',
    'Inside the loop the gap shrinks by exactly 1 each step, so fast cannot skip over slow.',
  ],
  pitfall: 'Checking fast.next.next without first checking fast and fast.next — crashes on lists that end.',
  backend: {
    title: 'Detecting redirect / reference loops',
    detail:
      'A URL shortener or HTTP client follows redirects where each URL points to exactly one next URL; a misconfigured rule (A → B → C → A) loops forever. Following the chain with a 1-step and a 2-step cursor detects the loop with O(1) memory — the same check catches cycles in "next pointer" chains like symlinks or parent-version chains in a document store.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def hasCycle(head):
    slow, fast = head, head          @init
    while fast and fast.next:        @loop
        slow = slow.next             @slow
        fast = fast.next.next        @fast
        if slow == fast:             @meet
            return True              @yes
    return False                     @no
`,
  explain: {
    loop: 'If fast can reach None there is an end, hence no cycle.',
    fast: 'Two steps per iteration — fast closes the gap on slow by one node each time inside a cycle.',
    meet: 'Compare node identity, not values (values may repeat).',
  },
  distractors: [
    { text: '        if slow.val == fast.val:', why: 'Different nodes can hold the same value; you must compare the nodes themselves.' },
    { text: '    while fast.next.next:', why: 'Crashes when fast or fast.next is None (lists without a cycle).' },
    { text: '        fast = fast.next', why: 'With equal speeds the pointers never close the gap, so a cycle is never detected.' },
  ],
  input: { values: [3, 2, 0, -4], pos: 1 },
  presets: [
    { label: 'no cycle', input: { values: [1, 2, 3, 4, 5], pos: -1 } },
    { label: 'tail → head', input: { values: [1, 2], pos: 0 } },
  ],
  validate: ({ values, pos }) =>
    !isNumList(values, 10) || typeof pos !== 'number'
      ? 'Expected { values: number[] (≤ 10), pos: number }'
      : pos < -1 || pos >= values.length
        ? 'pos must be −1 or a valid index'
        : null,
  trace(t, { values, pos }) {
    const { head, nodes } = buildList(values);
    if (pos >= 0) nodes[nodes.length - 1].next = nodes[pos];
    const idx = new Map<LN, number>(nodes.map((n, i) => [n, i]));
    let slow: LN | null = head;
    let fast: LN | null = head;
    let met = false;
    const nm = (n: LN | null) => (n ? `#${idx.get(n)} (${n.val})` : 'None');
    t.draw(() => [
      V.list('list', nodes, {
        pointers: { slow, fast },
        tones: met && slow ? { [slow.id]: 'good' } : { ...one(slow, 'info'), ...one(fast, 'warn') },
        caption: pos >= 0 ? `tail links back to index ${pos}` : 'tail → None',
      }),
    ]);
    t.step('init', 'Both runners start at head.', { slow: nm(slow), fast: nm(fast) });
    let it = 0;
    while (fast && fast.next) {
      t.step('loop', 'fast and fast.next exist, so fast can take two steps.', { slow: nm(slow), fast: nm(fast) });
      slow = slow!.next;
      t.step('slow', `slow moves 1 → ${nm(slow)}.`, { slow: nm(slow), fast: nm(fast) });
      const landing = fast.next.next;
      if (it === 0 || (landing === slow && pos >= 0)) {
        t.predict(`fast will jump two nodes to ${nm(landing)}. Will it land on slow?`, ['Yes', 'No'], landing === slow ? 0 : 1, landing === slow ? 'Inside the loop fast gains one node per step, so it eventually lands exactly on slow.' : 'Not yet — the gap is still closing.');
      }
      fast = landing;
      t.step('fast', `fast moves 2 → ${nm(fast)}.`, { slow: nm(slow), fast: nm(fast) });
      if (slow === fast) {
        met = true;
        t.step('meet', `slow and fast are on the same node ${nm(slow)}.`, { slow: nm(slow), fast: nm(fast) });
        t.step('yes', 'They met, so the list must loop — return True.', { result: true });
        return true;
      }
      t.step('meet', 'Different nodes — keep running.', { slow: nm(slow), fast: nm(fast) });
      it++;
      if (it > 50) break;
    }
    t.step('loop', 'fast reached the end of the list.', { slow: nm(slow), fast: nm(fast) });
    t.step('no', 'A list with an end cannot contain a cycle — return False.', { result: false });
    return false;
  },
};

const findDuplicate: Problem<{ nums: number[] }> = {
  id: 'find-the-duplicate-number',
  num: 287,
  title: 'Find the Duplicate Number',
  difficulty: 'Medium',
  category: 'linked-list',
  pattern: 'fast-slow',
  statement:
    'An array of n + 1 integers holds values from 1 to n, so at least one value repeats. Return the repeated value without modifying the array and using O(1) extra space.',
  signals: ['values are in range 1…n with n + 1 slots', 'do not modify the array', 'O(1) extra space', 'a value can be read as "the index to go to next"'],
  insight:
    'Treat i → nums[i] as a next pointer. Index 0 is never a target, so following pointers from 0 enters a loop, and the loop entrance is a value two indices point to — the duplicate. Floyd\'s algorithm finds that entrance.',
  hints: [
    'Sorting or a set breaks the constraints. What structure do "values that are valid indices" form?',
    'Draw an arrow from every index i to nums[i]. Two arrows enter the duplicate value.',
    'Phase 1: slow/fast until they meet. Phase 2: restart one pointer at 0; move both 1 step — they meet at the cycle entrance.',
  ],
  pitfall: 'Returning the meeting point of phase 1 — that is just some node inside the cycle, not necessarily its entrance.',
  backend: {
    title: 'Finding the loop entry in a pointer-chasing chain',
    detail:
      'Garbage collectors, storage engines with on-disk "next block" pointers, and job chains where each job names its successor can all be modelled as i → next[i]. When a corruption introduces a loop, Floyd\'s two phases find the exact block where two chains merge into the loop — without allocating a visited set over millions of blocks.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def findDuplicate(nums):
    slow, fast = 0, 0                 @init
    while True:                       @loop1
        slow = nums[slow]             @s1
        fast = nums[nums[fast]]       @f1
        if slow == fast:              @meet
            break
    slow2 = 0                         @phase2
    while True:                       @loop2
        slow = nums[slow]             @s2
        slow2 = nums[slow2]           @s22
        if slow == slow2:             @check
            return slow               @done
`,
  explain: {
    init: 'Index 0 has no incoming arrow (values are ≥ 1), so it is outside the cycle — a valid "head".',
    f1: 'Two hops per iteration.',
    phase2: 'Distance head → entrance equals distance meeting point → entrance (mod cycle length).',
    check: 'They meet exactly at the cycle entrance, which is the duplicated value.',
  },
  distractors: [
    { text: '            return slow', why: 'Inside phase 1 the meeting point is some node in the cycle, not necessarily its entrance (the duplicate).' },
    { text: '        fast = nums[fast]', why: 'fast must take two hops; at equal speed the pointers never meet inside the cycle.' },
    { text: '    slow2 = nums[0]', why: 'slow2 must start at the head (index 0) for the equal-distance argument to hold.' },
  ],
  input: { nums: [1, 3, 4, 2, 2] },
  presets: [
    { label: 'longer tail', input: { nums: [3, 1, 3, 4, 2] } },
    { label: 'all same', input: { nums: [2, 2, 2, 2] } },
  ],
  validate: ({ nums }) => {
    if (!isNumList(nums, 10) || nums.length < 2) return 'Expected { nums: number[] } with 2–10 values';
    const n = nums.length - 1;
    return nums.every((x) => Number.isInteger(x) && x >= 1 && x <= n) ? null : `Values must be integers 1…${n}`;
  },
  trace(t, { nums }) {
    const n = nums.length;
    let slow = 0;
    let fast: number | null = 0;
    let slow2: number | null = null;
    let found: number | null = null;
    const positions: Record<string, [number, number]> = {};
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n - Math.PI / 2;
      positions[String(i)] = [50 + 38 * Math.cos(a), 50 + 38 * Math.sin(a)];
    }
    t.draw(() => {
      const nodeTones: Record<string, Tone> = {};
      if (fast !== null) nodeTones[String(fast)] = 'warn';
      if (slow2 !== null) nodeTones[String(slow2)] = 'warn';
      nodeTones[String(slow)] = 'info';
      if (found !== null) nodeTones[String(found)] = 'good';
      const ptrs: Record<string, number | null> = { slow };
      if (fast !== null) ptrs.fast = fast;
      if (slow2 !== null) ptrs.slow2 = slow2;
      return [
        V.array('nums (index → value)', nums, { pointers: ptrs, tones: found !== null ? { [found]: 'good' } : {} }),
        V.graph(
          'arrows i → nums[i]',
          nums.map((_, i) => i),
          nums.map((v, i) => [i, v] as const),
          { directed: true, positions, tones: nodeTones, badges: { [String(slow)]: 'slow', ...(fast !== null ? { [String(fast)]: fast === slow ? 'slow+fast' : 'fast' } : {}), ...(slow2 !== null ? { [String(slow2)]: slow2 === slow ? 'slow+slow2' : 'slow2' } : {}) } },
        ),
      ];
    });
    t.step('init', 'Read every value as a pointer to an index. Start both runners at index 0 (no arrow points into it).', { slow, fast });
    let it = 0;
    for (;;) {
      t.step('loop1', 'Phase 1: run until the runners meet inside the cycle.', { slow, fast });
      slow = nums[slow];
      t.step('s1', `slow = nums[slow] → ${slow}.`, { slow, fast });
      fast = nums[nums[fast!]];
      t.step('f1', `fast = nums[nums[fast]] → ${fast} (two hops).`, { slow, fast });
      if (slow === fast) {
        t.step('meet', `Met at index ${slow} — somewhere inside the cycle.`, { slow, fast });
        break;
      }
      t.step('meet', 'Not equal yet.', { slow, fast });
      if (++it > 40) break;
    }
    t.predict(`Is the meeting index ${slow} the duplicate value?`, ['Yes, return it', 'Not necessarily — find the cycle entrance'], 1, 'Phase 1 only proves a cycle exists; the duplicate is where the tail joins the cycle.');
    fast = null;
    slow2 = 0;
    t.step('phase2', 'Phase 2: slow2 starts back at index 0; both now move one hop at a time.', { slow, slow2 });
    let askedEntry = false;
    it = 0;
    for (;;) {
      t.step('loop2', 'Advance both by one hop.', { slow, slow2 });
      const ns: number = nums[slow];
      const ns2: number = nums[slow2!];
      if (!askedEntry && ns === ns2) {
        askedEntry = true;
        t.predict(`After one more hop each, slow → ${ns} and slow2 → ${ns2}. Is that the answer?`, ['Yes — they meet at the entrance', 'No — keep going'], 0, `Two different indices point at ${ns}: that is the duplicated value.`);
      }
      slow = ns;
      t.step('s2', `slow → ${slow}.`, { slow, slow2 });
      slow2 = ns2;
      t.step('s22', `slow2 → ${slow2}.`, { slow, slow2 });
      if (slow === slow2) {
        found = slow;
        t.step('check', `Both at ${slow}: the cycle entrance, i.e. the value with two incoming arrows.`, { slow, slow2 });
        t.step('done', `Return ${slow}.`, { result: slow });
        return slow;
      }
      t.step('check', 'Different — keep going.', { slow, slow2 });
      if (++it > 40) return null;
    }
  },
};

const lruCache: Problem<{ capacity: number; ops: (string | number)[][] }> = {
  id: 'lru-cache',
  num: 146,
  title: 'LRU Cache',
  difficulty: 'Medium',
  category: 'linked-list',
  pattern: 'design',
  statement:
    'Design a fixed-capacity key-value cache with get and put in O(1). When inserting a new key into a full cache, evict the key that was used least recently (reads and writes both count as use).',
  signals: ['O(1) get AND put', '"least recently used" eviction', 'need ordering by recency plus key lookup', 'design / ops sequence'],
  insight:
    'A hashmap gives O(1) lookup but no order; a doubly linked list gives O(1) reordering but no lookup. Combine them: map key → list node, keep the list ordered from LRU (left) to MRU (right) with sentinel nodes on both ends.',
  hints: [
    'Which structure lets you move an element to the "most recent" end in O(1)?',
    'Removing a node from the middle in O(1) needs its predecessor — doubly linked.',
    'Sentinel left/right nodes mean insert and remove never deal with None neighbours.',
  ],
  pitfall: 'Forgetting that get() also counts as a use — the node must move to the MRU end on reads too, or the wrong key gets evicted.',
  backend: {
    title: 'In-process cache in front of a database (Memcached / Redis allkeys-lru)',
    detail:
      'A service caches user profiles in memory with a hard memory cap. Each request looks up user-id in a hashmap; a hit moves that entry to the "recent" end of a linked list, and when the cache is full the entry at the "old" end is dropped. This is how Memcached\'s slab LRU, Guava/Caffeine caches and Redis\'s allkeys-lru policy (approximately) work.',
  },
  complexity: { time: 'O(1) per op', space: 'O(capacity)' },
  code: `
class LRUCache:
    def __init__(self, capacity):
        self.cap, self.cache = capacity, {}              @init
        self.left, self.right = Node(0, 0), Node(0, 0)
        self.left.next, self.right.prev = self.right, self.left
    def remove(self, node):
        node.prev.next, node.next.prev = node.next, node.prev    @remove
    def insert(self, node):
        prev, nxt = self.right.prev, self.right
        prev.next = nxt.prev = node                              @insert
        node.next, node.prev = nxt, prev
    def get(self, key):
        if key in self.cache:                            @get
            self.remove(self.cache[key])                 @getRemove
            self.insert(self.cache[key])                 @getInsert
            return self.cache[key].val                   @getHit
        return -1                                        @getMiss
    def put(self, key, value):
        if key in self.cache:                            @put
            self.remove(self.cache[key])                 @putRemove
        self.cache[key] = Node(key, value)               @putNew
        self.insert(self.cache[key])                     @putInsert
        if len(self.cache) > self.cap:                   @overCap
            lru = self.left.next                         @lru
            self.remove(lru)                             @evict
            del self.cache[lru.key]                      @evictDel
`,
  explain: {
    init: 'left sentinel = least-recent end, right sentinel = most-recent end.',
    remove: 'O(1) unlink: the node knows both neighbours (doubly linked).',
    insert: 'Always insert just before the right sentinel = mark as most recently used.',
    getRemove: 'A read is a use: move the node to the MRU end.',
    putRemove: 'Updating an existing key: drop the old node first so the key is not duplicated in the list.',
    lru: 'left.next is the least recently used real node.',
    evictDel: 'The node stores its key so we can delete it from the map too.',
  },
  distractors: [
    { text: '            lru = self.right.prev', why: 'right.prev is the MOST recently used node — the one just inserted.' },
    { text: '            return self.cache[key].val', why: 'Returning without moving the node to the MRU end means reads do not refresh recency (that is FIFO, not LRU).' },
    { text: '        if len(self.cache) >= self.cap:', why: 'Evicts one entry too early: the check runs after inserting, so only > capacity is an overflow.' },
  ],
  input: {
    capacity: 2,
    ops: [
      ['put', 1, 1],
      ['put', 2, 2],
      ['get', 1],
      ['put', 3, 3],
      ['get', 2],
      ['put', 4, 4],
      ['get', 1],
      ['get', 3],
    ],
  },
  presets: [
    {
      label: 'update existing key',
      input: {
        capacity: 2,
        ops: [
          ['put', 1, 1],
          ['put', 2, 2],
          ['put', 1, 10],
          ['put', 3, 3],
          ['get', 2],
          ['get', 1],
        ],
      },
    },
    {
      label: 'capacity 1',
      input: {
        capacity: 1,
        ops: [
          ['put', 1, 1],
          ['put', 2, 2],
          ['get', 1],
          ['get', 2],
        ],
      },
    },
  ],
  validate: ({ capacity, ops }) => {
    if (typeof capacity !== 'number' || capacity < 1 || capacity > 4) return 'capacity must be 1–4';
    if (!Array.isArray(ops) || ops.length > 14) return 'Expected ≤ 14 ops';
    for (const op of ops) {
      if (!Array.isArray(op)) return 'Each op is ["get", key] or ["put", key, value]';
      if (op[0] === 'get' && typeof op[1] === 'number') continue;
      if (op[0] === 'put' && typeof op[1] === 'number' && typeof op[2] === 'number') continue;
      return `Bad op ${JSON.stringify(op)}`;
    }
    return null;
  },
  trace(t, { capacity, ops }) {
    type CN = ListNode<string>;
    const left = new ListNode<string>('LRU');
    const right = new ListNode<string>('MRU');
    left.next = right;
    const prevOf = new Map<CN, CN>([[right, left]]);
    const cache = new Map<number, CN>();
    const vals = new Map<CN, number>();
    const keyOf = new Map<CN, number>();
    const out: (number | null)[] = [];
    let opIdx = -1;
    let hl: number[] = [];
    let active: CN | null = null;
    let doomed: CN | null = null;
    let pending: CN | null = null;
    const remove = (node: CN) => {
      const p = prevOf.get(node)!;
      const nx = node.next!;
      p.next = nx;
      prevOf.set(nx, p);
    };
    const insert = (node: CN) => {
      const p = prevOf.get(right)!;
      p.next = node;
      prevOf.set(right, node);
      node.next = right;
      prevOf.set(node, p);
    };
    t.draw(() => [
      V.array('ops', ops.map((o) => `${o[0]}(${o.slice(1).join(',')})`), { pointers: { op: opIdx }, tones: opIdx >= 0 ? { [opIdx]: 'active' } : {}, showIndex: false }),
      V.list('recency list (LRU → MRU)', [...chain(left), ...(pending ? [pending] : []), ...(doomed && !chain(left).includes(doomed) ? [doomed] : [])], {
        tones: { [left.id]: 'muted', [right.id]: 'muted', ...one(active, 'active'), ...one(pending, 'info'), ...one(doomed, 'bad') },
        caption: 'doubly linked (prev arrows not drawn); left end is evicted first',
      }),
      V.map('cache (key → node)', [...cache.entries()].map(([k, n]) => [k, n.val] as [number, string]), { hl }),
      V.chips('outputs', out.map((x) => (x === null ? 'null' : x))),
    ]);
    t.step('init', `Empty cache with capacity ${capacity}: just the two sentinels, LRU ↔ MRU.`, { cap: capacity });
    let askedHit = false;
    let askedEvict = false;
    let askedMiss = false;
    for (opIdx = 0; opIdx < ops.length; opIdx++) {
      const [name, key, value] = ops[opIdx] as [string, number, number];
      active = null;
      doomed = null;
      hl = [key];
      if (name === 'get') {
        const node = cache.get(key);
        t.step('get', `get(${key}): is ${key} in the map? ${node ? 'Yes' : 'No'}.`, { key, size: cache.size });
        if (!node) {
          if (!askedMiss) {
            askedMiss = true;
            t.predict(`What does get(${key}) return?`, ['-1', String(key)], 0, `${key} is not in the cache${out.length ? ' (it was evicted or never added)' : ''}.`);
          }
          out.push(-1);
          t.step('getMiss', `Miss → return -1.`, { key });
          continue;
        }
        active = node;
        if (!askedHit) {
          askedHit = true;
          t.predict(`get(${key}) hits. Where does its node go?`, ['Next to MRU (right end)', 'Next to LRU (left end)', 'Stays where it is'], 0, 'A read counts as a use, so the node moves to the most-recent end.');
        }
        remove(node);
        pending = node;
        t.step('getRemove', `Unlink ${node.val} from its current position in O(1).`, { key });
        pending = null;
        insert(node);
        t.step('getInsert', `Re-insert it just before MRU: ${key} is now the most recently used.`, { key });
        out.push(vals.get(node)!);
        t.step('getHit', `Return ${vals.get(node)}.`, { key, result: vals.get(node) });
      } else {
        const old = cache.get(key);
        t.step('put', `put(${key}, ${value}): ${old ? 'key already cached — replace it' : 'new key'}.`, { key, value, size: cache.size });
        if (old) {
          doomed = old;
          remove(old);
          t.step('putRemove', `Unlink the old node ${old.val} so the key appears only once.`, { key, value });
          doomed = null;
        }
        const node = new ListNode<string>(`${key}:${value}`);
        vals.set(node, value);
        keyOf.set(node, key);
        cache.set(key, node);
        pending = node;
        t.step('putNew', `Create node ${node.val} and point cache[${key}] at it.`, { key, value, size: cache.size });
        pending = null;
        insert(node);
        active = node;
        t.step('putInsert', `Insert it before MRU — a write is also a use.`, { key, value, size: cache.size });
        const over = cache.size > capacity;
        t.step('overCap', `size ${cache.size} ${over ? '>' : '≤'} capacity ${capacity}${over ? ' — must evict' : ''}.`, { size: cache.size, cap: capacity });
        if (over) {
          const lru = left.next!;
          if (!askedEvict) {
            askedEvict = true;
            const keys = [...cache.keys()];
            t.predict('Which key gets evicted?', keys.map(String), keys.indexOf(keyOf.get(lru)!), `left.next (${lru.val}) is the least recently used — it has gone longest without a get or put.`);
          }
          doomed = lru;
          active = null;
          hl = [keyOf.get(lru)!];
          t.step('lru', `lru = left.next = ${lru.val}: the least recently used entry.`, { lru: lru.val });
          remove(lru);
          t.step('evict', `Unlink ${lru.val} from the list.`, { lru: lru.val });
          cache.delete(keyOf.get(lru)!);
          hl = [];
          t.step('evictDel', `Delete key ${keyOf.get(lru)} from the map (the node stored its key for exactly this).`, { size: cache.size });
          doomed = null;
        }
        out.push(null);
      }
    }
    opIdx = ops.length;
    active = null;
    hl = [];
    t.step(null, `All operations done. Outputs: ${out.map((x) => (x === null ? 'null' : x)).join(', ')}.`, {});
    return out;
  },
};

const live = <T>(p: Record<string, T | null | undefined>) => {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(p)) if (v) out[k] = v;
  return out;
};

const mergeKLists: Problem<{ lists: number[][] }> = {
  id: 'merge-k-sorted-lists',
  num: 23,
  title: 'Merge K Sorted Lists',
  difficulty: 'Hard',
  category: 'linked-list',
  pattern: 'linked-list',
  statement: 'You get k linked lists, each sorted ascending. Combine all their nodes into a single sorted linked list and return it.',
  signals: ['k already-sorted inputs', '"merge" into one sorted output', 'merging one-by-one is too slow (O(k·N))', 'reuse of Merge Two Sorted Lists'],
  insight:
    'Merge in rounds, tournament style: pair the lists up and merge each pair with the two-list merge. Each round halves the number of lists, so every node is touched only log k times — O(N log k). (A min-heap of the k front nodes achieves the same bound; we use pairwise merging here because it reuses the linked-list merge and needs no extra structure — see the Heap category for the heap version of this idea.)',
  hints: [
    'You already know how to merge two sorted lists. What is wrong with folding lists into one result one at a time?',
    'Merging list 1 with 2, 3 with 4, … halves the count each round — like merge sort\'s merge tree.',
    'Alternative: keep the k current heads in a min-heap and repeatedly pop the smallest.',
  ],
  pitfall: 'Merging sequentially into one growing result: the early nodes get re-scanned k times, giving O(k·N) instead of O(N log k).',
  backend: {
    title: 'Combining sorted results from k database shards',
    detail:
      'A query like "latest 100 orders across all shards" fans out to k shards, each returning rows sorted by timestamp. The coordinator merges the k sorted streams (pairwise rounds or a k-way heap) — the same step as the merge phase of an external sort or an LSM-tree compaction merging k sorted SSTables.',
  },
  complexity: { time: 'O(N log k)', space: 'O(1) extra (besides the round list)' },
  code: `
def mergeKLists(lists):
    if not lists: return None                         @empty
    while len(lists) > 1:                             @round
        merged = []                                   @newRound
        for i in range(0, len(lists), 2):             @pair
            l1, l2 = lists[i], (lists[i + 1] if i + 1 < len(lists) else None)   @pick
            merged.append(mergeList(l1, l2))          @merge
        lists = merged                                @swap
    return lists[0]                                   @done

def mergeList(l1, l2):
    dummy = tail = ListNode()                         @mInit
    while l1 and l2:                                  @mLoop
        if l1.val < l2.val:                           @mCmp
            tail.next, l1 = l1, l1.next               @mTake1
        else:
            tail.next, l2 = l2, l2.next               @mTake2
        tail = tail.next                              @mTail
    tail.next = l1 or l2                              @mRest
    return dummy.next                                 @mDone
`,
  explain: {
    round: 'Each round halves the number of lists: k → k/2 → … → 1.',
    pick: 'Pair neighbours; an odd list out is merged with None (i.e. carried over unchanged).',
    swap: 'The merged lists become the input of the next round.',
    mCmp: 'Standard two-list merge: smaller front node goes next.',
    mRest: 'Leftover tail is already sorted.',
  },
  distractors: [
    { text: '        res = mergeList(res, lists[i])', why: 'Folding one list at a time into a growing result re-walks the result k times: O(k·N).' },
    { text: '    while lists:', why: 'Loops forever once one list is left — the loop must stop at len(lists) == 1.' },
    { text: '        for i in range(len(lists) - 1):', why: 'Merges overlapping pairs (0,1), (1,2)… so nodes would be merged into two outputs at once.' },
  ],
  input: {
    lists: [
      [1, 4, 5],
      [1, 3, 4],
      [2, 6],
    ],
  },
  presets: [
    { label: 'four lists', input: { lists: [[1, 5], [2, 6], [3, 7], [4, 8]] } },
    { label: 'with empty list', input: { lists: [[], [1], [0, 2]] } },
  ],
  validate: ({ lists }) => {
    if (!Array.isArray(lists) || lists.length < 1 || lists.length > 4) return 'Expected { lists: number[][] } with 1–4 lists';
    for (const l of lists) {
      if (!isNumList(l, 4)) return 'Each list: ≤ 4 numbers';
      if (!l.every((x, i) => i === 0 || l[i - 1] <= x)) return 'Each list must be sorted ascending';
    }
    return null;
  },
  trace(t, { lists: raw }) {
    type N = ListNode<number | string>;
    const lbl = (h: N | null) => (h ? listValues(h).join('→') : '∅');
    let lists: (N | null)[] = raw.map((a) => buildList<number | string>(a).head);
    let roundLabels = lists.map(lbl);
    let merged: (N | null)[] | null = null;
    let pairI = -1;
    let dummy: N | null = null;
    let l1: N | null = null;
    let l2: N | null = null;
    let tail: N | null = null;
    const taken = new Set<string>();
    t.draw(() => [
      V.chips('lists (this round)', roundLabels, { tones: pairI >= 0 ? { [pairI]: 'active', [pairI + 1]: 'active' } : {} }),
      merged && V.chips('merged (next round)', merged.map(lbl), { tones: tones(merged.map((_, j) => j), 'good') }),
      dummy &&
        V.list('mergeList(l1, l2)', chain(dummy, l1, l2), {
          pointers: live({ l1, l2, tail }),
          tones: { [dummy.id]: 'muted', ...tones([...taken], 'good'), ...one(tail === dummy ? null : tail, 'active') },
        }),
    ]);
    t.step('empty', `${lists.length} list(s) to merge.`, { k: lists.length });
    let round = 0;
    let askedCmp = false;
    while (lists.length > 1) {
      t.step('round', `Round ${round + 1}: ${lists.length} lists left.`, { 'len(lists)': lists.length });
      if (round === 0) t.predict('How many lists will remain after this round?', [String(lists.length - 1), String(Math.ceil(lists.length / 2)), '1'], 1, 'Pairs merge into one list each, and an odd one out is carried over: ⌈k/2⌉.');
      merged = [];
      t.step('newRound', 'Start collecting this round\'s merged lists.', {});
      for (let i = 0; i < lists.length; i += 2) {
        pairI = i;
        t.step('pair', `Pair starting at index ${i}.`, { i });
        l1 = lists[i];
        l2 = i + 1 < lists.length ? lists[i + 1] : null;
        t.step('pick', `l1 = ${lbl(l1)}, l2 = ${i + 1 < lists.length ? lbl(l2) : 'None (odd one out)'}.`, { i });
        dummy = new ListNode<number | string>('dummy');
        tail = dummy;
        taken.clear();
        t.step('mInit', 'mergeList: fresh dummy + tail.', {});
        while (l1 && l2) {
          t.step('mLoop', `Fronts: ${l1.val} and ${l2.val}.`, { 'l1.val': l1.val, 'l2.val': l2.val });
          const one1 = (l1.val as number) < (l2.val as number);
          t.step('mCmp', `${l1.val} < ${l2.val}? ${one1 ? 'Yes' : 'No'}.`, { 'l1.val': l1.val, 'l2.val': l2.val });
          if (!askedCmp) {
            askedCmp = true;
            t.predict('Which front node is attached next?', [`l1's ${l1.val}`, `l2's ${l2.val}`], one1 ? 0 : 1, one1 ? `${l1.val} is strictly smaller.` : `${l2.val} is smaller or equal (ties go to l2 with a strict <).`);
          }
          if (one1) {
            tail.next = l1;
            taken.add(l1.id);
            l1 = l1.next;
            t.step('mTake1', `Attach ${tail.next.val} from l1.`, {});
          } else {
            tail.next = l2;
            taken.add(l2.id);
            l2 = l2.next;
            t.step('mTake2', `Attach ${tail.next.val} from l2.`, {});
          }
          tail = tail.next!;
          t.step('mTail', `tail → ${tail.val}.`, {});
        }
        tail.next = l1 ?? l2;
        for (const n of chain(l1 ?? l2)) taken.add(n.id);
        t.step('mRest', l1 || l2 ? `Attach the leftover ${lbl(l1 ?? l2)} in one link.` : 'Nothing left over.', {});
        const res = dummy.next;
        t.step('mDone', `mergeList returns ${lbl(res)}.`, {});
        merged.push(res);
        dummy = null;
        l1 = l2 = tail = null;
        t.step('merge', `merged = [${merged.map(lbl).join(', ')}].`, { 'len(merged)': merged.length });
      }
      pairI = -1;
      lists = merged;
      roundLabels = lists.map(lbl);
      merged = null;
      t.step('swap', `Next round works on ${lists.length} list(s).`, { 'len(lists)': lists.length });
      round++;
    }
    const res = listValues(lists[0] ?? null);
    t.step('done', `One list left: ${res.join(' → ') || 'empty'}.`, { result: res });
    return res;
  },
};

const reverseKGroup: Problem<{ values: number[]; k: number }> = {
  id: 'reverse-nodes-in-k-group',
  num: 25,
  title: 'Reverse Nodes in k-Group',
  difficulty: 'Hard',
  category: 'linked-list',
  pattern: 'linked-list',
  statement:
    'Reverse the nodes of a linked list k at a time and return the new head. A final group with fewer than k nodes stays in its original order. Only links may change.',
  signals: ['"k at a time"', 'leftover group stays as is', 'in place / O(1) space', 'reversal plus re-attaching to neighbours'],
  insight:
    'Treat each group as a mini Reverse Linked List, but seed prev with the node AFTER the group so the reversed group\'s tail is already attached to what follows. Then hook the node before the group (groupPrev) to the group\'s new head (kth).',
  hints: [
    'Before reversing a group, check that k nodes actually exist.',
    'You need the node before the group (to re-point it) and the node after it (to attach the new tail).',
    'Initialise prev = kth.next instead of None — the old first node then points to the next group automatically.',
  ],
  pitfall: 'Advancing groupPrev to kth after the reversal — kth is now the group\'s HEAD; the node before the next group is the old first node.',
  backend: {
    title: 'Batch-reversing message order for per-batch LIFO processing',
    detail:
      'A message broker consumer receives a linked chain of messages and processes them in fixed-size batches where, inside each batch, the newest message must be applied first (e.g. "last write wins" compaction per batch). Re-linking each k-sized batch in place — and leaving a partial final batch untouched until it fills — avoids copying payloads.',
  },
  complexity: { time: 'O(n)', space: 'O(1)' },
  code: `
def reverseKGroup(head, k):
    dummy = groupPrev = ListNode(0, head)     @init
    while True:                               @loop
        kth = getKth(groupPrev, k)            @kth
        if not kth: break                     @stop
        groupNext = kth.next                  @gnext
        prev, curr = kth.next, groupPrev.next @rinit
        while curr != groupNext:              @rloop
            tmp = curr.next                   @rsave
            curr.next = prev                  @rflip
            prev, curr = curr, tmp            @radv
        tmp = groupPrev.next                  @fix
        groupPrev.next = kth                  @attach
        groupPrev = tmp                       @move
    return dummy.next                         @done

def getKth(curr, k):
    while curr and k > 0:
        curr, k = curr.next, k - 1
    return curr
`,
  explain: {
    kth: 'Walk k steps from groupPrev; None means fewer than k nodes remain.',
    rinit: 'prev = the node after the group, so the group\'s old first node gets linked to the rest automatically.',
    rloop: 'Ordinary reversal, bounded by groupNext instead of None.',
    fix: 'The old first node of the group is now its last — it is the next groupPrev.',
    attach: 'Hook the previous part of the list onto the group\'s new head.',
  },
  distractors: [
    { text: '        prev, curr = None, groupPrev.next', why: 'The reversed group\'s tail would point to None, cutting off the rest of the list.' },
    { text: '        groupPrev = kth', why: 'After reversal kth is the group\'s head; groupPrev must become the group\'s new TAIL (old first node).' },
    { text: '        while curr:', why: 'Reverses past the group boundary — the reversal must stop at groupNext.' },
  ],
  input: { values: [1, 2, 3, 4, 5], k: 2 },
  presets: [
    { label: 'k = 3', input: { values: [1, 2, 3, 4, 5], k: 3 } },
    { label: 'k = 1 (no change)', input: { values: [1, 2, 3], k: 1 } },
  ],
  validate: ({ values, k }) =>
    !isNumList(values, 10) || values.length < 1 || typeof k !== 'number'
      ? 'Expected { values: number[] (1–10), k: number }'
      : k < 1 || k > values.length
        ? 'k must be between 1 and the list length'
        : null,
  trace(t, { values, k }) {
    type N = ListNode<number | string>;
    const { head, nodes } = buildList<number | string>(values);
    const dummy = new ListNode<number | string>('dummy', head);
    let groupPrev: N = dummy;
    let kth: N | null = null;
    let groupNext: N | null = null;
    let prev: N | null = null;
    let curr: N | null = null;
    const doneIds = new Set<string>();
    let group: string[] = [];
    t.draw(() => [
      V.list('list (original positions)', [dummy, ...nodes], {
        pointers: live({ groupPrev, kth, groupNext, prev, curr }),
        tones: { [dummy.id]: 'muted', ...tones([...doneIds], 'good'), ...tones(group, 'info'), ...one(curr, 'active') },
        caption: 'blue = current group, green = finished groups',
      }),
    ]);
    t.step('init', 'dummy sits before head; groupPrev is the node just before the next group.', { k });
    let g = 0;
    for (;;) {
      t.step('loop', `Look for group #${g + 1}.`, { groupPrev: valOf(groupPrev) });
      let c: N | null = groupPrev;
      for (let s = k; c && s > 0; s--) c = c.next;
      kth = c;
      group = [];
      for (let p = groupPrev.next; p && kth && p !== kth.next; p = p.next) group.push(p.id);
      t.step('kth', kth ? `Walk ${k} steps from groupPrev: kth = ${kth.val}.` : `Fewer than ${k} nodes remain after ${valOf(groupPrev)} → kth = None.`, { kth: valOf(kth) });
      if (!kth) {
        if (g > 0 || values.length < k) t.predict('Will this short tail be reversed?', ['Yes', 'No — it stays in order'], 1, 'Only full groups of k are reversed.');
        t.step('stop', 'Not a full group — stop.', {});
        break;
      }
      if (g === 0) t.predict('After this group is reversed, what will groupPrev.next point to?', [valOf(groupPrev.next), valOf(kth)], 1, `kth (${kth.val}) is the last node of the group, so it becomes the group's first.`);
      groupNext = kth.next;
      t.step('gnext', `groupNext = ${valOf(groupNext)} — the first node after this group.`, { kth: valOf(kth), groupNext: valOf(groupNext) });
      prev = kth.next;
      curr = groupPrev.next;
      t.step('rinit', `prev = ${valOf(prev)} (not None!) so the group's old first node will link to the rest; curr = ${valOf(curr)}.`, { prev: valOf(prev), curr: valOf(curr) });
      if (g === 0) t.predict(`After the first flip, where will node ${valOf(curr)} point?`, ['None', valOf(groupNext)], 1, 'prev was seeded with groupNext, so the old first node already points past the group.');
      while (curr !== groupNext) {
        t.step('rloop', `curr (${valOf(curr)}) is still inside the group.`, { prev: valOf(prev), curr: valOf(curr) });
        const tmp: N | null = curr!.next;
        t.step('rsave', `Save tmp = ${valOf(tmp)}.`, { prev: valOf(prev), curr: valOf(curr), tmp: valOf(tmp) });
        curr!.next = prev;
        t.step('rflip', `${valOf(curr)} → ${valOf(prev)}.`, { prev: valOf(prev), curr: valOf(curr) });
        prev = curr;
        curr = tmp;
        t.step('radv', `prev = ${valOf(prev)}, curr = ${valOf(curr)}.`, { prev: valOf(prev), curr: valOf(curr) });
      }
      t.step('rloop', 'curr reached groupNext — this group is reversed.', { prev: valOf(prev), curr: valOf(curr) });
      prev = curr = null;
      const first = groupPrev.next!;
      t.step('fix', `tmp = groupPrev.next = ${first.val}: the old first node, now the group's tail.`, { tmp: valOf(first) });
      groupPrev.next = kth;
      t.step('attach', `groupPrev (${valOf(groupPrev)}) now points at the new group head ${kth.val}.`, { groupPrev: valOf(groupPrev), kth: valOf(kth) });
      for (const id of group) doneIds.add(id);
      group = [];
      groupPrev = first;
      kth = groupNext = null;
      t.step('move', `groupPrev moves to ${first.val}, the node right before the next group.`, { groupPrev: valOf(groupPrev) });
      g++;
    }
    group = [];
    const res = listValues(dummy.next);
    t.step('done', `Result: ${res.join(' → ')}.`, { result: res });
    return res;
  },
};

export const problems: Problem[] = [
  reverseList,
  mergeTwoLists,
  reorderList,
  removeNth,
  copyRandomList,
  addTwoNumbers,
  hasCycle,
  findDuplicate,
  lruCache,
  mergeKLists,
  reverseKGroup,
];

export const variants: Variant[] = [
  {
    id: 'rotate-list-right-by-k',
    title: 'Rotate a Linked List Right by k',
    statement:
      'Given a linked list and an integer k (possibly larger than the length), move the last k nodes to the front, keeping their order, and return the new head. Do it in O(1) extra space.',
    pattern: 'linked-list',
    nearest: 'remove-nth-node-from-end-of-list',
    signals: ['"k-th from the end" in disguise', 'k may exceed the length (take k mod n)', 'in place — only re-link'],
    approach:
      'Walk once to get the length n and the tail; k %= n. The new tail is the (n − k)-th node: walk to it, set newHead = newTail.next, newTail.next = None, oldTail.next = oldHead. (Or keep two pointers k apart as in Remove Nth.)',
    backend:
      'Round-robin rotation of a linked ring of upstream servers in a load balancer after k requests were dispatched — re-linking the chain is O(1) memory and no copying.',
  },
  {
    id: 'palindrome-linked-list-o1',
    title: 'Is This Linked List a Palindrome?',
    statement: 'Return True if the values of a singly linked list read the same forwards and backwards, using O(1) extra memory.',
    pattern: 'fast-slow',
    nearest: 'reorder-list',
    signals: ['compare front against back', 'singly linked — cannot walk back', 'O(1) space'],
    approach:
      'Same first two phases as Reorder List: slow/fast to find the middle, reverse the second half, then walk both halves comparing values (optionally reverse back to restore the list).',
    backend:
      'Validating that a chain of mirrored migration steps (up/down migrations stored as a linked chain) is symmetric before running a rollback.',
  },
  {
    id: 'redirect-loop-entry',
    title: 'First URL in a Redirect Loop',
    statement:
      'Each URL redirects to exactly one other URL, given as a next-pointer chain starting at an entry URL. If following redirects eventually loops, return the first URL that is part of the loop; otherwise return None. Use O(1) memory.',
    pattern: 'fast-slow',
    nearest: 'find-the-duplicate-number',
    signals: ['each element points to exactly one next', '"loop" / "cycle" with O(1) memory', 'need where the loop STARTS, not just whether it exists'],
    approach:
      'Floyd: slow 1 step, fast 2 steps until they meet (or fast hits the end → no loop). Reset one pointer to the entry and move both 1 step; they meet at the loop entrance.',
    backend:
      'An HTTP client or CDN config validator that must report which rule introduced a redirect loop, without storing every visited URL for very long chains.',
  },
  {
    id: 'recent-unique-visitors',
    title: 'Last N Distinct Visitors',
    statement:
      'Design a structure that records user logins and can return the N most recent DISTINCT users, newest first. A repeat login moves the user to the front. login and getRecent must be O(1) / O(N).',
    pattern: 'design',
    nearest: 'lru-cache',
    signals: ['recency ordering with re-touch', 'O(1) updates', 'fixed capacity with eviction of the oldest'],
    approach:
      'Exactly the LRU structure: hashmap user → node in a doubly linked list. On login, unlink the node if present and insert at the MRU end; if size > N, evict the LRU end. getRecent walks from the MRU end.',
    backend: 'The "recently active users" widget in an admin dashboard or the "recent devices" list in an auth service, backed by an in-memory LRU per account.',
  },
];
