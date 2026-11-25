import { useState } from 'react';
import { Clock, Copy, FileWarning, Files, Flame, Skull, Sparkles, Unplug, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout } from '@/shared/ui';
import { CHAOS, OUTCOMES, chaosDef, outcomeLabel, runChaos, type ChaosResult } from '../engine/chaos';
import type { ChaosId, Graph, OutcomeKey, Workload } from '../types';
import { Rich } from './Rich';

export const CHAOS_ICON: Record<string, LucideIcon> = { Clock, FileWarning, Flame, Skull, Copy, Unplug, Files };

const OUTCOME_TONE: Record<OutcomeKey, 'ok' | 'info' | 'warn' | 'bad'> = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.tone])) as Record<OutcomeKey, 'ok' | 'info' | 'warn' | 'bad'>;

/** Predict-first outcome buttons. */
export function OutcomePicker({ onPick }: { onPick: (k: OutcomeKey) => void }) {
  return (
    <div className="grid gap-1">
      {OUTCOMES.map((o) => (
        <button key={o.key} className="rounded-md border border-line bg-surface px-2 py-1 text-left text-[12px] hover:border-accent hover:bg-accent/5" onClick={() => onPick(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The verdict of a chaos run: outcome, reasons, and whether the learner predicted it. */
export function ChaosResultCard({ id, r, guess }: { id: ChaosId; r: ChaosResult; guess?: OutcomeKey }) {
  const def = chaosDef(id);
  const right = guess === undefined || guess === r.outcome;
  const title = guess === undefined ? `${def.name}: ${outcomeLabel(r.outcome)}` : right ? `Correct: ${outcomeLabel(r.outcome)}` : `Actually: ${outcomeLabel(r.outcome)} (you said “${outcomeLabel(guess)}”)`;
  return (
    <Callout tone={guess === undefined ? OUTCOME_TONE[r.outcome] : right ? 'ok' : 'warn'} title={<span className="text-[13px]">{title}</span>}>
      <ul className="space-y-1 text-[12.5px] leading-relaxed">
        {r.why.slice(0, 4).map((w, i) => (
          <li key={i}>
            <Rich text={w} />
          </li>
        ))}
      </ul>
    </Callout>
  );
}

export interface ChaosBarProps {
  graph: Graph;
  wl: Workload;
  /** Called after the learner predicted and the chaos ran. */
  onResult?: (id: ChaosId, r: ChaosResult, right: boolean) => void;
  /** Nodes to highlight on the canvas (where the effect shows up). */
  onHighlight?: (ids: string[]) => void;
}

/** "Chaos" menu floating over the canvas: pick a data incident, predict its outcome, then see what your design does. */
export function ChaosBar({ graph, wl, onResult, onHighlight }: ChaosBarProps) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<ChaosId | null>(null);
  const [res, setRes] = useState<{ id: ChaosId; r: ChaosResult; guess: OutcomeKey } | null>(null);
  const close = () => {
    setOpen(false);
    setPick(null);
    setRes(null);
    onHighlight?.([]);
  };
  const predict = (guess: OutcomeKey) => {
    if (!pick) return;
    const r = runChaos(graph, wl, pick);
    setRes({ id: pick, r, guess });
    onHighlight?.(r.hot);
    onResult?.(pick, r, guess === r.outcome);
  };
  return (
    <div className="pointer-events-auto relative">
      <Button size="xs" variant={open ? 'primary' : 'secondary'} icon={<Sparkles size={13} />} onClick={() => (open ? close() : setOpen(true))}>
        Chaos
      </Button>
      {open && (
        <div className="absolute bottom-9 left-0 z-20 w-[340px] rounded-xl border border-line bg-surface p-3 shadow-paper">
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Data chaos · predict first</span>
            <button aria-label="Close chaos" onClick={close} className="text-faint hover:text-ink">
              <X size={14} />
            </button>
          </div>
          {!pick && (
            <div className="grid grid-cols-1 gap-1">
              {CHAOS.map((c) => {
                const Icon = CHAOS_ICON[c.icon] ?? Sparkles;
                return (
                  <button
                    key={c.id}
                    onClick={() => setPick(c.id)}
                    className="flex items-start gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:border-accent hover:bg-accent/5"
                  >
                    <Icon size={14} className="mt-0.5 shrink-0 text-bad" />
                    <span>
                      <span className="block font-mono text-[12px] font-semibold">{c.name}</span>
                      <span className="block text-[11px] leading-snug text-muted">
                        <Rich text={c.blurb} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {pick && (
            <div className="space-y-2">
              <p className="text-[12px] leading-snug text-muted">
                <Rich text={chaosDef(pick).blurb} />
              </p>
              {!res && (
                <>
                  <p className="text-[12.5px] font-semibold">{chaosDef(pick).question}</p>
                  <OutcomePicker onPick={predict} />
                </>
              )}
              {res && <ChaosResultCard id={res.id} r={res.r} guess={res.guess} />}
              <div className="flex gap-2">
                <button
                  className={cn('text-[11px] text-faint underline')}
                  onClick={() => {
                    setPick(null);
                    setRes(null);
                    onHighlight?.([]);
                  }}
                >
                  ← another event
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
