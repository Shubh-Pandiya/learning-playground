import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Brain,
  CheckCircle2,
  Eye,
  ExternalLink,
  Lightbulb,
  NotebookPen,
  Play,
  Server,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Button, Callout, Tag } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { PatternId, Problem } from '../engine/types';
import { parseCode, runTrace } from '../engine/tracer';
import { problemById, problems } from '../problems';
import { patternById, patterns } from '../data/patterns';
import { categoryById } from '../data/categories';
import { useDsa, MASTERY_LABELS, mastery } from '../store';
import { Visualizer } from '../components/Visualizer';
import { Builder } from '../components/Builder';
import { GotchaList, LangSwitch } from '../components/LangSwitch';
import { LANG_META, gotchas, problemCode } from '../lang/code';
import { useLang } from '../lang/store';
import { DifficultyTag, MasteryDots, PatternTag, shuffle } from '../components/common';
import type { RecallGrade } from '@/shared/progress';

type TabId = 'understand' | 'visualize' | 'build' | 'reflect';
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'understand', label: 'Understand', icon: <Lightbulb className="h-4 w-4" /> },
  { id: 'visualize', label: 'Visualize', icon: <Eye className="h-4 w-4" /> },
  { id: 'build', label: 'Build', icon: <Blocks className="h-4 w-4" /> },
  { id: 'reflect', label: 'Reflect & review', icon: <NotebookPen className="h-4 w-4" /> },
];

export default function Playground() {
  const { id = '' } = useParams();
  const problem = problemById[id];
  if (!problem) {
    return (
      <Callout tone="warn" title="Problem not found">
        <Link className="underline" to="/dsa/problems">
          Back to all problems
        </Link>
      </Callout>
    );
  }
  return <ProblemPage key={problem.id} problem={problem} />;
}

function ProblemPage({ problem }: { problem: Problem }) {
  const [params, setParams] = useSearchParams();
  const progress = useDsa((s) => s.problems[problem.id]);
  const visit = useDsa((s) => s.visit);
  const patch = useDsa((s) => s.patch);
  const [revealed, setRevealed] = useState(() => !!progress?.recognized || progress?.recognized === false || !!progress?.visualized);
  const tab = (params.get('tab') as TabId) || 'understand';
  const setTab = (t: TabId) => setParams((p) => (p.set('tab', t), p), { replace: true });
  const idx = problems.findIndex((p) => p.id === problem.id);
  const prev = problems[idx - 1];
  const next = problems[idx + 1];
  const pattern = patternById[problem.pattern];

  useEffect(() => {
    visit(problem.id);
  }, [problem.id, visit]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between text-xs text-muted">
        <Link to={`/dsa/problems#${problem.category}`} className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> {categoryById[problem.category]?.name}
        </Link>
        <div className="flex items-center gap-3">
          {prev && (
            <Link to={`/dsa/problem/${prev.id}`} className="hover:text-ink">
              ← {prev.title}
            </Link>
          )}
          {next && (
            <Link to={`/dsa/problem/${next.id}`} className="hover:text-ink">
              {next.title} →
            </Link>
          )}
        </div>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="eyebrow mb-1">
            #{problem.num} · {categoryById[problem.category]?.name}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{problem.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DifficultyTag d={problem.difficulty} />
            {revealed ? <PatternTag id={problem.pattern} /> : <Tag variant="outline">pattern hidden — guess it first</Tag>}
            <MasteryDots p={progress} className="ml-1" />
            <span className="text-[11px] text-faint">{MASTERY_LABELS[mastery(progress)]}</span>
          </div>
        </div>
        <a
          href={`https://leetcode.com/problems/${problem.id}/`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:border-ink/30 hover:text-ink"
        >
          LeetCode <ExternalLink className="h-3 w-3" />
        </a>
      </header>

      <div className="rounded-xl border border-line bg-surface p-4 text-[15px] leading-relaxed text-ink shadow-paper">{problem.statement}</div>

      {!revealed ? (
        <RecognitionGate
          problem={problem}
          onDone={(ok) => {
            patch(problem.id, { recognized: ok });
            useDsa.getState().recordDrill(problem.pattern, ok);
            setRevealed(true);
          }}
          onSkip={() => setRevealed(true)}
        />
      ) : (
        <>
          <nav className="flex flex-wrap gap-1 border-b border-line">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition',
                  tab === t.id ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {t.icon}
                {t.label}
                {t.id === 'visualize' && progress?.visualized && <CheckCircle2 className="h-3.5 w-3.5 text-ok" />}
                {t.id === 'build' && (progress?.built?.scratch || progress?.built?.faded) && <CheckCircle2 className="h-3.5 w-3.5 text-ok" />}
              </button>
            ))}
          </nav>
          {tab === 'understand' && <Understand problem={problem} onGo={setTab} />}
          {tab === 'visualize' && <VisualizeTab problem={problem} />}
          {tab === 'build' && <BuildTab problem={problem} onRun={() => setTab('visualize')} />}
          {tab === 'reflect' && <Reflect problem={problem} />}
        </>
      )}

      {revealed && pattern && (
        <div className="text-xs text-faint">
          Pattern: <Link className="underline hover:text-ink" to={`/dsa/patterns/${pattern.id}`}>{pattern.name}</Link> — {pattern.tagline}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RecognitionGate({ problem, onDone, onSkip }: { problem: Problem; onDone: (ok: boolean) => void; onSkip: () => void }) {
  const options = useMemo(() => {
    const others = shuffle(
      patterns.filter((p) => p.id !== problem.pattern && p.id !== 'design').map((p) => p.id),
      problem.num,
    ).slice(0, 3);
    return shuffle<PatternId>([problem.pattern, ...others], problem.num + 7);
  }, [problem]);
  const [pick, setPick] = useState<PatternId | null>(null);
  const ok = pick === problem.pattern;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border-2 border-violet/40 bg-violet/5 p-5">
      <div className="mb-1 flex items-center gap-2 font-semibold text-ink">
        <Brain className="h-5 w-5 text-violet" /> Before anything else: which pattern would you reach for?
      </div>
      <p className="mb-4 text-sm text-muted">
        Guessing first (even wrong) makes the answer stick much better than reading it. Look for the signals in the statement above.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const p = patternById[o];
          const isAns = o === problem.pattern;
          return (
            <button
              key={o}
              disabled={!!pick}
              onClick={() => setPick(o)}
              className={cn(
                'rounded-lg border px-3 py-2.5 text-left transition',
                !pick && 'border-line bg-surface hover:border-violet',
                pick && isAns && 'border-ok bg-ok/10',
                pick === o && !isAns && 'border-bad bg-bad/10',
                pick && !isAns && pick !== o && 'border-line/50 opacity-50',
              )}
            >
              <div className="text-sm font-medium text-ink">{p.name}</div>
              <div className="text-xs text-muted">{p.tagline}</div>
            </button>
          );
        })}
      </div>
      {pick && (
        <div className="mt-4 space-y-3">
          <div className={cn('flex items-center gap-2 text-sm font-medium', ok ? 'text-ok' : 'text-bad')}>
            {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {ok ? 'Yes!' : `It's ${patternById[problem.pattern].name}.`} The signals were:
          </div>
          <ul className="ml-6 list-disc space-y-0.5 text-sm text-ink">
            {problem.signals.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <Button variant="primary" onClick={() => onDone(ok)}>
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
      {!pick && (
        <button onClick={onSkip} className="mt-3 text-xs text-faint underline hover:text-muted">
          skip — just show me
        </button>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

function Understand({ problem, onGo }: { problem: Problem; onGo: (t: TabId) => void }) {
  const [showInsight, setShowInsight] = useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <section className="rounded-xl border border-line bg-surface p-4 shadow-paper">
          <div className="eyebrow mb-2">recognition signals</div>
          <ul className="space-y-1.5 text-sm text-ink">
            {problem.signals.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {s}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-line bg-surface p-4 shadow-paper">
          <div className="eyebrow mb-2">key insight</div>
          {showInsight ? (
            <p className="text-sm leading-relaxed text-ink">{problem.insight}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted">Take 30 seconds and try to state the trick yourself before revealing it.</p>
              <Button size="sm" variant="secondary" icon={<Sparkles className="h-4 w-4" />} onClick={() => setShowInsight(true)}>
                Reveal insight
              </Button>
            </div>
          )}
        </section>
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="eyebrow">time</div>
            <div className="font-mono text-sm text-ink">{problem.complexity.time}</div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="eyebrow">space</div>
            <div className="font-mono text-sm text-ink">{problem.complexity.space}</div>
          </div>
        </section>
        <Callout tone="warn" title="Common pitfall">
          {problem.pitfall}
        </Callout>
        <LangGotchas problem={problem} />
      </div>
      <div className="space-y-4">
        <section className="rounded-xl border-2 border-info/30 bg-info/5 p-4">
          <div className="mb-1 flex items-center gap-2 text-info">
            <Server className="h-4 w-4" />
            <span className="eyebrow !text-info">where this shows up in backend engineering</span>
          </div>
          <div className="mb-1 font-semibold text-ink">{problem.backend.title}</div>
          <p className="text-sm leading-relaxed text-ink">{problem.backend.detail}</p>
        </section>
        <section className="rounded-xl border border-line bg-surface p-4 shadow-paper">
          <div className="eyebrow mb-2">suggested path</div>
          <ol className="space-y-2 text-sm text-ink">
            <li className="flex items-center justify-between gap-2">
              <span>1. Watch the algorithm run and predict each move</span>
              <Button size="xs" variant="secondary" icon={<Play className="h-3 w-3" />} onClick={() => onGo('visualize')}>
                Visualize
              </Button>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>2. Rebuild it: worked → gaps → from scratch</span>
              <Button size="xs" variant="secondary" icon={<Blocks className="h-3 w-3" />} onClick={() => onGo('build')}>
                Build
              </Button>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>3. Explain it in your own words, rate your recall</span>
              <Button size="xs" variant="secondary" icon={<NotebookPen className="h-3 w-3" />} onClick={() => onGo('reflect')}>
                Reflect
              </Button>
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BuildTab({ problem, onRun }: { problem: Problem; onRun: () => void }) {
  const lang = useLang();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span className="eyebrow">blocks in</span>
        <LangSwitch size="xs" />
        {lang !== 'python' && <span className="text-faint">Closing braces are left out — a block ends where the indentation does.</span>}
      </div>
      <Builder key={`${problem.id}:${lang}`} problem={problem} lang={lang} onRun={onRun} />
      <LangGotchas problem={problem} />
    </div>
  );
}

/** Language-specific traps for this problem and its pattern. */
function LangGotchas({ problem }: { problem: Problem }) {
  const lang = useLang();
  const list = [...gotchas(problem, lang), ...gotchas(patternById[problem.pattern], lang)];
  if (!list.length) return null;
  return (
    <Callout tone="info" title={`${LANG_META[lang].label} gotchas`}>
      <GotchaList items={list} />
    </Callout>
  );
}

// ---------------------------------------------------------------------------

function VisualizeTab({ problem }: { problem: Problem }) {
  const lang = useLang();
  const lines = useMemo(() => parseCode(problemCode(problem, lang)), [problem, lang]);
  const presets = useMemo(() => [{ label: 'default', input: problem.input }, ...(problem.presets ?? [])], [problem]);
  const [preset, setPreset] = useState(0);
  const [text, setText] = useState(() => JSON.stringify(problem.input));
  const [input, setInput] = useState<unknown>(problem.input);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const predictMode = useDsa((s) => s.predictMode);
  const lineQuiz = useDsa((s) => s.lineQuiz);
  const setPredictMode = useDsa((s) => s.setPredictMode);
  const setLineQuiz = useDsa((s) => s.setLineQuiz);
  const patch = useDsa((s) => s.patch);
  const recordPrediction = useDsa((s) => s.recordPrediction);

  const trace = useMemo(() => runTrace(problem, input, lang), [problem, input, lang]);

  const choose = (i: number) => {
    setPreset(i);
    setText(JSON.stringify(presets[i].input));
    setInput(presets[i].input);
    setParseErr(null);
  };
  const run = () => {
    try {
      const v = JSON.parse(text);
      setInput(v);
      setParseErr(null);
      setPreset(-1);
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : String(e));
    }
  };

  const editor = (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-paper">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="eyebrow mr-1">input</span>
        {presets.map((p, i) => (
          <button
            key={i}
            onClick={() => choose(i)}
            className={cn('rounded-md border px-2 py-0.5 text-[11px]', preset === i ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:text-ink')}
          >
            {p.label}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run();
          e.stopPropagation();
        }}
        spellCheck={false}
        rows={Math.min(6, Math.max(2, Math.ceil(text.length / 60)))}
        className="w-full resize-y rounded-md border border-line bg-paper p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-faint">Edit the JSON and run (⌘/Ctrl+Enter). Try an edge case!</span>
        <Button size="xs" variant="primary" icon={<Play className="h-3 w-3" />} onClick={run}>
          Run
        </Button>
      </div>
      {parseErr && <div className="mt-2 text-xs text-bad">Invalid JSON: {parseErr}</div>}
      {trace.error && !trace.frames.length && <div className="mt-2 text-xs text-bad">{trace.error}</div>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={predictMode} onChange={(e) => setPredictMode(e.target.checked)} className="accent-[rgb(var(--c-accent))]" />
          Predict-before-reveal questions
        </label>
        <label className={cn('inline-flex cursor-pointer items-center gap-1.5', !predictMode && 'opacity-50')}>
          <input
            type="checkbox"
            disabled={!predictMode}
            checked={lineQuiz}
            onChange={(e) => setLineQuiz(e.target.checked)}
            className="accent-[rgb(var(--c-accent))]"
          />
          Also quiz me “which line runs next?” at every branch
        </label>
        <span className="ml-auto text-faint">← → step · space play · R reset</span>
      </div>
      <Visualizer
        lines={lines}
        trace={trace}
        explain={problem.explain}
        predictMode={predictMode}
        lineQuiz={lineQuiz}
        onPrediction={(ok) => recordPrediction(problem.id, ok)}
        onFinish={() => patch(problem.id, { visualized: true })}
        codeFooter={editor}
        language={LANG_META[lang].prism}
        codeActions={<LangSwitch size="xs" />}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

const GRADES: { g: RecallGrade; label: string; hint: string; tone: 'danger' | 'secondary' | 'success' | 'primary' }[] = [
  { g: 0, label: 'Again', hint: "couldn't rebuild it", tone: 'danger' },
  { g: 1, label: 'Hard', hint: 'needed hints', tone: 'secondary' },
  { g: 2, label: 'Good', hint: 'rebuilt with effort', tone: 'success' },
  { g: 3, label: 'Easy', hint: 'instant recall', tone: 'primary' },
];

function Reflect({ problem }: { problem: Problem }) {
  const progress = useDsa((s) => s.problems[problem.id]);
  const patch = useDsa((s) => s.patch);
  const grade = useDsa((s) => s.grade);
  const navigate = useNavigate();
  const pattern = patternById[problem.pattern];
  const prompt = pattern?.selfExplain[problem.num % Math.max(1, pattern.selfExplain.length)];
  const [graded, setGraded] = useState(false);
  const card = progress?.card;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <section className="rounded-xl border border-line bg-surface p-4 shadow-paper">
          <div className="eyebrow mb-1">self-explanation</div>
          <p className="mb-2 text-sm text-ink">
            In 2–3 sentences: <b>why</b> does this solution work, and what in the statement told you to use {pattern?.name ?? 'this pattern'}?
          </p>
          {prompt && <p className="mb-2 text-xs italic text-muted">Prompt: {prompt}</p>}
          <textarea
            value={progress?.note ?? ''}
            onChange={(e) => patch(problem.id, { note: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            rows={5}
            placeholder="Write it as if teaching a teammate…"
            className="w-full rounded-md border border-line bg-paper p-2 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </section>
        <section className="rounded-xl border border-line bg-surface p-4 shadow-paper">
          <div className="eyebrow mb-1">connect it to your own work</div>
          <p className="mb-2 text-sm text-ink">Where in a system you have worked on could this exact pattern appear? (Example: {problem.backend.title.toLowerCase()}.)</p>
          <textarea
            value={progress?.backendNote ?? ''}
            onChange={(e) => patch(problem.id, { backendNote: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            rows={3}
            className="w-full rounded-md border border-line bg-paper p-2 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </section>
      </div>
      <div className="space-y-4">
        <section className="rounded-xl border border-line bg-surface p-4 shadow-paper">
          <div className="eyebrow mb-1">how well can you recall it?</div>
          <p className="mb-3 text-sm text-muted">
            Be honest — this schedules your next review. Things you find hard come back sooner; easy ones fade out.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GRADES.map((x) => (
              <Button
                key={x.g}
                variant={x.tone}
                onClick={() => {
                  grade(problem.id, x.g);
                  setGraded(true);
                }}
                className="flex h-auto flex-col items-center py-2"
              >
                <span className="font-semibold">{x.label}</span>
                <span className="text-[10px] font-normal opacity-80">{x.hint}</span>
              </Button>
            ))}
          </div>
          {card && (
            <p className={cn('mt-3 text-xs', graded ? 'text-ok' : 'text-muted')}>
              Next review: <b>{new Date(card.due).toLocaleDateString()}</b> · interval {card.interval} day{card.interval === 1 ? '' : 's'} · {card.reps} successful
              recall{card.reps === 1 ? '' : 's'} in a row
            </p>
          )}
        </section>
        <section className="rounded-xl border border-line bg-surface p-4 shadow-paper">
          <div className="eyebrow mb-2">your stats on this problem</div>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Predictions</dt>
            <dd className="font-mono text-ink">
              {progress?.predictRight ?? 0}/{progress?.predictTotal ?? 0}
            </dd>
            <dt className="text-muted">Build attempts</dt>
            <dd className="font-mono text-ink">{progress?.attempts ?? 0}</dd>
            <dt className="text-muted">Hints used</dt>
            <dd className="font-mono text-ink">{progress?.hintsUsed ?? 0}</dd>
            <dt className="text-muted">Levels done</dt>
            <dd className="font-mono text-ink">
              {(['worked', 'faded', 'scratch'] as const).filter((m) => progress?.built?.[m]).join(', ') || '—'}
            </dd>
          </dl>
        </section>
        <Button variant="secondary" onClick={() => navigate('/dsa/transfer?pattern=' + problem.pattern)}>
          Test transfer: try an unseen problem with this pattern →
        </Button>
      </div>
    </div>
  );
}
