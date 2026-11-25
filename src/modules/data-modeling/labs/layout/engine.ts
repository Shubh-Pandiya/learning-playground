/**
 * Lakehouse layout simulator: a clickstream `events` table on object storage (Iceberg/Delta).
 * Pure functions: given a layout (partitioning, clustering, bucketing) compute files, partitions,
 * skew and what each query plans, prunes, skips and scans.
 *
 * Model (deliberately simple, numbers are napkin-accurate):
 * - 1 year, 2 TB compressed Parquet, 3B events, 50M users, uniform over time.
 * - Writers produce ~128 MB files; every non-empty partition (and bucket) holds ≥ 1 file.
 * - Files are compacted, so without a time partition rows of different days are mixed in every file
 *   (min/max on event_ts cannot skip). Real append-only tables often keep some natural time locality.
 * - Data skipping = per-file min/max stats on the sort key. Z-order on 2 columns ≈ a √n × √n grid.
 * - Bytes scanned count whole files (column pruning would scale every layout by the same factor).
 */
import type { ChangeLine } from '../../ui/ChangeCard';

export type PartitionBy = 'none' | 'date' | 'hour' | 'country' | 'user' | 'date_country' | 'hour_country';
export type ClusterBy = 'none' | 'user' | 'event_type' | 'country_type';
export type Bucketing = 'none' | 'user16';
export type QueryId = 'dau' | 'user' | 'in_purchases' | 'join';

export interface Layout {
  part: PartitionBy;
  cluster: ClusterBy;
  bucket: Bucketing;
}

export const T = {
  totalGB: 2048,
  events: 3e9,
  days: 365,
  users: 50_000_000,
  targetMB: 128,
  smallMB: 64,
  maxPartitions: 10_000,
  usdPerTB: 5,
  parallel: 100,
  fileOpenMs: 20,
  scanGBps: 10,
  shuffleGBps: 2,
  usersDimGB: 10,
  purchaseShare: 0.01,
  buckets: 16,
  /** Bucket the debugged user hashes to (for the visual). */
  targetBucket: 5,
};

export const TODAY_UTC = Date.UTC(2026, 10, 25);
export const dayLabel = (daysAgo: number) => new Date(TODAY_UTC - daysAgo * 86_400_000).toISOString().slice(0, 10);

export const TOP_COUNTRIES: { code: string; share: number }[] = [
  { code: 'US', share: 0.4 },
  { code: 'IN', share: 0.15 },
  { code: 'BR', share: 0.08 },
  { code: 'GB', share: 0.06 },
  { code: 'DE', share: 0.05 },
  { code: 'JP', share: 0.04 },
  { code: 'FR', share: 0.03 },
  { code: 'ID', share: 0.03 },
  { code: 'MX', share: 0.02 },
  { code: 'CA', share: 0.02 },
];
export const TAIL = { count: 180, share: 0.12 };
export const countryShare = (code: string) => TOP_COUNTRIES.find((c) => c.code === code)?.share ?? TAIL.share / TAIL.count;

export const PARTITIONS: { id: PartitionBy; label: string; iceberg: string }[] = [
  { id: 'none', label: 'none', iceberg: '' },
  { id: 'date', label: 'event_date', iceberg: 'days(event_ts)' },
  { id: 'hour', label: 'event_hour', iceberg: 'hours(event_ts)' },
  { id: 'country', label: 'country', iceberg: 'country' },
  { id: 'user', label: 'user_id', iceberg: 'user_id' },
  { id: 'date_country', label: 'event_date + country', iceberg: 'days(event_ts), country' },
  { id: 'hour_country', label: 'event_hour + country', iceberg: 'hours(event_ts), country' },
];

export const CLUSTERS: { id: ClusterBy; label: string }[] = [
  { id: 'none', label: 'none' },
  { id: 'user', label: 'sort user_id' },
  { id: 'event_type', label: 'sort event_type' },
  { id: 'country_type', label: 'Z-order (country, event_type)' },
];

export const BUCKETS: { id: Bucketing; label: string }[] = [
  { id: 'none', label: 'none' },
  { id: 'user16', label: 'bucket(16, user_id)' },
];

export interface QueryDef {
  id: QueryId;
  name: string;
  who: string;
  sql: string;
  /** Days-ago window [from, to] (0 = today). Undefined = whole year. */
  window?: [number, number];
  country?: string;
  type?: boolean;
  user?: boolean;
  join?: boolean;
  rows: string;
}

export const QUERIES: QueryDef[] = [
  {
    id: 'dau',
    name: 'Last 7 days DAU',
    who: 'growth dashboard, refreshed every 15 min',
    sql: `SELECT event_date, COUNT(DISTINCT user_id) AS dau
FROM events
WHERE event_date >= current_date - INTERVAL 6 DAYS
GROUP BY event_date`,
    window: [0, 6],
    rows: '7 rows from ~57M events',
  },
  {
    id: 'user',
    name: 'All events for one user',
    who: 'support engineer debugging a ticket',
    sql: `SELECT * FROM events
WHERE user_id = 'u_8c1f'
ORDER BY event_ts`,
    user: true,
    rows: '~60 rows over the year',
  },
  {
    id: 'in_purchases',
    name: 'Purchases yesterday in IN',
    who: 'India ops team, daily',
    sql: `SELECT * FROM events
WHERE event_date = current_date - 1
  AND country = 'IN'
  AND event_type = 'purchase'`,
    window: [1, 1],
    country: 'IN',
    type: true,
    rows: '~12k rows',
  },
  {
    id: 'join',
    name: 'Join with users on user_id',
    who: 'weekly cohort job',
    sql: `SELECT u.plan, COUNT(*) FROM events e
JOIN users u ON u.user_id = e.user_id
WHERE e.event_date >= current_date - INTERVAL 6 DAYS
GROUP BY u.plan`,
    window: [0, 6],
    join: true,
    rows: '4 rows · joins 57M events × 50M users',
  },
];
export const getQuery = (id: QueryId) => QUERIES.find((q) => q.id === id)!;

const timeUnit = (p: PartitionBy): 'all' | 'day' | 'hour' => (p === 'date' || p === 'date_country' ? 'day' : p === 'hour' || p === 'hour_country' ? 'hour' : 'all');
export const byCountry = (p: PartitionBy) => p === 'country' || p === 'date_country' || p === 'hour_country';
export const isBucketed = (l: Layout) => l.bucket === 'user16' && l.part !== 'user';

/** A class of identical partitions (same size, same match behaviour). */
interface PClass {
  count: number;
  gb: number;
  country?: string;
}

function partitionClasses(p: PartitionBy): PClass[] {
  const unit = timeUnit(p);
  const tCount = unit === 'day' ? 365 : unit === 'hour' ? 365 * 24 : 1;
  if (p === 'user') return [{ count: T.users, gb: T.totalGB / T.users }];
  if (!byCountry(p)) return [{ count: tCount, gb: T.totalGB / tCount }];
  return [
    ...TOP_COUNTRIES.map((c) => ({ count: tCount, gb: (T.totalGB / tCount) * c.share, country: c.code })),
    { count: tCount * TAIL.count, gb: ((T.totalGB / tCount) * TAIL.share) / TAIL.count, country: '*' },
  ];
}

export interface PartEval {
  files: number;
  buckets: number;
  perBucket: number;
  fileMB: number;
  /** Files opened after min/max stats and bucket pruning (if the partition matched). */
  opened: number;
  /** Buckets read (1 when bucket pruning applies). */
  bucketsRead: number;
  scannedGB: number;
}

function effectiveCluster(l: Layout): ClusterBy {
  return l.cluster === 'country_type' && byCountry(l.part) ? 'event_type' : l.cluster;
}

function filesAfterStats(n: number, cluster: ClusterBy, r: { country?: number; type?: number; user?: boolean }): number {
  if (n <= 1) return n;
  const lin = (f: number) => Math.min(n, Math.ceil(f * n) + 1);
  switch (cluster) {
    case 'user':
      return r.user ? 1 : n;
    case 'event_type':
      return r.type !== undefined ? lin(r.type) : n;
    case 'country_type': {
      if (r.country === undefined && r.type === undefined) return n;
      const k = Math.sqrt(n);
      const g = (f?: number) => (f === undefined ? k : Math.min(k, f * k + 1));
      return Math.min(n, Math.ceil(g(r.country) * g(r.type) - 1e-9));
    }
    default:
      return n;
  }
}

/** Files in one partition of `gb`, and what query `q` opens in it if it matched. */
export function evalPartition(gb: number, l: Layout, q: QueryDef): PartEval {
  const buckets = isBucketed(l) ? T.buckets : 1;
  const perBucket = Math.max(1, Math.ceil((gb * 1024) / buckets / T.targetMB - 1e-9));
  const files = buckets * perBucket;
  const residual = {
    country: q.country && !byCountry(l.part) ? countryShare(q.country) : undefined,
    type: q.type ? T.purchaseShare : undefined,
    user: !!q.user && l.part !== 'user',
  };
  const bucketsRead = residual.user && buckets > 1 ? 1 : buckets;
  const perOpen = filesAfterStats(perBucket, effectiveCluster(l), residual);
  const opened = bucketsRead * perOpen;
  return { files, buckets, perBucket, fileMB: (gb * 1024) / files, opened, bucketsRead, scannedGB: (gb * opened) / files };
}

function timeMatchFrac(unit: 'all' | 'day' | 'hour', q: QueryDef) {
  if (unit === 'all' || !q.window) return 1;
  return (q.window[1] - q.window[0] + 1) / 365;
}

export interface QueryResult {
  partitions: number;
  partitionsMatched: number;
  filesTotal: number;
  filesInMatched: number;
  filesOpened: number;
  scannedGB: number;
  scanFrac: number;
  skipFrac: number;
  costUSD: number;
  planS: number;
  scanS: number;
  shuffleGB: number;
  shuffleS: number;
  totalS: number;
}

export interface LayoutStats {
  partitions: number;
  files: number;
  avgFileMB: number;
  smallFilePct: number;
  largestGB: number;
  medianGB: number;
  skew: number;
}

export function layoutStats(l: Layout): LayoutStats {
  const cls = partitionClasses(l.part);
  const dummy = QUERIES[0];
  let partitions = 0;
  let files = 0;
  let small = 0;
  for (const c of cls) {
    const e = evalPartition(c.gb, l, dummy);
    partitions += c.count;
    files += c.count * e.files;
    if (e.fileMB < T.smallMB) small += c.count * e.files;
  }
  const sorted = [...cls].sort((a, b) => a.gb - b.gb);
  let acc = 0;
  let medianGB = sorted[0].gb;
  for (const c of sorted) {
    acc += c.count;
    if (acc >= partitions / 2) {
      medianGB = c.gb;
      break;
    }
  }
  const largestGB = sorted[sorted.length - 1].gb;
  return { partitions, files, avgFileMB: (T.totalGB * 1024) / files, smallFilePct: small / files, largestGB, medianGB, skew: largestGB / medianGB };
}

export function runQuery(l: Layout, q: QueryDef): QueryResult {
  const unit = timeUnit(l.part);
  let partitions = 0;
  let filesTotal = 0;
  let partitionsMatched = 0;
  let filesInMatched = 0;
  let filesOpened = 0;
  let scannedGB = 0;
  for (const c of partitionClasses(l.part)) {
    const e = evalPartition(c.gb, l, q);
    partitions += c.count;
    filesTotal += c.count * e.files;
    let m = c.count * timeMatchFrac(unit, q);
    if (c.country && q.country) m *= c.country === q.country ? 1 : 0;
    if (l.part === 'user' && q.user) m = 1;
    partitionsMatched += m;
    filesInMatched += m * e.files;
    filesOpened += m * e.opened;
    scannedGB += m * e.scannedGB;
  }
  const planS = 0.3 + filesTotal * 1e-6 + filesInMatched * 1e-5;
  const usersGB = q.join ? T.usersDimGB : 0;
  const scanS = (scannedGB + usersGB) / T.scanGBps + (filesOpened * T.fileOpenMs) / 1000 / T.parallel;
  const shuffleGB = q.join && !isBucketed(l) ? scannedGB + usersGB : 0;
  const shuffleS = shuffleGB / T.shuffleGBps;
  const costUSD = ((scannedGB + usersGB) / 1024) * T.usdPerTB;
  return {
    partitions,
    partitionsMatched,
    filesTotal,
    filesInMatched,
    filesOpened,
    scannedGB,
    scanFrac: scannedGB / T.totalGB,
    skipFrac: 1 - filesOpened / filesTotal,
    costUSD,
    planS,
    scanS,
    shuffleGB,
    shuffleS,
    totalS: planS + scanS + shuffleS,
  };
}

export const runAll = (l: Layout) => Object.fromEntries(QUERIES.map((q) => [q.id, runQuery(l, q)])) as Record<QueryId, QueryResult>;

/* ───────────────────────── visual: representative folders ───────────────────────── */

export interface ShownFolder {
  kind: 'folder';
  key: string;
  path: string;
  gb: number;
  matched: boolean;
  eval: PartEval;
  tiny: boolean;
}
export interface MoreFolder {
  kind: 'more';
  key: string;
  matched: boolean;
  folders: number;
  files: number;
  opened: number;
}
export type Tile = ShownFolder | MoreFolder;

interface Desc {
  day?: number;
  hour?: number;
  country?: string;
  user?: string;
}

const TARGET_USER = 'u_8c1f';

function describe(p: PartitionBy): Desc[] {
  switch (p) {
    case 'none':
      return [{}];
    case 'date':
      return [0, 1, 2, 3, 4, 5, 6, 7, 8].map((day) => ({ day }));
    case 'hour':
      return [
        { day: 0, hour: 21 },
        { day: 0, hour: 20 },
        { day: 0, hour: 19 },
        { day: 1, hour: 23 },
        { day: 1, hour: 22 },
        { day: 1, hour: 21 },
        { day: 7, hour: 23 },
        { day: 7, hour: 22 },
      ];
    case 'country':
      return [...TOP_COUNTRIES.map((c) => ({ country: c.code })), { country: 'IS' }, { country: 'MT' }];
    case 'user':
      return ['u_0001', 'u_0002', 'u_0003', 'u_0004', TARGET_USER, 'u_9f00', 'u_a113', 'u_b7e2', 'u_c0de'].map((user) => ({ user }));
    case 'date_country':
      return [1, 0].flatMap((day) => ['US', 'IN', 'BR', 'MT'].map((country) => ({ day, country })));
    case 'hour_country':
      return [
        { day: 1, hour: 23 },
        { day: 0, hour: 21 },
      ].flatMap((t) => ['US', 'IN', 'BR', 'MT'].map((country) => ({ ...t, country })));
  }
}

function descGB(d: Desc) {
  let gb = T.totalGB;
  if (d.day !== undefined) gb /= 365;
  if (d.hour !== undefined) gb /= 24;
  if (d.country) gb *= countryShare(d.country);
  if (d.user) gb /= T.users;
  return gb;
}

function descPath(d: Desc) {
  const parts: string[] = [];
  if (d.hour !== undefined) parts.push(`event_hour=${dayLabel(d.day ?? 0)}-${String(d.hour).padStart(2, '0')}`);
  else if (d.day !== undefined) parts.push(`event_date=${dayLabel(d.day)}`);
  if (d.country) parts.push(`country=${d.country}`);
  if (d.user) parts.push(`user_id=${d.user}`);
  return parts.length ? parts.join('/') + '/' : 'events/data/';
}

function descMatches(d: Desc, q: QueryDef) {
  if (d.day !== undefined && q.window && (d.day < q.window[0] || d.day > q.window[1])) return false;
  if (d.country && q.country && d.country !== q.country) return false;
  if (d.user && q.user && d.user !== TARGET_USER) return false;
  return true;
}

export function folderTiles(l: Layout, q: QueryDef): Tile[] {
  const r = runQuery(l, q);
  const shown: ShownFolder[] = describe(l.part).map((d) => {
    const gb = descGB(d);
    const e = evalPartition(gb, l, q);
    return { kind: 'folder', key: descPath(d), path: descPath(d), gb, matched: descMatches(d, q), eval: e, tiny: e.fileMB < T.smallMB };
  });
  const shownMatched = shown.filter((s) => s.matched);
  const shownPruned = shown.filter((s) => !s.matched);
  const sum = (xs: ShownFolder[], f: (s: ShownFolder) => number) => xs.reduce((a, s) => a + f(s), 0);
  const restMatched = Math.round(r.partitionsMatched - shownMatched.length);
  const restPruned = Math.round(r.partitions - r.partitionsMatched - shownPruned.length);
  const restMatchedFiles = Math.max(0, Math.round(r.filesInMatched - sum(shownMatched, (s) => s.eval.files)));
  const tiles: Tile[] = [...shown];
  if (restMatched > 0)
    tiles.push({
      kind: 'more',
      key: 'more-matched',
      matched: true,
      folders: restMatched,
      files: restMatchedFiles,
      opened: Math.max(0, Math.round(r.filesOpened - sum(shownMatched, (s) => s.eval.opened))),
    });
  if (restPruned > 0)
    tiles.push({
      kind: 'more',
      key: 'more-pruned',
      matched: false,
      folders: restPruned,
      files: Math.max(0, Math.round(r.filesTotal - sum(shown, (s) => s.eval.files) - restMatchedFiles)),
      opened: 0,
    });
  return tiles;
}

/* ───────────────────────── verdicts, flags, diff ───────────────────────── */

export interface Flag {
  tone: 'bad' | 'warn';
  title: string;
  body: string;
  fix: string;
}

export function layoutFlags(l: Layout, s = layoutStats(l)): Flag[] {
  const out: Flag[] = [];
  if (l.part === 'user')
    out.push({
      tone: 'bad',
      title: 'Partitioning by a high-cardinality key',
      body: `${fmtCount(s.partitions)} folders of ~${fmtSize(s.medianGB)} each. Planning lists 50M partitions; every query that is not about one user opens 50M tiny files; manifests and the metastore explode.`,
      fix: 'Keep a coarse time partition and **sort by user_id** (min/max skipping) or **bucket(16, user_id)**.',
    });
  if (s.avgFileMB < T.smallMB && l.part !== 'user')
    out.push({
      tone: s.avgFileMB < 8 ? 'bad' : 'warn',
      title: `Small files: avg ${fmtSize(s.avgFileMB / 1024)} per file`,
      body: `${fmtCount(s.files)} files. Each costs a GET + footer read (~${T.fileOpenMs} ms) and a manifest entry; readers spend more time opening files than reading bytes.`,
      fix: 'Partition coarser (by day), move skewed or high-cardinality columns into the **sort/Z-order**, and run compaction (`rewrite_data_files` / `OPTIMIZE`).',
    });
  if (s.partitions > T.maxPartitions && l.part !== 'user')
    out.push({
      tone: 'warn',
      title: `${fmtCount(s.partitions)} partitions (> 10k)`,
      body: 'Hive metastore and planners slow down; partition listing alone takes seconds; most partitions hold one tiny file.',
      fix: 'Aim for partitions of ≥ 1 GB; let clustering handle the finer filter.',
    });
  if (s.skew > 50)
    out.push({
      tone: 'warn',
      title: `Partition skew ${Math.round(s.skew)}×`,
      body: `Largest partition ${fmtSize(s.largestGB)} vs median ${fmtSize(s.medianGB)}. One writer task handles the US slice while hundreds of tail-country tasks write kilobytes.`,
      fix: 'Don’t partition by a skewed column; Z-order by it inside a time partition.',
    });
  return out;
}

export function fmtSize(gb: number) {
  if (gb >= 1024) return `${(gb / 1024).toFixed(gb >= 10240 ? 0 : 1)} TB`;
  if (gb >= 1) return `${gb >= 100 ? Math.round(gb) : gb.toFixed(1)} GB`;
  const mb = gb * 1024;
  if (mb >= 1) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(mb * 1024))} KB`;
}

export function fmtCount(n: number) {
  n = Math.round(n);
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return n.toLocaleString('en-US');
}

export function fmtTime(s: number) {
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  if (s < 3600) return `${(s / 60).toFixed(s < 600 ? 1 : 0)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

export const fmtUSD = (x: number) => (x < 0.01 ? '<$0.01' : x < 10 ? `$${x.toFixed(2)}` : `$${Math.round(x).toLocaleString('en-US')}`);
export const fmtPct = (f: number) => (f > 0 && f < 0.001 ? '<0.1%' : f < 0.1 ? `${(f * 100).toFixed(1)}%` : `${Math.round(f * 100)}%`);

export const partLabel = (p: PartitionBy) => PARTITIONS.find((x) => x.id === p)!.label;
export const clusterLabel = (c: ClusterBy) => CLUSTERS.find((x) => x.id === c)!.label;
export const bucketLabel = (b: Bucketing) => BUCKETS.find((x) => x.id === b)!.label;

/** Short "what changed" title. */
export function describeChange(a: Layout, b: Layout): string {
  const parts: string[] = [];
  if (a.part !== b.part) parts.push(`partition \`${partLabel(a.part)}\` → \`${partLabel(b.part)}\``);
  if (a.cluster !== b.cluster) parts.push(`cluster \`${clusterLabel(a.cluster)}\` → \`${clusterLabel(b.cluster)}\``);
  if (a.bucket !== b.bucket) parts.push(`bucketing \`${bucketLabel(a.bucket)}\` → \`${bucketLabel(b.bucket)}\``);
  return parts.length ? parts.join(' · ') : 'Layout unchanged';
}

/** Iceberg DDL for the layout. */
export function ddl(l: Layout): string {
  const spec = [PARTITIONS.find((p) => p.id === l.part)!.iceberg, isBucketed(l) ? 'bucket(16, user_id)' : ''].filter(Boolean).join(', ');
  const lines = [
    'CREATE TABLE lake.events (',
    '  event_id STRING, user_id STRING, event_ts TIMESTAMP,',
    '  country STRING, event_type STRING, props MAP<STRING,STRING>',
    ') USING iceberg' + (spec ? `\nPARTITIONED BY (${spec});` : ';'),
  ];
  if (l.cluster === 'user') lines.push('ALTER TABLE lake.events WRITE ORDERED BY user_id;');
  if (l.cluster === 'event_type') lines.push('ALTER TABLE lake.events WRITE ORDERED BY event_type;');
  if (l.cluster === 'country_type')
    lines.push("CALL system.rewrite_data_files(table => 'lake.events',\n  strategy => 'sort', sort_order => 'zorder(country, event_type)');");
  return lines.join('\n');
}

function ratio(a: number, b: number) {
  const r = a / b;
  return r >= 10 ? `${Math.round(r)}×` : `${r.toFixed(1)}×`;
}

/** Impact lines for a layout change: per query faster/slower, files, small files, partitions. */
export function diffLayouts(a: Layout, b: Layout): ChangeLine[] {
  const lines: ChangeLine[] = [];
  const ra = runAll(a);
  const rb = runAll(b);
  for (const q of QUERIES) {
    const x = ra[q.id];
    const y = rb[q.id];
    const k = x.totalS / y.totalS;
    if (Math.abs(k - 1) < 0.08) continue;
    const join = q.join && x.shuffleGB !== y.shuffleGB ? ` · shuffle ${x.shuffleGB ? fmtSize(x.shuffleGB) : '0'} → ${y.shuffleGB ? fmtSize(y.shuffleGB) : '0'}` : '';
    lines.push({
      tone: k > 1 ? 'ok' : 'bad',
      text: `**${q.name}** ${k > 1 ? `${ratio(x.totalS, y.totalS)} faster` : `${ratio(y.totalS, x.totalS)} slower`}: ${fmtTime(x.totalS)} → ${fmtTime(y.totalS)} · scans ${fmtSize(x.scannedGB)} → ${fmtSize(y.scannedGB)} · ${fmtUSD(x.costUSD)} → ${fmtUSD(y.costUSD)}${join}`,
    });
  }
  const sa = layoutStats(a);
  const sb = layoutStats(b);
  if (sa.files !== sb.files)
    lines.push({
      tone: sb.files > sa.files * 3 ? 'warn' : 'info',
      text: `Files ${fmtCount(sa.files)} → ${fmtCount(sb.files)} · avg file ${fmtSize(sa.avgFileMB / 1024)} → ${fmtSize(sb.avgFileMB / 1024)} · partitions ${fmtCount(sa.partitions)} → ${fmtCount(sb.partitions)}`,
    });
  if (sb.avgFileMB < T.smallMB && sa.avgFileMB >= T.smallMB)
    lines.push({ tone: 'bad', text: `**Small-file problem**: avg file under ${T.smallMB} MB (${fmtPct(sb.smallFilePct)} of files are small). Planning and file opens now dominate.` });
  if (sb.avgFileMB >= T.smallMB && sa.avgFileMB < T.smallMB) lines.push({ tone: 'ok', text: `Small files gone: avg file ${fmtSize(sb.avgFileMB / 1024)}.` });
  if (sb.partitions > T.maxPartitions && sa.partitions <= T.maxPartitions) lines.push({ tone: 'bad', text: `Partition count crossed 10k (${fmtCount(sb.partitions)}): metastore and planning pain.` });
  if (sb.skew > 50 && sa.skew <= 50) lines.push({ tone: 'warn', text: `Partition skew ${Math.round(sb.skew)}×: largest partition ${fmtSize(sb.largestGB)}, median ${fmtSize(sb.medianGB)}.` });
  if (!lines.length) lines.push({ tone: 'info', text: 'No query moved by more than 8%: this knob serves none of the four queries.' });
  return lines;
}

/* ───────────────────────── exercises ───────────────────────── */

export const EX = {
  pruneDates: (l: Layout) => runQuery(l, getQuery('dau')).scanFrac < 0.05,
  smallFiles: (l: Layout) => {
    const s = layoutStats(l);
    return runQuery(l, getQuery('in_purchases')).scannedGB < 1 && s.avgFileMB >= T.smallMB && s.partitions <= T.maxPartitions;
  },
  userLookup: (l: Layout) => l.part !== 'user' && runQuery(l, getQuery('user')).skipFrac > 0.9,
};
