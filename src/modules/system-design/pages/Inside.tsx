import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Cpu, FlaskConical } from 'lucide-react';
import { cn } from '@/shared/cn';
import { CATEGORY_LABEL, COMPONENTS } from '../data/components';
import { ALL_INTERNALS, getInternals } from '../internals';
import { InternalsView } from '../internals/InternalsView';
import { hasDeep } from '../internals/deep';
import { LAB_TITLE } from '../internals/labs';
import type { LabId } from '../internals/types';
import { useSd } from '../store';
import type { ComponentKind } from '../types';
import { IsoGlyph } from '../ui/iso';

const ORDER = ['entry', 'compute', 'data', 'messaging', 'control', 'anti'] as const;
const GROUP_LABEL: Record<string, string> = { ...CATEGORY_LABEL, anti: 'Anti-patterns (know why they fail)' };

function grouped() {
  return ORDER.map((c) => ({ c, items: ALL_INTERNALS.filter((i) => COMPONENTS[i.kind].category === c) })).filter((g) => g.items.length);
}

/** First kind that hosts each lab, so a lab can be opened directly. */
function labHosts(): [LabId, ComponentKind][] {
  const seen = new Map<LabId, ComponentKind>();
  for (const i of ALL_INTERNALS) for (const l of [i.lab, ...(i.moreLabs ?? [])]) if (l && !seen.has(l)) seen.set(l, i.kind);
  return [...seen.entries()];
}

function Library() {
  const inside = useSd((s) => s.inside);
  const seen = ALL_INTERNALS.filter((i) => inside[i.kind]?.seen).length;
  const assembled = ALL_INTERNALS.filter((i) => inside[i.kind]?.assembled).length;
  const guides = ALL_INTERNALS.filter((i) => inside[i.kind]?.guide).length;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-7">
        <Link to="/system-design" className="inline-flex items-center gap-1 font-mono text-[12px] text-faint hover:text-ink">
          <ArrowLeft size={13} /> Pattern map
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Component internals</div>
            <h1 className="font-mono text-2xl font-semibold">How each box is actually built</h1>
            <p className="mt-1 max-w-2xl text-[13.5px] text-muted">
              A box on a diagram hides a whole system. Each component has an SDE-3 guide (first principles, real architecture, latency budget, algorithms, failure modes with war
              stories, numbers, tradeoffs), an animated anatomy you can rebuild by drag-and-drop, live labs, and senior-level interview drills with follow-up probes.
            </p>
          </div>
          <div className="font-mono text-[12px] text-muted">
            {seen}/{ALL_INTERNALS.length} explored · {guides} guides read · {assembled} assembled
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-violet/30 bg-violet/[0.05] p-3">
          <div className="eyebrow mb-2 flex items-center gap-1.5 text-violet">
            <FlaskConical size={13} /> Labs · change the algorithm, watch the system react
          </div>
          <div className="flex flex-wrap gap-1.5">
            {labHosts().map(([lab, kind]) => (
              <Link
                key={lab}
                to={`/system-design/inside/${kind}?tab=lab`}
                className="rounded-md border border-line bg-surface px-2.5 py-1 font-mono text-[11.5px] hover:border-violet/60 hover:text-violet"
              >
                {LAB_TITLE[lab]}
              </Link>
            ))}
          </div>
        </div>

        {grouped().map(({ c, items }) => (
          <section key={c} className="mt-6">
            <div className="eyebrow mb-2">{GROUP_LABEL[c]}</div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((i) => {
                const d = COMPONENTS[i.kind];
                const p = inside[i.kind];
                return (
                  <Link
                    key={i.kind}
                    to={`/system-design/inside/${i.kind}`}
                    className="group flex gap-2.5 rounded-xl border border-line bg-surface p-2.5 transition hover:-translate-y-px hover:border-accent/60 hover:shadow-sm"
                  >
                    <IsoGlyph kind={i.kind} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="truncate font-mono text-[12.5px] font-semibold">{d.name}</span>
                        {p?.assembled && <CheckCircle2 size={12} className="shrink-0 text-ok" />}
                      </div>
                      <div className="truncate font-mono text-[10.5px] text-faint">{d.tech}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="rounded bg-sunken px-1 font-mono text-[9.5px] text-muted">{i.parts.length} parts</span>
                        {hasDeep(i.kind) && <span className={cn('rounded px-1 font-mono text-[9.5px]', p?.guide ? 'bg-ok/10 text-ok' : 'bg-accent/10 text-accent')}>SDE-3 guide{p?.guide ? ' ✓' : ''}</span>}
                        {i.lab && <span className="rounded bg-violet/10 px-1 font-mono text-[9.5px] text-violet">{1 + (i.moreLabs?.length ?? 0)} lab{i.moreLabs?.length ? 's' : ''}</span>}
                        {i.kafka && <span className="rounded bg-info/10 px-1 font-mono text-[9.5px] text-info">→ kafka</span>}
                        {p?.seen && !p.assembled && <span className="rounded bg-sunken px-1 font-mono text-[9.5px] text-faint">seen</span>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Detail({ kind }: { kind: ComponentKind }) {
  const [q] = useSearchParams();
  const inside = useSd((s) => s.inside);
  const tab = q.get('tab');
  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[230px] shrink-0 overflow-y-auto border-r border-line bg-paper p-3 md:block">
        <Link to="/system-design/inside" className="mb-2 inline-flex items-center gap-1 font-mono text-[12px] text-faint hover:text-ink">
          <ArrowLeft size={13} /> All components
        </Link>
        {grouped().map(({ c, items }) => (
          <div key={c} className="mt-2">
            <div className="eyebrow mb-0.5 !text-[9.5px]">{GROUP_LABEL[c]}</div>
            {items.map((i) => (
              <Link
                key={i.kind}
                to={`/system-design/inside/${i.kind}`}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11.5px]',
                  i.kind === kind ? 'bg-accent/10 text-ink' : 'text-muted hover:bg-sunken hover:text-ink',
                )}
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', inside[i.kind]?.assembled ? 'bg-ok' : inside[i.kind]?.seen ? 'bg-faint' : 'bg-line')} />
                <span className="truncate">{COMPONENTS[i.kind].name}</span>
                {i.lab && <FlaskConical size={10} className="ml-auto shrink-0 text-violet" />}
              </Link>
            ))}
          </div>
        ))}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <InternalsView key={`${kind}:${tab}`} kind={kind} initialTab={tab === 'lab' ? 'lab' : undefined} />
        </div>
      </main>
    </div>
  );
}

export function Inside() {
  const { kind } = useParams();
  if (kind && getInternals(kind as ComponentKind)) return <Detail kind={kind as ComponentKind} />;
  return <Library />;
}

/** Small entry-point card used on the pattern map. */
export function InsideTeaser() {
  return (
    <Link to="/system-design/inside" className="flex items-center gap-2 rounded-xl border border-violet/40 bg-violet/[0.05] px-3 py-2.5 hover:bg-violet/10">
      <Cpu size={18} className="text-violet" />
      <div>
        <div className="font-mono text-[12.5px] font-semibold">Component internals</div>
        <div className="text-[11.5px] text-muted">How a load balancer, Redis, a B-tree… are really built</div>
      </div>
    </Link>
  );
}
