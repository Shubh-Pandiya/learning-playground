import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'nfs',

  problem: {
    why: 'When an app that writes to local disk (`/var/www/uploads`) needs a second server, the fastest fix is to mount one shared directory on all of them. NFS makes a remote filesystem look local to unmodified code. That convenience hides a distributed system with weak cache coherence, a shared server in every request path and failure semantics (hung processes) that local disks never had. It is tempting precisely because it requires zero code changes.',
    withoutIt: [
      'Uploads written on server A are invisible on server B — users get 404s depending on which server they hit.',
      'Legacy apps (CMSs, PHP apps, batch tools) that assume a POSIX directory need code changes to scale out.',
      'Shared read-mostly datasets (ML training data, media libraries) get copied to every node.',
      'Teams without object-storage experience must learn presigned URLs, events and eventual cleanup.',
    ],
    position: 'A file server (or managed NFS like EFS) mounted on every app server; every `open`, `stat`, `read`, `write` on that path becomes an RPC on the synchronous request path, so the file server’s latency and availability become the whole tier’s.',
    diagram: {
      type: 'flow',
      title: 'The lift-and-shift shortcut',
      nodes: [
        { label: 'LB', sub: 'round-robin' },
        { label: 'Web 1..N', sub: 'same code, local paths', tone: 'accent' },
        { label: 'Kernel NFS client', sub: 'syscall → RPC', tone: 'warn' },
        { label: 'NFS server', sub: 'one box, all clients', tone: 'bad' },
        { label: 'RAID disks', sub: 'bounded capacity' },
      ],
      caption: 'Every web request that touches a file now depends on one shared server.',
    },
  },

  architecture: {
    overview: 'NFS is ONC RPC over TCP. The kernel VFS routes syscalls on the mount to the NFS client, which caches attributes and pages and only revalidates at specific moments (open, attribute-cache expiry). The server (`nfsd` threads in Linux, or a filer) executes operations against a local filesystem. Locking is either a separate protocol (NLM + statd in NFSv3) or lease-based state in NFSv4. NFSv4.1 adds sessions and pNFS; managed services like EFS distribute the server side across AZs but keep the protocol semantics.',
    diagram: {
      type: 'layers',
      title: 'NFS stack',
      layers: [
        { name: 'Application', items: ['open / write / stat', 'flock / fcntl', 'Assumes local disk'], tone: 'neutral' },
        { name: 'Client kernel', items: ['VFS', 'Attribute cache (3–60 s)', 'Page cache', 'Close-to-open checks'], tone: 'warn' },
        { name: 'Protocol', items: ['ONC RPC / TCP 2049', 'NFSv3 + NLM/NSM', 'NFSv4 leases (~90 s)', 'v4.1 sessions, pNFS'], tone: 'info' },
        { name: 'Server', items: ['nfsd threads', 'Local FS (XFS/ZFS)', 'RAID / filer HA pair', 'EFS: multi-AZ backend'], tone: 'bad' },
      ],
      caption: 'Coherence lives in client caches; availability lives in one server (or a managed service).',
    },
    blocks: [
      { name: 'VFS + NFS client', what: 'Ordinary syscalls on the mount become `LOOKUP`, `GETATTR`, `READ`, `WRITE`, `COMMIT` RPCs (or v4 `COMPOUND`s). The app cannot tell the disk is remote — including that it may be slow or unreachable.' },
      { name: 'Attribute cache', what: 'File attributes are cached for `acregmin`–`acregmax` (3–60 s) and directories for `acdirmin`–`acdirmax` (30–60 s) by default. Within that window another client’s changes (new files, sizes) can be invisible.' },
      { name: 'Close-to-open consistency', what: 'The only real guarantee: data written and closed by client A is seen by client B that opens the file afterwards, because A flushes on `close()` and B revalidates on `open()`. Concurrent readers/writers with the file open get no guarantee.' },
      { name: 'Locking', what: 'NFSv3: advisory locks via the separate NLM protocol and `statd` for crash recovery — notoriously fragile through firewalls and restarts. NFSv4: locks are part of the protocol with leases (Linux default 90 s) and a grace period after server restart during which new locks are refused.' },
      { name: 'Mount semantics', what: '`hard` (default) retries forever: processes block in uninterruptible D state while the server is down. `soft` returns `EIO` after `timeo`/`retrans`, which can silently corrupt writes. There is no good option for a write path.' },
      { name: 'Server and storage', what: 'A single Linux `knfsd` host, an HA filer pair (NetApp, Isilon), or a managed service (EFS, Filestore, Azure Files). Throughput, IOPS and metadata ops are shared by every client.' },
    ],
    real: [
      { name: 'Linux knfsd', how: 'In-kernel server exporting directories via `/etc/exports`. HA needs Pacemaker + DRBD/shared storage + floating IP; clients stall through failover and the v4 grace period.' },
      { name: 'NetApp ONTAP / Dell PowerScale (Isilon)', how: 'Commercial filers: NVRAM-backed write acks, controller HA pairs, snapshots, scale-out namespaces (Isilon). They fix durability and throughput, not the protocol’s coherence model or the coupling.' },
      { name: 'AWS EFS', how: 'Managed NFSv4.1 replicated across AZs (Standard). Throughput modes: Bursting (baseline scales with stored size: ~50 KiB/s per GiB, with burst credits), Provisioned, and Elastic. Per-operation latency is in the low milliseconds — fine for streaming, painful for many small files.' },
      { name: 'Lustre / FSx for Lustre, CephFS', how: 'Parallel/distributed filesystems with separate metadata and object servers, built for HPC and ML training throughput (hundreds of GB/s). Different tool, same caution: metadata-heavy small-file workloads hurt.' },
      { name: 'GitLab (moving away)', how: 'GitLab.com served Git repositories over NFS and hit repeated latency and availability incidents; it built **Gitaly**, a gRPC service that owns repository access, and removed NFS from the request path.' },
    ],
  },

  lifecycle: {
    summary: 'A web request renders a gallery with 20 thumbnails stored on an NFS mount in the same region (RTT ~0.5 ms, server lightly loaded). Compare with a CDN serving thumbnails directly.',
    stages: [
      { stage: 'Path lookup', what: '`open("/mnt/shared/thumbs/u42/1.jpg")` walks path components; cached dentries help, misses issue `LOOKUP` RPCs.', cost: '0–4 RPCs', ms: 1 },
      { stage: 'Open revalidation', what: 'Close-to-open requires a `GETATTR` (or v4 `OPEN`) on every open to check for changes.', cost: '1 RPC per file', ms: 0.5 },
      { stage: 'Read', what: '`READ` RPCs for 30 KB; page cache hit if unchanged and cached.', cost: '0–1 RPC + transfer', ms: 0.8 },
      { stage: 'Close', what: 'Flush dirty pages (none for reads); v4 `CLOSE` op.', cost: '0–1 RPC', ms: 0.3 },
      { stage: '× 20 thumbnails', what: 'Serial in typical PHP/Ruby code: 20 × (lookup + getattr + read + close).', cost: '~50–80 RPCs', ms: 40 },
      { stage: 'Server contention', what: 'A backup or rsync job on the share saturates server disks; every RPC queues.', cost: 'p99 per op 10–100 ms', ms: 200 },
      { stage: 'App streams bytes', what: 'App server sends images to the client itself — no CDN, worker held.', cost: 'App CPU + bandwidth', ms: 30 },
    ],
  },

  deepDives: [
    {
      title: 'Close-to-open consistency and attribute caching',
      hook: 'Two servers can disagree about whether a file exists for up to a minute — by design.',
      body: [
        'NFS clients cache aggressively to avoid RPCs. Attributes (size, mtime, existence) are trusted for 3–60 s per file and 30–60 s per directory, scaled by how recently the file changed. Directory listings and negative lookups ("file not found") are cached too, so server B can keep returning 404 for a file server A just created.',
        'The guarantee is **close-to-open**: if A writes and closes, then B opens, B sees A’s data. Patterns that break it: B already had the file open (log tailing), A never closed it (long-lived writers), B checks existence with `stat()` instead of `open()`, or both append concurrently. Mount options `noac`/`actimeo=0` or `lookupcache=none` improve coherence at the cost of an RPC on nearly every access — throughput collapses.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Stale read across servers',
        actors: ['Web A', 'NFS server', 'User', 'Web B', 'B attr cache'],
        messages: [
          { from: 'Web A', to: 'NFS server', label: 'CREATE + WRITE u42.jpg' },
          { from: 'Web A', to: 'NFS server', label: 'COMMIT on close', tone: 'ok' },
          { from: 'User', to: 'Web B', label: 'GET /img/u42.jpg' },
          { from: 'Web B', to: 'B attr cache', label: 'lookup u42.jpg' },
          { from: 'B attr cache', to: 'Web B', label: 'cached: no such file', dashed: true, tone: 'warn' },
          { from: 'Web B', to: 'User', label: '404 for ~60 s', dashed: true, tone: 'bad' },
        ],
        caption: 'Negative and directory attribute caching hides A’s new file from B.',
      },
      insight: 'Using a shared filesystem as a coordination mechanism ("worker picks up files dropped in /inbox") inherits all these races. Use a queue or a DB row for coordination; files are payload only.',
    },
    {
      title: 'Failure semantics: hard mounts and D-state',
      hook: 'A local disk failure kills one server; an NFS server failure freezes all of them.',
      body: [
        'With the default `hard` mount, an RPC to an unreachable server is retried forever. Any thread touching the mount — including health-check handlers that log to it, or `df` in a monitoring agent — blocks in uninterruptible sleep (D state) and cannot be killed. Web servers stop answering, health checks fail, autoscaling replaces them, and the new ones hang on boot when they mount the share.',
        '`soft` mounts return `EIO` after `timeo × retrans`, so processes recover — but a write that times out may or may not have happened, and applications rarely handle `EIO` on `write()`/`close()` correctly, leading to silent truncation. Neither option gives you the "fail fast, fail independently" behaviour a stateless tier needs.',
      ],
      diagram: {
        type: 'flow',
        title: 'NFS server reboot cascade',
        nodes: [
          { label: 'NFS server down', sub: 'reboot / failover', tone: 'bad' },
          { label: 'Threads in D state', sub: 'hard mount retries', tone: 'bad' },
          { label: 'Pools exhausted', sub: 'all web servers', tone: 'warn' },
          { label: 'Health checks fail', sub: 'LB drains everything', tone: 'bad' },
          { label: 'Grace period', sub: 'v4: no new locks', tone: 'warn' },
          { label: 'Slow recovery', sub: 'cold caches', tone: 'warn' },
        ],
      },
      code: {
        lang: 'bash',
        caption: 'Typical mount lines and what they trade',
        code: `# hard (default): never lose acked writes, but hang forever when the server is gone
mount -t nfs4 -o hard,timeo=600,retrans=2,vers=4.1 nfs:/export /mnt/shared
# EFS recommended options (from AWS docs)
mount -t nfs4 -o nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport \\
  fs-1234.efs.us-east-1.amazonaws.com:/ /mnt/efs
# soft: processes get EIO instead of hanging, writes may be silently lost
mount -t nfs -o soft,timeo=50,retrans=3 nfs:/export /mnt/ro-data`,
      },
      insight: 'Never put anything a health check or the boot path touches on NFS. If the mount is optional to serving traffic, the failure of the mount must be optional too.',
    },
    {
      title: 'Locking: NLM, leases and why databases corrupt on NFS',
      hook: '`flock()` that works on a laptop silently stops coordinating across servers.',
      body: [
        'NFSv3 locks go through the separate Network Lock Manager and `rpc.statd`, which must notify lock holders after crashes; firewalls, NAT and restarts frequently break it. Linux historically emulated `flock()` with POSIX byte-range locks over NFS, and some configurations (`nolock`, `local_lock=`) make locks purely local — two servers both "hold" the lock.',
        'NFSv4 integrates locking with leases: a client must renew within the lease time (Linux default 90 s) or its locks are revoked; after a server restart there is a grace period in which clients reclaim locks and new locks wait. Correct, but a network partition longer than the lease means a client may still be writing while another acquires the lock.',
        'SQLite, Berkeley DB and similar embedded databases rely on precise lock and `fsync` semantics; the SQLite docs warn that NFS locking is often broken and can corrupt databases. Running Postgres/MySQL data directories on NFS is supported only under strict conditions and is a frequent source of corruption reports.',
      ],
      table: {
        columns: ['Mechanism', 'Version', 'Failure behaviour', 'Safe for coordination?'],
        rows: [
          ['NLM + statd', 'NFSv3', 'Lost notifications, stale locks', 'No'],
          ['Leases + grace period', 'NFSv4.x', 'Revoked after ~90 s partition', 'Weak'],
          ['local_lock / nolock', 'any', 'Locks are per-client only', 'No'],
          ['DB row / Redis lease / etcd', 'n/a', 'Fencing tokens possible', 'Yes'],
        ],
      },
      insight: 'If correctness depends on a lock, you need fencing (a monotonically increasing token checked by the resource). NFS locks provide none; a coordination service plus fencing does.',
    },
    {
      title: 'Throughput, latency and noisy neighbours',
      hook: 'Big sequential reads are fine; thousands of small files and metadata ops are where NFS dies.',
      body: [
        'Every metadata operation is a round trip: ~0.2–1 ms on a LAN, low milliseconds on managed cloud NFS. Code written for local disks (where `stat()` costs microseconds) can do hundreds of them per request: framework autoloaders checking files, `ls` on a directory with 500k files, template caches, `file_exists` loops. A 100× slowdown per op becomes seconds per request.',
        'All clients share the server’s NIC, CPU, disk IOPS and (for EFS Bursting) a credit balance. A nightly backup, an `rsync`, or one job writing logs to the share degrades every web server at once. EFS Bursting throughput is proportional to stored size (~50 KiB/s per GiB baseline), so a small file system storing a few GB of uploads gets a tiny baseline once burst credits run out — a classic production surprise; Elastic throughput mode exists for this.',
      ],
      table: {
        caption: 'Per-operation cost',
        columns: ['Operation', 'Local NVMe', 'NFS (LAN)', 'Managed NFS (cloud)'],
        rows: [
          ['stat / getattr', '~1 µs (cached)', '~0.2–0.5 ms', '~1–3 ms'],
          ['open + read 4 KB', '~10–100 µs', '~0.5–1 ms', '~1–5 ms'],
          ['create + write + close', '~50 µs', '~1–3 ms', '~3–10 ms'],
          ['list 100k-entry dir', '~50 ms', 'seconds', 'seconds to tens of s'],
        ],
      },
      insight: 'Before blaming NFS for slowness, count syscalls per request (`strace -c` or `perf trace`). The fix is often fewer metadata ops (opcache, no `file_exists` loops) — or moving the data off the share entirely.',
    },
    {
      title: 'The right alternative: object storage, stateless servers',
      hook: 'Replace "shared directory" with "shared service with an HTTP API" and the coupling disappears.',
      body: [
        'User uploads go to object storage via presigned URLs, metadata goes to the DB, and reads come from a CDN. Web servers keep nothing they cannot lose and can be killed at any time. Session state goes to Redis or a signed cookie, not to files. Generated artifacts (thumbnails, exports) are objects too.',
        'For apps you cannot change yet, a stepping stone: keep NFS only for the legacy write path, sync to S3 asynchronously, and serve reads from S3/CDN — or use an S3-backed file gateway. Tools like Mountpoint for S3 or s3fs give a file view of a bucket for read-heavy workloads, but they are not POSIX (no in-place edits, limited renames) and should not be treated as NFS replacements for writes.',
      ],
      diagram: {
        type: 'compare',
        title: 'Shared directory vs shared service',
        columns: [
          { name: 'NFS mount', points: ['Server in request path', 'Hangs on failure', 'Stale caches across nodes', 'App streams bytes'], tone: 'bad' },
          { name: 'Object store + CDN', points: ['Client ↔ S3 directly', 'Fails per request', 'Strong read-after-write', 'CDN serves reads'], tone: 'ok' },
        ],
      },
      insight: 'The migration is mostly about identifying every code path that touches the mount: uploads are obvious, but also sessions, caches, lock files, generated assets and cron outputs. `lsof`/`auditd` on the mount for a week gives you the real list.',
    },
    {
      title: 'When a shared filesystem IS right',
      hook: 'NFS/EFS is a legitimate tool when the workload really needs POSIX files shared across machines.',
      body: [
        'Good fits: legacy or third-party apps you cannot modify (WordPress plugins, CMSs, some enterprise software); ML/HPC training data read by many nodes (often via Lustre/FSx or EFS); shared home directories and build caches for developer machines; container platforms needing ReadWriteMany volumes for low-traffic shared config; and lift-and-shift migrations as a temporary step.',
        'Make it safe: read-mostly access, no locking-based coordination, nothing on the health-check or boot path, large files over many small ones, managed multi-AZ service instead of a single box, and alarms on latency and throughput credits.',
      ],
      insight: 'Ask "does the app need a filesystem or does it need shared bytes?" Most web apps need shared bytes, which object storage provides more cheaply and robustly.',
    },
  ],

  scaling: {
    body: [
      'A single NFS server scales vertically only: bigger box, faster disks, more NICs. Filers and managed services (EFS, Isilon) scale capacity and aggregate throughput, but the coupling remains — every client depends synchronously on the shared service, and per-operation latency does not improve with scale.',
      'Multi-AZ: EFS Standard stores data across AZs and offers mount targets per AZ; cross-AZ data access adds latency and transfer cost. Multi-region means asynchronous replication (EFS replication) with an RPO of minutes; there is no multi-region writable NFS with POSIX semantics.',
    ],
    bullets: [
      'Server failure = all clients affected (hang with hard mounts).',
      'Per-op latency is constant overhead; more clients only add queueing.',
      'EFS Bursting throughput scales with stored GiB; small file systems starve.',
      'Coherence does not improve with scale; more clients = more stale-cache windows.',
      'Object storage scales request rate per prefix and capacity independently.',
    ],
    diagram: {
      type: 'compare',
      title: 'Scaling shapes',
      columns: [
        { name: 'Single NFS server', points: ['Scale up only', 'SPOF', 'Shared IOPS'], tone: 'bad' },
        { name: 'Managed NFS (EFS)', points: ['Multi-AZ durable', 'ms per op', 'Throughput modes/credits'], tone: 'warn' },
        { name: 'Object store', points: ['Scale out by prefix', 'Per-request failure', 'CDN offload'], tone: 'ok' },
      ],
    },
  },

  failures: [
    {
      name: 'Server outage hangs the tier',
      symptom: 'All web servers stop responding at once; processes in D state; restarts do not help.',
      detect: 'Node exporter `node_procs_blocked` spike, `nfsstat -c` retransmissions, mount latency probe from each client.',
      mitigate: 'Move request-path data off NFS; keep mounts off boot/health paths; HA server or managed service in the meantime.',
    },
    {
      name: 'Stale reads and phantom 404s',
      symptom: 'Files appear on some servers and not others for up to a minute after upload.',
      detect: 'Per-server 404 rate for recently created keys; synthetic write-then-read-from-another-node probe.',
      mitigate: 'Do not coordinate via files; serve from object storage with strong read-after-write.',
    },
    {
      name: 'Throughput credit exhaustion (EFS)',
      symptom: 'Everything slows to a crawl days after a migration, with no code change.',
      detect: 'CloudWatch `BurstCreditBalance` trending to zero, `PercentIOLimit`, `MeteredIOBytes`.',
      mitigate: 'Elastic or Provisioned throughput, reduce I/O, move hot data to object storage/CDN.',
    },
    {
      name: 'Lock failures and corruption',
      symptom: 'Duplicate job processing, corrupted SQLite files, truncated writes after soft-mount timeouts.',
      detect: 'Integrity checks, duplicate-processing metrics, `EIO` errors in application logs.',
      mitigate: 'Coordination via DB/Redis/etcd with fencing; never host databases on NFS.',
    },
    {
      name: 'Noisy neighbour',
      symptom: 'Page latency spikes nightly when a backup or batch job reads the share.',
      detect: 'Server-side ops/s and disk utilization correlated with client p99; `nfsiostat` per-mount RTT.',
      mitigate: 'Snapshot-based backups, separate exports/filesystems per workload, QoS on filers.',
    },
  ],

  warStories: [
    {
      title: 'GitLab removes NFS from the Git path',
      source: 'GitLab blog posts on Gitaly (2017–2018)',
      what: 'GitLab.com stored repositories on NFS servers mounted by application nodes. As traffic grew, NFS latency and server incidents translated directly into site-wide slowness and outages, and Git’s many small file operations were costly over the network. GitLab built Gitaly, a gRPC service colocated with the storage, migrated all Git access to it, and then disabled NFS.',
      lesson: 'Replace "remote filesystem" with "remote service with an API" so operations are coarse-grained, observable and can fail per request.',
    },
    {
      title: 'Burst credits ran out on a Thursday',
      source: 'Composite of common incidents (AWS EFS Bursting mode)',
      what: 'A team lifted a CMS to AWS with uploads on a 20 GB EFS file system. It ran fast for a week on initial burst credits, then baseline throughput (~1 MiB/s for 20 GiB) took over; page loads went to 10+ seconds. Nothing in the app had changed, which made diagnosis slow.',
      lesson: 'Read the throughput model of managed filesystems and alarm on credits; for small, hot datasets, use Elastic throughput or object storage.',
    },
    {
      title: 'The NFS reboot that took the whole site',
      source: 'Composite of common incidents',
      what: 'A file server holding uploads and PHP session files was rebooted for a kernel patch "during low traffic". All web servers hung on hard-mounted session reads; the load balancer marked them unhealthy; autoscaling launched new instances that hung mounting the share at boot. Recovery took far longer than the 5-minute reboot.',
      lesson: 'Sessions belong in Redis or signed cookies, uploads in object storage; the web tier must not share a synchronous failure domain with a file server.',
    },
  ],

  numbers: [
    { label: 'Attribute cache (files)', value: '3–60 s', note: 'acregmin/acregmax defaults' },
    { label: 'Attribute cache (dirs)', value: '30–60 s', note: 'acdirmin/acdirmax defaults' },
    { label: 'NFSv4 lease (Linux)', value: '~90 s', note: 'plus grace period after restart' },
    { label: 'Metadata op, LAN', value: '~0.2–1 ms' },
    { label: 'Metadata op, managed cloud NFS', value: '~1–5 ms' },
    { label: 'EFS Bursting baseline', value: '~50 KiB/s per GiB stored', note: 'credits allow bursts' },
    { label: 'NFS port', value: 'TCP 2049', note: 'v3 also needs portmapper/NLM ports' },
    { label: 'Local stat()', value: '~1 µs cached', note: '100–1000× cheaper than NFS' },
  ],

  capacity: {
    question: 'A PHP site on 10 web servers serves 2,000 req/s; each request does ~40 file metadata operations on an NFS-mounted app directory (autoload checks, templates, uploads). Can one NFS server cope?',
    steps: [
      'Metadata load: 2,000 × 40 = 80,000 ops/s against one server, mostly GETATTR/LOOKUP.',
      'Latency added: 40 serial ops × ~0.5 ms ≈ 20 ms per request at best; with server queueing at 80k ops/s, p99 can reach hundreds of ms.',
      'Failure impact: 100% of requests depend on the server; a 5-minute reboot is a 5-minute+ total outage.',
      'Fix 1: deploy code to local disk with opcache (eliminates most stat calls); metadata load drops ~10×.',
      'Fix 2: uploads to S3 + CDN; NFS only for a legacy admin path or removed entirely.',
    ],
    answer: 'One server might survive the ops/s, but it adds ~20 ms+ per request and makes the whole site share its failure domain; local code + object storage removes both problems.',
  },

  comparison: {
    caption: 'Shared storage options',
    columns: ['Option', 'Semantics', 'Failure mode', 'Latency per op', 'Fits'],
    rows: [
      ['Self-run NFS (knfsd)', 'POSIX, close-to-open', 'Single box; clients hang', '~0.2–1 ms', 'Labs, legacy on-prem'],
      ['Filer (NetApp, Isilon)', 'POSIX, HA pair', 'Failover stalls', '~0.2–1 ms', 'Enterprise shared files'],
      ['AWS EFS / Filestore', 'NFSv4.1, multi-AZ', 'Throughput limits, ms ops', '~1–5 ms', 'Legacy apps, shared config, ML data'],
      ['FSx for Lustre / CephFS', 'Parallel FS', 'Metadata server pressure', 'sub-ms to ms', 'HPC, ML training throughput'],
      ['Object store (S3) + CDN', 'Key → object, strong RAW', 'Per-request errors', '10–100 ms first byte', 'User uploads, static assets'],
    ],
  },

  whenNot: [
    'User uploads and static assets for a web tier — object storage + CDN.',
    'Session storage — Redis/Memcached or signed cookies.',
    'Coordination between servers (locks, job claiming, inbox directories) — a DB, queue or etcd with fencing.',
    'Database data directories (SQLite, embedded DBs, usually Postgres/MySQL) — local or block storage.',
    'Anything on the boot or health-check path of a stateless service.',
  ],

  interview: [
    {
      q: 'Your monolith writes uploads to local disk and you are adding a second server. A teammate proposes an NFS mount. Respond.',
      a: 'It works immediately but makes the file server part of every request: its latency is added to each file op, its failure hangs every web server on hard mounts, and client caching means servers disagree about new files for up to a minute. Instead upload directly to object storage with presigned URLs, keep metadata in the DB and serve via CDN — servers become stateless. If we need a bridge, NFS can be temporary with a dated plan to remove it.',
      followUps: ['What else besides uploads tends to live on the share?', 'How would you migrate existing files with zero downtime?'],
      seniorSignal: 'Names the failure coupling and cache-coherence problems concretely and offers a time-boxed bridge rather than a flat refusal.',
    },
    {
      q: 'What is close-to-open consistency and how does it bite web apps?',
      a: 'NFS guarantees that a client opening a file after another client closed it sees the closed data — flush on close, revalidate on open. Between those points, attribute and directory caches (3–60 s) can hide changes, including the existence of new files. Web apps that write on one server and check `file_exists` or list a directory on another get phantom 404s and inconsistent listings.',
      followUps: ['What do `noac` or `actimeo=0` cost?', 'Is S3 better here, and why?'],
      seniorSignal: 'Explains the exact guarantee and the cache windows, and contrasts with S3’s strong read-after-write.',
    },
    {
      q: 'Hard vs soft mounts — which would you choose for a write path?',
      a: 'Neither is good. Hard mounts never lose acknowledged writes but freeze processes in uninterruptible sleep when the server is unreachable, taking down the whole tier. Soft mounts return `EIO`, so processes recover, but writes may be partially applied and apps rarely handle that correctly. The real answer is to take the shared filesystem off the synchronous write path.',
      followUps: ['How would you detect hung NFS clients in monitoring?', 'What about read-only data?'],
      seniorSignal: 'Recognizes the dilemma as a design smell instead of tuning mount options.',
    },
    {
      q: 'When would you deliberately choose EFS or another shared filesystem?',
      a: 'When software genuinely needs POSIX files shared across machines and cannot be changed: legacy or third-party apps, shared ML training datasets read by many nodes, developer home directories, low-traffic ReadWriteMany volumes. I would keep access read-mostly, avoid locking-based coordination, keep it off boot and health-check paths, pick the right throughput mode and alarm on latency and credits.',
      followUps: ['Why might Lustre beat EFS for training data?', 'What is the EFS Bursting trap?'],
      seniorSignal: 'Has concrete legitimate use cases and operational guardrails, not only a prohibition.',
    },
    {
      q: 'Why do embedded databases like SQLite corrupt on NFS?',
      a: 'They rely on correct POSIX byte-range locks and `fsync` ordering to coordinate writers and guarantee durability. Over NFS, locks may be emulated locally, lost on server restart, or revoked after a lease expires during a partition, while client caches may serve stale pages. Two writers can believe they hold the lock, so they interleave writes and corrupt the file.',
      followUps: ['How would you coordinate two workers safely?', 'What is a fencing token?'],
      seniorSignal: 'Ties corruption to lock semantics and introduces fencing as the correct coordination primitive.',
    },
  ],

  takeaways: [
    'NFS turns every file syscall into an RPC to a shared server on the request path.',
    'Only close-to-open consistency; caches hide changes across servers for up to ~60 s.',
    'Hard mounts hang the whole tier on server failure; soft mounts risk silent write loss.',
    'Locks are weak (NLM fragile, v4 leases) — never coordinate or run databases over NFS.',
    'Small-file and metadata-heavy workloads suffer most; count syscalls per request.',
    'Object storage + CDN + stateless servers is the scalable answer for uploads and assets.',
    'Legitimate for legacy apps, shared ML/HPC datasets and read-mostly shared config.',
  ],
};

export default deep;
