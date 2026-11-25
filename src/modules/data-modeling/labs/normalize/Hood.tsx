import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Brush, Database, KeyRound, PencilLine, RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, CodeBlock, Tag } from '@/shared/ui';
import { ChangeCard, type Change } from '../../ui/ChangeCard';
import { Rich } from '../../ui/Rich';
import type { LabTopic } from '../../types';
import { CUSTOMERS, FLAT_ROWS } from './data';
import { ChangeFeed, Metric, Shell } from './ui';

type Section = 'mvcc' | 'fk';

/* ───────────────────────── MVCC heap model ───────────────────────── */

interface Tup {
  lp: number;
  xmin: number;
  xmax?: number;
  next?: number;
  nextHot?: boolean;
  hot?: boolean;
  unused?: boolean;
  redirect?: boolean;
  label: string;
  id: string;
  city: string;
}

interface Heap {
  name: string;
  tupleBytes: number;
  indexes: string[];
  tuples: Tup[];
  versions: number;
  bytes: number;
  indexWrites: number;
}

const PAGE = 8192;
const PAGE_HEADER = 24;
const LP = 4;
const CITIES = ['Mumbai', 'Bengaluru', 'Pune', 'Kolkata', 'Jaipur'];

const initFlat = (): Heap => ({
  name: 'order_sheet',
  tupleBytes: 88,
  indexes: ['order_sheet_pkey (order_id, product_id)', 'idx (customer_id)'],
  tuples: FLAT_ROWS.map((r, i) => ({ lp: i + 1, xmin: 100, label: `${r.order_id}·${r.product_id}`, id: String(r.customer_id), city: String(r.customer_city) })),
  versions: 0,
  bytes: 0,
  indexWrites: 0,
});
const initCust = (): Heap => ({
  name: 'customers',
  tupleBytes: 50,
  indexes: ['customers_pkey (customer_id)'],
  tuples: Object.entries(CUSTOMERS).map(([id, c], i) => ({ lp: i + 1, xmin: 100, label: c.name, id, city: c.city })),
  versions: 0,
  bytes: 0,
  indexWrites: 0,
});

function updateHeap(h: Heap, txid: number, city: string, cityIndexed: boolean): Heap {
  const nIdx = h.indexes.length + (cityIndexed ? 1 : 0);
  const free = h.tuples.filter((t) => t.unused && !t.redirect).map((t) => t.lp);
  let nextLp = h.tuples.length + 1;
  const added: Tup[] = [];
  const tuples = h.tuples.map((t) => {
    if (t.unused || t.xmax || t.id !== 'C1') return t;
    const lp = free.shift() ?? nextLp++;
    added.push({ ...t, lp, xmin: txid, xmax: undefined, next: undefined, nextHot: undefined, city, hot: !cityIndexed });
    return { ...t, xmax: txid, next: lp, nextHot: !cityIndexed };
  });
  const byLp = new Map(added.map((t) => [t.lp, t]));
  const merged = tuples.map((t) => byLp.get(t.lp) ?? t);
  return {
    ...h,
    tuples: [...merged, ...added.filter((t) => t.lp > h.tuples.length)],
    versions: h.versions + added.length,
    bytes: h.bytes + added.length * (h.tupleBytes + LP),
    indexWrites: h.indexWrites + (cityIndexed ? added.length * nIdx : 0),
  };
}

/** Pruning: dead HOT-chain roots keep a redirect line pointer (indexes still point at it); other dead tuples free their slot. */
const vacuumHeap = (h: Heap): Heap => ({
  ...h,
  tuples: h.tuples.map((t) => (t.xmax && !t.unused ? { ...t, unused: true, redirect: t.redirect || (!!t.nextHot && !t.hot) } : t)),
});
const deadOf = (h: Heap) => h.tuples.filter((t) => t.xmax && !t.unused).length;
const liveOf = (h: Heap) => h.tuples.filter((t) => !t.xmax && !t.unused).length;
const usedBytes = (h: Heap) => PAGE_HEADER + h.tuples.length * LP + h.tuples.filter((t) => !t.unused).length * h.tupleBytes;
const slotText = (t: Tup) => (t.redirect ? 'redirect' : 'free slot');

export function Hood({ header, footer }: { topic: LabTopic; header: ReactNode; footer: ReactNode }) {
  const [section, setSection] = useState<Section>('mvcc');
  const [flat, setFlat] = useState(initFlat);
  const [cust, setCust] = useState(initCust);
  const [txid, setTxid] = useState(101);
  const [cityIdx, setCityIdx] = useState(false);
  const [changes, setChanges] = useState<Change[]>([]);
  const [fkIndex, setFkIndex] = useState(false);
  const [fkRows, setFkRows] = useState(1_000_000);
  const [fkRan, setFkRan] = useState(false);
  const push = (c: Omit<Change, 'key'>) => setChanges((cs) => [{ ...c, key: `${Date.now()}-${cs.length}` }, ...cs].slice(0, 6));

  const c1city = cust.tuples.find((t) => t.id === 'C1' && !t.xmax && !t.unused)?.city ?? 'Pune';
  const nextCity = CITIES.find((c) => c !== c1city) ?? 'Mumbai';

  const update = () => {
    const f = updateHeap(flat, txid, nextCity, cityIdx);
    const c = updateHeap(cust, txid, nextCity, cityIdx);
    setFlat(f);
    setCust(c);
    setTxid((x) => x + 1);
    const fNew = f.versions - flat.versions;
    const cNew = c.versions - cust.versions;
    push({
      title: `txid ${txid}: C1 moves to ${nextCity}`,
      lines: [
        { tone: 'bad', text: `order_sheet: **${fNew} new tuple versions** + ${fNew} dead (${fNew * (flat.tupleBytes + LP)} B heap)` },
        { tone: 'ok', text: `customers: **${cNew} new version** + ${cNew} dead (${cNew * (cust.tupleBytes + LP)} B heap)` },
        cityIdx
          ? { tone: 'warn', text: `city is indexed → no HOT: ${f.indexWrites - flat.indexWrites} vs ${c.indexWrites - cust.indexWrites} new index entries` }
          : { tone: 'info', text: 'No indexed column changed and the page has room → **HOT** update: no new index entries.' },
      ],
    });
  };
  const vacuum = () => {
    const fd = deadOf(flat);
    const cd = deadOf(cust);
    setFlat(vacuumHeap(flat));
    setCust(vacuumHeap(cust));
    push({
      title: 'VACUUM',
      lines: [
        { tone: fd ? 'warn' : 'info', text: `order_sheet: reclaimed **${fd} dead tuples** (${fd * flat.tupleBytes} B)` },
        { tone: 'info', text: `customers: reclaimed **${cd}** (${cd * cust.tupleBytes} B)` },
        { tone: 'info', text: 'Freed slots are reused by the next UPDATE; HOT-chain roots stay as redirects. The file does not shrink (only `VACUUM FULL` rewrites it, under an ACCESS EXCLUSIVE lock).' },
      ],
    });
  };
  const reset = () => {
    setFlat(initFlat());
    setCust(initCust());
    setTxid(101);
    setChanges([]);
  };

  const runFk = () => {
    setFkRan(true);
    const pages = Math.ceil(fkRows / 180);
    push({
      title: "DELETE FROM products WHERE product_id = 'P3'",
      lines: fkIndex
        ? [
            { tone: 'ok', text: `RI trigger probes \`order_lines_product_id_idx\`: **~4 page reads** (B-tree depth 3 + leaf).` },
            { tone: 'info', text: 'Same cost at 1K or 1B child rows: O(log n).' },
          ]
        : [
            { tone: 'bad', text: `No index on \`order_lines(product_id)\` → RI trigger **seq-scans ${fkRows.toLocaleString()} rows (~${pages.toLocaleString()} pages)**.` },
            { tone: 'warn', text: 'Paid on **every** parent DELETE or key UPDATE, while holding the parent row lock.' },
          ],
    });
  };

  const nav = (
    <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
      {(
        [
          ['mvcc', 'Heap & MVCC'],
          ['fk', 'Foreign keys'],
        ] as const
      ).map(([id, l]) => (
        <button
          key={id}
          onClick={() => setSection(id)}
          className={cn('flex-1 rounded-md py-1.5 font-mono text-[11.5px]', section === id ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}
        >
          {l}
        </button>
      ))}
    </div>
  );

  const left =
    section === 'mvcc' ? (
      <>
        {nav}
        <h2 className="font-mono text-[16px] font-semibold">An UPDATE is an INSERT plus a tombstone</h2>
        <div className="space-y-2.5 text-[13px] leading-relaxed text-muted">
          <p>
            <Rich text="Postgres stores rows as **heap tuples** in 8 KB pages. Each tuple carries a ~23-byte header with `xmin` (the transaction that created it) and `xmax` (the one that deleted it)." />
          </p>
          <p>
            <Rich text="`UPDATE` never edits in place (**MVCC**). It writes a **new tuple version** and stamps the old one with `xmax`, so concurrent readers still see the old version. Old versions become **dead tuples** that `VACUUM` must reclaim later." />
          </p>
          <p>
            <Rich text="So an update anomaly is a write-amplification problem, not just a consistency one: 4 duplicated cities mean 4 new tuples, 4 dead tuples, 4× the WAL and 4× the vacuum work." />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" icon={<PencilLine size={14} />} onClick={update}>
            UPDATE C1 → {nextCity}
          </Button>
          <Button variant="secondary" size="sm" icon={<Brush size={14} />} onClick={vacuum} disabled={!deadOf(flat) && !deadOf(cust)}>
            VACUUM
          </Button>
          <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={reset}>
            Reset
          </Button>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px]">
          <input type="checkbox" checked={cityIdx} onChange={(e) => setCityIdx(e.target.checked)} className="accent-accent" />
          <span>
            <code className="font-mono text-[11.5px]">CREATE INDEX ON … (customer_city)</code>
            <span className="block text-[11px] text-muted">disables HOT for city updates: every version needs a new entry in every index</span>
          </span>
        </label>
        <ChangeFeed changes={changes} />
        <Callout tone="info" title="HOT updates">
          <span className="text-[12px]">
            If no indexed column changes and the new version fits on the same page, Postgres makes a <b>heap-only tuple</b>: indexes keep pointing at the old line pointer, which
            chains to the new one. Leave room with <code>fillfactor</code> (e.g. 90) on update-heavy tables; check <code>n_tup_hot_upd</code> in <code>pg_stat_user_tables</code>.
          </span>
        </Callout>
      </>
    ) : (
      <>
        {nav}
        <h2 className="font-mono text-[16px] font-semibold">Foreign keys are triggers plus indexes</h2>
        <div className="space-y-2.5 text-[13px] leading-relaxed text-muted">
          <p>
            <Rich text="Normalizing replaces copies with **foreign keys**. Postgres implements each FK as internal **RI triggers**. Inserting a child row looks the parent up through the parent's unique index and takes `FOR KEY SHARE` on it, so the parent can't vanish mid-transaction." />
          </p>
          <p>
            <Rich text="Deleting a parent (or changing its key) runs the reverse check: find child rows that reference it. That lookup uses an index on the **child** column, and **Postgres does not create one for you**. MySQL InnoDB does; SQL Server and Oracle don't either." />
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={fkIndex}
            onChange={(e) => {
              setFkIndex(e.target.checked);
              setFkRan(false);
            }}
            className="accent-accent"
          />
          <code className="font-mono text-[11.5px]">CREATE INDEX ON order_lines (product_id)</code>
        </label>
        <div className="rounded-lg border border-line bg-surface px-3 py-2">
          <div className="mb-1 flex justify-between font-mono text-[11px] text-muted">
            <span>order_lines rows</span>
            <span className="text-ink">{fkRows.toLocaleString()}</span>
          </div>
          <input
            type="range"
            min={3}
            max={8}
            step={1}
            value={Math.log10(fkRows)}
            onChange={(e) => {
              setFkRows(10 ** Number(e.target.value));
              setFkRan(false);
            }}
            className="w-full accent-accent"
          />
        </div>
        <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={runFk}>
          DELETE product P3
        </Button>
        <ChangeFeed changes={changes} />
      </>
    );

  const center = section === 'mvcc' ? <MvccView flat={flat} cust={cust} cityIdx={cityIdx} /> : <FkView fkIndex={fkIndex} rows={fkRows} ran={fkRan} />;

  return <Shell header={header} footer={footer} left={left} center={center} />;
}

function MvccView({ flat, cust, cityIdx }: { flat: Heap; cust: Heap; cityIdx: boolean }) {
  const amp = cust.versions ? (flat.versions / cust.versions).toFixed(0) : '4';
  return (
    <div className="space-y-5 p-6">
      <div className="grid grid-cols-4 gap-2">
        <Metric label="Versions written" value={`${flat.versions} vs ${cust.versions}`} tone={flat.versions > cust.versions ? 'bad' : undefined} sub="flat vs 3NF" />
        <Metric label="Dead tuples now" value={`${deadOf(flat)} vs ${deadOf(cust)}`} tone={deadOf(flat) ? 'warn' : 'ok'} sub="waiting for VACUUM" />
        <Metric label="Heap bytes written" value={`${flat.bytes} vs ${cust.bytes} B`} sub="tuple + 4 B line pointer" />
        <Metric label="Index entries written" value={`${flat.indexWrites} vs ${cust.indexWrites}`} tone={cityIdx ? 'warn' : 'ok'} sub={cityIdx ? 'non-HOT' : 'HOT: 0'} />
      </div>
      <HeapPage h={flat} />
      <HeapPage h={cust} />
      <Callout tone="tip" title={`Write amplification: ${amp}× here, far more in production`}>
        <span className="text-[12.5px]">
          A customer with 200 orders × 3 lines rewrites <b>600 tuples</b> per address change in the flat table, vs <b>1</b> in <code>customers</code>. Autovacuum triggers at{' '}
          <code>50 + 0.2 × reltuples</code> dead tuples (defaults), so a 10M-row table tolerates ~2M dead tuples of bloat before it is cleaned. Uber's 2016 write-up on leaving Postgres
          was largely about this: every update rewrote the tuple and every index entry.
        </span>
      </Callout>
    </div>
  );
}

function HeapPage({ h }: { h: Heap }) {
  const used = usedBytes(h);
  const pct = (used / PAGE) * 100;
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-paper">
      <div className="mb-2 flex items-center gap-2">
        <Database size={14} className="text-accent" />
        <span className="font-mono text-[13px] font-semibold">{h.name}</span>
        <span className="font-mono text-[11px] text-faint">heap page 0 · ~{h.tupleBytes} B per tuple</span>
        <span className="ml-auto flex gap-1">
          <Tag size="sm" tone="ok">
            {liveOf(h)} live
          </Tag>
          <Tag size="sm" tone={deadOf(h) ? 'bad' : 'neutral'}>
            {deadOf(h)} dead
          </Tag>
        </span>
      </div>
      <div className="mb-2 flex items-center gap-2 font-mono text-[10.5px] text-muted">
        <span className="w-24">page usage</span>
        <div className="relative h-2 flex-1 overflow-hidden rounded bg-sunken">
          <motion.div className="h-full bg-accent/60" animate={{ width: `${Math.max(pct, 0.5)}%` }} />
        </div>
        <span className="w-28 text-right">
          {used} / {PAGE} B
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {h.tuples.map((t) => {
            const dead = !!t.xmax && !t.unused;
            const c1 = t.id === 'C1';
            return (
              <motion.div
                key={t.lp}
                layout
                initial={{ opacity: 0, scale: 0.6, y: -8 }}
                animate={{ opacity: t.unused ? 0.45 : 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                className={cn(
                  'w-[132px] rounded-md border px-1.5 py-1 font-mono text-[10px] leading-tight',
                  t.unused
                    ? 'border-dashed border-line bg-paper text-faint'
                    : dead
                      ? 'border-bad/50 bg-bad/10 text-bad'
                      : t.xmin > 100 && !t.hot
                        ? 'border-warn/60 bg-warn/10'
                      : t.xmin > 100
                        ? 'border-ok/60 bg-ok/10'
                        : c1
                          ? 'border-accent/40 bg-accent/5'
                          : 'border-line bg-paper',
                )}
              >
                <div className="flex justify-between">
                  <span className="font-semibold">(0,{t.lp})</span>
                  {t.unused ? <span>{slotText(t)}</span> : dead ? <span className="font-semibold">dead</span> : t.xmin > 100 ? <span className={t.hot ? 'text-ok' : 'text-warn'}>{t.hot ? 'HOT' : 'new + idx'}</span> : null}
                </div>
                {!t.unused && (
                  <>
                    <div className={cn('truncate', dead && 'line-through')}>
                      {t.label} · {t.city}
                    </div>
                    <div className="text-faint">
                      xmin {t.xmin} · xmax {t.xmax ?? 0}
                      {t.next && <span className="text-bad"> → (0,{t.next})</span>}
                    </div>
                  </>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <div className="mt-2 font-mono text-[10px] text-faint">indexes: {h.indexes.join(' · ')}</div>
    </div>
  );
}

/* ───────────────────────── FK view ───────────────────────── */

const DDL = `CREATE TABLE customers (
  customer_id   text PRIMARY KEY,
  customer_name text NOT NULL,
  customer_city text NOT NULL
);
CREATE TABLE products (
  product_id   text PRIMARY KEY,
  product_name text NOT NULL,
  unit_price   numeric(10,2) NOT NULL CHECK (unit_price >= 0)
);
CREATE TABLE orders (
  order_id    text PRIMARY KEY,
  order_date  date NOT NULL,
  customer_id text NOT NULL REFERENCES customers
);
CREATE INDEX ON orders (customer_id);        -- not automatic in Postgres
CREATE TABLE order_lines (
  order_id   text REFERENCES orders ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products,
  qty        int  NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, product_id)         -- also serves lookups by order_id
);
CREATE INDEX ON order_lines (product_id);    -- PK can't serve this: wrong leading column`;

function FkView({ fkIndex, rows, ran }: { fkIndex: boolean; rows: number; ran: boolean }) {
  const pages = Math.ceil(rows / 180);
  const reads = fkIndex ? 4 : pages;
  const barMax = Math.ceil(1e8 / 180);
  const change: Change = {
    key: `fk-${fkIndex}-${rows}`,
    title: fkIndex ? 'Parent delete with a child index' : 'Parent delete without a child index',
    lines: fkIndex
      ? [
          { tone: 'ok', text: '**~4 page reads** per deleted product, at any table size.' },
          { tone: 'warn', text: 'Costs: one more index to maintain on every `order_lines` insert (~1 B-tree insert each).' },
        ]
      : [
          { tone: 'bad', text: `**${pages.toLocaleString()} page reads** per deleted product (≈${((pages * 8) / 1024).toFixed(0)} MB scanned).` },
          { tone: 'warn', text: 'Deleting 100 discontinued products = 100 full scans of `order_lines`.' },
        ],
  };
  return (
    <div className="space-y-5 p-6">
      <div className="grid grid-cols-[1fr_340px] gap-5">
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-surface p-3 shadow-paper">
            <div className="mb-3 flex items-center gap-2 font-mono text-[12px] font-semibold">
              <KeyRound size={14} className="text-accent" /> What the RI trigger does on DELETE FROM products
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <FkBox title="products" sub="DELETE P3" tone="bad" />
              <motion.div className="h-0.5 flex-1 bg-line" animate={{ backgroundColor: ran ? 'rgb(var(--c-accent))' : 'rgb(var(--c-line))' }} />
              <FkBox title="RI_FKey_noaction_del" sub="SELECT 1 FROM order_lines WHERE product_id = 'P3' FOR KEY SHARE" tone="info" />
              <motion.div className="h-0.5 flex-1 bg-line" animate={{ backgroundColor: ran ? 'rgb(var(--c-accent))' : 'rgb(var(--c-line))' }} />
              <FkBox title="order_lines" sub={fkIndex ? 'Index Scan on product_id' : 'Seq Scan: every row'} tone={fkIndex ? 'ok' : 'bad'} />
            </div>
            <div className="mt-4 space-y-1.5 font-mono text-[11px]">
              <Bar label="with index" value={4} max={barMax} tone="ok" active={fkIndex} />
              <Bar label="without index" value={pages} max={barMax} tone="bad" active={!fkIndex} />
            </div>
            <div className="mt-2 font-mono text-[10.5px] text-faint">
              page reads per parent delete · {rows.toLocaleString()} child rows ≈ {pages.toLocaleString()} pages at ~180 rows/page · log scale
            </div>
          </div>
          <CodeBlock language="sql" code={DDL} highlightLines={[16, 23]} />
        </div>
        <div className="space-y-3">
          <AnimatePresence mode="wait">
            {ran && (
              <motion.div key={change.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <ChangeCard change={change} />
              </motion.div>
            )}
          </AnimatePresence>
          <Metric label="Page reads now" value={reads.toLocaleString()} tone={fkIndex ? 'ok' : 'bad'} sub={fkIndex ? 'B-tree probe' : 'sequential scan'} />
          <Callout tone="warn" title="Find unindexed FKs">
            <span className="text-[12px]">
              Query <code>pg_constraint</code> (contype = 'f') and check that each <code>conkey</code> is the leading column(s) of some index in <code>pg_index</code>. Run it in CI:
              normalization adds FKs, and every FK needs its child index.
            </span>
          </Callout>
          <Callout tone="info" title="Locks, too">
            <span className="text-[12px]">
              Every child insert takes <code>FOR KEY SHARE</code> on the parent row. Hot parents (one tenant row referenced by every insert) see MultiXact churn: another cost of the
              join-friendly shape.
            </span>
          </Callout>
        </div>
      </div>
    </div>
  );
}

function FkBox({ title, sub, tone }: { title: string; sub: string; tone: 'ok' | 'bad' | 'info' }) {
  const cls = { ok: 'border-ok/50 bg-ok/10', bad: 'border-bad/50 bg-bad/10', info: 'border-info/50 bg-info/10' }[tone];
  return (
    <div className={cn('w-44 shrink-0 rounded-md border px-2 py-1.5', cls)}>
      <div className="font-semibold">{title}</div>
      <div className="text-[10px] text-muted">{sub}</div>
    </div>
  );
}

function Bar({ label, value, max, tone, active }: { label: string; value: number; max: number; tone: 'ok' | 'bad'; active: boolean }) {
  const pct = (Math.log10(value + 1) / Math.log10(max + 1)) * 100;
  return (
    <div className={cn('flex items-center gap-2', !active && 'opacity-40')}>
      <span className="w-24 text-muted">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-sunken">
        <motion.div className={cn('h-full', tone === 'ok' ? 'bg-ok' : 'bg-bad')} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
      </div>
      <span className="w-20 text-right">{value.toLocaleString()}</span>
    </div>
  );
}
