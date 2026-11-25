import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, CheckCircle2, ChevronDown, Circle, GitPullRequest, KeyRound, Link2, MessageSquare, MousePointerClick, RotateCcw, Send, Tag as TagIcon, X } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, CodeBlock, Tag } from '@/shared/ui';
import { ChangeCard, type Change } from '../../ui/ChangeCard';
import { PredictCard } from '../../ui/Predict';
import { Rich } from '../../ui/Rich';
import { useDm } from '../../store';
import type { LabTopic } from '../../types';
import { SCHEMAS, type ReviewSchema } from './data';
import { KIND_GROUPS, KINDS, grade, type Flaw, type Grade, type KindId, type STable, type Tag as FlawTag, type Verdict } from './engine';

interface Sheet {
  tags: FlawTag[];
  submitted: boolean;
  predict?: number;
  attempts: number;
}

const EMPTY: Sheet = { tags: [], submitted: false, attempts: 0 };

const KIND_ORDER = KIND_GROUPS.map((g) => ({
  group: g,
  kinds: (Object.keys(KINDS) as KindId[]).filter((k) => KINDS[k].group === g),
}));

const prettyTarget = (t: string) => (t.includes('.') ? t : `${t} (table)`);

export default function ReviewLab({ topic }: { topic: LabTopic }) {
  const markExercise = useDm((s) => s.markExercise);
  const recordPrediction = useDm((s) => s.recordPrediction);
  const done = useDm((s) => s.topics[topic.id]?.exercises) ?? {};

  const [idx, setIdx] = useState(0);
  const [sheets, setSheets] = useState<Record<number, Sheet>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);

  const schema = SCHEMAS[idx];
  const sheet = sheets[schema.id] ?? EMPTY;
  const result = useMemo(() => (sheet.submitted ? grade(schema.flaws, sheet.tags, schema.fine) : null), [sheet, schema]);
  const revealed = !!result && sheet.predict !== undefined;

  const patch = (p: Partial<Sheet>) => setSheets((s) => ({ ...s, [schema.id]: { ...(s[schema.id] ?? EMPTY), ...p } }));

  const go = (i: number) => {
    setIdx(i);
    setSel(null);
    setHover(null);
  };

  const addTag = (kind: KindId) => {
    if (!sel || sheet.submitted) return;
    if (sheet.tags.some((t) => t.target === sel && t.kind === kind)) return;
    patch({ tags: [...sheet.tags, { target: sel, kind }] });
  };
  const removeTag = (i: number) => patch({ tags: sheet.tags.filter((_, j) => j !== i) });

  const submit = () => {
    const g = grade(schema.flaws, sheet.tags, schema.fine);
    patch({ submitted: true, attempts: sheet.attempts + 1 });
    setSel(null);
    if (g.solved) markExercise(topic.id, schema.exId);
    setChanges((cs) =>
      [
        {
          key: `${schema.id}-${Date.now()}`,
          title: `PR #${schema.pr.number} review: ${g.hits.length}/${schema.flaws.length} flaws found, ${g.fp} false positive${g.fp === 1 ? '' : 's'}`,
          lines: [
            ...g.misses.map((f) => ({ tone: 'warn' as const, text: `Missed: ${f.title}` })),
            g.fp ? { tone: 'bad' as const, text: `${g.fp} comment${g.fp > 1 ? 's' : ''} on code that was fine: noise the author must argue with.` } : { tone: 'ok' as const, text: 'No false positives: every comment was actionable.' },
            g.solved
              ? { tone: 'ok' as const, text: `**${schema.exId} solved** (≥ ${schema.flaws.length - 1} found, ≤ 1 false positive).` }
              : { tone: 'info' as const, text: `To solve: find ≥ ${schema.flaws.length - 1} with ≤ 1 false positive. Try again keeps nothing.` },
          ],
        },
        ...cs,
      ].slice(0, 4),
    );
  };
  const retry = () => {
    patch({ tags: [], submitted: false });
    setHover(null);
  };
  const answerPredict = (i: number, right: boolean) => {
    patch({ predict: i });
    recordPrediction(topic.id, `review-${schema.id}`, right);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ── left: PR + tagging ── */}
      <aside className="flex w-[370px] shrink-0 flex-col border-r border-line bg-paper">
        <div className="border-b border-line p-2">
          <div className="grid grid-cols-5 gap-1 rounded-lg bg-sunken p-1">
            {SCHEMAS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => go(i)}
                title={s.title}
                className={cn(
                  'flex items-center justify-center gap-1 rounded-md py-1.5 font-mono text-[11.5px] transition-colors',
                  i === idx ? 'bg-surface text-ink shadow-paper' : 'text-muted hover:text-ink',
                )}
              >
                {done[s.exId] ? <Check size={12} className="text-ok" /> : <span className="text-faint">#</span>}
                {s.id}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <PrCard schema={schema} />
          {!sheet.submitted ? (
            <Picker sel={sel} tags={sheet.tags} onAdd={addTag} onClear={() => setSel(null)} />
          ) : null}
          <TagList tags={sheet.tags} verdicts={revealed ? result!.verdicts : null} onRemove={sheet.submitted ? undefined : removeTag} onHover={setHover} />
          <div className="flex items-center gap-2">
            {!sheet.submitted ? (
              <Button variant="primary" icon={<Send size={14} />} disabled={!sheet.tags.length} onClick={submit}>
                Submit review ({sheet.tags.length})
              </Button>
            ) : (
              <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={retry}>
                Try again
              </Button>
            )}
            {sheet.attempts > 0 && <span className="font-mono text-[11px] text-faint">attempt {sheet.attempts}</span>}
          </div>
          {changes.length > 0 && (
            <div>
              <div className="eyebrow mb-1">What your review changed</div>
              <div className="space-y-1.5">
                <AnimatePresence initial={false} mode="popLayout">
                  {changes.slice(0, 2).map((c, i) => (
                    <motion.div key={c.key} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: i ? 0.6 : 1, y: 0 }} exit={{ opacity: 0 }}>
                      <ChangeCard change={c} compact={i > 0} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
        <Checklist topic={topic} done={done} />
      </aside>

      {/* ── centre: schema ── */}
      <main className="bg-grid relative min-w-0 flex-1 overflow-auto bg-sunken/60">
        <div className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[15px] font-semibold">{schema.title}</span>
            <Tag size="sm" tone="neutral">
              {schema.engine}
            </Tag>
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-muted">
              <MousePointerClick size={13} />
              {sheet.submitted ? 'review submitted' : 'click a column or a table name to select it'}
            </span>
          </div>
          <motion.div layout className="flex flex-wrap items-start gap-4">
            {schema.tables.map((t) => (
              <TableCard
                key={`${schema.id}-${t.name}`}
                t={t}
                sel={sel}
                onSelect={sheet.submitted ? undefined : (x) => setSel((cur) => (cur === x ? null : x))}
                tags={sheet.tags}
                result={revealed ? result : null}
                flaws={schema.flaws}
                hover={hover}
              />
            ))}
          </motion.div>
          {revealed && <RevealLegend />}
        </div>
      </main>

      {/* ── right: reveal ── */}
      <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-line bg-paper p-4">
        {!sheet.submitted ? (
          <ReviewTips />
        ) : (
          <div className="space-y-3">
            <PredictCard key={schema.id} predict={schema.predict} answered={sheet.predict} onAnswer={answerPredict} />
            {!revealed && <div className="font-mono text-[11px] text-accent">Answer to reveal your review results →</div>}
            {revealed && result && <Results schema={schema} g={result} onHover={setHover} />}
          </div>
        )}
      </aside>
    </div>
  );
}

/* ───────────────────────── left panel pieces ───────────────────────── */

function PrCard({ schema }: { schema: ReviewSchema }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
        <GitPullRequest size={13} className="text-ok" />
        <span>#{schema.pr.number}</span>
        <span>·</span>
        <span>@{schema.pr.author}</span>
        <span className="ml-auto text-faint">wants to merge</span>
      </div>
      <div className="mt-1 text-[13.5px] font-semibold leading-snug">{schema.pr.title}</div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
        <Rich text={schema.pr.body} />
      </p>
      <div className="eyebrow mt-2.5 mb-1">Requirements</div>
      <ul className="space-y-1">
        {schema.pr.requirements.map((r) => (
          <li key={r} className="flex gap-1.5 text-[12px] leading-snug">
            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-accent" />
            <span>
              <Rich text={r} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Picker({ sel, tags, onAdd, onClear }: { sel: string | null; tags: FlawTag[]; onAdd: (k: KindId) => void; onClear: () => void }) {
  return (
    <div className={cn('rounded-xl border p-3 transition-colors', sel ? 'border-accent/60 bg-accent/[0.04]' : 'border-line bg-surface')}>
      <div className="mb-2 flex items-center gap-1.5">
        <TagIcon size={13} className="text-accent" />
        {sel ? (
          <>
            <span className="text-[12.5px]">Tag</span>
            <code className="rounded bg-accent/10 px-1 font-mono text-[11.5px] text-accent">{prettyTarget(sel)}</code>
            <span className="text-[12.5px]">as…</span>
            <button onClick={onClear} className="ml-auto text-faint hover:text-ink" aria-label="Clear selection">
              <X size={13} />
            </button>
          </>
        ) : (
          <span className="text-[12.5px] text-muted">Select a column or table in the schema, then pick what is wrong with it.</span>
        )}
      </div>
      <div className={cn('space-y-2', !sel && 'pointer-events-none opacity-45')}>
        {KIND_ORDER.map(({ group, kinds }) => (
          <div key={group}>
            <div className="mb-0.5 font-mono text-[9.5px] uppercase tracking-wider text-faint">{group}</div>
            <div className="flex flex-wrap gap-1">
              {kinds.map((k) => {
                const on = !!sel && tags.some((t) => t.target === sel && t.kind === k);
                return (
                  <button
                    key={k}
                    onClick={() => onAdd(k)}
                    title={KINDS[k].hint}
                    className={cn(
                      'rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight transition-colors',
                      on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-paper text-ink hover:border-accent/60 hover:bg-accent/5',
                    )}
                  >
                    {KINDS[k].label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const VERDICT_STYLE: Record<Verdict['status'], { cls: string; label: string }> = {
  hit: { cls: 'border-ok/50 bg-ok/10 text-ok', label: 'hit' },
  dup: { cls: 'border-line bg-sunken text-muted', label: 'duplicate' },
  'wrong-kind': { cls: 'border-bad/50 bg-bad/10 text-bad', label: 'right spot, wrong diagnosis' },
  decoy: { cls: 'border-bad/50 bg-bad/10 text-bad', label: 'false positive' },
  fp: { cls: 'border-bad/50 bg-bad/10 text-bad', label: 'false positive' },
};

function TagList({
  tags,
  verdicts,
  onRemove,
  onHover,
}: {
  tags: FlawTag[];
  verdicts: Verdict[] | null;
  onRemove?: (i: number) => void;
  onHover: (anchor: string | null) => void;
}) {
  if (!tags.length) return <div className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-faint">No review comments yet.</div>;
  return (
    <div>
      <div className="eyebrow mb-1">Your review comments ({tags.length})</div>
      <div className="space-y-1">
        <AnimatePresence initial={false}>
          {tags.map((t, i) => {
            const v = verdicts?.[i];
            const st = v ? VERDICT_STYLE[v.status] : null;
            return (
              <motion.div
                key={`${t.target}-${t.kind}`}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ delay: v ? i * 0.08 : 0 }}
                onMouseEnter={() => onHover(t.target)}
                onMouseLeave={() => onHover(null)}
                className={cn('rounded-lg border px-2 py-1.5', st ? st.cls : 'border-line bg-surface')}
              >
                <div className="flex items-center gap-1.5">
                  <MessageSquare size={12} className="shrink-0" />
                  <code className="truncate font-mono text-[11px]">{t.target}</code>
                  {st && <span className="ml-auto shrink-0 font-mono text-[10px] font-semibold uppercase">{st.label}</span>}
                  {onRemove && (
                    <button onClick={() => onRemove(i)} className="ml-auto text-faint hover:text-bad" aria-label="Remove">
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className={cn('text-[11.5px]', st ? '' : 'text-muted')}>{KINDS[t.kind].label}</div>
                {v && (v.status === 'decoy' || v.status === 'fp') && v.note && (
                  <div className="mt-0.5 text-[11px] text-muted">
                    <Rich text={v.note} />
                  </div>
                )}
                {v && v.status === 'wrong-kind' && (
                  <div className="mt-0.5 text-[11px] text-muted">
                    Something is wrong here, but it is <b>{KINDS[v.flaw.kind].label}</b>.
                  </div>
                )}
                {v && v.status === 'dup' && <div className="mt-0.5 text-[11px] text-muted">Already counted: one comment per flaw.</div>}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Checklist({ topic, done }: { topic: LabTopic; done: Record<string, boolean | undefined> }) {
  const n = topic.exercises.filter((e) => done[e.id]).length;
  return (
    <div className="border-t border-line px-4 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="eyebrow">Exercises</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {n}/{topic.exercises.length}
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {topic.exercises.map((e) => (
          <li key={e.id} className={cn('flex items-center gap-1.5 text-[11.5px]', done[e.id] ? 'text-ink' : 'text-muted')}>
            {done[e.id] ? <CheckCircle2 size={13} className="shrink-0 text-ok" /> : <Circle size={13} className="shrink-0 text-faint" />}
            <span className="truncate">{e.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────── table card ───────────────────────── */

const FLAG_CLS: Record<string, string> = {
  PK: 'border-accent/40 bg-accent/10 text-accent',
  FK: 'border-info/40 bg-info/10 text-info',
  UQ: 'border-violet/40 bg-violet/10 text-violet',
};

type Mark = 'hit' | 'miss' | 'fp' | null;

function markFor(target: string, flaws: Flaw[], g: Grade | null): Mark {
  if (!g) return null;
  const f = flaws.find((x) => x.anchor === target);
  if (f) return g.hits.includes(f) ? 'hit' : 'miss';
  if (g.verdicts.some((v) => v.tag.target === target && v.status !== 'hit' && v.status !== 'dup')) return 'fp';
  return null;
}

const MARK_CLS: Record<Exclude<Mark, null>, string> = {
  hit: 'ring-2 ring-ok bg-ok/10',
  miss: 'outline-dashed outline-2 -outline-offset-2 outline-warn bg-warn/10',
  fp: 'ring-2 ring-bad bg-bad/10',
};
const MARK_LABEL: Record<Exclude<Mark, null>, { text: string; cls: string }> = {
  hit: { text: 'found', cls: 'bg-ok text-paper' },
  miss: { text: 'missed', cls: 'bg-warn text-paper' },
  fp: { text: 'fine', cls: 'bg-bad text-paper' },
};

function TableCard({
  t,
  sel,
  onSelect,
  tags,
  result,
  flaws,
  hover,
}: {
  t: STable;
  sel: string | null;
  onSelect?: (target: string) => void;
  tags: FlawTag[];
  result: Grade | null;
  flaws: Flaw[];
  hover: string | null;
}) {
  const [open, setOpen] = useState(false);
  const tableMark = markFor(t.name, flaws, result);
  const tagCount = (target: string) => tags.filter((x) => x.target === target).length;
  const hovered = (target: string) => !!hover && (hover === target || flaws.some((f) => f.anchor === target && f.id === hover));
  let order = 0;
  const delay = () => 0.15 + 0.12 * order++;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('relative w-[400px] rounded-xl border bg-surface shadow-paper', sel === t.name ? 'border-accent ring-2 ring-accent/30' : 'border-line')}
    >
      <Marker mark={tableMark} delay={0.1} className="-right-2 -top-2" />
      <button
        onClick={() => onSelect?.(t.name)}
        disabled={!onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-t-xl border-b border-line px-3 py-2 text-left transition-colors',
          onSelect && 'hover:bg-accent/5',
          tableMark && MARK_CLS[tableMark],
          hovered(t.name) && 'animate-pulse-soft',
        )}
      >
        <span className="font-mono text-[13px] font-semibold">{t.name}</span>
        {t.note && <span className="font-mono text-[10.5px] text-faint">{t.note}</span>}
        {tagCount(t.name) > 0 && (
          <span className="ml-auto flex items-center gap-0.5 rounded bg-accent/15 px-1 font-mono text-[10px] text-accent">
            <MessageSquare size={10} />
            {tagCount(t.name)}
          </span>
        )}
      </button>
      <div className="py-1">
        {t.cols.map((c) => {
          const target = `${t.name}.${c.name}`;
          const mark = markFor(target, flaws, result);
          const n = tagCount(target);
          const d = mark ? delay() : 0;
          return (
            <motion.button
              key={c.name}
              onClick={() => onSelect?.(target)}
              disabled={!onSelect}
              animate={mark ? { scale: [1, 1.03, 1] } : { scale: 1 }}
              transition={{ delay: d, duration: 0.35 }}
              className={cn(
                'relative flex w-full items-center gap-2 px-3 py-[5px] text-left font-mono text-[11.5px] transition-colors',
                onSelect && 'hover:bg-accent/5',
                sel === target && 'bg-accent/10',
                mark && MARK_CLS[mark],
                hovered(target) && 'animate-pulse-soft',
              )}
            >
              <span className="flex w-4 shrink-0 justify-center">
                {c.flags?.includes('PK') ? <KeyRound size={11} className="text-accent" /> : c.flags?.includes('FK') ? <Link2 size={11} className="text-info" /> : null}
              </span>
              <span className={cn('w-[128px] shrink-0 truncate', c.flags?.includes('PK') && 'font-semibold')} title={c.name}>
                {c.name}
              </span>
              <span className="w-[104px] shrink-0 truncate text-violet" title={c.type}>
                {c.type}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap gap-0.5">
                {(c.flags ?? [])
                  .filter((f) => f !== 'PK' || !c.flags?.includes('FK'))
                  .map((f) => (
                    <span key={f} className={cn('rounded border px-1 text-[9px] leading-[14px]', FLAG_CLS[f] ?? 'border-line text-faint')}>
                      {f}
                    </span>
                  ))}
              </span>
              {n > 0 && (
                <span className="flex shrink-0 items-center gap-0.5 rounded bg-accent/15 px-1 text-[10px] text-accent">
                  <MessageSquare size={10} />
                  {n}
                </span>
              )}
              <Marker mark={mark} delay={d} className="-right-1.5 top-1/2 -translate-y-1/2" />
            </motion.button>
          );
        })}
        {t.cols.some((c) => c.sample) && (
          <div className="mx-3 mt-1 space-y-0.5 border-t border-line/60 pt-1">
            {t.cols
              .filter((c) => c.sample)
              .map((c) => (
                <div key={c.name} className="flex gap-2 font-mono text-[10px] text-faint">
                  <span className="w-[128px] shrink-0 truncate pl-6">{c.name}</span>
                  <span className="truncate">{c.sample}</span>
                </div>
              ))}
          </div>
        )}
        {t.more && (
          <div className="px-3 py-1">
            <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 font-mono text-[11px] text-muted hover:text-ink">
              <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />+ {t.more.count} more columns
            </button>
            <AnimatePresence>
              {open && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="flex flex-wrap gap-1 pt-1">
                    {t.more.sample.map((s) => (
                      <span key={s} className="rounded bg-sunken px-1 font-mono text-[10px] text-muted">
                        {s}
                      </span>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
      {t.extra && (
        <div className="space-y-0.5 rounded-b-xl border-t border-line bg-sunken/50 px-3 py-1.5">
          {t.extra.map((e) => (
            <div key={e} className="font-mono text-[10px] text-muted">
              {e}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function Marker({ mark, delay, className }: { mark: Mark; delay: number; className?: string }) {
  return (
    <AnimatePresence>
      {mark && (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ delay, type: 'spring', stiffness: 400, damping: 18 }}
          className={cn('pointer-events-none absolute z-10 rounded-full px-1.5 font-mono text-[9.5px] font-semibold leading-[16px] shadow-paper', MARK_LABEL[mark].cls, className)}
        >
          {MARK_LABEL[mark].text}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function RevealLegend() {
  return (
    <div className="flex flex-wrap gap-4 font-mono text-[10.5px] text-muted">
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded-sm bg-ok/20 ring-2 ring-ok" /> flaw you found
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded-sm bg-warn/20 outline-dashed outline-2 -outline-offset-2 outline-warn" /> flaw you missed
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded-sm bg-bad/20 ring-2 ring-bad" /> you flagged it, but it is fine
      </span>
      <span>hover a finding to locate it</span>
    </div>
  );
}

/* ───────────────────────── right panel ───────────────────────── */

function ReviewTips() {
  return (
    <div className="space-y-3">
      <div className="eyebrow">How a senior reviews a schema PR</div>
      <ol className="space-y-2 text-[12.5px] leading-relaxed text-muted">
        {[
          'Read the **requirements** first. Most flaws are a mismatch between a rule ("every user has a team") and a constraint (`NULL` allowed).',
          'Walk each column: **type** (money, time, lists), **nullability**, **key** (can it change?), **index** (is it filtered or an FK?).',
          'Then each table: does it have one **grain** and one concern? Can it be synced, deleted, restored?',
          'Comment only on what will bite. **False positives cost trust**: the author has to argue with every one.',
        ].map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="font-mono text-[11px] text-accent">{i + 1}.</span>
            <span>
              <Rich text={t} />
            </span>
          </li>
        ))}
      </ol>
      <Callout tone="tip" title="Scoring">
        <span className="text-[12px]">
          Each schema has 3–4 planted flaws. Solved when you find all but at most one, with at most one false positive. Some picker entries are decoys: patterns that look suspicious
          but are fine.
        </span>
      </Callout>
      <Callout tone="info" title="Under the hood: why reviews catch these early">
        <span className="text-[12px]">
          Every fix here is cheap on an empty table and expensive later: changing a column type rewrites the table under an <code>ACCESS EXCLUSIVE</code> lock, a new unique index on
          dirty data fails, and moving a PK means repointing every FK. A 10-minute review comment saves a multi-week online migration.
        </span>
      </Callout>
    </div>
  );
}

function Results({ schema, g, onHover }: { schema: ReviewSchema; g: Grade; onHover: (id: string | null) => void }) {
  const fps = g.verdicts.filter((v) => v.status === 'decoy' || v.status === 'fp' || v.status === 'wrong-kind');
  return (
    <div className="space-y-3">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn('rounded-xl border p-3', g.solved ? 'border-ok/50 bg-ok/10' : 'border-warn/50 bg-warn/10')}
      >
        <div className="flex items-baseline gap-2">
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-mono text-[28px] font-semibold tabular-nums">
            {g.score}
          </motion.span>
          <span className="font-mono text-[11px] text-muted">/ 100</span>
          <span className={cn('ml-auto font-mono text-[11.5px] font-semibold', g.solved ? 'text-ok' : 'text-warn')}>{g.solved ? `${schema.exId} solved` : 'not yet'}</span>
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[11px]">
          <span className="text-ok">{g.hits.length} found</span>
          <span className="text-warn">{g.misses.length} missed</span>
          <span className="text-bad">{g.fp} false +</span>
        </div>
        <div className="mt-1 text-[11px] text-muted">score = 100 × found / {schema.flaws.length} − 15 per false positive</div>
      </motion.div>

      <div className="eyebrow">Planted flaws</div>
      {schema.flaws.map((f, i) => (
        <FlawCard key={f.id} f={f} hit={g.hits.includes(f)} i={i} onHover={onHover} />
      ))}

      {fps.length > 0 && (
        <>
          <div className="eyebrow">False positives</div>
          {fps.map((v, i) => (
            <motion.div
              key={`${v.tag.target}-${v.tag.kind}`}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              className="rounded-lg border border-bad/40 bg-bad/5 p-2 text-[12px]"
            >
              <div className="font-mono text-[11px] text-bad">
                {v.tag.target} · {KINDS[v.tag.kind].label}
              </div>
              <div className="mt-0.5 text-muted">
                {v.status === 'wrong-kind' ? (
                  <>
                    Right spot, wrong diagnosis: it is <b>{KINDS[v.flaw.kind].label}</b>.
                  </>
                ) : (
                  <Rich text={(v.status === 'decoy' || v.status === 'fp' ? v.note : undefined) ?? 'Nothing wrong here for these requirements.'} />
                )}
              </div>
            </motion.div>
          ))}
        </>
      )}

      <div className="eyebrow">The review comment you would leave</div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="rounded-xl border border-line bg-surface">
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 font-mono text-[11px] text-muted">
          <MessageSquare size={12} /> reviewer commented on #{schema.pr.number}
          <Tag size="sm" tone="bad" className="ml-auto">
            changes requested
          </Tag>
        </div>
        <div className="space-y-1.5 px-3 py-2 text-[12px] leading-relaxed">
          {schema.comment.map((l, i) => (
            <p key={i}>
              <Rich text={l} />
            </p>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function FlawCard({ f, hit, i, onHover }: { f: Flaw; hit: boolean; i: number; onHover: (id: string | null) => void }) {
  const [open, setOpen] = useState(!hit);
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.15 + i * 0.12 }}
      onMouseEnter={() => onHover(f.id)}
      onMouseLeave={() => onHover(null)}
      className={cn('rounded-xl border bg-surface', hit ? 'border-ok/50' : 'border-warn/60')}
    >
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2 p-2.5 text-left">
        <span className={cn('mt-0.5 shrink-0 rounded-full px-1.5 font-mono text-[9.5px] font-semibold leading-[16px] text-paper', hit ? 'bg-ok' : 'bg-warn')}>{hit ? 'found' : 'missed'}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold leading-snug">
            <Rich text={f.title} />
          </span>
          <span className="font-mono text-[10.5px] text-faint">{KINDS[f.kind].label}</span>
        </span>
        <ChevronDown size={14} className={cn('mt-0.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-2 px-2.5 pb-2.5 text-[12px] leading-relaxed">
              <p className="text-muted">
                <Rich text={f.impact} />
              </p>
              <div className="rounded-lg border border-bad/30 bg-bad/5 px-2 py-1.5">
                <div className="mb-0.5 font-mono text-[9.5px] uppercase tracking-wider text-bad">Impact in numbers</div>
                <Rich text={f.numbers} />
              </div>
              <div>
                <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-ok">Fix</div>
                <CodeBlock language="sql" code={f.fix} showLineNumbers={false} className="text-[11px]" />
              </div>
              <div className="rounded-lg bg-sunken/70 px-2 py-1.5 text-[11.5px] text-muted">
                <span className="font-mono text-[9.5px] uppercase tracking-wider text-info">Under the hood · </span>
                <Rich text={f.hood} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

