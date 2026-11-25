import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertOctagon, ArrowRight, Bug, CheckCircle2, Circle, Database, FileWarning, RotateCcw, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, CodeBlock } from '@/shared/ui';
import type { Change } from '../../ui/ChangeCard';
import { PredictCard } from '../../ui/Predict';
import { Rich } from '../../ui/Rich';
import { BUG_PREDICT, LAYERS, MALFORMED_PREDICT, TRANSFORMS, type Layer } from './data';
import { dayLabel } from './engine';

type Scenario = 'none' | 'bug' | 'malformed';

const TONE: Record<string, string> = { warn: 'border-warn/50', info: 'border-info/50', accent: 'border-accent/60' };
const TEXT: Record<string, string> = { warn: 'text-warn', info: 'text-info', accent: 'text-accent' };
const DAYS = [5, 4, 3, 2, 1, 0];

export function Medallion({
  onChange,
  onPredict,
  onSolved,
  solved,
}: {
  onChange: (c: Change) => void;
  onPredict: (key: string, right: boolean) => void;
  onSolved: () => void;
  solved: boolean;
}) {
  const [scenario, setScenario] = useState<Scenario>('none');
  const [bugAns, setBugAns] = useState<number | undefined>();
  const [badAns, setBadAns] = useState<number | undefined>();
  const [phase, setPhase] = useState(0);

  const revealed = (scenario === 'bug' && bugAns !== undefined) || (scenario === 'malformed' && badAns !== undefined);

  useEffect(() => {
    setPhase(0);
    if (!revealed) return;
    const ts = [setTimeout(() => setPhase(1), 500), setTimeout(() => setPhase(2), 1300), setTimeout(() => setPhase(3), 2100)];
    return () => ts.forEach(clearTimeout);
  }, [revealed, scenario]);

  const pick = (s: Scenario) => {
    setScenario(s);
    onChange(
      s === 'bug'
        ? {
            key: `med-bug-${Date.now()}`,
            title: 'Incident: gold revenue bug shipped 3 days ago',
            lines: [
              { tone: 'bad', text: `\`gold.daily_revenue\` partitions ${dayLabel(2)} … ${dayLabel(0)} are wrong (refunds double-counted). Finance dashboards show inflated numbers.` },
              { tone: 'info', text: 'Bronze and silver were not touched by the bug.' },
            ],
          }
        : {
            key: `med-bad-${Date.now()}`,
            title: 'A malformed record arrives from a producer',
            lines: [{ tone: 'warn', text: '`event_ts = "yesterday-ish"` cannot be cast to TIMESTAMP. 1 bad record among ~95k/s good ones.' }],
          },
    );
  };

  const answerBug = (i: number, right: boolean) => {
    setBugAns(i);
    onPredict('medallion-bug', right);
    onChange({
      key: `med-bug-fix-${Date.now()}`,
      title: 'Replayed gold from silver for 3 day-partitions',
      lines: [
        { tone: 'ok', text: '`INSERT OVERWRITE gold.daily_revenue` for 3 days: reads ~3 days of silver orders, minutes of compute, no source re-ingestion.' },
        { tone: 'ok', text: 'Bronze and silver untouched; dashboards corrected; downstream consumers notified via lineage.' },
        { tone: 'info', text: 'If silver had been wrong too: replay silver from bronze (raw, append-only), then gold from silver.' },
      ],
    });
  };
  const answerBad = (i: number, right: boolean) => {
    setBadAns(i);
    onPredict('medallion-malformed', right);
    onChange({
      key: `med-bad-fix-${Date.now()}`,
      title: 'Quarantined 1 record, pipeline kept flowing',
      lines: [
        { tone: 'ok', text: 'Raw bytes kept in `bronze.events_raw` (offset 8812331): nothing lost.' },
        { tone: 'ok', text: '`silver.events_quarantine` gets the record + error + source offset; 0 bad rows in silver; good records unaffected.' },
        { tone: 'info', text: 'Alert on quarantine rate (e.g. > 0.1%); after fixing the parser, replay the quarantined offsets from bronze.' },
      ],
    });
  };

  const goldChip = (d: number) => {
    if (scenario !== 'bug' || d > 2) return 'border-line bg-surface text-muted';
    if (!revealed || phase < 2) return 'border-bad/60 bg-bad/10 text-bad';
    return 'border-ok/60 bg-ok/10 text-ok';
  };

  return (
    <div className="space-y-4">
      {/* flow */}
      <div className="flex items-stretch gap-1.5">
        <div className="flex w-[92px] shrink-0 flex-col justify-center rounded-xl border border-dashed border-line bg-surface/60 p-2 text-center font-mono text-[10.5px] text-muted">
          <Database size={14} className="mx-auto mb-1 text-faint" />
          Kafka · CDC · files
          <div className="relative mt-2 h-4">
            <AnimatePresence>
              {scenario === 'malformed' && (!revealed || phase === 0) && (
                <motion.span layoutId="bad-record" className="absolute left-1/2 top-0 block h-3.5 w-3.5 -translate-x-1/2 rounded-sm bg-bad" />
              )}
            </AnimatePresence>
          </div>
        </div>
        {LAYERS.map((L, li) => (
          <div key={L.id} className="flex min-w-0 flex-1 items-stretch gap-1.5">
            <ArrowRight size={14} className={cn('shrink-0 self-center', scenario === 'bug' && li === 2 && revealed && phase >= 1 ? 'animate-pulse-soft text-ok' : 'text-faint')} />
            <div className={cn('flex min-w-0 flex-1 flex-col rounded-xl border-2 bg-surface p-2.5', TONE[L.tone])}>
              <div className={cn('font-mono text-[12px] font-semibold', TEXT[L.tone])}>{L.name}</div>
              <div className="font-mono text-[9.5px] text-faint">{L.example}</div>
              <ul className="mt-1.5 space-y-0.5 text-[11.5px] leading-snug text-muted">
                {L.guarantees.map((g) => (
                  <li key={g} className="flex gap-1">
                    <span className="text-faint">·</span>
                    <span>
                      <Rich text={g} />
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-1">
                {DAYS.map((d) => (
                  <motion.span
                    key={d}
                    layout
                    animate={{ scale: L.id === 'gold' && scenario === 'bug' && revealed && phase === 2 && d <= 2 ? [1, 1.15, 1] : 1 }}
                    className={cn('rounded border px-1 font-mono text-[9px] transition-colors duration-500', L.id === 'gold' ? goldChip(d) : 'border-line bg-surface text-muted')}
                  >
                    {dayLabel(d).slice(5)}
                  </motion.span>
                ))}
              </div>
              <div className="relative mt-2 min-h-[18px]">
                <AnimatePresence>
                  {scenario === 'malformed' && revealed && phase >= 1 && L.id === 'bronze' && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1 font-mono text-[9.5px] text-warn">
                      <span className="block h-2.5 w-2.5 rounded-sm bg-warn" /> raw copy kept
                    </motion.div>
                  )}
                  {scenario === 'malformed' && revealed && phase === 1 && L.id === 'silver' && (
                    <motion.span layoutId="bad-record" className="block h-3.5 w-3.5 rounded-sm bg-bad" />
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        ))}
        <ArrowRight size={14} className="shrink-0 self-center text-faint" />
        <div className="flex w-[80px] shrink-0 flex-col justify-center rounded-xl border border-dashed border-line bg-surface/60 p-2 text-center font-mono text-[10.5px] text-muted">
          BI · ML · reverse ETL
        </div>
      </div>

      {/* quarantine lane */}
      <div className="ml-[33%] flex items-center gap-2">
        <div className={cn('flex min-h-[44px] flex-1 items-center gap-2 rounded-xl border border-dashed p-2', scenario === 'malformed' && revealed && phase >= 2 ? 'border-bad/60 bg-bad/[0.05]' : 'border-line')}>
          <FileWarning size={14} className="shrink-0 text-bad" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[11px] text-ink">silver.events_quarantine</div>
            <div className="font-mono text-[9.5px] text-faint">raw STRING · error STRING · source_offset BIGINT · ingest_ts TIMESTAMP</div>
          </div>
          <AnimatePresence>{scenario === 'malformed' && revealed && phase >= 2 && <motion.span layoutId="bad-record" className="block h-3.5 w-3.5 shrink-0 rounded-sm bg-bad" />}</AnimatePresence>
        </div>
      </div>

      {/* scenarios */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={scenario === 'bug' ? 'primary' : 'secondary'} icon={<Bug size={13} />} onClick={() => pick('bug')}>
          Gold revenue bug, 3 days ago
        </Button>
        <Button size="sm" variant={scenario === 'malformed' ? 'primary' : 'secondary'} icon={<AlertOctagon size={13} />} onClick={() => pick('malformed')}>
          A malformed record arrives
        </Button>
      </div>
      {scenario === 'bug' && <PredictCard key="bug" predict={BUG_PREDICT} answered={bugAns} onAnswer={answerBug} />}
      {scenario === 'malformed' && <PredictCard key="bad" predict={MALFORMED_PREDICT} answered={badAns} onAnswer={answerBad} />}
      {scenario === 'bug' && revealed && phase >= 3 && (
        <CodeBlock
          language="sql"
          code={`-- fixed logic, recompute only the affected partitions
INSERT OVERWRITE gold.daily_revenue
SELECT order_date, country, SUM(amount) - SUM(refund_amount) AS revenue
FROM silver.orders
WHERE order_date >= DATE '${dayLabel(2)}'
GROUP BY order_date, country;`}
        />
      )}
      {scenario === 'bug' && bugAns !== undefined && bugAns !== BUG_PREDICT.answer && (
        <Callout tone="bad" title={bugAns === 3 ? 'Hand-patching gold is not reproducible' : bugAns === 0 ? 'Re-ingesting from sources is the slow, risky path' : 'Restoring a backup loses 3 days of good data'}>
          <span className="text-[12.5px]">Gold is derived: fix the code and recompute the affected partitions from silver. Keep bronze for when silver itself is wrong.</span>
        </Callout>
      )}
      {scenario === 'malformed' && badAns !== undefined && badAns !== MALFORMED_PREDICT.answer && (
        <Callout tone="bad" title={badAns === 0 ? 'One bad producer halts every consumer' : 'Silent data loss corrupts metrics'}>
          <span className="text-[12.5px]">Quarantine with the error and source offset, keep flowing, alert on the rate, replay from bronze after the fix.</span>
        </Callout>
      )}

      <Classify onChange={onChange} onSolved={onSolved} solved={solved} />
    </div>
  );
}

function Classify({ onChange, onSolved, solved }: { onChange: (c: Change) => void; onSolved: () => void; solved: boolean }) {
  const [assign, setAssign] = useState<Record<string, Layer>>({});
  const [checked, setChecked] = useState(false);
  const right = TRANSFORMS.filter((t) => assign[t.id] === t.layer).length;
  const all = Object.keys(assign).length === TRANSFORMS.length;

  const place = (id: string, layer: Layer) => {
    setAssign((a) => ({ ...a, [id]: layer }));
    setChecked(false);
    const t = TRANSFORMS.find((x) => x.id === id)!;
    const L = LAYERS.find((x) => x.id === layer)!;
    onChange({ key: `cls-${id}-${layer}-${Date.now()}`, title: `Placed “${t.text.slice(0, 48)}…” in **${layer}**`, lines: [{ tone: 'info', text: `${L.name} promises: ${L.guarantees.join('; ').replace(/\*\*/g, '')}.` }] });
  };

  const check = () => {
    setChecked(true);
    const wrong = TRANSFORMS.filter((t) => assign[t.id] !== t.layer);
    onChange({
      key: `cls-check-${Date.now()}`,
      title: `Checked classification: ${right} / ${TRANSFORMS.length} right`,
      lines: wrong.length
        ? wrong.map((t) => ({ tone: 'bad' as const, text: `“${t.text.slice(0, 60)}…” belongs in **${t.layer}**, not ${assign[t.id] ?? 'nowhere'}.` }))
        : [{ tone: 'ok', text: 'All 8 placed correctly: exercise solved.' }],
    });
    if (!wrong.length) onSolved();
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow">Exercise · classify the transformations</div>
          <p className="text-[12.5px] text-muted">Which layer owns each step? Bronze = raw & replayable, silver = clean & conformed, gold = consumption.</p>
        </div>
        {solved && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-ok">
            <CheckCircle2 size={13} /> solved
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {TRANSFORMS.map((t) => {
          const a = assign[t.id];
          const ok = checked && a === t.layer;
          const bad = checked && a !== t.layer;
          return (
            <li key={t.id} className={cn('rounded-lg border p-2', ok ? 'border-ok/50 bg-ok/[0.05]' : bad ? 'border-bad/50 bg-bad/[0.05]' : 'border-line')}>
              <div className="flex items-start gap-2">
                {ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" /> : bad ? <XCircle size={14} className="mt-0.5 shrink-0 text-bad" /> : <Circle size={14} className="mt-0.5 shrink-0 text-faint" />}
                <span className="flex-1 text-[12.5px] leading-snug text-ink">{t.text}</span>
                <div className="flex shrink-0 gap-1">
                  {LAYERS.map((L) => (
                    <button
                      key={L.id}
                      onClick={() => place(t.id, L.id)}
                      className={cn(
                        'rounded border px-1.5 py-0.5 font-mono text-[10.5px] transition-colors',
                        a === L.id ? cn('bg-ink/[0.06] font-semibold', TONE[L.tone], TEXT[L.tone]) : 'border-line text-muted hover:border-ink/30',
                      )}
                    >
                      {L.id}
                    </button>
                  ))}
                </div>
              </div>
              {checked && <p className={cn('mt-1 pl-6 text-[11.5px]', ok ? 'text-muted' : 'text-bad')}>{ok ? t.why : `Belongs in ${t.layer}: ${t.why}`}</p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={!all} onClick={check}>
          Check ({Object.keys(assign).length}/{TRANSFORMS.length})
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={13} />}
          onClick={() => {
            setAssign({});
            setChecked(false);
          }}
        >
          Reset
        </Button>
        {checked && <span className={cn('font-mono text-[12px]', right === TRANSFORMS.length ? 'text-ok' : 'text-warn')}>{right} / {TRANSFORMS.length} right</span>}
      </div>
    </div>
  );
}
