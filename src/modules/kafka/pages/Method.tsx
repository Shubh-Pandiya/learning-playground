import { Link } from 'react-router-dom';
import { PageBar } from '../ui/PageBar';
import { Rich } from '../ui/Rich';

/** Mirrors LEARNING_DESIGN.md: each principle, the mechanic that applies it, and how to use it. */
const PRINCIPLES: { name: string; where: string; what: string; use: string; to: string }[] = [
  { name: 'Predict before reveal', where: 'Learn steps, internals frames, chaos bar', what: 'You commit to an outcome *before* the simulator or animation shows it. A wrong prediction is the moment your mental model updates (the generation effect plus prediction error).', use: 'Actually pick. Don’t click “skip prediction”. Your accuracy shows up on the Kafka home page as calibration.', to: '/kafka/lab' },
  { name: 'Every change explains itself', where: 'Impact tab, change toast, Inspector', what: 'Each config or topology change is diffed: **what changed**, which metrics moved (throughput, p99, lag, ordering, delivery semantics, durability), **why** (the mechanism), and what the cluster did internally (elections, rebalances, ISR changes).', use: 'After each change, read the toast before the next change. One variable at a time.', to: '/kafka/lab' },
  { name: 'Worked → faded → scratch', where: 'Learn → Build → Challenge', what: 'Learn is a fully worked example. Build gives a broken system plus requirements, with hints on request. Challenge is the same concept in a **different domain** with no scaffolding. This reduces cognitive load first, then removes it.', use: 'Don’t open the reference until you’ve used all three hints. Struggle is where learning happens.', to: '/kafka' },
  { name: 'Transfer, not recall', where: 'Challenge scenarios, incident drills', what: 'Each concept reappears in an unfamiliar system (orders → IoT, payments → audit log), so you learn to recognise *when* it applies, not just its name.', use: 'Before building, say which lesson’s idea applies and why.', to: '/kafka/drills' },
  { name: 'Mechanism first (how it’s built)', where: 'Internals deep dives, “How it’s built” tab, step internals', what: 'Configs make sense only with the machinery behind them: segments and sparse indexes, HW/LEO, PID+sequence numbers, transaction markers, the group coordinator, the KRaft quorum. Every node has an internals view and every lesson links to dives.', use: 'When a result surprises you, open the matching deep dive.', to: '/kafka/internals' },
  { name: 'Red flags as feedback', where: 'Red flags tab, node rings', what: 'Common production mistakes are detected live and explained: idle consumers beyond the partition count, acks=1 on critical data, random keys breaking order, no DLQ for poison messages, unclean election.', use: 'Treat a red flag as a question: why does this hurt, and what would I trade to fix it?', to: '/kafka/lab' },
  { name: 'Desirable difficulty via chaos', where: 'Chaos bar, incident drills', what: 'Killing brokers, slowing consumers and injecting poison messages forces you to reason about failure modes, not just the happy path.', use: 'Break every design you finish. A design you haven’t broken isn’t done.', to: '/kafka/lab' },
  { name: 'Spaced, interleaved retrieval', where: 'Review (SM-2)', what: 'Quiz answers and predictions become cards scheduled by SM-2. Review mixes lessons and internals so you practise discriminating between concepts.', use: 'Rate honestly: “Guessed” brings a card back sooner. Ten minutes a day beats one long session.', to: '/kafka/review' },
  { name: 'Judgment drills', where: 'Drills: incidents, sizing, config review, trade-offs', what: 'Senior engineers are paid for decisions under uncertainty. Drills train diagnosis from symptoms, back-of-envelope capacity math, code-review instincts and choosing between workable options.', use: 'Write your reasoning down before answering. That text is your interview answer.', to: '/kafka/drills' },
  { name: 'Knowing when not to', where: 'Compare page', what: 'The trade-off matrix and “when not to use Kafka” build the habit of choosing tools by requirements, not hype.', use: 'For your current work system, run the picker and defend the result.', to: '/kafka/compare' },
];

export function MethodPage() {
  return (
    <div className="flex h-full flex-col">
      <PageBar eyebrow="Learning design" title="How this module teaches" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <p className="text-[13px] leading-relaxed text-muted">
            The aim is engineering judgment, not trivia: given a system and a requirement, pick the right Kafka design, predict how it fails, and explain the mechanism. Each mechanic below targets one part of that.
          </p>
          <div className="mt-4 space-y-2.5">
            {PRINCIPLES.map((p, i) => (
              <Link key={p.name} to={p.to} className="block rounded-xl border border-line bg-surface p-3.5 transition hover:shadow-lift">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-mono text-[14px] font-semibold">{p.name}</span>
                  <span className="ml-auto text-[11px] text-faint">{p.where}</span>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed">
                  <Rich text={p.what} />
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  <b className="text-accent">How to use it: </b>
                  <Rich text={p.use} />
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
