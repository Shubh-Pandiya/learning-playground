import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'redis-lock',

  problem: {
    why:
      'Teams reach for a Redis lock because Redis is already there and `SET key token NX PX 30000` is one round trip: whoever creates the key “owns” the work until it expires. That is a perfectly good **efficiency lock** — it stops most duplicate work. It is not a **correctness lock**: Redis has no consensus, replicates asynchronously, and expiry runs on time, so a paused or partitioned holder and a new holder can both act. For leader election or anything that must never happen twice, it is the wrong primitive.',
    withoutIt: [
      'Without any lock, 10 cron replicas all rebuild the same expensive report at 02:00.',
      'Cache stampede: 500 requests miss the same key and all recompute it against the database.',
      'Two workers process the same webhook concurrently and send two emails.',
      'With a Redis lock used for correctness, the failures are rarer but worse: two “leaders” write, and nothing detects it.',
    ],
    position:
      'A key in a Redis primary that application instances race to create before doing a piece of work; nothing downstream knows the lock exists — which is exactly the problem for correctness.',
    diagram: {
      type: 'flow',
      title: 'Why it is tempting — and where it leaks',
      nodes: [
        { label: 'Worker', sub: 'SET NX PX 30000', tone: 'neutral' },
        { label: 'Redis primary', sub: '~0.3 ms, single thread', tone: 'accent' },
        { label: 'Async replica', sub: 'may lack the key', tone: 'warn' },
        { label: 'Protected resource', sub: 'cannot see the lock', tone: 'bad' },
      ],
      caption: 'The lock lives in Redis; the damage happens in a resource that never checks it.',
    },
  },

  architecture: {
    overview:
      'A Redis lock is one key with a random owner token and a TTL. Acquire = `SET NX PX` (atomic on one node because commands are executed one at a time). Release = compare-and-delete via a Lua script so you never delete someone else’s lock. Extensions add renewal (Redisson’s watchdog) or spread the lock across independent masters (Redlock). None of them add the two things correctness needs: **consensus** and a **fencing token**.',
    diagram: {
      type: 'layers',
      title: 'Variants, from simple to elaborate',
      layers: [
        { name: 'Single node', items: ['SET NX PX + token', 'Lua compare-and-delete', 'Lost on failover'], tone: 'neutral' },
        { name: 'With renewal', items: ['Redisson RLock', 'Watchdog extends TTL', 'Pub/sub wakes waiters'], tone: 'info' },
        { name: 'Redlock', items: ['5 independent masters', 'Majority within validity', 'Assumes bounded drift'], tone: 'warn' },
        { name: 'What correctness needs', items: ['Consensus (Raft/ZAB)', 'Monotonic fencing token', 'Resource checks token'], tone: 'ok' },
      ],
    },
    blocks: [
      { name: 'Owner token', what: 'Random value unique per acquisition (UUID or 20 random bytes); identifies who may release or extend. Not monotonic, so it cannot fence.' },
      { name: '`SET key token NX PX ttl`', what: 'Creates the key only if absent and sets a millisecond TTL atomically. Replaced the old `SETNX` + `EXPIRE` pair, which could leave a lock without TTL if the client died between the two commands.' },
      { name: 'Lua release / extend', what: '`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end` — atomic because scripts run without interleaving. Same pattern with `pexpire` for extension.' },
      { name: 'Expiry engine', what: 'Redis expires keys lazily on access plus an active cycle that samples keys with TTLs. Expiry is driven by the server’s clock, independent of whether the holder is finished.' },
      { name: 'Async replication', what: 'The primary acknowledges before replicas have the write. `WAIT n timeout` can block until n replicas acknowledge, but it does not make failover consensus-safe.' },
      { name: 'Watchdog (Redisson)', what: 'If you lock without an explicit lease time, Redisson sets a 30 s TTL (`lockWatchdogTimeout`) and a background task renews it every ~10 s while the client is alive.' },
    ],
    real: [
      { name: 'Single-instance pattern (Redis docs)', how: 'The canonical `SET NX PX` + Lua release, documented by Redis as correct for a single instance with the caveat that failover can lose locks.' },
      { name: 'Redisson (Java)', how: '`RLock` with reentrancy (hash of owner → count), watchdog renewal and pub/sub notification of waiters; `RFencedLock` adds a token from an incrementing counter, though without consensus behind it. `RedissonRedLock` is deprecated.' },
      { name: 'Redlock implementations', how: 'redlock-py, node-redlock, redsync (Go): acquire on N=5 independent masters with short per-node timeouts, succeed on a majority within the validity time.' },
      { name: 'Contrast: etcd / ZooKeeper locks', how: 'Lease-backed key or ephemeral sequential znode decided by Raft/ZAB; the create revision or zxid is a real fencing token. Slower (ms) but correct under pauses and partitions.' },
    ],
  },

  lifecycle: {
    summary:
      'One efficiency-lock cycle on a single Redis primary in the same AZ. The lock overhead is ~1 ms; the danger is entirely in the gap between the TTL and how long the work actually takes.',
    stages: [
      { stage: 'Generate token', what: 'Client creates a random owner token.', cost: 'µs', ms: 0.01 },
      { stage: 'Acquire', what: '`SET lock:report:2024-11-28 tok NX PX 30000` → `OK` (or nil: someone else holds it).', cost: '1 RTT ~0.3–1 ms', ms: 0.5 },
      { stage: 'Replicate (async)', what: 'Primary streams the write to replicas after replying; not on the client’s path.', cost: 'Off path', ms: 0 },
      { stage: 'Critical section', what: 'Do the work. Must finish well within the TTL, including GC pauses and slow I/O.', cost: 'Your work', ms: 50 },
      { stage: 'Renew (optional)', what: 'Lua `pexpire` if token matches, e.g. every TTL/3.', cost: '1 RTT', ms: 0.5 },
      { stage: 'Release', what: 'Lua compare-and-delete; returns 0 if the lock had already expired and been taken.', cost: '1 RTT', ms: 0.5 },
    ],
  },

  deepDives: [
    {
      title: 'The single-instance pattern, done right',
      hook: 'Most Redis lock bugs are in the release, not the acquire.',
      body: [
        'Three rules: acquire with one atomic command that sets the TTL (`SET NX PX`, never `SETNX` then `EXPIRE`); store a unique token; release with compare-and-delete. A plain `DEL` is a bug: if your lock expired and B acquired it, your `DEL` releases B’s lock and C gets in — three holders from one mistake.',
        'Check the return value of release: 0 means your lock expired while you were working. That is a signal your TTL is too short or your work too slow — log and alert on it, because for correctness-relevant work something may already have gone wrong.',
      ],
      code: {
        lang: 'lua',
        caption: 'Acquire (command) and release (script)',
        code: `-- acquire (from client):
--   SET lock:invoice:42 9f3c1e... NX PX 30000   -> OK | nil

-- release.lua  (EVALSHA sha 1 lock:invoice:42 9f3c1e...)
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0   -- expired and maybe re-acquired by someone else
end

-- extend.lua  (ARGV[2] = new ttl ms)
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end`,
      },
      insight:
        'A lock that “usually works” hides its failures: nothing logs when two holders overlap. If you keep a Redis lock, at least count release-returned-0 and extend-failed events — they are your only evidence of overlap.',
    },
    {
      title: 'Redlock: the algorithm',
      hook: 'Majority voting across independent Redis nodes — without consensus or a shared clock.',
      body: [
        'Redlock uses N (typically 5) independent Redis masters with no replication between them. The client records the start time, tries `SET NX PX` with the same key and token on every node using a short per-node timeout (e.g. 5–50 ms for a 10 s TTL), and considers the lock acquired if a **majority** (3) succeeded and the elapsed time is less than the TTL. Its validity is TTL − elapsed − clock drift allowance. On failure it releases on all nodes.',
        'Safety relies on assumptions: clocks on the nodes advance at roughly the same rate, the client’s pauses and network delays are much shorter than the TTL, and a crashed node does not restart with the lock forgotten while it is still valid (the Redlock description requires fsync-always persistence or a delayed restart of at least the max TTL).',
      ],
      diagram: {
        type: 'flow',
        title: 'Redlock acquire',
        nodes: [
          { label: 't0 = now()', tone: 'neutral' },
          { label: 'SET NX PX ×5', sub: 'short per-node timeout', tone: 'info' },
          { label: '≥3 succeeded?', tone: 'accent' },
          { label: 'validity = TTL − elapsed', sub: '− drift', tone: 'warn' },
          { label: 'Work within validity', tone: 'ok' },
        ],
      },
      insight:
        'Redlock improves availability over a single node, but the safety argument is timing-based. If your lock is for efficiency, one node is enough; if it is for correctness, timing-based safety is not enough — Redlock sits in an awkward middle.',
    },
    {
      title: 'Kleppmann’s critique and antirez’s reply',
      hook: 'The 2016 debate that defines how senior engineers talk about distributed locks.',
      body: [
        'Martin Kleppmann (“How to do distributed locking”, 2016) argued: (1) any lock with expiry can be held by a client that is paused — GC, page faults, VM suspension, network delay — past its expiry, so it acts after another client acquired the lock; the fix is a **fencing token** checked by the storage, which Redlock does not produce. (2) Redlock’s safety depends on bounded network delay, process pauses and clock drift, i.e. a synchronous system model; clock jumps (NTP steps, admin changes) can expire a lock early on several nodes.',
        'Salvatore Sanfilippo (antirez) replied (“Is Redlock safe?”) that clock issues can be managed (monotonic time, no stepping), that the client can check elapsed time after acquiring, and that the random token could be used for compare-and-set at the resource. Kleppmann’s counterpoint: a pause after the check still breaks it, and a resource that can do compare-and-set on a token already gives you the coordination you need.',
      ],
      diagram: {
        type: 'sequence',
        title: 'The pause problem',
        actors: ['Client 1', 'Redis', 'Client 2', 'Storage'],
        messages: [
          { from: 'Client 1', to: 'Redis', label: 'acquire (TTL 10 s)' },
          { from: 'Client 1', to: 'Client 1', label: 'GC pause 15 s', tone: 'warn' },
          { from: 'Client 2', to: 'Redis', label: 'acquire → OK (expired)' },
          { from: 'Client 2', to: 'Storage', label: 'write', tone: 'ok' },
          { from: 'Client 1', to: 'Storage', label: 'write (stale!)', tone: 'bad' },
        ],
        caption: 'No check by Client 1 helps: the pause can happen right after the check.',
      },
      insight:
        'The practical consensus: use Redis locks when an occasional double execution is acceptable; when it is not, use consensus plus fencing (etcd/ZooKeeper) or push the guarantee into the resource itself (conditional writes, unique constraints, idempotency).',
    },
    {
      title: 'Efficiency locks vs correctness locks',
      hook: 'Ask “what happens if two holders run at once?” — the answer picks the tool.',
      body: [
        'An **efficiency** lock saves work: if it fails, you waste compute or send a duplicate cache refresh. A **correctness** lock protects invariants: if it fails, money moves twice, data is corrupted or two primaries diverge. Redis locks are good at the first and unsafe for the second.',
        'Often the best correctness lock is no lock: make the operation idempotent (idempotency key with a unique constraint), use a conditional write (`UPDATE … WHERE version = ?`, S3 conditional writes, DynamoDB condition expressions), or a DB row lock in the database that owns the data — all naturally fenced by the resource.',
      ],
      table: {
        columns: ['Use case', 'Lock type', 'Double execution means', 'Right tool'],
        rows: [
          ['Cache rebuild / stampede guard', 'Efficiency', 'Extra DB query', 'Redis SET NX'],
          ['Nightly report on 10 replicas', 'Efficiency', 'Report built twice', 'Redis lock or k8s CronJob'],
          ['Leader of a scheduler that charges cards', 'Correctness', 'Double charges', 'etcd/ZK + fencing, idempotency keys'],
          ['Single writer to a shared file/object', 'Correctness', 'Corrupted output', 'Fencing token or conditional writes'],
          ['DB primary election', 'Correctness', 'Split brain, data loss', 'Raft-based manager (Patroni+etcd)'],
        ],
      },
      insight:
        'Stating which kind of lock you need is the senior move in a design review; most incidents come from an efficiency lock quietly promoted to correctness duty as the system evolved.',
    },
    {
      title: 'Long work: expiry, renewal and watchdogs',
      hook: 'Renewal narrows the window; it cannot close it.',
      body: [
        'TTL choice is a trade-off: short TTLs recover quickly from crashed holders but expire under slow work; long TTLs block progress for the whole TTL after a crash. Renewal tries to get both: hold a short TTL and extend it periodically while working.',
        'Redisson’s watchdog renews every `lockWatchdogTimeout / 3` (10 s of a 30 s default) from a background thread. That keeps a slow but alive holder safe, but it also keeps renewing for a thread that is stuck forever (deadlock) as long as the JVM lives — and during a stop-the-world GC pause the watchdog thread is paused too, so the lock can still expire under a paused holder.',
      ],
      bullets: [
        'Check remaining validity before each side effect, and abort if renewal failed.',
        'Split long jobs into short idempotent steps, each with its own lock or checkpoint.',
        'Use a queue with visibility timeouts (SQS) or a workflow engine for long-running exclusive work.',
      ],
      insight:
        'If your critical section is long and must be exclusive, you are describing a job queue with leases or a leader with fencing — not a lock in a cache.',
    },
  ],

  scaling: {
    body: [
      'A single Redis node handles 100k+ lock operations per second, so throughput is never the issue; availability and safety are. Adding replicas with Sentinel or Redis Cluster improves availability but **reduces** safety, because a lock acknowledged by the primary can be missing on the promoted replica.',
      'In Redis Cluster, a lock key lives in one hash slot on one primary; failover of that shard has the same async-replication hole. Redlock needs independent masters, not a cluster.',
    ],
    bullets: [
      'Efficiency locks: single primary is fine; failover losing a lock costs only duplicate work.',
      'Use `WAIT 1 100` after acquiring to reduce (not remove) failover loss.',
      'Hash-tag lock keys only if you need multi-key Lua; otherwise spread them.',
      'Correctness locks: move to etcd/ZooKeeper/Consul or DB-native locking; do not try to make Redis HA enough.',
    ],
    diagram: {
      type: 'compare',
      columns: [
        { name: 'Redis + replica', tone: 'warn', points: ['More available', 'Failover can drop locks', 'No fencing'] },
        { name: 'Redlock (5 masters)', tone: 'warn', points: ['Survives node loss', 'Timing assumptions', 'No fencing'] },
        { name: 'etcd / ZooKeeper', tone: 'ok', points: ['Majority consensus', 'Revision / zxid token', 'ms latency'] },
      ],
    },
  },

  failures: [
    {
      name: 'Holder pauses past TTL',
      symptom: 'Two workers act concurrently after a GC pause or VM freeze; duplicate side effects or overwritten data.',
      detect: 'Release/extend scripts returning 0; `jvm_gc_pause_seconds` max approaching TTL; duplicate-effect reconciliation alerts.',
      mitigate: 'Fencing tokens or conditional writes at the resource; idempotent operations; consensus-based lock for correctness.',
    },
    {
      name: 'Failover drops the lock',
      symptom: 'Shortly after a Sentinel/Cluster failover, a second client acquires a lock the first still holds.',
      detect: 'Sentinel `+switch-master` events or cluster failover logs correlated with duplicate work.',
      mitigate: 'Accept for efficiency locks; otherwise use consensus. `WAIT` narrows the window only.',
    },
    {
      name: 'Unsafe release',
      symptom: 'Plain `DEL` deletes another client’s lock after expiry; cascading overlap of three or more holders.',
      detect: 'Code review / static checks for `DEL lock:*`; overlapping work logs with different tokens.',
      mitigate: 'Lua compare-and-delete with the owner token; library that does it for you.',
    },
    {
      name: 'Clock jump on a Redis node',
      symptom: 'NTP step or manual clock change expires keys early (critical for Redlock majorities).',
      detect: 'Chrony/NTP step events, `timex` offset alerts, unexpected expirations.',
      mitigate: 'Slew-only NTP, monotonic clocks; do not depend on timing for safety.',
    },
    {
      name: 'Lock never released (TTL too long or missing)',
      symptom: 'After a crash, work stalls for the whole TTL; with legacy `SETNX` without TTL, forever.',
      detect: 'Age of lock keys (`PTTL`), job lag alerts.',
      mitigate: 'Always `SET NX PX`; TTL sized to p99.9 work time with renewal; operator unlock runbook.',
    },
  ],

  warStories: [
    {
      title: 'The double-charging scheduler',
      source: 'Composite of common incidents',
      what:
        'A payments scheduler ran on 3 replicas and used a Redis `SET NX PX 30000` key as “leader election”. A long GC pause on the leader during a heap spike exceeded 30 s; a second replica became leader and started the charge batch; the first resumed and finished its batch too. Hundreds of customers were charged twice before reconciliation caught it.',
      lesson: 'Correctness-critical leadership needs consensus plus fencing — and charges need idempotency keys regardless of who is leader.',
    },
    {
      title: 'Failover in the middle of an import',
      source: 'Composite of common incidents',
      what:
        'A Redis primary was replaced during maintenance; the lock key for a tenant import had not reached the replica. A second worker acquired the lock and imported the same file concurrently, creating duplicate rows because the table had no unique constraint on the source row id.',
      lesson: 'Assume Redis locks can vanish on failover; enforce uniqueness in the database that owns the data.',
    },
  ],

  numbers: [
    { label: 'Acquire / release latency', value: '~0.3–1 ms', note: '1 RTT each' },
    { label: 'Single node throughput', value: '100k+ ops/s', note: 'never the bottleneck' },
    { label: 'Typical TTL', value: '10–30 s', note: 'short = fragile, long = slow recovery' },
    { label: 'Redisson watchdog', value: '30 s TTL, renew every ~10 s', note: '`lockWatchdogTimeout`' },
    { label: 'Redlock', value: '5 masters, majority 3', note: 'per-node timeout ≪ TTL' },
    { label: 'JVM full GC pauses', value: '100 ms – tens of s', note: 'larger heaps, older collectors' },
    { label: 'VM live migration / steal', value: 'up to seconds', note: 'pauses the whole guest' },
  ],

  capacity: {
    question:
      'A report job runs on 12 replicas every hour and takes ~4 min; duplicate runs waste ~$3 each. Is a Redis lock acceptable, and how should it be configured?',
    steps: [
      'Classify: duplicate output is harmless (report overwrites itself), cost is only compute ⇒ efficiency lock.',
      'Without a lock: 12 runs/hour ⇒ 11 wasted × $3 × 24 × 30 ≈ $23,760/month.',
      'With a Redis lock: duplicates only on failover or > TTL pauses — a few per month ⇒ ~$10.',
      'TTL: work p99.9 ~6 min ⇒ TTL 2 min with renewal every 40 s, or 10 min without renewal (recovery after a crash then waits ≤ 10 min, fine for hourly work).',
    ],
    answer:
      'Yes — a single-node Redis lock with a token, Lua release and a 10 min TTL (or 2 min + renewal) removes >99.9% of the waste. If the report sent invoices instead, it would need consensus + fencing or idempotency.',
  },

  comparison: {
    caption: 'Distributed lock options',
    columns: ['Option', 'Safety under pauses/failover', 'Fencing token', 'Latency', 'Use for'],
    rows: [
      ['Redis SET NX PX (single)', 'No — TTL and failover leaks', 'No', '~0.5 ms', 'Efficiency locks'],
      ['Redlock (5 masters)', 'Timing-dependent', 'No (token is random)', '~1–2 ms', 'Rarely justified'],
      ['Redisson RLock + watchdog', 'Better for slow holders; not pauses/failover', '`RFencedLock` counter, no consensus', '~0.5 ms', 'Efficiency, JVM shops'],
      ['etcd lease / ZooKeeper ephemeral', 'Yes (consensus)', 'Revision / zxid', '~2–10 ms', 'Leader election, correctness'],
      ['DB row lock / advisory lock', 'Yes within that DB', 'Implicit (same DB transaction)', 'DB RTT', 'Work on data in the same DB'],
    ],
  },

  whenNot: [
    'Leader election for anything that writes money, inventory or replicated state — use etcd/ZooKeeper leases with fencing tokens.',
    'Protecting data in a single database — use row locks, `SELECT … FOR UPDATE`, advisory locks or conditional updates in that database.',
    'Long-running exclusive jobs — use a queue with visibility timeouts or a workflow engine with leases.',
    'When idempotency is possible — idempotency keys plus unique constraints remove the need for mutual exclusion entirely.',
  ],

  interview: [
    {
      q: 'Is a Redis SET NX lock safe for leader election?',
      a: 'Not for correctness. A holder can pause past the TTL (GC, VM freeze) while another acquires the lock, and a primary failover can lose a just-acquired lock due to async replication. The holder cannot detect either reliably, and the lock provides no fencing token for the resource to reject stale writers. For leader election use a consensus store with leases and the revision/zxid as a fencing token, and make side effects idempotent.',
      followUps: ['What exactly is a fencing token?', 'Would Redlock fix this?', 'When is a Redis lock fine?'],
      seniorSignal: 'Separates efficiency from correctness locks and places the safety check at the resource.',
    },
    {
      q: 'Explain Redlock and the main criticism of it.',
      a: 'Acquire the same key with the same token on a majority of N independent masters within a short time, treating the lock as valid for TTL minus elapsed time minus drift. The critique (Kleppmann, 2016): safety depends on bounded pauses, network delay and clock drift, which real systems violate; and it produces no monotonic fencing token, so a paused client can still corrupt the resource. antirez argued the timing assumptions are reasonable with monotonic clocks, but the pause-after-check problem remains.',
      followUps: ['Why does a node restart matter for Redlock?', 'What does clock drift do to the validity time?', 'Could you add a fencing token to Redlock?'],
      seniorSignal: 'Can present both sides and conclude with when each approach is acceptable.',
    },
    {
      q: 'Why does lock release need a Lua script?',
      a: 'Release must delete the key only if it still holds my token; a GET then DEL from the client is two operations, and between them the lock can expire and be acquired by someone else, so I would delete their lock. Lua scripts execute atomically in Redis, making compare-and-delete one operation. The same applies to extending the TTL.',
      followUps: ['What happens if release returns 0?', 'Why was SETNX + EXPIRE replaced?', 'How would you do this with Redis Functions?'],
      seniorSignal: 'Treats a failed release as an overlap signal to monitor, not just a no-op.',
    },
    {
      q: 'How do you protect a long-running job with a lock?',
      a: 'Prefer not to: break it into short idempotent steps with checkpoints, or run it via a queue with visibility timeouts or a workflow engine with leases. If using a lock, keep a short TTL with renewal, check validity before each side effect, and stop if renewal fails. Remember that renewal threads pause with the process, so correctness still needs fencing at the resource.',
      followUps: ['How does Redisson’s watchdog work?', 'What happens to a deadlocked thread holding a watchdog lock?', 'How do SQS visibility timeouts compare?'],
      seniorSignal: 'Reframes the problem as leases/checkpoints rather than longer locks.',
    },
    {
      q: 'Give an example where a Redis lock is the right choice.',
      a: 'Cache stampede protection: when a hot key expires, the first request takes a short lock and recomputes while others serve stale data or wait briefly; if the lock fails and two recompute, it is just extra load. Similarly, deduplicating an hourly idempotent report across replicas. In both, an occasional double execution is harmless and the speed and simplicity of Redis win.',
      followUps: ['What TTL would you choose for a stampede lock?', 'How do you serve stale data during recompute?', 'What changes if the job sends emails?'],
      seniorSignal: 'Justifies the choice by the cost of the failure mode, not by convenience.',
    },
  ],

  takeaways: [
    'Redis locks are efficiency locks: great at avoiding duplicate work, unsafe for correctness.',
    'Acquire with `SET NX PX` + unique token; release and extend with Lua compare-and-delete.',
    'Pauses past TTL and async-replication failover both allow two holders.',
    'Redlock adds availability but relies on timing and provides no fencing token.',
    'Correctness needs consensus plus a fencing token checked by the resource — or idempotency.',
    'Renewal watchdogs narrow the window but pause with the process.',
  ],
};

export default deep;
