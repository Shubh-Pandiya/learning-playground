import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'big-server',

  problem: {
    why: 'When the database or app server runs hot, the simplest fix is a bigger machine: more cores, more RAM, faster disks, no code changes, no distributed-systems problems. This is often **correct** — modern servers are enormous and one box avoids network hops, partitioning and consistency trade-offs. It becomes an anti-pattern when it is the only plan: one failure domain, a hard ceiling, non-linear cost at the top end, and resizes that need downtime or a failover.',
    withoutIt: [
      'Teams shard or adopt distributed databases years before they need to, paying permanent complexity.',
      'Working sets that would fit in 1 TB of RAM are spread over many small nodes with network hops.',
      'Single-threaded or lock-heavy bottlenecks are "solved" with horizontal scale that cannot help them.',
      'But with only a big box: one hardware fault, kernel panic or AZ event takes everything down.',
    ],
    position: 'Usually the primary database (or a stateful service like a cache or search node) that cannot trivially scale out. Stateless app tiers should scale horizontally regardless; the debate is about state.',
    diagram: {
      type: 'flow',
      title: 'Scale-up path',
      nodes: [
        { label: '16 cores, 64 GB', sub: 'CPU at 80%', tone: 'warn' },
        { label: '64 cores, 512 GB', sub: 'working set fits', tone: 'ok' },
        { label: '192 cores, 4 TB', sub: 'NUMA, licences', tone: 'warn' },
        { label: 'Largest instance', sub: 'no next size', tone: 'bad' },
        { label: 'Must partition', sub: 'under pressure', tone: 'bad' },
      ],
      caption: 'Each step is easy until there is no next step — plan the exit before you need it.',
    },
  },

  architecture: {
    overview: 'A large server is itself a distributed system in miniature: two or more sockets, each with its own memory controllers (NUMA nodes), connected by an inter-socket link; dozens of PCIe lanes to NVMe drives and 100–200 Gbps NICs. Software scales on it only if it avoids global locks, serial phases and cross-socket memory traffic. Operationally it is a single failure domain, so production setups pair it with a hot standby (synchronous or async replica) and accept failover time on failure or resize.',
    diagram: {
      type: 'layers',
      title: 'Inside a big box',
      layers: [
        { name: 'Software', items: ['DB engine / JVM', 'Global locks, latches', 'GC / allocator', 'Single-threaded phases'], tone: 'warn' },
        { name: 'OS', items: ['Scheduler', 'NUMA balancing', 'Huge pages', 'IRQ affinity'], tone: 'info' },
        { name: 'Compute', items: ['Socket 0: 96–192 cores', 'Socket 1: 96–192 cores', 'Inter-socket link'], tone: 'accent' },
        { name: 'Memory & I/O', items: ['Local DRAM per socket', '1–24+ TB total', 'NVMe ~1M IOPS each', '100–200 Gbps NIC'], tone: 'neutral' },
      ],
      caption: 'Hardware scales further than most software does; NUMA and locks decide how much you actually get.',
    },
    blocks: [
      { name: 'CPU sockets and cores', what: 'Current x86 servers reach ~2 × 128–192 cores. More cores only help work that parallelises; Amdahl’s law caps speedup at 1/serial-fraction (5% serial → max 20×).' },
      { name: 'NUMA memory', what: 'Each socket owns local DRAM; remote access crosses the inter-socket link at roughly 1.5–2× the latency and lower bandwidth. Unpinned processes and big shared buffers end up with half their accesses remote.' },
      { name: 'Storage', what: 'Local NVMe gives ~1M random IOPS per drive at ~100 µs; arrays of 8–24 drives deliver millions of IOPS and tens of GB/s — far beyond most networked block storage.' },
      { name: 'Network', what: '25–200 Gbps NICs; at high packet rates, interrupt and softirq distribution across cores (RSS, IRQ affinity) becomes the limit.' },
      { name: 'Hot standby', what: 'An equally large replica (streaming replication, Always On AG, Multi-AZ) for failover and for resizes: upgrade the standby, fail over, upgrade the old primary. Doubles cost.' },
      { name: 'Software scalability', what: 'Lock contention (buffer pool latches, WAL insert lock, a JVM’s stop-the-world GC over a 1 TB heap) decides whether 192 cores beat 64. Benchmark before buying.' },
    ],
    real: [
      { name: 'Stack Overflow', how: 'For years served one of the busiest sites on the web from a handful of web servers and two SQL Server clusters (primary + replicas) with hundreds of GB of RAM each — famously "scale up" with careful caching rather than sharding.' },
      { name: 'Let’s Encrypt (2021)', how: 'Upgraded its single MariaDB primary to a Dell server with 2 × 32-core AMD EPYC, 2 TB RAM and 24 NVMe drives; reported roughly halved query times and headroom for growth, with replicas for availability.' },
      { name: 'Cloud high-memory instances', how: 'AWS x2iedn.32xlarge (128 vCPU, 4 TB), u7i/u7in high-memory instances up to ~32 TB RAM and ~900 vCPU, mainly for SAP HANA and in-memory databases.' },
      { name: 'Managed DB instance classes', how: 'RDS/Aurora/Cloud SQL scale up by changing instance class; with Multi-AZ the change is applied via failover, so writes pause for about a minute or two instead of a long outage.' },
    ],
  },

  lifecycle: {
    summary: 'Resizing a Postgres primary from 32 to 96 vCPUs with a hot standby (the safe path). Times are illustrative for a ~2 TB database.',
    stages: [
      { stage: 'Provision bigger standby', what: 'Launch the new instance class as a replica, or resize the existing standby.', cost: 'Minutes; 2× cost during overlap', ms: 600000 },
      { stage: 'Replica catch-up', what: 'Streaming replication from base backup/snapshot until lag ~0.', cost: 'Network + disk I/O', ms: 1800000 },
      { stage: 'Planned failover', what: 'Stop writes, wait for lag 0, promote standby, repoint DNS/proxy.', cost: 'Write unavailability', ms: 60000 },
      { stage: 'Connection storm', what: 'All app pools reconnect at once; pooler absorbs it.', cost: 'Spike in auth + CPU', ms: 10000 },
      { stage: 'Cold cache', what: 'New primary’s buffer pool is cold (unless pre-warmed via pg_prewarm); p99 elevated.', cost: 'Disk reads, slow queries', ms: 900000 },
      { stage: 'Rebuild old primary', what: 'Old primary resized and re-attached as standby.', cost: 'Back to N+1', ms: 1800000 },
    ],
  },

  deepDives: [
    {
      title: 'Why scale up first is often right',
      hook: 'A single machine avoids the hardest problems in distributed systems — for a long time.',
      body: [
        'One box means no cross-shard transactions, no distributed joins, no rebalancing and no partial failures between nodes. Local memory is ~100 ns away; a network hop is ~100–500 µs. A working set that fits in RAM on one machine beats the same data spread over a cluster for most OLTP workloads.',
        'The ceiling is far higher than many engineers assume: hundreds of cores, terabytes of RAM and millions of NVMe IOPS. A well-indexed Postgres or MySQL on such hardware handles tens of thousands of transactions per second. Sharding costs engineering time forever; buying a bigger box costs money once (per year).',
      ],
      diagram: {
        type: 'compare',
        title: 'Scale up vs scale out',
        columns: [
          { name: 'Scale up', points: ['No code changes', 'Strong consistency free', 'Single failure domain', 'Hard ceiling'], tone: 'ok' },
          { name: 'Scale out', points: ['Near-unlimited ceiling', 'Partial failures', 'Cross-shard complexity', 'Ops + tooling cost'], tone: 'warn' },
        ],
      },
      insight: 'A strong answer is "scale up the stateful tier until a measured limit, keep the stateless tier horizontal, and have a written partitioning plan with a trigger metric" — not "always shard" or "never shard".',
    },
    {
      title: 'Where the curve bends: Amdahl, locks and NUMA',
      hook: 'Doubling cores rarely doubles throughput for a database.',
      body: [
        'Amdahl’s law: with serial fraction s, the max speedup on N cores is 1 / (s + (1 − s)/N). At s = 5%, 64 cores give ~15×, 192 cores ~18×, infinity 20×. In databases the "serial" part is contention: WAL insertion, buffer-mapping latches, row locks on hot rows, a single replication apply thread, a global allocator.',
        'NUMA adds a second penalty. Memory allocated on socket 0 and accessed from socket 1 costs roughly 1.5–2× the latency. Large shared buffer pools are interleaved across sockets, so on a 2-socket box about half the accesses are remote. Many engines need tuning (interleave policy, huge pages, pinning, disabling automatic NUMA balancing) to scale linearly across sockets.',
      ],
      table: {
        caption: 'Amdahl speedup ceiling',
        columns: ['Serial fraction', '16 cores', '64 cores', '192 cores', 'Max'],
        rows: [
          ['1%', '13.9×', '39.3×', '66.0×', '100×'],
          ['5%', '9.1×', '15.4×', '18.2×', '20×'],
          ['10%', '6.4×', '8.8×', '9.6×', '10×'],
          ['25%', '3.4×', '3.8×', '3.9×', '4×'],
        ],
      },
      insight: 'Profile for contention (wait events in `pg_stat_activity`, `perf` lock profiles) before resizing. If the top wait is a lock, more cores make the queue longer, not shorter.',
    },
    {
      title: 'Single failure domain and blast radius',
      hook: 'A bigger box does not make you more available; it makes each failure bigger.',
      body: [
        'Every component — PSU, DIMM, NIC, kernel, hypervisor host, rack switch, AZ — is a way for the only node to vanish. ECC catches most memory errors, but a host retirement or kernel panic is still a full outage. Availability needs at least one equally sized standby, so real cost is 2× (or 3× with a DR replica).',
        'Failover itself has a cost: seconds to minutes of write unavailability, a connection storm, and a cold cache on the new primary. Bigger machines with bigger buffer pools take longer to warm; a 1 TB buffer pool read back from NVMe at a few GB/s still takes minutes, and from network storage much longer.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Host failure on a big primary',
        actors: ['App', 'Proxy', 'Primary', 'Standby'],
        messages: [
          { from: 'Primary', to: 'Proxy', label: 'host failure', tone: 'bad' },
          { from: 'App', to: 'Proxy', label: 'writes fail', dashed: true, tone: 'bad' },
          { from: 'Proxy', to: 'Standby', label: 'promote after timeout', tone: 'warn' },
          { from: 'Standby', to: 'Proxy', label: 'accepting writes', dashed: true, tone: 'ok' },
          { from: 'App', to: 'Proxy', label: 'reconnect storm', tone: 'warn' },
          { from: 'Proxy', to: 'Standby', label: 'cold cache queries', tone: 'warn' },
        ],
        caption: 'Recovery time depends on detection, promotion and cache warm-up — all grow with the box.',
      },
      insight: 'Express availability needs as RTO/RPO. A single big primary with async standby gives an RTO of ~1–2 minutes and RPO of seconds; if that is acceptable, scale-up is fine.',
    },
    {
      title: 'The cost curve and licensing',
      hook: 'Cloud prices are roughly linear inside a family; the non-linearity hides at the edges.',
      body: [
        'Within one cloud instance family, price per vCPU and per GB is roughly constant from `large` to `48xlarge`. Non-linearity appears with high-memory tiers (multi-TB instances priced as specialised hardware), top-bin CPUs and high-density DIMMs on-prem, and per-core licensing: commercial databases charge per core, so 192 cores may cost more in licences than in hardware.',
        'The other cost is headroom. You must size for peak plus failover plus growth until the next resize, and the step from the largest instance to "partition the data" is not a purchase — it is a project of quarters.',
      ],
      bullets: [
        'Reserved/committed pricing locks you into a size; resizing early wastes commitments.',
        'Standby doubles cost; cross-region DR triples it.',
        'Per-core licences (SQL Server, Oracle) dominate at high core counts.',
        'Horizontally scaled stateless tiers can use spot/preemptible capacity; a single primary cannot.',
      ],
      insight: 'Compare cost per unit of *useful* throughput, measured by benchmark at target p99, not list price per core.',
    },
    {
      title: 'Planning the exit: what to do before the ceiling',
      hook: 'Scale up buys time; spend that time preparing to scale out.',
      body: [
        'Signals that the box is running out: CPU or I/O saturation despite tuning, contention-dominated wait events, replication apply lag on replicas (single-threaded apply cannot keep up with a bigger primary), backup/restore time exceeding RTO, and largest-instance-minus-one already in use.',
        'Steps that keep options open: route reads to replicas, move cold or append-only data (logs, events, history) to separate stores, split by bounded context (auth, billing, catalog each with their own DB), choose a sharding key early and include it in new tables and APIs. Vitess, Citus and managed distributed SQL become migrations rather than rewrites if the key exists.',
      ],
      diagram: {
        type: 'flow',
        title: 'Escalation ladder',
        nodes: [
          { label: 'Tune + index', sub: 'cheapest', tone: 'ok' },
          { label: 'Scale up', sub: 'buy headroom', tone: 'ok' },
          { label: 'Read replicas', sub: 'offload reads', tone: 'info' },
          { label: 'Split by domain', sub: 'separate DBs', tone: 'info' },
          { label: 'Shard by key', sub: 'last resort', tone: 'warn' },
        ],
      },
      insight: 'Write down the trigger ("when p99 write latency > X at peak on the second-largest size, start sharding") so the decision is made calmly, not during an outage.',
    },
  ],

  scaling: {
    body: [
      'Vertical scaling is bounded by the largest machine you can buy and by the software’s ability to use it. It is excellent for the stateful core and inappropriate for stateless tiers, which should be horizontally scaled behind a load balancer from day one because it is cheap to do so.',
      'For availability, pair the big primary with a same-size standby in another AZ; for reads, add replicas; for writes beyond one box, partition. Multi-region active-active is not achievable with a single primary — at most a primary region with async DR.',
    ],
    bullets: [
      'Ceiling: ~2 × 192 cores, 4–32 TB RAM, ~200 Gbps network per host.',
      'Resize = failover to a bigger replica (minutes of degraded service) or a stop/start.',
      'Write throughput limited by one node’s WAL and locks.',
      'Replica apply lag grows when the primary outgrows single-threaded apply.',
      'Backup and restore time scale with data size, not with cores.',
    ],
  },

  failures: [
    {
      name: 'Host failure, no standby',
      symptom: 'Total outage of the service until the machine is replaced and data restored.',
      detect: 'Health checks, instance status checks, replication heartbeat.',
      mitigate: 'Hot standby in another AZ with automated failover; tested restore runbook.',
    },
    {
      name: 'Bigger box does not help',
      symptom: 'After resizing, throughput barely moves; CPU is idle while latency stays high.',
      detect: 'Wait-event analysis shows lock/latch contention; per-core utilisation skewed.',
      mitigate: 'Fix the contended resource (hot rows, partitioning, batching); profile before buying.',
    },
    {
      name: 'NUMA imbalance',
      symptom: 'Unexplained latency variance; one socket saturated, memory bandwidth on the link high.',
      detect: '`numastat`, `perf` remote-memory counters, per-node memory usage.',
      mitigate: 'Interleave buffer pools, pin processes, huge pages, or run one instance per socket.',
    },
    {
      name: 'Resize downtime',
      symptom: 'A planned instance class change causes minutes of write errors and a slow cache warm-up.',
      detect: 'Error rate during maintenance windows; buffer cache hit ratio after failover.',
      mitigate: 'Resize standby first, controlled switchover, pre-warm cache, pooler to absorb reconnects.',
    },
    {
      name: 'Hit the ceiling under growth',
      symptom: 'Already on the largest instance; peak load approaches saturation.',
      detect: 'Capacity forecast vs largest available size; headroom tracked monthly.',
      mitigate: 'Emergency read offload and caching, domain split, then sharding — plan earlier next time.',
    },
  ],

  warStories: [
    {
      title: 'Roblox: bigger machines did not fix the outage',
      source: 'Roblox engineering post-mortem, October 2021 (73-hour outage)',
      what: 'Roblox’s Consul cluster, central to service discovery and configuration, became overloaded. During the incident the team replaced the Consul servers with higher-performance machines (128 cores, faster storage). It did not help: the root causes were contention in a newly enabled streaming feature and a pathological BoltDB freelist behaviour, neither of which scaled with cores.',
      lesson: 'When the bottleneck is contention or an algorithmic pathology, vertical scaling buys nothing; diagnose the limiting resource before throwing hardware at it.',
    },
    {
      title: 'Let’s Encrypt doubles down on one big database',
      source: 'Let’s Encrypt blog, "The Next Gen Database Servers Powering Let’s Encrypt" (2021)',
      what: 'Serving a large share of the web’s TLS certificates from one MariaDB primary, Let’s Encrypt moved to a 64-core AMD EPYC server with 2 TB RAM and 24 NVMe drives rather than sharding, and reported query latencies roughly halved, with replicas providing redundancy.',
      lesson: 'A well-chosen big box with replicas can carry a globally critical service; scale-up is a legitimate architecture when backed by measurement and redundancy.',
    },
    {
      title: 'The single primary that outgrew its replicas',
      source: 'Composite of common incidents',
      what: 'A team kept scaling their MySQL primary to the largest instance. Replicas, applying changes with limited parallelism, fell minutes behind at peak; read-after-write bugs appeared and failover became risky because the standby was behind. They had to partition the hottest tables urgently.',
      lesson: 'Watch replica lag as a leading indicator: a primary that outpaces its replicas has already outgrown the single-node design.',
    },
  ],

  numbers: [
    { label: 'Cores per 2-socket server', value: 'up to ~2 × 192', note: 'current x86 generations' },
    { label: 'Largest cloud RAM', value: '~24–32 TB', note: 'high-memory instances' },
    { label: 'NUMA remote access', value: '~1.5–2× latency', note: 'vs local socket memory' },
    { label: 'NVMe drive', value: '~1M IOPS, ~100 µs', note: 'random 4 KB reads' },
    { label: 'Amdahl at 5% serial', value: 'max 20×', note: 'regardless of core count' },
    { label: 'Managed DB resize', value: '~1–2 min', note: 'Multi-AZ failover-based' },
    { label: 'DRAM access', value: '~100 ns', note: 'vs ~100–500 µs network hop' },
    { label: 'HA cost multiplier', value: '2–3×', note: 'standby + DR replica' },
  ],

  capacity: {
    question: 'An OLTP Postgres runs at 70% CPU on 32 vCPUs at 8,000 TPS; traffic doubles yearly. How long does scaling up last?',
    steps: [
      'Target: keep peak below ~60% CPU for headroom and failover. Today needs ~37 vCPU-equivalents at 60%.',
      'Assume ~80% scaling efficiency per doubling of cores due to contention (measure it): 64 vCPUs ≈ 1.6× capacity, 128 ≈ 2.6×, 192 ≈ 3.3×.',
      'Today’s load is ~1.17× a 32-vCPU box at 60%. Year 1 (16k TPS) needs ~2.3× → 128 vCPUs. Year 2 (32k TPS) needs ~4.7× → beyond 192 vCPUs.',
      'Meanwhile replica apply and backup windows also grow; check they stay within RTO.',
      'So scale-up buys ~1.5–2 years; start domain splits and read offload in year 1.',
    ],
    answer: 'Roughly 18–24 months of headroom from scaling up — enough to plan partitioning calmly, not enough to ignore it.',
  },

  comparison: {
    caption: 'Ways to add capacity to a stateful tier',
    columns: ['Approach', 'Ceiling', 'Failure domain', 'Complexity', 'Fits'],
    rows: [
      ['Single big server', 'Largest box', 'Whole service', 'Lowest', 'Dev, non-critical, early stage'],
      ['Big primary + hot standby', 'Largest box', 'Failover of minutes', 'Low', 'Most OLTP products'],
      ['+ read replicas', 'Writes: one box', 'Reads degrade gracefully', 'Medium (lag)', 'Read-heavy apps'],
      ['Split by domain', 'Per-domain box', 'Per domain', 'Medium', 'Growing product lines'],
      ['Sharded / distributed SQL', 'Near-unlimited', 'Per shard', 'High', 'Large write volume, multi-region'],
    ],
  },

  whenNot: [
    'Stateless tiers (web, API workers) — scale horizontally behind a load balancer.',
    'Availability targets that cannot tolerate a minutes-long failover.',
    'Bottlenecks caused by contention, hot keys or serial work — more cores will not help.',
    'Growth forecasts that exceed the largest machine within your planning horizon.',
    'Multi-region active-active requirements.',
  ],

  interview: [
    {
      q: 'Your primary database is at 85% CPU. What do you do?',
      a: 'First find out why: top queries, missing indexes, wait events. Often a fix there buys a lot. If the load is genuine, scaling up the primary is usually the fastest, safest step — resize the standby, switch over, resize the old primary. In parallel I offload reads to replicas and caches and start planning the next step (domain split or sharding key) with a trigger metric.',
      followUps: ['How do you resize without downtime?', 'What would make you skip scale-up?'],
      seniorSignal: 'Diagnoses before buying, treats scale-up as legitimate, and plans the exit with a measurable trigger.',
    },
    {
      q: 'Why might doubling cores not double throughput?',
      a: 'Amdahl’s law: serial fractions cap speedup, and in databases the serial part is contention — WAL insertion, latches, hot rows, single-threaded replication apply, GC. NUMA adds remote-memory penalties across sockets. Throughput may barely move while latency stays high because the queue is on a lock, not on CPU.',
      followUps: ['How would you detect lock contention in Postgres?', 'What is NUMA interleaving?'],
      seniorSignal: 'Quantifies with Amdahl and names concrete contended resources.',
    },
    {
      q: 'Is a single big server ever the right production architecture?',
      a: 'Yes, often — with a standby. Stack Overflow and Let’s Encrypt are well-known examples. It avoids distributed transactions and partial failure, and modern hardware has a very high ceiling. It is wrong when availability targets cannot accept failover time, when growth outruns the largest box, or for stateless tiers where horizontal scaling is cheap.',
      followUps: ['What RTO/RPO does that give?', 'How do you know when to stop scaling up?'],
      seniorSignal: 'Pushes back on reflexive sharding with real examples while stating the limits precisely.',
    },
    {
      q: 'How does vertical scaling affect blast radius and recovery?',
      a: 'Each failure takes down everything on the box, and recovery takes longer as the box grows: larger buffer pools to warm, more connections to re-establish, more data to restore if the standby is lost. So bigger nodes need faster detection, warm standbys, cache pre-warming and tested restore times.',
      followUps: ['How long would restoring 10 TB take?', 'How would you warm a cold buffer pool?'],
      seniorSignal: 'Connects node size to RTO and operational practices, not only to throughput.',
    },
    {
      q: 'Compare the economics of scaling up vs out.',
      a: 'In the cloud, price is roughly linear within an instance family, so per-core cost is similar; the differences are licensing (per-core DB licences), high-memory tiers, the 2× standby cost, and engineering cost of sharding, which is ongoing. Scale-out lets stateless tiers use spot capacity and autoscaling. For a stateful core, scale-up is usually cheaper until the ceiling is near.',
      followUps: ['How do reserved instances change the decision?', 'What hidden costs does sharding bring?'],
      seniorSignal: 'Includes engineering and licensing costs, not just hardware list prices.',
    },
  ],

  takeaways: [
    'Scale up the stateful core first — it is often correct and avoids distributed complexity.',
    'Always pair a big primary with an equally sized standby; HA cost is 2–3×.',
    'Amdahl, contention and NUMA decide how much a bigger box actually delivers.',
    'Diagnose the bottleneck before buying cores; contention does not scale with hardware.',
    'Resizes and failures take longer as the box grows: warm-up, reconnects, restores.',
    'Watch replica lag and backup time as early signs you are outgrowing one node.',
    'Define a trigger metric and an exit plan (domain split, sharding key) before the ceiling.',
  ],
};

export default deep;
