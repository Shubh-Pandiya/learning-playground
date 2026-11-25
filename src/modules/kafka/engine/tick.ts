/**
 * Deterministic visual state for the animated views: partition logs with offsets, replica LEO/HW,
 * committed offsets per group, and a narrated cluster event log when chaos changes leadership.
 * `t` is a frame counter; nothing here is random.
 */
import type { KGraph, KeyStrategy } from '../types';
import { cfgOf } from './defaults';
import type { Model } from './model';

export const KEY_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#db2777', '#0891b2', '#65a30d', '#dc2626'];

/** murmur2-ish stand-in: a stable small hash. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Cell {
  offset: number;
  /** Index into KEY_COLORS, or -1 for no key. */
  key: number;
  poison?: boolean;
}

export interface ReplicaView {
  broker: number;
  leo: number;
  inIsr: boolean;
  leader: boolean;
  alive: boolean;
}

export interface PartitionView {
  p: number;
  leo: number;
  hw: number;
  cells: Cell[];
  replicas: ReplicaView[];
  committed: Record<string, number>;
  offline: boolean;
  stuck: boolean;
  hot: boolean;
}

/** Which keys (0..7) hash to partition p of P. */
function keysFor(p: number, P: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 8; k++) if (hash(`user-${k}`) % P === p) out.push(k);
  return out;
}

/** Records visible per partition per frame, normalised so the busiest partition grows ~1 cell/frame. */
export function partitionViews(g: KGraph, m: Model, topicId: string, t: number, window = 14): PartitionView[] {
  const ts = m.topics[topicId];
  if (!ts) return [];
  const node = g.nodes.find((n) => n.id === topicId)!;
  const c = cfgOf(node);
  const P = ts.partitions.length;
  const maxRate = Math.max(1, ...ts.partitions.map((p) => p.rate));
  const key: KeyStrategy = (ts.keyModes[0] as KeyStrategy) ?? 'entity';
  return ts.partitions.map((pt) => {
    const speed = pt.rate / maxRate;
    const leo = Math.floor(t * speed * 0.6) + 20 + pt.p * 3;
    const pkeys = keysFor(pt.p, P);
    const cells: Cell[] = [];
    for (let o = Math.max(0, leo - window); o < leo; o++) {
      let k: number;
      if (key === 'null') k = -1;
      else if (key === 'random') k = hash(`${pt.p}:${o}`) % 8;
      else if ((key === 'hot' || pt.share > 2 / P) && pt.p === 0) k = hash(`${o}`) % 4 === 0 ? (pkeys[0] ?? 0) : 7;
      else k = pkeys.length ? pkeys[hash(`${pt.p}:${o}`) % pkeys.length] : hash(`${pt.p}:${o}`) % 8;
      cells.push({ offset: o, key: k, poison: pt.stuck && o === leo - window + 3 });
    }
    // replicas: followers trail by a couple of records; a slow follower trails a lot and is out of the ISR
    const replicas: ReplicaView[] = pt.replicas.map((b, i) => {
      const alive = m.brokers[b - 1]?.alive ?? false;
      const leader = b === pt.leader;
      const inIsr = pt.isr.includes(b);
      const lag = leader ? 0 : inIsr ? 1 + (i % 2) : Math.min(leo, 9);
      return { broker: b, leo: alive ? leo - lag : leo - 12, inIsr, leader, alive };
    });
    const isrLeos = replicas.filter((r) => r.inIsr && r.alive).map((r) => r.leo);
    const hw = isrLeos.length ? Math.min(...isrLeos) : 0;
    const committed: Record<string, number> = {};
    for (const gid of ts.consumers) {
      const gr = m.groups[gid];
      if (!gr) continue;
      const behind = gr.stuck && pt.stuck ? Math.min(window - 3, Math.floor(t * 0.6 * speed)) : gr.lagGrowth > 1 ? Math.min(window - 1, Math.floor((t * 0.6 * speed * gr.lagGrowth) / Math.max(1, gr.inRate))) + 1 : 1;
      committed[gid] = Math.max(0, hw - behind);
    }
    void c;
    return { p: pt.p, leo, hw, cells, replicas, committed, offline: pt.offline, stuck: pt.stuck, hot: pt.share > 2 / P && P > 1 };
  });
}

export interface ClusterEvent {
  level: 'info' | 'warn' | 'bad' | 'ok';
  text: string;
}

/** Narrates what the controller did between two cluster states. */
export function clusterEvents(before: Model, after: Model, names: Record<string, string>): ClusterEvent[] {
  const ev: ClusterEvent[] = [];
  for (const b of after.brokers) {
    const was = before.brokers[b.id - 1];
    if (was?.alive && !b.alive) ev.push({ level: 'bad', text: `Broker ${b.id} stopped heartbeating to the controller. After the session timeout it is fenced and its replicas leave every ISR.` });
    if (was && !was.alive && b.alive) ev.push({ level: 'ok', text: `Broker ${b.id} is back. Its replicas truncate to the leader epoch, fetch the missing records, then rejoin the ISR.` });
    if (was && !was.slow && b.slow) ev.push({ level: 'warn', text: `Broker ${b.id} is slow (disk / GC). Follower replicas on it stop catching up within replica.lag.time.max.ms (30 s) and are removed from the ISR.` });
  }
  if (before.brokers.find((b) => b.controller)?.id !== after.brokers.find((b) => b.controller)?.id && after.brokers.some((b) => b.controller))
    ev.push({ level: 'info', text: `KRaft quorum elected a new active controller (broker ${after.brokers.find((b) => b.controller)!.id}).` });
  for (const [id, t] of Object.entries(after.topics)) {
    const old = before.topics[id];
    if (!old) continue;
    const name = names[id] ?? id;
    const moved = t.partitions.filter((p, i) => old.partitions[i] && old.partitions[i].leader !== p.leader && p.leader !== null && !p.unclean);
    if (moved.length)
      ev.push({ level: 'info', text: `${name}: controller elected new leaders for ${moved.length} partition${moved.length > 1 ? 's' : ''} from the ISR (${moved.slice(0, 3).map((p) => `p${p.p}→b${p.leader}`).join(', ')}${moved.length > 3 ? '…' : ''}). The leader epoch is bumped, so clients refresh metadata and retry.` });
    const shrunk = t.partitions.filter((p, i) => old.partitions[i] && p.isr.length < old.partitions[i].isr.length && !p.offline);
    if (shrunk.length) ev.push({ level: 'warn', text: `${name}: ISR shrank on ${shrunk.length} partition${shrunk.length > 1 ? 's' : ''} (now ${shrunk[0].isr.length} in sync).` });
    const off = t.partitions.filter((p, i) => p.offline && !old.partitions[i]?.offline);
    if (off.length) ev.push({ level: 'bad', text: `${name}: ${off.length} partition${off.length > 1 ? 's have' : ' has'} no in-sync replica left and went OFFLINE. Produce and fetch fail until one returns.` });
    const unc = t.partitions.filter((p, i) => p.unclean && !old.partitions[i]?.unclean);
    if (unc.length) ev.push({ level: 'bad', text: `${name}: UNCLEAN election on ${unc.map((p) => `p${p.p}`).join(', ')}. An out-of-sync replica is leader, and the records it never fetched are gone.` });
    if (t.blocked > old.blocked) ev.push({ level: 'bad', text: `${name}: ISR < min.insync.replicas on ${t.blocked} partition${t.blocked > 1 ? 's' : ''}. acks=all produce returns NOT_ENOUGH_REPLICAS (reads still work).` });
    if (t.blocked < old.blocked && t.blocked === 0) ev.push({ level: 'ok', text: `${name}: ISR back to min.insync.replicas, so writes accepted again.` });
  }
  for (const [id, gr] of Object.entries(after.groups)) {
    const old = before.groups[id];
    if (!old) continue;
    const name = names[id] ?? id;
    if (gr.stuck && !old.stuck) ev.push({ level: 'bad', text: `${name}: poison record at the head of a partition. The consumer can’t get past that offset.` });
    if (gr.lagGrowth > 1 && old.lagGrowth <= 1) ev.push({ level: 'warn', text: `${name}: consumption fell behind; lag now grows ${Math.round(gr.lagGrowth)}/s.` });
    if (gr.lagGrowth <= 1 && old.lagGrowth > 1) ev.push({ level: 'ok', text: `${name}: caught up, so lag is stable again.` });
  }
  return ev;
}
