import { useMemo, useState } from 'react';
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
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { BookOpen, CheckCircle2, GripVertical, Lightbulb, Lock, Play, RotateCcw, Wand2, XCircle } from 'lucide-react';
import { Button, Callout, Tag } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { Problem } from '../engine/types';
import { parseCode } from '../engine/tracer';
import { patternById } from '../data/patterns';
import { useDsa, type BuildMode } from '../store';
import { shuffle } from './common';

interface Block {
  id: string;
  text: string;
  distractor: boolean;
  why?: string;
  key?: string | null;
  locked?: boolean;
}

type Containers = { solution: string[]; tray: string[] };
type Mark = 'ok' | 'bad' | 'move';

interface Feedback {
  ok: boolean;
  title: string;
  items: { tone: 'bad' | 'warn' | 'info'; text: string }[];
}

const MODES: { id: BuildMode; label: string; blurb: string }[] = [
  { id: 'worked', label: '1 · Worked example', blurb: 'Read the full solution line by line with the reason for each line.' },
  { id: 'faded', label: '2 · Fill the gaps', blurb: 'The skeleton is there — drag the missing lines into the right place.' },
  { id: 'scratch', label: '3 · Build from scratch', blurb: 'Assemble the whole algorithm. Some blocks are traps.' },
];

function setup(problem: Problem, mode: BuildMode, seed: number) {
  const lines = parseCode(problem.code).filter((l) => l.text.trim());
  const blocks: Record<string, Block> = {};
  const correct: string[] = [];
  lines.forEach((l, i) => {
    const id = `l${i}`;
    blocks[id] = { id, text: l.text, distractor: false, key: l.key };
    correct.push(id);
  });
  const pattern = patternById[problem.pattern];
  const distractors = [
    ...problem.distractors,
    ...shuffle(pattern?.distractors ?? [], seed).slice(0, mode === 'scratch' ? 2 : 1),
  ];
  distractors.forEach((d, i) => {
    blocks[`d${i}`] = { id: `d${i}`, text: d.text, distractor: true, why: d.why };
  });
  const dIds = distractors.map((_, i) => `d${i}`);

  let c: Containers;
  if (mode === 'worked') c = { solution: [...correct], tray: [] };
  else if (mode === 'scratch') c = { solution: [], tray: shuffle([...correct, ...dIds], seed) };
  else {
    // fade roughly half of the body (never the signature line) — prefer loop/branch/return lines
    const body = correct.slice(1);
    const score = (id: string) => (/^\s*(for|while|if|elif|else|return)\b/.test(blocks[id].text) ? 2 : 0) + ((seed + id.length + +id.slice(1)) % 3);
    const fadeN = Math.max(2, Math.ceil(body.length * 0.45));
    const faded = new Set([...body].sort((a, b) => score(b) - score(a)).slice(0, fadeN));
    const solution = correct.filter((id) => !faded.has(id));
    solution.forEach((id) => (blocks[id] = { ...blocks[id], locked: true }));
    c = { solution, tray: shuffle([...faded, ...dIds.slice(0, Math.max(2, problem.distractors.length))], seed) };
  }
  return { blocks, correct, containers: c };
}

export function Builder({ problem, onRun }: { problem: Problem; onRun: () => void }) {
  const progress = useDsa((s) => s.problems[problem.id]);
  const recordBuild = useDsa((s) => s.recordBuild);
  const recordHint = useDsa((s) => s.recordHint);
  const suggested: BuildMode = progress?.built?.faded ? 'scratch' : progress?.built?.worked ? 'faded' : 'worked';
  const [mode, setMode] = useState<BuildMode>(suggested);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const { blocks, correct } = useMemo(() => setup(problem, mode, seed), [problem, mode, seed]);
  const [c, setC] = useState<Containers>(() => setup(problem, mode, seed).containers);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [fb, setFb] = useState<Feedback | null>(null);
  const [hints, setHints] = useState(0);

  const restart = (m: BuildMode = mode) => {
    const s = Math.floor(Math.random() * 1e6);
    setMode(m);
    setSeed(s);
    setC(setup(problem, m, s).containers);
    setMarks({});
    setFb(null);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const find = (id: string): keyof Containers | null => {
    if (id === 'solution' || id === 'tray') return id;
    if (c.solution.includes(id)) return 'solution';
    if (c.tray.includes(id)) return 'tray';
    return null;
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = find(String(active.id));
    const to = find(String(over.id));
    if (!from || !to || from === to) return;
    setC((prev) => {
      const src = prev[from].filter((x) => x !== active.id);
      const dst = [...prev[to]];
      const overIdx = dst.indexOf(String(over.id));
      dst.splice(overIdx >= 0 ? overIdx : dst.length, 0, String(active.id));
      return { ...prev, [from]: src, [to]: dst } as Containers;
    });
    setMarks({});
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const from = find(String(active.id));
    const to = find(String(over.id));
    if (!from || from !== to) return;
    const list = c[from];
    const a = list.indexOf(String(active.id));
    const b = list.indexOf(String(over.id));
    if (a >= 0 && b >= 0 && a !== b) {
      // locked (given) lines keep their place relative to each other
      const next = arrayMove(list, a, b);
      const lockedOrder = next.filter((id) => blocks[id].locked);
      const expected = list.filter((id) => blocks[id].locked);
      if (lockedOrder.join() !== expected.join()) return;
      setC({ ...c, [from]: next });
      setMarks({});
    }
  };

  const move = (id: string) => {
    if (mode === 'worked' || blocks[id].locked) return;
    const from = find(id);
    if (!from) return;
    const to = from === 'solution' ? 'tray' : 'solution';
    setC({ ...c, [from]: c[from].filter((x) => x !== id), [to]: [...c[to], id] } as Containers);
    setMarks({});
  };

  const check = () => {
    const sol = c.solution;
    const items: Feedback['items'] = [];
    const m: Record<string, Mark> = {};
    const traps = sol.filter((id) => blocks[id].distractor);
    for (const id of traps) {
      m[id] = 'bad';
      items.push({ tone: 'bad', text: `“${blocks[id].text.trim()}” — ${blocks[id].why}` });
    }
    const real = sol.filter((id) => !blocks[id].distractor);
    const text = (id: string) => blocks[id].text;
    const correctTexts = correct.map(text);
    // longest prefix match + positional check using texts (duplicate lines are interchangeable)
    let firstWrong = -1;
    const placedTexts = real.map(text);
    const expectedPlaced = correctTexts.filter((t) => {
      const i = placedTexts.indexOf(t);
      if (i >= 0) {
        placedTexts[i] = '\u0000';
        return true;
      }
      return false;
    });
    real.forEach((id, i) => {
      const ok = text(id) === expectedPlaced[i];
      if (!ok && firstWrong < 0) firstWrong = i;
      m[id] = ok ? 'ok' : 'move';
    });
    if (firstWrong >= 0) {
      const wrongId = real[firstWrong];
      const exp = correct.find((id) => text(id) === expectedPlaced[firstWrong]);
      const why = exp && blocks[exp].key ? problem.explain?.[blocks[exp].key!] : undefined;
      items.push({
        tone: 'warn',
        text:
          `Order: “${text(wrongId).trim()}” is not where it belongs (orange blocks are out of position). ` +
          `Ask yourself what must already exist before it can run.` +
          (why ? ` Hint about the line that belongs here: ${why}` : ''),
      });
    }
    const missing = correct.length - real.length;
    if (missing > 0) {
      items.push({ tone: 'info', text: `${missing} line${missing > 1 ? 's are' : ' is'} still missing from your solution.` });
    }
    const ok = !items.length;
    setMarks(m);
    setFb({
      ok,
      title: ok ? 'Correct — every line is in the right place.' : 'Not yet. Here is what to fix:',
      items,
    });
    recordBuild(problem.id, mode, ok);
  };

  const studied = () => {
    recordBuild(problem.id, 'worked', true);
    setFb({ ok: true, title: 'Worked example studied. Next: fill the gaps from memory.', items: [] });
  };

  const placed = c.solution.length;
  const modeInfo = MODES.find((x) => x.id === mode)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {MODES.map((x) => (
          <Button
            key={x.id}
            size="sm"
            variant={mode === x.id ? 'primary' : 'secondary'}
            onClick={() => restart(x.id)}
            icon={progress?.built?.[x.id] ? <CheckCircle2 className="h-3.5 w-3.5 text-ok" /> : undefined}
          >
            {x.label}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted">{modeInfo.blurb}</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div className={cn('grid gap-4', mode !== 'worked' && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
          <Column
            id="solution"
            title={mode === 'worked' ? 'Solution (read it, then explain each line to yourself)' : `Your solution · ${placed} block${placed === 1 ? '' : 's'}`}
            empty="Drag blocks here (or click a block in the tray) in the order they should run."
            ids={c.solution}
            blocks={blocks}
            marks={marks}
            onClick={move}
            explain={mode === 'worked' ? problem.explain : undefined}
            numbered
          />
          {mode !== 'worked' && (
            <Column
              id="tray"
              title="Block tray — some of these are traps"
              empty="Tray is empty."
              ids={c.tray}
              blocks={blocks}
              marks={marks}
              onClick={move}
              sunken
            />
          )}
        </div>
      </DndContext>

      <div className="flex flex-wrap items-center gap-2">
        {mode === 'worked' ? (
          <Button variant="primary" icon={<BookOpen className="h-4 w-4" />} onClick={studied}>
            I can explain every line
          </Button>
        ) : (
          <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} onClick={check} disabled={!placed}>
            Check my solution
          </Button>
        )}
        <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => restart()}>
          Reshuffle
        </Button>
        <Button variant="ghost" icon={<Play className="h-4 w-4" />} onClick={onRun}>
          Watch it run
        </Button>
        {mode !== 'worked' && hints < problem.hints.length && (
          <Button
            variant="ghost"
            icon={<Lightbulb className="h-4 w-4" />}
            onClick={() => {
              setHints((h) => h + 1);
              recordHint(problem.id);
            }}
          >
            Hint {hints + 1}/{problem.hints.length}
          </Button>
        )}
      </div>

      {hints > 0 && mode !== 'worked' && (
        <div className="space-y-1.5">
          {problem.hints.slice(0, hints).map((h, i) => (
            <div key={i} className="flex gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-ink">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              {h}
            </div>
          ))}
        </div>
      )}

      {fb && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <Callout tone={fb.ok ? 'ok' : 'warn'} title={fb.title}>
            {fb.items.length > 0 && (
              <ul className="mt-1 space-y-1.5">
                {fb.items.map((it, i) => (
                  <li key={i} className="flex gap-2">
                    {it.tone === 'bad' ? (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
                    ) : (
                      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', it.tone === 'warn' ? 'bg-warn' : 'bg-info')} />
                    )}
                    <span>{it.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {fb.ok && mode !== 'scratch' && (
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={() => restart(mode === 'worked' ? 'faded' : 'scratch')}>
                  Next level: {mode === 'worked' ? 'fill the gaps' : 'build from scratch'} →
                </Button>
              </div>
            )}
            {fb.ok && mode === 'scratch' && (
              <p className="mt-1">
                Added to your spaced-review queue. You will be asked to rebuild it from memory in a few days — that is when it really sticks.
              </p>
            )}
          </Callout>
        </motion.div>
      )}
    </div>
  );
}

function Column({
  id,
  title,
  empty,
  ids,
  blocks,
  marks,
  onClick,
  explain,
  numbered,
  sunken,
}: {
  id: string;
  title: string;
  empty: string;
  ids: string[];
  blocks: Record<string, Block>;
  marks: Record<string, Mark>;
  onClick: (id: string) => void;
  explain?: Record<string, string>;
  numbered?: boolean;
  sunken?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div className="min-w-0">
      <div className="eyebrow mb-1.5">{title}</div>
      <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            'min-h-[8rem] space-y-1 rounded-xl border-2 border-dashed p-2 transition-colors',
            sunken ? 'bg-sunken/40' : 'bg-surface/50',
            isOver ? 'border-accent/60' : 'border-line',
          )}
        >
          {!ids.length && <div className="p-4 text-center text-xs text-faint">{empty}</div>}
          {ids.map((bid, i) => (
            <SortableBlock
              key={bid}
              block={blocks[bid]}
              mark={marks[bid]}
              n={numbered ? i + 1 : undefined}
              onClick={() => onClick(bid)}
              note={explain && blocks[bid].key ? explain[blocks[bid].key!] : undefined}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableBlock({ block, mark, n, onClick, note }: { block: Block; mark?: Mark; n?: number; onClick: () => void; note?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled: block.locked });
  const indent = block.text.length - block.text.trimStart().length;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative flex items-start gap-2 rounded-lg border px-2 py-1.5 font-mono text-[12.5px] transition-colors',
        block.locked ? 'cursor-default border-line/50 bg-sunken/40 text-muted' : 'cursor-grab border-line bg-surface hover:border-ink/30 active:cursor-grabbing',
        mark === 'ok' && 'border-ok/60 bg-ok/10',
        mark === 'bad' && 'border-bad bg-bad/10',
        mark === 'move' && 'border-warn bg-warn/10',
        isDragging && 'z-10 shadow-lift ring-2 ring-accent/50',
      )}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {n !== undefined && <span className="w-5 shrink-0 select-none text-right text-[10px] leading-5 text-faint">{n}</span>}
      {block.locked ? (
        <Lock className="mt-1 h-3 w-3 shrink-0 text-faint" />
      ) : (
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-faint group-hover:text-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="whitespace-pre-wrap break-words leading-5" style={{ paddingLeft: `${indent * 0.55}em` }}>
          {block.text.trimStart()}
        </div>
        {note && <div className="mt-1 whitespace-normal font-sans text-xs leading-relaxed text-muted">{note}</div>}
      </div>
      {mark === 'bad' && <Tag tone="bad">trap</Tag>}
    </div>
  );
}
