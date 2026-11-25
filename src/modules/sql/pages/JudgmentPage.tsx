import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle } from 'lucide-react';
import { Tag } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { JudgmentKind } from '../types';
import { CONCEPTS } from '../content';
import { trackName } from '../content/tracks';
import { useSql } from '../store';
import { PageHeader, trackTone } from '../ui/common';
import { JudgmentCard, judgmentKindMeta } from '../ui/Judgment';

export default function JudgmentPage() {
  const prog = useSql((s) => s.concepts);
  const [kind, setKind] = useState<JudgmentKind | 'all'>('all');
  const all = useMemo(() => CONCEPTS.flatMap((c) => (c.judgment ?? []).map((item) => ({ c, item }))), []);
  const list = all.filter((x) => kind === 'all' || x.item.kind === kind);
  const [sel, setSel] = useState<string | null>(null);
  const cur = list.find((x) => x.item.id === sel) ?? list.find((x) => prog[x.c.id]?.judged?.[x.item.id] === undefined) ?? list[0];

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Engineer judgment" title="Review real queries">
        Reading SQL critically is the job: PR reviews, slow dashboards, incident queries. Find the line, name the root cause, then see the measured impact of the fix — wrong rows, a 40× slower plan, a race condition.
      </PageHeader>
      <div className="flex flex-wrap gap-1.5">
        {(['all', 'spot-bug', 'slow-query', 'peer-review'] as const).map((k) => (
          <button
            key={k}
            onClick={() => {
              setKind(k);
              setSel(null);
            }}
            className={cn('rounded-md border px-2.5 py-1 text-[12.5px]', kind === k ? 'border-ink bg-ink text-paper' : 'border-line text-muted hover:text-ink')}
          >
            {k === 'all' ? `All (${all.length})` : `${judgmentKindMeta[k].label} (${all.filter((x) => x.item.kind === k).length})`}
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <ul className="max-h-[75vh] space-y-0.5 overflow-y-auto rounded-xl border border-line bg-surface p-2">
          {list.map(({ c, item }) => {
            const r = prog[c.id]?.judged?.[item.id];
            const M = judgmentKindMeta[item.kind];
            return (
              <li key={item.id}>
                <button onClick={() => setSel(item.id)} className={cn('flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-sunken', cur?.item.id === item.id && 'bg-sunken')}>
                  {r === undefined ? <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" /> : <CheckCircle2 className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', r ? 'text-ok' : 'text-warn')} />}
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-ink">{item.title}</span>
                    <span className="flex items-center gap-1 text-[10.5px] text-faint">
                      <M.icon className="h-3 w-3" /> {M.label} · {c.title}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="min-w-0">
          {cur ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <Tag tone={trackTone[cur.c.track]}>{trackName(cur.c.track)}</Tag>
                concept:
                <Link to={`/sql/c/${cur.c.id}`} className="text-ink hover:text-accent">
                  {cur.c.title}
                </Link>
              </div>
              <JudgmentCard key={cur.item.id} concept={cur.c} item={cur.item} />
            </div>
          ) : (
            <div className="text-sm text-muted">No drills in this category yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
