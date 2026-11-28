import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Ban, ChevronDown, Lightbulb, Siren, Timer, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { CodeBlock } from '@/shared/ui';
import { Rich } from '../../ui/Rich';
import type { Deep, DeepSection, DeepTable } from '../types';
import { Diagram } from './Diagram';

const SECTIONS = [
  { id: 'problem', label: '1 · Why' },
  { id: 'architecture', label: '2 · Architecture' },
  { id: 'lifecycle', label: '3 · Lifecycle' },
  { id: 'deep-dives', label: '4 · Deep dives' },
  { id: 'scaling', label: '5 · Scale & HA' },
  { id: 'failures', label: '6 · Failures' },
  { id: 'numbers', label: '7 · Numbers' },
  { id: 'tradeoffs', label: '8 · Tradeoffs' },
  { id: 'takeaways', label: 'Recap' },
] as const;

function H({ n, title, sub }: { n?: string; title: string; sub?: string }) {
  return (
    <div className="mb-2 border-b border-line pb-1">
      <h3 className="font-mono text-[13.5px] font-semibold">
        {n && <span className="mr-1.5 text-accent">{n}</span>}
        {title}
      </h3>
      {sub && <p className="text-[11.5px] text-faint">{sub}</p>}
    </div>
  );
}

const P = ({ t, className }: { t: string; className?: string }) => (
  <p className={cn('text-[13px] leading-relaxed text-ink/90', className)}>
    <Rich text={t} />
  </p>
);

export function Table({ t }: { t: DeepTable }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-left text-[11.5px]">
        <thead className="bg-sunken">
          <tr>
            {t.columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => (
                <td key={j} className={cn('px-2 py-1.5 leading-snug', j === 0 ? 'whitespace-nowrap font-mono font-semibold text-ink' : 'text-ink/85')}>
                  <Rich text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {t.caption && (
        <div className="border-t border-line bg-sunken/50 px-2 py-1 text-[11px] text-muted">
          <Rich text={t.caption} />
        </div>
      )}
    </div>
  );
}

function Insight({ text }: { text: string }) {
  return (
    <div className="flex gap-2 rounded-md border border-violet/40 bg-violet/[0.06] px-2.5 py-2 text-[12.5px] leading-relaxed">
      <Lightbulb size={14} className="mt-0.5 shrink-0 text-violet" />
      <span>
        <span className="mr-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet">senior note</span>
        <Rich text={text} />
      </span>
    </div>
  );
}

function DeepDive({ s, open, onToggle, idx }: { s: DeepSection; open: boolean; onToggle: () => void; idx: number }) {
  return (
    <div className={cn('rounded-lg border bg-surface transition-colors', open ? 'border-accent/40' : 'border-line')}>
      <button onClick={onToggle} className="flex w-full items-start gap-2 px-3 py-2 text-left">
        <span className="mt-0.5 font-mono text-[11px] text-faint">4.{idx + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[12.5px] font-semibold text-ink">{s.title}</span>
          <span className="block text-[11.5px] leading-snug text-muted">
            <Rich text={s.hook} />
          </span>
        </span>
        <ChevronDown size={15} className={cn('mt-0.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-line px-3 py-2.5">
          {s.body.map((b, i) => (
            <P key={i} t={b} />
          ))}
          {s.diagram && <Diagram d={s.diagram} />}
          {s.bullets && (
            <ul className="space-y-1">
              {s.bullets.map((b, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink/90">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                  <span>
                    <Rich text={b} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {s.table && <Table t={s.table} />}
          {s.code && (
            <div>
              <CodeBlock code={s.code.code} language={s.code.lang === 'text' ? 'markup' : s.code.lang} showLineNumbers={false} />
              {s.code.caption && <p className="mt-1 text-[11px] text-faint">{s.code.caption}</p>}
            </div>
          )}
          {s.insight && <Insight text={s.insight} />}
        </div>
      )}
    </div>
  );
}

/** Waterfall of the request lifecycle: bars on a sqrt scale so µs-level stages stay visible next to ms-level ones. */
function Waterfall({ d }: { d: Deep['lifecycle'] }) {
  const [sel, setSel] = useState(0);
  const total = d.stages.reduce((a, s) => a + s.ms, 0);
  const scale = (ms: number) => Math.sqrt(ms);
  const sum = d.stages.reduce((a, s) => a + scale(s.ms), 0) || 1;
  let acc = 0;
  const s = d.stages[sel];
  return (
    <div className="space-y-2">
      <P t={d.summary} />
      <div className="rounded-lg border border-line bg-sunken/60 p-2.5">
        <div className="mb-1.5 flex items-center justify-between font-mono text-[10.5px] text-faint">
          <span className="flex items-center gap-1">
            <Timer size={11} /> latency budget · click a stage
          </span>
          <span>
            total ≈ <b className="text-ink">{fmtMs(total)}</b>
          </span>
        </div>
        <div className="space-y-1">
          {d.stages.map((st, i) => {
            const left = (acc / sum) * 100;
            const w = Math.max((scale(st.ms) / sum) * 100, 0.8);
            acc += scale(st.ms);
            const share = total ? (st.ms / total) * 100 : 0;
            return (
              <button key={i} onClick={() => setSel(i)} className={cn('grid w-full grid-cols-[minmax(90px,160px)_1fr_56px] items-center gap-2 rounded px-1 py-0.5 text-left', i === sel && 'bg-accent/10')}>
                <span className={cn('truncate font-mono text-[11px]', i === sel ? 'font-semibold text-ink' : 'text-muted')}>{st.stage}</span>
                <span className="relative h-3">
                  <span
                    className={cn('absolute top-0 h-3 rounded-sm transition-all', share > 30 ? 'bg-bad/70' : share > 10 ? 'bg-warn/70' : 'bg-ok/60', i === sel && 'ring-2 ring-accent/60')}
                    style={{ left: `${left}%`, width: `${w}%` }}
                  />
                </span>
                <span className="text-right font-mono text-[10.5px] text-ink/80">{fmtMs(st.ms)}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[10.5px] text-faint">Bar widths use a √ scale so microsecond steps stay visible; colour = share of total (green &lt;10%, amber &lt;30%, red ≥30%).</p>
      </div>
      {s && (
        <div className="rounded-lg border border-line bg-surface p-2.5">
          <div className="font-mono text-[12px] font-semibold">
            {sel + 1}. {s.stage} <span className="font-normal text-faint">· {fmtMs(s.ms)}</span>
          </div>
          <P t={s.what} className="mt-1" />
          <p className="mt-1 text-[12px] text-muted">
            <span className="font-mono text-[10px] uppercase tracking-wider text-warn">cost </span>
            <Rich text={s.cost} />
          </p>
        </div>
      )}
    </div>
  );
}

export function fmtMs(ms: number) {
  if (ms === 0) return '0';
  if (ms < 1) return `${+(ms * 1000).toFixed(ms < 0.01 ? 1 : 0)}µs`;
  if (ms < 1000) return `${+ms.toFixed(ms < 10 ? 1 : 0)}ms`;
  return `${+(ms / 1000).toFixed(1)}s`;
}

function Capacity({ c }: { c: Deep['capacity'] }) {
  const [shown, setShown] = useState(0);
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="eyebrow mb-1">Worked capacity estimate · try it before revealing</div>
      <P t={c.question} className="font-semibold" />
      <ol className="mt-2 space-y-1">
        {c.steps.slice(0, shown).map((s, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed">
            <span className="font-mono text-[11px] text-accent">{i + 1}.</span>
            <span>
              <Rich text={s} />
            </span>
          </li>
        ))}
      </ol>
      {shown < c.steps.length ? (
        <button onClick={() => setShown((x) => x + 1)} className="mt-2 font-mono text-[11px] text-accent hover:underline">
          {shown === 0 ? 'I have my estimate, show step 1' : 'next step'} →
        </button>
      ) : (
        <div className="mt-2 rounded-md border border-ok/40 bg-ok/[0.07] px-2.5 py-1.5 text-[12.5px]">
          <span className="mr-1 font-mono text-[10px] font-semibold uppercase text-ok">answer</span>
          <Rich text={c.answer} />
        </div>
      )}
    </div>
  );
}

/** The SDE-3 guide: one long, sectioned page with a sticky table of contents and collapsible deep dives. */
export function Guide({ d, onReadAll }: { d: Deep; onReadAll?: () => void }) {
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });
  const [active, setActive] = useState<string>('problem');
  const root = useRef<HTMLDivElement>(null);
  const allOpen = d.deepDives.every((_, i) => open[i]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const secs = SECTIONS.map((s) => el.querySelector<HTMLElement>(`[data-sec="${s.id}"]`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (es) => {
        const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) {
          const id = (vis.target as HTMLElement).dataset.sec!;
          setActive(id);
          if (id === 'takeaways') onReadAll?.();
        }
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    secs.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [d, onReadAll]);

  const go = (id: string) => root.current?.querySelector(`[data-sec="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const sec = (id: string) => ({ 'data-sec': id, className: 'scroll-mt-14' });

  const totalLatency = useMemo(() => d.lifecycle.stages.reduce((a, s) => a + s.ms, 0), [d]);

  return (
    <div ref={root} className="relative">
      <nav className="sticky top-0 z-10 -mx-1 mb-3 flex gap-1 overflow-x-auto border-b border-line bg-paper/95 px-1 py-1.5 backdrop-blur">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => go(s.id)}
            className={cn('shrink-0 rounded-md px-2 py-0.5 font-mono text-[10.5px]', active === s.id ? 'bg-accent text-paper' : 'text-muted hover:bg-ink/[0.05]')}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="space-y-7">
        <section {...sec('problem')}>
          <H n="1" title="First principles" sub="Why it exists, what breaks without it, where it sits" />
          <div className="space-y-2.5">
            <P t={d.problem.why} />
            <div className="rounded-lg border border-bad/30 bg-bad/[0.04] p-2.5">
              <div className="mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-bad">without it</div>
              <ul className="space-y-1">
                {d.problem.withoutIt.map((w, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed">
                    <XCircle size={13} className="mt-0.5 shrink-0 text-bad" />
                    <span>
                      <Rich text={w} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <P t={d.problem.position} className="text-muted" />
            {d.problem.diagram && <Diagram d={d.problem.diagram} />}
          </div>
        </section>

        <section {...sec('architecture')}>
          <H n="2" title="Internal architecture" sub="The real building blocks, and how production systems build them" />
          <div className="space-y-2.5">
            <P t={d.architecture.overview} />
            <Diagram d={d.architecture.diagram} />
            <div className="grid gap-2 sm:grid-cols-2">
              {d.architecture.blocks.map((b) => (
                <div key={b.name} className="rounded-lg border border-line bg-surface p-2.5">
                  <div className="font-mono text-[12px] font-semibold">{b.name}</div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                    <Rich text={b.what} />
                  </p>
                </div>
              ))}
            </div>
            <div className="eyebrow pt-1">How real systems build it</div>
            <div className="space-y-2">
              {d.architecture.real.map((r) => (
                <div key={r.name} className="rounded-lg border-l-2 border-accent/60 bg-surface px-3 py-2">
                  <div className="font-mono text-[12px] font-semibold">{r.name}</div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink/85">
                    <Rich text={r.how} />
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section {...sec('lifecycle')}>
          <H n="3" title="Request lifecycle" sub={`Stage by stage, with where the ≈${fmtMs(totalLatency)} goes`} />
          <Waterfall d={d.lifecycle} />
        </section>

        <section {...sec('deep-dives')}>
          <div className="flex items-end justify-between">
            <H n="4" title="Algorithms & protocols" sub="Open each deep dive; the violet note is what seniors notice" />
            <button
              className="mb-2 shrink-0 font-mono text-[10.5px] text-accent hover:underline"
              onClick={() => setOpen(allOpen ? {} : Object.fromEntries(d.deepDives.map((_, i) => [i, true])))}
            >
              {allOpen ? 'collapse all' : 'expand all'}
            </button>
          </div>
          <div className="space-y-2">
            {d.deepDives.map((s, i) => (
              <DeepDive key={s.title} s={s} idx={i} open={!!open[i]} onToggle={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} />
            ))}
          </div>
        </section>

        <section {...sec('scaling')}>
          <H n="5" title="Scaling & high availability" sub="Control plane vs data plane, multi-region, config propagation" />
          <div className="space-y-2.5">
            {d.scaling.body.map((b, i) => (
              <P key={i} t={b} />
            ))}
            {d.scaling.diagram && <Diagram d={d.scaling.diagram} />}
            <ul className="space-y-1">
              {d.scaling.bullets.map((b, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
                  <span>
                    <Rich text={b} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section {...sec('failures')}>
          <H n="6" title="Failure modes & war stories" sub="How it breaks, how you detect it, how you fix it" />
          <div className="space-y-2">
            {d.failures.map((f) => (
              <div key={f.name} className="rounded-lg border border-line bg-surface p-2.5">
                <div className="flex items-center gap-1.5 font-mono text-[12px] font-semibold text-bad">
                  <AlertTriangle size={13} /> {f.name}
                </div>
                <div className="mt-1 grid gap-2 text-[12px] leading-relaxed sm:grid-cols-3">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-faint">symptom</div>
                    <Rich text={f.symptom} />
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-info">detect</div>
                    <Rich text={f.detect} />
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-ok">mitigate</div>
                    <Rich text={f.mitigate} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="eyebrow mb-1.5 mt-3">War stories</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {d.warStories.map((w) => (
              <div key={w.title} className="rounded-lg border border-warn/40 bg-warn/[0.05] p-2.5">
                <div className="flex items-start gap-1.5">
                  <Siren size={14} className="mt-0.5 shrink-0 text-warn" />
                  <div>
                    <div className="font-mono text-[12px] font-semibold">{w.title}</div>
                    <div className="font-mono text-[10px] text-faint">{w.source}</div>
                  </div>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-ink/85">
                  <Rich text={w.what} />
                </p>
                <p className="mt-1 text-[12px] leading-relaxed">
                  <span className="font-mono text-[10px] font-semibold uppercase text-ok">lesson </span>
                  <Rich text={w.lesson} />
                </p>
              </div>
            ))}
          </div>
        </section>

        <section {...sec('numbers')}>
          <H n="7" title="Numbers & capacity math" sub="Napkin numbers worth memorising, then a worked estimate" />
          <div className="grid gap-1.5 sm:grid-cols-2">
            {d.numbers.map((n) => (
              <div key={n.label} className="flex items-baseline gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
                <span className="min-w-0 flex-1 text-[12px] text-muted">
                  {n.label}
                  {n.note && (
                    <span className="block text-[10.5px] text-faint">
                      <Rich text={n.note} />
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[12px] font-semibold text-ink">{n.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5">
            <Capacity c={d.capacity} />
          </div>
        </section>

        <section {...sec('tradeoffs')}>
          <H n="8" title="Tradeoffs & alternatives" sub="Compare the real options, and know when NOT to use it" />
          <Table t={d.comparison} />
          <div className="mt-2.5 rounded-lg border border-line bg-surface p-2.5">
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-bad">
              <Ban size={12} /> when NOT to use it
            </div>
            <ul className="space-y-1">
              {d.whenNot.map((w, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-bad/70" />
                  <span>
                    <Rich text={w} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section {...sec('takeaways')}>
          <Takeaways items={d.takeaways} />
        </section>
      </div>
    </div>
  );
}

export function Takeaways({ items }: { items: string[] }) {
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/[0.06] p-3">
      <div className="eyebrow mb-1.5 text-accent">Key takeaways</div>
      <ol className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
            <span className="mt-px font-mono text-[11px] font-semibold text-accent">{String(i + 1).padStart(2, '0')}</span>
            <span>
              <Rich text={t} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
