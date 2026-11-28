import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, BookOpen, Brain, CheckCircle2, FlaskConical } from 'lucide-react';
import { Button, Callout, Card, StepControls, Tag, useStepper } from '@/shared/ui';
import { useReportProgress } from '@/shared/progress';
import { SOURCES, TOPICS, topicById, type Topic } from './data';
import { Incident, Ordering, Prediction, Recall } from './exercises';
import { dueItems, mastered, useJava } from './store';
import { COUNTERFACTUALS } from './scenarios';

const base = '/java-spring';
const path = (topic: Topic) => `${base}/learn/${topic.id}`;

function Reporter() {
  const state = useJava();
  const summary = useMemo(() => {
    const due = dueItems(state);
    const next = TOPICS.find((topic) => !mastered(topic, state));
    const last = state.last ? topicById(state.last) : undefined;
    return {
      completed: TOPICS.filter((topic) => mastered(topic, state)).length,
      total: TOPICS.length,
      unit: 'concepts',
      detail: `${Object.keys(state.studied).length} mechanisms explored · ${Object.keys(state.solved).length} incidents solved`,
      dueForReview: due.length,
      resume: { label: last?.title ?? TOPICS[0].title, path: path(last ?? TOPICS[0]) },
      reviews: due.slice(0, 5).map((item) => ({ label: `${item.topic.domain}: ${item.topic.title}`, path: `${base}/review`, kind: 'review' as const, minutes: 3 })),
      nextSteps: next ? [{ label: `Java / Spring: ${next.title}`, path: path(next), kind: 'learn' as const, minutes: 12, detail: next.tagline }] : [],
    };
  }, [state]);
  useReportProgress('java-spring', summary);
  return null;
}

function Home({ inside = false, drills = false }: { inside?: boolean; drills?: boolean }) {
  const state = useJava();
  const [filter, setFilter] = useState<'All' | 'Java' | 'Spring'>('All');
  const due = dueItems(state);
  return <div className="space-y-6">
    <header className="space-y-3">
      <p className="eyebrow">SDE-2 to senior · mechanism-first learning</p>
      <h1 className="font-mono text-2xl font-semibold">{drills ? 'Incident & spot-the-bug drills' : inside ? 'Inside the mechanisms' : 'Java & Spring Boot'}</h1>
      <p className="max-w-3xl text-sm leading-relaxed text-muted">{drills
        ? 'Read evidence, predict the cause, and choose the smallest defensible fix. No code-writing exercises.'
        : 'Understand the causal model, predict what happens, reconstruct the flow, then explain and diagnose from memory. Learn theory as decisions, not annotation trivia.'}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Tag tone="accent">{TOPICS.filter((t) => mastered(t, state)).length}/{TOPICS.length} practiced concepts</Tag>
        <Link to={`${base}/review`} className="text-sm text-accent underline">{due.length} reviews due</Link>
        <Link to={`${base}/method`} className="text-sm text-muted underline">Why this learning loop works</Link>
      </div>
    </header>
    {!drills && <Callout tone="tip" title="A 20-minute study loop">
      <p className="text-sm">5 min due recall → 8 min one prediction + mechanism → 5 min incident or assembly → 2 min explain the tradeoff aloud. Return on the scheduled date; delayed recall matters more than rereading.</p>
    </Callout>}
    <div className="flex gap-2" aria-label="Filter topics">{(['All', 'Java', 'Spring'] as const).map((domain) =>
      <Button key={domain} size="sm" active={filter === domain} onClick={() => setFilter(domain)}>{domain}</Button>)}</div>
    <div className="grid gap-4 md:grid-cols-2">
      {TOPICS.filter((topic) => filter === 'All' || topic.domain === filter).map((topic, i) => (
        <Link key={topic.id} to={drills ? `${base}/drills/${topic.id}` : inside ? `${base}/inside/${topic.id}` : path(topic)}>
          <Card interactive className="h-full space-y-3">
            <div className="flex items-center gap-2"><Tag tone={topic.domain === 'Java' ? 'info' : 'violet'}>{topic.domain}</Tag>
              <span className="ml-auto text-xs text-muted">{mastered(topic, state) ? 'Practiced' : state.studied[topic.id] ? 'Mechanism explored' : `${i + 1} · 10–15 min`}</span>
              {mastered(topic, state) && <CheckCircle2 size={16} className="text-ok" />}
            </div>
            <h2 className="font-mono text-sm font-semibold">{drills ? topic.drill.title : topic.title}</h2>
            <p className="text-sm text-muted">{drills ? topic.drill.evidence : topic.tagline}</p>
            <div className="flex items-center gap-2 text-xs text-accent"><ArrowRight size={14} />{drills ? 'Diagnose from evidence' : topic.order ? 'Predict · trace · assemble · recall' : 'Predict · trace · diagnose · recall'}</div>
          </Card>
        </Link>
      ))}
    </div>
    {state.confidence.high > 0 && <p className="text-xs text-muted">Confidence calibration: {state.confidence.highWrong}/{state.confidence.high} confident attempts were missed (includes self-rated recall). Treat mismatches as useful feedback, not a score to optimize.</p>}
  </div>;
}

function Trace({ topic, cardId }: { topic: Topic; cardId: string }) {
  const state = useJava();
  const [unlocked, setUnlocked] = useState(false);
  const stepper = useStepper(topic.frames.length, { intervalMs: 2400 });
  const reducedMotion = useReducedMotion();
  const frame = topic.frames[stepper.step];
  return <Card className="space-y-5">
    <div className="flex items-center gap-2"><FlaskConical size={18} className="text-accent" /><h2 className="font-mono font-semibold">Predict before opening the mechanism</h2></div>
    {!unlocked ? <Prediction question={topic.prediction} onGraded={(grade, confident, correct) => {
      state.grade(cardId, grade, confident, correct);
      setUnlocked(true);
    }} /> : <>
      <div className="rounded-xl border border-line bg-sunken bg-grid p-4">
        <div className="mb-5 flex items-center justify-between gap-2"><h3 className="font-mono text-sm font-semibold">{frame.title}</h3><Tag>{stepper.step + 1}/{topic.frames.length}</Tag></div>
        <div className="grid gap-3 md:grid-cols-3" aria-label="Mechanism state">
          {frame.lanes.map((lane) => <motion.div key={lane.label} layout={!reducedMotion}
            transition={{ duration: reducedMotion ? 0 : 0.3 }}
            className={`min-h-28 rounded-lg border p-3 transition-colors ${lane.active ? 'border-accent bg-accent/10' : 'border-line bg-surface'}`}>
            <p className="eyebrow mb-3">{lane.label}</p>
            <motion.p key={lane.value} initial={reducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.3 }}
              className={`text-sm font-mono ${lane.active ? 'text-accent' : 'text-ink'}`}>{lane.value}</motion.p>
          </motion.div>)}
        </div>
        <p className="mt-4 min-h-14 text-sm leading-relaxed" aria-live="polite">{frame.explain}</p>
      </div>
      <StepControls stepper={stepper} caption={frame.title} />
      <p className="text-xs text-muted">A simplified explanatory model, not a live JVM or Spring runtime. Pause and explain why the next transition is legal.</p>
      <Button variant="primary" disabled={!stepper.atEnd} onClick={() => state.study(topic.id)}>{state.studied[topic.id] ? 'Mechanism explored · replay anytime' : 'Finish mechanism and unlock spaced review'}</Button>
    </>}
  </Card>;
}

function Mechanism({ topic }: { topic: Topic }) {
  const [alternative, setAlternative] = useState(false);
  const scenario = COUNTERFACTUALS[topic.id];
  return <div className="space-y-3">
    {scenario && <div className="flex flex-wrap items-center gap-2">
      <span className="eyebrow">Change one boundary</span>
      <Button size="sm" active={!alternative} onClick={() => setAlternative(false)}>Original scenario</Button>
      <Button size="sm" active={alternative} onClick={() => setAlternative(true)}>{scenario.label}</Button>
    </div>}
    <Trace key={`${topic.id}:${alternative}`} cardId={`${topic.id}:${alternative ? 'counterfactual' : 'prediction'}`} topic={alternative && scenario
      ? { ...topic, frames: scenario.frames, prediction: scenario.prediction } : topic} />
  </div>;
}

function TopicContent({ topic, inside }: { topic: Topic; inside: boolean }) {
  const state = useJava();
  useEffect(() => { state.visit(topic.id); }, [topic.id, state.visit]);
  return <div className="space-y-6">
    <header className="space-y-2">
      <p className="eyebrow">{topic.domain} · {inside ? 'Inside' : 'Learn'} · senior interview depth</p>
      <h1 className="font-mono text-2xl font-semibold">{topic.title}</h1>
      <p className="text-sm text-muted">{topic.tagline}</p>
    </header>
    <Mechanism key={topic.id} topic={topic} />
    <Card className="space-y-4">
      <h2 className="flex items-center gap-2 font-mono font-semibold"><BookOpen size={18} />Theory that explains the trace</h2>
      <ul className="space-y-3">{topic.theory.map((point) => <li key={point} className="border-l-2 border-accent/30 pl-3 text-sm leading-relaxed">{point}</li>)}</ul>
      <a href={topic.source} target="_blank" rel="noreferrer" className="inline-block text-xs text-accent underline">Check the runtime/framework reference</a>
    </Card>
    {topic.order && <Card><Ordering topic={{ ...topic, order: topic.order }} /></Card>}
    <Card className="space-y-4">
      <p className="eyebrow">Retrieval · explain, do not recite</p>
      <Recall key={topic.id} topic={topic} onGraded={(grade, confident, correct) => state.grade(`${topic.id}:recall`, grade, confident, correct)} />
    </Card>
    <div className="flex flex-wrap gap-3">
      <Link to={`${base}/drills/${topic.id}`}><Button variant="primary" icon={<Brain size={16} />}>Apply it to an incident</Button></Link>
      <Link to={`${base}/review`}><Button>Review due concepts</Button></Link>
    </div>
  </div>;
}

function TopicPage({ inside = false }: { inside?: boolean }) {
  const { id } = useParams();
  const topic = topicById(id ?? '');
  return topic ? <TopicContent key={topic.id} topic={topic} inside={inside} /> : <NotFound />;
}

function DrillPage() {
  const { id } = useParams();
  const topic = topicById(id ?? '');
  const state = useJava();
  return topic ? <div className="space-y-6">
    <header><p className="eyebrow">{topic.domain} · production judgment</p><h1 className="mt-2 font-mono text-2xl font-semibold">{topic.drill.title}</h1></header>
    <Card><Incident key={topic.id} topic={topic} onGraded={(grade, confident, correct) => {
      state.grade(`${topic.id}:drill`, grade, confident, correct);
      if (correct) state.solve(topic.id);
    }} /></Card>
    <Link to={path(topic)} className="text-sm text-accent underline">Reconstruct the underlying mechanism</Link>
  </div> : <NotFound />;
}

function ReviewPage() {
  const state = useJava();
  const [queue] = useState(() => dueItems(state).slice(0, 15));
  const [index, setIndex] = useState(0);
  const [graded, setGraded] = useState(false);
  const item = queue[index];
  const onGrade = (grade: Parameters<typeof state.grade>[1], confident: boolean, correct: boolean) => {
    if (!item) return;
    state.grade(item.id, grade, confident, correct);
    if (item.kind === 'drill' && correct) state.solve(item.topic.id);
    setGraded(true);
  };
  return <div className="mx-auto max-w-2xl space-y-6">
    <header><p className="eyebrow">Interleaved retrieval · SM-2-style scheduling</p><h1 className="mt-2 font-mono text-2xl font-semibold">Review from memory</h1></header>
    {!item ? <Callout tone="ok" title={queue.length ? 'Review session complete' : 'Nothing due yet'}>
      <p className="text-sm">{queue.length ? 'Your ratings set the next review dates. If more cards remain due, start another short session after a break.' : 'Finish a mechanism to activate its prediction, senior explanation and incident cards. Scheduled cards reappear when due.'}</p>
      <Link to={base} className="mt-3 inline-block text-sm underline">Back to roadmap</Link>
    </Callout> : <>
      <p className="text-xs text-muted">Card {index + 1}/{queue.length} · alternating Java and Spring when available · predict, explain, diagnose</p>
      <Card key={item.id}>
        {item.kind === 'recall' ? <Recall topic={item.topic} onGraded={onGrade} />
          : item.kind === 'drill' ? <Incident topic={item.topic} onGraded={onGrade} />
            : <Prediction question={item.kind === 'counterfactual'
              ? COUNTERFACTUALS[item.topic.id]!.prediction : item.topic.prediction} onGraded={onGrade} />}
      </Card>
      {graded && <Link className="block text-xs text-accent underline" to={path(item.topic)}>Revisit: {item.topic.title}</Link>}
      <Button variant="primary" disabled={!graded} onClick={() => { setIndex(index + 1); setGraded(false); }}>Next card</Button>
    </>}
  </div>;
}

function MethodPage() {
  return <div className="max-w-3xl space-y-6">
    <header><p className="eyebrow">Evidence, not learning-style myths</p><h1 className="mt-2 font-mono text-2xl font-semibold">Learn the mechanism; retrieve the decision</h1></header>
    <Callout tone="tip" title="What is best supported?"><p className="text-sm">Spaced retrieval with feedback is the core. Visuals, prediction and assembly are supporting tools for causal understanding, not proof that you have memorized it. There is no universally optimal psychological method or scientifically optimal SM-2 interval for this particular curriculum.</p></Callout>
    <Card className="space-y-4">
      <h2 className="font-mono font-semibold">The loop</h2>
      <p className="text-sm leading-relaxed">Activate prior knowledge with a prediction. Step through one small causal mechanism with labels and state changes. Reconstruct callback/request/transaction ordering where order is meaningful. Explain the senior answer from memory, then compare it. Diagnose an incident from evidence. Return later for a mixed review instead of repeatedly reading the same topic.</p>
      <p className="text-sm leading-relaxed">A concept is marked practiced only after its mechanism is completed, its incident is solved, its ordering exercise is solved when available, and at least one senior recall is rated successful. This is practice completion, not certification of interview readiness. Wrong answers remain valuable feedback and cannot earn a successful recall interval.</p>
      <p className="text-sm leading-relaxed">Before revealing answers, record confidence. Confident mistakes expose misconceptions. Free explanations are self-assessed, not AI-graded; use the supplied mechanism/tradeoff answer honestly. The shared scheduler adapts future dates to Forgot/Hard/Good/Easy; spacing is evidence-backed, the exact intervals are a practical heuristic.</p>
    </Card>
    <Card className="space-y-3">
      <h2 className="font-mono font-semibold">SDE-2 → senior interview practice</h2>
      <p className="text-sm">Say: “The invariant is …; this transition is legal because …; the failure would show …; I would verify …; the fix costs …”. Contrast lookalikes: volatile vs atomic, REQUIRED vs REQUIRES_NEW, flush vs commit, filter vs interceptor, virtual-thread concurrency vs CPU parallelism.</p>
      <p className="text-sm text-muted">Avoid passive animation watching, highlighting, massed rereading and memorizing annotations without call paths. Use a 20-minute session; the time split is a convenient habit, not an experimentally optimized dose.</p>
    </Card>
    <div className="space-y-3">{SOURCES.map((source) => <Card key={source.url}>
      <a href={source.url} target="_blank" rel="noreferrer" className="font-mono text-sm text-accent underline">{source.title}</a>
      <p className="mt-2 text-sm text-muted">{source.note}</p>
    </Card>)}</div>
  </div>;
}

function NotFound() {
  return <Callout tone="warn" title="Unknown Java / Spring concept"><Link to={base} className="text-sm underline">Open the roadmap</Link></Callout>;
}

export default function JavaSpringModule() {
  return <div className="min-h-[calc(100vh-var(--header-h))]">
    <Reporter />
    <nav className="border-b border-line bg-surface" aria-label="Java and Spring sections">
      <div className="mx-auto flex max-w-5xl flex-wrap gap-1 px-4 py-3">{[
        ['Roadmap', base], ['Inside', `${base}/inside`], ['Incidents', `${base}/drills`], ['Review', `${base}/review`], ['Method', `${base}/method`],
      ].map(([label, to]) => <NavLink key={to} to={to} end={to === base}
        className={({ isActive }) => `rounded px-3 py-2 font-mono text-xs ${isActive ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-ink/5'}`}>{label}</NavLink>)}</div>
    </nav>
    <main className="mx-auto max-w-5xl px-4 py-7 md:px-6">
      <Routes>
        <Route index element={<Home />} />
        <Route path="learn/:id" element={<TopicPage />} />
        <Route path="inside" element={<Home inside />} />
        <Route path="inside/:id" element={<TopicPage inside />} />
        <Route path="drills" element={<Home drills />} />
        <Route path="drills/:id" element={<DrillPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="method" element={<MethodPage />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </main>
  </div>;
}
