import { Building2, CheckCircle2 } from 'lucide-react';
import { Tag } from '@/shared/ui';
import { useDm } from '../store';
import type { Topic } from '../types';
import { QuizCard } from './Quiz';
import { Rich } from './Rich';

export function Brief({ topic }: { topic: Topic }) {
  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-relaxed text-ink">
        <Rich text={topic.tagline} />
      </p>
      <section>
        <div className="eyebrow mb-1.5">Interview signals → reach for this</div>
        <div className="flex flex-wrap gap-1.5">
          {topic.signals.map((s) => (
            <Tag key={s} size="sm" tone="accent" className="!h-auto whitespace-normal py-0.5">
              {s}
            </Tag>
          ))}
        </div>
      </section>
      <section>
        <div className="eyebrow mb-1.5">You'll be able to</div>
        <ul className="space-y-1 text-[13px] text-muted">
          {topic.learn.map((l) => (
            <li key={l} className="flex gap-2">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
              <span>
                <Rich text={l} />
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <div className="eyebrow mb-1.5">In production</div>
        <div className="space-y-2">
          {topic.realWorld.map((r) => (
            <div key={r.who} className="rounded-lg border border-line bg-surface p-2.5">
              <div className="flex items-center gap-1.5 font-mono text-[12px] font-semibold">
                <Building2 size={13} className="text-accent" /> {r.who}
              </div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                <Rich text={r.how} />
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function Recall({ topic }: { topic: Topic }) {
  const grade = useDm((s) => s.grade);
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-faint">Answer from memory, then rate how sure you were. Questions come back in the Review deck on a spaced schedule.</p>
      {topic.quiz.map((q) => (
        <QuizCard key={q.id} item={q} onGraded={(g) => grade(q.id, g)} />
      ))}
    </div>
  );
}
