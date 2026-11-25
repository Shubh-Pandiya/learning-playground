import { useMemo, useState } from 'react';
import { cn } from '@/shared/cn';
import { LabFrame, rng, Seg, Slider, Stat, useTicker } from './kit';

type Format = 'csv' | 'json' | 'parquet';

const ROWS = 8_000_000;
const DAYS = 30; // ts spans one month
const SCAN_MB_PER_TICK = 45;

// bytes per row as CSV text vs encoded Parquet (sorted by ts / random order)
const COLS = [
  { name: 'order_id', csv: 11, sorted: 1.2, random: 5, enc: 'delta' },
  { name: 'ts', csv: 21, sorted: 0.8, random: 5, enc: 'delta' },
  { name: 'customer_id', csv: 9, sorted: 3, random: 3, enc: 'dict' },
  { name: 'country', csv: 3, sorted: 0.3, random: 0.3, enc: 'dict+RLE' },
  { name: 'status', csv: 9, sorted: 0.25, random: 0.25, enc: 'dict+RLE' },
  { name: 'amount', csv: 8, sorted: 4.5, random: 4.5, enc: 'plain+zstd' },
  { name: 'sku', csv: 13, sorted: 2.5, random: 2.5, enc: 'dict' },
  { name: 'notes', csv: 65, sorted: 24, random: 24, enc: 'zstd' },
] as const;
const TS = 1;
const JSON_KEYS = COLS.reduce((a, c) => a + c.name.length + 4, 2); // "name": repeated on every row

const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} MB`);

export default function ParquetLab() {
  const [fmt, setFmt] = useState<Format>('parquet');
  const [sorted, setSorted] = useState(true);
  const [groups, setGroups] = useState(16);
  const [sel, setSel] = useState<number[]>([3, 5]);
  const [from, setFrom] = useState(10);
  const [days, setDays] = useState(3);
  const [running, setRunning] = useState(true);
  const [cursor, setCursor] = useState(0);

  const m = useMemo(() => {
    const r = rng(17 + groups);
    const rowsPerGroup = ROWS / groups;
    const to = Math.min(DAYS, from + days);
    const stats = Array.from({ length: groups }, (_, g) =>
      sorted ? { min: (g * DAYS) / groups, max: ((g + 1) * DAYS) / groups - 0.01 } : { min: r() * 0.2, max: DAYS - 0.01 - r() * 0.2 },
    );
    const keep = stats.map((s) => s.max >= from && s.min < to);
    const read = [...new Set([...sel, TS])];
    const perRow = (c: (typeof COLS)[number]) => (sorted ? c.sorted : c.random);
    const chunk = (c: number) => rowsPerGroup * perRow(COLS[c]);
    const csvRow = COLS.reduce((a, c) => a + c.csv, 0);
    const csvTotal = ROWS * csvRow;
    const pqTotal = COLS.reduce((a, _, c) => a + chunk(c) * groups, 0) + 16 * 1024;
    const total = fmt === 'csv' ? csvTotal : fmt === 'json' ? ROWS * (csvRow + JSON_KEYS) : pqTotal;
    const kept = keep.filter(Boolean).length;
    const scanned = fmt === 'parquet' ? 16 * 1024 + keep.reduce((a, k) => (k ? a + read.reduce((b, c) => b + chunk(c), 0) : a), 0) : total;
    const matching = Math.round((ROWS * (to - from)) / DAYS);
    const decoded = fmt === 'parquet' ? kept * rowsPerGroup : ROWS;
    // per-group bytes actually read, for the scan animation
    const groupBytes = keep.map((k) => (fmt !== 'parquet' ? total / groups : k ? read.reduce((b, c) => b + chunk(c), 0) : 0));
    return { stats, keep, read, chunk, perRow, total, csvTotal, pqTotal, scanned, kept, matching, decoded, groupBytes, to, rowsPerGroup };
  }, [fmt, sorted, groups, sel, from, days]);

  const totalTicks = Math.max(1, Math.ceil(m.scanned / (SCAN_MB_PER_TICK * 1024 ** 2)));
  useTicker(running, 100, () => setCursor((c) => (c > totalTicks + 12 ? 0 : c + 1)));
  const bytesDone = Math.min(m.scanned, cursor * SCAN_MB_PER_TICK * 1024 ** 2);
  // which group the scan cursor is in (skipped groups cost ~0)
  let acc = 0;
  let at = m.groupBytes.length;
  for (let g = 0; g < m.groupBytes.length; g++) {
    acc += m.groupBytes[g];
    if (bytesDone < acc) {
      at = g;
      break;
    }
  }
  const restart = <T,>(f: (v: T) => void) => (v: T) => {
    f(v);
    setCursor(0);
  };
  const toggleCol = (c: number) => restart(setSel)(sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c].sort((a, b) => a - b));

  const skipped = m.stats.length - m.kept;
  const ratio = m.csvTotal / m.pqTotal;
  const notesShare = (m.chunk(7) * groups) / m.pqTotal;
  const row = fmt !== 'parquet';

  const lines: string[] = [];
  if (row)
    lines.push(`${fmt.toUpperCase()} stores row after row: to answer a query on ${m.read.length} column(s) the reader still reads and parses all 8 columns of all ${(ROWS / 1e6).toFixed(0)}M rows (${mb(m.total)}). There are no footer statistics, so the WHERE runs only after every row is parsed.${fmt === 'json' ? ' JSON also repeats every key name on every row.' : ''}`);
  else {
    if (sorted && skipped) lines.push(`Sorted by ts, each row group's footer min/max covers a narrow slice of the month, so the reader skips ${skipped} of ${groups} groups without touching them and reads only ${m.read.length} of 8 column chunks in the rest: ${mb(m.scanned)} of ${mb(m.total)}.`);
    if (!sorted) lines.push(`Rows are in random order (e.g. written after a shuffle by customer_id), so every group's min/max spans the whole month and the stats can't rule out a single group. Sort or cluster by the filter column (ORDER BY ts, Z-order, an Iceberg sort order) to make the ranges tight. Projection still saves you: only ${m.read.length} column chunks per group.`);
    if (sorted && !skipped) lines.push('The WHERE range overlaps every row group, so min/max can skip nothing. Narrow the date range to see groups drop out.');
    if (sel.includes(7)) lines.push(`notes is ${Math.round(notesShare * 100)}% of the file: selecting it (or SELECT *) gives back most of the columnar win.`);
    if (groups >= 32) lines.push(`Smaller row groups skip more precisely, but each one adds footer metadata, a separate read per column chunk (${m.kept * m.read.length} requests here) and smaller dictionaries. Typical row groups are 128 MB to 1 GB.`);
    lines.push(`Low-cardinality columns compress hardest: country and status become a small dictionary plus run-length-encoded bit-packed ids (~${Math.round(COLS[3].csv / COLS[3].sorted)}x and ~${Math.round(COLS[4].csv / COLS[4].sorted)}x smaller than CSV).`);
  }

  // layout
  const AX = 20; // min/max axis column
  const AW = 104;
  const GX = 140; // grid start
  const GW = 380;
  const rh = Math.min(14, 300 / groups);
  const H = 40 + groups * rh + 12;
  const widths = COLS.map((c) => Math.sqrt(row ? c.csv : m.perRow(c)));
  const wsum = widths.reduce((a, b) => a + b, 0);
  const cx: number[] = [];
  widths.reduce((x, w, i) => ((cx[i] = x), x + (w / wsum) * GW), GX);
  const cw = (i: number) => (widths[i] / wsum) * GW;
  const mid = (i: number) => cx[i] + cw(i) / 2;
  const ax = (d: number) => AX + (d / DAYS) * AW;

  return (
    <LabFrame
      title="Parquet: columnar layout and predicate pushdown"
      goal="Pick the columns and a date range, then compare row formats with Parquet, sorted vs random order, and big vs small row groups. Watch which row groups and column chunks are actually read."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={() => setCursor(0)}
      controls={
        <>
          <Seg
            label="File format"
            value={fmt}
            options={[
              { value: 'csv', label: 'CSV (rows)' },
              { value: 'json', label: 'JSON (rows)' },
              { value: 'parquet', label: 'Parquet (columns)' },
            ]}
            onChange={restart(setFmt)}
          />
          <div className="flex flex-wrap gap-3">
            <Seg
              label="Physical order"
              value={sorted ? 'sorted' : 'random'}
              options={[
                { value: 'sorted', label: 'sorted by ts' },
                { value: 'random', label: 'random' },
              ]}
              onChange={restart((v: string) => setSorted(v === 'sorted'))}
            />
            <Seg label="Row groups" value={groups} options={[4, 8, 16, 32].map((g) => ({ value: g, label: `${g}`, hint: `${ROWS / g / 1000}k rows each` }))} onChange={restart(setGroups)} />
          </div>
          <div className="sm:col-span-2">
            <div className="eyebrow mb-1">SELECT (ts is always read for the WHERE)</div>
            <div className="flex flex-wrap gap-1">
              {COLS.map((c, i) => (
                <button key={c.name} onClick={() => toggleCol(i)} className={cn('rounded-md border px-2 py-1 font-mono text-[11px] transition', sel.includes(i) ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-surface text-muted hover:border-accent/50 hover:text-ink')}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <Slider label="WHERE ts from" value={from} min={0} max={DAYS - 1} onChange={restart(setFrom)} fmt={(v) => `Nov ${v + 1}`} />
          <Slider label="Date range" value={days} min={1} max={DAYS} onChange={restart(setDays)} fmt={(v) => `${Math.min(v, DAYS - from)} day(s) → ${((Math.min(v, DAYS - from) / DAYS) * 100).toFixed(0)}% of rows`} />
        </>
      }
      stats={
        <>
          <Stat label="Bytes scanned" value={mb(m.scanned)} tone={m.scanned / m.csvTotal > 0.5 ? 'bad' : m.scanned / m.csvTotal > 0.1 ? 'warn' : 'ok'} sub={`of ${mb(m.total)} (${((m.scanned / m.total) * 100).toFixed(1)}%)`} />
          <Stat label="Row groups skipped" value={row ? 'n/a' : `${skipped} / ${groups}`} tone={row ? 'bad' : skipped ? 'ok' : 'warn'} sub={row ? 'no footer stats' : `${m.kept * m.read.length} column-chunk reads`} />
          <Stat label="Rows decoded" value={`${(m.decoded / 1e6).toFixed(1)}M`} sub={`${(m.matching / 1e6).toFixed(2)}M match the WHERE`} tone={m.decoded > 3 * m.matching ? 'warn' : 'ok'} />
          <Stat label="Compression vs CSV" value={`${ratio.toFixed(1)}x`} sub={`Parquet file ${mb(m.pqTotal)}${sorted ? '' : ' (unsorted: delta encoding weaker)'}`} />
        </>
      }
      insight={lines.join(' ')}
    >
      <svg viewBox={`0 0 560 ${H}`} className="w-full">
        <text x={AX} y={12} className="fill-muted font-mono text-[9px]">
          {row ? 'no stats' : 'footer min/max (ts)'}
        </text>
        {!row && <rect x={ax(from)} y={18} width={Math.max(1.5, ax(m.to) - ax(from))} height={groups * rh + 20} fill="rgb(var(--c-info) / 0.12)" stroke="rgb(var(--c-info) / 0.6)" strokeDasharray="3 2" />}
        {!row && (
          <text x={AX} y={28} className="fill-info font-mono text-[8px]">
            WHERE Nov {from + 1}–{m.to}
          </text>
        )}
        <text x={GX} y={12} className="fill-muted font-mono text-[9px]">
          {row ? `${fmt.toUpperCase()}: each block = many rows, every column interleaved` : 'Parquet: row groups × column chunks (width ∝ √ encoded size)'}
        </text>
        {COLS.map((c, i) => (
          <text key={c.name} x={cx[i] + cw(i) / 2} y={i % 2 ? 31 : 24} textAnchor="middle" className={cn('font-mono text-[7.5px]', m.read.includes(i) ? 'fill-accent font-semibold' : 'fill-faint')}>
            {c.name.slice(0, Math.max(3, Math.floor((Math.min(i > 1 ? mid(i) - mid(i - 2) : 2 * (mid(i) - GX), i < COLS.length - 2 ? mid(i + 2) - mid(i) : 2 * (GX + GW - mid(i))) - 6) / 4.7)))}
          </text>
        ))}
        {m.stats.map((s, g) => {
          const y = 36 + g * rh;
          const keep = row || m.keep[g];
          const scanned = g < at || at >= groups;
          const scanning = g === at && keep;
          return (
            <g key={g}>
              {!row && <rect x={ax(s.min)} y={y + rh * 0.3} width={Math.max(1, ax(s.max) - ax(s.min))} height={rh * 0.4} rx={1} fill={m.keep[g] ? 'rgb(var(--c-accent) / 0.7)' : 'rgb(var(--c-faint) / 0.5)'} />}
              {row
                ? Array.from({ length: 3 }, (_, rep) =>
                    COLS.map((c, i) => {
                      const w = (c.csv / COLS.reduce((a, b) => a + b.csv, 0)) * (GW / 3);
                      const x0 = GX + rep * (GW / 3) + (COLS.slice(0, i).reduce((a, b) => a + b.csv, 0) / COLS.reduce((a, b) => a + b.csv, 0)) * (GW / 3);
                      return <rect key={`${rep}-${i}`} x={x0} y={y + 0.5} width={Math.max(0.6, w - 0.6)} height={rh - 1} fill={m.read.includes(i) ? 'rgb(var(--c-accent) / 0.75)' : `rgb(var(--c-ink) / ${scanned || scanning ? 0.3 : 0.1})`} />;
                    }),
                  )
                : COLS.map((_, i) => {
                    const read = m.keep[g] && m.read.includes(i);
                    return <rect key={i} x={cx[i] + 0.5} y={y + 0.5} width={cw(i) - 1} height={rh - 1} rx={1.5} fill={read ? `rgb(var(--c-accent) / ${scanned ? 0.85 : 0.35})` : m.keep[g] ? 'rgb(var(--c-surface))' : 'rgb(var(--c-line) / 0.25)'} stroke={read ? 'rgb(var(--c-accent))' : 'rgb(var(--c-line))'} strokeWidth={0.6} />;
                  })}
              {!row && !m.keep[g] && <line x1={GX} x2={GX + GW} y1={y + rh / 2} y2={y + rh / 2} stroke="rgb(var(--c-faint))" strokeWidth={0.8} />}
              {scanning && <rect x={GX - 3} y={y} width={GW + 6} height={rh} rx={2} fill="none" stroke="rgb(var(--c-info))" strokeWidth={1.4} />}
              {rh >= 9 && (
                <text x={GX + GW + 4} y={y + rh / 2 + 3} className={cn('font-mono text-[7.5px]', row || m.keep[g] ? 'fill-muted' : 'fill-faint')}>
                  {row ? 'parse' : m.keep[g] ? 'read' : 'skip'}
                </text>
              )}
            </g>
          );
        })}
        {!row && (
          <text x={AX} y={H - 1} className="fill-faint font-mono text-[7.5px]">
            Nov 1
            <tspan x={AX + AW} textAnchor="end">
              Nov 30
            </tspan>
          </text>
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-3 px-1 pb-1 font-mono text-[9.5px] text-faint">
        <span>
          scan: {mb(bytesDone)} / {mb(m.scanned)} at {SCAN_MB_PER_TICK * 10} MB/s
        </span>
        <span className="text-accent">■ bytes read</span>
        {!row && <span>▭ column not selected</span>}
        {!row && <span>— group skipped by min/max</span>}
        {!row && (
          <span>
            encodings:{' '}
            {COLS.map((c) => `${c.name} ${c.enc}`)
              .slice(0, 5)
              .join(' · ')}{' '}
            …
          </span>
        )}
      </div>
    </LabFrame>
  );
}
