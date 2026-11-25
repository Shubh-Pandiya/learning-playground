import { useMemo } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Folder, FolderOpen, Layers } from 'lucide-react';
import { cn } from '@/shared/cn';
import { T, fmtCount, fmtSize, folderTiles, getQuery, type Layout, type MoreFolder, type QueryId, type ShownFolder } from './engine';

const CAP = 48;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

interface Sq {
  bucket: number;
  read: boolean;
}

/** Representative squares for a folder: ≤ CAP squares, grouped by bucket, with the opened files marked. */
function squaresFor(f: ShownFolder, query: QueryId): { groups: Sq[][]; per: number } {
  const e = f.eval;
  const seed = hash(f.path + query);
  if (e.buckets > 1) {
    const perB = Math.min(e.perBucket, Math.max(1, Math.floor(CAP / e.buckets)));
    const per = e.perBucket / perB;
    const openPerBucket = e.opened / e.bucketsRead;
    const readN = Math.min(perB, Math.ceil(openPerBucket / per - 1e-9));
    const off = seed % (perB - readN + 1);
    const groups: Sq[][] = [];
    for (let b = 0; b < e.buckets; b++) {
      const bucketRead = e.bucketsRead === e.buckets || b === T.targetBucket;
      groups.push(Array.from({ length: perB }, (_, i) => ({ bucket: b, read: bucketRead && i >= off && i < off + readN })));
    }
    return { groups, per };
  }
  const n = Math.min(e.files, CAP);
  const per = e.files / n;
  const readN = Math.min(n, Math.ceil(e.opened / per - 1e-9));
  const off = seed % (n - readN + 1);
  return { groups: [Array.from({ length: n }, (_, i) => ({ bucket: 0, read: i >= off && i < off + readN }))], per };
}

const sqSize = (mb: number) => (mb >= T.smallMB ? 'h-3 w-3' : mb >= 8 ? 'h-2 w-2' : mb >= 1 ? 'h-1.5 w-1.5' : 'h-1 w-1');

function FolderTile({ f, stage, query }: { f: ShownFolder; stage: number; query: QueryId }) {
  const { groups, per } = useMemo(() => squaresFor(f, query), [f, query]);
  const pruned = stage >= 1 && !f.matched;
  const e = f.eval;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: pruned ? 0.38 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.35 }}
      className={cn(
        'w-[214px] rounded-lg border bg-surface p-2 shadow-paper transition-colors',
        pruned ? 'border-line' : stage >= 1 ? 'border-accent/60' : f.tiny ? 'border-warn/60' : 'border-line',
      )}
    >
      <div className={cn('flex items-start gap-1 font-mono text-[10px] leading-tight text-ink', pruned && 'line-through decoration-faint')}>
        {pruned ? <Folder size={11} className="mt-px shrink-0 text-faint" /> : <FolderOpen size={11} className="mt-px shrink-0 text-accent" />}
        <span className="break-all">{f.path}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-muted">
        <span>
          {fmtCount(e.files)} file{e.files > 1 ? 's' : ''} × {fmtSize(e.fileMB / 1024)}
        </span>
        {f.tiny && <span className="rounded bg-warn/15 px-1 text-warn">small</span>}
        {e.buckets > 1 && <span className="rounded bg-violet/10 px-1 text-violet">16 buckets</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {groups.map((g, gi) => (
          <div key={gi} className={cn('flex flex-wrap items-center gap-[3px]', groups.length > 1 && 'rounded-sm bg-ink/[0.04] p-[2px]')}>
            {g.map((s, i) => {
              const cls =
                stage === 0
                  ? 'bg-ink/25'
                  : !f.matched
                    ? 'bg-ink/15'
                    : stage >= 2 && !s.read
                      ? 'bg-transparent ring-1 ring-inset ring-info/60'
                      : stage >= 3
                        ? 'bg-accent'
                        : 'bg-ink/40';
              return (
                <motion.span
                  key={i}
                  className={cn('block rounded-[2px] transition-colors duration-300', sqSize(e.fileMB), cls)}
                  animate={{ scale: stage >= 3 && f.matched && s.read ? [1, 1.4, 1] : 1 }}
                  transition={{ duration: 0.4, delay: ((gi * 7 + i) % 20) * 0.015 }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-1 font-mono text-[9.5px] text-faint">
        <span>{per > 1.01 ? `1 ▪ ≈ ${fmtCount(per)} files` : '1 ▪ = 1 file'}</span>
        {stage >= 1 && (
          <span className={cn(f.matched ? 'text-accent' : 'text-faint')}>
            {!f.matched ? 'pruned' : stage >= 2 ? `open ${fmtCount(e.opened)}/${fmtCount(e.files)}` : 'kept'}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function MoreTile({ m, stage }: { m: MoreFolder; stage: number }) {
  const pruned = stage >= 1 && !m.matched;
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: pruned ? 0.45 : 1 }}
      exit={{ opacity: 0 }}
      className={cn(
        'flex w-[214px] flex-col justify-center rounded-lg border border-dashed p-2.5 font-mono text-[10.5px]',
        pruned ? 'border-line text-faint' : stage >= 1 ? 'border-accent/60 text-ink' : 'border-ink/25 text-muted',
      )}
    >
      <div className="flex items-center gap-1">
        <Layers size={12} className={stage >= 1 && m.matched ? 'text-accent' : 'text-faint'} />+{fmtCount(m.folders)} more folder{m.folders > 1 ? 's' : ''}
      </div>
      <div className="mt-0.5 text-[10px] text-muted">{fmtCount(m.files)} files</div>
      {stage >= 1 && (
        <div className={cn('mt-1 text-[10px]', m.matched ? 'text-accent' : 'text-faint')}>
          {!m.matched ? 'pruned from metadata' : stage >= 2 ? `open ${fmtCount(m.opened)} of ${fmtCount(m.files)}` : 'matches the filter'}
        </div>
      )}
    </motion.div>
  );
}

export function FileGrid({ layout, query, stage }: { layout: Layout; query: QueryId; stage: number }) {
  const tiles = useMemo(() => folderTiles(layout, getQuery(query)), [layout, query]);
  return (
    <LayoutGroup>
      <motion.div layout className="flex flex-wrap content-start gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {tiles.map((t) => (t.kind === 'folder' ? <FolderTile key={t.key} f={t} stage={stage} query={query} /> : <MoreTile key={t.key} m={t} stage={stage} />))}
        </AnimatePresence>
      </motion.div>
    </LayoutGroup>
  );
}

export function GridLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded-[2px] bg-accent" /> read
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded-[2px] ring-1 ring-inset ring-info/60" /> skipped by min/max or bucket
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded-[2px] bg-ink/15" /> in a pruned partition
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded-[2px] bg-ink/30" />
        <span className="h-2 w-2 rounded-[2px] bg-ink/30" />
        <span className="h-1 w-1 rounded-[2px] bg-ink/30" /> ≥64 MB · 8–64 MB · tiny
      </span>
    </div>
  );
}
