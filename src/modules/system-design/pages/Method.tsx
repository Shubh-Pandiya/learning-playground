import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const PRINCIPLES: { name: string; research: string; here: string }[] = [
  {
    name: 'Worked example → faded guidance',
    research: 'Novices learn more from studying worked examples than from solving cold; support should then fade as skill grows (Sweller, Renkl).',
    here: 'Learn mode builds the reference design step by step. Build mode removes the narration but keeps feedback and three hint levels. Challenge mode allows only two hints.',
  },
  {
    name: 'Prediction before reveal (generation effect)',
    research: 'Committing to an answer before seeing it, even a wrong one, improves later recall and exposes misconceptions (Slamecka & Graf; Kornell et al.).',
    here: 'Guided steps that inject a failure or a traffic spike pause until you predict the outcome. Killing any node asks what will happen first. Your accuracy is tracked.',
  },
  {
    name: 'Immediate, specific feedback',
    research: 'Feedback is most effective when it is immediate and says why, not just right or wrong (Hattie & Timperley).',
    here: 'Every dropped component explains what it solves here and its tradeoffs. Wrong ones turn red with a scenario-specific reason and what to use instead. Bad links are flagged too.',
  },
  {
    name: 'Dual coding and animation',
    research: 'Pairing words with a visual model makes two retrieval paths (Paivio; Mayer). Animation helps for processes that change over time.',
    here: 'Requests flow as dots along edges. Overloaded nodes glow, dead nodes grey out, failing calls stop mid-edge, and queues show backlog. Metrics update in real time.',
  },
  {
    name: 'Desirable difficulty',
    research: 'Conditions that slow learning slightly, like distractors, effort and less scaffolding, improve retention and transfer (Bjork).',
    here: 'The palette mixes correct components with plausible traps, like a cache for a write-heavy ledger or 2PC across microservices. You have to discriminate between them, not just recognise the right one.',
  },
  {
    name: 'Retrieval practice and spaced repetition',
    research: 'Testing beats re-reading, and spacing reviews just before forgetting multiplies retention (Roediger & Karpicke; Cepeda et al.).',
    here: 'Each pattern has recall questions graded by confidence. They feed an SM-2-style schedule, and the home page shows how many are due.',
  },
  {
    name: 'Interleaving',
    research: 'Mixing problem types forces you to choose the strategy, which is the actual interview skill (Rohrer & Taylor).',
    here: 'The Review deck shuffles questions across patterns and adds “name the pattern from the interview cue” drills.',
  },
  {
    name: 'Transfer to new problems',
    research: 'Far transfer needs the same deep structure in different surface stories (Gick & Holyoak).',
    here: 'Every pattern has a Challenge with a different domain and workload. A pattern only counts as mastered once you solve that.',
  },
  {
    name: 'Concrete anchors',
    research: 'Abstract ideas stick when tied to concrete, meaningful cases (elaborative encoding).',
    here: 'Each pattern lists how real systems use it (Netflix, Stripe, Discord, DynamoDB…), and every component lists who runs it in production.',
  },
  {
    name: 'Failure as a teacher',
    research: 'Productive failure: exploring a problem and getting it wrong before instruction deepens understanding (Kapur).',
    here: 'Chaos tools such as kill instance and 2×/4×/10× traffic let you break your own design and see SPOFs, cascades and backlogs right away.',
  },
  {
    name: 'Causal feedback: every change shows its impact',
    research: 'Learners build mental models faster when cause and effect are shown together, not left to inference (Mayer’s signalling; contiguity).',
    here: 'Every add, remove, connect, scale, kill or traffic change writes a change-log entry: a before→after diff of p99, capacity, errors, availability and cost, which nodes got hotter or cooler, and any new risks (for example stale reads or a new SPOF). Learn mode shows "What this step changed" for each step.',
  },
  {
    name: 'Look inside the box (mental models, not labels)',
    research: 'Experts reason from how a mechanism works, not from its name (Chi’s expert–novice studies). Self-generated structure beats reading (generation effect).',
    here: 'Every component has an Inside view: an animated request path through its parts, an Assemble drill where you drag the parts into the right order, design knobs with real-world defaults, failure modes and napkin numbers, plus hands-on labs (LB algorithms, eviction policies, rate-limit algorithms, B-tree vs LSM, hash rings, bloom filters, inverted index, circuit breaker, queue backlog).',
  },
  {
    name: 'Error detection (design review)',
    research: 'Finding errors in worked examples builds the conceptual knowledge needed to avoid them (Große & Renkl; erroneous examples).',
    here: 'Design-review drills give you a teammate’s plausible but flawed design. You test it live, then flag and classify each flaw. False alarms cost points, so you learn to verify before you object.',
  },
  {
    name: 'Case-based, deliberate practice (incidents)',
    research: 'Experts are built from many worked cases with feedback on decisions under pressure (Ericsson; case-based reasoning; Klein’s recognition-primed decisions).',
    here: 'Incident drills page you with a live, broken system. You go through triage, root cause, mitigate and prevent, with an explanation after every choice, then read a blameless postmortem and a real-world incident of the same shape.',
  },
  {
    name: 'Self-explanation + expert comparison (ADR-lite)',
    research: 'Explaining a decision in your own words, then comparing it with an expert’s, sharpens metacognition, which is knowing what you don’t know (Chi; Dunlosky).',
    here: 'You commit to an option and write a four-line ADR (decision, because, we accept, revisit when) before the expert ADR is revealed. Missed considerations are highlighted, so you see exactly which forces you didn’t weigh.',
  },
];

export function Method() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link to="/system-design" className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-faint hover:text-ink">
          <ArrowLeft size={13} /> Patterns
        </Link>
        <h1 className="mt-3 font-mono text-2xl font-semibold">How this playground teaches</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
          The goal is to solve problems you've never seen, not to memorise 20 diagrams. Each mechanic below comes from learning research.
        </p>
        <div className="mt-5 space-y-3">
          {PRINCIPLES.map((p, i) => (
            <div key={p.name} className="rounded-xl border border-line bg-surface p-4">
              <div className="font-mono text-[13.5px] font-semibold">
                <span className="text-faint">{String(i + 1).padStart(2, '0')}</span> {p.name}
              </div>
              <p className="mt-1 text-[12.5px] italic leading-relaxed text-faint">{p.research}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{p.here}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
