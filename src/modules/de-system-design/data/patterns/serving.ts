import type { Pattern } from '../../types';
import { E, N, W, X, req } from './dsl';

export const realtimeOlap: Pattern = {
  id: 'realtime-olap',
  num: 11,
  title: 'Real-time OLAP serving',
  group: 'Serving',
  tagline: 'Thousands of users slicing fresh data at once need a store built for it: streaming ingestion, columnar segments, pre-aggregation and indexes, with sub-second p99.',
  minutes: 13,
  level: 'Intermediate',
  signals: [
    '"user-facing analytics": dashboards inside the product, not for analysts',
    '"thousands of queries per second" plus "group by / filter / time range"',
    '"seconds-fresh" numbers with sub-second latency',
    '"the warehouse is too slow / too expensive for the app"',
  ],
  learn: [
    'Why OLTP databases and warehouses fail at user-facing analytics',
    'How Druid, Pinot and ClickHouse ingest from Kafka into real-time segments',
    'Real-time vs historical segments, and segment hand-off',
    'Rollup, sorted columns, inverted and star-tree indexes',
    'What real-time OLAP is not good at (big joins, updates, ad-hoc exploration)',
  ],
  realWorld: [
    { who: 'LinkedIn', how: 'Built Apache Pinot for “Who viewed your profile” and other member-facing analytics: hundreds of thousands of queries per second at millisecond latency, ingested from Kafka.' },
    { who: 'Uber Eats', how: 'Restaurant Manager shows restaurants live order, rating and revenue analytics from Pinot, fed by Kafka and Flink.' },
    { who: 'Cloudflare', how: 'Customer-facing HTTP and DNS analytics run on ClickHouse, ingesting millions of rows per second.' },
    { who: 'Netflix', how: 'Uses Apache Druid for real-time playback and device-quality metrics, queried interactively by engineers.' },
  ],
  scenario: {
    id: 'ro-seller-analytics',
    title: 'Live seller analytics',
    context:
      'A marketplace gives each of its 2 million sellers a live dashboard: views, add-to-carts and sales per listing, filterable by hour, country and device, for the last 90 days. 50,000 storefront events/s. Sellers refresh obsessively during promotions: 3,000 dashboard queries/s at peak, each a filter + group-by over one seller’s data. Product wants a p99 under 200 ms and numbers no more than seconds old.',
    workload: { eps: 50000, unit: 'storefront event', queryQps: 3000 },
    requirements: [
      req.queryP99(200, 'Dashboards inside the product must feel instant, even at peak query load.'),
      req.fresh(10, 'During a flash sale, sellers want to see sales within seconds.'),
      req.throughput(50000, 'events'),
      req.noOltp('Analytics must not run against the marketplace’s production database.'),
      req.survives('olap', 'Losing one OLAP server keeps dashboards up', 'Run several servers with replicated segments so a query can be served by another replica.'),
      req.noLoss('Storefront events go to a durable log before anything else.'),
    ],
    palette: ['app-db', 'events', 'kafka', 'cdc', 'flink', 'prod-analytics', 'warehouse', 'trino', 'olap', 'kv', 'lakehouse', 'app-api', 'bi'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Storefront emits view, cart and order events with seller_id, listing_id and event time.', { label: 'Storefront events' }),
        N('kafka', 'kafka', X[1], 160, '3 brokers, RF=3, topic partitioned by seller_id. OLAP servers consume it directly.', { count: 3 }),
        N('olap', 'olap', X[2], 160, 'Pinot/Druid: 3 servers, each segment on 2 replicas. Real-time segments consume Kafka; sealed segments move to historical servers. Sorted by seller_id, inverted index on country/device, star-tree on (seller, hour).', { count: 3 }),
        N('api', 'app-api', X[3], 160, 'Seller dashboard API: always filters by seller_id and a time range, caches for a few seconds.'),
      ],
      edges: [
        E('events', 'kafka'),
        E('kafka', 'olap', 'Pull-based streaming ingestion: each server consumes its partitions, builds a mutable in-memory segment and makes rows queryable within seconds.'),
        E('olap', 'api', 'Low-latency SQL: `WHERE seller_id = ? AND ts > now() - 7d GROUP BY hour, country`.'),
      ],
    },
    wrong: {
      'prod-analytics': {
        why: 'Aggregating 90 days of events per seller on the production database at 3,000 queries/s would melt the checkout path. OLTP row stores aren’t built for scans and group-bys.',
        instead: W.prodAnalytics.instead,
      },
      warehouse: {
        why: 'A warehouse is built for few, big analyst queries: seconds per query and a small concurrency limit per cluster (Snowflake queues beyond about 8 queries per warehouse). 3,000 queries/s × 2 s ≈ 6,000 concurrent queries, which means hundreds of clusters and a huge bill, with p99 still in seconds.',
        instead: 'Keep the warehouse for analysts. Serve the product from a real-time OLAP store (Pinot, Druid, ClickHouse) that answers in milliseconds at thousands of QPS.',
      },
      trino: {
        why: 'A federated query engine plans and scans files for every query: great for ad-hoc analysis, but seconds per query and tens of concurrent queries, not thousands.',
        instead: 'Pre-index the data in a real-time OLAP store and serve dashboards from it.',
      },
    },
    alt: {
      cdc: 'If some numbers live only in the order database (refunds, cancellations), CDC into Kafka is the right way to get them into the OLAP store.',
      'app-db': 'The app database is fine as a CDC source, just never as the query engine for analytics.',
      flink: 'A Flink job before the OLAP store can enrich events (join listing category, filter bots) and deduplicate. Worth it once raw events aren’t enough.',
      kv: 'If every query is a fixed lookup (one seller, one day), a precomputed key-value table is even faster, but it can’t filter or group by arbitrary dimensions.',
    },
  },
  extras: {
    nodes: [
      N('db', 'app-db', X[0], 320, 'The marketplace’s Postgres: orders, listings and an events table.', { label: 'Marketplace DB' }),
      N('pa', 'prod-analytics', X[1], 320, 'Dashboard queries run straight against the production database (or its read replica).'),
      N('wh', 'warehouse', X[2], 320, 'Snowflake/BigQuery fed by Snowpipe streaming: the analysts’ warehouse, reused for the product.'),
    ],
    edges: [E('db', 'pa'), E('pa', 'api'), E('kafka', 'wh'), E('wh', 'api')],
  },
  guided: [
    {
      title: 'Dashboards on the production database',
      tag: 'problem',
      body: [
        'The quick version: the seller dashboard runs `SELECT hour, count(*) … GROUP BY hour` against the marketplace Postgres (or a read replica).',
        'It works with 50 sellers in beta. At 3,000 queries/s, each scanning thousands of rows, the database is overwhelmed and the checkout path slows with it.',
      ],
      add: ['db', 'pa', 'api'],
      predict: {
        question: 'Moving the dashboard queries to a read replica: does that fix it?',
        options: ['Yes, replicas scale reads infinitely', 'It protects checkout a bit, but a row store still can’t do 3,000 scan-and-aggregate queries/s fast', 'Yes, if you add an index on seller_id', 'Only if you use MySQL'],
        answer: 1,
        explain: 'A replica isolates the blast radius, but every query still scans and aggregates rows. Row-oriented OLTP engines are built for point reads and writes, not analytics at high concurrency.',
      },
    },
    {
      title: 'The warehouse, then?',
      tag: 'problem',
      body: [
        'Next idea: events already stream into the warehouse for analysts, so point the dashboard at it.',
        'Warehouses are tuned for a few large queries: a query takes seconds (compile, plan, spin up workers, scan micro-partitions), and each cluster runs only a handful of queries concurrently. At 3,000 queries/s the queue grows without bound.',
      ],
      add: ['events', 'kafka', 'wh'],
      remove: ['db', 'pa'],
      predict: {
        question: 'Each query takes about 2 s and a cluster runs about 8 at once. Roughly how many clusters do you need for 3,000 queries/s?',
        options: ['1', 'About 10', 'About 750', 'It depends on the data size only'],
        answer: 2,
        explain: '3,000 × 2 s = 6,000 queries in flight. 6,000 / 8 ≈ 750 clusters, which is absurd, and every query is still seconds long. Concurrency, not storage, is what kills the warehouse here.',
      },
    },
    {
      title: 'A real-time OLAP store',
      tag: 'technique',
      body: [
        'Druid, Pinot and ClickHouse are built for exactly this: **many small analytic queries, filtered to a narrow slice**, over fresh data. They store data in compressed columnar **segments**, keep indexes on them and ingest straight from Kafka.',
        'Each server consumes some Kafka partitions and makes rows queryable within seconds. A broker scatters each query to the servers that hold the relevant segments and merges the partial results.',
      ],
      add: ['olap'],
      remove: ['wh'],
      keyIdea: 'Warehouses optimize for big queries from few people. Real-time OLAP optimizes for small queries from many people.',
    },
    {
      title: 'Real-time and historical segments',
      tag: 'technique',
      body: [
        'Recent data lives in a **real-time (consuming) segment**: mutable, in memory, indexed as rows arrive. When it reaches a size or time limit it is **sealed**: converted to an immutable, compressed, fully indexed segment, uploaded to deep storage (S3) and handed to **historical** servers.',
        'A query for “last 7 days” reads a few historical segments plus the current real-time one. Historical segments are replicated, so a server can die without losing data or availability, and deep storage can rebuild any of them.',
        'Retention is a segment operation too: dropping 91-day-old data means deleting whole segments, not running `DELETE`.',
      ],
      goodToKnow: 'Pinot calls them REALTIME and OFFLINE tables behind one hybrid table. Druid calls them real-time tasks and historicals. ClickHouse uses MergeTree parts that merge in the background.',
    },
    {
      title: 'Rollup and indexes',
      tag: 'technique',
      body: [
        '**Rollup** pre-aggregates at ingestion: if the dashboard never needs single events, store one row per (seller, listing, minute, country, device) with counts and sums. Often 10–100× fewer rows.',
        '**Sorted column**: sort segments by seller_id so one seller’s rows are contiguous. **Inverted indexes** on country and device turn filters into bitmap intersections. A **star-tree index** (Pinot) pre-computes aggregates for chosen dimension combinations, so a group-by reads a few hundred pre-aggregated rows instead of millions.',
        'Partition the Kafka topic and the table by seller_id, and a query touches only the servers that hold that seller.',
      ],
      predict: {
        question: 'Every dashboard query filters on one seller. Which layout choice helps most?',
        options: ['Sort and partition segments by seller_id', 'An inverted index on event_id', 'Bigger servers', 'Store events as JSON'],
        answer: 0,
        explain: 'Sorting by seller_id makes each query read one contiguous range; partitioning by it prunes whole servers and segments. Indexes on high-cardinality ids that nobody filters on just waste memory.',
      },
      keyIdea: 'Design the table for the query: roll up what you never drill into, sort by the filter everyone uses, index the dimensions people slice by.',
    },
    {
      title: 'Peak traffic',
      tag: 'tradeoff',
      body: [
        'A promotion doubles both events and dashboard refreshes. Watch the OLAP node: query capacity per server is finite, and as utilization rises, queueing pushes p99 up long before anything fails.',
        'Scale out servers and replicas for query capacity, add short API-side caching (a dashboard refreshed every 2 s by 1,000 tabs is one query), and keep segment counts low (rollup, larger segments) so each query fans out less.',
      ],
      traffic: 2,
    },
    {
      title: 'An OLAP server dies',
      tag: 'failure',
      body: ['Kill one of the three OLAP servers. Every segment has a replica on another server, so brokers route queries there while the cluster re-replicates from deep storage, and real-time ingestion resumes from the last committed Kafka offset.'],
      kill: ['olap'],
    },
    {
      title: 'What real-time OLAP isn’t',
      tag: 'tradeoff',
      body: [
        'Real-time OLAP stores are fast because they are narrow. Large joins between big tables are weak or unsupported (denormalize upstream with Flink instead). Updates and deletes are limited (Pinot upserts by primary key, ClickHouse ReplacingMergeTree), so corrections are best handled as new rows or re-ingested segments.',
        'They aren’t a warehouse replacement either: analysts still want SQL over years of history with arbitrary joins. Keep both, fed from the same Kafka topics.',
      ],
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'User-facing analytics = high QPS + fresh data + low latency. Prod databases melt, warehouses queue. Use Kafka → real-time OLAP (Pinot, Druid, ClickHouse), with rollup, a sorted partition key and indexes designed for the dashboard’s queries, and replicas for both availability and query capacity.',
      ],
    },
  ],
  quiz: [
    {
      id: 'ro-q1',
      q: 'Why is a cloud warehouse a poor fit for a dashboard serving 3,000 queries/s?',
      options: ['It can’t store enough data', 'Queries take seconds and each cluster runs only a few at once, so concurrency costs explode', 'It doesn’t support SQL', 'It can’t ingest from Kafka'],
      answer: 1,
      why: 'Warehouses are built for throughput on big queries, not thousands of small concurrent ones. Concurrency limits and per-query latency make it slow and expensive.',
    },
    {
      id: 'ro-q2',
      q: 'What happens when a Pinot/Druid real-time segment is sealed?',
      options: ['It is deleted', 'It becomes an immutable, compressed, indexed segment in deep storage, served by historical/offline servers', 'It is sent back to Kafka', 'It is merged into the warehouse'],
      answer: 1,
      why: 'Consuming segments are mutable and in memory. Sealing converts them into optimized immutable segments that can be replicated and rebuilt from deep storage.',
    },
    {
      id: 'ro-q3',
      q: 'What does rollup at ingestion trade away?',
      options: ['Freshness', 'The ability to query individual events below the rollup grain', 'Durability', 'Query speed'],
      answer: 1,
      why: 'Rollup stores aggregates at a chosen grain. It shrinks data and speeds queries, but you can no longer drill into single events or dimensions you rolled away.',
    },
    {
      id: 'ro-q4',
      q: 'Which query is a real-time OLAP store worst at?',
      options: ['Count of orders per hour for one seller', 'Top 10 listings by views today', 'A join of two billion-row tables on a non-partition key', 'Filter by country and device'],
      answer: 2,
      why: 'Big shuffling joins are what warehouses and Spark are for. Real-time OLAP expects denormalized tables, with joins done upstream in the stream processor.',
    },
    {
      id: 'ro-q5',
      q: 'Queries filter on one seller. How do you keep each query from touching every server?',
      options: ['Add more replicas', 'Partition the Kafka topic and the table by seller_id so the broker prunes to the servers holding that seller', 'Use a bigger cache', 'Store data in JSON'],
      answer: 1,
      why: 'Partition-aware routing lets the broker query only the segments for that seller: less fan-out, lower tail latency, more queries per second.',
    },
  ],
  challenge: {
    id: 'ro-profile-views',
    title: 'Who viewed your profile',
    context:
      'A professional network shows every member who viewed their profile, with counts by company, title and region over the last 90 days. 40,000 profile-view events/s. 8,000 queries/s from members opening the page, and the page must render in under 100 ms. Views from the same viewer within a minute (refreshes) count once, and a view should appear within half a minute.',
    workload: { eps: 40000, unit: 'profile view', queryQps: 8000 },
    requirements: [
      req.queryP99(100, 'The page renders in under 100 ms end to end.'),
      req.fresh(30, 'A member should see a new viewer within half a minute.'),
      req.throughput(40000, 'views'),
      req.survives('olap', 'Losing one OLAP server keeps the page up', 'Run enough servers with replicated segments so the survivors absorb the queries.'),
      req.noLoss('View events go to a durable log first.'),
      req.exactlyOnce('A viewer refreshing the profile must count once. Deduplicate by (viewer, viewee, minute) before the store.'),
    ],
    palette: ['app-db', 'events', 'kafka', 'flink', 'prod-analytics', 'warehouse', 'trino', 'olap', 'kv', 'app-api', 'bi'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Profile pages emit a view event (viewer, viewee, time).', { label: 'Profile views' }),
        N('kafka', 'kafka', X[1], 160, '3 brokers, RF=3, partitioned by viewee id.', { count: 3 }),
        N('flink', 'flink', X[2], 160, 'Deduplicates refreshes per (viewer, viewee, minute) and enriches with the viewer’s company, title and region, so the OLAP table needs no joins.', { count: 3 }),
        N('olap', 'olap', X[3], 160, 'Pinot: 6 servers for query capacity, partitioned and sorted by viewee id, star-tree on (viewee, day, company).', { count: 6 }),
        N('api', 'app-api', X[4], 160, 'Profile-views page.'),
      ],
      edges: [E('events', 'kafka'), E('kafka', 'flink'), E('flink', 'olap', 'Enriched, deduplicated rows through a Kafka topic that Pinot consumes.'), E('olap', 'api')],
    },
    wrong: {
      'prod-analytics': {
        why: 'Counting 90 days of views per member at 8,000 queries/s on the member database would take down the site.',
        instead: W.prodAnalytics.instead,
      },
      warehouse: {
        why: '8,000 queries/s at seconds each is tens of thousands of concurrent warehouse queries: far beyond any cluster’s concurrency, with p99 in seconds instead of under 100 ms.',
        instead: 'Serve the page from a real-time OLAP store and keep the warehouse for analysts.',
      },
      trino: {
        why: 'Trino scans files per query. At 8,000 queries/s with a 100 ms budget it can’t keep up.',
        instead: 'Pre-index in a real-time OLAP store (Pinot) partitioned by viewee.',
      },
    },
    alt: {
      kv: 'A key-value table of precomputed counts per (viewee, day, company) is fast too, but every new slice means a new precomputation. OLAP keeps the slicing flexible.',
    },
  },
  deeper: [
    { label: 'Denormalized, query-shaped tables', to: '/data-modeling' },
    { label: 'Kafka partitioning by key', to: '/kafka' },
  ],
};

export const smallFiles: Pattern = {
  id: 'small-files',
  num: 12,
  title: 'Small files & compaction',
  group: 'Serving',
  tagline: 'Streaming into a lakehouse commits a few files every few seconds. Without compaction you get millions of tiny files, and every query pays for them.',
  minutes: 11,
  level: 'Intermediate',
  signals: [
    '"streaming into the lake / Iceberg / Delta / Hudi"',
    '"queries got slower every week, but the data didn’t grow much"',
    '"S3 LIST / GET costs are higher than storage"',
    '"query planning takes longer than the query"',
  ],
  learn: [
    'Where small files come from: frequent commits × partitions × writers',
    'Why they hurt: per-file open cost, metadata and listing, planning time',
    'Compaction (bin-packing, sorting) as a background service',
    'Choosing the commit interval and partition granularity',
    'Snapshot expiry and orphan-file cleanup',
  ],
  realWorld: [
    { who: 'Netflix', how: 'Created Apache Iceberg partly to fix slow planning over huge numbers of files in Hive tables, and runs background compaction services over its Iceberg tables.' },
    { who: 'Uber', how: 'Built Apache Hudi for incremental ingestion into the lake. Merge-on-read tables are compacted asynchronously, and file sizing is built into the writer.' },
    { who: 'Databricks', how: 'Delta Lake’s OPTIMIZE, Z-ORDER and auto-compaction / optimized writes exist because streaming writers produce small files.' },
  ],
  scenario: {
    id: 'sf-clickstream-lake',
    title: 'Clickstream into the lakehouse',
    context:
      'A news site streams 40,000 clickstream events/s into a lakehouse table, partitioned by day. Editors and analysts query it through Trino (about 10 queries/s at peak) and want data within a few minutes. Six months in, a query over yesterday takes ten times longer than at launch, and the S3 bill shows more GET and LIST requests than storage.',
    workload: { eps: 40000, unit: 'click', queryQps: 10 },
    requirements: [
      req.queryP99(5000, 'Analyst queries over a day of clicks should come back in seconds, not tens of seconds.'),
      req.chaos('smallfiles', 'Six months of streaming commits must not slow queries down', 'Something must rewrite small files into large ones in the background.', ['absorbed']),
      req.fresh(300, 'Editors want clicks within about five minutes.'),
      req.throughput(40000, 'clicks'),
      req.exactlyOnce('Each click lands in the table once, even after restarts.'),
      req.cost(5000, 'Per-event object writes cost more in PUT requests than the whole pipeline.'),
    ],
    palette: ['events', 'mem-buffer', 'kafka', 'tiny-writer', 'flink', 'spark-ss', 'raw-files', 'lakehouse', 'compaction', 'airflow', 'trino', 'bi'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Web and app click events.', { label: 'Clickstream' }),
        N('kafka', 'kafka', X[1], 160, '3 brokers, RF=3: buffers clicks so writers can batch them into files.', { count: 3 }),
        N('flink', 'flink', X[2], 160, 'Commits one Iceberg snapshot per checkpoint (every 60 s), with files sized by a rolling policy, not one per event.', { count: 3 }),
        N('lake', 'lakehouse', X[3], 160, 'Iceberg table partitioned by day (and by hour of event time only if needed), with a target file size of 256–512 MB.'),
        N('cmp', 'compaction', X[3], 300, 'Hourly bin-pack (and sort) of recent partitions into large files, plus snapshot expiry and orphan-file cleanup.'),
        N('trino', 'trino', X[4], 160, 'Analysts’ SQL: plans from Iceberg metadata, reads far fewer, larger files.'),
        N('bi', 'bi', X[5], 160, 'Editorial dashboards and ad-hoc queries.'),
      ],
      edges: [
        E('events', 'kafka'),
        E('kafka', 'flink'),
        E('flink', 'lake', 'Exactly-once: files are committed atomically with the checkpoint.'),
        E('cmp', 'lake', '`CALL system.rewrite_data_files(…)`: rewrites small files and commits a new snapshot without blocking writers or readers.'),
        E('lake', 'trino'),
        E('trino', 'bi'),
      ],
    },
    wrong: {
      'tiny-writer': W.tinyWriter,
      'raw-files': W.rawFiles,
      'mem-buffer': W.memBuffer,
    },
    alt: {
      'spark-ss': 'Spark Structured Streaming with a trigger of a minute or more writes reasonable files too. It still needs compaction.',
      airflow: 'Scheduling compaction and snapshot expiry as Airflow jobs is common when the platform has no built-in table service.',
    },
  },
  extras: {
    nodes: [N('tiny', 'tiny-writer', X[2], 300, 'A consumer that writes every event (or every tiny batch) as its own Parquet/JSON object.', { count: 25 })],
    edges: [E('kafka', 'tiny'), E('tiny', 'lake')],
  },
  guided: [
    {
      title: 'One file per event',
      tag: 'problem',
      body: [
        'The first writer is a simple consumer: read a click, write it to the table as its own object. It needs 25 instances just to keep up with the PUT rate.',
        'At 40,000 events/s that is 3.5 billion objects a day. S3 throttles PUTs per prefix, a LIST of one day’s partition takes minutes, and every query must open millions of files.',
      ],
      add: ['events', 'kafka', 'tiny', 'lake', 'trino', 'bi'],
      chaos: 'smallfiles',
      keyIdea: 'Object stores charge and throttle per request. A file should hold hundreds of MB, not one row.',
    },
    {
      title: 'Batch commits from a stream processor',
      tag: 'technique',
      body: [
        'Replace the consumer with Flink. It buffers rows and commits files only on each checkpoint, atomically and exactly-once.',
        'Better, but still small: 3 writers × a few partitions × one commit per minute is thousands of files a day, a few MB each. Look at the query p99: Trino now opens and plans over far more files than it needs.',
      ],
      add: ['flink'],
      remove: ['tiny'],
      predict: {
        question: 'Flink commits every 60 s with 3 parallel writers into 24 hourly partitions per day. Files per day, roughly?',
        options: ['3', 'About 4,300 (3 writers × 1,440 commits), more if writers touch several partitions', '1 per partition', '40,000'],
        answer: 1,
        explain: 'Each writer writes at least one file per commit for each partition it touches. 3 × 1,440 = 4,320 files a day, and late events that touch an older partition add more. Each file is only a few MB.',
      },
    },
    {
      title: 'Six months later',
      tag: 'failure',
      body: [
        'Small files accumulate: every partition has thousands of files, and table metadata (manifests, snapshots) grows with every commit. Queries spend longer opening files and planning than reading data.',
        'Results are still correct, just slower every week: the classic slow-burning small-files problem.',
      ],
      traffic: 1.5,
      chaos: 'smallfiles',
    },
    {
      title: 'Compaction',
      tag: 'technique',
      body: [
        'Add a **compaction** service: it regularly rewrites small files in recent partitions into large ones (bin-packing to 256–512 MB, optionally sorting by a common filter column) and commits the result as a new snapshot. Readers and the streaming writer keep working: table formats use optimistic concurrency, and the rewrite only replaces files it read.',
        'Pair it with **snapshot expiry** (drop old snapshots and their files) and **orphan-file cleanup** (files left behind by failed writes). Otherwise metadata and storage keep growing.',
      ],
      add: ['cmp'],
      chaos: 'smallfiles',
      keyIdea: 'Streaming writers optimize for freshness; compaction restores the layout readers need. You need both.',
      goodToKnow: 'Iceberg: `rewrite_data_files`, `expire_snapshots`, `remove_orphan_files`. Delta: `OPTIMIZE` and auto-compaction. Hudi: inline or async compaction and clustering.',
    },
    {
      title: 'Partitioning that isn’t too fine',
      tag: 'tradeoff',
      body: [
        'Small files multiply with partitions: every commit writes at least one file per partition touched. Partitioning by (day, hour, country, event_type) can turn one commit into thousands of files.',
        'Partition only by what queries filter on and what keeps a partition at least a few GB: usually day, sometimes hour. Use sorting or Z-ordering within files (during compaction) for the other columns. Iceberg’s hidden partitioning lets you change this later without rewriting queries.',
      ],
      predict: {
        question: 'A table partitioned by (day, country) with 200 countries gets a commit every minute from 3 writers. Worst case files per day?',
        options: ['600', 'About 860,000 (1,440 × 3 × 200)', '1,440', '200'],
        answer: 1,
        explain: 'Every writer can touch every country partition on every commit. Over-partitioning is the fastest way to create small files. Partition by day, and sort by country inside files.',
      },
    },
    {
      title: 'Commit interval vs freshness',
      tag: 'tradeoff',
      body: [
        'The commit interval sets both freshness and file count. Every 10 s: fresh, 6× the files. Every 5 min: fewer, bigger files, data up to 5 minutes old. Choose the longest interval the freshness requirement allows.',
        'Compaction makes short intervals affordable but not free: rewriting data costs compute, and very frequent commits also bloat metadata (one snapshot per commit).',
      ],
      predict: {
        question: 'Editors accept 5 minutes of delay. What commit interval would you choose?',
        options: ['1 s, as fresh as possible', 'About 1–2 minutes: well within the requirement, with far fewer files', '1 hour', 'Once a day'],
        answer: 1,
        explain: 'Leave headroom under the freshness target, but don’t commit more often than you need. Every commit costs files, metadata and compaction work.',
      },
    },
    {
      title: 'Compaction stops',
      tag: 'failure',
      body: ['Kill the compaction service. Nothing errors: data keeps arriving and queries stay correct. But small files accumulate again, and the query p99 drifts back to where it was without compaction (the meter shows where it ends up). Alert on file count per partition and average file size, not only on job failures.'],
      kill: ['cmp'],
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Small files come from commit frequency × writers × partitions. Never write one object per event; batch commits through a stream processor; partition coarsely; and run compaction, snapshot expiry and orphan cleanup as standard table maintenance.',
        'In an interview: “Flink commits every minute, Iceberg partitioned by day, hourly compaction to 512 MB files, daily snapshot expiry.”',
      ],
    },
  ],
  quiz: [
    {
      id: 'sf-q1',
      q: 'Why do many small files slow queries even when total data is unchanged?',
      options: ['Parquet compresses small files badly only', 'Each file adds open, request and metadata cost, and planning must list and read stats for every file', 'Small files are stored on slower disks', 'They break ACID'],
      answer: 1,
      why: 'Per-file overhead (S3 requests, footers, manifest entries, task scheduling) dominates when files are a few KB or MB.',
    },
    {
      id: 'sf-q2',
      q: 'What does compaction do in Iceberg, Delta or Hudi?',
      options: ['Deletes old data', 'Rewrites many small files into fewer large ones and commits the result atomically as a new snapshot', 'Compresses Kafka topics', 'Merges two tables'],
      answer: 1,
      why: 'Compaction is a rewrite committed like any other change, so readers see either the old or new files, never a mix.',
    },
    {
      id: 'sf-q3',
      q: 'Which change creates more small files?',
      options: ['Increasing the checkpoint interval', 'Adding a partition column with high cardinality', 'Running compaction hourly', 'Sorting within files'],
      answer: 1,
      why: 'Each commit writes at least one file per partition touched, so more partitions means more, smaller files.',
    },
    {
      id: 'sf-q4',
      q: 'You run compaction but storage keeps growing. What did you forget?',
      options: ['A bigger cluster', 'Snapshot expiry and orphan-file cleanup: old snapshots keep the replaced small files alive', 'More partitions', 'A faster commit interval'],
      answer: 1,
      why: 'Compaction adds new files; the old ones stay referenced by older snapshots for time travel until you expire them.',
    },
    {
      id: 'sf-q5',
      q: 'Freshness target is 10 minutes. Which commit interval is a sensible starting point?',
      options: ['1 second', 'A few minutes', '1 hour', '1 day'],
      answer: 1,
      why: 'Commit as rarely as the freshness target comfortably allows. It cuts file count and metadata growth at no cost to users.',
    },
  ],
  challenge: {
    id: 'sf-cdc-hudi',
    title: 'CDC upserts into a Hudi table',
    context:
      'An e-commerce company mirrors its orders database into the lake for finance and analytics. 20,000 row changes/s (inserts and updates, as orders move from placed to shipped to refunded) flow via CDC. The lake table must reflect the latest state of each order within 10 minutes. Updates rewrite files constantly, and after a month queries over last week’s orders are crawling. About 8 analyst queries/s.',
    workload: { eps: 20000, unit: 'row change', queryQps: 8 },
    requirements: [
      req.queryP99(5000, 'Finance queries over last week’s orders should return in seconds.'),
      req.chaos('smallfiles', 'A month of streaming upserts must not slow queries down', 'Updates create delta/log files and small base files: compact them in the background.', ['absorbed']),
      req.noOltp('Don’t run analytics or full dumps against the orders database.'),
      req.exactlyOnce('Each change is applied once and in order per order id: upsert by primary key.'),
      req.fresh(600, 'Finance wants the latest order state within 10 minutes.'),
      req.throughput(20000, 'changes'),
    ],
    palette: ['app-db', 'cdc', 'full-dump', 'kafka', 'tiny-writer', 'flink', 'spark-ss', 'raw-files', 'lakehouse', 'compaction', 'airflow', 'trino', 'bi'],
    reference: {
      nodes: [
        N('db', 'app-db', X[0], 160, 'Orders database (Postgres/MySQL).', { label: 'Orders DB' }),
        N('cdc', 'cdc', X[1], 160, 'Debezium reads the write-ahead log: every insert, update and delete, with no load on queries.'),
        N('kafka', 'kafka', X[2], 160, '3 brokers, RF=3, one topic per table, keyed by order id so changes stay in order.', { count: 3 }),
        N('ss', 'spark-ss', X[3], 160, 'Hudi DeltaStreamer / Spark streaming upsert with a 1–2 minute trigger, record key = order_id, precombine on the change’s log position.', { count: 2 }),
        N('lake', 'lakehouse', X[4], 160, 'Hudi merge-on-read table: updates go to small log files next to base Parquet files, so writes are fast and readers merge them.'),
        N('cmp', 'compaction', X[4], 300, 'Async compaction merges log files into new base files; clustering rewrites small base files into large, sorted ones; cleaner removes old file versions.'),
        N('trino', 'trino', X[5], 160, 'Finance and analyst SQL over the read-optimized or snapshot view.'),
        N('bi', 'bi', X[6], 160, 'Finance dashboards.'),
      ],
      edges: [E('db', 'cdc'), E('cdc', 'kafka'), E('kafka', 'ss'), E('ss', 'lake', 'Upsert by order_id: idempotent, so replays are harmless.'), E('cmp', 'lake'), E('lake', 'trino'), E('trino', 'bi')],
    },
    wrong: {
      'tiny-writer': W.tinyWriter,
      'raw-files': {
        why: 'Plain Parquet files can’t be updated in place: every order status change would need its file rewritten by hand, or you append versions and make every reader deduplicate.',
        instead: 'A table format with upserts (Hudi, Iceberg or Delta MERGE) plus compaction.',
      },
      'full-dump': W.fullDump,
    },
    alt: {
      flink: 'Flink with the Hudi or Iceberg sink can do the same upserts with shorter commits. Compaction is still required.',
      airflow: 'Hudi compaction and clustering can run as scheduled Airflow jobs instead of inline or async table services.',
    },
  },
  deeper: [
    { label: 'Partitioning and table layout', to: '/data-modeling' },
  ],
};

export const skewPattern: Pattern = {
  id: 'skew',
  num: 13,
  title: 'Partitioning & skew',
  group: 'Serving',
  tagline: 'One hot key can overload one task while the rest sit idle. Spread it with salting and two-phase aggregation, or let the engine split skewed joins.',
  minutes: 12,
  level: 'Advanced',
  signals: [
    '"celebrity users" / "one huge merchant" / "a big city"',
    '"one task runs for hours while the others finished in minutes"',
    '"consumer lag is high on one partition only"',
    '"adding instances didn’t help"',
  ],
  learn: [
    'How key-based partitioning sends every event of a key to one task',
    'Why adding instances doesn’t fix a hot key',
    'Salting and two-phase (local + global) aggregation',
    'Spark AQE skew-join handling and when salting is still needed',
    'Choosing partition keys: cardinality and distribution',
  ],
  realWorld: [
    { who: 'Alibaba', how: 'Flink (Blink) added local-global (two-phase) aggregation and split distinct aggregation to handle skewed keys in Singles’ Day dashboards.' },
    { who: 'Databricks / Apache Spark', how: 'Adaptive Query Execution (Spark 3) detects skewed join partitions at run time and splits them into smaller tasks.' },
    { who: 'Twitter', how: 'Fan-out for accounts with tens of millions of followers is handled differently from normal accounts, a classic hot-key problem.' },
  ],
  scenario: {
    id: 'sk-viral-likes',
    title: 'Like counts on a viral post',
    context:
      'A social app shows live like, share and comment counts per post. 80,000 engagement events/s, keyed by post id. When a celebrity posts, that one post gets 35% of all events for an hour. The counts are read 2,000 times/s by the feed. Last time it happened, one stream task fell hours behind while the rest were idle, and every post on that task froze.',
    workload: { eps: 80000, unit: 'engagement', skew: 0.35, queryQps: 2000 },
    requirements: [
      req.throughput(80000, 'events'),
      req.fresh(10, 'Counts should move within seconds while a post is going viral.'),
      req.chaos('skew', 'A celebrity post doesn’t overload one task', 'Spread the hot key over several tasks (salting) and combine the partial counts in a second phase.', ['absorbed']),
      req.survives('flink', 'Losing one processor instance loses nothing', 'Run several instances with checkpointed state.'),
      req.queryP99(200, 'The feed reads counts on every scroll.'),
      req.noLoss('Engagement events go to a durable log first.'),
    ],
    palette: ['events', 'mem-buffer', 'kafka', 'salt', 'flink', 'spark', 'append-sink', 'cron-script', 'olap', 'kv', 'app-api'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Likes, shares and comments with post id and event time.', { label: 'Engagement events' }),
        N('kafka', 'kafka', X[1], 160, '3 brokers, RF=3, partitioned by post id: the hot post fills one partition, but brokers can absorb it.', { count: 3 }),
        N('salt', 'salt', X[2], 160, 'Phase 1: key by (post_id, salt), with salt = hash(user_id) % 16, and pre-aggregate locally for a second.'),
        N('flink', 'flink', X[3], 160, '5 instances. Partial counts per (post, salt) spread over all tasks; phase 2 re-keys by post id and sums the 16 partials, which is cheap.', { count: 5 }),
        N('olap', 'olap', X[4], 160, 'Counts per post per minute, upserted.', { count: 2 }),
        N('api', 'app-api', X[5], 160, 'Feed service reads counts for visible posts.'),
      ],
      edges: [
        E('events', 'kafka'),
        E('kafka', 'salt', 'Partitioned by post id, so the hot post lands on one partition.'),
        E('salt', 'flink', 'Keyed by (post_id, salt): the hot post is split 16 ways.'),
        E('flink', 'olap', 'Phase 2 output: one total per post per minute.'),
        E('olap', 'api'),
      ],
    },
    wrong: {
      'mem-buffer': {
        why: 'Pre-aggregating likes in app-server memory reduces load, but every deploy or crash silently loses the counts in memory, and nothing can be replayed.',
        instead: 'Pre-aggregate inside the stream processor (local aggregation with checkpointed state), after a durable log.',
      },
      'append-sink': W.appendSink,
      'cron-script': W.cronScript,
    },
    alt: {
      spark: 'For the daily batch rollups, Spark with AQE splits skewed partitions automatically. It doesn’t help the live counts.',
      kv: 'A key-value store also serves fixed per-post counts well.',
    },
  },
  extras: {
    nodes: [N('flink10', 'flink', X[3], 300, 'Same job, keyed by post id, scaled to 10 instances.', { count: 10, label: 'Stream processor x10' })],
    edges: [E('kafka', 'flink', undefined, 'salt'), E('kafka', 'flink10'), E('flink10', 'olap')],
  },
  guided: [
    {
      title: 'A hot key',
      tag: 'problem',
      body: [
        'Key the counting job by post id across 5 Flink instances. With uniform traffic each instance gets 16,000 events/s, well under capacity.',
        'But a keyed stream sends every event of one key to the same task. The celebrity post is 35% of traffic: 28,000 events/s on one instance. That instance overloads, its lag grows, and every other post on it freezes too. The other four are mostly idle.',
      ],
      add: ['events', 'kafka', 'flink', 'olap', 'api'],
      keyIdea: 'Partitioning by key gives ordering and local state, and also means one key can never use more than one task.',
    },
    {
      title: 'Scale out?',
      tag: 'problem',
      body: [
        'The first reaction is to double the cluster. Swap in 10 instances.',
      ],
      add: ['flink10'],
      remove: ['flink'],
      predict: {
        question: 'With 10 instances instead of 5, what load does the instance owning the hot post see?',
        options: ['Half: 14,000 events/s', 'The same 28,000 events/s: one key still goes to one task', 'Zero, it rebalances', '8,000 events/s'],
        answer: 1,
        explain: 'Adding instances spreads keys, not the events of one key. The hot task is still overloaded; you’ve only added more idle ones.',
      },
    },
    {
      title: 'Salting and two-phase aggregation',
      tag: 'technique',
      body: [
        '**Salt** the key: phase 1 keys by (post_id, salt) where salt = hash(user_id) % 16 (or random). The hot post’s events now spread over 16 sub-keys across all tasks, and each computes a partial count, often pre-aggregated locally for a second.',
        'Phase 2 re-keys the partials by post_id and sums them. It receives 16 small partials per post per window instead of 28,000 events/s, so the hot key is cheap there.',
        'Trigger a celebrity-scale spike and watch it spread.',
      ],
      add: ['salt', 'flink'],
      remove: ['flink10'],
      chaos: 'skew',
      keyIdea: 'Split the hot key, aggregate partially, then merge. This works for sums, counts, min/max and sketches (HyperLogLog), not for order-dependent logic.',
      goodToKnow: 'Flink SQL does this for you: `table.optimizer.agg-phase-strategy = TWO_PHASE` (local-global aggregation) and `table.optimizer.distinct-agg.split.enabled = true` for COUNT DISTINCT.',
    },
    {
      title: 'What salting costs',
      tag: 'tradeoff',
      body: [
        'An extra shuffle and a second aggregation stage, so a bit more latency and state. You lose per-key ordering in phase 1, so it only works for associative operations (sum, count, max, HLL merge), not “apply events in order”.',
        'Choose the salt factor by the hottest key’s rate: 28,000 events/s at ~10,000 per task means at least 3, and a power of two like 16 leaves headroom. Many teams salt only known-hot keys (a small hot-key list, or detected via sampling) to avoid the cost for the long tail.',
      ],
      predict: {
        question: 'You need the latest profile state per user by applying update events in order. Can salting fix a hot user?',
        options: ['Yes, the same way', 'No: salting splits a key’s events across tasks, so their order is lost. Reduce work per event or batch per key instead', 'Yes, with more salt', 'Only in Spark'],
        answer: 1,
        explain: 'Two-phase aggregation needs an associative combine. Order-dependent state machines must stay on one task per key: optimize the per-event work or pre-batch upstream.',
      },
    },
    {
      title: 'Batch: Spark AQE skew joins',
      tag: 'technique',
      body: [
        'In batch jobs, skew hits joins: joining engagements to posts on post_id puts all of the celebrity’s rows in one shuffle partition, and one task runs for an hour.',
        'Spark 3 **Adaptive Query Execution** measures shuffle partition sizes at run time. With `spark.sql.adaptive.skewJoin.enabled`, it splits a partition that is much larger than the median into several tasks and replicates the matching rows of the other side. No code change.',
        'When AQE isn’t enough (aggregations, extreme skew), salt manually: add a random salt to the big side, explode the small side over all salt values, join, then aggregate. Or broadcast the small side so there is no shuffle at all.',
      ],
      goodToKnow: 'Skew factor and threshold are configurable: `spark.sql.adaptive.skewJoin.skewedPartitionFactor` (default 5) and `skewedPartitionThresholdInBytes` (default 256 MB).',
    },
    {
      title: 'Choosing partition keys',
      tag: 'tradeoff',
      body: [
        'A good key has high cardinality and an even distribution, and matches how you join and aggregate. Bad keys: country, status, event type (a few values, very uneven), or a date (all of today on one partition).',
        'The same applies to Kafka topics (one hot partition limits a consumer), lakehouse partitions and OLAP segments. When the business key is skewed by nature (merchant, city, celebrity), design for it: salting, hot-key lists, or a separate path for the top keys.',
      ],
      predict: {
        question: 'Which Kafka key gives the most even load for engagement events?',
        options: ['country', 'post_id', 'event_type', 'hash(user_id, post_id)'],
        answer: 3,
        explain: 'A composite of user and post has huge cardinality and no single dominant value. post_id is fine until a post goes viral; country and event_type have a handful of very uneven values.',
      },
    },
    {
      title: 'A processor instance dies',
      tag: 'failure',
      body: ['Kill one of the five Flink instances. Salted sub-keys rebalance onto the survivors from the last checkpoint, and because the hot key is spread out, no single survivor inherits all of it.'],
      kill: ['flink'],
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Hot keys defeat horizontal scaling because a key lives on one task. Detect them (per-task lag, per-key rates), then salt and aggregate in two phases for associative metrics; let Spark AQE split skewed joins in batch; and pick partition keys with high cardinality and even distribution.',
      ],
    },
  ],
  quiz: [
    {
      id: 'sk-q1',
      q: 'One key is 40% of traffic. You double the number of stream tasks. What happens to the hot task?',
      options: ['Its load halves', 'Nothing changes: all events of that key still go to one task', 'It is split automatically', 'Kafka rebalances the key'],
      answer: 1,
      why: 'Hash partitioning maps a key to exactly one task. More tasks only help if load is spread across many keys.',
    },
    {
      id: 'sk-q2',
      q: 'How does two-phase aggregation handle a hot key?',
      options: ['Drops some of its events', 'Splits it into salted sub-keys for partial aggregates, then re-keys by the real key to combine the partials', 'Sends it to a bigger machine', 'Writes it straight to the sink'],
      answer: 1,
      why: 'Phase 1 spreads the work; phase 2 only merges a handful of partials per key.',
    },
    {
      id: 'sk-q3',
      q: 'Which metric can NOT be computed with salting and two-phase aggregation as is?',
      options: ['Sum of amounts', 'Count of events', 'Latest state from applying events in order', 'Approximate distinct users (HyperLogLog)'],
      answer: 2,
      why: 'Salting needs an associative, order-independent combine. Order-dependent state must stay on one task per key.',
    },
    {
      id: 'sk-q4',
      q: 'What does Spark AQE’s skew-join optimization do?',
      options: ['Broadcasts both sides', 'Detects oversized shuffle partitions at run time and splits them into several tasks', 'Adds salt to your code', 'Repartitions the source files'],
      answer: 1,
      why: 'AQE uses run-time shuffle statistics to split skewed partitions and replicate the other side’s matching rows.',
    },
  ],
  challenge: {
    id: 'sk-ride-city',
    title: 'Real-time ride metrics per city',
    context:
      'A ride-hailing company computes live supply, demand and surge inputs per city and zone: open requests, available drivers and ETAs over the last minute. 70,000 events/s (driver pings, ride requests). One megacity produces 45% of all events. The pricing service reads the metrics 5,000 times/s and needs them within seconds, and a ping counted twice skews surge.',
    workload: { eps: 70000, unit: 'driver ping / request', skew: 0.45, queryQps: 5000 },
    requirements: [
      req.throughput(70000, 'events'),
      req.fresh(5, 'Surge reacts within seconds.'),
      req.chaos('skew', 'The megacity doesn’t overload one task', 'Salt the city key (for example by zone or driver hash) and merge partials per city.', ['absorbed']),
      req.survives('flink', 'Losing one processor instance loses nothing', 'Run several instances with checkpointed state.'),
      req.queryP99(50, 'Pricing reads metrics on every ride request.'),
      req.exactlyOnce('A retried driver ping must not count twice.'),
    ],
    palette: ['events', 'mem-buffer', 'kafka', 'salt', 'flink', 'spark-ss', 'proc-time', 'cron-script', 'olap', 'kv', 'app-api'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Driver pings and ride requests with city, zone, id and event time.', { label: 'Pings & requests' }),
        N('kafka', 'kafka', X[1], 160, '3 brokers, RF=3, keyed by driver or request id (not city) so partitions stay even.', { count: 3 }),
        N('salt', 'salt', X[2], 160, 'Phase 1 keyed by (city, zone) or (city, hash(driver) % 32): the megacity spreads over many tasks.'),
        N('flink', 'flink', X[3], 160, '5 instances: event-time partial aggregates per sub-key, then a cheap phase 2 per city.', { count: 5 }),
        N('kv', 'kv', X[4], 160, 'Latest metrics per (city, zone), upserted.'),
        N('api', 'app-api', X[5], 160, 'Pricing service.'),
      ],
      edges: [E('events', 'kafka'), E('kafka', 'salt'), E('salt', 'flink'), E('flink', 'kv', 'Upsert per (city, zone, minute): replays are idempotent.'), E('kv', 'api')],
    },
    wrong: {
      'proc-time': {
        why: 'Pings from phones on bad networks arrive late; processing-time windows count them in the wrong minute and surge reacts to noise.',
        instead: W.procTime.instead,
      },
      'mem-buffer': W.memBuffer,
      'cron-script': W.cronScript,
    },
    alt: {
      olap: 'An OLAP store also serves per-city metrics and allows ad-hoc slicing, at higher latency than a key-value lookup.',
      'spark-ss': 'Spark Structured Streaming can salt and aggregate in two phases too, with micro-batch latency.',
    },
  },
  deeper: [
    { label: 'Choosing partition and sort keys', to: '/data-modeling' },
    { label: 'Kafka partitioning and consumer lag', to: '/kafka' },
  ],
};

export const SERVING_PATTERNS: Pattern[] = [realtimeOlap, smallFiles, skewPattern];
