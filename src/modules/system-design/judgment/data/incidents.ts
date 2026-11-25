import type { IncidentCase } from '../types';

export const INCIDENTS: IncidentCase[] = [
  /* ------------------------------------------------------------------ */
  {
    id: 'inc-cache-stampede',
    title: 'The cache restart that took down the database',
    severity: 'SEV1',
    alert: '🔴 PAGE: catalog-api 5xx rate 68% (threshold 1%) · catalog-db CPU 100% · p99 > 2s',
    context:
      'The product catalog serves ~12,000 req/s at peak, 95% reads, with a 90% Redis hit ratio. A platform engineer applied a routine Redis minor-version upgrade during the evening peak; the single Redis node restarted with an empty keyspace. The SQL primary can do ~4,000 load units/s.',
    workload: { qps: 12000, readRatio: 0.95, cacheHit: 0.9 },
    patterns: ['caching', 'circuit-breaker', 'read-replicas'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Shoppers', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'Catalog API', count: 8, x: 380, y: 120 },
        { id: 'cache', kind: 'cache', label: 'Redis (1 node)', x: 570, y: 40 },
        { id: 'db', kind: 'db', label: 'Catalog DB', x: 570, y: 200 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'cache' },
        { from: 'app', to: 'db' },
      ],
    },
    inject: { down: [{ node: 'cache', count: 1 }] },
    timeline: [
      { t: '19:58', event: 'Redis upgrade started from the change calendar (marked low-risk).' },
      { t: '20:01', event: 'Redis restarts; keyspace empty. Hit ratio drops from 90% to ~0%.' },
      { t: '20:01', event: 'DB connections jump from 180 to 2,000 (pool max). DB CPU 100%.' },
      { t: '20:02', event: 'App threads block on DB calls; LB health checks start failing on app pods.' },
      { t: '20:04', event: 'You are paged. Redis is back up and healthy — but nothing recovers.' },
    ],
    signals: [
      { label: 'API 5xx rate', value: '68%', tone: 'bad' },
      { label: 'Redis hit ratio', value: '2% (normally 90%)', tone: 'bad' },
      { label: 'Redis health', value: 'UP, 0.3 GB used (normally 9 GB)', tone: 'warn' },
      { label: 'DB CPU / connections', value: '100% / 2000 of 2000', tone: 'bad' },
      { label: 'App pod CPU', value: '14%', tone: 'neutral' },
      { label: 'Deploys in last hour', value: 'none (infra change only)', tone: 'neutral' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'Redis is up, app CPU is low, the DB is pinned. What is the most likely shape of this incident?',
        options: [
          'A bad app deploy — roll back the catalog service',
          'A cache stampede: a cold cache sends every read to the DB, which is now overloaded',
          'A network partition between the app and Redis',
          'A slow query introduced by a schema change',
        ],
        answer: 1,
        explain:
          'The tell is **Redis is healthy but nearly empty** while the DB is saturated: every request is a miss. Low app CPU says the app is waiting, not working. There was no deploy, so rolling back is a reflex, not a diagnosis. A partition would show Redis errors/timeouts, not a low hit ratio.',
      },
      {
        title: 'Root cause',
        question: 'Why does the system not recover on its own even though Redis came back within seconds?',
        options: [
          'Redis is still replaying its AOF file',
          'The DB has too few indexes',
          'Refilling the cache requires DB reads, but the DB is saturated so misses time out and never populate the cache — a feedback loop',
          'The LB is routing traffic to the wrong pods',
        ],
        answer: 2,
        explain:
          'Cache-aside only warms on a **successful** miss. With the DB at 3× its capacity, most misses time out, so keys never get written back and the hit ratio stays near zero. This is a metastable failure: the trigger is gone, but the overload sustains itself. Indexes would not fix a 3× load problem.',
      },
      {
        title: 'Mitigate now',
        question: 'What is the fastest safe way to break the loop?',
        options: [
          'Restart the DB to clear connections',
          'Scale the app tier from 8 to 24 pods',
          'Shed load: temporarily serve a static/degraded catalog or reject a share of traffic at the LB, and let hot keys refill (pre-warm the top N products) before reopening',
          'Flush Redis again so it starts clean',
        ],
        answer: 2,
        explain:
          'You need the DB **below** capacity long enough for the cache to fill. Shedding load (and pre-warming the hottest keys) does that. Restarting the DB drops in-flight work and comes back to the same stampede. More app pods means more concurrent DB queries — it makes the overload worse.',
      },
      {
        title: 'Prevent',
        question: 'Which follow-up most directly prevents a repeat?',
        options: [
          'Freeze all infrastructure changes during peak hours',
          'Make the cache tier redundant (replicated cluster, rolling upgrades) and add request coalescing / stale-while-revalidate so a miss storm sends one DB query per key',
          'Double the DB instance size',
          'Lower the cache TTL so data is fresher',
        ],
        answer: 1,
        explain:
          'The design flaw is that the DB was sized for 10% of reads and the cache was a single node. A replicated cache removes the trigger; **coalescing** removes the amplification. Change freezes treat the symptom; a bigger DB still cannot take 3× load; shorter TTLs make stampedes more likely.',
      },
    ],
    lesson:
      'Once a cache absorbs most reads, it is no longer an optimisation — it is **load-bearing**, and the DB behind it is sized for misses only. Treat the cache tier like a database: redundant, upgraded with rolling restarts, warmed before cut-over, and protected by request coalescing so a cold start cannot turn into a self-sustaining overload. The change was reasonable; the system made a routine restart unsafe.',
    realWorld:
      'Facebook, Sept 2010: an automated system for fixing invalid cache/config values caused every client to query the database cluster at once; the feedback loop only stopped when they took the site down to let the databases recover.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inc-retry-storm',
    title: 'One slow payment pod, a whole checkout outage',
    severity: 'SEV1',
    alert: '🔴 PAGE: checkout success rate 3% (SLO 99.5%) · payments-svc p99 9.8s',
    context:
      'Checkout (3,000 req/s, 70% reads) calls the Payments service through a shared HTTP client that retries failed calls 3× with no backoff and no circuit breaker. Payments runs 3 pods; one pod\'s node started hanging on a degraded disk. The client has a hard-coded endpoint list (no health checking).',
    workload: { qps: 3000, readRatio: 0.7 },
    patterns: ['circuit-breaker', 'service-discovery', 'idempotency'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Shoppers', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'Checkout', count: 6, x: 380, y: 120 },
        { id: 'retry', kind: 'naive-retry', label: 'HTTP client (retry ×3)', x: 570, y: 40 },
        { id: 'pay', kind: 'service', label: 'Payments', count: 3, x: 760, y: 40 },
        { id: 'db', kind: 'db', label: 'Orders DB', x: 570, y: 220 },
        { id: 'replica', kind: 'replica', x: 760, y: 220 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'retry' },
        { from: 'retry', to: 'pay' },
        { from: 'app', to: 'db' },
        { from: 'app', to: 'replica' },
        { from: 'db', to: 'replica' },
      ],
    },
    inject: { down: [{ node: 'pay', count: 1 }] },
    timeline: [
      { t: '14:10', event: 'payments-2 host disk latency spikes to 4s; the process stays up but hangs.' },
      { t: '14:11', event: 'One third of payment calls time out after 3s. Clients retry each ×3 immediately.' },
      { t: '14:12', event: 'Healthy payments pods see ~3× normal traffic; their p99 climbs past 5s.' },
      { t: '14:13', event: 'Checkout pods exhaust their thread pools waiting on Payments; even cart reads start failing.' },
      { t: '14:14', event: 'You are paged.' },
    ],
    signals: [
      { label: 'Checkout success', value: '3%', tone: 'bad' },
      { label: 'Payments RPS', value: '8,900 (normally 3,000)', tone: 'bad' },
      { label: 'payments-2', value: 'UP (TCP accepts), 100% timeouts', tone: 'bad' },
      { label: 'payments-1/3 CPU', value: '98%', tone: 'warn' },
      { label: 'Checkout threads busy', value: '200 / 200', tone: 'bad' },
      { label: 'Orders DB', value: 'healthy, 40% CPU', tone: 'ok' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'Payments traffic is ~3× normal, but user traffic is flat. What explains the extra load?',
        options: [
          'A bot attack on the checkout endpoint',
          'Retries: every timed-out call is re-sent up to 3 times, amplifying load on the remaining healthy pods',
          'A marketing campaign started',
          'The LB is duplicating requests',
        ],
        answer: 1,
        explain:
          'Flat user traffic + tripled downstream traffic = **amplification inside your system**. Immediate retries without backoff or a budget multiply load exactly when the dependency is weakest. Bots and campaigns would show at the edge too.',
      },
      {
        title: 'Root cause',
        question: 'A single hung pod is 1/3 of capacity. Why did it become a near-total outage?',
        options: [
          'Payments is under-provisioned in general',
          'The disk failure spread to other hosts',
          'No health-checked discovery kept sending traffic to the hung pod, retries overloaded the healthy ones, and with no circuit breaker checkout threads blocked on timeouts — a cascading failure',
          'The orders DB ran out of connections',
        ],
        answer: 2,
        explain:
          'Three missing guards compounded: (1) the hung pod stayed in rotation, (2) retries amplified load ×3, (3) without a **breaker or tight timeout**, checkout threads waited and starved unrelated requests. The DB is healthy; the failure is pure coupling.',
      },
      {
        title: 'Mitigate now',
        question: 'What do you do first?',
        options: [
          'Remove payments-2 from the endpoint list and disable client retries (feature flag) to stop the amplification',
          'Scale Payments to 12 pods',
          'Restart all checkout pods',
          'Fail over the orders DB',
        ],
        answer: 0,
        explain:
          'Cut the **cause** (the hung instance) and the **amplifier** (retries). Scaling Payments may help eventually but new pods take minutes and retries will saturate them too. Restarting checkout just refills thread pools with the same blocked calls.',
      },
      {
        title: 'Prevent',
        question: 'Which change set best prevents this class of incident?',
        options: [
          'Increase the client timeout to 30s so calls eventually succeed',
          'Remove retries entirely',
          'Health-checked discovery (registry/LB) for Payments, a circuit breaker with a fallback ("payment pending"), retries with exponential backoff + jitter and a retry budget, and idempotency keys so retries are safe',
          'Move Payments onto bigger machines',
        ],
        answer: 2,
        explain:
          'Retries are fine when **bounded and safe**: backoff + jitter + budget, behind a breaker, against instances that are health-checked, with idempotency keys so a retried charge is not a double charge. Longer timeouts hold threads even longer; removing retries hurts the 99% case of transient errors.',
      },
    ],
    lesson:
      'A partially failed dependency is more dangerous than a dead one: it accepts connections and holds your threads. Resilience is a stack — health-checked routing, timeouts, retry budgets with backoff, circuit breakers with fallbacks — and missing any layer lets one bad host take the whole flow down. The engineer who wrote the retry helper was optimising for transient blips; the system lacked a budget to make that safe under sustained failure.',
    realWorld:
      'AWS us-east-1, Dec 7 2021: an automated scaling action triggered a surge of connection retries from clients on AWS\'s internal network, congesting the devices between networks and impairing many services for hours.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inc-primary-down-no-failover',
    title: 'Primary database lost at 3 a.m., no automatic failover',
    severity: 'SEV1',
    alert: '🔴 PAGE: orders-api write errors 100% · "could not connect to server: orders-db-primary"',
    context:
      'An order service (2,000 req/s, 80% reads) runs on a single SQL primary with two async read replicas. Failover is a runbook: an on-call human promotes a replica and updates the app config. The primary\'s host just failed a hardware check and was terminated by the cloud provider.',
    workload: { qps: 2000, readRatio: 0.8 },
    patterns: ['leader-election', 'read-replicas'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Customers', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'Orders API', count: 4, x: 380, y: 120 },
        { id: 'db', kind: 'db', label: 'Primary', x: 570, y: 60 },
        { id: 'replica', kind: 'replica', label: 'Async replicas', count: 2, x: 760, y: 200 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'db' },
        { from: 'app', to: 'replica' },
        { from: 'db', to: 'replica' },
      ],
    },
    inject: { down: [{ node: 'db', count: 1 }] },
    timeline: [
      { t: '03:02', event: 'Cloud provider retires the primary\'s host after a hardware fault.' },
      { t: '03:02', event: 'All writes fail; reads routed to the primary (1/3 of reads) time out.' },
      { t: '03:07', event: 'You are paged (alert needed 5 minutes of errors to fire).' },
      { t: '03:15', event: 'You find the runbook; it references a replica that was decommissioned last month.' },
    ],
    signals: [
      { label: 'Write success', value: '0%', tone: 'bad' },
      { label: 'Read success', value: '67%', tone: 'warn' },
      { label: 'Primary', value: 'UNREACHABLE (host terminated)', tone: 'bad' },
      { label: 'replica-1 lag at failure', value: '0.4 s', tone: 'ok' },
      { label: 'replica-2 lag at failure', value: '38 s', tone: 'warn' },
      { label: 'App pods', value: 'healthy', tone: 'ok' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'Why are some reads failing even though both replicas are healthy?',
        options: [
          'Replicas cannot serve reads while the primary is down',
          'The app spreads reads across all SQL nodes including the dead primary, and it has no health checking — those calls hang until timeout',
          'The LB is broken',
          'Replication lag makes reads fail',
        ],
        answer: 1,
        explain:
          'Replicas serve reads fine without a primary. The read errors come from **the app still routing a share of reads to a dead host** with no health check. Lag produces stale reads, not errors.',
      },
      {
        title: 'Root cause',
        question: 'What turned a routine hardware failure into a 15+ minute write outage?',
        options: [
          'The cloud provider terminating hosts without notice',
          'Async replication',
          'Failover depended on a human following a stale runbook — there was no automated, quorum-based leader election to promote a replica',
          'Too few replicas',
        ],
        answer: 2,
        explain:
          'Hosts **will** die; that is the premise. The gap is that promotion was manual. A quorum (etcd/ZooKeeper/Raft, or a managed DB with automatic failover) detects the dead leader, promotes the most caught-up replica and fences the old one in seconds.',
      },
      {
        title: 'Mitigate now',
        question: 'You are promoting a replica by hand. Which one, and what else must you do?',
        options: [
          'replica-2, because it was added more recently',
          'Either — they are identical',
          'replica-1 (0.4s lag, least data at risk); repoint the app and the other replica to it, and make sure the old primary can never come back as a writer (fence it)',
          'Wait for the provider to restore the host so no data is lost',
        ],
        answer: 2,
        explain:
          'Promote the **most caught-up** replica to minimise lost writes (async replication means the last ~0.4s may be gone — record it). Fencing matters: if the old primary reappears and accepts writes you have split brain. Waiting for a terminated host is not a plan.',
      },
      {
        title: 'Prevent',
        question: 'Which follow-up is the best investment?',
        options: [
          'Add a third replica',
          'Automated failover via a consensus-backed coordinator (or managed HA DB) with fencing, health-checked DB endpoints in the app, and regular failover game days',
          'Page faster (1-minute alert window)',
          'Move to multi-master so any node can take writes',
        ],
        answer: 1,
        explain:
          'More replicas do not promote themselves. Faster pages still leave a human in the loop. Multi-master trades a failover problem for a **write-conflict** problem. Automated, quorum-based election plus practice is what makes failover boring.',
      },
    ],
    lesson:
      'Replicas give you a copy of the data, not availability: someone still has to decide, safely and once, who the new leader is. Runbooks rot; automation that is exercised regularly does not. Automate failover with a quorum and fencing, and test it by actually failing primaries on a schedule. Equally important: automated failover must understand topology (regions, lag) or it can make things worse.',
    realWorld:
      'GitHub, Oct 2018: a 43-second network partition led their automated failover tooling to promote primaries in another region; writes landed on both sides and reconciling them caused over 24 hours of degraded service — a reminder that automation needs fencing and topology awareness.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inc-hot-shard',
    title: 'One shard falls over and a quarter of users are locked out',
    severity: 'SEV2',
    alert: '🟠 PAGE: profile-api 5xx 24% · shard-3 OOM-killed (restart loop)',
    context:
      'User data is split across 4 shards by `user_id` range. Each shard is a single SQL instance (nightly backups, no replica). Shard 3 owns IDs created during a viral growth month and holds 2.5× the data of the others; its working set no longer fits in RAM. Traffic: 6,000 req/s, 85% reads.',
    workload: { qps: 6000, readRatio: 0.85 },
    patterns: ['sharding', 'consistent-hashing', 'read-replicas'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Users', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'Profile API', count: 6, x: 380, y: 120 },
        { id: 'router', kind: 'shard-router', label: 'Range router', x: 570, y: 120 },
        { id: 'shard', kind: 'shard', label: 'Shards 1–4', count: 4, x: 760, y: 120 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'router' },
        { from: 'router', to: 'shard' },
      ],
    },
    inject: { down: [{ node: 'shard', count: 1 }] },
    timeline: [
      { t: 'D-30', event: 'Capacity review shows shard-3 at 81% memory; ticket filed, not prioritised.' },
      { t: '11:20', event: 'Weekly analytics job runs a large scan on every shard.' },
      { t: '11:24', event: 'shard-3 is OOM-killed, restarts, warms its buffer pool, gets killed again.' },
      { t: '11:26', event: 'Every request for a user on shard-3 fails. You are paged.' },
    ],
    signals: [
      { label: 'Error rate', value: '24%', tone: 'bad' },
      { label: 'Errors by shard', value: '100% on shard-3, 0% elsewhere', tone: 'bad' },
      { label: 'shard-3 data size', value: '2.5× median shard', tone: 'warn' },
      { label: 'Other shards CPU', value: '35%', tone: 'ok' },
      { label: 'Router', value: 'healthy', tone: 'ok' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'Errors are ~25% and all for one shard. Can the router just send shard-3\'s traffic to the healthy shards?',
        options: [
          'Yes — the router health-checks and will route around it',
          'No — with key-based partitioning, each key lives on exactly one shard; other shards do not have that data',
          'Yes, but only for reads',
          'Only if you restart the router',
        ],
        answer: 1,
        explain:
          'This is the core trade of sharding: it scales writes by giving each key **one owner**. Losing an owner without a replica means that slice of users is down, full stop — health checks cannot conjure data that is not there.',
      },
      {
        title: 'Root cause',
        question: 'What is the real root cause, beyond "OOM"?',
        options: [
          'The analytics job',
          'Uneven partitioning (a range key that let one shard grow 2.5×) plus no replica per shard, with no rebalancing process',
          'Not enough app pods',
          'The router is a single point of failure',
        ],
        answer: 1,
        explain:
          'The analytics scan was the **trigger**, not the cause. Range-by-ID made the shard sizes depend on signup history, there was no rebalancing to fix the skew, and each shard had a single copy so one host failure equals partial outage.',
      },
      {
        title: 'Mitigate now',
        question: 'Fastest way to restore the affected users?',
        options: [
          'Kill the analytics job, restore shard-3 on a larger instance (more RAM) from backup + binlogs, and keep heavy scans off it',
          'Re-shard everything into 8 shards right now',
          'Point shard-3 users at shard-4',
          'Add more app pods',
        ],
        answer: 0,
        explain:
          'Remove the trigger and **scale the one sick shard vertically** — a perfectly good short-term move. Re-sharding live during an outage is a multi-day migration and risks data loss. Pointing users at a shard without their data returns wrong or empty profiles.',
      },
      {
        title: 'Prevent',
        question: 'Which long-term fix addresses both skew and availability?',
        options: [
          'Switch to `user_id % 4`',
          'Hash-based placement with many virtual partitions (consistent hashing / fixed partition map) so data spreads evenly and can be moved in small pieces, plus a replica with automatic failover per shard, plus per-shard capacity alerts',
          'Bigger shards',
          'Move analytics to a weekly schedule',
        ],
        answer: 1,
        explain:
          '`% 4` spreads data but makes adding a 5th shard remap almost every key. Many small partitions on a hash ring (or a lookup map) give even spread **and** cheap rebalancing. Replicas per shard turn host loss into a failover instead of an outage.',
      },
    ],
    lesson:
      'Sharding multiplies your failure domains: N shards means N things that can each take a slice of users offline. Every shard needs the same HA story as a single database (replica + automated failover), and the partitioning scheme must keep shards even and movable as data grows. The capacity ticket was filed; the gap was a process that turned that signal into action.',
    realWorld:
      'Foursquare, Oct 2010: one MongoDB shard grew faster than the others and ran out of RAM; the site was down for about 11 hours while they added a shard and migrated data.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inc-stale-endpoints',
    title: 'Half the inventory pods vanished, but callers kept calling them',
    severity: 'SEV2',
    alert: '🟠 PAGE: checkout p99 2.1s (SLO 400ms) · checkout errors 52%',
    context:
      'Checkout (2,500 req/s, 60% reads) calls Inventory synchronously. Inventory runs 6 pods spread over 2 availability zones. Checkout reads Inventory addresses from a config file rendered at deploy time — there is no service registry or health-checked load balancing between services. AZ-b just had a networking event.',
    workload: { qps: 2500, readRatio: 0.6 },
    patterns: ['service-discovery', 'load-balancing', 'circuit-breaker'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Shoppers', x: 0, y: 120 },
        { id: 'gw', kind: 'api-gateway', count: 2, x: 190, y: 120 },
        { id: 'checkout', kind: 'service', label: 'Checkout', count: 4, x: 380, y: 120 },
        { id: 'inv', kind: 'service', label: 'Inventory (static IP list)', count: 6, x: 570, y: 120 },
        { id: 'db', kind: 'db', label: 'Inventory DB', x: 760, y: 60 },
        { id: 'replica', kind: 'replica', x: 760, y: 220 },
      ],
      edges: [
        { from: 'client', to: 'gw' },
        { from: 'gw', to: 'checkout' },
        { from: 'checkout', to: 'inv' },
        { from: 'inv', to: 'db' },
        { from: 'db', to: 'replica' },
      ],
    },
    inject: { down: [{ node: 'inv', count: 3 }] },
    timeline: [
      { t: '09:40', event: 'AZ-b networking event: 3 of 6 inventory pods unreachable.' },
      { t: '09:41', event: 'Kubernetes reschedules them in AZ-a with new IPs. Checkout config still lists the old ones.' },
      { t: '09:41', event: 'Half of inventory calls hit dead IPs and wait for the 1s connect timeout.' },
      { t: '09:45', event: 'You are paged. Inventory dashboards show all 6 pods "Ready".' },
    ],
    signals: [
      { label: 'Checkout errors', value: '52%', tone: 'bad' },
      { label: 'Checkout p99', value: '2.1 s', tone: 'bad' },
      { label: 'Inventory pods Ready', value: '6 / 6 (3 rescheduled)', tone: 'ok' },
      { label: 'Inventory CPU', value: '22%', tone: 'ok' },
      { label: 'Checkout → inventory connect timeouts', value: '~50% of calls', tone: 'bad' },
      { label: 'Inventory DB', value: 'healthy', tone: 'ok' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'Inventory reports 6/6 pods ready and low CPU, yet checkout sees ~50% connect timeouts. Where do you look?',
        options: [
          'Inventory\'s code — it must be throwing errors',
          'The addresses checkout is using: it is likely calling IPs that no longer host inventory',
          'The inventory DB',
          'The API gateway',
        ],
        answer: 1,
        explain:
          '**Connect** timeouts (not 5xx) while the callee looks healthy means the caller is dialing the wrong place. Low inventory CPU confirms it is not receiving half the traffic it should.',
      },
      {
        title: 'Root cause',
        question: 'What made a routine AZ blip into an outage?',
        options: [
          'Running in only 2 AZs',
          'Static, deploy-time endpoint lists: instance churn is invisible to callers, and nothing health-checks the targets',
          'Too few inventory pods',
          'Kubernetes rescheduling too aggressively',
        ],
        answer: 1,
        explain:
          'Instances move — that is normal in any cloud. The design assumed they would not. With a **registry or service mesh / internal LB**, callers resolve healthy endpoints continuously and the reschedule would have been a non-event.',
      },
      {
        title: 'Mitigate now',
        question: 'Best immediate action?',
        options: [
          'Re-render checkout\'s config with the current pod IPs and roll checkout',
          'Scale inventory to 12 pods',
          'Restart the inventory DB',
          'Increase checkout\'s connect timeout to 5s',
        ],
        answer: 0,
        explain:
          'Fix the stale data the callers depend on. More inventory pods will not be in checkout\'s list either. A longer timeout just makes each failed call slower and holds more threads.',
      },
      {
        title: 'Prevent',
        question: 'What should the follow-up be?',
        options: [
          'Pin inventory pods to fixed IPs',
          'Dynamic service discovery (registry + health checks, e.g. Kubernetes Services/Consul/mesh) with client-side outlier ejection, short connect timeouts and a circuit breaker on the inventory call',
          'Add an alert on config drift',
          'Merge inventory into checkout',
        ],
        answer: 1,
        explain:
          'Pinning IPs fights the platform. Drift alerts still need a human. Discovery + health checks make churn invisible; **outlier ejection** and a breaker cover the gap between an instance dying and the registry noticing.',
      },
    ],
    lesson:
      'In elastic infrastructure, the set of healthy instances is live data, and anything that snapshots it (config files, long DNS TTLs, cached connection pools) will eventually route to the dead. Make discovery dynamic and health-aware, and keep callers defensive with fast timeouts and ejection. The engineer who wrote the static config was following the pattern every other service used at the time.',
    realWorld:
      'Roblox, Oct 2021: their Consul cluster (service discovery, plus KV for other systems) degraded under a new streaming feature and a BoltDB performance issue; because nearly every service depended on it, the platform was down for about 73 hours — discovery is critical infrastructure and must be treated that way.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inc-flash-sale-spike',
    title: 'The influencer post: 5× traffic in 90 seconds',
    severity: 'SEV2',
    alert: '🟠 PAGE: storefront 5xx 20% · app pod CPU 100% · queue for /checkout timing out',
    context:
      'A small fashion store normally peaks at 2,000 req/s (80% reads) on 4 app pods with a Redis cache in front of SQL. A celebrity posted a discount link; traffic went to ~5× in under two minutes. The app tier is a fixed-size group (autoscaling was "on the roadmap"). Order placement writes synchronously to the DB.',
    workload: { qps: 2000, readRatio: 0.8, cacheHit: 0.9 },
    patterns: ['autoscaling', 'message-queues', 'caching', 'cdn'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Shoppers', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'Storefront', count: 4, x: 380, y: 120 },
        { id: 'cache', kind: 'cache', label: 'Redis', count: 2, x: 570, y: 40 },
        { id: 'db', kind: 'db', label: 'Shop DB', x: 570, y: 220 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'cache' },
        { from: 'app', to: 'db' },
      ],
    },
    inject: { traffic: 5 },
    timeline: [
      { t: '18:00', event: 'Influencer posts a link with a 40%-off code to 6M followers.' },
      { t: '18:01', event: 'Traffic climbs from 2k to 10k req/s. App pods at 100% CPU.' },
      { t: '18:02', event: 'Checkouts write to the DB synchronously; DB write latency rises.' },
      { t: '18:03', event: 'You are paged. Marketing asks in Slack whether the sale is "going well".' },
    ],
    signals: [
      { label: 'Requests/s', value: '10,100 (normal peak 2,000)', tone: 'warn' },
      { label: '5xx rate', value: '20%', tone: 'bad' },
      { label: 'App pod CPU', value: '100% × 4', tone: 'bad' },
      { label: 'Redis hit ratio', value: '91%', tone: 'ok' },
      { label: 'DB CPU', value: '88%', tone: 'warn' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'Which tier is the first bottleneck?',
        options: [
          'Redis — it must be overwhelmed',
          'The app tier: 4 fixed pods (~8k req/s) cannot serve ~10k req/s',
          'The LB',
          'DNS',
        ],
        answer: 1,
        explain:
          'Cache hit ratio is healthy and the LB is far below its ceiling. 4 pods × ~2k req/s is ~8k; offered load is ~10k. The **fixed-size compute tier** saturates first. The DB is hot but not yet the limit.',
      },
      {
        title: 'Root cause',
        question: 'What is the underlying design gap?',
        options: [
          'The discount code was too generous',
          'Capacity was static and sized for normal peak with no elastic headroom, and every checkout hit the DB synchronously with no buffer to absorb bursts',
          'Redis should be bigger',
          'The influencer should have warned you',
        ],
        answer: 1,
        explain:
          'Spikes are a property of the internet, not a mistake by marketing. The system had no way to **add** capacity (autoscaling) or **defer** work (queue for order processing), so a 5× burst became errors.',
      },
      {
        title: 'Mitigate now',
        question: 'What do you do in the next 5 minutes?',
        options: [
          'Manually scale the app group to ~12 pods, put static product pages behind the CDN, and if needed enable a waiting room / shed non-essential endpoints',
          'Restart the app pods to free memory',
          'Disable the cache to reduce complexity',
          'Turn off the discount code',
        ],
        answer: 0,
        explain:
          'Add capacity where it is missing and **reduce what reaches origin** (CDN, waiting room, shedding recommendations). Restarts lose capacity during the spike. Killing the discount code destroys the business event you are trying to serve.',
      },
      {
        title: 'Prevent',
        question: 'Which follow-up gives the most protection for the next spike?',
        options: [
          'Permanently run 20 pods',
          'Autoscaling on CPU/RPS with a warm minimum and fast scale-out, async order processing through a queue so writes are buffered, CDN for static pages, and a load test at 5×',
          'Move to a bigger single server',
          'Rate-limit every user to 1 req/s',
        ],
        answer: 1,
        explain:
          '20 pods forever is expensive and still finite. Autoscaling covers the compute tier; a **queue** decouples the DB from burst writes; the CDN removes most reads. Note that autoscaling takes minutes — a warm minimum and a queue cover the gap. Per-user limits do not stop many real users.',
      },
    ],
    lesson:
      'Capacity planning for consumer traffic is about bursts, not averages. Combine elastic compute (autoscaling with a warm floor), buffers for work that can wait (queues), and offload for what can be cached (CDN). Then prove it with a load test at the spike you fear. The team had correctly prioritised features; the missing piece was making "unexpected success" a tested scenario.',
    realWorld:
      'Pokémon GO launch, July 2016: Google Cloud reported traffic reached about 50× the target estimate (and ~10× the worst-case estimate), forcing rapid capacity additions during launch week.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inc-credential-stuffing',
    title: 'Login endpoint melts under a credential-stuffing botnet',
    severity: 'SEV2',
    alert: '🟠 PAGE: auth-api 5xx 60% · auth-db write IOPS at limit · failed logins 40×',
    context:
      'The login API normally serves 1,500 req/s (50% reads: session checks; 50% writes: logins that update `last_login` and a failed-attempt counter). There is no rate limiting anywhere: the LB forwards everything to 4 app pods. A botnet started replaying a leaked credential list from thousands of IPs.',
    workload: { qps: 1500, readRatio: 0.5 },
    patterns: ['rate-limiting', 'api-gateway', 'autoscaling'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Users + bots', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'Auth API', count: 4, x: 380, y: 120 },
        { id: 'db', kind: 'db', label: 'Auth DB', x: 570, y: 60 },
        { id: 'replica', kind: 'replica', x: 760, y: 200 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'db' },
        { from: 'db', to: 'replica' },
      ],
    },
    inject: { traffic: 4 },
    timeline: [
      { t: '02:10', event: 'Login requests rise from 750/s to 5,000/s; 97% fail authentication.' },
      { t: '02:12', event: 'Each failed login writes a counter row. Auth DB write IOPS hit the provisioned limit.' },
      { t: '02:13', event: 'Session checks for real users time out behind the write backlog.' },
      { t: '02:14', event: 'You are paged.' },
    ],
    signals: [
      { label: 'Login attempts/s', value: '5,000 (normal 750)', tone: 'bad' },
      { label: 'Login failure ratio', value: '97%', tone: 'bad' },
      { label: 'Distinct source IPs', value: '41,000 (residential ASNs)', tone: 'warn' },
      { label: 'Auth DB', value: 'CPU 100%, write IOPS capped', tone: 'bad' },
      { label: 'App pod CPU', value: '72%', tone: 'warn' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'Traffic is up 4× and 97% of logins fail. What is happening?',
        options: [
          'A product launch brought many new users who forgot passwords',
          'An automated credential-stuffing attack: high volume, very high failure ratio, widely distributed sources',
          'A bug in password hashing',
          'The DB is corrupted',
        ],
        answer: 1,
        explain:
          'Real users do not fail 97% of the time from 41k residential IPs at 2 a.m. This is **abuse traffic**, and it is consuming capacity real users need.',
      },
      {
        title: 'Root cause',
        question: 'Why did abusive traffic cause an outage for legitimate users?',
        options: [
          'The app has a memory leak',
          'Nothing limited or prioritised requests at the edge, and each failed attempt did expensive work (password hash + DB write) before being rejected',
          'Passwords are too short',
          'The replica is lagging',
        ],
        answer: 1,
        explain:
          'Every unauthenticated request got the full, expensive path. Without **admission control** (rate limits, bot scoring, cheap rejection before costly work), anyone can buy your capacity for free.',
      },
      {
        title: 'Mitigate now',
        question: 'Which immediate step protects real users fastest?',
        options: [
          'Scale the auth DB to the largest instance',
          'Enable edge rate limiting on `/login` (per IP and per account, plus a global cap) and a CAPTCHA/bot challenge for suspicious traffic; make failed-attempt counting cheap (in Redis, not a DB write)',
          'Block all logins for an hour',
          'Turn off the failed-attempt counter',
        ],
        answer: 1,
        explain:
          'Push rejection to the cheapest point. A bigger DB is just a bigger target; blocking everyone is a self-inflicted outage; turning off lockout counting helps the attacker. Rate limits + challenges at the edge restore capacity for humans.',
      },
      {
        title: 'Prevent',
        question: 'Long-term, what is the right architecture?',
        options: [
          'Autoscale the app tier so it can absorb any attack',
          'A gateway/edge layer with layered rate limits (global, per-IP, per-account, per-API-key), bot management, and cheap fast-path rejection, with abuse dashboards and alerting on failure ratios',
          'Require 2FA for everyone immediately',
          'Move login to a separate domain',
        ],
        answer: 1,
        explain:
          'Autoscaling against an attacker just converts an outage into a bill. **Layered limits at the edge** keep costs proportional to legitimate use. 2FA is great for account safety but does not stop the load.',
      },
    ],
    lesson:
      'Any endpoint that does expensive work for unauthenticated callers is a capacity liability. Rate limiting is not just fairness between customers — it is availability protection. Put admission control at the edge, make rejection cheap, and alert on abuse signals (failure ratios, source diversity) rather than only on errors.',
    realWorld:
      'GitHub, Feb 28 2018: a 1.35 Tbps memcached-amplification DDoS hit github.com; they routed traffic through Akamai\'s scrubbing edge and were back within about 10 minutes — abuse is handled at the edge, not by scaling origin.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inc-global-config-push',
    title: 'A config change pinned every CPU at once',
    severity: 'SEV1',
    alert: '🔴 PAGE: edge-api 5xx 67% · 6 of 8 app pods failing health checks · CPU 100%',
    context:
      'A request-filtering rule (a new regular expression for blocking a malicious pattern) is shipped as runtime configuration and pushed to all app pods simultaneously — config does not go through the staged deploy pipeline. Traffic: 12,000 req/s, 90% reads, behind a health-checking LB.',
    workload: { qps: 12000, readRatio: 0.9, cacheHit: 0.9 },
    patterns: ['load-balancing', 'autoscaling', 'caching'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Users', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'Edge API', count: 8, x: 380, y: 120 },
        { id: 'cache', kind: 'cache', count: 2, x: 570, y: 40 },
        { id: 'db', kind: 'db', x: 570, y: 200 },
        { id: 'replica', kind: 'replica', x: 760, y: 200 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'cache' },
        { from: 'app', to: 'db' },
        { from: 'app', to: 'replica' },
        { from: 'db', to: 'replica' },
      ],
    },
    inject: { down: [{ node: 'app', count: 6 }] },
    timeline: [
      { t: '13:42', event: 'Security engineer merges a new filter rule; config system pushes it to all pods within 30s.' },
      { t: '13:43', event: 'The regex backtracks catastrophically on common inputs; pod CPU hits 100%.' },
      { t: '13:43', event: 'LB health checks time out on 6 of 8 pods; the remaining 2 receive all traffic and saturate.' },
      { t: '13:45', event: 'You are paged. No code deploy is in progress.' },
    ],
    signals: [
      { label: '5xx rate', value: '67%', tone: 'bad' },
      { label: 'Healthy pods', value: '2 / 8', tone: 'bad' },
      { label: 'CPU (all pods)', value: '100%', tone: 'bad' },
      { label: 'Code deploys (2h)', value: 'none', tone: 'neutral' },
      { label: 'Config changes (2h)', value: '1 — waf-rules v812, 13:42', tone: 'warn' },
      { label: 'DB / cache', value: 'healthy, low load', tone: 'ok' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'No code deploy, every pod at 100% CPU simultaneously. What is the best first hypothesis?',
        options: [
          'A traffic spike',
          'A change that reached every pod at once — check config/feature-flag changes, not just deploys',
          'A noisy neighbour on one host',
          'Database slowness',
        ],
        answer: 1,
        explain:
          'Request volume is normal and data stores are idle, so it is not load or dependencies. **Simultaneous** failure across all pods points to something shared and recent: config is code that often skips the safety rails.',
      },
      {
        title: 'Root cause',
        question: 'What allowed a single bad rule to take down the whole fleet?',
        options: [
          'Regexes are inherently dangerous',
          'The engineer did not test the rule',
          'Config changes bypassed staged rollout: no canary, no automatic halt on health regression, and a CPU-unbounded regex engine',
          'Too few pods',
        ],
        answer: 2,
        explain:
          'Blameless framing: a person will eventually ship a bad rule. The system must make that **cheap**. Global, instant config push meant blast radius = 100%. A canary would have shown the CPU spike on 1 pod; a linear-time regex engine would have prevented the backtracking entirely.',
      },
      {
        title: 'Mitigate now',
        question: 'Fastest path to recovery?',
        options: [
          'Add 16 more pods',
          'Roll back the config (global kill switch for the rule set) and let pods recover',
          'Restart all pods',
          'Fail over to the DR region',
        ],
        answer: 1,
        explain:
          'New pods load the same config and pin their CPUs too. Restarts reload it. DR has the same config. **Revert the change**: the single fastest mitigation for any change-induced incident.',
      },
      {
        title: 'Prevent',
        question: 'Which follow-up best reduces the blast radius of future config changes?',
        options: [
          'Require two approvals on rule changes',
          'Treat config like code: staged/canary rollout with automatic rollback on health metrics, a global kill switch, and a regex engine with linear-time guarantees (e.g. RE2) plus CPU limits per rule',
          'Ban regexes in filter rules',
          'Only change rules on weekdays',
        ],
        answer: 1,
        explain:
          'Reviews help but do not catch performance cliffs. **Progressive delivery** with automatic halt limits blast radius for every class of bad change, and safe-by-construction tools (RE2) remove this specific failure mode.',
      },
    ],
    lesson:
      'Health-checking LBs protect you from one bad instance, not from a change that breaks every instance at once — then the survivors just get the full load and fail too. The defence is limiting how fast a change reaches the fleet: canaries, staged rollout, automatic rollback, and a kill switch. Configuration and feature flags deserve the same pipeline as code.',
    realWorld:
      'Cloudflare, July 2 2019: a WAF rule with a regex that backtracked catastrophically was deployed globally at once, exhausting CPU on every edge machine and causing ~27 minutes of 502s worldwide.',
  },
];
