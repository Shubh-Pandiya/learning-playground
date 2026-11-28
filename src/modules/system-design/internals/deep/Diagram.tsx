import { Fragment, useEffect, useState } from 'react';
import { ChevronRight, Pause, Play } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Rich } from '../../ui/Rich';
import type { Diagram as D, DiagramTone } from '../types';

export const TONE_BOX: Record<DiagramTone, string> = {
  neutral: 'border-line bg-surface',
  accent: 'border-accent/50 bg-accent/[0.08]',
  ok: 'border-ok/50 bg-ok/[0.08]',
  warn: 'border-warn/50 bg-warn/[0.08]',
  bad: 'border-bad/50 bg-bad/[0.08]',
  info: 'border-info/50 bg-info/[0.08]',
  violet: 'border-violet/50 bg-violet/[0.08]',
};
const TONE_TEXT: Record<DiagramTone, string> = {
  neutral: 'text-muted',
  accent: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
  violet: 'text-violet',
};
const TONE_LINE: Record<DiagramTone, string> = {
  neutral: 'rgb(var(--c-faint))',
  accent: 'rgb(var(--c-accent))',
  ok: 'rgb(var(--c-ok))',
  warn: 'rgb(var(--c-warn))',
  bad: 'rgb(var(--c-bad))',
  info: 'rgb(var(--c-info))',
  violet: 'rgb(var(--c-violet))',
};

/** Steps an index through 0..n-1 while playing — the "packet" that walks the diagram. */
function useWalk(n: number, ms = 1100) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing || n < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => clearInterval(t);
  }, [playing, n, ms]);
  return { i, setI, playing, setPlaying };
}

function PlayToggle({ playing, onToggle }: { playing: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint hover:text-ink" title={playing ? 'pause' : 'play'}>
      {playing ? <Pause size={10} /> : <Play size={10} />}
      {playing ? 'pause' : 'play'}
    </button>
  );
}

function Flow({ d }: { d: Extract<D, { type: 'flow' }> }) {
  const w = useWalk(d.nodes.length);
  return (
    <>
      <div className="flex flex-wrap items-stretch gap-y-2">
        {d.nodes.map((n, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <div className="flex items-center px-0.5">
                <ChevronRight size={14} className={cn('transition-colors', i === w.i ? 'text-accent' : 'text-faint')} />
              </div>
            )}
            <button
              onClick={() => {
                w.setI(i);
                w.setPlaying(false);
              }}
              className={cn(
                'min-w-[84px] max-w-[160px] flex-1 rounded-md border px-2 py-1.5 text-left transition-all duration-300',
                TONE_BOX[n.tone ?? 'neutral'],
                i === w.i ? 'shadow-lift ring-2 ring-accent/60' : 'opacity-90',
              )}
            >
              <div className="font-mono text-[11px] font-semibold leading-tight text-ink">{n.label}</div>
              {n.sub && <div className="mt-0.5 text-[10.5px] leading-tight text-muted">{n.sub}</div>}
            </button>
          </Fragment>
        ))}
      </div>
      <div className="mt-1.5 flex justify-end">
        <PlayToggle playing={w.playing} onToggle={() => w.setPlaying((p) => !p)} />
      </div>
    </>
  );
}

function Sequence({ d }: { d: Extract<D, { type: 'sequence' }> }) {
  const w = useWalk(d.messages.length, 1300);
  const n = d.actors.length;
  const x = (a: string) => ((d.actors.indexOf(a) + 0.5) / n) * 100;
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}>
        {d.actors.map((a) => (
          <div key={a} className="mx-0.5 truncate rounded-md border border-line bg-surface px-1 py-1 text-center font-mono text-[10.5px] font-semibold" title={a}>
            {a}
          </div>
        ))}
      </div>
      <div className="relative">
        {d.actors.map((a) => (
          <div key={a} className="absolute bottom-0 top-0 w-px border-l border-dashed border-line" style={{ left: `${x(a)}%` }} />
        ))}
        {d.messages.map((m, i) => {
          const a = x(m.from);
          const b = x(m.to);
          const self = a === b;
          const left = Math.min(a, b);
          const width = Math.max(Math.abs(b - a), 0.001);
          const active = i === w.i;
          const color = active ? TONE_LINE.accent : TONE_LINE[m.tone ?? 'neutral'];
          return (
            <button
              key={i}
              className={cn('relative block h-[30px] w-full text-left transition-opacity', active ? 'opacity-100' : i < w.i ? 'opacity-80' : 'opacity-55')}
              onClick={() => {
                w.setI(i);
                w.setPlaying(false);
              }}
            >
              {self ? (
                <div className="absolute top-[13px] h-[10px] w-[22px] rounded-r border border-l-0" style={{ left: `${a}%`, borderColor: color, borderStyle: m.dashed ? 'dashed' : 'solid' }} />
              ) : (
                <div className="absolute top-[18px]" style={{ left: `${left}%`, width: `${width}%` }}>
                  <div className="h-0 border-t-[1.5px]" style={{ borderColor: color, borderStyle: m.dashed ? 'dashed' : 'solid' }} />
                  <div
                    className="absolute -top-[4.5px] h-0 w-0 border-y-[4px] border-y-transparent"
                    style={b > a ? { right: -1, borderLeft: `6px solid ${color}` } : { left: -1, borderRight: `6px solid ${color}` }}
                  />
                  {active && <span className="absolute -top-[3.5px] h-[6px] w-[6px] animate-[sdpkt_1.2s_linear_infinite] rounded-full bg-accent" style={{ animationDirection: b > a ? 'normal' : 'reverse' }} />}
                </div>
              )}
              <div
                className={cn('absolute top-0 truncate px-1 text-center font-mono text-[10px] leading-[16px]', active ? 'font-semibold text-ink' : 'text-muted')}
                style={self ? { left: `calc(${a}% + 24px)`, maxWidth: '40%' } : { left: `${left}%`, width: `${width}%` }}
                title={m.label}
              >
                <span className="font-semibold text-faint">{i + 1}.</span> {m.label}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10.5px] text-ink">
          {w.i + 1}/{d.messages.length} · {d.messages[w.i]?.from} → {d.messages[w.i]?.to}: {d.messages[w.i]?.label}
        </span>
        <PlayToggle playing={w.playing} onToggle={() => w.setPlaying((p) => !p)} />
      </div>
      <style>{`@keyframes sdpkt{0%{left:0%}100%{left:100%}}`}</style>
    </div>
  );
}

function Layers({ d }: { d: Extract<D, { type: 'layers' }> }) {
  return (
    <div className="space-y-1.5">
      {d.layers.map((l, i) => (
        <div key={i} className={cn('flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5', TONE_BOX[l.tone ?? 'neutral'])}>
          <span className={cn('w-[120px] shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-wider', TONE_TEXT[l.tone ?? 'neutral'])}>{l.name}</span>
          {l.items.map((it) => (
            <span key={it} className="rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[10.5px] text-ink/90">
              {it}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Compare({ d }: { d: Extract<D, { type: 'compare' }> }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${d.columns.length}, minmax(0,1fr))` }}>
      {d.columns.map((c) => (
        <div key={c.name} className={cn('rounded-md border p-2', TONE_BOX[c.tone ?? 'neutral'])}>
          <div className={cn('mb-1 font-mono text-[11.5px] font-semibold', TONE_TEXT[c.tone ?? 'neutral'])}>{c.name}</div>
          <ul className="space-y-1">
            {c.points.map((p, i) => (
              <li key={i} className="flex gap-1.5 text-[11.5px] leading-snug text-ink/90">
                <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-faint" />
                <span>
                  <Rich text={p} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Visual-first diagram for deep content: animated flow, sequence, layers or side-by-side compare. */
export function Diagram({ d, className }: { d: D; className?: string }) {
  return (
    <figure className={cn('rounded-lg border border-line bg-sunken/60 p-2.5', className)}>
      {d.title && <div className="eyebrow mb-1.5">{d.title}</div>}
      <div className="overflow-x-auto">
        <div className={cn(d.type === 'sequence' && 'min-w-[480px]')}>
          {d.type === 'flow' && <Flow d={d} />}
          {d.type === 'sequence' && <Sequence d={d} />}
          {d.type === 'layers' && <Layers d={d} />}
          {d.type === 'compare' && <Compare d={d} />}
        </div>
      </div>
      {d.caption && (
        <figcaption className="mt-1.5 text-[11.5px] leading-snug text-muted">
          <Rich text={d.caption} />
        </figcaption>
      )}
    </figure>
  );
}
