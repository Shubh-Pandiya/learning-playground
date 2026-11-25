import type { KKind, NodeCfg } from '../types';

const PRODUCER: Partial<NodeCfg> = {
  rate: 5000,
  msgBytes: 1000,
  key: 'entity',
  acks: 'all',
  idempotence: true,
  retries: true,
  maxInFlight: 5,
  lingerMs: 5,
  batchKb: 16,
  compression: 'none',
  transactional: false,
};

/** Kafka 3.x/4.x client defaults where they exist; sensible app defaults otherwise. */
export const DEFAULTS: Record<KKind, Partial<NodeCfg>> = {
  service: { ...PRODUCER },
  cdc: { ...PRODUCER, key: 'entity' },
  postgres: {},
  topic: { partitions: 6, rf: 3, minIsr: 2, cleanup: 'delete', retentionH: 168, unclean: false, role: 'main' },
  group: {
    consumers: 3,
    procMs: 1,
    commit: 'after',
    assignor: 'range',
    staticMembership: false,
    isolation: 'uncommitted',
    onError: 'crash',
    maxPollRecords: 500,
  },
  streams: { consumers: 3, procMs: 0.5, assignor: 'coop', staticMembership: false, isolation: 'committed', eos: false, idempotence: true },
  sink: { idempotentSink: false, capacity: 20000 },
  registry: {},
  poller: {},
  memqueue: {},
  rabbit: {},
};

export function cfgOf(n: { kind: KKind; cfg: Partial<NodeCfg> }): NodeCfg {
  return { ...(DEFAULTS[n.kind] as NodeCfg), ...n.cfg } as NodeCfg;
}
