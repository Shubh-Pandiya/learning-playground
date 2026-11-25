import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Ban, PackagePlus, PencilLine, RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, CodeBlock } from '@/shared/ui';
import type { Change } from '../../ui/ChangeCard';
import { PredictCard } from '../../ui/Predict';
import { Rich } from '../../ui/Rich';
import { useDm } from '../../store';
import type { LabTopic, Predict } from '../../types';
import { FLAT_COLS, FLAT_ROWS, ORDER_FDS, UPDATES, type UpdateScenario } from './data';
import { showVal, type Row, type Tbl } from './engine';
import { ChangeFeed, Shell, TableCard } from './ui';

type Mode = 'update' | 'insert' | 'delete';

const P5_CELLS: Record<string, string> = { product_id: 'P5', product_name: 'Milk Frother', unit_price: '1299' };
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const fresh = () => FLAT_ROWS.map((r, i) => ({ ...r, _id: `r${i}` }));
const rid = (r: Row) => String(r._id);

const INSERT_PREDICT: Predict = {
  question: "Insert a new product **P5 Milk Frother, ₹1299** that nobody has ordered yet. The sheet's key is `(order_id, product_id)`. What does Postgres do?",
  options: [
    'Inserts it, leaving the order columns NULL',
    'Rejects it: `order_id` is part of the primary key, and key columns can never be NULL',
    'Generates an order_id automatically',
    'Inserts it but hides it from SELECT *',
  ],
  answer: 1,
  explain: 'Entity integrity: every PK column is implicitly `NOT NULL`. A product fact cannot exist without an order fact, because both live in one row.',
};

const DELETE_PREDICT: Predict = {
  question: 'Asha cancels order **O1003**, so we delete its row. Apart from the order, what else disappears from the database?',
  options: ['Nothing else', 'Customer C1 (Asha Rao)', 'Product P3: the only place its name and price were stored', 'Every order of C1'],
  answer: 2,
  explain: 'O1003 is the only line with the French Press. Its name and price lived only in that row. Asha survives because her other orders still mention her.',
};

export function Anomalies({ topic, header, footer }: { topic: LabTopic; header: ReactNode; footer: ReactNode }) {
  const recordPrediction = useDm((s) => s.recordPrediction);
  const markExercise = useDm((s) => s.markExercise);

  const [mode, setMode] = useState<Mode>('update');
  const [scId, setScId] = useState(UPDATES[0].id);
  const sc = UPDATES.find((u) => u.id === scId)!;
  const [rows, setRows] = useState<Row[]>(fresh);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [applied, setApplied] = useState<'none' | 'full' | 'partial'>('none');
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [stale, setStale] = useState<string | null>(null);
  const [insert, setInsert] = useState<'none' | 'blocked' | 'dummy'>('none');
  const [deleted, setDeleted] = useState(false);
  const [changes, setChanges] = useState<Change[]>([]);

  const push = (c: Omit<Change, 'key'>) => setChanges((cs) => [{ ...c, key: `${Date.now()}-${cs.length}` }, ...cs].slice(0, 6));

  const reset = () => {
    setRows(fresh());
    setApplied('none');
    setFlash(new Set());
    setStale(null);
    setInsert('none');
    setDeleted(false);
  };

  const switchMode = (m: Mode) => {
    reset();
    setMode(m);
  };
  const switchScenario = (id: string) => {
    reset();
    setScId(id);
  };

  const targets = rows.filter((r) => r[sc.by] === sc.value);
  const answeredUpdate = answers[`update-${sc.id}`];

  const answer = (key: string, p: Predict, i: number) => {
    setAnswers((a) => ({ ...a, [key]: i }));
    const right = i === p.answer;
    recordPrediction(topic.id, key, right);
    if (key.startsWith('update-')) {
      const n = targets.length;
      if (right) markExercise(topic.id, 'predict-update');
      push({
        title: `Predicted rows touched: ${p.options[i].replace(/ \(.*\)/, '')}`,
        lines: [
          { tone: right ? 'ok' : 'bad', text: right ? `Right: **${n} rows** hold a copy of this fact.` : `Actual: **${n} rows**. Count order *lines*, not orders.` },
          { tone: 'info', text: `Highlighted below. In 3NF the same change touches **1 row**.` },
        ],
      });
    }
  };

  const applyUpdate = (partial: boolean) => {
    const ids = targets.map(rid);
    const changedIds = partial ? ids.slice(0, -1) : ids;
    const staleId = partial ? ids[ids.length - 1] : null;
    setRows((rs) => rs.map((r) => (changedIds.includes(rid(r)) ? { ...r, [sc.attr]: sc.to } : r)));
    setFlash(new Set(changedIds));
    setStale(staleId);
    setApplied(partial ? 'partial' : 'full');
    const n = ids.length;
    if (!partial) {
      push({
        title: `\`${sc.sql}\` → ${n} rows`,
        lines: [
          { tone: 'warn', text: `**${n} rows** rewritten to change **1 fact** (${n}× write amplification).` },
          { tone: 'info', text: `Postgres MVCC: ${n} new tuple versions + ${n} dead tuples for VACUUM, ${n} WAL records.` },
          { tone: 'ok', text: `Consistent: all ${n} copies agree on \`${sc.to}\`.` },
          { tone: 'info', text: 'In 3NF: 1 row in one table.' },
        ],
      });
    } else {
      const staleRow = rows.find((r) => rid(r) === staleId)!;
      push({
        title: `Partial update: ${n - 1} of ${n} rows changed, \`${staleRow.order_id}\` still says \`${showVal(staleRow[sc.attr])}\``,
        lines: [
          { tone: 'bad', text: `${sc.value} now has **2 values** of \`${sc.attr}\`: ${sc.to} ×${n - 1}, ${showVal(staleRow[sc.attr])} ×1.` },
          { tone: 'bad', text: impactOf(sc, staleRow) },
          { tone: 'bad', text: `No constraint can catch it: nothing enforces \`${sc.by} → ${sc.attr}\` in this table.` },
          { tone: 'ok', text: `Fix: store the fact once, in a table keyed by \`${sc.by}\` (2NF/3NF).` },
        ],
      });
    }
  };

  const tryInsert = () => {
    setInsert('blocked');
    push({
      title: 'INSERT product P5 without an order → rejected',
      lines: [
        { tone: 'bad', text: '`ERROR: null value in column "order_id" of relation "order_sheet" violates not-null constraint`' },
        { tone: 'bad', text: 'The catalog cannot grow until someone buys: product facts are hostage to order facts.' },
        { tone: 'info', text: 'With `products(product_id PK, …)` this is a 1-row insert.' },
      ],
    });
  };

  const dummy = () => {
    setInsert('dummy');
    setRows((rs) => [
      ...rs,
      {
        _id: 'dummy',
        order_id: 'O-DUMMY',
        order_date: '1970-01-01',
        customer_id: 'C0',
        customer_name: '(none)',
        customer_city: '(none)',
        product_id: 'P5',
        product_name: 'Milk Frother',
        unit_price: '1299',
        qty: '0',
      },
    ]);
    push({
      title: 'Workaround: fake order `O-DUMMY` with fake customer `C0`',
      lines: [
        { tone: 'warn', text: 'Insert accepted, but **orders count 6 → 7** and **customers 3 → 4**: every report must now filter the dummy.' },
        { tone: 'bad', text: 'Average order value drops 14% (one extra ₹0 order). Someone will forget the filter.' },
        { tone: 'ok', text: 'Real fix: a `products` table. A product is its own fact.' },
      ],
    });
  };

  const doDelete = () => {
    setDeleted(true);
    setRows((rs) => rs.filter((r) => r.order_id !== 'O1003'));
    push({
      title: "`DELETE FROM order_sheet WHERE order_id = 'O1003'` → 1 row",
      lines: [
        { tone: 'bad', text: 'Lost 2 unrelated facts: **P3 French Press** and its price **₹2,499**. The catalog now lists 3 products.' },
        { tone: 'warn', text: 'Same trap: deleting O1004 would erase customer **C3 Meera Iyer** entirely.' },
        { tone: 'ok', text: 'In 2NF, deleting an order removes order rows only; `products` keeps P3.' },
      ],
    });
  };

  const sheet: Tbl = { id: 'sheet', name: 'order_sheet', cols: FLAT_COLS, pk: ['order_id', 'product_id'], rows };
  const highlight = mode === 'update' && answeredUpdate !== undefined;

  const rowTone = (r: Row): 'hit' | 'bad' | 'warn' | undefined => {
    if (mode === 'update' && stale === rid(r)) return 'bad';
    if (mode === 'update' && highlight && applied === 'none' && r[sc.by] === sc.value) return 'hit';
    if (mode === 'insert' && rid(r) === 'dummy') return 'warn';
    if (mode === 'delete' && !deleted && answers['delete-o1003'] !== undefined && r.order_id === 'O1003') return 'bad';
    return undefined;
  };
  const cellTone = (r: Row, _i: number, c: string): 'bad' | 'ok' | 'flash' | undefined => {
    if (mode !== 'update') return undefined;
    if (stale === rid(r) && c === sc.attr) return 'bad';
    if (flash.has(rid(r)) && c === sc.attr) return 'ok';
    if (highlight && applied === 'none' && r[sc.by] === sc.value && c === sc.attr) return 'flash';
    return undefined;
  };

  const left = (
    <>
      <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
        {(
          [
            ['update', 'Update', PencilLine],
            ['insert', 'Insert', PackagePlus],
            ['delete', 'Delete', Trash2],
          ] as const
        ).map(([m, label, Icon]) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-mono text-[11.5px]', mode === m ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}
          >
            <Icon size={12} /> {label} anomaly
          </button>
        ))}
      </div>

      {mode === 'update' && (
        <>
          <p className="text-[13px] leading-relaxed text-muted">
            <Rich text="An **update anomaly**: one real-world fact is stored on many rows, so one change becomes many writes, and a write that misses a row leaves the database contradicting itself." />
          </p>
          <div className="grid gap-1">
            {UPDATES.map((u) => (
              <button
                key={u.id}
                onClick={() => switchScenario(u.id)}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-left font-mono text-[11.5px]',
                  u.id === scId ? 'border-accent bg-accent/[0.07] text-ink' : 'border-line bg-surface text-muted hover:border-accent/50',
                )}
              >
                {u.label}
                {answers[`update-${u.id}`] !== undefined && (
                  <span className={cn('ml-2', answers[`update-${u.id}`] === u.predict.answer ? 'text-ok' : 'text-bad')}>
                    {answers[`update-${u.id}`] === u.predict.answer ? '✓' : '✗'}
                  </span>
                )}
              </button>
            ))}
          </div>
          <PredictCard key={sc.id} predict={sc.predict} answered={answeredUpdate} onAnswer={(i) => answer(`update-${sc.id}`, sc.predict, i)} />
          {answeredUpdate !== undefined && (
            <div className="space-y-2">
              <CodeBlock code={sc.sql} language="sql" showLineNumbers={false} className="!py-2 text-[11.5px]" />
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" disabled={applied !== 'none'} onClick={() => applyUpdate(false)}>
                  Apply to all {targets.length} rows
                </Button>
                <Button size="sm" variant="danger" disabled={applied !== 'none'} onClick={() => applyUpdate(true)}>
                  Partial update ({targets.length - 1} rows)
                </Button>
                <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={reset}>
                  Reset
                </Button>
              </div>
              <p className="text-[11.5px] text-faint">
                Partial = the batch job crashed mid-way, or someone ran <code className="font-mono">WHERE order_id IN (…)</code> and missed a line.
              </p>
            </div>
          )}
          {applied === 'partial' && (
            <Callout tone="bad" title="The database now contradicts itself">
              <span className="text-[12.5px]">
                <Rich text={`Two answers to one question. Any query that picks "the" ${sc.attr} for ${sc.value} returns whichever row it reads first. Fix: put the fact in a table keyed by \`${sc.by}\`, so there is one row to update.`} />
              </span>
            </Callout>
          )}
        </>
      )}

      {mode === 'insert' && (
        <>
          <p className="text-[13px] leading-relaxed text-muted">
            <Rich text="An **insert anomaly**: you can't record one fact without inventing another, because both live in the same row and the key needs both." />
          </p>
          <PredictCard predict={INSERT_PREDICT} answered={answers['insert-p5']} onAnswer={(i) => answer('insert-p5', INSERT_PREDICT, i)} />
          {answers['insert-p5'] !== undefined && (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" disabled={insert !== 'none'} onClick={tryInsert}>
                INSERT P5 Milk Frother
              </Button>
              <Button size="sm" variant="danger" disabled={insert !== 'blocked'} onClick={dummy}>
                Workaround: dummy order
              </Button>
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={reset}>
                Reset
              </Button>
            </div>
          )}
          {insert === 'dummy' && (
            <Callout tone="bad" title="Red flag: placeholder rows">
              <span className="text-[12.5px]">Dummy orders and fake customers leak into every COUNT, AVG and dashboard. Use instead: a `products` table keyed by `product_id`; order lines reference it.</span>
            </Callout>
          )}
        </>
      )}

      {mode === 'delete' && (
        <>
          <p className="text-[13px] leading-relaxed text-muted">
            <Rich text="A **delete anomaly**: removing one fact silently removes another that happened to share its row." />
          </p>
          <PredictCard predict={DELETE_PREDICT} answered={answers['delete-o1003']} onAnswer={(i) => answer('delete-o1003', DELETE_PREDICT, i)} />
          {answers['delete-o1003'] !== undefined && (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="danger" icon={<Trash2 size={13} />} disabled={deleted} onClick={doDelete}>
                DELETE order O1003
              </Button>
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={reset}>
                Reset
              </Button>
            </div>
          )}
        </>
      )}

      <ChangeFeed changes={changes} />
    </>
  );

  const ghost =
    mode === 'insert' && insert === 'blocked' ? (
      <motion.div
        key="ghost"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, x: [0, -8, 8, -6, 6, -3, 0] }}
        transition={{ duration: 0.6 }}
        className="flex border-y-2 border-dashed border-bad/60 bg-bad/[0.08]"
      >
        {FLAT_COLS.map((c) => {
          const v = P5_CELLS[c] ?? 'NULL';
          const key = c === 'order_id';
          return (
            <div
              key={c}
              style={{ width: 92 }}
              className={cn('shrink-0 truncate px-1.5 py-[3px] font-mono text-[11px]', v === 'NULL' ? 'italic text-faint' : 'text-ink', key && 'bg-bad/25 font-semibold text-bad')}
            >
              {v}
            </div>
          );
        })}
      </motion.div>
    ) : null;

  const center = (
    <div className="mx-auto max-w-[900px] space-y-4 p-6">
      <div>
        <div className="eyebrow">Flat order sheet · key (order_id, product_id)</div>
        <p className="mt-0.5 text-[12.5px] text-muted">
          8 order lines, 6 orders, 3 customers, 4 products. Amber cells are copies of a fact already stated on another row.
        </p>
      </div>
      <TableCard
        t={sheet}
        fds={ORDER_FDS}
        lanes={false}
        showNF={false}
        rowKey={rid}
        rowTone={rowTone}
        cellTone={cellTone}
        dup={mode !== 'update' || (applied === 'none' && !highlight) ? dupCells(rows) : undefined}
        extra={ghost}
        footer={
          mode === 'insert' && insert === 'blocked' ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 flex items-start gap-2 rounded-lg bg-bad/10 px-2.5 py-1.5 font-mono text-[11px] text-bad">
              <Ban size={13} className="mt-px shrink-0" />
              ERROR: null value in column "order_id" of relation "order_sheet" violates not-null constraint
            </motion.div>
          ) : null
        }
      />
      <Reports rows={rows} mode={mode} sc={sc} deleted={deleted} insert={insert} />
    </div>
  );

  return <Shell header={header} footer={footer} left={left} center={center} />;
}

function impactOf(sc: UpdateScenario, staleRow: Row): string {
  if (sc.attr === 'customer_city') {
    const rev = Number(staleRow.unit_price) * Number(staleRow.qty);
    return `Revenue by city disagrees with the CRM: ${showVal(staleRow.customer_city)} is still credited **${inr(rev)}** of ${sc.value}'s spend.`;
  }
  if (sc.attr === 'unit_price') return 'The catalog (`SELECT DISTINCT product_id, unit_price`) now lists the Mug **twice**, at two prices. Which one does checkout charge?';
  return 'The customer list shows **2 names** for one id; a CRM sync keyed on name would create a duplicate customer.';
}

function dupCells(rows: Row[]): Set<string> {
  const cells = new Set<string>();
  const seen = { o: new Set<string>(), c: new Set<string>(), p: new Set<string>() };
  rows.forEach((r, i) => {
    const o = String(r.order_id);
    const c = String(r.customer_id);
    const p = String(r.product_id);
    if (seen.o.has(o)) ['order_date', 'customer_id'].forEach((x) => cells.add(`${i}:${x}`));
    if (seen.c.has(c)) ['customer_name', 'customer_city'].forEach((x) => cells.add(`${i}:${x}`));
    if (seen.p.has(p)) ['product_name', 'unit_price'].forEach((x) => cells.add(`${i}:${x}`));
    seen.o.add(o);
    seen.c.add(c);
    seen.p.add(p);
  });
  return cells;
}

/** Live "reports" computed from the sheet: they show the system-level impact of each anomaly. */
function Reports({ rows, mode, sc, deleted, insert }: { rows: Row[]; mode: Mode; sc: UpdateScenario; deleted: boolean; insert: string }) {
  const customers = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      const k = String(r.customer_id);
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(`${r.customer_name} · ${r.customer_city}`);
    }
    return [...m.entries()];
  }, [rows]);
  const products = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      const k = String(r.product_id);
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(`${r.product_name} · ₹${r.unit_price}`);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const byCity = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.customer_city), (m.get(String(r.customer_city)) ?? 0) + Number(r.unit_price) * Number(r.qty));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const orders = new Set(rows.map((r) => r.order_id)).size;
  const max = Math.max(...byCity.map(([, v]) => v), 1);

  return (
    <div className="grid grid-cols-3 gap-3">
      <Report title="Customers" sub="SELECT DISTINCT customer_id, name, city" bad={customers.some(([, s]) => s.size > 1)}>
        {customers.map(([k, s]) => (
          <motion.div layout key={k} className={cn('font-mono text-[11px]', s.size > 1 ? 'text-bad' : k === 'C0' ? 'text-warn' : 'text-ink')}>
            <span className="text-faint">{k}</span> {[...s].join(' | ')}
            {s.size > 1 && <span className="ml-1 font-semibold">⚠ {s.size} versions</span>}
          </motion.div>
        ))}
      </Report>
      <Report title="Product catalog" sub="SELECT DISTINCT product_id, name, price" bad={deleted || products.some(([, s]) => s.size > 1)}>
        {products.map(([k, s]) => (
          <motion.div layout key={k} className={cn('font-mono text-[11px]', s.size > 1 ? 'text-bad' : k === 'P5' ? 'text-warn' : 'text-ink')}>
            <span className="text-faint">{k}</span> {[...s].join(' | ')}
          </motion.div>
        ))}
        {mode === 'delete' && deleted && (
          <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="font-mono text-[11px] text-bad line-through">
            P3 French Press · ₹2499
          </motion.div>
        )}
        {mode === 'insert' && insert === 'blocked' && <div className="font-mono text-[11px] text-bad">P5 Milk Frother: cannot be stored</div>}
      </Report>
      <Report title="Revenue by city" sub={`${orders} orders · SUM(price × qty)`} bad={mode === 'update' && sc.attr === 'customer_city' && customers.some(([, s]) => s.size > 1)}>
        {byCity.map(([city, v]) => (
          <motion.div layout key={city} className="font-mono text-[11px]">
            <div className="flex justify-between">
              <span className={city === '(none)' ? 'text-warn' : 'text-ink'}>{city}</span>
              <span className="tabular-nums text-muted">{inr(v)}</span>
            </div>
            <div className="mt-0.5 h-1 rounded-full bg-ink/[0.07]">
              <motion.div className="h-full rounded-full bg-accent" initial={false} animate={{ width: `${(v / max) * 100}%` }} />
            </div>
          </motion.div>
        ))}
      </Report>
    </div>
  );
}

function Report({ title, sub, bad, children }: { title: string; sub: string; bad?: boolean; children: ReactNode }) {
  return (
    <motion.div layout className={cn('rounded-xl border bg-surface p-2.5 transition-colors', bad ? 'border-bad/50 bg-bad/[0.04]' : 'border-line')}>
      <div className="font-mono text-[12px] font-semibold">{title}</div>
      <div className="mb-1.5 font-mono text-[9.5px] text-faint">{sub}</div>
      <div className="space-y-1">{children}</div>
    </motion.div>
  );
}
