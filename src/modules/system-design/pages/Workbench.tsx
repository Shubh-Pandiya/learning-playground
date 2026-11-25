import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Eraser, Lightbulb, PartyPopper, X } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, Tag } from '@/shared/ui';
import { COMPONENTS } from '../data/components';
import { edgeFeedback, evaluate, hint, nodeFeedback } from '../engine/evaluate';
import { edgeId, toGNode } from '../engine/graph';
import { canvasKey, useSd } from '../store';
import type { ComponentKind, GNode, Graph, Pattern, Scenario } from '../types';
import { Canvas } from '../ui/Canvas';
import { FeedbackCard, feedbackFromNode, Inspector, type FeedbackItem } from '../ui/Inspector';
import { Capabilities, ClosenessView, MetricStrip } from '../ui/Metrics';
import { Palette } from '../ui/Palette';
import { Rich } from '../ui/Rich';
import { TrafficBar } from '../ui/TrafficBar';
import { fmtPct, fmtQps } from '../ui/format';

type Tab = 'design' | 'capabilities';

function initialGraph(s: Scenario): Graph {
  return { nodes: s.reference.nodes.filter((n) => n.kind === 'client').map(toGNode), edges: [] };
}

/** Click-to-add placement: the kind's slot in the reference layout if free, else a free spot right of the graph. */
function nextPos(g: Graph, s: Scenario, kind: ComponentKind): { x: number; y: number } {
  const taken = (x: number, y: number) => g.nodes.some((n) => Math.abs(n.x - x) < 120 && Math.abs(n.y - y) < 90);
  for (const r of s.reference.nodes) if (r.kind === kind && !taken(r.x, r.y)) return { x: r.x, y: r.y };
  if (!g.nodes.length) return { x: 0, y: 120 };
  const x = Math.min(Math.max(...g.nodes.map((n) => n.x)) + 190, 1140);
  for (const dy of [0, 130, -130, 260, -260, 390]) if (!taken(x, 120 + dy)) return { x, y: 120 + dy };
  return { x, y: 520 };
}

const uid = (k: string) => `${k}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function Workbench({ pattern, mode }: { pattern: Pattern; mode: 'build' | 'challenge' }) {
  const s = mode === 'build' ? pattern.scenario : pattern.challenge;
  const key = canvasKey(pattern.id, mode);
  const saved = useSd((st) => st.canvases[key]);
  const saveCanvas = useSd((st) => st.saveCanvas);
  const clearCanvas = useSd((st) => st.clearCanvas);
  const recordResult = useSd((st) => st.recordResult);
  const addHint = useSd((st) => st.addHint);
  const recordChaos = useSd((st) => st.recordChaos);
  const prog = useSd((st) => st.patterns[pattern.id]);

  const [graph, setGraph] = useState<Graph>(() => (saved ? { nodes: saved.nodes.map((n) => ({ ...n, down: 0 })), edges: saved.edges } : initialGraph(s)));
  const [traffic, setTraffic] = useState(1);
  const [animate, setAnimate] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedbackItem[]>([]);
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2 | 3>(0);
  const [tab, setTab] = useState<Tab>('design');
  const [fresh, setFresh] = useState<string[]>([]);
  const [celebrate, setCelebrate] = useState(false);
  const maxHint = mode === 'challenge' ? 2 : 3;

  const ev = useMemo(() => evaluate(graph, s, traffic), [graph, s, traffic]);

  // persist (without injected failures)
  useEffect(() => {
    saveCanvas(pattern.id, mode, { nodes: graph.nodes.map((n) => ({ ...n, down: 0 })), edges: graph.edges });
  }, [graph, pattern.id, mode, saveCanvas]);

  const wasSolved = useRef(ev.solved);
  useEffect(() => {
    recordResult(pattern.id, mode, ev.close.score, ev.solved);
    if (ev.solved && !wasSolved.current) setCelebrate(true);
    wasSolved.current = ev.solved;
  }, [ev.solved, ev.close.score, pattern.id, mode, recordResult]);

  useEffect(() => setHintLevel(0), [graph.nodes.length, graph.edges.length]);

  const push = (f: FeedbackItem) => setFeed((xs) => [f, ...xs.filter((x) => x.key !== f.key)].slice(0, 8));
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const nameOf = (id: string) => byId.get(id)?.label ?? COMPONENTS[byId.get(id)?.kind ?? 'app'].name;

  const addNode = (kind: ComponentKind, x?: number, y?: number) => {
    const pos = x === undefined || y === undefined ? nextPos(graph, s, kind) : { x, y };
    const n: GNode = { id: uid(kind), kind, count: 1, ...pos };
    setGraph((g) => ({ ...g, nodes: [...g.nodes, n] }));
    push(feedbackFromNode(n.id, nodeFeedback(s, kind), COMPONENTS[kind].usedBy));
    setFresh([n.id]);
    setTab('design');
    setSelected(null);
  };

  const connect = (from: string, to: string) => {
    const id = edgeId(from, to);
    if (graph.edges.some((e) => e.id === id)) return;
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) return;
    setGraph((g) => ({ ...g, edges: [...g.edges, { id, from, to }] }));
    const fb = edgeFeedback(s, a, b);
    push({
      key: id,
      tone: fb.verdict === 'good' ? 'ok' : fb.verdict === 'wrong' ? 'bad' : 'warn',
      title: `${nameOf(from)} → ${nameOf(to)}`,
      body: fb.text,
    });
    setTab('design');
  };

  const deleteNodes = (ids: string[]) => {
    setGraph((g) => ({
      nodes: g.nodes.filter((n) => !ids.includes(n.id) || n.kind === 'client'),
      edges: g.edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to)),
    }));
    if (selected && ids.includes(selected)) setSelected(null);
  };
  const deleteEdges = (ids: string[]) => setGraph((g) => ({ ...g, edges: g.edges.filter((e) => !ids.includes(e.id)) }));
  const patchNode = (id: string, f: (n: GNode) => Partial<GNode>) => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...f(n) } : n)) }));

  const onCanvas = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of graph.nodes) c[n.kind] = (c[n.kind] ?? 0) + 1;
    return c;
  }, [graph.nodes]);

  const sel = selected ? byId.get(selected) : undefined;
  const anyDown = graph.nodes.some((n) => n.down);
  const hintText = hintLevel ? hint(graph, s, ev, hintLevel as 1 | 2 | 3) : '';
  const wl = s.workload;

  return (
    <div className="flex h-full min-h-0">
      {/* left: scenario + palette */}
      <aside className="flex w-[268px] shrink-0 flex-col overflow-y-auto border-r border-line bg-paper p-3.5">
        <div className="eyebrow">{mode === 'build' ? 'Scenario' : 'Transfer challenge · new domain'}</div>
        <h2 className="mt-1 font-mono text-[15px] font-semibold leading-snug">{s.title}</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          <Rich text={s.context} />
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Tag size="sm" tone="accent">
            peak {fmtQps(wl.qps)}
          </Tag>
          <Tag size="sm">{fmtPct(wl.readRatio)} reads</Tag>
          {wl.abusive ? <Tag size="sm" tone="bad">+{fmtPct(wl.abusive)} bots</Tag> : null}
          {wl.retryRate ? <Tag size="sm" tone="warn">{fmtPct(wl.retryRate)} retried</Tag> : null}
        </div>
        {mode === 'challenge' && !prog?.buildSolved && (
          <Callout tone="tip" className="mt-3">
            <span className="text-[12px]">Tip: solve the Build scenario first. Same pattern, different problem — that's the point.</span>
          </Callout>
        )}
        <div className="my-3 h-px bg-line" />
        <Palette kinds={s.palette} onCanvas={onCanvas} onAdd={(k) => addNode(k)} />
      </aside>

      {/* center: canvas */}
      <main className="relative min-w-0 flex-1">
        <Canvas
          graph={graph}
          sim={ev.sim}
          nodeVerdicts={ev.close.nodeVerdicts}
          edgeVerdicts={ev.close.edgeVerdicts}
          fresh={fresh}
          editable
          animate={animate}
          showRates
          selectedId={selected}
          onSelect={setSelected}
          onMove={(id, x, y) => patchNode(id, () => ({ x, y }))}
          onAddNode={addNode}
          onConnect={connect}
          onDeleteNodes={deleteNodes}
          onDeleteEdges={deleteEdges}
          fitKey={`${pattern.id}:${mode}`}
        />
        <div className="pointer-events-none absolute left-3 right-3 top-3 flex justify-center">
          <MetricStrip m={ev.sim.metrics} wl={wl} traffic={traffic} score={ev.close.score} />
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 flex">
          <TrafficBar
            traffic={traffic}
            setTraffic={setTraffic}
            animate={animate}
            setAnimate={setAnimate}
            anyDown={anyDown}
            onRestoreAll={() => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => ({ ...n, down: 0 })) }))}
          />
        </div>
        {graph.nodes.length <= 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center">
            <div className="rounded-xl border border-dashed border-line bg-surface/80 px-5 py-4 text-center">
              <p className="font-mono text-sm font-semibold">Drag components onto the canvas →</p>
              <p className="mt-1 text-[12px] text-muted">Start from the client and work inwards. Each addition is explained. Connect nodes by dragging from a node's right dot.</p>
            </div>
          </div>
        )}
        {celebrate && (
          <div className="absolute inset-x-0 bottom-16 flex justify-center">
            <div className="flex items-center gap-3 rounded-xl border border-ok/40 bg-surface px-4 py-3 shadow-lift">
              <PartyPopper className="text-ok" size={22} />
              <div>
                <p className="font-mono text-sm font-semibold text-ok">All requirements met · {ev.close.score}% match</p>
                <p className="text-[12px] text-muted">Now break it: kill nodes and spike traffic to see where it bends.</p>
              </div>
              {mode === 'build' ? (
                <Link to={`/system-design/p/${pattern.id}/challenge`}>
                  <Button size="sm" variant="success" icon={<ArrowRight size={14} />}>
                    Transfer challenge
                  </Button>
                </Link>
              ) : (
                <Link to="/system-design">
                  <Button size="sm" variant="success" icon={<ArrowRight size={14} />}>
                    Next pattern
                  </Button>
                </Link>
              )}
              <Button size="xs" variant="ghost" iconOnly aria-label="Dismiss" icon={<X size={14} />} onClick={() => setCelebrate(false)} />
            </div>
          </div>
        )}
      </main>

      {/* right: feedback / score / capabilities */}
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-paper">
        {sel ? (
          <div className="flex-1 overflow-y-auto p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="eyebrow">Component</span>
              <Button size="xs" variant="ghost" iconOnly aria-label="Close" icon={<X size={14} />} onClick={() => setSelected(null)} />
            </div>
            <Inspector
              key={sel.id}
              node={sel}
              sim={ev.sim.nodes[sel.id]}
              graph={graph}
              wl={wl}
              feedback={sel.kind === 'client' ? undefined : nodeFeedback(s, sel.kind)}
              edgeNotes={graph.edges
                .filter((e) => (e.from === sel.id || e.to === sel.id) && ev.close.edgeVerdicts[e.id] === 'wrong')
                .map((e) => `${nameOf(e.from)} → ${nameOf(e.to)}: ${ev.close.edgeNotes[e.id]}`)}
              editable
              onCount={(d) => patchNode(sel.id, (n) => ({ count: Math.max(1, Math.min(20, n.count + d)), down: Math.min(n.down ?? 0, Math.max(1, n.count + d)) }))}
              onKill={() => patchNode(sel.id, (n) => ({ down: Math.min(n.count, (n.down ?? 0) + 1) }))}
              onRestore={() => patchNode(sel.id, () => ({ down: 0 }))}
              onDelete={sel.kind === 'client' ? undefined : () => deleteNodes([sel.id])}
              onPredicted={recordChaos}
            />
          </div>
        ) : (
          <>
            <div className="flex border-b border-line">
              {(['design', 'capabilities'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn('flex-1 py-2 font-mono text-[11px] uppercase tracking-wider', tab === t ? 'border-b-2 border-accent text-ink' : 'text-faint hover:text-muted')}
                >
                  {t === 'design' ? 'Feedback & score' : 'Capabilities'}
                </button>
              ))}
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
              {tab === 'design' ? (
                <>
                  {feed.length > 0 && (
                    <div className="space-y-2">
                      <FeedbackCard f={feed[0]} />
                      {feed.slice(1, 4).map((f) => (
                        <div key={f.key} className="opacity-70">
                          <FeedbackCard f={f} compact />
                        </div>
                      ))}
                    </div>
                  )}
                  <ClosenessView close={ev.close} reqs={ev.reqs} solved={ev.solved} concealGaps={mode === 'challenge'} />
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
                          addHint(pattern.id);
                        }}
                      >
                        {hintLevel === 0 ? 'Nudge' : hintLevel < maxHint ? 'Stronger hint' : 'No more hints'}
                      </Button>
                    </div>
                    {hintLevel > 0 ? (
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{hintText}</p>
                    ) : (
                      <p className="mt-1 text-[11.5px] text-faint">Hints fade from a nudge to the exact step. Try predicting first: which node turns red at 2× traffic?</p>
                    )}
                  </div>
                </>
              ) : (
                <Capabilities m={ev.sim.metrics} wl={wl} traffic={traffic} nameOf={nameOf} />
              )}
              <div className="flex justify-end pt-1">
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<Eraser size={12} />}
                  onClick={() => {
                    if (!confirm('Clear the canvas and start over?')) return;
                    clearCanvas(pattern.id, mode);
                    setGraph(initialGraph(s));
                    setFeed([]);
                    setSelected(null);
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
