import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Dices, Eraser, Plus, Search } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { hash32, LabFrame, rng, Slider, Stat } from './kit';

const COLORS = ['--c-accent', '--c-info', '--c-violet', '--c-ok', '--c-warn', '--c-bad'];
const ADJ = ['brave', 'lazy', 'quick', 'silent', 'red', 'cosmic', 'tiny', 'grumpy', 'neon', 'shy'];
const NOUN = ['otter', 'falcon', 'panda', 'wizard', 'ninja', 'koala', 'pixel', 'comet', 'yak', 'tiger'];
const PROBES = Array.from({ length: 200 }, (_, j) => `probe_${j}_nobody`);

/** k independent-ish hash functions: same FNV-1a with a different seed each (the "double hashing" trick in spirit). */
const positions = (item: string, k: number, m: number) => Array.from({ length: k }, (_, i) => hash32(item, Math.imul(i + 1, 0x9e3779b1)) % m);

function build(items: string[], k: number, m: number): number[] {
  const bits = Array<number>(m).fill(0);
  for (const it of items) for (const p of positions(it, k, m)) bits[p] = 1;
  return bits;
}

interface Op {
  kind: 'add' | 'query' | 'delete';
  item: string;
  idx: number[];
  n: number; // op counter, re-keys the animation
}

export default function BloomLab() {
  const [m, setM] = useState(64);
  const [k, setK] = useState(3);
  const [members, setMembers] = useState<string[]>(['alice', 'bob', 'carol']);
  const [bits, setBits] = useState<number[]>(() => build(['alice', 'bob', 'carol'], 3, 64));
  const [addText, setAddText] = useState('dave');
  const [queryText, setQueryText] = useState('mallory');
  const [op, setOp] = useState<Op | null>(null);
  const [seed, setSeed] = useState(1);
  const [deleted, setDeleted] = useState(0);

  const rebuild = (nm: number, nk: number, items = members) => {
    setBits(build(items, nk, nm));
    setOp(null);
    setDeleted(0);
  };
  const changeM = (v: number) => {
    setM(v);
    rebuild(v, k);
  };
  const changeK = (v: number) => {
    setK(v);
    rebuild(m, v);
  };

  const add = (items: string[]) => {
    const fresh = items.map((s) => s.trim()).filter((s) => s && !members.includes(s));
    if (!fresh.length) return;
    const next = [...bits];
    for (const it of fresh) for (const p of positions(it, k, m)) next[p] = 1;
    setBits(next);
    setMembers([...members, ...fresh]);
    const last = fresh[fresh.length - 1];
    setOp({ kind: 'add', item: fresh.length > 1 ? `${fresh.length} users` : last, idx: fresh.flatMap((it) => positions(it, k, m)), n: (op?.n ?? 0) + 1 });
  };
  const addRandom = () => {
    const r = rng(seed * 7919);
    setSeed(seed + 1);
    add(Array.from({ length: 10 }, () => `${ADJ[Math.floor(r() * ADJ.length)]}_${NOUN[Math.floor(r() * NOUN.length)]}${Math.floor(r() * 100)}`));
  };
  const query = (item: string) => {
    if (!item.trim()) return;
    setOp({ kind: 'query', item: item.trim(), idx: positions(item.trim(), k, m), n: (op?.n ?? 0) + 1 });
  };
  const findFalsePositive = () => {
    for (let j = 0; j < 5000; j++) {
      const cand = `guest${j}`;
      if (members.includes(cand)) continue;
      if (positions(cand, k, m).every((p) => bits[p])) {
        setQueryText(cand);
        query(cand);
        return;
      }
    }
  };
  /** The naive "delete": clear the item's bits. Breaks every other item sharing those bits. */
  const naiveDelete = () => {
    const victim = members[0];
    if (!victim) return;
    const idx = positions(victim, k, m);
    const next = [...bits];
    for (const p of idx) next[p] = 0;
    setBits(next);
    setMembers(members.slice(1));
    setDeleted(deleted + 1);
    setOp({ kind: 'delete', item: victim, idx, n: (op?.n ?? 0) + 1 });
  };
  const reset = () => {
    const base = ['alice', 'bob', 'carol'];
    setMembers(base);
    setBits(build(base, k, m));
    setOp(null);
    setDeleted(0);
  };

  const n = members.length;
  const ones = bits.reduce((a, b) => a + b, 0);
  const fill = ones / m;
  const stats = useMemo(() => {
    const fp = PROBES.filter((p) => !members.includes(p) && positions(p, k, m).every((i) => bits[i])).length;
    const fn = members.filter((it) => !positions(it, k, m).every((i) => bits[i])).length;
    return { fpr: fp / PROBES.length, fn };
  }, [bits, members, k, m]);
  const theory = n ? Math.pow(1 - Math.exp((-k * n) / m), k) : 0;
  const kOpt = n ? (m / n) * Math.LN2 : 0;
  const setBytes = members.reduce((a, s) => a + s.length, 0) + n * 40;

  const qIdx = op?.kind === 'query' ? op.idx : [];
  const allSet = qIdx.length > 0 && qIdx.every((p) => bits[p]);
  const isMember = op?.kind === 'query' && members.includes(op.item);
  const verdict = op?.kind !== 'query' ? null : !allSet ? 'not' : isMember ? 'tp' : 'fp';

  const COLS = 16;
  const rows = Math.ceil(m / COLS);
  const cw = 32;
  const ch = 26;
  const gx = (560 - COLS * cw) / 2;
  const gy = 96;
  const H = gy + rows * (ch + 4) + 8;
  const cx = (p: number) => gx + (p % COLS) * cw + cw / 2;
  const cy = (p: number) => gy + Math.floor(p / COLS) * (ch + 4) + ch / 2;

  let insight: string;
  if (stats.fn > 0) insight = `You "deleted" by clearing bits — and ${stats.fn} remaining member(s) now read as "definitely not present". A false negative breaks the one guarantee a Bloom filter gives. Real deletes need a counting Bloom filter (4-bit counters per slot) or a cuckoo filter; Cassandra/RocksDB simply rebuild the filter when the SSTable is compacted.`;
  else if (n === 0) insight = 'Empty filter: every bit is 0, so every query is "definitely not". Add some users.';
  else if (fill > 0.7) insight = `The array is ${Math.round(fill * 100)}% ones — saturated. Almost any string passes all ${k} checks, so "maybe" means nothing. Size m for the expected n up front (~10 bits/key ≈ 1% FPR); a Bloom filter cannot be resized without re-inserting every key.`;
  else if (k < Math.floor(kOpt) - 1) insight = `k=${k} is below the optimum ≈ ${kOpt.toFixed(1)}: few bits are set, but a non-member only has to get lucky on ${k} check(s). Raise k and watch the measured FPR drop.`;
  else if (k > Math.ceil(kOpt) + 1) insight = `k=${k} is above the optimum ≈ ${kOpt.toFixed(1)}: each insert sets so many bits that the array fills up and false positives rise again — and every lookup costs ${k} hashes.`;
  else insight = `k is near the optimum (m/n)·ln2 ≈ ${kOpt.toFixed(1)}. Measured and theoretical FPR roughly agree. This is how Cassandra/RocksDB skip SSTables that cannot contain a key, how "username taken?" is answered without a DB hit, and how CDNs avoid caching one-hit-wonders (cache only on the 2nd sighting).`;

  return (
    <LabFrame
      title={`Bloom filter: "definitely not" or "maybe"`}
      goal="Add users, then query names that were never added. Shrink m or change k until a query comes back MAYBE for a name that is not in the set — a false positive."
      onReset={reset}
      controls={
        <>
          <Slider label="m — bits in the array" value={m} min={16} max={128} step={8} onChange={changeM} fmt={(v) => `${v} bits = ${Math.ceil(v / 8)} B`} />
          <Slider label="k — hash functions" value={k} min={1} max={6} onChange={changeK} fmt={(v) => `${v}${n ? ` (optimal ≈ ${kOpt.toFixed(1)})` : ''}`} />
          <form className="flex items-end gap-1" onSubmit={(e) => (e.preventDefault(), add([addText]), setAddText(''))}>
            <label className="flex-1">
              <div className="eyebrow mb-1">Add to set</div>
              <input value={addText} onChange={(e) => setAddText(e.target.value)} className="w-full rounded-md border border-line bg-surface px-2 py-1 font-mono text-[12px]" placeholder="username" />
            </label>
            <Button size="sm" variant="primary" type="submit" icon={<Plus size={12} />}>
              add
            </Button>
            <Button size="sm" variant="secondary" icon={<Dices size={12} />} onClick={addRandom} title="Add 10 random usernames">
              +10
            </Button>
          </form>
          <form className="flex items-end gap-1" onSubmit={(e) => (e.preventDefault(), query(queryText))}>
            <label className="flex-1">
              <div className="eyebrow mb-1">Query (contains?)</div>
              <input value={queryText} onChange={(e) => setQueryText(e.target.value)} className="w-full rounded-md border border-line bg-surface px-2 py-1 font-mono text-[12px]" placeholder="username" />
            </label>
            <Button size="sm" variant="primary" type="submit" icon={<Search size={12} />}>
              check
            </Button>
            <Button size="sm" variant="ghost" onClick={findFalsePositive} title="Search guest0, guest1, … for a non-member that passes all k checks">
              find FP
            </Button>
          </form>
        </>
      }
      stats={
        <>
          <Stat label="Items n · fill" value={`${n} · ${Math.round(fill * 100)}%`} sub={`${ones}/${m} bits set · ${n ? (m / n).toFixed(1) : '–'} bits/key`} tone={fill > 0.7 ? 'bad' : fill > 0.5 ? 'warn' : undefined} />
          <Stat label="Measured FPR" value={`${(stats.fpr * 100).toFixed(1)}%`} sub="200 non-members tested" tone={stats.fpr > 0.2 ? 'bad' : stats.fpr > 0.05 ? 'warn' : 'ok'} />
          <Stat label="Theory (1−e^(−kn/m))^k" value={`${(theory * 100).toFixed(1)}%`} sub={`optimal k = (m/n)·ln2 ≈ ${n ? kOpt.toFixed(1) : '–'}`} />
          <Stat label="Memory" value={`${Math.ceil(m / 8)} B`} sub={`vs ~${setBytes} B as a hash set`} tone={stats.fn ? 'bad' : 'info'} />
        </>
      }
      insight={insight}
    >
      <svg viewBox={`0 0 560 ${H}`} className="w-full">
        {op && (
          <g>
            <rect x={200} y={8} width={160} height={30} rx={8} fill="rgb(var(--c-surface))" stroke={`rgb(var(${op.kind === 'add' ? '--c-accent' : op.kind === 'delete' ? '--c-bad' : '--c-info'}))`} strokeWidth={1.5} />
            <text x={280} y={27} textAnchor="middle" className="fill-ink font-mono text-[11px] font-semibold">
              {op.kind === 'add' ? 'add' : op.kind === 'delete' ? 'clear bits of' : 'query'} “{op.item.length > 14 ? `${op.item.slice(0, 13)}…` : op.item}”
            </text>
            {op.kind !== 'add' || op.idx.length <= 6 ? (
              <text x={366} y={27} className="fill-faint font-mono text-[8.5px]">
                → bits {op.idx.slice(0, 6).join(', ')}
              </text>
            ) : null}
            {op.idx.slice(0, 60).map((p, i) => {
              const color = COLORS[i % k];
              const ok = bits[p] === 1;
              return (
                <motion.line
                  key={`${op.n}-${i}`}
                  x1={280}
                  y1={38}
                  x2={cx(p)}
                  y2={cy(p) - ch / 2}
                  stroke={op.kind === 'query' && !ok ? 'rgb(var(--c-bad))' : `rgb(var(${color}))`}
                  strokeWidth={op.kind === 'add' && op.idx.length > 6 ? 0.8 : 1.6}
                  strokeDasharray={op.kind === 'query' && !ok ? '4 3' : undefined}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.85 }}
                  transition={{ duration: 0.45, delay: Math.min(i, 12) * 0.06 }}
                />
              );
            })}
          </g>
        )}
        {!op && (
          <text x={280} y={30} textAnchor="middle" className="fill-faint font-mono text-[10px]">
            add or query an item to see its k bit positions: hᵢ(item) mod m
          </text>
        )}
        {bits.map((b, p) => {
          const hit = op?.idx.includes(p);
          const checked = op?.kind === 'query' && hit;
          return (
            <g key={p}>
              <motion.rect
                key={`${p}-${hit ? op?.n : 0}`}
                x={gx + (p % COLS) * cw + 2}
                y={gy + Math.floor(p / COLS) * (ch + 4)}
                width={cw - 4}
                height={ch}
                rx={4}
                fill={b ? 'rgb(var(--c-accent) / 0.75)' : 'rgb(var(--c-surface))'}
                stroke={checked ? (b ? 'rgb(var(--c-ok))' : 'rgb(var(--c-bad))') : 'rgb(var(--c-line))'}
                strokeWidth={checked ? 2.5 : 1}
                initial={hit ? { scale: 1.35, opacity: 0.4 } : false}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.35, delay: hit ? 0.35 : 0 }}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              />
              <text x={cx(p)} y={cy(p) + 1} textAnchor="middle" className={cn('pointer-events-none font-mono text-[10px] font-semibold', b ? 'fill-paper' : 'fill-faint')}>
                {b}
              </text>
              <text x={cx(p)} y={cy(p) + 11} textAnchor="middle" className={cn('pointer-events-none font-mono text-[7px]', b ? 'fill-paper' : 'fill-faint')} opacity={0.7}>
                {p}
              </text>
            </g>
          );
        })}
        {verdict && (
          <text x={280} y={gy - 12} textAnchor="middle" className={cn('font-mono text-[11px] font-semibold', verdict === 'not' ? 'fill-ok' : verdict === 'tp' ? 'fill-info' : 'fill-bad')}>
            {verdict === 'not' ? 'a checked bit is 0 → DEFINITELY NOT present (no disk read needed)' : verdict === 'tp' ? `all ${k} bits are 1 → MAYBE present · true positive (it is in the set)` : `all ${k} bits are 1 → MAYBE present · FALSE POSITIVE (never added!)`}
          </text>
        )}
      </svg>
      <div className="flex flex-wrap items-center gap-1 px-1 pb-1">
        <span className="eyebrow mr-1">set ({n})</span>
        {members.slice(-14).map((it) => (
          <button key={it} onClick={() => (setQueryText(it), query(it))} className="rounded border border-line bg-surface px-1.5 font-mono text-[10.5px] text-muted hover:text-ink">
            {it}
          </button>
        ))}
        {n > 14 && <span className="font-mono text-[10px] text-faint">+{n - 14} more</span>}
        <Button size="xs" variant="ghost" className="ml-auto" icon={<Eraser size={11} />} onClick={naiveDelete} disabled={!n} title={`Try to delete "${members[0] ?? ''}" by clearing its bits`}>
          naive delete “{members[0] ?? '–'}”
        </Button>
        {deleted > 0 && <span className="font-mono text-[10px] text-bad">{deleted} naive delete(s)</span>}
      </div>
    </LabFrame>
  );
}
