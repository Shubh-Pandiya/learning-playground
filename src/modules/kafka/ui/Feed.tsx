import { useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, CircleAlert, Flame, Lightbulb, Server, Sparkles, Wrench } from 'lucide-react';
import { cn } from '@/shared/cn';
import type { Flag } from '../types';
import { headline } from '../engine/impact';
import type { LogEntry } from './useLab';
import { Rich } from './Rich';

const DIR = {
  better: { icon: ArrowUpRight, cls: 'text-ok' },
  worse: { icon: ArrowDownRight, cls: 'text-bad' },
  neutral: { icon: ArrowRight, cls: 'text-muted' },
};
const EV = { ok: 'text-ok', bad: 'text-bad', warn: 'text-warn', info: 'text-info' };

export function EntryCard({ e, open: initial }: { e: LogEntry; open?: boolean }) {
  const [open, setOpen] = useState(!!initial);
  const V = DIR[e.verdict];
  const nothing = !e.rows.length && !e.added.length && !e.resolved.length && !e.events.length;
  return (
    <div className={cn('rounded-xl border bg-surface p-2.5', e.verdict === 'better' ? 'border-ok/40' : e.verdict === 'worse' ? 'border-bad/40' : 'border-line')}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2 text-left">
        <V.icon size={15} className={cn('mt-0.5 shrink-0', V.cls)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('rounded px-1 text-[9px] font-bold uppercase tracking-wider', e.source === 'chaos' ? 'bg-bad/15 text-bad' : e.source === 'lesson' ? 'bg-violet/15 text-violet' : 'bg-accent/15 text-accent-ink')}>{e.source === 'you' ? 'change' : e.source}</span>
            <span className="truncate text-[12.5px] font-medium text-ink">{e.change}</span>
          </div>
          {!open && <div className="mt-0.5 truncate text-[11px] text-muted">{headline(e)}</div>}
        </div>
        <ChevronDown size={14} className={cn('mt-0.5 shrink-0 text-faint transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-6">
          {nothing && <p className="text-[11.5px] text-muted">No measurable change at the current load. Try raising traffic or injecting a failure to see where this setting matters.</p>}
          {e.rows.length > 0 && (
            <table className="w-full text-[11.5px]">
              <tbody>
                {e.rows.map((r) => {
                  const D = DIR[r.dir];
                  return (
                    <tr key={r.metric} className="align-top">
                      <td className="py-0.5 pr-2 text-muted">{r.metric}</td>
                      <td className="py-0.5 text-right font-mono">
                        <span className="text-faint line-through decoration-faint/50">{r.from}</span>
                        <span className={cn('ml-1 font-semibold', D.cls)}>→ {r.to}</span>
                        {r.why && <div className="font-sans text-[10.5px] text-faint">{r.why}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {e.events.length > 0 && (
            <div className="space-y-1">
              <div className="eyebrow flex items-center gap-1">
                <Server size={11} /> Inside the cluster
              </div>
              {e.events.map((ev, i) => (
                <p key={i} className={cn('text-[11.5px] leading-snug', EV[ev.level])}>
                  <span className="text-ink/85">{ev.text}</span>
                </p>
              ))}
            </div>
          )}
          {e.added.map((f) => (
            <FlagLine key={f.id} f={f} kind="added" />
          ))}
          {e.resolved.map((f) => (
            <FlagLine key={f.id} f={f} kind="resolved" />
          ))}
          {e.how && (
            <div className="rounded-lg bg-sunken px-2 py-1.5 text-[11.5px] leading-snug text-ink/85">
              <Lightbulb size={11} className="mr-1 inline text-accent" />
              <Rich text={e.how} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FlagLine({ f, kind }: { f: Flag; kind: 'added' | 'resolved' }) {
  return (
    <div className={cn('rounded-lg border px-2 py-1 text-[11.5px] leading-snug', kind === 'resolved' ? 'border-ok/30 bg-ok/5' : f.level === 'bad' ? 'border-bad/30 bg-bad/5' : 'border-warn/30 bg-warn/5')}>
      <div className={cn('flex items-center gap-1 font-semibold', kind === 'resolved' ? 'text-ok' : f.level === 'bad' ? 'text-bad' : 'text-warn')}>
        {kind === 'resolved' ? <CheckCircle2 size={12} /> : <CircleAlert size={12} />}
        {kind === 'resolved' ? 'Fixed: ' : 'New: '}
        {f.title}
      </div>
      {kind === 'added' && (
        <div className="text-muted">
          <Rich text={f.why} />
        </div>
      )}
    </div>
  );
}

export function ImpactFeed({ log, onClear }: { log: LogEntry[]; onClear?: () => void }) {
  if (!log.length)
    return (
      <div className="rounded-xl border border-dashed border-line p-4 text-center text-[12px] leading-snug text-muted">
        <Sparkles size={18} className="mx-auto mb-1.5 text-accent" />
        Every change you make (adding a component, flipping a config, killing a broker) shows up here: <b>what changed</b>, <b>which metrics moved and why</b>, <b>what the cluster did internally</b>, and which red flags appeared or got fixed.
      </div>
    );
  return (
    <div className="space-y-2">
      {log.map((e, i) => (
        <EntryCard key={e.id} e={e} open={i === 0} />
      ))}
      {onClear && (
        <button onClick={onClear} className="w-full text-center text-[11px] text-faint hover:text-ink">
          Clear history
        </button>
      )}
    </div>
  );
}

export function IssueList({ flags, onPick }: { flags: Flag[]; onPick?: (nodeId: string) => void }) {
  const list = [...flags].sort((a, b) => ['bad', 'warn', 'info'].indexOf(a.level) - ['bad', 'warn', 'info'].indexOf(b.level));
  if (!list.length)
    return (
      <div className="rounded-xl border border-ok/30 bg-ok/5 p-3 text-[12px] text-ok">
        <CheckCircle2 size={14} className="mr-1 inline" /> No red flags in this design at the current load and failures.
      </div>
    );
  return (
    <div className="space-y-1.5">
      {list.map((f) => (
        <button
          key={f.id}
          onClick={() => f.nodeId && onPick?.(f.nodeId)}
          className={cn('w-full rounded-lg border px-2.5 py-1.5 text-left text-[12px] leading-snug transition hover:shadow-paper', f.level === 'bad' ? 'border-bad/40 bg-bad/5' : f.level === 'warn' ? 'border-warn/40 bg-warn/5' : 'border-line bg-surface')}
        >
          <div className={cn('flex items-center gap-1 font-semibold', f.level === 'bad' ? 'text-bad' : f.level === 'warn' ? 'text-warn' : 'text-ink')}>
            {f.level === 'bad' ? <Flame size={12} /> : <CircleAlert size={12} />}
            {f.title}
          </div>
          <div className="text-muted">
            <Rich text={f.why} />
          </div>
          {f.fix && (
            <div className="mt-0.5 text-ink/85">
              <Wrench size={11} className="mr-1 inline text-ok" />
              <Rich text={f.fix} />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
