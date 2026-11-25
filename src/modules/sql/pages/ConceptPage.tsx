import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Briefcase, Clock, Cpu, Eye, Hammer, Lightbulb, MessageSquareText, PenLine, Radar, Scale } from 'lucide-react';
import { Button, Callout, CodeBlock, Tag } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { Concept } from '../types';
import { CONCEPTS, conceptById } from '../content';
import { trackName } from '../content/tracks';
import { MASTERY_LABELS, mastery, useSql } from '../store';
import { DbBadge, InterviewHeat, LevelTag, MasteryDots, Md, Paras, trackTone } from '../ui/common';
import { useBootDb } from '../ui/hooks';
import { PipelineViewer } from '../ui/PipelineViewer';
import { QueryBuilder } from '../ui/QueryBuilder';
import { PracticeTab } from '../ui/Practice';
import { JudgmentList } from '../ui/Judgment';
import { PlanLab } from '../ui/PlanTree';
import { BTreeLab } from '../ui/BTreeLab';
import { IsolationSim } from '../ui/Isolation';

const TABS = [
  { id: 'understand', label: 'Understand', icon: BookOpen },
  { id: 'visualize', label: 'Visualize', icon: Eye },
  { id: 'build', label: 'Build', icon: Hammer },
  { id: 'practice', label: 'Practice', icon: PenLine },
  { id: 'judge', label: 'Judge', icon: Scale },
  { id: 'reflect', label: 'Reflect', icon: MessageSquareText },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function ConceptPage() {
  const { id } = useParams();
  const c = id ? conceptById(id) : undefined;
  const [params, setParams] = useSearchParams();
  const visit = useSql((s) => s.visit);
  const p = useSql((s) => (c ? s.concepts[c.id] : undefined));
  useBootDb();
  useEffect(() => {
    if (c) visit(c.id);
  }, [c, visit]);
  if (!c) return <Navigate to="/sql/concepts" replace />;

  const tab = (params.get('tab') as TabId) || 'understand';
  const setTab = (t: TabId) => setParams({ tab: t }, { replace: false });
  const idx = CONCEPTS.indexOf(c);
  const prev = CONCEPTS[idx - 1];
  const next = CONCEPTS[idx + 1];
  const m = mastery(c, p);
  const solved = c.exercises.filter((e) => p?.solved?.[e.id]).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <Link to="/sql/concepts" className="text-muted hover:text-ink">
              Concepts
            </Link>
            <span className="text-faint">/</span>
            <Tag tone={trackTone[c.track]}>{trackName(c.track)}</Tag>
            <LevelTag level={c.level} />
            <InterviewHeat n={c.interview} />
            <span className="flex items-center gap-1 text-faint">
              <Clock className="h-3 w-3" /> {c.minutes} min
            </span>
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">{c.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{c.tagline}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <DbBadge />
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <MasteryDots c={c} p={p} /> {MASTERY_LABELS[m]} · {solved}/{c.exercises.length} exercises
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map((t) => {
          if (t.id === 'build' && !c.build) return null;
          if (t.id === 'judge' && !c.judgment?.length) return null;
          const done =
            (t.id === 'visualize' && p?.visualized) ||
            (t.id === 'build' && (p?.built?.scratch || p?.built?.faded)) ||
            (t.id === 'practice' && solved === c.exercises.length && solved > 0) ||
            (t.id === 'judge' && c.judgment?.every((j) => p?.judged?.[j.id] !== undefined));
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition', tab === t.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {done && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
            </button>
          );
        })}
        <div className="ml-auto flex gap-1 pb-1">
          {prev && (
            <Link to={`/sql/c/${prev.id}`}>
              <Button size="xs" variant="ghost" icon={<ArrowLeft className="h-3 w-3" />}>
                {prev.title}
              </Button>
            </Link>
          )}
          {next && (
            <Link to={`/sql/c/${next.id}`}>
              <Button size="xs" variant="ghost">
                {next.title} <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          )}
        </div>
      </div>

      {tab === 'understand' && <Understand c={c} onNext={() => setTab('visualize')} />}
      {tab === 'visualize' && <Visualize c={c} onNext={() => setTab(c.build ? 'build' : 'practice')} />}
      {tab === 'build' && c.build && <QueryBuilder concept={c} />}
      {tab === 'practice' && <PracticeTab concept={c} />}
      {tab === 'judge' && <JudgmentList concept={c} />}
      {tab === 'reflect' && <Reflect c={c} />}
    </div>
  );
}

function Understand({ c, onNext }: { c: Concept; onNext: () => void }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-6">
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Lightbulb className="h-4 w-4 text-accent" /> Intuition
          </h2>
          <Paras items={c.intuition} />
        </section>
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Cpu className="h-4 w-4 text-info" /> How Postgres actually does it
          </h2>
          <Paras items={c.internals} />
        </section>
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <AlertTriangle className="h-4 w-4 text-bad" /> Mistakes that ship to production
          </h2>
          <div className="grid gap-2 md:grid-cols-2">
            {c.mistakes.map((m, i) => (
              <div key={i} className="rounded-lg border border-line bg-surface p-3 text-[13px]">
                <div className="font-medium text-ink">{m.title}</div>
                <div className="mt-1 text-muted">
                  <Md text={m.why} />
                </div>
                <div className="mt-1.5 text-ok">
                  <b>Fix:</b> <Md text={m.fix} />
                </div>
              </div>
            ))}
          </div>
        </section>
        <Button variant="primary" onClick={onNext} icon={<Eye className="h-4 w-4" />}>
          Now watch it run on real data
        </Button>
      </div>
      <aside className="space-y-5">
        <section className="rounded-lg border border-line bg-surface p-4">
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Radar className="h-4 w-4 text-violet" /> Reach for it when the question says…
          </h3>
          <ul className="space-y-1 text-[13px] text-muted">
            {c.signals.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-violet">›</span>
                <Md text={s} />
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="eyebrow mb-1">Template</div>
          <CodeBlock code={c.template.trim()} language="sql" showLineNumbers={false} className="text-[12px]" />
        </section>
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Briefcase className="h-4 w-4 text-ok" /> Where you’ll meet it at work
          </h3>
          {c.realWorld.map((r, i) => (
            <div key={i} className="rounded-lg border border-line bg-sunken/40 p-3 text-[13px]">
              <div className="font-medium text-ink">{r.title}</div>
              <div className="mt-0.5 text-muted">
                <Md text={r.body} />
              </div>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}

function Visualize({ c, onNext }: { c: Concept; onNext: () => void }) {
  const predictMode = useSql((s) => s.predictMode);
  const setPredictMode = useSql((s) => s.setPredictMode);
  const recordPrediction = useSql((s) => s.recordPrediction);
  const patch = useSql((s) => s.patch);
  const visualized = useSql((s) => !!s.concepts[c.id]?.visualized);
  const [finished, setFinished] = useState(false);
  const markDone = () => {
    patch(c.id, { visualized: true });
    setFinished(true);
  };

  const pipeline = (
    <PipelineViewer
      key={c.id}
      sql={c.worked.sql}
      notes={c.worked.notes}
      predictions={c.worked.predictions}
      predictMode={predictMode}
      recursiveLevel={c.worked.recursiveLevel}
      onPredict={(ok) => recordPrediction(c.id, ok)}
      onFinished={markDone}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <div className="eyebrow">Worked example</div>
          <div className="mt-0.5 text-[15px] font-medium text-ink">
            <Md text={c.worked.question} />
          </div>
        </div>
        {(c.viz === 'pipeline' || c.viz === 'recursive' || c.viz === 'isolation') && (
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={predictMode} onChange={(e) => setPredictMode(e.target.checked)} />
            Predict before each reveal (recommended)
          </label>
        )}
      </div>

      {(c.viz === 'pipeline' || c.viz === 'recursive') && pipeline}

      {c.viz === 'index' && (
        <>
          <BTreeLab />
          {c.variants && c.variants.length > 0 && (
            <section className="space-y-2 border-t border-line pt-5">
              <h2 className="text-[15px] font-semibold text-ink">Same idea on 200k real rows: EXPLAIN ANALYZE each variant</h2>
              <PlanLab variants={c.variants} />
            </section>
          )}
        </>
      )}
      {c.viz === 'plan' && c.variants && <PlanLab variants={c.variants} />}
      {c.viz === 'isolation' && (
        <>
          <IsolationSim scenarios={c.scenarios} />
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-[13px] font-medium text-ink">The single-session query behind this concept, stage by stage</summary>
            <div className="mt-3">{pipeline}</div>
          </details>
        </>
      )}

      {(finished || visualized) && (
        <Callout tone="ok" title="Takeaway">
          <Md text={c.worked.takeaway} />
        </Callout>
      )}
      <div className="flex flex-wrap gap-2">
        {(c.viz === 'index' || c.viz === 'plan' || c.viz === 'isolation') && !visualized && (
          <Button variant="secondary" onClick={markDone}>
            I’ve explored this
          </Button>
        )}
        <Button variant="primary" onClick={onNext} icon={<Hammer className="h-4 w-4" />}>
          {c.build ? 'Rebuild it from blocks' : 'Practise it'}
        </Button>
      </div>
    </div>
  );
}

function Reflect({ c }: { c: Concept }) {
  const note = useSql((s) => s.concepts[c.id]?.note ?? '');
  const patch = useSql((s) => s.patch);
  const recordDrill = useSql((s) => s.recordDrill);
  const transfer = useSql((s) => s.transfer);
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const [tShown, setTShown] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState(note);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="space-y-2">
        <h2 className="text-[15px] font-semibold text-ink">Recall check</h2>
        <p className="text-[13px] text-muted">Answer out loud or in your head first, then reveal. Retrieval — not re-reading — is what makes it stick.</p>
        {c.recall.map((r, i) => (
          <div key={i} className="rounded-lg border border-line bg-surface p-3 text-[13px]">
            <div className="font-medium text-ink">
              <Md text={r.q} />
            </div>
            {shown[i] ? (
              <div className="mt-1.5 text-muted">
                <Md text={r.a} />
              </div>
            ) : (
              <Button size="xs" variant="ghost" className="mt-1" onClick={() => setShown((s) => ({ ...s, [i]: true }))}>
                reveal
              </Button>
            )}
          </div>
        ))}
      </section>
      <div className="space-y-6">
        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold text-ink">Explain it to a junior engineer</h2>
          <p className="text-[13px] text-muted">Two or three sentences: what problem it solves, how the database does it, and the trap to avoid. Writing it exposes gaps.</p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => patch(c.id, { note: draft })}
            rows={5}
            className="w-full rounded-md border border-line bg-surface p-2.5 text-[13px] text-ink focus:border-accent focus:outline-none"
            placeholder="When I need …, I reach for … because …. Under the hood Postgres …. Watch out for …."
          />
        </section>
        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold text-ink">Transfer: same idea, new problem</h2>
          {c.transfer.map((t) => (
            <div key={t.id} className="rounded-lg border border-line bg-surface p-3 text-[13px]">
              <div className="text-ink">
                <Md text={t.scenario} />
              </div>
              {tShown[t.id] ? (
                <div className="mt-2 space-y-2">
                  <div className="rounded-md bg-sunken/60 p-2 text-muted">
                    <Md text={t.approach} />
                  </div>
                  {transfer[t.id] === undefined && (
                    <div className="flex items-center gap-2 text-[12px] text-muted">
                      Did your sketch match?
                      <Button size="xs" variant="success" onClick={() => recordDrill(c.id, t.id, true)}>
                        yes
                      </Button>
                      <Button size="xs" variant="danger" onClick={() => recordDrill(c.id, t.id, false)}>
                        no
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <Button size="xs" variant="ghost" className="mt-1" onClick={() => setTShown((s) => ({ ...s, [t.id]: true }))}>
                  I’ve sketched my approach — show one
                </Button>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
