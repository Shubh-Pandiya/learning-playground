import { Link } from 'react-router-dom';
import { principles } from '../data/learning';
import { PageHeader } from '../components/common';
import { MASTERY_LABELS } from '../store';

export default function Method() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Learning design" title="How this playground teaches">
        The goal is not to memorise 150 solutions but to recognise and adapt ~27 patterns under interview pressure, including on problems you have never seen.
        Each mechanic below comes from cognitive-science research on how people learn faster and transfer better.
      </PageHeader>

      <section className="mb-8 rounded-xl border border-line bg-surface p-5 shadow-paper">
        <div className="eyebrow mb-2">the loop for every problem</div>
        <ol className="grid gap-3 text-sm md:grid-cols-5">
          {[
            ['Recognise', 'Guess the pattern from the statement'],
            ['Watch & predict', 'Step through the real run; predict the next move'],
            ['Rebuild', 'Worked → gaps → from scratch, with trap blocks'],
            ['Explain', 'Write why it works + where you would use it'],
            ['Space it', 'Rate recall; it comes back before you forget'],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-lg border border-line bg-paper p-3">
              <div className="font-mono text-xs text-accent">{i + 1}</div>
              <div className="font-medium text-ink">{t}</div>
              <div className="text-xs text-muted">{d}</div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted">
          Mastery levels: {MASTERY_LABELS.map((l, i) => `${i} ${l}`).join(' · ')}. Level 4 needs a from-scratch build plus 3 successful spaced reviews.
        </p>
      </section>

      <div className="space-y-3">
        {principles.map((p, i) => (
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

      <div className="mt-8 text-center">
        <Link to="/dsa" className="text-sm text-muted underline hover:text-ink">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
