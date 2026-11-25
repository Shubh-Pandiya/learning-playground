import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, GripVertical, History, Lightbulb, Loader2, Lock, Play, RotateCcw, TriangleAlert, XCircle, Zap } from 'lucide-react';
import { Button, Callout, CodeBlock, Tag } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { BuildSpec, Concept, SlotId } from '../types';
import { MAIN, SLOTS, SLOT_EVAL_ORDER, SLOT_LABEL, assembleSql, correctPlacement, scopeOf, slotKey, type Placement } from '../engine/builder';
import { compareResults, describeChange, diffRows } from '../engine/compare';
import { diffPlans, fmt, type PlanSummary } from '../engine/plan';
import { hasAggregate } from '../engine/parse';
import { runQuery, type QueryResult } from '../engine/db';
import { useSql, type BuildMode } from '../store';
import { Md, ResultTable, SqlErrorBox, shuffle, type RowMark } from './common';
import { errMsg, explainSummary } from './hooks';

interface Block {
  id: string;
  sql: string;
  why: string;
  scope: string;
  slot: SlotId;
  trap: boolean;
  locked?: boolean;
  /** Wrong-slot "what-if" moves for this block (slotKey → why it breaks), from traps that reuse its exact text. */
  alt?: Record<string, string>;
}
type Containers = Record<string, string[]>;
const TRAY = 'tray';

const MODES: { id: BuildMode; label: string; blurb: string }[] = [
  { id: 'worked', label: '1 · Worked example', blurb: 'The full query is assembled with the reason for every block. Drag a trap in (or a block out) to see what breaks.' },
  { id: 'faded', label: '2 · Fill the gaps', blurb: 'Part of the query is locked in place — drag the missing blocks into the right clause.' },
  { id: 'scratch', label: '3 · Build from scratch', blurb: 'Assemble the whole query. Some blocks are traps that look right but change the answer.' },
];

function setup(spec: BuildSpec, mode: BuildMode, seed: number) {
  const blocks: Record<string, Block> = {};
  spec.blocks.forEach((b, i) => (blocks[`b${i}`] = { id: `b${i}`, sql: b.sql, why: b.why, scope: scopeOf(b), slot: b.slot, trap: false }));
  // A trap with the same text as a correct block would be an indistinguishable twin chip; fold it into that
  // block as a "wrong slot" explanation instead.
  const moves: { sql: string; key: string; why: string }[] = [];
  const traps: string[] = [];
  spec.traps.forEach((t, i) => {
    const same = (b: Block) => !b.trap && b.sql.trim() === t.sql.trim();
    const twin = Object.values(blocks).find((b) => same(b) && b.scope === scopeOf(t)) ?? Object.values(blocks).find(same);
    if (twin) {
      const key = slotKey(scopeOf(t), t.slot);
      twin.alt = { ...twin.alt, [key]: t.why };
      moves.push({ sql: t.sql, key, why: t.why });
      return;
    }
    blocks[`t${i}`] = { id: `t${i}`, sql: t.sql, why: t.why, scope: scopeOf(t), slot: t.slot, trap: true };
    traps.push(`t${i}`);
  });
  const correct = spec.blocks.map((_, i) => `b${i}`);
  const c: Containers = { [TRAY]: [] };
  const place = (id: string) => (c[slotKey(blocks[id].scope, blocks[id].slot)] ??= []).push(id);
  if (mode === 'worked') {
    correct.forEach(place);
    c[TRAY] = shuffle(traps, seed);
  } else if (mode === 'faded') {
    const weight = (id: string) => (['where', 'having', 'groupBy', 'join'].includes(blocks[id].slot) || hasAggregate(blocks[id].sql) ? 2 : 0) + ((seed + +id.slice(1) * 7) % 3);
    const n = Math.max(2, Math.ceil(correct.length * 0.45));
    const faded = new Set([...correct].sort((a, b) => weight(b) - weight(a)).slice(0, n));
    correct.forEach((id) => {
      if (!faded.has(id)) {
        blocks[id] = { ...blocks[id], locked: true };
        place(id);
      }
    });
    c[TRAY] = shuffle([...faded, ...shuffle(traps, seed).slice(0, Math.max(2, Math.ceil(traps.length / 2)))], seed);
  } else c[TRAY] = shuffle([...correct, ...traps], seed);
  return { blocks, containers: c, moves };
}

function misplaced(b: Block, key: string): { tone: 'bad' | 'warn'; text: string } | null {
  if (b.trap || key === TRAY) return null;
  const [scope, slot] = key.split(':') as [string, SlotId];
  if (b.scope === scope && b.slot === slot) return null;
  if (b.alt?.[key]) return { tone: 'bad', text: b.alt[key] };
  const where = scope === MAIN ? 'the main query' : `CTE \`${scope}\``;
  if (b.scope !== scope) return { tone: 'bad', text: `\`${b.sql}\` doesn't belong in ${where} — think about which step needs it.` };
  if (slot === 'where' && hasAggregate(b.sql)) return { tone: 'bad', text: 'Aggregates can’t appear in WHERE: WHERE filters single rows **before** GROUP BY forms groups. Conditions on aggregates go in HAVING.' };
  if (slot === 'groupBy' && hasAggregate(b.sql)) return { tone: 'bad', text: 'GROUP BY lists the grouping keys (plain columns/expressions); aggregates are computed **per group** in SELECT/HAVING.' };
  if (b.slot === 'join') return { tone: 'bad', text: 'That’s a complete `JOIN … ON …` clause — it goes in the JOIN slot right after FROM.' };
  if (slot === 'join') return { tone: 'bad', text: 'Only full `JOIN … ON …` clauses go in the JOIN slot.' };
  if (b.slot === 'where' && slot === 'having')
    return { tone: 'warn', text: 'A plain row filter in HAVING works but runs **after** grouping — every row gets grouped first, then thrown away. Put row-level filters in WHERE so less data is aggregated.' };
  if (b.slot === 'select' && (slot === 'groupBy' || slot === 'orderBy')) return { tone: 'bad', text: `\`${b.sql}\` is an output column (it has an alias / computes a value) — it belongs in SELECT.` };
  return { tone: 'bad', text: `\`${b.sql}\` doesn't fit in ${SLOT_LABEL[slot]} — what does ${SLOT_LABEL[slot]} do at its step of the logical order?` };
}

/* ---------------------------------------------------------------- dnd bits */

function BlockChip({ b, status, showWhy }: { b: Block; status?: 'ok' | 'bad' | 'warn' | 'trap'; showWhy?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: b.id, disabled: b.locked });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cn(
        'group flex items-start gap-1.5 rounded-md border bg-surface px-2 py-1.5 font-mono text-[12px] leading-snug shadow-sm',
        b.locked ? 'cursor-default border-line bg-sunken/70 text-muted' : 'cursor-grab border-line hover:border-accent/50 active:cursor-grabbing',
        status === 'ok' && 'border-ok/60 bg-ok/[0.06]',
        (status === 'bad' || status === 'trap') && 'border-bad/70 bg-bad/[0.06]',
        status === 'warn' && 'border-warn/70 bg-warn/[0.06]',
        isDragging && 'z-10 opacity-60 shadow-lift',
      )}
    >
      {b.locked ? <Lock className="mt-0.5 h-3 w-3 shrink-0 text-faint" /> : <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint group-hover:text-muted" />}
      <div className="min-w-0">
        <div className="whitespace-pre-wrap break-words text-ink">{b.sql}</div>
        {showWhy && <div className="mt-0.5 font-sans text-[11px] leading-snug text-muted">{b.why}</div>}
      </div>
    </div>
  );
}

function Drop({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn(className, isOver && 'border-accent bg-accent/[0.06]')}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- builder */

interface LogEntry {
  id: number;
  action: string;
  result: string;
  plan?: string[];
  tone: 'ok' | 'bad' | 'warn' | 'info';
}

export function QueryBuilder({ concept }: { concept: Concept }) {
  const spec = concept.build!;
  const prog = useSql((s) => s.concepts[concept.id]);
  const recordBuild = useSql((s) => s.recordBuild);
  const recordHint = useSql((s) => s.recordHint);
  const suggested: BuildMode = prog?.built?.faded ? 'scratch' : prog?.built?.worked ? 'faded' : 'worked';
  const [mode, setMode] = useState<BuildMode>(suggested);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const initial = useMemo(() => setup(spec, mode, seed), [spec, mode, seed]);
  const blocks = initial.blocks;
  const [c, setC] = useState<Containers>(initial.containers);
  const [feedback, setFeedback] = useState<{ tone: 'bad' | 'warn' | 'ok'; title: string; text: string } | null>(null);
  const [checked, setChecked] = useState<null | { ok: boolean; reason?: string }>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const lastAction = useRef<string>('Initial query');
  const dragFrom = useRef<string | null>(null);
  const prev = useRef<{ result: QueryResult; plan?: PlanSummary } | null>(null);

  const restart = (m: BuildMode = mode) => {
    const s = Math.floor(Math.random() * 1e6);
    const fresh = setup(spec, m, s);
    setMode(m);
    setSeed(s);
    setC(fresh.containers);
    setFeedback(null);
    setChecked(null);
    setHint(null);
    setLog([]);
    prev.current = null;
    lastAction.current = m === 'worked' ? 'Worked example' : 'Starting point';
  };

  const scopes = [...(spec.ctes ?? []), MAIN];
  const slotsFor = (scope: string) => {
    const used = new Set<SlotId>(['select', 'from']);
    [...spec.blocks, ...spec.traps].forEach((b) => scopeOf(b) === scope && used.add(b.slot));
    return SLOTS.filter((s) => used.has(s));
  };

  /* ---- live run of the assembled query */
  const placement: Placement = useMemo(() => {
    const p: Placement = {};
    for (const [k, ids] of Object.entries(c)) if (k !== TRAY && ids.length) p[k] = ids.map((id) => blocks[id].sql);
    return p;
  }, [c, blocks]);
  // While a block is being dragged it hops between containers (onDragOver); only run the query once it's dropped,
  // so every result change is attributed to a completed move.
  const [dragging, setDragging] = useState(false);
  const liveSql = useMemo(() => assembleSql(spec, placement), [spec, placement]);
  const settledSql = useRef(liveSql);
  if (!dragging) settledSql.current = liveSql;
  const sql = settledSql.current;
  const targetSql = useMemo(() => assembleSql(spec, correctPlacement(spec))!, [spec]);
  const ordered = spec.blocks.some((b) => b.slot === 'orderBy' && scopeOf(b) === MAIN);

  const [target, setTarget] = useState<QueryResult | null>(null);
  useEffect(() => {
    runQuery(targetSql).then(setTarget, () => setTarget(null));
  }, [targetSql]);

  const [run, setRun] = useState<{ status: 'idle' | 'loading' | 'ok' | 'error'; result?: QueryResult; plan?: PlanSummary; error?: string; added?: Set<number>; removed?: QueryResult['rows'] }>({ status: 'idle' });
  useEffect(() => {
    if (!sql) {
      setRun({ status: 'idle' });
      return;
    }
    let alive = true;
    setRun((r) => ({ ...r, status: 'loading' }));
    const t = setTimeout(async () => {
      try {
        const result = await runQuery(sql, { maxRows: 300 });
        const plan = await explainSummary(sql, false).catch(() => undefined);
        if (!alive) return;
        const before = prev.current;
        let added: Set<number> | undefined;
        let removed: QueryResult['rows'] | undefined;
        if (before) {
          const ch = describeChange(before.result, result);
          if (ch.comparable) {
            const d = diffRows(before.result.rows, result.rows);
            const keys = new Set(d.added.map((r) => JSON.stringify(r)));
            added = new Set(result.rows.map((r, i) => (keys.has(JSON.stringify(r)) ? i : -1)).filter((i) => i >= 0));
            removed = d.removed;
          }
          const pd = before.plan && plan ? diffPlans(before.plan, plan).lines.filter((l) => !/^Estimated cost/.test(l) || Math.abs(plan.totalCost - before.plan!.totalCost) > 0.5) : undefined;
          const tone = /trap/.test(lastAction.current) ? 'bad' : ch.rowsAfter === ch.rowsBefore && ch.comparable && !ch.added.length ? 'info' : 'warn';
          setLog((l) => [{ id: Date.now(), action: lastAction.current, result: ch.summary, plan: pd, tone } as LogEntry, ...l].slice(0, 8));
        }
        prev.current = { result, plan };
        setRun({ status: 'ok', result, plan, added, removed });
      } catch (e) {
        if (!alive) return;
        setLog((l) => [{ id: Date.now(), action: lastAction.current, result: `error: ${errMsg(e)}`, tone: 'bad' } as LogEntry, ...l].slice(0, 8));
        setRun({ status: 'error', error: errMsg(e) });
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [sql]);

  /* ---- dnd */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const find = (id: string): string | null => {
    if (id in c) return id;
    return Object.keys(c).find((k) => c[k].includes(id)) ?? null;
  };
  const describeDrop = (id: string, from: string, to: string) => {
    const b = blocks[id];
    const label = (k: string) => (k === TRAY ? 'the tray' : `${k.startsWith(MAIN) ? '' : `${k.split(':')[0]} · `}${SLOT_LABEL[k.split(':')[1] as SlotId]}`);
    if (to === TRAY) return `Removed \`${b.sql}\` from ${label(from)}`;
    return `${b.trap ? 'Placed trap' : 'Placed'} \`${b.sql}\` in ${label(to)}`;
  };
  const afterDrop = (id: string, from: string, to: string) => {
    setChecked(null);
    setHint(null);
    if (from === to) {
      lastAction.current = `Reordered ${SLOT_LABEL[to.split(':')[1] as SlotId] ?? ''}`;
      return;
    }
    lastAction.current = describeDrop(id, from, to);
    const b = blocks[id];
    if (to === TRAY) return setFeedback(null);
    if (b.trap) return setFeedback({ tone: 'bad', title: 'Trap — here’s what this would break', text: b.why });
    const m = misplaced(b, to);
    if (m) return setFeedback({ tone: m.tone, title: m.tone === 'bad' ? 'Not in this clause' : 'Works, but costs more', text: m.text });
    setFeedback(mode === 'scratch' ? null : { tone: 'ok', title: 'Fits here', text: b.why });
  };
  const onDragStart = ({ active }: DragStartEvent) => {
    dragFrom.current = find(String(active.id));
    setDragging(true);
  };
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = find(String(active.id));
    const to = find(String(over.id));
    if (!from || !to || from === to) return;
    setC((p) => {
      const dst = [...(p[to] ?? [])];
      const at = dst.indexOf(String(over.id));
      dst.splice(at >= 0 ? at : dst.length, 0, String(active.id));
      return { ...p, [from]: p[from].filter((x) => x !== active.id), [to]: dst };
    });
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const origin = dragFrom.current;
    dragFrom.current = null;
    setDragging(false);
    if (!over) {
      const cur = find(id);
      if (origin && cur) afterDrop(id, origin, cur);
      return;
    }
    const cur = find(id);
    const to = find(String(over.id));
    if (cur && to && cur === to) {
      const list = c[cur];
      const a = list.indexOf(id);
      const b = list.indexOf(String(over.id));
      if (a >= 0 && b >= 0 && a !== b) setC((p) => ({ ...p, [cur]: arrayMove(p[cur], a, b) }));
    }
    if (origin && cur) afterDrop(id, origin, cur);
  };

  /* ---- check / hint */
  const placedTraps = Object.entries(c).filter(([k]) => k !== TRAY).flatMap(([, ids]) => ids.filter((id) => blocks[id].trap));
  const wrongSlots = Object.entries(c).filter(([k]) => k !== TRAY).flatMap(([k, ids]) => ids.filter((id) => !blocks[id].trap && misplaced(blocks[id], k)?.tone === 'bad'));
  const missing = Object.values(blocks).filter((b) => !b.trap && c[TRAY].includes(b.id));
  const check = () => {
    if (!sql) return setChecked({ ok: false, reason: 'Every query (and CTE) needs at least a SELECT and a FROM block.' });
    if (run.status === 'error') return setChecked({ ok: false, reason: `The query errors: ${run.error}` });
    if (!run.result || !target) return;
    const v = compareResults(run.result, target, ordered);
    if (v.ok && placedTraps.length === 0) {
      setChecked({ ok: true });
      recordBuild(concept.id, mode);
    } else setChecked({ ok: false, reason: placedTraps.length ? `The result may look plausible, but ${placedTraps.length} trap block${placedTraps.length > 1 ? 's are' : ' is'} still in the query (red).` : v.reason });
  };
  const giveHint = () => {
    recordHint(concept.id);
    if (placedTraps.length) return setHint(`\`${blocks[placedTraps[0]].sql}\` is a trap — drag it back to the tray.`);
    if (wrongSlots.length) return setHint(`\`${blocks[wrongSlots[0]].sql}\` is in the wrong clause.`);
    const next = [...missing].sort((a, b) => SLOT_EVAL_ORDER.indexOf(a.slot) - SLOT_EVAL_ORDER.indexOf(b.slot))[0];
    if (next) return setHint(`Next, in logical order: \`${next.sql}\` belongs in ${next.scope === MAIN ? '' : `${next.scope} · `}${SLOT_LABEL[next.slot]}. ${next.why}`);
    setHint('All the right blocks are placed — check the order of SELECT columns and JOINs.');
  };

  const marks = (id: string, key: string): 'ok' | 'bad' | 'warn' | 'trap' | undefined => {
    const b = blocks[id];
    if (b.trap) return 'trap';
    if (b.locked) return undefined;
    const m = misplaced(b, key);
    if (m) return mode === 'scratch' && !checked ? undefined : m.tone;
    return checked ? 'ok' : undefined;
  };

  const resultMarks: RowMark[] | undefined = run.result && run.added ? run.result.rows.map((_, i) => (run.added!.has(i) ? 'added' : undefined)) : undefined;
  const verdict = run.result && target ? compareResults(run.result, target, ordered) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {MODES.map((m) => (
          <Button key={m.id} size="sm" variant={mode === m.id ? 'primary' : 'secondary'} onClick={() => restart(m.id)}>
            {m.label}
            {prog?.built?.[m.id] && <CheckCircle2 className="ml-1 h-3.5 w-3.5 text-ok" />}
          </Button>
        ))}
        <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => restart()}>
          Reshuffle
        </Button>
      </div>
      <p className="text-sm text-muted">{MODES.find((m) => m.id === mode)!.blurb}</p>
      <Callout tone="info" title="Task">
        <Md text={spec.prompt} />
      </Callout>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setDragging(false)}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* skeleton */}
          <div className="space-y-3">
            {spec.given && (
              <div>
                <div className="eyebrow mb-1 flex items-center gap-1">
                  <Lock className="h-3 w-3" /> given
                </div>
                <CodeBlock code={`WITH ${spec.recursive ? 'RECURSIVE ' : ''}${spec.given.trim()}`} language="sql" showLineNumbers={false} className="text-[11.5px]" />
              </div>
            )}
            {scopes.map((scope) => (
              <div key={scope} className={cn('rounded-xl border border-line bg-surface p-3 shadow-paper', scope !== MAIN && 'border-violet/40')}>
                <div className="mb-2 font-mono text-[12px] font-semibold text-ink">{scope === MAIN ? (scopes.length > 1 || spec.given ? 'Main query' : 'Query') : `${scope} AS ( … )`}</div>
                <div className="space-y-1.5">
                  {slotsFor(scope).map((slot) => {
                    const key = slotKey(scope, slot);
                    const ids = c[key] ?? [];
                    return (
                      <div key={key} className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-2">
                        <div className="flex items-center gap-1 pt-1.5">
                          <span className="font-mono text-[12px] font-semibold text-accent">{SLOT_LABEL[slot]}</span>
                          <span className="rounded-full bg-sunken px-1 font-mono text-[9px] text-faint" title="Logical evaluation step">
                            {SLOT_EVAL_ORDER.indexOf(slot) + 1}
                          </span>
                        </div>
                        <SortableContext id={key} items={ids} strategy={verticalListSortingStrategy}>
                          <Drop id={key} className="min-h-[36px] space-y-1 rounded-md border border-dashed border-line p-1 transition-colors">
                            {ids.map((id) => (
                              <BlockChip key={id} b={blocks[id]} status={marks(id, key)} showWhy={mode === 'worked' && !blocks[id].trap} />
                            ))}
                            {ids.length === 0 && <div className="px-2 py-1 text-[11px] italic text-faint">drop here</div>}
                          </Drop>
                        </SortableContext>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="text-[11px] text-faint">Small numbers = logical evaluation order (FROM runs first, SELECT near the end) — the reason an alias from SELECT isn’t visible in WHERE.</p>
          </div>

          {/* tray + feedback */}
          <div className="space-y-3 lg:sticky lg:top-[calc(var(--header-h)+3.5rem)] lg:self-start">
            <div className="rounded-xl border border-line bg-sunken/60 p-3">
              <div className="eyebrow mb-2">{mode === 'worked' ? 'What-if blocks (traps)' : 'Blocks'}</div>
              <SortableContext id={TRAY} items={c[TRAY]} strategy={verticalListSortingStrategy}>
                <Drop id={TRAY} className="min-h-[60px] space-y-1 rounded-md border border-dashed border-transparent p-0.5">
                  {c[TRAY].map((id) => (
                    <BlockChip key={id} b={blocks[id]} />
                  ))}
                  {c[TRAY].length === 0 && <div className="py-3 text-center text-[11px] italic text-faint">tray empty</div>}
                </Drop>
              </SortableContext>
              {mode === 'worked' && initial.moves.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-line pt-2 text-[11px] text-muted">
                  <div className="eyebrow">What-if moves</div>
                  {initial.moves.map((m) => (
                    <div key={m.sql + m.key}>
                      Drag <code className="font-mono text-ink">{m.sql}</code> into {m.key.startsWith(`${MAIN}:`) ? '' : `${m.key.split(':')[0]} · `}
                      {SLOT_LABEL[m.key.split(':')[1] as SlotId]}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <AnimatePresence mode="wait">
              {feedback && (
                <motion.div key={feedback.text} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Callout tone={feedback.tone} title={feedback.title}>
                    <Md text={feedback.text} />
                  </Callout>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={check}>
                Check
              </Button>
              <Button size="sm" variant="secondary" icon={<Lightbulb className="h-3.5 w-3.5" />} onClick={giveHint}>
                Hint
              </Button>
              {mode === 'worked' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    recordBuild(concept.id, 'worked');
                    restart('faded');
                  }}
                >
                  Got it → fill the gaps
                </Button>
              )}
            </div>
            {hint && (
              <Callout tone="tip">
                <Md text={hint} />
              </Callout>
            )}
            {checked &&
              (checked.ok ? (
                <Callout tone="ok" title={mode === 'scratch' ? 'Built from scratch ✓' : 'Correct ✓'}>
                  {mode === 'scratch' ? 'This concept now enters spaced review. Next: the Practice tab — write it yourself without blocks.' : mode === 'faded' ? 'Now try building it from scratch.' : 'Now try filling the gaps.'}
                  {mode !== 'scratch' && (
                    <Button size="xs" className="ml-2" variant="secondary" onClick={() => restart(mode === 'worked' ? 'faded' : 'scratch')}>
                      next level
                    </Button>
                  )}
                </Callout>
              ) : (
                <Callout tone="bad" title="Not yet">
                  <Md text={checked.reason ?? 'The result differs from the expected one.'} />
                </Callout>
              ))}
          </div>
        </div>
      </DndContext>

      {/* live result + change log */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="eyebrow">Live result of your query</div>
            <div className="flex items-center gap-1.5">
              {run.status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
              {run.plan && <Tag tone="neutral">est. cost {fmt(run.plan.totalCost)}</Tag>}
              {verdict && <Tag tone={verdict.ok && !placedTraps.length ? 'ok' : 'warn'}>{verdict.ok ? (placedTraps.length ? 'same result, but traps placed' : 'matches the target') : `${verdict.missing} missing · ${verdict.extra} extra vs target`}</Tag>}
            </div>
          </div>
          {!sql ? (
            <div className="rounded-md border border-dashed border-line p-6 text-center text-xs text-faint">Place at least a SELECT and a FROM block{scopes.length > 1 ? ' in every scope' : ''} to run the query.</div>
          ) : run.status === 'error' ? (
            <SqlErrorBox message={run.error!} />
          ) : run.result ? (
            <>
              <ResultTable columns={run.result.columns} rows={run.result.rows} marks={resultMarks} maxHeight={300} dense={run.result.rows.length > 12} />
              {!!run.removed?.length && (
                <details className="text-xs text-muted" open={run.removed.length <= 5}>
                  <summary className="cursor-pointer">{run.removed.length} row{run.removed.length > 1 ? 's' : ''} disappeared with your last change</summary>
                  <ResultTable columns={run.result.columns} rows={run.removed} marks={run.removed.map(() => 'removed')} maxHeight={160} dense />
                </details>
              )}
            </>
          ) : null}
          {sql && (
            <details className="text-xs text-faint">
              <summary className="cursor-pointer hover:text-ink">assembled SQL</summary>
              <CodeBlock code={sql} language="sql" className="mt-1 text-[11.5px]" />
            </details>
          )}
        </div>
        <div>
          <div className="eyebrow mb-2 flex items-center gap-1">
            <History className="h-3 w-3" /> Every change → its impact
          </div>
          <div className="space-y-1.5">
            {log.length === 0 && <p className="text-xs text-faint">Each drop re-runs the query. You’ll see what changed in the result and the plan here.</p>}
            <AnimatePresence initial={false}>
              {log.map((e) => (
                <motion.div key={e.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className={cn('rounded-md border px-2.5 py-1.5 text-[12px]', e.tone === 'bad' ? 'border-bad/40 bg-bad/[0.04]' : e.tone === 'warn' ? 'border-warn/40 bg-warn/[0.04]' : 'border-line bg-surface')}>
                  <div className="flex items-start gap-1.5 text-ink">
                    {e.tone === 'bad' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" /> : e.tone === 'warn' ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> : <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />}
                    <Md text={e.action} />
                  </div>
                  <div className="ml-5 font-mono text-[11px] text-muted">→ {e.result}</div>
                  {e.plan?.map((l, i) => (
                    <div key={i} className="ml-5 text-[11px] text-faint">
                      plan: <Md text={l} />
                    </div>
                  ))}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
