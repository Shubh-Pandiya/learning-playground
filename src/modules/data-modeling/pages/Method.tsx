import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const PRINCIPLES: { name: string; research: string; here: string }[] = [
  {
    name: 'Causal feedback: every change shows its impact',
    research: 'Mental models form faster when cause and effect appear together rather than being left to inference (Mayer: signalling, contiguity).',
    here: 'Every drop, move, key toggle, index or relationship writes a change-log entry: which queries gained or lost a join, how many rows a write now touches, which anomalies appeared or vanished, storage and duplication before → after, and the closeness delta. Learn mode shows "What this step changed" for each step.',
  },
  {
    name: 'Worked example → faded guidance → scratch',
    research: 'Novices learn more from studying worked examples than from solving cold, and support should fade as skill grows (Sweller; Renkl).',
    here: 'Learn mode assembles the reference model step by step. Build gives you the requirements, the palette and three hint levels. Challenge allows two hints, hides the "should be…" details and changes the domain.',
  },
  {
    name: 'Prediction before reveal',
    research: 'Committing to an answer first, even a wrong one, improves recall and surfaces misconceptions (Slamecka & Graf; Kornell et al.).',
    here: 'Key steps freeze the canvas until you predict: "which anomaly happens if…", "how many rows does this update touch?", "what does SCD2 do to this row?". Your accuracy is tracked on the home page.',
  },
  {
    name: 'Desirable difficulty: plausible traps',
    research: 'Distractors and effort slow learning a little but improve retention and transfer (Bjork).',
    here: 'Palettes mix correct tables and columns with tempting wrong ones: a fact at the wrong grain, a natural key that changes, a snowflaked dimension, a summed balance, a hot partition key. Wrong choices turn red with the reason and the fix.',
  },
  {
    name: 'Dual coding and animation',
    research: 'Words plus a visual model give two retrieval paths (Paivio; Mayer). Animation helps for processes that change over time.',
    here: 'Query paths light up across joins, full scans are badged, duplicated values repeat visibly, anomalies animate row by row in the normalization lab, SCD rows version over a timeline, and partitions and files move in the layout labs.',
  },
  {
    name: 'Mechanism, not labels',
    research: 'Experts reason from how a mechanism works rather than from its name (Chi: expert vs novice studies).',
    here: 'Every lab has "under the hood" notes: how Postgres enforces FKs and builds B-tree indexes, how Delta/Iceberg MERGE rewrites files for SCD2, how DynamoDB hashes partition keys, how Postgres RLS filters rows per tenant, how expand/contract migrations avoid table locks.',
  },
  {
    name: 'Retrieval practice and spaced repetition',
    research: 'Testing beats re-reading, and spacing reviews just before forgetting multiplies retention (Roediger & Karpicke; Cepeda et al.).',
    here: 'Every topic has recall questions graded by confidence. They feed an SM-2-style schedule, and due cards surface on the home page and in the cross-module Today plan.',
  },
  {
    name: 'Interleaving',
    research: 'Mixing problem types forces you to choose the strategy, which is the real interview skill (Rohrer & Taylor).',
    here: 'The Review deck shuffles questions across topics and adds "name the technique from the interview cue" drills.',
  },
  {
    name: 'Transfer to new problems',
    research: 'Far transfer needs the same deep structure in different surface stories (Gick & Holyoak).',
    here: 'Every canvas topic has a Challenge in a different domain (course enrolment → ride-hailing, retail sales → trips, CRM → insurance). A topic only counts as mastered once you solve it.',
  },
  {
    name: 'Error detection (schema review)',
    research: 'Finding errors in flawed worked examples builds the knowledge needed to avoid them (Große & Renkl).',
    here: 'The schema-review lab hands you a teammate’s plausible but flawed schema. You flag and classify each flaw. False alarms cost points, so you learn to verify before you object.',
  },
  {
    name: 'Judgment under constraints',
    research: 'Expertise is built from decisions with feedback on consequences (Ericsson; Klein: recognition-primed decisions).',
    here: 'Labs ask for decisions with real costs: an online migration with zero downtime, choosing a partition key against a skewed workload, picking a tenancy model for 10 vs 10,000 tenants. Each decision shows rows locked, bytes scanned, blast radius or cost.',
  },
  {
    name: 'Concrete anchors',
    research: 'Abstract ideas stick when tied to concrete, meaningful cases (elaborative encoding).',
    here: 'Each topic lists how real systems use it (Stripe ledgers, Uber trips, Amazon’s DynamoDB single-table design, Databricks medallion, Salesforce multi-tenancy, Kimball retail schemas).',
  },
];

export function Method() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link to="/data-modeling" className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-faint hover:text-ink">
          <ArrowLeft size={13} /> Topics
        </Link>
        <h1 className="mt-3 font-mono text-2xl font-semibold">How this playground teaches</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
          The goal is to model data for problems you've never seen and defend every choice with its cost, not to memorise normal forms. Each mechanic
          below comes from learning research.
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
