/**
 * SDE-3 depth for the original nine dives: defaults and magnitudes, tradeoff tables, real-world
 * incident patterns and interview questions with follow-up probes and the senior signal.
 * Merged into DIVES by internals.ts.
 */
import type { DeepExtra } from './internals';

export const DEEP: Record<string, DeepExtra> = {
  fast: {
    base: [{ probes: ['Which of these breaks when TLS is on?', 'What makes Kafka slow, then?'], senior: 'Ranks the factors (batching and the page cache matter most) and names the conditions that cancel them: TLS, tiny batches, lagging readers.' }],
    numbers: [
      { k: 'Sequential vs random disk', v: '~100s MB/s vs ~100s IOPS (HDD)', why: 'Why append-only logs work even on spinning disks.' },
      { k: 'Broker heap', v: '~6 GB typical', why: 'The rest of RAM is the page cache.' },
      { k: 'Network fan-out', v: 'in × (RF−1) + out × groups', why: 'NICs, not disks, usually saturate first.' },
      { k: 'Per-broker throughput', v: '100s of MB/s', why: 'With batching and compression on commodity hardware.' },
      { k: 'LinkedIn (2019)', v: '7 trillion msgs/day', why: 'Scale ceiling is partitions and operations, not the design.' },
    ],
    tradeoffs: [
      {
        title: 'Design choices behind the speed',
        cols: ['Choice', 'Gain', 'Price'],
        rows: [
          ['No per-message fsync', 'write at memory speed', 'durability depends on replication'],
          ['Pull-based consumers', 'batching, consumer-paced, replay', 'long-poll needed for latency'],
          ['On-disk format = wire format', 'zero-copy sendfile', 'TLS and down-conversion bypass it'],
          ['No per-message acks', 'O(1) broker state per consumer', 'no selective redelivery'],
          ['Page cache instead of heap cache', 'no GC, survives broker restarts', 'shared with every reader'],
        ],
      },
    ],
    incidents: [
      { title: 'TLS rollout doubled broker CPU', symptom: 'After enabling TLS, broker CPU went from 30% to 70% and produce latency rose.', cause: 'Encrypted traffic can’t use sendfile, so every byte is copied through the JVM to be encrypted.', fix: 'Capacity-plan for TLS (more brokers or bigger CPUs), use a modern JDK with AES-NI, and consider kTLS.', lesson: 'Zero-copy is a property of plaintext paths.' },
      { title: 'A bigger heap made things slower', symptom: 'Consumer fetch latency and disk reads jumped after a "performance" change.', cause: 'Broker heap was raised from 6 GB to 32 GB, shrinking the page cache, so tail reads went to disk.', fix: 'Keep the heap modest and leave RAM to the OS. Watch the disk-read to network-out ratio.', lesson: 'In Kafka, free memory is the cache.' },
    ],
    interview: [
      { q: 'Kafka doesn’t fsync every message. How is it durable?', a: 'Durability comes from replication, not fsync: with acks=all and min.insync.replicas=2 an acknowledged record is in the page cache of at least two brokers, ideally in different racks or AZs. Losing it requires simultaneous failure of all those machines before the OS flushes. You can force flush.messages/flush.ms, but that kills throughput.', probes: ['What failure would still lose data?', 'How does Redpanda differ?'], senior: 'Names the correlated failure (a whole-cluster power loss) and its mitigation (rack/AZ spread). Notes that Redpanda fsyncs by default.' },
      { q: 'Why do Kafka consumers pull rather than have the broker push?', a: 'Pull lets each consumer go at its own pace (natural back-pressure), lets the broker stay simple (no per-consumer delivery state), batches large fetches efficiently and allows replay. Long-poll (fetch.max.wait.ms, fetch.min.bytes) removes the busy-polling cost.', probes: ['What does push buy RabbitMQ?'], senior: 'Contrasts with push brokers’ prefetch tuning and per-message ack bookkeeping, and states when push wins (low-latency task dispatch).' },
      { q: 'When does Kafka stop being fast?', a: 'Tiny batches (linger 0 with low per-partition rate), very many partitions per broker (metadata, open files, replication overhead), TLS or format down-conversion (no zero-copy), lagging consumers evicting the page cache, cross-AZ bandwidth limits, and synchronous send-and-wait call patterns.', probes: ['How would you detect each?'], senior: 'Maps each cause to a metric: batch-size-avg, under-replicated partitions, disk read bytes, request queue time.' },
      { q: 'How do you capacity-plan a Kafka cluster?', a: 'Start from peak ingest MB/s and consumer fan-out. Network in = ingest × RF (leader plus replication). Network out = ingest × (RF−1 + number of consumer groups). Disk = ingest × retention × RF. Size so each broker stays below ~60–70% of NIC, disk and CPU at peak, with room for one broker failure. Validate with kafka-producer-perf-test and consumer-perf-test.', probes: ['What changes with 10 consumer groups?'], senior: 'Identifies network fan-out as the usual bottleneck, plans for N−1, and runs a real benchmark before committing.' },
    ],
  },

  log: {
    base: [{ probes: ['How do you find the offset for "9:00 yesterday"?', 'Why is the index sparse rather than dense?'], senior: 'Mentions the .timeindex and offsetsForTimes, and explains the sparse index as a memory-versus-scan tradeoff (one entry per 4 KB).' }],
    numbers: [
      { k: 'segment.bytes', v: '1 GB', why: 'Unit of deletion, compaction and tiering.' },
      { k: 'index.interval.bytes', v: '4 KB', why: 'One index entry per ~4 KB, so a scan is at most a few KB.' },
      { k: 'segment.index.bytes', v: '10 MB', why: 'Pre-allocated, mmap’d index size.' },
      { k: 'Files per segment', v: '.log .index .timeindex (+ .txnindex)', why: 'Open files and mmaps scale with partitions × segments.' },
      { k: 'vm.max_map_count', v: '65,530 (Linux default)', why: 'Each index is mmap’d; huge partition counts can exceed it.' },
    ],
    tradeoffs: [
      {
        title: 'Index design',
        cols: ['Option', 'Memory', 'Lookup', 'Kafka’s choice'],
        rows: [
          ['Dense index (every record)', 'high', 'O(log n), no scan', 'no'],
          ['Sparse index every 4 KB', 'tiny', 'binary search + ≤ 4 KB scan', 'yes'],
          ['B-tree / LSM', 'medium', 'random-access friendly', 'no: offsets are monotonic'],
        ],
      },
    ],
    incidents: [
      { title: 'Broker crash from mmap limits', symptom: 'Brokers died with "Map failed" OOM errors despite free heap.', cause: 'Tens of thousands of partitions with small segments exceeded vm.max_map_count.', fix: 'Raise vm.max_map_count (for example to 262144), use fewer partitions or larger segments, and raise ulimit -n.', lesson: 'Partition count has OS-level costs.' },
      { title: 'Hour-long broker restart', symptom: 'After a hard kill, a broker took ~1 h to rejoin.', cause: 'Log recovery re-scans unflushed segments and rebuilds indexes, single-threaded per data dir by default.', fix: 'Raise num.recovery.threads.per.data.dir, use controlled shutdown, and keep fewer partitions per broker.', lesson: 'Clean shutdown writes a recovery checkpoint, while crashes pay at startup.' },
    ],
    interview: [
      { q: 'What happens on disk when a broker restarts after a crash?', a: 'For each partition it starts from the recovery point checkpoint, re-validates segments after it (CRC per batch), truncates any torn tail, and rebuilds the indexes. Clean shutdown skips this. Then it truncates or catches up against the leader using leader epochs.', probes: ['How do you speed it up?'], senior: 'Distinguishes local recovery (CRC and indexes) from replication reconciliation (leader epoch truncation).' },
      { q: 'Why can too many partitions hurt?', a: 'Each partition has segments, indexes and open files, replica fetcher work, metadata and leader elections. More partitions mean longer failover, more memory for producer batches per partition, smaller batches (worse compression) and higher end-to-end latency. KRaft raises the metadata limit but not the per-broker I/O costs.', probes: ['What is a sane partitions-per-broker number?'], senior: 'Gives a range (low thousands per broker), and sizes partitions from throughput and consumer parallelism with modest headroom, not "just make 1000".' },
      { q: 'How does Kafka detect corrupt data?', a: 'Every record batch has a CRC32C over its contents. Brokers validate on append and on recovery; consumers validate on fetch (check.crcs). A corrupt tail is truncated during recovery, and a corrupt replica can be rebuilt from the leader.', probes: ['Who validates when zero-copy skips the broker?'], senior: 'Notes the consumer verifies CRCs because zero-copy reads bypass broker inspection.' },
      { q: 'How would you implement "replay from timestamp T"?', a: 'consumer.offsetsForTimes(T) uses each segment’s .timeindex to find the earliest offset with timestamp ≥ T per partition, then seek(). Operationally, run kafka-consumer-groups --reset-offsets --to-datetime with the group stopped.', probes: ['What if producers set bad timestamps?'], senior: 'Points out that CreateTime from skewed clocks makes time-based seeks approximate, and validates with sample reads.' },
    ],
  },

  partitioner: {
    base: [{ probes: ['What happens to a user’s ordering when you go from 12 to 24 partitions?', 'How does the consumer side preserve order with a thread pool?'], senior: 'Mentions per-key ordering inside a parallel consumer (key-based worker hashing, e.g. Confluent parallel-consumer) and a planned migration for partition changes.' }],
    numbers: [
      { k: 'Default key hash', v: 'murmur2(key) % N (Java)', why: 'librdkafka’s default is consistent_random (CRC32), so mixed clients disagree.' },
      { k: 'Null keys', v: 'sticky → uniform sticky (KIP-794, 3.3)', why: 'Bigger batches; adaptive to slow brokers.' },
      { k: 'Sizing rule', v: 'max(T/p, T/c)', why: 'T = target throughput; p, c = per-partition producer and consumer rates.' },
      { k: 'Consumer parallelism', v: '≤ partitions', why: 'Extra consumers sit idle.' },
      { k: 'Partitions can only grow', v: 'no shrink', why: 'Over-partitioning is hard to undo.' },
    ],
    tradeoffs: [
      {
        title: 'Choosing the key',
        cols: ['Key', 'Ordering', 'Balance', 'Risk'],
        rows: [
          ['null (sticky)', 'none', 'best', 'no per-entity order'],
          ['entity id (order, user)', 'per entity', 'good with many entities', 'whales become hot keys'],
          ['tenant / merchant id', 'per tenant', 'poor', 'one big tenant = one hot partition'],
          ['salted key (id + n)', 'per sub-key only', 'good', 'consumers must re-merge'],
          ['random per message', 'none', 'good', 'breaks ordering silently'],
        ],
      },
    ],
    incidents: [
      { title: 'Hot partition from one big merchant', symptom: 'One partition’s lag climbed for hours while the others were idle.', cause: 'Keyed by merchantId, and one merchant ran a flash sale generating 40% of traffic.', fix: 'Key by orderId where per-merchant order isn’t needed, or salt the hot key and re-aggregate downstream. Monitor per-partition bytes-in.', lesson: 'Pick the smallest entity whose order actually matters.' },
      { title: 'Out-of-order updates after adding partitions', symptom: 'Order states regressed (SHIPPED then PAID) in a downstream DB.', cause: 'Partitions went from 12 to 24, so orderIds remapped. Old events were still on the old partition while new ones were processed on the new one.', fix: 'Drain before expanding, create a new topic and dual-write, or make consumers version-aware (reject lower versions).', lesson: 'Partition count is part of the ordering contract.' },
    ],
    interview: [
      { q: 'How do you choose the number of partitions?', a: 'From throughput: target MB/s ÷ min(per-partition producer rate, per-partition consumer rate), plus headroom for 1–2 years of growth, since adding partitions remaps keys. Cap it by per-broker partition costs and end-to-end latency. Example: 600 MB/s target with a consumer doing 20 MB/s per partition gives ≥ 30, so pick 36–48.', probes: ['Why not 1,000 just in case?', 'How does the consumer’s processing time enter the formula?'], senior: 'Derives the count from the consumer’s per-record cost (usually the bottleneck), and states the remap cost of growing later.' },
      { q: 'You have a hot key. What are your options?', a: 'Confirm it with per-partition metrics. Then: choose a finer key if ordering allows; salt the key (key#0..n) and merge downstream; isolate the whale to its own topic; pre-aggregate at the producer; or accept it and make the consumer for that partition faster (batching). A custom partitioner can route known whales.', probes: ['How do you keep per-key order if you salt?'], senior: 'Weighs ordering requirements before picking. Salting loses total order for that key, so they ask whether per-key order actually matters.' },
      { q: 'Java and Go services produce to the same topic with the same keys. Any problem?', a: 'Possibly. Java uses murmur2, while librdkafka-based clients default to consistent_random (CRC32), so the same key can land on different partitions, breaking ordering and co-partitioned joins. Set partitioner=murmur2_random in librdkafka, or standardise on one client.', probes: ['How would you detect it?'], senior: 'Knows the specific default mismatch and checks for it in multi-language estates.' },
      { q: 'Does Kafka guarantee global ordering?', a: 'Only within a partition. Global order requires a single partition, which caps throughput at one consumer. Usually you need per-entity order (key by entity) or a sequence or version number so consumers can reorder or reject stale updates.', probes: ['How would you build total order for a ledger?'], senior: 'Pushes back on "global order" and reframes it as per-aggregate ordering plus idempotent, version-checked consumers.' },
    ],
  },

  replication: {
    base: [
      { probes: ['Why can’t a consumer read up to the leader’s LEO?', 'What removes a follower from the ISR?'], senior: 'Explains HW as the consistency boundary consumers see, and that ISR membership is time-based (replica.lag.time.max.ms), not message-count based.' },
      { probes: ['Which of these do you accept for clickstream vs payments?'], senior: 'Maps each loss path to a config and picks per-topic settings by business impact rather than one cluster-wide answer.' },
    ],
    numbers: [
      { k: 'replica.lag.time.max.ms', v: '30 s', why: 'Follower out of the ISR if not caught up for this long.' },
      { k: 'default.replication.factor', v: '1 (broker default!)', why: 'Auto-created topics are unreplicated unless you change it.' },
      { k: 'min.insync.replicas', v: '1 default; use 2 with RF 3', why: 'Turns acks=all into a real guarantee.' },
      { k: 'unclean.leader.election', v: 'false (since 0.11)', why: 'Availability vs acknowledged data.' },
      { k: 'Leader epoch', v: 'KIP-101 (0.11), KIP-279', why: 'Truncation by epoch, not by HW.' },
      { k: 'Follower fetching', v: 'KIP-392 (2.4)', why: 'Consumers read from the same-AZ replica to cut cross-AZ cost.' },
    ],
    tradeoffs: [
      {
        title: 'RF and min.insync.replicas',
        cols: ['RF / minISR', 'Survives (writes)', 'Survives (no loss)', 'Notes'],
        rows: [
          ['1 / 1', 'nothing', 'nothing', 'dev only'],
          ['2 / 1', '1 broker', 'not guaranteed', 'acks=all degrades to the leader'],
          ['2 / 2', '0 brokers', '1 broker', 'any broker down stops writes'],
          ['3 / 2', '1 broker', '1 broker (2 for reads)', 'the standard production choice'],
          ['3 / 3', '0 brokers', '2 brokers', 'rolling restarts block writes'],
        ],
      },
    ],
    incidents: [
      { title: 'Replica divergence before leader epochs', symptom: 'After back-to-back leader failures, replicas held different records at the same offset.', cause: 'Followers truncated to their local high watermark, which lags the leader’s. A quick second failover let a stale replica become leader (KAFKA-1211 class of bugs).', fix: 'KIP-101 leader epochs: followers ask the new leader for the end offset of their last epoch and truncate exactly to it.', lesson: 'Use a fencing token (epoch), not a derived watermark, for reconciliation.' },
      { title: 'AZ outage took topics offline', symptom: 'One AZ failed and several partitions had no leader.', cause: 'broker.rack wasn’t set, so all 3 replicas of some partitions sat in the same AZ.', fix: 'Set broker.rack per AZ (rack-aware placement), reassign existing partitions, and check placement in CI.', lesson: 'RF is only as good as the failure domains replicas are spread across.' },
    ],
    interview: [
      { q: 'What is the leader epoch, and why did Kafka need it?', a: 'A monotonically increasing number bumped on every leader change, stored with each batch and in a leader-epoch checkpoint file. When a follower restarts, it asks the leader for the end offset of its latest epoch and truncates to exactly that point. HW-based truncation could lose acknowledged data or diverge after fast successive failovers (KIP-101 and KIP-279).', probes: ['How is this like Raft’s term?'], senior: 'Relates it to Raft terms and log matching, and explains why HW is a lagging hint and not a safe reconciliation point.' },
      { q: 'A leader dies. Walk through what happens.', a: 'The controller notices the missed heartbeat or session, picks the first live ISR member in the replica list as leader, bumps the leader epoch and publishes metadata. Followers truncate to the new leader’s epoch end offset and fetch from it. Producers and consumers get NOT_LEADER, refresh metadata and retry. Writes above the old HW that never reached the new leader are discarded, but they were never acknowledged with acks=all.', probes: ['How long does this take?', 'What if the ISR is empty?'], senior: 'Gives the timing (seconds, dominated by detection timeouts), and explains the empty-ISR choice: wait (consistency) or unclean election (availability), plus KIP-966 eligible leader replicas.' },
      { q: 'How do you survive the loss of a full AZ?', a: 'Use 3 AZs with broker.rack set, RF=3 with one replica per AZ, min.insync.replicas=2 and acks=all. Losing one AZ leaves 2 replicas, so writes continue. Clients need bootstrap servers across AZs, and the KRaft controllers must also span 3 AZs.', probes: ['What does this cost in network?', 'What about 2-AZ regions?'], senior: 'Prices cross-AZ replication traffic, uses follower fetching to save consumer cost, and says 2 AZs can’t keep a quorum, so a stretch cluster needs a third site or async mirroring.' },
      { q: 'When would you enable unclean leader election?', a: 'Only where availability beats correctness and lost acknowledged data is tolerable, such as metrics or logs. It lets an out-of-sync replica lead, truncating records others had acknowledged. For orders or payments, never.', probes: ['How do you detect it happened?'], senior: 'Makes it a per-topic decision and alerts on the unclean election rate metric.' },
      { q: 'How do you replicate Kafka across regions?', a: 'Use MirrorMaker 2 (Connect-based) or Confluent Cluster Linking to asynchronously copy topics, with offset translation for consumer failover. It is active-passive or active-active with prefixed topics to avoid loops. RPO > 0, because it is async, and failover needs translated consumer offsets.', probes: ['How do consumers resume in the other region?', 'Why not a stretch cluster?'], senior: 'States the RPO and RTO honestly, and designs idempotent consumers because failover replays some data.' },
    ],
  },

  idempotence: {
    base: [{ probes: ['What extra do transactions add?', 'Why doesn’t it survive a restart?'], senior: 'Separates producer-retry duplicates (solved), app-resend duplicates (not solved) and consumer-side duplicates (not solved), and gives the tool for each.' }],
    numbers: [
      { k: 'State per (PID, partition)', v: 'last 5 batch sequences', why: 'Why max.in.flight ≤ 5.' },
      { k: 'producer.id.expiration.ms', v: '1 day', why: 'Idle producer state is expired (KIP-854).' },
      { k: 'Default since 3.0', v: 'enable.idempotence=true', why: 'Requires acks=all and retries > 0.' },
      { k: 'Overhead', v: '≈ 0', why: 'A few bytes per batch header.' },
    ],
    tradeoffs: [
      {
        title: 'Where to dedupe',
        cols: ['Mechanism', 'Covers', 'Misses'],
        rows: [
          ['Idempotent producer', 'retries within one producer session', 'restarts, app resends'],
          ['Transactions', 'atomic multi-partition writes plus offsets', 'external side effects'],
          ['Consumer dedupe table', 'any duplicate with a stable event id', 'needs storage and TTL'],
          ['Idempotent sink (upsert)', 'replays, duplicates', 'non-idempotent effects (emails)'],
        ],
      },
    ],
    incidents: [
      { title: 'UNKNOWN_PRODUCER_ID on quiet topics', symptom: 'Low-traffic producers failed sends after retention ran.', cause: 'Before KIP-360 (2.5), the broker lost producer state when retention deleted that producer’s last records.', fix: 'Upgrade clients and brokers; KIP-360 lets producers safely bump the epoch and continue.', lesson: 'Protocol state tied to data retention fails at the edges.' },
      { title: 'Duplicates after pod restarts', symptom: 'Small duplicate bursts after every deploy.', cause: 'In-flight sends at shutdown were resent by a new producer with a new PID, so the broker can’t correlate them.', fix: 'flush() and close() on shutdown, plus consumer dedupe by event id.', lesson: 'Idempotence is per producer session.' },
    ],
    interview: [
      { q: 'How exactly does the broker detect a duplicate batch?', a: 'Per (PID, partition), the leader keeps the sequence ranges of the last 5 batches. A batch with an already-seen range is a duplicate: it is acknowledged with the original offset and not appended again. A gap gives OutOfOrderSequenceException, and an old epoch gives a fencing error. This state is rebuilt from the log snapshot on leader change.', probes: ['Why exactly 5?', 'What survives leader failover?'], senior: 'Knows the state lives in producer snapshots alongside the log, so it survives failover.' },
      { q: 'What does OutOfOrderSequenceException mean, and what do you do?', a: 'The broker saw a sequence gap, which means a prior batch was lost (for example after an unclean election or truncation). Records may be lost. Modern clients bump the epoch and continue where safe. Investigate durability settings, because it signals possible acknowledged-data loss.', probes: ['Can you retry it?'], senior: 'Treats it as a durability alarm, not just a client error.' },
      { q: 'Design an idempotent consumer.', a: 'Give each event a stable id at creation. In the sink transaction, insert the id into a processed table with a unique constraint (or upsert by business key with a version check), then apply the effect. Expire ids after the maximum replay window. For external APIs, pass the id as an idempotency key.', probes: ['How large can the dedupe table get?'], senior: 'Bounds the dedupe window to replay or retention, and prefers natural idempotency (upsert by key and version) over a separate table.' },
      { q: 'Is the outbox pattern still needed with idempotent producers?', a: 'Yes. Idempotence fixes Kafka-side retries, but not the dual-write problem (DB commit succeeds, then the send fails or the app crashes). The outbox writes the event in the same DB transaction, and a relay (Debezium CDC) publishes it at-least-once.', probes: ['Why not a Kafka transaction around the DB write?'], senior: 'Explains that a Kafka transaction can’t include the DB, and calls the outbox the standard fix for dual writes.' },
    ],
  },

  transactions: {
    base: [{ probes: ['What is the LSO?', 'How are zombies fenced?', 'What isn’t covered?'], senior: 'Covers fencing, markers and LSO in one breath, then states the boundary: only Kafka reads and writes, so external effects need idempotency.' }],
    numbers: [
      { k: 'transaction.timeout.ms', v: '60 s', why: 'The coordinator aborts transactions open longer than this.' },
      { k: '__transaction_state', v: '50 partitions, RF 3', why: 'The coordinator is hash(transactional.id).' },
      { k: 'transactional.id.expiration.ms', v: '7 days', why: 'Idle ids are forgotten.' },
      { k: 'Overhead', v: '~3–5% at 100 ms commits (KIP-98)', why: 'Grows as transactions get smaller.' },
      { k: 'Streams EOS commit', v: '100 ms', why: 'Latency floor for read_committed readers.' },
    ],
    tradeoffs: [
      {
        title: 'Delivery guarantees',
        cols: ['Guarantee', 'How', 'Cost', 'When'],
        rows: [
          ['At-most-once', 'commit before processing', 'lowest', 'loss is tolerable'],
          ['At-least-once', 'commit after processing', 'low', 'default, with idempotent effects'],
          ['Exactly-once (Kafka → Kafka)', 'transactions / Streams EOS', 'latency + markers', 'stateful stream processing, financial aggregates'],
          ['Effectively-once (Kafka → DB)', 'at-least-once + idempotent sink or offsets in the DB', 'design effort', 'most sinks'],
        ],
      },
    ],
    incidents: [
      { title: 'Hanging transaction froze consumers', symptom: 'read_committed consumers stopped advancing on one partition; lag grew while data kept arriving.', cause: 'A transaction left open (a producer bug or lost marker) pinned the LSO, so read_committed readers can’t pass it.', fix: 'Find it with kafka-transactions.sh find-hanging and abort it (KIP-664). Upgrade for KIP-890 server-side defences.', lesson: 'One stuck transaction blocks every read_committed reader of that partition.' },
      { title: 'Zombies wrote duplicates despite EOS', symptom: 'Duplicate aggregates after a network partition.', cause: 'Each pod used a random transactional.id, so a new instance never fenced the old, still-running one.', fix: 'Use a stable transactional.id per logical producer (or rely on KIP-447 group-based fencing in consume-transform-produce).', lesson: 'Fencing only works if the identity is stable across restarts.' },
    ],
    interview: [
      { q: 'What is the last stable offset (LSO)?', a: 'The offset of the earliest still-open transaction in a partition (or the HW if none are open). read_committed consumers only read up to the LSO and use the .txnindex of aborted ranges to drop aborted records. A long-open transaction delays all read_committed consumers.', probes: ['What does a read_uncommitted consumer see?'], senior: 'Connects the LSO to consumer latency and the hanging-transaction failure mode.' },
      { q: 'How do Kafka transactions fence zombie producers?', a: 'initTransactions() with a transactional.id bumps its epoch at the coordinator. Writes or commits with an older epoch get PRODUCER_FENCED. Since KIP-447, the consumer group metadata (generation) passed to sendOffsetsToTransaction also fences stale instances after a rebalance.', probes: ['What happens to the zombie’s open transaction?'], senior: 'Says the new epoch aborts the old instance’s pending transaction, and explains why the id must be stable.' },
      { q: 'When would you not use exactly-once?', a: 'When the sink is outside Kafka (it doesn’t help), when latency must be lower than commit intervals, when throughput with small transactions suffers, or when idempotent consumers already make at-least-once safe and simpler. EOS is for Kafka-to-Kafka stateful processing where duplicates corrupt aggregates.', probes: ['What does EOS cost in latency?'], senior: 'Defaults to at-least-once plus idempotency, and reserves EOS for stateful Kafka-to-Kafka pipelines where it pays.' },
      { q: 'Explain the two-phase commit inside Kafka transactions.', a: 'The producer registers partitions (AddPartitions) and offsets with the coordinator, then writes data. On commit the coordinator writes PrepareCommit to __transaction_state (the decision point), writes COMMIT markers to every involved partition, and then records CompleteCommit. If the coordinator fails after Prepare, the new one finishes writing markers from its log.', probes: ['What is the durable decision point?'], senior: 'Identifies the Prepare record as the commit point, so recovery is deterministic and participants never vote.' },
    ],
  },

  rebalance: {
    base: [{ probes: ['What does a member do during an eager rebalance?', 'How does static membership change a rolling restart?'], senior: 'Quantifies the pause (stop-the-world for eager) and pairs cooperative-sticky with static membership for deploys.' }],
    numbers: [
      { k: 'session.timeout.ms', v: '45 s (3.0+)', why: 'Death detection.' },
      { k: 'heartbeat.interval.ms', v: '3 s', why: 'About 1/3 of the session timeout or less.' },
      { k: 'group.initial.rebalance.delay.ms', v: '3 s', why: 'Waits for more members at group start.' },
      { k: 'Cooperative protocol', v: 'KIP-429 (2.4)', why: 'Only moved partitions are revoked.' },
      { k: 'Static membership', v: 'KIP-345 (2.3)', why: 'group.instance.id survives restarts.' },
      { k: 'KIP-848 protocol', v: 'GA in 4.0', why: 'Broker-side assignment, incremental, no global barrier.' },
    ],
    tradeoffs: [
      {
        title: 'Rebalance protocols',
        cols: ['Protocol', 'Pause', 'Partition movement', 'Notes'],
        rows: [
          ['Eager (range / round-robin)', 'all partitions revoked', 'can reshuffle everything', 'simplest, worst for large groups'],
          ['Sticky (eager)', 'all revoked', 'minimal movement', 'still stop-the-world'],
          ['Cooperative-sticky', 'only moving partitions', 'minimal', 'two rounds; the usual client default choice'],
          ['Static membership', 'none for restarts < session timeout', 'none', 'needs a stable id per pod'],
          ['KIP-848 consumer protocol', 'per-member, incremental', 'minimal, server-side', 'new default direction (4.0+)'],
        ],
      },
    ],
    incidents: [
      { title: 'Rolling deploy = 20 rebalances', symptom: 'Every deploy caused ~10 minutes of near-zero throughput.', cause: 'Eager assignor with 20 pods: each restart triggered a stop-the-world rebalance, twice (leave and join).', fix: 'Cooperative-sticky plus group.instance.id (StatefulSet ordinals) and a session timeout above the restart time.', lesson: 'Rebalance cost is a deployment concern.' },
      { title: 'GC pauses kicked healthy consumers', symptom: 'Random members dropped out under load and the group flapped.', cause: 'A 10 s session.timeout (old default) and full-GC pauses over 10 s.', fix: 'Fix heap sizing and GC, use a 45 s session timeout, and bound max.poll.records.', lesson: 'Timeouts must exceed your worst normal pause.' },
    ],
    interview: [
      { q: 'Eager vs cooperative rebalancing: what is the difference?', a: 'Eager: every member revokes all partitions, rejoins, gets a new assignment, so the whole group stops. Cooperative (incremental): members keep their partitions; the first round computes the target and revokes only partitions that must move, and a second round assigns them. Only moving partitions pause.', probes: ['Why does cooperative need two rounds?'], senior: 'Explains the safety reason (a partition must be released before another member takes it), so two rounds avoid double ownership.' },
      { q: 'What changes with KIP-848, the new consumer protocol?', a: 'The group coordinator computes assignments server-side, and members reconcile incrementally via heartbeats with no global sync barrier. One slow member no longer stalls the group, and client-side assignor complexity disappears. It is GA in Kafka 4.0 (group.protocol=consumer).', probes: ['What about custom assignors?'], senior: 'Notes the server-side assignors and the migration path. Knows Streams has its own protocol (KIP-1071) in progress.' },
      { q: 'How would you design consumers for a 200-pod deployment?', a: 'Partitions ≥ pods (or pods × threads), cooperative-sticky or KIP-848, static membership tied to pod identity, graceful shutdown that commits and closes, bounded poll batches, and idempotent processing for the duplicates rebalances cause. Monitor rebalance rate and generation.', probes: ['What goes wrong with autoscaling on lag?'], senior: 'Warns that lag-based autoscaling causes rebalance churn that adds lag, and adds cooldowns and a partition-count ceiling.' },
      { q: 'How does the group coordinator know a consumer is dead?', a: 'Two signals. Missing heartbeats for session.timeout.ms (from the background heartbeat thread) means the process is dead or partitioned. Not calling poll() within max.poll.interval.ms makes the client itself leave the group. Either triggers a rebalance; a clean close() leaves immediately.', probes: ['Which one fires on a deadlock in your handler?'], senior: 'Knows a deadlocked handler keeps heartbeating but trips max.poll.interval, and designs timeouts for handler calls.' },
    ],
  },

  kraft: {
    base: [{ probes: ['How fast is controller failover now?', 'What is the metadata log?'], senior: 'Explains the event-sourced metadata log (brokers replay deltas) and why that makes failover and scaling to millions of partitions possible.' }],
    numbers: [
      { k: 'Controller quorum', v: '3 or 5 voters', why: 'Tolerates 1 or 2 failures.' },
      { k: 'Production-ready', v: 'KRaft 3.3; ZK removed 4.0', why: 'Migration via 3.x bridge releases.' },
      { k: 'Partition scale', v: '~200k (ZK) → millions (KRaft)', why: 'Metadata no longer loaded in bulk from ZK.' },
      { k: 'Controller failover', v: 'seconds or minutes → near-instant', why: 'Standbys already have the log.' },
      { k: 'Dynamic quorum', v: 'KIP-853 (3.9)', why: 'Add or remove controllers without downtime.' },
    ],
    tradeoffs: [
      {
        title: 'Metadata management',
        cols: ['Mode', 'Failover', 'Ops', 'Use'],
        rows: [
          ['ZooKeeper (legacy)', 'new controller reloads all state from ZK', 'two systems to run and secure', 'pre-4.0 only'],
          ['KRaft combined mode', 'fast', 'one process type', 'dev, small clusters'],
          ['KRaft dedicated controllers', 'fast, isolated from broker load', 'extra nodes', 'production'],
        ],
      },
    ],
    incidents: [
      { title: 'Controller failover took minutes', symptom: 'After a controller broker died, partitions stayed leaderless for minutes (ZK era).', cause: 'The new controller had to read all metadata for 100k+ partitions from ZooKeeper before acting.', fix: 'KRaft: standbys replicate the metadata log continuously and take over in milliseconds to seconds.', lesson: 'A cold standby’s recovery time scales with state size.' },
      { title: 'Lost quorum during maintenance', symptom: 'Metadata changes (topic creation, leader election) stopped cluster-wide.', cause: 'With 3 controllers, one was being patched while another crashed: 1 of 3 left, no majority.', fix: 'Use 5 controllers for larger clusters, patch one at a time, and spread controllers across AZs.', lesson: 'Maintenance consumes your failure budget.' },
    ],
    interview: [
      { q: 'What is the KRaft metadata log, and how do brokers use it?', a: 'A single-partition Raft log (__cluster_metadata) of metadata records (topics, partitions, ISR changes, configs), replicated across the controller quorum. The active controller is the Raft leader. Brokers are observers that fetch and apply deltas, plus periodic snapshots, so they never need a full reload.', probes: ['What happens if a broker falls behind?'], senior: 'Frames it as event sourcing for cluster metadata, with snapshots bounding replay.' },
      { q: 'What happens if the controller quorum loses its majority?', a: 'No new metadata can be committed: no leader elections, ISR changes or topic changes. Existing leaders keep serving reads and writes as long as their ISR is stable, but any broker failure can’t be handled.', probes: ['Is the data plane down?'], senior: 'Separates data plane (partly up) from control plane (frozen) and sizes the quorum (3 vs 5) by maintenance practice.' },
      { q: 'How would you migrate a ZooKeeper cluster to KRaft?', a: 'On a 3.x bridge release: deploy KRaft controllers in migration mode, which copy metadata from ZK. Roll brokers to talk to the KRaft controller while still dual-writing to ZK, verify, then finalise and remove ZK. Rollback is possible until finalisation. You must be on KRaft before upgrading to 4.0.', probes: ['Where is the point of no return?'], senior: 'Names the dual-write phase and the finalise step as the point of no return, and plans the rollback window.' },
      { q: 'Why Raft and not ZooKeeper’s ZAB or an external store like etcd?', a: 'Kafka already is a replicated log, so the metadata log reuses its storage, fetch protocol and tooling. One system to operate, metadata propagation by log replay, and no external dependency.', probes: ['What did Kafka give up?'], senior: 'Mentions the cost: Kafka now owns consensus correctness, which shows in the multi-year migration.' },
    ],
  },

  compaction: {
    base: [{ probes: ['How long do tombstones live?', 'Why do duplicates still appear?', 'What can you compact by?'], senior: 'Explains the consumer contract: a reader that starts from 0 sees at least the latest value per key, plus tombstones it reads within delete.retention.ms.' }],
    numbers: [
      { k: 'min.cleanable.dirty.ratio', v: '0.5', why: 'Compaction starts when half the log is dirty.' },
      { k: 'delete.retention.ms', v: '24 h', why: 'How long tombstones stay readable.' },
      { k: 'min.compaction.lag.ms', v: '0', why: 'Guarantees recent records are kept un-compacted.' },
      { k: 'max.compaction.lag.ms', v: '∞', why: 'Set it for GDPR-style deadlines.' },
      { k: 'log.cleaner.dedupe.buffer.size', v: '128 MB', why: 'Bounds keys per cleaning pass.' },
      { k: 'log.cleaner.threads', v: '1', why: 'One thread for the whole broker.' },
    ],
    tradeoffs: [
      {
        title: 'Cleanup policies',
        cols: ['Policy', 'Keeps', 'Good for', 'Watch out'],
        rows: [
          ['delete', 'everything within retention', 'events, logs', 'history is lost after retention'],
          ['compact', 'latest value per key forever', 'changelogs, CDC snapshots, config', 'unbounded growth with unbounded keys'],
          ['compact,delete', 'latest per key, within retention', 'windowed state, recent snapshots', 'old keys disappear entirely'],
        ],
      },
    ],
    incidents: [
      { title: 'Deleted users came back', symptom: 'A cache rebuilt from a compacted topic contained users deleted weeks ago.', cause: 'The rebuild consumer was offline longer than delete.retention.ms, so it never saw the tombstones; its old snapshot still had the keys.', fix: 'Rebuild from offset 0 rather than patching an old snapshot, or raise delete.retention.ms above the maximum consumer downtime.', lesson: 'Tombstones are time-limited messages, not permanent deletes.' },
      { title: 'Silent disk growth: cleaner thread died', symptom: 'Disk usage of compacted topics grew steadily for weeks.', cause: 'The log cleaner thread died on an unexpected record (for example a null key) and was never restarted.', fix: 'Alert on max-dirty-percent and time-since-last-run-ms, fix the producer, and restart the broker.', lesson: 'Background maintenance threads need health metrics.' },
    ],
    interview: [
      { q: 'How do you delete a key from a compacted topic, and what are the pitfalls?', a: 'Produce a tombstone (same key, null value). After compaction runs, older values disappear, and the tombstone itself is removed after delete.retention.ms. Pitfalls: consumers offline longer than that miss the delete; compaction timing isn’t guaranteed without max.compaction.lag.ms; the active segment isn’t compacted.', probes: ['How would you meet "deleted within 30 days"?'], senior: 'Sets max.compaction.lag.ms and segment.ms for the deadline, or uses crypto-shredding (per-user keys) when deletion must be provable.' },
      { q: 'What are compacted topics used for in Kafka itself?', a: '__consumer_offsets (latest offset per group, topic and partition), __transaction_state, Streams changelogs, Connect config/offset/status topics, and Schema Registry’s _schemas. Each is a durable key → latest-value table.', probes: ['Why not a database?'], senior: 'Points out that Kafka uses its own log as its database, so all state recovery is "replay the log".' },
      { q: 'Can you rely on compaction to give consumers exactly one record per key?', a: 'No. Compaction is eventual and skips the active segment and records newer than min.compaction.lag.ms, so consumers can see multiple values for a key. Consumers must treat records as upserts: last write wins.', probes: ['How should a cache builder handle it?'], senior: 'Designs consumers to be upsert-idempotent and never counts records.' },
      { q: 'Design a "latest price per product" feed with Kafka.', a: 'A compacted topic keyed by productId, with cleanup.policy=compact, enough partitions for consumer parallelism and min.insync.replicas=2. New consumers bootstrap by reading from 0 (a snapshot) then tail. Use a tombstone to delist. Alternatively, Streams with a KTable or GlobalKTable gives queryable state.', probes: ['How do you bootstrap a new service quickly?'], senior: 'Uses the compacted topic as the system of record for the snapshot, and estimates bootstrap time from topic size.' },
    ],
  },
};
