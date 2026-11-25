import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Calculator, CheckCircle2, ClipboardCheck, FileWarning, Scale, Siren, Wrench, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout } from '@/shared/ui';
import { applyOps, describeOp } from '../data/lesson';
import { DECISIONS, INCIDENTS, SIZING, SPOT } from '../data/drills';
import { useKafka } from '../store';
import { NO_CHAOS } from '../types';
import { PageBar } from '../ui/PageBar';
import { Rich } from '../ui/Rich';
import { useLab } from '../ui/useLab';
import { Workbench } from '../ui/Workbench';

const KINDS = [
  { id: 'incident', title: 'Incident response', icon: Siren, blurb: 'Paged at 3 a.m. Read the live simulated system, pick the root cause, apply the fix and watch the metrics recover.', items: INCIDENTS.map((x) => ({ id: x.id, title: x.title })) },
  { id: 'sizing', title: 'Capacity math', icon: Calculator, blurb: 'Partition counts, consumer counts, disk and network. The back-of-envelope numbers interviews and design reviews ask for.', items: SIZING.map((x) => ({ id: x.id, title: x.story })) },
  { id: 'spot', title: 'Spot the bad config', icon: FileWarning, blurb: 'Code-review a producer, topic or consumer config. Click every line that would hurt in production.', items: SPOT.map((x) => ({ id: x.id, title: x.title })) },
  { id: 'decision', title: 'Trade-off calls', icon: Scale, blurb: 'Several workable options, one best. Judge each and learn why the others lose.', items: DECISIONS.map((x) => ({ id: x.id, title: x.scenario })) },
] as const;

export function DrillsHome() {
  const drills = useKafka((s) => s.drills);
  return (
    <div className="flex h-full flex-col">
      <PageBar eyebrow="Judgment drills" title="Think like the on-call engineer" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
          <p className="max-w-3xl text-[13px] leading-relaxed text-muted">
            Knowing configs isn’t the same as making good calls under pressure. These drills mix every lesson together (interleaving), so you practise <b className="text-ink">choosing</b> the right concept, not just recalling it.
          </p>
          {KINDS.map((k) => (
            <section key={k.id}>
              <div className="flex items-center gap-2">
                <k.icon size={16} className="text-accent" />
                <h2 className="font-mono text-[15px] font-semibold">{k.title}</h2>
                <span className="text-[12px] text-faint">
                  {k.items.filter((it) => drills[`${k.id}:${it.id}`]).length}/{k.items.length} done
                </span>
              </div>
              <p className="mt-0.5 text-[12.5px] text-muted">{k.blurb}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {k.items.map((it) => {
                  const r = drills[`${k.id}:${it.id}`];
                  return (
                    <Link key={it.id} to={`/kafka/drills/${k.id}/${it.id}`} className="flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-paper hover:-translate-y-0.5 hover:shadow-lift">
                      <span className="flex-1 text-[12.5px] leading-snug">
                        <Rich text={it.title} />
                      </span>
                      {r && <span className={cn('rounded-full px-1.5 font-mono text-[10.5px]', r.best >= 100 ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn')}>{r.best}%</span>}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DrillPage() {
  const { kind = '', id = '' } = useParams();
  const meta = KINDS.find((k) => k.id === kind);
  const idx = meta?.items.findIndex((x) => x.id === id) ?? -1;
  if (!meta || idx < 0) return <Navigate to="/kafka/drills" replace />;
  const next = meta.items[idx + 1];
  const nextLink = next ? (
    <Link to={`/kafka/drills/${kind}/${next.id}`}>
      <Button size="sm">
        Next drill <ArrowRight size={13} className="ml-1" />
      </Button>
    </Link>
  ) : (
    <Link to="/kafka/drills">
      <Button size="sm" variant="secondary">
        All drills
      </Button>
    </Link>
  );
  const body =
    kind === 'incident' ? <IncidentDrill key={id} id={id} nextLink={nextLink} /> : kind === 'sizing' ? <SizingDrill key={id} id={id} nextLink={nextLink} /> : kind === 'spot' ? <SpotDrill key={id} id={id} nextLink={nextLink} /> : <DecisionDrill key={id} id={id} nextLink={nextLink} />;
  return (
    <div className="flex h-full flex-col">
      <PageBar back="/kafka/drills" backLabel="Drills" eyebrow={`${meta.title} · ${idx + 1}/${meta.items.length}`} title={kind === 'incident' ? INCIDENTS[idx].title : meta.title} />
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

const Scroll = ({ children }: { children: React.ReactNode }) => (
  <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">{children}</div>
  </div>
);

/* ---------------- Incident: live system, diagnose, fix, verify ---------------- */

function IncidentDrill({ id, nextLink }: { id: string; nextLink: React.ReactNode }) {
  const inc = INCIDENTS.find((x) => x.id === id)!;
  const st = useKafka();
  const lab = useLab(inc.graph, { initialChaos: { ...NO_CHAOS, ...inc.chaos } });
  const [ans, setAns] = useState<number | null>(null);
  const [fixed, setFixed] = useState(false);
  const pick = (k: number) => {
    if (ans !== null) return;
    setAns(k);
    st.recordDrill('incident', inc.id, k === inc.answer ? 100 : 0);
  };
  const applyFix = () => {
    const next = applyOps(lab.g, inc.fix.ops);
    const what = inc.fix.ops.map((o) => describeOp(lab.g, o, (x) => lab.names[x] ?? x)).join(' · ');
    lab.commit(next, `Fix: ${inc.fix.label}${what ? ` (${what})` : ''}`, inc.fix.note, 'lesson');
    if (inc.fix.chaos) lab.setChaos({ ...lab.chaos, ...inc.fix.chaos }, 'Failure condition resolved');
    setFixed(true);
  };
  const left = (
    <div className="space-y-3">
      <div className="rounded-lg border border-bad/40 bg-bad/5 px-2.5 py-2 font-mono text-[11.5px] leading-snug text-bad">
        <Siren size={12} className="mr-1 inline" />
        {inc.alert}
      </div>
      <div>
        <div className="eyebrow">What you see</div>
        <ul className="mt-1 space-y-1 text-[12px] leading-snug text-muted">
          {inc.signals.map((s, k) => (
            <li key={k} className="flex gap-1.5">
              <span className="text-faint">•</span>
              <span>
                <Rich text={s} />
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[11px] text-faint">Inspect the canvas: click nodes, open “Inside the cluster”, check the metric strip.</p>
      </div>
      <div>
        <div className="eyebrow">Diagnose</div>
        <p className="mt-1 text-[12.5px] font-medium leading-snug">
          <Rich text={inc.question} />
        </p>
        <div className="mt-1.5 grid gap-1">
          {inc.options.map((o, k) => {
            const isAns = k === inc.answer;
            return (
              <button
                key={k}
                disabled={ans !== null}
                onClick={() => pick(k)}
                className={cn(
                  'flex items-start gap-1.5 rounded-lg border px-2 py-1 text-left text-[12px] leading-snug',
                  ans === null && 'border-line bg-surface hover:border-accent',
                  ans !== null && isAns && 'border-ok/50 bg-ok/10',
                  ans === k && !isAns && 'border-bad/50 bg-bad/10',
                  ans !== null && !isAns && ans !== k && 'opacity-50',
                )}
              >
                <span className="flex-1">
                  <Rich text={o} />
                </span>
                {ans !== null && isAns && <CheckCircle2 size={13} className="text-ok" />}
                {ans === k && !isAns && <XCircle size={13} className="text-bad" />}
              </button>
            );
          })}
        </div>
      </div>
      {ans !== null && (
        <>
          <p className="text-[12px] leading-relaxed text-muted">
            <Rich text={inc.explain} />
          </p>
          {!fixed ? (
            <Button size="sm" variant="success" icon={<Wrench size={13} />} onClick={applyFix}>
              Apply fix: {inc.fix.label}
            </Button>
          ) : (
            <div className="space-y-2">
              <Callout tone="ok">
                <span className="text-[12px]">Fix applied. The Impact tab shows exactly which metrics recovered and why.</span>
              </Callout>
              <div>
                <div className="eyebrow">What a strong engineer does next</div>
                <ul className="mt-1 space-y-1 text-[12px] leading-snug">
                  {inc.followUp.map((s, k) => (
                    <li key={k} className="flex gap-1.5">
                      <ClipboardCheck size={12} className="mt-0.5 shrink-0 text-ok" />
                      <span>
                        <Rich text={s} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {nextLink}
            </div>
          )}
        </>
      )}
    </div>
  );
  return <Workbench lab={lab} left={left} locked={!fixed} chaos={fixed ? undefined : false} fitKey={id} defaultTab={fixed ? 'impact' : 'inspect'} hideIssues={ans === null} onPredict={st.recordChaos} />;
}

/* ---------------- Sizing ---------------- */

function SizingDrill({ id, nextLink }: { id: string; nextLink: React.ReactNode }) {
  const s = SIZING.find((x) => x.id === id)!;
  const rec = useKafka((x) => x.recordDrill);
  const [val, setVal] = useState('');
  const [done, setDone] = useState<null | { right: boolean; off: number }>(null);
  const submit = () => {
    const v = Number(val.replace(/[, ]/g, ''));
    if (!Number.isFinite(v)) return;
    const right = Math.abs(v - s.answer) <= s.tolerance;
    setDone({ right, off: v - s.answer });
    rec('sizing', s.id, right ? 100 : Math.max(0, Math.round(100 - (Math.abs(v - s.answer) / s.answer) * 100)));
  };
  return (
    <Scroll>
      <h2 className="font-mono text-lg font-semibold">
        <Rich text={s.story} />
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {s.given.map((g) => (
          <div key={g.label} className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="eyebrow">{g.label}</div>
            <div className="font-mono text-[15px] font-semibold">{g.value}</div>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-faint">Work it out on paper first. Writing the formula is half the interview answer.</p>
      <div className="flex items-center gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          disabled={!!done}
          placeholder="your answer"
          className="w-40 rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-[14px] outline-none focus:border-accent"
        />
        <span className="font-mono text-[13px] text-muted">{s.unit}</span>
        <Button size="sm" onClick={submit} disabled={!!done || !val}>
          Check
        </Button>
      </div>
      {done && (
        <div className={cn('rounded-xl border p-3.5', done.right ? 'border-ok/40 bg-ok/5' : 'border-bad/40 bg-bad/5')}>
          <div className={cn('font-mono text-[13px] font-semibold', done.right ? 'text-ok' : 'text-bad')}>
            {done.right ? 'Correct' : `Expected ${s.answer.toLocaleString()} ${s.unit} (you were ${done.off > 0 ? 'high' : 'low'} by ${Math.abs(done.off).toLocaleString()})`}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink/90">
            <Rich text={s.explain} />
          </p>
          <div className="mt-3">{nextLink}</div>
        </div>
      )}
    </Scroll>
  );
}

/* ---------------- Spot the bad config ---------------- */

function SpotDrill({ id, nextLink }: { id: string; nextLink: React.ReactNode }) {
  const s = SPOT.find((x) => x.id === id)!;
  const rec = useKafka((x) => x.recordDrill);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [done, setDone] = useState(false);
  const score = useMemo(() => {
    const hits = s.bad.filter((b) => sel.has(b)).length;
    const fp = [...sel].filter((x) => !s.bad.includes(x)).length;
    return Math.max(0, Math.round(((hits - fp) / s.bad.length) * 100));
  }, [sel, s]);
  return (
    <Scroll>
      <div>
        <h2 className="font-mono text-lg font-semibold">{s.title}</h2>
        <p className="mt-1 text-[13px] text-muted">
          <Rich text={s.context} />
        </p>
      </div>
      <p className="text-[12px] text-faint">Click every line that’s a problem, then submit. False positives cost points, as in a real review.</p>
      <div className="overflow-hidden rounded-xl border border-line bg-[#1b1d23] font-mono text-[13px]">
        {s.lines.map((l, k) => {
          const bad = s.bad.includes(k);
          const on = sel.has(k);
          return (
            <div key={k}>
              <button
                disabled={done}
                onClick={() => setSel((p) => (p.has(k) ? new Set([...p].filter((x) => x !== k)) : new Set([...p, k])))}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-1.5 text-left text-[#d7dae0]',
                  !done && (on ? 'bg-warn/25' : 'hover:bg-white/5'),
                  done && bad && 'bg-bad/25',
                  done && on && !bad && 'bg-warn/15 line-through',
                )}
              >
                <span className="w-5 text-right text-[11px] text-[#6b7080]">{k + 1}</span>
                <span className="flex-1">{l}</span>
                {done && bad && (on ? <CheckCircle2 size={14} className="text-ok" /> : <AlertTriangle size={14} className="text-bad" />)}
              </button>
              {done && bad && (
                <div className="border-l-2 border-bad bg-[#24262e] px-3 py-1.5 pl-11 font-sans text-[12px] leading-snug text-[#c3c7d1]">
                  <Rich text={s.explain[k]} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!done ? (
        <Button
          size="sm"
          disabled={!sel.size}
          onClick={() => {
            setDone(true);
            rec('spot', s.id, score);
          }}
        >
          Submit review
        </Button>
      ) : (
        <div className="flex items-center gap-3">
          <span className={cn('font-mono text-[14px] font-semibold', score === 100 ? 'text-ok' : 'text-warn')}>Score {score}%</span>
          {nextLink}
        </div>
      )}
    </Scroll>
  );
}

/* ---------------- Decisions ---------------- */

function DecisionDrill({ id, nextLink }: { id: string; nextLink: React.ReactNode }) {
  const d = DECISIONS.find((x) => x.id === id)!;
  const rec = useKafka((x) => x.recordDrill);
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => setPick(null), [id]);
  const tone = { best: 'border-ok/50 bg-ok/10', ok: 'border-warn/50 bg-warn/10', bad: 'border-bad/50 bg-bad/10' };
  return (
    <Scroll>
      <h2 className="font-mono text-lg font-semibold leading-snug">
        <Rich text={d.scenario} />
      </h2>
      <div className="grid gap-2">
        {d.options.map((o, k) => (
          <button
            key={k}
            disabled={pick !== null}
            onClick={() => {
              setPick(k);
              rec('decision', d.id, o.verdict === 'best' ? 100 : o.verdict === 'ok' ? 50 : 0);
            }}
            className={cn('rounded-xl border px-3.5 py-2.5 text-left', pick === null ? 'border-line bg-surface hover:border-accent' : tone[o.verdict], pick !== null && pick !== k && 'opacity-80')}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-medium">
                <Rich text={o.label} />
              </span>
              {pick !== null && <span className={cn('ml-auto font-mono text-[10.5px] uppercase', o.verdict === 'best' ? 'text-ok' : o.verdict === 'ok' ? 'text-warn' : 'text-bad')}>{o.verdict === 'best' ? 'best' : o.verdict === 'ok' ? 'workable' : 'wrong'}{pick === k && ' · your pick'}</span>}
            </div>
            {pick !== null && (
              <p className="mt-1 text-[12.5px] leading-snug text-muted">
                <Rich text={o.why} />
              </p>
            )}
          </button>
        ))}
      </div>
      {pick !== null && nextLink}
    </Scroll>
  );
}
