import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'object-store',

  problem: {
    why: 'Disks, filesystems and databases are bad homes for billions of immutable blobs: they are bounded by one machine, priced like premium SSD, and their durability is whatever your RAID and backups happen to be. An object store turns storage into an HTTP service with a flat `bucket/key → bytes` namespace, durability engineered by math (erasure coding across failure domains), and per-GB pricing. It is also the only storage clients can talk to **directly**, which takes bytes off your app tier.',
    withoutIt: [
      'User uploads stream through app servers and pin threads + memory for seconds per request.',
      'Files sit on one server’s disk (or NFS), so servers become stateful and a dead disk loses data.',
      'Media bloats the database, its WAL, replicas and backups (see `blob-column`).',
      'Durability = "we have RAID and a nightly backup" instead of a designed, measured 11 nines.',
      'Every CDN miss and every backup job competes with transactional traffic for the same disks.',
    ],
    position: 'Off the synchronous request path for bytes: the API mints presigned URLs and stores a metadata row, clients upload/download directly (via a CDN for reads), and bucket events trigger async processing.',
    diagram: {
      type: 'flow',
      title: 'Bytes bypass the app tier',
      nodes: [
        { label: 'Client', sub: 'browser / mobile' },
        { label: 'API', sub: 'auth + presign', tone: 'accent' },
        { label: 'Object store', sub: 'PUT via presigned URL', tone: 'ok' },
        { label: 'Event → queue', sub: 'ObjectCreated', tone: 'info' },
        { label: 'Workers', sub: 'thumbnail / transcode' },
        { label: 'CDN', sub: 'serves reads', tone: 'violet' },
      ],
      caption: 'The API touches metadata only; bytes go client → store → CDN.',
    },
  },

  architecture: {
    overview: 'At design level S3-class systems have three planes. A stateless **front-end fleet** terminates HTTP, authenticates SigV4 and routes. A partitioned, replicated **metadata/index layer** maps `bucket/key/version` to placement and is the commit point (strongly consistent in S3 since Dec 2020). A huge fleet of **storage nodes** holds erasure-coded shards on HDDs across ≥3 AZs, with background scrubbers, repair and lifecycle engines. Each plane scales and fails independently.',
    diagram: {
      type: 'layers',
      title: 'S3-style object store',
      layers: [
        { name: 'Front end', items: ['DNS + LBs', 'Request routers', 'SigV4 / IAM auth', 'Throttling (503 SlowDown)'], tone: 'accent' },
        { name: 'Metadata / index', items: ['Range-partitioned index', 'Auto-split hot prefixes', 'Placement service', 'Consistency witness'], tone: 'info' },
        { name: 'Storage', items: ['Erasure coder', 'ShardStore nodes', 'HDD JBODs', 'Spread over ≥3 AZs'], tone: 'ok' },
        { name: 'Background', items: ['Scrubber + repair', 'Lifecycle / tiering', 'Replication (CRR)', 'Event notifications'], tone: 'neutral' },
      ],
      caption: 'Front end and index are latency-critical; storage is capacity-critical; background work makes durability real.',
    },
    blocks: [
      { name: 'Front-end request routers', what: 'Stateless HTTP fleet behind DNS round-robin. Parses the REST call, verifies the SigV4 HMAC and bucket/IAM policy, applies per-prefix throttles and fans reads/writes out to index and storage. Any node can serve any request.' },
      { name: 'Metadata index', what: 'A key-ordered, range-partitioned KV keyed by `bucket/key` (+ version id). Partitions split automatically when a key range gets hot — that is why request limits are quoted **per prefix**. A write is visible only when its index record commits.' },
      { name: 'Placement subsystem', what: 'Chooses which storage nodes/disks/AZs receive the shards of a new object, balancing free capacity and failure domains. In the 2017 outage this was one of the two subsystems that had to be cold-restarted.' },
      { name: 'Erasure coder', what: 'Splits each chunk into k data + m parity shards (Reed–Solomon style). Any k of k+m rebuild it. S3 does not publish its exact scheme; think "survive an AZ plus a disk" at ~1.5–1.8× overhead instead of 3×.' },
      { name: 'ShardStore storage nodes', what: 'S3’s per-node KV store for shards, written in Rust, using an LSM-style index over extents on HDD; AWS validated it with lightweight formal methods (SOSP 2021 paper). Checksums stored with every shard.' },
      { name: 'Scrubber and repair', what: 'Continuously re-reads shards, verifies checksums and re-creates lost shards on other disks. Durability depends on repair time: the shorter the window, the less likely m+1 shards die together.' },
      { name: 'Lifecycle and tiering engine', what: 'Applies bucket lifecycle rules: transition to IA/Glacier classes, expire noncurrent versions, abort incomplete multipart uploads. Runs asynchronously (typically within a day), so never use it for precise deadlines.' },
    ],
    real: [
      { name: 'Amazon S3', how: 'Front-end fleet + partitioned index + ShardStore nodes; erasure-coded across ≥3 AZs (except One Zone/Express classes). Strong read-after-write for PUT, DELETE and LIST since Dec 2020, achieved by a replicated witness that tracks the latest index version per key so caches cannot serve stale metadata.' },
      { name: 'Google Cloud Storage', how: 'Object metadata in **Spanner** (globally consistent listing for free) and bytes in **Colossus** with Reed–Solomon coding. Dual- and multi-region buckets replicate asynchronously with an optional turbo-replication RPO.' },
      { name: 'Azure Blob Storage', how: 'Partition layer (range-partitioned object index) over a stream layer of extent nodes, coded with **Local Reconstruction Codes** (12 data + 2 local + 2 global parity in the 2012 paper), so most repairs read 6 fragments instead of 12.' },
      { name: 'MinIO', how: 'Self-hosted S3 API in Go. Each object is erasure-coded across an erasure set of drives with metadata in an `xl.meta` file beside the shards — no central metadata DB, so LIST is a distributed directory walk.' },
      { name: 'Ceph RGW', how: 'S3/Swift gateway over RADOS. Objects are placed by the **CRUSH** hash (no lookup table), but each bucket has an index in OMAP; very large buckets need **bucket index resharding** or the index shard becomes the hotspot.' },
    ],
  },

  lifecycle: {
    summary: 'A direct-to-store upload of a 40 MB photo set from a mobile client, then the first read through a CDN. Your servers spend a few milliseconds; the store and the network spend the rest.',
    stages: [
      { stage: 'Request upload slot', what: 'Client calls `POST /uploads`; API authenticates, writes a `pending` metadata row and signs a presigned PUT (or multipart part URLs).', cost: 'One API call + DB insert + local HMAC signing (no AWS round trip)', ms: 15 },
      { stage: 'TLS to store endpoint', what: 'Client opens HTTPS to the regional S3 endpoint (or an Accelerate edge).', cost: '1 RTT TCP + 1 RTT TLS 1.3', ms: 60 },
      { stage: 'Front-end auth', what: 'Router recomputes the SigV4 signature from the query string and checks expiry and policy.', cost: 'HMAC chain + policy eval, sub-ms', ms: 0.5 },
      { stage: 'Upload bytes', what: 'Body streams in; for multipart, 8 parts of 5 MB go in parallel on separate connections.', cost: 'Bound by client uplink: 40 MB at 50 Mbit/s ≈ 6.4 s', ms: 6400 },
      { stage: 'Erasure-code and persist', what: 'Front end encodes chunks into shards and writes them to nodes in several AZs; ack after enough shards are durable.', cost: 'Cross-AZ writes, HDD/journal fsync', ms: 25 },
      { stage: 'Index commit', what: 'Metadata record (key, version, ETag, size, shard map) commits; object now visible to every GET and LIST.', cost: 'Replicated index write', ms: 8 },
      { stage: 'Event notification', what: '`s3:ObjectCreated:*` delivered to SQS/SNS/Lambda/EventBridge; worker flips row to `ready` and makes thumbnails.', cost: 'Async, usually < 1 s, at-least-once', ms: 500 },
      { stage: 'First read (CDN miss)', what: 'CDN edge fetches from the bucket via origin access control and caches it.', cost: 'S3 first-byte 10–100 ms + transfer', ms: 60 },
      { stage: 'Later reads (CDN hit)', what: 'Served from the edge with long `Cache-Control` on content-hashed keys.', cost: 'Edge RTT only', ms: 15 },
    ],
  },

  deepDives: [
    {
      title: 'Erasure coding vs replication, and the 11-nines math',
      hook: 'Durability is not a property of disks; it is (shards you can lose) × (how fast you repair) × (how independent failures are).',
      body: [
        'With k+m coding an object survives any m lost shards at (k+m)/k overhead. 3× replication survives 2 losses at 3.0×; a 6+3 code survives 3 losses at 1.5×. Reads touch k nodes instead of one, and repair reads k shards to rebuild one, so coding costs CPU and network — which is why small objects and hot tiers are often replicated instead.',
        'Data is lost only if more than m shards of the same stripe die **within one repair window**. Shrinking the window from a day to an hour improves durability by orders of magnitude, more than adding a parity shard would.',
        'The toy model below ignores correlated failures (same rack, same firmware, same AZ power event), which dominate in reality. That is why placement across failure domains and AZs matters more than the code itself, and why "11 nines" is a design target AWS states, not something you could measure.',
      ],
      code: {
        lang: 'text',
        caption: 'Toy model: AFR 2%, repair window 1 day',
        code: `p = P(a given disk dies inside one window) = 0.02 / 365 ≈ 5.5e-5

3x replication: lose all 3 copies
  P/window ≈ p^3 = 1.7e-13  -> per year x365 ≈ 6e-11   (~10 nines)

6+3 erasure code: lose >= 4 of 9 shards
  P/window ≈ C(9,4) * p^4 = 126 * 9.2e-18 = 1.2e-15
  per year x365 ≈ 4e-13                              (~12 nines)
  storage overhead 1.5x instead of 3x

AWS framing of 11 nines: store 10,000,000 objects,
expect to lose one object every ~10,000 years.`,
      },
      table: {
        caption: 'Redundancy schemes',
        columns: ['Scheme', 'Overhead', 'Losses survived', 'Read cost', 'Repair cost'],
        rows: [
          ['3× replication', '3.0×', '2', '1 node', 'copy 1 shard'],
          ['RS 6+3', '1.5×', '3', '6 nodes', 'read 6 to rebuild 1'],
          ['RS 10+4 (HDFS EC style)', '1.4×', '4', '10 nodes', 'read 10 to rebuild 1'],
          ['Azure LRC 12+2+2', '1.33×', '3 (most 4)', '12 nodes', 'read 6 (local group)'],
        ],
      },
      insight: 'Durability is lost to software and operators far more often than to disks: a bad deploy, a lifecycle rule that deletes the wrong prefix, or a leaked credential. Versioning, Object Lock and cross-account replication defend against those; erasure coding does not.',
    },
    {
      title: 'Key naming and prefix partitioning',
      hook: 'S3 throughput limits are per partition of the key space, so key design is capacity planning.',
      body: [
        'The index is range-partitioned by key. S3 supports at least **3,500 PUT/COPY/POST/DELETE and 5,500 GET/HEAD requests per second per partitioned prefix**, and splits partitions automatically as load grows. Splitting takes time (minutes), so a sudden 10× spike on a single prefix returns `503 SlowDown` until it catches up.',
        'Before 2018 AWS told everyone to prepend random hashes to keys. Today sequential keys are fine for steady load because partitions split on any boundary, but you still want **many distinct prefixes** for bursty, massively parallel jobs (Spark/EMR writing thousands of files per second) so the work spreads across partitions immediately.',
        'Keys like `2026/11/28/…` concentrate all of today’s writes on one range — the classic hot partition. Prefer `tenant/<id>/…` or a short hash shard: `uploads/7f/<uuid>.jpg`. Also remember LIST returns at most 1,000 keys per page, so a "directory" of 50M keys is 50,000 sequential calls.',
      ],
      code: {
        lang: 'text',
        caption: 'Key layouts',
        code: `hot:   logs/2026-11-28/14/host-0001.gz      (one moving hot range)
ok:    logs/shard=37/2026-11-28/14/host-0001.gz
ok:    media/7f/3c/7f3c9a...e1.jpg            (hash fan-out, 256 prefixes)
best:  keep (owner, created_at, key) in your DB; never LIST to query`,
      },
      insight: 'Throttling is per prefix but you pay per request: retries on `503 SlowDown` multiply cost and latency. The SDKs’ adaptive retry mode exists for exactly this; pair it with key fan-out, not with bigger retry counts.',
    },
    {
      title: 'Multipart upload, presigned URLs and POST policies',
      hook: 'Large and untrusted uploads should never touch your servers — but the URL you hand out is a bearer token.',
      body: [
        'Multipart upload: `CreateMultipartUpload` returns an `UploadId`; the client uploads parts of **5 MB–5 GB** (up to 10,000 parts; the last can be smaller) in parallel, each returning an ETag; `CompleteMultipartUpload` with the ordered (part, ETag) list commits atomically. A failed part is retried alone, and a mobile client can resume by asking which parts exist (`ListParts`). Single PUT is capped at 5 GB.',
        'A presigned URL embeds a SigV4 signature for one method + key + expiry (max 7 days with long-term keys; shorter if signed with temporary role credentials). It cannot limit size on its own. A **POST policy** (browser form upload) can: it signs conditions such as `content-length-range`, `starts-with $key`, and `Content-Type`.',
        'Incomplete multipart uploads are invisible but billed. Always add a lifecycle rule `AbortIncompleteMultipartUpload` (e.g. 7 days) or you will pay for terabytes of orphaned parts.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Resumable multipart upload',
        actors: ['Client', 'API', 'S3', 'Queue'],
        messages: [
          { from: 'Client', to: 'API', label: 'POST /uploads (size, type)' },
          { from: 'API', to: 'S3', label: 'CreateMultipartUpload' },
          { from: 'API', to: 'Client', label: 'UploadId + presigned part URLs', dashed: true },
          { from: 'Client', to: 'S3', label: 'PUT part 1..N (parallel)', tone: 'accent' },
          { from: 'S3', to: 'Client', label: 'ETag per part', dashed: true },
          { from: 'Client', to: 'API', label: 'complete (part ETags)' },
          { from: 'API', to: 'S3', label: 'CompleteMultipartUpload', tone: 'ok' },
          { from: 'S3', to: 'Queue', label: 'ObjectCreated event', tone: 'info' },
        ],
        caption: 'API signs and commits; bytes go straight to S3.',
      },
      code: {
        lang: 'json',
        caption: 'POST policy conditions (browser form upload)',
        code: `{
  "expiration": "2026-11-28T18:30:00Z",
  "conditions": [
    {"bucket": "user-uploads"},
    ["starts-with", "$key", "incoming/u42/"],
    ["content-length-range", 1, 26214400],
    ["starts-with", "$Content-Type", "image/"]
  ]
}`,
      },
      insight: 'Upload to an `incoming/` prefix that nothing serves, scan/validate asynchronously, then copy to the public prefix. Otherwise a presigned URL lets anyone host arbitrary content (malware, HTML for phishing) on your domain.',
    },
    {
      title: 'Consistency model and event-driven processing',
      hook: 'Strong read-after-write removed a class of bugs in 2020; event delivery is still at-least-once and unordered.',
      body: [
        'Since December 2020 S3 provides **strong read-after-write consistency** for PUTs and DELETEs of objects and for LIST, at no extra cost. Before that, overwrites and LIST were eventually consistent, which is why tools like Netflix’s S3mper and EMRFS consistent view tracked listings in DynamoDB. There is still no multi-object transaction and no compare-and-swap on arbitrary writes beyond conditional writes (`If-None-Match: *`, added 2024, and `If-Match`).',
        'Event notifications (to SQS, SNS, Lambda or EventBridge) are **at-least-once**, can arrive late, and are not ordered; each record carries a `sequencer` field you can compare per key. Consumers must be idempotent: key processing on (bucket, key, version id or ETag).',
        'Concurrent writers to the same key resolve as last-writer-wins by request time. With versioning enabled no write is lost — each becomes a version — which is the cheap way to make overwrites recoverable.',
      ],
      diagram: {
        type: 'flow',
        title: 'Idempotent processing pipeline',
        nodes: [
          { label: 'S3 PUT', sub: 'incoming/u42/abc.jpg' },
          { label: 'Event', sub: 'at-least-once', tone: 'warn' },
          { label: 'SQS', sub: 'DLQ after 5 tries', tone: 'info' },
          { label: 'Worker', sub: 'dedupe on key+ETag', tone: 'accent' },
          { label: 'Derived objects', sub: 'thumbs/, hls/' },
          { label: 'DB row → ready', sub: 'conditional update', tone: 'ok' },
        ],
      },
      insight: 'Do not make the S3 event the only trigger for state transitions. Pair it with a reconciler that scans `pending` rows older than N minutes and HEADs the object — events get lost to misconfiguration, permissions changes and DLQ overflows.',
    },
    {
      title: 'Storage classes, lifecycle, versioning and Object Lock',
      hook: 'Storage is cheap; retrieval fees, minimum durations and request counts are where cost surprises live.',
      body: [
        'Classes trade $/GB-month for retrieval latency and fees. Infrequent-access classes have a **30-day minimum** and 128 KB minimum billable size; Glacier Flexible has 90 days and Deep Archive 180 days. Transitioning millions of tiny objects can cost more in per-object transition requests than it ever saves. **Intelligent-Tiering** moves objects automatically for a small monitoring fee per object (objects < 128 KB are not tiered).',
        'Versioning turns overwrite and delete into "new version" and "delete marker". Pair it with a `NoncurrentVersionExpiration` rule or storage grows forever. **Object Lock** (requires versioning) adds WORM retention: governance mode can be bypassed with a special permission, compliance mode cannot be shortened by anyone, including root. Legal holds have no expiry.',
      ],
      table: {
        caption: 'S3 classes (us-east-1, approximate list prices)',
        columns: ['Class', '$/GB-month', 'First byte', 'Min duration', 'Use'],
        rows: [
          ['Express One Zone', '~$0.11', 'single-digit ms', 'none', 'ML/analytics scratch, one AZ'],
          ['Standard', '~$0.023', '10–100 ms', 'none', 'Hot data, default'],
          ['Standard-IA', '~$0.0125', 'ms (+$/GB retrieval)', '30 days', 'Backups read monthly'],
          ['Glacier Instant Retrieval', '~$0.004', 'ms (higher fee)', '90 days', 'Archives read quarterly'],
          ['Glacier Deep Archive', '~$0.001', '12–48 h restore', '180 days', 'Compliance, never-read'],
        ],
      },
      code: {
        lang: 'json',
        caption: 'Lifecycle rule every bucket should have',
        code: `{"Rules": [{
  "ID": "hygiene", "Status": "Enabled", "Filter": {},
  "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
  "NoncurrentVersionExpiration": {"NoncurrentDays": 30},
  "Transitions": [{"Days": 30, "StorageClass": "STANDARD_IA"}]
}]}`,
      },
      insight: 'Ransomware and fat-fingered `aws s3 rm --recursive` are the realistic data-loss threats. Versioning + Object Lock on backups + replication to a separate account with its own credentials is the defence; durability nines do nothing here.',
    },
    {
      title: 'Read path: CDN, range GETs and the cost model',
      hook: 'At scale the bill is egress and requests, not storage — and a CDN fixes both latency and cost.',
      body: [
        'S3 first-byte latency is typically tens of ms and every GET is billed (~$0.0004 per 1,000) plus internet egress (~$0.09/GB at list price, tiering down with volume). Put a CDN in front with origin access control so the bucket stays private; use content-hashed keys (`avatar/7f3c….jpg`) with `Cache-Control: max-age=31536000, immutable` so you never invalidate.',
        'Range GETs (`Range: bytes=0-8388607`) let clients and analytics engines fetch slices: video players seek, Parquet readers fetch footers then column chunks, and download managers parallelise 8–16 MB ranges across connections to saturate bandwidth. A single connection to S3 tops out well below a 25 Gbit NIC; parallel ranges are how you get the rest.',
        'PUT/COPY/POST/LIST cost ~$0.005 per 1,000 — 12.5× a GET. Writing a million 1 KB objects costs $5 in requests and $0.02 in storage: small objects are a request-cost problem, so batch them (Parquet, tar, log rollups).',
      ],
      table: {
        caption: 'Where the money goes (illustrative, list prices)',
        columns: ['Workload', 'Storage', 'Requests', 'Egress', 'Dominant'],
        rows: [
          ['100 TB backups, read rarely', '$2,300/mo', '≈ $0', '≈ $0', 'Storage → use IA/Glacier'],
          ['Image CDN origin, 2B GETs/mo', '$50/mo', '$800/mo w/o CDN', '$45k/mo w/o CDN', 'Egress → CDN'],
          ['IoT 1 KB writes, 1B/mo', '$23/mo', '$5,000/mo', '≈ $0', 'PUTs → batch'],
        ],
      },
      insight: 'Cross-region and cross-AZ transfer, and NAT gateway processing for S3 traffic from private subnets, are classic hidden bills. A free S3 gateway VPC endpoint removes the NAT charge entirely.',
    },
  ],

  scaling: {
    body: [
      'Every layer scales horizontally and independently: the front end is stateless, the index splits hot key ranges, and storage grows by adding racks. The data plane (GET/PUT) is designed to keep working when control-plane operations (create bucket, change policy, replication config) are degraded — AWS explicitly tells you not to create buckets on the request path.',
      'Regions are isolated failure domains. A bucket lives in one region; multi-region means **Cross-Region Replication** (async, most objects within seconds to minutes; Replication Time Control offers a 15-minute SLA for 99.99% of objects) plus **Multi-Region Access Points** for routing and failover. Active-active writes to the same key in two regions are last-writer-wins.',
      'For your application, the scaling unit is usually the prefix and the request budget: spread keys, add a CDN, batch small objects, and keep metadata queries in your database rather than in LIST.',
    ],
    bullets: [
      'Data plane vs control plane: GET/PUT depend on front end + index + storage; bucket config changes propagate asynchronously and can take time to be visible everywhere.',
      'Hot prefix: 3,500 writes / 5,500 reads per second per prefix before auto-split; split takes minutes.',
      'Read scaling: CDN first, then range GETs in parallel, then more prefixes.',
      'Multi-region: CRR/RTC for DR, Multi-Region Access Points for routing; RPO is minutes, not zero.',
      'Self-hosted: MinIO scales by adding server pools (new erasure sets); Ceph by adding OSDs (CRUSH rebalances data).',
      'Blast radius: S3 partitions its index into cells after 2017 so one bad operation cannot take a whole region.',
    ],
    diagram: {
      type: 'compare',
      title: 'Single region vs multi-region',
      columns: [
        { name: 'Single region (3 AZ)', points: ['Survives AZ loss', 'Strong consistency', 'Cheapest', 'Region outage = downtime'], tone: 'ok' },
        { name: 'CRR + MRAP', points: ['Survives region loss', 'Async, RPO minutes', '2× storage + transfer', 'LWW on same key'], tone: 'info' },
      ],
    },
  },

  failures: [
    {
      name: 'Hot prefix throttling',
      symptom: '`503 SlowDown` bursts and latency spikes during batch jobs or launch-day spikes.',
      detect: 'CloudWatch request metrics `5xxErrors` by prefix filter; SDK retry counters; S3 server access logs with `503` per key prefix.',
      mitigate: 'Fan out keys across prefixes, ramp load gradually, adaptive retry with jitter, request a pre-split from AWS support for known launches.',
    },
    {
      name: 'Orphans and runaway versions',
      symptom: 'Storage bill grows while object count in the app is flat.',
      detect: 'S3 Storage Lens: incomplete multipart bytes and noncurrent version bytes; S3 Inventory diffed against DB metadata.',
      mitigate: 'Lifecycle: abort incomplete multipart after 7 days, expire noncurrent versions, expire `incoming/` after 1 day; reconciler job.',
    },
    {
      name: 'Public or over-permissive bucket',
      symptom: 'Data exposure discovered by a researcher or attacker.',
      detect: 'Block Public Access at account level, IAM Access Analyzer findings, AWS Config rules `s3-bucket-public-read-prohibited`.',
      mitigate: 'Account-level Block Public Access on, CDN with OAC instead of public buckets, short-lived presigned URLs, least-privilege roles.',
    },
    {
      name: 'Lost or duplicated processing events',
      symptom: 'Uploads stuck in `pending`, or thumbnails generated twice.',
      detect: 'Age of oldest `pending` row; SQS `ApproximateAgeOfOldestMessage`; DLQ depth alarm.',
      mitigate: 'Idempotent workers keyed on key + version/ETag, DLQ with alarms, periodic reconciler.',
    },
    {
      name: 'Egress and request cost blowout',
      symptom: 'Monthly bill jumps with traffic; often from hotlinking or a crawler bypassing the CDN.',
      detect: 'Cost Explorer by usage type (`DataTransfer-Out-Bytes`, `Requests-Tier1`), CDN hit ratio < ~90%.',
      mitigate: 'Private bucket behind CDN, immutable cache headers, batch small writes, VPC gateway endpoint.',
    },
    {
      name: 'Accidental mass delete',
      symptom: 'Objects gone after a script or lifecycle rule with the wrong filter.',
      detect: '`DeleteObject` spikes in CloudTrail data events; replication/versioning metrics.',
      mitigate: 'Versioning, MFA delete or Object Lock on critical buckets, replicate to an isolated account, review lifecycle rules like code.',
    },
  ],

  warStories: [
    {
      title: 'S3 us-east-1 outage — a mistyped command',
      source: 'AWS, Summary of the Amazon S3 Service Disruption, Feb 28 2017',
      what: 'An engineer running an established playbook to remove a few billing-subsystem servers mistyped an input and removed a much larger set, including servers backing the **index** and **placement** subsystems. Both needed a full restart, which had not been done at that scale in years; GET/LIST/PUT were impaired for about four hours, taking down large parts of the internet. The AWS status dashboard itself depended on S3 and could not show the outage.',
      lesson: 'Capacity-removal tools need rate limits and a minimum-capacity floor; big subsystems must be partitioned into cells so restarts are small; and your status page must not depend on the thing it reports on.',
    },
    {
      title: 'Unauthorized requests billed to the bucket owner',
      source: 'Public blog post by a developer, April 2024; AWS policy change May 2024',
      what: 'A developer created a private, empty bucket whose name matched a placeholder used by a popular open-source tool’s default config. Misconfigured installs sent ~100M PUT requests within a day; S3 billed the owner for the denied requests, a bill of about $1,300. After the story spread, AWS stopped charging for unauthorized requests that originate outside the account.',
      lesson: 'Bucket names are global and guessable; include a random suffix, and set billing alarms. Request cost is a real attack surface ("denial of wallet").',
    },
    {
      title: 'Uploads proxied through the API tier',
      source: 'Composite of common incidents',
      what: 'A social app accepted photo uploads at `POST /photos`, buffered them in the API process and wrote them to S3. A viral moment brought 10× uploads from slow mobile networks; every upload held a worker for 5–20 s, the thread pool saturated and unrelated endpoints (login, feed) timed out.',
      lesson: 'Bytes should never share a thread pool with business logic. Presigned direct uploads make upload volume S3’s problem, not your API’s.',
    },
  ],

  numbers: [
    { label: 'Durability (design)', value: '99.999999999%', note: '10M objects → lose ~1 per 10,000 years' },
    { label: 'Availability SLA (Standard)', value: '99.9%', note: 'designed for 99.99%' },
    { label: 'Per-prefix request rate', value: '3,500 writes / 5,500 reads per s', note: 'auto-splits beyond' },
    { label: 'Single PUT max', value: '5 GB', note: 'objects historically up to 5 TB via multipart' },
    { label: 'Multipart parts', value: '5 MB–5 GB, ≤ 10,000', note: 'last part may be smaller' },
    { label: 'First-byte latency', value: '10–100 ms', note: 'Express One Zone: single-digit ms' },
    { label: 'Standard storage', value: '~$0.023/GB-month', note: 'Deep Archive ~$0.001' },
    { label: 'Request price', value: 'PUT ~$5 / GET ~$0.40 per million' },
    { label: 'Internet egress', value: '~$0.09/GB', note: 'first tier; CDN egress usually cheaper' },
    { label: 'LIST page size', value: '1,000 keys' },
    { label: 'Presigned URL max', value: '7 days', note: 'SigV4; less with temporary creds' },
  ],

  capacity: {
    question: 'A photo app gets 20M uploads/day, average 3 MB original + 4 derived sizes totalling 1 MB, viewed 50× each in the first week. Size storage, request rates and the read path.',
    steps: [
      'Writes: 20M/day ÷ 86,400 ≈ 230 uploads/s average, ~3× peak ≈ 700/s; each upload creates 5 objects ⇒ ~3,500 PUT/s peak — right at one prefix’s limit, so shard keys by hash prefix.',
      'Storage: 20M × 4 MB = 80 TB/day ≈ 29 PB/year. At $0.023/GB ≈ $670k/month after one year if all Standard; move originals to IA at 30 days and Glacier IR at 90 to roughly halve that.',
      'Reads: 20M × 50 = 1B views/day ≈ 11.6k/s average, ~35k/s peak — almost all on derived 200 KB images.',
      'CDN: with 95% hit rate, origin sees ~1.7k GET/s peak (fine) and egress from S3 falls from ~200 TB/day to ~10 TB/day.',
      'API tier: only metadata — ~700 presign calls/s peak plus event processing; a handful of small instances.',
    ],
    answer: '~3.5k PUT/s peak (hash-prefixed keys), ~29 PB/year growth (lifecycle tiering is the main cost lever), and a CDN that absorbs ~95% of 35k reads/s; the app servers never touch image bytes.',
  },

  comparison: {
    caption: 'Object stores and their nearest alternatives',
    columns: ['Option', 'Consistency', 'Durability model', 'Latency', 'Best for'],
    rows: [
      ['Amazon S3', 'Strong RAW + LIST (2020)', 'EC across ≥3 AZs, 11 nines design', '10–100 ms', 'Default blob store on AWS'],
      ['Google Cloud Storage', 'Strong (Spanner metadata)', 'Colossus RS coding; dual/multi-region', '10–100 ms', 'GCP, globally consistent listing'],
      ['Azure Blob', 'Strong', 'LRC, LRS/ZRS/GRS options', '10–100 ms', 'Azure, append and page blobs'],
      ['MinIO', 'Strong (per erasure set)', 'EC per erasure set, you run it', '1–20 ms on LAN', 'On-prem/edge, S3-compatible'],
      ['Ceph RGW', 'Strong', 'RADOS replication or EC, CRUSH', '5–50 ms', 'Large private clouds'],
      ['EFS / NFS', 'Close-to-open', 'Multi-AZ (EFS) or one box', '~1 ms per op', 'POSIX apps that need a filesystem'],
    ],
  },

  whenNot: [
    'Low-latency, small, mutable records (sessions, counters, profiles) — use a KV store or database; per-request tens of ms and per-request pricing are wrong.',
    'Data that needs in-place appends, renames or POSIX locks (a database’s data files, SQLite, build scratch) — use block storage (EBS) or a filesystem.',
    'Querying by attributes — keep metadata in a DB or a table format (Iceberg/Delta) instead of LIST + naming conventions.',
    'Millions of tiny writes per second (IoT events, logs) — buffer through a stream (Kafka/Kinesis) and write batched files.',
    'Files under ~100 KB that must change atomically with a row in a transaction and are few in number — a DB column can be acceptable.',
  ],

  interview: [
    {
      q: 'Design the upload path for a video platform where users upload files up to 20 GB from mobile.',
      a: 'The API authenticates, creates a `pending` video row and a multipart upload, and returns presigned part URLs (e.g. 16 MB parts) to the client. The client uploads parts in parallel and can resume after network loss by asking which parts exist. On completion the API calls `CompleteMultipartUpload`; the `ObjectCreated` event lands in SQS and transcode workers produce HLS renditions to a separate prefix served via CDN. A lifecycle rule aborts incomplete uploads after 7 days, and a reconciler fixes rows stuck in `pending`.',
      followUps: ['How do you prevent a user from uploading 2 TB with that URL?', 'How do you make processing idempotent?', 'How would you scan for malware before the file is public?'],
      seniorSignal: 'Covers resumability, abort-incomplete lifecycle, at-least-once events with idempotency and a reconciler, and the incoming/public prefix split — not just "use presigned URLs".',
    },
    {
      q: 'How does S3 achieve 11 nines of durability, and what does it not protect you from?',
      a: 'Objects are erasure-coded into k+m shards spread across disks, hosts and at least three AZs, checksummed, and continuously scrubbed; lost shards are rebuilt quickly so the window in which m+1 failures could coincide is tiny. Durability is a function of parity count, repair time and independence of failures. It does not protect against your own deletes, overwrites, bad lifecycle rules, ransomware or leaked credentials — for those you need versioning, Object Lock and replication to an isolated account.',
      followUps: ['Why erasure coding instead of 3× replication?', 'Why does repair speed matter as much as the code?', 'What does correlated failure do to the math?'],
      seniorSignal: 'Explains durability as a probability over repair windows and separates hardware durability from operational/data-integrity risk.',
    },
    {
      q: 'Your Spark job writing to S3 starts getting `503 SlowDown`. What is happening and what do you do?',
      a: 'The job concentrates writes on one key range that exceeds the per-prefix rate (~3,500 writes/s) faster than S3 can split the partition. Short term: adaptive retries with jitter and lower concurrency. Structurally: spread output across more prefixes (partition columns or hash shards), write fewer larger files, and for predictable launches ask AWS to pre-partition.',
      followUps: ['Why did random key prefixes stop being required in 2018?', 'How does file size affect request cost?', 'How do table formats like Iceberg help?'],
      seniorSignal: 'Ties throttling to index range partitioning and auto-split latency, and fixes the file-count problem rather than just raising retries.',
    },
    {
      q: 'What changed when S3 became strongly consistent, and what is still not guaranteed?',
      a: 'Since Dec 2020 a successful PUT or DELETE is immediately reflected in subsequent GET, HEAD and LIST, so tools like S3Guard and EMRFS consistent view became unnecessary. There are still no multi-object transactions; concurrent writes to one key are last-writer-wins; event notifications remain at-least-once and unordered; and cross-region replication is asynchronous. Conditional writes now allow create-if-absent, but you still need a database for richer coordination.',
      followUps: ['How would you implement an atomic "commit" of 100 files?', 'How do you order events for the same key?'],
      seniorSignal: 'Knows the boundary of the guarantee (single key, single region) and uses manifests or table formats for multi-object atomicity.',
    },
    {
      q: 'Serving 2 billion image views per month straight from S3 — what is wrong and what does it cost?',
      a: 'Every view is a billed GET and full-price internet egress, with tens of ms first-byte latency from one region. At ~200 KB per image that is ~400 TB of egress, tens of thousands of dollars a month, plus slow loads for distant users. A CDN with immutable, content-hashed keys absorbs ~95%+ of reads at lower egress rates and edge latency, and the bucket stays private via origin access control.',
      followUps: ['How do you handle cache invalidation on avatar change?', 'How would you serve private images through the CDN?'],
      seniorSignal: 'Quantifies egress and request cost and designs keys for immutability instead of planning invalidations.',
    },
    {
      q: 'When would you run MinIO or Ceph instead of using S3?',
      a: 'When data must stay on-prem or at the edge (sovereignty, factory/hospital sites), when egress from the cloud would dominate cost for heavy re-reads, or for an S3-compatible dev/test environment. You take on hardware failure handling, capacity planning, upgrades and the durability math yourself. MinIO is simpler (erasure sets, no metadata DB) but listing huge namespaces is slower; Ceph is more flexible but operationally heavy, with bucket-index sharding as a classic pain point.',
      followUps: ['How many drives can you lose in a MinIO erasure set?', 'What breaks in Ceph with a 500M-object bucket?'],
      seniorSignal: 'Frames it as a cost/compliance/ops trade-off and names a concrete operational failure of each system.',
    },
  ],

  takeaways: [
    'Object storage is a flat, immutable key→bytes service: front end, strongly consistent index, erasure-coded storage.',
    'Durability = parity × repair speed × failure independence; operational mistakes, not disks, are the real risk.',
    'Bytes go client ↔ store directly via presigned URLs/POST policies; the API handles metadata only.',
    'Key design is capacity planning: ~3,500 writes / 5,500 reads per second per prefix before auto-split.',
    'Events are at-least-once and unordered — idempotent workers plus a reconciler.',
    'Cost is storage + requests + egress; CDN, batching and lifecycle rules are the levers.',
    'Every bucket: Block Public Access, abort-incomplete-multipart rule, noncurrent-version expiry, billing alarm.',
  ],
};

export default deep;
