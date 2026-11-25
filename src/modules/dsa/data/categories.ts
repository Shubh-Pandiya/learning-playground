import type { Category } from '../engine/types.ts';

export const categories: Category[] = [
  { id: 'arrays-hashing', order: 1, name: 'Arrays & Hashing', blurb: 'Trade memory for time: remember what you have seen so each lookup is O(1).' },
  { id: 'two-pointers', order: 2, name: 'Two Pointers', blurb: 'Two indices walking a sorted/symmetric sequence, each step discarding impossible answers.' },
  { id: 'sliding-window', order: 3, name: 'Sliding Window', blurb: 'A contiguous range that grows on the right and shrinks on the left while staying valid.' },
  { id: 'stack', order: 4, name: 'Stack', blurb: 'Last-in-first-out: matching, undo, and "nearest greater/smaller" questions.' },
  { id: 'binary-search', order: 5, name: 'Binary Search', blurb: 'Halve a sorted (or monotonic) search space every step — including searching on the answer.' },
  { id: 'linked-list', order: 6, name: 'Linked List', blurb: 'Pointer surgery: dummy heads, reversal, fast/slow runners.' },
  { id: 'trees', order: 7, name: 'Trees', blurb: 'Recursion that trusts subtrees: DFS returns facts upward, BFS sweeps level by level.' },
  { id: 'tries', order: 8, name: 'Tries', blurb: 'Prefix trees: share common prefixes so lookups cost O(word length).' },
  { id: 'heap', order: 9, name: 'Heap / Priority Queue', blurb: 'Always know the current min/max in O(log n): top-k, scheduling, streaming medians.' },
  { id: 'backtracking', order: 10, name: 'Backtracking', blurb: 'Choose → explore → un-choose. Enumerate a decision tree and prune dead branches.' },
  { id: 'graphs', order: 11, name: 'Graphs', blurb: 'BFS/DFS over grids and adjacency lists, cycle detection, topological order, union-find.' },
  { id: 'advanced-graphs', order: 12, name: 'Advanced Graphs', blurb: 'Weighted shortest paths, minimum spanning trees and Euler paths.' },
  { id: 'dp-1d', order: 13, name: '1-D Dynamic Programming', blurb: 'Answer for i built from a few earlier answers — recursion with memory.' },
  { id: 'dp-2d', order: 14, name: '2-D Dynamic Programming', blurb: 'Two changing parameters → a table. Strings, grids, knapsacks.' },
  { id: 'greedy', order: 15, name: 'Greedy', blurb: 'Make the locally best choice and prove it never hurts.' },
  { id: 'intervals', order: 16, name: 'Intervals', blurb: 'Sort by start (or end) and sweep: merge, insert, count overlaps.' },
  { id: 'math-geometry', order: 17, name: 'Math & Geometry', blurb: 'Matrix transforms, digit arithmetic, fast exponentiation.' },
  { id: 'bit-manipulation', order: 18, name: 'Bit Manipulation', blurb: 'XOR cancels, masks isolate, shifts multiply — O(1) space tricks.' },
];

export const categoryById = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<Category['id'], Category>;
