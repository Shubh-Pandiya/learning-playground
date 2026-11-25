/* Multi-tenancy simulator: pure functions, no React. */

import type { ChangeLine } from '../../ui/ChangeCard';

export type Strategy = 'pool' | 'bridge' | 'silo' | 'hybrid';
export type Compliance = 'none' | 'residency' | 'isolation';
export type Custom = 'none' | 'some' | 'heavy';

export interface Inputs {
  tenants: number;
  /** Number of large tenants (1–3). */
  whales: number;
  /** Share of total load per whale (0.005–0.4). */
  share: number;
  compliance: Compliance;
  custom: Custom;
}

export const K = {
  tailQps: 1, // a small B2B tenant: ~1 query/s on average
  cap: 10_000, // qps one pooled instance can serve
  target: 0.65, // plan instances to 65% utilisation
  instUSD: 900, // per month, sized for pooled load
  siloCap: 1_500, // qps of the smallest dedicated DB
  siloUSD: 150, // per month minimum per dedicated DB (instance + storage + backups)
  schemasPerInstance: 3_000,
  tablesPerTenant: 40,
  relsPerTable: 3, // heap + indexes + TOAST in pg_class
  appServers: 20,
  poolSize: 10,
  migrateS: 3, // per schema or per DB
  migratePoolS: 30, // per pooled instance (bigger tables, online DDL)
  parallel: 10,
  baseMs: 6,
  spike: 5,
  whaleFrac: 0.15, // a tenant above 15% of an instance's usable capacity is a whale
  maxShown: 8,
  maxSilosShown: 22,
} as const;

export const usable = K.cap * K.target;

export const STRATEGIES: { id: Strategy; name: string; short: string; how: string }[] = [
  { id: 'pool', name: 'Pool', short: 'shared tables + tenant_id + RLS', how: 'Every tenant in the same tables; `tenant_id` on every row; RLS as the safety net.' },
  { id: 'bridge', name: 'Bridge', short: 'schema per tenant', how: 'One Postgres schema per tenant on shared servers; `search_path` picks the tenant.' },
  { id: 'silo', name: 'Silo', short: 'database per tenant', how: 'A dedicated database (and instance) per tenant.' },
  { id: 'hybrid', name: 'Hybrid', short: 'pool the tail, silo the whales', how: 'Small tenants pooled; tenants above a size threshold get their own database.' },
];
export const stratName = (s: Strategy) => STRATEGIES.find((x) => x.id === s)!.name;

export const TENANT_STEPS = [10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000];
export const maxShare = (whales: number) => Math.min(0.4, Math.floor((0.9 / whales) * 100) / 100);
export const clampInputs = (i: Inputs): Inputs => {
  const whales = Math.max(1, Math.min(3, Math.min(i.whales, i.tenants - 1)));
  return { ...i, whales, share: Math.max(0.005, Math.min(i.share, maxShare(whales))) };
};

/* ───────────────────────── load ───────────────────────── */

export function load(i: Inputs) {
  const tail = i.tenants - i.whales;
  const tailQps = tail * K.tailQps;
  const total = tailQps / (1 - i.whales * i.share);
  const whaleQps = i.share * total;
  const regions = i.compliance === 'none' ? 1 : 3;
  return { tail, tailQps, total, whaleQps, regions };
}

export const isWhale = (i: Inputs) => load(i).whaleQps > K.whaleFrac * usable;

export const p99 = (u: number) => (u >= 0.95 ? Infinity : K.baseMs / (1 - u));
export const fmtMs = (ms: number) => (ms === Infinity ? 'timeouts' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/* ───────────────────────── placement ───────────────────────── */

export type BoxKind = 'shared' | 'schemas' | 'silo';

export interface Box {
  id: string;
  kind: BoxKind;
  label: string;
  /** Tail tenants placed here. */
  tenants: number;
  /** Indices of whales placed here. */
  whales: number[];
  /** Representative tail-tenant ids drawn as dots. */
  reps: number[];
  qps: number;
  cap: number;
  u: number;
  uSpike: number;
  p99: number;
  p99Spike: number;
}

export interface More {
  id: string;
  kind: 'more';
  boxes: number;
  tenants: number;
  reps: number[];
  what: string;
}

export const REPS = (i: Inputs) => Math.min(load(i).tail, 30);
/** How many tail tenants one dot stands for. */
export const perDot = (i: Inputs) => load(i).tail / REPS(i);

function siloBox(id: string, label: string, qps: number, whales: number[], reps: number[], tenants: number, spikeQps: number): Box {
  const cap = qps > K.siloCap * K.target ? Math.ceil(qps / usable) * K.cap : K.siloCap;
  const u = qps / cap;
  const uSpike = (qps + spikeQps) / cap;
  return { id, kind: 'silo', label, tenants, whales, reps, qps, cap, u, uSpike, p99: p99(u), p99Spike: p99(uSpike) };
}

function sharedBoxes(i: Inputs, kind: 'shared' | 'schemas', tailOnly: boolean): Box[] {
  const L = load(i);
  const pooledQps = tailOnly ? L.tailQps : L.total;
  const byLoad = Math.ceil(pooledQps / L.regions / usable);
  const bySchemas = kind === 'schemas' ? Math.ceil(L.tail / L.regions / K.schemasPerInstance) : 1;
  const perRegion = Math.max(1, byLoad, bySchemas);
  const n = perRegion * L.regions;
  const reps = REPS(i);
  const spikeQps = (K.spike - 1) * L.whaleQps;
  const REG = ['us', 'eu', 'ap'];
  return Array.from({ length: n }, (_, b) => {
    const whales = tailOnly ? [] : Array.from({ length: i.whales }, (_, w) => w).filter((w) => w % perRegion === b);
    const qps = L.tailQps / n + whales.length * L.whaleQps;
    const u = qps / K.cap;
    const uSpike = (qps + (whales.includes(0) ? spikeQps : 0)) / K.cap;
    const region = L.regions > 1 ? `${REG[Math.floor(b / perRegion)]}-` : '';
    return {
      id: `${kind}-${b}`,
      kind,
      label: `${region}${kind === 'schemas' ? 'pg' : 'shard'}-${(b % perRegion) + 1}`,
      tenants: L.tail / n,
      whales,
      reps: Array.from({ length: reps }, (_, r) => r).filter((r) => r % n === b),
      qps,
      cap: K.cap,
      u,
      uSpike,
      p99: p99(u),
      p99Spike: p99(uSpike),
    };
  });
}

export function placement(s: Strategy, i: Inputs): Box[] {
  const L = load(i);
  const spikeQps = (K.spike - 1) * L.whaleQps;
  const reps = REPS(i);
  const pd = perDot(i);
  if (s === 'pool') return sharedBoxes(i, 'shared', false);
  if (s === 'bridge') return sharedBoxes(i, 'schemas', false);
  const whaleSilos = Array.from({ length: i.whales }, (_, w) => siloBox(`silo-w${w}`, `db-whale-${w + 1}`, L.whaleQps, [w], [], 0, w === 0 ? spikeQps : 0));
  if (s === 'silo') {
    const tailSilos = Array.from({ length: reps }, (_, r) => siloBox(`silo-t${r}`, `db-t${r + 1}`, K.tailQps * Math.min(pd, 1), [], [r], pd, 0));
    return [...whaleSilos, ...tailSilos];
  }
  // hybrid: only tenants that are real whales get silos
  if (!isWhale(i)) return sharedBoxes(i, 'shared', false);
  return [...sharedBoxes(i, 'shared', true), ...whaleSilos];
}

/** Boxes to draw (capped) plus a "+N more" summary. */
export function visibleBoxes(s: Strategy, i: Inputs): (Box | More)[] {
  const all = placement(s, i);
  const cap = s === 'silo' ? K.maxSilosShown : K.maxShown;
  if (all.length <= cap) return all;
  if (s === 'silo') {
    const shown = all.slice(0, cap);
    const hidden = all.slice(cap);
    const L = load(i);
    return [...shown, { id: 'more-silo', kind: 'more', boxes: L.tail - (cap - i.whales), tenants: L.tail - (cap - i.whales), reps: hidden.flatMap((b) => b.reps), what: 'databases' }];
  }
  const whaleBoxes = all.filter((b) => b.whales.length > 0 || b.kind === 'silo');
  const plain = all.filter((b) => !(b.whales.length > 0 || b.kind === 'silo'));
  const room = Math.max(1, cap - whaleBoxes.length);
  const shown = plain.slice(0, room);
  const hidden = plain.slice(room);
  const ordered = all.filter((b) => whaleBoxes.includes(b) || shown.includes(b));
  if (!hidden.length) return ordered;
  return [...ordered, { id: 'more-shared', kind: 'more', boxes: hidden.length, tenants: hidden.reduce((a, b) => a + b.tenants, 0), reps: hidden.flatMap((b) => b.reps), what: s === 'bridge' ? 'servers' : 'shards' }];
}

/* ───────────────────────── metrics ───────────────────────── */

export type Tone = 'ok' | 'warn' | 'bad';

export interface Verdict {
  tone: Tone;
  text: string;
}

export interface Metrics {
  strategy: Strategy;
  servers: number;
  databases: number;
  schemas: number;
  costMonth: number;
  costPerTenant: number;
  isolation: Verdict & { level: number };
  migrations: number;
  migrationHours: number;
  pools: number;
  connections: number;
  catalogRels: number;
  noisy: Verdict & { affected: number; baseP99: number; spikeP99: number };
  backup: Verdict;
  analytics: Verdict;
  compliance: Verdict;
  custom: Verdict;
  whaleSiloed: boolean;
}

export function metrics(s: Strategy, i: Inputs): Metrics {
  const L = load(i);
  const boxes = placement(s, i);
  const shared = boxes.filter((b) => b.kind !== 'silo');
  const silos = boxes.filter((b) => b.kind === 'silo');
  const tailSiloCount = s === 'silo' ? L.tail : 0;
  const whaleSiloCount = silos.filter((b) => b.whales.length).length;
  const siloDbs = tailSiloCount + whaleSiloCount;
  const siloCost = (s === 'silo' ? L.tail * K.siloUSD : 0) + silos.filter((b) => b.whales.length).reduce((a, b) => a + (b.cap > K.siloCap ? (b.cap / K.cap) * K.instUSD : K.siloUSD), 0);
  const servers = shared.length + siloDbs;
  const costMonth = shared.length * K.instUSD + siloCost;
  const databases = (shared.length ? shared.length : 0) + siloDbs;
  const schemas = s === 'bridge' ? i.tenants : 0;

  const migrations = s === 'bridge' ? i.tenants : shared.length + siloDbs;
  const migrationS = s === 'bridge' ? i.tenants * K.migrateS : shared.length * K.migratePoolS + siloDbs * K.migrateS;
  const migrationHours = migrationS / K.parallel / 3600;
  const pools = K.appServers * databases;
  const connections = shared.length * K.appServers * K.poolSize + siloDbs * K.appServers * 2;
  const catalogRels = s === 'bridge' ? Math.round((i.tenants / Math.max(1, shared.length)) * K.tablesPerTenant * K.relsPerTable) : K.tablesPerTenant * K.relsPerTable;

  // noisy neighbour: the box hosting whale 0
  const host = boxes.find((b) => b.whales.includes(0))!;
  const affected = host.kind === 'silo' ? 0 : host.p99Spike > Math.max(2 * host.p99, 100) ? Math.round(host.tenants) : 0;
  const noisy: Metrics['noisy'] =
    affected > 0
      ? { tone: 'bad', text: `whale spike → ${fmtMs(host.p99Spike)} for ${Math.round(host.tenants).toLocaleString('en-US')} co-located tenants`, affected, baseP99: host.p99, spikeP99: host.p99Spike }
      : host.kind === 'silo'
        ? { tone: 'ok', text: 'whale is alone: only it feels its spike', affected, baseP99: host.p99, spikeP99: host.p99Spike }
        : host.p99Spike > 1.3 * host.p99
          ? { tone: 'warn', text: `spike raises co-located p99 ${fmtMs(host.p99)} → ${fmtMs(host.p99Spike)}`, affected, baseP99: host.p99, spikeP99: host.p99Spike }
          : { tone: 'ok', text: 'largest tenant is too small to hurt its shard', affected, baseP99: host.p99, spikeP99: host.p99Spike };

  const isolation: Metrics['isolation'] =
    s === 'pool'
      ? { level: 1, tone: 'warn', text: 'logical: one missing predicate or RLS bypass leaks data' }
      : s === 'bridge'
        ? { level: 2, tone: 'warn', text: 'namespace: shared server, superuser, WAL and CPU' }
        : s === 'silo'
          ? { level: 3, tone: 'ok', text: 'physical: own database, keys, backups' }
          : whaleSiloCount
            ? { level: 2, tone: 'warn', text: 'whales physical, tail logical' }
            : { level: 1, tone: 'warn', text: 'no whale qualifies: behaves like pool' };

  const backup: Verdict =
    s === 'silo'
      ? { tone: 'ok', text: 'PITR / snapshot one tenant’s DB' }
      : s === 'bridge'
        ? { tone: 'warn', text: '`pg_dump -n tenant_x`; restore = drop + reload schema' }
        : s === 'hybrid' && whaleSiloCount
          ? { tone: 'warn', text: 'whales: own PITR; tail: export by tenant_id' }
          : { tone: 'bad', text: 'restore whole cluster aside, copy one tenant’s rows back' };

  const analytics: Verdict =
    s === 'pool'
      ? { tone: 'ok', text: 'one `GROUP BY tenant_id` (or a read replica)' }
      : s === 'hybrid'
        ? { tone: 'warn', text: 'pool + CDC from the few silos' }
        : s === 'bridge'
          ? { tone: i.tenants > 200 ? 'bad' : 'warn', text: `UNION ALL over ${i.tenants.toLocaleString('en-US')} schemas, or CDC to a warehouse` }
          : { tone: i.tenants > 50 ? 'bad' : 'warn', text: `CDC from ${i.tenants.toLocaleString('en-US')} databases into a warehouse` };

  const compliance: Verdict =
    i.compliance === 'none'
      ? { tone: 'ok', text: 'no constraint' }
      : i.compliance === 'residency'
        ? { tone: 'ok', text: s === 'silo' ? 'each DB placed in the tenant’s region' : '3 regional cells (us / eu / ap)' }
        : s === 'silo'
          ? { tone: 'ok', text: 'dedicated DB, own KMS key, own backups per tenant' }
          : { tone: 'bad', text: s === 'hybrid' ? 'only whales get dedicated DBs; the contract covers every tenant' : 'tenants share a server: fails a hard-isolation contract' };

  const custom: Verdict =
    i.custom === 'none'
      ? { tone: 'ok', text: 'one schema for everyone' }
      : i.custom === 'some'
        ? s === 'pool' || s === 'hybrid'
          ? { tone: 'ok', text: 'custom fields in a `JSONB` column + metadata table' }
          : { tone: 'ok', text: 'JSONB, or per-tenant columns (drift risk)' }
        : s === 'pool' || s === 'hybrid'
          ? { tone: 'warn', text: 'heavy custom objects: metadata-driven model (Salesforce-style) or EAV' }
          : { tone: 'ok', text: 'per-tenant DDL possible, but every tenant’s schema drifts' };

  return {
    strategy: s,
    servers,
    databases,
    schemas,
    costMonth,
    costPerTenant: costMonth / i.tenants,
    isolation,
    migrations,
    migrationHours,
    pools,
    connections,
    catalogRels,
    noisy,
    backup,
    analytics,
    compliance,
    custom,
    whaleSiloed: whaleSiloCount > 0,
  };
}

/* ───────────────────────── recommendation & flags ───────────────────────── */

export function recommend(i: Inputs): Strategy {
  if (i.compliance === 'isolation') return 'silo';
  if (isWhale(i)) return 'hybrid';
  if (i.custom === 'heavy' && i.tenants <= 1_000) return 'bridge';
  return 'pool';
}

export interface Flag {
  title: string;
  body: string;
  fix: string;
}

export function flags(s: Strategy, i: Inputs, m = metrics(s, i)): Flag[] {
  const out: Flag[] = [];
  if (m.compliance.tone === 'bad')
    out.push({ title: 'Isolation contract violated', body: `Hard isolation means no shared server for *any* tenant. ${m.compliance.text}.`, fix: 'Silo every regulated tenant (or run a separate silo tier just for them).' });
  if (m.noisy.affected > 0)
    out.push({
      title: 'Noisy neighbour',
      body: `A 5× spike from the largest tenant pushes its ${s === 'bridge' ? 'server' : 'shard'} to ${Math.round(placement(s, i).find((b) => b.whales.includes(0))!.uSpike * 100)}% utilisation: ${Math.round(m.noisy.affected).toLocaleString('en-US')} co-located tenants see ${fmtMs(m.noisy.spikeP99)}.`,
      fix: 'Move whales to their own database (hybrid), or isolate them to a dedicated shard; add per-tenant rate limits.',
    });
  if (s === 'bridge' && m.catalogRels > 100_000)
    out.push({ title: 'Catalog bloat', body: `${m.catalogRels.toLocaleString('en-US')} relations per server in pg_class: relcache memory per connection, slow pg_dump and autovacuum scans, planning slowdowns.`, fix: 'Pool the long tail; keep schema-per-tenant to hundreds, not thousands.' });
  if ((s === 'silo' || s === 'bridge') && m.migrations > 1_000)
    out.push({ title: `${m.migrations.toLocaleString('en-US')} migrations per release`, body: `≈ ${m.migrationHours < 1 ? `${Math.round(m.migrationHours * 60)} min` : `${m.migrationHours.toFixed(1)} h`} at 10 in parallel, and a failure halfway leaves tenants on mixed schema versions.`, fix: 'Pool the small tenants; make migrations backward compatible (expand → migrate → contract) and track per-tenant schema versions.' });
  if (s === 'silo' && i.tenants >= 1_000 && i.compliance !== 'isolation')
    out.push({ title: 'Silo for the long tail', body: `$${Math.round(m.costPerTenant)} per tenant per month for tenants that generate ~$0.10 of load, plus ${m.pools.toLocaleString('en-US')} app-side connection pools.`, fix: 'Pool small tenants; silo only those who pay for it or need it.' });
  if (s === 'hybrid' && !m.whaleSiloed)
    out.push({ title: 'Hybrid with no whales', body: 'No tenant exceeds the whale threshold, so you run two provisioning paths for one shape of tenant.', fix: 'Start with pool; add a silo tier when a tenant crosses the threshold.' });
  return out;
}

/* ───────────────────────── formatting & diff ───────────────────────── */

export const fmtUSD = (x: number) => (x < 1 ? `$${x.toFixed(2)}` : x < 100 ? `$${x.toFixed(x < 10 ? 2 : 0)}` : `$${Math.round(x).toLocaleString('en-US')}`);
export const fmtN = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString('en-US'));
export const fmtH = (h: number) => (h < 1 / 60 ? `${Math.round(h * 3600)} s` : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);
export const shareLabel = (s: number) => `${s < 0.1 ? (s * 100).toFixed(1).replace(/\.0$/, '') : Math.round(s * 100)}%`;

const ratio = (a: number, b: number) => (a / b >= 10 ? `${Math.round(a / b)}×` : `${(a / b).toFixed(1)}×`);

export function describeInputs(a: Inputs, b: Inputs): string[] {
  const out: string[] = [];
  if (a.tenants !== b.tenants) out.push(`tenants ${fmtN(a.tenants)} → ${fmtN(b.tenants)}`);
  if (a.whales !== b.whales) out.push(`whales ${a.whales} → ${b.whales}`);
  if (a.share !== b.share) out.push(`whale share ${shareLabel(a.share)} → ${shareLabel(b.share)}`);
  if (a.compliance !== b.compliance) out.push(`compliance ${a.compliance} → ${b.compliance}`);
  if (a.custom !== b.custom) out.push(`customization ${a.custom} → ${b.custom}`);
  return out;
}

export function diff(sa: Strategy, a: Inputs, sb: Strategy, b: Inputs): ChangeLine[] {
  const x = metrics(sa, a);
  const y = metrics(sb, b);
  const lines: ChangeLine[] = [];
  if (Math.abs(y.costPerTenant / x.costPerTenant - 1) > 0.05)
    lines.push({
      tone: y.costPerTenant < x.costPerTenant ? 'ok' : 'bad',
      text: `Cost per tenant ${fmtUSD(x.costPerTenant)} → **${fmtUSD(y.costPerTenant)}**/mo (${y.costPerTenant < x.costPerTenant ? `${ratio(x.costPerTenant, y.costPerTenant)} cheaper` : `${ratio(y.costPerTenant, x.costPerTenant)} dearer`}) · total ${fmtUSD(x.costMonth)} → ${fmtUSD(y.costMonth)}`,
    });
  if (x.isolation.level !== y.isolation.level) lines.push({ tone: y.isolation.level > x.isolation.level ? 'ok' : 'warn', text: `Isolation: ${y.isolation.text}.` });
  if (x.noisy.tone !== y.noisy.tone || x.noisy.affected !== y.noisy.affected) lines.push({ tone: y.noisy.tone === 'bad' ? 'bad' : y.noisy.tone === 'warn' ? 'warn' : 'ok', text: `Noisy neighbour: ${y.noisy.text}.` });
  if (x.migrations !== y.migrations)
    lines.push({ tone: y.migrations > x.migrations * 5 && y.migrations > 100 ? 'bad' : y.migrations < x.migrations ? 'ok' : 'info', text: `A release runs its migration **${fmtN(y.migrations)}×** (was ${fmtN(x.migrations)}) · ≈ ${fmtH(y.migrationHours)}` });
  if (x.pools !== y.pools) lines.push({ tone: y.pools > 2_000 ? 'warn' : 'info', text: `App-side connection pools ${fmtN(x.pools)} → ${fmtN(y.pools)} · server connections ${fmtN(x.connections)} → ${fmtN(y.connections)}` });
  if (x.catalogRels !== y.catalogRels && (y.catalogRels > 10_000 || x.catalogRels > 10_000))
    lines.push({ tone: y.catalogRels > 100_000 ? 'bad' : y.catalogRels > x.catalogRels ? 'warn' : 'ok', text: `Catalog: ${fmtN(y.catalogRels)} relations per server (was ${fmtN(x.catalogRels)})` });
  if (x.compliance.tone !== y.compliance.tone || x.compliance.text !== y.compliance.text) lines.push({ tone: y.compliance.tone === 'bad' ? 'bad' : 'ok', text: `Compliance: ${y.compliance.text}.` });
  if (x.custom.text !== y.custom.text) lines.push({ tone: y.custom.tone === 'warn' ? 'warn' : 'info', text: `Customization: ${y.custom.text}.` });
  if (x.backup.text !== y.backup.text) lines.push({ tone: y.backup.tone === 'bad' ? 'warn' : 'info', text: `Per-tenant restore: ${y.backup.text}.` });
  if (!lines.length) lines.push({ tone: 'info', text: 'No metric moved meaningfully: this knob doesn’t matter for this strategy at this size.' });
  return lines;
}

/* ───────────────────────── scenarios (exercises) ───────────────────────── */

export type ScenarioId = 'pick-startup' | 'pick-bank' | 'pick-hybrid';

export const SCENARIOS: { id: ScenarioId; title: string; brief: string; inputs: Inputs; answer: Strategy }[] = [
  {
    id: 'pick-startup',
    title: 'Seed-stage B2B SaaS',
    brief: '5,000 small teams on a project tool. Largest customer is ~2% of traffic. No compliance asks. A few custom fields per tenant.',
    inputs: { tenants: 5_000, whales: 1, share: 0.02, compliance: 'none', custom: 'some' },
    answer: 'pool',
  },
  {
    id: 'pick-bank',
    title: 'Core-banking platform',
    brief: '20 regulated banks. Contracts require data residency, dedicated databases, their own encryption keys and per-bank restore.',
    inputs: { tenants: 20, whales: 1, share: 0.2, compliance: 'isolation', custom: 'some' },
    answer: 'silo',
  },
  {
    id: 'pick-hybrid',
    title: 'Growth-stage SaaS with enterprise whales',
    brief: '10,000 tenants; 3 enterprise customers each drive ~15% of all traffic and run month-end batch jobs.',
    inputs: { tenants: 10_000, whales: 3, share: 0.15, compliance: 'none', custom: 'some' },
    answer: 'hybrid',
  },
];

export const NOISY_INPUTS: Inputs = { tenants: 10_000, whales: 3, share: 0.15, compliance: 'none', custom: 'some' };

export const sameInputs = (a: Inputs, b: Inputs) => a.tenants === b.tenants && a.whales === b.whales && a.share === b.share && a.compliance === b.compliance && a.custom === b.custom;

export function whyPick(s: Strategy, i: Inputs): string {
  const m = metrics(s, i);
  const best = recommend(i);
  if (s === best) {
    if (s === 'pool') return `Cheapest (${fmtUSD(m.costPerTenant)}/tenant), one migration per shard, trivial analytics, and no tenant is big enough to hurt the others.`;
    if (s === 'silo') return 'Only a dedicated database per tenant meets hard isolation, residency, own keys and per-tenant PITR. At 20 tenants the extra migrations and pools are manageable.';
    if (s === 'hybrid') return 'The tail stays cheap in the pool while each whale gets its own database: its spikes, migrations windows and restores no longer touch anyone else.';
    return 'Heavy per-tenant schema changes with few tenants: schema-per-tenant keeps DDL separate without a database each.';
  }
  const f = flags(s, i, m)[0];
  if (f) return `${f.title}: ${f.body}`;
  if (s === 'bridge') return `Schema-per-tenant buys little here: ${fmtN(m.migrations)} migrations per release and ${m.analytics.text}, without hard isolation.`;
  if (s === 'hybrid') return 'No tenant is big enough to deserve its own database: two provisioning paths for nothing.';
  if (s === 'pool') return `Pool fails here: ${m.compliance.tone === 'bad' ? m.compliance.text : m.noisy.text}.`;
  return `Silo costs ${fmtUSD(m.costPerTenant)}/tenant and ${fmtN(m.migrations)} migrations per release for no requirement that needs it.`;
}
