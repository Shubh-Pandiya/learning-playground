import { count, flowing, handles, noFlag, noLag, ordAtLeast, semAtLeast, survivesBrokerLoss, type Ctx, type Requirement } from '../engine/check';
import { cfgOf } from '../engine/defaults';
import { COL, ROW, graph, n, type Lesson } from './lesson';

export const R = (id: string, label: string, why: string, test: (c: Ctx) => boolean, hint?: string): Requirement => ({ id, label, why, test, hint });
export const topicCfg = (c: Ctx) => c.g.nodes.filter((x) => x.kind === 'topic').map(cfgOf);
export const groupCfg = (c: Ctx) => c.g.nodes.filter((x) => x.kind === 'group' || x.kind === 'streams').map(cfgOf);
export const svcCfg = (c: Ctx) => c.g.nodes.filter((x) => x.kind === 'service').map(cfgOf);

/* ================================================================== */
/* 1. Partitions, keys and ordering                                    */
/* ================================================================== */

const l1start = graph(
  [
    n('service', 'api', COL.a, ROW(1), { rate: 2000, key: 'entity' }, 'orders-api'),
    n('topic', 'orders', COL.b, ROW(1), { partitions: 1 }, 'orders'),
    n('group', 'ful', COL.c, ROW(1), { consumers: 1, procMs: 0.4 }, 'fulfillment'),
  ],
  ['api>orders', 'orders>ful'],
);

export const L1: Lesson = {
  id: 'partitions',
  n: 1,
  title: 'Partitions, keys & ordering',
  tagline: 'The unit of parallelism is also the unit of ordering.',
  minutes: 12,
  concepts: ['partition = append-only log', 'offsets', 'key → partition (murmur2)', 'per-key ordering', 'one consumer per partition per group', 'hot keys', 'adding partitions remaps keys'],
  problem: 'Order events (Created → Paid → Shipped / Cancelled) must be processed in order per order, but one consumer can’t keep up. You need parallelism without scrambling each order’s history.',
  stage: l1start,
  learn: [
    {
      title: 'A topic is a set of append-only logs',
      body: 'Each **partition** is an ordered, immutable log on disk. A producer appends to the end; every record gets the next **offset** (0, 1, 2…). Consumers don’t delete anything. They just remember the offset they’ve reached. Right now `orders` has 1 partition and `fulfillment` has 1 consumer: total order, and no parallelism.',
      internals: 'On disk a partition is a directory `orders-0/` of segment files: `00000000000000000000.log` (record batches), a sparse `.index` (offset → byte position) and `.timeindex`. Appends are sequential writes into the OS page cache, which is why a single partition can take 10+ MB/s on commodity disks.',
      focus: 'orders',
    },
    {
      title: 'Black Friday: traffic triples',
      body: 'Traffic grows to 6,000/s. Each fulfillment pod handles ~2,500/s, so you scale to 3 pods.',
      predict: {
        q: 'Traffic triples to 6,000/s and you run 3 fulfillment pods against the 1-partition topic. What happens?',
        options: ['Throughput triples and lag stays flat', 'Two pods sit idle and lag keeps growing', 'Each pod gets a third of the partition’s records', 'Kafka round-robins records across the pods'],
        answer: 1,
        explain: 'Within one consumer group a partition is owned by exactly **one** member, which is how Kafka keeps per-partition order without locks. With 1 partition, 1 pod does all the work and 2 pods sit idle. Lag grows at 6,000 − 2,500 = 3,500 records/s.',
      },
      ops: [{ set: ['api', { rate: 6000 }] }, { set: ['ful', { consumers: 3 }] }],
      focus: 'ful',
    },
    {
      title: 'Partitions are the unit of parallelism',
      body: 'Go to **6 partitions**. The group coordinator assigns 2 partitions to each pod, so all 3 work and lag stops growing. The rule: **max useful consumers in a group = number of partitions.** The price: order is now only guaranteed *within* a partition, not across the topic.',
      ops: [{ set: ['orders', { partitions: 6 }] }],
      internals: 'One broker per consumer group is the **group coordinator** (chosen by hash(group.id) % partitions of `__consumer_offsets`). Members send JoinGroup; one is elected leader, runs the assignor (Range by default) and sends the plan back in SyncGroup.',
      focus: 'orders',
    },
    {
      title: 'Random keys: the tempting mistake',
      body: 'A teammate wants “perfectly even load” and sends records with a random key.',
      predict: {
        q: 'Order #42 emits Created, Paid, Cancelled with random keys across 6 partitions. What can fulfillment observe?',
        options: ['Always Created → Paid → Cancelled', 'Cancelled can be processed before Created', 'Kafka rejects records without a stable key', 'Only the latest event is delivered'],
        answer: 1,
        explain: 'The three events land on different partitions, owned by different pods that run in parallel. Nothing orders them relative to each other, so “Cancelled” can be handled while “Created” is still queued on another partition.',
      },
      ops: [{ set: ['api', { key: 'random' }] }],
      focus: 'api',
    },
    {
      title: 'Key by the entity that needs ordering',
      body: 'Key every event by **orderId**. The default partitioner computes `murmur2(keyBytes) % numPartitions`, so the same order always lands on the same partition, is read by one pod, in offset order. You get parallelism *across* orders and ordering *within* each order.',
      ops: [{ set: ['api', { key: 'entity' }] }],
      internals: 'Records **without** a key use the sticky partitioner (KIP-480): fill a batch for one partition, then switch. That gives big batches but no ordering. With a key, the partition is fixed by the hash.',
      focus: 'orders',
    },
    {
      title: 'Hot keys: when hashing isn’t enough',
      body: 'Someone keys by **merchantId** instead, and one marketplace giant is ~40% of all orders.',
      predict: {
        q: 'One key is 40% of traffic. You double partitions from 6 to 12. Does the lag go away?',
        options: ['Yes, the load spreads across twice as many partitions', 'No, the hot key still maps to one partition owned by one pod', 'Yes, Kafka splits hot keys automatically', 'No, but adding consumers will fix it'],
        answer: 1,
        explain: 'A key always hashes to exactly one partition, so 40% of the traffic still flows through one partition, one leader broker and one consumer. More partitions only spread the *other* 60%. Fixes: key by a finer entity (orderId), or **salt** the hot key (`merchant-7#0..3`) and merge downstream if order across the salt doesn’t matter.',
      },
      ops: [{ set: ['api', { key: 'hot' }] }, { set: ['orders', { partitions: 12 }] }],
      focus: 'orders',
    },
    {
      title: 'Choose the partition count up front',
      body: 'Back to keying by orderId. One more trap: **adding partitions to a live keyed topic remaps keys** (`hash % 12 ≠ hash % 6`). Order #42’s new events can land on a different partition than its old ones, so ordering breaks during the change, and compacted topics end up with the old value in one partition and the new in another. Size for 1–2 years of growth: `partitions ≥ max(target MB/s ÷ per-partition MB/s, target msg/s ÷ per-consumer msg/s)`.',
      ops: [{ set: ['api', { key: 'entity' }] }],
    },
  ],
  build: {
    title: 'Order events with per-order ordering',
    story: '`orders-api` emits 6,000 events/s. Fulfillment takes ~1 ms per event (≈1,000/s per pod). Each order’s events must be handled in order, and Black Friday can double the traffic.',
    start: graph(
      [
        n('service', 'api', COL.a, ROW(1), { rate: 6000, key: 'random' }, 'orders-api'),
        n('topic', 'orders', COL.b, ROW(1), { partitions: 1 }, 'orders'),
        n('group', 'ful', COL.c, ROW(1), { consumers: 1, procMs: 1 }, 'fulfillment'),
      ],
      ['api>orders', 'orders>ful'],
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('flow', 'Events flow orders-api → fulfillment', 'Nothing else matters if events don’t arrive.', (c) => flowing(c.m)),
      R('order', 'Per-order ordering', 'A Cancelled processed before Created ships a cancelled order.', (c) => ordAtLeast(c.m, 'per-key'), 'Set the producer key strategy to “entity id” (orderId).'),
      R('lag', 'No growing lag at today’s load', 'Lag = customers waiting.', (c) => noLag(c.m), 'Throughput = active consumers × 1,000/s. Active consumers ≤ partitions.'),
      R('idle', 'No idle consumers', 'You pay for pods that do nothing.', (c) => noFlag(c.m, 'idle:'), 'Consumers ≤ partitions.'),
      R('peak', 'Survives a 2× Black Friday spike', 'Repartitioning mid-peak remaps keys. Size for the peak up front.', (c) => handles(c, 2), '12,000/s ÷ 1,000/s per consumer = 12 consumers, so ≥ 12 partitions.'),
    ],
    hints: ['Two separate problems: ordering (the key) and throughput (partitions × consumers).', 'Key by orderId. One partition is read by one consumer, so parallelism = partitions.', 'Key: entity id. Partitions 12, consumers 12.'],
    reference: graph(
      [
        n('service', 'api', COL.a, ROW(1), { rate: 6000, key: 'entity' }, 'orders-api'),
        n('topic', 'orders', COL.b, ROW(1), { partitions: 12 }, 'orders'),
        n('group', 'ful', COL.c, ROW(1), { consumers: 12, procMs: 1 }, 'fulfillment'),
      ],
      ['api>orders', 'orders>ful'],
    ),
    debrief: 'Partition count is a capacity decision you make once: per-consumer throughput sets it. The key decides *what* stays ordered. Pick the smallest entity whose events must be sequential (order, account, device), not a coarse one (merchant, tenant) that creates hot partitions.',
  },
  challenge: {
    title: 'IoT telemetry, ordered per device',
    story: '200k devices send 30,000 readings/s in total. The anomaly detector needs each device’s readings in order and takes 0.5 ms per reading. Firmware teams sent readings with **no key**. Handle 2× growth.',
    start: graph(
      [
        n('service', 'iot', COL.a, ROW(1), { rate: 30000, msgBytes: 200, key: 'null' }, 'device-gateway'),
        n('topic', 'tel', COL.b, ROW(1), { partitions: 6 }, 'telemetry'),
        n('group', 'det', COL.c, ROW(1), { consumers: 6, procMs: 0.5 }, 'anomaly-detector'),
      ],
      ['iot>tel', 'tel>det'],
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('order', 'Readings ordered per device', 'Out-of-order readings create false anomalies.', (c) => ordAtLeast(c.m, 'per-key')),
      R('lag', 'No growing lag', '', (c) => noLag(c.m)),
      R('idle', 'No idle consumers', '', (c) => noFlag(c.m, 'idle:')),
      R('peak', 'Handles 2× growth', '', (c) => handles(c, 2)),
    ],
    hints: ['Null keys use the sticky partitioner, which gives no per-device order.', 'Each detector does 2,000/s. At 60,000/s that is 30 consumers.', 'Key by deviceId, 30 partitions, 30 consumers.'],
    reference: graph(
      [
        n('service', 'iot', COL.a, ROW(1), { rate: 30000, msgBytes: 200, key: 'entity' }, 'device-gateway'),
        n('topic', 'tel', COL.b, ROW(1), { partitions: 30 }, 'telemetry'),
        n('group', 'det', COL.c, ROW(1), { consumers: 30, procMs: 0.5 }, 'anomaly-detector'),
      ],
      ['iot>tel', 'tel>det'],
    ),
    debrief: 'Same reasoning, new domain. That transfer is the skill. Note that 30 partitions with 30 consumers is exactly at capacity at 2×. In production you’d round up (36 or 48) and watch the per-partition rate.',
  },
  quiz: [
    { q: 'A group has 10 consumers reading a 4-partition topic. How many are actively consuming?', options: ['10', '4', '1', '5'], answer: 1, explain: 'One member per partition; 6 are idle standbys.' },
    { q: 'What does Kafka guarantee about ordering?', options: ['Total order per topic', 'Order per partition', 'Order per producer across topics', 'Order per consumer group'], answer: 1, explain: 'Offsets are ordered within a partition only. Keys give per-key order because a key maps to one partition.' },
    { q: 'You go from 8 to 16 partitions on a keyed topic. Biggest risk?', options: ['Brokers restart', 'Keys move to different partitions, so per-key order breaks across the change', 'Old data is deleted', 'Consumers lose their offsets'], answer: 1, explain: 'hash(key) % 16 ≠ hash(key) % 8 for half the keys. Existing data is not moved.' },
  ],
  takeaways: [
    'Partition = ordered log = unit of parallelism. Useful consumers ≤ partitions.',
    'Key by the entity that needs ordering: murmur2(key) % partitions.',
    'Hot keys can’t be fixed by more partitions. Use a finer key or salt it.',
    'Size partitions up front. Adding them remaps keys.',
  ],
  interview: [
    { q: 'How do you guarantee all events for a user are processed in order while scaling consumers?', a: 'Key by userId so they hash to one partition. One partition is read by one consumer in the group, in offset order. Scale by adding partitions (planned up front) and consumers up to the partition count. Watch out for producer retries reordering (use idempotence) and for retry topics breaking order.' },
    { q: 'How many partitions would you create?', a: 'Measure per-partition producer throughput (≈10 MB/s) and per-consumer throughput. partitions = max(target / producer-per-partition, target / consumer-per-instance), plus 1–2 years of growth headroom, because adding partitions later remaps keys. Avoid thousands per broker: failover and memory costs grow.' },
  ],
  deepDives: ['log', 'partitioner'],
};

/* ================================================================== */
/* 2. Durability: replication, acks, ISR                               */
/* ================================================================== */

export const L2: Lesson = {
  id: 'durability',
  n: 2,
  title: 'Replication, acks & ISR',
  tagline: 'What does “acknowledged” actually promise?',
  minutes: 14,
  concepts: ['leader / follower', 'replication factor', 'ISR', 'acks=0/1/all', 'min.insync.replicas', 'high watermark', 'NotEnoughReplicas', 'unclean leader election'],
  problem: 'Payments must never be lost once the API has said “accepted”, even when a broker dies mid-write. But the system should keep accepting payments during routine broker restarts.',
  stage: graph(
    [
      n('service', 'api', COL.a, ROW(1), { rate: 3000, acks: '1', idempotence: false }, 'payments-api'),
      n('topic', 'pay', COL.b, ROW(1), { partitions: 6, rf: 1, minIsr: 1 }, 'payments'),
      n('group', 'led', COL.c, ROW(1), { consumers: 6, procMs: 0.5 }, 'ledger-writer'),
      n('sink', 'db', COL.d, ROW(1), { idempotentSink: true }, 'ledger-db'),
    ],
    ['api>pay', 'pay>led', 'led>db'],
  ),
  learn: [
    {
      title: 'One copy of every payment',
      body: '`payments` has **RF=1**: each partition lives on one broker. The producer uses **acks=1**: the leader confirms as soon as the batch is in *its* log.',
      internals: 'Every partition has one **leader** that serves all reads and writes. Replicas live on different brokers. Placement spreads leaders round-robin so load is even.',
      ops: [],
      focus: 'pay',
    },
    {
      title: 'A broker dies',
      body: 'Broker 2 loses its disk.',
      predict: {
        q: 'With RF=1, broker 2 goes down. What happens?',
        options: ['Another broker takes over its partitions', 'Its partitions go offline; writes to them fail and the data is gone if the disk is lost', 'Producers buffer forever and nothing is lost', 'Only reads fail'],
        answer: 1,
        explain: 'No other broker has a copy, so there’s nothing to elect. Those partitions are **offline** until broker 2 returns. If the disk is gone, so is the data.',
      },
      chaos: { brokersDown: [2] },
      focus: 'pay',
    },
    {
      title: 'Replicate: RF=3',
      body: 'Each partition now has a leader plus 2 **followers** on other brokers. Followers fetch from the leader like consumers do. The **ISR** (in-sync replicas) is the leader plus followers that are caught up within `replica.lag.time.max.ms` (30 s).',
      ops: [{ set: ['pay', { rf: 3 }] }],
      internals: 'Each replica tracks its **LEO** (log end offset). The leader sets the **high watermark** = min LEO across the ISR. Consumers can only read below the HW, so they never see a record that could still disappear in a failover.',
      focus: 'pay',
    },
    {
      title: 'acks=1 with replication still loses data',
      body: 'Kill the leader for some partitions (broker 1).',
      predict: {
        q: 'acks=1, RF=3. The leader acks a payment, then dies before followers fetch it. What happens to that payment?',
        options: ['Safe: it’s replicated', 'Lost: a follower without it becomes leader, yet the client got “success”', 'The producer retries automatically', 'Consumers already have it'],
        answer: 1,
        explain: 'acks=1 means “the leader has it”. The new leader is elected from the ISR, which never got that record. The old leader truncates its log to match when it returns. The client was told success, so this is silent loss.',
      },
      chaos: { brokersDown: [1] },
      focus: 'api',
    },
    {
      title: 'acks=all + min.insync.replicas=2',
      body: '**acks=all**: the leader waits until every *current* ISR member has the batch (the HW passes it). **min.insync.replicas=2**: refuse the write if the ISR has fewer than 2 members. Together, an ack means “on at least 2 brokers”. Idempotence (on by default since Kafka 3.0) also requires acks=all.',
      ops: [{ set: ['api', { acks: 'all', idempotence: true }] }, { set: ['pay', { minIsr: 2 }] }],
      focus: 'pay',
    },
    {
      title: 'Two brokers down',
      body: 'Brokers 1 and 2 both fail.',
      predict: {
        q: 'RF=3, min.insync=2, acks=all. Two of three brokers are down. What do producers and consumers see?',
        options: ['Everything works on the remaining broker', 'Producers get NotEnoughReplicas; consumers can still read', 'Both fail', 'Writes succeed but are lost later'],
        answer: 1,
        explain: 'Each partition still has a leader (the last replica), so reads work. But the ISR is 1 < 2, so acks=all writes are rejected. Kafka chooses **consistency over availability**, which is right for payments. The producer retries until `delivery.timeout.ms` (2 min) runs out.',
      },
      chaos: { brokersDown: [1, 2] },
      focus: 'pay',
    },
    {
      title: '“Max safety” that blocks every restart',
      body: 'Someone sets `min.insync.replicas=3` “to be extra safe”, then does a rolling restart.',
      predict: {
        q: 'RF=3 and min.insync=3. Broker 3 restarts for a patch. What happens?',
        options: ['Nothing; it’s a restart', 'Every partition with a replica on broker 3 rejects writes until it’s back', 'Data is lost', 'Kafka lowers min.insync automatically'],
        answer: 1,
        explain: 'Any single replica going away makes the ISR 2 < 3. Rule of thumb: **min.insync = RF − 1**, so you tolerate 1 broker down for writes and keep 2 copies of every ack.',
      },
      ops: [{ set: ['pay', { minIsr: 3 }] }],
      chaos: { brokersDown: [3] },
      focus: 'pay',
    },
    {
      title: 'Unclean leader election',
      body: 'Imagine RF=2, min.insync=1 and `unclean.leader.election.enable=true`. Broker 2’s follower fell behind (slow disk) and dropped out of the ISR. Then the leader on broker 1 dies. The only replica left is **out of sync**. With unclean election on, it becomes leader anyway: available, but every record it hadn’t fetched is **gone**. Kafka keeps this off by default.',
      ops: [{ set: ['pay', { rf: 2, minIsr: 1, unclean: true }] }],
      chaos: { slowBroker: 2, brokersDown: [1] },
      focus: 'pay',
    },
    {
      title: 'The production default',
      body: 'Back to **RF=3, min.insync=2, acks=all, idempotence on, unclean off**. Kill any one broker: leaders move within seconds, writes continue, nothing acked is lost.',
      ops: [{ set: ['pay', { rf: 3, minIsr: 2, unclean: false }] }],
      chaos: { brokersDown: [2] },
      internals: 'Leader epochs (KIP-101) replace HW-based truncation: a returning replica asks the new leader where its epoch ended and truncates exactly there. This avoids the old “HW lag” divergence bugs.',
    },
  ],
  build: {
    title: 'A payments topic you can trust',
    story: 'The payments API accepts 3,000 payments/s and replies “accepted” once Kafka acks. The ledger consumer writes to a ledger DB. Platform team: brokers get patched weekly (one at a time).',
    start: graph(
      [
        n('service', 'api', COL.a, ROW(1), { rate: 3000, acks: '1', idempotence: false }, 'payments-api'),
        n('topic', 'pay', COL.b, ROW(1), { partitions: 6, rf: 1, minIsr: 1 }, 'payments'),
        n('group', 'led', COL.c, ROW(1), { consumers: 6, procMs: 0.5 }, 'ledger-writer'),
        n('sink', 'db', COL.d, ROW(1), { idempotentSink: true }, 'ledger-db'),
      ],
      ['api>pay', 'pay>led', 'led>db'],
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('acked', 'Every acked payment is on ≥ 2 brokers', 'An ack is a promise to the customer.', (c) => c.m.metrics.durability.level === 2, 'acks=all and min.insync.replicas ≥ 2.'),
      R('b1', 'Any one broker can fail: writes continue, nothing lost', 'Weekly patching must not cause an outage.', survivesBrokerLoss, 'RF must exceed min.insync.replicas.'),
      R('noloss', 'No payment lost end to end', '', (c) => semAtLeast(c.m, 'at-least-once')),
      R('unclean', 'Unclean leader election off', '', (c) => noFlag(c.m, 'unclean')),
    ],
    hints: ['Two layers: copies on brokers (RF), and what the producer waits for (acks + min.insync).', 'RF=1 means no failover. acks=1 acks before replication.', 'acks=all, idempotence on, RF=3, min.insync.replicas=2.'],
    reference: graph(
      [
        n('service', 'api', COL.a, ROW(1), { rate: 3000, acks: 'all', idempotence: true }, 'payments-api'),
        n('topic', 'pay', COL.b, ROW(1), { partitions: 6, rf: 3, minIsr: 2 }, 'payments'),
        n('group', 'led', COL.c, ROW(1), { consumers: 6, procMs: 0.5 }, 'ledger-writer'),
        n('sink', 'db', COL.d, ROW(1), { idempotentSink: true }, 'ledger-db'),
      ],
      ['api>pay', 'pay>led', 'led>db'],
    ),
    debrief: 'RF − min.insync = brokers you can lose and still write. min.insync = copies behind every ack. RF=3/min.insync=2/acks=all balances both, and costs ~3–5 ms of produce latency for the follower round trip.',
  },
  challenge: {
    title: 'Regulated audit log: survive two failures',
    story: 'Healthcare audit events (500/s) on a 5-broker cluster. Compliance: writes must continue with **any two** brokers down (one in maintenance, one failing), and every acknowledged record must exist on **at least 3** brokers.',
    start: graph(
      [
        n('service', 'emr', COL.a, ROW(1), { rate: 500 }, 'emr-service'),
        n('topic', 'aud', COL.b, ROW(1), { partitions: 6, rf: 3, minIsr: 2, retentionH: -1 }, 'audit-events'),
        n('group', 'arc', COL.c, ROW(1), { consumers: 2, procMs: 1 }, 'archiver'),
      ],
      ['emr>aud', 'aud>arc'],
      5,
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('three', 'Each ack means ≥ 3 copies', '', (c) => topicCfg(c).every((t) => t.minIsr >= 3) && svcCfg(c).every((s) => s.acks === 'all')),
      R('two', 'Writes continue with any 2 brokers down', '', (c) => {
        for (let a = 1; a <= c.g.cluster.brokers; a++)
          for (let b = a + 1; b <= c.g.cluster.brokers; b++) {
            const m = c.under({ brokersDown: [a, b] });
            if (m.metrics.errorRate > 0.001) return false;
          }
        return true;
      }),
      R('ok', 'Nothing offline or unclean', '', (c) => noFlag(c.m, 'off:') && noFlag(c.m, 'unclean')),
    ],
    hints: ['Writes need ISR ≥ min.insync after losing 2 replicas.', 'RF − 2 ≥ min.insync and min.insync ≥ 3.', 'RF=5, min.insync.replicas=3, acks=all.'],
    reference: graph(
      [
        n('service', 'emr', COL.a, ROW(1), { rate: 500 }, 'emr-service'),
        n('topic', 'aud', COL.b, ROW(1), { partitions: 6, rf: 5, minIsr: 3, retentionH: -1 }, 'audit-events'),
        n('group', 'arc', COL.c, ROW(1), { consumers: 2, procMs: 1 }, 'archiver'),
      ],
      ['emr>aud', 'aud>arc'],
      5,
    ),
    debrief: 'Generalise: to tolerate **f** failures for writes and keep **d** copies per ack, you need min.insync ≥ d and RF ≥ min.insync + f. The cost is RF× the disk and replication bandwidth, so it’s reserved for the data that justifies it.',
  },
  quiz: [
    { q: 'RF=3, min.insync=2, acks=all. How many brokers can fail with writes still succeeding?', options: ['0', '1', '2', '3'], answer: 1, explain: 'With 2 down the ISR is 1 < 2, so writes are rejected (reads still work).' },
    { q: 'What is the high watermark?', options: ['The leader’s last offset', 'The highest offset replicated to all ISR members; consumers read only below it', 'The retention limit', 'The committed consumer offset'], answer: 1, explain: 'HW = min(LEO over ISR). It stops consumers from reading records that a failover could erase.' },
    { q: 'acks=all with min.insync.replicas=1. Is an acked record safe?', options: ['Yes, always', 'Not if the ISR has shrunk to just the leader: then acks=all = acks=1', 'Only with idempotence', 'Only with RF ≥ 5'], answer: 1, explain: 'acks=all waits for the *current* ISR. min.insync puts a floor on its size.' },
  ],
  takeaways: [
    'acks=all waits for the current ISR, and min.insync.replicas puts a floor on it.',
    'RF − min.insync = failures tolerated for writes. min.insync = copies behind each ack.',
    'NotEnoughReplicas is Kafka choosing consistency. Unclean election chooses availability and loses data.',
    'Consumers only read below the high watermark.',
  ],
  interview: [
    { q: 'Walk me through what happens when a Kafka leader dies.', a: 'The controller (KRaft quorum) notices the broker’s heartbeats stopped, fences it, and picks a new leader from the ISR for each partition it led. It bumps the leader epoch and propagates metadata. Producers and consumers get NOT_LEADER errors, refresh metadata and retry against the new leader. With acks=all + min.insync=2 no acked data is lost. With acks=1, records only on the old leader are lost.' },
    { q: 'Trade-off between durability and availability in Kafka?', a: 'min.insync.replicas and unclean.leader.election. A high min.insync blocks writes when replicas are down (consistency). Unclean election lets an out-of-sync replica lead (availability, with data loss). Business data: RF=3, min.insync=2, unclean off. Metrics/logs: can relax.' },
  ],
  deepDives: ['replication', 'kraft'],
};

/* ================================================================== */
/* 3. Producer throughput: batching, linger, compression              */
/* ================================================================== */

export const L3: Lesson = {
  id: 'throughput',
  n: 3,
  title: 'Batching, linger & compression',
  tagline: 'Throughput is won in the producer, not the broker.',
  minutes: 12,
  concepts: ['record batches', 'batch.size', 'linger.ms', 'compression (zstd/lz4)', 'request rate vs bytes', 'broker sizing', 'too many partitions'],
  problem: 'A clickstream goes from 100k to 1M events/s. Brokers are saturating and adding hardware is expensive. You need to get more out of each broker.',
  stage: graph(
    [
      n('service', 'web', COL.a, ROW(1), { rate: 100000, msgBytes: 1000, key: 'random', lingerMs: 0, batchKb: 16, compression: 'none' }, 'web-tracker'),
      n('topic', 'clicks', COL.b, ROW(1), { partitions: 48, retentionH: 24 }, 'clicks'),
      n('group', 'load', COL.c, ROW(1), { consumers: 48, procMs: 0.02 }, 'warehouse-loader'),
      n('sink', 'wh', COL.d, ROW(1), { capacity: 3000000, idempotentSink: true }, 'warehouse'),
    ],
    ['web>clicks', 'clicks>load', 'load>wh'],
  ),
  learn: [
    {
      title: '100k clicks/s',
      body: 'Each click is ~1 KB of JSON. The producer sends with `linger.ms=0` and `batch.size=16KB` and no compression. Look at the broker load in the cluster view.',
      internals: 'The producer’s `RecordAccumulator` keeps one in-progress batch per partition. A sender thread drains ready batches (full, or older than linger.ms) and groups them by leader broker into one ProduceRequest each.',
      focus: 'web',
    },
    {
      title: '10× traffic',
      body: 'Marketing launches. Traffic goes to 1M/s.',
      predict: {
        q: '1M × 1 KB/s with RF=3 on 3 brokers, no compression. What breaks first?',
        options: ['Consumers', 'Broker network/disk: 1 GB/s in, 3 GB/s with replication', 'ZooKeeper', 'Nothing; Kafka handles millions/s'],
        answer: 1,
        explain: 'Every byte is written RF times: 1 GB/s × 3 = 3 GB/s across 3 brokers, so ~1 GB/s each, about 5× what a broker sustains here (~200 MB/s). Produce latency explodes and requests time out.',
      },
      ops: [{ set: ['web', { rate: 1000000 }] }],
      focus: 'web',
    },
    {
      title: 'Compress the batch',
      body: '`compression.type=zstd`. The producer compresses whole **batches** (more records means better ratio). The broker stores the compressed batch as is and consumers decompress, so network, disk *and* replication all shrink. JSON typically compresses 3–5×.',
      ops: [{ set: ['web', { compression: 'zstd' }] }],
      internals: 'The broker only re-compresses if the topic’s `compression.type` differs from the producer’s. Keep topic compression=producer so batches stay zero-copy all the way to consumers (sendfile).',
      focus: 'web',
    },
    {
      title: 'Still over: add brokers',
      body: 'Compression got us to ~1.3× capacity. Six brokers spread leaders and replicas. In real life, new brokers start **empty**: you move partitions with `kafka-reassign-partitions` or Cruise Control, which throttles replication traffic.',
      ops: [{ cluster: { brokers: 6 } }],
    },
    {
      title: '“More partitions = more throughput”?',
      body: 'Someone raises partitions to 600 “for parallelism”, still with `linger.ms=0`.',
      predict: {
        q: '1M/s over 600 partitions with linger.ms=0. What happens to the brokers?',
        options: ['Load drops because it’s more spread', 'Batches shrink to ~3 records, so the request rate explodes and compression stops working', 'Nothing changes', 'Consumers get faster'],
        answer: 1,
        explain: 'Per partition it’s only ~1.6k records/s, so a 2 ms window holds ~3 records. That means ~10× more requests to process, and tiny batches compress badly. Brokers are now bound by **request rate**, not bytes.',
      },
      ops: [{ set: ['clicks', { partitions: 600 }] }],
      focus: 'clicks',
    },
    {
      title: 'linger.ms trades a little latency for big batches',
      body: '`linger.ms=20` + `batch.size=64KB`: the producer waits up to 20 ms to fill a batch. Batches grow ~10×, requests drop ~10×, and compression works again. Produce p99 goes up by roughly the linger time. That’s fine for analytics, but not for a trading engine.',
      ops: [{ set: ['web', { lingerMs: 20, batchKb: 64 }] }],
      internals: 'Since Kafka 3.x the default batch.size is 16 KB and linger.ms is 5 ms (KIP-1030). High-throughput producers typically use 64–256 KB and 10–50 ms. `buffer.memory` (32 MB) caps unsent data; when full, `send()` blocks up to max.block.ms.',
      focus: 'web',
    },
  ],
  build: {
    title: 'Clickstream at 1M events/s on a budget',
    story: 'The web tracker emits 1M clicks/s (~1 KB JSON). It loads into the warehouse. Finance approved **at most 6 brokers**. Product wants clicks visible within a second, and the data must survive a broker failure.',
    start: graph(
      [
        n('service', 'web', COL.a, ROW(1), { rate: 1000000, msgBytes: 1000, key: 'random', lingerMs: 0, batchKb: 16, compression: 'none' }, 'web-tracker'),
        n('topic', 'clicks', COL.b, ROW(1), { partitions: 48, retentionH: 24 }, 'clicks'),
        n('group', 'load', COL.c, ROW(1), { consumers: 48, procMs: 0.02 }, 'warehouse-loader'),
        n('sink', 'wh', COL.d, ROW(1), { capacity: 3000000, idempotentSink: true }, 'warehouse'),
      ],
      ['web>clicks', 'clicks>load', 'load>wh'],
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('rate', 'Sustains 1.3M/s (30% headroom)', '', (c) => handles(c, 1.3), 'Bytes per broker = MB/s × RF ÷ brokers. Compression cuts MB/s.'),
      R('lat', 'Produce p99 < 100 ms', '', (c) => c.m.metrics.produceP99 < 100),
      R('dur', 'Survives a broker failure without loss', '', (c) => c.m.metrics.durability.level === 2),
      R('budget', 'At most 6 brokers', 'Every broker is ~$2k/month.', (c) => c.g.cluster.brokers <= 6),
    ],
    hints: ['Look at the bottleneck: is it bytes or requests?', 'zstd shrinks JSON ~4×. Bigger batches compress better and mean fewer requests.', '6 brokers, zstd, linger.ms 10, batch.size 128 KB.'],
    reference: graph(
      [
        n('service', 'web', COL.a, ROW(1), { rate: 1000000, msgBytes: 1000, key: 'random', lingerMs: 10, batchKb: 128, compression: 'zstd' }, 'web-tracker'),
        n('topic', 'clicks', COL.b, ROW(1), { partitions: 48, retentionH: 24 }, 'clicks'),
        n('group', 'load', COL.c, ROW(1), { consumers: 48, procMs: 0.02 }, 'warehouse-loader'),
        n('sink', 'wh', COL.d, ROW(1), { capacity: 3000000, idempotentSink: true }, 'warehouse'),
      ],
      ['web>clicks', 'clicks>load', 'load>wh'],
      6,
    ),
    debrief: 'Before buying hardware, make each byte and request cheaper: compress, batch and linger. Throwing brokers at uncompressed JSON would need ~20 brokers here. Random keys are fine for clicks because no per-entity ordering is needed, and they give the sticky partitioner big batches.',
  },
  challenge: {
    title: 'Log shipping: big messages, 3 brokers',
    story: '2,000 hosts ship 300k log lines/s, ~2 KB each, to a search cluster. Budget: **3 brokers**. Latency up to 1 s is fine. Logs must survive one broker failure.',
    start: graph(
      [
        n('service', 'ship', COL.a, ROW(1), { rate: 300000, msgBytes: 2000, key: 'null', lingerMs: 0, batchKb: 16, compression: 'none' }, 'log-shippers'),
        n('topic', 'logs', COL.b, ROW(1), { partitions: 12, retentionH: 24 }, 'logs'),
        n('group', 'idx', COL.c, ROW(1), { consumers: 12, procMs: 0.03 }, 'log-indexer'),
        n('sink', 'es', COL.d, ROW(1), { capacity: 1000000, idempotentSink: true }, 'search'),
      ],
      ['ship>logs', 'logs>idx', 'idx>es'],
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('rate', 'Sustains 1.2× (360k/s)', '', (c) => handles(c, 1.2)),
      R('lat', 'Produce p99 < 1 s', '', (c) => c.m.metrics.produceP99 < 1000),
      R('dur', 'Survives a broker failure', '', (c) => c.m.metrics.durability.level === 2),
      R('budget', '3 brokers', '', (c) => c.g.cluster.brokers <= 3),
    ],
    hints: ['2 KB messages in a 16 KB batch means only 8 per batch.', 'Compression ratio needs enough records per batch, so raise batch.size.', 'zstd, batch.size ≥ 64 KB, linger.ms 20–50.'],
    reference: graph(
      [
        n('service', 'ship', COL.a, ROW(1), { rate: 300000, msgBytes: 2000, key: 'null', lingerMs: 50, batchKb: 256, compression: 'zstd' }, 'log-shippers'),
        n('topic', 'logs', COL.b, ROW(1), { partitions: 12, retentionH: 24 }, 'logs'),
        n('group', 'idx', COL.c, ROW(1), { consumers: 12, procMs: 0.03 }, 'log-indexer'),
        n('sink', 'es', COL.d, ROW(1), { capacity: 1000000, idempotentSink: true }, 'search'),
      ],
      ['ship>logs', 'logs>idx', 'idx>es'],
    ),
    debrief: 'batch.size is in bytes, so it must scale with message size. When latency budgets are loose, spend them on linger: it is the cheapest throughput you can buy.',
  },
  quiz: [
    { q: 'Which change most reduces broker request rate at a fixed message rate?', options: ['More partitions', 'Higher linger.ms / batch.size', 'acks=0', 'More consumers'], answer: 1, explain: 'More records per batch means fewer ProduceRequests.' },
    { q: 'Where does Kafka compression happen?', options: ['On the broker per record', 'On the producer per batch; the broker stores it as is', 'On the consumer', 'On disk only'], answer: 1, explain: 'Batch-level compression on the producer. The broker keeps the batch compressed (unless the topic codec differs).' },
    { q: 'Cost of linger.ms=20?', options: ['Up to ~20 ms extra produce latency', 'Data loss', 'Reordering', 'More memory on brokers'], answer: 0, explain: 'A batch waits up to linger.ms to fill (less if it fills first).' },
  ],
  takeaways: ['Brokers are limited by bytes (network/disk × RF) and by request rate.', 'Batching + compression multiply capacity before you buy hardware.', 'Too many partitions mean tiny batches. Partition count is not a throughput dial on its own.', 'linger.ms spends latency to buy throughput.'],
  interview: [
    { q: 'How would you tune a Kafka producer for throughput?', a: 'linger.ms 10–50 and batch.size 64–256 KB for bigger batches; compression zstd or lz4; keep acks=all + idempotence (the cost is small with big batches); max.in.flight 5; enough buffer.memory. Measure batch-size-avg, record-queue-time and request-rate. Then size brokers by MB/s × RF.' },
    { q: 'Why is Kafka fast?', a: 'Sequential appends to the page cache, batching end to end (producer batch = stored batch = fetched batch), zero-copy sendfile from page cache to socket, compression of whole batches, and partitions that scale horizontally. No per-message acks or random disk seeks.' },
  ],
  deepDives: ['fast', 'log'],
};

/* ================================================================== */
/* 4. Consumer groups, parallelism, lag                                */
/* ================================================================== */

export const L4: Lesson = {
  id: 'consumers',
  n: 4,
  title: 'Consumer groups & lag',
  tagline: 'Lag is a queue. Read it like one.',
  minutes: 12,
  concepts: ['group coordinator', 'committed offsets (__consumer_offsets)', 'lag = LEO − committed', 'partition count caps parallelism', 'sink backpressure', 'max.poll.interval.ms'],
  problem: 'Push notifications fall minutes behind every evening. The team keeps adding pods and nothing improves.',
  stage: graph(
    [
      n('service', 'src', COL.a, ROW(1), { rate: 3000 }, 'events'),
      n('topic', 'notif-t', COL.b, ROW(1), { partitions: 6 }, 'notifications'),
      n('group', 'notif', COL.c, ROW(1), { consumers: 3, procMs: 1 }, 'notifier'),
      n('sink', 'push', COL.d, ROW(1), { capacity: 20000, idempotentSink: true }, 'push-provider'),
    ],
    ['src>notif-t', 'notif-t>notif', 'notif>push'],
  ),
  learn: [
    {
      title: 'How a group reads',
      body: 'Each consumer in `notifier` owns some partitions. It polls a batch, processes it, then **commits** the next offset to the internal topic `__consumer_offsets`. **Lag** per partition = log end offset − committed offset. It’s the number one health metric for any consumer.',
      internals: '`__consumer_offsets` is a compacted topic with 50 partitions. The group coordinator is the leader of partition hash(group.id) % 50. A commit is a write keyed by (group, topic, partition), so compaction keeps only the latest one.',
      focus: 'notif',
    },
    {
      title: 'Processing gets slower',
      body: 'A new template engine and a call to the push provider make each notification take **5 ms**.',
      predict: {
        q: '3,000/s arrive. 3 consumers each now handle 200/s. What happens over the evening?',
        options: ['Lag grows steadily and latency grows without bound', 'Kafka slows the producers down', 'Records are dropped', 'Lag spikes then recovers by itself'],
        answer: 0,
        explain: '3,000 − 600 = 2,400 records/s accumulate. Kafka never applies backpressure to producers for slow consumers: the log absorbs it, which is a feature. After an hour you’re 8.6M records (48 min) behind.',
      },
      ops: [{ set: ['notif', { procMs: 5 }] }],
      focus: 'notif',
    },
    {
      title: 'Scale consumers…',
      body: 'Double to 6 consumers: 1,200/s. Better, still lagging.',
      ops: [{ set: ['notif', { consumers: 6 }] }],
    },
    {
      title: '…and hit the partition wall',
      body: 'Go to 12 pods.',
      predict: {
        q: '12 consumers on a 6-partition topic. Throughput?',
        options: ['Doubles to 2,400/s', 'Same 1,200/s, with 6 pods idle', 'Halves due to rebalancing', 'Triples'],
        answer: 1,
        explain: 'Partitions cap parallelism. The extra 6 pods are hot standbys that take over on failure, but they don’t add throughput.',
      },
      ops: [{ set: ['notif', { consumers: 12 }] }],
      focus: 'notif',
    },
    {
      title: 'Size partitions for the consumer',
      body: '3,000/s ÷ 200/s = **15** consumers needed, so 18 partitions and 18 consumers gives headroom. This is why partition count is usually set by the *slowest consumer*, not the producer.',
      ops: [{ set: ['notif-t', { partitions: 18 }] }, { set: ['notif', { consumers: 18 }] }],
    },
    {
      title: 'The downstream is the real limit',
      body: 'Traffic doubles and you scale to 36 partitions and 36 consumers, but the push provider rate-limits at 5,000/s.',
      predict: {
        q: 'What does lag do now?',
        options: ['Stable: 36 consumers can do 7,200/s', 'Grows ~1,000/s: consumers block on the provider', 'The provider queues the rest'],
        answer: 1,
        explain: 'Consumers can only go as fast as their sink. Scaling consumers further just adds 429s and retries. Options: batch API calls, negotiate limits, or accept lag and prioritise (separate high-priority topic).',
      },
      ops: [{ set: ['src', { rate: 6000 }] }, { set: ['notif-t', { partitions: 36 }] }, { set: ['notif', { consumers: 36 }] }, { set: ['push', { capacity: 5000 }] }],
      focus: 'push',
    },
    {
      title: 'The silent killer: max.poll.interval.ms',
      body: 'If one `poll()` batch takes longer than `max.poll.interval.ms` (5 min) to process, the consumer is considered dead and **evicted**. It rebalances, another member gets the same uncommitted batch and also times out: a rebalance storm with zero progress. Keep `max.poll.records × worst-case processing time` well under the limit.',
      internals: 'Two liveness checks: the background heartbeat thread (session.timeout.ms, 45 s) detects crashed processes; max.poll.interval.ms detects stuck processing loops.',
    },
  ],
  build: {
    title: 'Notifications that keep up',
    story: '3,000 notification events/s. Each takes ~5 ms (render + push API). The provider allows 20,000/s. Evenings double the traffic.',
    start: graph(
      [
        n('service', 'src', COL.a, ROW(1), { rate: 3000 }, 'events'),
        n('topic', 'notif-t', COL.b, ROW(1), { partitions: 6 }, 'notifications'),
        n('group', 'notif', COL.c, ROW(1), { consumers: 6, procMs: 5 }, 'notifier'),
        n('sink', 'push', COL.d, ROW(1), { capacity: 20000, idempotentSink: true }, 'push-provider'),
      ],
      ['src>notif-t', 'notif-t>notif', 'notif>push'],
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('lag', 'No lag at today’s load', '', (c) => noLag(c.m)),
      R('peak', 'No lag at 2× (evening peak)', '', (c) => handles(c, 2), '6,000/s ÷ 200/s per consumer.'),
      R('idle', 'No idle consumers', '', (c) => noFlag(c.m, 'idle:')),
      R('evict', 'No consumer evicted by max.poll.interval', '', (c) => noFlag(c.m, 'evict')),
      R('real', 'Processing stays ~5 ms (no wishful thinking)', '', (c) => groupCfg(c).every((g) => g.procMs >= 5)),
    ],
    hints: ['Parallelism = min(consumers, partitions).', 'Each consumer does 200/s, and the peak is 6,000/s.', 'Partitions 30, consumers 30.'],
    reference: graph(
      [
        n('service', 'src', COL.a, ROW(1), { rate: 3000 }, 'events'),
        n('topic', 'notif-t', COL.b, ROW(1), { partitions: 30 }, 'notifications'),
        n('group', 'notif', COL.c, ROW(1), { consumers: 30, procMs: 5 }, 'notifier'),
        n('sink', 'push', COL.d, ROW(1), { capacity: 20000, idempotentSink: true }, 'push-provider'),
      ],
      ['src>notif-t', 'notif-t>notif', 'notif>push'],
    ),
    debrief: 'Lag diagnosis order: is it all partitions (capacity) or one (hot key or poison)? Is the consumer CPU-bound, or waiting on a sink? Are there idle members (partition wall)? Scale only the thing that is actually saturated.',
  },
  challenge: {
    title: 'Thumbnail workers',
    story: 'Uploads produce 50 images/s. Resizing takes **800 ms** each and that won’t change. Workers poll 500 records at a time. Handle 1.5× without lag or rebalance storms.',
    start: graph(
      [
        n('service', 'up', COL.a, ROW(1), { rate: 50 }, 'upload-api'),
        n('topic', 'img', COL.b, ROW(1), { partitions: 12 }, 'images'),
        n('group', 'thumb', COL.c, ROW(1), { consumers: 12, procMs: 800, maxPollRecords: 500 }, 'thumbnailer'),
      ],
      ['up>img', 'img>thumb'],
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('peak', 'No lag at 1.5×', '', (c) => handles(c, 1.5)),
      R('evict', 'No max.poll.interval evictions', '', (c) => noFlag(c.m, 'evict')),
      R('idle', 'No idle consumers', '', (c) => noFlag(c.m, 'idle:')),
      R('real', 'Resize still takes 800 ms', '', (c) => groupCfg(c).every((g) => g.procMs >= 800)),
    ],
    hints: ['500 × 0.8 s = 400 s per poll, over the 300 s limit.', '1 consumer = 1.25 images/s, and 75/s is needed.', 'max.poll.records ≤ 100; partitions and consumers = 60.'],
    reference: graph(
      [
        n('service', 'up', COL.a, ROW(1), { rate: 50 }, 'upload-api'),
        n('topic', 'img', COL.b, ROW(1), { partitions: 60 }, 'images'),
        n('group', 'thumb', COL.c, ROW(1), { consumers: 60, procMs: 800, maxPollRecords: 10 }, 'thumbnailer'),
      ],
      ['up>img', 'img>thumb'],
    ),
    debrief: 'Slow, independent work items are a weak fit for partition-based parallelism: you need one partition per worker. Alternatives: a work queue (SQS/RabbitMQ), Kafka 4.0 **share groups** (KIP-932, queue semantics on a topic), or a parallel consumer (Confluent Parallel Consumer) that processes keys concurrently within one partition.',
  },
  quiz: [
    { q: 'Consumer lag is…', options: ['Network latency to the broker', 'Log end offset − committed offset', 'Time since last commit', 'Rebalance duration'], answer: 1, explain: 'Measured per partition, summed per group. Alert on lag *in time* (e.g. via Burrow or kafka-lag-exporter), not just records.' },
    { q: 'Where are committed offsets stored?', options: ['ZooKeeper', '__consumer_offsets (compacted)', 'Consumer local disk', 'The partition itself'], answer: 1, explain: 'Since 0.9 offsets are records in an internal compacted topic.' },
    { q: 'A consumer’s batch takes 6 min to process. What happens?', options: ['Fine; heartbeats continue', 'Evicted after max.poll.interval.ms (5 min), which triggers a rebalance', 'Kafka extends the deadline', 'The batch is split'], answer: 1, explain: 'Heartbeats only prove the process is alive; the poll interval proves it’s making progress.' },
  ],
  takeaways: ['Throughput = min(consumers, partitions) × per-consumer rate, capped by the sink.', 'Kafka doesn’t backpressure producers: lag absorbs bursts.', 'Partition count is usually set by the slowest consumer.', 'max.poll.records × processing time < max.poll.interval.ms.'],
  interview: [
    { q: 'Consumer lag keeps growing. How do you debug it?', a: '1) Lag on all partitions or one? One means a hot key or a stuck/poison record. 2) Are consumers CPU-bound, or waiting on I/O (DB, API)? Check processing time and sink latency. 3) Idle members means the partition wall, so add partitions. 4) Rebalance logs: are members flapping (max.poll.interval, GC)? 5) Then fix the bottleneck: batch writes, parallelize I/O, add partitions and consumers, or shed/prioritize.' },
    { q: 'More consumers than partitions?', a: 'Extras are idle, though useful as fast failover. To go beyond, add partitions (planned, since keys remap), or process concurrently within a partition while preserving per-key order (parallel consumer), or use share groups.' },
  ],
  deepDives: ['rebalance', 'fast'],
};

/* ================================================================== */
/* 5. Rebalancing                                                      */
/* ================================================================== */

export const L5: Lesson = {
  id: 'rebalance',
  n: 5,
  title: 'Rebalancing without stalls',
  tagline: 'Every deploy shouldn’t stop the world.',
  minutes: 10,
  concepts: ['rebalance triggers', 'eager (stop-the-world) protocol', 'Range vs RoundRobin vs Sticky', 'CooperativeSticky (incremental)', 'static membership (group.instance.id)', 'KIP-848 next-gen protocol'],
  problem: 'Checkout events pause for ~a minute during every Kubernetes rolling deploy, and alerts fire on lag every release.',
  stage: graph(
    [
      n('service', 'co', COL.a, ROW(1), { rate: 6000 }, 'checkout-api'),
      n('topic', 'cot', COL.b, ROW(1), { partitions: 24 }, 'checkout-events'),
      n('group', 'chk', COL.c, ROW(1), { consumers: 12, procMs: 1, assignor: 'range' }, 'checkout-consumers'),
    ],
    ['co>cot', 'cot>chk'],
  ),
  learn: [
    {
      title: 'What triggers a rebalance',
      body: 'A member joins or leaves (deploy, scale, crash), misses heartbeats for `session.timeout.ms`, exceeds `max.poll.interval.ms`, or the subscription or partition count changes. The group must then agree on a new partition assignment.',
      focus: 'chk',
    },
    {
      title: 'Eager rebalancing',
      body: 'With the classic **eager** protocol (Range/RoundRobin/Sticky assignors) every member **revokes all partitions**, rejoins (JoinGroup), waits for the leader’s plan (SyncGroup), then resumes. Nobody consumes in between.',
      predict: {
        q: 'Rolling deploy of 12 pods with eager rebalancing. Roughly how many stop-the-world pauses?',
        options: ['1', '12', '~24: each pod leaves and then rejoins', '0'],
        answer: 2,
        explain: 'Each restart is a leave plus a join, so ~24 rebalances, each pausing all 12 pods for a few seconds. Check the “stop-the-world per deploy” metric.',
      },
      focus: 'chk',
    },
    {
      title: 'Cooperative incremental rebalancing',
      body: '**CooperativeStickyAssignor** (KIP-429): members keep their partitions during the rebalance; only partitions that must **move** are revoked, then reassigned in a second short round. Everyone else keeps consuming.',
      ops: [{ set: ['chk', { assignor: 'coop' }] }],
      internals: 'Round 1: everyone rejoins and reports owned partitions, and the leader computes the target but only revokes the moving ones. Round 2: the freed partitions are assigned. Migrating from eager needs two rolling bounces (add cooperative-sticky to the list, then remove the old).',
      focus: 'chk',
    },
    {
      title: 'Static membership',
      body: 'Give each pod a stable `group.instance.id` (e.g. the StatefulSet pod name) and a `session.timeout.ms` longer than a restart. A restarting pod comes back as the *same* member, so **no rebalance at all**. Its partitions just pause for the restart.',
      ops: [{ set: ['chk', { staticMembership: true }] }],
      focus: 'chk',
    },
    {
      title: 'Crash loops amplify rebalances',
      body: 'A poison record makes one consumer crash every few seconds.',
      predict: {
        q: 'With the cooperative assignor, does a crash-looping member stall the whole group?',
        options: ['Yes, everyone stops each time', 'Mostly no: only that member’s partitions move; the partition with the poison record stays stuck', 'Kafka skips the bad record'],
        answer: 1,
        explain: 'Cooperative limits the blast radius to the moving partitions. But the poisoned partition still can’t progress: that needs error handling (lesson 7), not a better assignor.',
      },
      chaos: { poison: true },
      focus: 'chk',
    },
    {
      title: 'KIP-848: the broker takes over',
      body: 'Kafka 4.0 makes the **new consumer group protocol** GA (`group.protocol=consumer`). The coordinator computes assignments server-side and reconciles each member incrementally via heartbeats. There is no global JoinGroup/SyncGroup barrier and no client-side leader, so rebalances are faster and don’t stop the world by design.',
    },
  ],
  build: {
    title: 'Zero-stall deploys for checkout',
    story: '`checkout-events` (6,000/s, 24 partitions) is consumed by 12 pods, deployed several times a day. SLO: no group-wide pause during deploys, and a crash affects only the crashed pod’s partitions.',
    start: graph(
      [
        n('service', 'co', COL.a, ROW(1), { rate: 6000 }, 'checkout-api'),
        n('topic', 'cot', COL.b, ROW(1), { partitions: 24 }, 'checkout-events'),
        n('group', 'chk', COL.c, ROW(1), { consumers: 12, procMs: 1, assignor: 'range' }, 'checkout-consumers'),
      ],
      ['co>cot', 'cot>chk'],
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('lag', 'No lag', '', (c) => noLag(c.m)),
      R('deploy', 'Stop-the-world per deploy < 1 s', '', (c) => c.m.metrics.deployPause < 1, 'Rolling restarts are leave + join per pod, unless the pod keeps its identity.'),
      R('crash', 'A crash only pauses the moved partitions', '', (c) => groupCfg(c).every((g) => g.assignor === 'coop')),
    ],
    hints: ['Two mechanisms: avoid the rebalance, and make the remaining ones incremental.', 'group.instance.id avoids rebalances on restart; CooperativeSticky makes the rest incremental.', 'assignor = cooperative-sticky, static membership on.'],
    reference: graph(
      [
        n('service', 'co', COL.a, ROW(1), { rate: 6000 }, 'checkout-api'),
        n('topic', 'cot', COL.b, ROW(1), { partitions: 24 }, 'checkout-events'),
        n('group', 'chk', COL.c, ROW(1), { consumers: 12, procMs: 1, assignor: 'coop', staticMembership: true }, 'checkout-consumers'),
      ],
      ['co>cot', 'cot>chk'],
    ),
    debrief: 'Static membership trades faster detection for fewer rebalances: a pod that really dies isn’t replaced until session.timeout.ms expires. Pick a timeout just above your restart time.',
  },
  challenge: {
    title: 'One group, three small topics',
    story: '`audit-consumer` (6 pods) subscribes to three topics of 2 partitions each (1,000/s each, ~1 ms per record). Half the pods do nothing and the busy ones lag. Fix it without changing the topics, and keep deploys stall-free.',
    start: graph(
      [
        n('service', 'a', COL.a, ROW(0), { rate: 1000 }, 'users-svc'),
        n('service', 'b', COL.a, ROW(1), { rate: 1000 }, 'orders-svc'),
        n('service', 'c', COL.a, ROW(2), { rate: 1000 }, 'billing-svc'),
        n('topic', 'ta', COL.b, ROW(0), { partitions: 2 }, 'user-events'),
        n('topic', 'tb', COL.b, ROW(1), { partitions: 2 }, 'order-events'),
        n('topic', 'tc', COL.b, ROW(2), { partitions: 2 }, 'billing-events'),
        n('group', 'aud', COL.c, ROW(1), { consumers: 6, procMs: 1, assignor: 'range' }, 'audit-consumer'),
      ],
      ['a>ta', 'b>tb', 'c>tc', 'ta>aud', 'tb>aud', 'tc>aud'],
    ),
    palette: ['topic', 'group'],
    reqs: [
      R('idle', 'No idle consumers', '', (c) => noFlag(c.m, 'idle:')),
      R('lag', 'No lag', '', (c) => noLag(c.m)),
      R('deploy', 'Stop-the-world per deploy < 1 s', '', (c) => c.m.metrics.deployPause < 1),
      R('same', 'Topics unchanged (2 partitions each)', '', (c) => topicCfg(c).every((t) => t.partitions === 2) && count(c.g, 'topic') === 3),
    ],
    hints: ['Range assigns each topic independently, starting from member 0.', 'Every topic’s 2 partitions go to members 0 and 1.', 'CooperativeSticky (spreads across all topics) + static membership.'],
    reference: graph(
      [
        n('service', 'a', COL.a, ROW(0), { rate: 1000 }, 'users-svc'),
        n('service', 'b', COL.a, ROW(1), { rate: 1000 }, 'orders-svc'),
        n('service', 'c', COL.a, ROW(2), { rate: 1000 }, 'billing-svc'),
        n('topic', 'ta', COL.b, ROW(0), { partitions: 2 }, 'user-events'),
        n('topic', 'tb', COL.b, ROW(1), { partitions: 2 }, 'order-events'),
        n('topic', 'tc', COL.b, ROW(2), { partitions: 2 }, 'billing-events'),
        n('group', 'aud', COL.c, ROW(1), { consumers: 6, procMs: 1, assignor: 'coop', staticMembership: true }, 'audit-consumer'),
      ],
      ['a>ta', 'b>tb', 'c>tc', 'ta>aud', 'tb>aud', 'tc>aud'],
    ),
    debrief: 'Range exists so that co-partitioned topics (same key, same count) land on the same member, which is what joins need. For unrelated topics it piles work onto the first members. Know *why* each default exists before changing it.',
  },
  quiz: [
    { q: 'What does the cooperative protocol avoid?', options: ['All rebalances', 'Revoking partitions that don’t need to move', 'Heartbeats', 'Offset commits'], answer: 1, explain: 'Only moving partitions are revoked; everyone else keeps consuming.' },
    { q: 'Static membership (group.instance.id) means…', options: ['A restarted pod rejoins as the same member, so no rebalance (within session.timeout)', 'Partitions never move', 'No offsets needed', 'Exactly-once'], answer: 0, explain: 'The coordinator keeps the member’s assignment while it’s briefly gone.' },
    { q: 'In the classic protocol, who computes the assignment?', options: ['The controller', 'The group leader (a consumer) runs the assignor', 'ZooKeeper', 'Each consumer independently'], answer: 1, explain: 'The coordinator picks a leader member, which computes the plan and sends it in SyncGroup. KIP-848 moves this to the broker.' },
  ],
  takeaways: ['Eager rebalances stop everyone; cooperative ones move only what’s needed.', 'Static membership turns restarts into non-events.', 'Range is per-topic and great for co-partitioned joins, poor for many small unrelated topics.', 'Kafka 4.0’s KIP-848 does assignment on the broker, incrementally.'],
  interview: [
    { q: 'Why do consumers pause during deployments and how do you fix it?', a: 'Each pod restart leaves and rejoins the group, triggering eager rebalances where all members revoke everything. Fix: CooperativeStickyAssignor (incremental), static membership with group.instance.id and session.timeout above restart time, graceful shutdown that commits offsets, and, on Kafka 4.x, the KIP-848 consumer protocol.' },
    { q: 'Explain the consumer rebalance protocol.', a: 'Members heartbeat to the group coordinator. On a change, the coordinator starts a generation: JoinGroup (members send subscriptions, one becomes leader), the leader runs the assignor and sends the plan via SyncGroup, and members start fetching from committed offsets. Generation ids fence zombie members whose commits are rejected.' },
  ],
  deepDives: ['rebalance'],
};
