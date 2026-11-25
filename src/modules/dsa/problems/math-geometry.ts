import type { Problem, Tone, Variant } from '../engine/types.ts';
import { V, rc, tones } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Math & Geometry — matrix index juggling, digit arithmetic, and small number-theory tricks.
// ---------------------------------------------------------------------------

const isMatrix = (m: unknown): m is number[][] =>
  Array.isArray(m) && m.length > 0 && m.every((r) => Array.isArray(r) && r.length === (m[0] as unknown[]).length && r.every((v) => typeof v === 'number'));
const copyM = (m: number[][]) => m.map((r) => [...r]);

const rotateImage: Problem<{ matrix: number[][] }> = {
  id: 'rotate-image',
  num: 48,
  title: 'Rotate Image',
  difficulty: 'Medium',
  category: 'math-geometry',
  pattern: 'matrix',
  statement: 'Rotate an n × n matrix 90° clockwise, modifying it in place (no second matrix).',
  signals: ['square matrix', '"rotate 90 degrees"', '"in place" / O(1) extra space', 'cells move in cycles of four'],
  insight:
    'A 90° rotation moves cells in cycles of four: top → right → bottom → left → top. Work ring by ring from the outside in; save one corner in a temp and shift the other three around it.',
  hints: [
    'Where does matrix[0][0] go? And the cell that lands on [0][0] — where did it come from?',
    'Each ring (layer) rotates independently; inside a ring, cells rotate in groups of four.',
    'Keep l, r (= top, bottom) bounds; for i in range(r − l), save top-left and move left → top, bottom → left, right → bottom, saved → right.',
  ],
  pitfall: 'Rotating in the wrong direction by moving values clockwise one at a time — you overwrite a cell before saving it. Save top-left first, then fill it from the LEFT side (counter-clockwise reads).',
  backend: {
    title: 'Rotating map tiles / sensor frames on a memory-tight device',
    detail:
      'An edge service that normalises camera frames (or a game server rotating a tile chunk) must rotate a square pixel buffer 90° without allocating a second buffer. Layer-by-layer four-way swaps touch each pixel once with O(1) extra memory — the same in-place index arithmetic used by image libraries.',
  },
  complexity: { time: 'O(n²)', space: 'O(1)' },
  code: `
def rotate(matrix):
    l, r = 0, len(matrix) - 1                                  @init
    while l < r:                                               @layer
        top, bottom = l, r                                     @bounds
        for i in range(r - l):                                 @loop
            topLeft = matrix[top][l + i]                       @save
            matrix[top][l + i] = matrix[bottom - i][l]         @leftToTop
            matrix[bottom - i][l] = matrix[bottom][r - i]      @bottomToLeft
            matrix[bottom][r - i] = matrix[top + i][r]         @rightToBottom
            matrix[top + i][r] = topLeft                       @topLeftToRight
        l, r = l + 1, r - 1                                    @shrink
`,
  explain: {
    init: 'Outer ring first: columns l..r, rows l..r.',
    layer: 'Stop when the ring collapses to a single centre cell (or nothing).',
    loop: 'A ring of side k has k − 1 groups of four cells (corners are shared).',
    save: 'The only temp needed: the cell about to be overwritten first.',
    leftToTop: 'Moving counter-clockwise while writing means every source is still intact when it is read.',
    shrink: 'Step inward to the next ring.',
  },
  distractors: [
    { text: '        for i in range(r - l + 1):', why: 'Off by one: the last corner was already moved as the first cell of this ring, so it would rotate twice.' },
    { text: '            matrix[top][l + i] = matrix[top + i][r]', why: 'Reads from the right side — that rotates counter-clockwise instead of clockwise.' },
    { text: '            matrix[top + i][r] = matrix[top][l + i]', why: 'The top cell was already overwritten; you must use the saved topLeft.' },
  ],
  input: { matrix: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] },
  presets: [
    { label: '4 × 4 (two rings)', input: { matrix: [[5, 1, 9, 11], [2, 4, 8, 10], [13, 3, 6, 7], [15, 14, 12, 16]] } },
    { label: '1 × 1', input: { matrix: [[7]] } },
  ],
  validate: ({ matrix }) =>
    !isMatrix(matrix) || matrix.length !== matrix[0].length ? 'Expected { matrix: number[n][n] } (square)' : matrix.length > 5 ? 'Keep n ≤ 5' : null,
  trace(t, { matrix }) {
    const m = copyM(matrix);
    let l = 0;
    let r = m.length - 1;
    let cells: [number, number][] = [];
    let write: [number, number] | null = null;
    let topLeft: number | null = null;
    let asked = 0;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (let k = l; k <= r && l < r; k++) for (const [a, b] of [[l, k], [r, k], [k, l], [k, r]]) tn[rc(a, b)] = 'info';
      for (const [a, b] of cells) tn[rc(a, b)] = 'active';
      if (write) tn[rc(write[0], write[1])] = 'warn';
      return [
        V.grid('matrix', m, { tones: tn, caption: 'blue = current ring · highlighted = the 4 cells of this rotation · orange = cell just written' }),
        V.chips('topLeft (saved)', topLeft === null ? [] : [topLeft], { tones: { 0: 'warn' } }),
      ];
    });
    t.step('init', `Start with the outer ring: l = ${l}, r = ${r}.`, { l, r });
    const rings = Math.floor(m.length / 2);
    t.predict(`How many rings does a ${m.length} × ${m.length} matrix have to rotate?`, ['0', '1', '2'], Math.min(rings, 2), `⌊n / 2⌋ = ${rings}${m.length % 2 ? ' — the centre cell stays put' : ''}.`);
    if (l >= r) t.step('layer', `l = ${l}, r = ${r}: l < r is false straight away.`, { l, r });
    while (l < r) {
      t.step('layer', `l = ${l} < r = ${r}: ring of side ${r - l + 1} to rotate.`, { l, r });
      const top = l;
      const bottom = r;
      t.step('bounds', `top = ${top}, bottom = ${bottom}.`, { top, bottom });
      for (let i = 0; i < r - l; i++) {
        cells = [
          [top, l + i],
          [top + i, r],
          [bottom, r - i],
          [bottom - i, l],
        ];
        write = null;
        t.step('loop', `i = ${i}: cycle (${top},${l + i}) → (${top + i},${r}) → (${bottom},${r - i}) → (${bottom - i},${l}) → back.`, { i });
        topLeft = m[top][l + i];
        t.step('save', `Save topLeft = ${topLeft} before it is overwritten.`, { topLeft });
        if (asked < 2) {
          asked++;
          const opts = [m[bottom - i][l], m[top + i][r], m[bottom][r - i]].map(String);
          t.predict(`Which value moves into the top cell (${top},${l + i})?`, opts, 0, `Clockwise rotation: the top is filled from the LEFT side — (${bottom - i},${l}) = ${m[bottom - i][l]}.`);
        }
        m[top][l + i] = m[bottom - i][l];
        write = [top, l + i];
        t.step('leftToTop', `Left → top: (${top},${l + i}) = ${m[top][l + i]}.`, {});
        m[bottom - i][l] = m[bottom][r - i];
        write = [bottom - i, l];
        t.step('bottomToLeft', `Bottom → left: (${bottom - i},${l}) = ${m[bottom - i][l]}.`, {});
        m[bottom][r - i] = m[top + i][r];
        write = [bottom, r - i];
        t.step('rightToBottom', `Right → bottom: (${bottom},${r - i}) = ${m[bottom][r - i]}.`, {});
        m[top + i][r] = topLeft;
        write = [top + i, r];
        t.step('topLeftToRight', `Saved topLeft → right: (${top + i},${r}) = ${topLeft}. These four cells are done.`, {});
        topLeft = null;
      }
      cells = [];
      write = null;
      l++;
      r--;
      t.step('shrink', `Ring finished. Move inward: l = ${l}, r = ${r}.`, { l, r });
      if (asked < 3) {
        asked++;
        t.predict('Is there another ring to rotate?', ['Yes', 'No'], l < r ? 0 : 1, l < r ? `l = ${l} < r = ${r}.` : l === r ? 'Only the centre cell is left — it maps to itself.' : 'The rings are exhausted.');
      }
    }
    t.step('layer', m.length === 1 ? 'A 1 × 1 matrix is its own rotation. Done.' : l === r ? `l == r: the centre (${l},${l}) stays put. Done.` : 'No ring left. Done.', { l, r });
    return m;
  },
};

const spiralMatrix: Problem<{ matrix: number[][] }> = {
  id: 'spiral-matrix',
  num: 54,
  title: 'Spiral Matrix',
  difficulty: 'Medium',
  category: 'math-geometry',
  pattern: 'matrix',
  statement: 'Return all elements of an m × n matrix in clockwise spiral order, starting from the top-left corner.',
  signals: ['"spiral order"', 'walk the border, then the inner border', 'rectangular (not necessarily square)', 'four directions in a fixed cycle'],
  insight:
    'Keep four walls — top, bottom, left, right. Walk the top row, then the right column, then the bottom row, then the left column; after each walk, move that wall inward.',
  hints: [
    'Which cells are visited before the spiral turns the first time?',
    'Use four boundaries and shrink one after each straight walk.',
    'Re-check left < right and top < bottom after the first two walks, otherwise a single remaining row or column is visited twice.',
  ],
  pitfall: 'Not re-checking the boundaries mid-loop: for a single remaining row the "bottom" walk re-reads the same row backwards.',
  backend: {
    title: 'Generating a spiral search pattern for geo lookups',
    detail:
      'A ride-hailing dispatcher looking for the nearest driver in a grid of geohash cells expands outward ring by ring around the rider\'s cell. Walking each ring with four boundaries (the same wall-shrinking bookkeeping, just in reverse) visits each cell exactly once without a visited set.',
  },
  complexity: { time: 'O(m·n)', space: 'O(1) besides the output' },
  code: `
def spiralOrder(matrix):
    res = []                                          @init
    left, right = 0, len(matrix[0])
    top, bottom = 0, len(matrix)
    while left < right and top < bottom:              @loop
        for i in range(left, right):                  @top
            res.append(matrix[top][i])                @takeTop
        top += 1                                      @shrinkTop
        for i in range(top, bottom):                  @right
            res.append(matrix[i][right - 1])          @takeRight
        right -= 1                                    @shrinkRight
        if not (left < right and top < bottom):       @guard
            break                                     @stop
        for i in range(right - 1, left - 1, -1):      @bottom
            res.append(matrix[bottom - 1][i])         @takeBottom
        bottom -= 1                                   @shrinkBottom
        for i in range(bottom - 1, top - 1, -1):      @left
            res.append(matrix[i][left])               @takeLeft
        left += 1                                     @shrinkLeft
    return res                                        @done
`,
  explain: {
    init: 'right and bottom are exclusive bounds (one past the last column / row).',
    shrinkTop: 'The top row is consumed — move the top wall down.',
    shrinkRight: 'The right column is consumed — move the right wall left.',
    guard: 'If only one row or column was left, it is already fully read; the backward walks would repeat it.',
    takeBottom: 'Bottom row right → left.',
    takeLeft: 'Left column bottom → top.',
  },
  distractors: [
    { text: '        for i in range(left, right + 1):', why: 'right is exclusive here; + 1 reads past the last column.' },
    { text: '            res.append(matrix[i][right])', why: 'right is one past the last column — use right − 1.' },
    { text: '        top -= 1', why: 'The top wall moves DOWN (inward) after reading the top row.' },
  ],
  input: { matrix: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]] },
  presets: [
    { label: 'square', input: { matrix: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] } },
    { label: 'single column', input: { matrix: [[1], [2], [3]] } },
  ],
  validate: ({ matrix }) => (!isMatrix(matrix) || !matrix[0].length ? 'Expected { matrix: number[m][n] }' : matrix.length > 5 || matrix[0].length > 6 ? 'Keep the matrix ≤ 5 × 6' : null),
  trace(t, { matrix }) {
    const R = matrix.length;
    const C = matrix[0].length;
    const res: number[] = [];
    const seen = new Set<string>();
    let left = 0;
    let right = C;
    let top = 0;
    let bottom = R;
    let cur: [number, number] | null = null;
    let asked = 0;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (const k of seen) tn[k] = 'muted';
      if (cur) tn[rc(cur[0], cur[1])] = 'active';
      const rowLabels = matrix.map((_, r) => [r === top ? 'top' : '', r === bottom - 1 ? 'bottom' : ''].filter(Boolean).join('/') || String(r));
      const colLabels = matrix[0].map((_, c) => [c === left ? 'L' : '', c === right - 1 ? 'R' : ''].filter(Boolean).join('/') || String(c));
      return [
        V.grid('matrix', matrix, { tones: tn, pointers: { cur }, rowLabels, colLabels, caption: 'labels mark the current walls · grey = already output' }),
        V.chips('res', res, { tones: res.length ? { [res.length - 1]: 'good' } : {} }),
      ];
    });
    const take = (key: string, r: number, c: number, note: string) => {
      cur = [r, c];
      seen.add(rc(r, c));
      res.push(matrix[r][c]);
      t.step(key, `${note} (${r},${c}) = ${matrix[r][c]}.`, { r, c, res: [...res] });
    };
    t.step('init', `Walls: top = 0, bottom = ${R} (exclusive), left = 0, right = ${C} (exclusive).`, { top, bottom, left, right });
    while (left < right && top < bottom) {
      t.step('loop', `left ${left} < right ${right} and top ${top} < bottom ${bottom}: cells remain.`, { top, bottom, left, right });
      t.step('top', `Walk the top row ${top}, columns ${left}..${right - 1}.`, { top });
      for (let i = left; i < right; i++) take('takeTop', top, i, 'Top row →');
      if (asked < 1) {
        asked++;
        t.predict('The top row is done. Which wall moves now?', ['top moves down', 'right moves left', 'nothing moves yet'], 0, 'The top row is consumed, so the top wall steps inward (down).');
      }
      top++;
      cur = null;
      t.step('shrinkTop', `top = ${top}.`, { top });
      t.step('right', `Walk the right column ${right - 1}, rows ${top}..${bottom - 1}.`, { right });
      for (let i = top; i < bottom; i++) take('takeRight', i, right - 1, 'Right column ↓');
      right--;
      cur = null;
      t.step('shrinkRight', `right = ${right}.`, { right });
      const ok = left < right && top < bottom;
      if (asked < 3) {
        asked++;
        t.predict(`Walls: top ${top}, bottom ${bottom}, left ${left}, right ${right}. Is there still something to walk?`, ['Yes — continue with the bottom row', 'No — break'], ok ? 0 : 1, ok ? 'Both ranges are non-empty.' : 'One of the ranges is empty: the remaining row/column was already read.');
      }
      if (!ok) {
        t.step('guard', 'A range collapsed — every cell has been read.', { top, bottom, left, right });
        t.step('stop', 'Break out of the loop.', {});
        break;
      }
      t.step('guard', 'Both ranges are still non-empty.', { top, bottom, left, right });
      t.step('bottom', `Walk the bottom row ${bottom - 1} right → left.`, { bottom });
      for (let i = right - 1; i >= left; i--) take('takeBottom', bottom - 1, i, 'Bottom row ←');
      bottom--;
      cur = null;
      t.step('shrinkBottom', `bottom = ${bottom}.`, { bottom });
      t.step('left', `Walk the left column ${left} bottom → top.`, { left });
      for (let i = bottom - 1; i >= top; i--) take('takeLeft', i, left, 'Left column ↑');
      left++;
      cur = null;
      t.step('shrinkLeft', `left = ${left}. One full ring done.`, { left });
    }
    cur = null;
    t.step('done', `Spiral order: [${res.join(', ')}].`, { res });
    return res;
  },
};

const setMatrixZeroes: Problem<{ matrix: number[][] }> = {
  id: 'set-matrix-zeroes',
  num: 73,
  title: 'Set Matrix Zeroes',
  difficulty: 'Medium',
  category: 'math-geometry',
  pattern: 'matrix',
  statement: 'Wherever the matrix holds a 0, turn its entire row and entire column into 0s. Do it in place, ideally with O(1) extra memory.',
  signals: ['"in place"', 'row/column-wide effect', 'O(1) extra space follow-up', 'decisions must use ORIGINAL zeros, not ones you wrote'],
  insight:
    'Use the first row and first column as the marker arrays: matrix[0][c] = 0 means "zero column c", matrix[r][0] = 0 means "zero row r". Row 0 itself needs one extra flag because matrix[0][0] is already used for column 0.',
  hints: [
    'With O(m + n) memory you would keep a set of zero rows and zero columns. Where could those flags live instead?',
    'Store the flags in row 0 and column 0 of the matrix itself.',
    'matrix[0][0] can only mean one thing — let it mean column 0, and keep a separate rowZero boolean for row 0. Apply row/col 0 last.',
  ],
  pitfall: 'Zeroing cells during the scan — the new zeros then look like original zeros and spread to the whole matrix.',
  backend: {
    title: 'Invalidating rows and columns of a feature-flag matrix in place',
    detail:
      'A config service stores a tenants × features availability matrix in a fixed memory slab. When a tenant (row) or feature (column) is hit by an incident, every cell in that row/column must be disabled. Marking in the first row/column then sweeping avoids allocating side tables — the same two-phase "mark, then apply" used to avoid cascading updates in place.',
  },
  complexity: { time: 'O(m·n)', space: 'O(1)' },
  code: `
def setZeroes(matrix):
    ROWS, COLS = len(matrix), len(matrix[0])          @init
    rowZero = False
    for r in range(ROWS):                             @scanR
        for c in range(COLS):                         @scanC
            if matrix[r][c] == 0:                     @isZero
                matrix[0][c] = 0                      @markCol
                if r > 0:                             @notFirst
                    matrix[r][0] = 0                  @markRow
                else:
                    rowZero = True                    @flagRow
    for r in range(1, ROWS):                          @fillR
        for c in range(1, COLS):                      @fillC
            if matrix[0][c] == 0 or matrix[r][0] == 0:   @readMarks
                matrix[r][c] = 0                      @zero
    if matrix[0][0] == 0:                             @col0
        for r in range(ROWS):                         @col0Loop
            matrix[r][0] = 0                          @col0Set
    if rowZero:                                       @row0
        for c in range(COLS):                         @row0Loop
            matrix[0][c] = 0                          @row0Set
`,
  explain: {
    init: 'rowZero remembers whether row 0 itself must be cleared (matrix[0][0] is taken by column 0).',
    markCol: 'Top cell of the column = "this column has a zero".',
    markRow: 'First cell of the row = "this row has a zero".',
    flagRow: 'A zero in row 0 cannot be recorded in matrix[0][0] (that means column 0), hence the flag.',
    readMarks: 'Only the inner cells first, so the markers are not destroyed while they are still being read.',
    col0: 'Column 0 is cleared after the inner cells, because its cells were markers.',
    row0: 'Row 0 last — it holds the column markers.',
  },
  distractors: [
    { text: '    for r in range(ROWS):', why: 'The fill pass must start at row 1 — row 0 still holds the column markers needed by other cells.' },
    { text: '            if matrix[0][c] == 0 and matrix[r][0] == 0:', why: 'A cell is zeroed if its row OR its column is marked, not only when both are.' },
    { text: '                matrix[0][0] = 0', why: 'matrix[0][0] already means "zero column 0"; a zero in row 0 must set the rowZero flag instead.' },
  ],
  input: { matrix: [[1, 2, 0, 4], [5, 6, 7, 8], [9, 0, 11, 12], [13, 14, 15, 16]] },
  presets: [
    { label: 'zero in the middle', input: { matrix: [[1, 1, 1], [1, 0, 1], [1, 1, 1]] } },
    { label: 'zeros in row 0', input: { matrix: [[0, 1, 2, 0], [3, 4, 5, 2], [1, 3, 1, 5]] } },
  ],
  validate: ({ matrix }) => (!isMatrix(matrix) || !matrix[0].length ? 'Expected { matrix: number[m][n] }' : matrix.length > 5 || matrix[0].length > 6 ? 'Keep the matrix ≤ 5 × 6' : null),
  trace(t, { matrix }) {
    const m = copyM(matrix);
    const ROWS = m.length;
    const COLS = m[0].length;
    let rowZero = false;
    let cur: [number, number] | null = null;
    const marks = new Set<string>();
    let markAsked = false;
    let fillAsked = 0;
    t.draw(() => {
      const tn: Record<string, Tone> = {};
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (r === 0 || c === 0) tn[rc(r, c)] = 'info';
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (m[r][c] === 0) tn[rc(r, c)] = 'bad';
      for (const k of marks) tn[k] = 'warn';
      if (cur) tn[rc(cur[0], cur[1])] = 'active';
      return [
        V.grid('matrix', m, { tones: tn, pointers: { cur }, caption: 'blue = marker row/col · orange = marker written · red = zero' }),
        V.map('flags', [['rowZero', rowZero]]),
      ];
    });
    t.step('init', `${ROWS} × ${COLS}. Row 0 and column 0 will double as marker arrays; rowZero covers row 0 itself.`, { ROWS, COLS, rowZero });
    for (let r = 0; r < ROWS; r++) {
      cur = null;
      t.step('scanR', `Scan row ${r}.`, { r });
      for (let c = 0; c < COLS; c++) {
        cur = [r, c];
        if (m[r][c] !== 0) {
          t.step('isZero', `(${r},${c}) = ${m[r][c]} — not zero.`, { r, c });
          continue;
        }
        t.step('isZero', `(${r},${c}) is an original 0.`, { r, c });
        m[0][c] = 0;
        marks.add(rc(0, c));
        t.step('markCol', `Mark column ${c}: matrix[0][${c}] = 0.`, { c });
        t.step('notFirst', r > 0 ? `r = ${r} > 0, so the row marker matrix[${r}][0] is free to use.` : 'r = 0: this zero is IN the marker row.', { r });
        if (!markAsked && r === 0) {
          markAsked = true;
          t.predict('How do we remember that row 0 must be zeroed?', ['Set matrix[0][0] = 0', 'Set the rowZero flag'], 1, 'matrix[0][0] already means "zero column 0", so row 0 needs its own flag.');
        }
        if (r > 0) {
          m[r][0] = 0;
          marks.add(rc(r, 0));
          t.step('markRow', `Mark row ${r}: matrix[${r}][0] = 0.`, { r });
        } else {
          rowZero = true;
          t.step('flagRow', 'rowZero = True — clear row 0 at the very end.', { rowZero });
        }
      }
    }
    for (let r = 1; r < ROWS; r++) {
      cur = null;
      t.step('fillR', `Fill row ${r} using the markers (inner cells only).`, { r });
      for (let c = 1; c < COLS; c++) {
        cur = [r, c];
        const z = m[0][c] === 0 || m[r][0] === 0;
        t.step('readMarks', `Column marker matrix[0][${c}] = ${m[0][c]}, row marker matrix[${r}][0] = ${m[r][0]}.`, { r, c });
        if (fillAsked < 2 && (fillAsked === 0 || z)) {
          fillAsked++;
          t.predict(`Does (${r},${c}) become 0?`, ['Yes', 'No'], z ? 0 : 1, z ? 'One of its markers is 0.' : 'Neither its row nor its column was marked.');
        }
        if (z && m[r][c] !== 0) {
          m[r][c] = 0;
          t.step('zero', `(${r},${c}) = 0.`, { r, c });
        }
      }
    }
    cur = null;
    t.step('col0', `matrix[0][0] = ${m[0][0]}: ${m[0][0] === 0 ? 'column 0 must be cleared' : 'column 0 stays'}.`, { 'matrix[0][0]': m[0][0] });
    if (m[0][0] === 0) {
      t.step('col0Loop', 'Clear column 0.', {});
      for (let r = 0; r < ROWS; r++) {
        m[r][0] = 0;
        cur = [r, 0];
        t.step('col0Set', `(${r},0) = 0.`, { r });
      }
    }
    cur = null;
    t.step('row0', `rowZero = ${rowZero ? 'True' : 'False'}: ${rowZero ? 'clear row 0 last' : 'row 0 stays'}.`, { rowZero });
    if (rowZero) {
      t.step('row0Loop', 'Clear row 0.', {});
      for (let c = 0; c < COLS; c++) m[0][c] = 0;
      t.step('row0Set', 'Row 0 is now all zeros. Done.', {});
    }
    marks.clear();
    return m;
  },
};

const sumSq = (n: number) => String(n).split('').reduce((s, d) => s + Number(d) ** 2, 0);
const sumSqText = (n: number) => String(n).split('').map((d) => `${d}²`).join(' + ');

const happyNumber: Problem<{ n: number }> = {
  id: 'happy-number',
  num: 202,
  title: 'Happy Number',
  difficulty: 'Easy',
  category: 'math-geometry',
  pattern: 'fast-slow',
  statement:
    'Repeatedly replace n by the sum of the squares of its digits. n is "happy" if this process reaches 1; otherwise it loops forever in a cycle that never contains 1. Return whether n is happy.',
  signals: ['"repeat the process" with a deterministic next value', '"loops endlessly in a cycle"', 'detect a cycle without extra memory', 'implicit linked list: x → f(x)'],
  insight:
    'x → sumSquareDigits(x) is an implicit linked list, and every chain ends in a cycle (1 → 1 is a cycle too). Run Floyd\'s slow/fast pointers on it: they always meet inside the cycle; n is happy exactly when they meet at 1.',
  hints: [
    'Write out the sequence for n = 2. What eventually happens?',
    'The sequence must repeat (values quickly drop below 243). Detecting a repeat is cycle detection — a hash set works.',
    'For O(1) memory use Floyd: slow takes one step, fast takes two; when they meet, check whether the meeting value is 1.',
  ],
  pitfall: 'Looping "while n != 1" with no cycle check — unhappy numbers then run forever.',
  backend: {
    title: 'Detecting redirect / alias loops',
    detail:
      'A URL shortener, DNS CNAME resolver or config "extends" chain follows next = f(current) links. A misconfiguration can create a loop. Floyd\'s two pointers detect it with constant memory — useful when chains are generated lazily or are too long to keep a visited set per request.',
  },
  complexity: { time: 'O(log n) per step; the chain length is bounded', space: 'O(1)' },
  code: `
def isHappy(n):
    slow, fast = n, sumSquareDigits(n)          @init
    while slow != fast:                         @loop
        fast = sumSquareDigits(fast)            @fast1
        fast = sumSquareDigits(fast)            @fast2
        slow = sumSquareDigits(slow)            @slow
    return fast == 1                            @done

def sumSquareDigits(n):
    output = 0
    while n:
        output += (n % 10) ** 2
        n = n // 10
    return output
`,
  explain: {
    init: 'Start fast one step ahead so the loop condition is not trivially false.',
    loop: 'In a cycle the gap between fast and slow shrinks by one each round, so they must meet.',
    fast1: 'fast moves two links per round…',
    slow: '…slow moves one.',
    done: 'Every chain ends in a cycle; 1 → 1 is the only "happy" cycle.',
  },
  distractors: [
    { text: '    while fast != 1:', why: 'For unhappy numbers fast never reaches 1 — infinite loop.' },
    { text: '    slow, fast = n, n', why: 'slow == fast immediately, so the loop never runs and every n looks "happy" only if n == 1.' },
    { text: '    return slow == n', why: 'The meeting point says nothing about n itself — the question is whether the cycle is 1 → 1.' },
  ],
  input: { n: 2 },
  presets: [
    { label: '19 (happy)', input: { n: 19 } },
    { label: '7 (happy, longer)', input: { n: 7 } },
    { label: '1', input: { n: 1 } },
  ],
  validate: ({ n }) => (!Number.isInteger(n) || n < 1 ? 'Expected { n: positive integer }' : n > 1e9 ? 'Keep n ≤ 10⁹' : null),
  trace(t, { n }) {
    const seq: number[] = [n];
    const at = (i: number) => {
      while (seq.length <= i) seq.push(sumSq(seq[seq.length - 1]));
      return seq[i];
    };
    let si = 0;
    let fi = 1;
    let cycle: number[] = [];
    let asked = 0;
    t.draw(() => {
      const tn: Record<number, Tone> = {};
      for (const i of cycle) tn[i] = seq[i] === 1 ? 'good' : 'bad';
      return [
        V.array('sequence  x → sumSquareDigits(x)', seq.slice(0, Math.max(fi, si) + 1), {
          pointers: { slow: si, fast: fi },
          tones: tn,
          caption: 'Index = how many steps from n. slow moves 1 step per round, fast moves 2.',
        }),
      ];
    });
    at(1);
    t.step('init', `slow = ${n}; fast = sumSquareDigits(${n}) = ${sumSqText(n)} = ${seq[1]}.`, { slow: seq[si], fast: seq[fi] });
    while (at(si) !== at(fi)) {
      t.step('loop', `slow = ${seq[si]} ≠ fast = ${seq[fi]}: keep going.`, { slow: seq[si], fast: seq[fi] });
      const f0 = seq[fi];
      fi++;
      at(fi);
      t.step('fast1', `fast = ${sumSqText(f0)} = ${seq[fi]}.`, { fast: seq[fi] });
      const f1 = seq[fi];
      if (asked < 1 && String(f1).length > 1) {
        asked++;
        const right = sumSq(f1);
        const wrong1 = String(f1).split('').reduce((s, d) => s + Number(d), 0);
        const opts = [...new Set([right, wrong1, right + 1].map(String))];
        t.predict(`fast takes its second step from ${f1}. What is sumSquareDigits(${f1})?`, opts, opts.indexOf(String(right)), `${sumSqText(f1)} = ${right}.`);
      }
      fi++;
      at(fi);
      t.step('fast2', `fast = ${sumSqText(f1)} = ${seq[fi]}.`, { fast: seq[fi] });
      const s0 = seq[si];
      si++;
      t.step('slow', `slow = ${sumSqText(s0)} = ${seq[si]}.`, { slow: seq[si] });
      if (si > 40) break;
    }
    const meet = seq[fi];
    t.step('loop', `slow == fast == ${meet}: the pointers met, so we are inside the cycle.`, { slow: seq[si], fast: seq[fi] });
    t.predict(`They met at ${meet}. Is ${n} a happy number?`, ['True', 'False'], meet === 1 ? 0 : 1, meet === 1 ? 'They met at 1, and 1 → 1 is the happy cycle.' : `${meet} is in a cycle that does not contain 1, so the process never reaches 1.`);
    const first = seq.indexOf(meet);
    let j = first;
    cycle = [];
    do {
      cycle.push(j);
      j++;
    } while (j < seq.length && seq[j] !== meet);
    t.step('done', meet === 1 ? `Return True — ${n} is happy.` : `Return False — the cycle ${cycle.map((i) => seq[i]).join(' → ')} → ${meet} never hits 1.`, { result: meet === 1 });
    return meet === 1;
  },
};

const plusOne: Problem<{ digits: number[] }> = {
  id: 'plus-one',
  num: 66,
  title: 'Plus One',
  difficulty: 'Easy',
  category: 'math-geometry',
  pattern: 'math',
  statement: 'A large integer is given as an array of its decimal digits (most significant first). Add one and return the resulting digit array.',
  signals: ['number stored as a digit array', 'too big for a machine integer', 'carry propagation', 'only + 1, so the carry stops at the first non-9'],
  insight: 'Walk from the last digit. A digit < 9 just increments and you are done. A 9 becomes 0 and the carry moves left. If every digit was 9, prepend a 1.',
  hints: [
    'What happens when the last digit is not 9?',
    'A 9 turns into 0 and passes a carry to the left — keep walking.',
    'If the loop finishes, all digits were 9: the answer is [1] followed by zeros.',
  ],
  pitfall: 'Converting the array to an int and back — fine in Python, but overflows in most languages for long inputs, which is the whole point of the problem.',
  backend: {
    title: 'Incrementing version counters / big sequence numbers stored as digits',
    detail:
      'Ledger systems and some ID generators store arbitrarily long decimal counters as strings or digit arrays (beyond 64-bit). Incrementing them in place with an early-exit carry loop is O(1) amortised — almost every increment touches one digit.',
  },
  complexity: { time: 'O(n) worst case, O(1) amortised', space: 'O(1) (O(n) only when the length grows)' },
  code: `
def plusOne(digits):
    for i in range(len(digits) - 1, -1, -1):     @loop
        if digits[i] < 9:                          @check
            digits[i] += 1                         @inc
            return digits                          @ret
        digits[i] = 0                              @carry
    return [1] + digits                            @grow
`,
  explain: {
    loop: 'Start at the least significant digit — that is where + 1 lands.',
    check: 'A digit below 9 can absorb the carry.',
    ret: 'The carry was absorbed; everything to the left is unchanged.',
    carry: '9 + 1 = 10: write 0, carry 1 to the next digit on the left.',
    grow: 'All digits were 9 (e.g. 999 → 1000).',
  },
  distractors: [
    { text: '    for i in range(len(digits)):', why: 'Adds from the most significant digit — the + 1 belongs at the end.' },
    { text: '        digits[i] += 1', why: 'Unconditionally incrementing turns 9 into 10, which is not a digit.' },
    { text: '    return digits + [1]', why: 'The new leading 1 goes at the front: 99 + 1 = 100, not 001.' },
  ],
  input: { digits: [1, 2, 9, 9] },
  presets: [
    { label: 'all nines', input: { digits: [9, 9, 9] } },
    { label: 'no carry', input: { digits: [4, 3, 2, 1] } },
  ],
  validate: ({ digits }) =>
    !Array.isArray(digits) || !digits.length || digits.some((d) => !Number.isInteger(d) || d < 0 || d > 9) ? 'Expected { digits: number[] } with digits 0–9' : digits.length > 15 ? 'Keep it ≤ 15 digits' : null,
  trace(t, { digits }) {
    const d = [...digits];
    let i: number | null = d.length - 1;
    let out: number[] | null = null;
    const zeroed = new Set<number>();
    let bumped: number | null = null;
    let asked = 0;
    t.draw(() => [
      V.array('digits', d, {
        pointers: { i },
        tones: { ...tones([...zeroed], 'warn'), ...(bumped !== null ? { [bumped]: 'good' as Tone } : {}) },
        caption: 'orange = 9 rolled over to 0 · green = digit that absorbed the carry',
      }),
      V.chips('carry', [out ? 0 : 1], { tones: { 0: out ? 'muted' : 'active' } }),
      out && V.array('result', out, { tones: { 0: 'good' } }),
    ]);
    for (let k = d.length - 1; k >= 0; k--) {
      i = k;
      t.step('loop', `i = ${k}: add the carry (1) to digits[${k}] = ${d[k]}.`, { i: k, 'digits[i]': d[k] });
      if (asked < 2 && (asked === 0 || d[k] < 9)) {
        asked++;
        t.predict(`digits[${k}] = ${d[k]}. What happens here?`, ['It becomes digit + 1 and we return', 'It becomes 0 and the carry moves left'], d[k] < 9 ? 0 : 1, d[k] < 9 ? `${d[k]} + 1 = ${d[k] + 1} fits in one digit.` : '9 + 1 = 10: write 0, carry 1.');
      }
      if (d[k] < 9) {
        t.step('check', `${d[k]} < 9 — it can absorb the carry.`, { 'digits[i]': d[k] });
        d[k]++;
        bumped = k;
        t.step('inc', `digits[${k}] = ${d[k]}.`, { 'digits[i]': d[k] });
        out = [...d];
        t.step('ret', `Return [${d.join(', ')}].`, { result: d });
        return d;
      }
      t.step('check', '9 cannot absorb the carry.', { 'digits[i]': d[k] });
      d[k] = 0;
      zeroed.add(k);
      t.step('carry', `digits[${k}] = 0; the carry moves to index ${k - 1}.`, { 'digits[i]': 0 });
    }
    i = null;
    out = [1, ...d];
    t.step('grow', `Every digit was 9 — prepend 1: [${out.join(', ')}].`, { result: out });
    return out;
  },
};

const powXN: Problem<{ x: number; n: number }> = {
  id: 'powx-n',
  num: 50,
  title: 'Pow(x, n)',
  difficulty: 'Medium',
  category: 'math-geometry',
  pattern: 'math',
  statement: 'Implement pow(x, n): x raised to the integer power n (n may be negative). Use far fewer than |n| multiplications.',
  signals: ['"implement pow" / large exponent', 'n up to 2³¹ — O(n) is too slow', 'negative exponent', 'binary representation of n'],
  insight:
    'Exponentiation by squaring: write n in binary. x^n is the product of x^(2^k) for every set bit k. Square the base each round (x, x², x⁴, x⁸, …) and multiply it in whenever the current bit of n is 1 — O(log n) multiplications.',
  hints: [
    'x^10 = x^8 · x^2. Where do 8 and 2 come from?',
    '10 = 1010₂. Keep a base that goes x, x², x⁴, x⁸… by squaring, and multiply the result by the base when the bit is set.',
    'For n < 0 compute (1/x)^(−n).',
  ],
  pitfall: 'Multiplying x by itself n times (O(n), times out for n ≈ 2³¹), or forgetting negative n.',
  backend: {
    title: 'Modular exponentiation in crypto and hashing',
    detail:
      'RSA, Diffie-Hellman and signature checks compute a^e mod m with exponents thousands of bits long; rolling-hash libraries precompute base^k mod p. All of them use square-and-multiply over the bits of the exponent — the exact loop here, plus a "% m" after every multiplication.',
  },
  complexity: { time: 'O(log |n|)', space: 'O(1)' },
  code: `
def myPow(x, n):
    if n < 0:                       @neg
        x, n = 1 / x, -n            @flip
    res, base = 1, x                @init
    while n:                        @loop
        if n & 1:                   @bit
            res *= base             @take
        base *= base                @square
        n >>= 1                     @shift
    return res                      @done
`,
  explain: {
    flip: 'x^(−n) = (1/x)^n, so only non-negative exponents remain.',
    init: 'base always holds x^(2^k) for the bit k currently being read.',
    bit: 'Lowest remaining bit of n.',
    take: 'This power of two is part of n, so its x^(2^k) is a factor of the answer.',
    square: 'x^(2^k) → x^(2^(k+1)).',
    shift: 'Drop the bit we just used.',
  },
  distractors: [
    { text: '        base *= x', why: 'Multiplying by x makes base x^(k+1) instead of x^(2^k) — back to O(n).' },
    { text: '            res *= x', why: 'The factor for bit k is x^(2^k) (the base), not x.' },
    { text: '        n -= 1', why: 'Removes one from n instead of dropping a bit — O(n) iterations.' },
  ],
  input: { x: 2, n: 10 },
  presets: [
    { label: 'negative n', input: { x: 2, n: -2 } },
    { label: '3^13', input: { x: 3, n: 13 } },
    { label: 'n = 0', input: { x: 5, n: 0 } },
  ],
  validate: ({ x, n }) =>
    typeof x !== 'number' || !Number.isInteger(n)
      ? 'Expected { x: number, n: integer }'
      : Math.abs(n) > 255 || Math.abs(x) > 10
        ? 'Keep |n| ≤ 255 and |x| ≤ 10'
        : x === 0 && n < 0
          ? '0 to a negative power is undefined'
          : null,
  trace(t, { x, n }) {
    const n0 = Math.abs(n);
    const width = Math.max(4, n0.toString(2).length);
    let xx = x;
    let nn = n;
    let res = 1;
    let base = x;
    let k = 0;
    const powers: number[] = [];
    const taken = new Set<number>();
    let cur: number | null = null;
    let asked = 0;
    const show = (v: number) => Math.round(v * 1e6) / 1e6;
    t.draw(() => [
      V.bits(
        'exponent',
        [
          { label: `|n| = ${n0}`, value: n0, tones: { ...tones([...taken], 'good'), ...(cur !== null ? { [cur]: 'active' as Tone } : {}) } },
          { label: 'n (remaining)', value: Math.max(nn, 0), tones: nn > 0 ? { 0: 'active' } : {} },
        ],
        { width, caption: 'green = bits whose power was multiplied into res' },
      ),
      V.array('base = x^(2^k)', powers, { pointers: { k: cur }, tones: tones([...taken], 'good'), caption: 'index k → x^(2^k)' }),
      V.map('state', [
        ['x', show(xx)],
        ['res', show(res)],
        ['base', show(base)],
      ]),
    ]);
    if (n < 0) {
      t.step('neg', `n = ${n} is negative.`, { x, n });
      xx = 1 / x;
      nn = -n;
      base = xx;
      t.step('flip', `x = 1/${x} = ${show(xx)}, n = ${nn}.`, { x: xx, n: nn });
    } else {
      t.step('neg', `n = ${n} ≥ 0 — no flip needed.`, { x, n });
    }
    powers.push(show(base));
    t.step('init', `res = 1, base = x = ${show(base)}. |n| in binary: ${n0.toString(2)}.`, { res, base, n: nn });
    while (nn) {
      cur = k;
      t.step('loop', `n = ${nn} (${nn.toString(2)}₂) ≠ 0.`, { n: nn });
      const set = (nn & 1) === 1;
      if (asked < 1) {
        asked++;
        t.predict(`n = ${nn.toString(2)}₂. Is the lowest bit set (do we multiply res by base = ${show(base)})?`, ['Yes', 'No'], set ? 0 : 1, set ? 'n is odd: its lowest bit is 1.' : 'n is even: its lowest bit is 0.');
      }
      t.step('bit', `n & 1 = ${set ? 1 : 0}: bit ${k} of |n| is ${set ? 'set' : 'clear'}.`, { 'n & 1': set ? 1 : 0 });
      if (set) {
        res *= base;
        taken.add(k);
        t.step('take', `res *= x^(2^${k}) = ${show(base)} → res = ${show(res)}.`, { res });
      }
      const next = base * base;
      if (asked < 2 && nn > 1 && k >= 1) {
        asked++;
        const opts = [...new Set([next, base * 2, base * xx].map(show).map(String))];
        t.predict(`base = ${show(base)}. What is base after squaring?`, opts, opts.indexOf(String(show(next))), `${show(base)}² = ${show(next)} = x^(2^${k + 1}).`);
      }
      base = next;
      if (nn > 1) powers.push(show(base));
      t.step('square', `base = ${show(base)} = x^(2^${k + 1}).`, { base });
      nn >>= 1;
      k++;
      t.step('shift', `n >>= 1 → n = ${nn}${nn ? ` (${nn.toString(2)}₂)` : ''}.`, { n: nn });
    }
    cur = null;
    t.step('loop', 'n = 0: every bit is consumed.', { n: 0 });
    t.step('done', `Return res = ${show(res)}. Used ${k} squarings instead of ${n0} multiplications.`, { res });
    return show(res);
  },
};

const multiplyStrings: Problem<{ num1: string; num2: string }> = {
  id: 'multiply-strings',
  num: 43,
  title: 'Multiply Strings',
  difficulty: 'Medium',
  category: 'math-geometry',
  pattern: 'math',
  statement: 'Multiply two non-negative integers given as decimal strings and return the product as a string, without converting the inputs to integers directly.',
  signals: ['numbers as strings', '"do not convert to int / no BigInteger"', 'grade-school long multiplication', 'result has at most len1 + len2 digits'],
  insight:
    'Digit i of num1 times digit j of num2 (both counted from the right) lands in position i + j of the result. Accumulate into an array of len1 + len2 slots, pushing each overflow into position i + j + 1, then strip leading zeros.',
  hints: [
    'How many digits can the product of an m-digit and an n-digit number have?',
    'Reverse both strings so index = power of ten. The product of digits at i and j contributes to 10^(i+j).',
    'After adding into res[i + j], move res[i + j] // 10 into res[i + j + 1] and keep res[i + j] % 10.',
  ],
  pitfall: 'Forgetting the "0" shortcut or the leading-zero strip — "123" × "0" must be "0", not "000".',
  backend: {
    title: 'Arbitrary-precision arithmetic for money and IDs',
    detail:
      'Payment and accounting services avoid floats and sometimes exceed 64 bits (e.g. crypto amounts in wei, interest over many periods). Decimal big-number libraries multiply digit arrays exactly this way (with bigger "digits" such as base 10⁹ limbs) before switching to Karatsuba for very long numbers.',
  },
  complexity: { time: 'O(m·n)', space: 'O(m + n)' },
  code: `
def multiply(num1, num2):
    if "0" in [num1, num2]:                          @zero
        return "0"                                   @zeroRes
    res = [0] * (len(num1) + len(num2))              @init
    num1, num2 = num1[::-1], num2[::-1]              @reverse
    for i1 in range(len(num1)):                      @outer
        for i2 in range(len(num2)):                  @inner
            digit = int(num1[i1]) * int(num2[i2])    @mul
            res[i1 + i2] += digit                    @add
            res[i1 + i2 + 1] += res[i1 + i2] // 10   @carry
            res[i1 + i2] = res[i1 + i2] % 10         @keep
    res, beg = res[::-1], 0                          @flip
    while beg < len(res) and res[beg] == 0:          @skip
        beg += 1                                     @advance
    res = map(str, res[beg:])
    return "".join(res)                              @done
`,
  explain: {
    zero: 'Anything times 0 is "0" — avoids returning "00…0".',
    init: 'm digits × n digits has at most m + n digits.',
    reverse: 'Now index k means 10^k for both numbers.',
    add: 'Digit product for 10^i1 · 10^i2 = 10^(i1+i2).',
    carry: 'Push the tens into the next power of ten right away.',
    keep: 'Keep only the ones digit in this slot.',
    flip: 'Back to most-significant-first.',
    skip: 'At most one leading zero (the product may have m + n − 1 digits).',
  },
  distractors: [
    { text: '            res[i1 + i2 + 1] = res[i1 + i2] // 10', why: 'Overwrites what the slot already accumulated — the carry must be ADDED.' },
    { text: '    res = [0] * (len(num1) * len(num2))', why: 'The product has at most len1 + len2 digits, not len1 × len2.' },
    { text: '            res[i1 * i2] += digit', why: 'Powers of ten add: 10^i1 · 10^i2 = 10^(i1+i2).' },
  ],
  input: { num1: '123', num2: '456' },
  presets: [
    { label: 'no leading zero', input: { num1: '99', num2: '99' } },
    { label: 'times zero', input: { num1: '123', num2: '0' } },
  ],
  validate: ({ num1, num2 }) =>
    typeof num1 !== 'string' || typeof num2 !== 'string' || !/^\d+$/.test(num1) || !/^\d+$/.test(num2)
      ? 'Expected { num1: "digits", num2: "digits" }'
      : num1.length > 5 || num2.length > 5
        ? 'Keep each number ≤ 5 digits'
        : (num1.length > 1 && num1[0] === '0') || (num2.length > 1 && num2[0] === '0')
          ? 'No leading zeros'
          : null,
  trace(t, { num1, num2 }) {
    const L1 = num1.length;
    const L2 = num2.length;
    const r1 = [...num1].reverse();
    const r2 = [...num2].reverse();
    const prod: string[][] = r1.map(() => r2.map(() => '·'));
    let res: number[] = [];
    let flipped = false;
    let i1c: number | null = null;
    let i2c: number | null = null;
    let pos: number | null = null;
    let beg: number | null = null;
    let asked = 0;
    let slotAsked = false;
    let carryAsked = false;
    t.draw(() => {
      const gt: Record<string, Tone> = {};
      for (let a = 0; a < L1; a++) for (let b = 0; b < L2; b++) if (prod[a][b] !== '·') gt[rc(a, b)] = 'muted';
      if (i1c !== null && i2c !== null) gt[rc(i1c, i2c)] = 'active';
      const rt: Record<number, Tone> = {};
      if (pos !== null) rt[pos] = 'active';
      if (pos !== null && pos + 1 < res.length) rt[pos + 1] = 'warn';
      if (flipped && beg !== null) for (let k = 0; k < beg; k++) rt[k] = 'muted';
      return [
        V.text('num1', num1, { tones: i1c !== null ? { [L1 - 1 - i1c]: 'active' } : {} }),
        V.text('num2', num2, { tones: i2c !== null ? { [L2 - 1 - i2c]: 'active' } : {} }),
        V.grid('digit products', prod, {
          tones: gt,
          rowLabels: r1.map((d, k) => `${d}·10^${k}`),
          colLabels: r2.map((d, k) => `${d}·10^${k}`),
          caption: 'row = digit of num1, column = digit of num2 (both from the right). Cell (i1, i2) adds into 10^(i1+i2).',
        }),
        res.length > 0 &&
          V.array(flipped ? 'res (most significant first)' : 'res  (index k = 10^k)', res, {
            pointers: flipped ? { beg } : { 'i1+i2': pos, carry: pos === null ? null : pos + 1 },
            tones: rt,
          }),
      ];
    });
    if (num1 === '0' || num2 === '0') {
      t.step('zero', `One of the inputs is "0".`, { num1, num2 });
      t.step('zeroRes', 'Return "0".', { result: '0' });
      t.step('done', 'Product = "0".', { result: '0' });
      return '0';
    }
    t.step('zero', 'Neither input is "0".', { num1, num2 });
    res = new Array(L1 + L2).fill(0);
    t.step('init', `res has ${L1} + ${L2} = ${L1 + L2} slots — the product can't be longer.`, { res: [...res] });
    t.step('reverse', `Reversed: num1 = "${r1.join('')}", num2 = "${r2.join('')}". Index k now means 10^k.`, {});
    for (let a = 0; a < L1; a++) {
      i1c = a;
      i2c = null;
      pos = null;
      t.step('outer', `i1 = ${a}: digit ${r1[a]} of num1 (×10^${a}).`, { i1: a });
      for (let b = 0; b < L2; b++) {
        i2c = b;
        pos = a + b;
        t.step('inner', `i2 = ${b}: digit ${r2[b]} of num2 (×10^${b}).`, { i1: a, i2: b });
        const digit = Number(r1[a]) * Number(r2[b]);
        if (!slotAsked && (a >= 1 || L1 === 1) && b >= 1) {
          slotAsked = true;
          asked++;
          const opts = [String(a + b), String(a * b), String(a + b + 1)].filter((v, k, arr) => arr.indexOf(v) === k);
          t.predict(`${r1[a]}·10^${a} × ${r2[b]}·10^${b}: which res slot (power of ten) does the product go to?`, opts, 0, `10^${a} · 10^${b} = 10^${a + b}.`);
        }
        prod[a][b] = String(digit);
        t.step('mul', `digit = ${r1[a]} × ${r2[b]} = ${digit}.`, { digit });
        res[a + b] += digit;
        t.step('add', `res[${a + b}] += ${digit} → ${res[a + b]}.`, { [`res[${a + b}]`]: res[a + b] });
        const c = Math.floor(res[a + b] / 10);
        if (!carryAsked && c > 0) {
          carryAsked = true;
          asked++;
          const opts = [String(c), String(res[a + b] % 10), String(c + 1)].filter((v, k, arr) => arr.indexOf(v) === k);
          t.predict(`res[${a + b}] = ${res[a + b]}. How much carries into res[${a + b + 1}]?`, opts, 0, `${res[a + b]} // 10 = ${c}.`);
        }
        res[a + b + 1] += c;
        t.step('carry', c ? `Carry ${c} into res[${a + b + 1}] → ${res[a + b + 1]}.` : `res[${a + b}] < 10: carry 0.`, { carry: c });
        res[a + b] %= 10;
        t.step('keep', `res[${a + b}] = ${res[a + b]}.`, { res: [...res] });
      }
    }
    i1c = i2c = pos = null;
    res = [...res].reverse();
    flipped = true;
    beg = 0;
    t.step('flip', `Most significant first: [${res.join(', ')}].`, { res: [...res] });
    if (asked < 3) {
      asked++;
      const lead = res.findIndex((v) => v !== 0);
      t.predict('How many leading zeros will be skipped?', ['0', '1', '2'], lead, lead ? `res[0] = 0, res[1] = ${res[1]}.` : `res[0] = ${res[0]} is already non-zero.`);
    }
    while (beg < res.length && res[beg] === 0) {
      t.step('skip', `res[${beg}] = 0 — leading zero.`, { beg });
      beg++;
      t.step('advance', `beg = ${beg}.`, { beg });
    }
    t.step('skip', `res[${beg}] = ${res[beg]} ≠ 0: stop.`, { beg });
    const out = res.slice(beg).join('');
    t.step('done', `Product = "${out}".`, { result: out });
    return out;
  },
};

type SqOp = [string, [number, number]];

const detectSquares: Problem<{ ops: SqOp[] }> = {
  id: 'detect-squares',
  num: 2013,
  title: 'Detect Squares',
  difficulty: 'Medium',
  category: 'math-geometry',
  pattern: 'hashing',
  statement:
    'Design a structure that supports add(point) (duplicates allowed) and count(point): the number of ways to pick three stored points that form an axis-aligned square of positive area with the query point.',
  signals: ['design class with add / count', 'axis-aligned square', 'duplicates count separately', 'fix one corner, enumerate the opposite corner'],
  insight:
    'An axis-aligned square is fixed by its diagonal. For the query (px, py), try every stored point (x, y) as the opposite corner: it must satisfy |x − px| = |y − py| ≠ 0. The other two corners are then (x, py) and (px, y) — look their counts up in a hash map and multiply.',
  hints: [
    'If you know two opposite corners of an axis-aligned square, do you know the other two?',
    'Enumerate the diagonal corner from the list of stored points; check |dx| == |dy| and dx ≠ 0.',
    'Keep a Counter of points; the answer adds count[(x, py)] · count[(px, y)] per diagonal (duplicates of the diagonal appear separately in the list).',
  ],
  pitfall: 'Iterating over distinct points without multiplying by their multiplicity, or forgetting to exclude zero-area "squares" where x == px.',
  backend: {
    title: 'Spatial pattern lookups in a hash-indexed point store',
    detail:
      'Map services and game servers keep entities in a hash map keyed by grid cell. Queries like "is there a rectangle of sensors around this point" fix one anchor, enumerate candidates, and do O(1) lookups for the derived corners — avoiding an O(n³) scan over triples.',
  },
  complexity: { time: 'add O(1), count O(n)', space: 'O(n)' },
  code: `
class DetectSquares:
    def __init__(self):
        self.ptsCount = defaultdict(int)                   @init
        self.pts = []

    def add(self, point):
        self.ptsCount[tuple(point)] += 1                   @add
        self.pts.append(point)                             @store

    def count(self, point):
        res = 0                                            @count
        px, py = point
        for x, y in self.pts:                              @loop
            if abs(py - y) != abs(px - x) or x == px or y == py:   @diag
                continue                                   @skip
            res += self.ptsCount[(x, py)] * self.ptsCount[(px, y)]   @combine
        return res                                         @ret
`,
  explain: {
    init: 'ptsCount answers "how many copies of (x, y)?" in O(1); pts lists every added point (with duplicates) to enumerate diagonals.',
    store: 'Duplicates are appended too, so a doubled diagonal corner is counted twice.',
    loop: 'Treat each stored point as the corner diagonally opposite the query.',
    diag: 'Axis-aligned square ⇔ |dx| == |dy|, and dx ≠ 0 for positive area.',
    combine: 'Choices for the two remaining corners multiply.',
  },
  distractors: [
    { text: '            if abs(py - y) != abs(px - x):', why: 'Allows x == px, y == py (the query itself) — a zero-area "square".' },
    { text: '            res += self.ptsCount[(x, py)] + self.ptsCount[(px, y)]', why: 'Independent choices multiply; adding counts squares with a missing corner.' },
    { text: '        for x, y in self.ptsCount:', why: 'Distinct keys lose multiplicity of the diagonal corner (unless you also multiply by its count).' },
  ],
  input: {
    ops: [
      ['add', [3, 10]],
      ['add', [11, 2]],
      ['add', [3, 2]],
      ['count', [11, 10]],
      ['count', [14, 8]],
      ['add', [11, 2]],
      ['count', [11, 10]],
    ],
  },
  presets: [
    {
      label: 'two squares, one query',
      input: {
        ops: [
          ['add', [0, 0]],
          ['add', [0, 2]],
          ['add', [2, 0]],
          ['add', [4, 0]],
          ['add', [4, 2]],
          ['count', [2, 2]],
        ],
      },
    },
    { label: 'no square', input: { ops: [['add', [1, 1]], ['add', [2, 2]], ['count', [1, 2]]] } },
  ],
  validate: ({ ops }) =>
    !Array.isArray(ops) ||
    !ops.every((o) => Array.isArray(o) && (o[0] === 'add' || o[0] === 'count') && Array.isArray(o[1]) && o[1].length === 2 && o[1].every((v) => Number.isInteger(v) && v >= 0))
      ? 'Expected { ops: [["add" | "count", [x, y]], …] } with non-negative integer coordinates'
      : ops.length > 14
        ? 'Keep it ≤ 14 operations'
        : null,
  trace(t, { ops }) {
    const key = (x: number, y: number) => `${x},${y}`;
    const counts = new Map<string, number>();
    const pts: [number, number][] = [];
    const out: (number | null)[] = [];
    const xs = ops.map((o) => o[1][0]);
    const ys = ops.map((o) => o[1][1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1);
    let q: [number, number] | null = null;
    let cand: [number, number] | null = null;
    let square = false;
    let hl: string[] = [];
    const lastCount = ops.map((o) => o[0]).lastIndexOf('count');
    let asked = 0;
    t.draw(() => {
      const ids = [...counts.keys()];
      if (q && !counts.has(key(...q))) ids.push(key(...q));
      const positions: Record<string, [number, number]> = {};
      for (const id of ids) {
        const [x, y] = id.split(',').map(Number);
        positions[id] = [10 + (80 * (x - minX)) / span, 90 - (80 * (y - minY)) / span];
      }
      const tn: Record<string, Tone> = {};
      const badges: Record<string, string> = {};
      for (const [id, c] of counts) badges[id] = `×${c}`;
      const edges: [string, string][] = [];
      const et: Record<string, Tone> = {};
      if (q && cand) {
        const [px, py] = q;
        const [x, y] = cand;
        const qk = key(px, py);
        const dk = key(x, y);
        tn[dk] = 'warn';
        edges.push([qk, dk]);
        et[`${qk}->${dk}`] = square ? 'good' : 'warn';
        if (square) {
          const c1 = key(x, py);
          const c2 = key(px, y);
          for (const c of [c1, c2]) tn[c] = 'good';
          edges.push([qk, c1], [c1, dk], [dk, c2], [c2, qk]);
          for (const [a, b] of [[qk, c1], [c1, dk], [dk, c2], [c2, qk]]) et[`${a}->${b}`] = 'good';
        }
      }
      if (q) tn[key(...q)] = 'active';
      return [
        V.graph('plane', ids, edges, { positions, tones: tn, edgeTones: et, badges, caption: 'blue = query · orange = diagonal candidate · green = complete square' }),
        V.map('ptsCount', [...counts.entries()].map(([k, v]) => [`(${k})`, v] as [string, number]), { hl }),
        V.chips('outputs', out.map((v) => (v === null ? 'None' : v))),
      ];
    });
    t.step('init', 'Empty ptsCount map and pts list.', {});
    ops.forEach(([op, [px, py]], oi) => {
      if (op === 'add') {
        q = null;
        cand = null;
        const k = key(px, py);
        counts.set(k, (counts.get(k) ?? 0) + 1);
        hl = [`(${k})`];
        t.step('add', `add(${px}, ${py}): ptsCount[(${k})] = ${counts.get(k)}.`, { point: [px, py] });
        pts.push([px, py]);
        out.push(null);
        t.step('store', `pts now has ${pts.length} point${pts.length > 1 ? 's' : ''}.`, { pts: pts.length });
        return;
      }
      q = [px, py];
      cand = null;
      square = false;
      hl = [];
      let res = 0;
      t.step('count', `count(${px}, ${py}): try each of the ${pts.length} stored points as the diagonal corner.`, { px, py, res });
      if (oi === lastCount && asked < 3 && oi > ops.findIndex((o) => o[0] === 'count')) {
        asked++;
        let ans = 0;
        for (const [x, y] of pts) if (Math.abs(py - y) === Math.abs(px - x) && x !== px) ans += (counts.get(key(x, py)) ?? 0) * (counts.get(key(px, y)) ?? 0);
        const opts = [...new Set([ans, ans + 1, ans * 2, Math.max(ans - 1, 0)])].sort((a, b) => a - b).map(String);
        t.predict(`What will count(${px}, ${py}) return?`, opts, opts.indexOf(String(ans)), 'Each stored copy of a diagonal corner forms its own squares, multiplied by the copies of the two side corners.');
      }
      for (const [x, y] of pts) {
        cand = [x, y];
        square = false;
        hl = [];
        t.step('loop', `Candidate diagonal corner (${x}, ${y}): dx = ${x - px}, dy = ${y - py}.`, { x, y });
        const ok = Math.abs(py - y) === Math.abs(px - x) && x !== px && y !== py;
        if (asked < 1) {
          asked++;
          t.predict(`Can (${x}, ${y}) be the corner opposite (${px}, ${py})?`, ['Yes', 'No'], ok ? 0 : 1, ok ? '|dx| = |dy| ≠ 0.' : x === px || y === py ? 'It shares a row or column with the query — zero width.' : '|dx| ≠ |dy|: that would be a non-square rectangle.');
        }
        if (!ok) {
          t.step('diag', `|dy| = ${Math.abs(py - y)}, |dx| = ${Math.abs(px - x)} — not a square diagonal.`, {});
          t.step('skip', 'continue.', {});
          continue;
        }
        t.step('diag', `|dy| = |dx| = ${Math.abs(px - x)} — a valid diagonal.`, {});
        const a = counts.get(key(x, py)) ?? 0;
        const b = counts.get(key(px, y)) ?? 0;
        square = a > 0 && b > 0;
        hl = [`(${key(x, py)})`, `(${key(px, y)})`];
        if (asked < 2) {
          asked++;
          const opts = [...new Set([a * b, a + b, Math.max(a, b)])].map(String);
          t.predict(`Corners (${x}, ${py}) ×${a} and (${px}, ${y}) ×${b}. How much does this diagonal add?`, opts, opts.indexOf(String(a * b)), `${a} × ${b} = ${a * b}.`);
        }
        res += a * b;
        t.step('combine', `res += ptsCount[(${key(x, py)})] · ptsCount[(${key(px, y)})] = ${a} · ${b} → res = ${res}.`, { res });
      }
      cand = null;
      square = false;
      out.push(res);
      t.step('ret', `count(${px}, ${py}) returns ${res}.`, { res });
    });
    q = null;
    hl = [];
    return out;
  },
};

export const problems: Problem[] = [rotateImage, spiralMatrix, setMatrixZeroes, happyNumber, plusOne, powXN, multiplyStrings, detectSquares];

export const variants: Variant[] = [
  {
    id: 'math-game-of-life-in-place',
    title: 'Next Generation of a Cell Grid, In Place',
    statement:
      'Given a grid of live (1) and dead (0) cells, compute the next generation using Conway\'s rules (neighbours counted among the 8 surrounding cells) and write it into the same grid without allocating a second one.',
    pattern: 'matrix',
    nearest: 'set-matrix-zeroes',
    signals: ['"in place" grid update', 'every new value depends on OLD neighbour values', 'need to encode old and new state together'],
    approach: 'Encode transitions in spare bits: store new state in bit 1 (cell |= 2 if it lives next turn) while bit 0 still holds the old state for neighbours to read. A final pass shifts every cell right by one.',
    backend: 'Applying a batch of dependent updates to a shared in-memory table without a full copy (e.g. recomputing health states of a service mesh from neighbour states).',
  },
  {
    id: 'math-add-decimal-strings',
    title: 'Add Two Amount Strings',
    statement: 'Two non-negative amounts are given as decimal strings of arbitrary length. Return their sum as a string without converting either to a number type.',
    pattern: 'math',
    nearest: 'multiply-strings',
    signals: ['numbers too long for 64-bit', 'string digits', 'carry from right to left'],
    approach: 'Two pointers from the right ends with a carry; append (a + b + carry) % 10, carry = sum // 10; append a final carry and reverse.',
    backend: 'Summing ledger balances stored as decimal strings in a payments service that forbids floating point.',
  },
  {
    id: 'math-modular-power',
    title: 'Modular Power for Token Signatures',
    statement: 'Given integers a, e (0 ≤ e ≤ 10¹⁸) and modulus m, return a^e mod m without overflowing 64-bit integers.',
    pattern: 'math',
    nearest: 'powx-n',
    signals: ['huge exponent', '"mod m"', 'repeated squaring'],
    approach: 'Square-and-multiply over the bits of e, reducing modulo m after every multiplication (use 128-bit or mulmod when m is near 2⁶³).',
    backend: 'RSA / Diffie-Hellman primitives and rolling-hash precomputation (base^k mod p).',
  },
  {
    id: 'math-redirect-loop-detection',
    title: 'Detect a Redirect Loop in O(1) Memory',
    statement: 'Every short-link either points to a final URL or to another short-link. Given a function next(link), decide whether following redirects from a starting link ever reaches a final URL or loops forever — using constant extra memory.',
    pattern: 'fast-slow',
    nearest: 'happy-number',
    signals: ['implicit linked list via next()', '"loops forever"', 'constant memory'],
    approach: 'Floyd\'s tortoise and hare: advance slow by one and fast by two; if fast reaches a final URL it terminates, if slow == fast there is a loop.',
    backend: 'Validating CNAME chains, URL shortener redirects, or config inheritance chains before serving them.',
  },
];
