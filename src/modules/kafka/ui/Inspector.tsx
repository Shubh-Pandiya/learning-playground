import { useState } from 'react';
import { ChevronDown, Cpu, Crown, Minus, Plus, Settings2, Wrench } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Callout, Tag } from '@/shared/ui';
import { KINDS } from '../data/components';
import { fmtKnobValue, knobsFor, type Knob } from '../data/knobs';
import { cfgOf } from '../engine/defaults';
import { label, type Model } from '../engine/model';
import type { KGraph, NodeCfg } from '../types';
import type { Lab } from './useLab';
import { Glyph } from './Glyph';
import { Rich } from './Rich';

function KnobEditor({ k, value, onChange, disabled }: { k: Knob; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const opt = k.options?.find((o) => o.value === value);
  return (
    <div className="rounded-lg border border-line bg-surface p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-ink">{k.label}</div>
          <div className="truncate font-mono text-[10px] text-faint">{k.config}</div>
        </div>
        <span className="shrink-0 font-mono text-[11.5px] font-semibold text-accent-ink">{fmtKnobValue(k, value)}</span>
      </div>
      <div className="mt-2">
        {k.type === 'select' && (
          <div className="flex flex-wrap gap-1">
            {k.options!.map((o) => (
              <button
                key={String(o.value)}
                disabled={disabled}
                onClick={() => onChange(o.value)}
                className={cn('rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition', o.value === value ? 'border-accent bg-accent text-paper' : 'border-line hover:border-accent', disabled && 'opacity-50')}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {k.type === 'bool' && (
          <button
            disabled={disabled}
            onClick={() => onChange(!value)}
            className={cn('relative h-5 w-9 rounded-full transition', value ? 'bg-accent' : 'bg-ink/20', disabled && 'opacity-50')}
            aria-pressed={!!value}
          >
            <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-paper shadow transition-all', value ? 'left-[18px]' : 'left-0.5')} />
          </button>
        )}
        {k.type === 'number' && k.stops && (
          <div className="flex flex-wrap gap-1">
            {k.stops.map((s) => (
              <button
                key={s}
                disabled={disabled}
                onClick={() => onChange(s)}
                className={cn('rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition', s === value ? 'border-accent bg-accent text-paper' : 'border-line hover:border-accent', disabled && 'opacity-50')}
              >
                {fmtKnobValue(k, s)}
              </button>
            ))}
          </div>
        )}
        {k.type === 'number' && !k.stops && (
          <div className="flex items-center gap-1.5">
            <button disabled={disabled} className="rounded border border-line p-0.5 hover:border-accent" onClick={() => onChange(Math.max(k.min ?? 0, Number(value) - (k.step ?? 1)))}>
              <Minus size={12} />
            </button>
            <input
              type="range"
              disabled={disabled}
              min={k.min}
              max={k.max}
              step={k.step}
              value={Number(value)}
              onChange={(e) => onChange(Number(e.target.value))}
              className="flex-1 accent-[rgb(var(--c-accent))]"
            />
            <button disabled={disabled} className="rounded border border-line p-0.5 hover:border-accent" onClick={() => onChange(Math.min(k.max ?? 1e9, Number(value) + (k.step ?? 1)))}>
              <Plus size={12} />
            </button>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
        <Rich text={opt?.note ?? k.what} />
      </p>
      <button onClick={() => setOpen((o) => !o)} className="mt-1 flex items-center gap-1 text-[11px] font-medium text-accent-ink hover:underline">
        <ChevronDown size={12} className={cn('transition', open && 'rotate-180')} /> How it works{k.interview ? ' · interview' : ''}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 text-[11.5px] leading-snug">
          {opt && <p className="text-muted"><Rich text={k.what} /></p>}
          <p className="text-ink/90">
            <Rich text={k.how} />
          </p>
          {k.interview && (
            <p className="rounded-md bg-violet/10 px-2 py-1 text-ink/90">
              <span className="font-semibold text-violet">Interview: </span>
              <Rich text={k.interview} />
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ClusterPanel({ g, m, lab, locked }: { g: KGraph; m: Model; lab: Lab; locked?: boolean }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="eyebrow mb-1">Cluster</div>
        <p className="text-[12px] leading-snug text-muted">Click any component to configure it and see how it is built. Here: the brokers that host every partition.</p>
      </div>
      <div className="rounded-lg border border-line bg-surface p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-medium">Brokers</span>
          <div className="flex items-center gap-1">
            <button disabled={locked || g.cluster.brokers <= 1} className="rounded border border-line p-0.5 hover:border-accent disabled:opacity-40" onClick={() => lab.setCluster({ brokers: g.cluster.brokers - 1 })}>
              <Minus size={12} />
            </button>
            <span className="w-6 text-center font-mono text-[13px] font-semibold">{g.cluster.brokers}</span>
            <button disabled={locked || g.cluster.brokers >= 9} className="rounded border border-line p-0.5 hover:border-accent disabled:opacity-40" onClick={() => lab.setCluster({ brokers: g.cluster.brokers + 1 })}>
              <Plus size={12} />
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-muted">Each broker handles ~200 MB/s of produce + replication traffic. Replication factor can’t exceed the broker count.</p>
      </div>
      <div className="rounded-lg border border-line bg-surface p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-medium">Metadata</span>
          <div className="flex gap-1">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                disabled={locked}
                onClick={() => lab.setCluster({ kraft: v })}
                className={cn('rounded-md border px-1.5 py-0.5 font-mono text-[11px]', g.cluster.kraft === v ? 'border-accent bg-accent text-paper' : 'border-line hover:border-accent')}
              >
                {v ? 'KRaft' : 'ZooKeeper'}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-muted">{g.cluster.kraft ? 'A Raft quorum of controllers stores metadata as an internal log. Failover is near-instant: standbys already have it in memory.' : 'Legacy (removed in Kafka 4.0). A new controller must reload all metadata from ZooKeeper, which takes minutes with ~200k partitions.'}</p>
      </div>
      <div className="space-y-1">
        {m.brokers.map((b) => (
          <div key={b.id} className={cn('flex items-center gap-2 rounded-md border px-2 py-1', b.alive ? 'border-line' : 'border-bad/50 bg-bad/5')}>
            <Cpu size={13} className={b.alive ? 'text-muted' : 'text-bad'} />
            <span className="font-mono text-[11.5px] font-semibold">b{b.id}</span>
            {b.controller && (
              <Tag tone="violet">
                <Crown size={10} className="mr-0.5 inline" />
                controller
              </Tag>
            )}
            {!b.alive && <Tag tone="bad">down</Tag>}
            {b.slow && <Tag tone="warn">slow</Tag>}
            <span className="ml-auto font-mono text-[10.5px] text-faint">
              {b.leaders}L/{b.replicas}R · {Math.round(b.util * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Inspector({ lab, selected, locked, lockedKeys }: { lab: Lab; selected: string | null; locked?: boolean; lockedKeys?: (keyof NodeCfg)[] }) {
  const [tab, setTab] = useState<'config' | 'built'>('config');
  const [adv, setAdv] = useState(false);
  const node = lab.g.nodes.find((n) => n.id === selected);
  if (!node) return <ClusterPanel g={lab.g} m={lab.m} lab={lab} locked={locked} />;
  const def = KINDS[node.kind];
  const cfg = cfgOf(node);
  const knobs = knobsFor(node.kind);
  const shown = knobs.filter((k) => adv || !k.advanced);
  const flags = lab.m.flags.filter((f) => f.nodeId === node.id);
  const v = lab.m.view[node.id];
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5">
        <Glyph kind={node.kind} size={38} />
        <div className="min-w-0 flex-1">
          <input
            value={label(node)}
            disabled={locked}
            onChange={(e) => lab.rename(node.id, e.target.value)}
            className="w-full rounded bg-transparent font-semibold text-ink outline-none focus:bg-sunken"
          />
          <div className="font-mono text-[10.5px] text-faint">{def.tech}</div>
          {v?.line && <div className="mt-0.5 font-mono text-[11px] text-muted">{v.line}{v.sub ? ` · ${v.sub}` : ''}</div>}
        </div>
      </div>
      <p className="text-[12.5px] leading-snug text-muted">
        <Rich text={def.solves} />
      </p>
      {def.trap && (
        <Callout tone="bad">
          <div className="text-[12px]">
            <b>Why this is a trap:</b> <Rich text={def.trap.why} />
            <div className="mt-1">
              <b>Instead:</b> <Rich text={def.trap.instead} />
            </div>
          </div>
        </Callout>
      )}
      {flags.filter((f) => f.level !== 'info').length > 0 && (
        <div className="space-y-1.5">
          {flags
            .filter((f) => f.level !== 'info')
            .map((f) => (
              <div key={f.id} className={cn('rounded-lg border px-2.5 py-1.5 text-[12px] leading-snug', f.level === 'bad' ? 'border-bad/40 bg-bad/5' : 'border-warn/40 bg-warn/5')}>
                <div className={cn('font-semibold', f.level === 'bad' ? 'text-bad' : 'text-warn')}>{f.title}</div>
                <div className="text-muted">
                  <Rich text={f.why} />
                </div>
                {f.fix && (
                  <div className="mt-0.5 text-ink/90">
                    <Wrench size={11} className="mr-1 inline text-ok" />
                    <Rich text={f.fix} />
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
      {flags.some((f) => f.level === 'info') && (
        <details className="rounded-lg border border-line bg-sunken px-2.5 py-1.5 text-[11.5px] leading-snug">
          <summary className="cursor-pointer font-medium text-muted">{flags.filter((f) => f.level === 'info').length} production-readiness tip(s)</summary>
          {flags
            .filter((f) => f.level === 'info')
            .map((f) => (
              <div key={f.id} className="mt-1.5">
                <div className="font-semibold text-ink">{f.title}</div>
                <div className="text-muted">
                  <Rich text={f.why} />
                </div>
                {f.fix && (
                  <div className="text-ink/90">
                    <Wrench size={11} className="mr-1 inline text-ok" />
                    <Rich text={f.fix} />
                  </div>
                )}
              </div>
            ))}
        </details>
      )}
      <div className="flex gap-1 rounded-lg bg-sunken p-0.5">
        {(
          [
            ['config', 'Configure', Settings2],
            ['built', 'How it’s built', Cpu],
          ] as const
        ).map(([id, txt, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={cn('flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-[12px] font-medium', tab === id ? 'bg-surface text-ink shadow-paper' : 'text-muted')}>
            <Icon size={12} /> {txt}
          </button>
        ))}
      </div>
      {tab === 'config' ? (
        <div className="space-y-2">
          {!knobs.length && <p className="text-[12px] text-muted">Nothing to tune here: this component matters for what it connects to.</p>}
          {shown.map((k) => (
            <KnobEditor key={k.key} k={k} value={cfg[k.key]} disabled={locked || lockedKeys?.includes(k.key)} onChange={(val) => lab.setCfg(node.id, { [k.key]: val } as Partial<NodeCfg>)} />
          ))}
          {knobs.some((k) => k.advanced) && (
            <button onClick={() => setAdv((a) => !a)} className="w-full rounded-md border border-dashed border-line py-1 text-[11.5px] text-muted hover:border-accent hover:text-ink">
              {adv ? 'Hide advanced settings' : `Show ${knobs.filter((k) => k.advanced).length} advanced settings`}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-[12px] leading-snug">
          <div>
            <div className="eyebrow mb-1">Internals</div>
            <ul className="space-y-1.5">
              {def.internals.map((s, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>
                    <Rich text={s} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="eyebrow mb-1">Trade-offs</div>
            <ul className="space-y-1">
              {def.tradeoffs.map((s, i) => (
                <li key={i} className="text-muted">
                  · <Rich text={s} />
                </li>
              ))}
            </ul>
          </div>
          <Callout tone="warn">
            <div className="text-[12px]">
              <b>Classic pitfall:</b> <Rich text={def.pitfall} />
            </div>
          </Callout>
          <p className="text-[11.5px] text-faint">Used by: {def.usedBy}</p>
        </div>
      )}
    </div>
  );
}
