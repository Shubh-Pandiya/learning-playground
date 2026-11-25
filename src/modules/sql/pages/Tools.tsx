import { Link } from 'react-router-dom';
import { CONCEPTS } from '../content';
import { PageHeader } from '../ui/common';
import { BTreeLab } from '../ui/BTreeLab';
import { IsolationSim } from '../ui/Isolation';

function Related({ viz }: { viz: 'index' | 'plan' | 'isolation' }) {
  const list = CONCEPTS.filter((c) => c.viz === viz || (viz === 'index' && c.viz === 'plan'));
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
      Go deeper with real EXPLAIN on 200k rows:
      {list.map((c) => (
        <Link key={c.id} to={`/sql/c/${c.id}`} className="rounded-md border border-line bg-surface px-2 py-0.5 text-ink hover:border-ink/40">
          {c.title}
        </Link>
      ))}
    </div>
  );
}

export function IndexesPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="How indexes are actually built" title="B+tree index lab">
        A Postgres B-tree index is a tree of 8 KB pages: internal pages route by key, leaf pages hold (key → row pointer) and are chained left-to-right. Step through a lookup page by page and count the
        I/O — the thing that actually costs time. Change the page size, the index columns and the predicate; each change tells you what happened and what it means for your query.
      </PageHeader>
      <Related viz="index" />
      <BTreeLab />
    </div>
  );
}

export function IsolationPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Concurrency" title="Isolation levels & MVCC lab">
        Two transactions interleave on one timeline. Postgres keeps multiple row versions (xmin / xmax) and each transaction reads through its snapshot. Pick a scenario, step through, then switch the
        isolation level to see exactly which step changes and why — plus the fix an engineer would ship.
      </PageHeader>
      <IsolationSim />
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        Concepts:
        {CONCEPTS.filter((c) => c.track === 'transactions').map((c) => (
          <Link key={c.id} to={`/sql/c/${c.id}`} className="rounded-md border border-line bg-surface px-2 py-0.5 text-ink hover:border-ink/40">
            {c.title}
          </Link>
        ))}
      </div>
    </div>
  );
}
