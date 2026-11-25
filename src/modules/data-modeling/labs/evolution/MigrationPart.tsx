import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'framer-motion';
import { Ban, ChevronDown, ChevronUp, GripVertical, Lightbulb, ListOrdered, Play, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, Tag } from '@/shared/ui';
import type { Change, ChangeLine } from '../../ui/ChangeCard';
import { PredictCard } from '../../ui/Predict';
import { Rich } from '../../ui/Rich';
import { COLS, ROLLOUT_MIN, SCENARIOS, firstBreak, simulate, type Cell, type Col, type Scenario, type ScenarioId, type SimResult, type StepCard } from './migrations';

type Box = 'pool' | 'plan' | 'bin';
type Board = Record<Box, string[]>;

const initialBoard = (s: Scenario): Board => ({ pool: [...s.pool], plan: [], bin: [] });

const CELL_STYLE: Record<Cell['s'], string> = {
  ok: 'border-ok/30 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/15 text-warn',
  bad: 'border-bad/50 bg-bad/15 text-bad',
  na: 'border-line bg-ink/[0.03] text-faint',
};
const CELL_ICON: Record<Cell['s'], string> = { ok: '✓', warn: '!', bad: '✗', na: '—' };
const PHASE_LABEL = { v1: 'v1 only', both: `v1 + v2 · ${ROLLOUT_MIN} min`, v2: 'v2 only' } as const;

export function MigrationPart({
  scnId,
  setScnId,
  done,
  predicted,
  onPredict,
  onSolved,
  onChange,
}: {
  scnId: ScenarioId;
  setScnId: (id: ScenarioId) => void;
  done: Record<string, boolean> | undefined;
  predicted: Record<string, number>;
  onPredict: (key: string, i: number, right: boolean) => void;
  onSolved: (exId: string) => void;
  onChange: (c: Change) => void;
}) {
  const scn = SCENARIOS.find((s) => s.id === scnId)!;
  const [boards, setBoards] = useState<Record<ScenarioId, Board>>(() => Object.fromEntries(SCENARIOS.map((s) => [s.id, initialBoard(s)])) as Record<ScenarioId, Board>);
  const [ran, setRan] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<{ row: number; col: Col } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const board = boards[scnId];
  const pkey = `mig-${scnId}`;
  const answered = predicted[pkey];
  const live = !!ran[scnId];

  const sim = useMemo(() => simulate(scn, board.plan, board.bin), [scn, board]);
  const prevSim = useRef<{ id: ScenarioId; sim: SimResult } | null>(null);

  const setBoard = (fn: (b: Board) => Board) => {
    setBoards((all) => ({ ...all, [scnId]: fn(all[scnId]) }));
    setHint(null);
    setSel(null);
  };

  // live re-simulation after the first run: diff ✗ counts per move
  useEffect(() => {
    const prev = prevSim.current;
    prevSim.current = { id: scnId, sim };
    if (!live || !prev || prev.id !== scnId || prev.sim === sim) return;
    const p = prev.sim;
    if (p.bad === sim.bad && p.warn === sim.warn && p.missing.length === sim.missing.length && p.trapsNotBinned.length === sim.trapsNotBinned.length && p.solved === sim.solved) return;
    onChange(describeSim(scn, sim, p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim]);

  useEffect(() => {
    setSel(null);
    setHint(null);
  }, [scnId]);

  useEffect(() => {
    if (live && sim.solved && !done?.[scn.exId]) onSolved(scn.exId);
  }, [live, sim.solved, done, scn.exId, onSolved]);

  const run = () => {
    setRan((r) => ({ ...r, [scnId]: true }));
    prevSim.current = { id: scnId, sim };
    onChange(describeSim(scn, sim, null));
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const find = (id: string): Box | null => {
    if (id === 'pool' || id === 'plan' || id === 'bin') return id;
    return (['pool', 'plan', 'bin'] as Box[]).find((b) => board[b].includes(id)) ?? null;
  };
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = find(String(active.id));
    const to = find(String(over.id));
    if (!from || !to || from === to) return;
    setBoard((b) => {
      const src = b[from].filter((x) => x !== active.id);
      const dst = [...b[to]];
      const at = dst.indexOf(String(over.id));
      dst.splice(at >= 0 ? at : dst.length, 0, String(active.id));
      return { ...b, [from]: src, [to]: dst };
    });
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const from = find(String(active.id));
    const to = find(String(over.id));
    if (!from || from !== to) return;
    const list = board[from];
    const a = list.indexOf(String(active.id));
    const b = list.indexOf(String(over.id));
    if (a >= 0 && b >= 0 && a !== b) setBoard((bd) => ({ ...bd, [from]: arrayMove(list, a, b) }));
  };
  const moveTo = (id: string, to: Box) =>
    setBoard((b) => {
      const next: Board = { pool: b.pool.filter((x) => x !== id), plan: b.plan.filter((x) => x !== id), bin: b.bin.filter((x) => x !== id) };
      next[to] = [...next[to], id];
      return next;
    });
  const shift = (id: string, d: -1 | 1) =>
    setBoard((b) => {
      const i = b.plan.indexOf(id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= b.plan.length) return b;
      return { ...b, plan: arrayMove(b.plan, i, j) };
    });

  const giveHint = () => {
    const sol = scn.solution;
    const trapIn = board.plan.find((id) => scn.steps.find((s) => s.id === id)?.trap);
    if (trapIn) return setHint(`“${title(scn, trapIn)}” is a trap: ${scn.steps.find((s) => s.id === trapIn)!.why}`);
    for (let i = 0; i < sol.length; i++)
      if (board.plan[i] !== sol[i]) return setHint(`One safe plan has “${title(scn, sol[i])}” as step ${i + 1}${i ? `, right after “${title(scn, sol[i - 1])}”` : ''}.`);
    const trapLeft = scn.steps.find((s) => s.trap && !board.bin.includes(s.id));
    setHint(trapLeft ? `Drag “${trapLeft.title}” to Don’t do.` : 'Your plan matches a known-safe order. Run it!');
  };

  const byId = (id: string) => scn.steps.find((s) => s.id === id)!;
  const rowOf = Object.fromEntries(sim.rows.map((r, i) => [r.id, i]));

  return (
    <div className="space-y-3">
      {/* scenario tabs */}
      <div className="flex flex-wrap gap-1.5">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setScnId(s.id)}
            className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11.5px] transition', s.id === scnId ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-muted hover:border-accent')}
          >
            <span className="opacity-60">{i + 1}</span> {s.short}
            {done?.[s.exId] && <span className={s.id === scnId ? 'text-paper' : 'text-ok'}>✓</span>}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="text-[14px] font-semibold text-ink">
          <Rich text={scn.title} />
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-faint">{scn.table}</div>
        <ul className="mt-1.5 space-y-0.5">
          {scn.context.map((c, i) => (
            <li key={i} className="text-[12.5px] leading-snug text-muted">
              <Rich text={c} />
            </li>
          ))}
        </ul>
      </div>

      {/* board */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-[1fr_1.15fr_1fr] gap-2.5">
          <Column id="pool" title="Step cards" sub="drag into the plan or the bin" icon={<ListOrdered size={12} />} items={board.pool}>
            {board.pool.map((id) => (
              <StepItem key={id} step={byId(id)} box="pool" onMove={moveTo} reveal={false} />
            ))}
          </Column>
          <Column id="plan" title="Your plan" sub="runs top → bottom" icon={<Play size={12} />} items={board.plan} accent>
            {board.plan.map((id, i) => {
              const r = live ? sim.rows[rowOf[id]] : undefined;
              const status = r ? (Object.values(r.cells).some((c) => c.s === 'bad') ? 'bad' : Object.values(r.cells).some((c) => c.s === 'warn') ? 'warn' : 'ok') : undefined;
              return <StepItem key={id} step={byId(id)} box="plan" index={i} status={status} onMove={moveTo} onShift={shift} reveal={live} />;
            })}
          </Column>
          <Column id="bin" title="Don’t do" sub="traps you exclude" icon={<Ban size={12} />} items={board.bin} danger>
            {board.bin.map((id) => (
              <StepItem key={id} step={byId(id)} box="bin" onMove={moveTo} reveal={live} />
            ))}
          </Column>
        </div>
      </DndContext>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" icon={<Play size={13} />} onClick={run} disabled={answered === undefined || board.plan.length === 0}>
          {live ? 'Re-run rolling deploy' : 'Simulate rolling deploy'}
        </Button>
        <Button variant="ghost" size="sm" icon={<Lightbulb size={13} />} onClick={giveHint}>
          Hint
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<RotateCcw size={13} />}
          onClick={() => {
            setBoard(() => initialBoard(scn));
            setRan((r) => ({ ...r, [scnId]: false }));
          }}
        >
          Reset
        </Button>
        {answered === undefined && <span className="font-mono text-[11px] text-accent">↓ answer the prediction to unlock the simulation</span>}
        {live && (
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px]">
            <Tag size="sm" tone={sim.bad ? 'bad' : 'ok'}>
              {sim.bad} ✗
            </Tag>
            <Tag size="sm" tone={sim.warn ? 'warn' : 'neutral'}>
              {sim.warn} !
            </Tag>
            {sim.solved && (
              <Tag size="sm" tone="ok">
                zero-downtime ✓
              </Tag>
            )}
          </span>
        )}
      </div>
      {hint && (
        <Callout tone="tip" title="Hint">
          <span className="text-[12px]">
            <Rich text={hint} />
          </span>
        </Callout>
      )}

      {answered === undefined ? (
        <PredictCard key={pkey} predict={scn.predict} onAnswer={(i, right) => onPredict(pkey, i, right)} />
      ) : !live ? (
        <div className="rounded-xl border border-dashed border-line bg-surface/60 p-6 text-center font-mono text-[12px] text-faint">
          Arrange the plan, then simulate: each step becomes a row, checked against v1 and v2 pods and lock risk.
        </div>
      ) : (
        <Grid sim={sim} sel={sel} setSel={setSel} />
      )}

      {live && sim.missing.length > 0 && (
        <Callout tone="warn" title={`Missing from the plan (${sim.missing.length})`}>
          <span className="text-[12px]">
            <Rich text={sim.missing.map((m) => `**${m.title}**: ${m.why}`).join(' · ')} />
          </span>
        </Callout>
      )}
      {done?.[scn.exId] && sim.solved && live && (
        <Callout tone="ok" title="Zero-downtime plan">
          <span className="text-[12px]">
            Every row works for whichever pods are live, no step holds a blocking lock for longer than milliseconds, and every trap is excluded. That’s expand → migrate → contract.
          </span>
        </Callout>
      )}
    </div>
  );
}

const title = (scn: Scenario, id: string) => scn.steps.find((s) => s.id === id)?.title ?? id;

function Column({ id, title, sub, icon, items, children, accent, danger }: { id: Box; title: string; sub: string; icon: ReactNode; items: string[]; children: ReactNode; accent?: boolean; danger?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[220px] flex-col rounded-xl border p-2 transition',
        accent ? 'border-accent/40 bg-accent/[0.04]' : danger ? 'border-bad/30 bg-bad/[0.03]' : 'border-line bg-surface/70',
        isOver && 'ring-2 ring-accent/40',
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <span className={cn(accent ? 'text-accent' : danger ? 'text-bad' : 'text-muted')}>{icon}</span>
        <span className="font-mono text-[11.5px] font-semibold text-ink">{title}</span>
        <span className="truncate font-mono text-[10px] text-faint">{sub}</span>
        <span className="ml-auto font-mono text-[10.5px] text-faint">{items.length}</span>
      </div>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-1.5">
          {children}
          {items.length === 0 && <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line p-3 text-center font-mono text-[10.5px] text-faint">drop here</div>}
        </div>
      </SortableContext>
    </div>
  );
}

function StepItem({
  step,
  box,
  index,
  status,
  onMove,
  onShift,
  reveal,
}: {
  step: StepCard;
  box: Box;
  index?: number;
  status?: 'ok' | 'warn' | 'bad';
  onMove: (id: string, to: Box) => void;
  onShift?: (id: string, d: -1 | 1) => void;
  reveal: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const [open, setOpen] = useState(false);
  const lines = step.sql.split('\n');
  const binVerdict = reveal && box === 'bin' ? (step.trap ? 'ok' : 'bad') : undefined;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'rounded-lg border bg-surface text-[12px] shadow-sm',
        isDragging && 'z-10 opacity-80 shadow-paper',
        status === 'bad' ? 'border-bad/60' : status === 'warn' ? 'border-warn/60' : status === 'ok' ? 'border-ok/50' : 'border-line',
        binVerdict === 'bad' && 'border-bad/60',
      )}
    >
      <div className="flex items-start gap-1 px-1.5 pt-1.5">
        <button {...attributes} {...listeners} className="mt-0.5 cursor-grab touch-none text-faint hover:text-ink active:cursor-grabbing" aria-label={`Drag ${step.title}`}>
          <GripVertical size={13} />
        </button>
        {index !== undefined && <span className="mt-[1px] font-mono text-[11px] font-semibold text-accent">{index + 1}.</span>}
        <div className="min-w-0 flex-1 font-medium leading-snug text-ink">
          <Rich text={step.title} />
        </div>
        {status && <span className={cn('font-mono text-[11px] font-bold', status === 'bad' ? 'text-bad' : status === 'warn' ? 'text-warn' : 'text-ok')}>{CELL_ICON[status]}</span>}
      </div>
      <button onClick={() => setOpen((o) => !o)} className="block w-full px-2 pb-1 pt-0.5 text-left">
        <pre className={cn('overflow-hidden whitespace-pre-wrap break-words font-mono text-[10.5px] leading-snug text-muted', !open && 'line-clamp-2')}>{open ? step.sql : lines.slice(0, 2).join('\n')}</pre>
      </button>
      {binVerdict && (
        <div className={cn('mx-1.5 mb-1 rounded px-1.5 py-1 text-[11px] leading-snug', binVerdict === 'ok' ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}>
          {binVerdict === 'ok' ? 'Trap, correctly excluded: ' : 'Needed, don’t bin it: '}
          <span className="text-muted">
            <Rich text={step.why} />
          </span>
        </div>
      )}
      <div className="flex items-center gap-0.5 border-t border-line px-1 py-0.5">
        {box === 'plan' && onShift && (
          <>
            <IconBtn label="Move up" onClick={() => onShift(step.id, -1)}>
              <ChevronUp size={12} />
            </IconBtn>
            <IconBtn label="Move down" onClick={() => onShift(step.id, 1)}>
              <ChevronDown size={12} />
            </IconBtn>
          </>
        )}
        <span className="ml-auto flex gap-0.5">
          {box !== 'plan' && (
            <IconBtn label="Add to plan" onClick={() => onMove(step.id, 'plan')}>
              <Play size={11} /> <span className="text-[10px]">plan</span>
            </IconBtn>
          )}
          {box !== 'bin' && (
            <IconBtn label="Don’t do" onClick={() => onMove(step.id, 'bin')}>
              <Trash2 size={11} /> <span className="text-[10px]">don’t</span>
            </IconBtn>
          )}
          {box !== 'pool' && (
            <IconBtn label="Back to cards" onClick={() => onMove(step.id, 'pool')}>
              <Undo2 size={11} />
            </IconBtn>
          )}
        </span>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-faint hover:bg-ink/5 hover:text-ink">
      {children}
    </button>
  );
}

function Grid({ sim, sel, setSel }: { sim: SimResult; sel: { row: number; col: Col } | null; setSel: (s: { row: number; col: Col } | null) => void }) {
  const picked = sel ? sim.rows[sel.row]?.cells[sel.col] : undefined;
  const breaks = sim.rows.flatMap((r, i) =>
    COLS.filter((c) => r.cells[c.key].s === 'bad' || r.cells[c.key].s === 'warn').map((c) => ({ i, row: r, col: c, cell: r.cells[c.key] })),
  );
  // collapse repeated "blocked behind lock" explanations to the lock cell
  const shown = breaks.filter((b, k) => !(b.cell.why.startsWith('Blocked behind') && breaks.some((o, m) => m !== k && o.i === b.i && o.col.key === 'lock')));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-line bg-surface p-2">
        <table className="w-full min-w-[640px] border-separate border-spacing-1 font-mono text-[11px]">
          <thead>
            <tr className="text-left text-[10.5px] text-faint">
              <th className="w-6 font-normal">#</th>
              <th className="font-normal">step</th>
              <th className="w-[92px] font-normal">live pods</th>
              {COLS.map((c) => (
                <th key={c.key} className="w-[66px] text-center font-normal">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {sim.rows.map((r, i) => (
                <motion.tr key={r.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.04 }}>
                  <td className="text-faint">{i + 1}</td>
                  <td className={cn('max-w-[260px] truncate pr-1 text-ink', r.fail && 'text-bad')} title={r.title}>
                    {r.title.replace(/`/g, '')}
                  </td>
                  <td>
                    <span className={cn('rounded px-1 py-0.5 text-[10px]', r.phase === 'both' ? 'bg-violet/15 text-violet' : r.phase === 'v2' ? 'bg-info/10 text-info' : 'bg-ink/5 text-muted')}>{PHASE_LABEL[r.phase]}</span>
                  </td>
                  {COLS.map((c) => {
                    const cell = r.cells[c.key];
                    const on = sel?.row === i && sel.col === c.key;
                    return (
                      <td key={c.key} className="text-center">
                        <motion.button
                          key={`${cell.s}-${cell.why.length}`}
                          initial={{ scale: 0.7, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          onClick={() => setSel(on ? null : { row: i, col: c.key })}
                          title={cell.why.replace(/[*`]/g, '')}
                          className={cn('h-6 w-full rounded border text-[12px] font-bold', CELL_STYLE[cell.s], on && 'ring-2 ring-accent')}
                        >
                          {CELL_ICON[cell.s]}
                        </motion.button>
                      </td>
                    );
                  })}
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
        <div className="mt-1 flex flex-wrap gap-3 px-1 font-mono text-[10px] text-faint">
          <span>✓ works</span>
          <span className="text-warn">! risky / pointless</span>
          <span className="text-bad">✗ breaks</span>
          <span>— not running</span>
          <span className="ml-auto">click a cell for the why</span>
        </div>
      </div>

      {picked && sel && (
        <div className={cn('rounded-lg border px-3 py-2 text-[12px] leading-snug', CELL_STYLE[picked.s])}>
          <span className="font-mono text-[11px] font-semibold">
            {sel.row + 1}. {sim.rows[sel.row].title.replace(/`/g, '')} · {COLS.find((c) => c.key === sel.col)!.label}:
          </span>{' '}
          <span className="text-ink">
            <Rich text={picked.why || 'No issue.'} />
          </span>
        </div>
      )}

      {shown.length > 0 && (
        <div className="rounded-xl border border-bad/30 bg-bad/[0.04] p-2.5">
          <div className="eyebrow mb-1 text-bad">What breaks, and the impact</div>
          <ul className="space-y-1">
            {shown.map((b) => (
              <li key={`${b.i}-${b.col.key}`} className="text-[12px] leading-snug text-ink">
                <span className={cn('mr-1 font-mono text-[11px] font-bold', b.cell.s === 'bad' ? 'text-bad' : 'text-warn')}>
                  {CELL_ICON[b.cell.s]} {b.i + 1}·{b.col.label}
                </span>
                <Rich text={b.cell.why} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function describeSim(scn: Scenario, sim: SimResult, prev: SimResult | null): Change {
  const lines: ChangeLine[] = [];
  if (prev) lines.push({ tone: sim.bad < prev.bad ? 'ok' : sim.bad > prev.bad ? 'bad' : 'info', text: `✗ cells: ${prev.bad} → **${sim.bad}** · warnings ${prev.warn} → ${sim.warn}` });
  else lines.push({ tone: sim.bad ? 'bad' : 'ok', text: `Simulated ${sim.rows.length} step${sim.rows.length === 1 ? '' : 's'} through a ${ROLLOUT_MIN}-minute rolling deploy: **${sim.bad} ✗**, ${sim.warn} warnings.` });
  const fb = firstBreak(sim);
  if (fb) lines.push({ tone: 'bad', text: `First break · **${fb.step.replace(/`/g, '')}** (${fb.col}): ${fb.why}` });
  const trapIn = sim.rows.map((r) => scn.steps.find((s) => s.id === r.id)!).filter((s) => s.trap);
  for (const t of trapIn) lines.push({ tone: 'bad', text: `Trap in the plan: **${t.title.replace(/`/g, '')}**. ${t.why}` });
  if (sim.missing.length) lines.push({ tone: 'warn', text: `Missing: ${sim.missing.map((m) => `**${m.title.replace(/`/g, '')}**`).join(', ')}.` });
  const loose = sim.trapsNotBinned.filter((t) => !trapIn.includes(t));
  if (loose.length) lines.push({ tone: 'info', text: `Still unsorted: ${loose.length} trap card${loose.length === 1 ? '' : 's'}; drag to Don’t do.` });
  if (sim.solved) lines.push({ tone: 'ok', text: 'Safe: every intermediate schema serves v1 and v2, locks are brief, traps excluded.' });
  return { key: `${scn.id}-${sim.bad}-${sim.missing.length}-${sim.rows.map((r) => r.id).join('.')}`, title: `${scn.short}: rolling-deploy check`, lines };
}
