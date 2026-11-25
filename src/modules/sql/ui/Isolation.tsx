import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { Callout, StepControls, Tag, useStepper } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { IsolationScenarioId } from '../types';
import { finalCommitted, LEVELS, SCENARIOS, seenBy, simulate, type Level, type TxName } from '../engine/isolation';
import { Md } from './common';

const ALL: IsolationScenarioId[] = ['dirty-read', 'non-repeatable-read', 'phantom', 'lost-update', 'lost-update-fixed', 'write-skew', 'deadlock'];

const statusTone = (s: string) => (s === 'committed' ? 'ok' : s === 'aborted' ? 'bad' : s === 'waiting' ? 'warn' : s === 'active' ? 'info' : 'neutral');

export function IsolationSim({ scenarios = ALL }: { scenarios?: IsolationScenarioId[] }) {
  const [scId, setScId] = useState<IsolationScenarioId>(scenarios[0]);
  const sc = SCENARIOS[scId];
  const [level, setLevel] = useState<Level>(sc.defaultLevel);
  const frames = useMemo(() => simulate(sc, level), [sc, level]);
  const stepper = useStepper(frames.length, { intervalMs: 1600 });
  const f = frames[Math.min(stepper.step, frames.length - 1)];
  const curStep = stepper.step - 1; // frame 0 = before any step
  const atEnd = stepper.step === frames.length - 1;
  const verdict = useMemo(() => {
    const last = frames[frames.length - 1];
    return sc.verdict(level, last.named, finalCommitted(last));
  }, [frames, sc, level]);
  // what the same scenario does at every level (shown at the end to build the comparison)
  const matrix = useMemo(
    () =>
      LEVELS.map((l) => {
        const fr = simulate(sc, l.id);
        const last = fr[fr.length - 1];
        return { l, v: sc.verdict(l.id, last.named, finalCommitted(last)) };
      }),
    [sc],
  );

  const pick = (id: IsolationScenarioId) => {
    setScId(id);
    setLevel(SCENARIOS[id].defaultLevel);
    stepper.goTo(0);
  };

  return (
    <div className="space-y-4">
      {scenarios.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {scenarios.map((id) => (
            <button key={id} onClick={() => pick(id)} className={cn('rounded-full border px-3 py-1 text-[12px] transition', id === scId ? 'border-ink bg-ink text-paper' : 'border-line text-muted hover:bg-surface')}>
              {SCENARIOS[id].title}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Isolation level:</span>
        {LEVELS.map((l) => (
          <button
            key={l.id}
            onClick={() => setLevel(l.id)}
            title={l.label}
            className={cn('rounded-md border px-2.5 py-1 font-mono text-[11px] transition', level === l.id ? 'border-accent bg-accent text-paper' : 'border-line text-muted hover:bg-surface')}
          >
            {l.label}
          </button>
        ))}
        <span className="text-[11px] text-faint">Switch level at any step — the timeline re-runs and you see exactly which step diverges.</span>
      </div>
      <p className="text-sm text-muted">
        <b className="text-ink">{sc.title}.</b> {sc.story}
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* timeline */}
        <div className="min-w-0 overflow-hidden rounded-lg border border-line">
          <div className="grid grid-cols-[28px_1fr_1fr] border-b border-line bg-sunken text-[12px] font-medium">
            <div />
            {(['T1', 'T2'] as TxName[]).map((t) => (
              <div key={t} className="flex items-center gap-2 border-l border-line px-3 py-1.5">
                {t} <span className="font-mono text-[10px] text-faint">xid {f.tx[t].xid}</span>
                <Tag tone={statusTone(f.tx[t].status)} className="ml-auto">
                  {f.tx[t].status}
                  {f.tx[t].waitingFor ? ` on ${f.tx[t].waitingFor}` : ''}
                </Tag>
              </div>
            ))}
          </div>
          {sc.steps.map((s, i) => {
            const out = f.outputs[i];
            const done = i <= curStep;
            return (
              <button key={i} onClick={() => stepper.goTo(i + 1)} className={cn('grid w-full grid-cols-[28px_1fr_1fr] border-b border-line/60 text-left transition', i === curStep ? 'bg-accent/[0.07]' : done ? 'bg-surface' : 'bg-surface/40 opacity-50 hover:opacity-80')}>
                <div className="py-2 text-center font-mono text-[10px] text-faint">{i + 1}</div>
                {(['T1', 'T2'] as TxName[]).map((t) => (
                  <div key={t} className="min-w-0 border-l border-line/60 px-3 py-1.5">
                    {s.tx === t && (
                      <>
                        <div className="whitespace-pre-wrap break-words font-mono text-[11.5px] text-ink">{s.op.k === 'begin' ? 'BEGIN;' : s.op.k === 'commit' ? 'COMMIT;' : s.op.k === 'rollback' ? 'ROLLBACK;' : s.op.sql}</div>
                        {done && out && (
                          <motion.div
                            initial={{ opacity: 0, y: -2 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={cn('mt-0.5 font-mono text-[11px]', out.kind === 'error' ? 'text-bad' : out.kind === 'blocked' ? 'text-warn' : out.kind === 'ok' ? 'text-ok' : 'text-faint')}
                          >
                            → {out.text}
                          </motion.div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </button>
            );
          })}
        </div>

        {/* state */}
        <div className="space-y-3">
          <StepControls stepper={stepper} caption={stepper.step === 0 ? 'start' : `step ${stepper.step}/${frames.length - 1}`} />
          <div className="rounded-lg border border-line bg-surface p-3">
            <div className="eyebrow mb-2 flex items-center justify-between">
              <span>{sc.table}: physical tuple versions</span>
              <span className="normal-case tracking-normal text-faint">xmin = creator · xmax = deleter</span>
            </div>
            <div className="space-y-2">
              {f.rows.map((r) => {
                const s1 = seenBy(f, 'T1', r, level);
                const s2 = seenBy(f, 'T2', r, level);
                return (
                  <div key={r.id} className="rounded-md border border-line/70 p-2">
                    <div className="mb-1 flex items-center gap-2 font-mono text-[12px]">
                      <b className="text-ink">{r.id}</b>
                      {f.locks[r.id] && (
                        <span className="flex items-center gap-1 rounded bg-warn/15 px-1.5 text-[10px] text-warn">
                          <Lock className="h-2.5 w-2.5" /> row lock: {f.locks[r.id]}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <AnimatePresence initial={false}>
                        {r.versions.map((v, vi) => {
                          const st = f.xidStatus[v.xmin];
                          const dead = st === 'aborted' || (v.xmax !== undefined && f.xidStatus[v.xmax] === 'committed');
                          return (
                            <motion.div
                              key={vi}
                              initial={{ opacity: 0, scale: 0.85 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className={cn(
                                'rounded border px-1.5 py-1 font-mono text-[10.5px]',
                                st === 'aborted' ? 'border-bad/50 bg-bad/5 text-faint line-through' : st === 'active' ? 'border-warn/60 bg-warn/10' : dead ? 'border-line bg-sunken text-faint' : 'border-ok/50 bg-ok/5',
                              )}
                            >
                              <div className="text-ink">
                                {sc.columns.map((c) => `${c}=${String(v.data[c])}`).join(' ')}
                              </div>
                              <div className="text-[9.5px] text-faint">
                                xmin {v.xmin === 1 ? 'old' : v.xmin}
                                {st === 'active' ? ' (in progress)' : st === 'aborted' ? ' (aborted)' : ''} · xmax {v.xmax ?? '—'}
                                {v.xmax && f.xidStatus[v.xmax] === 'aborted' ? ' (ignored)' : ''}
                              </div>
                              <div className="mt-0.5 flex gap-1 text-[9.5px]">
                                {s1 === v && <span className="rounded bg-info/15 px-1 text-info">T1 sees</span>}
                                {s2 === v && <span className="rounded bg-violet/15 px-1 text-violet">T2 sees</span>}
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-faint">
              {(['T1', 'T2'] as TxName[]).map((t) =>
                f.tx[t].snapshot && level !== 'RC' && level !== 'RU' ? (
                  <span key={t}>
                    {t} snapshot: sees commits of {f.tx[t].snapshot!.length ? f.tx[t].snapshot!.join(', ') : 'nothing newer than the initial data'}
                  </span>
                ) : null,
              )}
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface p-3">
            <div className="eyebrow mb-1">What changed</div>
            <ul className="space-y-1 text-[13px] leading-relaxed text-muted">
              {f.events.map((e, i) => (
                <li key={i} className={cn(e.startsWith('⚠') && 'text-bad')}>
                  <Md text={e} />
                </li>
              ))}
            </ul>
            {f.impact && stepper.step > 0 && (
              <div className={cn('mt-2 rounded-md border-l-2 px-2 py-1 text-[12.5px]', f.tone === 'bad' ? 'border-bad text-bad' : f.tone === 'warn' ? 'border-warn text-ink' : 'border-ok text-ink')}>
                <b>Impact:</b> <Md text={f.impact} />
              </div>
            )}
          </div>
        </div>
      </div>

      {atEnd && (
        <div className="space-y-3">
          <Callout tone={verdict.anomaly ? 'bad' : 'ok'} title={verdict.anomaly ? `Anomaly at ${LEVELS.find((l) => l.id === level)!.label}` : `Prevented at ${LEVELS.find((l) => l.id === level)!.label}`}>
            <Md text={verdict.text} />
            <div className="mt-2 text-[12.5px]">
              <b>Engineer’s fix:</b> <Md text={sc.fix} />
            </div>
          </Callout>
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="bg-sunken px-3 py-1.5 text-[12px] font-medium">Same interleaving at every level</div>
            {matrix.map(({ l, v }) => (
              <button key={l.id} onClick={() => setLevel(l.id)} className={cn('flex w-full items-start gap-3 border-t border-line/60 px-3 py-1.5 text-left text-[12px] hover:bg-surface', l.id === level && 'bg-accent/[0.05]')}>
                <span className="w-36 shrink-0 font-mono text-[11px]">{l.label}</span>
                <Tag tone={v.anomaly ? 'bad' : 'ok'}>{v.anomaly ? 'anomaly' : 'safe'}</Tag>
                <span className="line-clamp-2 text-muted">
                  <Md text={v.text} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
