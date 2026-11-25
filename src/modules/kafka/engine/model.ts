/**
 * Napkin-math model of a Kafka pipeline on a simulated cluster. Pure and deterministic:
 * the same graph + chaos always gives the same numbers, so "before vs after" diffs are meaningful.
 *
 * Capacities are rough but defensible orders of magnitude (per broker ~200 MB/s ingress incl.
 * replication, ~25k produce requests/s; a consumer handles 1000/procMs records/s). Good for reasoning, not benchmarks.
 */
import { KINDS } from '../data/components';
import type { Chaos, Flag, KEdge, KGraph, KKind, KNode, NodeCfg, Ordering, Semantics } from '../types';
import { cfgOf } from './defaults';

export const BROKER_MBPS = 200;
export const BROKER_BATCHES = 25000;
const RABBIT_CAP = 30000;
const POISON_RATE = 0.002;

export interface PartitionState {
  p: number;
  replicas: number[];
  isr: number[];
  leader: number | null;
  offline: boolean;
  /** Leader elected from outside the ISR (data loss). */
  unclean: boolean;
  /** acks=all write rejected: ISR < min.insync.replicas */
  notEnoughReplicas: boolean;
  share: number;
  rate: number;
  stuck: boolean;
}

export interface Durability {
  level: 0 | 1 | 2;
  label: string;
  /** Acked writes lost if one broker dies. */
  lossOn1: boolean;
  /** Writes keep working with any one broker down. */
  writesOn1: boolean;
}

export interface TopicStats {
  id: string;
  inRate: number;
  mbps: number;
  partitions: PartitionState[];
  rf: number;
  hotShare: number;
  ordering: Ordering;
  durability: Durability;
  diskGB: number;
  offline: number;
  blocked: number;
  /** Fraction of produced records rejected right now. */
  errorRate: number;
  producers: string[];
  consumers: string[];
  keyModes: string[];
  semanticsIn: 'may-lose' | 'dups' | 'once';
  /** Upstream is a transactional/EOS producer. */
  transactionalIn: boolean;
}

export interface GroupStats {
  id: string;
  kind: 'group' | 'streams' | 'rabbit-consumer';
  topics: string[];
  members: number;
  active: number;
  idle: number;
  capPer: number;
  inRate: number;
  consumed: number;
  lagGrowth: number;
  util: number;
  /** Partition-ownership per member: number of partitions. */
  assignment: number[];
  hottestMemberUtil: number;
  stuck: number;
  semantics: Semantics;
  loss: string[];
  dups: string[];
  ordering: Ordering;
  /** Hours until lag exceeds retention, if lag grows. */
  hoursToRetentionLoss?: number;
  evicted: boolean;
  rebalance: string;
  /** Rebalances caused by one rolling deploy of every member. */
  deployRebalances: number;
  /** Seconds of full-group stop-the-world per rolling deploy (eager) or equivalent partial pause (cooperative). */
  deployPause: number;
  sinks: string[];
  outTopics: string[];
}

export interface ProducerStats {
  id: string;
  rate: number;
  p99: number;
  batchMsgs: number;
  compression: number;
  semantics: 'may-lose' | 'dups' | 'once';
  reorder: boolean;
  errorRate: number;
  dualWrite: boolean;
}

export interface BrokerStats {
  id: number;
  alive: boolean;
  slow: boolean;
  leaders: number;
  replicas: number;
  mbps: number;
  batches: number;
  util: number;
  controller: boolean;
}

export type NodeStatus = 'ok' | 'hot' | 'overloaded' | 'idle' | 'blocked' | 'degraded' | 'wrong';

export interface NodeView {
  status: NodeStatus;
  util: number;
  line: string;
  sub?: string;
}

export interface EdgeView {
  rate: number;
  kind: 'produce' | 'consume' | 'write' | 'cdc' | 'invalid';
  failing: boolean;
  note?: string;
}

export interface Metrics {
  connected: boolean;
  ingest: number;
  ingestMB: number;
  maxThroughput: number;
  bottleneck: string;
  produceP99: number;
  e2eP99: number;
  lagGrowth: number;
  semantics: Semantics;
  ordering: Ordering;
  durability: Durability;
  activeConsumers: number;
  idleConsumers: number;
  partitions: number;
  diskGB: number;
  errorRate: number;
  brokersUp: number;
  deployPause: number;
}

export interface Model {
  topics: Record<string, TopicStats>;
  groups: Record<string, GroupStats>;
  producers: Record<string, ProducerStats>;
  brokers: BrokerStats[];
  view: Record<string, NodeView>;
  edges: Record<string, EdgeView>;
  metrics: Metrics;
  flags: Flag[];
}

/* ------------------------------------------------------------------ */

const PRODUCING: KKind[] = ['service', 'cdc', 'poller', 'memqueue', 'streams', 'group'];

export function edgeValidity(a: KKind, b: KKind): { ok: boolean; kind: EdgeView['kind']; note: string } {
  const ok = (kind: EdgeView['kind'], note: string) => ({ ok: true, kind, note });
  const bad = (note: string) => ({ ok: false, kind: 'invalid' as const, note });
  if (b === 'registry' || a === 'registry') return ok('write', 'Uses the schema registry to (de)serialize with a versioned schema.');
  switch (a) {
    case 'service':
      if (b === 'topic') return ok('produce', 'The service publishes to this topic with its producer client.');
      if (b === 'postgres') return ok('write', 'The service commits its state (and outbox rows) to its database.');
      if (b === 'memqueue') return ok('produce', 'Events are buffered in process memory before reaching Kafka.');
      if (b === 'rabbit') return ok('produce', 'The service publishes to a RabbitMQ exchange/queue.');
      return bad('A service talks to consumers through a topic, not directly. Publish to a topic instead.');
    case 'memqueue':
      return b === 'topic' ? ok('produce', 'A background thread drains the buffer into Kafka.') : bad('The buffer can only drain into a topic.');
    case 'postgres':
      if (b === 'cdc') return ok('cdc', 'Debezium reads committed changes from the WAL through a replication slot.');
      if (b === 'poller') return ok('cdc', 'The poller queries for changed rows every few seconds.');
      return bad('A database does not push to that. Use CDC (Debezium) to turn commits into events.');
    case 'cdc':
    case 'poller':
      return b === 'topic' ? ok('produce', 'Change events are published to this topic, keyed by primary key.') : bad('Connectors publish into topics.');
    case 'topic':
      if (b === 'group' || b === 'streams') return ok('consume', 'Subscribes: partitions of this topic are split among the members.');
      if (b === 'sink') return bad('A topic does not push anywhere. Something must consume it: add a consumer group (or a Connect sink) between them.');
      if (b === 'topic') return bad('Topics don’t feed topics on their own. A stream processor (or MirrorMaker for cross-cluster) does the copying.');
      return bad('Topics are read by consumer groups or stream processors.');
    case 'group':
      if (b === 'sink') return ok('write', 'Each processed record is written to this store.');
      if (b === 'topic') return ok('produce', 'Re-publishes records (e.g. failures to a retry topic or DLQ).');
      return bad('A consumer group writes to stores or topics.');
    case 'streams':
      if (b === 'topic') return ok('produce', 'Results are produced to an output topic.');
      if (b === 'sink') return bad('Stream processors write to output topics; a sink connector or consumer then loads the store.');
      return bad('A stream processor outputs to topics.');
    case 'rabbit':
      return b === 'group' ? ok('consume', 'Competing consumers pull messages from the queue.') : bad('Queues are read by consumers.');
    default:
      return bad('That connection doesn’t make sense here.');
  }
}

/** Replica placement: partition p of the t-th topic, spread round-robin across brokers. */
function placement(t: number, p: number, rf: number, brokers: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.min(rf, brokers); i++) out.push(((p + t + i) % brokers) + 1);
  return out;
}

const COMPRESSION_RATIO: Record<string, number> = { none: 1, gzip: 0.28, snappy: 0.5, lz4: 0.45, zstd: 0.26 };
const COMPRESSION_MS: Record<string, number> = { none: 0, gzip: 2.5, snappy: 0.2, lz4: 0.2, zstd: 0.6 };

function assign(partitionsPerTopic: number[], members: number, assignor: NodeCfg['assignor']): number[][] {
  // returns, per member, a list of global partition indexes
  const out: number[][] = Array.from({ length: members }, () => []);
  if (members <= 0) return out;
  let base = 0;
  if (assignor === 'range') {
    for (const P of partitionsPerTopic) {
      const per = Math.floor(P / members);
      const extra = P % members;
      let p = 0;
      for (let m = 0; m < members; m++) {
        const n = per + (m < extra ? 1 : 0);
        for (let k = 0; k < n; k++) out[m].push(base + p++);
      }
      base += P;
    }
  } else {
    const total = partitionsPerTopic.reduce((a, b) => a + b, 0);
    for (let g = 0; g < total; g++) out[g % members].push(g);
  }
  return out;
}

const worstSem = (xs: Semantics[]): Semantics => {
  const rank: Semantics[] = ['none', 'at-most-once', 'at-least-once', 'effectively-once', 'exactly-once'];
  if (!xs.length) return 'none';
  return xs.reduce((a, b) => (rank.indexOf(a) <= rank.indexOf(b) ? a : b));
};

const worstOrdering = (xs: Ordering[]): Ordering => {
  const rank: Ordering[] = ['none', 'per-key*', 'per-key', 'total'];
  const ys = xs.filter((x) => x !== 'n/a');
  if (!ys.length) return 'n/a';
  return ys.reduce((a, b) => (rank.indexOf(a) <= rank.indexOf(b) ? a : b));
};

/* ------------------------------------------------------------------ */

export function evaluate(g: KGraph, chaos: Chaos): Model {
  const flags: Flag[] = [];
  const flag = (f: Flag) => {
    if (!flags.some((x) => x.id === f.id)) flags.push(f);
  };
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const cfg = new Map(g.nodes.map((n) => [n.id, cfgOf(n)]));
  const C = (id: string) => cfg.get(id)!;
  const B = Math.max(1, g.cluster.brokers);
  const down = new Set(chaos.brokersDown);
  const traffic = chaos.traffic;
  const hasRegistry = g.nodes.some((n) => n.kind === 'registry');

  // edge validity
  const edges: Record<string, EdgeView> = {};
  for (const e of g.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const v = edgeValidity(a.kind, b.kind);
    edges[e.id] = { rate: 0, kind: v.kind, failing: !v.ok, note: v.note };
    if (!v.ok) flag({ id: `edge:${e.id}`, level: 'bad', nodeId: b.id, title: `${label(a)} → ${label(b)} is not a valid link`, why: v.note });
  }
  const validOut = (id: string) => g.edges.filter((e) => e.from === id && !edges[e.id]?.failing).map((e) => byId.get(e.to)!).filter(Boolean);
  const validIn = (id: string) => g.edges.filter((e) => e.to === id && !edges[e.id]?.failing).map((e) => byId.get(e.from)!).filter(Boolean);

  /* ---------- producers ---------- */
  const producers: Record<string, ProducerStats> = {};
  const dbRate = new Map<string, number>();
  for (const n of g.nodes.filter((x) => x.kind === 'service')) {
    const c = C(n.id);
    const o = validOut(n.id);
    const writesDb = o.filter((x) => x.kind === 'postgres');
    const publishes = o.filter((x) => x.kind === 'topic' || x.kind === 'memqueue' || x.kind === 'rabbit');
    for (const d of writesDb) dbRate.set(d.id, (dbRate.get(d.id) ?? 0) + c.rate * traffic);
    const dual = writesDb.length > 0 && publishes.length > 0;
    if (dual)
      flag({
        id: `dual:${n.id}`,
        level: 'bad',
        nodeId: n.id,
        title: 'Dual write: DB commit and Kafka publish are not atomic',
        why: 'If the service crashes or Kafka is unavailable after the DB commit, the event is lost. If the publish succeeds but the DB transaction rolls back, consumers act on something that never happened. Retrying makes it worse (duplicates, reordering).',
        fix: 'Transactional outbox: insert the event into an outbox table in the same DB transaction and let Debezium CDC publish it.',
      });
    if (!publishes.length && !writesDb.length) continue;
    producers[n.id] = { id: n.id, rate: c.rate * traffic, p99: 0, batchMsgs: 1, compression: 1, semantics: 'once', reorder: false, errorRate: 0, dualWrite: dual };
  }
  for (const n of g.nodes.filter((x) => x.kind === 'cdc' || x.kind === 'poller')) {
    const src = validIn(n.id).filter((x) => x.kind === 'postgres');
    const r = src.reduce((a, d) => a + (dbRate.get(d.id) ?? 0), 0);
    producers[n.id] = { id: n.id, rate: r, p99: 0, batchMsgs: 1, compression: 1, semantics: n.kind === 'poller' ? 'may-lose' : 'dups', reorder: false, errorRate: 0, dualWrite: false };
    if (n.kind === 'poller')
      flag({ id: `poller:${n.id}`, level: 'bad', nodeId: n.id, title: 'Polling publisher misses changes', why: KINDS.poller.trap!.why, fix: KINDS.poller.trap!.instead });
    if (!src.length) flag({ id: `nosrc:${n.id}`, level: 'warn', nodeId: n.id, title: `${label(n)} has no database to read`, why: 'Connect Postgres → this connector.' });
  }
  for (const n of g.nodes.filter((x) => x.kind === 'memqueue')) {
    const r = validIn(n.id).reduce((a, s) => a + (producers[s.id]?.rate ?? 0), 0);
    producers[n.id] = { id: n.id, rate: r, p99: 0, batchMsgs: 1, compression: 1, semantics: 'may-lose', reorder: false, errorRate: 0, dualWrite: false };
    flag({ id: `mem:${n.id}`, level: 'bad', nodeId: n.id, title: 'In-memory buffer loses events on every crash or deploy', why: KINDS.memqueue.trap!.why, fix: KINDS.memqueue.trap!.instead });
  }
  for (const n of g.nodes.filter((x) => x.kind === 'rabbit')) {
    flag({ id: `rabbit:${n.id}`, level: 'warn', nodeId: n.id, title: 'RabbitMQ deletes messages once consumed', why: KINDS.rabbit.trap!.why, fix: KINDS.rabbit.trap!.instead });
  }

  /* ---------- topics: inbound, keys, placement ---------- */
  const topicNodes = g.nodes.filter((n) => n.kind === 'topic');
  const topics: Record<string, TopicStats> = {};
  const topicIndex = new Map(topicNodes.map((t, i) => [t.id, i]));
  const groupNodes = g.nodes.filter((n) => n.kind === 'group' || n.kind === 'streams');
  // group output rates, filled by iteration (for streams outputs / DLQ topics)
  const groupOut = new Map<string, number>();

  const computeTopics = () => {
    for (const t of topicNodes) {
      const c = C(t.id);
      const rfWanted = c.rf;
      const rf = Math.min(rfWanted, B);
      const P = Math.max(1, c.partitions);
      const srcs = validIn(t.id).filter((x) => PRODUCING.includes(x.kind));
      let inRate = 0;
      const shares = new Array<number>(P).fill(0);
      const keyModes: string[] = [];
      let reorder = false;
      let sem: TopicStats['semanticsIn'] = 'once';
      let txIn = false;
      let bytes = 0;
      for (const s of srcs) {
        let r = 0;
        let key: NodeCfg['key'] = 'entity';
        let msgBytes = 1000;
        let ratio = 1;
        if (s.kind === 'group' || s.kind === 'streams') {
          r = s.kind === 'streams' ? groupOut.get(s.id) ?? 0 : (groupOut.get(`${s.id}:err`) ?? 0);
          if (s.kind === 'streams') {
            if (C(s.id).eos) txIn = true;
            else sem = sem === 'may-lose' ? sem : 'dups';
          }
        } else {
          const ps = producers[s.id];
          r = ps?.rate ?? 0;
          const sc = C(s.id);
          if (s.kind === 'service' || s.kind === 'cdc') {
            key = sc.key;
            msgBytes = s.kind === 'service' ? sc.msgBytes : 1000;
            ratio = COMPRESSION_RATIO[sc.compression] ?? 1;
            if (s.kind === 'service' && sc.transactional) txIn = true;
          }
          if (s.kind === 'memqueue') {
            const up = validIn(s.id).find((x) => x.kind === 'service');
            if (up) {
              key = C(up.id).key;
              msgBytes = C(up.id).msgBytes;
            }
          }
          if (ps) {
            if (ps.semantics === 'may-lose') sem = 'may-lose';
            else if (ps.semantics === 'dups' && sem === 'once') sem = 'dups';
            if (ps.reorder) reorder = true;
          }
        }
        keyModes.push(key);
        inRate += r;
        bytes += r * msgBytes * ratio;
        const hot = key === 'hot' || (chaos.hotKey && key === 'entity');
        if (hot && P > 1) {
          const h = Math.max(1 / P, key === 'hot' ? 0.4 : 0.35);
          shares[0] += r * h;
          for (let p = 1; p < P; p++) shares[p] += (r * (1 - h)) / (P - 1);
        } else for (let p = 0; p < P; p++) shares[p] += r / P;
      }
      // partition states
      const ti = topicIndex.get(t.id)!;
      const parts: PartitionState[] = [];
      let offline = 0;
      let blocked = 0;
      const acksAll = srcs.some((s) => (s.kind === 'service' || s.kind === 'cdc' ? C(s.id).acks === 'all' : true));
      for (let p = 0; p < P; p++) {
        const replicas = placement(ti, p, rf, B);
        const alive = replicas.filter((b) => !down.has(b));
        // A slow follower drops out of the ISR (the preferred leader stays the reference point).
        // If every ISR member then dies, only out-of-sync replicas remain: offline, or an unclean election.
        const prevIsr = replicas.filter((b) => b !== chaos.slowBroker || b === replicas[0]);
        const isrFinal = prevIsr.filter((b) => !down.has(b));
        let effLeader: number | null = isrFinal[0] ?? null;
        let unclean = false;
        if (effLeader === null && alive.length && c.unclean) {
          effLeader = alive[0];
          unclean = true;
          isrFinal.push(alive[0]);
        }
        const isOff = effLeader === null;
        const ner = !isOff && acksAll && isrFinal.length < c.minIsr;
        if (isOff) offline++;
        if (ner) blocked++;
        parts.push({ p, replicas, isr: isrFinal, leader: effLeader, offline: isOff, unclean, notEnoughReplicas: ner, share: inRate ? shares[p] / inRate : 1 / P, rate: shares[p], stuck: false });
      }
      const hotShare = Math.max(...parts.map((x) => x.share));
      // ordering
      let ordering: Ordering = 'per-key';
      if (!srcs.length) ordering = 'n/a';
      else if (keyModes.some((k) => k === 'random' || k === 'null')) ordering = P === 1 ? 'total' : 'none';
      else if (P === 1) ordering = 'total';
      if (reorder && ordering !== 'none') ordering = 'per-key*';
      // durability, from the weakest producer
      const acksList = srcs.filter((s) => s.kind === 'service' || s.kind === 'cdc').map((s) => C(s.id).acks);
      const weakest = acksList.includes('0') ? '0' : acksList.includes('1') ? '1' : 'all';
      const dur = durability(weakest, rfWanted, rf, c.minIsr, c.unclean, B);
      const mbps = bytes / 1e6;
      const diskGB =
        c.cleanup === 'compact'
          ? (Math.min(inRate * 3600 * 24, 2e6) * (bytes / Math.max(inRate, 1)) * rf) / 1e9
          : c.retentionH < 0
            ? Infinity
            : (mbps * 3600 * c.retentionH * rf) / 1000;
      const errorRate = inRate ? parts.filter((x) => x.offline || x.notEnoughReplicas).reduce((a, x) => a + x.rate, 0) / inRate : 0;
      topics[t.id] = {
        id: t.id,
        inRate,
        mbps,
        partitions: parts,
        rf,
        hotShare,
        ordering,
        durability: dur,
        diskGB,
        offline,
        blocked,
        errorRate,
        producers: srcs.map((s) => s.id),
        consumers: validOut(t.id).filter((x) => x.kind === 'group' || x.kind === 'streams').map((x) => x.id),
        keyModes,
        semanticsIn: sem,
        transactionalIn: txIn,
      };
    }
  };

  /* ---------- consumer groups ---------- */
  const groups: Record<string, GroupStats> = {};
  const computeGroups = () => {
    for (const n of groupNodes) {
      const c = C(n.id);
      const tIds = validIn(n.id).filter((x) => x.kind === 'topic').map((x) => x.id);
      const ts = tIds.map((id) => topics[id]).filter(Boolean);
      const parts = ts.flatMap((t) => t.partitions);
      const members = Math.max(1, c.consumers);
      const slow = chaos.slowGroup === n.id;
      const procMs = Math.max(0.02, c.procMs) * (slow ? 5 : 1);
      const capPer = 1000 / procMs;
      const assignor = c.assignor;
      const plan = assign(
        ts.map((t) => t.partitions.length),
        members,
        assignor,
      );
      const active = plan.filter((x) => x.length > 0).length;
      const idle = members - active;
      const inRate = ts.reduce((a, t) => a + t.inRate * (1 - t.errorRate), 0);
      // poison pill lands in the first partition of the first topic
      const poisonStuck = chaos.poison && n.kind === 'group' && (c.onError === 'crash' || c.onError === 'block-retry') && parts.length > 0;
      const evicted = procMs * c.maxPollRecords > 300000 && n.kind === 'group';
      let consumed = 0;
      let hottest = 0;
      let stuck = 0;
      plan.forEach((ps) => {
        let load = 0;
        for (const gi of ps) {
          const pt = parts[gi];
          if (!pt) continue;
          if (poisonStuck && gi === 0) {
            stuck++;
            continue;
          }
          load += pt.rate * (1 - (pt.offline || pt.notEnoughReplicas ? 1 : 0));
        }
        const done = Math.min(load, capPer);
        consumed += done;
        hottest = Math.max(hottest, capPer ? load / capPer : 0);
      });
      // rebalance storms: crash-looping consumer or eviction by max.poll.interval
      const eager = assignor !== 'coop';
      if ((poisonStuck && c.onError === 'crash') || evicted) consumed *= eager ? 0.45 : 0.85;
      // sink backpressure
      const sinks = validOut(n.id).filter((x) => x.kind === 'sink');
      const sinkCap = sinks.length ? Math.min(...sinks.map((s) => C(s.id).capacity)) : Infinity;
      if (consumed > sinkCap) consumed = sinkCap;
      const lagGrowth = Math.max(0, inRate - consumed);
      const util = inRate ? inRate / Math.max(1, Math.min(active * capPer, sinkCap)) : 0;
      const outTopics = validOut(n.id).filter((x) => x.kind === 'topic');
      groupOut.set(n.id, consumed);
      const errFrac = (chaos.poison ? POISON_RATE * 5 : POISON_RATE) * (c.onError === 'retry-dlq' ? 1 : 0);
      groupOut.set(`${n.id}:err`, consumed * errFrac);

      // semantics
      const loss: string[] = [];
      const dups: string[] = [];
      for (const t of ts) {
        if (t.semanticsIn === 'may-lose') loss.push('the producer side can drop records before they reach the log');
        if (t.semanticsIn === 'dups') dups.push('the producer side can write a record twice (retries without idempotence, or CDC replays)');
        if (t.durability.level < 2) loss.push(`acked records can vanish on a broker failure (${t.durability.label})`);
      }
      if (n.kind === 'group' && c.isolation === 'uncommitted' && ts.some((t) => t.transactionalIn))
        dups.push('read_uncommitted also delivers records from aborted transactions');
      const ownTopicCfg = tIds.map((id) => C(id));
      let sem: Semantics;
      if (n.kind === 'streams') {
        if (!c.eos) dups.push('without exactly_once_v2, a crash re-processes records since the last commit and re-emits outputs');
      } else {
        if (c.commit === 'before') loss.push('offsets are committed before processing, so a crash skips those records');
        if (c.commit === 'auto') dups.push('auto-commit replays up to 5 s of records after a crash (and skips some if you process asynchronously)');
        if (c.commit === 'after') dups.push('a crash between processing and commit re-delivers the batch');
        if (c.commit === 'txn' && sinks.length) dups.push('transactions cover Kafka writes only, so the external sink write can repeat');
        if (c.commit === 'txn' && !outTopics.length && !sinks.length) dups.push('transactional commit with no Kafka output is just a normal commit');
        if (c.onError === 'skip') loss.push('failed records are logged and skipped, so they are silently lost');
      }
      // retention loss
      let hoursToRetentionLoss: number | undefined;
      if (lagGrowth > 0.5 && inRate > 0) {
        const behindPerSec = lagGrowth / inRate; // seconds of backlog accumulated per second
        const ret = Math.min(...ownTopicCfg.map((x) => (x.retentionH < 0 || x.cleanup === 'compact' ? Infinity : x.retentionH)));
        if (Number.isFinite(ret)) {
          hoursToRetentionLoss = ret / behindPerSec;
          if (hoursToRetentionLoss < 48) loss.push(`at this lag the group falls off the ${ret} h retention window in ~${fmtH(hoursToRetentionLoss)}, then OffsetOutOfRange skips data`);
        }
      }
      const allSinksIdem = sinks.length > 0 && sinks.every((s) => C(s.id).idempotentSink);
      if (loss.length && dups.length) sem = 'none';
      else if (loss.length) sem = 'at-most-once';
      else if (dups.length) sem = allSinksIdem && n.kind === 'group' ? 'effectively-once' : 'at-least-once';
      else sem = 'exactly-once';
      if (!ts.length) sem = 'none';

      let ordering = worstOrdering(ts.map((t) => t.ordering));
      if (c.onError === 'retry-dlq' && n.kind === 'group' && ordering !== 'none' && ordering !== 'n/a') ordering = 'per-key*';

      const rebalance = eager
        ? `Eager (${assignor === 'range' ? 'Range' : assignor === 'roundrobin' ? 'RoundRobin' : 'Sticky'}): every join/leave pauses all ${active} active members`
        : 'Cooperative: only partitions that move pause';
      // Rolling deploy: each pod leaves and rejoins (2 rebalances) unless static membership keeps its identity.
      const deployRebalances = c.staticMembership ? 0 : 2 * members;
      const deployPause = eager ? deployRebalances * 3 : (deployRebalances * 3) / Math.max(1, members);
      groups[n.id] = {
        id: n.id,
        kind: n.kind === 'streams' ? 'streams' : 'group',
        topics: tIds,
        members,
        active,
        idle,
        capPer,
        inRate,
        consumed,
        lagGrowth,
        util,
        assignment: plan.map((x) => x.length),
        hottestMemberUtil: hottest,
        stuck,
        semantics: sem,
        loss,
        dups,
        ordering,
        hoursToRetentionLoss,
        evicted,
        rebalance,
        deployRebalances,
        deployPause,
        sinks: sinks.map((s) => s.id),
        outTopics: outTopics.map((x) => x.id),
      };
    }
    // rabbit consumers
    for (const r of g.nodes.filter((x) => x.kind === 'rabbit')) {
      const inRate = validIn(r.id).reduce((a, s) => a + (producers[s.id]?.rate ?? 0), 0);
      for (const cg of validOut(r.id).filter((x) => x.kind === 'group')) {
        const c = C(cg.id);
        const cap = Math.min(RABBIT_CAP, (c.consumers * 1000) / Math.max(0.02, c.procMs));
        const consumed = Math.min(inRate, cap);
        groups[cg.id] = {
          id: cg.id,
          kind: 'rabbit-consumer',
          topics: [],
          members: c.consumers,
          active: c.consumers,
          idle: 0,
          capPer: 1000 / c.procMs,
          inRate,
          consumed,
          lagGrowth: Math.max(0, inRate - consumed),
          util: inRate / Math.max(1, cap),
          assignment: [],
          hottestMemberUtil: inRate / Math.max(1, cap),
          stuck: 0,
          semantics: 'at-least-once',
          loss: [],
          dups: ['messages are redelivered if a consumer dies before acking'],
          ordering: c.consumers > 1 ? 'none' : 'total',
          evicted: false,
          rebalance: 'No partitions: competing consumers share one queue',
          deployRebalances: 0,
          deployPause: 0,
          sinks: validOut(cg.id).filter((x) => x.kind === 'sink').map((x) => x.id),
          outTopics: [],
        };
      }
    }
  };

  // Two passes so stream-processor outputs and DLQ rates propagate downstream.
  computeTopics();
  computeGroups();
  computeTopics();
  computeGroups();

  // stuck partitions visible on topic
  for (const gr of Object.values(groups)) {
    if (gr.stuck && gr.topics[0]) {
      const p0 = topics[gr.topics[0]]?.partitions[0];
      if (p0) p0.stuck = true;
    }
  }

  /* ---------- producer client model (batching, latency) ---------- */
  const brokers: BrokerStats[] = Array.from({ length: B }, (_, i) => ({
    id: i + 1,
    alive: !down.has(i + 1),
    slow: chaos.slowBroker === i + 1,
    leaders: 0,
    replicas: 0,
    mbps: 0,
    batches: 0,
    util: 0,
    controller: false,
  }));
  for (const t of Object.values(topics)) {
    const tc = C(t.id);
    const srcs = t.producers.map((id) => byId.get(id)!).filter(Boolean);
    const anyProducer = srcs.find((s) => s.kind === 'service' || s.kind === 'cdc');
    const pc = anyProducer ? C(anyProducer.id) : undefined;
    const msgBytes = pc && anyProducer!.kind === 'service' ? pc.msgBytes : 1000;
    for (const pt of t.partitions) {
      const lingerWindow = (pc?.lingerMs ?? 5) + 2;
      const maxMsgs = Math.max(1, ((pc?.batchKb ?? 16) * 1024) / msgBytes);
      const perBatch = Math.max(1, Math.min(maxMsgs, (pt.rate * lingerWindow) / 1000));
      const batches = pt.rate / perBatch;
      const ratio = pc ? COMPRESSION_RATIO[pc.compression] : 1;
      const effRatio = 1 - (1 - ratio) * Math.min(1, perBatch / 10);
      const mb = (pt.rate * msgBytes * effRatio) / 1e6;
      for (const b of pt.replicas) {
        const br = brokers[b - 1];
        br.replicas++;
        if (!br.alive) continue;
        br.mbps += mb;
        if (b === pt.leader) {
          br.leaders++;
          br.batches += batches;
        }
      }
    }
    void tc;
  }
  const alive = brokers.filter((b) => b.alive);
  if (alive.length) alive[0].controller = true;
  for (const b of brokers) b.util = b.alive ? Math.max(b.mbps / BROKER_MBPS, b.batches / BROKER_BATCHES) * (b.slow ? 2.5 : 1) : 0;
  const brokerUtil = Math.max(0, ...alive.map((b) => b.util));

  for (const ps of Object.values(producers)) {
    const n = byId.get(ps.id)!;
    if (n.kind !== 'service' && n.kind !== 'cdc') {
      ps.p99 = n.kind === 'poller' ? 5000 : 2;
      continue;
    }
    const c = C(ps.id);
    const tOut = validOut(ps.id).filter((x) => x.kind === 'topic').map((x) => topics[x.id]).filter(Boolean);
    const P = tOut.reduce((a, t) => a + t.partitions.length, 0) || 1;
    const partRate = ps.rate / P;
    const maxMsgs = Math.max(1, (c.batchKb * 1024) / (n.kind === 'service' ? c.msgBytes : 1000));
    const perBatch = Math.max(1, Math.min(maxMsgs, (partRate * (c.lingerMs + 2)) / 1000));
    ps.batchMsgs = perBatch;
    const ratio = COMPRESSION_RATIO[c.compression] ?? 1;
    ps.compression = 1 - (1 - ratio) * Math.min(1, perBatch / 10);
    const fillMs = partRate > 0 ? (maxMsgs / partRate) * 1000 : c.lingerMs;
    const waitMs = Math.min(c.lingerMs, fillMs);
    const ackMs = c.acks === '0' ? 0 : c.acks === '1' ? 1.5 : 4;
    const u = Math.min(brokerUtil, 0.97);
    const queue = u > 0.7 ? 1 / (1 - u) : 1;
    ps.p99 = waitMs + (1 + ackMs) * queue + (COMPRESSION_MS[c.compression] ?? 0) + 1;
    if (brokerUtil >= 1) ps.p99 = Math.max(ps.p99, 60000);
    const idem = c.idempotence && c.acks === 'all' && c.maxInFlight <= 5;
    if (c.idempotence && c.acks !== 'all')
      flag({
        id: `idemacks:${ps.id}`,
        level: 'bad',
        nodeId: ps.id,
        title: 'enable.idempotence=true requires acks=all',
        why: 'The client refuses to start with this combination (ConfigException). Idempotence relies on the leader confirming the batch is in the ISR.',
        fix: 'Use acks=all, or explicitly disable idempotence (and accept duplicates).',
      });
    if (n.kind === 'service') {
      ps.semantics = c.acks === '0' || !c.retries ? 'may-lose' : idem ? 'once' : 'dups';
      ps.reorder = c.retries && !idem && c.maxInFlight > 1;
      if (ps.dualWrite) ps.semantics = 'may-lose';
      if (validOut(ps.id).some((x) => x.kind === 'memqueue')) ps.semantics = 'may-lose';
    } else ps.semantics = 'dups';
    ps.errorRate = tOut.length ? Math.max(...tOut.map((t) => t.errorRate)) : 0;
    if (brokerUtil >= 1) ps.errorRate = Math.max(ps.errorRate, 1 - 1 / brokerUtil);
  }
  // Recompute topic semantics now producer semantics are final.
  computeTopics();
  computeGroups();
  for (const gr of Object.values(groups)) if (gr.stuck && gr.topics[0]) topics[gr.topics[0]].partitions[0].stuck = true;

  /* ---------- flags ---------- */
  for (const t of topicNodes) {
    const ts = topics[t.id];
    const c = C(t.id);
    const name = label(t);
    if (c.rf > B)
      flag({ id: `rf>b:${t.id}`, level: 'bad', nodeId: t.id, title: `RF ${c.rf} > ${B} brokers`, why: 'Topic creation fails with InvalidReplicationFactor: each replica must be on a different broker.', fix: `Add brokers or lower RF to ${B}.` });
    if (c.rf === 1)
      flag({ id: `rf1:${t.id}`, level: 'bad', nodeId: t.id, title: `${name}: RF=1 is a single copy`, why: 'One disk failure loses the data, and any broker restart takes its partitions offline.', fix: 'RF=3 with min.insync.replicas=2.' });
    if (c.rf >= 2 && c.minIsr >= c.rf)
      flag({ id: `isr=rf:${t.id}`, level: 'warn', nodeId: t.id, title: `${name}: min.insync.replicas (${c.minIsr}) ≥ RF (${c.rf})`, why: 'With acks=all, any single broker restart (even a rolling upgrade) makes the ISR too small and blocks all writes.', fix: 'min.insync.replicas = RF − 1.' });
    if (c.minIsr > c.rf) flag({ id: `isr>rf:${t.id}`, level: 'bad', nodeId: t.id, title: `${name}: min.insync.replicas > RF`, why: 'acks=all writes can never succeed.', fix: 'min.insync.replicas = RF − 1.' });
    if (c.rf >= 2 && c.minIsr === 1 && ts.durability.level < 2 && ts.keyModes.length > 0)
      flag({ id: `isr1:${t.id}`, level: 'warn', nodeId: t.id, title: `${name}: min.insync.replicas=1`, why: 'acks=all only waits for the *current* ISR. When followers fall behind and the ISR shrinks to the leader, one copy is enough to ack, and a leader crash then loses acked data.', fix: 'min.insync.replicas=2.' });
    if (c.unclean)
      flag({ id: `unclean:${t.id}`, level: 'warn', nodeId: t.id, title: `${name}: unclean leader election enabled`, why: 'If every in-sync replica is gone, a stale replica becomes leader and acknowledged records it never received are lost for good.', fix: 'Keep it off for business data. It’s acceptable for metrics or logs.' });
    if (ts.offline)
      flag({ id: `off:${t.id}`, level: 'bad', nodeId: t.id, title: `${name}: ${ts.offline} partition${ts.offline > 1 ? 's' : ''} offline`, why: 'No live in-sync replica to lead them. Producers to those partitions fail and consumers stall.', fix: c.rf === 1 ? 'Increase RF so another broker has a copy.' : 'Restore a broker that holds an in-sync replica.' });
    if (ts.blocked)
      flag({ id: `ner:${t.id}`, level: 'bad', nodeId: t.id, title: `${name}: NotEnoughReplicas on ${ts.blocked} partition${ts.blocked > 1 ? 's' : ''}`, why: `ISR fell below min.insync.replicas=${c.minIsr}, so acks=all writes are rejected. Kafka is choosing consistency over availability.`, fix: 'Restore the broker, or (if you accept the risk) lower min.insync.replicas.' });
    if (ts.partitions.some((p) => p.unclean))
      flag({ id: `uncl-now:${t.id}`, level: 'bad', nodeId: t.id, title: `${name}: unclean election just lost data`, why: 'An out-of-sync replica became leader. Records it had not fetched are gone, and the other replicas truncate their logs to match.' });
    if (ts.hotShare > 2 / ts.partitions.length && ts.partitions.length > 1 && ts.inRate > 0)
      flag({ id: `hot:${t.id}`, level: 'warn', nodeId: t.id, title: `${name}: hot partition (${Math.round(ts.hotShare * 100)}% of traffic on one)`, why: 'One key (or tenant) dominates. Its partition’s single consumer and leader broker become the bottleneck no matter how many partitions you add.', fix: 'Salt the hot key (key + suffix, merge downstream), or split that tenant to its own topic.' });
    if (c.cleanup === 'compact' && ts.keyModes.includes('null'))
      flag({ id: `cmpnull:${t.id}`, level: 'bad', nodeId: t.id, title: `${name}: compacted topic receives null keys`, why: 'Compaction keeps the latest record per key. Records without a key are rejected by the broker (InvalidRecordException).', fix: 'Key every record by entity id.' });
    if (c.cleanup === 'compact' && ts.keyModes.includes('random'))
      flag({ id: `cmprnd:${t.id}`, level: 'warn', nodeId: t.id, title: `${name}: compaction with random keys does nothing`, why: 'Every key is unique, so nothing is ever superseded and the topic grows forever.', fix: 'Key by entity id so newer values replace older ones.' });
    if (ts.keyModes.includes('random') && ts.partitions.length > 1)
      flag({ id: `rnd:${t.id}`, level: 'warn', nodeId: t.id, title: `${name}: random keys scatter each entity`, why: 'Events of the same order/user land on different partitions and are consumed in parallel, so “cancelled” can be processed before “created”.', fix: 'Key by the entity whose events must stay ordered.' });
    if (!ts.producers.length) flag({ id: `noprod:${t.id}`, level: 'info', nodeId: t.id, title: `${name} has no producer`, why: 'Nothing writes to it yet.' });
    if (!ts.consumers.length && ts.producers.length && C(t.id).role !== 'dlq') flag({ id: `nocons:${t.id}`, level: 'info', nodeId: t.id, title: `${name} has no consumers`, why: 'Records are retained but nobody reads them yet.' });
    if (C(t.id).retentionH < 0 && C(t.id).cleanup === 'delete' && ts.inRate > 1000)
      flag({ id: `forever:${t.id}`, level: 'info', nodeId: t.id, title: `${name}: infinite retention`, why: 'Disk grows without bound. Fine for an event-sourced system of record, but plan for tiered storage (KIP-405) to offload old segments to S3.' });
    if (ts.partitions.length * ts.rf > 4000 * B) flag({ id: `toomany:${t.id}`, level: 'info', nodeId: t.id, title: 'Very high partition count', why: 'Thousands of partitions per broker slow down failover and increase memory and file-handle use.' });
  }
  for (const n of g.nodes.filter((x) => x.kind === 'service')) {
    const ps = producers[n.id];
    const c = C(n.id);
    if (!ps) continue;
    if (c.acks === '0') flag({ id: `acks0:${n.id}`, level: 'warn', nodeId: n.id, title: `${label(n)}: acks=0 is fire-and-forget`, why: 'The producer never learns if a write failed. Any leader change, network blip or full disk silently drops records.', fix: 'acks=all for anything you would miss.' });
    if (c.acks === '1') flag({ id: `acks1:${n.id}`, level: 'warn', nodeId: n.id, title: `${label(n)}: acks=1 acknowledges before replication`, why: 'If the leader dies after acking but before followers fetch the batch, a follower becomes leader without it. The producer thinks it succeeded.', fix: 'acks=all + min.insync.replicas=2.' });
    if (!c.retries) flag({ id: `noretry:${n.id}`, level: 'warn', nodeId: n.id, title: `${label(n)}: retries disabled`, why: 'Leader elections and rolling restarts produce brief retriable errors. Without retries those records are dropped.', fix: 'Leave retries on (default MAX_INT) with enable.idempotence=true.' });
    if (ps.reorder) flag({ id: `reorder:${n.id}`, level: 'warn', nodeId: n.id, title: `${label(n)}: retries can reorder and duplicate`, why: `With ${c.maxInFlight} in-flight requests and no idempotence, batch 2 can land while batch 1 is being retried, so batch 1 ends up after it. A lost ack also means a duplicate write.`, fix: 'enable.idempotence=true (keeps order with up to 5 in-flight).' });
    if (c.lingerMs === 0 && ps.rate >= 50000) flag({ id: `linger0:${n.id}`, level: 'info', nodeId: n.id, title: `${label(n)}: linger.ms=0 at high rate`, why: `Only ~${Math.round(ps.batchMsgs)} records per batch, so many small requests, more broker CPU and worse compression.`, fix: 'linger.ms 5–20 and batch.size 64–256 KB.' });
    if (c.compression === 'none' && ps.rate * c.msgBytes > 20e6) flag({ id: `nocomp:${n.id}`, level: 'info', nodeId: n.id, title: `${label(n)}: ${Math.round((ps.rate * c.msgBytes) / 1e6)} MB/s uncompressed`, why: 'Network, disk and replication all carry full-size text.', fix: 'compression.type=lz4 or zstd. JSON typically shrinks 3–5×.' });
    if (c.compression === 'gzip' && ps.rate > 50000) flag({ id: `gzip:${n.id}`, level: 'info', nodeId: n.id, title: `${label(n)}: gzip at high rate`, why: 'gzip costs much more producer CPU and latency than lz4/zstd for a similar ratio.', fix: 'zstd (better ratio) or lz4 (faster).' });
    if (c.transactional && Object.values(groups).some((gr) => gr.topics.some((t) => topics[t]?.producers.includes(n.id)) && C(gr.id).isolation === 'uncommitted'))
      flag({ id: `rc:${n.id}`, level: 'warn', nodeId: n.id, title: 'Transactional producer, read_uncommitted consumer', why: 'Consumers see records from aborted and still-open transactions, which defeats the point.', fix: 'isolation.level=read_committed on consumers.' });
  }
  for (const n of groupNodes) {
    const gr = groups[n.id];
    const c = C(n.id);
    if (!gr) continue;
    const name = label(n);
    if (!gr.topics.length) flag({ id: `nosub:${n.id}`, level: 'warn', nodeId: n.id, title: `${name} isn’t subscribed to any topic`, why: 'Connect a topic → this group.' });
    if (gr.idle > 0 && gr.topics.length)
      flag({
        id: `idle:${n.id}`,
        level: 'warn',
        nodeId: n.id,
        title: `${name}: ${gr.idle} of ${gr.members} consumers idle`,
        why:
          c.assignor === 'range' && gr.topics.length > 1 && gr.active < Math.min(gr.members, gr.assignment.reduce((a, b) => a + b, 0))
            ? 'The Range assignor assigns each topic separately, so with several small topics the same low-numbered members get everything.'
            : 'A partition is consumed by at most one member of a group. Members beyond the partition count get no partitions.',
        fix: c.assignor === 'range' && gr.topics.length > 1 ? 'Use CooperativeSticky (or RoundRobin), or add partitions.' : 'Add partitions (≥ consumers), or run fewer consumers.',
      });
    if (gr.lagGrowth > 1)
      flag({
        id: `lag:${n.id}`,
        level: 'bad',
        nodeId: n.id,
        title: `${name}: lag growing +${fmtN(gr.lagGrowth)}/s`,
        why:
          gr.stuck > 0
            ? 'A poison record is stuck at the head of one partition. Everything behind it waits.'
            : gr.hottestMemberUtil > 1 && gr.active * gr.capPer >= gr.inRate
              ? 'Total capacity is enough, but one member owns a hot partition it can’t keep up with.'
              : gr.sinks.length && gr.consumed >= Math.min(...gr.sinks.map((s) => C(s).capacity)) - 1
                ? 'The sink can’t absorb the write rate, so consumers block on it.'
                : `Each consumer handles ~${fmtN(gr.capPer)}/s; ${gr.active} active consumers can’t keep up with ${fmtN(gr.inRate)}/s.`,
        fix:
          gr.stuck > 0
            ? 'Move failures aside: retry topic + DLQ.'
            : gr.idle > 0 || gr.active >= gr.assignment.reduce((a, b) => a + b, 0)
              ? 'Add partitions and consumers together, or make processing faster (batch DB writes).'
              : 'Add consumers (up to the partition count) or make processing faster.',
      });
    if (n.kind === 'group' && c.commit === 'before') flag({ id: `cb:${n.id}`, level: 'warn', nodeId: n.id, title: `${name}: commit before processing = at-most-once`, why: 'If the consumer dies after committing but before finishing, those records are never processed.', fix: 'Process, then commit (at-least-once) with an idempotent sink.' });
    if (n.kind === 'group' && c.onError === 'skip') flag({ id: `skip:${n.id}`, level: 'warn', nodeId: n.id, title: `${name}: failures are skipped`, why: 'A transient downstream error (DB failover) drops real records, not just malformed ones.', fix: 'Retry topic + DLQ, and alert on DLQ depth.' });
    if (n.kind === 'group' && c.onError === 'crash')
      flag({
        id: `crash:${n.id}`,
        level: chaos.poison ? 'bad' : 'info',
        nodeId: n.id,
        title: chaos.poison ? `${name}: poison pill, crash loop` : `${name}: one bad record will crash-loop the consumer`,
        why: 'The consumer throws, restarts, resumes from the same committed offset and hits the same record again. That partition is stuck, and every restart triggers a rebalance.',
        fix: 'Catch deserialization/processing errors and publish the record to a retry topic / DLQ.',
      });
    if (n.kind === 'group' && c.onError === 'block-retry' && chaos.poison)
      flag({ id: `hol:${n.id}`, level: 'bad', nodeId: n.id, title: `${name}: head-of-line blocking`, why: 'Retrying the poison record in place blocks every record behind it in that partition.', fix: 'Non-blocking retries: retry topic(s) with backoff, then DLQ.' });
    if (n.kind === 'group' && c.onError === 'retry-dlq' && !gr.outTopics.length)
      flag({ id: `nodlq:${n.id}`, level: 'warn', nodeId: n.id, title: `${name}: retry/DLQ strategy but no retry or DLQ topic wired`, why: 'Failed records have nowhere to go.', fix: 'Add a topic (role: retry or dlq) and connect this group → it.' });
    if (gr.evicted)
      flag({ id: `evict:${n.id}`, level: 'bad', nodeId: n.id, title: `${name}: evicted by max.poll.interval.ms`, why: `${c.maxPollRecords} records × ${fmtN(1000 / gr.capPer)} ms = ${Math.round((c.maxPollRecords * 1000) / gr.capPer / 1000)} s per poll, over the 300 s limit. The member is kicked out, rebalances, gets the same batch and times out again: a rebalance storm.`, fix: 'Lower max.poll.records, or speed up processing.' });
    if (n.kind === 'group' && gr.sinks.some((s) => !C(s).idempotentSink) && gr.dups.length && !gr.loss.length)
      flag({ id: `dupsink:${n.id}`, level: 'warn', nodeId: n.id, title: `${name}: duplicates reach the sink`, why: 'At-least-once delivery + plain INSERTs = duplicate rows (double emails, double charges) after any crash or rebalance.', fix: 'Make the sink idempotent: upsert / dedupe on event id.' });
    if (gr.assignment.length && c.assignor !== 'coop' && gr.members >= 6)
      flag({ id: `eager:${n.id}`, level: 'info', nodeId: n.id, title: `${name}: eager rebalancing with ${gr.members} members`, why: 'Every deploy, scale event or crash revokes all partitions from everyone (stop-the-world). A rolling deploy causes one pause per pod.', fix: 'CooperativeSticky assignor + static membership (group.instance.id).' });
    if (n.kind === 'streams' && gr.topics.length >= 2) {
      const counts = new Set(gr.topics.map((t) => topics[t]?.partitions.length));
      const keys = new Set(gr.topics.flatMap((t) => topics[t]?.keyModes ?? []));
      if (counts.size > 1)
        flag({ id: `copart:${n.id}`, level: 'bad', nodeId: n.id, title: `${name}: join inputs are not co-partitioned`, why: `Input topics have ${[...counts].join(' vs ')} partitions. A join reads partition i of each input in the same task, so key K must live in the same partition number on both. With different counts, hash(K) % N differs, and Kafka Streams fails with a TopologyException (or a hand-rolled join silently misses matches).`, fix: 'Same partition count and same key on every joined topic (repartition one side).' });
      if (keys.has('random') || keys.has('null'))
        flag({ id: `copartkey:${n.id}`, level: 'bad', nodeId: n.id, title: `${name}: join input isn’t keyed by the join key`, why: 'Matching records land in different partitions, so the join never sees both sides.', fix: 'Key both inputs by the join key (e.g. orderId).' });
    }
    if (n.kind === 'streams' && !c.eos && gr.outTopics.length)
      flag({ id: `noeos:${n.id}`, level: 'info', nodeId: n.id, title: `${name}: at-least-once processing`, why: 'After a crash, records since the last commit are re-processed: aggregates double-count and outputs repeat.', fix: 'processing.guarantee=exactly_once_v2.' });
  }
  const consumerGroups = groupNodes.filter((n) => groups[n.id]?.topics.length);
  if (!hasRegistry && consumerGroups.length >= 2)
    flag({ id: 'noschema', level: 'info', title: 'No schema registry', why: `${consumerGroups.length} independent consumers depend on the event format. One producer-side field rename breaks them all at deploy time.`, fix: 'Add a schema registry with BACKWARD compatibility.' });

  /* ---------- edge rates & node views ---------- */
  for (const e of g.edges) {
    const ev = edges[e.id];
    if (!ev || ev.failing) continue;
    const a = byId.get(e.from)!;
    const b = byId.get(e.to)!;
    if (a.kind === 'service' || a.kind === 'cdc' || a.kind === 'poller' || a.kind === 'memqueue') {
      ev.rate = b.kind === 'postgres' ? producers[a.id]?.rate ?? 0 : producers[a.id]?.rate ?? 0;
      if (b.kind === 'topic') ev.failing = (topics[b.id]?.errorRate ?? 0) > 0.5;
    } else if (a.kind === 'postgres') ev.rate = dbRate.get(a.id) ?? 0;
    else if (a.kind === 'topic') ev.rate = groups[b.id]?.consumed ?? 0;
    else if (a.kind === 'group' || a.kind === 'streams') ev.rate = b.kind === 'sink' ? groups[a.id]?.consumed ?? 0 : groupOut.get(a.kind === 'streams' ? a.id : `${a.id}:err`) ?? 0;
    else if (a.kind === 'rabbit') ev.rate = groups[b.id]?.consumed ?? 0;
    if (a.kind === 'topic' && groups[b.id]?.stuck) ev.failing = false;
  }

  const view: Record<string, NodeView> = {};
  for (const n of g.nodes) {
    const c = C(n.id);
    const wrong = n.kind === 'poller' || n.kind === 'memqueue' || flags.some((f) => f.nodeId === n.id && f.level === 'bad' && f.id.startsWith('dual'));
    if (n.kind === 'service' || n.kind === 'cdc' || n.kind === 'poller' || n.kind === 'memqueue') {
      const ps = producers[n.id];
      view[n.id] = {
        status: wrong ? 'wrong' : ps?.errorRate && ps.errorRate > 0.01 ? 'blocked' : brokerUtil >= 1 ? 'overloaded' : 'ok',
        util: brokerUtil,
        line: ps ? `${fmtN(ps.rate)}/s` : 'not connected',
        sub: ps && (n.kind === 'service' || n.kind === 'cdc') ? `acks=${c.acks} · p99 ${fmtMs(ps.p99)}` : undefined,
      };
    } else if (n.kind === 'topic') {
      const t = topics[n.id];
      view[n.id] = {
        status: t.offline ? 'blocked' : t.blocked ? 'blocked' : t.hotShare > 2 / t.partitions.length && t.partitions.length > 1 && t.inRate > 0 ? 'hot' : 'ok',
        util: brokerUtil,
        line: `${c.partitions}p · RF${t.rf} · isr≥${c.minIsr}`,
        sub: `${fmtN(t.inRate)}/s · ${t.mbps >= 0.1 ? `${t.mbps.toFixed(t.mbps < 10 ? 1 : 0)} MB/s` : '<0.1 MB/s'}`,
      };
    } else if (n.kind === 'group' || n.kind === 'streams') {
      const gr = groups[n.id];
      view[n.id] = gr
        ? {
            status: gr.lagGrowth > 1 ? 'overloaded' : gr.idle ? 'idle' : gr.util > 0.75 ? 'hot' : 'ok',
            util: gr.util,
            line: gr.idle ? `${gr.active} active · ${gr.idle} idle` : `${gr.members} consumer${gr.members > 1 ? 's' : ''}`,
            sub: gr.lagGrowth > 1 ? `lag +${fmtN(gr.lagGrowth)}/s` : `${fmtN(gr.consumed)}/s`,
          }
        : { status: 'idle', util: 0, line: `${c.consumers} consumers`, sub: 'no input' };
    } else if (n.kind === 'sink') {
      const load = Object.values(groups)
        .filter((gr) => gr.sinks.includes(n.id))
        .reduce((a, gr) => a + gr.consumed, 0);
      const u = load / Math.max(1, c.capacity);
      view[n.id] = { status: u >= 0.99 ? 'overloaded' : u > 0.75 ? 'hot' : 'ok', util: u, line: `${fmtN(load)} writes/s`, sub: c.idempotentSink ? 'idempotent upsert' : 'plain insert' };
    } else if (n.kind === 'postgres') view[n.id] = { status: 'ok', util: 0, line: `${fmtN(dbRate.get(n.id) ?? 0)} tx/s` };
    else if (n.kind === 'rabbit') view[n.id] = { status: 'wrong', util: 0, line: 'no replay' };
    else view[n.id] = { status: 'ok', util: 0, line: '' };
  }

  /* ---------- headline metrics ---------- */
  const ts = Object.values(topics).filter((t) => C(t.id).role === 'main' || C(t.id).role === 'changelog');
  const allTopics = Object.values(topics);
  const gs = Object.values(groups).filter((x) => x.topics.length || x.kind === 'rabbit-consumer');
  const ingest = ts.reduce((a, t) => a + t.inRate, 0) + Object.values(groups).filter((x) => x.kind === 'rabbit-consumer').reduce((a, x) => a + x.inRate, 0);
  const ingestMB = allTopics.reduce((a, t) => a + t.mbps, 0);
  // max sustainable scale factor
  let scale = Infinity;
  let bottleneck = '—';
  for (const b of alive)
    if (b.util > 0 && 1 / b.util < scale) {
      scale = 1 / b.util;
      bottleneck = `broker ${b.id} (${b.mbps / BROKER_MBPS >= b.batches / BROKER_BATCHES ? 'disk/network bytes' : 'request rate: batches too small'})`;
    }
  for (const gr of gs) {
    if (!gr.inRate) continue;
    const s = gr.hottestMemberUtil > 0 ? 1 / gr.hottestMemberUtil : Infinity;
    const label0 = label(byId.get(gr.id)!);
    if (s < scale) {
      scale = s;
      bottleneck = gr.idle === 0 && gr.active < gr.assignment.reduce((a, b) => a + b, 0) ? `${label0} (consumers)` : gr.hottestMemberUtil > gr.util * 1.3 ? `${label0} (hot partition)` : `${label0} (partitions × consumer speed)`;
    }
    for (const sid of gr.sinks) {
      const cap = C(sid).capacity;
      if (cap / gr.inRate < scale) {
        scale = cap / gr.inRate;
        bottleneck = label(byId.get(sid)!);
      }
    }
  }
  const maxThroughput = Number.isFinite(scale) ? ingest * scale : ingest > 0 ? Infinity : 0;
  const prodList = Object.values(producers).filter((p) => byId.get(p.id)!.kind !== 'memqueue');
  const produceP99 = prodList.length ? Math.max(...prodList.map((p) => p.p99)) : 0;
  let e2e = 0;
  for (const gr of gs) {
    if (gr.lagGrowth > 1 || gr.stuck) {
      e2e = Infinity;
      break;
    }
    const n = byId.get(gr.id)!;
    const c = C(gr.id);
    const u = Math.min(gr.hottestMemberUtil, 0.97);
    const queue = (1000 / gr.capPer) * (u > 0.6 ? u / (1 - u) : 0.2);
    const repl = Math.max(0, ...gr.topics.map((t) => (topics[t]?.rf ?? 1) > 1 ? 3 : 0));
    const eos = n.kind === 'streams' && c.eos ? 100 : 0;
    const poll = gr.topics.some((t) => topics[t]?.producers.some((p) => byId.get(p)?.kind === 'poller')) ? 5000 : 0;
    e2e = Math.max(e2e, produceP99 + repl + 2 + 1000 / gr.capPer + queue + eos + poll);
  }
  const durs = ts.filter((t) => t.producers.length).map((t) => t.durability);
  const dur = durs.length ? durs.reduce((a, b) => (a.level <= b.level ? a : b)) : { level: 0 as const, label: 'no data yet', lossOn1: true, writesOn1: false };
  const metrics: Metrics = {
    connected: ingest > 0 && gs.some((x) => x.inRate > 0),
    ingest,
    ingestMB,
    maxThroughput,
    bottleneck,
    produceP99,
    e2eP99: gs.length ? e2e : 0,
    lagGrowth: gs.reduce((a, x) => a + x.lagGrowth, 0),
    semantics: worstSem(gs.filter((x) => x.inRate > 0 || x.topics.length).map((x) => x.semantics)),
    ordering: worstOrdering(gs.map((x) => x.ordering)),
    durability: dur,
    activeConsumers: gs.reduce((a, x) => a + x.active, 0),
    idleConsumers: gs.reduce((a, x) => a + x.idle, 0),
    partitions: allTopics.reduce((a, t) => a + t.partitions.length, 0),
    diskGB: allTopics.reduce((a, t) => a + t.diskGB, 0),
    errorRate: prodList.length ? Math.max(...prodList.map((p) => p.errorRate)) : 0,
    brokersUp: alive.length,
    deployPause: gs.reduce((a, x) => Math.max(a, x.deployPause), 0),
  };
  const order: Record<string, number> = { bad: 0, warn: 1, info: 2 };
  flags.sort((a, b) => order[a.level] - order[b.level]);
  return { topics, groups, producers, brokers, view, edges, metrics, flags };
}

function durability(acks: string, rfWanted: number, rf: number, minIsr: number, unclean: boolean, brokers: number): Durability {
  const writesOn1 = acks !== 'all' ? rf >= 2 : rf - 1 >= minIsr && rf >= 2;
  if (rfWanted > brokers) return { level: 0, label: 'topic cannot be created', lossOn1: true, writesOn1: false };
  if (rf === 1) return { level: 0, label: 'RF=1: a single copy', lossOn1: true, writesOn1: false };
  if (acks === '0') return { level: 0, label: 'acks=0: no confirmation at all', lossOn1: true, writesOn1 };
  if (acks === '1') return { level: 1, label: 'acks=1: leader-only ack', lossOn1: true, writesOn1 };
  if (minIsr < 2) return { level: 1, label: 'acks=all but min.insync=1', lossOn1: true, writesOn1 };
  if (unclean) return { level: 1, label: 'unclean election can drop acked writes', lossOn1: false, writesOn1 };
  return { level: 2, label: `acked by ≥${minIsr} replicas`, lossOn1: false, writesOn1 };
}

/* ------------------------------------------------------------------ */

export function label(n: KNode): string {
  return n.label ?? KINDS[n.kind].name;
}

export function fmtN(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  if (a >= 10 || a === 0) return `${Math.round(n)}`;
  return n.toFixed(1);
}

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  if (ms >= 60000) return `${Math.round(ms / 60000)} min`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
}

function fmtH(h: number): string {
  return h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h`;
}

export const edgeIdOf = (from: string, to: string) => `${from}->${to}`;
export type { KEdge };
