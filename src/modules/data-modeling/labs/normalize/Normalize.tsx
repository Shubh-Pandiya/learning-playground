import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { cn } from '@/shared/cn';
import { Button, Callout, StepControls, Tag, useStepper } from '@/shared/ui';
import { ChangeCard, type Change, type ChangeLine } from '../../ui/ChangeCard';
import { PredictCard } from '../../ui/Predict';
import { Rich } from '../../ui/Rich';
import { useDm } from '../../store';
import type { LabTopic } from '../../types';
import { ENROLL_FDS, ENROLL_ROWS, NF_STEPS, ORDER_FDS, ORDER_REPORT, SHEET_FDS, type NFStep } from './data';
import { naturalJoin, redundancy, schemaMetrics, type FD, type Row, type SchemaMetrics, type Tbl } from './engine';
import { ChangeFeed, Metric, Shell, TableCard } from './ui';

const fdsOf = (t: Tbl, st: NFStep): FD[] => (st.domain === 'enroll' ? ENROLL_FDS : t.multi?.length ? SHEET_FDS : ORDER_FDS);
const metricsOf = (st: NFStep, tables = st.tables) => schemaMetrics(tables, (t) => fdsOf(t, st));

const delta = (label: string, a: number, b: number, unit = '', lowerIsBetter = true): ChangeLine => {
  const d = b - a;
  const tone = d === 0 ? 'info' : d < 0 === lowerIsBetter ? 'ok' : 'bad';
  return { tone, text: `${label}: **${a} → ${b}${unit}**${d ? ` (${d > 0 ? '+' : ''}${d})` : ''}` };
};

function stepChange(i: number): Change {
  const st = NF_STEPS[i];
  const m = metricsOf(st);
  const lines: ChangeLine[] = [];
  if (i === 0) {
    lines.push({ tone: 'bad', text: '4 list columns: `product_id` can\'t carry a foreign key or an index entry per product.' });
    lines.push({ tone: 'info', text: `${m.rows} rows · **${m.dup} duplicated values** · C1 moves → ${m.c1Move} rows.` });
    return { key: st.id, title: 'Start: the spreadsheet export (0NF)', lines };
  }
  const prev = NF_STEPS[i - 1];
  if (st.removed) lines.push({ tone: 'ok', text: `Removes: ${st.removed}` });
  if (st.domain === 'orders' && prev.domain === 'orders') {
    const p = metricsOf(prev);
    lines.push(delta('Duplicated values', p.dup, m.dup));
    lines.push(delta('C1 moves → rows touched', p.c1Move, m.c1Move));
    if (p.p2Price !== m.p2Price) lines.push(delta('Mug price change → rows touched', p.p2Price, m.p2Price));
    if (m.joins !== p.joins) lines.push({ tone: 'warn', text: `Full order report: **${m.joins} joins** across ${m.tables} tables (was ${p.joins}).` });
  } else if (st.domain === 'enroll') {
    lines.push({ tone: m.dup ? 'bad' : 'ok', text: `Duplicated values: **${m.dup}**` });
  }
  if (st.cost) lines.push({ tone: 'warn', text: `Costs: ${st.cost}` });
  return { key: st.id, title: st.title, lines };
}

export function Normalize({ topic, header, footer }: { topic: LabTopic; header: ReactNode; footer: ReactNode }) {
  const recordPrediction = useDm((s) => s.recordPrediction);
  const stepper = useStepper(NF_STEPS.length, { intervalMs: 9000 });
  const step = stepper.step;
  const st = NF_STEPS[step];
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [denorm, setDenorm] = useState(false);
  const [anaDate, setAnaDate] = useState(false);
  const [extra, setExtra] = useState<Change[]>([]);

  const answered = answers[step];
  const revealed = !st.predict || answered !== undefined;
  const shownIdx = revealed ? step : step - 1;
  const shown = NF_STEPS[shownIdx];

  useEffect(() => {
    if (stepper.playing && !revealed) stepper.pause();
  }, [stepper, revealed]);
  useEffect(() => {
    setDenorm(false);
    setAnaDate(false);
    setExtra([]);
  }, [step]);

  const tables = useMemo<Tbl[]>(() => {
    if (shown.id === 'denorm' && denorm) return [ORDER_REPORT];
    if (shown.id === 'bcnf' && anaDate)
      return shown.tables.map((t) => (t.id === 'enroll' ? { ...t, rows: [...t.rows, { student: 'Ana', instructor: 'Date' }] } : t));
    return shown.tables;
  }, [shown, denorm, anaDate]);

  const m = metricsOf(shown, tables);
  const focus = shown.focus.kind === 'fd' ? shown.focus.lhs : null;
  const change = revealed ? stepChange(step) : null;

  const answer = (i: number) => {
    if (!st.predict || answered !== undefined) return;
    setAnswers((a) => ({ ...a, [step]: i }));
    recordPrediction(topic.id, `nf-${st.id}`, i === st.predict.answer);
  };

  const toggleDenorm = (on: boolean) => {
    if (on === denorm) return;
    setDenorm(on);
    const nm = metricsOf(st, TABLES_FOR(on, st));
    const om = metricsOf(st, TABLES_FOR(!on, st));
    setExtra((cs) => [
      {
        key: `denorm-${Date.now()}`,
        title: on ? 'Copied the 4 tables back into one wide `order_report`' : 'Back to 3NF: 4 tables, keys and FKs',
        lines: [
          delta('Joins per order report', om.joins, nm.joins),
          delta('C1 moves → rows touched', om.c1Move, nm.c1Move),
          delta('Mug price change → rows touched', om.p2Price, nm.p2Price),
          delta('Duplicated values', om.dup, nm.dup),
          on
            ? { tone: 'bad', text: 'Update, insert and delete anomalies are back if this table is the source of truth.' }
            : { tone: 'ok', text: 'Each fact lives in one row; reads pay 3 index joins.' },
        ],
      },
      ...cs,
    ]);
  };

  const insertAnaDate = () => {
    setAnaDate(true);
    setExtra((cs) => [
      {
        key: `ana-${Date.now()}`,
        title: "INSERT INTO enrollment VALUES ('Ana', 'Date') → accepted",
        lines: [
          { tone: 'ok', text: 'PK `(student, instructor)` is unique; FK to `teaches` is satisfied.' },
          { tone: 'bad', text: 'But Ana now takes **Databases twice** (with Codd and with Date): `{student, course} → instructor` is violated and no constraint noticed.' },
          { tone: 'warn', text: 'Enforcing it needs a trigger that joins `teaches` on every insert, or keep the 3NF table with a composite FK.' },
        ],
      },
      ...cs,
    ]);
  };

  const left = (
    <>
      <div className="flex flex-wrap gap-1">
        {NF_STEPS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => {
              stepper.pause();
              stepper.goTo(i);
            }}
            className={cn(
              'rounded-md border px-2 py-0.5 font-mono text-[11px]',
              i === step ? 'border-accent bg-accent text-accent-ink' : i < step ? 'border-ok/40 bg-ok/10 text-ok' : 'border-line bg-surface text-muted hover:border-accent/50',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Tag size="sm" tone={st.domain === 'enroll' ? 'violet' : 'accent'}>
          {st.domain === 'enroll' ? 'enrollment case' : 'orders case'}
        </Tag>
        <span className="font-mono text-[11px] text-faint">
          step {step + 1} / {NF_STEPS.length}
        </span>
      </div>
      <h2 className="font-mono text-[17px] font-semibold leading-snug">{st.title}</h2>
      <div className="space-y-2.5 text-[13.5px] leading-relaxed text-muted">
        {st.body.map((b, i) => (
          <p key={i}>
            <Rich text={b} />
          </p>
        ))}
      </div>
      {st.predict && <PredictCard key={st.id} predict={st.predict} answered={answered} onAnswer={answer} />}
      {revealed && st.keyIdea && (
        <Callout tone="tip" title="Key idea">
          <span className="text-[12.5px]">
            <Rich text={st.keyIdea} />
          </span>
        </Callout>
      )}
      {revealed && st.id === 'denorm' && (
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {[false, true].map((on) => (
            <button
              key={String(on)}
              onClick={() => toggleDenorm(on)}
              className={cn('flex-1 rounded-md py-1.5 font-mono text-[11.5px]', denorm === on ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}
            >
              {on ? 'Denormalized order_report' : '3NF: 4 tables'}
            </button>
          ))}
        </div>
      )}
      {revealed && st.id === 'bcnf' && (
        <Button size="sm" variant="danger" disabled={anaDate} onClick={insertAnaDate}>
          Try: INSERT ('Ana', 'Date') into enrollment
        </Button>
      )}
      {extra.length > 0 && <ChangeFeed changes={extra} label="What your action changed" />}
      {change && (
        <div>
          <div className="eyebrow mb-1">What this step changed</div>
          <ChangeCard change={change} />
        </div>
      )}
      {revealed && st.goodToKnow && (
        <Callout tone="info" title="Good to know">
          <span className="text-[12.5px]">
            <Rich text={st.goodToKnow} />
          </span>
        </Callout>
      )}
    </>
  );

  const center = (
    <div className="space-y-4 p-6">
      <MetricStrip st={shown} m={m} anaDate={anaDate} />
      {!revealed && (
        <div className="rounded-lg border border-accent/50 bg-surface/95 px-3 py-2 font-mono text-[11px] text-accent shadow-paper">
          ← make a prediction to play this step (showing the previous step)
        </div>
      )}
      <LayoutGroup>
        <motion.div layout className="flex flex-wrap items-start gap-4">
          <AnimatePresence mode="popLayout">
            {tables.map((t) => (
              <TableCard
                key={t.id}
                t={t}
                fds={fdsOf(t, shown)}
                focus={focus}
                focusMulti={shown.focus.kind === 'multi'}
                dup={redundancy(t, fdsOf(t, shown)).cells}
                colW={t.cols.length <= 3 ? 104 : 92}
                rowTone={(r) => (anaDate && t.id === 'enroll' && r.student === 'Ana' && r.instructor === 'Date' ? 'warn' : undefined)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      </LayoutGroup>
      {shown.id === 'bcnf' && <JoinCheck anaDate={anaDate} />}
      {shown.id === 'denorm' && <DenormCompare denorm={denorm} />}
      <Legend />
    </div>
  );

  const fullFooter = (
    <>
      <div className="border-t border-line p-3">
        <StepControls stepper={stepper} speeds={[0.5, 1, 2]} />
      </div>
      {footer}
    </>
  );

  return <Shell header={header} footer={fullFooter} left={left} center={center} />;
}

const TABLES_FOR = (denorm: boolean, st: NFStep) => (denorm ? [ORDER_REPORT] : st.tables);

function MetricStrip({ st, m, anaDate }: { st: NFStep; m: SchemaMetrics; anaDate: boolean }) {
  if (st.domain === 'enroll') {
    const isSplit = st.id === 'bcnf';
    return (
      <div className="grid grid-cols-4 gap-2">
        <Metric label="Tables" value={m.tables} />
        <Metric label="Duplicated values" value={m.dup} tone={m.dup ? 'warn' : 'ok'} sub="instructor→course copies" />
        <Metric label="Join returns" value={isSplit ? `${anaDate ? 6 : 5} rows` : 'n/a'} tone={isSplit ? (anaDate ? 'bad' : 'ok') : undefined} sub={isSplit ? 'original: 5 rows' : 'single table'} />
        <Metric label="FDs enforced by keys" value={isSplit ? '1 of 2' : '1 of 2'} tone={isSplit ? 'bad' : 'warn'} sub={isSplit ? 'lost {student, course} → instructor' : 'instructor → course is not a key'} />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-5 gap-2">
      <Metric label="Tables · rows" value={`${m.tables} · ${m.rows}`} sub={`${m.cells} cells stored`} />
      <Metric label="Duplicated values" value={m.dup} tone={m.dup ? (m.dup > 10 ? 'bad' : 'warn') : 'ok'} sub="amber cells" />
      <Metric label="Order report" value={`${m.joins} joins`} tone={m.joins >= 3 ? 'warn' : m.joins ? 'info' : 'ok'} sub={`${m.tables} table${m.tables > 1 ? 's' : ''}`} />
      <Metric label="C1 moves" value={`${m.c1Move} row${m.c1Move > 1 ? 's' : ''}`} tone={m.c1Move > 1 ? 'bad' : 'ok'} sub="rows rewritten" />
      <Metric label="Mug price change" value={`${m.p2Price} row${m.p2Price > 1 ? 's' : ''}`} tone={m.p2Price > 1 ? 'bad' : 'ok'} sub="rows rewritten" />
    </div>
  );
}

function JoinCheck({ anaDate }: { anaDate: boolean }) {
  const teaches = [
    { instructor: 'Codd', course: 'Databases' },
    { instructor: 'Date', course: 'Databases' },
    { instructor: 'Ritchie', course: 'Systems' },
  ];
  const enroll: Row[] = ENROLL_ROWS.map((r) => ({ student: r.student, instructor: r.instructor }));
  if (anaDate) enroll.push({ student: 'Ana', instructor: 'Date' });
  const joined = naturalJoin(enroll, teaches);
  const count = new Map<string, number>();
  for (const r of joined) count.set(`${r.student}|${r.course}`, (count.get(`${r.student}|${r.course}`) ?? 0) + 1);
  return (
    <motion.div layout className="max-w-md rounded-xl border border-line bg-surface p-2.5">
      <div className="font-mono text-[12px] font-semibold">enrollment ⋈ teaches</div>
      <div className="mb-1 font-mono text-[10px] text-faint">join on instructor · {joined.length} rows</div>
      {joined.map((r, i) => {
        const bad = (count.get(`${r.student}|${r.course}`) ?? 0) > 1;
        return (
          <motion.div
            layout
            key={`${r.student}${r.instructor}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.04 }}
            className={cn('flex gap-3 border-b border-line/50 px-1 py-0.5 font-mono text-[11px] last:border-b-0', bad && 'bg-bad/10 text-bad')}
          >
            <span className="w-16">{String(r.student)}</span>
            <span className="w-20">{String(r.course)}</span>
            <span className="w-16">{String(r.instructor)}</span>
            {bad && <span className="font-semibold">2 instructors for one course</span>}
          </motion.div>
        );
      })}
    </motion.div>
  );
}

function DenormCompare({ denorm }: { denorm: boolean }) {
  const rows: [string, string, string, boolean][] = [
    ['Joins per order report', '3', '0', false],
    ['Rows touched: C1 moves', '1', '4', true],
    ['Rows touched: Mug price change', '1', '3', true],
    ['…for a customer with 200 orders × 3 lines', '1', '600', true],
    ['Duplicated values', '0', '22', true],
    ['Anomalies (update/insert/delete)', 'none', 'all three', true],
  ];
  return (
    <motion.div layout className="max-w-2xl rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 grid grid-cols-[1fr_120px_160px] gap-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">
        <span>Tradeoff</span>
        <span className={cn(!denorm && 'text-accent')}>3NF</span>
        <span className={cn(denorm && 'text-accent')}>Denormalized</span>
      </div>
      {rows.map(([k, a, b, writeSide]) => (
        <div key={k} className="grid grid-cols-[1fr_120px_160px] gap-2 border-t border-line/60 py-1 font-mono text-[11.5px]">
          <span className="text-muted">{k}</span>
          <span className={cn(writeSide ? 'text-ok' : 'text-warn', !denorm && 'font-semibold')}>{a}</span>
          <span className={cn(writeSide ? 'text-bad' : 'text-ok', denorm && 'font-semibold')}>{b}</span>
        </div>
      ))}
      <Callout tone="tip" title="Senior answer: derive, don't duplicate" className="mt-3">
        <span className="text-[12.5px]">
          Keep 3NF as the write model. Serve hot reads from a <b>derived</b> wide shape: a materialized view (<code>REFRESH MATERIALIZED VIEW CONCURRENTLY</code>), a CDC-fed read table, or a warehouse
          OBT. Writes stay 1 row; reads skip joins; the cost is staleness and a rebuild pipeline, not anomalies.
        </span>
      </Callout>
    </motion.div>
  );
}

function Legend() {
  const items: [string, string][] = [
    ['bg-ok', 'determinant is a key'],
    ['bg-bad', 'partial: part of key → non-key'],
    ['bg-warn', 'transitive: non-key → non-key'],
    ['bg-violet', 'non-key → part of key (BCNF)'],
    ['bg-info', 'implied FD, intermediate gone'],
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-muted">
      <span className="eyebrow">FD lanes</span>
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1">
          <span className={cn('h-0.5 w-4 rounded', c)} /> {l}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-3 rounded-sm bg-warn/30" /> duplicated value
      </span>
    </div>
  );
}
