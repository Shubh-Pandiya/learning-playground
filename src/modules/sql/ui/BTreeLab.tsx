import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Database, Plus, Search } from 'lucide-react';
import { Button, Callout, StepControls, Tag, useStepper } from '@/shared/ui';
import { cn } from '@/shared/cn';
import { BPlusTree, buildTree, cmp, fmtKey, levelsFor, traceFullScan, traceRange, type BNode, type Frame, type InsertEvent, type Key } from '../engine/btree';
import { Md } from './common';

/* ------------------------------------------------------------------ data */

const rand = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const singleKeys = (): number[] => {
  const r = rand(7);
  const set = new Set<number>();
  while (set.size < 26) set.add(10 + Math.floor(r() * 90));
  return [...set];
};
const COUNTRIES = ['BR', 'DE', 'IN', 'US'];
const compositeKeys = (): [string, number][] => {
  const r = rand(11);
  const out: [string, number][] = [];
  const seen = new Set<string>();
  while (out.length < 24) {
    const k: [string, number] = [COUNTRIES[Math.floor(r() * 4)], 18 + Math.floor(r() * 40)];
    if (!seen.has(k.join())) {
      seen.add(k.join());
      out.push(k);
    }
  }
  return out;
};

type Mode = 'single' | 'composite';

interface Op {
  label: string;
  sql: string;
  frames: Frame[];
  verdict: string;
  impact: string;
  tone: 'ok' | 'warn' | 'bad';
}

/* ------------------------------------------------------------------ tree drawing */

function TreeView({ tree, frame, flash, covering }: { tree: BPlusTree; frame?: Frame; flash: number[]; covering: boolean }) {
  const levels = tree.levels();
  const visited = new Set(frame?.visited ?? []);
  return (
    <div className="space-y-5 overflow-x-auto pb-2">
      {levels.map((lvl, d) => (
        <div key={d} className="flex items-start justify-center gap-1.5">
          {lvl.map((n) => (
            <PageBox key={n.id} n={n} isRoot={d === 0} frame={frame} visited={visited.has(n.id)} flash={flash.includes(n.id)} covering={covering} last={d === levels.length - 1} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PageBox({ n, frame, visited, flash, isRoot, covering, last }: { n: BNode; frame?: Frame; visited: boolean; flash: boolean; isRoot: boolean; covering: boolean; last: boolean }) {
  const current = frame?.current === n.id;
  const hl = frame?.hl[n.id] ?? [];
  return (
    <div className="flex items-center">
      <motion.div
        layout
        animate={flash ? { scale: [1, 1.08, 1] } : {}}
        transition={{ duration: 0.5 }}
        className={cn(
          'rounded-md border bg-surface px-1 py-1 shadow-sm transition-colors',
          current ? 'border-accent ring-2 ring-accent/40' : visited ? 'border-accent/50 bg-accent/[0.06]' : 'border-line',
          flash && 'border-ok ring-2 ring-ok/40',
        )}
      >
        <div className="mb-0.5 flex items-center justify-between gap-2 px-0.5 font-mono text-[9px] text-faint">
          <span>#{n.id}</span>
          <span>{isRoot ? 'root' : n.leaf ? 'leaf' : 'internal'}</span>
        </div>
        <div className="flex gap-0.5">
          {n.keys.map((k, i) => (
            <div
              key={i}
              title={n.leaf ? `key ${fmtKey(k)} → heap TID (${n.tids[i]})` : `separator ${fmtKey(k)}`}
              className={cn(
                'min-w-[26px] rounded px-1 py-0.5 text-center font-mono text-[11px]',
                hl.includes(i) ? (n.leaf ? 'bg-ok text-paper' : 'bg-accent text-paper') : n.leaf ? 'bg-sunken text-ink' : 'bg-violet/10 text-ink',
              )}
            >
              {fmtKey(k)}
              {n.leaf && <div className="text-[8px] leading-none opacity-60">{covering ? '+cols' : `(${n.tids[i]})`}</div>}
            </div>
          ))}
        </div>
      </motion.div>
      {last && n.next && <span className="mx-0.5 font-mono text-[10px] text-faint">→</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ lab */

export function BTreeLab() {
  const [mode, setMode] = useState<Mode>('single');
  const [fan, setFan] = useState(3);
  const [covering, setCovering] = useState(false);
  const [extra, setExtra] = useState<Key[]>([]);
  const [opIdx, setOpIdx] = useState<number | null>(0);
  const [insertLog, setInsertLog] = useState<{ key: Key; events: InsertEvent[]; heightBefore: number; heightAfter: number } | null>(null);
  const [newKey, setNewKey] = useState('');
  const [lookup, setLookup] = useState('');

  const base = useMemo<Key[]>(() => (mode === 'single' ? singleKeys() : compositeKeys()), [mode]);
  const tree = useMemo(() => {
    const t = buildTree(base, fan);
    extra.forEach((k, i) => t.insert(k, `${Math.floor((base.length + i) / 4)},${((base.length + i) % 4) + 1}`));
    return t;
  }, [base, fan, extra]);

  const ops = useMemo<Op[]>(() => {
    const totalLeaves = tree.leaves().length;
    const heapNote = (f: Frame[]) => {
      const last = f[f.length - 1];
      return covering
        ? `0 heap pages: the index is covering (INCLUDE), so values come straight from the leaves → Index Only Scan.`
        : `${last.heapPages.length} heap page${last.heapPages.length === 1 ? '' : 's'} fetched for ${last.matches} row${last.matches === 1 ? '' : 's'} (random I/O). Covering the selected columns would skip these.`;
    };
    if (mode === 'single') {
      const keys = (base as number[]).slice().sort((a, b) => a - b);
      const pick = keys[Math.floor(keys.length * 0.6)];
      const lo = keys[Math.floor(keys.length * 0.25)];
      const hi = keys[Math.floor(keys.length * 0.45)];
      const custom = Number(lookup);
      const list: Op[] = [
        { label: `= ${pick}`, sql: `WHERE user_id = ${pick}`, frames: traceRange(tree, pick, pick), verdict: 'Index seek (point lookup)', tone: 'ok', impact: '' },
        { label: `BETWEEN ${lo} AND ${hi}`, sql: `WHERE user_id BETWEEN ${lo} AND ${hi}`, frames: traceRange(tree, lo, hi), verdict: 'Index range scan', tone: 'ok', impact: '' },
        {
          label: `user_id + 0 = ${pick}`,
          sql: `WHERE user_id + 0 = ${pick}   -- or abs(user_id), user_id::text = '…'`,
          frames: traceFullScan(tree, (k) => k === pick, 'The predicate wraps the column in an expression, so the tree’s sort order on `user_id` can’t be used to seek (not sargable).'),
          verdict: 'Not sargable → full scan',
          tone: 'bad',
          impact: '',
        },
      ];
      if (lookup.trim() && Number.isFinite(custom)) list.push({ label: `= ${custom}`, sql: `WHERE user_id = ${custom}`, frames: traceRange(tree, custom, custom), verdict: 'Index seek (your key)', tone: 'ok', impact: '' });
      return list.map((o) => {
        const last = o.frames[o.frames.length - 1];
        return {
          ...o,
          impact:
            o.tone === 'bad'
              ? `Read all ${totalLeaves} leaf pages to find ${last.matches} row(s) — O(n). On 10M rows that’s ~${Math.round(10_000_000 / 300).toLocaleString()} leaf pages instead of ${levelsFor(10_000_000, 300)} page reads. Fix: write \`user_id = $1\` (move math to the constant side) or index the expression.`
              : `${last.pagesRead} index page${last.pagesRead === 1 ? '' : 's'} read (height ${tree.height()} + leaf walk), O(log n + k). ${heapNote(o.frames)}`,
        };
      });
    }
    // composite (country, age)
    const lowest = (c: string): Key => [c, -Infinity];
    const highest = (c: string): Key => [c, Infinity];
    const list: Op[] = [
      { label: `country='IN'`, sql: `WHERE country = 'IN'`, frames: traceRange(tree, lowest('IN'), highest('IN')), verdict: 'Leftmost prefix → seek', tone: 'ok', impact: '' },
      { label: `country='IN' AND age BETWEEN 25 AND 40`, sql: `WHERE country = 'IN' AND age BETWEEN 25 AND 40`, frames: traceRange(tree, ['IN', 25], ['IN', 40]), verdict: 'Both columns → tight seek', tone: 'ok', impact: '' },
      {
        label: `age = 30 (no country)`,
        sql: `WHERE age BETWEEN 30 AND 35`,
        frames: traceFullScan(tree, (k) => (k as [string, number])[1] >= 30 && (k as [string, number])[1] <= 35, 'The index is sorted by country first; ages 30–35 appear inside every country’s run, so there is no single place to start.'),
        verdict: 'Missing leading column → no seek',
        tone: 'bad',
        impact: '',
      },
      {
        label: `country > 'BR' AND age = 30`,
        sql: `WHERE country > 'BR' AND age = 30`,
        frames: traceRange(tree, ['C', -Infinity], ['ZZ', Infinity], (k) => cmp(k, ['BR', Infinity]) > 0 && (k as [string, number])[1] === 30),
        verdict: 'Range on 1st column → 2nd only filters',
        tone: 'warn',
        impact: '',
      },
    ];
    return list.map((o) => {
      const last = o.frames[o.frames.length - 1];
      return {
        ...o,
        impact:
          o.tone === 'bad'
            ? `Read all ${totalLeaves} leaves for ${last.matches} match(es). Postgres would usually Seq Scan instead. Fix: an index on (age) or (age, country), or query with the leading column. Rule: equality columns first, then the range column.`
            : o.tone === 'warn'
              ? `The seek uses only \`country > 'BR'\`; every leaf after BR is read and age is checked per key (${last.pagesRead} pages for ${last.matches} match). Once a range appears on a column, later columns can’t narrow the seek.`
              : `${last.pagesRead} index pages read for ${last.matches} match(es): one contiguous slice of the leaf chain. ${heapNote(o.frames)}`,
      };
    });
  }, [mode, base, tree, covering, lookup]);

  const op = opIdx !== null ? ops[Math.min(opIdx, ops.length - 1)] : null;
  const stepper = useStepper(op?.frames.length ?? 1, { intervalMs: 1100 });
  const frame = op ? op.frames[Math.min(stepper.step, op.frames.length - 1)] : undefined;

  const doInsert = (k: Key) => {
    const probe = buildTree(base, fan);
    extra.forEach((x) => probe.insert(x, '0,0'));
    const before = probe.height();
    const events: InsertEvent[] = [];
    probe.insert(k, 'new', events);
    setInsertLog({ key: k, events, heightBefore: before, heightAfter: probe.height() });
    setExtra((e) => [...e, k]);
    setOpIdx(null);
  };
  const insertRandom = () => {
    const r = Math.random;
    if (mode === 'single') {
      const v = newKey.trim() ? Number(newKey) : 10 + Math.floor(r() * 90);
      if (Number.isFinite(v)) doInsert(v);
    } else doInsert([COUNTRIES[Math.floor(r() * 4)], 18 + Math.floor(r() * 40)]);
    setNewKey('');
  };

  const flash = insertLog ? insertLog.events.flatMap((e) => e.nodes) : [];
  const leaves = tree.leaves().length;
  const totalKeys = base.length + extra.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['single', 'composite'] as Mode[]).map((m) => (
          <Button
            key={m}
            size="sm"
            variant={mode === m ? 'primary' : 'secondary'}
            onClick={() => {
              setMode(m);
              setExtra([]);
              setInsertLog(null);
              setOpIdx(0);
              stepper.goTo(0);
            }}
          >
            {m === 'single' ? 'orders(user_id)' : 'users(country, age)'}
          </Button>
        ))}
        <span className="mx-2 h-5 w-px bg-line" />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          keys per page
          <select value={fan} onChange={(e) => (setFan(Number(e.target.value)), setExtra([]), setInsertLog(null))} className="rounded border border-line bg-surface px-1 py-0.5 text-xs">
            {[3, 4, 6].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={covering} onChange={(e) => setCovering(e.target.checked)} />
          covering index (INCLUDE the selected columns)
        </label>
        <div className="ml-auto flex items-center gap-2 font-mono text-[11px] text-muted">
          <Tag tone="neutral">{totalKeys} keys</Tag>
          <Tag tone="neutral">{leaves} leaf pages</Tag>
          <Tag tone="info">height {tree.height()}</Tag>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 rounded-lg border border-line bg-sunken/40 p-4">
          <TreeView tree={tree} frame={frame} flash={flash} covering={covering} />
          {frame && !covering && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-faint">
                <Database className="h-3 w-3" /> heap (table) pages — rows live here in insertion order, not key order
              </div>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: Math.ceil(totalKeys / 4) }, (_, p) => (
                  <div key={p} className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px]', frame.heapPages.includes(String(p)) ? 'border-warn bg-warn/15 text-ink' : 'border-line text-faint')}>
                    p{p}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="eyebrow flex items-center gap-1">
              <Search className="h-3 w-3" /> Run a lookup
            </div>
            {ops.map((o, i) => (
              <button
                key={i}
                onClick={() => {
                  setOpIdx(i);
                  setInsertLog(null);
                  stepper.goTo(0);
                  stepper.play?.();
                }}
                className={cn('block w-full rounded-md border px-2.5 py-1.5 text-left font-mono text-[12px] transition', opIdx === i ? 'border-ink bg-surface' : 'border-line hover:bg-surface')}
              >
                <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-full', o.tone === 'ok' ? 'bg-ok' : o.tone === 'warn' ? 'bg-warn' : 'bg-bad')} />
                {o.sql}
              </button>
            ))}
            {mode === 'single' && (
              <input value={lookup} onChange={(e) => setLookup(e.target.value.replace(/[^\d]/g, ''))} placeholder="your key, e.g. 42" className="w-full rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs" />
            )}
          </div>

          {op && frame && (
            <div className="space-y-2">
              <StepControls stepper={stepper} caption={`page ${stepper.step + 1}/${op.frames.length}`} />
              <div className="rounded-md border border-line bg-surface p-3 text-[13px] leading-relaxed text-muted">
                <div className="eyebrow mb-1">What happened</div>
                <Md text={frame.text} />
                <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px]">
                  <Tag tone="info">index pages {frame.pagesRead}</Tag>
                  <Tag tone={covering ? 'ok' : 'warn'}>heap pages {covering ? 0 : frame.heapPages.length}</Tag>
                  <Tag tone="ok">matches {frame.matches}</Tag>
                </div>
              </div>
              {stepper.step === op.frames.length - 1 && (
                <Callout tone={op.tone === 'ok' ? 'ok' : op.tone === 'warn' ? 'warn' : 'bad'} title={`${op.verdict} — impact`}>
                  <Md text={op.impact} />
                </Callout>
              )}
            </div>
          )}

          <div className="space-y-1.5 border-t border-line pt-3">
            <div className="eyebrow flex items-center gap-1">
              <Plus className="h-3 w-3" /> Insert a row (watch pages split)
            </div>
            <div className="flex gap-1.5">
              {mode === 'single' && (
                <input value={newKey} onChange={(e) => setNewKey(e.target.value.replace(/[^\d]/g, ''))} placeholder="key (blank = random)" className="w-full rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs" />
              )}
              <Button size="sm" variant="secondary" onClick={insertRandom}>
                INSERT
              </Button>
              {extra.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => (setExtra([]), setInsertLog(null))}>
                  reset
                </Button>
              )}
            </div>
            {insertLog && (
              <div className="rounded-md border border-line bg-surface p-3 text-[13px] text-muted">
                <div className="eyebrow mb-1">What changed — INSERT {fmtKey(insertLog.key)}</div>
                <ol className="list-decimal space-y-1 pl-4">
                  {insertLog.events.map((e, i) => (
                    <li key={i} className={cn(e.kind !== 'place' && 'text-ink')}>
                      {e.text}
                    </li>
                  ))}
                </ol>
                <div className="mt-2 text-[12px]">
                  <b>Impact:</b>{' '}
                  {insertLog.events.some((e) => e.kind !== 'place')
                    ? `A page split writes ${insertLog.events.filter((e) => e.kind !== 'place').length + 2}+ pages (WAL too) instead of 1${insertLog.heightAfter > insertLog.heightBefore ? `, and the tree grew to height ${insertLog.heightAfter}` : ''}. Every index on a table pays this on every INSERT — that’s the write cost of indexes. Random keys (UUIDv4) split all over the tree; monotonic keys (bigserial, UUIDv7) only split the rightmost leaf.`
                    : 'One leaf page written (plus WAL). Cheap — the page had free space. Each extra index on the table repeats this work per INSERT.'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-3 text-[13px] text-muted">
        <div className="eyebrow mb-1">At real scale</div>
        An 8 KB Postgres page holds roughly 200–400 bigint index entries, so fan-out is ~300 (here it’s {fan + 1}). Levels needed:{' '}
        {[4, 6, 8, 10].map((e) => (
          <span key={e} className="mr-2 font-mono text-ink">
            10<sup>{e}</sup> rows → {levelsFor(10 ** e, 300)} levels;
          </span>
        ))}
        — that’s why an index seek is a handful of page reads even on huge tables, and why the root and internal pages are almost always cached.
      </div>
    </div>
  );
}
