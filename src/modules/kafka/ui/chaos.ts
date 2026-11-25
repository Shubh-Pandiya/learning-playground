import { evaluate, type Model } from '../engine/model';
import type { Chaos, KGraph } from '../types';

export interface ChaosAction {
  id: string;
  label: string;
  /** Short real-world cause. */
  cause: string;
  apply: (c: Chaos, g: KGraph, m: Model) => Chaos;
  question: string;
  options: string[];
  /** Index of the outcome the model actually produces. */
  classify: (before: Model, after: Model, g: KGraph) => number;
  /** Mechanism shown after the reveal. */
  why: string[];
}

const maxErr = (m: Model) => Math.max(0, ...Object.values(m.topics).map((t) => t.errorRate));
const offline = (m: Model) => Object.values(m.topics).reduce((s, t) => s + t.offline, 0);
const unclean = (m: Model) => Object.values(m.topics).some((t) => t.partitions.some((p) => p.unclean));
const blocked = (m: Model) => Object.values(m.topics).reduce((s, t) => s + t.blocked, 0);
const isrSum = (m: Model) => Object.values(m.topics).reduce((s, t) => s + t.partitions.reduce((a, p) => a + p.isr.length, 0), 0);

/** Broker hosting the most partition leaders (the most interesting one to kill). */
export function busiestBroker(m: Model): number {
  const alive = m.brokers.filter((b) => b.alive);
  if (!alive.length) return 1;
  return alive.reduce((a, b) => (b.leaders > a.leaders ? b : a)).id;
}

export const CHAOS: ChaosAction[] = [
  {
    id: 'kill',
    label: 'Kill a broker',
    cause: 'Hardware failure, OOM kill, or a bad deploy',
    apply: (c, _g, m) => ({ ...c, brokersDown: [...c.brokersDown, busiestBroker(m)] }),
    question: 'The broker leading the most partitions dies. What do producers and consumers experience?',
    options: [
      'A short blip: new leaders are elected from the ISR and writes and reads continue',
      'Reads continue, but acks=all writes are rejected on some partitions',
      'Some partitions go offline: no reads or writes until the broker returns',
      'Failover works, but some already-acknowledged records are silently lost',
    ],
    classify: (b, a) => (unclean(a) || (b.metrics.durability.lossOn1 && offline(a) === 0) ? 3 : offline(a) > 0 ? 2 : blocked(a) > blocked(b) || maxErr(a) > maxErr(b) + 0.001 ? 1 : 0),
    why: [
      'The controller notices the missed heartbeats, then picks a new leader for each affected partition **from the ISR** and bumps the leader epoch. Clients refresh metadata and retry.',
      'With RF=3 and min.insync.replicas=2 one broker can die and acks=all writes still succeed. With minISR = RF, losing one replica means the ISR is too small, so writes get NOT_ENOUGH_REPLICAS.',
      'With RF=1 there is no other replica: the partition is offline until that exact broker comes back (and gone if its disk is gone).',
      'acks=1 acknowledges once the leader alone has the record. If the leader dies before followers fetch it, the new leader never had it. Unclean election does the same at a bigger scale.',
    ],
  },
  {
    id: 'slow',
    label: 'Slow broker (disk/GC)',
    cause: 'A failing disk, long GC pauses, noisy neighbour',
    apply: (c, _g, m) => ({ ...c, slowBroker: m.brokers.find((b) => b.alive && b.id !== busiestBroker(m))?.id ?? busiestBroker(m) }),
    question: 'One broker becomes slow. Its follower replicas can’t keep up. What happens?',
    options: [
      'Nothing visible: followers don’t affect clients',
      'Its replicas drop out of the ISR; writes keep flowing on the remaining in-sync replicas',
      'acks=all writes start failing on partitions where the ISR falls below min.insync.replicas',
    ],
    classify: (b, a) => (blocked(a) > blocked(b) || maxErr(a) > maxErr(b) + 0.001 ? 2 : isrSum(a) < isrSum(b) ? 1 : 0),
    why: [
      'A follower that hasn’t caught up to the leader’s LEO within `replica.lag.time.max.ms` (30 s) is removed from the ISR. Until then, acks=all produce latency follows the **slowest** in-sync follower.',
      'The high watermark only advances on what every ISR member has. Shrinking the ISR is how Kafka trades redundancy for availability without losing acknowledged data.',
      'If the ISR falls below min.insync.replicas, the leader rejects acks=all writes rather than accept data that isn’t safely replicated.',
    ],
  },
  {
    id: 'slowgroup',
    label: 'Slow consumer',
    cause: 'A slow downstream DB, a lock, a bad deploy',
    apply: (c, g) => ({ ...c, slowGroup: g.nodes.find((n) => n.kind === 'group' || n.kind === 'streams')?.id }),
    question: 'Processing in the first consumer group becomes 5× slower. What happens?',
    options: [
      'It absorbs it: there is enough headroom',
      'Lag grows steadily; events arrive later and later',
      'Lag grows and members get kicked out of the group (max.poll.interval.ms), so it rebalances repeatedly',
    ],
    classify: (_b, a) => {
      const gr = Object.values(a.groups);
      if (gr.some((x) => x.evicted)) return 2;
      return a.metrics.lagGrowth > 1 ? 1 : 0;
    },
    why: [
      'Consumer capacity = active members × (1000 / ms per record). Kafka doesn’t push: a slow consumer just falls behind; the broker is unaffected.',
      'Lag that grows linearly never recovers by itself. The fix is more partitions **and** members, faster processing (batching, async I/O), or shedding work.',
      'If one poll batch (`max.poll.records` × time per record) takes longer than `max.poll.interval.ms`, the member is considered dead. Its partitions move, the same batch is reprocessed elsewhere, and the cycle repeats.',
    ],
  },
  {
    id: 'poison',
    label: 'Poison message',
    cause: 'A record the consumer can’t deserialize or process',
    apply: (c) => ({ ...c, poison: true }),
    question: 'A malformed record lands on one partition. What happens to that partition?',
    options: ['It goes to a dead-letter topic and the partition keeps flowing', 'It is skipped and silently dropped; the partition keeps flowing', 'The partition is stuck: the consumer retries the same offset forever while lag builds behind it'],
    classify: (_b, a, g) => {
      if (Object.values(a.groups).some((x) => x.stuck)) return 2;
      const groups = g.nodes.filter((n) => n.kind === 'group');
      return groups.some((n) => n.cfg.onError === 'skip') ? 1 : 0;
    },
    why: [
      'Kafka delivers in offset order per partition. A consumer that throws and doesn’t commit fetches the **same** record again: one bad record blocks every record behind it on that partition.',
      'Skipping keeps things flowing but loses the record with no trace. The production pattern: bounded retries, then publish to a DLQ (with error headers) and commit past it.',
    ],
  },
  {
    id: 'hot',
    label: 'Hot key',
    cause: 'A celebrity user, one huge tenant, a bot',
    apply: (c) => ({ ...c, hotKey: true }),
    question: 'One key suddenly produces 40% of all traffic. What happens?',
    options: ['Load stays even: Kafka balances partitions automatically', 'One partition and the single consumer that owns it saturate; lag builds there while others sit idle', 'All partitions slow down equally'],
    classify: (b, a) => (Object.values(a.groups).some((x) => x.hottestMemberUtil >= 1) || a.metrics.lagGrowth > b.metrics.lagGrowth + 1 || Object.values(a.topics).some((t) => t.hotShare > 0.3) ? 1 : 0),
    why: [
      'The default partitioner is `murmur2(key) % partitions`: the same key always lands on the same partition, which is what gives per-key ordering. It also means one key can never use more than one partition or one consumer.',
      'Fixes: salt the hot key (`key#0..N`, then re-aggregate), isolate big tenants on their own topic, or drop the key if ordering isn’t needed. Adding partitions doesn’t help one key.',
    ],
  },
  {
    id: 'spike',
    label: 'Traffic ×3',
    cause: 'A sale, a backfill, a retry storm',
    apply: (c) => ({ ...c, traffic: c.traffic * 3 }),
    question: 'Traffic triples. What breaks first?',
    options: ['Nothing: it absorbs the spike', 'Consumers: lag grows', 'Brokers or producers: produce latency and errors go up'],
    classify: (b, a) => (maxErr(a) > maxErr(b) + 0.001 || a.brokers.some((x) => x.util >= 1) || a.metrics.produceP99 > b.metrics.produceP99 * 3 ? 2 : a.metrics.lagGrowth > 1 ? 1 : 0),
    why: [
      'Kafka absorbs bursts well: the log is just disk, so producers rarely notice. Consumers are usually the first to fall behind, and lag is the buffer.',
      'Brokers saturate on network/disk (~200 MB/s each here, including replication traffic ×RF). Batching (linger.ms) and compression push that ceiling out.',
    ],
  },
];

/** What a chaos action would produce, without applying it. */
export function preview(a: ChaosAction, g: KGraph, chaos: Chaos, m: Model) {
  const next = a.apply(chaos, g, m);
  const after = evaluate(g, next);
  return { next, after, answer: a.classify(m, after, g) };
}
