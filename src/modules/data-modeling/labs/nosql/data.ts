import type { Predict } from '../../types';
import type { CState, DDesign, DPattern, EntityOpt, GsiOpt, Inst, MState } from './engine';

/* ───────────────────────── DynamoDB: workload (production scale) ───────────────────────── */

export const DDB = {
  customers: 1_000_000,
  ordersPerCustomer: 20,
  /** A big B2B customer: drives the largest customer item collection. */
  heavyOrders: 2_000,
  itemsPerOrder: 3,
  bytes: { customer: 1024, order: 800, item: 400 } as Record<'customer' | 'order' | 'item', number>,
  statusShare: { PENDING: 0.02, PAID: 0.03, SHIPPED: 0.05, DELIVERED: 0.88, CANCELLED: 0.02 } as Record<string, number>,
  statuses: ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
  /** Peak new orders per second. Each order then goes PENDING → PAID → SHIPPED → DELIVERED (3 status updates). */
  ordersPerSec: 600,
  statusUpdatesPerOrder: 3,
  customerWritesPerSec: 20,
  /** A heavy customer places ~2 orders/s at peak. */
  heavyOrdersPerSec: 2,
  shards: 10,
  page: { a2: 10, a4: 50 },
  limits: { wcu: 1000, rcu: 3000, collectionBytes: 10 * 1024 ** 3, pageBytes: 1024 ** 2 },
};

export const PATTERNS: DPattern[] = [
  { id: 'a1', name: 'Get customer profile', short: 'A1 profile', rate: 4000, sample: { cid: 'c1' }, ask: 'customer c1' },
  { id: 'a2', name: "List a customer's orders, newest first", short: 'A2 orders by customer', rate: 800, sample: { cid: 'c1' }, ask: '10 newest of c1' },
  { id: 'a3', name: 'Get an order with its items', short: 'A3 order + items', rate: 1000, sample: { oid: 'b7c' }, ask: 'order b7c + items' },
  { id: 'a4', name: 'List orders by status (ops: PENDING)', short: 'A4 orders by status', rate: 5, sample: { status: 'PENDING' }, ask: '50 oldest PENDING' },
  { id: 'a5', name: 'Get order by id', short: 'A5 order by id', rate: 1500, sample: { oid: 'd9e' }, ask: 'order d9e' },
];

/* ───────────────────────── DynamoDB: key design options ───────────────────────── */

export const ENTITY_OPTS: EntityOpt[] = [
  {
    id: 'c-good',
    entity: 'customer',
    table: 'app',
    pk: ['CUSTOMER#', { v: 'cid' }],
    sk: ['PROFILE'],
    verdict: 'good',
    why: 'Each customer is its own item collection; the profile is a fixed SK inside it, so orders can live next to it.',
  },
  {
    id: 'c-const',
    entity: 'customer',
    table: 'app',
    pk: ['CUSTOMER'],
    sk: [{ v: 'cid' }],
    verdict: 'trap',
    why: 'One partition key value for 1M customers: every profile read (4,000/s) lands on one partition, capped at 3,000 RCU.',
    fix: 'Put the id in the partition key: `PK=CUSTOMER#<cid>`, `SK=PROFILE`.',
  },
  {
    id: 'c-table',
    entity: 'customer',
    table: 'customers',
    pk: [{ v: 'cid' }],
    sk: null,
    verdict: 'meh',
    why: 'GetItem by id works, but the profile can never come back in the same request as the orders. Fine for these patterns, a join in the app for a "profile + recent orders" page.',
  },
  {
    id: 'o-good',
    entity: 'order',
    table: 'app',
    pk: ['CUSTOMER#', { v: 'cid' }],
    sk: ['ORDER#', { v: 'date' }, '#', { v: 'oid' }],
    verdict: 'good',
    why: "Orders sit in the customer's item collection, sorted by ISO date: newest-first is a reverse range read with Limit.",
  },
  {
    id: 'o-uuid',
    entity: 'order',
    table: 'app',
    pk: ['CUSTOMER#', { v: 'cid' }],
    sk: ['ORDER#', { v: 'oid' }],
    verdict: 'trap',
    why: 'A random UUID sorts randomly: "newest first" must read every order of the customer and sort in the app, and you cannot page.',
    fix: 'Lead the SK with something time-ordered: `ORDER#<iso-date>#<oid>` (or a ULID/KSUID order id).',
  },
  {
    id: 'o-const',
    entity: 'order',
    table: 'app',
    pk: ['ORDER'],
    sk: [{ v: 'oid' }],
    verdict: 'trap',
    why: 'All 20M orders under one key: 600 creates/s + 1,800 status updates/s = 2,400 WCU on one partition (cap 1,000). Per-customer lists become a filter over everything.',
    fix: 'Partition by a high-cardinality value the reads know: `PK=CUSTOMER#<cid>`.',
  },
  {
    id: 'o-status',
    entity: 'order',
    table: 'app',
    pk: [{ v: 'status' }],
    sk: [{ v: 'oid' }],
    verdict: 'trap',
    why: 'Five key values for 20M orders. Every new order lands in `PENDING`, and changing status changes the key: DeleteItem + PutItem (1,200 WCU per status key). The 88% DELIVERED collection is ~14 GB.',
    fix: 'Keep the base key on the entity (`CUSTOMER#<cid>`) and serve by-status reads from a write-sharded GSI.',
  },
  {
    id: 'o-table',
    entity: 'order',
    table: 'orders',
    pk: [{ v: 'oid' }],
    sk: null,
    verdict: 'meh',
    why: "Relational habit: one table per entity. By-id is a perfect GetItem, but a customer's orders need a Scan (no join, no index on customer_id) and order + items is an app-side join.",
    fix: "Co-locate what is read together: orders in the customer's collection, items in the order's.",
  },
  {
    id: 'i-good',
    entity: 'item',
    table: 'app',
    pk: ['ORDER#', { v: 'oid' }],
    sk: ['ITEM#', { v: 'n' }],
    verdict: 'good',
    why: "The order's items form one item collection: one Query returns all of them, in line order.",
  },
  {
    id: 'i-uuid',
    entity: 'item',
    table: 'app',
    pk: ['ITEM#', { v: 'iid' }],
    sk: null,
    viaHeaderList: true,
    verdict: 'trap',
    why: "Each line item is its own partition; the order stores an `item_ids` list. Reading an order's items = GetItem the order, then BatchGetItem the ids: 2 sequential round trips (N+1 shaped).",
    fix: 'Group children under the parent key: `PK=ORDER#<oid>`, `SK=ITEM#<n>`.',
  },
  {
    id: 'i-table',
    entity: 'item',
    table: 'order_items',
    pk: [{ v: 'oid' }],
    sk: [{ v: 'n' }],
    verdict: 'meh',
    why: 'Items are one Query per order, but always a second call next to the order (different table): an app-side join on every order page.',
  },
];

export const GSI_OPTS: GsiOpt[] = [
  { id: 'g1-none', slot: 'gsi1', label: 'No GSI1', verdict: 'meh', why: 'Nothing indexes orders by status.', map: null },
  {
    id: 'g1-hot',
    slot: 'gsi1',
    label: 'GSI1PK=STATUS#<status> · GSI1SK=<date>',
    verdict: 'trap',
    why: 'Every new order writes `STATUS#PENDING` and every status change deletes from one status key and inserts into another: ~1,200 WCU on one GSI partition. A throttled GSI back-pressures the base table: order writes fail too.',
    fix: 'Write-shard the key: `STATUS#<status>#<0-9>` (shard = hash(order id) % 10), read with 10 parallel Queries.',
    map: (e) => (e === 'order' ? { pk: ['STATUS#', { v: 'status' }], sk: [{ v: 'date' }] } : null),
  },
  {
    id: 'g1-shard',
    slot: 'gsi1',
    label: 'GSI1PK=STATUS#<status>#<shard 0-9> · GSI1SK=<date>',
    verdict: 'good',
    why: 'Each status is spread across 10 keys (~120 WCU each). Reads fan out to 10 Queries and merge by date: you trade read work for write headroom.',
    map: (e) => (e === 'order' ? { pk: ['STATUS#', { v: 'status' }, '#', { v: 'shard' }], sk: [{ v: 'date' }] } : null),
  },
  { id: 'g2-none', slot: 'gsi2', label: 'No GSI2', verdict: 'meh', why: 'Nothing indexes orders by id alone.', map: null },
  {
    id: 'g2-inv',
    slot: 'gsi2',
    label: 'Inverted index: GSI2PK=SK · GSI2SK=PK',
    verdict: 'trap',
    why: 'An inverted index only helps if you know the full SK at read time. `ORDER#<date>#<oid>` needs the date; `PROFILE` and `ITEM#1` become giant low-cardinality keys.',
    fix: 'Write a dedicated lookup key on the order and its items: `GSI2PK=ORDER#<oid>`.',
    map: (_e, base) => (base.sk ? { pk: base.sk, sk: base.pk } : null),
  },
  {
    id: 'g2-lookup',
    slot: 'gsi2',
    label: 'Lookup: GSI2PK=ORDER#<oid> · GSI2SK=#ORDER | ITEM#<n>',
    verdict: 'good',
    why: 'Overloaded GSI: the order header and its items share `GSI2PK=ORDER#<oid>`, so by-id and order+items are one Query (`#` sorts before `I`, header first).',
    map: (e) =>
      e === 'order' ? { pk: ['ORDER#', { v: 'oid' }], sk: ['#ORDER'] } : e === 'item' ? { pk: ['ORDER#', { v: 'oid' }], sk: ['ITEM#', { v: 'n' }] } : null,
  },
];

/* ───────────────────────── DynamoDB: sample rows for the visual ───────────────────────── */

const order = (oid: string, cid: string, date: string, status: string, shard: number, items: number) => ({ oid, cid, date, status, shard, items });
const ORDERS = [
  order('a1f', 'c1', '2026-11-02', 'DELIVERED', 3, 2),
  order('b7c', 'c1', '2026-11-20', 'PENDING', 7, 3),
  order('c3d', 'c2', '2026-10-15', 'DELIVERED', 1, 1),
  order('d9e', 'c2', '2026-11-22', 'PENDING', 4, 2),
  order('e2a', 'c3', '2026-11-18', 'SHIPPED', 8, 2),
  order('f5b', 'c3', '2026-11-24', 'PENDING', 0, 1),
];
const NAMES: Record<string, string> = { c1: 'Ada', c2: 'Lin', c3: 'Sam' };
const IIDS = ['1a', '2b', '3c', '4d', '5e', '6f', '7a', '8b', '9c', 'ad', 'be'];

export const SAMPLE: Inst[] = (() => {
  const out: Inst[] = Object.keys(NAMES).map((cid) => ({ id: `cust:${cid}`, entity: 'customer' as const, vals: { cid }, label: NAMES[cid] }));
  let k = 0;
  for (const o of ORDERS) {
    const vals = { cid: o.cid, oid: o.oid, date: o.date, status: o.status, shard: String(o.shard) };
    out.push({ id: `order:${o.oid}`, entity: 'order', vals, label: o.status });
    for (let n = 1; n <= o.items; n++) out.push({ id: `item:${o.oid}:${n}`, entity: 'item', vals: { ...vals, n: String(n), iid: `i-${IIDS[k++ % IIDS.length]}` }, label: `line ${n}` });
  }
  return out;
})();

/* ───────────────────────── Walkthrough steps ───────────────────────── */

export type StepTag = 'problem' | 'technique' | 'tradeoff' | 'failure' | 'recap';

export interface LabStep<S> {
  id: string;
  title: string;
  tag: StepTag;
  body: string[];
  preset?: S;
  predict?: Predict;
  keyIdea?: string;
  /** DynamoDB: access pattern to animate when the step is revealed. */
  focus?: string;
}

const D = (customer: string, order: string, item: string, gsi1 = 'g1-none', gsi2 = 'g2-none'): DDesign => ({ customer, order, item, gsi1, gsi2 });
const GOOD = D('c-good', 'o-good', 'i-good');

export const DYNAMO_START = D('c-table', 'o-table', 'i-table');

export const DYNAMO_STEPS: LabStep<DDesign>[] = [
  {
    id: 'patterns',
    title: 'Access patterns first, keys second',
    tag: 'problem',
    body: [
      'Relational design starts from entities and lets the query planner find a path later. DynamoDB has **no joins and no planner**: a request either names a partition key (`Query`/`GetItem`) or reads the whole table (`Scan`).',
      'So you write the **5 access patterns** down first (cards above the tables), then pick keys so that each one is a single cheap request.',
      'Start: the relational habit. One table per entity, keyed by id. Click **A2** to watch a customer\'s order history: there is no key for "orders of customer c1", so DynamoDB scans everything.',
    ],
    preset: DYNAMO_START,
    focus: 'a2',
    keyIdea: 'Keys are your only indexes. A pattern that cannot name a partition key is a Scan.',
  },
  {
    id: 'one-key',
    title: 'One table, one constant key',
    tag: 'failure',
    body: [
      'Single-table attempt #1: everything in one table, all orders under `PK=ORDER`, all profiles under `PK=CUSTOMER`.',
      'DynamoDB places items by **hash(PK)**. One key value means one partition, and a partition serves at most **1,000 WCU and 3,000 RCU**.',
    ],
    preset: D('c-const', 'o-const', 'i-good'),
    predict: {
      question: 'All orders share `PK=ORDER`. Peak is 600 new orders/s plus 1,800 status updates/s. What happens?',
      options: ['Fine: on-demand mode scales automatically', 'That key needs ~2,400 WCU on one partition (cap 1,000): writes throttle', 'Writes get slower but are never rejected', 'Only reads are affected'],
      answer: 1,
      explain: 'On-demand raises the table limit, not the per-partition one. Adaptive capacity can isolate a hot key on its own partition but cannot give one key more than one partition can serve: ~1,400 writes/s get `ProvisionedThroughputExceededException`.',
    },
    focus: 'a5',
    keyIdea: 'Partition keys need high cardinality and evenly spread traffic.',
  },
  {
    id: 'collection',
    title: 'Item collections: the customer owns its orders',
    tag: 'technique',
    body: [
      '`PK=CUSTOMER#<cid>` holds the profile (`SK=PROFILE`) and every order (`SK=ORDER#<iso-date>#<oid>`). Items with the same PK form an **item collection**, stored together and **sorted by SK**.',
      'Items go to their own collection: `PK=ORDER#<oid>`, `SK=ITEM#<n>`.',
    ],
    preset: GOOD,
    predict: {
      question: 'Orders are `PK=CUSTOMER#c1`, `SK=ORDER#<iso-date>#<oid>`. How do you get the 10 newest?',
      options: [
        'Scan with a filter on customer id',
        '`Query PK=CUSTOMER#c1 AND begins_with(SK, "ORDER#")`, `ScanIndexForward=false`, `Limit 10`',
        'GetItem 10 times',
        'Query the collection, then sort in the app',
      ],
      answer: 1,
      explain: 'The SK is already in date order. Reading the range backwards with Limit 10 touches exactly 10 items: 8 KB, 2 RCU, one round trip.',
    },
    focus: 'a2',
    keyIdea: 'Same PK = co-located. SK order = free sorting and range queries (`begins_with`, `BETWEEN`).',
  },
  {
    id: 'uuid',
    title: 'Trap: a random sort key',
    tag: 'failure',
    body: ['Someone "simplifies" the order SK to `ORDER#<uuid>`. Still the right collection, still one Query.'],
    preset: D('c-good', 'o-uuid', 'i-good'),
    predict: {
      question: 'With `SK=ORDER#<random uuid>`, what happens to "newest first"?',
      options: ['Nothing: DynamoDB keeps insertion order', 'Still one Query, but it must read all of the customer\'s orders and sort in the app', 'It becomes a Scan', 'DynamoDB sorts by write timestamp'],
      answer: 1,
      explain: 'UUIDs sort randomly. 20 orders: wasteful. The 2,000-order B2B customer: 1.6 MB, two 1 MB pages, and no way to page newest-first.',
    },
    focus: 'a2',
  },
  {
    id: 'gsi',
    title: 'A second access key: GSI',
    tag: 'technique',
    body: [
      'Ops needs "all PENDING orders". Status is not in any key, so that is a Scan. A **global secondary index** is an async, eventually consistent copy of the table keyed by other attributes.',
      'First try: `GSI1PK=STATUS#<status>`, `GSI1SK=<date>`.',
    ],
    preset: D('c-good', 'o-good', 'i-good', 'g1-hot'),
    predict: {
      question: 'Every new order is PENDING, then leaves PENDING. Write load on GSI key `STATUS#PENDING`?',
      options: ['~600 WCU: only inserts count', '~1,200 WCU: an insert per new order + a delete when it moves on: over the 1,000 cap', '0: GSIs are free', '~60 WCU'],
      answer: 1,
      explain: 'Changing an indexed key = delete the old GSI entry + put the new one. When a GSI throttles, DynamoDB throttles the **base table** writes too.',
    },
    focus: 'a4',
    keyIdea: 'GSIs fix read paths but their keys need the same cardinality discipline as the table.',
  },
  {
    id: 'shard',
    title: 'Write sharding the hot GSI key',
    tag: 'technique',
    body: ['Append a shard suffix: `STATUS#PENDING#<0-9>`, where shard = hash(order id) % 10. Each key now gets ~120 WCU.'],
    preset: D('c-good', 'o-good', 'i-good', 'g1-shard'),
    predict: {
      question: 'What does reading a page of PENDING orders cost now?',
      options: ['Same single Query', '10 parallel Queries (one per shard), merged by date in the app', 'A Scan', 'Impossible with shards'],
      answer: 1,
      explain: 'Scatter-gather: each shard returns its 50 oldest, the app merges and keeps 50. You trade 10× read requests (cheap, rare) for 10× write headroom (hot, constant).',
    },
    focus: 'a4',
  },
  {
    id: 'by-id',
    title: 'Order by id: the inverted-index temptation',
    tag: 'tradeoff',
    body: [
      'A5 and A3 only know the **order id**. Orders live under `CUSTOMER#<cid>`, so the base table cannot find them.',
      'Classic trick: an **inverted index** (GSI2PK = SK, GSI2SK = PK).',
    ],
    preset: D('c-good', 'o-good', 'i-good', 'g1-shard', 'g2-inv'),
    predict: {
      question: 'With the inverted index, can you get order `d9e` by id alone?',
      options: ['Yes: `GSI2PK=ORDER#…#d9e`', 'No: the inverted PK is `ORDER#<date>#d9e` and you don\'t know the date', 'Yes, with `begins_with` on the partition key', 'Only with strongly consistent reads'],
      answer: 1,
      explain: 'Key conditions need the **exact** partition key; `begins_with` works only on the sort key. Also look at GSI2: `PROFILE` and `ITEM#1` are now giant low-cardinality keys.',
    },
    focus: 'a5',
  },
  {
    id: 'lookup',
    title: 'Overloaded lookup GSI: every pattern is one Query',
    tag: 'recap',
    body: [
      'Write `GSI2PK=ORDER#<oid>` on the order (`GSI2SK=#ORDER`) **and** on each item (`GSI2SK=ITEM#<n>`). One GSI partition now holds the header and its lines, header first.',
      'Click through A1–A5: every pattern is a single Query on one item collection, no Scan, no hot key.',
    ],
    preset: D('c-good', 'o-good', 'i-good', 'g1-shard', 'g2-lookup'),
    focus: 'a3',
    keyIdea: 'Design sequence: list patterns → choose PK/SK per entity so each pattern names one collection → add GSIs for other lookup keys → check cardinality of every key.',
  },
  {
    id: 'yours',
    title: 'Your turn',
    tag: 'recap',
    body: [
      'Back to the relational starting point (plus the hot status GSI). Use **Key design** on the right to solve the exercises. Each change shows which patterns flipped and what it cost.',
    ],
    preset: D('c-table', 'o-table', 'i-table', 'g1-hot'),
  },
];

export const CASS_STEPS: LabStep<CState>[] = [
  {
    id: 'conv',
    title: 'Partition by conversation, cluster by time',
    tag: 'technique',
    body: [
      'Cassandra hashes the **partition key** with Murmur3 into a token on the ring; the token decides which nodes (RF=3) own the partition.',
      'Inside a partition, rows are stored sorted by the **clustering key**. With `sent_at DESC`, the newest message is the first row on disk, so "latest 50" is a slice of one partition.',
    ],
    preset: { pk: 'conv', ck: 'sent-desc', months: 6, perDay: 2000 },
    keyIdea: 'Partition key = where. Clustering key = order within. Queries must name the full partition key.',
  },
  {
    id: 'grow',
    title: 'Unbounded partitions',
    tag: 'failure',
    body: ['Same table, five years later. Drag **months** to see the busy conversation grow; nothing ever closes a partition.'],
    preset: { pk: 'conv', ck: 'sent-desc', months: 60, perDay: 2000 },
    predict: {
      question: 'A busy conversation (2,000 msgs/day, ~250 B per row) after 5 years. Partition size?',
      options: ['~3.6 MB', '~45 MB', '~3.65M rows, ~0.9 GB: unbounded', 'Cassandra auto-splits it at 100 MB'],
      answer: 2,
      explain: 'Cassandra never splits a partition. Past ~100 MB / 100k rows, compaction, repair and reads (and tombstones when old messages are deleted) get slow on the three replicas that own it.',
    },
  },
  {
    id: 'bucket',
    title: 'Bucket the partition key by time',
    tag: 'technique',
    body: ['Add a time bucket to the partition key: `PRIMARY KEY ((conversation_id, day_bucket), sent_at, message_id)`. Each partition holds at most one day.'],
    preset: { pk: 'conv-day', ck: 'sent-desc', months: 60, perDay: 2000 },
    predict: {
      question: 'At 2,000 msgs/day, how many partitions does "latest 50" read now?',
      options: ["One: today's bucket", '1,825: one per day of history', 'All six nodes', 'It needs ALLOW FILTERING'],
      answer: 0,
      explain: 'The app computes today\'s bucket and asks for `(conversation_id, today)`: a single-partition slice of 50 rows, and partitions stay ~2,000 rows forever.',
    },
    keyIdea: 'Bound partitions with a bucket derived from data the reader already knows (time).',
  },
  {
    id: 'quiet',
    title: 'Bucket size must match traffic',
    tag: 'tradeoff',
    body: ['Most conversations are quiet. Drag **messages/day** down to 5 with day buckets.'],
    preset: { pk: 'conv-day', ck: 'sent-desc', months: 60, perDay: 5 },
    predict: {
      question: 'A quiet conversation (5 msgs/day) with day buckets. Latest 50?',
      options: ['Still one partition', '~10 day-partitions walked one after another (more if some days are empty)', 'A full table scan', 'Cassandra merges buckets automatically'],
      answer: 1,
      explain: 'Each bucket holds 5 rows, so the app walks back day by day. Pick the bucket so a partition holds "a page or more" but stays bounded: month buckets here, or bucket size per conversation tier.',
    },
  },
  {
    id: 'month',
    title: 'Month buckets',
    tag: 'technique',
    body: ['`((conversation_id, month_bucket))`: quiet chats get ~150 rows per partition and one read; a 2,000/day chat gets ~61k rows (~15 MB), still bounded. At 20,000/day it would not be: try it.'],
    preset: { pk: 'conv-month', ck: 'sent-desc', months: 60, perDay: 5 },
  },
  {
    id: 'filter',
    title: 'Trap: the wrong partition key + ALLOW FILTERING',
    tag: 'failure',
    body: ['Partition by `message_id` ("perfectly even spread!"). Now ask for the latest 50 messages of a conversation.'],
    preset: { pk: 'msg', ck: 'sent-desc', months: 60, perDay: 2000 },
    predict: {
      question: '`SELECT * FROM messages WHERE conversation_id = ? LIMIT 50` with `PRIMARY KEY (message_id)`?',
      options: ['Works: the token ring finds it', 'Rejected; with ALLOW FILTERING it reads every partition on every node', 'Works thanks to LIMIT 50', 'Cassandra builds an index automatically'],
      answer: 1,
      explain: 'Without the partition key the coordinator cannot compute a token, so it must ask every token range. ALLOW FILTERING silences the error, not the cost. A secondary index is also a scatter-gather to all nodes.',
    },
  },
  {
    id: 'overwrite',
    title: 'Trap: no clustering column',
    tag: 'failure',
    body: ['`PRIMARY KEY ((conversation_id))` with no clustering column: the partition key alone is the full primary key.'],
    preset: { pk: 'conv', ck: 'none', months: 6, perDay: 2000 },
    predict: {
      question: 'Insert 3 messages into one conversation. How many rows exist?',
      options: ['3 rows', '1 row: every INSERT is an upsert on the same primary key', 'Error: duplicate key', '3 rows in insertion order'],
      answer: 1,
      explain: 'Cassandra writes are upserts. Same primary key = same row, last write wins. Silent data loss, no error.',
    },
  },
  {
    id: 'yours',
    title: 'Your turn',
    tag: 'recap',
    body: ['Starting point: one partition per conversation, clustered by a random UUID. Fix it so a busy conversation (2,000 msgs/day for 5 years) stays bounded and the latest 50 come from one sorted partition slice.'],
    preset: { pk: 'conv', ck: 'msgid', months: 24, perDay: 2000 },
  },
];

export const MONGO_STEPS: LabStep<MState>[] = [
  {
    id: 'embed',
    title: 'Embed what you read together',
    tag: 'technique',
    body: [
      'A blog page shows the post, the author name and the latest 10 comments. Documents let you **embed** related data: one read, one document, no join.',
      'Start: author snapshot and all comments embedded in the post.',
    ],
    preset: { author: 'embed', comments: 'embed', count: 200 },
    keyIdea: 'Model for the page, not the entity: data read together lives together.',
  },
  {
    id: 'viral',
    title: 'The viral post',
    tag: 'failure',
    body: ['Drag **comments per post** up: the post goes viral.'],
    preset: { author: 'embed', comments: 'embed', count: 50_000 },
    predict: {
      question: '50,000 comments × ~350 B, all embedded in the post. What happens?',
      options: ['Fine: documents grow freely', 'The doc reaches ~17 MB > the 16 MB BSON limit: the next `$push` fails', 'MongoDB moves comments to GridFS', 'Only reads get slower'],
      answer: 1,
      explain: 'Hard limit: 16 MB per document. Long before that, every `$push` rewrites a multi-MB document (WiredTiger has no in-place append) and every page view pulls megabytes into cache.',
    },
  },
  {
    id: 'ref',
    title: 'Reference the unbounded side',
    tag: 'technique',
    body: ['Comments move to their own collection with `post_id`. The page reads the post, then the latest 10 comments.'],
    preset: { author: 'embed', comments: 'collection', count: 50_000 },
    predict: {
      question: 'Reads per page view now (author still embedded)?',
      options: ['1', '2: the post + `comments.find({post_id}).sort({created_at:-1}).limit(10)`', '50,001', '3'],
      answer: 1,
      explain: 'Two indexed reads. Without the compound index `{post_id: 1, created_at: -1}` the second read becomes a collection scan plus an in-memory sort.',
    },
  },
  {
    id: 'rename',
    title: 'Author: snapshot vs reference',
    tag: 'tradeoff',
    body: ['The author has 300 posts. An embedded snapshot duplicates their name into each one.'],
    preset: { author: 'ref', comments: 'collection', count: 50_000 },
    predict: {
      question: 'Switch the author to a reference (`author_id`). Rename fan-out and reads per page view?',
      options: ['Rename: 300 → 1 document; page view: 2 → 3 reads', 'Both unchanged', 'Rename 300 → 1, reads unchanged', 'Rename 1 → 300'],
      answer: 0,
      explain: 'Classic trade: references make writes cheap and reads more expensive. Renames are rare and page views are constant, so a snapshot (refreshed by an async job, or kept as "name at time of posting") is often the better default.',
    },
  },
  {
    id: 'subset',
    title: 'Subset pattern: hot slice embedded, the rest referenced',
    tag: 'technique',
    body: ['Embed only the **latest 10** comments (`$push` with `$slice: -10`) plus a `comment_count`; every comment also lives in the `comments` collection for "load more".'],
    preset: { author: 'embed', comments: 'subset', count: 50_000 },
    predict: {
      question: 'Writes per new comment with the subset pattern?',
      options: ['1', '2: insert into `comments` + `$push/$slice` on the post', '50,000', '0'],
      answer: 1,
      explain: 'Two writes (atomic together only in a transaction; usually acceptable to be briefly out of sync). The post stays ~10 KB no matter how viral, and the page is one read.',
    },
    keyIdea: 'Embed bounded data, reference unbounded data, embed a bounded slice of unbounded data when the page needs it.',
  },
  {
    id: 'yours',
    title: 'Your turn',
    tag: 'recap',
    body: ['Back to a referenced author and an embedded comment array. Pick embed/reference so a page view is ≤ 2 reads and the post stays under 1 MB even at 50,000 comments.'],
    preset: { author: 'ref', comments: 'embed', count: 1000 },
  },
];

/* ───────────────────────── Under the hood ───────────────────────── */

export const UNDER_HOOD: Record<'dynamo' | 'cassandra' | 'mongo', { title: string; body: string }[]> = {
  dynamo: [
    { title: 'Partitions', body: 'Items are placed by an internal hash of the partition key. A partition holds ~10 GB and serves up to **3,000 RCU** and **1,000 WCU** (1 RCU = one strongly consistent 4 KB read/s; 1 WCU = one 1 KB write/s). Partitions split as size or traffic grows.' },
    { title: 'Adaptive capacity', body: 'Unused throughput is shifted to busy partitions and hot items can be isolated on their own partition (split-for-heat by sort key range). It cannot make **one key value** faster than one partition, and monotonically increasing SKs keep hitting the last split.' },
    { title: 'Item collections', body: 'All items with the same PK, stored together sorted by SK (UTF-8 bytes). `Query` reads a contiguous SK range, up to **1 MB per page**. The **10 GB** item-collection cap applies only to tables with a local secondary index.' },
    { title: 'GSIs', body: 'A GSI is a separate table that DynamoDB maintains **asynchronously** from the base table: reads are eventually consistent only, every projected write costs WCU again, and a throttled GSI throttles base-table writes. No `GetItem` on a GSI, only `Query`/`Scan`.' },
    { title: 'Read costs', body: '`Query` sums the item sizes and rounds up to 4 KB once; `BatchGetItem` rounds **each** item up to 4 KB. Eventually consistent reads cost half. `Scan` reads every item (1 MB per page) and filters afterwards: you pay for everything read, not returned.' },
  ],
  cassandra: [
    { title: 'Token ring', body: 'The Murmur3 partitioner hashes the partition key to a 64-bit token. Each node (via vnodes) owns token ranges; with RF=3 the next replicas clockwise hold copies. A query with the full partition key goes to exactly those replicas.' },
    { title: 'Clustering order', body: 'Within a partition, rows are sorted by clustering columns in memtables and SSTables, so a slice `LIMIT 50` reads contiguous rows. Reverse-order reads work but are a little less efficient.' },
    { title: 'Partition size', body: 'Partitions never split. Guidance: keep them under **~100 MB** and **~100k rows**. Big partitions hurt compaction, repair, streaming and heap on the owning replicas.' },
    { title: 'Tombstones', body: 'Deletes and TTL expiry write **tombstones**, purged only after `gc_grace_seconds` and compaction. A read that walks >100k tombstones fails (`tombstone_failure_threshold`). Time-bucketed partitions + TTL + TimeWindowCompactionStrategy let whole SSTables expire.' },
    { title: 'Upserts & filtering', body: 'INSERT and UPDATE are both upserts on the primary key. Queries without the full partition key need `ALLOW FILTERING` (or a secondary index): a fan-out to every token range.' },
  ],
  mongo: [
    { title: '16 MB documents', body: 'A BSON document is capped at **16 MB**; writes that would exceed it fail. GridFS exists for files, not for growing arrays.' },
    { title: 'WiredTiger updates', body: 'WiredTiger does not update documents in place: a modified document is written as a new version. A `$push` onto a 10 MB document costs ~10 MB of cache churn and checkpoint I/O.' },
    { title: 'Reads load whole documents', body: 'A projection or `$slice` trims what goes over the network, but the storage engine still loads the whole document into cache.' },
    { title: '$lookup', body: '`$lookup` is a join executed per input document against another collection (needs an index on the foreign field). Convenient, but it is still N index lookups and cannot join across shards cheaply.' },
    { title: 'Indexes', body: 'Referencing moves cost into indexes: `comments {post_id: 1, created_at: -1}` serves "latest 10 for a post" as an index range scan with no in-memory sort. Indexing fields inside arrays creates a multikey index (one entry per element).' },
  ],
};
