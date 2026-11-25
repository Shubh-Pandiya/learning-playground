import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Archive, Eraser, GitMerge, Plus, Trash2, Users, Zap } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { LabFrame, rng, Seg, Slider, Stat, useTicker } from './kit';

type DelMode = 'cow' | 'mor';
type Act = 'init' | 'append' | 'stream' | 'cow' | 'mor' | 'compact' | 'noop' | 'expire' | 'race' | 'crash' | 'orphans';
type Tone = 'ok' | 'bad' | 'warn' | 'info' | undefined;

interface DFile {
  id: number;
  mb: number;
  del: boolean; // position-delete file (MOR) rather than a data file
  target?: number; // data file a delete file applies to
}
interface Manifest {
  id: number;
  files: number[];
  del: boolean;
}
interface Snap {
  id: number;
  v: number;
  op: string;
  manifests: number[];
}
interface Line {
  text: string;
  tone?: Tone;
}
interface Sim {
  files: Map<number, DFile>;
  manifests: Map<number, Manifest>;
  snaps: Snap[];
  pending: DFile[]; // written by an in-flight commit, not referenced yet
  orphans: DFile[]; // written by a crashed job, never committed
  fileId: number;
  manId: number;
  snapId: number;
  metaV: number;
  purged: number;
  expired: number;
  writtenMB: number;
  rewrittenMB: number;
  last: Act;
  info: Record<string, number>;
  log: Line[];
  race: { line: Line; fn?: () => void }[];
  rand: () => number;
}

const SMALL_MB = 64;
const TARGET_MB = 256;
const GRID = 12;
const CELL = 16;

const head = (st: Sim) => st.snaps[st.snaps.length - 1];
const filesOf = (st: Sim, s: Snap) => s.manifests.flatMap((m) => st.manifests.get(m)!.files).map((id) => st.files.get(id)!);
const log = (st: Sim, text: string, tone?: Tone) => (st.log = [...st.log, { text, tone }].slice(-6));

function newFile(st: Sim, mb: number, del = false, target?: number): DFile {
  const f = { id: st.fileId++, mb: Math.round(mb), del, target };
  st.writtenMB += f.mb;
  return f;
}
function addManifest(st: Sim, files: DFile[], del = false) {
  files.forEach((f) => st.files.set(f.id, f));
  const m = { id: st.manId++, files: files.map((f) => f.id), del };
  st.manifests.set(m.id, m);
  return m.id;
}
/** Write a new metadata.json and swap the catalog pointer to it (the atomic commit). */
function commit(st: Sim, op: string, manifests: number[]) {
  st.metaV++;
  st.snaps.push({ id: ++st.snapId, v: st.metaV, op, manifests });
}

function append(st: Sim, n: number, lo: number, hi: number, op = 'append') {
  const files = Array.from({ length: n }, () => newFile(st, lo + st.rand() * (hi - lo)));
  commit(st, op, [...(head(st)?.manifests ?? []), addManifest(st, files)]);
  return files;
}

function fresh(): Sim {
  const st: Sim = {
    files: new Map(),
    manifests: new Map(),
    snaps: [],
    pending: [],
    orphans: [],
    fileId: 1,
    manId: 1,
    snapId: 0,
    metaV: 0,
    purged: 0,
    expired: 0,
    writtenMB: 0,
    rewrittenMB: 0,
    last: 'init',
    info: {},
    log: [],
    race: [],
    rand: rng(7),
  };
  append(st, 2, 180, 250);
  append(st, 3, 20, 60);
  log(st, 'S1 append · S2 append committed (metadata v1, v2)');
  return st;
}

export default function IcebergLab() {
  const [mode, setMode] = useState<DelMode>('cow');
  const [retain, setRetain] = useState(3);
  const [travel, setTravel] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [, force] = useState(0);
  const s = useRef(fresh());
  const st = s.current;
  const bump = () => force((x) => x + 1);
  const act = (a: Act, info: Record<string, number> = {}) => {
    st.last = a;
    st.info = info;
    bump();
  };

  // "Run" = a streaming job that commits a tiny micro-batch every 2 s
  useTicker(running, 2000, () => {
    if (st.race.length) return;
    const [f] = append(st, 1, 3, 14, 'append');
    log(st, `stream commit S${st.snapId}: 1 file (${f.mb} MB)`);
    act('stream');
  });
  useTicker(st.race.length > 0, 900, () => {
    const step = st.race.shift();
    if (!step) return;
    step.fn?.();
    log(st, step.line.text, step.line.tone);
    bump();
  });

  const doAppend = () => {
    const fs = append(st, 3, 20, 70);
    log(st, `append S${st.snapId}: 3 files, 1 manifest`, 'ok');
    act('append', { n: fs.length, reused: head(st).manifests.length - 1 });
  };

  const doDelete = () => {
    const data = filesOf(st, head(st)).filter((f) => !f.del);
    const victim = data[Math.floor(st.rand() * data.length)];
    if (mode === 'cow') {
      const repl = newFile(st, victim.mb * 0.95);
      st.rewrittenMB += victim.mb;
      const mans = head(st).manifests.map((mid) => {
        const m = st.manifests.get(mid)!;
        if (!m.files.includes(victim.id)) return mid;
        return addManifest(
          st,
          m.files
            .filter((id) => id !== victim.id)
            .map((id) => st.files.get(id)!)
            .concat(repl),
          m.del,
        );
      });
      commit(st, 'overwrite', mans);
      log(st, `COW delete S${st.snapId}: rewrote f${victim.id} (${victim.mb} MB) → f${repl.id}`, 'warn');
      act('cow', { mb: victim.mb });
    } else {
      const d = newFile(st, 1, true, victim.id);
      commit(st, 'delete', [...head(st).manifests, addManifest(st, [d], true)]);
      log(st, `MOR delete S${st.snapId}: +1 delete file for f${victim.id}`, 'warn');
      act('mor', { d: filesOf(st, head(st)).filter((f) => f.del).length });
    }
  };

  const doCompact = () => {
    const live = filesOf(st, head(st));
    const dels = live.filter((f) => f.del);
    const targeted = new Set(dels.map((d) => d.target));
    const rewrite = live.filter((f) => !f.del && (f.mb < SMALL_MB || targeted.has(f.id)));
    if (rewrite.length < 2 && !dels.length) {
      log(st, 'compaction: nothing worth rewriting');
      return act('noop');
    }
    const keep = live.filter((f) => !f.del && !rewrite.includes(f));
    const deleted = new Map<number, number>();
    dels.forEach((d) => deleted.set(d.target!, (deleted.get(d.target!) ?? 0) + 1));
    let total = rewrite.reduce((a, f) => a + f.mb * Math.pow(0.95, deleted.get(f.id) ?? 0), 0);
    st.rewrittenMB += rewrite.reduce((a, f) => a + f.mb, 0);
    const out: DFile[] = [];
    while (total > 0.5) {
      const mb = Math.min(TARGET_MB, total);
      out.push(newFile(st, Math.max(1, mb)));
      total -= mb;
    }
    commit(st, 'replace', [addManifest(st, [...keep, ...out])]);
    log(st, `compaction S${st.snapId}: ${rewrite.length} files + ${dels.length} deletes → ${out.length} files`, 'ok');
    act('compact', { a: rewrite.length, b: out.length, d: dels.length });
  };

  const doExpire = () => {
    const drop = st.snaps.length - retain;
    if (drop <= 0) return act('expire', { x: 0, y: 0 });
    st.snaps = st.snaps.slice(drop);
    const liveM = new Set(st.snaps.flatMap((x) => x.manifests));
    const liveF = new Set(st.snaps.flatMap((x) => filesOf(st, x).map((f) => f.id)));
    [...st.manifests.keys()].forEach((id) => !liveM.has(id) && st.manifests.delete(id));
    let y = 0;
    [...st.files.keys()].forEach((id) => {
      if (liveF.has(id)) return;
      st.files.delete(id);
      y++;
    });
    st.purged += y;
    st.expired += drop;
    log(st, `expire_snapshots: dropped ${drop} snapshots, deleted ${y} files`, 'info');
    act('expire', { x: drop, y });
  };

  const doCrash = () => {
    const fs = [newFile(st, 30 + st.rand() * 40), newFile(st, 30 + st.rand() * 40)];
    st.orphans.push(...fs);
    log(st, `job crashed after writing ${fs.length} files; no commit, pointer still v${st.metaV}`, 'bad');
    act('crash', { n: fs.length });
  };

  const doOrphans = () => {
    const n = st.orphans.length;
    st.purged += n;
    st.orphans = [];
    log(st, `remove_orphan_files: deleted ${n} unreferenced files`, 'info');
    act('orphans', { n });
  };

  const doRace = () => {
    const base = head(st);
    const v = st.metaV;
    const a = [newFile(st, 40)];
    const b = [newFile(st, 35), newFile(st, 45)];
    st.race = [
      { line: { text: `A and B both read metadata v${v} (base S${base.id})` } },
      {
        line: {
          text: 'A writes 1 data file, B writes 2 (invisible: no metadata points at them)',
        },
        fn: () => st.pending.push(...a, ...b),
      },
      {
        line: {
          text: `A: CAS catalog v${v} → v${v + 1} ✓ committed`,
          tone: 'ok',
        },
        fn: () => {
          st.pending = st.pending.filter((f) => !a.includes(f));
          commit(st, 'append', [...base.manifests, addManifest(st, a)]);
        },
      },
      {
        line: {
          text: `B: CAS catalog v${v} → v${v + 1} ✗ pointer already moved`,
          tone: 'bad',
        },
      },
      {
        line: {
          text: `B: refresh to v${v + 1}, validate: A only added files → no conflict`,
          tone: 'warn',
        },
      },
      {
        line: {
          text: `B: rebuild manifest list on top of A, CAS v${v + 1} → v${v + 2} ✓`,
          tone: 'ok',
        },
        fn: () => {
          st.pending = [];
          commit(st, 'append', [...head(st).manifests, addManifest(st, b)]);
        },
      },
    ];
    act('race', { v });
  };

  // derived
  const cur = head(st);
  const sel = st.snaps.find((x) => x.id === travel) ?? cur;
  const lostTravel = travel !== null && sel.id !== travel;
  const selIdx = st.snaps.indexOf(sel);
  const selFiles = filesOf(st, sel);
  const selIds = new Set(selFiles.map((f) => f.id));
  const curFiles = filesOf(st, cur);
  const dataN = curFiles.filter((f) => !f.del).length;
  const smallN = curFiles.filter((f) => !f.del && f.mb < SMALL_MB).length;
  const delN = curFiles.filter((f) => f.del).length;
  const storedMB = [...st.files.values(), ...st.orphans, ...st.pending].reduce((a, f) => a + f.mb, 0);
  const liveMB = curFiles.reduce((a, f) => a + f.mb, 0);
  const busy = st.race.length > 0;

  const ins: string[] = [];
  const I = st.info;
  if (sel !== cur)
    ins.push(
      `Time travel: SELECT … VERSION AS OF S${sel.id} reads metadata v${sel.v}'s manifest list, so it sees exactly the ${selFiles.length} files that existed then, even though later commits added or replaced files. Nothing was copied; old files simply have not been deleted yet.`,
    );
  if (lostTravel) ins.push('The snapshot you were reading was expired: its unreferenced files are gone, so time travel to it now fails.');
  const MSG: Record<Act, string> = {
    init: 'Every commit writes new immutable files plus a new metadata.json, then atomically swaps the catalog pointer to it. Nothing is modified in place: that is where atomic commits, snapshot isolation and time travel come from. Readers pin one metadata version and never see a half-written commit.',
    append: `Append wrote ${I.n} data files and ONE new manifest, then a new manifest list that reuses the ${I.reused} existing manifest(s) by reference. Commit cost is proportional to the change, not the table size. Older snapshots still point at older manifest lists, so they still read the old data.`,
    stream: `A streaming job commits every 2 s; each commit adds one tiny file, one manifest and one snapshot. ${smallN} small files (< ${SMALL_MB} MB) now: each is an S3 GET, a Parquet footer read and a planning entry, so query planning and scans slow down linearly. This is the small-files problem: compact on a schedule.`,
    cow: `Copy-on-write: to delete ~5% of one file the writer rewrote the whole ${I.mb} MB file and its manifest. Writes are expensive (bytes rewritten: ${st.rewrittenMB} MB so far) but reads stay simple: no delete files to merge. Pick COW for read-heavy tables with rare, batched deletes.`,
    mor: `Merge-on-read: wrote a ~1 MB position-delete file instead of rewriting data. The write is cheap, but every query now opens the data files AND ${I.d} delete file(s) and merges them on the fly. Pick MOR for frequent CDC upserts or GDPR deletes, and let compaction fold the deletes in later.`,
    compact: `rewrite_data_files merged ${I.a} files into ${I.b} (target ${TARGET_MB} MB)${I.d ? ` and applied ${I.d} delete file(s)` : ''}, committed as a 'replace' snapshot with the same rows. Readers already on an older snapshot are unaffected, and the old files stay on S3 until those snapshots are expired.`,
    noop: 'Nothing to compact: no small files and no delete files in the current snapshot.',
    expire: I.x
      ? `expire_snapshots kept the last ${retain}: ${I.x} snapshot(s) dropped and ${I.y} file(s) no longer referenced by any retained snapshot physically deleted. Storage shrinks, but time travel and rollback to those snapshots are gone. Replaced files (COW, compaction) only free space now.`
      : `Only ${st.snaps.length} snapshot(s), retention is ${retain}: nothing to expire.`,
    race: `Optimistic concurrency: both writers built on v${I.v} and the catalog's atomic compare-and-swap let only one win. The loser re-read the new metadata, checked that A's change did not touch what B depends on (both are appends), and retried by writing only a new manifest list and metadata.json: no data rewrite. If A had rewritten files B was deleting from (compaction vs a delete), validation fails and B's job must redo its work.`,
    crash: `The job wrote ${I.n} data files, then died before the commit. No metadata.json points at them, so no reader, not even a concurrent one, ever sees partial data: atomicity for free. They are orphans: remove_orphan_files deletes unreferenced files older than a safety window (3 days by default) so in-flight writes are not removed.`,
    orphans: `Removed ${I.n} orphan file(s). The table never changed: only storage that no snapshot referenced was reclaimed.`,
  };
  ins.push(MSG[st.last]);

  // layout
  const shownSnaps = st.snaps.slice(-9);
  const mans = [...new Set(st.snaps.flatMap((x) => x.manifests))].sort((a, b) => a - b).slice(-10);
  const allFiles = [...st.files.values(), ...st.pending, ...st.orphans].sort((a, b) => a.id - b.id);
  const shownFiles = allFiles.slice(-GRID * 12);
  const sy = (i: number) => 28 + i * 23;
  const my = (i: number) => 28 + i * 21;
  const fx = 352;

  return (
    <LabFrame
      title="Iceberg: snapshots, manifests & time travel"
      goal="Append, delete, compact and expire; race two writers; crash a job mid-write. Then drag the time-travel slider and watch which files an old snapshot still reads."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={() => {
        s.current = fresh();
        setTravel(null);
        setRunning(false);
        bump();
      }}
      controls={
        <>
          <Seg
            label="Row-level deletes"
            value={mode}
            options={[
              {
                value: 'cow',
                label: 'copy-on-write',
                hint: 'rewrite affected data files',
              },
              {
                value: 'mor',
                label: 'merge-on-read',
                hint: 'write small delete files, merge at read time',
              },
            ]}
            onChange={setMode}
          />
          <Slider label="expire_snapshots: retain last" value={retain} min={1} max={6} onChange={setRetain} fmt={(v) => `${v} snapshot${v > 1 ? 's' : ''}`} />
          <Slider
            label="Time travel: read as of"
            value={selIdx}
            min={0}
            max={Math.max(0, st.snaps.length - 1)}
            onChange={(i) => setTravel(i >= st.snaps.length - 1 ? null : st.snaps[i].id)}
            fmt={() => `S${sel.id} · ${sel.op}${sel === cur ? ' (current)' : ''}`}
          />
          <div className="text-[11px] leading-snug text-muted">
            <b className="text-ink">Run</b> starts a streaming writer committing a tiny micro-batch every 2 s. Small files &lt; {SMALL_MB} MB, compaction target {TARGET_MB} MB.
          </div>
          <div className="flex flex-wrap gap-1.5 sm:col-span-2">
            <Button size="xs" variant="secondary" icon={<Plus size={12} />} disabled={busy} onClick={doAppend}>
              append batch
            </Button>
            <Button size="xs" variant="secondary" icon={<Trash2 size={12} />} disabled={busy} onClick={doDelete}>
              delete rows ({mode === 'cow' ? 'COW' : 'MOR'})
            </Button>
            <Button size="xs" variant="secondary" icon={<GitMerge size={12} />} disabled={busy} onClick={doCompact}>
              compact
            </Button>
            <Button size="xs" variant="secondary" icon={<Archive size={12} />} disabled={busy} onClick={doExpire}>
              expire snapshots
            </Button>
            <Button size="xs" variant="secondary" icon={<Users size={12} />} disabled={busy} onClick={doRace}>
              concurrent writer
            </Button>
            <Button size="xs" variant="danger" icon={<Zap size={12} />} disabled={busy} onClick={doCrash}>
              crash mid-write
            </Button>
            {st.orphans.length > 0 && (
              <Button size="xs" variant="ghost" icon={<Eraser size={12} />} disabled={busy} onClick={doOrphans}>
                remove orphans ({st.orphans.length})
              </Button>
            )}
          </div>
        </>
      }
      stats={
        <>
          <Stat label="Snapshots" value={st.snaps.length} sub={`metadata v${st.metaV} · ${st.expired} expired`} />
          <Stat label="Data files" value={dataN} sub="in current snapshot" />
          <Stat label="Small files" value={smallN} tone={smallN > 8 ? 'bad' : smallN > 4 ? 'warn' : 'ok'} sub={`< ${SMALL_MB} MB each`} />
          <Stat label="Delete files" value={delN} tone={delN > 3 ? 'warn' : undefined} sub="merged at read time" />
          <Stat
            label="Files query opens"
            value={selFiles.length}
            tone={selFiles.length > 15 ? 'bad' : selFiles.length > 8 ? 'warn' : 'ok'}
            sub={`+ ${sel.manifests.length} manifests + 1 list (S${sel.id})`}
          />
          <Stat label="Storage on S3" value={`${storedMB} MB`} tone={storedMB > liveMB * 2 ? 'warn' : undefined} sub={`live ${liveMB} MB; rest is history/orphans`} />
          <Stat label="Bytes rewritten" value={`${st.rewrittenMB} MB`} sub={`of ${st.writtenMB} MB written`} />
          <Stat label="Orphan files" value={st.orphans.length} tone={st.orphans.length ? 'bad' : 'ok'} sub={`${st.purged} files purged so far`} />
        </>
      }
      insight={ins.join(' ')}
    >
      <svg viewBox="0 0 560 262" className="w-full">
        <text x={8} y={14} className="fill-muted font-mono text-[9.5px]">
          catalog
        </text>
        <rect x={8} y={20} width={86} height={34} rx={6} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-accent))" strokeWidth={1.5} />
        <text x={51} y={34} textAnchor="middle" className="fill-ink font-mono text-[9.5px] font-semibold">
          db.events
        </text>
        <text x={51} y={47} textAnchor="middle" className="fill-accent font-mono text-[9px]">
          → v{st.metaV}.json
        </text>
        <line x1={51} y1={54} x2={51} y2={82} stroke="rgb(var(--c-accent))" strokeWidth={1.5} />
        <motion.rect key={st.metaV} x={8} y={82} width={86} height={40} rx={6} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-line))" initial={{ opacity: 0.3 }} animate={{ opacity: 1 }} />
        <text x={51} y={98} textAnchor="middle" className="fill-ink font-mono text-[9.5px]">
          metadata.json
        </text>
        <text x={51} y={112} textAnchor="middle" className="fill-faint font-mono text-[8.5px]">
          v{st.metaV} · {st.snaps.length} snaps
        </text>
        {Array.from({ length: Math.min(4, st.metaV - 1) }, (_, i) => (
          <text key={i} x={12} y={138 + i * 11} className="fill-faint font-mono text-[8.5px]" opacity={0.8 - i * 0.15}>
            v{st.metaV - 1 - i}.json (old)
          </text>
        ))}
        <text x={8} y={198} className="fill-muted font-mono text-[8.5px]">
          {busy ? 'commit in flight…' : `pointer swap = commit`}
        </text>

        <text x={112} y={14} className="fill-muted font-mono text-[9.5px]">
          snapshots · manifest lists
        </text>
        {st.snaps.length > shownSnaps.length && (
          <text x={212} y={14} textAnchor="end" className="fill-faint font-mono text-[8.5px]">
            +{st.snaps.length - shownSnaps.length}
          </text>
        )}
        {shownSnaps.map((x, i) => {
          const on = x === sel;
          return (
            <g key={x.id}>
              <line x1={94} y1={102} x2={112} y2={sy(i) + 9} stroke="rgb(var(--c-line))" />
              <rect
                x={112}
                y={sy(i)}
                width={100}
                height={19}
                rx={4}
                fill={on ? 'rgb(var(--c-info) / 0.15)' : 'rgb(var(--c-surface))'}
                stroke={on ? 'rgb(var(--c-info))' : x === cur ? 'rgb(var(--c-accent))' : 'rgb(var(--c-line))'}
                strokeWidth={on || x === cur ? 1.5 : 1}
              />
              <text x={117} y={sy(i) + 12.5} className={cn('font-mono text-[9px]', on ? 'fill-info' : 'fill-ink')}>
                S{x.id} {x.op}
              </text>
              <text x={208} y={sy(i) + 12.5} textAnchor="end" className="fill-faint font-mono text-[8px]">
                {x.manifests.length}m
              </text>
            </g>
          );
        })}

        <text x={236} y={14} className="fill-muted font-mono text-[9.5px]">
          manifests
        </text>
        {mans.map((mid, i) => {
          const m = st.manifests.get(mid)!;
          const on = sel.manifests.includes(mid);
          const si = shownSnaps.indexOf(sel);
          return (
            <g key={mid}>
              {on && si >= 0 && <line x1={212} y1={sy(si) + 9} x2={236} y2={my(i) + 8} stroke="rgb(var(--c-info))" strokeWidth={1.2} />}
              <rect
                x={236}
                y={my(i)}
                width={96}
                height={17}
                rx={4}
                fill={on ? 'rgb(var(--c-info) / 0.12)' : 'rgb(var(--c-surface))'}
                stroke={on ? 'rgb(var(--c-info))' : 'rgb(var(--c-line))'}
                opacity={on ? 1 : 0.6}
              />
              <text x={241} y={my(i) + 11.5} className={cn('font-mono text-[8.5px]', m.del ? 'fill-warn' : on ? 'fill-ink' : 'fill-muted')}>
                m{mid} · {m.files.length} {m.del ? 'del' : 'data'}
              </text>
            </g>
          );
        })}

        <text x={fx} y={14} className="fill-muted font-mono text-[9.5px]">
          files on S3 ({allFiles.length})
        </text>
        {shownFiles.map((f, i) => {
          const sz = 4 + 10 * Math.min(1, f.mb / TARGET_MB);
          const cx = fx + (i % GRID) * CELL + 8;
          const cy = 28 + Math.floor(i / GRID) * CELL + 8;
          const pend = st.pending.includes(f);
          const orph = st.orphans.includes(f);
          const read = selIds.has(f.id);
          const c = orph ? '--c-bad' : pend ? '--c-info' : f.del ? '--c-warn' : '--c-ok';
          return (
            <motion.rect
              key={f.id}
              x={cx - sz / 2}
              y={cy - sz / 2}
              width={sz}
              height={sz}
              rx={2}
              fill={read ? `rgb(var(${c}))` : orph || pend ? `rgb(var(${c}) / 0.15)` : 'rgb(var(--c-faint) / 0.25)'}
              stroke={orph || pend ? `rgb(var(${c}))` : read ? 'none' : 'rgb(var(--c-faint))'}
              strokeDasharray={orph || pend ? '2 1.5' : undefined}
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              <title>{`f${f.id} · ${f.mb} MB${f.del ? ' · delete file' : ''}${orph ? ' · orphan' : pend ? ' · uncommitted' : read ? ` · read by S${sel.id}` : ' · kept for time travel'}`}</title>
            </motion.rect>
          );
        })}
        <text x={8} y={246} className="fill-faint font-mono text-[8.5px]">
          files: size ∝ MB · <tspan className="fill-ok">■ read by S{sel.id}</tspan> · <tspan className="fill-warn">■ delete file</tspan> · <tspan className="fill-info">▢ written, uncommitted</tspan> ·{' '}
          <tspan className="fill-bad">▢ orphan (never committed)</tspan>
        </text>
        <text x={8} y={258} className="fill-faint font-mono text-[8.5px]">
          grey = still on S3 only because an older snapshot references it (time travel) · hover a file for details
        </text>
      </svg>
      <div className="mx-1 mb-1 rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-[10.5px] leading-relaxed">
        <div className="eyebrow mb-0.5">commit log</div>
        {st.log.map((l, i) => (
          <div
            key={`${st.log.length}-${i}`}
            className={cn(
              l.tone
                ? {
                    ok: 'text-ok',
                    bad: 'text-bad',
                    warn: 'text-warn',
                    info: 'text-info',
                  }[l.tone]
                : 'text-muted',
            )}
          >
            {l.text}
          </div>
        ))}
      </div>
    </LabFrame>
  );
}
