import { useCallback, useMemo, useRef, useState } from 'react';
import { KINDS } from '../data/components';
import { KNOB, fmtKnobValue } from '../data/knobs';
import { cfgOf } from '../engine/defaults';
import { diff, type Impact } from '../engine/impact';
import { edgeValidity, edgeIdOf, evaluate, label, type Model } from '../engine/model';
import { clusterEvents, type ClusterEvent } from '../engine/tick';
import { NO_CHAOS, type Chaos, type ClusterCfg, type KGraph, type KKind, type NodeCfg } from '../types';

export interface LogEntry extends Impact {
  events: ClusterEvent[];
  source: 'you' | 'chaos' | 'lesson';
}

export interface Lab {
  g: KGraph;
  chaos: Chaos;
  m: Model;
  log: LogEntry[];
  fresh: Set<string>;
  names: Record<string, string>;
  /** Replace the graph and narrate the change. */
  commit: (next: KGraph, change: string, how?: string, source?: LogEntry['source']) => LogEntry;
  setChaos: (next: Chaos, change: string, how?: string) => LogEntry;
  add: (kind: KKind, x: number, y: number) => string;
  move: (id: string, x: number, y: number) => void;
  connect: (from: string, to: string) => void;
  remove: (nodeIds: string[], edgeIds: string[]) => void;
  setCfg: (id: string, patch: Partial<NodeCfg>) => void;
  setCluster: (patch: Partial<ClusterCfg>) => void;
  rename: (id: string, name: string) => void;
  /** Reset without narration (e.g. loading a scenario). */
  reset: (g: KGraph, chaos?: Chaos) => void;
  clearLog: () => void;
}

const namesOf = (g: KGraph) => Object.fromEntries(g.nodes.map((n) => [n.id, label(n)]));

/**
 * The lab's single source of truth. Every mutation re-runs the deterministic model, diffs it
 * against the previous one, and appends a narrated "what changed → impact" entry.
 */
export function useLab(initial: KGraph, opts: { onChange?: (g: KGraph) => void; initialChaos?: Chaos } = {}): Lab {
  const [g, setG] = useState(initial);
  const [chaos, setChaosState] = useState<Chaos>(opts.initialChaos ?? NO_CHAOS);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const m = useMemo(() => evaluate(g, chaos), [g, chaos]);
  const ref = useRef({ g, chaos, m });
  ref.current = { g, chaos, m };
  const onChange = useRef(opts.onChange);
  onChange.current = opts.onChange;

  const flash = (ids: string[]) => {
    if (!ids.length) return;
    setFresh(new Set(ids));
    setTimeout(() => setFresh(new Set()), 1600);
  };

  const record = (before: Model, after: Model, beforeG: KGraph, afterG: KGraph, change: string, how: string | undefined, source: LogEntry['source']) => {
    const imp = diff(before, after, change, how);
    const e: LogEntry = { ...imp, events: clusterEvents(before, after, { ...namesOf(beforeG), ...namesOf(afterG) }), source };
    setLog((l) => [e, ...l].slice(0, 40));
    return e;
  };

  const commit = useCallback((next: KGraph, change: string, how?: string, source: LogEntry['source'] = 'you') => {
    const { g: prev, chaos: c, m: before } = ref.current;
    const after = evaluate(next, c);
    ref.current = { g: next, chaos: c, m: after };
    setG(next);
    onChange.current?.(next);
    const added = next.nodes.filter((n) => !prev.nodes.some((p) => p.id === n.id)).map((n) => n.id);
    const changedCfg = next.nodes.filter((n) => {
      const p = prev.nodes.find((x) => x.id === n.id);
      return p && JSON.stringify(p.cfg) !== JSON.stringify(n.cfg);
    });
    flash([...added, ...changedCfg.map((n) => n.id)]);
    return record(before, after, prev, next, change, how, source);
  }, []);

  const setChaos = useCallback((next: Chaos, change: string, how?: string) => {
    const { g: cur, m: before } = ref.current;
    const after = evaluate(cur, next);
    ref.current = { g: cur, chaos: next, m: after };
    setChaosState(next);
    return record(before, after, cur, cur, change, how, 'chaos');
  }, []);

  const add = useCallback(
    (kind: KKind, x: number, y: number) => {
      const cur = ref.current.g;
      let i = 1;
      while (cur.nodes.some((n) => n.id === `${kind}-${i}`)) i++;
      const id = `${kind}-${i}`;
      const same = cur.nodes.filter((n) => n.kind === kind).length;
      const node = { id, kind, x, y, cfg: {}, label: same ? `${KINDS[kind].name} ${same + 1}` : undefined };
      const def = KINDS[kind];
      commit({ ...cur, nodes: [...cur.nodes, node] }, `Added ${def.name}`, def.trap ? `Trap: ${def.trap.why}` : def.solves);
      return id;
    },
    [commit],
  );

  const move = useCallback((id: string, x: number, y: number) => {
    const cur = ref.current.g;
    const next = { ...cur, nodes: cur.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) };
    ref.current = { ...ref.current, g: next };
    setG(next);
    onChange.current?.(next);
  }, []);

  const connect = useCallback(
    (from: string, to: string) => {
      const cur = ref.current.g;
      const id = edgeIdOf(from, to);
      if (cur.edges.some((e) => e.id === id)) return;
      const a = cur.nodes.find((n) => n.id === from);
      const b = cur.nodes.find((n) => n.id === to);
      if (!a || !b) return;
      const v = edgeValidity(a.kind, b.kind);
      commit({ ...cur, edges: [...cur.edges, { id, from, to }] }, `Connected ${label(a)} → ${label(b)}${v.ok ? '' : ' (invalid)'}`, v.note);
    },
    [commit],
  );

  const remove = useCallback(
    (nodeIds: string[], edgeIds: string[]) => {
      const cur = ref.current.g;
      const ns = new Set(nodeIds);
      const es = new Set(edgeIds);
      const nodes = cur.nodes.filter((n) => !ns.has(n.id));
      const edges = cur.edges.filter((e) => !es.has(e.id) && !ns.has(e.from) && !ns.has(e.to));
      if (nodes.length === cur.nodes.length && edges.length === cur.edges.length) return;
      const nm = namesOf(cur);
      const what = [...nodeIds.map((id) => nm[id]), ...edgeIds.map((id) => id.split('->').map((x) => nm[x] ?? x).join(' → '))].join(', ');
      commit({ ...cur, nodes, edges }, `Removed ${what}`);
    },
    [commit],
  );

  const setCfg = useCallback(
    (id: string, patch: Partial<NodeCfg>) => {
      const cur = ref.current.g;
      const n = cur.nodes.find((x) => x.id === id);
      if (!n) return;
      const old = cfgOf(n);
      const keys = Object.keys(patch) as (keyof NodeCfg)[];
      if (keys.every((k) => old[k] === patch[k])) return;
      const desc = keys.map((k) => (KNOB[k] ? `${KNOB[k].config}: ${fmtKnobValue(KNOB[k], old[k])} → ${fmtKnobValue(KNOB[k], patch[k])}` : `${k}: ${String(old[k])} → ${String(patch[k])}`)).join(', ');
      const how = keys.map((k) => KNOB[k]?.how).filter(Boolean)[0];
      commit({ ...cur, nodes: cur.nodes.map((x) => (x.id === id ? { ...x, cfg: { ...x.cfg, ...patch } } : x)) }, `${label(n)} · ${desc}`, how);
    },
    [commit],
  );

  const setCluster = useCallback(
    (patch: Partial<ClusterCfg>) => {
      const cur = ref.current.g;
      const desc = Object.entries(patch)
        .map(([k, v]) => (k === 'brokers' ? `brokers: ${cur.cluster.brokers} → ${v}` : `metadata: ${cur.cluster.kraft ? 'KRaft' : 'ZooKeeper'} → ${v ? 'KRaft' : 'ZooKeeper'}`))
        .join(', ');
      commit(
        { ...cur, cluster: { ...cur.cluster, ...patch } },
        `Cluster · ${desc}`,
        'brokers' in patch
          ? 'New brokers start empty: existing partitions stay where they are until you run a reassignment (kafka-reassign-partitions / Cruise Control). The model assumes the reassignment is done, so leaders spread evenly.'
          : 'KRaft keeps metadata in a Raft-replicated log inside Kafka (controller quorum). ZooKeeper mode stores it in an external ensemble and the controller reloads it on failover, which is slow with many partitions.',
      );
    },
    [commit],
  );

  const rename = useCallback((id: string, name: string) => {
    const cur = ref.current.g;
    const next = { ...cur, nodes: cur.nodes.map((n) => (n.id === id ? { ...n, label: name || undefined } : n)) };
    ref.current = { ...ref.current, g: next };
    setG(next);
    onChange.current?.(next);
  }, []);

  const reset = useCallback((next: KGraph, c: Chaos = NO_CHAOS) => {
    ref.current = { g: next, chaos: c, m: evaluate(next, c) };
    setG(next);
    setChaosState(c);
    setLog([]);
  }, []);

  return { g, chaos, m, log, fresh, names: namesOf(g), commit, setChaos, add, move, connect, remove, setCfg, setCluster, rename, reset, clearLog: () => setLog([]) };
}
