import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Pencil, Zap } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { hash32, LabFrame, rng, Seg, Slider, Stat, useTicker } from './kit';

type Engine = 'btree' | 'lsm';
type Phase = 'idle' | 'read' | 'crashed' | 'replay';

interface BNode {
  id: number;
  leaf: boolean;
  keys: number[];
  kids: BNode[];
}
interface Ent {
  k: number;
  seq: number;
}
interface SST {
  id: number;
  ents: Ent[];
}
type Step = { target: 'mem' | number; res: 'miss' | 'skip' | 'probe' | 'found' };

const KEYSPACE = 48;
const LEAF_CAP = 4; // rows per leaf page
const FANOUT = 5; // children per internal page
const PAGE = LEAF_CAP; // a page write costs a full page of bytes
const BLOOM_FPR = 10; // % false positives (real filters: ~1%)

const clone = (n: BNode): BNode => ({ ...n, keys: [...n.keys], kids: n.kids.map(clone) });

function initSim(engine: Engine, cfg: Cfg) {
  const st = {
    engine,
    tree: { id: 0, leaf: true, keys: [], kids: [] } as BNode,
    ckpt: { id: 0, leaf: true, keys: [], kids: [] } as BNode,
    nextId: 1,
    dirty: new Set<number>(),
    split: { fx: 0, ids: [] as number[] },
    lastLeaf: -1,
    mem: new Map<number, number>(),
    l0: [] as SST[],
    l1: null as SST | null,
    ghosts: [] as { fx: number; sst: SST; row: number }[],
    wal: [] as Ent[],
    seq: 0,
    logical: 0,
    physical: 0,
    randomIO: 0,
    phase: 'idle' as Phase,
    crashT: 0,
    replayIdx: 0,
    read: null as null | { key: number; i: number; path: number[]; steps: Step[]; found: boolean },
    pending: 0,
    msg: 'ready',
    rand: rng(3),
  };
  for (let i = 0; i < 14; i++) write(st, 1 + Math.floor(st.rand() * KEYSPACE), cfg);
  st.msg = 'preloaded 14 writes';
  return st;
}
type Sim = ReturnType<typeof initSim>;
type Cfg = { memLimit: number; ckptEvery: number };

function btInsert(st: Sim, key: number) {
  const touched: number[] = [];
  const split: number[] = [];
  const ins = (n: BNode): { right: BNode; sep: number } | null => {
    touched.push(n.id);
    if (n.leaf) {
      st.lastLeaf = n.id;
      if (n.keys.includes(key)) return null; // update in place
      n.keys = [...n.keys, key].sort((a, b) => a - b);
      if (n.keys.length <= LEAF_CAP) return null;
      const mid = Math.ceil(n.keys.length / 2);
      const right: BNode = { id: st.nextId++, leaf: true, keys: n.keys.slice(mid), kids: [] };
      n.keys = n.keys.slice(0, mid);
      split.push(n.id, right.id);
      return { right, sep: right.keys[0] };
    }
    const i = n.keys.filter((k) => k <= key).length;
    const res = ins(n.kids[i]);
    if (!res) return null;
    n.keys.splice(i, 0, res.sep);
    n.kids.splice(i + 1, 0, res.right);
    if (n.kids.length <= FANOUT) return null;
    const mid = Math.floor(n.keys.length / 2);
    const right: BNode = { id: st.nextId++, leaf: false, keys: n.keys.slice(mid + 1), kids: n.kids.slice(mid + 1) };
    const sep = n.keys[mid];
    n.keys = n.keys.slice(0, mid);
    n.kids = n.kids.slice(0, mid + 1);
    split.push(n.id, right.id);
    return { right, sep };
  };
  const res = ins(st.tree);
  if (res) {
    st.tree = { id: st.nextId++, leaf: false, keys: [res.sep], kids: [st.tree, res.right] };
    split.push(st.tree.id);
  }
  // only the leaf (plus pages touched by a split) are modified; inner pages on the path are just read
  [st.lastLeaf, ...split].forEach((id) => st.dirty.add(id));
  if (split.length) st.split = { fx: st.split.fx + 1, ids: split };
  return split.length > 0;
}

function apply(st: Sim, e: Ent, cfg: Cfg, replay: boolean) {
  if (st.engine === 'btree') {
    const didSplit = btInsert(st, e.k);
    st.msg = `${replay ? 'replay' : 'put'} k=${e.k} → leaf page updated in place${didSplit ? ' · PAGE SPLIT' : ''}`;
    return;
  }
  st.mem.set(e.k, e.seq);
  st.msg = `${replay ? 'replay' : 'put'} k=${e.k} → memtable (${st.mem.size}/${cfg.memLimit})`;
  if (replay || st.mem.size < cfg.memLimit) return;
  const sst: SST = { id: st.nextId++, ents: [...st.mem].map(([k, seq]) => ({ k, seq })).sort((a, b) => a.k - b.k) };
  st.physical += sst.ents.length;
  st.l0 = [sst, ...st.l0];
  st.mem = new Map();
  st.wal = [];
  st.msg = `memtable full → flushed as immutable SSTable #${sst.id} (sequential write), WAL truncated`;
  if (st.l0.length < 3) return;
  const merged = new Map<number, number>();
  for (const t of [...(st.l1 ? [st.l1] : []), ...[...st.l0].reverse()]) for (const x of t.ents) merged.set(x.k, x.seq);
  const before = st.l0.reduce((a, t) => a + t.ents.length, 0) + (st.l1?.ents.length ?? 0);
  const out: SST = { id: st.nextId++, ents: [...merged].map(([k, seq]) => ({ k, seq })).sort((a, b) => a.k - b.k) };
  st.physical += out.ents.length;
  st.ghosts = st.l0.map((sst, row) => ({ fx: out.id, sst, row }));
  st.l1 = out;
  st.l0 = [];
  st.msg = `L0 has 3 tables → compaction merged into L1: rewrote ${out.ents.length} entries, dropped ${before - out.ents.length} stale versions`;
}

function write(st: Sim, key: number, cfg: Cfg) {
  const e = { k: key, seq: ++st.seq };
  st.logical++;
  st.physical++; // WAL append
  st.wal.push(e);
  apply(st, e, cfg, false);
  if (st.engine === 'btree' && st.wal.length >= cfg.ckptEvery) {
    const n = st.dirty.size;
    st.physical += n * PAGE;
    st.randomIO += n;
    st.dirty = new Set();
    st.ckpt = clone(st.tree);
    st.wal = [];
    st.msg = `checkpoint: ${n} dirty pages written to random disk locations, WAL truncated`;
  }
}

export default function StorageLab() {
  const [engine, setEngine] = useState<Engine>('btree');
  const [memLimit, setMemLimit] = useState(5);
  const [ckptEvery, setCkptEvery] = useState(8);
  const [running, setRunning] = useState(false);
  const [, force] = useState(0);
  const cfg: Cfg = { memLimit, ckptEvery };
  const s = useRef<Sim>(initSim('btree', cfg));
  const st = s.current;
  const busy = st.phase === 'crashed' || st.phase === 'replay';

  const reset = (e = engine) => {
    s.current = initSim(e, cfg);
    force((x) => x + 1);
  };

  useTicker(true, 260, () => {
    const st = s.current;
    if (st.phase === 'crashed') {
      if (--st.crashT > 0) return;
      if (st.engine === 'btree') {
        st.tree = clone(st.ckpt);
        st.dirty = new Set();
      } else st.mem = new Map();
      st.phase = 'replay';
      st.replayIdx = 0;
      st.msg = `recovery: memory is empty — replaying ${st.wal.length} WAL entries`;
    } else if (st.phase === 'replay') {
      if (st.replayIdx < st.wal.length) apply(st, st.wal[st.replayIdx++], cfg, true);
      else [st.phase, st.msg] = ['idle', 'recovered: every acknowledged write is back'];
    } else if (st.phase === 'read' && st.read) {
      const r = st.read;
      // walk one step per tick, then hold the highlighted result for a few ticks
      if (++r.i >= (st.engine === 'btree' ? r.path.length : r.steps.length) + 3) st.phase = 'idle';
    } else if (st.pending > 0 || running) {
      if (st.pending > 0) st.pending--;
      write(st, 1 + Math.floor(st.rand() * KEYSPACE), cfg);
    } else return;
    force((x) => x + 1);
  });

  const doRead = () => {
    const live = st.engine === 'btree' ? leaves(st.tree).flatMap((l) => l.keys) : [...new Set([...st.mem.keys(), ...st.l0.flatMap((t) => t.ents.map((e) => e.k)), ...(st.l1?.ents.map((e) => e.k) ?? [])])];
    const key = live.length && st.rand() < 0.75 ? live[Math.floor(st.rand() * live.length)] : 1 + Math.floor(st.rand() * KEYSPACE);
    const path: number[] = [];
    const steps: Step[] = [];
    let found = false;
    if (st.engine === 'btree') {
      let n = st.tree;
      path.push(n.id);
      while (!n.leaf) path.push((n = n.kids[n.keys.filter((k) => k <= key).length]).id);
      found = n.keys.includes(key);
    } else {
      found = st.mem.has(key);
      steps.push({ target: 'mem', res: found ? 'found' : 'miss' });
      for (const t of [...st.l0, ...(st.l1 ? [st.l1] : [])]) {
        if (found) break;
        found = t.ents.some((e) => e.k === key);
        steps.push({ target: t.id, res: found ? 'found' : hash32(`${key}:${t.id}`) % 100 < BLOOM_FPR ? 'probe' : 'skip' });
      }
    }
    st.read = { key, i: 0, path, steps, found };
    st.phase = 'read';
    st.msg = `GET k=${key} → ${found ? 'found' : 'not found'}`;
    force((x) => x + 1);
  };
  const crash = () => {
    st.phase = 'crashed';
    st.crashT = 4;
    st.read = null;
    st.msg = engine === 'btree' ? `CRASH: buffer pool lost ${st.dirty.size} dirty pages not yet checkpointed` : `CRASH: memtable lost ${st.mem.size} entries never flushed`;
    force((x) => x + 1);
  };

  // stats
  const wa = st.logical ? st.physical / st.logical : 0;
  const lsmStored = st.mem.size + st.l0.reduce((a, t) => a + t.ents.length, 0) + (st.l1?.ents.length ?? 0);
  const allLeaves = leaves(st.tree);
  const liveKeys = engine === 'btree' ? allLeaves.reduce((a, l) => a + l.keys.length, 0) : new Set([...st.mem.keys(), ...st.l0.flatMap((t) => t.ents.map((e) => e.k)), ...(st.l1?.ents.map((e) => e.k) ?? [])]).size;
  const spaceAmp = liveKeys ? (engine === 'btree' ? (allLeaves.length * LEAF_CAP) / liveKeys : lsmStored / liveKeys) : 1;
  const rd = st.read;
  const readAmp = !rd ? null : engine === 'btree' ? rd.path.length : rd.steps.filter((x) => x.target !== 'mem' && x.res !== 'skip').length;
  const skipped = rd?.steps.filter((x) => x.res === 'skip').length ?? 0;

  // layout
  const W = 560;
  const H = 262;
  const AX = 128;
  const AW = 420;
  const visibleWal = st.wal.slice(-16);
  const walOff = st.wal.length - visibleWal.length;
  const replaying = st.phase === 'replay' ? st.replayIdx - 1 : -1;

  return (
    <LabFrame
      title="B-tree vs LSM-tree storage engines (with WAL)"
      goal="Write keys, watch where the bytes go, read one back, then crash the process and see the WAL bring it back."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={() => reset()}
      controls={
        <>
          <Seg
            label="Storage engine"
            value={engine}
            options={[
              { value: 'btree', label: 'B-tree (Postgres / InnoDB)', hint: 'Pages updated in place' },
              { value: 'lsm', label: 'LSM (RocksDB / Cassandra)', hint: 'Append-only: memtable → SSTables → compaction' },
            ]}
            onChange={(e) => {
              setEngine(e);
              reset(e);
            }}
          />
          {engine === 'lsm' ? (
            <Slider label="Memtable flush threshold" value={memLimit} min={3} max={10} onChange={setMemLimit} fmt={(v) => `${v} entries`} />
          ) : (
            <Slider label="Checkpoint every" value={ckptEvery} min={4} max={16} onChange={setCkptEvery} fmt={(v) => `${v} WAL entries`} />
          )}
          <div className="flex flex-wrap gap-1.5 sm:col-span-2">
            <Button size="xs" variant="secondary" icon={<Pencil size={12} />} disabled={busy} onClick={() => (write(st, 1 + Math.floor(st.rand() * KEYSPACE), cfg), force((x) => x + 1))}>
              write 1
            </Button>
            <Button size="xs" variant="secondary" disabled={busy} onClick={() => ((st.pending += 20), force((x) => x + 1))}>
              write burst ×20{st.pending ? ` (${st.pending} left)` : ''}
            </Button>
            <Button size="xs" variant="secondary" icon={<BookOpen size={12} />} disabled={busy} onClick={doRead}>
              read key
            </Button>
            <Button size="xs" variant="danger" icon={<Zap size={12} />} disabled={busy} onClick={crash}>
              crash &amp; recover
            </Button>
          </div>
        </>
      }
      stats={
        <>
          <Stat label="Write amplification" value={`${wa.toFixed(1)}×`} tone={wa > 4 ? 'warn' : 'ok'} sub={engine === 'btree' ? `${st.randomIO} random page writes` : 'flush + compaction, all sequential'} />
          <Stat label="Read amplification" value={readAmp === null ? '—' : `${readAmp} ${engine === 'btree' ? 'pages' : 'tables'}`} sub={!rd ? 'press "read key"' : engine === 'btree' ? 'root → leaf descent' : `bloom filters skipped ${skipped}`} />
          <Stat label="Space amplification" value={`${spaceAmp.toFixed(2)}×`} tone={spaceAmp > 1.6 ? 'warn' : undefined} sub={engine === 'btree' ? 'half-empty pages after splits' : 'stale versions until compaction'} />
          <Stat label="WAL" value={`${st.wal.length} entries`} sub={engine === 'btree' ? 'since last checkpoint' : 'since last flush'} />
        </>
      }
      insight={
        <>
          {engine === 'btree'
            ? 'B-tree: rows live in fixed-size pages updated in place. A read is one root→leaf descent (log_F n pages; the upper levels stay cached in the buffer pool), so reads are cheap and predictable. A write dirties a page at a random disk location, a 1-row change rewrites a whole page, and a full page splits. A longer checkpoint interval coalesces more writes per page (lower write amp) but leaves a longer WAL to replay. Postgres adds MVCC on top: an UPDATE writes a new row version and VACUUM later reclaims the old one.'
            : 'LSM: a write is just a WAL append plus an insert into the sorted in-memory memtable — pure sequential IO, which is why Cassandra and RocksDB ingest so fast. The bill arrives later: a read may check the memtable and every SSTable newest→oldest (bloom filters skip most), overwritten keys take space until compaction, and compaction rewrites data again. A bigger memtable means fewer flushes and compactions.'}{' '}
          {busy && <b className="text-bad">Recovery in progress: data pages / memtable were only in RAM; every write was fsync’d to the sequential WAL before it was acknowledged, so replaying the log rebuilds exactly what was lost. That is the whole point of a write-ahead log.</b>}
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* WAL */}
        <text x={10} y={14} className="fill-muted font-mono text-[10px]">
          WAL (append-only)
        </text>
        <rect x={8} y={20} width={106} height={200} rx={6} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-line))" />
        {visibleWal.map((e, i) => (
          <motion.g key={e.seq} initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }}>
            <rect x={12} y={24 + i * 12} width={98} height={11} rx={2} fill={walOff + i === replaying ? 'rgb(var(--c-ok) / 0.35)' : 'rgb(var(--c-info) / 0.1)'} />
            <text x={16} y={32.5 + i * 12} className="fill-ink font-mono text-[8.5px]">
              #{e.seq} put k={e.k}
            </text>
          </motion.g>
        ))}
        {!st.wal.length && (
          <text x={61} y={44} textAnchor="middle" className="fill-faint font-mono text-[9px]">
            truncated
          </text>
        )}
        <line x1={AX - 8} x2={AX - 8} y1={10} y2={224} stroke="rgb(var(--c-line))" />

        {engine === 'btree' ? <BTreeView st={st} AX={AX} AW={AW} /> : <LsmView st={st} AX={AX} AW={AW} memLimit={memLimit} />}

        {st.phase === 'crashed' && (
          <motion.text x={AX + AW / 2} y={120} textAnchor="middle" className="fill-bad font-mono text-[22px] font-bold" initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 0.85 }}>
            CRASH — RAM wiped
          </motion.text>
        )}
        <text x={10} y={H - 22} className={cn('font-mono text-[10px]', st.phase === 'crashed' ? 'fill-bad' : st.phase === 'replay' ? 'fill-ok' : 'fill-ink')}>
          {st.msg}
        </text>
        <text x={10} y={H - 8} className="fill-faint font-mono text-[9px]">
          logical {st.logical} rows · physically written {st.physical} rows-worth (WAL {st.seq} + {engine === 'btree' ? `pages ${st.randomIO}×${PAGE}` : 'flush/compaction'})
        </text>
      </svg>
    </LabFrame>
  );
}

function leaves(n: BNode): BNode[] {
  return n.leaf ? [n] : n.kids.flatMap(leaves);
}

function BTreeView({ st, AX, AW }: { st: Sim; AX: number; AW: number }) {
  const ls = leaves(st.tree);
  const slot = AW / ls.length;
  const lw = Math.min(36, slot - 4);
  const pos = new Map<number, { x: number; y: number; w: number; h: number; n: BNode }>();
  const height = (n: BNode): number => (n.leaf ? 1 : 1 + height(n.kids[0]));
  const h = height(st.tree);
  const place = (n: BNode, d: number): number => {
    const y = 26 + d * 40;
    if (n.leaf) {
      const cx = AX + slot * (ls.indexOf(n) + 0.5);
      pos.set(n.id, { x: cx - lw / 2, y: 26 + (h - 1) * 40, w: lw, h: 46, n });
      return cx;
    }
    const cxs = n.kids.map((k) => place(k, d + 1));
    const cx = cxs.reduce((a, b) => a + b, 0) / cxs.length;
    const w = n.keys.length * 13 + 8;
    pos.set(n.id, { x: cx - w / 2, y, w, h: 16, n });
    return cx;
  };
  place(st.tree, 0);
  const rd = st.phase === 'read' ? st.read : null;
  const onPath = new Set(rd ? rd.path.slice(0, rd.i + 1) : []);
  const crashed = st.phase === 'crashed';
  return (
    <g>
      <text x={AX} y={14} className="fill-muted font-mono text-[10px]">
        B+tree pages · leaf holds {LEAF_CAP} rows · fanout {FANOUT} · depth {h}
      </text>
      {[...pos.values()].flatMap((p) =>
        p.n.kids.map((k) => {
          const c = pos.get(k.id)!;
          return <motion.line key={`e${k.id}`} initial={false} animate={{ x1: p.x + p.w / 2, y1: p.y + p.h, x2: c.x + c.w / 2, y2: c.y }} stroke={onPath.has(k.id) ? 'rgb(var(--c-info))' : 'rgb(var(--c-line))'} strokeWidth={onPath.has(k.id) ? 2 : 1} transition={{ duration: 0.4 }} />;
        }),
      )}
      {[...pos.values()].map((p) => {
        const dirty = st.dirty.has(p.n.id);
        const isRead = onPath.has(p.n.id);
        const stroke = crashed && dirty ? 'rgb(var(--c-bad))' : isRead ? 'rgb(var(--c-info))' : dirty ? 'rgb(var(--c-warn))' : 'rgb(var(--c-line))';
        return (
          <motion.g key={p.n.id} initial={{ x: p.x, y: p.y - 12, opacity: 0 }} animate={{ x: p.x, y: p.y, opacity: 1 }} transition={{ duration: 0.4 }}>
            <rect width={p.w} height={p.h} rx={4} fill={crashed && dirty ? 'rgb(var(--c-bad) / 0.2)' : isRead ? 'rgb(var(--c-info) / 0.15)' : 'rgb(var(--c-surface))'} stroke={stroke} strokeWidth={dirty || isRead ? 1.6 : 1} />
            {st.split.ids.includes(p.n.id) && <motion.rect key={st.split.fx} width={p.w} height={p.h} rx={4} fill="rgb(var(--c-violet))" initial={{ opacity: 0.6 }} animate={{ opacity: 0 }} transition={{ duration: 1.2 }} />}
            {p.n.leaf ? (
              p.n.keys.map((k, j) => (
                <text key={k} x={p.w / 2} y={11 + j * 10} textAnchor="middle" className={cn('font-mono text-[8.5px]', rd && rd.key === k && isRead ? 'fill-ok font-bold' : 'fill-ink')}>
                  {k}
                </text>
              ))
            ) : (
              <text x={p.w / 2} y={11.5} textAnchor="middle" className="fill-ink font-mono text-[8.5px]">
                {p.n.keys.join('·')}
              </text>
            )}
          </motion.g>
        );
      })}
      <text x={AX} y={222} className="fill-faint font-mono text-[9px]">
        <tspan className="fill-warn">▢ dirty (in buffer pool, not on disk)</tspan> · <tspan className="fill-violet">▢ split</tspan> · <tspan className="fill-info">▢ read path</tspan>
      </text>
    </g>
  );
}

function LsmView({ st, AX, AW, memLimit }: { st: Sim; AX: number; AW: number; memLimit: number }) {
  const kx = (k: number) => AX + 84 + ((k - 1) / (KEYSPACE - 1)) * (AW - 92);
  const rd = st.phase === 'read' ? st.read : null;
  const stepFor = (target: 'mem' | number) => {
    if (!rd) return null;
    const i = rd.steps.findIndex((x) => x.target === target);
    return i >= 0 && i <= rd.i ? rd.steps[i] : null;
  };
  const tone = (x: Step | null) => (!x ? null : x.res === 'found' ? 'ok' : x.res === 'probe' ? 'info' : x.res === 'skip' ? 'faint' : 'muted');
  const row = (key: string, y: number, label: string, ents: Ent[], x: Step | null, color: string, sub?: string, from = 36) => {
    const t = tone(x);
    return (
      <motion.g key={key} initial={{ y: from, opacity: 0.3 }} animate={{ y, opacity: 1 }} transition={{ duration: 0.5 }}>
        <rect x={AX} y={-8} width={AW - 4} height={17} rx={4} fill={t ? `rgb(var(--c-${t}) / 0.14)` : 'rgb(var(--c-surface))'} stroke={t ? `rgb(var(--c-${t}))` : 'rgb(var(--c-line))'} strokeDasharray={x?.res === 'skip' ? '3 3' : undefined} />
        <text x={AX + 5} y={4} className="fill-ink font-mono text-[9px]">
          {label}
        </text>
        {ents.map((e) => (
          <line key={e.k} x1={kx(e.k)} x2={kx(e.k)} y1={-5} y2={6} stroke={rd && rd.key === e.k && x ? 'rgb(var(--c-ok))' : color} strokeWidth={rd && rd.key === e.k && x ? 3 : 1.6} />
        ))}
        {(x || sub) && (
          <text x={AX + AW - 8} y={4} textAnchor="end" className="fill-muted font-mono text-[8.5px]">
            {x ? (x.res === 'skip' ? 'bloom: no → skip' : x.res === 'probe' ? 'bloom false positive → read, miss' : x.res === 'found' ? 'found ✓' : 'miss') : sub}
          </text>
        )}
      </motion.g>
    );
  };
  const memEnts = [...st.mem].map(([k, seq]) => ({ k, seq }));
  return (
    <g>
      <text x={AX} y={14} className="fill-muted font-mono text-[10px]">
        key space 1…{KEYSPACE} → each tick = one key stored in that structure
      </text>
      {row('mem', 36, `memtable ${st.mem.size}/${memLimit}`, memEnts, stepFor('mem'), st.phase === 'crashed' ? 'rgb(var(--c-bad))' : 'rgb(var(--c-accent))', 'RAM · sorted (skiplist)')}
      <line x1={AX} x2={AX + AW - 4} y1={56} y2={56} stroke="rgb(var(--c-ink) / 0.4)" strokeDasharray="5 4" />
      <text x={AX + AW - 4} y={66} textAnchor="end" className="fill-faint font-mono text-[8.5px]">
        RAM ↑ · disk ↓ (immutable files)
      </text>
      {st.l0.map((t, i) => row(`s${t.id}`, 82 + i * 22, `L0 #${t.id} (${t.ents.length})`, t.ents, stepFor(t.id), 'rgb(var(--c-info))', i === 0 ? 'newest · ranges overlap' : undefined))}
      {st.ghosts.map((g) => (
        <motion.g key={`g${g.fx}-${g.sst.id}`} initial={{ y: 82 + g.row * 22, opacity: 0.8 }} animate={{ y: 168, opacity: 0 }} transition={{ duration: 0.9, ease: 'easeIn' }}>
          {g.sst.ents.map((e) => (
            <line key={e.k} x1={kx(e.k)} x2={kx(e.k)} y1={-5} y2={6} stroke="rgb(var(--c-violet))" strokeWidth={1.6} />
          ))}
        </motion.g>
      ))}
      <text x={AX} y={154} className="fill-faint font-mono text-[8.5px]">
        compaction: when L0 has 3 tables, merge-sort them with L1, keep newest version per key
      </text>
      {st.l1 ? row(`s${st.l1.id}`, 172, `L1 #${st.l1.id} (${st.l1.ents.length})`, st.l1.ents, stepFor(st.l1.id), 'rgb(var(--c-violet))', 'one sorted run, no overlap', 104) : null}
      <text x={AX} y={222} className="fill-faint font-mono text-[9px]">
        reads: memtable → L0 newest→oldest → L1 · bloom filter per SSTable ({BLOOM_FPR}% false positives here)
      </text>
    </g>
  );
}
