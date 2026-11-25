import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck } from 'lucide-react';
import { Button, Tag } from '@/shared/ui';
import type { RecallGrade } from '@/shared/progress';
import { CONCEPTS } from '../content';
import { trackName } from '../content/tracks';
import { isConceptDue, useSql } from '../store';
import { Md, PageHeader, trackTone } from '../ui/common';

const GRADES: { g: RecallGrade; label: string; hint: string; variant: 'danger' | 'secondary' | 'success' | 'primary' }[] = [
  { g: 0, label: 'Again', hint: 'couldn’t recall', variant: 'danger' },
  { g: 1, label: 'Hard', hint: 'with effort', variant: 'secondary' },
  { g: 2, label: 'Good', hint: 'recalled', variant: 'success' },
  { g: 3, label: 'Easy', hint: 'instant', variant: 'primary' },
];

export default function Review() {
  const prog = useSql((s) => s.concepts);
  const grade = useSql((s) => s.grade);
  const [ahead, setAhead] = useState(false);
  const queue = useMemo(
    () =>
      CONCEPTS.filter((c) => (ahead ? !!prog[c.id]?.card : isConceptDue(prog[c.id]))).sort((a, b) => (prog[a.id]!.card!.due < prog[b.id]!.card!.due ? -1 : 1)),
    // only rebuild when the set of cards changes, not on every grade
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ahead],
  );
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const c = queue[i];
  const q = useMemo(() => (c ? c.recall[Math.floor(Math.random() * c.recall.length)] : undefined), [c]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Spaced repetition" title="Review">
        Concepts enter review once you’ve built or solved them. Answer from memory first — effortful retrieval is what makes it last — then grade honestly; the next review is scheduled from your grade.
      </PageHeader>
      {c && q ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            card {i + 1}/{queue.length}
            <Tag tone={trackTone[c.track]}>{trackName(c.track)}</Tag>
            <Link to={`/sql/c/${c.id}`} className="hover:text-ink">
              {c.title}
            </Link>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5 text-[16px] font-medium leading-relaxed text-ink shadow-paper">
            <Md text={q.q} />
          </div>
          {!shown ? (
            <Button variant="primary" onClick={() => setShown(true)}>
              I’ve answered — show the answer
            </Button>
          ) : (
            <>
              <div className="rounded-xl border border-ok/40 bg-ok/[0.05] p-4 text-[14px] leading-relaxed text-ink">
                <Md text={q.a} />
              </div>
              <div className="rounded-lg border border-line bg-sunken/40 p-3 text-[12.5px] text-muted">
                <b className="text-ink">Also check:</b> could you write the template from memory?
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[11.5px] text-ink">{c.template.trim()}</pre>
              </div>
              <div className="flex flex-wrap gap-2">
                {GRADES.map((g) => (
                  <Button
                    key={g.g}
                    variant={g.variant}
                    onClick={() => {
                      grade(c.id, g.g);
                      setShown(false);
                      setI((x) => x + 1);
                    }}
                  >
                    {g.label} <span className="ml-1 text-[10px] opacity-70">{g.hint}</span>
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-6 text-center shadow-paper">
          <CalendarCheck className="mx-auto h-8 w-8 text-ok" />
          <div className="mt-2 font-medium text-ink">{i > 0 ? 'Review done for now.' : 'Nothing due.'}</div>
          <p className="mt-1 text-sm text-muted">Build or solve a concept to add it to your review schedule.</p>
          <div className="mt-4 flex justify-center gap-2">
            {!ahead && CONCEPTS.some((x) => prog[x.id]?.card) && (
              <Button
                variant="secondary"
                onClick={() => {
                  setAhead(true);
                  setI(0);
                }}
              >
                Practise ahead anyway
              </Button>
            )}
            <Link to="/sql/drill">
              <Button variant="primary">Do a recognition drill</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
