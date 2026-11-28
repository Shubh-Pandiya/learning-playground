import { Suspense, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, BookOpenCheck, Boxes, Cog, FlaskConical, ListChecks, MessageSquareQuote, Puzzle, Workflow } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Callout, Tag } from '@/shared/ui';
import { COMPONENTS } from '../data/components';
import { useSd } from '../store';
import type { ComponentKind } from '../types';
import { IsoGlyph } from '../ui/iso';
import { Rich } from '../ui/Rich';
import { Anatomy } from './Anatomy';
import { Assemble } from './Assemble';
import { DeepInterview } from './deep/DeepInterview';
import { Guide, Takeaways } from './deep/Guide';
import { hasDeep, useDeep } from './deep';
import { getInternals } from './index';
import { LAB_TITLE, LABS } from './labs';
import type { Internals } from './types';

export type InsideTab = 'guide' | 'anatomy' | 'assemble' | 'design' | 'lab' | 'interview' | 'recap';
type Tab = InsideTab;

function Design({ data }: { data: Internals }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  return (
    <div className="space-y-4">
      <section>
        <div className="eyebrow mb-1.5">Design decisions · pick an option to see its effect</div>
        <div className="space-y-2.5">
          {data.knobs.map((k, ki) => {
            const sel = picked[ki] ?? 0;
            const o = k.options[sel];
            return (
              <div key={k.name} className="rounded-lg border border-line bg-surface p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 font-mono text-[12px] font-semibold">{k.name}</span>
                  {k.options.map((x, i) => (
                    <button
                      key={x.label}
                      onClick={() => setPicked((p) => ({ ...p, [ki]: i }))}
                      className={cn('rounded-md border px-2 py-0.5 font-mono text-[11px]', i === sel ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:border-accent/50')}
                    >
                      {x.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink/90">
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-accent">effect </span>
                  <Rich text={o.effect} />
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-ok">choose when </span>
                  <Rich text={o.when} />
                </p>
              </div>
            );
          })}
        </div>
      </section>
      <section>
        <div className="eyebrow mb-1.5">How real systems build it</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.implementations.map((im) => (
            <div key={im.name} className="rounded-lg border border-line bg-surface p-2.5">
              <div className="font-mono text-[12px] font-semibold">{im.name}</div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                <Rich text={im.how} />
              </p>
            </div>
          ))}
        </div>
      </section>
      <Callout tone="info" title="Keeping the component itself available & scalable">
        <span className="text-[12.5px]">
          <Rich text={data.ha} />
        </span>
      </Callout>
      <section>
        <div className="eyebrow mb-1.5">How it fails in production</div>
        <div className="overflow-hidden rounded-lg border border-line">
          {data.failureModes.map((f, i) => (
            <div key={f.name} className={cn('grid gap-2 p-2.5 text-[12px] sm:grid-cols-[130px_1fr_1fr]', i > 0 && 'border-t border-line')}>
              <div className="font-mono font-semibold text-bad">{f.name}</div>
              <div className="text-muted">
                <span className="font-mono text-[10px] uppercase text-faint">symptom </span>
                <Rich text={f.symptom} />
              </div>
              <div className="text-muted">
                <span className="font-mono text-[10px] uppercase text-ok">fix </span>
                <Rich text={f.fix} />
              </div>
            </div>
          ))}
        </div>
      </section>
      {data.numbers && data.numbers.length > 0 && (
        <section>
          <div className="eyebrow mb-1.5">Napkin numbers</div>
          <div className="flex flex-wrap gap-1.5">
            {data.numbers.map((n) => (
              <span key={n} className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-ink/90">
                {n}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Interview({ data, warmup }: { data: Internals; warmup?: boolean }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <div className="space-y-2.5">
      <p className="text-[12.5px] text-muted">{warmup ? 'Warm-up questions (SDE-2 level).' : 'Answer out loud (or in your head) before revealing. Retrieval beats re-reading.'}</p>
      {data.interview.map((q, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface p-3">
          <p className="font-mono text-[12.5px] font-semibold leading-snug">
            <Rich text={q.q} />
          </p>
          {open[i] ? (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              <Rich text={q.a} />
            </p>
          ) : (
            <button className="mt-1.5 font-mono text-[11px] text-accent hover:underline" onClick={() => setOpen((o) => ({ ...o, [i]: true }))}>
              I’ve answered — reveal the model answer
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** "Inside" view: how a component is actually implemented — anatomy, assembly, design knobs, lab, interview. */
export function InternalsView({ kind, initialTab }: { kind: ComponentKind; initialTab?: Tab }) {
  const data = getInternals(kind);
  const def = COMPONENTS[kind];
  const prog = useSd((s) => s.inside[kind]);
  const mark = useSd((s) => s.markInside);
  const deep = useDeep(kind);
  const [tab, setTab] = useState<Tab>(initialTab ?? (hasDeep(kind) ? 'guide' : 'anatomy'));
  const labs = data?.lab ? [data.lab, ...(data.moreLabs ?? [])] : [];
  const [labIdx, setLabIdx] = useState(0);
  const onReadAll = useCallback(() => mark(kind, 'guide'), [kind, mark]);
  const onAttempted = useCallback(() => mark(kind, 'interview'), [kind, mark]);

  useEffect(() => {
    if (data) mark(kind, 'seen');
  }, [kind, data, mark]);
  useEffect(() => {
    if (tab === 'lab' && data?.lab) mark(kind, 'lab');
  }, [tab, kind, data, mark]);

  if (!data)
    return (
      <div className="rounded-lg border border-dashed border-line p-4 text-[12.5px] text-muted">
        <b className="font-mono text-ink">{def.name}</b> is the caller, not a component you build — no internals to explore.
      </div>
    );

  const tabs: { id: Tab; label: string; icon: typeof Boxes; done?: boolean }[] = [
    ...(hasDeep(kind) ? [{ id: 'guide' as Tab, label: 'Guide', icon: BookOpen, done: prog?.guide }] : []),
    { id: 'anatomy', label: 'Anatomy', icon: Workflow, done: prog?.seen },
    { id: 'assemble', label: 'Assemble', icon: Puzzle, done: prog?.assembled },
    { id: 'design', label: 'Design', icon: Cog },
    ...(data.lab ? [{ id: 'lab' as Tab, label: 'Lab', icon: FlaskConical, done: prog?.lab }] : []),
    { id: 'interview', label: 'Interview', icon: MessageSquareQuote, done: prog?.interview },
    ...(hasDeep(kind) ? [{ id: 'recap' as Tab, label: 'Recap', icon: ListChecks }] : []),
  ];
  const labId = labs[Math.min(labIdx, labs.length - 1)];
  const Lab = labId ? LABS[labId] : null;
  const loading = <div className="p-6 text-center font-mono text-[12px] text-faint">loading…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <IsoGlyph kind={kind} size={48} />
        <div className="min-w-0 flex-1">
          <div className="eyebrow">How it’s built</div>
          <div className="font-mono text-[15px] font-semibold">{def.name}</div>
          <div className="font-mono text-[11px] text-faint">{def.tech}</div>
        </div>
        {data.lab && (
          <Tag size="sm" tone="violet">
            {labs.length > 1 ? `${labs.length} labs` : `lab: ${LAB_TITLE[data.lab]}`}
          </Tag>
        )}
      </div>
      {data.kafka && (
        <Link to="/kafka" className="flex items-center gap-2 rounded-lg border border-violet/40 bg-violet/[0.06] px-3 py-2 text-[12.5px] hover:bg-violet/10">
          <BookOpenCheck size={15} className="text-violet" />
          <span className="flex-1">Partitions, consumer groups, offsets, ISR and exactly-once are covered in depth in the Kafka module.</span>
          <ArrowUpRight size={14} className="text-violet" />
        </Link>
      )}
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider',
              tab === t.id ? '-mb-px border-b-2 border-accent text-ink' : 'text-faint hover:text-muted',
            )}
          >
            <t.icon size={12} />
            {t.label}
            {t.done && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
          </button>
        ))}
      </div>
      {tab === 'guide' && (deep ? <Guide d={deep} onReadAll={onReadAll} /> : loading)}
      {tab === 'anatomy' && <Anatomy data={data} />}
      {tab === 'assemble' && <Assemble key={kind} data={data} onSolved={() => mark(kind, 'assembled')} />}
      {tab === 'design' && <Design data={data} />}
      {tab === 'lab' && Lab && (
        <div className="space-y-2">
          {labs.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {labs.map((l, i) => (
                <button
                  key={l}
                  onClick={() => setLabIdx(i)}
                  className={cn('rounded-md border px-2 py-0.5 font-mono text-[11px]', l === labId ? 'border-violet bg-violet/10 text-ink' : 'border-line text-muted hover:border-violet/50')}
                >
                  {LAB_TITLE[l]}
                </button>
              ))}
            </div>
          )}
          <Suspense fallback={loading}>
            <Lab key={labId} />
          </Suspense>
        </div>
      )}
      {tab === 'interview' &&
        (deep ? (
          <div className="space-y-5">
            <DeepInterview d={deep} onAttempted={onAttempted} />
            <Interview data={data} warmup />
          </div>
        ) : deep === undefined ? (
          loading
        ) : (
          <Interview data={data} />
        ))}
      {tab === 'recap' &&
        (deep ? (
          <div className="space-y-3">
            <Takeaways items={deep.takeaways} />
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="eyebrow mb-1.5">Self-check · can you answer each in 60 seconds?</div>
              <ol className="space-y-1">
                {deep.interview.map((q, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-snug">
                    <span className="font-mono text-[11px] text-faint">{i + 1}.</span>
                    <span>
                      <Rich text={q.q} />
                    </span>
                  </li>
                ))}
              </ol>
              <button onClick={() => setTab('interview')} className="mt-2 font-mono text-[11px] text-accent hover:underline">
                practise them in the Interview tab →
              </button>
            </div>
          </div>
        ) : (
          loading
        ))}
    </div>
  );
}
