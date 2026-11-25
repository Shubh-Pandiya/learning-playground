import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Eraser, Lightbulb, PartyPopper, X } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, Tag } from '@/shared/ui';
import { TOPICS } from '../data/topics';
import { addColumn, addTable, attrName, connect, diffImpact, disconnect, dropColumn, moveColumn, moveTable, removeTable, startSchema, toggleIndex, togglePk } from '../engine/analyze';
import { evaluate, type Evaluation } from '../engine/evaluate';
import { canvasKey, topicPath, useDm } from '../store';
import type { CanvasTopic, Scenario, Schema } from '../types';
import { Canvas } from '../ui/Canvas';
import { ChangeCard, type Change } from '../ui/ChangeCard';
import { ImpactPanel } from '../ui/ImpactPanel';
import { Inspector } from '../ui/Inspector';
import { ClosenessView, MetricStrip } from '../ui/Metrics';
import { Palette } from '../ui/Palette';
import { Rich } from '../ui/Rich';

type Tab = 'feedback' | 'impact' | 'changes';
const TAB_LABEL: Record<Tab, string> = { feedback: 'Feedback', impact: 'Impact', changes: 'Changes' };

interface LogEntry extends Change {
  at: number;
  /** Table the change is about. */
  subject?: string;
}

interface Note {
  key: string;
  tone: 'ok' | 'warn' | 'bad';
  title: string;
  body: string;
}

/** Click-to-add placement: the template's layout slot if free, else a free spot right of the model. */
function nextPos(s: Schema, sc: Scenario, tpl: string) {
  const taken = (x: number, y: number) => s.tables.some((t) => Math.abs(t.x - x) < 200 && Math.abs(t.y - y) < 120);
  const l = sc.layout[tpl];
  if (l && !taken(l.x, l.y)) return l;
  const x = s.tables.length ? Math.max(...s.tables.map((t) => t.x)) + 280 : 0;
  for (const y of [0, 220, 440, -220]) if (!taken(x, y)) return { x, y };
  return { x, y: 660 };
}

function hint(sc: Scenario, schema: Schema, ev: Evaluation, level: 1 | 2 | 3): string {
  const trap = schema.tables.find((t) => ev.verdicts[t.id] === 'wrong');
  if (trap) return level === 1 ? 'One of the tables on the canvas is a trap for this workload. Which one fights the access patterns?' : `Remove **${trap.name}**. ${sc.notes[trap.tpl]?.instead ?? ''}`.trim();
  const r = ev.reqs.find((x) => !x.met);
  if (r) return r.hints[level - 1];
  const bad = ev.impact.issues.find((i) => i.severity === 'bad');
  if (bad) return level === 1 ? `Requirements are met, but a red flag remains: ${bad.title}.` : `${bad.title}. ${bad.fix ?? ''}`;
  return 'Everything is met. Explore: what breaks if you denormalise one table back?';
}

export function Workbench({ topic, mode }: { topic: CanvasTopic; mode: 'build' | 'challenge' }) {
  const sc = mode === 'build' ? topic.scenario : topic.challenge;
  const key = canvasKey(topic.id, mode);
  const saved = useDm((st) => st.canvases[key]);
  const saveCanvas = useDm((st) => st.saveCanvas);
  const clearCanvas = useDm((st) => st.clearCanvas);
  const recordResult = useDm((st) => st.recordResult);
  const addHint = useDm((st) => st.addHint);
  const prog = useDm((st) => st.topics[topic.id]);

  const [schema, setSchema] = useState<Schema>(() => saved ?? startSchema(sc));
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [fresh, setFresh] = useState<string[]>([]);
  const [changed, setChanged] = useState<Record<string, string[]>>({});
  const [celebrate, setCelebrate] = useState(false);
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2 | 3>(0);
  const [tab, setTab] = useState<Tab>('feedback');
  const maxHint = mode === 'challenge' ? 2 : 3;

  const ev = useMemo(() => evaluate(sc, schema), [sc, schema]);

  // Refs so the canvas callbacks stay stable.
  const cur = useRef({ schema, ev });
  cur.current = { schema, ev };

  const commit = useCallback(
    (next: Schema, title: string, opts: { subject?: string; changed?: Record<string, string[]>; fresh?: string[] } = {}) => {
      const before = cur.current.ev;
      const after = evaluate(sc, next);
      const lines = diffImpact(sc, before.impact, after.impact);
      if (after.closeness.score !== before.closeness.score)
        lines.push({ tone: after.closeness.score > before.closeness.score ? 'ok' : 'warn', text: `Closeness ${before.closeness.score}% → ${after.closeness.score}%` });
      if (after.met !== before.met) lines.unshift({ tone: after.met > before.met ? 'ok' : 'bad', text: `Requirements met: ${before.met} → ${after.met} of ${after.reqs.length}` });
      setLog((xs) => [{ key: `${Date.now()}`, title, lines, at: Date.now(), subject: opts.subject }, ...xs].slice(0, 50));
      setSchema(next);
      setChanged(opts.changed ?? {});
      if (opts.fresh) setFresh(opts.fresh);
      setTab((t) => (t === 'changes' ? t : 'feedback'));
    },
    [sc],
  );

  const pushNote = (n: Note) => setNotes((xs) => [n, ...xs.filter((x) => x.key !== n.key)].slice(0, 6));

  useEffect(() => {
    saveCanvas(topic.id, mode, schema);
  }, [schema, topic.id, mode, saveCanvas]);

  const wasSolved = useRef(ev.solved);
  useEffect(() => {
    recordResult(topic.id, mode, ev.closeness.score, ev.solved);
    if (ev.solved && !wasSolved.current) setCelebrate(true);
    wasSolved.current = ev.solved;
  }, [ev.solved, ev.closeness.score, topic.id, mode, recordResult]);

  useEffect(() => setHintLevel(0), [schema]);

  const tname = (id: string) => cur.current.schema.tables.find((t) => t.id === id)?.name ?? id;
  const an = (a: string) => `\`${attrName(sc, a)}\``;

  const addTpl = useCallback(
    (tpl: string, x?: number, y?: number) => {
      const s = cur.current.schema;
      if (s.tables.some((t) => t.tpl === tpl)) return;
      const pos = x === undefined || y === undefined ? nextPos(s, sc, tpl) : { x, y };
      const next = addTable(sc, s, tpl, pos);
      const t = next.tables[next.tables.length - 1];
      commit(next, `Added table **${t.name}**`, { subject: t.id, fresh: [t.id] });
      const n = sc.notes[tpl];
      const tp = sc.templates.find((x) => x.id === tpl);
      if (n) pushNote({ key: tpl, tone: n.verdict === 'good' ? 'ok' : n.verdict === 'wrong' ? 'bad' : 'warn', title: tp && !n.title.startsWith(`${tp.name}:`) ? `${tp.name}: ${n.title}` : n.title, body: n.body + (n.instead ? ` **Instead:** ${n.instead}` : '') });
      setSelected(null);
    },
    [sc, commit],
  );

  const onDropAttr = useCallback(
    (to: string, attr: string, from: string | undefined, copy: boolean) => {
      const s = cur.current.schema;
      const target = s.tables.find((t) => t.id === to);
      if (!target || target.columns.some((c) => c.attr === attr)) return;
      if (from && !copy) {
        commit(moveColumn(s, attr, from, to), `Moved ${an(attr)} from **${tname(from)}** → **${tname(to)}**`, { subject: to, changed: { [to]: [attr] } });
      } else if (from) {
        const wasPk = s.tables.find((t) => t.id === from)?.columns.find((c) => c.attr === attr)?.pk;
        commit(addColumn(s, attr, to), wasPk ? `Copied key ${an(attr)} into **${tname(to)}** (a foreign key to ${tname(from)})` : `Copied ${an(attr)} into **${tname(to)}** (now stored twice)`, { subject: to, changed: { [to]: [attr] } });
      } else {
        commit(addColumn(s, attr, to), `Added ${an(attr)} to **${tname(to)}**`, { subject: to, changed: { [to]: [attr] } });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );

  const onTogglePk = useCallback(
    (table: string, attr: string) => {
      const s = cur.current.schema;
      const on = s.tables.find((t) => t.id === table)?.columns.find((c) => c.attr === attr)?.pk;
      commit(togglePk(s, attr, table), on ? `${an(attr)} removed from **${tname(table)}**'s primary key` : `${an(attr)} is now part of **${tname(table)}**'s primary key`, { subject: table, changed: { [table]: [attr] } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );
  const onToggleIndex = useCallback(
    (table: string, attr: string) => {
      const s = cur.current.schema;
      const on = s.tables.find((t) => t.id === table)?.columns.find((c) => c.attr === attr)?.indexed;
      commit(toggleIndex(s, attr, table), on ? `Dropped the index on **${tname(table)}**.${an(attr)}` : `Indexed **${tname(table)}**.${an(attr)}`, { subject: table, changed: { [table]: [attr] } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );
  const onRemoveCol = useCallback(
    (table: string, attr: string) => commit(dropColumn(cur.current.schema, attr, table), `Removed ${an(attr)} from **${tname(table)}**`, { subject: table }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );
  const onConnect = useCallback(
    (child: string, parent: string) => {
      const r = connect(cur.current.schema, child, parent);
      if (r.error) {
        pushNote({ key: `conn:${child}:${parent}`, tone: 'warn', title: `Can't link ${tname(child)} → ${tname(parent)}`, body: r.error });
        setTab('feedback');
        return;
      }
      if (!r.added.length) {
        pushNote({ key: `conn:${child}:${parent}`, tone: 'warn', title: `${tname(child)} already references ${tname(parent)}`, body: 'It already holds the full primary key, so the relationship exists.' });
        return;
      }
      commit(r.schema, `**${tname(child)}** now references **${tname(parent)}** (FK ${r.added.map(an).join(', ')})`, { subject: child, changed: { [child]: r.added } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );
  const onDeleteRels = useCallback(
    (ids: string[]) => {
      let s = cur.current.schema;
      const rels = cur.current.ev.impact.rels.filter((r) => ids.includes(r.id));
      for (const r of rels) s = disconnect(s, r);
      if (rels.length) commit(s, rels.map((r) => `Dropped the link **${tname(r.child)}** → **${tname(r.parent)}**`).join('; '));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );
  const onDeleteTables = useCallback(
    (ids: string[]) => {
      let s = cur.current.schema;
      for (const id of ids) s = removeTable(s, id);
      commit(s, `Removed **${ids.map(tname).join(', ')}**`);
      setSelected((x) => (x && ids.includes(x) ? null : x));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );
  const onMove = useCallback((id: string, x: number, y: number) => setSchema((s) => moveTable(s, id, x, y)), []);

  const onCanvas = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of schema.tables) c[t.tpl] = (c[t.tpl] ?? 0) + 1;
    return c;
  }, [schema.tables]);

  const sel = selected ? schema.tables.find((t) => t.id === selected) : undefined;
  const idx = TOPICS.findIndex((t) => t.id === topic.id);
  const nextTopic = TOPICS[idx + 1];
  const recent = log[0] && Date.now() - log[0].at < 120_000 ? log[0] : undefined;

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[268px] shrink-0 flex-col overflow-y-auto border-r border-line bg-paper p-3.5">
        <div className="eyebrow">{mode === 'build' ? 'Scenario' : 'Transfer challenge · new domain'}</div>
        <h2 className="mt-1 font-mono text-[15px] font-semibold leading-snug">{sc.title}</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          <Rich text={sc.context} />
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Tag size="sm" tone="accent">
            {sc.paradigm === 'oltp' ? 'OLTP' : sc.paradigm === 'olap' ? 'OLAP / warehouse' : 'Data Vault'}
          </Tag>
          <Tag size="sm">{sc.patterns.filter((p) => p.kind === 'read').length} queries</Tag>
          <Tag size="sm">{sc.patterns.filter((p) => p.kind === 'write').length} writes</Tag>
        </div>
        {mode === 'challenge' && !prog?.buildSolved && (
          <Callout tone="tip" className="mt-3">
            <span className="text-[12px]">Tip: solve the Build scenario first. Same technique, different domain. That's the point.</span>
          </Callout>
        )}
        <div className="my-3 h-px bg-line" />
        <Palette sc={sc} onCanvas={onCanvas} unplaced={ev.impact.unplaced} onAdd={(t) => addTpl(t)} />
      </aside>

      <main className="relative min-w-0 flex-1">
        <Canvas
          sc={sc}
          schema={schema}
          impact={ev.impact}
          verdicts={ev.verdicts}
          fresh={fresh}
          changed={changed}
          focus={focus}
          editable
          selectedId={selected}
          onSelect={setSelected}
          onMove={onMove}
          onAddTable={addTpl}
          onConnect={onConnect}
          onDeleteTables={onDeleteTables}
          onDeleteRels={onDeleteRels}
          onTogglePk={onTogglePk}
          onToggleIndex={onToggleIndex}
          onRemoveCol={onRemoveCol}
          onDropAttr={onDropAttr}
          fitKey={`${topic.id}:${mode}`}
        />
        <div className="pointer-events-none absolute left-3 right-3 top-3 flex justify-center">
          <MetricStrip impact={ev.impact} score={ev.closeness.score} />
        </div>
        {focus && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-accent/40 bg-surface/95 px-2.5 py-1.5 text-[12px] shadow-paper">
            <span className="text-muted">Tracing</span>
            <span className="font-medium text-ink">{ev.impact.reads[focus]?.name}</span>
            <button onClick={() => setFocus(null)} className="text-faint hover:text-ink" aria-label="Stop tracing">
              <X size={13} />
            </button>
          </div>
        )}
        {schema.tables.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center">
            <div className="rounded-xl border border-dashed border-line bg-surface/80 px-5 py-4 text-center">
              <p className="font-mono text-sm font-semibold">← Drag tables onto the canvas</p>
              <p className="mt-1 text-[12px] text-muted">Start from the access patterns: what does the hottest query need? Every change shows its impact on the right.</p>
            </div>
          </div>
        )}
        {celebrate && (
          <div className="absolute inset-x-0 bottom-16 flex justify-center">
            <div className="flex items-center gap-3 rounded-xl border border-ok/40 bg-surface px-4 py-3 shadow-lift">
              <PartyPopper className="text-ok" size={22} />
              <div>
                <p className="font-mono text-sm font-semibold text-ok">All requirements met · {ev.closeness.score}% match</p>
                <p className="text-[12px] text-muted">Now stress it: trace each query, then try denormalising one thing and read the impact.</p>
              </div>
              {mode === 'build' ? (
                <Link to={topicPath(topic, 'challenge')}>
                  <Button size="sm" variant="success" icon={<ArrowRight size={14} />}>
                    Transfer challenge
                  </Button>
                </Link>
              ) : (
                <Link to={nextTopic ? topicPath(nextTopic, nextTopic.kind === 'lab' ? 'lab' : 'learn') : '/data-modeling'}>
                  <Button size="sm" variant="success" icon={<ArrowRight size={14} />}>
                    Next topic
                  </Button>
                </Link>
              )}
              <Button size="xs" variant="ghost" iconOnly aria-label="Dismiss" icon={<X size={14} />} onClick={() => setCelebrate(false)} />
            </div>
          </div>
        )}
      </main>

      <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-paper">
        {sel ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {log[0]?.subject === sel.id && (
              <div className="border-b border-line px-4 py-2.5">
                <div className="eyebrow mb-1">Impact of your last change</div>
                <ChangeCard change={log[0]} compact />
              </div>
            )}
            <div className="min-h-0 flex-1">
              <Inspector key={sel.id} sc={sc} table={sel} impact={ev.impact} verdict={ev.verdicts[sel.id]} editable onClose={() => setSelected(null)} onRemove={() => onDeleteTables([sel.id])} />
            </div>
          </div>
        ) : (
          <>
            <div className="flex border-b border-line">
              {(['feedback', 'impact', 'changes'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn('flex-1 py-2 font-mono text-[11px] uppercase tracking-wider', tab === t ? 'border-b-2 border-accent text-ink' : 'text-faint hover:text-muted')}
                >
                  {TAB_LABEL[t]}
                  {t === 'changes' && log.length > 0 && <span className="ml-1 rounded bg-sunken px-1 text-[10px] text-muted">{log.length}</span>}
                  {t === 'impact' && ev.impact.counts.bad > 0 && <span className="ml-1 rounded bg-bad/15 px-1 text-[10px] text-bad">{ev.impact.counts.bad}</span>}
                </button>
              ))}
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
              {tab === 'feedback' ? (
                <>
                  {recent && (
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="eyebrow">What just changed</span>
                        <button className="font-mono text-[10.5px] text-faint hover:text-ink" onClick={() => setTab('changes')}>
                          full log →
                        </button>
                      </div>
                      <ChangeCard change={recent} />
                    </div>
                  )}
                  {notes.length > 0 && (
                    <div className="space-y-2">
                      {notes.slice(0, 3).map((n, i) => (
                        <Callout key={n.key} tone={n.tone} title={n.title} className={cn(i > 0 && 'opacity-70')}>
                          <span className="text-[12px]">
                            <Rich text={i > 0 ? n.body.split('. ')[0] + '.' : n.body} />
                          </span>
                        </Callout>
                      ))}
                    </div>
                  )}
                  <ClosenessView close={ev.closeness} reqs={ev.reqs} solved={ev.solved} concealGaps={mode === 'challenge'} />
                  <div className="rounded-lg border border-line bg-surface p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="eyebrow">Stuck?</span>
                      <Button
                        size="xs"
                        variant="secondary"
                        icon={<Lightbulb size={13} />}
                        disabled={hintLevel >= maxHint || ev.solved}
                        onClick={() => {
                          setHintLevel((h) => Math.min(maxHint, h + 1) as 1 | 2 | 3);
                          addHint(topic.id);
                        }}
                      >
                        {hintLevel === 0 ? 'Nudge' : hintLevel < maxHint ? 'Stronger hint' : 'No more hints'}
                      </Button>
                    </div>
                    {hintLevel > 0 ? (
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                        <Rich text={hint(sc, schema, ev, hintLevel as 1 | 2 | 3)} />
                      </p>
                    ) : (
                      <p className="mt-1 text-[11.5px] text-faint">Hints fade from a nudge to the exact move. First, open Impact and trace the hottest query: which table does it scan?</p>
                    )}
                  </div>
                </>
              ) : tab === 'impact' ? (
                <ImpactPanel sc={sc} impact={ev.impact} focus={focus} onFocus={setFocus} onSelectTable={setSelected} />
              ) : log.length ? (
                <div className="space-y-2">
                  {log.map((c, i) => (
                    <div key={c.key} className={cn(i > 0 && 'opacity-80')}>
                      <ChangeCard change={c} compact={i > 0} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-faint">Every change you make is logged here with its impact on queries, writes, anomalies and storage.</p>
              )}
              <div className="flex justify-end pt-1">
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<Eraser size={12} />}
                  onClick={() => {
                    if (!confirm('Reset the canvas and start over?')) return;
                    clearCanvas(topic.id, mode);
                    setSchema(startSchema(sc));
                    setNotes([]);
                    setLog([]);
                    setSelected(null);
                    setFocus(null);
                  }}
                >
                  Start over
                </Button>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
