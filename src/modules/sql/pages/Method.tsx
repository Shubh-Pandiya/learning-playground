import { Link } from 'react-router-dom';
import { MASTERY_LABELS } from '../store';
import { PageHeader } from '../ui/common';

const PRINCIPLES: { name: string; finding: string; where: string; tip: string }[] = [
  {
    name: 'Predict before you see (generation effect)',
    finding: 'Committing to a guess before seeing the answer, even a wrong one, makes the correct answer stick far better than passive reading. Being surprised flags exactly what to update.',
    where: 'The stage-by-stage visualizer asks how many rows survive a JOIN, which rows WHERE drops, and what a window value will be before it reveals them. Practice asks for the row count before running.',
    tip: 'Keep “predict mode” on. When a prediction misses, read the stage note: that gap is the lesson.',
  },
  {
    name: 'Dual coding: rows you can watch',
    finding: 'A matching visual plus words is remembered better than either alone, as long as the visual shows the mechanism rather than decorating it.',
    where: 'Real rows flow through FROM → JOIN → WHERE → GROUP BY → HAVING → window → SELECT → ORDER BY → LIMIT. Fan-out rows, NULL-extended rows, dropped rows, groups and partitions each get a colour. The B+tree lab shows pages, and the isolation lab shows row versions.',
    tip: 'Say what each stage does out loud before you press next.',
  },
  {
    name: 'Every change explains its impact',
    finding: 'Feedback is most useful when it is immediate, specific and causal (“this did X because Y”), not just right or wrong.',
    where: 'Each run is diffed against your previous run: rows added or removed and the cardinality change. Plans are diffed too: scan type, join strategy, cost and ms. Builder moves, B+tree operations and isolation steps all report what changed and why it matters.',
    tip: 'Make one change at a time and read the diff. That is how you build a mental model of the planner.',
  },
  {
    name: 'Worked → faded → scratch',
    finding: 'Novices learn fastest from worked examples. Support should then be withdrawn step by step (fading), or it starts to hurt (the expertise-reversal effect).',
    where: 'The drag-and-drop builder starts with every clause placed, then blanks out the key clauses, then gives you only the blocks. Trap blocks (e.g. aggregate in WHERE, filtering the outer side in WHERE) come with a targeted “why this is wrong”.',
    tip: 'Don’t skip straight to scratch, and don’t stay in worked mode once it feels easy.',
  },
  {
    name: 'Interleaving: which technique?',
    finding: 'Mixing problem types forces you to pick the strategy, which is the skill interviews test. Blocked practice feels better but transfers worse.',
    where: 'The Drill shuffles unseen business questions across every track. Distractors are the techniques most often confused with the answer.',
    tip: 'Before choosing, name the signal in the question (“latest per…”, “consecutive…”, “never…”).',
  },
  {
    name: 'Spaced retrieval',
    finding: 'Recalling from memory at growing intervals is the most reliable way to retain knowledge long term. Re-reading feels productive but isn’t.',
    where: 'A concept enters review (SM-2 scheduling) once you build or solve it. Review asks a recall question and checks the template, and your grade sets the next interval. Due items show up in the app-wide “Today” plan.',
    tip: 'Answer fully in your head (or on paper) before revealing. Grade honestly.',
  },
  {
    name: 'Transfer to unseen problems',
    finding: 'Knowledge stays tied to its original context unless you practise applying it to new surface stories.',
    where: 'Each concept has transfer scenarios from data engineering and backend work (pipelines, billing, sessions, SCDs) and exercises on different tables from the worked example.',
    tip: 'After each concept, ask yourself where in your own systems you’d use it.',
  },
  {
    name: 'Judgment, not just recall',
    finding: 'Expertise is mostly pattern recognition of what’s wrong. Deliberate practice on realistic flawed artefacts builds it faster than writing code from scratch.',
    where: 'Judgment drills give you a PR, a slow dashboard query or a race condition. Find the line, choose the diagnosis, then both queries run so you see the real impact: wrong rows, plan cost, ms.',
    tip: 'Do one judgment drill a day. Explain the root cause in one sentence before reading the lesson.',
  },
  {
    name: 'Mechanism over magic',
    finding: 'Understanding the mechanism lets you derive behaviour you’ve never seen, instead of memorising rules.',
    where: 'Every concept explains how Postgres implements it (executor nodes, hash tables, sort and frame buffers, B+tree pages, MVCC xmin/xmax). Plan nodes link to a glossary of what each node does and what it costs.',
    tip: 'When a result surprises you, open EXPLAIN and find the node responsible.',
  },
  {
    name: 'Self-explanation',
    finding: 'Explaining a solution in your own words exposes gaps and roughly doubles learning compared with just reading the solution.',
    where: 'The Reflect tab asks you to explain the concept to a junior engineer, then tests recall and transfer.',
    tip: 'Write two sentences: when to use it, and the trap to avoid.',
  },
];

export default function Method() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Learning design" title="How this playground teaches">
        The goal isn’t memorising syntax. It’s seeing what the database does with your query, picking the right technique for an unseen problem, and spotting the bug or slow plan in someone else’s SQL.
        Each mechanic below applies a finding from learning research.
      </PageHeader>
      <section className="mb-8 rounded-xl border border-line bg-surface p-5 shadow-paper">
        <div className="eyebrow mb-2">the loop for every concept</div>
        <ol className="grid gap-3 text-sm md:grid-cols-6">
          {[
            ['Understand', 'Intuition + how Postgres implements it'],
            ['Watch & predict', 'Real rows stage by stage; predict each reveal'],
            ['Rebuild', 'Drag clauses: worked → faded → scratch'],
            ['Practise', 'Exercises checked against the real result'],
            ['Judge', 'Find the bug / slow plan; see the impact'],
            ['Space it', 'Recall later; transfer to new stories'],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-lg border border-line bg-paper p-3">
              <div className="font-mono text-xs text-accent">{i + 1}</div>
              <div className="font-medium text-ink">{t}</div>
              <div className="text-xs text-muted">{d}</div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted">
          Mastery levels: {MASTERY_LABELS.map((l, i) => `${i} ${l}`).join(' · ')}. Level 4 needs a from-scratch build, every exercise solved and a successful spaced review.
        </p>
      </section>
      <div className="space-y-3">
        {PRINCIPLES.map((p, i) => (
          <section key={p.name} className="rounded-xl border border-line bg-surface p-5 shadow-paper">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs text-faint">{String(i + 1).padStart(2, '0')}</span>
              <h2 className="font-semibold text-ink">{p.name}</h2>
            </div>
            <div className="mt-2 grid gap-3 text-sm md:grid-cols-3">
              <div>
                <div className="eyebrow mb-0.5">research</div>
                <p className="text-muted">{p.finding}</p>
              </div>
              <div>
                <div className="eyebrow mb-0.5">in the playground</div>
                <p className="text-ink">{p.where}</p>
              </div>
              <div>
                <div className="eyebrow mb-0.5">what you should do</div>
                <p className="text-ink">{p.tip}</p>
              </div>
            </div>
          </section>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">
        Start at the{' '}
        <Link to="/sql" className="text-accent hover:underline">
          dashboard
        </Link>{' '}
        and follow “Today’s session”.
      </p>
    </div>
  );
}
