import type { Track, TrackId } from '../types';

export const TRACKS: Track[] = [
  { id: 'mechanics', order: 1, name: 'Query mechanics', blurb: 'How a query is really evaluated: logical order, joins and fan-out, NULL logic, aggregation.' },
  { id: 'windows', order: 2, name: 'Window functions', blurb: 'Rank, compare and accumulate without collapsing rows — the most-asked advanced SQL topic.' },
  { id: 'ctes', order: 3, name: 'CTEs & recursion', blurb: 'Compose queries in named steps; walk hierarchies and graphs with recursive CTEs.' },
  { id: 'analytics', order: 4, name: 'Analytics patterns', blurb: 'Gaps & islands, sessions, pivots, retention, funnels, SCD2 — the data-engineering interview staples.' },
  { id: 'performance', order: 5, name: 'Indexes & plans', blurb: 'B-trees, composite and covering indexes, sargability, EXPLAIN and join algorithms.' },
  { id: 'transactions', order: 6, name: 'Transactions & concurrency', blurb: 'Isolation levels and anomalies, MVCC and locks, idempotent upserts.' },
];

export const trackName = (id: TrackId) => TRACKS.find((t) => t.id === id)?.name ?? id;

/** Planned concept ids per track (content files must use these ids; used for `confusable`). */
export const PLANNED: Record<TrackId, string[]> = {
  mechanics: ['logical-order', 'joins-fanout', 'outer-join-filters', 'semi-anti-joins', 'null-semantics', 'conditional-aggregation', 'self-joins'],
  windows: ['ranking-functions', 'top-n-per-group', 'lag-lead', 'running-totals-frames', 'dedup-latest', 'percentiles-median'],
  ctes: ['cte-basics', 'recursive-hierarchy', 'recursive-graph-dates'],
  analytics: ['gaps-islands', 'sessionization', 'pivot-unpivot', 'retention-cohort', 'funnel-analysis', 'scd2-asof'],
  performance: ['btree-indexes', 'composite-covering', 'sargability', 'explain-joins', 'antipatterns-pagination'],
  transactions: ['isolation-anomalies', 'mvcc-locking', 'upsert-idempotent'],
};
