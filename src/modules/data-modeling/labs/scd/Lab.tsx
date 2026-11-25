import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Award, Database, Dumbbell, Footprints, MapPin, PenLine, ShoppingCart, UserPlus } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Callout, StepControls, Tag, useStepper } from '@/shared/ui';
import { useDm } from '../../store';
import type { LabTopic } from '../../types';
import { ChangeCard } from '../../ui/ChangeCard';
import { PredictCard } from '../../ui/Predict';
import { Rich } from '../../ui/Rich';
import { ExerciseChecklist } from './bits';
import { PREDICTS, ROW_BYTES, SCALE_CUSTOMERS, SCD_TYPES, TIMELINE, TYPE_INFO, type Dim, type ScdType } from './data';
import { OPEN_END, bytesOf, describe, fmtBytes, fmtK, fmtRows, report, rowsOf, simulate, type DimRow, type Frame, type Report, type Touch, type View } from './engine';
import { AsWasExercise, LateFactExercise, PickTypeExercise, PlayType2Exercise } from './Exercises';
import { ScdUnderTheHood } from './UnderTheHood';

const VCOL = [
  { chip: 'border-info/40 bg-info/10 text-info', edge: 'border-l-info' },
  { chip: 'border-violet/40 bg-violet/10 text-violet', edge: 'border-l-violet' },
  { chip: 'border-accent/40 bg-accent/10 text-accent', edge: 'border-l-accent' },
  { chip: 'border-warn/40 bg-warn/10 text-warn', edge: 'border-l-warn' },
];
const vcol = (v: number) => VCOL[(v - 1) % VCOL.length];

const T2_KEYS = [
  { key: 't2-2', label: 'Mar · what happens to sk 1' },
  { key: 't2-4', label: 'May · rows for Asha' },
  { key: 't2-5', label: 'Jun · typo fix under Type 2' },
];

const FIX: Partial<Record<ScdType, string>> = {
  0: 'Use Type 0 only for attributes that are immutable by definition (`signup_channel`, date of birth). For `city`, use Type 2 when anyone reports as-was, Type 1 when only the current value matters.',
  1: 'If anyone reports by city **at the time of sale**, use Type 2 (or Type 6 for as-was and as-is from one join). Keep Type 1 for corrections.',
};

interface Col {
  key: keyof DimRow;
  label: string;
  w: number;
  tag?: { text: string; tone: 'violet' | 'info' | 'warn' | 'accent' };
}

function colsFor(type: ScdType, hist = false): Col[] {
  const sk: Col = { key: 'sk', label: hist ? 'hist_id' : 'sk', w: hist ? 52 : 34 };
  const id: Col = { key: 'custId', label: 'customer_id', w: 82 };
  const name: Col = { key: 'name', label: 'name', w: 74, tag: type === 2 || type === 6 ? { text: 'T1', tone: 'info' } : undefined };
  const city: Col = { key: 'city', label: 'city', w: 62 };
  const seg: Col = { key: 'segment', label: 'segment', w: 64 };
  const ch: Col = { key: 'channel', label: 'channel', w: 58, tag: { text: 'T0', tone: 'violet' } };
  const vf: Col = { key: 'validFrom', label: 'valid_from', w: 80 };
  const vt: Col = { key: 'validTo', label: 'valid_to', w: 80 };
  const cur: Col = { key: 'isCurrent', label: 'is_cur', w: 48 };
  if (hist) return [sk, id, name, city, seg, vf, vt];
  switch (type) {
    case 2:
      return [sk, id, name, city, seg, ch, vf, vt, cur];
    case 3:
      return [sk, id, name, city, { key: 'prevCity', label: 'prev_city', w: 66, tag: { text: 'T3', tone: 'accent' } }, seg, { key: 'prevSegment', label: 'prev_seg', w: 64, tag: { text: 'T3', tone: 'accent' } }, ch];
    case 6:
      return [
        sk,
        id,
        name,
        city,
        { key: 'curCity', label: 'cur_city', w: 62, tag: { text: 'T1', tone: 'info' } },
        seg,
        { key: 'curSegment', label: 'cur_seg', w: 62, tag: { text: 'T1', tone: 'info' } },
        vf,
        vt,
        cur,
      ];
    default:
      return [sk, id, name, city, seg, ch];
  }
}

const TOUCH_STYLE: Record<Touch, string> = { insert: 'bg-ok/10', update: 'bg-warn/10', expire: 'bg-bad/[0.06]' };
const TOUCH_TAG: Record<Touch, { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  insert: { text: 'INSERT', tone: 'ok' },
  update: { text: 'UPDATE', tone: 'warn' },
  expire: { text: 'EXPIRE', tone: 'bad' },
};

function fmtCell(r: DimRow, k: keyof DimRow): string {
  const v = r[k];
  if (v === null || v === undefined) return 'NULL';
  return String(v);
}

function DimTable({ title, sub, rows, cols, frame, live }: { title: string; sub: string; rows: DimRow[]; cols: Col[]; frame: Frame; live: boolean }) {
  const width = cols.reduce((a, c) => a + c.w, 0) + 76;
  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-baseline gap-2 border-b border-line px-3 py-2">
        <Database size={13} className="self-center text-accent" />
        <span className="font-mono text-[12.5px] font-semibold text-ink">{title}</span>
        <span className="font-mono text-[11px] text-faint">{sub}</span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted">
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="overflow-x-auto p-2">
        <div style={{ minWidth: width }}>
          <div className="flex px-1 pb-1 font-mono text-[10.5px] text-faint">
            {cols.map((c) => (
              <div key={c.key} style={{ width: c.w }} className="flex shrink-0 items-center gap-1 pr-1">
                {c.label}
                {c.tag && (
                  <Tag size="sm" tone={c.tag.tone} className="!h-4 !px-1 !text-[9px]">
                    {c.tag.text}
                  </Tag>
                )}
              </div>
            ))}
          </div>
          <AnimatePresence initial={false}>
            {rows.map((r) => {
              const t = live ? frame.touched[r.rid] : undefined;
              const ch = live ? (frame.changed[r.rid] ?? []) : [];
              const expired = r.isCurrent === false || (r.validTo !== undefined && r.validTo !== OPEN_END);
              return (
                <motion.div
                  key={r.rid}
                  layout
                  initial={{ opacity: 0, y: -10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35 }}
                  className={cn('mb-1 flex items-center rounded-md border border-l-4 border-line px-1 py-1 font-mono text-[11.5px] transition-colors', vcol(r.version).edge, t && TOUCH_STYLE[t], expired && 'text-muted')}
                >
                  {cols.map((c) => {
                    const v = fmtCell(r, c.key);
                    const hot = ch.includes(c.key);
                    const isSk = c.key === 'sk';
                    return (
                      <div key={c.key} style={{ width: c.w }} className="shrink-0 truncate pr-1">
                        <motion.span
                          key={v}
                          initial={hot ? { opacity: 0, y: -4 } : false}
                          animate={{ opacity: 1, y: 0 }}
                          className={cn(
                            'inline-block',
                            isSk && cn('rounded border px-1', vcol(r.version).chip),
                            hot && 'rounded bg-accent/15 px-0.5 font-semibold text-accent',
                            v === 'NULL' && 'text-faint',
                            v === OPEN_END && 'text-faint',
                            c.key === 'isCurrent' && (v === 'true' ? 'text-ok' : 'text-faint'),
                          )}
                        >
                          {v}
                        </motion.span>
                      </div>
                    );
                  })}
                  <div className="ml-auto w-[64px] shrink-0 text-right">
                    {t && (
                      <Tag size="sm" tone={TOUCH_TAG[t].tone} className="!h-4 !px-1 !text-[9px]">
                        {TOUCH_TAG[t].text}
                      </Tag>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function FactTable({ frame, rep, dim, type }: { frame: Frame; rep: Report; dim: Dim; type: ScdType }) {
  const truthWas = (date: string) => {
    for (let i = TIMELINE.length - 1; i >= 0; i--) {
      const c = TIMELINE[i].change;
      if (c && c.kind === 'change' && c.attr === dim && c.date <= date) return c.to!;
    }
    return dim === 'city' ? 'Pune' : 'Silver';
  };
  const cols = ['sale_id', 'sale_date', 'customer_sk', 'amount', `as-was ${dim}`, `as-is ${dim}`];
  const ws = [56, 86, 92, 70, 120, 120];
  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-baseline gap-2 border-b border-line px-3 py-2">
        <ShoppingCart size={13} className="self-center text-accent" />
        <span className="font-mono text-[12.5px] font-semibold text-ink">fact_sales</span>
        <span className="font-mono text-[11px] text-faint">{type === 4 ? 'customer_sk → current table; as-was via history' : 'customer_sk → dim_customer'}</span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted">{frame.facts.length} rows</span>
      </div>
      <div className="overflow-x-auto p-2">
        <div style={{ minWidth: ws.reduce((a, b) => a + b, 0) }}>
          <div className="flex px-1 pb-1 font-mono text-[10.5px] text-faint">
            {cols.map((c, i) => (
              <div key={c} style={{ width: ws[i] }} className="shrink-0">
                {c}
              </div>
            ))}
          </div>
          <AnimatePresence initial={false}>
            {frame.facts.map((f) => {
              const was = rep.asWas.perFact[f.id];
              const is = rep.asIs.perFact[f.id];
              const tWas = truthWas(f.date);
              const tIs = frame.truth[dim];
              return (
                <motion.div
                  key={f.id}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="mb-1 flex items-center rounded-md border border-line px-1 py-1 font-mono text-[11.5px]"
                >
                  <div style={{ width: ws[0] }} className="shrink-0 text-muted">
                    {f.id}
                  </div>
                  <div style={{ width: ws[1] }} className="shrink-0">
                    {f.date}
                  </div>
                  <div style={{ width: ws[2] }} className="shrink-0">
                    <span className={cn('rounded border px-1', vcol(f.version).chip)}>sk {f.sk}</span>
                  </div>
                  <div style={{ width: ws[3] }} className="shrink-0 tabular-nums">
                    {fmtK(f.amount)}
                  </div>
                  <Attribution w={ws[4]} value={was} truth={tWas} />
                  <Attribution w={ws[5]} value={is} truth={tIs} />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Attribution({ w, value, truth }: { w: number; value: string; truth: string }) {
  const ok = value === truth;
  return (
    <div style={{ width: w }} className="shrink-0 truncate">
      <motion.span key={value} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={ok ? 'text-ink' : 'font-semibold text-bad'}>
        {ok ? '✓' : '✗'} {value}
      </motion.span>
      {!ok && <span className="ml-1 text-[10px] text-faint">(was {truth})</span>}
    </div>
  );
}

function BarGroup({ title, sub, view, truth, values, max }: { title: string; sub: string; view: View; truth: Record<string, number>; values: string[]; max: number }) {
  return (
    <div className={cn('rounded-xl border p-2.5', view.correct ? 'border-line bg-surface' : 'border-bad/40 bg-bad/[0.04]')}>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[12px] font-semibold text-ink">{title}</span>
        <span className="text-[11px] text-faint">{sub}</span>
        <span className="ml-auto">
          {!view.supported ? (
            <Tag size="sm" tone="warn">
              not supported
            </Tag>
          ) : view.correct ? (
            <Tag size="sm" tone="ok">
              ✓ correct
            </Tag>
          ) : (
            <Tag size="sm" tone="bad">
              ✗ wrong
            </Tag>
          )}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {values.map((v) => {
          const got = view.totals[v] ?? 0;
          const want = truth[v] ?? 0;
          return (
            <div key={v} className="flex items-center gap-2">
              <span className="w-12 shrink-0 font-mono text-[11px] text-muted">{v}</span>
              <div className="relative h-5 flex-1 rounded bg-ink/[0.05]">
                <motion.div
                  className={cn('absolute inset-y-0 left-0 rounded', got === want ? 'bg-accent/70' : 'bg-bad/60')}
                  initial={false}
                  animate={{ width: `${max ? (got / max) * 100 : 0}%` }}
                  transition={{ type: 'spring', stiffness: 160, damping: 22 }}
                />
                {got !== want && (
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded border border-dashed border-ink/50"
                    initial={false}
                    animate={{ width: `${max ? (want / max) * 100 : 0}%` }}
                    title={`reality: ${fmtK(want)}`}
                  />
                )}
              </div>
              <span className="w-[74px] shrink-0 text-right font-mono text-[11px] tabular-nums text-ink">
                {fmtK(got)}
                {got !== want && <span className="block text-[9.5px] text-faint">real {fmtK(want)}</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 font-mono text-[10px] leading-snug text-faint">{view.how}</div>
    </div>
  );
}

const EVENT_ICON = { signup: UserPlus, city: MapPin, segment: Award, name: PenLine } as const;

function TimelineStrip({ step, onGo }: { step: number; onGo: (i: number) => void }) {
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {TIMELINE.map((ev, i) => {
        const c = ev.change;
        const Icon = c ? (c.kind === 'signup' ? EVENT_ICON.signup : EVENT_ICON[c.attr!]) : ShoppingCart;
        const label = c ? (c.kind === 'signup' ? 'signup' : c.kind === 'correction' ? 'typo fix' : `${c.from}→${c.to}`) : 'sale only';
        return (
          <button
            key={ev.month}
            onClick={() => onGo(i)}
            className={cn(
              'relative rounded-lg border px-2 py-1.5 text-left transition',
              i === step ? 'border-accent bg-accent/10 shadow-paper' : i < step ? 'border-line bg-surface' : 'border-dashed border-line bg-surface/50 opacity-60',
            )}
          >
            <div className="flex items-center gap-1 font-mono text-[11px] font-semibold text-ink">
              <Icon size={12} className={c ? 'text-accent' : 'text-faint'} /> {ev.month}
            </div>
            <div className="truncate font-mono text-[10px] text-muted">{label}</div>
            <div className="font-mono text-[10px] tabular-nums text-faint">sale {fmtK(ev.sale.amount)}</div>
            {i === step && <motion.div layoutId="scd-now" className="absolute -bottom-[5px] left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-accent" />}
          </button>
        );
      })}
    </div>
  );
}

function RowGrowth({ all, step, type }: { all: Record<ScdType, Frame[]>; step: number; type: ScdType }) {
  const max = Math.max(...SCD_TYPES.map((t) => rowsOf(all[t][TIMELINE.length - 1])));
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5">
      <div className="eyebrow">Rows for Asha · every type at {TIMELINE[step].month}</div>
      <div className="mt-2 space-y-1">
        {SCD_TYPES.map((t) => {
          const fr = all[t][step];
          const rows = rowsOf(fr);
          return (
            <div key={t} className={cn('flex items-center gap-2 rounded px-1 py-0.5', t === type && 'bg-accent/10')}>
              <span className={cn('w-6 font-mono text-[11px]', t === type ? 'font-semibold text-ink' : 'text-muted')}>T{t}</span>
              <div className="relative h-3 flex-1 rounded bg-ink/[0.05]">
                <motion.div className={cn('absolute inset-y-0 left-0 rounded', t === type ? 'bg-accent/70' : 'bg-ink/25')} initial={false} animate={{ width: `${(rows / max) * 100}%` }} />
              </div>
              <span className="w-[104px] text-right font-mono text-[10.5px] tabular-nums text-muted">
                {rows} · {fmtBytes(bytesOf(t, fr))} · ×10M {fmtRows(rows * SCALE_CUSTOMERS)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-faint">
        ≈ bytes/row: T0/T1 {ROW_BYTES[1]} · T2/T3 {ROW_BYTES[2]} · T6 {ROW_BYTES[6]} (Postgres tuple header + columns). Type 2 and 6 grow with change frequency, not customer count.
      </p>
    </div>
  );
}

type Tab = 'walk' | 'ex';

export default function ScdLab({ topic }: { topic: LabTopic }) {
  const markExercise = useDm((s) => s.markExercise);
  const recordPrediction = useDm((s) => s.recordPrediction);
  const exDone = useDm((s) => s.topics[topic.id]?.exercises);
  const storedPreds = useDm((s) => s.topics[topic.id]?.predictions);

  const [type, setType] = useState<ScdType>(2);
  const [dim, setDim] = useState<Dim>('city');
  const [tab, setTab] = useState<Tab>('walk');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const stepper = useStepper(TIMELINE.length, { intervalMs: 2800 });
  const step = stepper.step;

  const all = useMemo(() => Object.fromEntries(SCD_TYPES.map((t) => [t, simulate(t)])) as unknown as Record<ScdType, Frame[]>, []);
  const frames = all[type];
  const pkey = `t${type}-${step}`;
  const predict = PREDICTS[pkey];
  const revealed = !predict || answers[pkey] !== undefined;
  const shownStep = revealed ? step : Math.max(0, step - 1);
  const frame = frames[shownStep];
  const rep = useMemo(() => report(type, frame, dim), [type, frame, dim]);
  const change = useMemo(() => (revealed ? describe(type, frames, step) : null), [revealed, type, frames, step]);
  const ev = TIMELINE[step];
  const max = frame.facts.reduce((a, f) => a + f.amount, 0);

  useEffect(() => {
    if (stepper.playing && !revealed) stepper.pause();
  }, [stepper, revealed]);

  const t2Answered = T2_KEYS.map((k) => ({ ...k, ok: storedPreds?.[k.key] }));
  useEffect(() => {
    if (exDone?.['play-type2']) return;
    if (type === 2 && step === TIMELINE.length - 1 && revealed && T2_KEYS.every((k) => storedPreds && k.key in storedPreds)) markExercise(topic.id, 'play-type2');
  }, [type, step, revealed, storedPreds, exDone, markExercise, topic.id]);

  const answer = (i: number, right: boolean) => {
    setAnswers((a) => ({ ...a, [pkey]: i }));
    recordPrediction(topic.id, pkey, right);
  };

  const hasBad = !!change?.lines.some((l) => l.tone === 'bad');
  const t2Final = all[2][TIMELINE.length - 1];
  const fanout = { versions: t2Final.dim.length, total: t2Final.facts.reduce((a, f) => a + f.amount, 0) };

  return (
    <div className="flex h-full min-h-0">
      {/* left: narration + exercises */}
      <aside className="flex w-[380px] shrink-0 flex-col border-r border-line bg-paper">
        <div className="flex border-b border-line">
          {(
            [
              ['walk', 'Time machine', Footprints],
              ['ex', 'Exercises', Dumbbell],
            ] as const
          ).map(([t, label, Icon]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn('flex flex-1 items-center justify-center gap-1.5 py-2 font-mono text-[11px] uppercase tracking-wider', tab === t ? 'border-b-2 border-accent text-ink' : 'text-faint hover:text-muted')}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        {tab === 'walk' && (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div>
                <div className="eyebrow mb-1.5">SCD type applied to the load</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {SCD_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setType(t)}
                      className={cn(
                        'rounded-lg border px-2 py-1.5 text-left transition',
                        type === t ? 'border-ink bg-ink text-paper' : 'border-line bg-surface hover:border-accent',
                      )}
                    >
                      <div className="font-mono text-[12px] font-semibold">Type {t}</div>
                      <div className={cn('font-mono text-[10px]', type === t ? 'text-paper/75' : 'text-faint')}>{TYPE_INFO[t].short}</div>
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{TYPE_INFO[type].blurb}</p>
              </div>

              <div className="border-t border-line pt-3">
                <div className="flex items-center gap-2">
                  <Tag size="sm" tone={ev.change ? 'accent' : 'neutral'}>
                    {ev.month} 2025
                  </Tag>
                  <span className="font-mono text-[11px] text-faint">
                    step {step + 1} / {TIMELINE.length}
                  </span>
                </div>
                <h2 className="mt-1.5 font-mono text-[15px] font-semibold leading-snug text-ink">
                  <Rich text={ev.change ? ev.change.text : 'No attribute changes this month.'} />
                </h2>
                <p className="mt-1 text-[12.5px] text-muted">
                  Then a sale on <span className="font-mono text-ink">{ev.sale.date}</span> for <span className="font-mono text-ink">{fmtK(ev.sale.amount)}</span> lands in{' '}
                  <code className="font-mono text-[11.5px]">fact_sales</code>.
                </p>
              </div>

              {predict && <PredictCard key={pkey} predict={predict} answered={answers[pkey]} onAnswer={answer} />}

              {change && (
                <div>
                  <div className="eyebrow mb-1">What this step changed</div>
                  <ChangeCard change={change} />
                </div>
              )}

              {hasBad && FIX[type] && (
                <Callout tone="bad" title={`Red flag: Type ${type} for this attribute`}>
                  <span className="text-[12px]">
                    <Rich text={FIX[type]!} />
                  </span>
                </Callout>
              )}

              {step === TIMELINE.length - 1 && revealed && (
                <Callout tone="tip" title="Now compare">
                  <span className="text-[12px]">
                    Switch types at June: the right panel recomputes both reports and the row counts. Only Types 2, 4 and 6 get as-was right; 2 pays a self-join for as-is.
                  </span>
                </Callout>
              )}
            </div>
            <div className="border-t border-line p-3">
              <StepControls stepper={stepper} speeds={[0.5, 1, 2]} caption={`${Object.values(storedPreds ?? {}).filter(Boolean).length}/${Object.keys(storedPreds ?? {}).length} predictions right`} />
            </div>
          </>
        )}

        {tab === 'ex' && (
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <ExerciseChecklist items={topic.exercises} done={exDone} />
            <PickTypeExercise done={exDone?.['pick-type']} onSolved={() => markExercise(topic.id, 'pick-type')} />
            <PlayType2Exercise
              done={exDone?.['play-type2']}
              answered={t2Answered}
              onLoad={() => {
                setType(2);
                stepper.reset();
                setTab('walk');
              }}
            />
            <AsWasExercise done={exDone?.['as-was-as-is']} onSolved={() => markExercise(topic.id, 'as-was-as-is')} />
            <LateFactExercise done={exDone?.['late-fact']} onSolved={() => markExercise(topic.id, 'late-fact')} />
          </div>
        )}
      </aside>

      {/* centre: the tables over time */}
      <main className="relative min-w-0 flex-1 overflow-y-auto bg-sunken/60 bg-grid">
        <div className="space-y-3 p-4">
          <TimelineStrip
            step={step}
            onGo={(i) => {
              stepper.pause();
              stepper.goTo(i);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-ink">
              Type {type} · {TYPE_INFO[type].short}
            </span>
            <span className="font-mono text-[11px] text-faint">{TYPE_INFO[type].tables}</span>
            <span className="ml-auto flex items-center gap-1 font-mono text-[10.5px] text-faint">
              <span className="rounded bg-ok/15 px-1 text-ok">insert</span>
              <span className="rounded bg-warn/15 px-1 text-warn">update</span>
              <span className="rounded bg-bad/10 px-1 text-bad">expire</span>
              <span className="rounded bg-accent/15 px-1 text-accent">changed cell</span>
            </span>
          </div>

          <div className="relative space-y-3">
            {!revealed && (
              <div className="absolute inset-0 z-10 flex items-start justify-center rounded-xl bg-paper/60 pt-10 backdrop-blur-[1px]">
                <div className="rounded-lg border border-accent/50 bg-surface px-3 py-2 font-mono text-[11.5px] text-accent shadow-paper">← commit to a prediction to run {ev.month}’s load</div>
              </div>
            )}

            <div className="rounded-xl border border-line bg-surface/80 px-3 py-2">
              <div className="eyebrow mb-1">Statements this load ran</div>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.ul key={`${type}-${shownStep}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-0.5 font-mono text-[11px] leading-snug">
                  {frame.ops.length ? (
                    frame.ops.map((o, i) => (
                      <li key={i} className={o.startsWith('--') ? 'text-bad' : 'text-ink'}>
                        {o}
                      </li>
                    ))
                  ) : (
                    <li className="text-faint">-- no dimension statements</li>
                  )}
                  <li className="text-muted">
                    INSERT INTO fact_sales … → {frame.facts[frame.facts.length - 1].date}, customer_sk {frame.facts[frame.facts.length - 1].sk}, {fmtK(frame.facts[frame.facts.length - 1].amount)}
                  </li>
                </motion.ul>
              </AnimatePresence>
            </div>

            <DimTable
              title="dim_customer"
              sub={type === 4 ? 'current only · Type 1' : type === 2 || type === 6 ? 'one row per version' : 'one row per customer'}
              rows={frame.dim}
              cols={colsFor(type)}
              frame={frame}
              live={revealed}
            />
            {type === 4 && <DimTable title="dim_customer_history" sub="append-only versions · as-was" rows={frame.hist} cols={colsFor(4, true)} frame={frame} live={revealed} />}
            <FactTable frame={frame} rep={rep} dim={dim} type={type} />
          </div>

          <ScdUnderTheHood fanout={fanout} />
        </div>
      </main>

      {/* right: reports */}
      <aside className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-paper p-3.5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Revenue by {dim}</span>
          <div className="flex rounded border border-line bg-surface p-0.5">
            {(['city', 'segment'] as Dim[]).map((d) => (
              <button key={d} onClick={() => setDim(d)} className={cn('rounded px-2 py-0.5 font-mono text-[11px]', dim === d ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <BarGroup title="As-was" sub={`${dim} at time of sale`} view={rep.asWas} truth={rep.truthWas} values={rep.values} max={max} />
        <BarGroup title="As-is" sub={`current ${dim}`} view={rep.asIs} truth={rep.truthIs} values={rep.values} max={max} />
        <p className="-mt-1 text-[11px] leading-snug text-faint">Solid bar = what the query returns. Dashed outline = reality, shown only when they differ.</p>
        <RowGrowth all={all} step={shownStep} type={type} />
      </aside>
    </div>
  );
}
