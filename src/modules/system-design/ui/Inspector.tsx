import { useState } from 'react';
import { Building2, Cpu, Minus, Plus, RotateCcw, Skull, Trash2, Zap } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, SidePanel, Tag } from '@/shared/ui';
import { COMPONENTS } from '../data/components';
import { getInternals } from '../internals';
import { InternalsView } from '../internals/InternalsView';
import type { NodeFeedback } from '../engine/evaluate';
import { OUTCOMES, predictKill, type Metrics, type NodeSim, type Outcome } from '../engine/simulate';
import type { GNode, Graph, Workload } from '../types';
import { fmtMs, fmtNum, fmtPct } from './format';
import { IsoGlyph } from './iso';

export interface FeedbackItem {
  key: string;
  tone: 'ok' | 'warn' | 'bad' | 'info';
  title: string;
  body: string;
  tradeoffs?: string[];
  instead?: string;
  usedBy?: string;
}

export const feedbackFromNode = (key: string, fb: NodeFeedback, usedBy?: string): FeedbackItem => ({
  key,
  tone: fb.verdict === 'good' ? 'ok' : fb.verdict === 'wrong' ? 'bad' : 'warn',
  title: fb.title,
  body: fb.body,
  tradeoffs: fb.tradeoffs,
  instead: fb.instead,
  usedBy,
});

export function FeedbackCard({ f, compact }: { f: FeedbackItem; compact?: boolean }) {
  return (
    <Callout tone={f.tone} title={<span className="text-[13px]">{f.title}</span>}>
      <p className="text-[12.5px] leading-relaxed">{f.body}</p>
      {f.instead && (
        <p className="mt-1.5 text-[12.5px]">
          <span className="font-semibold text-ok">Use instead: </span>
          {f.instead}
        </p>
      )}
      {!compact && f.tradeoffs && f.tradeoffs.length > 0 && (
        <div className="mt-2">
          <div className="eyebrow !text-[9.5px]">{f.tone === 'bad' ? 'Why it hurts' : 'Tradeoffs'}</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] leading-snug text-muted">
            {f.tradeoffs.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {!compact && f.usedBy && (
        <p className="mt-2 flex gap-1.5 text-[11.5px] text-muted">
          <Building2 size={13} className="mt-px shrink-0" />
          <span>{f.usedBy}</span>
        </p>
      )}
    </Callout>
  );
}

function explainKill(name: string, before: Metrics, after: Metrics, wasSpof: boolean): string {
  const lines: string[] = [];
  if (after.readOk < 0.1 && after.writeOk < 0.1) lines.push(`${name} was on every request's path with no standby, so everything fails.`);
  else if (after.readOk >= 0.9 && after.writeOk < 0.5) lines.push(`Reads have another source, but writes only had ${name}.`);
  else if (after.errorRate > before.errorRate + 0.01)
    lines.push(
      wasSpof
        ? `${name} was a single point of failure for part of the traffic.`
        : `The survivors can't absorb ${name}'s share (or callers keep timing out on the dead instance), so ${fmtPct(after.errorRate - before.errorRate)} more requests fail.`,
    );
  else if (after.p99 > before.p99 * 1.5 + 5) lines.push(`Nothing fails, but requests now take a slower path (${fmtMs(before.p99)} → ${fmtMs(after.p99)}).`);
  else lines.push(`Redundancy absorbed it: health checks route around the dead instance and the rest have headroom.`);
  if (after.durability.level < before.durability.level) lines.push('Durability dropped too: fewer copies of the data now exist.');
  return lines.join(' ');
}

export interface InspectorProps {
  node: GNode;
  sim?: NodeSim;
  graph: Graph;
  wl: Workload;
  feedback?: NodeFeedback;
  edgeNotes?: string[];
  editable: boolean;
  onCount?: (delta: number) => void;
  onKill: () => void;
  onRestore: () => void;
  onDelete?: () => void;
  onPredicted?: (right: boolean) => void;
}

export function Inspector(p: InspectorProps) {
  const def = COMPONENTS[p.node.kind];
  const [predicting, setPredicting] = useState(false);
  const [inside, setInside] = useState(false);
  const hasInternals = !!getInternals(p.node.kind);
  const [result, setResult] = useState<{ guess: Outcome; actual: Outcome; text: string } | null>(null);
  const alive = p.node.count - (p.node.down ?? 0);
  const sim = p.sim;
  const canKill = alive > 0 && p.node.kind !== 'client';

  const choose = (guess: Outcome) => {
    const r = predictKill(p.graph, p.wl, p.node.id);
    const wasSpof = r.before.spofs.includes(p.node.id);
    setResult({ guess, actual: r.outcome, text: explainKill(p.node.label ?? def.name, r.before, r.after, wasSpof) });
    setPredicting(false);
    p.onPredicted?.(guess === r.outcome);
    p.onKill();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <IsoGlyph kind={p.node.kind} size={52} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold">{p.node.label ?? def.name}</div>
          <div className="font-mono text-[11px] text-faint">{def.tech}</div>
          {sim && p.node.kind !== 'client' && (
            <div className="mt-1 flex flex-wrap gap-1">
              <Tag size="sm" tone={sim.status === 'overloaded' ? 'bad' : sim.status === 'hot' || sim.status === 'degraded' ? 'warn' : sim.status === 'dead' ? 'neutral' : 'ok'} dot>
                {sim.status}
              </Tag>
              {!def.flow.control && <Tag size="sm">{fmtPct(Math.min(sim.util, 9.99))} load</Tag>}
              {sim.r + sim.w > 0 && (
                <Tag size="sm" tone="info">
                  {fmtNum(sim.r)} r · {fmtNum(sim.w)} w /s
                </Tag>
              )}
              {sim.aw > 0 && (
                <Tag size="sm" tone="violet">
                  {fmtNum(sim.aw)} msg/s
                </Tag>
              )}
            </div>
          )}
        </div>
      </div>
      {hasInternals && (
        <button
          onClick={() => setInside(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-violet/40 bg-violet/[0.06] px-2.5 py-2 text-left transition hover:bg-violet/[0.12]"
        >
          <Cpu size={16} className="shrink-0 text-violet" />
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[12px] font-semibold">Look inside: how it’s built</span>
            <span className="block text-[11px] text-muted">Anatomy · assemble it · design knobs · interactive lab</span>
          </span>
        </button>
      )}
      <SidePanel open={inside} onClose={() => setInside(false)} eyebrow="Component internals" title={def.name} widthClassName="w-[min(760px,94vw)]" overlay>
        {inside && <InternalsView kind={p.node.kind} />}
      </SidePanel>
      {sim?.note && <p className="rounded-md bg-warn/10 px-2 py-1.5 text-[12px] leading-snug text-warn">{sim.note}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        {p.editable && p.onCount && p.node.kind !== 'client' && (
          <div className="flex items-center rounded-md border border-line">
            <Button size="xs" variant="ghost" iconOnly aria-label="Fewer instances" icon={<Minus size={13} />} onClick={() => p.onCount!(-1)} disabled={p.node.count <= 1} />
            <span className="w-14 text-center font-mono text-[11px]">×{p.node.count}</span>
            <Button size="xs" variant="ghost" iconOnly aria-label="More instances" icon={<Plus size={13} />} onClick={() => p.onCount!(1)} disabled={p.node.count >= 20} />
          </div>
        )}
        {canKill && !predicting && (
          <Button size="xs" variant="danger" icon={<Zap size={13} />} onClick={() => { setResult(null); setPredicting(true); }}>
            Kill one instance
          </Button>
        )}
        {(p.node.down ?? 0) > 0 && (
          <Button size="xs" variant="success" icon={<RotateCcw size={13} />} onClick={() => { setResult(null); p.onRestore(); }}>
            Restore
          </Button>
        )}
        {p.editable && p.onDelete && (
          <Button size="xs" variant="ghost" icon={<Trash2 size={13} />} onClick={p.onDelete}>
            Remove
          </Button>
        )}
      </div>

      {predicting && (
        <div className="rounded-lg border border-accent/40 bg-accent/[0.06] p-2.5">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
            <Skull size={14} className="text-bad" /> Predict first: what happens if one {def.name} instance dies?
          </div>
          <div className="mt-2 grid gap-1">
            {OUTCOMES.map((o) => (
              <button key={o} className="rounded-md border border-line bg-surface px-2 py-1 text-left text-[12px] hover:border-accent hover:bg-accent/5" onClick={() => choose(o)}>
                {o}
              </button>
            ))}
          </div>
          <button className="mt-1.5 text-[11px] text-faint underline" onClick={() => setPredicting(false)}>
            cancel
          </button>
        </div>
      )}
      {result && (
        <Callout tone={result.guess === result.actual ? 'ok' : 'warn'} title={result.guess === result.actual ? `Correct: ${result.actual}` : `Actually: ${result.actual} (you said “${result.guess}”)`}>
          <p className="text-[12.5px] leading-relaxed">{result.text}</p>
        </Callout>
      )}

      {p.feedback && (
        <FeedbackCard
          f={{ ...feedbackFromNode('insp', p.feedback, def.usedBy), title: p.feedback.verdict === 'good' ? 'Why it is here' : p.feedback.title }}
        />
      )}
      {!p.feedback && (
        <div className="space-y-2 text-[12.5px] leading-relaxed text-muted">
          <p>
            <span className="font-semibold text-ink">Solves: </span>
            {def.solves}
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {def.tradeoffs.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          <p className="flex gap-1.5 text-[11.5px]">
            <Building2 size={13} className="mt-px shrink-0" />
            {def.usedBy}
          </p>
        </div>
      )}
      <p className={cn('text-[12px] leading-snug text-muted')}>
        <span className="font-semibold text-warn">Pitfall: </span>
        {def.pitfall}
      </p>
      {p.edgeNotes && p.edgeNotes.length > 0 && (
        <div className="space-y-1">
          {p.edgeNotes.map((n, i) => (
            <p key={i} className="rounded-md bg-bad/10 px-2 py-1 text-[12px] leading-snug text-bad">
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
