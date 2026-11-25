import type { Predict } from '../../types';
import type { FD, Row, Tbl } from './engine';
import { project } from './engine';

/* ───────────────────────── the order sheet ───────────────────────── */

export const CUSTOMERS: Record<string, { name: string; city: string }> = {
  C1: { name: 'Asha Rao', city: 'Pune' },
  C2: { name: 'Vikram Shah', city: 'Delhi' },
  C3: { name: 'Meera Iyer', city: 'Chennai' },
};

export const PRODUCTS: Record<string, { name: string; price: string }> = {
  P1: { name: 'Kettle', price: '1499' },
  P2: { name: 'Mug', price: '299' },
  P3: { name: 'French Press', price: '2499' },
  P4: { name: 'Tea Infuser', price: '399' },
};

const ORDERS: { id: string; date: string; customer: string; lines: [string, number][] }[] = [
  { id: 'O1001', date: '2026-03-02', customer: 'C1', lines: [['P1', 1], ['P2', 4]] },
  { id: 'O1002', date: '2026-03-05', customer: 'C2', lines: [['P1', 2], ['P4', 1]] },
  { id: 'O1003', date: '2026-03-09', customer: 'C1', lines: [['P3', 1]] },
  { id: 'O1004', date: '2026-03-11', customer: 'C3', lines: [['P2', 6]] },
  { id: 'O1005', date: '2026-03-14', customer: 'C1', lines: [['P4', 3]] },
  { id: 'O1006', date: '2026-03-15', customer: 'C2', lines: [['P2', 2]] },
];

export const FLAT_COLS = ['order_id', 'order_date', 'customer_id', 'customer_name', 'customer_city', 'product_id', 'product_name', 'unit_price', 'qty'];

export const FLAT_ROWS: Row[] = ORDERS.flatMap((o) =>
  o.lines.map(([p, q]) => ({
    order_id: o.id,
    order_date: o.date,
    customer_id: o.customer,
    customer_name: CUSTOMERS[o.customer].name,
    customer_city: CUSTOMERS[o.customer].city,
    product_id: p,
    product_name: PRODUCTS[p].name,
    unit_price: PRODUCTS[p].price,
    qty: String(q),
  })),
);

const SHEET_ROWS: Row[] = ORDERS.map((o) => ({
  order_id: o.id,
  order_date: o.date,
  customer_id: o.customer,
  customer_name: CUSTOMERS[o.customer].name,
  customer_city: CUSTOMERS[o.customer].city,
  product_id: o.lines.map(([p]) => p),
  product_name: o.lines.map(([p]) => PRODUCTS[p].name),
  unit_price: o.lines.map(([p]) => PRODUCTS[p].price),
  qty: o.lines.map(([, q]) => String(q)),
}));

export const ORDER_FDS: FD[] = [
  { lhs: ['order_id'], rhs: ['order_date', 'customer_id'] },
  { lhs: ['customer_id'], rhs: ['customer_name', 'customer_city'] },
  { lhs: ['product_id'], rhs: ['product_name', 'unit_price'] },
  { lhs: ['order_id', 'product_id'], rhs: ['qty'] },
];

/** The 0NF sheet also states that an order determines its whole cart (list-valued). */
export const SHEET_FDS: FD[] = [...ORDER_FDS, { lhs: ['order_id'], rhs: ['product_id', 'product_name', 'unit_price', 'qty'] }];

/* ───────────────────────── BCNF case ───────────────────────── */

export const ENROLL_COLS = ['student', 'course', 'instructor'];
export const ENROLL_FDS: FD[] = [
  { lhs: ['student', 'course'], rhs: ['instructor'] },
  { lhs: ['instructor'], rhs: ['course'] },
];
export const ENROLL_ROWS: Row[] = [
  { student: 'Ana', course: 'Databases', instructor: 'Codd' },
  { student: 'Ben', course: 'Databases', instructor: 'Date' },
  { student: 'Cleo', course: 'Databases', instructor: 'Codd' },
  { student: 'Ana', course: 'Systems', instructor: 'Ritchie' },
  { student: 'Ben', course: 'Systems', instructor: 'Ritchie' },
];

/* ───────────────────────── decomposition stepper ───────────────────────── */

const tbl = (id: string, name: string, cols: string[], pk: string[], extra: Partial<Tbl> = {}): Tbl => ({
  id,
  name,
  cols,
  pk,
  rows: project(FLAT_ROWS, cols),
  ...extra,
});

const ORDERS_2NF = tbl('orders', 'orders', ['order_id', 'order_date', 'customer_id', 'customer_name', 'customer_city'], ['order_id']);
const PRODUCTS_T = tbl('products', 'products', ['product_id', 'product_name', 'unit_price'], ['product_id']);
const LINES_T = tbl('lines', 'order_lines', ['order_id', 'product_id', 'qty'], ['order_id', 'product_id'], {
  fks: [
    { cols: ['order_id'], ref: 'orders' },
    { cols: ['product_id'], ref: 'products' },
  ],
});
const ORDERS_3NF = tbl('orders', 'orders', ['order_id', 'order_date', 'customer_id'], ['order_id'], { fks: [{ cols: ['customer_id'], ref: 'customers' }] });
const CUSTOMERS_T = tbl('customers', 'customers', ['customer_id', 'customer_name', 'customer_city'], ['customer_id']);

export const TABLES_3NF = [LINES_T, ORDERS_3NF, CUSTOMERS_T, PRODUCTS_T];
export const ORDER_REPORT: Tbl = { id: 'report', name: 'order_report', cols: FLAT_COLS, pk: ['order_id', 'product_id'], rows: FLAT_ROWS, badge: 'denormalized' };

export type Focus = { kind: 'multi' } | { kind: 'fd'; lhs: string[][] } | { kind: 'none' };

export interface NFStep {
  id: string;
  label: string;
  title: string;
  body: string[];
  domain: 'orders' | 'enroll';
  tables: Tbl[];
  focus: Focus;
  predict?: Predict;
  keyIdea?: string;
  goodToKnow?: string;
  /** Hand-written impact lines; numbers from schemaMetrics are added by the lab. */
  removed?: string;
  cost?: string;
}

export const NF_STEPS: NFStep[] = [
  {
    id: '0nf',
    label: '0NF',
    title: 'One row per order, products packed in lists',
    domain: 'orders',
    tables: [{ id: 'lines', name: 'order_sheet', cols: FLAT_COLS, pk: ['order_id'], multi: ['product_id', 'product_name', 'unit_price', 'qty'], rows: SHEET_ROWS }],
    focus: { kind: 'multi' },
    body: [
      'This is how orders arrive from a spreadsheet export: one row per order, and the cart squeezed into **parallel lists** (`P1,P2` / `Kettle,Mug` / `1,4`).',
      'A cell that holds a list is a **repeating group**. The database can no longer see individual products: no foreign key on `P2`, no index seek for "orders containing P2", and `LIKE \'%P1%\'` also matches `P10`.',
    ],
    removed: 'nothing yet: this is the starting point',
    cost: 'list cells: queries must parse strings, no FK, no index seek',
  },
  {
    id: '1nf',
    label: '1NF',
    title: '1NF: explode the lists, one row per order line',
    domain: 'orders',
    tables: [{ id: 'lines', name: 'order_sheet', cols: FLAT_COLS, pk: ['order_id', 'product_id'], rows: FLAT_ROWS }],
    focus: { kind: 'fd', lhs: [['order_id'], ['product_id']] },
    predict: {
      question: 'Exploding the lists gives every cell one value. Do **duplicated values** go up or down?',
      options: ['Down: atomic values remove duplication', 'Up: the order header is copied onto every line', 'Unchanged: same facts, different shape', 'Down to zero'],
      answer: 1,
      explain: 'Each extra line repeats the order date, customer and city. 1NF is about **atomicity**, not redundancy: duplication rises from 14 to 22 values.',
    },
    body: [
      'Every cell now holds one value and the key is `(order_id, product_id)`: one row per order line.',
      'Look at the FD lanes above the header. `order_id → order_date, customer_id` depends on **half** of the key. So does `product_id → product_name, unit_price`. That is a **partial dependency**: the 2NF violation.',
    ],
    keyIdea: '1NF fixes *shape* (atomic cells, a key). It does not fix redundancy; it usually makes it worse.',
    removed: 'repeating group: `product_id` is indexable and can carry a foreign key',
    cost: 'order header duplicated on every line',
  },
  {
    id: '2nf',
    label: '2NF',
    title: '2NF: split off what depends on part of the key',
    domain: 'orders',
    tables: [LINES_T, ORDERS_2NF, PRODUCTS_T],
    focus: { kind: 'fd', lhs: [['customer_id']] },
    predict: {
      question: 'Which FD do you split on to reach 2NF?',
      options: ['`customer_id → customer_name, customer_city`', '`order_id → order_date, customer_id` (and `product_id → product_name, unit_price`)', '`(order_id, product_id) → qty`', 'None: the table is already 2NF'],
      answer: 1,
      explain: 'Both determine non-key columns from **part** of the composite key. Each becomes its own table keyed by that part; `order_lines` keeps only what needs the whole key: `qty`.',
    },
    body: [
      '`orders` is keyed by `order_id`, `products` by `product_id`, and `order_lines(order_id, product_id, qty)` keeps only the fact that needs the whole key.',
      'A product can now exist with no orders, and cancelling O1003 no longer erases the French Press. But `orders` still carries `customer_name, customer_city` via `order_id → customer_id → customer_city`: a **transitive dependency**.',
    ],
    goodToKnow: 'In real systems `order_lines` also stores `price_paid`. That is not a 2NF violation: the price *at checkout* is a fact about the line, not about the product (whose list price changes).',
    removed: 'insert + delete anomalies for products; P2 price change now touches 1 row',
    cost: 'order report joins 3 tables',
  },
  {
    id: '3nf',
    label: '3NF',
    title: '3NF: split off the transitive dependency',
    domain: 'orders',
    tables: TABLES_3NF,
    focus: { kind: 'none' },
    predict: {
      question: 'After moving the customer to its own table, how many rows change when **C1 moves to Mumbai**?',
      options: ['4 (one per order line)', '3 (one per order)', '1 (the customer row)', '0: city is now derived'],
      answer: 2,
      explain: 'Every non-key column now depends on **the key, the whole key and nothing but the key**. One fact, one row: the update touches 1 row in `customers`.',
    },
    body: [
      '`customers(customer_id, customer_name, customer_city)` holds each customer fact once. `orders` keeps `customer_id` as a **foreign key**.',
      'Every FD lane is now green: each determinant is a key of its table. Duplicated values: 0. The price: the full order report joins **4 tables** (3 joins on indexed keys).',
    ],
    keyIdea: '3NF: every non-key attribute depends on the key, the whole key, and nothing but the key.',
    removed: 'update anomaly: one customer fact = one row',
    cost: 'order report joins 4 tables (3 joins)',
  },
  {
    id: 'bcnf-problem',
    label: 'BCNF?',
    title: '3NF is not the end: a non-key determines part of the key',
    domain: 'enroll',
    tables: [{ id: 'enroll', name: 'enrollment', cols: ENROLL_COLS, pk: ['student', 'course'], rows: ENROLL_ROWS }],
    focus: { kind: 'fd', lhs: [['instructor']] },
    predict: {
      question: 'Rules: a student takes a course with one instructor; each instructor teaches one course. `enrollment(student, course, instructor)` is in 3NF. Is it in **BCNF**?',
      options: ['Yes: it is 3NF and has a key', 'No: `instructor → course`, and `instructor` is not a superkey', 'No: `student → course` is partial', 'Yes: all columns are part of some key'],
      answer: 1,
      explain: '3NF tolerates `instructor → course` because `course` is **prime** (part of the key `{student, course}`). BCNF does not: every determinant must be a superkey.',
    },
    body: [
      'The orders schema is already BCNF: each determinant is a key. Real BCNF violations need **overlapping candidate keys**. Classic case: enrollment.',
      'Candidate keys: `{student, course}` and `{student, instructor}`. Every column is prime, so 3NF holds. But "Codd teaches Databases" is stored twice, and you can\'t record that Gray teaches Databases until a student enrols.',
    ],
    removed: 'nothing: this table is already 3NF',
    cost: '"Codd teaches Databases" stored 2×; can\'t add an instructor without a student',
  },
  {
    id: 'bcnf',
    label: 'BCNF',
    title: 'BCNF: split on instructor → course, and lose an FD',
    domain: 'enroll',
    tables: [
      { id: 'teaches', name: 'teaches', cols: ['instructor', 'course'], pk: ['instructor'], rows: project(ENROLL_ROWS, ['instructor', 'course']) },
      { id: 'enroll', name: 'enrollment', cols: ['student', 'instructor'], pk: ['student', 'instructor'], rows: project(ENROLL_ROWS, ['student', 'instructor']), fks: [{ cols: ['instructor'], ref: 'teaches' }] },
    ],
    focus: { kind: 'none' },
    body: [
      '`teaches(instructor PK, course)` + `enrollment(student, instructor)`. Joining them on `instructor` returns exactly the 5 original rows: **lossless**.',
      'But `{student, course} → instructor` now spans two tables. Nothing stops Ana enrolling with both Codd and Date, who both teach Databases. You need a trigger or an app check, or you stay in 3NF.',
    ],
    keyIdea: 'BCNF decomposition is always lossless but may not preserve dependencies. 3NF synthesis always preserves both. That is why 3NF is the usual target.',
    goodToKnow: 'Practical middle ground: keep `enrollment(student, course, instructor)` with `UNIQUE (student, course)` and a composite `FOREIGN KEY (instructor, course) REFERENCES teaches(instructor, course)`. Both rules are enforced by constraints; the redundancy is guarded.',
    removed: 'redundancy: each instructor→course fact stored once',
    cost: 'lost FD `{student, course} → instructor`: needs a trigger',
  },
  {
    id: 'denorm',
    label: 'Denorm?',
    title: 'Denormalize back for reads?',
    domain: 'orders',
    tables: TABLES_3NF,
    focus: { kind: 'none' },
    predict: {
      question: 'You copy the 3NF tables back into one wide `order_report` table and make it the source of truth. How many rows does **"Mug price 299 → 349"** touch?',
      options: ['1', '3 (every line containing P2)', '6', '0: reads only'],
      answer: 1,
      explain: 'P2 sits on 3 order lines, so 3 rows. Reads save 3 joins; every write about a customer or product fans out to all its lines.',
    },
    body: [
      'Flip the toggle and compare. Reads save joins; every update to a customer or product fans out to every line that mentions it, and the anomalies return.',
      'The senior answer is rarely "pick one": keep **3NF as the source of truth** and derive the wide shape as a read model (materialized view, CDC-fed table, warehouse OBT) that is rebuilt, never edited.',
    ],
    removed: 'joins on the hot read path',
    cost: 'writes fan out; anomalies are back unless the wide table is derived',
  },
];

/* ───────────────────────── anomaly simulator ───────────────────────── */

export interface UpdateScenario {
  id: string;
  label: string;
  sql: string;
  by: string;
  value: string;
  attr: string;
  to: string;
  predict: Predict;
}

export const UPDATES: UpdateScenario[] = [
  {
    id: 'c1-city',
    label: 'Customer C1 moves to Mumbai',
    sql: "UPDATE order_sheet SET customer_city = 'Mumbai' WHERE customer_id = 'C1'",
    by: 'customer_id',
    value: 'C1',
    attr: 'customer_city',
    to: 'Mumbai',
    predict: {
      question: 'Asha Rao (C1) moves from Pune to Mumbai. How many rows of the flat sheet must change?',
      options: ['1 row', '3 rows (one per order)', '4 rows (one per order line)', '8 rows (the whole sheet)'],
      answer: 2,
      explain: 'C1 placed 3 orders, but O1001 has 2 lines. The city is copied onto **every line**: 4 rows for one fact.',
    },
  },
  {
    id: 'p2-price',
    label: 'Mug (P2) price 299 → 349',
    sql: "UPDATE order_sheet SET unit_price = 349 WHERE product_id = 'P2'",
    by: 'product_id',
    value: 'P2',
    attr: 'unit_price',
    to: '349',
    predict: {
      question: 'The Mug (P2) list price changes from 299 to 349. How many rows must change?',
      options: ['1 row', '3 rows', '4 rows', '6 rows'],
      answer: 1,
      explain: 'P2 appears on 3 order lines (O1001, O1004, O1006). Each carries its own copy of the price.',
    },
  },
  {
    id: 'c2-name',
    label: 'C2 fixes name: Vikram Shaw',
    sql: "UPDATE order_sheet SET customer_name = 'Vikram Shaw' WHERE customer_id = 'C2'",
    by: 'customer_id',
    value: 'C2',
    attr: 'customer_name',
    to: 'Vikram Shaw',
    predict: {
      question: 'Vikram (C2) corrects the spelling of his surname. How many rows must change?',
      options: ['1 row', '2 rows (one per order)', '3 rows (one per order line)', '6 rows'],
      answer: 2,
      explain: 'C2 has 2 orders, and O1002 has 2 lines: 3 rows hold his name.',
    },
  },
];

/* ───────────────────────── classify drill ───────────────────────── */

export interface ClassifyCase {
  id: string;
  name: string;
  cols: string[];
  multi?: string[];
  fds: FD[];
  story: string;
}

export const CLASSIFY: ClassifyCase[] = [
  {
    id: 'employee',
    name: 'employee',
    cols: ['emp_id', 'dept_id', 'dept_name'],
    fds: [
      { lhs: ['emp_id'], rhs: ['dept_id'] },
      { lhs: ['dept_id'], rhs: ['dept_name'] },
    ],
    story: 'Each employee is in one department; a department has one name.',
  },
  {
    id: 'account',
    name: 'account',
    cols: ['user_id', 'email', 'name'],
    fds: [
      { lhs: ['user_id'], rhs: ['email', 'name'] },
      { lhs: ['email'], rhs: ['user_id'] },
    ],
    story: 'Emails are unique per user.',
  },
  {
    id: 'order_item',
    name: 'order_item',
    cols: ['order_id', 'product_id', 'qty', 'product_name'],
    fds: [
      { lhs: ['order_id', 'product_id'], rhs: ['qty'] },
      { lhs: ['product_id'], rhs: ['product_name'] },
    ],
    story: 'One row per product in an order.',
  },
  {
    id: 'address',
    name: 'address',
    cols: ['street', 'city', 'zip'],
    fds: [
      { lhs: ['street', 'city'], rhs: ['zip'] },
      { lhs: ['zip'], rhs: ['city'] },
    ],
    story: 'A street in a city has one zip; a zip lies in one city.',
  },
  {
    id: 'post',
    name: 'post',
    cols: ['post_id', 'title', 'tags'],
    multi: ['tags'],
    fds: [{ lhs: ['post_id'], rhs: ['title', 'tags'] }],
    story: '`tags` stores values like `sql,postgres,indexing`.',
  },
];

/* ───────────────────────── decompose drill ───────────────────────── */

export const DEC_U = ['student_id', 'course_id', 'student_name', 'advisor_id', 'advisor_name', 'course_title', 'grade'];

export const DEC_FDS: FD[] = [
  { lhs: ['student_id'], rhs: ['student_name', 'advisor_id'] },
  { lhs: ['advisor_id'], rhs: ['advisor_name'] },
  { lhs: ['course_id'], rhs: ['course_title'] },
  { lhs: ['student_id', 'course_id'], rhs: ['grade'] },
];

export interface DecChoice {
  id: string;
  lhs: string[];
  rhs: string[];
  note: string;
}

export const DEC_CHOICES: DecChoice[] = [
  { id: 'student', lhs: ['student_id'], rhs: ['student_name', 'advisor_id'], note: 'given FD' },
  { id: 'advisor', lhs: ['advisor_id'], rhs: ['advisor_name'], note: 'given FD' },
  { id: 'course', lhs: ['course_id'], rhs: ['course_title'], note: 'given FD' },
  { id: 'student-all', lhs: ['student_id'], rhs: ['student_name', 'advisor_id', 'advisor_name'], note: 'closure of student_id' },
  { id: 'student-adv-name', lhs: ['student_id'], rhs: ['advisor_name'], note: 'implied (transitivity)' },
  { id: 'course-grade', lhs: ['course_id'], rhs: ['grade'], note: 'looks plausible' },
];

export const DEC_NAMES: Record<string, string> = { student_id: 'students', advisor_id: 'advisors', course_id: 'courses' };
