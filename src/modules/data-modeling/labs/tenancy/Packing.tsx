import { LayoutGroup, motion } from 'framer-motion';
import { Database, Layers, Server, Zap } from 'lucide-react';
import { cn } from '@/shared/cn';
import { K, REPS, STRATEGIES, fmtMs, fmtN, fmtUSD, fmtH, metrics, perDot, recommend, visibleBoxes, type Box, type Inputs, type More, type Strategy } from './engine';

const spring = { type: 'spring', stiffness: 220, damping: 26 } as const;

function uTone(u: number) {
  return u >= 0.95 ? 'bad' : u > 0.8 ? 'warn' : 'ok';
}
const BAR: Record<string, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' };
const TXT: Record<string, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' };

function Whale({ w, spiking }: { w: number; spiking: boolean }) {
  return (
    <motion.span
      layoutId={`whale-${w}`}
      animate={spiking ? { scale: [1, 1.25, 1] } : { scale: 1 }}
      transition={spiking ? { ...spring, scale: { repeat: Infinity, duration: 0.9 } } : spring}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-semibold text-paper',
        spiking ? 'bg-bad ring-2 ring-bad/40 ring-offset-1 ring-offset-surface' : 'bg-violet',
      )}
      title={`whale ${w + 1}`}
    >
      W{w + 1}
    </motion.span>
  );
}

function Rep({ r, shape, tone }: { r: number; shape: 'dot' | 'schema'; tone: 'idle' | 'warn' | 'bad' }) {
  return (
    <motion.span
      layoutId={`rep-${r}`}
      transition={spring}
      className={cn(
        'block shrink-0 transition-colors duration-500',
        shape === 'dot' ? 'h-2.5 w-2.5 rounded-full' : 'h-3 w-3.5 rounded-[3px] border',
        tone === 'bad' ? 'border-bad bg-bad' : tone === 'warn' ? 'border-warn bg-warn' : shape === 'dot' ? 'bg-info/70' : 'border-info/70 bg-info/25',
      )}
    />
  );
}

function SharedBox({ b, spike, gated }: { b: Box; spike: boolean; gated: boolean }) {
  const hosting = b.whales.includes(0);
  const live = spike && hosting && !gated;
  const u = live ? b.uSpike : b.u;
  const p = live ? b.p99Spike : b.p99;
  const tone = uTone(u);
  const repTone = live ? (p === Infinity ? 'bad' : p > 2 * b.p99 ? 'warn' : 'idle') : 'idle';
  return (
    <motion.div
      layout
      transition={spring}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={cn('w-[200px] rounded-xl border-2 bg-surface p-2', live && tone === 'bad' ? 'border-bad/70' : b.kind === 'schemas' ? 'border-info/40' : 'border-line')}
    >
      <div className="flex items-center justify-between font-mono text-[10.5px]">
        <span className="flex items-center gap-1 text-ink">
          <Server size={11} className="text-faint" /> {b.label}
        </span>
        <span className="text-faint">{fmtN(b.tenants)} tenants</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
        <motion.div className={cn('h-full rounded-full', BAR[tone])} animate={{ width: `${Math.min(100, u * 100)}%` }} transition={{ duration: 0.5 }} />
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[10px]">
        <span className={TXT[tone]}>{gated ? '?' : `${Math.round(u * 100)}% busy`}</span>
        <span className={cn(p === Infinity ? 'font-semibold text-bad' : 'text-muted')}>p99 {gated ? '?' : fmtMs(p)}</span>
      </div>
      <div className="mt-1.5 flex min-h-[40px] flex-wrap content-start items-center gap-1">
        {b.whales.map((w) => (
          <Whale key={w} w={w} spiking={w === 0 && spike && !gated} />
        ))}
        {b.reps.map((r) => (
          <Rep key={r} r={r} shape={b.kind === 'schemas' ? 'schema' : 'dot'} tone={repTone} />
        ))}
      </div>
      {b.kind === 'schemas' && <div className="mt-1 font-mono text-[9.5px] text-faint">{fmtN(b.tenants + b.whales.length)} schemas · {fmtN((b.tenants + b.whales.length) * K.tablesPerTenant * K.relsPerTable)} relations</div>}
      {live && p === Infinity && <div className="mt-1 font-mono text-[9.5px] font-semibold text-bad">{fmtN(b.tenants)} neighbours timing out</div>}
    </motion.div>
  );
}

function SiloBox({ b, spike, gated }: { b: Box; spike: boolean; gated: boolean }) {
  const whale = b.whales.length > 0;
  const live = spike && b.whales.includes(0) && !gated;
  const u = live ? b.uSpike : b.u;
  const tone = uTone(u);
  return (
    <motion.div
      layout
      transition={spring}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={cn('flex flex-col items-center rounded-lg border-2 bg-surface p-1.5', whale ? 'w-[92px] border-violet/50' : 'w-[52px] border-ok/30', live && tone === 'bad' && 'border-bad/70')}
    >
      <div className="flex items-center gap-0.5 font-mono text-[8.5px] text-faint">
        <Database size={8} /> {b.label.replace('db-', '')}
      </div>
      <div className="my-1 flex h-7 items-center">{whale ? <Whale w={b.whales[0]} spiking={live} /> : b.reps.map((r) => <Rep key={r} r={r} shape="dot" tone="idle" />)}</div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-ink/[0.07]">
        <motion.div className={cn('h-full', BAR[tone])} animate={{ width: `${Math.max(3, Math.min(100, u * 100))}%` }} />
      </div>
      {whale && <div className={cn('mt-0.5 font-mono text-[9px]', TXT[tone])}>{gated ? '?' : `${Math.round(u * 100)}% · ${fmtMs(live ? b.p99Spike : b.p99)}`}</div>}
    </motion.div>
  );
}

function MoreBox({ m }: { m: More }) {
  return (
    <motion.div layout transition={spring} className="flex w-[160px] flex-col justify-center rounded-xl border-2 border-dashed border-line p-2 font-mono text-[10.5px] text-muted">
      <div className="flex items-center gap-1 text-ink">
        <Layers size={11} className="text-faint" /> +{fmtN(m.boxes)} more {m.what}
      </div>
      <div className="text-[10px]">{fmtN(m.tenants)} tenants</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {m.reps.map((r) => (
          <Rep key={r} r={r} shape="dot" tone="idle" />
        ))}
      </div>
    </motion.div>
  );
}

export function Packing({ strategy, inputs, spike, gated }: { strategy: Strategy; inputs: Inputs; spike: boolean; gated: boolean }) {
  const boxes = visibleBoxes(strategy, inputs);
  const pd = perDot(inputs);
  return (
    <div>
      <LayoutGroup>
        <motion.div layout className="flex flex-wrap content-start items-start gap-2">
          {boxes.map((b) => (b.kind === 'more' ? <MoreBox key={b.id} m={b} /> : b.kind === 'silo' ? <SiloBox key={b.id} b={b} spike={spike} gated={gated} /> : <SharedBox key={b.id} b={b} spike={spike} gated={gated} />))}
        </motion.div>
      </LayoutGroup>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-info/70" /> {pd > 1.01 ? `1 dot ≈ ${fmtN(pd)} small tenants` : '1 dot = 1 tenant'} ({REPS(inputs)} drawn)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3.5 rounded-[3px] border border-info/70 bg-info/25" /> schema
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full bg-violet" /> whale ({inputs.whales}× {Math.round(inputs.share * 1000) / 10}% of load)
        </span>
        <span className="flex items-center gap-1">
          <Zap size={10} className="text-bad" /> spiking 5×
        </span>
      </div>
    </div>
  );
}

const LEVEL = ['', 'logical', 'namespace', 'physical'];

export function Compare({ current, inputs, spike, gated, onPick }: { current: Strategy; inputs: Inputs; spike: boolean; gated: boolean; onPick: (s: Strategy) => void }) {
  const rec = recommend(inputs);
  const rows = STRATEGIES.map((s) => ({ s, m: metrics(s.id, inputs) }));
  const cell = 'px-2 py-1.5 text-right';
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-paper">
      <table className="w-full font-mono text-[11px]">
        <thead className="bg-surface text-faint">
          <tr>
            <th className="px-2 py-1.5 text-left font-normal">strategy</th>
            <th className={cn(cell, 'font-normal')}>$/tenant·mo</th>
            <th className={cn(cell, 'font-normal')}>isolation</th>
            <th className={cn(cell, 'font-normal')}>migrations</th>
            <th className={cn(cell, 'font-normal')}>conn. pools</th>
            <th className={cn(cell, 'font-normal')}>{spike ? 'whale spike' : 'noisy risk'}</th>
            <th className={cn(cell, 'font-normal')}>restore 1</th>
            <th className={cn(cell, 'font-normal')}>analytics</th>
            <th className={cn(cell, 'font-normal')}>pg_class/server</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, m }) => (
            <tr key={s.id} onClick={() => !gated && onPick(s.id)} className={cn('cursor-pointer border-t border-line', current === s.id ? 'bg-accent/[0.08]' : 'hover:bg-surface')}>
              <td className="px-2 py-1.5 text-left text-ink">
                {s.name}
                {rec === s.id && !gated && <span className="ml-1 rounded bg-ok/15 px-1 text-[9.5px] text-ok">fits</span>}
                {m.compliance.tone === 'bad' && !gated && <span className="ml-1 rounded bg-bad/15 px-1 text-[9.5px] text-bad">non-compliant</span>}
              </td>
              <td className={cn(cell, m.costPerTenant > 50 ? 'text-bad' : m.costPerTenant > 5 ? 'text-warn' : 'text-ink')}>{gated ? '?' : fmtUSD(m.costPerTenant)}</td>
              <td className={cn(cell, m.isolation.level === 3 ? 'text-ok' : 'text-muted')}>{LEVEL[m.isolation.level]}</td>
              <td className={cn(cell, m.migrations > 1000 ? 'text-bad' : m.migrations > 100 ? 'text-warn' : 'text-ink')}>
                {fmtN(m.migrations)}× <span className="text-faint">{fmtH(m.migrationHours)}</span>
              </td>
              <td className={cn(cell, m.pools > 2000 ? 'text-bad' : 'text-ink')}>{fmtN(m.pools)}</td>
              <td className={cn(cell, TXT[m.noisy.tone])}>{gated ? '?' : m.noisy.affected ? `${fmtN(m.noisy.affected)} hit` : m.noisy.tone === 'warn' ? `${fmtMs(m.noisy.baseP99)}→${fmtMs(m.noisy.spikeP99)}` : 'contained'}</td>
              <td className={cn(cell, TXT[m.backup.tone])}>{m.backup.tone === 'ok' ? 'PITR' : m.backup.tone === 'warn' ? 'dump' : 'hard'}</td>
              <td className={cn(cell, TXT[m.analytics.tone])}>{m.analytics.tone === 'ok' ? 'SQL' : m.analytics.tone === 'warn' ? 'some ETL' : 'CDC × N'}</td>
              <td className={cn(cell, m.catalogRels > 100_000 ? 'text-bad' : 'text-ink')}>{fmtN(m.catalogRels)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
