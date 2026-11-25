import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bomb, CheckCircle2, Gauge, HeartPulse, Snail, Skull, Turtle, X, XCircle, Zap } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { NO_CHAOS } from '../types';
import { CHAOS, preview, type ChaosAction } from './chaos';
import { Rich } from './Rich';
import type { Lab } from './useLab';

const ICON = { kill: Skull, slow: Turtle, slowgroup: Snail, poison: Bomb, hot: Zap, spike: Gauge } as const;

interface Pending {
  a: ChaosAction;
  answer: number;
  pick: number | null;
}

export function ChaosBar({ lab, onPredict, only, className }: { lab: Lab; onPredict?: (right: boolean) => void; only?: string[]; className?: string }) {
  const [p, setP] = useState<Pending | null>(null);
  const c = lab.chaos;
  const active = c.brokersDown.length > 0 || c.slowBroker || c.slowGroup || c.poison || c.hotKey || c.traffic !== 1;
  const actions = CHAOS.filter((a) => !only || only.includes(a.id));
  const disabled = (a: ChaosAction) =>
    !lab.m.metrics.connected ||
    (a.id === 'kill' && c.brokersDown.length >= lab.g.cluster.brokers - 1) ||
    (a.id === 'slow' && !!c.slowBroker) ||
    (a.id === 'slowgroup' && (!!c.slowGroup || !lab.g.nodes.some((n) => n.kind === 'group' || n.kind === 'streams'))) ||
    (a.id === 'poison' && c.poison) ||
    (a.id === 'hot' && c.hotKey) ||
    (a.id === 'spike' && c.traffic >= 9);

  const start = (a: ChaosAction) => setP({ a, answer: preview(a, lab.g, c, lab.m).answer, pick: null });
  const choose = (i: number) => {
    if (!p || p.pick !== null) return;
    const { next } = preview(p.a, lab.g, c, lab.m);
    lab.setChaos(next, `Chaos: ${p.a.label.toLowerCase()}`, p.a.why.join(' '));
    onPredict?.(i === p.answer);
    setP({ ...p, pick: i });
  };
  const skip = () => {
    if (!p) return;
    const { next } = preview(p.a, lab.g, c, lab.m);
    lab.setChaos(next, `Chaos: ${p.a.label.toLowerCase()}`, p.a.why.join(' '));
    setP({ ...p, pick: -1 });
  };

  return (
    <div className={cn('relative', className)}>
      <AnimatePresence>
        {p && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-lift"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="eyebrow text-bad">{p.pick === null ? 'Predict first' : 'What actually happened'}</div>
                <p className="mt-0.5 text-[13px] font-medium leading-snug">{p.a.question}</p>
                <p className="text-[11px] text-faint">Real-world cause: {p.a.cause}</p>
              </div>
              <button onClick={() => setP(null)} className="text-faint hover:text-ink">
                <X size={15} />
              </button>
            </div>
            <div className="mt-2 grid gap-1.5">
              {p.a.options.map((o, i) => (
                <button
                  key={i}
                  disabled={p.pick !== null}
                  onClick={() => choose(i)}
                  className={cn(
                    'flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] leading-snug',
                    p.pick === null && 'border-line hover:border-accent hover:bg-accent/5',
                    p.pick !== null && i === p.answer && 'border-ok/50 bg-ok/10',
                    p.pick === i && i !== p.answer && 'border-bad/50 bg-bad/10',
                    p.pick !== null && i !== p.answer && p.pick !== i && 'border-line opacity-55',
                  )}
                >
                  <span className="font-mono text-[11px] text-faint">{String.fromCharCode(65 + i)}</span>
                  <span className="flex-1">{o}</span>
                  {p.pick !== null && i === p.answer && <CheckCircle2 size={14} className="shrink-0 text-ok" />}
                  {p.pick === i && i !== p.answer && <XCircle size={14} className="shrink-0 text-bad" />}
                </button>
              ))}
            </div>
            {p.pick === null ? (
              <button onClick={skip} className="mt-2 text-[11px] text-faint hover:text-ink">
                Skip prediction and just break it →
              </button>
            ) : (
              <div className="mt-2.5 space-y-1.5 border-t border-line pt-2 text-[12px] leading-snug">
                {p.pick >= 0 && <p className={cn('font-semibold', p.pick === p.answer ? 'text-ok' : 'text-bad')}>{p.pick === p.answer ? 'You called it.' : 'Not this time. In this design:'}</p>}
                <p className="text-ink">
                  Outcome in <i>your</i> design: <b>{p.a.options[p.answer]}</b>. Watch the canvas and the impact feed.
                </p>
                {p.a.why.map((w, i) => (
                  <p key={i} className="text-muted">
                    · <Rich text={w} />
                  </p>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface/95 px-2 py-1.5 shadow-paper backdrop-blur">
        <span className="eyebrow mr-1 text-bad">Chaos</span>
        {actions.map((a) => {
          const Icon = ICON[a.id as keyof typeof ICON] ?? Zap;
          return (
            <button
              key={a.id}
              disabled={disabled(a)}
              onClick={() => start(a)}
              title={a.cause}
              className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11.5px] font-medium transition hover:border-bad hover:text-bad disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon size={12} /> {a.label}
            </button>
          );
        })}
        {active && (
          <Button
            size="xs"
            variant="success"
            icon={<HeartPulse size={12} />}
            onClick={() => {
              setP(null);
              lab.setChaos(NO_CHAOS, 'Healed: all brokers back, traffic normal, poison skipped', 'Recovered brokers fetch from the leaders until they catch up to the LEO, then rejoin the ISR. Preferred-leader election later moves leadership back to them.');
            }}
          >
            Heal all
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {c.traffic !== 1 && <span className="rounded bg-warn/15 px-1 font-mono text-[10.5px] text-warn">traffic ×{c.traffic}</span>}
          {c.brokersDown.map((b) => (
            <span key={b} className="rounded bg-bad/15 px-1 font-mono text-[10.5px] text-bad">
              b{b} down
            </span>
          ))}
          {c.slowBroker && <span className="rounded bg-warn/15 px-1 font-mono text-[10.5px] text-warn">b{c.slowBroker} slow</span>}
          {c.slowGroup && <span className="rounded bg-warn/15 px-1 font-mono text-[10.5px] text-warn">slow consumer</span>}
          {c.poison && <span className="rounded bg-bad/15 px-1 font-mono text-[10.5px] text-bad">poison</span>}
          {c.hotKey && <span className="rounded bg-warn/15 px-1 font-mono text-[10.5px] text-warn">hot key</span>}
        </div>
      </div>
    </div>
  );
}
