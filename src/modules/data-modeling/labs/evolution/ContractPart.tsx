import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, Circle, FileJson, RotateCcw, Target, X } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, Tag } from '@/shared/ui';
import type { Predict } from '../../types';
import type { Change, ChangeLine } from '../../ui/ChangeCard';
import { PredictCard } from '../../ui/Predict';
import { Rich } from '../../ui/Rich';
import { CHANGES, MODES, V1, attempt, deployOrder, diffSchemas, typeText, type Attempt, type ChangeDef, type Mission, type Mode, type Resolution, type Schema } from './avro';

interface Last {
  change: ChangeDef;
  mode: Mode;
  base: Schema;
  baseV: number;
  cand: Schema;
  att: Attempt;
  pred?: { p: Predict; i: number };
}
interface LogItem {
  label: string;
  mode: Mode;
  accepted: boolean;
  version?: number;
}

const strip = (s: string) => s.replace(/[*`]/g, '');
const firstBad = (r: Resolution) => r.notes.find((n) => !n.ok)?.text;
const firstNote = (r: Resolution) => r.notes[0]?.text;

export function ContractPart({
  mission,
  setMission,
  done,
  onSolved,
  onChange,
  onPredict,
}: {
  mission: Mission | null;
  setMission: (m: Mission | null) => void;
  done: Record<string, boolean> | undefined;
  onSolved: (exId: string) => void;
  onChange: (c: Change) => void;
  onPredict: (key: string, right: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>('BACKWARD');
  const [versions, setVersions] = useState<Schema[]>([V1]);
  const [log, setLog] = useState<LogItem[]>([]);
  const [last, setLast] = useState<Last | null>(null);
  const [pending, setPending] = useState<ChangeDef | null>(null);
  const [predictFirst, setPredictFirst] = useState(true);
  const [attemptNo, setAttemptNo] = useState(0);
  // which mission the registered versions belong to (guards against free-play history counting)
  const [owner, setOwner] = useState<string | null>(null);
  const latest = versions[versions.length - 1];

  const reset = () => {
    setVersions([V1]);
    setLog([]);
    setLast(null);
    setPending(null);
  };

  useEffect(() => {
    reset();
    setOwner(mission?.exId ?? null);
    if (mission) setMode(mission.mode);
  }, [mission]);

  useEffect(() => {
    if (mission && owner === mission.exId && mode === mission.mode && mission.goals.every((g) => g.met(latest)) && !done?.[mission.exId]) onSolved(mission.exId);
  }, [mission, owner, mode, latest, done, onSolved]);

  const commit = (change: ChangeDef, pred?: { p: Predict; i: number }) => {
    const cand = change.apply(latest);
    const att = attempt(mode, versions, cand);
    const accepted = mode === 'NONE' || att.accepted;
    const v = versions.length + 1;
    if (accepted) setVersions([...versions, cand]);
    setLog((l) => [...l, { label: change.label, mode, accepted, version: accepted ? v : undefined }]);
    setLast({ change, mode, base: latest, baseV: versions.length, cand, att: { ...att, accepted }, pred });
    setPending(null);
    setAttemptNo((n) => n + 1);
    onChange(describeAttempt(change, mode, att, accepted, v, versions.length));
  };

  const pick = (c: ChangeDef) => {
    if (predictFirst) {
      setPending(c);
      setLast(null);
    } else commit(c);
  };

  const predict: Predict | null = pending ? buildPredict(pending, mode, versions, latest) : null;

  return (
    <div className="space-y-3">
      {mission ? (
        <div className="rounded-xl border border-accent/50 bg-accent/[0.06] p-3">
          <div className="flex items-center gap-2">
            <Target size={14} className="text-accent" />
            <span className="text-[13.5px] font-semibold text-ink">{mission.title}</span>
            <Tag size="sm" tone="accent">
              mode locked: {mission.mode}
            </Tag>
            {done?.[mission.exId] && (
              <Tag size="sm" tone="ok">
                solved ✓
              </Tag>
            )}
            <button onClick={() => setMission(null)} className="ml-auto flex items-center gap-1 font-mono text-[11px] text-faint hover:text-ink">
              <X size={12} /> leave
            </button>
          </div>
          <p className="mt-1 text-[12.5px] text-muted">{mission.brief}</p>
          <ul className="mt-1.5 grid grid-cols-2 gap-1">
            {mission.goals.map((g) => {
              const met = g.met(latest);
              return (
                <li key={g.text} className={cn('flex items-center gap-1.5 text-[12px]', met ? 'text-ink' : 'text-muted')}>
                  {met ? <CheckCircle2 size={13} className="shrink-0 text-ok" /> : <Circle size={13} className="shrink-0 text-faint" />}
                  <Rich text={g.text} />
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="text-[14px] font-semibold text-ink">
            Producer team evolves <code className="font-mono">OrderPlaced</code>; 14 consumer teams read it from Kafka
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Each change is registered as a new version of subject <code className="font-mono">orders-value</code>. The registry runs the Avro resolution rules for the subject’s compatibility mode and answers <b>200</b> or <b>409</b>.
          </p>
        </div>
      )}

      {/* mode picker */}
      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className="eyebrow">Compatibility mode</span>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted">
            <input type="checkbox" checked={predictFirst} onChange={(e) => setPredictFirst(e.target.checked)} className="accent-[rgb(var(--c-accent))]" />
            predict before registering
          </label>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              disabled={!!mission}
              onClick={() => {
                setMode(m.id);
                setPending(null);
              }}
              className={cn(
                'rounded-md border px-2 py-1 font-mono text-[11px] transition',
                mode === m.id ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-muted hover:border-accent',
                mission && mode !== m.id && 'opacity-40',
              )}
            >
              {m.id}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-muted">
          <span className="font-mono font-semibold text-ink">{mode}</span>: <Rich text={MODES.find((m) => m.id === mode)!.rule} />.
          {mode.endsWith('TRANSITIVE') ? ' Topics retain old events and consumers replay from the start, so “compatible with the latest” isn’t enough: v3 must also read v1 data.' : ''}
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
        {/* change list */}
        <div className="rounded-xl border border-line bg-surface p-2.5">
          <div className="eyebrow mb-1.5">Apply a change to v{versions.length}</div>
          <div className="space-y-1">
            {CHANGES.map((c) => {
              const why = c.blocked(latest);
              return (
                <button
                  key={c.id}
                  disabled={!!why}
                  onClick={() => pick(c)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[12px] transition',
                    pending?.id === c.id ? 'border-accent bg-accent/10' : 'border-line hover:border-accent hover:bg-accent/5',
                    why && 'cursor-not-allowed opacity-45 hover:border-line hover:bg-transparent',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <Rich text={c.label} />
                  </span>
                  {why ? <span className="shrink-0 font-mono text-[10px] text-faint">{why}</span> : <ArrowRight size={12} className="shrink-0 text-faint" />}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button variant="ghost" size="xs" icon={<RotateCcw size={12} />} onClick={reset}>
              Reset subject to v1
            </Button>
          </div>
        </div>

        {/* subject: versions + schema */}
        <div className="space-y-2">
          <div className="rounded-xl border border-line bg-surface p-2.5">
            <div className="eyebrow mb-1">Subject orders-value · history</div>
            <div className="flex flex-wrap items-center gap-1">
              <Tag size="sm" tone="info">
                v1
              </Tag>
              <AnimatePresence initial={false}>
                {log.map((l, i) => (
                  <motion.span key={i} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} title={`${strip(l.label)} · ${l.mode}`}>
                    <Tag size="sm" tone={l.accepted ? 'ok' : 'bad'} variant={l.accepted ? 'soft' : 'outline'}>
                      {l.accepted ? `v${l.version}` : '409'}
                    </Tag>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </div>
          <SchemaView last={last} latest={latest} n={versions.length} />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {pending && predict ? (
          <motion.div key={`p-${attemptNo}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <PredictCard
              predict={predict}
              onAnswer={(i, right) => {
                onPredict(`contract-${pending.id}-${mode}`, right);
                commit(pending, { p: predict, i });
              }}
            />
          </motion.div>
        ) : last ? (
          <motion.div key={`r-${attemptNo}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Result last={last} />
          </motion.div>
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-surface/60 p-5 text-center font-mono text-[12px] text-faint">Pick a change to register it as the next version.</div>
        )}
      </AnimatePresence>
    </div>
  );
}

function buildPredict(c: ChangeDef, mode: Mode, versions: Schema[], latest: Schema): Predict {
  const att = attempt(mode, versions, c.apply(latest));
  const acc = mode === 'NONE' || att.accepted;
  const bad = att.checks.find((k) => !k.res.ok);
  const why = acc
    ? mode === 'NONE'
      ? 'NONE accepts anything; the matrix below still shows who would break.'
      : `Compatible: ${firstNote(att.back) ?? 'no field-level differences that matter'}`
    : `${bad!.dir === 'backward' ? `New schema can’t read v${bad!.version} data` : `v${bad!.version} consumers can’t read new data`}: ${firstBad(bad!.res)}`;
  return {
    question: `Subject mode **${mode}**. Register: ${c.label}?`,
    options: [`Accepted: 200, becomes v${versions.length + 1}`, 'Rejected: 409 Conflict'],
    answer: acc ? 0 : 1,
    explain: why,
  };
}

function SchemaView({ last, latest, n }: { last: Last | null; latest: Schema; n: number }) {
  const rows = last ? diffSchemas(last.base, last.cand) : latest.fields.map((f) => ({ f, st: 'same' as const }));
  const head = last ? (last.att.accepted ? `v${last.baseV} → v${last.baseV + 1} (registered)` : `v${last.baseV} → candidate (rejected, not registered)`) : `v${n} (latest)`;
  return (
    <div className={cn('rounded-xl border bg-surface p-2.5', last && !last.att.accepted ? 'border-bad/40' : 'border-line')}>
      <div className="mb-1 flex items-center gap-1.5">
        <FileJson size={13} className="text-accent" />
        <span className="font-mono text-[11.5px] font-semibold text-ink">record OrderPlaced</span>
        <span className="ml-auto font-mono text-[10.5px] text-faint">{head}</span>
      </div>
      <div className="font-mono text-[10.5px] leading-[1.55]">
        <AnimatePresence initial={false}>
          {rows.map(({ f, st }) => (
            <motion.div
              key={`${f.name}-${st}`}
              layout
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                'rounded px-1',
                st === 'added' && 'bg-ok/10 text-ok',
                st === 'removed' && 'bg-bad/10 text-bad line-through',
                st === 'changed' && 'bg-warn/15 text-ink',
                st === 'same' && 'text-muted',
              )}
            >
              <span className="mr-1 inline-block w-2 text-faint">{st === 'added' ? '+' : st === 'removed' ? '−' : st === 'changed' ? '~' : ' '}</span>
              {`{"name": "${f.name}", "type": ${typeText(f.type)}${f.def !== undefined ? `, "default": ${f.def}` : ''}${f.aliases ? `, "aliases": [${f.aliases.map((a) => `"${a}"`).join(', ')}]` : ''}}`}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Result({ last }: { last: Last }) {
  const { att, mode } = last;
  const order = deployOrder(att.back.ok, att.fwd.ok);
  const transitiveFail = att.checks.filter((c) => !c.res.ok && c.version !== last.baseV);
  return (
    <div className="space-y-2.5">
      {last.pred && <PredictCard predict={last.pred.p} answered={last.pred.i} />}
      <div className={cn('flex items-center gap-2 rounded-xl border px-3 py-2', att.accepted ? 'border-ok/40 bg-ok/10' : 'border-bad/40 bg-bad/10')}>
        <span className={cn('font-mono text-[13px] font-bold', att.accepted ? 'text-ok' : 'text-bad')}>{att.accepted ? `200 OK · v${last.baseV + 1}` : '409 Conflict'}</span>
        <span className="text-[12px] text-muted">
          {att.accepted ? (mode === 'NONE' && !(att.back.ok && att.fwd.ok) ? 'Registered without checks. Someone will break.' : `Compatible under ${mode}.`) : `Schema being registered is incompatible with an earlier schema (${mode}).`}
        </span>
      </div>

      <div className="rounded-xl border border-line bg-surface p-2.5">
        <div className="eyebrow mb-1.5">Who can read what · v{last.baseV} vs {att.accepted ? `v${last.baseV + 1}` : 'candidate'}</div>
        <div className="grid grid-cols-[110px_1fr_1fr] gap-1.5">
          <div />
          <div className="text-center font-mono text-[10.5px] text-faint">old data (v{last.baseV} events)</div>
          <div className="text-center font-mono text-[10.5px] text-faint">new data (new events)</div>
          <div className="self-center font-mono text-[10.5px] text-faint">old consumer</div>
          <MatrixCell ok text="Same schema." />
          <MatrixCell ok={att.fwd.ok} text={firstBad(att.fwd) ?? firstNote(att.fwd) ?? 'Identical fields.'} label="FORWARD" />
          <div className="self-center font-mono text-[10.5px] text-faint">new consumer</div>
          <MatrixCell ok={att.back.ok} text={firstBad(att.back) ?? firstNote(att.back) ?? 'Identical fields.'} label="BACKWARD" />
          <MatrixCell ok text="Same schema." />
        </div>
      </div>

      {transitiveFail.length > 0 && (
        <Callout tone="bad" title="Transitive check failed against an older version">
          <span className="text-[12px]">
            <Rich
              text={transitiveFail
                .map((c) => `v${c.version} (${c.dir}): ${firstBad(c.res)}`)
                .join(' · ')}
            />
          </span>
        </Callout>
      )}

      <div className={cn('rounded-xl border p-2.5', order.tone === 'bad' ? 'border-bad/40 bg-bad/[0.04]' : order.tone === 'ok' ? 'border-ok/40 bg-ok/[0.05]' : 'border-info/40 bg-info/[0.05]')}>
        <div className="eyebrow">Who must deploy first</div>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[13px] font-semibold text-ink">
          {order.title}
          <DeployArrows back={att.back.ok} fwd={att.fwd.ok} />
        </div>
        <p className="mt-0.5 text-[12px] text-muted">
          <Rich text={order.text} />
        </p>
      </div>
    </div>
  );
}

function MatrixCell({ ok, text, label }: { ok: boolean; text: string; label?: string }) {
  return (
    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={cn('rounded-lg border p-2', ok ? 'border-ok/40 bg-ok/[0.07]' : 'border-bad/50 bg-bad/10')}>
      <div className="flex items-center gap-1.5">
        <span className={cn('font-mono text-[15px] font-bold', ok ? 'text-ok' : 'text-bad')}>{ok ? '✓' : '✗'}</span>
        {label && <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{label}</span>}
      </div>
      <p className="mt-0.5 text-[11.5px] leading-snug text-ink">
        <Rich text={text} />
      </p>
    </motion.div>
  );
}

function DeployArrows({ back, fwd }: { back: boolean; fwd: boolean }) {
  const box = 'rounded border border-line bg-surface px-1.5 py-0.5 text-[10.5px] font-normal';
  if (back && fwd) return <span className="font-mono text-[10.5px] font-normal text-faint">producers ⇄ consumers</span>;
  if (!back && !fwd) return <span className="font-mono text-[10.5px] font-normal text-bad">new topic</span>;
  const first = back ? 'consumers' : 'producers';
  const second = back ? 'producers' : 'consumers';
  return (
    <span className="flex items-center gap-1">
      <span className={box}>1 · {first}</span>
      <ArrowRight size={12} className="text-faint" />
      <span className={box}>2 · {second}</span>
    </span>
  );
}

function describeAttempt(change: ChangeDef, mode: Mode, att: Attempt, accepted: boolean, v: number, baseV: number): Change {
  const lines: ChangeLine[] = [];
  lines.push({ tone: att.back.ok ? 'ok' : 'bad', text: `New consumer × v${baseV} data (BACKWARD): ${att.back.ok ? '✓' : '✗'} ${firstBad(att.back) ?? firstNote(att.back) ?? ''}` });
  lines.push({ tone: att.fwd.ok ? 'ok' : 'bad', text: `v${baseV} consumer × new data (FORWARD): ${att.fwd.ok ? '✓' : '✗'} ${firstBad(att.fwd) ?? firstNote(att.fwd) ?? ''}` });
  const older = att.checks.filter((c) => !c.res.ok && c.version !== baseV);
  if (older.length) lines.push({ tone: 'bad', text: `Transitive: fails against v${older[0].version}, even though the latest might be fine.` });
  if (mode === 'NONE' && !(att.back.ok && att.fwd.ok)) lines.push({ tone: 'bad', text: 'NONE registered it anyway: the break surfaces in a consumer at 3 a.m., not in CI.' });
  const order = deployOrder(att.back.ok, att.fwd.ok);
  lines.push({ tone: order.tone === 'bad' ? 'bad' : 'info', text: `Deploy order: **${order.title}**.` });
  return { key: `c-${change.id}-${mode}-${v}-${accepted}`, title: `${strip(change.label)} · ${mode} → ${accepted ? `200, v${v}` : '409 rejected'}`, lines };
}
