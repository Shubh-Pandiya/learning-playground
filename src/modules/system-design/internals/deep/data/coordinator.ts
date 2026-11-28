import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'coordinator',

  problem: {
    why:
      'Some decisions must be made **exactly once across a cluster** even when machines crash, pause and get partitioned: who is the leader, who owns shard 17, what the current config is. Doing that correctly requires consensus — a majority of replicas agreeing on one ordered log of decisions. Rather than embed Paxos/Raft in every system, you run a small, dedicated consensus store (etcd, ZooKeeper, Consul) and build election, leases, membership and locks on top of it.',
    withoutIt: [
      'Split brain: two schedulers both think they are leader and both run the billing job, or two DB primaries accept writes.',
      'Hand-rolled heartbeats + timeouts misjudge a paused or partitioned node as dead while it is still acting.',
      'Config changes reach nodes in different orders, so nodes act on inconsistent views of membership or shard ownership.',
      'Locks on a cache (Redis) silently vanish on failover, so “exclusive” work runs twice.',
    ],
    position:
      'Off the request path, in the control plane: services, schedulers, databases (Patroni, Kafka, HBase) and Kubernetes itself talk to it to elect leaders, hold leases, watch for changes and store small critical metadata.',
    diagram: {
      type: 'flow',
      title: 'Control plane, not data plane',
      nodes: [
        { label: 'Schedulers ×3', sub: 'campaign for leader', tone: 'neutral' },
        { label: 'etcd / ZK', sub: '3–5 voters, Raft/ZAB', tone: 'accent' },
        { label: 'Leader', sub: 'holds lease + token', tone: 'ok' },
        { label: 'Storage', sub: 'checks fencing token', tone: 'violet' },
      ],
      caption: 'The store decides who leads; the resource enforces it with the token.',
    },
  },

  architecture: {
    overview:
      'A consensus store is a **replicated state machine**: clients send commands to the leader, which appends them to a log, replicates the log to followers, and commits each entry once a majority has persisted it. Every member applies committed entries in the same order to an identical key-value state (etcd: bbolt B+tree with MVCC revisions; ZooKeeper: in-memory znode tree with snapshots). Leases/sessions, watches and compare-and-swap transactions turn that ordered KV into coordination primitives.',
    diagram: {
      type: 'flow',
      title: 'Write path in a Raft store (etcd)',
      nodes: [
        { label: 'Client gRPC', sub: 'Txn / Put / LeaseGrant', tone: 'neutral' },
        { label: 'Leader', sub: 'append to WAL, fsync', tone: 'accent' },
        { label: 'AppendEntries', sub: 'to all followers', tone: 'info' },
        { label: 'Majority ack', sub: 'commit index advances', tone: 'ok' },
        { label: 'Apply to bbolt', sub: 'new MVCC revision', tone: 'violet' },
        { label: 'Watchers notified', sub: 'stream from revision', tone: 'info' },
      ],
    },
    blocks: [
      { name: 'Raft / ZAB core', what: 'Leader election with terms (ZAB: epochs), log replication, commit index. Raft guarantees Election Safety (≤1 leader per term) and Leader Completeness (a new leader has every committed entry).' },
      { name: 'Write-ahead log + snapshots', what: 'Every entry is fsynced to the WAL before ack; periodic snapshots (etcd `--snapshot-count`, default 100,000 entries in v3.2+) truncate the log and bootstrap lagging followers.' },
      { name: 'MVCC key-value store', what: 'etcd keeps every revision of a key in bbolt until **compaction**; the cluster-wide revision is a strictly increasing 64-bit counter, ideal as a fencing token. ZooKeeper’s equivalent is the `zxid` (epoch + counter).' },
      { name: 'Leases / sessions', what: 'etcd: a lease with TTL, kept alive by the client; keys attached to it are deleted on expiry. ZooKeeper: a session with a negotiated timeout; **ephemeral znodes** vanish when it expires. Basis of liveness detection.' },
      { name: 'Watches', what: 'etcd: gRPC streams from a given revision, never missing events unless that revision was compacted. ZooKeeper: one-shot watches re-armed by the client (plus persistent recursive watches since 3.6).' },
      { name: 'Transactions / CAS', what: 'etcd `Txn(If(compare...).Then(ops).Else(ops))` — atomic compare-and-swap on versions/revisions; ZooKeeper conditional `setData(path, data, version)` and `multi`. Elections and locks are built from these.' },
      { name: 'Quota and compaction', what: 'etcd `--quota-backend-bytes` (2 GB default, ≤ 8 GB recommended); when exceeded, a `NOSPACE` alarm makes the cluster reject writes until compaction + defrag + alarm disarm.' },
    ],
    real: [
      { name: 'etcd', how: 'Go, Raft (etcd-io/raft library), bbolt + MVCC, gRPC API with Txn, leases and watches. Backs every Kubernetes cluster; the kube-apiserver is its only client and compacts history every 5 minutes by default.' },
      { name: 'Apache ZooKeeper', how: 'Java, ZAB atomic broadcast; hierarchical znodes (≤ ~1 MB each, `jute.maxbuffer`), ephemeral and sequential nodes, watches. Curator provides election/lock recipes. Used by HBase, Solr, older Kafka (replaced by KRaft in Kafka 4.0).' },
      { name: 'HashiCorp Consul', how: 'Raft among 3–5 server agents for the catalog and KV; sessions tied to node health checks implement locks (`consul lock`); gossip (Serf) for membership among client agents.' },
      { name: 'Google Chubby', how: 'Paxos-replicated lock service (5 replicas per cell) for coarse-grained locks; introduced **sequencers** (fencing tokens) and lock-delay. Its 2006 paper inspired ZooKeeper and etcd.' },
      { name: 'Embedded Raft (KRaft, CockroachDB, Consul)', how: 'Many systems now embed Raft directly: Kafka KRaft controllers hold metadata in a Raft log; CockroachDB runs a Raft group per range. Same algorithm, no external coordinator.' },
    ],
  },

  lifecycle: {
    summary:
      'An etcd `Txn` that campaigns for leadership in a 3-node, single-region cluster on NVMe: ~3–5 ms end to end, dominated by one network round trip to followers and two fsyncs (leader and the fastest follower in parallel).',
    stages: [
      { stage: 'Client → member', what: 'gRPC request on an existing HTTP/2 connection to any member.', cost: '~0.3 ms RTT', ms: 0.3 },
      { stage: 'Forward to leader', what: 'If the member is a follower it forwards the proposal to the leader.', cost: '0–1 RTT', ms: 0.4 },
      { stage: 'Leader WAL append', what: 'Entry (term 7, index 18,402) appended and fsynced to the leader’s WAL.', cost: 'fsync ~0.5–2 ms (NVMe)', ms: 1 },
      { stage: 'Replicate to followers', what: '`AppendEntries` to both followers in parallel; each checks prevLogIndex/term, appends, fsyncs, acks.', cost: '1 RTT + follower fsync', ms: 1.5 },
      { stage: 'Commit', what: 'Leader + 1 follower = majority; commit index advances; entry is durable.', cost: 'In memory', ms: 0.05 },
      { stage: 'Apply', what: 'Txn compare evaluated, key written in bbolt at revision 9,001; lease attached.', cost: 'bbolt batch commit', ms: 0.3 },
      { stage: 'Respond', what: 'Client learns it won, with revision 9,001 = its fencing token.', cost: '~0.3 ms', ms: 0.3 },
      { stage: 'Watch fan-out', what: 'Other candidates watching the election prefix receive the event.', cost: 'Stream push', ms: 0.5 },
    ],
  },

  deepDives: [
    {
      title: 'Raft leader election: terms and randomized timeouts',
      hook: 'Randomized timeouts make split votes rare; the up-to-date-log rule makes elections safe.',
      body: [
        'Every node is follower, candidate or leader. A follower that hears no heartbeat within its **election timeout** becomes a candidate: it increments the **term**, votes for itself and sends `RequestVote`. Each node grants at most one vote per term, and only to a candidate whose log is at least as up to date (higher last term, or same term and ≥ index). A majority makes it leader; any message with a higher term makes a leader step down.',
        'Timeouts are randomized (the Raft paper suggests 150–300 ms) so one node usually times out first and wins before others start. etcd defaults are `--heartbeat-interval=100ms` and `--election-timeout=1000ms`, guidance being heartbeat ≈ RTT and election timeout ≈ 10× heartbeat.',
        '**PreVote** (a candidate first asks “would you vote for me?” without bumping the term) and **CheckQuorum** (a leader steps down if it cannot hear a majority) prevent a flaky, partitioned node from repeatedly forcing elections when it rejoins.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Leader A dies; B times out first',
        actors: ['A (old leader)', 'B', 'C'],
        messages: [
          { from: 'A (old leader)', to: 'B', label: 'heartbeat term 6' },
          { from: 'A (old leader)', to: 'C', label: 'heartbeat term 6' },
          { from: 'B', to: 'C', label: 'RequestVote term 7', tone: 'accent' },
          { from: 'C', to: 'B', label: 'vote granted (log ok)', dashed: true, tone: 'ok' },
          { from: 'B', to: 'C', label: 'AppendEntries term 7' },
          { from: 'A (old leader)', to: 'B', label: 'late msg term 6 → rejected', tone: 'bad' },
        ],
        caption: 'B wins with 2 of 3 votes; A steps down when it sees term 7.',
      },
      insight:
        'Most production “election storms” are not network failures but slow disks or CPU starvation: a leader whose fsync or GC stalls longer than the election timeout looks dead. Tune timeouts to measured RTT and disk latency, and keep etcd off noisy shared hosts.',
    },
    {
      title: 'Log replication and the commit index',
      hook: 'An entry is committed only when a majority stores it — and only current-term entries are committed by counting.',
      body: [
        'The leader appends client commands to its log and sends `AppendEntries(prevLogIndex, prevLogTerm, entries, leaderCommit)`. A follower rejects if its entry at prevLogIndex has a different term; the leader backs up and resends until logs match (**Log Matching**: same index and term ⇒ identical prefix).',
        'When an entry from the **current term** is stored on a majority, the leader advances `commitIndex`, which commits all earlier entries too, and followers learn it via `leaderCommit`. The paper’s Figure 8 shows why a leader must not commit an old-term entry just because it is now on a majority — it could still be overwritten by a later leader.',
        'Throughput comes from **pipelining and batching**: many proposals share one fsync and one AppendEntries. A single client doing serial writes is bounded by RTT + fsync (hundreds per second); many concurrent clients reach tens of thousands.',
      ],
      table: {
        columns: ['Raft property', 'Guarantee', 'Mechanism'],
        rows: [
          ['Election Safety', '≤ 1 leader per term', 'One vote per node per term, majority needed'],
          ['Log Matching', 'Same (index, term) ⇒ same prefix', 'prevLogIndex/term consistency check'],
          ['Leader Completeness', 'New leader has all committed entries', 'Vote only for up-to-date logs + majority overlap'],
          ['State Machine Safety', 'All nodes apply same entries in order', 'Apply only committed entries, by index'],
        ],
      },
      insight:
        'Committed ≠ applied ≠ visible to your read. A read served from a follower’s local state can lag the commit index; that is why linearizable reads need ReadIndex or a leader lease (next section).',
    },
    {
      title: 'Quorum math and placement',
      hook: '2f + 1 nodes tolerate f failures — and where you put them matters more than how many.',
      body: [
        'Quorum is ⌊n/2⌋ + 1. Any two quorums intersect, which is what carries committed state across leader changes. 3 nodes tolerate 1 failure, 5 tolerate 2; even sizes add cost and latency without adding tolerance (4 still tolerates only 1). Larger clusters (7+) slow every write because more acks are needed and the leader does more work.',
        'Placement: 3 voters in 3 AZs survive an AZ loss. Two regions can never survive the loss of the region holding the majority — you need a third site (even a tiny tie-breaker). Cross-region quorums make every write cost at least the RTT to the nearest majority (e.g. 30–70 ms), which is fine for leader elections and terrible for anything chatty.',
      ],
      table: {
        columns: ['Voters', 'Quorum', 'Failures tolerated', 'Note'],
        rows: [
          ['1', '1', '0', 'Dev only'],
          ['2', '2', '0', 'Worse than 1: either failure blocks writes'],
          ['3', '2', '1', 'Default; 1 per AZ'],
          ['4', '3', '1', 'Same tolerance as 3, slower'],
          ['5', '3', '2', 'Critical control planes; survives maintenance + failure'],
        ],
      },
      insight:
        'Non-voting members (ZooKeeper observers, etcd learners) scale reads and stage new members without changing quorum size — add a member as a learner first, then promote, to avoid a window where a slow catch-up blocks quorum.',
    },
    {
      title: 'Linearizable reads: ReadIndex, leases and sync',
      hook: 'Reading from “the leader” is not enough — a deposed leader may not know it yet.',
      body: [
        'A leader partitioned from the majority can keep serving reads until it notices; a new leader may already have committed newer writes. **ReadIndex** (etcd’s default linearizable read): the leader records its commit index, confirms it is still leader with a heartbeat round to a majority, waits until it has applied up to that index, then serves the read. Cost: one round trip, no log write.',
        '**Lease reads** skip the round trip by assuming no new leader can be elected within the lease period — correct only if clock drift is bounded. **Serializable reads** in etcd (`--consistency=s`) are served from any member’s local state and may be stale. ZooKeeper reads are served locally by default (sequentially consistent per client, possibly stale); call `sync()` before a read to catch up with the leader.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'ReadIndex (etcd default)', tone: 'ok', points: ['Leader confirms majority', '+1 RTT, no fsync', 'Linearizable', 'No clock assumption'] },
          { name: 'Lease read', tone: 'warn', points: ['No extra RTT', 'Relies on bounded drift', 'Linearizable if clocks sane'] },
          { name: 'Local / serializable', tone: 'info', points: ['Any member serves', 'Can be stale', 'ZK default; etcd opt-in'] },
        ],
      },
      insight:
        'Lock or leader checks must use linearizable reads; caches and dashboards can use serializable ones. Mixing them up is how a client “sees” it still owns a key that was reassigned 2 s ago.',
    },
    {
      title: 'Leader election recipes: ZooKeeper and etcd',
      hook: 'Watch your predecessor, not the leader — or every change wakes the whole herd.',
      body: [
        'ZooKeeper recipe: each candidate creates an **ephemeral sequential** znode `/election/n_0000000042`. The lowest sequence number is leader. Each other candidate watches only the znode immediately **before** its own; when that one disappears it re-checks whether it is now lowest. Watching the leader node instead makes every candidate wake on each change (herd effect). The ephemeral node disappears when the leader’s session expires.',
        'etcd recipe (`clientv3/concurrency`): create a session (a lease, default TTL 60 s, kept alive by the client), then `Campaign` puts a key under the election prefix with that lease and waits until its key has the lowest **create revision** — again watching only the predecessor. `Resign` deletes the key; lease expiry deletes it automatically.',
      ],
      code: {
        lang: 'go',
        caption: 'etcd election with the leader key revision as fencing token',
        code: `cli, _ := clientv3.New(clientv3.Config{Endpoints: eps})
sess, _ := concurrency.NewSession(cli, concurrency.WithTTL(10))
defer sess.Close()

e := concurrency.NewElection(sess, "/scheduler/leader")
if err := e.Campaign(ctx, hostname); err != nil { return err }

token := e.Rev()                 // create revision of our key: monotonic
for {
    select {
    case <-sess.Done():          // lease lost: stop acting immediately
        return errors.New("lost leadership")
    case job := <-jobs:
        storage.Write(job, token) // storage rejects token < highest seen
    }
}`,
      },
      insight:
        'Session/lease timeout is a trade-off you must reason about: ZooKeeper negotiates between 2× and 20× `tickTime` (4–40 s at the default 2 s tick). Short timeouts fail over fast but turn GC pauses into false failovers; long ones leave you leaderless for longer after a real crash.',
    },
    {
      title: 'Fencing tokens: making leases safe against pauses',
      hook: 'Consensus tells you who should lead; only the resource can stop the one who shouldn’t.',
      body: [
        'A lease expires on the server’s clock, but the holder learns that only when it next talks to the server. A holder that pauses (GC, VM migration, swap) or is partitioned can wake up and act after its lease has been granted to someone else. No client-side check closes this gap, because the pause can happen between the check and the write.',
        'The fix is a **fencing token**: a number that strictly increases with each grant (etcd revision, ZooKeeper zxid or sequence number, Chubby sequencer). The holder sends it with every write; the storage remembers the highest token seen and rejects lower ones. Martin Kleppmann’s 2016 analysis of distributed locking made this the standard answer.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Zombie leader is fenced off',
        actors: ['Old leader', 'etcd', 'New leader', 'Storage'],
        messages: [
          { from: 'etcd', to: 'Old leader', label: 'leader, token 33' },
          { from: 'Old leader', to: 'Old leader', label: 'GC pause 15 s', tone: 'warn' },
          { from: 'etcd', to: 'New leader', label: 'lease expired → token 34' },
          { from: 'New leader', to: 'Storage', label: 'write (token 34)', tone: 'ok' },
          { from: 'Old leader', to: 'Storage', label: 'write (token 33)' },
          { from: 'Storage', to: 'Old leader', label: 'reject: 33 < 34', dashed: true, tone: 'bad' },
        ],
      },
      insight:
        'Fencing only works if the resource participates: a conditional write (`UPDATE … WHERE epoch <= ?`), an object-store precondition, a Kafka producer epoch, or a DB that stores the token. If the downstream cannot check tokens, make the operation idempotent instead.',
    },
    {
      title: 'Operating it: what to store, watches, compaction',
      hook: 'A coordinator is for kilobytes of truth, not gigabytes of data.',
      body: [
        'Store small, critical, slowly changing metadata: leader keys, membership, shard maps, feature switches, service config. Payloads go elsewhere with a pointer in the store. Every write is replicated and fsynced on a majority, and the whole dataset is held in memory (ZooKeeper) or mmapped (etcd), so size and write rate hit every member.',
        'etcd keeps all revisions until compaction; big or frequently rewritten values grow the DB quickly. Compaction drops old revisions; **defrag** returns space to the filesystem (blocking per member, so do one at a time). Watches resuming from a compacted revision get `ErrCompacted` and must re-list — the reason Kubernetes informers do list-then-watch.',
      ],
      table: {
        columns: ['Limit / setting', 'etcd', 'ZooKeeper'],
        rows: [
          ['Max request / node size', '`--max-request-bytes` 1.5 MiB', '`jute.maxbuffer` ~1 MB'],
          ['Total data', '`--quota-backend-bytes` 2 GB default, ≤ 8 GB advised', 'Must fit in heap'],
          ['Leader timing', 'heartbeat 100 ms, election 1000 ms', '`tickTime` 2000 ms, `initLimit`, `syncLimit`'],
          ['History', 'MVCC revisions until compaction', 'Only current znode + txn log'],
          ['Disk health signal', '`etcd_disk_wal_fsync_duration_seconds` p99 < 10 ms', 'fsync warnings in logs, `fsync_threshold_exceed_count`'],
        ],
      },
      insight:
        'Watch fan-out is often the real cost, not writes: one membership change watched by 5,000 clients is 5,000 events. Put aggregators (or the Kubernetes watch cache pattern) between the coordinator and large fleets.',
    },
  ],

  scaling: {
    body: [
      'You do not scale a consensus group by adding voters — that slows writes. You scale by **reducing load** (store less, watch through caches, batch writes), adding non-voting members for reads (ZooKeeper observers, etcd learners/proxies), or **partitioning** into many independent groups (one etcd per Kubernetes cluster; CockroachDB/TiKV run thousands of Raft groups, one per range).',
      'It is the control plane of control planes: when it loses quorum, existing leaders keep their leases only until they expire, then nothing can be elected or reconfigured. Data planes built on top should keep serving on last-known state (Kubernetes pods keep running if etcd is down; you just cannot change anything).',
      'Multi-region: put the quorum where the writers are and accept slow failover elsewhere, or place 5 voters across 3 regions (2+2+1) to survive a region loss at the cost of ~1 cross-region RTT per write. Never stretch 2+1 across 2 regions and expect to survive losing the bigger one.',
    ],
    bullets: [
      'Dedicated SSD/NVMe for the WAL; alert on `etcd_disk_wal_fsync_duration_seconds` p99 > 10 ms and `etcd_disk_backend_commit_duration_seconds` p99 > 25 ms.',
      'Alert on `etcd_server_has_leader == 0`, rising `etcd_server_leader_changes_seen_total`, `etcd_mvcc_db_total_size_in_bytes` vs quota.',
      'Regular snapshots (`etcdctl snapshot save`) shipped off-cluster; practice restore.',
      'Rolling member replacement one at a time; add as learner, then promote.',
      'Clients: retry with backoff on leader change, re-establish watches from last revision, handle `ErrCompacted`.',
      'Keep client count bounded; use gRPC proxies or watch caches for large fleets.',
    ],
    diagram: {
      type: 'compare',
      title: 'Voter placement across regions',
      columns: [
        { name: '2 regions (2+1)', tone: 'bad', points: ['Lose region with 2 ⇒ no quorum', 'Writes ~intra-region', 'Looks HA, is not'] },
        { name: '3 regions (2+2+1)', tone: 'ok', points: ['Survives any region loss', 'Writes pay ~1 cross-region RTT', 'Fine for elections, config'] },
        { name: 'One per region group', tone: 'info', points: ['Regional etcd per cluster', 'Local latency', 'No global agreement'] },
      ],
    },
  },

  failures: [
    {
      name: 'Loss of quorum',
      symptom: 'Writes, elections and lease grants hang; Kubernetes API read-only or unavailable; leaders keep running until leases expire, then nothing takes over.',
      detect: '`etcd_server_has_leader == 0`, member health checks failing, client errors `etcdserver: request timed out` / ZooKeeper `ConnectionLoss`.',
      mitigate: 'Odd-sized clusters across failure domains, no co-location with noisy workloads, tested snapshot restore and `--force-new-cluster` runbook for disaster recovery.',
    },
    {
      name: 'Slow disk → leader flapping',
      symptom: 'Frequent leader elections, latency spikes for all clients, kube-apiserver timeouts.',
      detect: '`etcd_server_leader_changes_seen_total` increasing, WAL fsync p99 > 10 ms, “apply request took too long” warnings.',
      mitigate: 'Dedicated NVMe, I/O priority (`ionice`), tune election timeout to measured latency, move off burstable or network disks.',
    },
    {
      name: 'Database size / NOSPACE',
      symptom: 'Cluster suddenly rejects all writes with `mvcc: database space exceeded`; Kubernetes cannot create or update objects.',
      detect: '`etcd_mvcc_db_total_size_in_bytes` approaching `etcd_server_quota_backend_bytes`; NOSPACE alarm in `etcdctl alarm list`.',
      mitigate: 'Find the large/churning keys, compact + defrag + `alarm disarm`; cap object sizes; move bulky data out; raise quota only up to ~8 GB.',
    },
    {
      name: 'Zombie leader without fencing',
      symptom: 'After a long GC pause or partition, the old leader writes after the new one took over: duplicate jobs, corrupted state.',
      detect: 'Overlapping “I am leader” log lines from two hosts; writes with stale epoch in audit logs; duplicate side effects.',
      mitigate: 'Fencing tokens checked by the resource; stop work on session loss (`sess.Done()`); idempotent operations.',
    },
    {
      name: 'Herd and watch storms',
      symptom: 'A leader change or big list causes thousands of clients to re-read/re-watch at once; coordinator CPU and memory spike.',
      detect: 'Watch count (`etcd_debugging_mvcc_watcher_total`), request rate spikes after events, client reconnect bursts.',
      mitigate: 'Watch predecessor (not leader), jittered reconnects, watch caches/aggregators, avoid full re-lists.',
    },
  ],

  warStories: [
    {
      title: 'Cloudflare: a partially failed switch vs etcd and Patroni',
      source: 'Cloudflare blog “A Byzantine failure in the real world”, November 2020',
      what:
        'A network switch failed partially, so some etcd nodes could reach each other and others could not. The etcd cluster kept losing and re-electing its leader; Patroni, which uses etcd to decide Postgres primaries, could not hold leadership, and the main database cluster went read-only/failed over. Cloudflare’s API and dashboard were degraded for several hours.',
      lesson: 'Partial (non-clean) network failures are the hard case for consensus-driven failover. Make automatic failover conservative and make the data plane tolerate a leaderless control plane.',
    },
    {
      title: 'GitHub: 43 seconds of partition, 24 hours of degradation',
      source: 'GitHub blog, October 2018 incident analysis',
      what:
        'A 43-second loss of connectivity between the US East network hub and the primary data center led Orchestrator (Raft-based MySQL topology manager) to promote West Coast replicas to primary. When connectivity returned, East had writes not present in West, and apps now crossed the country for every write. Restoring consistency took about 24 hours.',
      lesson: 'Consensus did exactly what it was configured to do. Failover policy must encode application topology (latency, data locality), not just “a majority agrees the primary is gone”.',
    },
    {
      title: 'Kubernetes etcd full of events and giant objects',
      source: 'Composite of common incidents',
      what:
        'A controller wrote large status objects and a noisy workload generated millions of Events. etcd’s DB grew past its 2 GB default quota, the NOSPACE alarm fired and the API server rejected every write: no deploys, no scaling, no pod rescheduling, while running pods kept serving.',
      lesson: 'Treat the coordinator as a scarce shared resource: object size limits, event TTLs, separate etcd for events, alerting on DB size well before quota.',
    },
  ],

  numbers: [
    { label: 'Fault tolerance', value: '2f + 1 nodes ⇒ f failures', note: '3 → 1, 5 → 2' },
    { label: 'etcd write latency (1 region)', value: '~2–10 ms', note: 'RTT + fsync on a majority' },
    { label: 'etcd throughput', value: '~10k–50k writes/s', note: 'with many concurrent clients; serial client: hundreds/s' },
    { label: 'etcd timing defaults', value: '100 ms / 1000 ms', note: 'heartbeat / election timeout' },
    { label: 'etcd backend quota', value: '2 GB default, ≤ 8 GB', note: '`--quota-backend-bytes`' },
    { label: 'etcd max request', value: '1.5 MiB', note: '`--max-request-bytes`' },
    { label: 'WAL fsync health', value: 'p99 < 10 ms', note: '`etcd_disk_wal_fsync_duration_seconds`' },
    { label: 'ZooKeeper session timeout', value: '4–40 s', note: '2–20 × `tickTime` (2 s default)' },
    { label: 'ZooKeeper znode size limit', value: '~1 MB', note: '`jute.maxbuffer`' },
    { label: 'Cross-region quorum write', value: '+30–150 ms', note: 'RTT to nearest majority' },
  ],

  capacity: {
    question:
      'A fleet of 3,000 workers uses etcd for membership (one key per worker on a 15 s lease) and leader election for 500 shards. Deploys restart the fleet over 10 minutes. Is one 3-node etcd enough?',
    steps: [
      'Lease keepalives: 3,000 workers renewing every ~5 s (TTL/3) ⇒ ~600 keepalives/s. etcd serves renewals at the leader without a Raft write (with periodic lease checkpoints), so this is cheap.',
      'Writes during deploy: 3,000 restarts / 600 s ≈ 5 deletes + 5 creates/s for membership, plus a few shard re-elections ⇒ ~20 writes/s — trivial vs ~10k+/s capacity.',
      'Data: 3,500 keys × ~200 B ≈ 0.7 MB — far below the 2 GB quota.',
      'Watch fan-out: if all 3,000 workers watch `/members/`, each change sends 3,000 events ⇒ 10 changes/s × 3,000 = 30,000 events/s during deploys — the real hotspot.',
      'Fix: workers watch only their shard keys; a few routers watch `/members/` and serve a cached view.',
    ],
    answer:
      'One 3-node etcd on NVMe is ample for writes and data; the design risk is watch fan-out, solved by narrow watches and an aggregation layer — not by adding voters.',
  },

  comparison: {
    caption: 'Coordination services',
    columns: ['Product', 'Protocol', 'Data model', 'Default reads', 'Liveness primitive', 'Typical users'],
    rows: [
      ['etcd', 'Raft', 'Flat KV + MVCC revisions', 'Linearizable (ReadIndex)', 'Lease (TTL, keepalive)', 'Kubernetes, CoreDNS, Patroni'],
      ['ZooKeeper', 'ZAB', 'Znode tree, ephemeral/sequential', 'Local, possibly stale (`sync` first)', 'Session + ephemeral znodes', 'HBase, Solr, legacy Kafka'],
      ['Consul', 'Raft (servers) + gossip', 'KV + service catalog', 'Default mode via leader; `stale` option', 'Session tied to health checks', 'HashiCorp stack, discovery'],
      ['Chubby', 'Paxos', 'Small files + locks', 'Cached at client with invalidation', 'Session lease + sequencers', 'Google (GFS/Bigtable masters)'],
      ['Redis lock (contrast)', 'None (async replication)', 'Single key with TTL', 'From primary', 'Key TTL only', 'Efficiency locks only'],
    ],
  },

  whenNot: [
    'Storing application data, large blobs or high-rate counters — use a database or Redis; the coordinator holds pointers and small metadata.',
    'When one database already owns the resource: a row lock, `SELECT … FOR UPDATE` or conditional update in that DB is simpler and naturally fenced.',
    'Service discovery for huge fleets where eventual consistency is fine — use DNS/xDS caches fed from it, not direct client watches.',
    'Low-latency writes from multiple regions — consensus across regions costs a cross-region RTT per write; partition ownership per region instead.',
    'Efficiency-only dedupe where an occasional double run is harmless — a Redis lock is cheaper to operate.',
  ],

  interview: [
    {
      q: 'Explain how Raft elects a leader and why there cannot be two leaders in the same term.',
      a: 'Followers start an election when they miss heartbeats for a randomized timeout: they bump the term, vote for themselves and request votes. Each node votes once per term and only for candidates whose log is at least as up to date as its own; a majority wins. Since any two majorities intersect and each node votes once per term, two candidates cannot both get a majority in the same term. A stale leader with a lower term steps down as soon as it sees a higher term.',
      followUps: ['Why randomized timeouts?', 'What do PreVote and CheckQuorum fix?', 'Can there be two nodes that believe they are leader at the same wall-clock time?'],
      seniorSignal: 'Distinguishes “one leader per term” from “one node acting as leader at a time” and explains why the latter needs fencing.',
    },
    {
      q: 'Design leader election for a cron scheduler with 3 replicas.',
      a: 'Use etcd or ZooKeeper: each replica campaigns with a lease-backed key (etcd) or ephemeral sequential znode (ZK), watching its predecessor. The winner gets a monotonically increasing token (create revision / zxid), passes it with every side-effecting write, and stops work immediately when its session reports loss. Downstream writes are conditional on the token or idempotent. Lease TTL ~10–15 s balances failover time against false failovers from GC pauses.',
      followUps: ['What if the downstream system cannot check tokens?', 'How do you pick the lease TTL?', 'Why not just use Redis SET NX?'],
      seniorSignal: 'Includes fencing at the resource and session-loss handling, not just “whoever holds the key is leader”.',
    },
    {
      q: 'Are reads from etcd/ZooKeeper always up to date?',
      a: 'No. etcd linearizable reads (the default) use ReadIndex: the leader confirms with a majority it is still leader, then serves the read after applying up to that commit index. Serializable reads come from local state and may be stale. ZooKeeper serves reads locally from whichever server the client is connected to, so they can lag; `sync()` before a read forces catch-up. Lease-based reads avoid the extra round trip but rely on bounded clock drift.',
      followUps: ['Why is reading from the leader not automatically linearizable?', 'What does ReadIndex cost?', 'Which reads in your design need linearizability?'],
      seniorSignal: 'Knows the deposed-leader problem and matches read consistency to the use case.',
    },
    {
      q: 'Why 3 or 5 nodes, and how would you deploy across regions?',
      a: 'Quorum is ⌊n/2⌋+1, so 2f+1 nodes tolerate f failures; even sizes add latency without tolerance. Three nodes in three AZs survive an AZ loss. Across regions, two regions cannot survive losing the majority side — use three sites (e.g. 2+2+1) and accept one cross-region RTT per write, which is fine for elections and config but not for chatty workloads. Often better: a regional coordinator per region and partition ownership by region.',
      followUps: ['What happens to write latency with 5 nodes in 3 regions?', 'What are learners/observers for?', 'How do you replace a failed member safely?'],
      seniorSignal: 'Reasons about placement and latency, not just node count.',
    },
    {
      q: 'What would you store in etcd, and what would you refuse to?',
      a: 'Small, critical, low-churn metadata: leader keys, membership, shard maps, config and switches. Not payloads, logs, events at high rate or anything that grows with users: every write is fsynced on a majority, history accumulates until compaction, and etcd has a 1.5 MiB request limit and a 2 GB default (≤8 GB advised) quota. Exceeding the quota triggers NOSPACE and the cluster rejects writes — for Kubernetes, that freezes the control plane.',
      followUps: ['How do compaction and defrag work?', 'How do watches behave after compaction?', 'How would you shrink a bloated etcd?'],
      seniorSignal: 'Knows concrete limits and the operational consequence (NOSPACE alarm) of misuse.',
    },
    {
      q: 'A process holds a lock in ZooKeeper and pauses for 30 s. What happens and how do you make it safe?',
      a: 'Its session times out, the ephemeral znode is deleted and another process acquires the lock. The paused process does not know yet; when it wakes, it may continue writing as if it held the lock. Client-side checks cannot close the window because the pause can occur between check and write. The resource must reject stale holders using a fencing token such as the lock znode’s zxid or sequence number, or the operation must be idempotent/conditional.',
      followUps: ['Which number would you use as the token in ZooKeeper?', 'How would S3 or Postgres enforce it?', 'How does Kafka’s producer epoch relate?'],
      seniorSignal: 'Places the safety check at the resource and names concrete token sources.',
    },
  ],

  takeaways: [
    'Consensus gives one ordered log agreed by a majority; coordination primitives are built on that log.',
    '2f+1 voters tolerate f failures; placement across failure domains matters more than count.',
    'Linearizable reads need ReadIndex or leases; ZooKeeper and serializable etcd reads can be stale.',
    'Elections: lease/ephemeral key + watch predecessor + stop on session loss.',
    'Fencing tokens checked by the resource are what make leader election safe against pauses.',
    'Store kilobytes of truth, not data: etcd limits are 1.5 MiB per request and ~8 GB total.',
    'Disk fsync latency and watch fan-out, not CPU, are the usual operational bottlenecks.',
  ],
};

export default deep;
