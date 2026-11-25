/**
 * "How it is actually built" deep dives. Each dive is a sequence of frames; every frame carries a
 * small declarative visual (rendered by ui/DiveViz) plus an optional predict-before-reveal.
 */
import type { Predict } from './lesson';

export type Viz =
  | { kind: 'path'; title?: string; stages: { label: string; sub?: string; hot?: boolean; skip?: boolean }[]; copies?: number; note?: string }
  | { kind: 'segments'; segments: { base: number; next: number; active?: boolean; deleted?: boolean; mark?: boolean }[]; index?: { off: number; pos: number; hit?: boolean }[]; lookup?: number; note?: string }
  | { kind: 'partitioner'; parts: number; keys: { key: string; hash: number; p: number }[]; note?: string; sticky?: boolean }
  | { kind: 'replicas'; replicas: { name: string; leo: number; leader?: boolean; isr: boolean; down?: boolean }[]; hw: number; note?: string; clean?: boolean }
  | { kind: 'seq'; pid: number; epoch: number; batches: { seq: number; state: 'ok' | 'dup' | 'gap' | 'fenced' | 'new' }[]; note?: string }
  | { kind: 'txn'; coordinator: string; parts: { name: string; recs: { label: string; s: 'open' | 'commit' | 'abort' | 'marker' | 'plain' }[]; lso?: number }[]; note?: string }
  | { kind: 'group'; phase: string; gen: number; members: { name: string; parts: string[]; state?: 'ok' | 'revoking' | 'joining' | 'gone' | 'leader' }[]; note?: string }
  | { kind: 'quorum'; mode: 'kraft' | 'zk'; nodes: { name: string; role: 'leader' | 'voter' | 'observer' | 'down' | 'zk' | 'controller'; off: number }[]; note?: string }
  | { kind: 'compaction'; before: { o: number; k: string; v: string | null }[]; after?: { o: number; k: string; v: string | null }[]; note?: string };

export interface Frame {
  title: string;
  body: string;
  viz: Viz;
  predict?: Predict;
}

export interface Dive {
  id: string;
  title: string;
  tagline: string;
  minutes: number;
  /** One-line answer an interviewer wants. */
  oneLiner: string;
  frames: Frame[];
  design: { decision: string; because: string }[];
  interview: { q: string; a: string }[];
}

export const DIVES: Dive[] = [
  /* -------------------------------------------------------------- */
  {
    id: 'fast',
    title: 'Why Kafka is fast',
    tagline: 'Sequential I/O, the page cache, zero-copy and batching.',
    minutes: 7,
    oneLiner: 'Append-only sequential writes, reads served from the OS page cache via sendfile (zero-copy), and everything batched and compressed end-to-end.',
    frames: [
      {
        title: 'The naive path: 4 copies',
        body: 'A typical server reads a file and writes it to a socket: disk → kernel buffer → **user space** → socket buffer → NIC. That is four copies and two context switches per chunk, and the CPU spends its time moving bytes.',
        viz: { kind: 'path', title: 'read() + write()', stages: [{ label: 'Disk' }, { label: 'Page cache', sub: 'kernel' }, { label: 'App buffer', sub: 'user space', hot: true }, { label: 'Socket buffer', sub: 'kernel' }, { label: 'NIC' }], copies: 4 },
      },
      {
        title: 'Zero-copy with sendfile()',
        body: 'The broker stores data on disk in **exactly the format** it sends over the wire (the producer’s batches). So it can call `sendfile()` (Java `FileChannel.transferTo`): the kernel ships bytes from the page cache straight to the NIC. The JVM never touches the payload.',
        viz: { kind: 'path', title: 'sendfile()', stages: [{ label: 'Disk' }, { label: 'Page cache', sub: 'kernel', hot: true }, { label: 'App buffer', sub: 'skipped', skip: true }, { label: 'Socket buffer', sub: 'descriptors only', skip: true }, { label: 'NIC', sub: 'DMA' }], copies: 2 },
        predict: {
          q: 'TLS is enabled between consumers and brokers. Does zero-copy still apply?',
          options: ['Yes', 'No: bytes must be encrypted in user space, so they’re copied through the JVM', 'Only for compressed data'],
          answer: 1,
          explain: 'With SSL the broker must read the bytes to encrypt them, so sendfile is bypassed. TLS costs noticeable broker CPU, and kTLS is the modern mitigation.',
        },
      },
      {
        title: 'The page cache is the cache',
        body: 'Kafka doesn’t keep its own in-heap cache. Writes go to the OS page cache and are flushed by the OS (Kafka doesn’t fsync per message; durability comes from **replication**). Consumers that are caught up read recent data that is still in memory, so disks see mostly writes.',
        viz: { kind: 'path', title: 'tail reads', stages: [{ label: 'Producer' }, { label: 'Page cache', sub: 'recent segments', hot: true }, { label: 'Consumer (caught up)', sub: 'served from RAM' }], note: 'Lagging consumers read from disk and evict hot pages. One far-behind consumer can slow everyone.' },
      },
      {
        title: 'Sequential I/O',
        body: 'Each partition is an append-only file. Sequential disk writes run at hundreds of MB/s even on HDDs, orders of magnitude faster than random writes. No B-trees, no in-place updates.',
        viz: { kind: 'segments', segments: [{ base: 0, next: 4096 }, { base: 4096, next: 8192 }, { base: 8192, next: 9120, active: true }], note: 'Writes only ever touch the end of the active segment.' },
      },
      {
        title: 'Batching everywhere',
        body: 'Producers group records per partition into batches (`batch.size`, `linger.ms`) and compress the **whole batch**. The broker appends the batch as one unit (no decompression on the hot path, given an idempotent producer and matching compression). Consumers fetch many batches per request (`fetch.min.bytes`). One network round trip moves thousands of messages.',
        viz: { kind: 'path', title: 'one request', stages: [{ label: 'Records ×1000' }, { label: 'Batch', sub: 'per partition' }, { label: 'Compressed', sub: 'lz4/zstd', hot: true }, { label: 'Broker log', sub: 'as-is' }, { label: 'Consumer', sub: 'decompresses' }] },
      },
    ],
    design: [
      { decision: 'Rely on the OS page cache, not an in-heap cache', because: 'No GC pressure, no double caching, and a warm cache survives broker process restarts.' },
      { decision: 'Same on-disk and wire format', because: 'Enables sendfile and avoids re-encoding on the broker.' },
      { decision: 'No per-message fsync', because: 'Durability comes from replicas on other machines, not from flushing one disk.' },
    ],
    interview: [
      { q: 'Why is Kafka so fast?', a: 'Sequential appends to partition logs; reads served from the page cache; zero-copy sendfile from page cache to socket; batching and compression end to end; partitions spread load across brokers and disks; consumers pull at their own pace with simple offset-based reads (no per-message acks).' },
    ],
  },
  /* -------------------------------------------------------------- */
  {
    id: 'log',
    title: 'The log on disk',
    tagline: 'Segments, sparse indexes and how an offset is found.',
    minutes: 6,
    oneLiner: 'A partition is a directory of segment files named by base offset, each with a sparse .index (offset→byte position) and .timeindex. Lookups binary-search segments, then the index, then scan a few KB.',
    frames: [
      {
        title: 'A partition is a directory',
        body: '`/var/kafka/orders-3/` holds `00000000000000000000.log`, `00000000000000004096.log`, … Each file is a **segment**, named after the first offset it contains. Only the last segment (the **active** one) receives writes.',
        viz: { kind: 'segments', segments: [{ base: 0, next: 4096 }, { base: 4096, next: 8192 }, { base: 8192, next: 9120, active: true }] },
      },
      {
        title: 'Rolling segments',
        body: 'A new segment starts when the active one reaches `segment.bytes` (1 GB) or `segment.ms` (7 days). Retention and compaction work on **closed** segments only, deleting or rewriting whole files. That’s why deletion is cheap and why data can outlive retention.ms on quiet topics.',
        viz: { kind: 'segments', segments: [{ base: 0, next: 4096, deleted: true }, { base: 4096, next: 8192 }, { base: 8192, next: 12288 }, { base: 12288, next: 12500, active: true }], note: 'Expired segment 0 deleted as a whole file.' },
      },
      {
        title: 'The sparse offset index',
        body: 'Next to each .log is an `.index`: every ~4 KB of log (`index.interval.bytes`), one entry maps *relative offset → byte position*. It’s memory-mapped and small enough to stay in RAM.',
        viz: { kind: 'segments', segments: [{ base: 8192, next: 9120, active: true, mark: true }], index: [{ off: 8192, pos: 0 }, { off: 8231, pos: 4110 }, { off: 8270, pos: 8203 }, { off: 8309, pos: 12290 }] },
      },
      {
        title: 'Finding offset 8250',
        body: 'A consumer asks for offset 8250.',
        viz: { kind: 'segments', segments: [{ base: 0, next: 4096 }, { base: 4096, next: 8192 }, { base: 8192, next: 9120, active: true, mark: true }], index: [{ off: 8192, pos: 0 }, { off: 8231, pos: 4110, hit: true }, { off: 8270, pos: 8203 }], lookup: 8250 },
        predict: {
          q: 'How many disk seeks does the lookup need?',
          options: ['A full scan of the partition', 'Binary-search segments by base offset (in memory) → binary-search the mmap’d index → scan ≤ ~4 KB from position 4110', 'One per record'],
          answer: 1,
          explain: 'O(log n) in memory, then one short sequential read. `.timeindex` works the same way for `offsetsForTimes()` (seek by timestamp).',
        },
      },
      {
        title: 'Inside a segment: record batches',
        body: 'The .log holds **record batches**: a header (base offset, length, partition leader epoch, magic, CRC, attributes for compression/transactional/control, producer id, epoch, base sequence, record count) followed by records with *delta*-encoded offsets and timestamps (varints). Compression applies to the records of a batch together.',
        viz: { kind: 'path', title: 'RecordBatch v2', stages: [{ label: 'baseOffset' }, { label: 'leaderEpoch' }, { label: 'CRC + attrs' }, { label: 'PID / epoch / seq', hot: true }, { label: 'records[]', sub: 'delta varints' }] },
      },
    ],
    design: [
      { decision: 'Segment files instead of one big file', because: 'Retention deletes whole files (O(1)), compaction rewrites them independently, and recovery only checks the active segment.' },
      { decision: 'Sparse index', because: 'Tiny enough to mmap for millions of offsets; a short scan finishes the lookup.' },
      { decision: 'Offsets are logical, per partition', because: 'Consumers track a single integer; no per-message state on the broker.' },
    ],
    interview: [
      { q: 'How does Kafka find a message by offset?', a: 'Segments are named by base offset, so binary search picks the segment; its sparse offset index (memory-mapped) gives the nearest byte position at or before the target; then a short sequential scan reaches the record batch.' },
    ],
  },
  /* -------------------------------------------------------------- */
  {
    id: 'partitioner',
    title: 'The producer partitioner',
    tagline: 'murmur2(key) % partitions, and the sticky partitioner.',
    minutes: 5,
    oneLiner: 'Keyed records go to murmur2(key) mod numPartitions; keyless records use the sticky partitioner, which fills one batch at a time per partition for bigger batches.',
    frames: [
      {
        title: 'Keyed records',
        body: '`partition = toPositive(murmur2(keyBytes)) % numPartitions`. Same key, same partition, so per-key order is preserved (a partition is ordered).',
        viz: { kind: 'partitioner', parts: 6, keys: [{ key: 'user-17', hash: 1902317, p: 5 }, { key: 'user-42', hash: 88431, p: 3 }, { key: 'user-17', hash: 1902317, p: 5 }, { key: 'user-99', hash: 70120, p: 4 }] },
      },
      {
        title: 'Adding partitions',
        body: 'The topic grows from 6 to 8 partitions.',
        viz: { kind: 'partitioner', parts: 8, keys: [{ key: 'user-17', hash: 1902317, p: 5 }, { key: 'user-42', hash: 88431, p: 7 }, { key: 'user-99', hash: 70120, p: 0 }], note: 'user-42 and user-99 moved; their old events stay in the old partitions.' },
        predict: {
          q: 'What happens to per-key ordering at the moment of the change?',
          options: ['Unaffected', 'Keys may now map to a different partition, so new events can be consumed before older ones still queued in the old partition', 'Kafka migrates old data'],
          answer: 1,
          explain: 'Kafka never moves existing records. Plan partition counts up front (over-provision), or create a new topic and migrate.',
        },
      },
      {
        title: 'Keyless: the sticky partitioner',
        body: 'Before 2.4, null keys went round-robin per record, which made tiny batches across all partitions. The **sticky partitioner** (KIP-480) sends to one partition until the batch is full or linger expires, then switches. Since 3.3 (KIP-794) it also avoids slow brokers by weighting on queue size.',
        viz: { kind: 'partitioner', parts: 6, sticky: true, keys: [{ key: '∅', hash: 0, p: 2 }, { key: '∅', hash: 0, p: 2 }, { key: '∅', hash: 0, p: 2 }, { key: '∅', hash: 0, p: 4 }], note: 'Fills partition 2’s batch, then moves on.' },
      },
      {
        title: 'Hot keys',
        body: 'Hashing spreads *keys* evenly, not *traffic*. One celebrity user or a big tenant pins one partition and one consumer. Fixes: salt the key (`key#0..n`, then re-aggregate), a custom partitioner for known heavy keys, or a different key.',
        viz: { kind: 'partitioner', parts: 6, keys: [{ key: 'tenant-1', hash: 5, p: 1 }, { key: 'tenant-1', hash: 5, p: 1 }, { key: 'tenant-1', hash: 5, p: 1 }, { key: 'tenant-1', hash: 5, p: 1 }, { key: 'tenant-7', hash: 9, p: 3 }], note: 'Partition 1 gets 80% of traffic.' },
      },
    ],
    design: [
      { decision: 'Deterministic hash on the client', because: 'No broker lookup per record; any producer computes the same partition.' },
      { decision: 'Modulo partition count (not consistent hashing)', because: 'Simple and fast; the cost is remapping when partitions are added.' },
    ],
    interview: [
      { q: 'How do you guarantee ordering for a user’s events?', a: 'Key by user id so they hash to one partition; use an idempotent producer (ordering is safe with up to 5 in flight); don’t add partitions without a migration plan; process each partition sequentially in the consumer.' },
    ],
  },
  /* -------------------------------------------------------------- */
  {
    id: 'replication',
    title: 'Replication: LEO, HW & ISR',
    tagline: 'How followers fetch, when data becomes visible, and what “committed” means.',
    minutes: 8,
    oneLiner: 'Followers fetch from the leader like consumers; the high watermark is the min LEO across the ISR; only records below HW are visible to consumers and safe from leader failover.',
    frames: [
      {
        title: 'Leader and followers',
        body: 'Each partition has one **leader** (all reads/writes by default) and followers that send **Fetch** requests to the leader, just like consumers. Each replica has a **log end offset (LEO)**: the next offset it will write.',
        viz: { kind: 'replicas', hw: 5, replicas: [{ name: 'b1', leo: 5, leader: true, isr: true }, { name: 'b2', leo: 5, isr: true }, { name: 'b3', leo: 5, isr: true }] },
      },
      {
        title: 'A write arrives',
        body: 'The leader appends offsets 5–7. LEO(leader)=8. Followers haven’t fetched yet.',
        viz: { kind: 'replicas', hw: 5, replicas: [{ name: 'b1', leo: 8, leader: true, isr: true }, { name: 'b2', leo: 5, isr: true }, { name: 'b3', leo: 5, isr: true }] },
        predict: {
          q: 'A consumer fetches now. Can it read offset 6?',
          options: ['Yes, it’s on the leader', 'No: consumers only see records below the high watermark (5)', 'Only with acks=all'],
          answer: 1,
          explain: 'Data above HW may be lost on failover, so it is hidden. That’s also why `acks=all` latency ≈ follower fetch round trip.',
        },
      },
      {
        title: 'The high watermark advances',
        body: 'b2 fetches up to 8; b3 up to 7. The leader learns follower LEOs from their next fetch offsets. **HW = min(LEO of ISR)** = 7. With `acks=all`, the producer is acked when HW passes its records.',
        viz: { kind: 'replicas', hw: 7, replicas: [{ name: 'b1', leo: 8, leader: true, isr: true }, { name: 'b2', leo: 8, isr: true }, { name: 'b3', leo: 7, isr: true }] },
      },
      {
        title: 'Falling out of the ISR',
        body: 'b3’s disk is slow. If a follower hasn’t caught up to the leader’s LEO within `replica.lag.time.max.ms` (30 s), the leader **shrinks the ISR**. HW now ignores b3, so producers aren’t held hostage by a slow replica.',
        viz: { kind: 'replicas', hw: 12, replicas: [{ name: 'b1', leo: 12, leader: true, isr: true }, { name: 'b2', leo: 12, isr: true }, { name: 'b3', leo: 7, isr: false }], note: 'ISR = {b1, b2}. min.insync.replicas=2 still satisfied.' },
      },
      {
        title: 'Leader dies',
        body: 'b1 crashes. The controller picks a new leader **from the ISR** (b2), and bumps the **leader epoch**.',
        viz: { kind: 'replicas', hw: 12, clean: true, replicas: [{ name: 'b1', leo: 12, isr: false, down: true }, { name: 'b2', leo: 12, leader: true, isr: true }, { name: 'b3', leo: 7, isr: false }] },
        predict: {
          q: 'b3 rejoins with offsets up to 7 but b2’s log diverged after a failover in the past. How does b3 know what to truncate?',
          options: ['It compares checksums of every record', 'It asks the leader for the end offset of its last leader epoch (OffsetsForLeaderEpoch) and truncates to that', 'It deletes its whole log'],
          answer: 1,
          explain: 'Leader epochs (KIP-101) replaced HW-based truncation, which could lose or diverge data in double-failure cases.',
        },
      },
      {
        title: 'Unclean election',
        body: 'Now suppose b2 also dies and only out-of-sync b3 is alive. With `unclean.leader.election.enable=true`, b3 becomes leader: offsets 7–11, already acked to producers, are **gone**, and consumers may see offsets reused. With false (default), the partition stays **offline** until an ISR member returns. Availability vs consistency, as a config flag.',
        viz: { kind: 'replicas', hw: 7, clean: false, replicas: [{ name: 'b1', leo: 12, isr: false, down: true }, { name: 'b2', leo: 12, isr: false, down: true }, { name: 'b3', leo: 7, leader: true, isr: true }], note: 'Acked records 7–11 lost.' },
      },
    ],
    design: [
      { decision: 'ISR instead of majority quorum', because: 'With f+1 replicas it tolerates f failures (a majority quorum needs 2f+1). The ISR is maintained dynamically by the leader and persisted by the controller.' },
      { decision: 'Pull-based replication', because: 'Followers batch naturally, and the same code path serves consumers.' },
      { decision: 'min.insync.replicas', because: 'Prevents the ISR shrinking to just the leader silently while acks=all still says “success”.' },
    ],
    interview: [
      { q: 'What is the ISR and the high watermark?', a: 'ISR = replicas caught up with the leader within replica.lag.time.max.ms. HW = smallest LEO among ISR members; consumers read only below HW and acks=all acknowledges when HW passes the batch. If the leader fails, a new one is chosen from the ISR, so committed (below-HW) data survives.' },
      { q: 'How can Kafka lose acknowledged data?', a: 'acks=0/1 with a leader crash before replication; min.insync.replicas=1 with acks=all when the ISR shrinks to the leader; unclean leader election; RF=1 with disk loss; and, without fsync, simultaneous power loss of all replicas.' },
    ],
  },
  /* -------------------------------------------------------------- */
  {
    id: 'idempotence',
    title: 'Idempotent producer',
    tagline: 'Producer ids, epochs and sequence numbers.',
    minutes: 5,
    oneLiner: 'Each producer gets a PID+epoch; each batch per partition has a sequence number; the leader caches the last 5 batch sequences per PID and rejects duplicates and gaps.',
    frames: [
      {
        title: 'InitProducerId',
        body: 'On startup the producer asks a broker for a **producer id (PID)** and **epoch**. From then on every batch to partition *p* carries `(PID, epoch, baseSequence)`, with sequences starting at 0 per partition.',
        viz: { kind: 'seq', pid: 4012, epoch: 0, batches: [{ seq: 0, state: 'ok' }, { seq: 1, state: 'ok' }, { seq: 2, state: 'ok' }] },
      },
      {
        title: 'Ack lost, retry',
        body: 'Batch 3 is written, but the response is lost. The producer retries batch 3.',
        viz: { kind: 'seq', pid: 4012, epoch: 0, batches: [{ seq: 0, state: 'ok' }, { seq: 1, state: 'ok' }, { seq: 2, state: 'ok' }, { seq: 3, state: 'ok' }, { seq: 3, state: 'dup' }] },
        predict: {
          q: 'What does the leader do with the retried batch?',
          options: ['Appends it again', 'Recognises seq 3 as already written for PID 4012 and returns success without appending', 'Returns an error to the app'],
          answer: 1,
          explain: 'The leader keeps the last 5 batches’ metadata per PID per partition (in memory, rebuilt from the log on failover, so it works across leader changes).',
        },
      },
      {
        title: 'Out of order',
        body: 'With 5 in-flight requests, batch 5 arrives before batch 4 (which failed and is being retried).',
        viz: { kind: 'seq', pid: 4012, epoch: 0, batches: [{ seq: 3, state: 'ok' }, { seq: 5, state: 'gap' }, { seq: 4, state: 'ok' }, { seq: 5, state: 'ok' }] },
        predict: {
          q: 'How does Kafka keep order?',
          options: ['It doesn’t', 'The leader rejects seq 5 with OutOfOrderSequence; the producer re-sends it after 4 succeeds', 'It buffers 5 until 4 arrives'],
          answer: 1,
          explain: 'This is why idempotence allows max.in.flight up to 5 while preserving order. Without it you need max.in.flight=1 for ordering.',
        },
      },
      {
        title: 'Scope: one session',
        body: 'A **restarted** producer gets a new PID, so it can’t dedupe what the old one sent. Cross-session dedupe needs a `transactional.id`, which maps to a stable PID and bumps the **epoch**. Any producer with an older epoch is **fenced** (a zombie).',
        viz: { kind: 'seq', pid: 4012, epoch: 1, batches: [{ seq: 0, state: 'new' }, { seq: 7, state: 'fenced' }], note: 'Zombie with epoch 0 is rejected: ProducerFenced.' },
      },
    ],
    design: [
      { decision: 'Dedupe on the broker by (PID, seq)', because: 'Constant memory per producer; no global message-id index.' },
      { decision: 'Default on since 3.0 (acks=all, idempotence=true)', because: 'Cheap and removes a whole class of duplicate/reorder bugs.' },
    ],
    interview: [
      { q: 'Does enable.idempotence give exactly-once?', a: 'Only exactly-once *writes* per partition for one producer session: no duplicates or reordering from retries. It doesn’t cover app-level resends after a restart, multiple partitions atomically, or consumer-side processing; that needs transactions and idempotent consumers.' },
    ],
  },
  /* -------------------------------------------------------------- */
  {
    id: 'transactions',
    title: 'Transactions & EOS',
    tagline: 'Coordinator, control markers and the last stable offset.',
    minutes: 8,
    oneLiner: 'A transaction coordinator logs state in __transaction_state; the producer writes to many partitions plus consumer offsets; commit writes control markers; read_committed consumers read up to the LSO.',
    frames: [
      {
        title: 'Begin',
        body: 'The producer with `transactional.id=agg-1` finds its **transaction coordinator** (the leader of a `__transaction_state` partition chosen by hashing the id) and calls `initTransactions()`, which fences older epochs and aborts any of their open transactions.',
        viz: { kind: 'txn', coordinator: 'Empty → Ongoing', parts: [{ name: 'out-0', recs: [{ label: 'a', s: 'plain' }] }, { name: 'out-1', recs: [] }, { name: '__consumer_offsets', recs: [] }] },
      },
      {
        title: 'Writes inside the transaction',
        body: 'Before writing to a new partition, the producer registers it with the coordinator (`AddPartitionsToTxn`). Records are appended to the real logs immediately, marked transactional. `sendOffsetsToTransaction()` adds the input offsets as part of the same transaction.',
        viz: { kind: 'txn', coordinator: 'Ongoing {out-0, out-1, offsets}', parts: [{ name: 'out-0', recs: [{ label: 'a', s: 'plain' }, { label: 'x1', s: 'open' }], lso: 1 }, { name: 'out-1', recs: [{ label: 'x2', s: 'open' }], lso: 0 }, { name: '__consumer_offsets', recs: [{ label: 'in-3 → 812', s: 'open' }] }] },
        predict: {
          q: 'A read_committed consumer polls out-0 now. What does it get?',
          options: ['a and x1', 'Only a: it stops at the last stable offset (first open transaction)', 'Nothing'],
          answer: 1,
          explain: 'The LSO is the offset of the earliest still-open transaction. A long transaction blocks read_committed consumers on that partition (lag that isn’t really lag).',
        },
      },
      {
        title: 'Commit: two phases',
        body: '`commitTransaction()`: the coordinator writes **PrepareCommit** to its log (the point of no return), then writes a **COMMIT control marker** into every partition involved, then **CompleteCommit**. Consumers see x1, x2 and the offsets atomically.',
        viz: { kind: 'txn', coordinator: 'PrepareCommit → CompleteCommit', parts: [{ name: 'out-0', recs: [{ label: 'a', s: 'plain' }, { label: 'x1', s: 'commit' }, { label: 'C', s: 'marker' }], lso: 3 }, { name: 'out-1', recs: [{ label: 'x2', s: 'commit' }, { label: 'C', s: 'marker' }], lso: 2 }, { name: '__consumer_offsets', recs: [{ label: 'in-3 → 812', s: 'commit' }, { label: 'C', s: 'marker' }] }] },
      },
      {
        title: 'Abort',
        body: 'On abort (or a timeout of `transaction.timeout.ms`), ABORT markers are written. The records stay in the log, but read_committed consumers skip them using the **aborted transaction index** (`.txnindex`). read_uncommitted consumers still see them.',
        viz: { kind: 'txn', coordinator: 'PrepareAbort → CompleteAbort', parts: [{ name: 'out-0', recs: [{ label: 'a', s: 'plain' }, { label: 'x1', s: 'abort' }, { label: 'A', s: 'marker' }] }, { name: 'out-1', recs: [{ label: 'x2', s: 'abort' }, { label: 'A', s: 'marker' }] }] },
      },
      {
        title: 'What EOS does not cover',
        body: 'Everything here is atomic **only across Kafka partitions**. An HTTP call, an email or a Postgres write inside your processing is outside the transaction and can happen twice. For those, use idempotency keys, or commit offsets inside the external DB transaction.',
        viz: { kind: 'path', title: 'EOS boundary', stages: [{ label: 'input topic', hot: true }, { label: 'process', hot: true }, { label: 'output topic', hot: true }, { label: 'external API', sub: 'outside!', skip: true }] },
      },
    ],
    design: [
      { decision: 'Write records immediately, commit with markers', because: 'No buffering of transactional data; the cost is the LSO and txn index for readers.' },
      { decision: 'Offsets committed as part of the transaction', because: 'Makes consume-process-produce atomic: output and progress move together.' },
      { decision: 'EOS v2 (KIP-447): one producer per instance', because: 'v1 needed a producer per input partition; v2 fences by consumer group generation instead.' },
    ],
    interview: [
      { q: 'Explain how Kafka transactions work.', a: 'transactional.id → coordinator and PID/epoch (fencing zombies). The producer registers partitions with the coordinator, writes records, and adds consumer offsets via sendOffsetsToTransaction. Commit is two-phase: PrepareCommit in __transaction_state, then COMMIT markers in each partition. read_committed consumers read up to the LSO and filter aborted records via the txn index.' },
    ],
  },
  /* -------------------------------------------------------------- */
  {
    id: 'rebalance',
    title: 'Consumer group rebalancing',
    tagline: 'Group coordinator, join/sync, eager vs cooperative, KIP-848.',
    minutes: 8,
    oneLiner: 'A group coordinator broker tracks members via heartbeats; on membership change members rejoin; the leader computes an assignment; eager revokes everything, cooperative-sticky only moves what must move; KIP-848 moves assignment to the broker.',
    frames: [
      {
        title: 'The group coordinator',
        body: 'Each group maps to a `__consumer_offsets` partition (hash of group.id). That partition’s leader is the group’s **coordinator**: it receives heartbeats, runs rebalances and stores committed offsets.',
        viz: { kind: 'group', phase: 'Stable', gen: 7, members: [{ name: 'c1', parts: ['p0', 'p1'], state: 'leader' }, { name: 'c2', parts: ['p2', 'p3'] }, { name: 'c3', parts: ['p4', 'p5'] }] },
      },
      {
        title: 'A member joins (eager)',
        body: 'c4 starts. The coordinator answers heartbeats with REBALANCE_IN_PROGRESS. Under the **eager** protocol every member revokes **all** partitions, commits, and sends JoinGroup.',
        viz: { kind: 'group', phase: 'PreparingRebalance', gen: 7, members: [{ name: 'c1', parts: [], state: 'revoking' }, { name: 'c2', parts: [], state: 'revoking' }, { name: 'c3', parts: [], state: 'revoking' }, { name: 'c4', parts: [], state: 'joining' }], note: 'Stop-the-world: nothing is consumed.' },
        predict: {
          q: 'Who decides the new assignment in the classic protocol?',
          options: ['The coordinator broker', 'The group leader (a consumer) runs the assignor and sends the result in SyncGroup', 'ZooKeeper'],
          answer: 1,
          explain: 'Client-side assignment lets you plug in custom assignors without upgrading brokers. KIP-848 (Kafka 4.0) moves it server-side.',
        },
      },
      {
        title: 'Sync and resume',
        body: 'The leader computes the assignment (range / round-robin / sticky) and sends it in **SyncGroup**; the coordinator hands each member its share. Generation 8 begins.',
        viz: { kind: 'group', phase: 'Stable', gen: 8, members: [{ name: 'c1', parts: ['p0', 'p1'], state: 'leader' }, { name: 'c2', parts: ['p2'] }, { name: 'c3', parts: ['p4'] }, { name: 'c4', parts: ['p3', 'p5'] }] },
      },
      {
        title: 'Cooperative-sticky',
        body: 'With `cooperative-sticky`, members keep their partitions during the first round; only partitions that must move are revoked, then a second, quick round assigns them. c1 never stops consuming p0 and p1.',
        viz: { kind: 'group', phase: 'Cooperative round 2', gen: 8, members: [{ name: 'c1', parts: ['p0', 'p1'], state: 'leader' }, { name: 'c2', parts: ['p2'], state: 'ok' }, { name: 'c3', parts: ['p4'], state: 'ok' }, { name: 'c4', parts: ['p3', 'p5'], state: 'joining' }], note: 'Only p3 and p5 moved.' },
      },
      {
        title: 'When members are kicked',
        body: 'Two timers: `session.timeout.ms` (45 s, missed heartbeats from the background thread, i.e. the process is dead) and `max.poll.interval.ms` (5 min, the *processing loop* didn’t call poll(), i.e. stuck or slow). The second one is what fires when a batch takes too long to process.',
        viz: { kind: 'group', phase: 'PreparingRebalance', gen: 8, members: [{ name: 'c1', parts: ['p0', 'p1'] }, { name: 'c2', parts: ['p2'], state: 'gone' }, { name: 'c3', parts: ['p4'] }, { name: 'c4', parts: ['p3', 'p5'] }], note: 'c2 exceeded max.poll.interval.ms → left the group.' },
      },
      {
        title: 'Static membership & KIP-848',
        body: '`group.instance.id` gives a member a stable identity: a restart within session.timeout reclaims the same partitions with **no rebalance**. **KIP-848** (GA in 4.0) replaces join/sync with a broker-driven, incremental protocol: no global barrier and much faster.',
        viz: { kind: 'group', phase: 'Stable (static)', gen: 8, members: [{ name: 'pod-0', parts: ['p0', 'p1'] }, { name: 'pod-1', parts: ['p2', 'p3'], state: 'joining' }, { name: 'pod-2', parts: ['p4', 'p5'] }], note: 'pod-1 restarts and gets p2,p3 back. Generation unchanged.' },
      },
    ],
    design: [
      { decision: 'Client-side assignors', because: 'Flexibility (e.g. Streams’ task assignor) without broker upgrades. The cost was the global barrier, now addressed by KIP-848.' },
      { decision: 'Separate heartbeat thread', because: 'Liveness (session.timeout) is decoupled from processing time (max.poll.interval).' },
    ],
    interview: [
      { q: 'What triggers a rebalance and how do you minimise its impact?', a: 'Members joining/leaving, session timeouts, exceeding max.poll.interval.ms, and partition count or subscription changes. Mitigate with cooperative-sticky, static membership, smaller max.poll.records or faster processing, proper shutdown (close() → leave group), and the KIP-848 protocol.' },
    ],
  },
  /* -------------------------------------------------------------- */
  {
    id: 'kraft',
    title: 'KRaft vs ZooKeeper',
    tagline: 'How cluster metadata is stored and replicated.',
    minutes: 6,
    oneLiner: 'KRaft replaces ZooKeeper with a Raft quorum of controllers that store metadata as an event log (__cluster_metadata); brokers replay it, so failover and partition limits improve dramatically.',
    frames: [
      {
        title: 'The ZooKeeper era',
        body: 'Metadata (brokers, topics, ISR, configs) lived in ZooKeeper. One broker was elected **controller** and pushed changes to brokers via RPCs. On controller failover the new controller had to **read everything from ZK**, which took minutes with 100k+ partitions.',
        viz: { kind: 'quorum', mode: 'zk', nodes: [{ name: 'zk1', role: 'zk', off: 0 }, { name: 'zk2', role: 'zk', off: 0 }, { name: 'zk3', role: 'zk', off: 0 }, { name: 'b1', role: 'controller', off: 0 }, { name: 'b2', role: 'observer', off: 0 }, { name: 'b3', role: 'observer', off: 0 }] },
      },
      {
        title: 'KRaft: metadata is a log',
        body: 'In KRaft, 3 (or 5) **controllers** form a Raft quorum over the `__cluster_metadata` topic. The active controller (Raft leader) appends records like `PartitionChangeRecord`; voters replicate them; a record is committed on a **majority**.',
        viz: { kind: 'quorum', mode: 'kraft', nodes: [{ name: 'c1', role: 'leader', off: 1042 }, { name: 'c2', role: 'voter', off: 1042 }, { name: 'c3', role: 'voter', off: 1040 }, { name: 'b1', role: 'observer', off: 1041 }, { name: 'b2', role: 'observer', off: 1042 }, { name: 'b3', role: 'observer', off: 1039 }] },
        predict: {
          q: 'How many controller failures can a 3-voter quorum survive?',
          options: ['0', '1', '2'],
          answer: 1,
          explain: 'Raft needs a majority (2 of 3). Use 5 voters to survive 2. Note the contrast with data partitions, where ISR replication survives RF−1.',
        },
      },
      {
        title: 'Brokers are observers',
        body: 'Brokers **fetch** the metadata log like followers and apply it to an in-memory image, with periodic snapshots. They know exactly which offset of metadata they’re at, so no more divergent metadata.',
        viz: { kind: 'quorum', mode: 'kraft', nodes: [{ name: 'c1', role: 'leader', off: 1050 }, { name: 'c2', role: 'voter', off: 1050 }, { name: 'c3', role: 'voter', off: 1050 }, { name: 'b1', role: 'observer', off: 1050 }, { name: 'b2', role: 'observer', off: 1050 }, { name: 'b3', role: 'observer', off: 1048 }] },
      },
      {
        title: 'Controller failover',
        body: 'c1 dies. c2 wins the election and is active almost instantly: it already has the whole metadata log in memory.',
        viz: { kind: 'quorum', mode: 'kraft', nodes: [{ name: 'c1', role: 'down', off: 1050 }, { name: 'c2', role: 'leader', off: 1051 }, { name: 'c3', role: 'voter', off: 1051 }, { name: 'b1', role: 'observer', off: 1051 }, { name: 'b2', role: 'observer', off: 1051 }, { name: 'b3', role: 'observer', off: 1050 }], note: 'Failover in milliseconds rather than minutes. Millions of partitions supported.' },
      },
    ],
    design: [
      { decision: 'Metadata as an event log', because: 'Kafka’s own abstraction: replayable, snapshot-able, and brokers can catch up incrementally.' },
      { decision: 'Raft for metadata, ISR for data', because: 'Metadata needs strong consensus with few writes; data needs RF−1 fault tolerance with high throughput.' },
      { decision: 'ZooKeeper removed in 4.0', because: 'One system to operate, secure and scale.' },
    ],
    interview: [
      { q: 'Why did Kafka remove ZooKeeper?', a: 'Operational burden of a second distributed system, slow controller failover (full metadata reload from ZK), and a partition count ceiling. KRaft stores metadata in a Raft-replicated log inside Kafka; standby controllers are hot and brokers consume metadata incrementally.' },
    ],
  },
  /* -------------------------------------------------------------- */
  {
    id: 'compaction',
    title: 'The log cleaner',
    tagline: 'How compaction rewrites segments and handles tombstones.',
    minutes: 5,
    oneLiner: 'The cleaner builds a key→latest-offset map over the dirty section, then copies older segments keeping only records whose offset matches the map; offsets are kept, tombstones expire after delete.retention.ms.',
    frames: [
      {
        title: 'Clean head, dirty tail',
        body: 'A compacted log has a **clean** section (already compacted, one record per key) and a **dirty** section (written since). The cleaner picks the log with the highest **dirty ratio** above `min.cleanable.dirty.ratio`.',
        viz: { kind: 'compaction', before: [{ o: 0, k: 'A', v: '1' }, { o: 1, k: 'B', v: '1' }, { o: 2, k: 'A', v: '2' }, { o: 3, k: 'C', v: '1' }, { o: 4, k: 'B', v: '2' }, { o: 5, k: 'A', v: '3' }, { o: 6, k: 'C', v: null }] },
      },
      {
        title: 'Build the offset map',
        body: 'Scan the dirty section and record the latest offset per key: A→5, B→4, C→6.',
        viz: { kind: 'compaction', before: [{ o: 0, k: 'A', v: '1' }, { o: 1, k: 'B', v: '1' }, { o: 2, k: 'A', v: '2' }, { o: 3, k: 'C', v: '1' }, { o: 4, k: 'B', v: '2' }, { o: 5, k: 'A', v: '3' }, { o: 6, k: 'C', v: null }], note: 'map: A→5, B→4, C→6' },
        predict: {
          q: 'After cleaning, which offsets remain?',
          options: ['0..6 renumbered 0..2', '4, 5, 6 (offsets unchanged; gaps are fine)', 'Only 5'],
          answer: 1,
          explain: 'Offsets never change. Consumers just see gaps. C’s tombstone (6) is kept for delete.retention.ms so consumers learn C was deleted, then it’s removed too.',
        },
      },
      {
        title: 'Copy and swap',
        body: 'Each old segment is copied into a new one, keeping only records whose offset equals the map value for their key. The new segment is swapped in atomically.',
        viz: { kind: 'compaction', before: [{ o: 0, k: 'A', v: '1' }, { o: 1, k: 'B', v: '1' }, { o: 2, k: 'A', v: '2' }, { o: 3, k: 'C', v: '1' }, { o: 4, k: 'B', v: '2' }, { o: 5, k: 'A', v: '3' }, { o: 6, k: 'C', v: null }], after: [{ o: 4, k: 'B', v: '2' }, { o: 5, k: 'A', v: '3' }, { o: 6, k: 'C', v: null }] },
      },
    ],
    design: [
      { decision: 'Never touch the active segment', because: 'Writers never contend with the cleaner. The consequence is that recent duplicates remain.' },
      { decision: 'Bounded dedupe buffer', because: '`log.cleaner.dedupe.buffer.size` caps memory, so huge key spaces are cleaned in several passes.' },
    ],
    interview: [
      { q: 'How does log compaction work?', a: 'A background cleaner thread picks the dirtiest log, builds a key → last offset map over the dirty portion, rewrites older segments keeping only the latest record per key (preserving offsets and order), and swaps them in. Tombstones (null values) remove keys after delete.retention.ms. The active segment is never compacted.' },
    ],
  },
];

export const diveById = (id: string | undefined) => DIVES.find((d) => d.id === id);
