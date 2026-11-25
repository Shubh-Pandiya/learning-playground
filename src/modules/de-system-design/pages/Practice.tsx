import { Link } from 'react-router-dom';
import { ArrowLeft, BellRing, FileText, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Tag } from '@/shared/ui';
import { ADRS } from '../judgment/data/adrs';
import { INCIDENTS } from '../judgment/data/incidents';
import { REVIEWS } from '../judgment/data/reviews';
import { useDesd, type DrillType } from '../store';

interface Item {
  id: string;
  title: string;
  sub: string;
  tag?: { label: string; tone: 'bad' | 'warn' | 'info' | 'accent' | 'violet' | 'neutral' };
}

function Section({ type, title, blurb, icon: Icon, items }: { type: DrillType; title: string; blurb: string; icon: LucideIcon; items: Item[] }) {
  const drills = useDesd((s) => s.drills);
  const done = items.filter((i) => drills[`${type}:${i.id}`]).length;
  return (
    <section className="mt-8">
      <div className="mb-1 flex items-baseline gap-3">
        <Icon size={15} className="self-center text-accent" />
        <h2 className="font-mono text-[13px] font-semibold uppercase tracking-wider">{title}</h2>
        <span className="font-mono text-[11px] text-faint">
          {done}/{items.length} attempted
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <p className="mb-3 max-w-3xl text-[12.5px] text-muted">{blurb}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => {
          const r = drills[`${type}:${i.id}`];
          return (
            <Link
              key={i.id}
              to={`/de-system-design/practice/${type}/${i.id}`}
              className="group flex flex-col justify-between rounded-xl border border-line bg-surface p-3 transition hover:-translate-y-0.5 hover:shadow-lift"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-[13px] font-semibold leading-snug group-hover:text-accent">{i.title}</span>
                  {i.tag && (
                    <Tag size="sm" tone={i.tag.tone}>
                      {i.tag.label}
                    </Tag>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">{i.sub}</p>
              </div>
              <div className="mt-2 font-mono text-[10.5px]">
                {r ? (
                  <span className={cn(r.best >= 80 ? 'text-ok' : r.best >= 50 ? 'text-warn' : 'text-bad')}>
                    best {r.best}% · {r.attempts} attempt{r.attempts === 1 ? '' : 's'}
                  </span>
                ) : (
                  <span className="text-faint">not attempted</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const plain = (s: string) => s.replace(/\*\*|`|_/g, '');

export function Practice() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Link to="/de-system-design" className="inline-flex items-center gap-1 font-mono text-[12px] text-faint hover:text-ink">
          <ArrowLeft size={13} /> Pattern map
        </Link>
        <p className="eyebrow mt-3">Engineering judgment</p>
        <h1 className="mt-1 font-mono text-2xl font-semibold">Think like the senior in the room</h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">
          Knowing the patterns is recall. Seniors are hired for judgment: spotting what will break in someone else's design, staying calm at 3 a.m., and writing down a
          tradeoff others can trust. These drills train exactly that, using the same live simulator.
        </p>
        <Section
          type="review"
          title="Design reviews"
          icon={Search}
          blurb="A teammate's design looks reasonable. Find the flaws a senior would block it for: kill nodes, raise volume, run chaos (late data, replays, schema changes), then flag and classify. False alarms cost points."
          items={REVIEWS.map((r) => ({ id: r.id, title: r.title, sub: plain(r.context), tag: { label: `${r.flaws.length} flaws · ${r.level}`, tone: r.level === 'Advanced' ? 'violet' : 'info' } }))}
        />
        <Section
          type="incident"
          title="Incident drills"
          icon={BellRing}
          blurb="You're on call for the data platform. A dashboard doubled overnight, partitions are missing, a stream is stuck: the pipeline is live and broken in front of you. Triage → root cause → mitigate → prevent, then read the blameless postmortem."
          items={INCIDENTS.map((r) => ({ id: r.id, title: r.title, sub: plain(r.alert), tag: { label: r.severity, tone: r.severity === 'SEV1' ? 'bad' : r.severity === 'SEV2' ? 'warn' : 'info' } }))}
        />
        <Section
          type="adr"
          title="Decision records (ADR-lite)"
          icon={FileText}
          blurb="Make a call and write it down in four lines: decision, because, we accept, revisit when. Then compare it with an expert's ADR and see which forces you missed."
          items={ADRS.map((r) => ({ id: r.id, title: r.title, sub: plain(r.context), tag: { label: `${r.options.length} options`, tone: 'accent' } }))}
        />
      </div>
    </div>
  );
}

/** Entry-point card for the pattern map. */
export function PracticeTeaser() {
  const drills = useDesd((s) => s.drills);
  const n = Object.keys(drills).length;
  const total = REVIEWS.length + INCIDENTS.length + ADRS.length;
  return (
    <Link to="/de-system-design/practice" className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/[0.05] px-3 py-2.5 hover:bg-accent/10">
      <BellRing size={18} className="text-accent" />
      <div>
        <div className="font-mono text-[12.5px] font-semibold">Judgment drills</div>
        <div className="text-[11.5px] text-muted">
          Design reviews, on-call incidents, ADRs · {n}/{total} tried
        </div>
      </div>
    </Link>
  );
}
