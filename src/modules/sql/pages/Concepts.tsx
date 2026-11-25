import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { conceptsInTrack, TRACKS } from '../content';
import { MASTERY_LABELS, mastery, useSql } from '../store';
import { InterviewHeat, LevelTag, MasteryDots, PageHeader, StatusIcon } from '../ui/common';

const VIZ_LABEL = { pipeline: 'step-through', recursive: 'recursion', index: 'B+tree', plan: 'EXPLAIN', isolation: 'MVCC sim' } as const;

export default function Concepts() {
  const prog = useSql((s) => s.concepts);
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Advanced SQL" title="Concepts">
        Ordered so each builds on the last. Every concept: intuition → how Postgres does it → a visual run on real data with predictions → drag-and-drop rebuild → exercises → judgment drills.
      </PageHeader>
      {TRACKS.map((t) => (
        <section key={t.id} id={t.id}>
          <div className="mb-2">
            <h2 className="text-lg font-semibold text-ink">
              <span className="mr-2 font-mono text-[12px] text-faint">{String(t.order).padStart(2, '0')}</span>
              {t.name}
            </h2>
            <p className="text-sm text-muted">{t.blurb}</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {conceptsInTrack(t.id).map((c) => {
              const p = prog[c.id];
              return (
                <Link key={c.id} to={`/sql/c/${c.id}`} className="group flex flex-wrap items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-0 hover:bg-sunken/50">
                  <StatusIcon c={c} p={p} />
                  <div className="min-w-[240px] flex-1">
                    <div className="text-[14px] font-medium text-ink group-hover:text-accent">{c.title}</div>
                    <div className="text-[12px] text-muted">{c.tagline}</div>
                  </div>
                  <span className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-muted">{VIZ_LABEL[c.viz]}</span>
                  <LevelTag level={c.level} />
                  <InterviewHeat n={c.interview} />
                  <span className="flex w-14 items-center gap-1 text-[11px] text-faint">
                    <Clock className="h-3 w-3" />
                    {c.minutes}m
                  </span>
                  <span className="flex w-28 items-center justify-end gap-2 text-[11px] text-muted">
                    {MASTERY_LABELS[mastery(c, p)]} <MasteryDots c={c} p={p} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
